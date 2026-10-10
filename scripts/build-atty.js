// Stage Atty's page and its saved data in dist/atty for its own artifact, with her
// walkthrough lines checked by Jev and pre-recorded so the page can speak offline.
// Run the server first so the agent and benchmark snapshots are fresh:
//   curl /api/agent?run=1 > public/atty/agent.json ; curl /api/funds?tickers=... > public/atty/funds.json
//   node scripts/build-atty.js            (add --no-voice to skip recording)
require('../lib/env').load(require('path').join(__dirname, '..', '.env'));
const fs = require('fs'); const path = require('path');
const pub = path.join(__dirname, '..', 'public');
const out = path.join(__dirname, '..', 'dist', 'atty');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const f of ['index.html', 'agent.json', 'funds.json', 'thread.json', 'beats.js']) fs.copyFileSync(path.join(pub, 'atty', f), path.join(out, f));
  for (const f of ['tape.json', 'news-sample.json']) fs.copyFileSync(path.join(pub, f), path.join(out, f));
  // in the artifact the shared snapshots sit next to the page, not one folder up
  const page = path.join(out, 'index.html');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').split("'../tape.json'").join("'tape.json'").split("'../news-sample.json'").join("'news-sample.json'").split("'../photos/").join("'photos/"));
  // the release photos (public domain and CC0, credited on the page)
  fs.mkdirSync(path.join(out, 'photos'), { recursive: true });
  for (const f of ['cpi.jpg', 'fed.jpg', 'nfp.jpg', 'credits.json']) fs.copyFileSync(path.join(pub, 'photos', f), path.join(out, 'photos', f));

  // the walkthrough exactly as the saved page will build it
  const { beats } = require(path.join(pub, 'atty', 'beats.js'));
  const read = (f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
  const list = beats({ agent: read('agent.json'), funds: read('funds.json'), tape: read('tape.json'), thread: read('thread.json') });
  list.forEach((b, i) => console.log(`${i + 1}. ${b.say}${b.sub ? '  / ' + b.sub : ''}`));

  const jev = require('../lib/jev');
  if (jev.configured()) {
    const r = await jev.checkRationales(list.filter((b) => Object.keys(b.numbers).length).map((b) => ({ id: b.id, text: [b.say, b.sub].filter(Boolean).join(' '), numbers: b.numbers })));
    console.log('jev check:', Object.entries(r.checks).map(([k, v]) => `${k} ${v}`).join(' · '));
  }

  if (!process.argv.includes('--no-voice')) {
    const voice = require('../lib/voice');
    const dir = path.join(out, 'voice');
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    // a second copy next to the page in public/, so the GitHub Pages site can speak too
    const site = path.join(pub, 'atty', 'voice');
    fs.rmSync(site, { recursive: true, force: true }); fs.mkdirSync(site, { recursive: true });
    for (const b of list) {
      const mp3 = await voice.speak(b.say);
      fs.writeFileSync(path.join(dir, b.hash + '.mp3'), mp3); fs.writeFileSync(path.join(site, b.hash + '.mp3'), mp3);
    }
    console.log('recorded', list.length, 'lines with voice', voice.voiceId());
  }
  console.log('staged', fs.readdirSync(out).join(', '));
})().catch((e) => { console.error(e.message); process.exit(1); });
