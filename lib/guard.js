// Guards for the public demo (ATROPOS_PUBLIC=1). Off when you run it on your own machine.
//
// - each caller gets a small allowance per endpoint, and every endpoint has an hourly ceiling,
//   so nobody can run up the Jev, Claude or ElevenLabs bills;
// - Atty only records new audio for lines her own beats produce, so the voice endpoint cannot
//   be used to make her say anything else.
const PUBLIC = process.env.ATROPOS_PUBLIC === '1';

// [per caller, window ms, overall per hour]
const LIMITS = {
  try: [6, 10 * 60e3, 120],      // your own tickers: Jev classify + an agent round each
  news: [20, 10 * 60e3, 600],
  voice: [40, 10 * 60e3, 3000],  // mostly cached files; new recordings are capped in lib/voice.js too
  api: [120, 60e3, 30000],       // everything else
};
const hits = new Map();

function ip(req) {
  return String(req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '?').trim();
}

/** May this caller make one more request of this kind? Counts it if so. */
function allow(req, kind) {
  if (!PUBLIC) return true;
  const [n, ms, total] = LIMITS[kind] || LIMITS.api, now = Date.now();
  const k = kind + ':' + ip(req), g = kind + ':*';
  const mine = (hits.get(k) || []).filter((t) => now - t < ms);
  const all = (hits.get(g) || []).filter((t) => now - t < 3600e3);
  const ok = mine.length < n && all.length < total;
  if (ok) { mine.push(now); all.push(now); }
  hits.set(k, mine); hits.set(g, all);
  if (hits.size > 50000) hits.clear();
  return ok;
}

const lines = new Map();
function allowLines(list) {
  const now = Date.now();
  for (const t of list) if (t) lines.set(String(t).trim(), now);
  if (lines.size > 3000) for (const [t] of [...lines].sort((a, b) => a[1] - b[1]).slice(0, lines.size - 3000)) lines.delete(t);
}
function lineAllowed(t) { return !PUBLIC || lines.has(String(t || '').trim()); }

module.exports = { PUBLIC, allow, allowLines, lineAllowed, ip };
