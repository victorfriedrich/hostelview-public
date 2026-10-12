"""
Refit rating_calibration.json from this repo's data.

For every reviewed hostel in the given cities, compares the stored raw Jev rating
(jev_ratings, written by app.jobs.rate) with the mean Hostelworld guest sub-score
over the same review window, and fits human = slope * jev + intercept per aspect.

Run after changing RATING_MODEL, the levels, or the question wording:
    python -m app.calibrate_ratings amsterdam barcelona prague --rate
(--rate first rates hostels that have no stored raw rating from RATING_MODEL.)
"""
import argparse
import json

import numpy as np

from app import db
from app.ratings import CALIBRATION_PATH, RATING_MODEL, load_reviews, rate_hostel, save_rating, select_reviews

# reviews column -> Jev aspect
SCORE_ASPECTS = {
    "score_security": "security", "score_location": "location", "score_staff": "staff",
    "score_atmosphere": "atmosphere", "score_cleanliness": "cleanliness", "score_facilities": "facilities",
    "score_value": "value_for_money", "score_overall": "overall",
}
MIN_HOSTELS = 20


def human_scores(reviews):
    """Mean guest sub-score per aspect (20..100 scaled to 0..1) over the given reviews."""
    sums, counts = {}, {}
    for review in reviews:
        per_aspect = {a: review[col] for col, a in SCORE_ASPECTS.items() if review[col] is not None}
        if len([a for a in per_aspect if a != "overall"]) < 3:
            continue
        for aspect, value in per_aspect.items():
            sums[aspect] = sums.get(aspect, 0.0) + min(1.0, max(0.0, (float(value) - 20) / 80))
            counts[aspect] = counts.get(aspect, 0) + 1
    return {a: sums[a] / counts[a] for a in sums}


def collect_pairs(cities, rate_missing):
    hostels = db.fetch_all(
        """
        SELECT h.id, j.raw, j.model FROM hostels h
        JOIN cities c ON c.id = h.city_id
        JOIN hostel_stats s ON s.hostel_id = h.id
        LEFT JOIN jev_ratings j ON j.hostel_id = h.id
        WHERE c.slug = ANY(%s) AND s.review_count > 0
        """,
        (cities,),
    )
    pairs = {}
    for hostel in hostels:
        reviews = load_reviews(hostel["id"])
        raw = hostel["raw"] if hostel["model"] == RATING_MODEL else None
        if raw is None and rate_missing:
            rating = rate_hostel(reviews)
            if rating:
                save_rating(hostel["id"], rating)
                raw = rating["raw"]
        if raw is None:
            continue
        human = human_scores(select_reviews(reviews))
        for aspect, jev in raw.items():
            if jev is not None and aspect in human:
                pairs.setdefault(aspect, []).append((jev, human[aspect]))
    print(f"{len(hostels)} hostels, {sum(len(v) for v in pairs.values())} aspect pairs")
    return pairs


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("cities", nargs="+", help="city slugs")
    parser.add_argument("--rate", action="store_true", help="rate hostels without a stored raw rating first")
    args = parser.parse_args()

    aspects = {}
    for aspect, pts in collect_pairs(args.cities, args.rate).items():
        x, y = np.array(pts).T
        if len(x) < MIN_HOSTELS or np.allclose(x, x[0]):
            print(f"{aspect}: only {len(x)} usable hostels, skipped")
            continue
        slope, intercept = np.polyfit(x, y, 1)
        r = float(np.corrcoef(x, y)[0, 1])
        aspects[aspect] = {"slope": round(float(slope), 4), "intercept": round(float(intercept), 4),
                           "n": len(x), "r": round(r, 2)}
        print(f"{aspect:16s} n={len(x):4d} r={r:.2f} slope={slope:.3f} intercept={intercept:.3f}")

    if not aspects:
        raise SystemExit("Nothing to fit; keeping the existing calibration.")
    with open(CALIBRATION_PATH, "w") as f:
        json.dump({
            "model": RATING_MODEL,
            "method": "per-aspect least-squares line: human = slope * jev + intercept",
            "fitted_on": f"calibrate_ratings.py on {', '.join(args.cities)}",
            "aspects": aspects,
        }, f, indent=2)
    print(f"Wrote {CALIBRATION_PATH}")


if __name__ == "__main__":
    main()
