"""Where orders go once the guard passes them, and the record of every order, sent or not.

Fidelity has no trading API, so the default broker, "proposals", sends nothing: an order becomes a checklist
row with status manual and an instruction ("Buy $1,250.00 of NWRB at Fidelity: market order, during market
hours"), and you mark it filled or canceled once you've placed it or decided not to. The optional "alpaca"
broker sends market orders to Alpaca's trading API, on paper unless policy.toml sets allow_live AND the
environment sets ALPACA_LIVE=1; either one alone stays on paper. Its keys come from APCA_API_KEY_ID and
APCA_API_SECRET_KEY. A sell of (nearly) the whole position goes by share quantity rather than dollars, so a
price tick between quote and fill can't leave a sliver behind.

`execute` is the one way in: it runs the guard and files the outcome, so a rejected order is on record with
its reasons, and every order that counts toward the daily and weekly limits is in the `orders` table the guard
reads them back from. An Alpaca order is filed as submitted before it's sent, so it counts even if we never
hear back. Rows are never deleted; a status change updates the row and its updated_at.
"""
import json
import os

from intel.guard import check, usd
from intel.policy import DATA_DIR
from intel.portfolio import http
from intel.store import now_iso

PAPER, LIVE = "https://paper-api.alpaca.markets", "https://api.alpaca.markets"
STATUSES = ("manual", "submitted", "filled", "canceled", "rejected", "failed")
WHOLE = 0.99            # a sell of at least this share of a position's value closes the position by quantity
ALPACA_STATUS = {"filled": "filled", "canceled": "canceled", "expired": "canceled", "replaced": "canceled",
                 "rejected": "failed"}  # anything else (new, accepted, partially_filled, ...) is still submitted

SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  proposal_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  ticker TEXT NOT NULL, side TEXT NOT NULL, notional REAL NOT NULL,
  broker TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
  broker_order_id TEXT, reasons TEXT NOT NULL DEFAULT '[]', detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status, created_at);
"""


def init(store):
    store.con.executescript(SCHEMA)


def _row(r):
    d = dict(r)
    d["reasons"], d["detail"] = json.loads(d["reasons"] or "[]"), json.loads(d["detail"] or "{}")
    return d


def get(store, order_id):
    r = store.con.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
    return _row(r) if r else None


def record(store, order, *, broker, mode, status, reasons=(), detail=None, broker_order_id=None, at=None):
    """File one order as it stands. Returns its id."""
    init(store)
    at = at or now_iso()
    with store.tx() as con:
        cur = con.execute("INSERT INTO orders(proposal_id, created_at, updated_at, ticker, side, notional, broker, "
                          "mode, status, broker_order_id, reasons, detail) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                          (order.proposal_id, at, at, order.ticker, order.side, order.notional, broker, mode, status,
                           broker_order_id, json.dumps(list(reasons)), json.dumps(detail or {})))
    return cur.lastrowid


def _update(store, order_id, *, detail=None, **fields):
    if detail:
        fields["detail"] = json.dumps({**get(store, order_id)["detail"], **detail})
    if "reasons" in fields:
        fields["reasons"] = json.dumps(list(fields["reasons"]))
    fields["updated_at"] = now_iso()
    with store.tx() as con:
        con.execute(f"UPDATE orders SET {', '.join(f'{k}=?' for k in fields)} WHERE id=?", (*fields.values(), order_id))
    return get(store, order_id)


class ManualBroker:
    """Orders as a checklist you place by hand at Fidelity."""
    name, mode = "proposals", "manual"

    def __init__(self, store, policy=None, *, where="Fidelity"):
        self.store, self.where = store, where
        init(store)

    def instruction(self, order):
        return (f"{order.side.capitalize()} {usd(order.notional)} of {order.ticker} at {self.where}: "
                "market order, during market hours")

    def submit(self, order, *, reasons=()):
        oid = record(self.store, order, broker=self.name, mode=self.mode, status="manual", reasons=reasons,
                     detail={"instruction": self.instruction(order)})
        return get(self.store, oid)

    def mark(self, order_id, status):
        """Record what became of a checklist item: "filled" once you've placed it, "canceled" if you won't."""
        if status not in ("filled", "canceled"):
            raise ValueError(f"a checklist item is marked filled or canceled, not {status!r}")
        row = get(self.store, order_id)
        if not row or row["broker"] != self.name or row["status"] == "rejected":
            raise ValueError(f"order {order_id} isn't on the checklist")
        return _update(self.store, order_id, status=status)


class AlpacaBroker:
    """Market orders through Alpaca: paper trading unless live is switched on in policy.toml and the env."""
    name = "alpaca"

    def __init__(self, store, policy, *, transport=http):
        self.store, self.transport = store, transport or http
        self.mode = "live" if policy.allow_live and os.environ.get("ALPACA_LIVE") == "1" else "paper"
        self.base = LIVE if self.mode == "live" else PAPER
        self.keys = (os.environ.get("APCA_API_KEY_ID", ""), os.environ.get("APCA_API_SECRET_KEY", ""))
        if store is not None:
            init(store)

    def _call(self, method, path, body=None):
        if not all(self.keys):
            raise RuntimeError("APCA_API_KEY_ID and APCA_API_SECRET_KEY aren't set")
        return self.transport(method, self.base + path,
                              {"APCA-API-KEY-ID": self.keys[0], "APCA-API-SECRET-KEY": self.keys[1]}, body)

    def account(self):
        return self._call("GET", "/v2/account")

    def positions(self):
        return self._call("GET", "/v2/positions")

    def payload(self, order):
        body = {"symbol": order.ticker, "side": order.side, "type": "market", "time_in_force": "day"}
        held = next((p for p in self.positions() if p["symbol"] == order.ticker), None) if order.side == "sell" else None
        if held and order.notional >= WHOLE * float(held["market_value"]):
            body["qty"] = str(held["qty"])
        else:
            body["notional"] = f"{order.notional:.2f}"
        return body

    def submit(self, order, *, reasons=()):
        oid = record(self.store, order, broker=self.name, mode=self.mode, status="submitted", reasons=reasons)
        try:
            body = self.payload(order)
            resp = self._call("POST", "/v2/orders", body)
        except Exception as e:  # noqa: BLE001 - a refused order is a fact to file, not a crash
            return _update(self.store, oid, status="failed", reasons=[*reasons, f"Alpaca didn't take it: {e}"],
                           detail={"error": str(e)})
        return _update(self.store, oid, status=ALPACA_STATUS.get(resp.get("status"), "submitted"),
                       broker_order_id=resp.get("id"), detail={"request": body, "alpaca_status": resp.get("status")})

    def refresh(self, order_id):
        """Bring one order's status up to date from Alpaca (filled, canceled, expired)."""
        row = get(self.store, order_id)
        if not row or row["broker"] != self.name or not row["broker_order_id"]:
            return row
        resp = self._call("GET", f"/v2/orders/{row['broker_order_id']}")
        return _update(self.store, order_id, status=ALPACA_STATUS.get(resp.get("status"), "submitted"),
                       detail={"alpaca_status": resp.get("status"), "filled_qty": resp.get("filled_qty"),
                               "filled_avg_price": resp.get("filled_avg_price")})


def make(policy, store, *, transport=http):
    """The broker policy.toml names."""
    if policy.broker == "alpaca":
        return AlpacaBroker(store, policy, transport=transport)
    return ManualBroker(store, policy)


def execute(order, portfolio, policy, store, broker, *, data_dir=DATA_DIR):
    """Guard one order, then file it as rejected with the reasons or hand it to the broker. The pipeline's only
    way to place an order."""
    v = check(order, portfolio, policy, store, data_dir=data_dir)
    if v.ok:
        row = broker.submit(v.order, reasons=v.reasons)
    else:
        row = get(store, record(store, v.order, broker=broker.name, mode=broker.mode, status="rejected",
                                reasons=v.reasons))
    return {"order_id": row["id"], "status": row["status"], "reasons": row["reasons"], "notional": row["notional"],
            "resized": v.resized}


def orders(store, *, since=None, status=None):
    """Filed orders, newest first. `since` is an ISO time; `status` one status or several."""
    init(store)
    sql, args = "SELECT * FROM orders WHERE 1=1", []
    if since:
        sql, args = sql + " AND created_at >= ?", [since]
    if status:
        statuses = [status] if isinstance(status, str) else list(status)
        sql += f" AND status IN ({','.join('?' * len(statuses))})"
        args += statuses
    return [_row(r) for r in store.con.execute(sql + " ORDER BY created_at DESC, id DESC", args)]
