// Jev weighs four directions for Atropos's interface now that it has history (does
// protection pay when you lose), fine print (what contracts settle on if a release is
// skipped) and a record of Atty's calls.
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');
const CTX = [
  'Atropos is a hackathon entry for a hedge-fund-sponsored track on prediction markets as economic signals. Many teams got the same prompt; most will build odds dashboards or chat assistants.',
  'It reads prediction-market odds on CPI, the Fed and jobs, prices protection for each holding, and says when protection is not worth buying. New: for every release since 2021 it checks whether that protection would have paid on the days the user actually lost money; it reads the contract terms to show what each contract settles on if the government skips the release (as in the 2025 shutdown); and it keeps a record of its calls, settled after each release.',
  'The helper is Atty, a pair of scissors drawn in one line (Atropos cuts the thread), who speaks one sentence at a time with a recorded voice and snips the thread when protection is not worth it. The page is black and white with particles.',
  'Judges are finance professionals; the product must also be instantly clear to an ordinary investor.',
];
const O = {
  thread_timeline: 'The thread is the interface: one line across the screen is time. Past release days are beads (size = how much you moved, filled = protection would have paid). Atty stands at today. Upcoming releases are knots ahead of her, tied (protect) or cut (skip). Clicking a knot plays her walkthrough for that release; settled calls slide into the past showing whether she was right.',
  story_mode: 'Full-screen story mode only: one sentence and one visual per screen, tap to advance, like phone stories; detail tables behind a single "see everything" link.',
  chat_first: 'Chat first: the user talks to Atty (voice or text) and she answers with small cards for quotes, history and fine print.',
  current: 'Keep the current page: a walkthrough hero beside Atty, then numbered index sections (quotes, public funds, watching, news).',
};
(async () => {
  const Q = {
    win: { type: 'choice', instructions: 'Which interface most likely wins this track: most distinctive next to other teams, shows the three new features most clearly, and is easiest for an ordinary investor to follow?', criteria: O },
    clear: { type: 'choice', instructions: 'Which interface would an ordinary investor understand fastest on first visit?', criteria: O },
  };
  const avg = {};
  for (let i = 0; i < 3; i++) {
    const a = await jev.ask({ context: CTX }, Q);
    for (const k of Object.keys(Q)) for (const [o, p] of Object.entries(a.answers[k].probabilities || {})) { avg[k] = avg[k] || {}; avg[k][o] = (avg[k][o] || 0) + p / 3; }
  }
  for (const k of Object.keys(Q)) console.log(k.padEnd(6), Object.entries(avg[k]).sort((a, b) => b[1] - a[1]).map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'ui-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), options: O, avg }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
