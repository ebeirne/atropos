// Jev on the redesign: the name and the design choices. Jev does not invent;
// it judges the options it is given against a brief and the product facts.
//
//   node scripts/jev-design.js     -> prints the table, writes data/design.json
//
// Names are scored on four questions (fit with the art, credibility with a
// hedge fund, simplicity, and whether it overpromises). Design choices are
// asked three times each and the probabilities averaged, because Jev's `choice`
// answers wobble when two options are close.
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs');
const path = require('path');
const jev = require('../lib/jev');

const FACTS = [
  'The product reads prediction-market odds for three US releases (inflation, the Fed decision, jobs), strips the betting margin, and compares them with what SPY options and fed funds futures imply.',
  'It links Robinhood or Fidelity read-only and suggests at most one SPY option spread per release, sized to the portfolio. Most weeks it suggests nothing. The user places any trade.',
  'Its principle is to measure disagreement between two prices for the same outcome, not to forecast numbers.',
  'The audience is a hedge-fund sponsor judging a hackathon, and the traders who would use it.',
];
const BRIEF = [
  'The site opens on a woman in profile made of tiny dust characters, looking at a small light that stands on a horizon; the dust blows away in the wind as you scroll and stars float down the page.',
  'Headline: "See what the market expects before it happens."',
  'A partner wants the design more aligned with the financial world while keeping this overall look, the type simple and readable, and the charts shown in a better way than the current full-width Chinese-character charts.',
];

const NAMES = process.argv.includes('--fates') ? {
  'Atropos': 'the Fate who cuts the thread: the outcome that cannot be turned aside',
  'Lachesis': 'the Fate who measures the thread: allots each life its length',
  'Clotho': 'the Fate who spins the thread: where every outcome begins',
  'Moira': 'fate itself, the share allotted to each',
  'Horizon Desk': 'the current name: the horizon in the art, plus a trading desk',
} : {
  'Prior Desk': 'current name: a statistical prior, plus a trading desk',
  'Horizon': 'the horizon line in the art; also an investment horizon',
  'Lantern': 'the small light the face looks toward',
  'Bellwether': 'a market term for an asset that leads the rest',
  'Vantage': 'a point from which to see ahead',
  'Foresight': 'seeing what comes next',
  'Lodestar': 'a guiding star',
  'Horizon Desk': 'the horizon in the art, plus a trading desk',
};

const DESIGN = {
  charts: {
    question: 'How should the odds, the exposure and the sizing be shown on the site?',
    options: {
      ladder: 'A probability ladder: each outcome is a row with its label, a thin bar and a tabular percentage, like an order book or depth ladder on a trading screen.',
      curve: 'A smooth distribution curve drawn as a line chart with axis ticks.',
      cjk: 'Full-width Chinese-character text charts (the current design).',
      ranges: 'Range bars like a candlestick chart, one per release.',
    },
  },
  headline_face: {
    question: 'Which typeface should the big headlines use?',
    options: {
      grotesk: 'Geist, a clean neo-grotesk sans-serif (the current choice).',
      serif: 'A financial-press serif such as Newsreader, in the spirit of the Financial Times or The Wall Street Journal.',
    },
  },
  body_face: {
    question: 'Which typeface should body text use for readability?',
    options: {
      sans: 'Geist sans-serif at a comfortable size.',
      mono: 'Space Mono, a monospace face (the current choice).',
    },
  },
  numbers: {
    question: 'How should numbers (odds, prices, dollars) be set?',
    options: {
      tabular: 'Geist Mono with tabular figures, so columns of numbers line up like a terminal.',
      body: 'In the body typeface, proportional figures.',
    },
  },
  ticker: {
    question: 'Should the site carry a market-data strip?',
    options: {
      strip: 'Yes: one slim strip with this week\'s key odds, like a market data bar.',
      none: 'No strip; keep the page clean.',
    },
  },
  accent: {
    question: 'What colour system fits?',
    options: {
      signals: 'Monochrome, with green and red used only for gains and losses.',
      gold: 'Monochrome plus a single muted gold accent.',
      navy: 'An institutional navy-blue accent.',
    },
  },
};

async function judgeNames() {
  const questions = {};
  const keys = Object.keys(NAMES);
  keys.forEach((n, i) => {
    const what = `The name "${n}" (${NAMES[n]}).`;
    questions[`art_${i}`] = { type: 'score', instructions: `${what} How well does it fit the site's imagery and headline?`,
      criteria: ['no connection to the imagery', 'loosely connected', 'fits the imagery and the headline closely'] };
    questions[`fin_${i}`] = { type: 'score', instructions: `${what} How credible does it sound as a professional trading or research tool to a hedge fund?`,
      criteria: ['sounds like a toy or a consumer app', 'plausible', 'sounds like a serious institutional product'] };
    questions[`simple_${i}`] = { type: 'score', instructions: `${what} How easy is it to say, spell and remember?`,
      criteria: ['awkward or forgettable', 'fine', 'effortless'] };
    questions[`honest_${i}`] = { type: 'noul', instructions: `${what} Does the name avoid implying that the product predicts the future or promises returns?`,
      criteria: { yes: 'It does not imply prediction or promised returns.', no: 'It implies the product predicts the future or promises returns, against its principle of measuring rather than forecasting.' } };
  });
  const out = await jev.ask({ product_facts: FACTS, brief: BRIEF }, questions);
  const rows = keys.map((n, i) => {
    const a = out.answers;
    const r = { name: n, art: a[`art_${i}`].score, finance: a[`fin_${i}`].score, simple: a[`simple_${i}`].score, honest: a[`honest_${i}`].noul };
    r.total = ((r.art + r.finance + r.simple) / 3) * (r.honest >= 0.5 ? 1 : 0.5);
    for (const k of ['art', 'finance', 'simple', 'honest', 'total']) r[k] = Math.round(r[k] * 100) / 100;
    return r;
  });
  return rows.sort((x, y) => y.total - x.total);
}

async function judgeDesign() {
  const runs = 3, result = {};
  for (let k = 0; k < runs; k++) {
    const questions = {};
    for (const [key, d] of Object.entries(DESIGN)) questions[key] = { type: 'choice', instructions: d.question, criteria: d.options };
    const out = await jev.ask({ product_facts: FACTS, brief: BRIEF }, questions);
    for (const key of Object.keys(DESIGN)) {
      const p = out.answers[key].probabilities || {};
      result[key] = result[key] || {};
      for (const [o, v] of Object.entries(p)) result[key][o] = (result[key][o] || 0) + v / runs;
    }
  }
  const picks = {};
  for (const [key, probs] of Object.entries(result)) {
    const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]);
    picks[key] = { pick: sorted[0][0], probabilities: Object.fromEntries(sorted.map(([o, v]) => [o, Math.round(v * 100) / 100])) };
  }
  return picks;
}

(async () => {
  if (!jev.configured()) { console.error('TYPESAFE_API_KEY is not set'); process.exit(1); }
  const names = await judgeNames();
  console.log('\nNAMES            art   fin   simple honest total');
  for (const r of names) console.log(`  ${r.name.padEnd(14)} ${r.art.toFixed(2)}  ${r.finance.toFixed(2)}  ${r.simple.toFixed(2)}   ${r.honest.toFixed(2)}   ${r.total.toFixed(2)}`);
  if (process.argv.includes('--fates')) { fs.writeFileSync(path.join(__dirname, '..', 'data', 'names-fates.json'), JSON.stringify({ judged_at: new Date().toISOString(), names }, null, 2)); return; }
  const design = await judgeDesign();
  console.log('\nDESIGN');
  for (const [k, v] of Object.entries(design)) console.log(`  ${k.padEnd(14)} -> ${v.pick.padEnd(9)} ${JSON.stringify(v.probabilities)}`);
  const out = path.join(__dirname, '..', 'data', 'design.json');
  fs.writeFileSync(out, JSON.stringify({ judged_at: new Date().toISOString(), names, design }, null, 2));
  console.log('\nwrote', out);
})().catch((e) => { console.error(e.message, e.detail ? JSON.stringify(e.detail).slice(0, 500) : ''); process.exit(1); });
