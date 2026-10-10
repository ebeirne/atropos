// Jev (TypeSafe's System One model): fast typed answers, ~200ms. Used where a
// yes/no, a choice or a score is the whole job - classifying a ticker nobody
// put in the table, and checking a written rationale against its numbers.
//
// Schema notes (the docs are thin, these were probed): criteria is an object
// {yes,no} for noul, an object {key: description} for choice, a non-empty list
// of anchors for score; score answers come back on 0..1.

const https = require('https');
const { BUCKETS } = require('./engine');

const MODEL = process.env.JEV_MODEL || 'jev-latest';

function configured() { return !!process.env.TYPESAFE_API_KEY; }

function ask(state, questions) {
  return new Promise((resolve, reject) => {
    if (!configured()) return reject(new Error('TYPESAFE_API_KEY is not set'));
    const body = Buffer.from(JSON.stringify({ model: MODEL, state, questions }));
    const t0 = Date.now();
    const req = https.request({
      hostname: 'api.typesafe.ai', path: '/v1/systemone', method: 'POST', timeout: 15000,
      headers: {
        Authorization: 'Bearer ' + process.env.TYPESAFE_API_KEY,
        'Content-Type': 'application/json', 'Content-Length': body.length,
      },
    }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(buf); } catch (_) { return reject(new Error('Jev returned non-JSON')); }
        if (res.statusCode >= 400) return reject(Object.assign(new Error('Jev ' + res.statusCode), { detail: json }));
        json.latency_ms = Date.now() - t0;
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Jev timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

async function health() {
  return new Promise((resolve) => {
    if (!configured()) return resolve({ ok: false, reason: 'no key' });
    https.get({ hostname: 'api.typesafe.ai', path: '/v1/models', timeout: 8000,
      headers: { Authorization: 'Bearer ' + process.env.TYPESAFE_API_KEY } }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode === 200, status: res.statusCode });
    }).on('error', (e) => resolve({ ok: false, reason: e.message }));
  });
}

const qkey = (s) => 'q_' + String(s).replace(/[^A-Za-z0-9]/g, '_');

/** One call classifies every unknown ticker into an exposure bucket. */
async function classify(securities) {
  if (!securities.length) return { buckets: {}, latency_ms: 0 };
  const criteria = {};
  for (const [k, b] of Object.entries(BUCKETS)) {
    criteria[k] = `${b.label}: equity beta about ${b.beta}, rate duration about ${b.duration} years.`;
  }
  const questions = {};
  for (const s of securities) {
    questions[qkey(s.symbol)] = {
      type: 'choice',
      instructions: `Which exposure bucket best describes the security ${s.symbol}` +
        (s.description ? ` (${s.description})` : '') + '?',
      criteria,
    };
  }
  const out = await ask({ securities }, questions);
  const buckets = {};
  for (const s of securities) {
    const a = out.answers[qkey(s.symbol)];
    buckets[s.symbol] = a && BUCKETS[a.choice] ? { bucket: a.choice, confidence: a.confidence } : { bucket: 'other', confidence: 0 };
  }
  return { buckets, latency_ms: out.latency_ms, model: out.model };
}

const GLOSSARY = {
  legs: 'BUY and SELL legs of one option spread; strike is in dollars, expiry is a date, qty is contracts.',
  limitPerShare: 'expected market price of the spread per share; one contract is 100 shares.',
  maxDebitPerShare: 'the highest price per share worth paying for the spread.',
  premiumAtRisk: 'dollars lost if the spread expires worthless (qty x limitPerShare x 100).',
  maxPayout: 'dollars the spread pays at most (qty x strike width x 100).',
  tail: 'side "low" means the release prints at or below threshold, "high" at or above; pModel is the odds from prediction markets and pOptions what options charge, both as fractions (0.15 = 15%).',
  covers: 'holdings whose exposure the spread is sized against.',
};

/**
 * One call checks every written case against its own numbers. The question is
 * narrow on purpose: is any figure contradicted? General explanation ("the
 * index is used because...") is not a figure and should not fail.
 */
async function checkRationales(items) {
  if (!items.length) return { checks: {}, latency_ms: 0 };
  const questions = {};
  for (const it of items) {
    questions[qkey(it.id)] = {
      type: 'noul',
      instructions: `For item ${it.id}: do the numbers, dates, strikes, tickers and directions written in its text all agree with its numbers object?`,
      criteria: {
        yes: 'Every figure the text states matches the numbers object, after unit conversion (fractions to percent, per share to per contract). Explanations that state no figure are fine.',
        no: 'The text states at least one figure, date, strike, ticker or direction that contradicts the numbers object.',
      },
    };
  }
  const out = await ask({ glossary: GLOSSARY, items }, questions);
  const checks = {};
  for (const it of items) {
    const a = out.answers[qkey(it.id)];
    checks[it.id] = a ? Math.round(a.noul * 100) / 100 : null;
  }
  return { checks, latency_ms: out.latency_ms, model: out.model };
}

module.exports = { configured, health, ask, classify, checkRationales };
