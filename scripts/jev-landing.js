// Jev picks every line on the landing page from short candidates, the way the earlier site did
// (data/site-copy.json). Each slot keeps the Topology page's role for that line.
//   node scripts/jev-landing.js   -> data/landing-copy.json
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');

const CTX = [
  'Atropos is a hackathon entry for a hedge-fund-sponsored track: prediction markets as economic signals. It joins three engines. Basis (by a teammate) says whether a prediction-market price is a real signal: a calibrated probability fitted on 628 settled Kalshi markets, the basis (the gap to what fed-funds futures or Bitcoin options already imply) and a 0-100 trust score. Atropos turns the odds on the next inflation, Fed and jobs reports into dollars at risk for your holdings and prices protection, checking whether that protection paid on the days you actually lost. Leaf (by a teammate) screens stock pairs for mean reversion, statistical arbitrage and hedging.',
  'The page copies the flow of a venture firm site: a huge hero line over a moving surface of contour rings, a one-line tagline, two short scroll titles that appear one after another as the camera dives into the rings, a section explaining where the name comes from, two numbered blocks (what it does, how), three principles each with a one-line claim, and a footer.',
  'Facts that may appear: a 40 cent contract resolved YES about 30 percent of the time; a 98 cent contract only 84 percent; inflation protection paid on only 6 of the sample portfolio\'s 13 worst inflation-report days since 2021; Atropos is the Fate who cuts the thread.',
  'Readers are hedge-fund judges with 30 seconds. Short, plain, confident, no hype words, no exclamation marks.',
];
const Q = {
  hero: { type: 'choice', instructions: 'The huge hero line, two short lines like "Meet us / at the edge." Which is best?', criteria: {
    a: 'Read the odds. Then your book.',
    b: 'Meet the market at the edge.',
    c: 'A price is not a probability.',
    d: 'See the move before it moves you.',
    e: 'The odds, read properly.',
  } },
  tagline: { type: 'choice', instructions: 'The one-line tagline beside the hero line (like "We\'re an early stage emerging tech venture firm."). Which is best?', criteria: {
    a: 'Prediction-market odds, calibrated, trusted and priced against what you own.',
    b: 'We turn prediction-market odds into one trade for your portfolio, or none.',
    c: 'Calibrated odds, your exposure, and the cheapest hedge that actually pays.',
    d: 'A trust layer between prediction markets and your book.',
  } },
  title0: { type: 'choice', instructions: 'The first scroll title, shown alone over the rings as the camera dives (their site says "You jump..."). Three or four words. Which is best?', criteria: {
    a: 'The odds move...',
    b: 'A price moves...',
    c: 'Markets whisper...',
    d: 'The number prints...',
  } },
  title1: { type: 'choice', instructions: 'The second scroll title, the answer to the first (their site says "We jump..."). Which is best?', criteria: {
    a: '...your book moves with it.',
    b: '...we read it first.',
    c: '...we tell you what it costs.',
    d: '...and so does what you own.',
  } },
  origin: { type: 'choice', instructions: 'The label above the name paragraph (their site says "Where our name comes from"). Which is best?', criteria: {
    a: 'Where the name comes from',
    b: 'Why a price is not a probability',
    c: 'What the odds are worth',
  } },
  block1: { type: 'choice', instructions: 'Block 01 title (theirs: "What we do"). Which is best?', criteria: { a: 'What it reads', b: 'What it does', c: 'What we built' } },
  block2: { type: 'choice', instructions: 'Block 02 title (theirs: "How we do it"). Which is best?', criteria: { a: 'How it decides', b: 'How it does it', c: 'How the numbers are made' } },
  engines: { type: 'choice', instructions: 'The pinned section title for the three engines (theirs: "Principles"). Which is best?', criteria: { a: 'Engines', b: 'Three engines', c: 'The method', d: 'Principles' } },
  week: { type: 'choice', instructions: 'Section title for the three reports coming up (theirs: "Team"). Which is best?', criteria: { a: 'This week', b: 'The week ahead', c: 'Next prints' } },
  signals: { type: 'choice', instructions: 'Section title for the framed grid of eight events with calibrated odds (theirs: "Select investments"). Which is best?', criteria: { a: 'Select signals', b: 'Live signals', c: 'What we trust', d: 'Signals, ranked' } },
  tools: { type: 'choice', instructions: 'Section title for the numbered rows linking to the tools (theirs: "Public goods"). Which is best?', criteria: { a: 'Tools', b: 'Open tools', c: 'Public tools', d: 'Instruments' } },
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
    console.log(k.padEnd(8), ranked.map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '), '->', pick[k].text);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'landing-copy.json'), JSON.stringify({ judged_at: new Date().toISOString(), pick }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
