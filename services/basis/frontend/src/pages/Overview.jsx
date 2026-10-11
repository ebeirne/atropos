import React from 'react'
import { useNavigate } from 'react-router-dom'
import { api, pct, pp } from '../api.js'
import TrustPill from '../components/TrustPill.jsx'
import BeliefBox from '../components/BeliefBox.jsx'

const COLS = [
  ['title', 'Event', 'text-left'], ['p_raw', 'Raw p'], ['p_calibrated', 'Calibrated'], ['p_proxy', 'Proxy p'],
  ['basis', 'Basis'], ['basis_z', 'z'], ['trust_score', 'Trust'],
]

export default function Overview() {
  const [rows, setRows] = React.useState(null)
  const [div, setDiv] = React.useState([])
  const [sort, setSort] = React.useState({ k: 'trust_score', d: -1 })
  const [err, setErr] = React.useState(null)
  const nav = useNavigate()
  React.useEffect(() => {
    api.events().then(setRows).catch(e => setErr(String(e)))
    api.divergence().then(setDiv).catch(() => {})
  }, [])
  const sorted = React.useMemo(() => {
    if (!rows) return []
    const { k, d } = sort
    return [...rows].sort((a, b) => {
      const x = a[k], y = b[k]
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      return (x > y ? 1 : x < y ? -1 : 0) * d
    })
  }, [rows, sort])
  const th = (k, label, cls = 'text-right') => (
    <th key={k} onClick={() => setSort(s => ({ k, d: s.k === k ? -s.d : -1 }))}
      className={`px-3 py-2 text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-white ${cls}`}>
      {label}{sort.k === k ? (sort.d < 0 ? ' ↓' : ' ↑') : ''}
    </th>
  )
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Which prediction-market prices are actually a signal?</h1>
        <p className="text-sm text-slate-400 mt-1">Calibrated probability, basis vs. the traditional-market proxy, and a 0–100 trust score for each event. Click a row.</p>
      </div>
      <BeliefBox />
      {err && <div className="card text-rose-300 text-sm">Backend unreachable: {err}. Run <code>make dev</code> (or <code>make demo</code>).</div>}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800"><tr>{COLS.map(([k, l, c]) => th(k, l, c))}<th className="px-3 py-2 text-xs text-slate-400 text-right">Venues</th></tr></thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.id} onClick={() => nav(`/events/${r.id}`)} className="border-b border-slate-800/60 hover:bg-slate-800/40 cursor-pointer">
                <td className="px-3 py-2.5">
                  <div className="text-white">{r.title}</div>
                  <div className="text-xs text-slate-500">{r.category} · resolves {r.resolution_date}{r.settled ? ' · settled' : ''}{r.stale ? ' · ' : ''}{r.stale && <span className="text-amber-300">stale</span>}</div>
                </td>
                <td className="px-3 py-2 text-right mono">{pct(r.p_raw, 1)}</td>
                <td className="px-3 py-2 text-right mono text-white">{pct(r.p_calibrated, 1)}</td>
                <td className="px-3 py-2 text-right mono">{r.p_proxy == null ? <span className="text-slate-600">no proxy</span> : pct(r.p_proxy, 1)}</td>
                <td className={`px-3 py-2 text-right mono ${r.basis == null ? 'text-slate-600' : r.basis > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{r.p_proxy == null ? '—' : pp(r.basis)}</td>
                <td className="px-3 py-2 text-right mono text-slate-400">{r.basis_z == null ? '—' : r.basis_z.toFixed(1)}</td>
                <td className="px-3 py-2 text-right"><TrustPill score={r.trust_score} leak={r.leakage_flag} /></td>
                <td className="px-3 py-2 text-right text-xs">
                  {Object.keys(r.venues).map(v => <span key={v} className={`ml-1 rounded px-1.5 py-0.5 ${v === 'kalshi' ? 'bg-cyan-500/10 text-cyan-300' : 'bg-violet-500/10 text-violet-300'}`}>{v === 'kalshi' ? 'K' : 'P'}</span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {div.length > 0 && (
        <div className="card">
          <div className="text-sm font-medium text-white">Divergence feed <span className="text-slate-500 font-normal">— ranked by |basis z| × trust</span></div>
          <ol className="mt-2 space-y-1.5">
            {div.slice(0, 6).map((d, i) => (
              <li key={d.id} className="text-sm flex gap-3 cursor-pointer hover:text-white" onClick={() => nav(`/events/${d.id}`)}>
                <span className="text-slate-600 mono w-4">{i + 1}</span>
                <span className="text-slate-200 flex-1">{d.title}</span>
                <span className="text-slate-400 text-xs">{d.reason}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
