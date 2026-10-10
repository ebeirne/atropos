// Jev picks the one character from the cast to keep as the focus, how far to strip
// it down, and how it should move. The page stays black and white with particles.
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');
const CTX = ['Atropos is a site that looks after the thread of your portfolio: it prices protection for each holding on prediction markets and says when protection is not worth buying. It is named for the Fate who cuts the thread.',
  'The page is black and white: a black background, one plain typeface at one size, a cloud of white dust particles behind the hero, and a beaded thread that follows the cursor.',
  'The hero currently shows a crowd of twelve cute line-drawn characters. The owner wants one character only, as simple as possible, that the average person instantly likes and remembers.'];
const Q = {
  who: { type: 'choice', instructions: 'Which one character should the whole site focus on: cute, instantly readable when drawn with very few white lines, memorable, and true to the thread and to saying no to overpriced protection?',
    criteria: {
      yarn_ball: 'Atty, a ball of yarn with dot eyes; her loose thread is the cursor trail.',
      scissors: 'Atropos, a pair of scissors whose two handle loops are the eyes.',
      spool: 'A spool of thread with a face.',
      coin: 'A round coin with a face.',
      piggy_bank: 'A piggy bank with a face.',
      fed_building: 'A classical bank building with a face.',
      shopping_bag: 'A grocery bag with a face (inflation).',
      die: 'A die with a face (odds).',
    } },
  how: { type: 'choice', instructions: 'How far should that character be simplified for this site?',
    criteria: {
      eyes_only: 'Just its outline and two dot eyes. No mouth, cheeks, arms or legs.',
      eyes_smile: 'Its outline, two dot eyes and a tiny smile. Nothing else.',
      one_line: 'A single continuous white line for the body, plus two dot eyes.',
      solid: 'A solid white silhouette with two black dot eyes.',
    } },
  move: { type: 'choice', instructions: 'How should the character move?',
    criteria: {
      breathe: 'It slowly breathes (scales a little) and blinks now and then.',
      eyes_follow: 'It stays still; only its eyes follow the cursor, and it blinks.',
      bob: 'It bobs up and down gently.',
      none: 'It does not move at all.',
    } },
};
(async () => {
  const avg = {};
  for (let r = 0; r < 3; r++) {
    const out = await jev.ask({ context: CTX }, Q);
    for (const k of Object.keys(Q)) {
      avg[k] = avg[k] || {};
      for (const [o, p] of Object.entries(out.answers[k].probabilities || {})) avg[k][o] = (avg[k][o] || 0) + p / 3;
    }
  }
  for (const k of Object.keys(Q)) console.log(k.padEnd(5), Object.entries(avg[k]).sort((a, b) => b[1] - a[1]).map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'character3-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), avg }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
