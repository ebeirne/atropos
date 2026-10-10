// Jev picks Atty's speaking voice from the account's premade ElevenLabs voices
// (Lucy is Lila's voice and is left out on purpose).
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path'); const jev = require('../lib/jev');
const CTX = ['Atty is the helper on Atropos, a site that walks an ordinary investor through what could hurt their portfolio this month and what protection costs on prediction markets, and tells them when protection is not worth buying.',
  'She is drawn as a cute, minimal pair of scissors (Atropos, the Fate who cuts the thread). She speaks one short sentence per step, with real dollar figures, and the voice is played only when the user presses play.',
  'The voice should feel calm, warm, trustworthy with money, a little playful, and easy to understand for anyone.'];
const O = {
  sarah: 'Sarah: young American woman, mature, reassuring, confident, warm.',
  matilda: 'Matilda: American woman, knowledgeable, professional, pleasing alto, upbeat.',
  alice: 'Alice: British woman, clear, engaging educator, friendly.',
  lily: 'Lily: British woman, velvety, confident, warm narration.',
  bella: 'Bella: American woman, professional, bright, warm.',
  jessica: 'Jessica: young American woman, playful, bright, warm, cute.',
  river: 'River: American, gender neutral, relaxed, calm, informative.',
};
const IDS = { sarah: 'EXAVITQu4vr4xnSDxMaL', matilda: 'XrExE9yKIg1WjnnlVkGX', alice: 'Xb7hH8MSUJpSbSDYk0k2', lily: 'pFZP5JQG7iQjIQuC4Bku', bella: 'hpp4J3VqNfWAUOO0d1Us', jessica: 'cgSgspJ2msm6clMCkdW9', river: 'SAz9YHcvj6GT2YYXdXww' };
(async () => {
  const avg = {};
  for (let r = 0; r < 3; r++) {
    const out = await jev.ask({ context: CTX }, { v: { type: 'choice', instructions: 'Which voice best fits Atty?', criteria: O } });
    for (const [o, p] of Object.entries(out.answers.v.probabilities || {})) avg[o] = (avg[o] || 0) + p / 3;
  }
  const ranked = Object.entries(avg).sort((a, b) => b[1] - a[1]);
  console.log(ranked.map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'voice-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), avg, pick: ranked[0][0], voice_id: IDS[ranked[0][0]] }, null, 2));
  console.log('pick', ranked[0][0], IDS[ranked[0][0]]);
})().catch((e) => { console.error(e.message); process.exit(1); });
