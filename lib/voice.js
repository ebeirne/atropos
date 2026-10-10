// Atty's voice: ElevenLabs text to speech, cached on disk by the hash of the line so a
// line is only ever paid for once. The voice is Jev's pick (data/voice-jev.json).
const fs = require('fs');
const path = require('path');
const { hash } = require('../public/atty/beats');

const DIR = path.join(__dirname, '..', 'data', 'voice');
const MODEL = 'eleven_flash_v2_5';
const MAX_CHARS = 300;
const PER_HOUR = 40;               // new recordings per hour, so a stuck page cannot drain credits
let made = [];

function voiceId() {
  if (process.env.ATTY_VOICE_ID) return process.env.ATTY_VOICE_ID;
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'voice-jev.json'), 'utf8')).voice_id; } catch (_) { return 'cgSgspJ2msm6clMCkdW9'; }
}
function configured() { return !!process.env.ELEVENLABS_API_KEY; }
/** What she actually says: the written line, with symbols read the way people say them. */
function spoken(text) { return String(text).replace(/−/g, 'minus ').replace(/\bIBKR\b/g, 'Interactive Brokers'); }
function fileFor(text) { return path.join(DIR, hash(text) + '.mp3'); }

async function speak(text) {
  text = String(text || '').trim();
  if (!text || text.length > MAX_CHARS) throw Object.assign(new Error('line must be 1 to ' + MAX_CHARS + ' characters'), { code: 400 });
  const file = fileFor(text);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  if (!configured()) throw Object.assign(new Error('ELEVENLABS_API_KEY is not set'), { code: 503 });
  const now = Date.now(); made = made.filter((t) => now - t < 3600e3);
  if (made.length >= PER_HOUR) throw Object.assign(new Error('voice limit reached for this hour'), { code: 429 });
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId()}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: spoken(text), model_id: MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2 } }),
  });
  if (!r.ok) throw Object.assign(new Error('ElevenLabs ' + r.status + ': ' + (await r.text()).slice(0, 160)), { code: 502 });
  const buf = Buffer.from(await r.arrayBuffer());
  made.push(now);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, buf);
  return buf;
}

function cached(text) { text = String(text || '').trim(); return !!text && text.length <= MAX_CHARS && fs.existsSync(fileFor(text)); }

module.exports = { speak, cached, configured, fileFor, voiceId, MODEL };
