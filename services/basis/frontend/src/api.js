const BASE = import.meta.env.VITE_API_URL || '/api'
async function j(path, opts) {
  const r = await fetch(BASE + path, opts)
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json()
}
export const api = {
  events: () => j('/events'),
  event: id => j(`/events/${id}`),
  calibration: () => j('/calibration'),
  divergence: () => j('/divergence'),
  arb: () => j('/arb'),
  health: () => j('/health'),
  scenario: (event_id, p_new) => j('/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_id, p_new }) }),
  belief: belief => j('/belief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ belief }) }),
}
export const pct = (x, d = 0) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`)
export const pp = x => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`)
export const COLORS = { kalshi: '#22d3ee', polymarket: '#a78bfa', proxy: '#f59e0b', grid: '#1f2937', text: '#94a3b8', ref: '#475569' }
export function trustColor(s) { return s >= 70 ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : s >= 40 ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-rose-500/15 text-rose-300 border-rose-500/30' }
