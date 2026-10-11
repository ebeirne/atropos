// Build the two joined engines' own pages into the site: Basis at public/basis/, Leaf at
// public/leaf/. Both are served from a sub-folder (relative base, hash routes). Basis reads its
// API at ../api/basis (this server, or the static snapshot on GitHub Pages); Leaf runs on its
// built-in sample so the screener works with no backend, and the landing page shows a real scan.
//   node scripts/build-tools.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const liveLeaf = process.argv.includes('--live-leaf');
const jobs = [
  { name: 'basis', dir: path.join(root, 'services', 'basis', 'frontend'), out: path.join(root, 'public', 'basis'), env: { VITE_API_URL: '../api/basis' } },
  { name: 'leaf', dir: path.join(root, 'services', 'leaf', 'Frontend'), out: path.join(root, 'public', 'leaf'), env: {
    VITE_USE_API: String(liveLeaf), VITE_API_BASE: '../api/leaf',
  } },
];
for (const j of jobs) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  if (!fs.existsSync(path.join(j.dir, 'node_modules'))) execSync(`${npm} install --ignore-scripts --no-audit --no-fund --no-save`, { cwd: j.dir, stdio: 'inherit', shell: true });
  fs.rmSync(j.out, { recursive: true, force: true });
  execSync(`${npm} exec --no -- vite build --base=./ --outDir "${j.out}" --emptyOutDir`, { cwd: j.dir, stdio: 'inherit', shell: true, env: { ...process.env, ...j.env } });
  console.log(j.name, '->', path.relative(root, j.out));
}

// The research pages take the site's theme in reverse: paper, dark stars, the same fonts.
// Done to the built page, so Leaf's own source stays as upstream has it.
const leafPage = path.join(root, 'public', 'leaf', 'index.html');
let html = fs.readFileSync(leafPage, 'utf8');
html = html.replace('</head>', '    <link rel="preconnect" href="https://fonts.googleapis.com">\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,300..500&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">\n    <link rel="stylesheet" href="../leaf-theme.css">\n  </head>')
  .replace('<div id="root"></div>', '<canvas id="dust" data-scene="stars" aria-hidden="true"></canvas>\n    <div id="root"></div>\n    <script src="../dust.js"></script>');
fs.writeFileSync(leafPage, html);
console.log('leaf -> themed (public/leaf-theme.css, dust.js)');
