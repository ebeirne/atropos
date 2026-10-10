// Minimal .env loader. Existing process.env values win, so a real environment
// variable always overrides the file.
const fs = require('fs');

function load(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return false; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
  return true;
}

module.exports = { load };
