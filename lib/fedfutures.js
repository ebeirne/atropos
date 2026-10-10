// FedWatch-style odds for one FOMC meeting, from CBOT 30-day fed funds futures
// (delayed quotes via Yahoo) and the effective fed funds rate (NY Fed API).
// Both are public and keyless. This is the reference a prediction-market Fed
// ladder gets compared against: the research's strongest result is that the
// two broadly agree, so the interesting number is where they don't.
//
// Method (the standard one):
//   r_pre  = today's EFFR
//   r_post = 100 - price of the first contract month after the meeting that has
//            no meeting of its own (its average rate is the post-meeting rate);
//            if the next month has a meeting, back r_post out of the meeting
//            month's average instead.
//   steps  = (r_post - r_pre) / 0.25, split between the two adjacent 25bp outcomes.

const https = require('https');

const MONTH_CODE = 'FGHJKMNQUVXZ';
// FOMC decision days (second day of each meeting).
const FOMC_2026 = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'];

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 prior-desk/0.1', Accept: 'application/json' } }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} from ${new URL(url).host}`));
        try { resolve(JSON.parse(buf)); } catch (_) { reject(new Error('non-JSON from ' + new URL(url).host)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function contractFor(year, monthIndex) {
  return `ZQ${MONTH_CODE[monthIndex]}${String(year).slice(-2)}.CBT`;
}

async function futuresRate(symbol) {
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`);
  const m = j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  if (!m || !Number.isFinite(m.regularMarketPrice)) throw new Error(`no quote for ${symbol}`);
  return { symbol, price: m.regularMarketPrice, rate: 100 - m.regularMarketPrice,
    asOf: new Date(m.regularMarketTime * 1000).toISOString() };
}

async function effr() {
  const j = await getJSON('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json');
  const r = j.refRates && j.refRates[0];
  if (!r || !Number.isFinite(r.percentRate)) throw new Error('no EFFR');
  return { rate: r.percentRate, date: r.effectiveDate };
}

/** Two-point split of a rate change over the outcome buckets [Cut 0.50+, Cut 0.25, Hold, Hike]. */
function bucketsFromSteps(steps) {
  const p = [0, 0, 0, 0];
  const add = (k, w) => {
    if (w <= 0) return;
    if (k <= -2) p[0] += w; else if (k === -1) p[1] += w; else if (k === 0) p[2] += w; else p[3] += w;
  };
  const lo = Math.floor(steps), frac = steps - lo;
  add(lo, 1 - frac); add(lo + 1, frac);
  return p;
}

async function oddsForMeeting(meetingDate) {
  const d = new Date(meetingDate + 'T12:00:00Z');
  const y = d.getUTCFullYear(), mo = d.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const nextY = mo === 11 ? y + 1 : y, nextMo = (mo + 1) % 12;
  const nextHasMeeting = FOMC_2026.some((m) => m.startsWith(`${nextY}-${String(nextMo + 1).padStart(2, '0')}`));

  const pre = await effr();
  let post, method, used;
  if (!nextHasMeeting) {
    used = await futuresRate(contractFor(nextY, nextMo));
    post = used.rate; method = `${used.symbol} (no meeting that month)`;
  } else {
    used = await futuresRate(contractFor(y, mo));
    const dPre = d.getUTCDate();                     // the new rate takes effect the day after the decision
    const wPre = dPre / daysInMonth;
    post = (used.rate - wPre * pre.rate) / (1 - wPre); method = `${used.symbol} (meeting month, backed out)`;
  }
  const deltaBp = (post - pre.rate) * 100;
  const p = bucketsFromSteps(deltaBp / 25);
  return {
    probs: p, rPre: pre.rate, rPost: Math.round(post * 10000) / 10000, deltaBp: Math.round(deltaBp * 10) / 10,
    contract: used.symbol, price: used.price, method, asOf: used.asOf, effrDate: pre.date,
    source: 'CBOT fed funds futures (delayed, via Yahoo) and NY Fed EFFR',
  };
}

module.exports = { oddsForMeeting, bucketsFromSteps, contractFor, FOMC_2026 };
