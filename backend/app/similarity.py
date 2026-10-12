"""
How alike two hostels are in who stays there and how they score, for the For you tab.

The hostel graph (app/graph.py) links hostels through guests who rated both 9.4+, which
only reaches hostels that share guests. This compares every hostel with enough reviews by
its reviews instead, in six groups:

- gender:     shares of solo women, solo men, couples and groups
- age:        shares of 18-24, 25-30, 31-40 and 41+
- nationality: shares of the most common nationalities (UK nations pooled) and the rest,
              counting half. Keeps hostels with the guests who travel the same routes
              together (Americans in Lisbon, Seville and Florence; Brits and Australians in
              the Balkans)
- scores:     Jev's cleanliness and facilities ratings from the review texts (app/ratings.py),
              each relative to Jev's overall rating, so they say what the hostel is strong at,
              not how good it is overall. Hostels Jev hasn't rated sit at the mean
- vibe:       Jev's party and social ratings from the review texts (app/ratings.py): a
              party hostel, a social but calm one, or neither. Without it most matches are
              just "young crowd". Hostels Jev hasn't rated sit at the mean
- hosting:    what the hostel puts on (app/hosting.py): Jev's scores for shared meals and
              organised daytime activities, counting half so the crowd still leads (party
              hostels stay with the ones their guests also go to). Unknown values sit at the mean

Shares are shrunk towards the shares over all hostels, so 25 reviews don't make a crowd.
Each feature is standardised over the hostels (z-score) and each group is weighted so one
with more features doesn't drown the others; similarity is the cosine between two hostels'
vectors, -1 to 1.
"""
import numpy as np

from app import cached, db

MIN_REVIEWS = 20
SHARE_PRIOR = 10  # pseudo-reviews at the shares over all hostels
CACHE_SECONDS = 3600

SEGMENTS = {
    "gender": ("traveller", ("solo_female", "solo_male", "couple", "group")),
    "age": ("age", ("18-24", "25-30", "31-40", "41+")),
}
# Jev's calibrated aspect ratings compared, each relative to Jev's overall rating.
COMPARED = ("cleanliness", "facilities")
# Jev's calibrated ratings (0-1) compared.
VIBE = ("party", "social")
# Jev's judgement of what the hostel puts on (app/hosting.py).
HOSTING = ("hosted_meals", "organised_activities")
# The nationalities compared (Hostelworld codes, UK nations pooled as "UK"); the rest count as one.
NATIONALITIES = ("UK", "US", "AU", "CA", "DE", "IE", "IN", "NZ", "NL", "FR", "IT", "DK", "MX", "BR", "SE", "ES",
                 "IL", "NO", "FI", "CH")
UK_NATIONS = {"ENG", "SCO", "WAL", "NIR", "GB"}
GROUP_WEIGHTS = {"gender": 1.0, "age": 1.0, "nationality": 0.5, "scores": 1.0, "vibe": 1.0, "hosting": 0.5}

FEATURES_SQL = f"""
    SELECT h.id, seg.segments, j.calibrated AS jev,
           x.hosted_meals, x.organised_activities, s.nationalities
    FROM hostels h
    JOIN hostel_stats s ON s.hostel_id = h.id
    JOIN hostel_segments seg ON seg.hostel_id = h.id
    LEFT JOIN jev_ratings j ON j.hostel_id = h.id
    LEFT JOIN hostel_hosting x ON x.hostel_id = h.id
    WHERE s.review_count >= {MIN_REVIEWS} AND s.overall IS NOT NULL
"""


class Profiles:
    def __init__(self, rows):
        self.ids = [r["id"] for r in rows]
        self.index = {h: i for i, h in enumerate(self.ids)}
        columns, groups = [], []

        for group, (dim, values) in SEGMENTS.items():
            counts = np.array([[((r["segments"] or {}).get(dim) or {}).get(v, 0) for v in values]
                               for r in rows], dtype=float)
            overall = counts.sum(0) / max(counts.sum(), 1)
            shares = (counts + SHARE_PRIOR * overall) / (counts.sum(1, keepdims=True) + SHARE_PRIOR)
            columns.append(shares)
            groups += [group] * len(values)

        counts = np.array([_nationalities(r) for r in rows])
        overall = counts.sum(0) / max(counts.sum(), 1)
        columns.append((counts + SHARE_PRIOR * overall) / (counts.sum(1, keepdims=True) + SHARE_PRIOR))
        groups += ["nationality"] * counts.shape[1]

        columns.append(np.array([[_relative(r["jev"], a) for a in COMPARED] for r in rows]))
        groups += ["scores"] * len(COMPARED)

        columns.append(np.array([[float((r["jev"] or {}).get(k, np.nan)) for k in VIBE] for r in rows]))
        groups += ["vibe"] * len(VIBE)

        columns.append(np.array([[np.nan if r[k] is None else float(r[k]) for k in HOSTING] for r in rows]))
        groups += ["hosting"] * len(HOSTING)

        x = np.column_stack(columns)
        mean, sd = np.nanmean(x, 0), np.nanstd(x, 0)
        z = np.nan_to_num((x - mean) / np.where(sd > 0, sd, 1.0))  # missing values sit at the mean
        self.groups = np.array(groups)
        size = {g: (self.groups == g).sum() for g in GROUP_WEIGHTS}
        z *= np.array([GROUP_WEIGHTS[g] / np.sqrt(size[g]) for g in groups])
        self.unit = z / np.maximum(np.linalg.norm(z, axis=1, keepdims=True), 1e-9)

    def similarity(self, anchors):
        """Cosine of every hostel to the mean of the anchors' vectors (array by self.ids), or None."""
        rows = [self.index[a] for a in anchors if a in self.index]
        if not rows:
            return None
        centre = self.unit[rows].mean(0)
        norm = np.linalg.norm(centre)
        return self.unit @ centre / norm if norm > 0 else None

    def closest(self, anchors, hostel):
        """The anchor most like `hostel`, or None."""
        if hostel not in self.index:
            return None
        v = self.unit[self.index[hostel]]
        found = [a for a in anchors if a in self.index and a != hostel]
        if not found:
            return None
        return max(found, key=lambda a: float(v @ self.unit[self.index[a]]))


def _relative(jev, aspect):
    """Jev's rating for `aspect` minus its overall rating, or NaN when either is missing."""
    jev = jev or {}
    if jev.get(aspect) is None or jev.get("overall") is None:
        return np.nan
    return float(jev[aspect]) - float(jev["overall"])


def _nationalities(row):
    """Guests per NATIONALITIES entry, and the rest."""
    out = np.zeros(len(NATIONALITIES) + 1)
    for code, n in (row["nationalities"] or {}).items():
        code = "UK" if code in UK_NATIONS else code
        out[NATIONALITIES.index(code) if code in NATIONALITIES else -1] += n
    return out


_profiles = cached.Refreshed(lambda: Profiles(db.fetch_all(FEATURES_SQL)), CACHE_SECONDS)


def get():
    """Profiles of every hostel with enough reviews, rebuilt at most hourly."""
    return _profiles.get()
