// Jev picks a simpler, cuter character that fits a minimal Swiss black-and-white site
// (one typeface, one size, a glowing cursor trail as the only art).
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');
const CTX = ['The site is minimal: black background, one plain typeface at one size, text in columns, and a soft glowing trail that follows the cursor as the only art.',
  'The character must be very cute and very simple (a few strokes), drawn in white line on black, and fit Atropos (the Fate who cuts the thread): it looks after the thread of your portfolio and says no to overpriced protection.'];
const O = {
  yarn_ball: 'A little ball of yarn with two dot eyes and a tiny smile; its loose thread is the cursor trail.',
  line_cat: 'A cat drawn in three strokes: a round head, two ear points, two dot eyes.',
  mochi: 'A soft round blob with dot eyes and blush.',
  ghost: 'A tiny ghost with dot eyes.',
  star: 'A small star with a face.',
  spool: 'A thread spool with a face.',
};
(async () => {
  const avg = {};
  for (let r = 0; r < 3; r++) {
    const out = await jev.ask({ context: CTX }, { c: { type: 'choice', instructions: 'Which character is cutest, simplest to draw in a few white lines, and fits the thread and the job?', criteria: O } });
    for (const [o, p] of Object.entries(out.answers.c.probabilities || {})) avg[o] = (avg[o] || 0) + p / 3;
  }
  console.log(Object.entries(avg).sort((a, b) => b[1] - a[1]).map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'character2-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), avg }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
