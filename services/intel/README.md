# intel: the evidence layer

Before the agent acts on a story, it needs to know three things: what the page actually says, who
originally wrote it, and how many independent owners stand behind it. This service answers those on top of
[Scrapling](https://github.com/D4Vinci/Scrapling) and keeps every page it reads in a point-in-time store, so a
trade can be audited (and a backtest run) against exactly what we knew at the time.

| module | does |
|---|---|
| `intel/sources.py` + `sources.toml` | domain → name, tier (primary, wire, major, trade, press_release, secondary, community, aggregator), owner group, wire-credit patterns |
| `intel/extract.py` | page → `Article`: JSON-LD / OpenGraph metadata, trafilatura body text after Scrapling's hidden-text sanitizer, paywall flag |
| `intel/dedup.py` | canonical URLs, copy clusters (canonical, headline + day, 5-gram containment), wire-credit detection, `corroborate()` |
| `intel/store.py` | SQLite: one row per distinct text per URL with its `first_seen` knowledge time, every fetch with ETag / Last-Modified, gzipped raw HTML |
| `intel/ingest.py` | Scrapling `Fetcher` (plain HTTP, named User-Agent, no stealth), conditional GETs, blocks logged not retried around |

## Counting sources

Twelve sites running one Reuters story are one source. `corroborate(articles, registry)` groups copies,
gives each group the origin it credits (a `(Reuters) -` dateline, a `--(BUSINESS WIRE)--` release, an AP
byline, a canonical link to another site), and counts owners once (WSJ + MarketWatch + Barron's = Dow Jones).
Paywall teasers are excluded. It returns the independent origins with their tier weights, a score, and
whether a primary source is among them. Picking which articles bear on one claim is the caller's job (next
step: claim extraction).

## Run

Python 3.11+. Windows paths over 260 characters break pip and SQLite unless long paths are enabled, so keep
the checkout (or at least the venv) somewhere short.

```bash
uv venv .venv && uv pip install -p .venv -r requirements-dev.txt
.venv/Scripts/python -m pytest          # .venv/bin/python on macOS / Linux
.venv/Scripts/python -m intel corroborate https://apnews.com/article/... https://www.reuters.com/...
.venv/Scripts/python -m intel asof 2026-10-22T15:00:00Z
```

The store defaults to `services/intel/data/evidence.db` (git-ignored); pass `--db` to put it elsewhere.

## Adding sources

Add a `[[source]]` block to `sources.toml`. Give outlets with a common owner the same `group`. Only wires and
release services need `credits`. Those are regexes searched in the first and last 600 characters of other
outlets' text and in the byline, so keep them specific: `\(AP\)\s*[-–—]`, not `Associated Press`.
