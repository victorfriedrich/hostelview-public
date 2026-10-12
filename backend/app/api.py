"""
Hostelview API. Every endpoint is one query against Postgres; per-hostel and
per-city figures come precomputed from the materialized views (002_derived_views.sql).

Scores are on Hostelworld's 0-10 scale throughout, Jev's included.
"""
from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app import config, db, graph, hostel_search, recommend
from app.aspects import ASPECTS

# Jev aspects beyond Hostelworld's seven.
JEV_EXTRA = ("bathrooms", "party", "social")
CACHE = "public, max-age=300"



@asynccontextmanager
async def lifespan(app):
    """Build the hostel graph (app/graph.py) in the background, so the first request doesn't wait."""
    graph.warm()
    yield


app = FastAPI(title="Hostelview API", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["GET"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"status": "ok"}


# ── Cities ──────────────────────────────────────────────────────────────────

@app.get("/cities")
def cities(response: Response):
    """Every city with at least one hostel, with its map figures."""
    response.headers["Cache-Control"] = CACHE
    rows = db.fetch_all(
        """
        SELECT c.slug, c.name, c.country, c.lat, c.lon, s.hostel_count, s.reviewed_hostel_count,
               s.avg_rating, s.avg_atmosphere, s.avg_dorm_price, s.top_rating, s.top_dorm_price
        FROM cities c JOIN city_stats s ON s.city_id = c.id
        WHERE s.hostel_count > 0
        ORDER BY c.name
        """
    )
    return [
        {
            "slug": r["slug"], "name": r["name"], "country": r["country"], "lat": r["lat"], "lon": r["lon"],
            "hostelCount": r["hostel_count"], "reviewedHostelCount": r["reviewed_hostel_count"],
            "avgRating": _num(r["avg_rating"]), "avgAtmosphere": _num(r["avg_atmosphere"]),
            "avgDormPrice": _num(r["avg_dorm_price"]), "topRating": _num(r["top_rating"]),
            "topDormPrice": _num(r["top_dorm_price"]),
        }
        for r in rows
    ]


# ── Hostels ─────────────────────────────────────────────────────────────────

HOSTEL_SQL = f"""
    SELECT h.id, h.name, c.slug AS city_slug, c.name AS city_name, c.country,
           h.hw_rating, h.hw_review_count, {', '.join(f'h.hw_{a}' for a in ASPECTS)}, h.delisted_at,
           s.review_count, s.first_review_on, s.last_review_on,
           s.overall, {', '.join(f's.{a}' for a in ASPECTS)},
           s.gender, s.age, s.nationalities, s.experience, s.reviewer_reviews_median,
           s.dorm_from, s.private_from, s.prices_scraped_on,
           j.model AS jev_model, j.n_reviews AS jev_reviews, j.calibrated AS jev, j.rated_at AS jev_rated_at,
           seg.segments
    FROM hostels h
    JOIN cities c ON c.id = h.city_id
    JOIN hostel_stats s ON s.hostel_id = h.id
    LEFT JOIN jev_ratings j ON j.hostel_id = h.id
    LEFT JOIN hostel_segments seg ON seg.hostel_id = h.id
"""


@app.get("/cities/{slug}/hostels")
def city_hostels(slug: str, response: Response):
    """The city's listed hostels that have any score, most-reviewed first."""
    rows = db.fetch_all(
        HOSTEL_SQL + """
        WHERE c.slug = %s AND h.delisted_at IS NULL AND (h.hw_rating IS NOT NULL OR s.review_count > 0)
        ORDER BY s.review_count DESC, h.hw_review_count DESC NULLS LAST, h.id
        """,
        (slug,),
    )
    if not rows and not db.fetch_one("SELECT 1 FROM cities WHERE slug = %s", (slug,)):
        raise HTTPException(404, f"No city {slug!r}")
    response.headers["Cache-Control"] = CACHE
    return [_hostel(r) for r in rows]


# ── For you ─────────────────────────────────────────────────────────────────

@app.get("/recommendations")
def recommendations(
    response: Response,
    aspects: str = Query("", description="comma-separated aspect:weight, weight 1 (important) or 2 (top priority)"),
    liked: str = Query("", description="comma-separated ids of hostels the traveller liked"),
    disliked: str = Query("", description="comma-separated ids of hostels the traveller disliked"),
    bbox: str | None = Query(None, description="west,south,east,north in degrees: only cities inside"),
    limit: int = Query(30, ge=1, le=100),
):
    """
    Hostels in all cities (or those inside `bbox`) ranked for the aspects the traveller cares
    about and liked and disliked hostels (app/recommend.py). Liked or disliked hostels
    neither linked in the hostel graph (app/graph.py) nor with enough reviews to compare
    (app/similarity.py) carry no signal and are listed in `unmatched`.
    """
    try:
        liked_ids = list(dict.fromkeys(int(x) for x in liked.split(",") if x.strip()))[:20]
        disliked_ids = [i for i in dict.fromkeys(int(x) for x in disliked.split(",") if x.strip()) if i not in liked_ids][:20]
        box = [float(x) for x in bbox.split(",")] if bbox else None
        weights = {a: int(w) for a, w in (x.split(":") for x in aspects.split(",") if x.strip())}
    except ValueError:
        raise HTTPException(422, "liked and disliked must be hostel ids, bbox four numbers, aspects aspect:weight")
    if box is not None and len(box) != 4:
        raise HTTPException(422, "bbox must be west,south,east,north")
    if any(a not in ASPECTS or w not in (1, 2) for a, w in weights.items()):
        raise HTTPException(422, f"aspects must be among {', '.join(ASPECTS)}, weighted 1 or 2")
    response.headers["Cache-Control"] = CACHE
    return recommend.recommend(liked_ids, disliked_ids, box, limit, weights)


# Declared before /hostels/{hostel_id}, which would otherwise claim the path.
@app.get("/hostels/search")
def search_hostels(response: Response, q: str = Query(..., min_length=2, max_length=80), limit: int = Query(10, ge=1, le=20),
                   names_only: bool = False):
    """
    Hostels whose name or city contains every word of `q`, ignoring case, accents and
    punctuation (app/hostel_search.py), for picking hostels you liked or disliked. `names_only`
    keeps only hostels whose name has a word starting with each word of `q`, for the city search
    box. `comparable` is false for hostels without stored reviews, whose guests can't be matched.
    """
    response.headers["Cache-Control"] = CACHE
    return [
        {"id": r["id"], "name": r["name"], "city": {"slug": r["slug"], "name": r["city_name"], "country": r["country"]},
         "reviewCount": r["review_count"], "comparable": r["review_count"] > 0}
        for r in hostel_search.search(q, limit, names_only)
    ]


@app.get("/hostels/{hostel_id}")
def hostel(hostel_id: int, response: Response):
    row = db.fetch_one(HOSTEL_SQL + " WHERE h.id = %s", (hostel_id,))
    if row is None:
        raise HTTPException(404, f"No hostel {hostel_id}")
    response.headers["Cache-Control"] = CACHE
    return _hostel(row)


@app.get("/hostels/{hostel_id}/history")
def history(hostel_id: int, response: Response):
    """
    Guest scores averaged over the 14 most recent review dates, per review date,
    and the number of reviews per calendar week.
    """
    with db.connection() as conn:
        points = conn.execute(
            f"""
            SELECT reviewed_on, reviews, overall, {', '.join(ASPECTS)}
            FROM hostel_review_history WHERE hostel_id = %s ORDER BY reviewed_on
            """,
            (hostel_id,),
        ).fetchall()
        volume = conn.execute(
            "SELECT block_start, reviews FROM hostel_review_volume WHERE hostel_id = %s ORDER BY block_start",
            (hostel_id,),
        ).fetchall()
    if not points:
        raise HTTPException(404, f"No reviews for hostel {hostel_id}")
    response.headers["Cache-Control"] = CACHE
    return {
        "windowDates": 14,
        "points": [
            {"date": p["reviewed_on"].isoformat(), "reviews": p["reviews"],
             "scores": {k: _num(p[k]) for k in ("overall", *ASPECTS)}}
            for p in points
        ],
        "volumeBlockDays": 7,
        "volume": [{"start": v["block_start"].isoformat(), "reviews": v["reviews"]} for v in volume],
    }


@app.get("/hostels/{hostel_id}/also-stayed")
def also_stayed(hostel_id: int, response: Response, limit: int = Query(6, ge=1, le=20)):
    """
    "Guests of this hostel also stayed at": the hostels closest to it in the hostel graph
    (app/graph.py), with the guests they share or the hostel they're reached through.
    """
    if not db.fetch_one("SELECT 1 FROM hostels WHERE id = %s", (hostel_id,)):
        raise HTTPException(404, f"No hostel {hostel_id}")
    response.headers["Cache-Control"] = CACHE
    return recommend.also_stayed(hostel_id, limit)


@app.get("/hostels/{hostel_id}/reviews")
def reviews(
    hostel_id: int,
    response: Response,
    start: date | None = Query(None, alias="from"),
    end: date | None = Query(None, alias="to"),
    limit: int = Query(500, ge=1, le=2000),
):
    """Reviews with text, newest first, optionally within [from, to]."""
    rows = db.fetch_all(
        """
        SELECT id, reviewed_on, text, score_overall, group_type, age_range, nationality
        FROM reviews
        WHERE hostel_id = %s AND text <> ''
          AND (%s::date IS NULL OR reviewed_on >= %s::date)
          AND (%s::date IS NULL OR reviewed_on <= %s::date)
        ORDER BY reviewed_on DESC, id DESC
        LIMIT %s
        """,
        (hostel_id, start, start, end, end, limit),
    )
    response.headers["Cache-Control"] = CACHE
    return [
        {"id": r["id"], "date": r["reviewed_on"].isoformat(), "text": r["text"],
         "score": _score(r["score_overall"]), "groupType": r["group_type"], "age": r["age_range"],
         "nationality": r["nationality"]}
        for r in rows
    ]


# ── Shapes ──────────────────────────────────────────────────────────────────

def _num(value):
    return float(value) if value is not None else None


def _score(value_100):
    return round(value_100 / 10, 1) if value_100 is not None else None


def _hostel(r):
    reviewed = r["review_count"] > 0
    jev = r["jev"]
    price = None
    # A delisted hostel's last prices are no longer on offer.
    if r["delisted_at"] is None and (r["dorm_from"] is not None or r["private_from"] is not None):
        price = {"dormFrom": _num(r["dorm_from"]), "privateFrom": _num(r["private_from"]),
                 "scrapedOn": r["prices_scraped_on"].isoformat()}
    return {
        "id": r["id"],
        "name": r["name"],
        "city": {"slug": r["city_slug"], "name": r["city_name"], "country": r["country"]},
        # Dropped off Hostelworld; the page stays for its reviews.
        "delisted": r["delisted_at"] is not None,
        # Hostelworld's published scores.
        "hostelworld": {
            "rating": _num(r["hw_rating"]),
            "reviewCount": r["hw_review_count"],
            "scores": {a: _num(r[f"hw_{a}"]) for a in ASPECTS},
        },
        # Averages over the reviews stored for this hostel (Hostelworld shows only the last 36 months).
        "guests": {
            "rating": _num(r["overall"]),
            "reviewCount": r["review_count"],
            "scores": {a: _num(r[a]) for a in ASPECTS},
            "firstReview": r["first_review_on"].isoformat(),
            "lastReview": r["last_review_on"].isoformat(),
        } if reviewed else None,
        # Jev's calibrated 0..1 ratings, on the same 2-10 range as the guest scores.
        "jev": {
            "model": r["jev_model"],
            "reviewCount": r["jev_reviews"],
            "ratedAt": r["jev_rated_at"].isoformat(),
            "rating": _jev(jev.get("overall")),
            "scores": {**{a: _jev(jev.get("value_for_money" if a == "value" else a)) for a in ASPECTS},
                       **{a: _jev(jev.get(a)) for a in JEV_EXTRA}},
        } if jev else None,
        "demographics": {
            "gender": r["gender"] or {},
            "age": r["age"] or {},
            "nationalities": r["nationalities"] or {},
            "reviewerExperienceMedian": r["reviewer_reviews_median"],
        } if reviewed else None,
        # Reviews per kind of traveller: dimension -> segment -> count (009_segment_counts.sql).
        "segments": r["segments"],
        "price": price,
    }


def _jev(x):
    return round(2 + 8 * x, 2) if x is not None else None
