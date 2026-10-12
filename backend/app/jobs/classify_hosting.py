"""
Judge what hostels host from their newest reviews with Jev (app/hosting.py), and report the cost.

    python -m app.jobs.classify_hosting --all --missing
    python -m app.jobs.classify_hosting --all --missing --shard 0/4    # one of four parallel runs
    python -m app.jobs.classify_hosting --hostel 7327 60936
"""
import argparse

from app import db
from app.hosting import judge_hostel, save


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--hostel", nargs="+", type=int)
    scope.add_argument("--all", action="store_true")
    parser.add_argument("--missing", action="store_true", help="skip hostels already judged")
    parser.add_argument("--shard", default="0/1", help="i/n: only hostels whose id %% n == i")
    args = parser.parse_args()

    shard, shards = (int(x) for x in args.shard.split("/"))
    where = ["h.id = ANY(%s)"] if args.hostel else ["h.delisted_at IS NULL", "s.review_count > 0"]
    if args.missing:
        where.append("NOT EXISTS (SELECT 1 FROM hostel_hosting x WHERE x.hostel_id = h.id)")
    hostels = [h for h in db.fetch_all(
        f"""SELECT h.id, h.name FROM hostels h JOIN hostel_stats s ON s.hostel_id = h.id
            WHERE {' AND '.join(where)} ORDER BY h.id""",
        (args.hostel,) if args.hostel else (),
    ) if h["id"] % shards == shard]
    print(f"{len(hostels)} hostels to judge")

    for n, h in enumerate(hostels, 1):
        try:
            row = judge_hostel(h["id"])
            if row is None:
                print(f"[{n}/{len(hostels)}] {h['id']} {h['name']}: no review text")
                continue
            save(row)
            print(f"[{n}/{len(hostels)}] {h['id']} {h['name']}: {row['n_reviews']} reviews, meals {row['hosted_meals']}, "
                  f"activities {row['organised_activities']}, breakfast {row['breakfast']}")
        except Exception as e:
            print(f"[{n}/{len(hostels)}] {h['id']} {h['name']}: failed: {e}")


if __name__ == "__main__":
    main()
