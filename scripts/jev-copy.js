// Jev words the landing page. Jev does not write; it judges. Each slot on the
// page gets a few short candidate lines, and Jev scores every one for how plainly
// it explains the product to someone who has never traded, and checks each against
// the product facts for anything it does not do. The clearest accurate line wins.
//
//   node scripts/jev-copy.js            -> prints the table, writes data/copy.json
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs');
const path = require('path');
const jev = require('../lib/jev');

const FACTS = [
  'Prior Desk reads prediction-market odds (Kalshi when reachable, otherwise Limitless) for three US releases: the inflation report (CPI), the Fed rate decision and the jobs report.',
  'It strips the betting margin out of the odds and fixes brackets that contradict each other.',
  'It compares those odds with what SPY index options and fed funds futures imply for the same outcomes.',
  'It links Robinhood or Fidelity through SnapTrade, read-only. It cannot place, change or cancel orders; the user places any trade themselves.',
  'For each release it suggests at most one SPY option spread, sized to the whole portfolio, and only when options price an outcome differently enough to pay for costs. Most weeks it suggests nothing.',
  'Every strike, size and price comes from code. Claude Sonnet writes the plain explanation; Jev checks each sentence against the numbers.',
  'It runs on the user\'s own machine. It is not investment advice and does not know the user\'s goals or taxes.',
  'Its weakest assumption is how far the market moves for a given surprise in a release, estimated from a short history of past releases.',
  'Research it is built on: a Federal Reserve working paper (Diercks, Katz & Wright 2026) found Kalshi\'s Fed odds called every meeting it studied the day before.',
  'Research: Valentin (2026) found prediction markets were often right before company news, but trading the stock when they looked confident lost on 17 of 22 trades, because stock prices moved about as fast.',
  'Research: what has paid in prediction markets is structure, such as longshots that are overpriced and prices that do not add up across outcomes or venues (Bürgi, Deng & Whelan; IMDEA Networks 2025).',
  'The product therefore measures disagreement between two prices for the same outcome rather than forecasting the numbers.',
];

// Some slots are not explanations, so they are judged on their own job.
const JOB = {
  cta: 'It is a button label. Clicking it opens the console, where the user links a brokerage read-only and sees this week\'s suggested trade, if any. How clearly does the label say what clicking does?',
  odds: 'It is the heading over a chart of this week\'s prediction-market odds for each release. How clearly does it say what the chart shows?',
  close: 'It is the last line before the button, reassuring the user about privacy and safety. How clearly does it say that?',
};

const SLOTS = {
  hero: [
    'Know the odds before the number.',
    'See what the market expects before it happens.',
    'See what the market expects.',
    'Prediction-market odds, turned into one trade or none.',
    'What traders expect, checked against what you own.',
    'The odds on every economic release, read for your portfolio.',
  ],
  hero_sub: [
    'Odds on inflation, the Fed and jobs, checked against your holdings.',
    'Prediction markets price every economic release. We check those odds against what you own.',
    'Reads the odds. Checks your holdings. Suggests one trade, or none.',
    'Live odds on the next inflation print, Fed decision and jobs report, matched to your portfolio.',
    'What traders expect for inflation, the Fed and jobs, checked against what you own.',
    'Odds on the next inflation, Fed and jobs numbers. Matched to what you own. One trade, or none.',
  ],
  cta: ['Open the console', 'See this week', 'Check my portfolio', 'Get started'],
  step1: [
    'Read the odds. What traders are betting on inflation, the Fed and jobs.',
    'Read the odds. Live prediction-market prices, cleaned of the betting margin.',
    'Read the odds. Every possible outcome, with how likely the market thinks it is.',
  ],
  step2: [
    'Check what you own. Link Robinhood or Fidelity, read-only.',
    'Check what you own. See how each release could move each holding.',
    'Check what you own. Read-only access to your brokerage, nothing more.',
  ],
  step3: [
    'Get one trade, or none. Only when options disagree with the odds.',
    'Get one trade, or none. Most weeks, none.',
    'Get one trade, or none. You place it yourself, if you want it.',
  ],
  why1: [
    'Prediction markets forecast the Fed well.',
    'The odds are usually right.',
    'Markets called every Fed meeting in one Fed study.',
  ],
  why2: [
    'They rarely beat stocks to the news.',
    'Being right is not the same as being early.',
    'Stocks usually move just as fast.',
  ],
  why3: [
    'So we trade disagreement, not forecasts.',
    'The edge is two prices that disagree.',
    'We look for prices that do not add up.',
  ],
  odds: ["This week's odds", 'What the market expects this week', 'This week'],
  limit1: ['It never places orders. You do.', 'Read-only. You place every trade.', 'It cannot trade for you.'],
  limit2: ['It sees positions, not your goals or taxes.', 'It does not know your situation.', 'Your goals and taxes are yours to judge.'],
  limit3: ['Its weakest step: turning a surprise into a price move.', 'Distrust the move estimate first.', 'Price-move estimates rest on short history.'],
  close: [
    'Runs on your machine. Your keys stay with you.',
    'Local and read-only. Your keys never leave your computer.',
    'Your keys and positions never leave your machine.',
  ],
};

async function judge(slot, lines) {
  const questions = {};
  lines.forEach((text, i) => {
    questions[`clear_${i}`] = {
      type: 'score',
      instructions: `Website line for the "${slot}" spot: "${text}". ` + (JOB[slot] ||
        'How plainly and quickly does it tell someone who has never traded what this product does or why it matters?') +
        ' Fewer words and no jargon score higher.',
      criteria: ['confusing, jargon-heavy or wordy', 'understandable with some effort', 'instantly clear in very few plain words'],
    };
    questions[`true_${i}`] = {
      type: 'noul',
      instructions: `Website line: "${text}". Is everything it claims supported by the product facts?`,
      criteria: {
        yes: 'Every claim in the line is supported by the facts, or it makes no factual claim.',
        no: 'The line claims something the facts contradict or do not support, such as placing trades for the user or predicting numbers.',
      },
    };
  });
  const out = await jev.ask({ product_facts: FACTS }, questions);
  const rows = lines.map((text, i) => ({
    text,
    clear: Math.round(out.answers[`clear_${i}`].score * 100) / 100,
    accurate: Math.round(out.answers[`true_${i}`].noul * 100) / 100,
  }));
  // score comes back on the anchor index (0..2 with three anchors). The clearest
  // line that passes the facts wins; if none passes, clarity times accuracy.
  const ok = rows.filter((r) => r.accurate >= 0.5);
  const pick = ok.length ? ok.slice().sort((a, b) => b.clear - a.clear)[0]
    : rows.slice().sort((a, b) => b.clear * b.accurate - a.clear * a.accurate)[0];
  return { pick: pick.text, rows, latency_ms: out.latency_ms };
}

(async () => {
  if (!jev.configured()) { console.error('TYPESAFE_API_KEY is not set'); process.exit(1); }
  const result = { judged_at: new Date().toISOString(), model: null, slots: {} };
  for (const [slot, lines] of Object.entries(SLOTS)) {
    const r = await judge(slot, lines);
    result.slots[slot] = r;
    console.log(`\n${slot}  (${r.latency_ms}ms)`);
    for (const row of r.rows) {
      console.log(`  ${row.text === r.pick ? '>' : ' '} clear ${row.clear.toFixed(2)}  true ${row.accurate.toFixed(2)}  ${row.text}`);
    }
  }
  const out = path.join(__dirname, '..', 'data', 'copy.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log('\nwrote', out);
})().catch((e) => { console.error(e.message, e.detail ? JSON.stringify(e.detail).slice(0, 400) : ''); process.exit(1); });
