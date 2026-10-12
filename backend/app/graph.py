"""
The hostel graph: hostels are linked when guests rated both 9.4 or higher.

Most guests review only two or three hostels, but together they connect hostels into a
map: a chain's hostels end up close to each other, and so do the party hostels on one
backpacker route, although no single guest stayed at all of them. A link needs at least MIN_SHARED guests, since one guest's pair of stays is an
anecdote. Link weights are divided by the hostels' sizes (cosine: shared / sqrt(a * b)),
so big hostels don't connect to everything.

walk() is a random walk with restart ("personalised PageRank") from one or more hostels:
where a walker ends up most often, following links in proportion to their weight and
jumping back to the start 30% of the time. Nearby hostels, including friends of friends,
score highest. explain() says why a hostel is close: the guests two hostels share, or the
hostel a two-step path runs through.

The graph is held in memory and rebuilt at most hourly in the background, so requests
never wait for it except the very first.
"""
import math
from collections import Counter, defaultdict

import numpy as np

from app import cached, db

RATED_WELL = 94  # score_overall (0-100) at or above which a guest rated a hostel well
MIN_SHARED = 2
RESTART = 0.3
ITERATIONS = 30
REBUILD_SECONDS = 3600

FANS_SQL = """
    SELECT a.reviewer_id, r.hostel_id
    FROM reviews r JOIN review_authors a ON a.review_id = r.id
    WHERE r.score_overall >= %s
"""


class Graph:
    def __init__(self, rows):
        by_guest = defaultdict(set)
        for r in rows:
            by_guest[r["reviewer_id"]].add(r["hostel_id"])
        shared, size = Counter(), Counter()
        for hostels in by_guest.values():
            if len(hostels) < 2:
                continue
            hostels = sorted(hostels)
            size.update(hostels)
            for i, a in enumerate(hostels):
                for b in hostels[i + 1:]:
                    shared[a, b] += 1

        self.shared = {pair: n for pair, n in shared.items() if n >= MIN_SHARED}
        self.ids = sorted({h for pair in self.shared for h in pair})
        self.index = {h: i for i, h in enumerate(self.ids)}
        self.neighbours = defaultdict(dict)
        src, dst, weight = [], [], []
        for (a, b), n in self.shared.items():
            w = n / math.sqrt(size[a] * size[b])
            self.neighbours[a][b] = self.neighbours[b][a] = w
            src += [self.index[a], self.index[b]]
            dst += [self.index[b], self.index[a]]
            weight += [w, w]
        self.src, self.dst = np.array(src, dtype=np.int64), np.array(dst, dtype=np.int64)
        weight = np.array(weight)
        out = np.bincount(self.src, weights=weight, minlength=len(self.ids))
        self.step = weight / out[self.src]  # transition probability along each link

    def walk(self, start):
        """{hostel id: visit probability} of a random walk with restart from `start` (a hostel in the graph)."""
        seed = np.zeros(len(self.ids))
        seed[self.index[start]] = 1.0
        p = seed.copy()
        for _ in range(ITERATIONS):
            p = RESTART * seed + (1 - RESTART) * np.bincount(self.dst, weights=p[self.src] * self.step,
                                                               minlength=len(self.ids))
        return p

    def shared_guests(self, a, b):
        """Guests who rated both hostels 9.4+, if they're linked."""
        return self.shared.get((min(a, b), max(a, b)), 0)

    def explain(self, start, hostel):
        """{"guests": n} for a direct link, else {"via": hostel id} on the strongest two-step path, else {}."""
        n = self.shared_guests(start, hostel)
        if n:
            return {"guests": n}
        mid = self.neighbours.get(start, {})
        best = max(((m, w * self.neighbours[m].get(hostel, 0.0)) for m, w in mid.items()), key=lambda p: p[1], default=None)
        return {"via": best[0]} if best and best[1] > 0 else {}


_graph = cached.Refreshed(lambda: Graph(db.fetch_all(FANS_SQL, (RATED_WELL,))), REBUILD_SECONDS)


def get():
    """The current graph; the first call builds it, later ones trigger an hourly rebuild in the background."""
    return _graph.get()


def warm():
    """Build the graph in the background, so the first request doesn't wait for it."""
    _graph.warm()
