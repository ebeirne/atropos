# Atropos

**Atty looks after the thread of what you own.**

Atropos reads what prediction markets expect from the next economic releases (inflation, the
Fed, jobs), works out what each outcome would do to *your* holdings, and prices protection on
every venue it can reach. Then Atty, a pair of scissors drawn in one line, walks you through it
one sentence at a time, out loud if you like, and snips the thread when protection is not worth
buying. Most weeks the answer is to buy nothing.

Built for a hackathon track on prediction markets as economic signals.

## What it does

- **Odds from many venues.** Kalshi (directly, and through Interactive Brokers ForecastTrader),
  ForecastEx, CME event contracts, Limitless and Futuur, read into one probability ladder per
  release (`lib/markets.js`, `lib/forecastex.js`, `lib/futuur.js`). `scripts/survey_venues.py`
  surveys 16 venues with Scrapling.
- **Your exposure, in dollars.** Each holding is sorted into a bucket and moved by the release's
  tails with the same model (`lib/engine.js`). Holdings come read-only from SnapTrade
  (Robinhood, Fidelity), or a sample portfolio.
- **The cheapest credible protection, or none.** For each tail, Atty's agent (`lib/agent.js`)
  finds the cheapest contract with enough open interest, sizes it to the dollar loss, compares the
  price with the fair value from the odds, and says buy, fair, or skip. It runs every 10 minutes.
- **Does it pay when you lose?** A contract pays on the printed number; you lose on how markets
  react, and the two can split. For every CPI and jobs release since 2021, `lib/history.js` checks
  how your current holdings moved and which way the number came in (first prints from BLS and
  ALFRED, prices from Yahoo). For the sample portfolio, hot-inflation protection lined up with only
  6 of the 13 inflation days it fell 0.5% or more.
- **The fine print.** `scripts/fetch_rules.py` reads Kalshi's published contract terms;
  `lib/rules.js` works out what each quoted contract would settle on if the government never
  publishes the number (a formula from the last CPI; last month's payrolls), using today's data.
  BLS skipped the October 2025 CPI and jobs reports during the shutdown, so this is not hypothetical.
- **Atty keeps score.** Every round records her calls (protect, your call, skip) in a ledger;
  `lib/ledger.js` settles each one against the first print after the release.
- **You next to public money.** The same model runs on the latest SEC 13F filings of state and
  city pensions and public university funds (`lib/thirteenf.js`, `lib/funds.js`), and shows who
  else holds what you hold and what they bought or sold last quarter.
- **Every sentence is checked.** Numbers only come from code. Jev (TypeSafe) reads each line Atty
  says against its numbers before you see it, and judged the name, the character and the voice
  (`scripts/jev-*.js`, `data/*-jev.json`).
- **News on anything.** Google News, Bing News, GDELT and Hacker News, ranked by Jev for what
  bears on the releases (`lib/news.js`).

## Run it

```
npm install
cp .env.example .env        # every key is optional
node server.js              # http://127.0.0.1:4411/atty/
```

Without keys it runs on a sample portfolio and saved odds. See `.env.example` for what each key
turns on.

Build the static version (saved data and pre-recorded voice, no server needed):

```
node scripts/snapshot-tape.js
node scripts/build-atty.js  # dist/atty/
```

## Layout

| Path | What |
|---|---|
| `server.js` | API (`/api/agent`, `/api/events`, `/api/funds`, `/api/thread`, `/api/news`, `/api/voice`, `/api/venues`) and static files |
| `lib/` | odds venues, engine, agent, 13F benchmark, news, Jev, voice |
| `public/atty/` | the Atty page: the thread is the interface (past report days as beads, Atty at today, the reports ahead as knots she tied or cut); `beats.js` builds her walkthrough lines from the numbers |
| `public/index.html`, `public/console.html` | the earlier Atropos landing page and console |
| `scripts/` | data builds (13F, odds snapshot, venue survey) and the Jev judgments |
| `data/` | 13F benchmark, venue survey, Jev decisions |

Not investment advice. Brokerage access is read-only; nothing here places a trade.
