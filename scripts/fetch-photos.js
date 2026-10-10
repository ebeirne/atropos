// Download the three approved release photos from Wikimedia Commons (owner approved,
// 2026-10-09) and record their licenses for the credit line.
//   node scripts/fetch-photos.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const UA = { 'User-Agent': 'Atropos/1.0 (local research tool)' };
const OUT = path.join(__dirname, '..', 'public', 'photos');
const FILES = {
  fomc: ['fed.jpg', 'Eccles Building (26088200676).jpg', 'The Eccles Building, home of the Federal Reserve Board'],
  cpi: ['cpi.jpg', 'Parsley for 99 cents, and other vegetables, in supermarket in Clearwater, Florida, US on 25 September 2020.jpg', 'Supermarket produce and its price tags'],
  nfp: ['nfp.jpg', '2025 - free download photo of a group of construction workers in working clothes, inspecting the last detals of their big finished job here, the renovation of c. 500 meter old quay along the canal street Nieuwe Herengracht in Amsterdam.tif', 'A construction crew at the end of a job'],
};

function get(u) {
  return new Promise((res, rej) => https.get(u, { headers: UA }, (r) => {
    const chunks = [];
    r.on('data', (d) => chunks.push(d));
    r.on('end', () => (r.statusCode === 200 ? res(Buffer.concat(chunks)) : rej(new Error(u.slice(0, 80) + ' -> ' + r.statusCode))));
  }).on('error', rej));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const credits = {};
  for (const [id, [file, title, alt]] of Object.entries(FILES)) {
    const meta = JSON.parse((await get('https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1200&titles=' + encodeURIComponent('File:' + title))).toString());
    const ii = Object.values(meta.query.pages)[0].imageinfo[0];
    const buf = await get(ii.thumburl);
    fs.writeFileSync(path.join(OUT, file), buf);
    const m = ii.extmetadata;
    credits[id] = { file: 'photos/' + file, alt, license: m.LicenseShortName.value,
      artist: String((m.Artist || {}).value || '').replace(/<[^>]+>/g, '').trim(), page: ii.descriptionurl };
    console.log(id, file, buf.length, 'bytes', credits[id].license);
  }
  fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(credits, null, 1));
  console.log('wrote public/photos/credits.json');
})().catch((e) => { console.error(e.message); process.exit(1); });
