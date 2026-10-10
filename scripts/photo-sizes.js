// HEAD each chosen photo's 1200px rendition to report its size (nothing downloaded).
const https = require('https');
const UA = { 'User-Agent': 'Atropos/1.0 (local research tool)' };
const FILES = {
  fomc: 'Eccles Building (26088200676).jpg',
  cpi: 'Parsley for 99 cents, and other vegetables, in supermarket in Clearwater, Florida, US on 25 September 2020.jpg',
  nfp: '2025 - free download photo of a group of construction workers in working clothes, inspecting the last detals of their big finished job here, the renovation of c. 500 meter old quay along the canal street Nieuwe Herengracht in Amsterdam.tif',
};
function get(u) { return new Promise((res, rej) => https.get(u, { headers: UA }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => res(JSON.parse(b))); }).on('error', rej)); }
function head(u) { return new Promise((res) => { const req = https.request(u, { method: 'HEAD', headers: UA }, (r) => res({ status: r.statusCode, len: r.headers['content-length'], type: r.headers['content-type'] })); req.on('error', (e) => res({ err: e.message })); req.end(); }); }
(async () => {
  for (const [id, f] of Object.entries(FILES)) {
    const j = await get('https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1200&titles=' + encodeURIComponent('File:' + f));
    const ii = Object.values(j.query.pages)[0].imageinfo[0];
    const h = await head(ii.thumburl);
    const m = ii.extmetadata;
    console.log(JSON.stringify({ id, url: ii.thumburl, bytes: h.len, type: h.type, license: m.LicenseShortName.value, artist: String((m.Artist || {}).value || '').replace(/<[^>]+>/g, '').trim(), page: ii.descriptionurl }));
  }
})();
