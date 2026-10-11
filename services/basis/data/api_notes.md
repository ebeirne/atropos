# External API notes (verified 2026-10-10 with real requests)

## Kalshi  `https://api.elections.kalshi.com/trade-api/v2`
- `GET /markets?status=settled&limit=1000&cursor=` → `{cursor, markets:[...]}`. Paginate until cursor == "".
  Market keys we rely on: `ticker`, `event_ticker`, `title`, `status` (`active|finalized|...`), `result` (`yes|no|""`),
  `last_price_dollars` (string, e.g. "0.0200"), `yes_bid_dollars`, `yes_ask_dollars`, `volume_24h_fp` (string contracts),
  `volume_fp`, `open_interest_fp`, `close_time`, `expiration_time`, `market_type` (`binary`). NOTE: prices are now
  `*_dollars` strings, not integer cents.
- `GET /markets?series_ticker=X&status=open` and `?event_ticker=X` work for discovery.
- `GET /markets/{ticker}` → `{market:{...}}`.
- `GET /markets/{ticker}/orderbook` → `{orderbook_fp:{yes_dollars:[[price,size],...], no_dollars:[...]}}`.
  Best yes bid = max(yes_dollars price); best yes ask = 1 − max(no_dollars price).
- `GET /series/{series}/markets/{ticker}/candlesticks?start_ts&end_ts&period_interval=1440` →
  `{candlesticks:[{end_period_ts, price:{close_dollars,...}, yes_bid:{close_dollars}, yes_ask:{close_dollars}, volume_fp, open_interest_fp}]}`.
  `price.close_dollars` is absent on days with no trades (only `previous_dollars`); forward-fill.
  Works for settled markets too (used for the Sept FOMC lag chart).
- `GET /markets/trades?ticker=X&limit=N` → `{trades:[{created_time, yes_price_dollars, count_fp, taker_side, is_block_trade}]}`.
- `GET /series?category=Economics|Politics|...` → `{series:[{ticker,title}]}` for discovery.

## Polymarket
- Gamma `GET https://gamma-api.polymarket.com/events?slug=X` → list of events; each has `markets:[...]` with
  `question`, `conditionId`, `clobTokenIds` (JSON-encoded string array, [yes,no]), `outcomePrices` (JSON string ["0.77","0.23"]),
  `volume24hr` (float, may be null), `spread`, `bestBid`, `bestAsk`, `lastTradePrice`, `endDate`, `closed`.
- Gamma `GET /public-search?q=...&limit_per_type=N` → `{events:[{slug,title,closed,volume24hr}]}`. Good for discovery.
- CLOB `GET https://clob.polymarket.com/prices-history?market=<yes_token>&interval=max&fidelity=1440` → `{history:[{t,p}]}` (unix s).
- CLOB `GET https://clob.polymarket.com/book?token_id=` → `{bids:[{price,size}], asks:[{price,size}]}` (strings).
- Data `GET https://data-api.polymarket.com/holders?market=<conditionId>&limit=20` → `[{token, holders:[{amount, outcomeIndex, ...}]}]`
  (one entry per outcome token). top10 share = sum(top10 amounts)/sum(all returned amounts) — approximation, only top-N returned.
- Data `GET https://data-api.polymarket.com/trades?market=<conditionId>&limit=N` → `[{side,size,price,timestamp,outcome}]`.

## Traditional proxies
- yfinance fed-funds futures resolve: `ZQV26.CBT`, `ZQX26.CBT`, `ZQZ26.CBT`, `ZQF27.CBT` (≈251 daily rows each). Implied rate = 100 − price.
- FRED `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFF` → CSV `observation_date,DFF`.
- Deribit `get_book_summary_by_currency?currency=BTC&kind=option` → `result:[{instrument_name:"BTC-25DEC26-100000-C", mark_iv (pct), underlying_price}]`.
  Expiries live on 2026-10-10: 30OCT26, 27NOV26, 25DEC26, 26MAR27, ...
- Current state of the world: fed-funds futures price *hikes* (Dec-2026 "hike 25bps" ~71–75% on both venues), so FOMC events are
  modelled as P(hike) with `direction: "hike"`.
