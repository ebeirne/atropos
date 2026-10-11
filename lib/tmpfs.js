// On Vercel the deployment is read-only, but the app keeps small caches and records under
// data/ (odds archive, ledger, voice recordings, trades without a database). This sends every
// write under data/ to /tmp/data instead, and reads from there first when a copy exists, so the
// same code runs unchanged. Nothing survives the instance; the durable store is the database.
const fs = require('fs');
const path = require('path');

function install(dataDir, tmpDir) {
  const real = path.resolve(dataDir), tmp = path.resolve(tmpDir);
  const under = (p) => typeof p === 'string' && path.resolve(p).startsWith(real + path.sep);
  const map = (p) => path.join(tmp, path.relative(real, path.resolve(p)));
  const pick = (p) => (under(p) && fs.existsSync(map(p)) ? map(p) : p);
  const orig = {};
  for (const k of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'unlinkSync', 'renameSync', 'createWriteStream']) {
    orig[k] = fs[k];
    fs[k] = function (p, ...rest) {
      if (under(p)) { const t = map(p); if (k !== 'mkdirSync') orig.mkdirSync.call(fs, path.dirname(t), { recursive: true }); p = t; }
      if (k === 'renameSync' && under(rest[0])) rest[0] = map(rest[0]);
      return orig[k].call(fs, p, ...rest);
    };
  }
  for (const k of ['readFileSync', 'existsSync', 'statSync', 'readdirSync', 'createReadStream']) {
    orig[k] = fs[k];
    fs[k] = function (p, ...rest) { return orig[k].call(fs, pick(p), ...rest); };
  }
  const origPromises = { writeFile: fs.promises.writeFile, readFile: fs.promises.readFile, mkdir: fs.promises.mkdir };
  fs.promises.writeFile = async (p, ...rest) => { if (under(p)) { const t = map(p); await origPromises.mkdir(path.dirname(t), { recursive: true }); p = t; } return origPromises.writeFile(p, ...rest); };
  fs.promises.readFile = (p, ...rest) => origPromises.readFile(pick(p), ...rest);
  fs.promises.mkdir = (p, ...rest) => origPromises.mkdir(under(p) ? map(p) : p, ...rest);
}

module.exports = { install };
