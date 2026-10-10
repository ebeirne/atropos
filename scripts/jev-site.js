// Jev words the whole site, landing page and console, under the new name.
// Same method as jev-copy.js: short candidates per slot, Jev scores each for
// plainness (score, 0..2 on three anchors) and checks it against the product
// facts (noul). The clearest line that passes wins; if none passes, clarity
// times accuracy decides.
//
//   node scripts/jev-site.js     -> prints the table, writes data/site-copy.json
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs');
const path = require('path');
const jev = require('../lib/jev');

const FACTS = [
  'The product is called Atropos.',
  'It reads prediction-market odds (Kalshi when reachable, otherwise Limitless or Futuur; it surveys every venue it can reach and shows them side by side) for three US releases: the inflation report (CPI), the Fed rate decision and the jobs report.',
  'It strips the betting margin out of the odds and fixes brackets that contradict each other.',
  'It compares those odds with what SPY index options and fed funds futures imply for the same outcomes.',
  'It links Robinhood or Fidelity through SnapTrade, read-only. It cannot place, change or cancel orders; the user places any trade themselves at their broker.',
  'For each release it suggests at most one SPY option spread (buy one strike, sell another), sized to the whole portfolio, and only when options price an outcome differently enough to cover costs. Most weeks it suggests nothing.',
  'For each holding it shows how much the holding could move in dollars if a release prints soft or hot.',
  'Every strike, size and price comes from code. Claude Sonnet writes the plain explanation when connected (otherwise a plain-text writer does); Jev checks each sentence against the numbers.',
  'An order shows: dollars at risk (the most you can lose), the most it pays, and the expected value.',
  'It runs on the user\'s own machine; keys and positions stay there. It is not investment advice and does not know the user\'s goals or taxes.',
  'It has a news desk: the user types any topic, an agent gathers recent articles from public news feeds (and Claude web search when connected), and Jev ranks them and tags which release each bears on.',
  'Its weakest assumption is how far the market moves for a given surprise, estimated from a short history of past releases.',
  'Research: a Federal Reserve working paper (Diercks, Katz & Wright 2026) found Kalshi\'s Fed odds called every meeting it studied the day before.',
  'Research: Valentin (2026) found prediction markets were often right before company news, but stocks moved about as fast, so trading on them rarely paid.',
  'Research: what has paid in prediction markets is structure, such as overpriced longshots and prices that do not add up across outcomes or venues (Bürgi, Deng & Whelan; IMDEA Networks 2025).',
];

// Slots that are not explanations are judged on their own job.
const JOB = {
  cta: 'It is a button label that opens the console. How clearly does it say what clicking does?',
  run: 'It is the console button that fetches this week\'s odds and recomputes the orders. How clearly does it say what clicking does?',
  copy_order: 'It is a button that copies the order text to the clipboard. How clearly does it say that?',
  odds_head: 'It is the heading over this week\'s odds ladders. How clearly does it say what is shown?',
  orders_head: 'It is the console heading over the suggested orders. How clearly does it name the section?',
  orders_note: 'It is a small label under the orders heading. How clearly does it say who places the orders?',
  holdings_head: 'It is the console heading over the user\'s holdings and how each could move. How clearly does it name the section?',
  console_odds_head: 'It is the console heading over the odds the orders were computed from. How clearly does it name the section?',
  ticker: 'It is the small label at the start of a market-data strip of this week\'s odds. How clearly does it say what the strip shows?',
  empty: 'It is the big line shown when there are no orders this week. How clearly does it say that?',
  why_h: 'It is a small heading over the reason for an order.',
  risk_h: 'It is a small heading over what the user can lose on an order.',
  wrong_h: 'It is a small heading over what would make the order wrong.',
  f_risk: 'It is a short label over the dollars the user can lose on an order.',
  f_pays: 'It is a short label over the most dollars an order can pay.',
  f_ev: 'It is a short label over the expected value of an order in dollars.',
  v_shape: 'It is a status chip shown when options price an outcome differently from the odds, enough to trade.',
  v_none: 'It is a status chip shown when the odds and the other prices agree and there is nothing to do.',
  v_unpriced: 'It is a status chip shown when live odds exist but there is no other price to compare them with.',
  v_thin: 'It is a status chip shown when the market has too little money or too wide a spread to be trusted.',
  v_direction: 'It is a status chip shown when the odds lean against consensus, but the edge is small.',
  h_in: 'It is a chip on a holding that the suggested order is sized against.',
  h_avoid: 'It is a chip on a holding where buying protective puts would cost more than it is worth.',
  h_hold: 'It is a chip on a holding where nothing needs doing.',
  note_sample: 'It is a notice that a sample portfolio is shown until a brokerage is linked, and that the broker password is entered on SnapTrade\'s page.',
  note_writer: 'It is a notice that Claude Sonnet is not connected, so a plain-text writer explains the orders and the numbers are unchanged.',
  note_static: 'It is a notice on the static preview: sample portfolio and dated odds; linking needs the local server.',
  footer: 'It is the footer disclaimer.',
  news_head: 'It is the heading over a search box where the user types any topic and an agent finds recent news articles on it, ranked, with the economic release each bears on. How clearly does it name that section?',
  news_hint: 'It is the placeholder text inside that news search box. How clearly does it invite the user to type any topic?',
  venues_head: 'It is the heading over a table that shows the same release priced on every prediction market we can reach (Kalshi, Limitless, Futuur, and fed funds futures), side by side, with which venues were blocked. How clearly does it name that table?',
  venues_gap: 'It is a short label before a number: how many percentage points apart the venues are on the same outcome. How clearly does it say that?',
  board_head: 'It is the heading over a row of big quote tiles, one per economic release, each showing the likeliest outcome, its odds and how far the odds moved. How clearly does it name that board?',
  tile_top: 'It is a small label above the likeliest outcome on each quote tile. How clearly does it say what the big number is?',
  limit1: 'It is one of three short lines naming what the product cannot do or where it is weakest. How plainly does it say that limit?',
  limit2: 'It is one of three short lines naming what the product cannot do or where it is weakest. How plainly does it say that limit?',
  limit3: 'It is one of three short lines naming what the product cannot do or where it is weakest. How plainly does it say that limit?',
  close: 'It is the last line before the final button, reassuring the user about privacy and safety.',
};

const SLOTS = {
  hero: ['See what the market expects before it happens.', 'Know the odds before the number.', 'What the market expects, before the number prints.'],
  hero_sub: ['Reads the odds. Checks your holdings. Suggests one trade, or none.',
    'Prediction-market odds, checked against your portfolio. One trade, or none.',
    'Odds on inflation, the Fed and jobs, matched to what you own.'],
  cta: ['Check my portfolio', 'Open the console', 'See this week'],
  step1: ['Read the odds. What traders are betting on inflation, the Fed and jobs.', 'Read the odds. Live prices on every outcome of each release.'],
  step2: ['Check what you own. Read-only access to your brokerage, nothing more.', 'Check what you own. See how each release could move each holding.'],
  step3: ['Get one trade, or none. You place it yourself, if you want it.', 'Get one trade, or none. Only when two prices disagree.'],
  why1: ['Markets called every Fed meeting in one Fed study.', 'In a Fed study, the odds called every Fed meeting the day before.'],
  why2: ['They rarely beat stocks to the news.', 'Stocks usually move just as fast.'],
  why3: ['The edge is two prices that disagree.', 'So we trade disagreement, not forecasts.'],
  odds_head: ['What the market expects this week', 'This week\'s odds', 'The odds, this week'],
  ticker: ['This week', 'Odds this week', 'Market odds'],
  limit1: ['Read-only. You place every trade.', 'It cannot trade for you.'],
  limit2: ['It sees positions, not your goals or taxes.', 'It does not know your goals or taxes.'],
  limit3: ['Its weakest step: turning a surprise into a price move.', 'Move estimates rest on a short history.'],
  close: ['Local and read-only. Your keys never leave your computer.', 'Runs on your machine. Your keys stay with you.'],
  footer: ['Not investment advice.', 'Not investment advice. Read-only brokerage access.'],
  run: ['Read the week', 'Refresh', 'Check this week'],
  copy_order: ['Copy order', 'Copy', 'Copy to clipboard'],
  orders_head: ['Orders', 'Suggested orders', 'This week\'s trade'],
  orders_note: ['You place these yourself, at your broker', 'Placed by you, at your broker', 'Nothing is placed for you'],
  holdings_head: ['Your holdings', 'What you own', 'Holdings'],
  console_odds_head: ['The odds behind it', 'The odds', 'Where the numbers come from'],
  empty: ['No orders this week.', 'Nothing to trade this week.', 'No trade this week.'],
  why_h: ['Why', 'Why this trade', 'The reason'],
  risk_h: ['What you can lose', 'Risk', 'Worst case'],
  wrong_h: ['What would make it wrong', 'When it fails', 'What breaks it'],
  f_risk: ['At risk', 'Max loss', 'You can lose'],
  f_pays: ['Most it pays', 'Max payout', 'Best case'],
  f_ev: ['Expected', 'Expected value', 'On average'],
  v_shape: ['Options mispriced', 'Prices disagree', 'Worth a trade'],
  v_none: ['Nothing to do', 'Prices agree', 'No edge'],
  v_unpriced: ['Nothing to compare', 'No reference price', 'Live, unpriced'],
  v_thin: ['Too thin', 'Too thin to trust', 'Thin market'],
  v_direction: ['Lean, thin', 'Small lean', 'Slight edge'],
  h_in: ['In the order', 'Sized in', 'Covered by the order'],
  h_avoid: ['Skip the puts', 'Puts cost too much', 'No hedge'],
  h_hold: ['Hold', 'No change', 'Nothing to do'],
  note_sample: ['Shown until you link a brokerage. You sign in on SnapTrade\'s page; Atropos never sees your password.',
    'A sample portfolio until you link one. Your password goes to SnapTrade, never here.'],
  note_writer: ['Sonnet is not connected, so a plain-text writer explains. The numbers are the same.',
    'Plain-text explanations: Sonnet is not connected. Numbers unchanged.'],
  note_static: ['Sample portfolio and dated odds. Linking a brokerage needs the local server.',
    'A preview with sample data. Run Atropos locally to link your brokerage.'],
};

async function judge(slot, lines) {
  const questions = {};
  lines.forEach((text, i) => {
    questions[`clear_${i}`] = {
      type: 'score',
      instructions: `Website text for the "${slot}" spot: "${text}". ` + (JOB[slot] ||
        'How plainly and quickly does it tell someone who has never traded what this product does or why it matters?') +
        ' Fewer words and no jargon score higher.',
      criteria: ['confusing, jargon-heavy or wordy', 'understandable with some effort', 'instantly clear in very few plain words'],
    };
    questions[`true_${i}`] = {
      type: 'noul',
      instructions: `Website text: "${text}". Is everything it claims supported by the product facts?`,
      criteria: {
        yes: 'Every claim is supported by the facts, or it makes no factual claim.',
        no: 'It claims something the facts contradict or do not support, such as placing trades for the user or predicting numbers.',
      },
    };
  });
  const out = await jev.ask({ product_facts: FACTS }, questions);
  const rows = lines.map((text, i) => ({
    text,
    clear: Math.round(out.answers[`clear_${i}`].score * 100) / 100,
    accurate: Math.round(out.answers[`true_${i}`].noul * 100) / 100,
  }));
  const ok = rows.filter((r) => r.accurate >= 0.5);
  const pick = ok.length ? ok.slice().sort((a, b) => b.clear - a.clear)[0]
    : rows.slice().sort((a, b) => b.clear * b.accurate - a.clear * a.accurate)[0];
  return { pick: pick.text, passed: ok.length > 0, rows, latency_ms: out.latency_ms };
}

module.exports = { judge, FACTS };
if (require.main === module) (async () => {
  if (!jev.configured()) { console.error('TYPESAFE_API_KEY is not set'); process.exit(1); }
  const result = { judged_at: new Date().toISOString(), name: 'Horizon Desk', slots: {} };
  for (const [slot, lines] of Object.entries(SLOTS)) {
    const r = await judge(slot, lines);
    result.slots[slot] = r;
    console.log(`\n${slot}${r.passed ? '' : '  (none passed the facts check)'}`);
    for (const row of r.rows) console.log(`  ${row.text === r.pick ? '>' : ' '} clear ${row.clear.toFixed(2)}  true ${row.accurate.toFixed(2)}  ${row.text}`);
  }
  const out = path.join(__dirname, '..', 'data', 'site-copy.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log('\nwrote', out);
})().catch((e) => { console.error(e.message, e.detail ? JSON.stringify(e.detail).slice(0, 500) : ''); process.exit(1); });
