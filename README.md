# Atropos

**Most hedges miss the days you actually lose.**

Atropos reads what prediction markets expect from the next economic releases (inflation, the
Fed, jobs), works out what each outcome would do to *your* holdings, and prices protection on
every venue it can reach. Then Atty, a little yellow blob, walks you through it one scene at a
time, out loud, and tells you when protection is not worth buying.

## The demo, scene by scene

Open `/atty/` and wake Atty.

1. **Your total.** She sits on it; this week's three reports sit below.
2. **The risk.** A hot inflation print could cost you $461. The number drops on her head.
3. **The trade.** She pushes the ticket in: 839 contracts on Kalshi for $377.55, fair price.
4. **Does it pay when you lose?** On your 13 worst inflation days since 2021 it would have
   paid 6 times, shown over every report day, misses in red.
5. **The fine print.** If the report is never published, this contract still pays (a formula on
   last month's number). It happened in October 2025.
6. **Skip.** The jobs-report protection is overpriced; she kicks it off the stage.
7. **You next to public pensions,** 8. **her record,** 9. **your turn:** your own tickers, or any news.

Next / Back or the arrow keys move between scenes. Drag her, throw her, poke her.
Every number comes from code; Jev checks every line she says against its numbers.

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
  price with the fair value from the odds, and says buy, fair, or skip. It runs every 10 minutes (hourly in the public demo).
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

## Put it online (Fly.io)

`ATROPOS_PUBLIC=1` (set in the Dockerfile) turns on the public demo: sample portfolio only, no
brokerage linking, per-visitor and hourly limits on ticker checks, news and voice, and Atty only
records audio for her own lines. The image never contains `.env`.

```
fly auth login
fly launch --no-deploy --copy-config      # change `app` in fly.toml if the name is taken
grep -E '^(TYPESAFE_API_KEY|ELEVENLABS_API_KEY|ANTHROPIC_API_KEY|SEC_USER_AGENT|ATTY_VOICE_ID)=' .env | fly secrets import
fly deploy
```

Do not give the public demo SnapTrade keys.

## Working on it

- Change the page in `public/atty/index.html`; Atty's lines in `public/atty/beats.js`. After
  changing a line, `node scripts/build-atty.js` re-checks it with Jev and records the voice.
- Keys stay in `.env` (gitignored). Never commit them.
- Every number on screen must come from code or data, never typed in by hand.

## Layout

| Path | What |
|---|---|
| `server.js` | API (`/api/agent`, `/api/events`, `/api/funds`, `/api/thread`, `/api/news`, `/api/voice`, `/api/venues`) and static files |
| `lib/` | odds venues, engine, agent, 13F benchmark, news, Jev, voice |
| `public/atty/` | the Atty page: one scene per line, Atty drawn on a canvas; `beats.js` builds her lines from the numbers |
| `lib/guard.js` | public-demo limits (`ATROPOS_PUBLIC=1`) |
| `Dockerfile`, `fly.toml` | the public demo on Fly.io |
| `public/index.html`, `public/console.html` | the earlier Atropos landing page and console |
| `scripts/` | data builds (13F, odds snapshot, venue survey) and the Jev judgments |
| `data/` | 13F benchmark, venue survey, Jev decisions |

Not investment advice. Brokerage access is read-only; nothing here places a trade.
