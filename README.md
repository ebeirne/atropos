# Atropos

**Read the odds. Then your book.**

**Live site: [ebeirne.github.io/atropos](https://ebeirne.github.io/atropos/)** ·
[One-scroll page](https://ebeirne.github.io/atropos/topo/) ·
[Trust table](https://ebeirne.github.io/atropos/basis/) ·
[Pair screener](https://ebeirne.github.io/atropos/leaf/#/screener) ·
[Atty's walkthrough](https://ebeirne.github.io/atropos/atty/) ·
[Desk](https://ebeirne.github.io/atropos/desk.html) ·
[Demo](https://ebeirne.github.io/atropos/demo.html)

Atropos joins three engines built for a hackathon track on prediction markets as economic
signals:

| Engine | What it answers | Origin |
|---|---|---|
| **Basis** | Is this prediction-market price a real signal? A calibrated probability (isotonic fit on 628 settled Kalshi markets), the *basis* against what fed-funds futures or Bitcoin options already imply, a 0–100 trust score, event betas. | [Arman-Chaudhury/basis](https://github.com/Arman-Chaudhury/basis), vendored at `services/basis` with its history |
| **Atropos** | What do the odds on the next inflation, Fed and jobs reports do to *your* holdings, what does protection cost, and would it have paid on the days you actually lost? | this repo: `server.js`, `lib/`, `public/` |
| **Leaf** | Which stock pairs move together or against each other: mean reversion, statistical arbitrage, hedging (correlation, Engle–Granger cointegration, half-life). | [juvowen/Leaf](https://github.com/juvowen/Leaf), vendored at `services/leaf` with its history |

Read the price → price the hedge → pair the hedge.

## The site

- **`/`** the landing page: what traders expect this week (live odds with the move since the
  last check), how it works, and the research behind it.
- **`/console.html`** the console: your portfolio (or the sample), what each report would do
  to it, and this week's trade, or none.
- **`/desk.html`** the desk: every Basis event with its calibrated probability, basis and
  trust, biggest trusted edge first; pick one and Atropos shows the trade and how much to put
  on it (half Kelly, capped at 10% of capital); save the trade and it is marked to the current
  price under Positions. Layout chosen with Jev as a second opinion (`data/console-jev.json`).
- **`/atty/`** Atty's nine-scene walkthrough with her recorded voice.
- **`/basis/`** and **`/leaf/`** the engines' own pages.
- **`/topo/`** a second landing page that joins all three engines in one scroll (kept for
  another project): a hero over a surface of contour rings, two titles as the camera dives
  into the rings, a dark reveal, then the content, and the grey rings back behind the footer.

The `/topo/` page, section by section:

- **Hero.** The rings are twenty stacked planes cut by one noise height field at twenty
  thresholds, so only each terrace's rim shows (`public/topo/surface.js`). The cursor stirs a
  small fluid field that ripples them. A directional blur, exposure, chromatic aberration and
  grain finish the frame. One timeline (`public/topo/timeline.js`) drives the camera, the field
  and the passes; the first two units play on load, the rest is tied to the scroll.
- **Where the name comes from.** The thesis, with Basis's calibration fact filled in from data.
- **01 What it does / 02 How the numbers are made.**
- **Three engines.** Basis, Atropos, Leaf, each with one real number as its quote.
- **Next prints.** The three reports coming up, with the likely outcome from the odds.
- **Select signals.** Eight Basis events: calibrated probability large, raw, basis and trust
  small; an asterisk where one trade dominates the tape (Basis's leakage flag).
- **Tools.** The Basis trust table and calibration curve, the Leaf screener, Atty's
  walkthrough, the console.

Every line on the page was picked by Jev from short candidates (`scripts/jev-landing.js`,
`data/landing-copy.json`). Every number comes from code or data, never typed in.

## Run it

```
npm install
cp .env.example .env        # every key is optional
node server.js              # http://127.0.0.1:4411
```

Without keys it runs on a sample portfolio and saved odds. See `.env.example` for what each key
turns on.

The engines' own pages are built into `public/basis/` and `public/leaf/`. By default, Leaf uses
its built-in sample so the static GitHub Pages site works without a backend. For live Yahoo Finance
prices in the local Leaf screener, build it with the API enabled:

```
node scripts/build-tools.js --live-leaf
```

Then run these in separate terminals.

```
npm start
/service/Leaf/Backend/sh run.sh --port 8001
```

```sh
cd services/leaf/Backend
uv venv
uv pip install -r requirements.txt
sh run.sh --port 8001
```

The Screener sends scans to Leaf through Atropos at `/api/leaf/*`; the backend fetches Yahoo prices.
`LEAF_URL` in `.env` changes the backend target. When Leaf's backend is stopped, the proxy falls
back to the committed `public/data/leaf/scan.json` snapshot (a real Yahoo scan, not a live refresh).
The default build without `--live-leaf` keeps Leaf's built-in sample for static hosting.

Basis can also run live separately on `:8000` with `cd services/basis && make setup && make demo`;
otherwise its API reads the committed snapshot.

Build the static version of Atty's page (saved data and pre-recorded voice):

```
node scripts/snapshot-tape.js
node scripts/build-atty.js  # dist/atty/
```

## Saving trades: Tiger Data / TimescaleDB

Trades and odds marks are stored in TimescaleDB when `DATABASE_URL` is set (a Tiger Cloud
connection string works as is); without it they go to `data/trades.json` so the demo still
runs. `lib/trades.js` creates two hypertables on first use: `trades` (one row per saved trade:
user, event, side, venue, price, contracts, dollars, and the calibrated probability, basis,
trust and Kelly share at the time) and `marks` (every event's price and calibrated probability
each time the desk loads, so `/api/marks?event=` can chart them with `time_bucket`).

```
# Tiger Cloud: paste the service's connection string
DATABASE_URL=postgres://tsdbadmin:...@....tsdb.cloud.timescale.com:3xxxx/tsdb?sslmode=require

# or a local TimescaleDB for development
docker run -d --name tsdb -p 5433:5432 -e POSTGRES_PASSWORD=atropos timescale/timescaledb:latest-pg16
DATABASE_URL=postgres://postgres:atropos@127.0.0.1:5433/postgres
```

Routes: `GET /api/desk/events?capital=` (events with price, edge and Kelly), `POST /api/trades`
`{event_id, side, contracts, capital}`, `GET /api/trades`, `GET /api/positions` (open trades
marked to the current price), `GET /api/marks?event=&days=`. There is no sign-in: the desk
page keeps an id per browser and sends it as `x-atropos-user`. On the static site the desk
does the same sums in the browser and keeps trades in the browser.

## The GitHub Pages site

Every push to `main` builds the engines' pages, then publishes `public/` to
[ebeirne.github.io/atropos](https://ebeirne.github.io/atropos/) (`.github/workflows/pages.yml`,
`scripts/build-tools.js`, `scripts/build-pages.js`). With no server behind it, the pages read the
committed snapshots: `public/tape.json`, `public/demo.json`, `public/data/{basis,leaf}/`,
`public/atty/*.json` and Atty's recorded lines in `public/atty/voice/`. Refresh them by running
the server, then `node scripts/build-atty.js`, and push.

## Live with the backend: Vercel

The GitHub repo is connected to a Vercel project (`atropos`); every push to `main` deploys.
`api/index.js` runs the same server handler as one function behind `/api/*` (`vercel.json`),
Vercel serves `public/` itself, and the build runs `scripts/build-tools.js`. Differences from
a long-running server: nothing runs between requests, so the agent does one quick round on the
first `/api/agent` call; writes under `data/` go to `/tmp` (`lib/tmpfs.js`) and do not last, so
saved trades need `DATABASE_URL`; the Python engines are not started, so `/api/basis/*` and
`/api/leaf/*` answer from the snapshots. Production env: `ATROPOS_PUBLIC=1`, `AGENT_EVERY_MIN`,
`TYPESAFE_API_KEY`, `ELEVENLABS_API_KEY`, `SEC_USER_AGENT`, and `DATABASE_URL` when you have it
(`vercel env add DATABASE_URL production`). Never SnapTrade keys.

## Put it online with a server (Fly.io)

`ATROPOS_PUBLIC=1` (set in the Dockerfile) turns on the public demo: sample portfolio only, no
brokerage linking, per-visitor and hourly limits on portfolio checks, news and voice, and Atty
only records audio for her own lines. The image never contains `.env`.

```
fly auth login
fly launch --no-deploy --copy-config      # change `app` in fly.toml if the name is taken
grep -E '^(TYPESAFE_API_KEY|ELEVENLABS_API_KEY|ANTHROPIC_API_KEY|SEC_USER_AGENT|ATTY_VOICE_ID)=' .env | fly secrets import
fly deploy
```

Do not give the public demo SnapTrade keys.

## What Atropos itself does

- **Odds from many venues.** Kalshi (directly, and through Interactive Brokers ForecastTrader),
  ForecastEx, CME event contracts, Limitless and Futuur, read into one probability ladder per
  release (`lib/markets.js`, `lib/forecastex.js`, `lib/futuur.js`).
- **Your exposure, in dollars.** Each holding is sorted into a bucket and moved by the release's
  tails with the same model (`lib/engine.js`). Holdings come read-only from SnapTrade
  (Robinhood, Fidelity), or a sample portfolio.
- **The cheapest credible protection, or none.** Atty's agent (`lib/agent.js`) finds the
  cheapest contract with enough open interest, sizes it to the dollar loss, compares the price
  with the fair value from the odds, and says buy, fair, or skip.
- **Does it pay when you lose?** For every CPI and jobs release since 2021, `lib/history.js`
  checks how your holdings moved and which way the number came in. For the sample portfolio,
  hot-inflation protection lined up with only 6 of the 13 inflation days it fell 0.5% or more.
- **The fine print.** `lib/rules.js` works out what each quoted contract would settle on if the
  government never publishes the number.
- **Atty keeps score.** Every round records her calls in a ledger; `lib/ledger.js` settles each
  one against the first print after the release.
- **You next to public money.** The same model runs on the latest SEC 13F filings of state and
  city pensions and public university funds (`lib/thirteenf.js`, `lib/funds.js`).
- **Every sentence is checked.** Jev (TypeSafe) reads each line against its numbers before you
  see it, and judged the name, the character, the voice and the page copy.

## The trading agent (your own machine only)

`services/intel` is a long-term investing agent. It follows the companies you hold and the ones on your
watchlist. It reads their news with Scrapling and works out which outlets are independent of each other
(twelve sites running one Reuters story count once). It checks each story against SEC filings and
prediction markets, then proposes a trade only when the evidence clears every check. Every proposal waits
on `agent.html` for you to approve it.

Fidelity has no trading API, so an approved trade becomes a checklist item you place there yourself.
Alpaca is the option for hands-off trading, on paper money by default. A guard in code enforces the limits
in `services/intel/policy.toml`, including a kill switch. The public demo never exposes any of this.

On Windows, one line in PowerShell sets it all up (tools, code, keys, start at login) and opens the agent page,
where you link Fidelity:

```powershell
irm https://raw.githubusercontent.com/ebeirne/atropos/main/scripts/setup-agent.ps1 | iex
```

The step-by-step guide, for whoever will use it, is [SETUP-AGENT.md](SETUP-AGENT.md). How it works, the gate, and
every setting are in [services/intel/README.md](services/intel/README.md).

## Working on it

- The landing page is `public/index.html` + `public/topo/`; Atty's page is `public/atty/`.
- Basis and Leaf live in `services/` as git subtrees. Pull their upstream changes with
  `git subtree pull --prefix services/basis https://github.com/Arman-Chaudhury/basis main` (same
  for Leaf). The only local change in either is Basis's router (hash routes, so it can be served
  from a sub-folder).
- Keys stay in `.env` (gitignored). Never commit them.
- Every number on screen must come from code or data, never typed in by hand.

## Layout

| Path | What |
|---|---|
| `server.js` | API (`/api/agent`, `/api/events`, `/api/funds`, `/api/thread`, `/api/news`, `/api/voice`, `/api/venues`, `/api/try`), the proxies `/api/basis/*` and `/api/leaf/*`, and static files |
| `lib/` | odds venues, engine, agent, 13F benchmark, news, Jev, voice, public-demo guards, trades (TimescaleDB or file) |
| `public/index.html`, `public/console.html` | the landing page and the console |
| `public/topo/` | the one-scroll page that joins the three engines, and its surface |
| `public/atty/` | Atty's walkthrough; `beats.js` builds her lines from the numbers |
| `public/console.html`, `public/desk.html`, `public/desk/kelly.js` | the console, the desk, and the Kelly sizing shared by server and page |
| `public/data/` | the engines' snapshots |
| `services/basis`, `services/leaf` | the two engines (FastAPI + React), vendored |
| `scripts/` | data builds, the Jev judgments, the site builds |
| `data/` | 13F benchmark, venue survey, Jev decisions |

Not investment advice. Brokerage access is read-only; nothing here places a trade.
