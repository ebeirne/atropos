# PLAN — Basis

Goal: working demo in ~24h. Three money charts: calibration curve, PM vs fed-funds-implied P, belief search → trust.

## Order
1. Scaffold repo, smoke-test Kalshi / Polymarket / yfinance / FRED / Deribit → `data/api_notes.md`.
2. `data/events.json` — hand-curated ~12–15 events (FOMC ×2, CPI, BTC ×3, no-proxy ×5).
3. Backend (FastAPI): clients → `scripts/backfill.py` → SQLite (`prices`, `market_state`).
4. `backend/calibration.py` (isotonic on settled Kalshi) → `data/calibration.json`.
5. `backend/proxies.py` (fedfunds, btc_options), `backend/basis.py`, `backend/trust.py`, `backend/betas.py`.
6. API: `/events`, `/events/{id}`, `/calibration`, `/scenario`. 60s refresh task. DEMO_MODE snapshot.
7. Frontend: overview table, event page (chart + trust bars + betas + slider), calibration page.
8. P1: belief box → Claude JSON match → explanation. `backend/prompts.py`.
9. P2: divergence feed, arb check, PNG export.

## Decisions
- Plain sqlite3, one file `data/basis.db`. uv for Python deps.
- Kalshi history: candlesticks endpoint; Polymarket: CLOB prices-history.
- Calibration uses Kalshi `last_price` on settled markets (documented approximation).
- All external failures → cached value + `stale` flag, never a 500.
