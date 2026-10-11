// Jev as a second opinion on the console layout sketched in the notebook: an event list with
// probabilities (Basis), capital and holdings in the corner, search and filter, and a click
// through to one event where Atropos says how much to allocate (Kelly).
//   node scripts/jev-console.js   -> data/console-jev.json
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');

const CTX = [
  'Atropos is a hackathon entry for a hedge-fund-sponsored track: prediction markets as economic signals. Basis (an event viewer) gives each prediction-market event a calibrated probability, the basis against the traditional market, and a 0-100 trust score. Atropos is the thinking engine for risk: given a probability and a price it works out dollars at risk and how much of your capital to put on a contract (Kelly criterion), and whether protection paid on the days you actually lost.',
  'The team sketched a console: a header with the product name, a menu (open screener, positions), capital and holdings top right; a search box; a list of events each with its probability and a filter; clicking an event opens its details with the probability, the trade, and Atropos\'s Kelly metrics: how much to allocate and the probability of success.',
  'Users are hedge-fund judges and traders with 30 seconds. The console must be read at a glance, with the fewest elements that still let someone go from "what is likely" to "how much should I put on it". Every number on screen comes from code.',
];
const Q = {
  structure: { type: 'choice', instructions: 'How should the list of events and the detail of one event be arranged?', criteria: {
    drill: 'One column: the list fills the screen; clicking an event replaces it with the detail, with a back link (the sketch).',
    split: 'Two panes side by side: the list on the left stays visible, the chosen event\'s detail on the right.',
    expand: 'One column: clicking an event expands it in place below its row, the others stay.',
  } },
  row: { type: 'choice', instructions: 'What should each event row show besides its name and date?', criteria: {
    p: 'The calibrated probability only.',
    ptrust: 'The calibrated probability and the trust score.',
    pbasis: 'The calibrated probability, the basis (gap to the traditional market) and the trust score.',
    all: 'Raw price, calibrated probability, basis, z and trust, like a table.',
  } },
  sort: { type: 'choice', instructions: 'What order should the list be in by default?', criteria: {
    date: 'Soonest to resolve first.',
    edge: 'Largest edge first: the biggest gap between the calibrated probability and the price, weighted by trust.',
    trust: 'Most trusted first.',
    exposure: 'Largest effect on the user\'s own holdings first.',
  } },
  controls: { type: 'choice', instructions: 'Search and filter: how should they appear?', criteria: {
    one: 'One search box that also understands words like "macro" or "trusted" (no separate filter).',
    chips: 'A search box plus a row of filter chips (category, minimum trust, resolves within).',
    both: 'A search box, a filter dropdown and a sort dropdown.',
  } },
  money: { type: 'choice', instructions: 'Where should capital and holdings live?', criteria: {
    corner: 'Top right of the header, two numbers (the sketch).',
    sidebar: 'A left sidebar with capital, holdings and the open positions.',
    detail: 'Only inside an event\'s detail, next to the allocation it drives.',
  } },
  detailOrder: { type: 'choice', instructions: 'Inside an event\'s detail, what should come first?', criteria: {
    kelly: 'The allocation first: how much to put on it in dollars and as a share of capital, then the probability and the trade, then the reasons.',
    prob: 'The probability first: calibrated vs price vs the traditional market, then the trade, then the allocation.',
    trade: 'The trade first: the contract, venue and price, then the allocation, then the probability.',
  } },
  kelly: { type: 'choice', instructions: 'How should the Kelly figure be shown?', criteria: {
    dollars: 'One dollar figure and one line of why (probability vs price).',
    inputs: 'The dollar figure, the Kelly fraction, and the inputs it used: calibrated probability, price, and the fraction of Kelly (half) applied.',
    slider: 'The dollar figure with a slider from 0 to full Kelly, showing the expected growth and worst case at each setting.',
  } },
  nav: { type: 'choice', instructions: 'The menu for the screener and positions: where?', criteria: {
    hamburger: 'A hamburger menu top left (the sketch).',
    tabs: 'Three plain tabs across the top: Events, Positions, Screener.',
    links: 'Two text links in the header next to the product name.',
  } },
};
(async () => {
  const avg = {};
  for (let i = 0; i < 3; i++) {
    const a = await jev.ask({ context: CTX }, Q);
    for (const k of Object.keys(Q)) for (const [o, p] of Object.entries(a.answers[k].probabilities || {})) { avg[k] = avg[k] || {}; avg[k][o] = (avg[k][o] || 0) + p / 3; }
  }
  const pick = {};
  for (const k of Object.keys(Q)) {
    const ranked = Object.entries(avg[k]).sort((a, b) => b[1] - a[1]);
    pick[k] = { choice: ranked[0][0], text: Q[k].criteria[ranked[0][0]], scores: Object.fromEntries(ranked.map(([o, p]) => [o, Math.round(p * 100) / 100])) };
    console.log(k.padEnd(12), ranked.map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '));
  }
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'console-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), pick }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
