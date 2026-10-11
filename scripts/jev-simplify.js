// Jev picks the shortest clear version of the lines that had grown wordy, across the desk, the
// landing page and the research pages. Every candidate is short, so the winner is short.
//   node scripts/jev-simplify.js -> data/simplify-jev.json
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');

const CTX = [
  'Atropos is a hackathon entry: prediction-market odds, calibrated (Basis), priced against what you own and sized with half Kelly (Atropos), plus a stock-pair screener (Leaf). Readers are hedge-fund judges with 30 seconds. The owner asked for everything to be simpler: fewer words, plain, no hype.',
];
const Q = {
  deskLede: { type: 'choice', instructions: 'The line under the desk title. Which?', criteria: { a: 'Biggest trusted edge first. Pick one.', b: 'Pick an event. See what to put on it.', c: 'Events by edge. Pick one.' } },
  search: { type: 'choice', instructions: 'Search box placeholder. Which?', criteria: { a: 'Search · macro · crypto · trusted · soon', b: 'Search events', c: 'Find an event' } },
  heroSub: { type: 'choice', instructions: 'The landing subtitle under "Find the edge. Price the risk. Size the trade." Which?', criteria: { a: 'Odds, calibrated. Risk, in dollars. Size, by Kelly.', b: 'Prediction-market odds, checked and sized for your book.', c: 'Where the price is wrong, what it costs you, how much to put on it.' } },
  step1: { type: 'choice', instructions: 'Landing step 01 "Read the odds." one-liner. Which?', criteria: { a: 'What traders expect this week.', b: 'The odds on the Fed, inflation and jobs.', c: 'Kalshi and Polymarket, calibrated.' } },
  step2: { type: 'choice', instructions: 'Step 02 "Check what you own." one-liner. Which?', criteria: { a: 'Read-only, from your brokerage.', b: 'Your holdings, read-only.', c: 'What each print does to your book.' } },
  step3: { type: 'choice', instructions: 'Step 03 title and one-liner. Which?', criteria: { a: 'Size the trade. | Half Kelly, capped.', b: 'Get one trade, or none. | You place it yourself.', c: 'Take the edge. | Or skip it.' } },
  tipCal: { type: 'choice', instructions: 'Tooltip definition of "Calibrated". Which?', criteria: { a: 'The real chance, after correcting the price.', b: 'Our probability for this event.', c: 'Price, corrected on 628 settled markets.' } },
  tipPrice: { type: 'choice', instructions: 'Tooltip definition of "Price". Which?', criteria: { a: 'What a YES contract costs.', b: 'The market\'s odds, as a price.', c: 'YES price on the venue.' } },
  tipTrad: { type: 'choice', instructions: 'Tooltip definition of "Traditional market". Which?', criteria: { a: 'What futures or options imply.', b: 'The same odds from the real market.', c: 'Implied by fed-funds futures or options.' } },
  tipBasis: { type: 'choice', instructions: 'Tooltip definition of "Basis". Which?', criteria: { a: 'Price minus traditional market.', b: 'The gap between the two.', c: 'How far the venues sit from the real market.' } },
  compare: { type: 'choice', instructions: 'The "How the price compares" block, one line per side. Which pattern?', criteria: { a: 'YES: 73¢ vs 59% likely. 14 points overpriced.', b: 'YES costs 73¢ for a 59% chance: overpriced by 14.', c: 'YES · market 73¢ · model 59% · +14 overpriced' } },
  why: { type: 'choice', instructions: 'The one line under the Kelly dollar figure. Which pattern?', criteria: { a: 'Half Kelly: 22¢ for a 38% chance.', b: '22¢ for a 38% chance, half Kelly.', c: 'Half Kelly on 38% at 22¢.' } },
  noEdge: { type: 'choice', instructions: 'The line when there is no edge. Which?', criteria: { a: 'No edge: 22¢ for a 22% chance.', b: 'Nothing: the price already matches the odds.', c: 'No edge after calibration.' } },
  src: { type: 'choice', instructions: 'The footnote at the bottom of the desk. Which?', criteria: { a: 'Odds from Basis. Size: half Kelly, capped at 10%. Not advice; nothing is placed.', b: 'Calibrated on 628 settled markets. Half Kelly, 10% cap. Not investment advice.', c: 'Numbers from code. Not advice. No orders.' } },
  leafStep1: { type: 'choice', instructions: 'Research step "Choose strategies" one-liner. Which?', criteria: { a: 'Mean reversion, stat-arb, hedging, or your own numbers.', b: 'Pick one or more. Each has its own rules.', c: 'Three strategies, or set the numbers yourself.' } },
  leafStep2: { type: 'choice', instructions: 'Research step "Screen the universe" one-liner. Which?', criteria: { a: 'Every pair tested: correlation, cointegration, half-life.', b: 'Correlation, cointegration, half-life, for every pair.', c: 'Every pair, three tests.' } },
  leafStep3: { type: 'choice', instructions: 'Research step "Read the shortlist" one-liner. Which?', criteria: { a: 'Ranked pairs, with the chart and the numbers.', b: 'The pairs that pass, ranked, with charts.', c: 'Pairs that fit, best first.' } },
  leafEmpty: { type: 'choice', instructions: 'The screener\'s empty state under "Choose a strategy, then find pairs". Which?', criteria: { a: 'Tick a strategy on the left. The pairs that pass appear here.', b: 'Every pair tested; the ones that fit your strategy land here.', c: 'Pick a strategy to see its pairs.' } },
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
    console.log(k.padEnd(10), ranked.map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '), '->', pick[k].text);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'simplify-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), pick }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
