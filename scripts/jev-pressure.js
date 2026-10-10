// Pressure test: every part of the idea (product and UI) scored by Jev against what
// already exists (found by web search on 2026-10-09; sources in data/pressure-test.md).
//   node scripts/jev-pressure.js   -> prints the table, writes data/pressure-jev.json
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs');
const path = require('path');
const jev = require('../lib/jev');

const EXISTING = [
  'Kairos (a16z crypto seed, Feb 2026), Metric Terminal (15,000+ markets across Polymarket, Kalshi, PredictIt) and Verso sell "Bloomberg terminals for prediction markets": cross-venue odds, alerts, charts.',
  'Kalshi is piloting its own professional trading interface and launched a Public Companies Hub; ICE and Tradeweb distribute Kalshi and Polymarket data to institutions; Bloomberg reportedly shows prediction odds.',
  'Frenzycap publishes a Fed Rate Fair Value comparison of Kalshi against SOFR-implied and FedWatch probabilities; Dune published a Kalshi vs Polymarket vs FedWatch study; an automated skill trades Kalshi vs FedWatch divergence.',
  'Hedgebook (hedgespx.com, May 2026) maps about 500 S&P 500 companies to 47 Kalshi event contracts as possible hedges, refreshed daily; users trade on Kalshi themselves; it does not appear to link brokerages, size hedges in dollars, compare venues or compare with options.',
  'Robinhood has a prediction-markets hub routing to Kalshi, ForecastEx, Rothera and Crypto.com; event contracts were its second-largest transaction revenue line in Q2 2026.',
  'Many 13F trackers exist (WhaleWisdom, Fintel, DisclosedCapitol, SentiSense, Dakota); none found compares public pensions and public university endowments with event risk.',
  'Hackathon teams given a prediction-markets prompt typically build odds dashboards with AI summaries, "AI hedge fund" signal bots, arbitrage scanners, chatbots and sentiment scores.',
];

const PARTS = {
  odds_dashboard: 'Live odds for CPI, the Fed and jobs from several venues, de-arbitraged, with charts.',
  cross_venue: 'The same outcome priced side by side across Kalshi, ForecastEx, CME event contracts, Limitless and Futuur, with the gap between them.',
  odds_vs_derivatives: 'Prediction odds compared with what SPY options and fed funds futures imply, trading only the gap after costs.',
  abstain: 'Says "no trade" most weeks and shows which condition failed.',
  point_in_time: 'Every read archived point-in-time so any signal can be replayed without look-ahead.',
  portfolio_exposure: 'Links the user\'s own Robinhood or Fidelity read-only and shows each holding\'s dollar exposure to each release.',
  hedge_shop: 'For each holding, an agent finds every event contract (any venue) and option that would protect it against the release that hurts it, sizes the hedge in dollars, picks the cheapest credible quote, and says when the protection costs more than the odds justify.',
  fact_check: 'Every AI sentence is checked against the numbers by a fast structured model before it is shown.',
  thirteen_f: 'Public pensions and public university endowments, from 13F, measured for exposure to the same releases with the same model, the user beside them.',
  news_agent: 'An agent that finds and ranks news on any topic and tags which release it touches.',
  ui_dust_landing: 'A landing page with a particle face drawn in tiny ASCII characters and a serif finance-press look.',
  ui_robinhood_console: 'A dark, Robinhood-style console: big portfolio number, green/red swings, a scrubbable odds chart, watchlist rows.',
  ui_character: 'A cute, admirable character who is the product\'s skeptical risk analyst: explains in plain words, refuses bad hedges, reacts to the user\'s exposure.',
};

async function main() {
  if (!jev.configured()) { console.error('TYPESAFE_API_KEY is not set'); process.exit(1); }
  const qs = {};
  for (const [k, d] of Object.entries(PARTS)) {
    qs[`exists_${k}`] = { type: 'score', instructions: `Part of our product: ${d} Given what already exists, how close is an existing product or common hackathon build to this?`,
      criteria: ['nothing close exists', 'partly exists', 'already exists'] };
    qs[`matters_${k}`] = { type: 'score', instructions: `Part of our product: ${d} How much would it matter to a hedge-fund judge and a real user?`,
      criteria: ['barely', 'somewhat', 'a lot'] };
  }
  const out = await jev.ask({ already_exists: EXISTING }, qs);
  const rows = Object.keys(PARTS).map((k) => {
    const e = Math.round(out.answers[`exists_${k}`].score * 100) / 100, m = Math.round(out.answers[`matters_${k}`].score * 100) / 100;
    return { part: k, exists: e, matters: m, unique: Math.round((2 - e) * 100) / 100, value: Math.round((2 - e) * m * 100) / 100 };
  }).sort((a, b) => b.value - a.value);
  console.log('PART                   exists matters  unique  value(unique x matters)');
  for (const r of rows) console.log(`  ${r.part.padEnd(22)} ${r.exists.toFixed(2)}   ${r.matters.toFixed(2)}    ${r.unique.toFixed(2)}   ${r.value.toFixed(2)}`);

  const avg = {};
  const choices = {
    wedge: { q: 'Which single wedge would make this team stand out most in the track?',
      o: { hedge_shop: PARTS.hedge_shop, odds_vs_derivatives: PARTS.odds_vs_derivatives, cross_venue: PARTS.cross_venue, thirteen_f: PARTS.thirteen_f, portfolio_exposure: PARTS.portfolio_exposure } },
    ui: { q: 'Which UI direction best fits the winning wedge for both judges and ordinary users?',
      o: { character_quote: 'A friendly character who hands you a plain "insurance quote" per holding and says no when it is not worth it, with every number one tap away.',
        terminal: 'A dense professional terminal with tables and tickers.',
        robinhood: 'A Robinhood-style dark app with a big portfolio number and green and red.',
        art_landing: 'An artistic landing page with a particle face.' } },
  };
  for (let run = 0; run < 3; run++) {
    const c = {};
    for (const [k, v] of Object.entries(choices)) c[k] = { type: 'choice', instructions: v.q, criteria: v.o };
    const res = await jev.ask({ already_exists: EXISTING }, c);
    for (const k of Object.keys(choices)) {
      avg[k] = avg[k] || {};
      for (const [o, p] of Object.entries(res.answers[k].probabilities || {})) avg[k][o] = (avg[k][o] || 0) + p / 3;
    }
  }
  for (const [k, v] of Object.entries(avg)) console.log(`\n${k}: ` + Object.entries(v).sort((a, b) => b[1] - a[1]).map(([o, p]) => `${o} ${p.toFixed(2)}`).join(' · '));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'pressure-jev.json'), JSON.stringify({ judged_at: new Date().toISOString(), existing: EXISTING, parts: rows, choices: avg }, null, 2));
}
main().catch((e) => { console.error(e.message, e.detail ? JSON.stringify(e.detail).slice(0, 400) : ''); process.exit(1); });
