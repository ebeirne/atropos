// Atty's track record. Every agent round records her call for each tail (protect, your
// call, or skip) with the price at the time; the last call before a release counts. After
// the release, the call is settled against the number as first printed: did the tail
// happen, what the protection would have paid, and how your holdings moved that day.
// Kept in data/ledger.json so the record survives restarts.

const fs = require('fs');
const path = require('path');
const history = require('./history');

const FILE = path.join(__dirname, '..', 'data', 'ledger.json');
function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return { calls: {} }; } }
function save(l) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(l, null, 1)); }
function monthBefore(iso) { const [y, m] = iso.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
const today = () => new Date().toISOString().slice(0, 10);

/** Record the latest call for every tail that has a quote; calls freeze once the release day arrives. */
function record(result) {
  if (!result || !result.portfolio) return;
  const l = load();
  for (const p of result.portfolio) {
    if (!p.best || !p.knot || !p.best.expiry) continue;
    if (p.best.expiry <= today()) continue;                // too late to change the call
    const key = `${p.release}:${p.side}:${p.best.expiry}`;
    const verdict = p.knot.verdict;
    l.calls[key] = {
      key, release: p.release, releaseName: p.releaseName, side: p.side, word: p.word, releaseDate: p.best.expiry,
      call: verdict === 'good' ? 'protect' : verdict === 'fair' ? 'your call' : 'skip', verdict,
      contract: p.best.contract, venue: p.best.venue, strike: p.best.strike, ask: p.best.ask, fair: p.best.fair,
      contracts: p.knot.contracts, cost: p.knot.cost, payout: p.knot.payout, loss: p.loss, holdings: p.holdings,
      calledAt: result.at, settled: null,
    };
  }
  save(l);
}

/** Settle every call whose release has come out. */
async function settle(holdings) {
  const l = load(); let changed = false;
  for (const c of Object.values(l.calls)) {
    if (c.settled || c.releaseDate > today()) continue;
    const month = monthBefore(c.releaseDate);
    let value = null;
    try {
      if (c.release === 'cpi') value = (await history.cpi()).yoy[month];
      if (c.release === 'nfp') value = await history.payrollFirstPrint(month, c.releaseDate);
    } catch (_) { value = null; }
    if (value == null) continue;                           // not out yet (or delayed): stays open
    const yes = /^YES/.test(c.contract);
    const paid = yes ? value > c.strike : value <= c.strike;
    let move = null;
    try {
      let w = 0, r = 0;
      for (const h of holdings) {
        const px = await history.closes(h.symbol), days = Object.keys(px), i = days.indexOf(c.releaseDate);
        if (i > 0) { r += h.value * (px[c.releaseDate] / px[days[i - 1]] - 1); w += h.value; }
      }
      move = w ? Math.round(r / w * 10000) / 100 : null;
    } catch (_) { move = null; }
    c.settled = { at: new Date().toISOString(), value, paid, net: Math.round(((paid ? c.payout : 0) - c.cost) * 100) / 100, move };
    changed = true;
  }
  if (changed) save(l);
  return l;
}

function list() {
  return Object.values(load().calls).sort((a, b) => (a.releaseDate < b.releaseDate ? -1 : a.releaseDate > b.releaseDate ? 1 : 0));
}

module.exports = { record, settle, list };
