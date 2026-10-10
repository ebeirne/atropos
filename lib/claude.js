// Claude Sonnet 5.5 decides whether each engine-built order is worth placing and
// explains every holding's position in plain English. It refers to orders by id
// and never writes a strike, price, size or date of its own, so the numbers on
// a ticket are always the engine's.

const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = 'claude-sonnet-5-5';

function configured() { return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN); }

let client = null;
function api() { if (!client) client = new Anthropic(); return client; }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'orders', 'holdings'],
  properties: {
    summary: { type: 'string' },
    orders: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['order_id', 'decision', 'headline', 'rationale', 'risk', 'invalidation', 'confidence'],
        properties: {
          order_id: { type: 'string' },
          decision: { type: 'string', enum: ['place', 'skip'] },
          headline: { type: 'string' },
          rationale: { type: 'string' },
          risk: { type: 'string' },
          invalidation: { type: 'string' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
    holdings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['holding', 'headline', 'note'],
        properties: {
          holding: { type: 'string' },
          headline: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
};

const SYSTEM = `You write the trade notes for Atropos. It reads prediction-market odds on upcoming economic releases, compares them with what index options charge, and checks the person's own brokerage holdings against both.

A deterministic engine has already built everything numeric: the orders, their strikes, sizes and limit prices, and each holding's dollar impact if a release lands in either tail. Your job is judgment and plain English, for a capable retail investor who is not a professional trader.

Orders:
- For each order, decide "place" or "skip". Place it only when its expected value is positive and its premium at risk is small next to the exposure it covers. Skipping is a fine answer; say why.
- An order is one index option spread sized to the whole portfolio's net exposure in a tail, not to any single holding. Explain that the index is used because its options are where the mispricing was measured. "covers" lists the holdings it is sized on: a "hedge" protects them, a "lean_in" adds to their upside in that tail and protects nothing. Never call a lean_in protection.
- Use each event's tail word (tail.word, e.g. "soft" or "hot") rather than "low tail" or "high tail".
- headline: one short sentence. rationale: two to four sentences. risk: what can be lost, in the order's own dollar figures. invalidation: what observable change before the release would make it wrong.

Holdings: write one entry per holding. headline: one sentence on what the upcoming releases mean for it, using tailEdge (the dollar move at the edge of its worst tail; prints further out move it more, so never call it a maximum). note: one or two sentences on what to do, which is usually nothing, or which order it is part of, or why buying protection this week overpays.

Quote only numbers that appear in the input. Never compute or invent a price, strike, probability, size or date. The person places every order themselves; the brokerage connection is read-only. Confidence reflects how far the tail disagreement clears costs.`;

function compactInput(portfolio, signals, planned) {
  return {
    holdings: portfolio.positions.filter((p) => p.type === 'equity').map((p) => ({
      symbol: p.symbol, bucket: p.bucketLabel, value: Math.round(p.value),
    })),
    events: signals.map((s) => ({
      id: s.id, name: s.name, date: s.date, verdict: s.verdict, cheapTail: s.side, notes: s.notes,
      tails: s.tails ? Object.fromEntries(Object.entries(s.tails).map(([k, t]) => [k,
        { printAtOrBeyond: t.threshold, odds: t.pModel, optionsCharge: t.pOptions, gapPp: t.gapPp }])) : undefined,
    })),
    orders: planned.orders,
    skippedEvents: planned.skipped,
    perHolding: planned.perHolding,
  };
}

async function compose(portfolio, signals, planned) {
  const t0 = Date.now();
  const response = await api().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(compactInput(portfolio, signals, planned)) }],
  });

  if (response.stop_reason === 'refusal') {
    const cat = response.stop_details && response.stop_details.category;
    throw new Error('Claude declined the request' + (cat ? ` (${cat})` : ''));
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { throw new Error('Claude returned unparseable JSON'); }
  return {
    ...parsed, model: response.model, latency_ms: Date.now() - t0,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}

/* ---------------------------------------------- deterministic stand-in */
// Used when no Anthropic key is configured, or if the call fails.

const money = (x) => '$' + Math.abs(Math.round(x)).toLocaleString('en-US');
const pct = (p) => Math.round(p * 1000) / 10 + '%';

function writeOrder(o) {
  const [l1, l2] = o.legs;
  const who = o.covers.map((c) => c.holding).join(', ');
  const word = o.tail.word || o.tail.side;
  return {
    order_id: o.id, decision: o.expectedValue > 0 ? 'place' : 'skip',
    headline: `${o.kind === 'hedge' ? 'Protect' : 'Add upside to'} the portfolio for a ${word} ${o.eventShort} ` +
      `on ${o.eventDate}: a ${o.underlying} ${l1.strike}/${l2.strike} ${l1.type} spread.`,
    rationale: `${o.underlying} options price a ${word} ${o.eventShort} at ${pct(o.tail.pOptions)}; the ` +
      `prediction-market odds put it at ${pct(o.tail.pModel)}. One spread, sized to how much ${who} ` +
      `would move together in that case, buys the gap. Pay no more than $${o.maxDebitPerShare} a share; ` +
      `the options should be near $${o.limitPerShare}.`,
    risk: `The most you can lose is the ${money(o.premiumAtRisk)} premium. The most it can pay is ${money(o.maxPayout)}.`,
    invalidation: `The odds of a ${word} print fall back toward ${pct(o.tail.pOptions)} before ${o.eventDate}, ` +
      `or the spread trades above $${o.maxDebitPerShare}.`,
    confidence: o.tail.gapPp >= 6 ? 'medium' : 'low',
  };
}

function writeHolding(ph, orders, signals) {
  const e = ph.tailEdge;
  const role = ph.roles.find((r) => r.kind === 'sized_on' || r.kind === 'protected');
  const avoid = ph.roles.find((r) => r.kind === 'avoid');
  const at = e ? (e.unit === 'k' ? Math.round(e.at) : Math.round(e.at * 10) / 10) : null;
  const headline = e && e.dollars < -1
    ? `A ${e.word} ${e.eventName} (${e.side === 'low' ? 'at or below' : 'at or above'} ${at}${e.unit}) ` +
      `would move ${ph.holding} about ${money(e.dollars)} ${e.dollars < 0 ? 'down' : 'up'}, more if it prints further out.`
    : `${ph.holding} has little at stake in the coming releases.`;
  const blind = (signals || []).some((s) => s.verdict === 'unpriced' || s.verdict === 'thin');
  let note = blind
    ? 'Hold it. The live odds cannot be priced against anything yet, so this is exposure to watch, not a trade.'
    : 'Hold it. Nothing on the calendar is mispriced enough to act on for this position.';
  if (role) {
    const o = orders.find((x) => x.id === role.order);
    note = role.kind === 'protected'
      ? `Protected by the ${o.underlying} spread, which is ${Math.round(role.share * 100)}% sized on this position.`
      : `Part of the ${o.underlying} spread's sizing (${Math.round(role.share * 100)}%): it adds to this position's ` +
        `upside if the ${o.eventShort} prints ${o.tail.word}. It does not protect it.`;
  }
  if (avoid) note += ` ${avoid.reason} Do not buy puts on it this week.`;
  return { holding: ph.holding, headline, note: note.trim() };
}

function composeDeterministic(planned, signals) {
  const orders = planned.orders.map(writeOrder);
  const holdings = planned.perHolding.map((ph) => writeHolding(ph, planned.orders, signals));
  const n = orders.filter((o) => o.decision === 'place').length;
  const blind = (signals || []).filter((s) => s.verdict === 'unpriced' || s.verdict === 'thin');
  let summary;
  if (n === 1) summary = 'One order is worth considering before the next release, sized to the whole portfolio. Otherwise, hold everything.';
  else if (n > 1) summary = `${n} orders are worth considering, each sized to the whole portfolio. Otherwise, hold everything.`;
  else {
    // Say what was actually found: agreement with a live reference is a result too.
    const parts = [];
    const agreed = (signals || []).filter((s) => s.source !== 'sample' && s.expectedMoveBp && s.verdict !== 'direction');
    for (const s of agreed) {
      parts.push(`the ${s.short} odds agree with ${s.referenceLabel} to within ${s.direction.rateBp}bp`);
    }
    const unpriced = blind.filter((s) => !s.expectedMoveBp);
    if (unpriced.length) parts.push(`the ${unpriced.map((s) => s.short).join(' and ')} odds have nothing to price against yet`);
    summary = parts.length
      ? `No orders: ${parts.join(', and ')}. Your exposure is below.`
      : 'Nothing on the calendar is mispriced enough to act on. Hold everything.';
  }
  return { summary, orders, holdings, model: 'deterministic', latency_ms: 0 };
}

module.exports = { configured, compose, composeDeterministic, writeOrder, writeHolding, MODEL };
