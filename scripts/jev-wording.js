// Jev picks the wording across the desk and the research pages (Leaf), from short candidates,
// so the whole site speaks with one voice.   node scripts/jev-wording.js -> data/wording-jev.json
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');

const CTX = [
  'Atropos is a hackathon entry for a hedge-fund-sponsored track: prediction markets as economic signals. Three engines: Basis gives each prediction-market event a calibrated probability, the basis against the traditional market and a 0-100 trust score; Atropos turns odds into dollars at risk and sizes a position (half Kelly); Leaf screens stock pairs for mean reversion, statistical arbitrage and hedging.',
  'The site is black with small white stars and the occasional shooting star; headlines in a light serif (Newsreader), body in a plain sans (Geist), numbers in a mono. The desk lists events biggest trusted edge first, shows one event (calibrated vs price vs real market, the trade, how much to put on it) and the trades you save. The research pages (Leaf) are the same theme in reverse: paper background, dark stars.',
  'The site\'s existing lines: "See what the market expects before it happens." / "Reads the odds. Checks your holdings. Suggests one trade, or none." / "Not investment advice. Read-only brokerage access."',
  'Readers are hedge-fund judges and traders with 30 seconds. Short, plain, confident, no hype, no exclamation marks. Every number on screen comes from code.',
];
const Q = {
  deskTitle: { type: 'choice', instructions: 'The desk page\'s name in the nav and its title. Which?', criteria: { a: 'Desk', b: 'Signals', c: 'Trades', d: 'Edge' } },
  deskLede: { type: 'choice', instructions: 'One line under the desk\'s name, above the event list. Which?', criteria: {
    a: 'Every event, biggest trusted edge first. Pick one to see what it costs and how much to put on it.',
    b: 'Calibrated odds against the price. The gap is the edge; trust says whether to believe it.',
    c: 'Which prices are wrong, by how much, and how much to put on it.',
    d: 'The odds, corrected. The price, compared. The size, worked out.',
  } },
  search: { type: 'choice', instructions: 'The placeholder in the search box. Which?', criteria: {
    a: 'Search events, or type macro, crypto, trusted, soon',
    b: 'Find an event: Fed, inflation, Bitcoin, trusted, soon',
    c: 'Search, or filter: macro · crypto · trusted · soon',
  } },
  listHead: { type: 'choice', instructions: 'The small heading over the event list. Which?', criteria: { a: 'Events, biggest edge first', b: 'Where the price is wrong', c: 'Signals', d: 'Edge, trusted first' } },
  realMarket: { type: 'choice', instructions: 'The label for the probability implied by futures or options, next to "Calibrated" and "Price". Which?', criteria: { a: 'Real market', b: 'Futures say', c: 'Proxy', d: 'Traditional market' } },
  howMuch: { type: 'choice', instructions: 'The label over the Kelly dollar figure. Which?', criteria: { a: 'How much', b: 'Put on it', c: 'Size', d: 'Allocation' } },
  saveBtn: { type: 'choice', instructions: 'The button that records a trade (nothing is placed; it is a paper trade). Which?', criteria: { a: 'Save trade', b: 'Record it', c: 'Paper trade', d: 'Take it' } },
  positions: { type: 'choice', instructions: 'The heading over the saved trades, marked to the current price. Which?', criteria: { a: 'Your trades', b: 'Positions', c: 'On the book', d: 'Saved' } },
  researchName: { type: 'choice', instructions: 'What the Leaf pages are called in Atropos\'s nav. Which?', criteria: { a: 'Research', b: 'Pairs', c: 'Screener', d: 'Leaf' } },
  researchHero: { type: 'choice', instructions: 'The research home\'s headline (now: "Find the pairs that move together."). Which?', criteria: {
    a: 'Find the pairs that move together.',
    b: 'Two stocks, one spread, a reason to trade it.',
    c: 'The pairs that move together, and the ones that move apart.',
    d: 'Which stocks hedge each other.',
  } },
  researchLede: { type: 'choice', instructions: 'The research home\'s one-line lede. Which?', criteria: {
    a: 'Leaf screens a universe for cointegration, correlation and how fast a spread snaps back, then matches pairs to the strategy you trade.',
    b: 'Every pair tested for correlation, cointegration and how fast the spread snaps back. Pick a strategy; get the pairs that fit.',
    c: 'Correlation, cointegration, half-life. Three strategies. The pairs that pass.',
  } },
  researchCta: { type: 'choice', instructions: 'The research home\'s main button. Which?', criteria: { a: 'Open the screener', b: 'Screen the pairs', c: 'Find pairs', d: 'Run a screen' } },
  screenerLede: { type: 'choice', instructions: 'The line under the screener\'s title. Which?', criteria: {
    a: 'Pick one or more strategies, or set your own parameters, and Leaf returns the pairs that fit.',
    b: 'Pick a strategy, or set the numbers yourself. The pairs that pass come back ranked.',
    c: 'Strategies on the left, pairs on the right.',
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
    pick[k] = { text: Q[k].criteria[ranked[0][0]], scores: Object.fromEntries(ranked.map(([o, p]) => [Q[k].criteria[o], Math.round(p * 100) / 100])) };
    console.log(k.padEnd(13), ranked.map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '), '->', pick[k].text);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'wording-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), pick }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
