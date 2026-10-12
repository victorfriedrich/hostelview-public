"""
Values computed from the database and kept in memory, rebuilt at most every so often.

The first get() builds the value (concurrent callers wait for that one build). After that,
get() always answers at once: a stale value is served while a single background thread
rebuilds it, so no request waits for an hourly reload.
"""
import threading
import time


class Refreshed:
    def __init__(self, build, max_age_seconds=3600):
        self._build = build
        self._max_age = max_age_seconds
        self._value = None
        self._built_at = 0.0
        self._lock = threading.Lock()  # held only for the first build
        self._refreshing = False

    def get(self):
        if self._value is None:
            with self._lock:
                if self._value is None:
                    self._store(self._build())
            return self._value
        if time.monotonic() - self._built_at > self._max_age and not self._refreshing:
            self._refreshing = True
            threading.Thread(target=self._refresh, daemon=True).start()
        return self._value

    def warm(self):
        """Start the first build in the background, so the first request doesn't wait for it."""
        if self._value is None:
            threading.Thread(target=self.get, daemon=True).start()

    def _store(self, value):
        self._value, self._built_at = value, time.monotonic()

    def _refresh(self):
        try:
            self._store(self._build())
        finally:
            self._refreshing = False
