# intel: the long-term trading agent

It follows the companies you hold and the ones you're watching. It reads the news about them and works out
which outlets are independent of each other. It checks each story against SEC filings and prediction
markets, then proposes a trade only when the evidence clears every check. Then the trade waits for you.

Your account is at Fidelity, which has no trading API. SnapTrade reads it, but only read-only. So by
default an approved trade becomes a checklist item you place in Fidelity yourself. Alpaca is the
alternative for hands-off trading, on paper (simulated) money unless you switch live trading on in two
places.

## How a trade happens

One cycle runs `intel/pipeline.py`:

| step | module | what it does |
|---|---|---|
| portfolio | `portfolio.py` | your holdings: Fidelity through atropos (`/api/portfolio`), or Alpaca, or `data/portfolio.json` |
| universe | `discover.py`, `watchlist.toml` | the watchlist plus everything you hold |
| discover | `discover.py`, `feeds.toml` | new article URLs from RSS feeds, per-ticker feeds and GDELT (many outlets, real URLs) |
| ingest | `ingest.py`, `extract.py` | Scrapling fetches each page; JSON-LD / OpenGraph metadata, trafilatura body text, hidden text stripped |
| claims | `claims.py` | Claude lists each article's claims, each tied to a verbatim quote; claims whose quote isn't on the page are dropped |
| stories | `stories.py` | claims grouped by ticker + event type + a 5-day window |
| primary | `edgar.py` | the company's recent SEC filings (8-K, 425, 10-Q …) filed as primary evidence |
| decide | `decide.py`, `dedup.py`, `markets.py` | the gate, prediction markets, Claude's thesis, sizing in code |
| execute | `guard.py`, `broker.py` | every order through the guard; then the Fidelity checklist, or Alpaca |

**The gate.** A story becomes a proposal only if it passes every check below, in order. The reason for each
pass or fail is saved on the story.

1. **Fresh:** first seen within `max_story_age_days`.
2. **Primary:** an SEC filing, an official release, or the company's own press release naming its ticker
   ("(NASDAQ: NWRB)").
3. **Independent:** at least 2 independent owners at wire or major-outlet tier, besides the primary source.
   Twelve sites running one Reuters story count as one. WSJ, MarketWatch and Barron's are all Dow Jones.
   Paywall teasers don't count.
4. **Direction:** the claims agree the news is positive or negative for the stock.
5. **Markets:** no credible prediction market (enough volume, tight spread) contradicts it.

Then Claude gives buy / sell / hold, a conviction, a horizon, the risks, and what would prove it wrong. It
never sees or sets a dollar amount. A buy is sized as 3% of equity × conviction; a sell as the held value ×
conviction.

**The guard** (`guard.py`) runs in code, and nothing the model writes can loosen it. It enforces:

- the kill switch;
- no trading on sample or missing holdings;
- no shorting;
- a 5% position cap;
- a 10% cash floor;
- a $2,500 per-order cap;
- 3 trades a day;
- 15% weekly turnover;
- a 25-position cap;
- a blocked-ticker list.

Every limit is in `policy.toml`.

## Setup

Python 3.11+. On Windows with long paths disabled, keep the checkout (or at least the venv) at a short path,
because pip and SQLite fail past 260 characters.

```bash
uv venv .venv && uv pip install -p .venv -r requirements-dev.txt
.venv/Scripts/python -m pytest          # .venv/bin/python on macOS / Linux
```

Environment (put these in atropos's `.env` or your shell):

| variable | for |
|---|---|
| `ANTHROPIC_API_KEY` | Claude reading articles and writing theses. Without it, evidence is still collected, but nothing is proposed. |
| `SEC_USER_AGENT` | SEC filings; SEC wants a contact: `"Your Name you@example.com"` |
| `ATROPOS_URL` | where atropos runs (default `http://127.0.0.1:4411`), for your Fidelity holdings |
| `INTEL_MODEL` | override the model (default `claude-opus-5-5`, with server-side refusal fallback) |
| `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY` | Alpaca, only if `broker = "alpaca"` in policy.toml |
| `ALPACA_LIVE=1` | real money on Alpaca; also needs `allow_live = true` in policy.toml |
| `INTEL_KILL=1` | the kill switch, from the environment |

## Run

```bash
.venv/Scripts/python -m intel serve --every 60   # the API on :8002, a cycle every hour
```

On Windows, `scripts\start-agent.cmd` starts both Atropos and the agent in minimized windows and opens the
agent page (`--quiet` skips the page). The logs go to `datatropos.log` and `services\intel\datagent.log`;
close the two windows to stop. To start it at login, put a shortcut to `cmd.exe /c "<repo>\scripts\start-agent.cmd" --quiet`
in your Startup folder (`shell:startup`).

Then open atropos's `agent.html` (`npm start`, then <http://127.0.0.1:4411/agent.html>). It shows:

- **Waiting for you:** each proposal with its thesis, sources and markets, plus Approve / Reject buttons.
- **Orders:** the Fidelity checklist. Mark each one once you've placed it.
- **Stories:** every story it's following, with why each did or didn't become a trade.
- **Stop all trading:** the kill switch.

The same from the command line:

```bash
python -m intel run                  # one cycle now
python -m intel proposals            # what's waiting
python -m intel approve 3            # through the guard to the checklist (or Alpaca)
python -m intel orders               # the checklist
python -m intel filled 7             # you placed order 7 at Fidelity
python -m intel kill                 # stop everything; `kill --off` resumes
python -m intel stories              # every story and why
python -m intel asof 2026-10-22T15:00:00Z   # exactly what it knew at that moment
```

## Safety, plainly

- **You approve every trade.** `mode = "approve"` is the default, and with Fidelity you place each order
  yourself anyway. `mode = "auto"` is for Alpaca, and paper trading first.
- **Scraped text is untrusted.** Hidden text is stripped before Claude sees a page, and the prompts tell it
  to treat articles as data. A claim must quote the page. The guard can't be argued with.
- **Only your own browser can reach the API.** The API and atropos's proxy refuse non-local Host headers
  (DNS rebinding), and every write needs an `x-intel-client` header, so another website can't approve a
  trade from your browser.
- **The evidence store is point-in-time.** Every page is kept with the moment we first held it. You can
  check later exactly what a trade was based on, and backtest without hindsight.

## Known gaps

- **Kalshi:** Kalshi has no text search. Its open-events listing is capped at 10 pages, which misses some
  markets. Polymarket's search covers company names properly.
- **Fidelity:** it can't be traded automatically. If you want hands-off trading, use a separate Alpaca
  account for the automated part.
- **Re-reading old articles:** an article that mentioned no followed company is never re-read, even if you
  later add that company to the watchlist.
- **Small holdings:** a holding worth under `min_order_usd` ($50) can't be sold through the guard.
