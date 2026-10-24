"""Command line for the evidence layer and the trade queue.

    python -m intel run                          one cycle: discover, read, corroborate, propose (prints the report)
    python -m intel serve --port 8002 --every 60 the HTTP API atropos proxies, with a cycle every 60 minutes
    python -m intel stories [--status open]      stories and why each did or didn't become a trade
    python -m intel proposals [--status proposed] trades waiting for you
    python -m intel approve ID | reject ID       send one through the guard to the broker, or drop it
    python -m intel orders                       what was sent (or is waiting for you to place at Fidelity)
    python -m intel filled ID | canceled ID      record what happened to an order you placed by hand
    python -m intel kill [--off]                 stop all trading (or resume); evidence keeps being collected
    python -m intel ingest URL [URL ...]         fetch, extract and file pages; one JSON line per URL
    python -m intel corroborate URL [URL ...]    the same, then how many independent owners back them
    python -m intel asof 2026-10-20T00:00:00Z    what we held at that moment (add --since to bound it)

Every command takes --db (default services/intel/data/evidence.db) and --sources (default services/intel/sources.toml).
"""
import argparse
import json
import logging

from intel import broker as broker_mod
from intel import decide, pipeline, stories
from intel import policy as policy_mod
from intel.dedup import corroborate
from intel.ingest import fetch
from intel.sources import DEFAULT_PATH, Registry
from intel.store import DEFAULT_DB, Store, to_article


def _print(rows):
    for r in rows if isinstance(rows, list) else [rows]:
        print(json.dumps(r, default=str))


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
    sub.add_parser("run")
    serve = sub.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8002)
    serve.add_argument("--every", type=float, default=0, help="minutes between cycles; 0 runs none on its own")
    for name in ("stories", "proposals", "orders"):
        sub.add_parser(name).add_argument("--status")
    for name in ("approve", "reject", "filled", "canceled"):
        sub.add_parser(name).add_argument("id", type=int)
    sub.add_parser("kill").add_argument("--off", action="store_true")
    args = ap.parse_args(argv)
    policy_mod.load_env()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    if args.cmd == "serve":
        import uvicorn
        from intel import api
        if args.every:
            api.schedule(args.every)
        uvicorn.run(api.app, host=args.host, port=args.port)
        return
    if args.cmd == "kill":
        policy_mod.set_killed(not args.off)
        print("trading stopped" if policy_mod.killed() else "trading resumed")
        return

    store, registry = Store(args.db), Registry(args.sources)
    try:
        if args.cmd == "asof":
            for row in store.as_of(args.when, since=args.since):
                _print({k: row[k] for k in ("id", "first_seen", "published", "origin", "tier", "title", "url")})
        elif args.cmd in ("ingest", "corroborate"):
            results = fetch(args.urls, store, registry)
            _print(results)
            if args.cmd == "corroborate":
                docs = [store.get(r["id"]) for r in results if r.get("id")]
                print(json.dumps(corroborate([to_article(d) for d in docs], registry).to_dict(), indent=2))
        elif args.cmd == "run":
            print(json.dumps(pipeline.cycle(store, registry, policy_mod.load()), indent=2, default=str))
        elif args.cmd == "stories":
            _print([{k: s[k] for k in ("id", "ticker", "event_type", "status", "title", "first_seen")}
                    | {"why": (s["gate"] or {}).get("reason")} for s in stories.listing(store, status=args.status)])
        elif args.cmd == "proposals":
            _print([{k: p[k] for k in ("id", "status", "ticker", "side", "notional", "conviction", "horizon_months", "thesis")}
                    for p in decide.proposals(store, status=args.status)])
        elif args.cmd == "approve":
            _print(pipeline.approve(store, policy_mod.load(), args.id))
        elif args.cmd == "reject":
            _print(pipeline.reject(store, args.id))
        elif args.cmd == "orders":
            broker_mod.init(store)
            _print(broker_mod.orders(store, status=args.status))
        elif args.cmd in ("filled", "canceled"):
            broker_mod.init(store)
            _print(broker_mod.ManualBroker(store).mark(args.id, args.cmd))
    finally:
        store.close()


if __name__ == "__main__":
    main()
