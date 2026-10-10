// Jev picks how to draw Atty as a very simple, humanlike character who lives
// throughout the page (stands on the thread, sits on section lines, points, waves).
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');
const CTX = [
  'Atropos is a black-and-white site with one plain typeface. Its helper, Atty (named for Atropos, the Fate who cuts the thread), tells an ordinary investor what could hurt their portfolio and when protection is not worth buying.',
  'The owner wants a real humanlike character, very very simple, who lives throughout the page: she stands on a timeline thread at "today", sits on the line above each section as you scroll, points at numbers, and waves at the end. Drawn in white lines on black, about 130 pixels tall.',
];
const Q = {
  look: { type: 'choice', instructions: 'Which drawing makes the most likeable, humanlike and memorable character while staying very simple?', criteria: {
    pictogram: 'A pictogram woman: round head with a short bob of hair, two dot eyes, a small smile, an A-line dress, line arms and legs.',
    one_line: 'One continuous line drawing of a woman, plus two dot eyes.',
    stick: 'A classic stick figure with a round head and dot eyes.',
    bean: 'A soft bean-shaped body with a round head, dot eyes, and little line arms and legs.',
  } },
  prop: { type: 'choice', instructions: 'What should she carry so people get who she is?', criteria: {
    scissors: 'A small pair of scissors (she cuts the thread when protection is not worth it).',
    thread: 'A loose thread she holds, which becomes the timeline.',
    nothing: 'Nothing; her words and the page explain her.',
  } },
  life: { type: 'choice', instructions: 'How should she live throughout the page?', criteria: {
    travels: 'She walks with you as you scroll and settles at each section in a pose (standing on the thread, sitting on a section line, pointing, waving), with one short line to say there.',
    corner: 'She stays in a corner and changes pose as you scroll.',
    hero_only: 'She only appears at the top.',
  } },
};
(async () => {
  const avg = {};
  for (let i = 0; i < 3; i++) {
    const a = await jev.ask({ context: CTX }, Q);
    for (const k of Object.keys(Q)) for (const [o, p] of Object.entries(a.answers[k].probabilities || {})) { avg[k] = avg[k] || {}; avg[k][o] = (avg[k][o] || 0) + p / 3; }
  }
  for (const k of Object.keys(Q)) console.log(k.padEnd(5), Object.entries(avg[k]).sort((a, b) => b[1] - a[1]).map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'human-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), avg }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
