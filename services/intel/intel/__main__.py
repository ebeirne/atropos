"""Command line for the evidence layer.

    python -m intel ingest URL [URL ...]          fetch, extract and file each page; prints one JSON line per URL
    python -m intel corroborate URL [URL ...]     the same, then how many independent owners back the story
    python -m intel asof 2026-10-20T00:00:00Z     what we held at that moment (add --since to bound it)

Every command takes --db (default services/intel/data/evidence.db) and --sources (default services/intel/sources.toml).
"""
import argparse
import json

from intel.dedup import corroborate
from intel.ingest import fetch
from intel.sources import DEFAULT_PATH, Registry
from intel.store import DEFAULT_DB, Store, to_article


def main(argv=None):
    ap = argparse.ArgumentParser(prog="intel")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--sources", default=str(DEFAULT_PATH))
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("ingest", "corroborate"):
        sub.add_parser(name).add_argument("urls", nargs="+")
    asof = sub.add_parser("asof")
    asof.add_argument("when")
    asof.add_argument("--since")
    args = ap.parse_args(argv)

    store, registry = Store(args.db), Registry(args.sources)
    try:
        if args.cmd == "asof":
            for row in store.as_of(args.when, since=args.since):
                print(json.dumps({k: row[k] for k in ("id", "first_seen", "published", "origin", "tier", "title", "url")}))
            return
        results = fetch(args.urls, store, registry)
        for r in results:
            print(json.dumps(r))
        if args.cmd == "corroborate":
            docs = [store.get(r["id"]) for r in results if r.get("id")]
            print(json.dumps(corroborate([to_article(d) for d in docs], registry).to_dict(), indent=2))
    finally:
        store.close()


if __name__ == "__main__":
    main()
