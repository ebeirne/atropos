// Point-in-time archive. Every live read of the odds is appended, never edited,
// stamped with knowledge_time (when we saw it). Reading "as of" a moment returns
// the latest snapshot per event that was knowable then - so a backtest built on
// this cannot see the future, by construction.
//
// Historical order books are the gap no venue fills; the only way to have
// them later is to start recording now.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'archive');

function fileFor(iso) { return path.join(DIR, `odds-${iso.slice(0, 10)}.jsonl`); }

function record(events) {
  const live = events.filter((e) => e.source !== 'sample');
  if (!live.length) return 0;
  fs.mkdirSync(DIR, { recursive: true });
  const knowledge_time = new Date().toISOString();
  const lines = live.map((e) => JSON.stringify({
    knowledge_time, id: e.id, source: e.source, title: e.title || e.name, event_date: e.date,
    labels: e.labels, edges: e.edges || null, raw: e.raw, overround: e.overround, depth: e.depth || null,
    reference: e.reference && e.reference.source ? { probs: e.reference.ois, source: e.reference.source,
      contract: e.reference.contract, deltaBp: e.reference.deltaBp, asOf: e.reference.asOf } : null,
  }));
  fs.appendFileSync(fileFor(knowledge_time), lines.join('\n') + '\n');
  return lines.length;
}

function readAll() {
  if (!fs.existsSync(DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
      if (line.trim()) { try { out.push(JSON.parse(line)); } catch (_) { /* a torn line is skipped, never repaired */ } }
    }
  }
  return out;
}

/** The latest snapshot of each event knowable at `asOf` (ISO). */
function asOf(asOfIso) {
  const latest = {};
  for (const s of readAll()) {
    if (s.knowledge_time > asOfIso) continue;
    if (!latest[s.id] || latest[s.id].knowledge_time < s.knowledge_time) latest[s.id] = s;
  }
  return Object.values(latest);
}

function status() {
  const all = readAll();
  return {
    snapshots: all.length,
    first: all.length ? all[0].knowledge_time : null,
    last: all.length ? all[all.length - 1].knowledge_time : null,
    events: [...new Set(all.map((s) => s.id))],
  };
}

/**
 * How each outcome's odds moved since the earliest read in the last `hours`,
 * in percentage points, like a day's change on a quote. Both ends are the raw
 * prices normalised the same way, so the change is the market's, not ours.
 * Null for samples, or until there are two reads of the same ladder.
 */
function changeFor(e, hours = 24) {
  if (!e || e.source === 'sample' || !Array.isArray(e.raw)) return null;
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const key = JSON.stringify(e.labels);
  const snaps = readAll().filter((s) => s.id === e.id && s.knowledge_time >= since &&
    Array.isArray(s.raw) && s.raw.length === e.raw.length && JSON.stringify(s.labels) === key);
  if (snaps.length < 2) return null;
  const first = snaps.reduce((a, b) => (a.knowledge_time <= b.knowledge_time ? a : b));
  const norm = (a) => { const t = a.reduce((x, y) => x + y, 0) || 1; return a.map((v) => v / t); };
  const prev = norm(first.raw), cur = norm(e.raw);
  return { since: first.knowledge_time, deltaPp: cur.map((c, i) => Math.round((c - prev[i]) * 1000) / 10) };
}

module.exports = { record, asOf, status, changeFor };
