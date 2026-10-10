// Capture this week's live odds, with their changes, for the static site:
// the published artifact cannot reach the exchanges, so it shows this dated
// snapshot (labelled "as of") instead. Needs the server running on :4411.
//   node scripts/snapshot-tape.js   -> public/tape.json
const fs = require('fs');
const path = require('path');
const http = require('http');

http.get('http://127.0.0.1:4411/api/events', (res) => {
  let b = '';
  res.on('data', (d) => { b += d; });
  res.on('end', () => {
    const j = JSON.parse(b);
    const keep = ['id', 'name', 'title', 'date', 'labels', 'p', 'unit', 'mean', 'source', 'verdict', 'change'];
    const out = { asOf: new Date().toISOString(),
      signals: j.signals.map((s) => Object.fromEntries(keep.map((k) => [k, s[k] === undefined ? null : s[k]]))) };
    fs.writeFileSync(path.join(__dirname, '..', 'public', 'tape.json'), JSON.stringify(out, null, 1));
    http.get('http://127.0.0.1:4411/api/venues', (r2) => {
      let b2 = '';
      r2.on('data', (d) => { b2 += d; });
      r2.on('end', () => { fs.writeFileSync(path.join(__dirname, '..', 'public', 'venues.json'), b2); console.log('wrote public/venues.json'); });
    });
    console.log('wrote public/tape.json', out.signals.map((s) => s.id + ':' + s.source + (s.change ? ' (change)' : '')).join(', '));
  });
}).on('error', (e) => { console.error('server not reachable:', e.message); process.exit(1); });
