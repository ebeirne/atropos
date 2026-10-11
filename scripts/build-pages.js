// Build the static site for GitHub Pages from public/: every page falls back to the saved
// snapshots (tape.json, demo.json, atty/*.json, atty/voice/) when there is no server.
//   node scripts/build-pages.js [outDir]      (default _site)
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, '..', 'public');
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', '_site'));

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(pub, out, { recursive: true });

// The pages are authored in the artifact format (no doctype; the host adds it). The local
// server prepends one; Pages serves files as they are, so add it here or the browser
// renders in quirks mode.
let pages = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { walk(f); continue; }
    if (path.extname(f) !== '.html') continue;
    const html = fs.readFileSync(f, 'utf8');
    if (!/^\s*<!doctype/i.test(html)) { fs.writeFileSync(f, '<!doctype html>\n<meta charset="utf-8">\n' + html); pages++; }
  }
})(out);

// With no server, the engines' API paths are plain files: the same JSON the server would send.
const api = path.join(out, 'api');
const data = path.join(pub, 'data');
const put = (rel, body) => { const f = path.join(api, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body)); };
for (const [rel, src] of [['basis/calibration', 'basis/calibration.json'], ['basis/divergence', 'basis/divergence.json'], ['leaf/scan', 'leaf/scan.json']]) {
  put(rel, fs.readFileSync(path.join(data, src), 'utf8'));
}
// /api/basis/events is both the list and a folder of events, so the list is the folder's index
put('basis/events/index.html', fs.readFileSync(path.join(data, 'basis', 'events.json'), 'utf8'));
for (const f of fs.readdirSync(path.join(data, 'basis', 'events'))) put('basis/events/' + f.replace(/\.json$/, ''), fs.readFileSync(path.join(data, 'basis', 'events', f), 'utf8'));
put('basis/health', { ok: true, demo_mode: true, snapshot: true });
put('leaf/health', { ok: true, snapshot: true });

fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('built', out, '·', pages, 'pages given a doctype');
