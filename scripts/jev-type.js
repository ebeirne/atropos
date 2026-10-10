// Jev picks the typefaces for the glass version: modern, unique, simple to read at
// large sizes, sharp-cornered layout, electric blue glass on black, trading-app clarity.
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');
const CTX = ['Atropos is a trading-style web app: a glowing glass head with two eyes (Atty, a voice) on electric blue and black, sharp square-cornered panels, real photos, very large simple typography. It must feel modern and unique, and anyone must understand the numbers at a glance. Judges are finance professionals at a hackathon.'];
const O = {
  unbounded: 'Unbounded (wide, bold geometric display) for headlines, Geist for text, Geist Mono for labels and numbers.',
  syne: 'Syne (quirky, art-school display) for headlines, Inter for text and numbers.',
  space: 'Space Grotesk for headlines and text, IBM Plex Mono for labels and numbers.',
  serif: 'Instrument Serif (elegant editorial serif) for headlines, Geist for text, Geist Mono for numbers.',
  archivo: 'Archivo (extra-condensed, heavy) for headlines, Archivo for text, JetBrains Mono for numbers.',
};
(async () => {
  const avg = {};
  for (let i = 0; i < 3; i++) {
    const a = await jev.ask({ context: CTX }, { f: { type: 'choice', instructions: 'Which type system makes Atropos look most modern and unique while keeping large, simple text easy to understand?', criteria: O } });
    for (const [o, p] of Object.entries(a.answers.f.probabilities || {})) avg[o] = (avg[o] || 0) + p / 3;
  }
  console.log(Object.entries(avg).sort((a, b) => b[1] - a[1]).map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'type-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), options: O, avg }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
