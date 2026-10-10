// Jev picks the character: who hands the user an insurance quote per holding.
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');
const CTX = ['The product is Atropos (the Fate who cuts the thread). An agent shops every prediction venue and options market for the cheapest protection on each thing the user owns, sizes it in dollars, and says no when it is not worth it.',
  'The character is the face of the product: cute and admirable so ordinary users are drawn in, yet credible to hedge-fund judges because it is a careful, skeptical risk analyst, not a hype mascot.'];
const CHAR = {
  cat_yarn: 'A small cat who looks after a ball of thread (your portfolio\'s thread of fate) and ties a knot (a hedge) where it might snap.',
  owl: 'A small owl in round glasses who reads the odds carefully.',
  fox: 'A clever little fox with a notebook.',
  spider: 'A tiny weaver spider who spins safety nets under each holding.',
  bear: 'A calm bear cub who keeps the portfolio warm through storms.',
  robot: 'A friendly little robot with a calculator.',
};
const NAMES = { Atty: 'short for Atropos', Spindle: 'the spindle the Fates spin thread on', Knot: 'a knot that holds', Clo: 'short for Clotho, the spinner', Moira: 'fate itself' };
(async () => {
  const avg = { character: {}, name: {} };
  for (let r = 0; r < 3; r++) {
    const out = await jev.ask({ context: CTX }, {
      character: { type: 'choice', instructions: 'Which character best fits: drawn-to by ordinary users, respected by judges, tied to the name Atropos and the job (protection, saying no)?', criteria: CHAR },
      name: { type: 'choice', instructions: 'Which name fits that character best: easy to say, warm, tied to Atropos?', criteria: NAMES },
    });
    for (const k of ['character', 'name']) for (const [o, p] of Object.entries(out.answers[k].probabilities || {})) avg[k][o] = (avg[k][o] || 0) + p / 3;
  }
  for (const [k, v] of Object.entries(avg)) console.log(k + ': ' + Object.entries(v).sort((a, b) => b[1] - a[1]).map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'character-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), choices: avg }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
