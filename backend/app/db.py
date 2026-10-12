"""
Postgres access: connection pool, schema migrations and the precomputed views.

    python -m app.db migrate    # apply pending migrations (Railway runs this before each deploy)
    python -m app.db refresh    # recompute the materialized views
"""
import argparse
import os
import time
from contextlib import contextmanager

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app import config

MIGRATIONS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations")

# Refreshed in this order: city_stats reads hostel_stats.
DERIVED_VIEWS = ("hostel_stats", "city_stats", "hostel_segments")

_pool = None


def pool():
    global _pool
    if _pool is None:
        if not config.DATABASE_URL:
            raise SystemExit("DATABASE_URL is not set.")
        _pool = ConnectionPool(
            config.DATABASE_URL,
            min_size=1,
            max_size=config.DB_POOL_SIZE,
            kwargs={"row_factory": dict_row},
            open=True,
        )
    return _pool


@contextmanager
def connection():
    """A pooled connection; the transaction commits when the block exits without an error."""
    with pool().connection() as conn:
        yield conn


def fetch_one(sql, params=()):
    with connection() as conn:
        return conn.execute(sql, params).fetchone()


def fetch_all(sql, params=()):
    with connection() as conn:
        return conn.execute(sql, params).fetchall()


def execute(sql, params=()):
    with connection() as conn:
        conn.execute(sql, params)


def execute_many(sql, rows):
    """Run one statement for many parameter rows, pipelined into a single round trip."""
    rows = list(rows)
    if rows:
        with connection() as conn, conn.cursor() as cur:
            cur.executemany(sql, rows)


def upsert_rows(table, rows, key, update=True, batch_size=20_000):
    """
    Bulk insert-or-update of dict rows (all with the same keys): COPY them into a
    temp table, then merge on the `key` columns. With update=False, existing rows
    are left alone. Fast even over a slow link.

    Each batch of `batch_size` rows is its own transaction, so a large load never
    holds a temp copy of the whole table or its write-ahead log at once (the
    production volume is small).
    """
    rows = list({tuple(r[k] for k in key): r for r in rows}.values())  # last row per key wins
    if not rows:
        return 0
    columns = list(rows[0])
    cols = ", ".join(columns)
    updates = update and ", ".join(f"{c} = EXCLUDED.{c}" for c in columns if c not in key)
    conflict = f"DO UPDATE SET {updates}" if updates else "DO NOTHING"
    for start in range(0, len(rows), batch_size):
        with connection() as conn, conn.cursor() as cur:
            cur.execute(f"CREATE TEMP TABLE _load (LIKE {table} INCLUDING DEFAULTS) ON COMMIT DROP")
            with cur.copy(f"COPY _load ({cols}) FROM STDIN") as copy:
                for row in rows[start:start + batch_size]:
                    copy.write_row([row[c] for c in columns])
            cur.execute(
                f"INSERT INTO {table} ({cols}) SELECT {cols} FROM _load "
                f"ON CONFLICT ({', '.join(key)}) {conflict}"
            )
    return len(rows)


# ── Migrations ──────────────────────────────────────────────────────────────

def migrate():
    """Apply every migrations/NNN_*.sql not yet recorded in schema_migrations, in order."""
    with connection() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        applied = {r["name"] for r in conn.execute("SELECT name FROM schema_migrations")}
    for name in sorted(f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql")):
        if name in applied:
            continue
        with open(os.path.join(MIGRATIONS_DIR, name)) as f:
            sql = f.read()
        with connection() as conn:
            conn.execute(sql)
            conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (name,))
        print(f"applied {name}")


def refresh_derived():
    """Recompute the materialized views; readers keep the old rows until each one is done."""
    for view in DERIVED_VIEWS:
        start = time.monotonic()
        with connection() as conn:
            conn.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {view}")
        print(f"refreshed {view} in {time.monotonic() - start:.1f}s")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["migrate", "refresh"])
    args = parser.parse_args()
    if args.command == "migrate":
        migrate()
    else:
        refresh_derived()


if __name__ == "__main__":
    main()
