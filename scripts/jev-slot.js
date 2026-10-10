// Re-judge one slot with new candidates and record it in data/site-copy.json.
//   node scripts/jev-slot.js limit3 "line one" "line two" ...
const fs = require('fs');
const path = require('path');
const { judge } = require('./jev-site');

(async () => {
  const [slot, ...lines] = process.argv.slice(2);
  if (!slot || !lines.length) { console.error('usage: jev-slot.js <slot> "candidate" ...'); process.exit(1); }
  const r = await judge(slot, lines);
  console.log(`${slot}${r.passed ? '' : '  (none passed the facts check)'}`);
  for (const row of r.rows) console.log(`  ${row.text === r.pick ? '>' : ' '} clear ${row.clear.toFixed(2)}  true ${row.accurate.toFixed(2)}  ${row.text}`);
  const file = path.join(__dirname, '..', 'data', 'site-copy.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  all.slots[slot] = { ...r, rejudged_at: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
})().catch((e) => { console.error(e.message); process.exit(1); });
