import { FALLBACK } from './data/strategies.js';
import { sampleScan, sampleUniverse } from './data/sampleScan.js';

// Frontend only for now. Later, set VITE_USE_API=true in .env.development to call a real backend.
const LIVE = import.meta.env.VITE_USE_API === 'true';
const BASE = import.meta.env.VITE_API_BASE || ''; // '' = same origin (the Vite proxy in dev)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function parse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `The server returned an error (${res.status}).`);
  return body;
}

function request(url, options) {
  return fetch(BASE + url, options).then(parse, () => {
    throw new Error('Cannot reach the Leaf API. Check that the backend is running.');
  });
}

// Strategies are content the frontend owns: users read and learn from them.
export async function getStrategies() {
  return FALLBACK;
}

export async function getUniverse(provider) {
  return LIVE ? request(`/api/universe/${provider}`) : sampleUniverse(provider);
}

export async function scanMulti(body) {
  if (LIVE) {
    return request('/api/scan/multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  await wait(900);
  return sampleScan(body);
}