// Jev decides the shape of the voice-glow version of Atropos (reference: Jakub Antalik's
// "Voice Glow Effect": an iridescent glow rising from the bottom edge of a dark panel as an
// AI speaks, words above it, a small agent pill).
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');
const CTX = [
  'Atropos is a hackathon entry (hedge-fund-sponsored track, prediction markets as economic signals). Its core: it prices protection for your holdings on prediction markets, and shows that most hedges miss the days you actually lose (6 of 13 for the sample), and says when to skip overpriced protection. Atty is its recorded voice that walks you through it in nine short lines.',
  'The interface is being rebuilt around a voice-glow reference: a dark minimal UI where an iridescent glow rises from the bottom edge while the AI speaks, with the spoken words above it.',
  'The owner wants it modern, simple, large readable type, trading-app clarity, and something judges remember.',
];
const Q = {
  character: { type: 'choice', instructions: 'What should represent Atty?', criteria: {
    none: 'No character at all: Atty is only the voice and the glow.',
    pill: 'A small glowing pill labelled "Atty" that pulses with her voice, like an agent badge.',
    orb: 'A small glowing glass orb with two eyes that sits by her words.',
    blob: 'Cute colorful blob characters with pill eyes (Grok style).',
  } },
  glow: { type: 'choice', instructions: 'Where should the voice glow live?', criteria: {
    screen_edge: 'Along the bottom edge of the whole screen, rising behind the words as she speaks.',
    under_words: 'In a band directly under her current sentence.',
    card_edges: 'Around the edges of whichever card she is talking about.',
  } },
  theme: { type: 'choice', instructions: 'Which theme?', criteria: { dark: 'Dark, near-black background.', light: 'Light, off-white background.' } },
  status: { type: 'choice', instructions: 'Should Atty show what she is doing with a status pill that steps through states like Reading odds, Pricing, Checking your history?', criteria: { yes: 'Yes, a small status pill.', no: 'No, keep it out.' } },
};
(async () => {
  const avg = {};
  for (let i = 0; i < 3; i++) {
    const a = await jev.ask({ context: CTX }, Q);
    for (const k of Object.keys(Q)) for (const [o, p] of Object.entries(a.answers[k].probabilities || {})) { avg[k] = avg[k] || {}; avg[k][o] = (avg[k][o] || 0) + p / 3; }
  }
  for (const k of Object.keys(Q)) console.log(k.padEnd(10), Object.entries(avg[k]).sort((a, b) => b[1] - a[1]).map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'voiceui-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), avg }, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
