// Find freely licensed photos on Wikimedia Commons for each release (metadata only; nothing is downloaded).
const https = require('https');
function get(u) { return new Promise((res, rej) => https.get(u, { headers: { 'User-Agent': 'Atropos/1.0 (local research tool)' } }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => res(JSON.parse(b))); }).on('error', rej)); }
const Q = { fomc: 'Eccles Building Federal Reserve', cpi: 'grocery store shelves prices', nfp: 'construction workers job site' };
(async () => {
  for (const [id, q] of Object.entries(Q)) {
    const u = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=12&format=json&prop=imageinfo&iiprop=url|size|extmetadata|mime&iiurlwidth=1200&gsrsearch=' + encodeURIComponent(q + ' filetype:bitmap');
    const j = await get(u);
    const pages = Object.values((j.query || {}).pages || {});
    console.log('\n' + id + ' — ' + q);
    for (const p of pages) {
      const ii = p.imageinfo && p.imageinfo[0]; if (!ii) continue;
      const m = ii.extmetadata || {};
      const lic = (m.LicenseShortName || {}).value || '?';
      if (!/public domain|cc0|cc by(?!-nc)|cc-by(?!-nc)/i.test(lic) || /nc|nd/i.test(lic)) continue;
      const artist = String((m.Artist || {}).value || '').replace(/<[^>]+>/g, '').trim().slice(0, 50);
      console.log(`  ${p.title.slice(5, 70)} | ${lic} | ${artist} | ${ii.width}x${ii.height} | thumb1200 ${ii.thumburl ? 'yes' : 'no'} | ${ii.descriptionurl}`);
    }
  }
})().catch((e) => console.error(e.message));
