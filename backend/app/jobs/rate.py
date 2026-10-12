"""
Rate hostels with Jev (app/ratings.py) and report what the run cost on OpenRouter.

    python -m app.jobs.rate --city barcelona prague
    python -m app.jobs.rate --all --missing       # only hostels without a current rating
    python -m app.jobs.rate --hostel 310413
"""
import argparse
import time

import requests

from app import config, db
from app.ratings import OPENROUTER_BASE_URL, RATING_MODEL, load_reviews, rate_hostel, save_rating


def openrouter_usage():
    """Total USD spent with this OpenRouter key so far."""
    resp = requests.get(f"{OPENROUTER_BASE_URL}/key",
                        headers={"Authorization": f"Bearer {config.OPENROUTER_API_KEY}"}, timeout=30)
    resp.raise_for_status()
    return float(resp.json()["data"]["usage"])


def select_hostels(args):
    where, params = ["s.review_count > 0"], []
    if args.hostel:
        where.append("h.id = ANY(%s)")
        params.append(args.hostel)
    else:
        where.append("h.delisted_at IS NULL")
    if args.city:
        where.append("c.slug = ANY(%s)")
        params.append(args.city)
    if args.missing:
        where.append("NOT EXISTS (SELECT 1 FROM jev_ratings j WHERE j.hostel_id = h.id AND j.model = %s)")
        params.append(RATING_MODEL)
    return db.fetch_all(
        f"""
        SELECT h.id, h.name FROM hostels h
        JOIN cities c ON c.id = h.city_id
        JOIN hostel_stats s ON s.hostel_id = h.id
        WHERE {' AND '.join(where)}
        ORDER BY c.slug, h.id
        """,
        params,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--city", nargs="+", help="city slugs")
    scope.add_argument("--hostel", nargs="+", type=int)
    scope.add_argument("--all", action="store_true")
    parser.add_argument("--missing", action="store_true", help=f"skip hostels already rated by {RATING_MODEL}")
    args = parser.parse_args()

    hostels = select_hostels(args)
    print(f"{len(hostels)} hostels to rate")
    before = openrouter_usage()
    rated = 0
    for n, hostel in enumerate(hostels, 1):
        try:
            rating = rate_hostel(load_reviews(hostel["id"]))
            if rating is None:
                print(f"[{n}/{len(hostels)}] {hostel['id']} {hostel['name']}: no review text")
                continue
            save_rating(hostel["id"], rating)
            rated += 1
            print(f"[{n}/{len(hostels)}] {hostel['id']} {hostel['name']}: "
                  f"{rating['n_reviews']} reviews, overall {rating['calibrated'].get('overall')}")
        except Exception as e:
            print(f"[{n}/{len(hostels)}] {hostel['id']} {hostel['name']}: failed: {e}")

    if rated:
        time.sleep(15)  # OpenRouter's usage total lags a few seconds behind
        cost = openrouter_usage() - before
        print(f"rated {rated}/{len(hostels)} for ${cost:.4f} (${cost / rated:.4f} per hostel)")


if __name__ == "__main__":
    main()
