// Build the two joined engines' own pages into the site: Basis at public/basis/, Leaf at
// public/leaf/. Both are served from a sub-folder (relative base, hash routes). Basis reads its
// API at ../api/basis (this server, or the static snapshot on GitHub Pages); Leaf runs on its
// built-in sample so the screener works with no backend, and the landing page shows a real scan.
//   node scripts/build-tools.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const jobs = [
  { name: 'basis', dir: path.join(root, 'services', 'basis', 'frontend'), out: path.join(root, 'public', 'basis'), env: { VITE_API_URL: '../api/basis' } },
  { name: 'leaf', dir: path.join(root, 'services', 'leaf', 'Frontend'), out: path.join(root, 'public', 'leaf'), env: { VITE_USE_API: 'false' } },
];
for (const j of jobs) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  if (!fs.existsSync(path.join(j.dir, 'node_modules'))) execSync(`${npm} install --ignore-scripts --no-audit --no-fund --no-save`, { cwd: j.dir, stdio: 'inherit', shell: true });
  fs.rmSync(j.out, { recursive: true, force: true });
  execSync(`${npm} exec --no -- vite build --base=./ --outDir "${j.out}" --emptyOutDir`, { cwd: j.dir, stdio: 'inherit', shell: true, env: { ...process.env, ...j.env } });
  console.log(j.name, '->', path.relative(root, j.out));
}
