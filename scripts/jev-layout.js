// Jev picks a layout for Atropos that is not a chatbot but keeps Atty (a yellow blob with
// two black eyes who squishes, stretches, follows the cursor and can be thrown) at the center.
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');
const CTX = [
  'Atropos is a hackathon entry (hedge-fund-sponsored track: prediction markets as economic signals). It prices protection for your holdings on prediction markets, shows that most hedges miss the days you actually lose (6 of 13 for the sample), reads the contract fine print (it still pays if the report is skipped), and says when to skip overpriced protection. There is one trade worth considering and one to skip this week.',
  'Atty is a soft yellow blob with two black eyes on a black page. She sleeps until your cursor comes near, follows it, squishes when poked, stretches when dragged, can be thrown, and has moods. She has a recorded voice (nine short lines).',
  'The team rejected a scrolling dashboard and a chatbot. They want Atty at the center, simple, memorable, and clear enough that a judge understands the trade in seconds.',
];
const Q = {
  layout: { type: 'choice', instructions: 'Which layout should the site use?', criteria: {
    stage: 'Stage: one full-screen scene at a time with Atty in the middle physically interacting with the one thing that matters (sitting on the big number, pushing the trade card in, holding up a Skip sign); scroll or arrow keys move scene to scene.',
    orbit: 'Orbit: Atty in the center with this week\'s reports floating around her as cards; click one and she pulls it in and explains it.',
    swipe: 'Decide: Atty holds one decision card at a time (protect against hot inflation for $377?); you choose protect or skip, then she reacts and reveals her call and the 6 of 13 fact; next card.',
    track: 'Track: a horizontal timeline of the coming reports; Atty walks along it and stops at each one to show the decision.',
    dashboard: 'Dashboard: a clean trading dashboard grid with Atty living in a corner, reacting when you hover cards.',
  } },
  nav: { type: 'choice', instructions: 'How should a visitor move through it?', criteria: {
    scroll: 'Scrolling (each scroll step is the next scene).',
    click: 'Clicking or tapping Atty or big next buttons.',
    choices: 'Making choices (protect or skip) that move it forward.',
  } },
  data: { type: 'choice', instructions: 'How should Atty relate to the numbers?', criteria: {
    physical: 'Physically: she holds, sits on, pushes or reacts to the cards and numbers.',
    beside: 'Beside: she floats next to the numbers and reacts with her face.',
    narrates: 'Narrates only: her voice and face; the numbers stand on their own.',
  } },
};
(async () => {
  const avg = {};
  for (let i = 0; i < 3; i++) {
    const a = await jev.ask({ context: CTX }, Q);
    for (const k of Object.keys(Q)) for (const [o, p] of Object.entries(a.answers[k].probabilities || {})) { avg[k] = avg[k] || {}; avg[k][o] = (avg[k][o] || 0) + p / 3; }
  }
  for (const k of Object.keys(Q)) console.log(k.padEnd(7), Object.entries(avg[k]).sort((a, b) => b[1] - a[1]).map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'layout-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), avg }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
