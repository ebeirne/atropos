// Copy the static site into dist/horizon for publishing as its own artifact.
// The earlier dust design is kept, untouched, in releases/v8-dust and at its
// own artifact URL.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'public');
const out = path.join(__dirname, '..', 'dist', 'horizon');
const FILES = ['index.html', 'console.html', 'skin.css', 'dust.js', 'motion.js', 'ladder.js', 'pictures.js', 'demo.json', 'tape.json', 'venues.json', 'news-sample.json'];
fs.mkdirSync(out, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(src, f), path.join(out, f));
fs.mkdirSync(path.join(out, 'photos'), { recursive: true });
for (const f of fs.readdirSync(path.join(src, 'photos'))) fs.copyFileSync(path.join(src, 'photos', f), path.join(out, 'photos', f));
console.log('copied', FILES.length, 'files to', out);
