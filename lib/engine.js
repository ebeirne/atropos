// The deterministic core. Every number a ticket shows - strike, expiry, size,
// max price - comes from here. The language models choose between candidates
// and explain them; they never author a figure.

/* ---------------------------------------------------------------- maths */

function invNorm(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
    -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const pl = 0.02425;
  if (p <= 0) return -4;
  if (p >= 1) return 4;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function moments(edges, p) {
  let m = 0, m2 = 0;
  for (let i = 0; i < p.length; i++) {
    const mid = (edges[i] + edges[i + 1]) / 2;
    m += mid * p[i]; m2 += mid * mid * p[i];
  }
  const sd = Math.sqrt(Math.max(1e-12, m2 - m * m));
  // Skew: which side the market's doubt leans. A consensus point cannot carry this.
  let m3 = 0;
  for (let i = 0; i < p.length; i++) {
    const mid = (edges[i] + edges[i + 1]) / 2;
    m3 += p[i] * Math.pow((mid - m) / sd, 3);
  }
  return { mean: m, sd, skew: m3 };
}

function cdfAt(edges, p, x) {
  let acc = 0;
  for (let i = 0; i < p.length; i++) {
    const lo = edges[i], hi = edges[i + 1];
    if (x >= hi) acc += p[i];
    else if (x > lo) { acc += p[i] * (x - lo) / (hi - lo); break; }
    else break;
  }
  return Math.min(0.9995, Math.max(0.0005, acc));
}

const r2 = (x) => Math.round(x * 100) / 100;
const p1 = (x) => (Math.round(x * 10) / 10).toFixed(1);   // percentages for people: one decimal

/* ------------------------------------------------------------- costs */

const COST = {
  optionRoundTrip: 0.025,   // fraction of premium lost to spread and fees
  rateRoundTrip: 0.30,      // bp of yield to get in and out
  directionMinNetBp: 1.0,   // a rate view must clear costs by this much to become an order
  shapeThresholdPp: 3,      // tail disagreement below this is noise
  minVolume: 5000,          // dollars traded across an event's markets before its odds can signal
  maxSpread: 0.08,          // typical bid-ask above this and the mid is a guess
  hedgeBudget: 0.010,       // max premium as a share of exposed notional, for protection
  leanBudget: 0.005,        // max premium as a share of exposed notional, for adding exposure
};

/* ----------------------------------------------------- event analysis */
// A view has a direction (stocks, bonds, futures can hold it), a shape (only
// options can), or nothing worth paying to express. Most weeks it is nothing.

function quantileOf(edges, p, q) {
  let acc = 0;
  for (let i = 0; i < p.length; i++) {
    if (acc + p[i] >= q) return edges[i] + (edges[i + 1] - edges[i]) * ((q - acc) / Math.max(p[i], 1e-9));
    acc += p[i];
  }
  return edges[edges.length - 1];
}

/** A thin book is a few people's opinion, not a price. Live venues report depth; the gate reads it. */
function credibility(depth) {
  if (!depth) return null;
  const reasons = [];
  if (depth.volume < COST.minVolume) reasons.push(`$${Math.round(depth.volume).toLocaleString('en-US')} traded in total`);
  if (depth.medianSpread != null && depth.medianSpread > COST.maxSpread) reasons.push(`${Math.round(depth.medianSpread * 100)}¢ typical spread`);
  if (depth.emptyBooks > depth.markets / 2) reasons.push(`${depth.emptyBooks} of ${depth.markets} books empty`);
  return { ok: reasons.length === 0, reasons, ...depth };
}

function analyseEvent(ev) {
  const out = {
    id: ev.id, name: ev.name, short: ev.short, tailWords: ev.tailWords || { low: 'low', high: 'high' },
    date: ev.date, kind: ev.kind, unit: ev.unit, dp: ev.dp,
    labels: ev.labels, p: ev.p, edges: ev.edges, source: ev.source, asOf: ev.asOf, title: ev.title || null,
    overround: ev.overround, kernels: ev.kernels, reference: ev.reference,
    credibility: credibility(ev.depth), verdict: 'none', side: null, notes: [],
  };

  if (!ev.reference) analyseUnpriced(ev, out);
  else if (ev.kind === 'discrete') analyseDiscrete(ev, out);
  else analyseContinuous(ev, out);

  // A trade signal from a thin book is a signal from a handful of people.
  if (out.credibility && !out.credibility.ok) {
    if (out.verdict === 'shape' || out.verdict === 'direction') { out.verdict = 'thin'; out.side = null; out.richTail = null; }
    out.notes.push(`Too thin to signal from: ${out.credibility.reasons.join(', ')}.`);
  }
  return out;
}

/**
 * Live odds with no consensus or options feed to compare against. The odds are
 * real and shown; nothing is traded, because there is no second price to set
 * them against. Tails come from the distribution's own 15th/85th percentiles,
 * so each holding's exposure can still be measured.
 */
function analyseUnpriced(ev, out) {
  out.verdict = 'unpriced';
  if (ev.kind === 'discrete') {
    const top = ev.p.indexOf(Math.max.apply(null, ev.p));
    out.focus = { label: ev.labels[top], market: r2(ev.p[top] * 100) };
    const rest = ev.labels.map((l, i) => [l, ev.p[i]]).filter((x, i) => i !== top && x[1] >= 0.02)
      .map((x) => `${x[0].toLowerCase()} ${p1(x[1] * 100)}%`).join(', ');
    out.notes.push(`The odds put "${ev.labels[top]}" at ${p1(ev.p[top] * 100)}%` + (rest ? `; ${rest}.` : '.') +
      ' No swaps-market feed is wired, so there is nothing to compare against and nothing to trade.');
    return;
  }
  const m = moments(ev.edges, ev.p);
  const lo = quantileOf(ev.edges, ev.p, 0.15), hi = quantileOf(ev.edges, ev.p, 0.85);
  const tails = {
    low: { threshold: r2(lo), pModel: 0.15, pOptions: null, z: invNorm(0.15) },
    high: { threshold: r2(hi), pModel: 0.15, pOptions: null, z: invNorm(0.85) },
  };
  for (const t of Object.values(tails)) {
    t.gapPp = null; t.spxMove = r2(ev.kernels.spx * t.z); t.rateMove = r2(ev.kernels.rate2y * t.z);
  }
  Object.assign(out, { mean: r2(m.mean), sd: Math.round(m.sd * 1000) / 1000, skew: r2(m.skew), tails });
  out.notes.push(`The odds center on ${p1(m.mean)}${ev.unit} (spread ${Math.round(m.sd * 100) / 100}${ev.unit}); ` +
    `a ${out.tailWords.low} print means ${p1(lo)}${ev.unit} or lower, ${out.tailWords.high} means ${p1(hi)}${ev.unit} or higher. ` +
    'No consensus or options feed is wired, so there is nothing to compare against and nothing to trade.');
}

// Rate move per outcome bucket [Cut 0.50+, Cut 0.25, Hold, Hike], in bp.
const MOVES_BP = [-50, -25, 0, 25];

/**
 * Compare two distributions over the same meeting by their expected rate move.
 * That uses every outcome, so a market leaning toward a 50bp cut counts for
 * more than one leaning toward 25bp.
 */
function analyseDiscrete(ev, out) {
  const ref = ev.reference.ois;
  const label = ev.reference.label || 'swaps market';
  const em = ev.p.reduce((s, p, k) => s + p * MOVES_BP[k], 0);
  const er = ref.reduce((s, p, k) => s + p * MOVES_BP[k], 0);
  const gap = em - er;
  const net = Math.abs(gap) - COST.rateRoundTrip;
  let i = 0;
  for (let k = 1; k < ev.p.length; k++) if (Math.abs(ev.p[k] - ref[k]) > Math.abs(ev.p[i] - ref[i])) i = k;
  Object.assign(out, {
    focus: { label: ev.labels[i], market: r2(ev.p[i] * 100), reference: r2(ref[i] * 100), gapPp: r2((ev.p[i] - ref[i]) * 100) },
    expectedMoveBp: { market: r2(em), reference: r2(er) },
    direction: { rateBp: r2(Math.abs(gap)), netBp: r2(net), sign: Math.sign(gap) },
    referenceProbs: ref, referenceLabel: label,
    verdict: net > COST.directionMinNetBp ? 'direction' : 'none',
  });
  const show = (ps) => ev.labels.map((l, k) => [l, ps[k]]).filter((x) => x[1] >= 0.02)
    .map((x) => `${x[0].toLowerCase()} ${p1(x[1] * 100)}%`).join(', ');
  const sign = (x) => (x >= 0 ? '+' : '−') + Math.abs(r2(x));
  out.notes.push(`The odds: ${show(ev.p)}. ${label[0].toUpperCase() + label.slice(1)}: ${show(ref)}. ` +
    `Expected move ${sign(em)}bp against ${sign(er)}bp, a ${r2(Math.abs(gap))}bp gap against ` +
    `${COST.rateRoundTrip}bp to trade` + (out.verdict === 'none' ? ': too thin to act on.' : '.'));
}

function analyseContinuous(ev, out) {
  const m = moments(ev.edges, ev.p);
  const ref = ev.reference;
  const words = out.tailWords;
  const pLow = cdfAt(ev.edges, ev.p, ref.lowThreshold);
  const pHigh = 1 - cdfAt(ev.edges, ev.p, ref.highThreshold);
  const tails = {
    low: { threshold: ref.lowThreshold, pModel: pLow, pOptions: ref.optLow, z: invNorm(pLow) },
    high: { threshold: ref.highThreshold, pModel: pHigh, pOptions: ref.optHigh, z: invNorm(1 - pHigh) },
  };
  for (const t of Object.values(tails)) {
    t.gapPp = r2((t.pModel - t.pOptions) * 100);
    t.spxMove = r2(ev.kernels.spx * t.z);
    t.rateMove = r2(ev.kernels.rate2y * t.z);
    t.pModel = r2(t.pModel * 100) / 100;
  }

  const gapZ = (m.mean - ref.consensus) / m.sd;
  const rateBp = Math.abs(gapZ * ev.kernels.rate2y);
  const direction = { meanGapZ: r2(gapZ), rateBp: r2(rateBp), netBp: r2(rateBp - COST.rateRoundTrip) };

  // The cheap tail is the one where the model sees more mass than options charge for.
  const cheap = [tails.low, tails.high].sort((x, y) => y.gapPp - x.gapPp)[0];
  const side = cheap === tails.low ? 'low' : 'high';

  Object.assign(out, {
    mean: r2(m.mean), sd: Math.round(m.sd * 1000) / 1000, skew: r2(m.skew), consensus: ref.consensus,
    sigmaVsTrailing: r2(m.sd / ref.trailSigma), tails, direction,
  });

  if (cheap.gapPp >= COST.shapeThresholdPp) {
    out.verdict = 'shape'; out.side = side;
    out.notes.push(`${ref.optUnderlying} options price a ${words[side]} print at ${p1(cheap.pOptions * 100)}%; ` +
      `the de-arbitraged odds put it at ${p1(cheap.pModel * 100)}%.`);
  } else if (direction.netBp > COST.directionMinNetBp) {
    out.verdict = 'direction';
    out.notes.push(`The odds average ${r2(m.mean)}${ev.unit} against a ${ref.consensus}${ev.unit} ` +
      `consensus: ${direction.rateBp}bp of drift on the two-year against ${COST.rateRoundTrip}bp to trade.`);
  } else if (direction.netBp > 0) {
    out.notes.push(`The odds lean ${r2(m.mean)}${ev.unit} against a ${ref.consensus}${ev.unit} consensus, ` +
      `worth ${direction.rateBp}bp on the two-year: above the ${COST.rateRoundTrip}bp cost, too thin to act on.`);
  } else {
    out.notes.push('Odds, consensus and options agree within costs.');
  }
  const rich = side === 'low' ? tails.high : tails.low;
  if (rich.gapPp <= -COST.shapeThresholdPp) {
    out.richTail = side === 'low' ? 'high' : 'low';
    out.notes.push(`Options price a ${words[out.richTail]} print at ${p1(rich.pOptions * 100)}% against odds of ` +
      `${p1(rich.pModel * 100)}%: a poor week to buy protection against it.`);
  }
}

/* ------------------------------------------------------ exposure model */
// Each holding gets an equity beta and a rate duration. Price move per unit of
// event surprise = beta * (index move per z) - duration * (2y bp move per z) / 100.

const BUCKETS = {
  broad_equity:          { beta: 1.00, duration: 0,     proxy: 'SPY', label: 'Broad US equity' },
  growth_tech:           { beta: 1.30, duration: 0,     proxy: 'QQQ', label: 'Large-cap growth' },
  high_beta_tech:        { beta: 1.80, duration: 0,     proxy: 'QQQ', label: 'High-beta tech' },
  small_cap:             { beta: 1.20, duration: 0,     proxy: 'IWM', label: 'Small caps' },
  financials:            { beta: 1.10, duration: -2.0,  proxy: 'XLF', label: 'Financials' },
  rate_sensitive_equity: { beta: 0.70, duration: 6.0,   proxy: 'XLU', label: 'Rate-sensitive equity' },
  defensive:             { beta: 0.60, duration: 2.0,   proxy: 'SPY', label: 'Defensive' },
  energy:                { beta: 0.90, duration: 0,     proxy: 'XLE', label: 'Energy' },
  long_bond:             { beta: 0,    duration: 16.5,  proxy: 'TLT', label: 'Long Treasuries' },
  intermediate_bond:     { beta: 0,    duration: 7.5,   proxy: 'IEF', label: 'Intermediate Treasuries' },
  short_bond:            { beta: 0,    duration: 1.9,   proxy: 'SHY', label: 'Short Treasuries' },
  aggregate_bond:        { beta: 0,    duration: 6.0,   proxy: 'AGG', label: 'Aggregate bonds' },
  gold:                  { beta: 0.10, duration: 3.0,   proxy: 'GLD', label: 'Gold' },
  crypto_related:        { beta: 2.20, duration: 0,     proxy: 'QQQ', label: 'Crypto-linked' },
  other:                 { beta: 1.00, duration: 0,     proxy: 'SPY', label: 'Unclassified' },
};

const TICKER_BUCKET = {
  SPY: 'broad_equity', VOO: 'broad_equity', VTI: 'broad_equity', IVV: 'broad_equity', DIA: 'broad_equity',
  QQQ: 'growth_tech', QQQM: 'growth_tech', AAPL: 'growth_tech', MSFT: 'growth_tech', GOOGL: 'growth_tech',
  GOOG: 'growth_tech', AMZN: 'growth_tech', META: 'growth_tech', NFLX: 'growth_tech', AVGO: 'growth_tech',
  NVDA: 'high_beta_tech', AMD: 'high_beta_tech', TSLA: 'high_beta_tech', PLTR: 'high_beta_tech',
  ARKK: 'high_beta_tech', SMH: 'high_beta_tech', SOXX: 'high_beta_tech', TQQQ: 'high_beta_tech',
  IWM: 'small_cap', VB: 'small_cap',
  JPM: 'financials', BAC: 'financials', WFC: 'financials', GS: 'financials', MS: 'financials',
  C: 'financials', XLF: 'financials', SCHW: 'financials', KRE: 'financials',
  HOOD: 'crypto_related', COIN: 'crypto_related', MSTR: 'crypto_related', IBIT: 'crypto_related',
  O: 'rate_sensitive_equity', VNQ: 'rate_sensitive_equity', XLU: 'rate_sensitive_equity',
  NEE: 'rate_sensitive_equity', XLRE: 'rate_sensitive_equity',
  KO: 'defensive', PG: 'defensive', JNJ: 'defensive', WMT: 'defensive', COST: 'defensive',
  XLP: 'defensive', PEP: 'defensive', MCD: 'defensive', 'BRK.B': 'defensive', 'BRK-B': 'defensive',
  XOM: 'energy', CVX: 'energy', XLE: 'energy', OXY: 'energy',
  TLT: 'long_bond', EDV: 'long_bond', ZROZ: 'long_bond', VGLT: 'long_bond',
  IEF: 'intermediate_bond', VGIT: 'intermediate_bond',
  SHY: 'short_bond', SGOV: 'short_bond', BIL: 'short_bond', VGSH: 'short_bond',
  BND: 'aggregate_bond', AGG: 'aggregate_bond',
  GLD: 'gold', IAU: 'gold',
};

// Index and Treasury ETFs list daily or weekly options, and their price on a
// release day is dominated by the release. Single-stock options price the
// stock's own volatility, so an event view goes through one of these instead.
const OPTION_PROXIES = new Set(['SPY', 'QQQ', 'IWM', 'TLT', 'IEF', 'XLF', 'XLU', 'XLE', 'GLD']);
const DAILY_EXPIRY = new Set(['SPY', 'QQQ', 'IWM']);

function bucketOf(sym, overrides) {
  const s = String(sym || '').toUpperCase();
  return (overrides && overrides[s]) || TICKER_BUCKET[s] || null;
}

function movePerZ(bucket, kernels) {
  const b = BUCKETS[bucket] || BUCKETS.other;
  return b.beta * kernels.spx - b.duration * kernels.rate2y / 100;
}

/* ---------------------------------------------------- the trade plan */
// Options-implied tail probabilities are known for one underlying (the index),
// so a shape edge can only be traded there. One spread per event, sized to the
// portfolio's net exposure in that tail - not one tiny spread per holding.

function strikeStep(px) { return px < 25 ? 0.5 : px < 200 ? 1 : 5; }
function roundStrike(x, step) { return Math.round(x / step) * step; }

function nextExpiry(dateStr, sym) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (!DAILY_EXPIRY.has(sym)) {
    while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

/** Dollar move of each holding if each tail of a continuous event happens. */
function impacts(holdings, sig) {
  if (!sig.tails) return [];
  return holdings.map((h) => {
    const per = movePerZ(h.bucket, sig.kernels);
    const row = { holding: h.symbol, value: r2(h.value) };
    for (const [side, t] of Object.entries(sig.tails)) {
      const pct = per * t.z;
      row[side] = { pct: r2(pct), dollars: r2(h.value * pct / 100) };
    }
    return row;
  });
}

function shapeOrder(holdings, sig, prices) {
  const side = sig.side, t = sig.tails[side];
  const und = sig.reference.optUnderlying;
  const spot = prices[und];
  if (!spot) return { skipped: `No price for ${und}.` };

  const mU = movePerZ(TICKER_BUCKET[und] || 'broad_equity', sig.kernels) * t.z;  // % move of the underlying at the threshold
  if (Math.abs(mU) < 0.05) return { skipped: `${und} barely moves on this release.` };

  // Each holding expressed as underlying-equivalent notional: value * (its move / the underlying's move).
  const contrib = holdings.map((h) => ({
    holding: h.symbol,
    notional: h.value * (movePerZ(h.bucket, sig.kernels) * t.z) / mU,
    pnlAtThreshold: h.value * movePerZ(h.bucket, sig.kernels) * t.z / 100,
  }));
  const net = contrib.reduce((s, c) => s + c.notional, 0);
  if (Math.abs(net) < 1) return { skipped: 'The portfolio has no net exposure to this tail.' };

  // The cheap tail pays a buyer in the underlying's direction of travel there.
  const right = mU > 0 ? 'call' : 'put';
  const kind = (net > 0) ? 'lean_in' : 'hedge';
  const step = strikeStep(spot);
  const kLong = roundStrike(spot * (1 + 0.5 * mU / 100), step);
  let kShort = roundStrike(spot * (1 + 1.5 * mU / 100), step);
  if (kShort === kLong) kShort = kLong + (right === 'call' ? step : -step);
  const width = Math.abs(kShort - kLong);

  const maxDebit = r2(t.pModel * width * (1 - COST.optionRoundTrip));  // the model's fair value, less costs
  const estCost = r2(Math.max(0.01, t.pOptions * width));               // what options should charge
  if (maxDebit <= estCost) return { skipped: 'After costs the spread is not cheaper than the odds imply.' };

  const exposed = Math.abs(net);
  let contracts;
  if (kind === 'hedge') {
    const loss = Math.abs(contrib.reduce((s, c) => s + c.pnlAtThreshold, 0));
    contracts = Math.min(Math.round(loss / (0.5 * width * 100)),
      Math.floor(exposed * COST.hedgeBudget / (estCost * 100)));
  } else {
    contracts = Math.floor(exposed * COST.leanBudget / (estCost * 100));
  }
  if (contracts < 1) {
    return { skipped: `One ${und} spread costs about $${r2(estCost * 100)}; the portfolio's ` +
      `$${Math.round(exposed).toLocaleString('en-US')} of exposure to this tail does not justify it.` };
  }

  const sign = Math.sign(net);
  const covers = contrib.filter((c) => Math.sign(c.notional) === sign && Math.abs(c.notional) >= 1)
    .map((c) => ({ holding: c.holding, share: r2(c.notional / net) }))
    .sort((a, b) => b.share - a.share);
  const expiry = nextExpiry(sig.date, und);

  return {
    id: `${sig.id}:${kind}:${und}`,
    kind, event: sig.id, eventName: sig.name, eventDate: sig.date,
    instrument: 'option_spread', underlying: und, underlyingPrice: r2(spot),
    legs: [
      { action: 'BUY', type: right, strike: kLong, expiry, qty: contracts },
      { action: 'SELL', type: right, strike: kShort, expiry, qty: contracts },
    ],
    orderType: 'limit', limitPerShare: estCost, maxDebitPerShare: maxDebit,
    premiumAtRisk: r2(contracts * estCost * 100),
    maxPayout: r2(contracts * width * 100),
    expectedValue: r2(contracts * (t.pModel * width * (1 - COST.optionRoundTrip) - estCost) * 100),
    tail: { side, threshold: t.threshold, pModel: t.pModel, pOptions: t.pOptions, gapPp: t.gapPp },
    underlyingMoveAtThreshold: r2(mU),
    exposedNotional: r2(exposed), budgetShare: r2(contracts * estCost * 100 / exposed * 100),
    covers,
  };
}

/**
 * The whole plan: executable orders (portfolio level) plus, for every holding,
 * what each upcoming release does to it and what - if anything - to do.
 */
function plan(holdings, signals, prices) {
  const eq = holdings.filter((h) => h.type === 'equity' && h.price && h.units);
  const orders = [], skipped = [];
  const perHolding = Object.fromEntries(eq.map((h) => [h.symbol, { holding: h.symbol, impacts: [], roles: [] }]));

  for (const sig of signals) {
    for (const row of impacts(eq, sig)) {
      perHolding[row.holding].impacts.push({
        event: sig.id, eventName: sig.short, date: sig.date, low: row.low, high: row.high,
        lowWord: sig.tailWords.low, highWord: sig.tailWords.high,
        lowAt: sig.tails.low.threshold, highAt: sig.tails.high.threshold, unit: sig.unit,
      });
    }

    if (sig.verdict === 'shape') {
      const o = shapeOrder(eq, sig, prices);
      if (o.skipped) skipped.push({ event: sig.id, reason: o.skipped });
      else {
        o.eventShort = sig.short; o.tail.word = sig.tailWords[o.tail.side];
        orders.push(o);
        // A lean-in adds to these holdings' upside in the tail; only a hedge protects them.
        for (const c of o.covers) {
          perHolding[c.holding].roles.push({ kind: o.kind === 'hedge' ? 'protected' : 'sized_on',
            order: o.id, event: sig.id, share: c.share });
        }
      }
    } else if (sig.verdict === 'direction') {
      skipped.push({ event: sig.id, reason: sig.notes[0] });
    }

    if (sig.richTail) {
      const t = sig.tails[sig.richTail];
      for (const h of eq) {
        const pct = movePerZ(h.bucket, sig.kernels) * t.z;
        if (pct < -0.1) {
          perHolding[h.symbol].roles.push({ kind: 'avoid', event: sig.id,
            reason: `Protection against a ${sig.tailWords[sig.richTail]} ${sig.short} costs as if it were ` +
              `${p1(t.pOptions * 100)}% likely; the odds say ${p1(t.pModel * 100)}%.` });
        }
      }
    }
  }

  for (const ph of Object.values(perHolding)) {
    ph.decision = ph.roles.some((r) => r.kind === 'sized_on' || r.kind === 'protected') ? 'in_order'
      : ph.roles.some((r) => r.kind === 'avoid') ? 'avoid' : 'hold';
    // The move at the edge of the tail, not a floor: prints beyond the edge move more.
    let edge = null;
    for (const i of ph.impacts) {
      for (const side of ['low', 'high']) {
        if (!edge || i[side].dollars < edge.dollars) {
          edge = { dollars: i[side].dollars, pct: i[side].pct, event: i.event, eventName: i.eventName,
            word: side === 'low' ? i.lowWord : i.highWord, at: side === 'low' ? i.lowAt : i.highAt,
            side, unit: i.unit };
        }
      }
    }
    ph.tailEdge = edge;
  }
  return { orders, skipped, perHolding: Object.values(perHolding) };
}

module.exports = {
  analyseEvent, plan, impacts, movePerZ, bucketOf, invNorm, moments, cdfAt,
  BUCKETS, TICKER_BUCKET, OPTION_PROXIES, COST,
};
