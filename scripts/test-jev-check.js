// Does Jev's consistency gate actually discriminate? Feed it one correct case
// and several with a single planted error each. A useful gate passes the first
// and fails the rest.
const path = require('path');
require('../lib/env').load(path.join(__dirname, '..', '.env'));
const jev = require('../lib/jev');

const numbers = {
  underlying: 'SPY',
  legs: [
    { action: 'BUY', type: 'call', strike: 670, expiry: '2026-10-13', qty: 4 },
    { action: 'SELL', type: 'call', strike: 675, expiry: '2026-10-13', qty: 4 },
  ],
  limitPerShare: 0.46, maxDebitPerShare: 0.73, premiumAtRisk: 184, maxPayout: 2000,
  eventName: 'Inflation (CPI, year over year)', eventDate: '2026-10-13',
  tail: { side: 'low', threshold: 2.75, pModel: 0.15, pOptions: 0.092, gapPp: 5.79 },
  covers: ['SPY', 'TLT', 'NVDA'],
};

const good = 'Add upside to the portfolio into the inflation report on 2026-10-13 with a SPY 670/675 call spread. ' +
  'SPY options charge 9.2% for the low tail of this release; the de-arbitraged odds put it at 15%. ' +
  'One spread sized to the portfolio covers SPY, TLT and NVDA, because index options are where the mispricing was measured. ' +
  'Pay no more than $0.73 a share. The most you can lose is the $184 premium; the most it can pay is $2,000.';

const cases = [
  ['correct', good],
  ['wrong strike', good.replace('670/675', '680/685')],
  ['wrong date', good.replace('2026-10-13', '2026-10-20')],
  ['wrong premium', good.replace('$184', '$84')],
  ['wrong direction', good.replace('call spread', 'put spread')],
  ['wrong odds', good.replace('put it at 15%', 'put it at 25%')],
  ['wrong ticker', good.replace('with a SPY', 'with a QQQ')],
];

(async () => {
  const r = await jev.checkRationales(cases.map(([id, text]) => ({ id, text, numbers })));
  console.log(`one call, ${cases.length} questions, ${r.latency_ms}ms (${r.model})\n`);
  let right = 0;
  for (const [id] of cases) {
    const score = r.checks[id];
    const pass = score >= 0.5;
    const ok = (id === 'correct') === pass;
    if (ok) right++;
    console.log(`${ok ? 'ok  ' : 'MISS'} ${id.padEnd(16)} consistent=${score}  -> ${pass ? 'pass' : 'fail'}`);
  }
  console.log(`\n${right}/${cases.length} judged correctly`);
})().catch((e) => { console.error(e.message, e.detail ? JSON.stringify(e.detail).slice(0, 300) : ''); process.exit(1); });
