# Atropos

**Read the odds. Then your book.**

**Live site: [ebeirne.github.io/atropos](https://ebeirne.github.io/atropos/)** ·
[One-scroll page](https://ebeirne.github.io/atropos/topo/) ·
[Trust table](https://ebeirne.github.io/atropos/basis/) ·
[Pair screener](https://ebeirne.github.io/atropos/leaf/#/screener) ·
[Atty's walkthrough](https://ebeirne.github.io/atropos/atty/) ·
[Console](https://ebeirne.github.io/atropos/console.html)

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

The engines' own pages are built into `public/basis/` and `public/leaf/`:

```
node scripts/build-tools.js
```

They work with no backend (Basis reads the committed snapshot through `/api/basis/*`; Leaf runs
on its built-in sample). To run them live, start their backends and the server proxies to them:

```
cd services/basis && make setup && make demo          # Basis on :8000 (DEMO_MODE serves its snapshot)
cd services/leaf/Backend && uv venv && uv pip install -r requirements.txt && .venv/bin/python -m uvicorn app.main:app --port 8001
```

`BASIS_URL` and `LEAF_URL` in `.env` change the targets. `/api/basis/*` and `/api/leaf/*` fall
back to `public/data/` when a backend is not running. `public/data/leaf/scan.json` is a real
Yahoo scan of Leaf's default universe (29 tickers, 252 days); refresh it by running Leaf's
engine and saving the result there.

Build the static version of Atty's page (saved data and pre-recorded voice):

```
node scripts/snapshot-tape.js
node scripts/build-atty.js  # dist/atty/
```

## The GitHub Pages site

Every push to `main` builds the engines' pages, then publishes `public/` to
[ebeirne.github.io/atropos](https://ebeirne.github.io/atropos/) (`.github/workflows/pages.yml`,
`scripts/build-tools.js`, `scripts/build-pages.js`). With no server behind it, the pages read the
committed snapshots: `public/tape.json`, `public/demo.json`, `public/data/{basis,leaf}/`,
`public/atty/*.json` and Atty's recorded lines in `public/atty/voice/`. Refresh them by running
the server, then `node scripts/build-atty.js`, and push.

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
| `lib/` | odds venues, engine, agent, 13F benchmark, news, Jev, voice, public-demo guards |
| `public/index.html`, `public/console.html` | the landing page and the console |
| `public/topo/` | the one-scroll page that joins the three engines, and its surface |
| `public/atty/` | Atty's walkthrough; `beats.js` builds her lines from the numbers |
| `public/console.html` | the console |
| `public/data/` | the engines' snapshots |
| `services/basis`, `services/leaf` | the two engines (FastAPI + React), vendored |
| `scripts/` | data builds, the Jev judgments, the site builds |
| `data/` | 13F benchmark, venue survey, Jev decisions |

Not investment advice. Brokerage access is read-only; nothing here places a trade.
