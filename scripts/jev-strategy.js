// Jev on strategy: which angles differentiate us in a hackathon track where every
// team got the same prompt (prediction markets as economic signals, hedge-fund sponsor).
// Each candidate is scored on four questions; choices are asked three times and averaged.
//   node scripts/jev-strategy.js   -> prints the table, writes data/strategy-jev.json
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs');
const path = require('path');
const jev = require('../lib/jev');

const CONTEXT = [
  'A hackathon track sponsored by a hedge fund. Every team got roughly the same prompt: build finance software that uses prediction markets as economic signals.',
  'Judges are hedge-fund people: they value real edge, honest risk, clean data with no look-ahead, and things a desk could actually use; they discount pretty dashboards and chatbots.',
  'Our team already has: live odds from five venues de-arbitraged and compared side by side, a point-in-time archive, odds compared with what options and futures imply, at most one sized trade when two prices disagree beyond costs, a read-only brokerage link that shows each holding\'s dollar exposure to each release, sentence-level fact checking of AI text, and a news agent.',
];

const ANGLES = {
  cross_venue: 'Show the same outcome priced on every prediction venue side by side and flag when venues disagree.',
  odds_vs_derivatives: 'Compare prediction-market odds with what options and fed funds futures imply, and trade only the gap after costs ("the market disagreeing with itself").',
  point_in_time: 'Archive every read point-in-time so any signal can be backtested with no look-ahead.',
  thirteen_f: 'Compare public 13F holdings of public pension funds (state and municipal) and public university endowments with the prediction-market odds: how exposed the slow public money is to each upcoming release, and what it changed last quarter.',
  my_portfolio: 'Link the user\'s own brokerage read-only and show what each upcoming release could do to each of their holdings in dollars.',
  mascot: 'A cute, admirable character who explains the odds and the user\'s exposure in plain words and reacts as the odds move.',
  fact_check: 'Every AI-written sentence is checked against the numbers before it is shown; anything that disagrees is held back.',
  news_agent: 'An agent that finds and ranks news on any topic the user types and tags which release it bears on.',
  chatbot: 'A chatbot you can ask about prediction markets.',
  sentiment_dash: 'A dashboard of Polymarket and Kalshi odds with charts and alerts.',
};

async function main() {
  if (!jev.configured()) { console.error('TYPESAFE_API_KEY is not set'); process.exit(1); }
  const questions = {};
  for (const [k, a] of Object.entries(ANGLES)) {
    questions[`common_${k}`] = { type: 'score', instructions: `Angle: ${a} How many of the other teams with the same prompt are likely to build this?`,
      criteria: ['almost no one', 'some teams', 'most teams'] };
    questions[`judge_${k}`] = { type: 'score', instructions: `Angle: ${a} How much would a hedge-fund judge value this?`,
      criteria: ['not at all', 'somewhat', 'a great deal'] };
    questions[`demo_${k}`] = { type: 'score', instructions: `Angle: ${a} How convincingly can it be shown live in a 90-second demo?`,
      criteria: ['hard to show', 'shows fine', 'lands instantly'] };
    questions[`users_${k}`] = { type: 'score', instructions: `Angle: ${a} How strongly would an ordinary retail investor be drawn to it?`,
      criteria: ['indifferent', 'mildly interested', 'drawn in'] };
  }
  const out = await jev.ask({ context: CONTEXT }, questions);
  const rows = Object.keys(ANGLES).map((k) => {
    const s = (q) => Math.round(out.answers[`${q}_${k}`].score * 100) / 100;
    const r = { angle: k, common: s('common'), judge: s('judge'), demo: s('demo'), users: s('users') };
    // differentiation = valued by judges, rare among teams, and demoable
    r.edge = Math.round((r.judge * 1.5 + (2 - r.common) + r.demo * 0.75 + r.users * 0.5) * 100) / 100;
    return r;
  }).sort((a, b) => b.edge - a.edge);

  const choices = {
    lead: { q: 'Which single angle should the pitch lead with to win this track?',
      o: { odds_vs_derivatives: ANGLES.odds_vs_derivatives, thirteen_f: ANGLES.thirteen_f, my_portfolio: ANGLES.my_portfolio, cross_venue: ANGLES.cross_venue, mascot: ANGLES.mascot } },
    mascot_role: { q: 'If the product has a cute character, what should it do so hedge-fund judges respect it?',
      o: { narrator: 'Narrates the numbers in plain words, never invents them, and says "nothing to do" most weeks.',
        reacts: 'Its mood and pose react to the odds and to the user\'s exposure (nervous before a risky print, calm when hedged).',
        gatekeeper: 'Refuses to show a trade unless two prices disagree beyond costs, and explains why.',
        mascot_only: 'Purely decorative branding.' } },
    thirteen_f_link: { q: 'How should 13F pension and endowment data connect to prediction markets so it is one product?',
      o: { exposure: 'Measure how exposed public pensions and endowments are to each upcoming release, the same way the user\'s own portfolio is measured, and put the user beside them.',
        crowding: 'Show which of the user\'s holdings the slow public money is crowded into ahead of a release.',
        separate_tab: 'A separate tab listing 13F holdings.',
        follow: 'Copy what the pensions bought last quarter.' } },
  };
  const avg = {};
  for (let run = 0; run < 3; run++) {
    const qs = {};
    for (const [k, c] of Object.entries(choices)) qs[k] = { type: 'choice', instructions: c.q, criteria: c.o };
    const res = await jev.ask({ context: CONTEXT }, qs);
    for (const k of Object.keys(choices)) {
      avg[k] = avg[k] || {};
      for (const [o, v] of Object.entries(res.answers[k].probabilities || {})) avg[k][o] = (avg[k][o] || 0) + v / 3;
    }
  }
  console.log('ANGLE                common judge demo users  edge');
  for (const r of rows) console.log(`  ${r.angle.padEnd(20)} ${r.common.toFixed(2)}  ${r.judge.toFixed(2)}  ${r.demo.toFixed(2)} ${r.users.toFixed(2)}  ${r.edge.toFixed(2)}`);
  for (const [k, v] of Object.entries(avg)) {
    const s = Object.entries(v).sort((a, b) => b[1] - a[1]).map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · ');
    console.log(`\n${k}: ${s}`);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'strategy-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), angles: rows, choices: avg }, null, 2));
}
main().catch((e) => { console.error(e.message, e.detail ? JSON.stringify(e.detail).slice(0, 400) : ''); process.exit(1); });
