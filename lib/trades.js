// Saved trades and odds marks. With DATABASE_URL set (Tiger Data / TimescaleDB) they live in two
// hypertables, trades and marks, so positions can be marked to market and every odds tick is
// kept as a time series. Without it, trades go to data/trades.json so the demo still works.
//
//   await trades.init()
//   await trades.record({ user, event_id, title, side, venue, price, contracts, dollars, p_calibrated, basis, trust, kelly_share })
//   await trades.list(user)              newest first
//   await trades.mark(events)            one row per event with its current price and calibrated p
//   await trades.history(event_id, days) the marks for one event, for a chart
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'trades.json');
let pool = null, ready = null;

function configured() { return !!process.env.DATABASE_URL; }

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE IF NOT EXISTS trades (
  time timestamptz NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  event_id text NOT NULL,
  title text,
  side text NOT NULL,
  venue text,
  price numeric NOT NULL,
  contracts integer NOT NULL,
  dollars numeric NOT NULL,
  p_calibrated numeric,
  basis numeric,
  trust integer,
  kelly_share numeric,
  status text NOT NULL DEFAULT 'open',
  PRIMARY KEY (time, id)
);
SELECT create_hypertable('trades', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS trades_user_time ON trades (user_id, time DESC);
CREATE TABLE IF NOT EXISTS marks (
  time timestamptz NOT NULL DEFAULT now(),
  event_id text NOT NULL,
  price numeric,
  p_calibrated numeric,
  p_proxy numeric,
  trust integer
);
SELECT create_hypertable('marks', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS marks_event_time ON marks (event_id, time DESC);
`;

async function init() {
  if (!configured()) return false;
  if (!ready) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, ssl: /sslmode=require|tsdb\.cloud|tigerdata/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined });
    ready = pool.query(SCHEMA).then(() => true).catch((e) => { console.error('trades: database unavailable, using data/trades.json:', e.message); pool = null; return false; });
  }
  return ready;
}

/* --------------------------------------------------------------- file store */
function readFile() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return { trades: [], marks: [] }; } }
function writeFile(d) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(d, null, 1)); }

const COLS = ['user_id', 'event_id', 'title', 'side', 'venue', 'price', 'contracts', 'dollars', 'p_calibrated', 'basis', 'trust', 'kelly_share'];

async function record(t) {
  const row = { time: new Date().toISOString(), id: require('crypto').randomUUID(), status: 'open' };
  for (const c of COLS) row[c] = t[c] == null ? null : t[c];
  if (await init()) {
    const vals = COLS.map((c) => row[c]);
    const r = await pool.query(`INSERT INTO trades (${COLS.join(',')}) VALUES (${COLS.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, vals);
    return clean(r.rows[0]);
  }
  const d = readFile(); d.trades.unshift(row); writeFile(d);
  return row;
}

async function list(user) {
  if (await init()) {
    const r = await pool.query('SELECT * FROM trades WHERE user_id = $1 ORDER BY time DESC LIMIT 200', [user]);
    return r.rows.map(clean);
  }
  return readFile().trades.filter((t) => t.user_id === user);
}

async function mark(events) {
  const rows = events.map((e) => ({ time: new Date().toISOString(), event_id: e.id, price: e.price, p_calibrated: e.p_calibrated, p_proxy: e.p_proxy, trust: e.trust_score }));
  if (await init()) {
    const text = 'INSERT INTO marks (event_id, price, p_calibrated, p_proxy, trust) VALUES ' + rows.map((_, i) => `($${i * 5 + 1},$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`).join(',');
    await pool.query(text, rows.flatMap((r) => [r.event_id, r.price, r.p_calibrated, r.p_proxy, r.trust]));
    return rows.length;
  }
  const d = readFile(); d.marks = (d.marks || []).concat(rows).slice(-5000); writeFile(d);
  return rows.length;
}

async function history(eventId, days = 30) {
  if (await init()) {
    // one point an hour, the way the desk charts it; time_bucket is what the hypertable is for
    const r = await pool.query(`SELECT time_bucket('1 hour', time) AS t, avg(price)::float AS price, avg(p_calibrated)::float AS p
      FROM marks WHERE event_id = $1 AND time > now() - ($2 || ' days')::interval GROUP BY t ORDER BY t`, [eventId, String(days)]);
    return r.rows.map((x) => ({ time: x.t, price: x.price, p: x.p }));
  }
  const since = Date.now() - days * 864e5;
  return (readFile().marks || []).filter((m) => m.event_id === eventId && Date.parse(m.time) > since).map((m) => ({ time: m.time, price: m.price, p: m.p_calibrated }));
}

function clean(r) { const o = { ...r }; for (const k of ['price', 'dollars', 'p_calibrated', 'basis', 'kelly_share']) if (o[k] != null) o[k] = Number(o[k]); if (o.time instanceof Date) o.time = o.time.toISOString(); return o; }
function backend() { return pool ? 'timescale' : 'file'; }

module.exports = { init, configured, record, list, mark, history, backend };
