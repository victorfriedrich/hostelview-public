"""
"For you" ranking (the map view's For you tab) and "Guests of X also stayed at" (hostel pages).

Both use the hostel graph (app/graph.py): hostels linked when guests rated both 9.4 or
higher (a good review: about 40% of reviews are a straight 10, and 8.0 is already in the
bottom fifth), walked from a starting hostel to find the ones closest to it.

For you ranks by a rating for what the traveller cares about (the Profile tab) plus a bonus:

- rating: the hostel's guest rating averaged with the aspects the traveller cares about
  (counted once more when important, twice when top priority).
- liked: up to +1.2 for closeness to the hostels the traveller liked and down to -0.6 for
  closeness to ones they disliked. Closeness mixes the graph walk's score with how alike the
  hostels' crowds and scores are (app/similarity.py), each relative to the closest hostel
  anywhere, so the hostel nearest a liked one gets the full bonus and hostels far from all
  of them get close to none.
"""
import numpy as np

from app import cached, db, graph, similarity
from app.aspects import ASPECTS

# Hostels with fewer stored reviews aren't ranked: their averages are mostly noise.
MIN_REVIEWS = 20
# Pseudo-reviews at the overall average, so 25 perfect reviews don't outrank 2,000
# excellent ones: reviews vary by ~1.6 points, hostels' true averages by ~0.4, (1.6/0.4)^2.
# Aspect averages are shrunk the same way.
BASE_SHRINK = 16
# Rating points for the hostel closest to the liked ones; closeness to disliked ones costs
# up to half that. Well above the spread of ratings near the top (9.5-9.9), so closeness
# decides among excellent hostels rather than a few tenths of rating (at 0.5, chains rated
# 9.8 that liked hostels' guests rarely go to outranked the ones they do).
LIKE_BONUS = 1.2
DISLIKE_FACTOR = 0.5
# How closeness to liked hostels splits between the graph and similarity, when both reach them.
GRAPH_SHARE = 0.6
# Cosine similarity below which hostels count as not alike: the median hostel is ~0, the
# closest 10% above ~0.5 (September 2026).
SIMILAR_FROM = 0.5
CACHE_SECONDS = 3600

CANDIDATES_SQL = f"""
    SELECT h.id, h.name, c.slug, c.name AS city_name, c.country, c.lat, c.lon,
           s.review_count, s.overall, {', '.join(f's.{a}' for a in ASPECTS)}, s.dorm_from
    FROM hostels h
    JOIN cities c ON c.id = h.city_id
    JOIN hostel_stats s ON s.hostel_id = h.id
    WHERE s.review_count >= {MIN_REVIEWS} AND s.overall IS NOT NULL AND h.delisted_at IS NULL
"""

def _weighted_mean(rows, key):
    pairs = [(float(r[key]), r["review_count"]) for r in rows if r[key] is not None]
    total = sum(n for _, n in pairs)
    return sum(x * n for x, n in pairs) / total if total else 0.0


def _load_candidates():
    rows = db.fetch_all(CANDIDATES_SQL)
    return rows, {k: _weighted_mean(rows, k) for k in ("overall", *ASPECTS)}


_candidates = cached.Refreshed(_load_candidates, CACHE_SECONDS)


def candidates():
    """Every listed hostel with enough reviews, and review-weighted mean scores; reloaded at most hourly."""
    return _candidates.get()


def _shrunk(row, key, means):
    n, x = row["review_count"], row[key]
    return means[key] if x is None else (n * float(x) + BASE_SHRINK * means[key]) / (n + BASE_SHRINK)


def aspect_rating(row, aspects, means):
    """
    (rating 0-10, [aspects]): the guest rating averaged with the aspects the traveller weighs.

    Aspects are averaged in as guests scored them. Shifting each onto the overall score's
    scale first (by the typical overall minus the typical aspect) changed no ranking except
    by pushing the best hostels past 10: with atmosphere top priority, 21 tied at 10.0
    (September 2026).
    """
    blend, weight = _shrunk(row, "overall", means), 1.0
    aspect_parts = []
    for a, w in aspects.items():
        score = _shrunk(row, a, means)
        blend += w * score
        weight += w
        aspect_parts.append({"aspect": a, "score": round(float(row[a]), 2) if row[a] is not None else None,
                             "vsTypical": round(score - means[a], 2)})
    return min(10.0, max(0.0, blend / weight)), aspect_parts


def closeness(g, anchors):
    """
    (closeness 0..1 per hostel id, per-anchor walks) for walks from the anchors in the graph:
    their average visit probability, relative to the highest outside the anchors.
    """
    walks = {a: g.walk(a) for a in anchors if a in g.index}
    if not walks:
        return {}, {}
    mean = sum(walks.values()) / len(walks)
    outside = mean.copy()
    outside[[g.index[a] for a in walks]] = 0
    top = outside.max()
    return ({h: float(mean[i] / top) for i, h in enumerate(g.ids)} if top > 0 else {}), walks


def likeness(p, anchors):
    """Closeness 0..1 per hostel id by similarity to the anchors: SIMILAR_FROM and below is 0, the most alike 1."""
    sims = p.similarity(anchors)
    if sims is None:
        return {}
    outside = sims.copy()
    outside[[p.index[a] for a in anchors if a in p.index]] = -1
    top = outside.max()
    if top <= SIMILAR_FROM:
        return {}
    near = np.clip((sims - SIMILAR_FROM) / (top - SIMILAR_FROM), 0, 1)
    return {h: float(near[i]) for i, h in enumerate(p.ids) if near[i] > 0}


def _mix(by_graph, by_likeness):
    """Closeness from both sources, weighted GRAPH_SHARE, or from whichever reaches the anchors."""
    if by_graph and by_likeness:
        return {h: GRAPH_SHARE * by_graph.get(h, 0.0) + (1 - GRAPH_SHARE) * by_likeness.get(h, 0.0)
                for h in by_graph.keys() | by_likeness.keys()}
    return by_graph or by_likeness


def _link(g, walks, hostel):
    """Why `hostel` is close to the anchors: the anchor whose walk reaches it most, and how."""
    if hostel not in g.index or not walks:
        return None
    i = g.index[hostel]
    anchor = max(walks, key=lambda a: walks[a][i])
    return {"anchor": anchor, **g.explain(anchor, hostel)}


def _in_box(row, bbox):
    west, south, east, north = bbox
    if row["lat"] is None or not south <= row["lat"] <= north:
        return False
    return west <= row["lon"] <= east if west <= east else (row["lon"] >= west or row["lon"] <= east)


def recommend(liked_ids, disliked_ids=(), bbox=None, limit=30, aspects=None):
    """
    Hostels (inside `bbox`, if given) ranked by rating for the aspects weighed ({aspect: 1 or 2})
    plus closeness to liked ones.
    """
    all_rows, means = candidates()
    aspects = aspects or {}
    anchors = set(liked_ids) | set(disliked_ids)
    rows = [r for r in all_rows if r["id"] not in anchors and (not bbox or _in_box(r, bbox))]
    g = graph.get() if anchors else None
    p = similarity.get() if anchors else None
    near_liked, liked_walks = closeness(g, liked_ids) if g else ({}, {})
    near_disliked, disliked_walks = closeness(g, disliked_ids) if g else ({}, {})
    alike_liked = likeness(p, liked_ids) if p else {}
    alike_disliked = likeness(p, disliked_ids) if p else {}
    liked_near, disliked_near = _mix(near_liked, alike_liked), _mix(near_disliked, alike_disliked)
    # Liked or disliked hostels neither linked in the graph (too few guests rated them and
    # another hostel 9.4+) nor with enough reviews to compare.
    unmatched = [i for i in (*liked_ids, *disliked_ids)
                 if (not g or i not in g.index) and (not p or i not in p.index)]

    scored = []
    for r in rows:
        rating, aspect_parts = aspect_rating(r, aspects, means)
        bonus = LIKE_BONUS * (liked_near.get(r["id"], 0.0) - DISLIKE_FACTOR * disliked_near.get(r["id"], 0.0))
        scored.append((rating + bonus, rating, bonus, aspect_parts, r))
    scored.sort(key=lambda t: -t[0])
    top = scored[:limit]

    # Only worth explaining when a hostel is at least a tenth as close as the closest one
    # (graph), or half as alike as the most alike one (similarity).
    links, alike = {}, {}
    for *_, r in top:
        for key, walks, near, like, ids in (("liked", liked_walks, near_liked, alike_liked, liked_ids),
                                            ("disliked", disliked_walks, near_disliked, alike_disliked, disliked_ids)):
            if g and near.get(r["id"], 0.0) >= 0.1:
                links[r["id"], key] = _link(g, walks, r["id"])
            if p and like.get(r["id"], 0.0) >= 0.5:
                anchor = p.closest(ids, r["id"])
                if anchor:
                    alike[r["id"], key] = {"anchor": anchor}
    via_ids = list({x["via"] for x in links.values() if x and "via" in x})
    names = {x["id"]: x["name"] for x in db.fetch_all("SELECT id, name FROM hostels WHERE id = ANY(%s)", (via_ids,))} if via_ids else {}
    for x in links.values():
        if x and "via" in x:
            x["via"] = {"id": x["via"], "name": names.get(x["via"], "")}

    return {
        "inView": len(scored),
        "hostels": [
            {
                "id": r["id"], "name": r["name"],
                "city": {"slug": r["slug"], "name": r["city_name"], "country": r["country"], "lat": r["lat"], "lon": r["lon"]},
                "rating": round(rating, 2),
                "guestRating": round(float(r["overall"]), 2),
                "reviewCount": r["review_count"],
                "dormFrom": float(r["dorm_from"]) if r["dorm_from"] is not None else None,
                "aspects": aspect_parts,
                "bonus": round(bonus, 3),
                "liked": links.get((r["id"], "liked")),
                "disliked": links.get((r["id"], "disliked")),
                "likedAlike": alike.get((r["id"], "liked")),
                "dislikedAlike": alike.get((r["id"], "disliked")),
            }
            for _, rating, bonus, aspect_parts, r in top
        ],
        "unmatched": unmatched,
    }


# ── Guests of this hostel also stayed at ────────────────────────────────────

HOSTELS_SQL = """
    SELECT h.id, h.name, c.slug, c.name AS city_name, c.country, s.overall, s.review_count, h.delisted_at
    FROM hostels h
    JOIN cities c ON c.id = h.city_id
    JOIN hostel_stats s ON s.hostel_id = h.id
    WHERE h.id = ANY(%s)
"""


def also_stayed(hostel_id, limit=6):
    """
    The listed hostels closest to this one in the hostel graph: most often ones its guests rated 9.4+
    themselves ("guests": how many), otherwise ones reached through such a hostel ("via").
    """
    g = graph.get()
    if hostel_id not in g.index:
        return {"hostels": []}
    walk = g.walk(hostel_id)
    ranked = [g.ids[i] for i in np.argsort(-walk) if g.ids[i] != hostel_id][:limit * 2]  # spares for delisted ones
    info = {r["id"]: r for r in db.fetch_all(HOSTELS_SQL, (ranked,))}
    order = [h for h in ranked if h in info and info[h]["delisted_at"] is None][:limit]
    via_ids = [v for v in (g.explain(hostel_id, h).get("via") for h in order) if v and v not in info]
    if via_ids:
        info.update({r["id"]: r for r in db.fetch_all(HOSTELS_SQL, (via_ids,))})
    out = []
    for h in order:
        r, how = info[h], g.explain(hostel_id, h)
        via = how.get("via")
        out.append({
            "id": h, "name": r["name"],
            "city": {"slug": r["slug"], "name": r["city_name"], "country": r["country"]},
            "guestRating": float(r["overall"]) if r["overall"] is not None else None,
            "reviewCount": r["review_count"],
            "guests": how.get("guests"),
            "via": {"id": via, "name": info[via]["name"]} if via in info else None,
        })
    return {"hostels": out}
