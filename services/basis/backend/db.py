"""Tiny sqlite3 layer. One file, a handful of tables, no ORM."""
import sqlite3
from contextlib import contextmanager
from backend.config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS prices (
  event_id TEXT, venue TEXT, date TEXT, p_yes REAL,
  PRIMARY KEY (event_id, venue, date)
);
CREATE TABLE IF NOT EXISTS market_state (
  event_id TEXT, venue TEXT, ts TEXT, p_yes REAL, spread REAL, volume_24h REAL,
  last_trade_ts TEXT, top10_holder_share REAL, largest_trade_24h REAL, stale INTEGER DEFAULT 0,
  PRIMARY KEY (event_id, venue)
);
CREATE TABLE IF NOT EXISTS proxy_prices (
  event_id TEXT, date TEXT, p_proxy REAL, detail TEXT,
  PRIMARY KEY (event_id, date)
);
CREATE TABLE IF NOT EXISTS asset_prices (
  ticker TEXT, date TEXT, close REAL,
  PRIMARY KEY (ticker, date)
);
CREATE TABLE IF NOT EXISTS settled_markets (
  ticker TEXT PRIMARY KEY, last_price REAL, result TEXT, close_time TEXT, volume REAL
);
"""


def connect(path=None):
    con = sqlite3.connect(str(path or DB_PATH), check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


@contextmanager
def tx(con):
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise


def upsert_prices(con, event_id, venue, rows):
    with tx(con):
        con.executemany(
            "INSERT OR REPLACE INTO prices(event_id, venue, date, p_yes) VALUES (?,?,?,?)",
            [(event_id, venue, d, p) for d, p in rows],
        )


def upsert_state(con, event_id, venue, s):
    with tx(con):
        con.execute(
            """INSERT OR REPLACE INTO market_state
               (event_id, venue, ts, p_yes, spread, volume_24h, last_trade_ts, top10_holder_share, largest_trade_24h, stale)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (event_id, venue, s["ts"], s.get("p_yes"), s.get("spread"), s.get("volume_24h"), s.get("last_trade_ts"),
             s.get("top10_holder_share"), s.get("largest_trade_24h"), int(s.get("stale", 0))),
        )


def get_state(con, event_id):
    rows = con.execute("SELECT * FROM market_state WHERE event_id=?", (event_id,)).fetchall()
    return {r["venue"]: dict(r) for r in rows}


def get_prices(con, event_id, venue=None):
    if venue:
        rows = con.execute("SELECT date, p_yes FROM prices WHERE event_id=? AND venue=? ORDER BY date", (event_id, venue)).fetchall()
        return [(r["date"], r["p_yes"]) for r in rows]
    rows = con.execute("SELECT venue, date, p_yes FROM prices WHERE event_id=? ORDER BY date", (event_id,)).fetchall()
    out = {}
    for r in rows:
        out.setdefault(r["venue"], []).append((r["date"], r["p_yes"]))
    return out


def upsert_proxy(con, event_id, rows):
    with tx(con):
        con.executemany(
            "INSERT OR REPLACE INTO proxy_prices(event_id, date, p_proxy, detail) VALUES (?,?,?,?)",
            [(event_id, d, p, det) for d, p, det in rows],
        )


def get_proxy(con, event_id):
    rows = con.execute("SELECT date, p_proxy, detail FROM proxy_prices WHERE event_id=? ORDER BY date", (event_id,)).fetchall()
    return [(r["date"], r["p_proxy"], r["detail"]) for r in rows]


def upsert_asset(con, ticker, rows):
    with tx(con):
        con.executemany("INSERT OR REPLACE INTO asset_prices(ticker, date, close) VALUES (?,?,?)",
                        [(ticker, d, c) for d, c in rows])


def get_asset(con, ticker):
    rows = con.execute("SELECT date, close FROM asset_prices WHERE ticker=? ORDER BY date", (ticker,)).fetchall()
    return [(r["date"], r["close"]) for r in rows]
