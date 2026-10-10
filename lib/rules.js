// The fine print on each protection quote, from Kalshi's own contract terms
// (data/rules.json, built by scripts/build-rules.js): when trading stops, the latest the
// contract can settle, and what it would settle on if the government never publishes the
// number, worked out with today's data. In 2025 BLS skipped the October CPI and jobs
// reports during the shutdown, so this is not hypothetical.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'rules.json');
let rules = null;
function load() { if (!rules) { try { rules = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { rules = { releases: {} }; } } return rules; }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function addMonths(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }
function monthBefore(iso) { const [y, m] = iso.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
const longMonth = (ym) => LONG[Number(ym.split('-')[1]) - 1] + ' ' + ym.split('-')[0];

/**
 * quote: an agent quote ({ release, contract: 'YES on "Above 3.6%"', strike, expiry })
 * data:  { cpi: history.cpi() result, nfpDays: history days for payrolls, gaps: history gaps }
 */
function edge(quote, data) {
  const r = load().releases[quote.release];
  if (!r || !quote.expiry) return null;
  const yes = /^YES/.test(quote.contract), out = {
    release: quote.release, family: r.family, url: r.url,
    stopsTrading: (r.lastTrading.match(/(\d{1,2}:\d{2} [AP]M ET)/) || [])[1] || null,
    releaseDate: quote.expiry,
    latestSettle: /three months/.test(r.expiration || '') ? addMonths(quote.expiry, 3) : null,
    exchangeCanReview: !!r.exchangeCanReview,
    fallback: null,
    precedent: (data.gaps || []).filter((g) => g.release === quote.release).map((g) => ({ month: longMonth(g.month), note: g.note })),
  };
  const measured = monthBefore(quote.expiry);   // the month the release reports on
  const kind = r.fallbackKind && r.fallbackKind.pick;

  if (quote.release === 'cpi' && kind === 'formula' && data.cpi) {
    // (last available CPI / CPI 12 months before it)^(13/12) - 1, from the terms
    const months = Object.keys(data.cpi.index).filter((m) => m < measured).sort(), last = months[months.length - 1];
    const [y, m] = last.split('-'), prev = data.cpi.index[`${Number(y) - 1}-${m}`];
    if (prev) {
      const v = (Math.pow(data.cpi.index[last] / prev, 13 / 12) - 1) * 100;
      const pays = yes ? v > quote.strike : v <= quote.strike;
      out.fallback = { kind, basedOn: longMonth(last), value: Math.round(v * 100) / 100, unit: '%', pays, clause: r.fallback,
        printed: data.cpi.yoy[last] };
    }
  }
  if (quote.release === 'nfp' && kind === 'last_month' && data.nfpDays && data.nfpDays.length) {
    const last = data.nfpDays.filter((d) => d.month < measured).slice(-1)[0];
    if (last) {
      // payroll strikes are "strictly above"; the quote's strike is in thousands
      const pays = yes ? last.value > quote.strike : last.value <= quote.strike;
      out.fallback = { kind, basedOn: longMonth(last.month), value: last.value, unit: 'K', pays, clause: r.fallback };
    }
  }
  if (!out.fallback && kind) out.fallback = { kind, clause: r.fallback };
  return out;
}

module.exports = { edge, load, MONTHS };
