"""
Hostel name search for the For you tab's "hostels you liked".

Matching ignores case, accents and punctuation, so "angels hostel" finds "Angels’ Hostel"
and "bigua" finds "64Bigüa". Every word of the query must appear in the hostel's name or
city. Exact names come first, then names starting with the query, then names containing
every word, each by Hostelworld review count. With `names_only` (the city search box, where
hostels should only surface on a clear hit), every query word must instead start a word of
the hostel's name, so "ome" doesn't find "Home Hostel" and a city name alone finds nothing.
Names are held in memory (a few MB) and reloaded at most hourly.
"""
import re
import unicodedata

from app import cached, db

CACHE_SECONDS = 3600


def normalize(text):
    """Lowercase ASCII words: accents folded, apostrophes dropped, other punctuation a space."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = re.sub(r"['’`´]", "", text)
    return " ".join(re.sub(r"[^0-9a-zß]+", " ", text).split())


def _load():
    rows = db.fetch_all(
        """
        SELECT h.id, h.name, c.slug, c.name AS city_name, c.country,
               coalesce(s.review_count, 0) AS review_count, coalesce(h.hw_review_count, 0) AS hw_review_count
        FROM hostels h
        JOIN cities c ON c.id = h.city_id
        LEFT JOIN hostel_stats s ON s.hostel_id = h.id
        """
    )
    return [(normalize(r["name"]), normalize(r["city_name"]), r) for r in rows]


_names = cached.Refreshed(_load, CACHE_SECONDS)


def search(query, limit, names_only=False):
    q = normalize(query)
    words = q.split()
    if not words:
        return []
    hits = []
    for name, city, row in _names.get():
        if names_only:
            name_words = name.split()
            if not all(any(nw.startswith(w) for nw in name_words) for w in words):
                continue
        elif not all(w in f"{name} {city}" for w in words):
            continue
        if name == q:
            rank = 0
        elif name.startswith(q):
            rank = 1
        elif all(w in name for w in words):
            rank = 2
        else:
            rank = 3  # some words only matched the city
        hits.append((rank, -row["hw_review_count"], row["id"], row))
    hits.sort(key=lambda h: h[:3])
    return [h[3] for h in hits[:limit]]
