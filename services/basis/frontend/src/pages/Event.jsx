import React from 'react'
import { useParams, Link } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { api, pct, pp, COLORS } from '../api.js'
import TrustPill from '../components/TrustPill.jsx'

function merge(h) {
  const m = new Map()
  for (const [k, rows] of Object.entries(h)) for (const r of rows) m.set(r.date, { ...(m.get(r.date) || { date: r.date }), [k]: r.p })
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export default function Event() {
  const { id } = useParams()
  const [ev, setEv] = React.useState(null)
  const [err, setErr] = React.useState(null)
  const [pNew, setPNew] = React.useState(null)
  const [sc, setSc] = React.useState(null)
  React.useEffect(() => { api.event(id).then(e => { setEv(e); setPNew(e.p_raw ?? 0.5) }).catch(e => setErr(String(e))) }, [id])
  React.useEffect(() => {
    if (pNew == null) return
    const t = setTimeout(() => api.scenario(id, pNew).then(setSc).catch(() => {}), 120)
    return () => clearTimeout(t)
  }, [id, pNew])
  if (err) return <div className="card text-rose-300">{err}</div>
  if (!ev) return <div className="text-slate-500">Loading…</div>
  const data = merge(ev.history)
  // single-point proxies (BTC options) → draw as a horizontal reference line instead
  const proxyPts = ev.history.proxy?.length || 0
  const trust = Object.entries(ev.venues)
  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-xs text-slate-500 hover:text-white">← all events</Link>
        <h1 className="text-2xl font-semibold text-white mt-1">{ev.title}</h1>
        <div className="text-sm text-slate-400">{ev.category} · resolves {ev.resolution_date} {ev.stale && <span className="text-amber-300 ml-2">stale data</span>}</div>
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        {[['Raw p', pct(ev.p_raw, 1)], ['Calibrated p', pct(ev.p_calibrated, 1)], ['Proxy p', ev.p_proxy == null ? 'no proxy' : pct(ev.p_proxy, 1)],
          ['Basis', ev.p_proxy == null ? '—' : pp(ev.basis)], ['Basis z', ev.basis_z == null ? '—' : ev.basis_z.toFixed(2)]].map(([k, v]) => (
          <div key={k} className="card py-3"><div className="text-xs text-slate-500">{k}</div><div className="text-xl text-white mono">{v}</div></div>
        ))}
      </div>

      <div className="card">
        <div className="flex items-baseline justify-between">
          <div className="text-sm font-medium text-white">Probability over time</div>
          <div className="text-xs text-slate-500">{ev.proxy_note}</div>
        </div>
        <div className="h-80 mt-3">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: COLORS.text, fontSize: 11 }} minTickGap={40} />
              <YAxis domain={[0, 1]} tickFormatter={v => `${Math.round(v * 100)}%`} tick={{ fill: COLORS.text, fontSize: 11 }} width={44} />
              <Tooltip contentStyle={{ background: '#0b0f14', border: '1px solid #1f2937', fontSize: 12 }} formatter={(v, n) => [pct(v, 1), n]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {ev.history.kalshi && <Line type="monotone" dataKey="kalshi" name="Kalshi" stroke={COLORS.kalshi} dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />}
              {ev.history.polymarket && <Line type="monotone" dataKey="polymarket" name="Polymarket" stroke={COLORS.polymarket} dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />}
              {proxyPts > 1 && <Line type="stepAfter" dataKey="proxy" name={`Proxy (${ev.proxy_type})`} stroke={COLORS.proxy} dot={false} strokeWidth={2} strokeDasharray="5 3" connectNulls isAnimationActive={false} />}
              {proxyPts === 1 && <ReferenceLine y={ev.p_proxy} stroke={COLORS.proxy} strokeDasharray="5 3" label={{ value: `proxy ${pct(ev.p_proxy)}`, fill: COLORS.proxy, fontSize: 11, position: 'insideTopRight' }} />}
              {ev.proxy?.meeting_date && <ReferenceLine x={ev.proxy.meeting_date} stroke={COLORS.ref} label={{ value: 'FOMC', fill: COLORS.text, fontSize: 11 }} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {ev.proxy_detail && <div className="text-xs text-slate-500 mt-2 mono">{ev.proxy_detail}</div>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="text-sm font-medium text-white">Trust score breakdown</div>
          {trust.map(([v, d]) => (
            <div key={v} className="mt-3">
              <div className="flex items-center justify-between text-sm">
                <span className={v === 'kalshi' ? 'text-cyan-300' : 'text-violet-300'}>{v} <span className="text-slate-500 text-xs">p={pct(d.p, 1)} · vol24h ${Math.round(d.volume_24h || 0).toLocaleString()} · spread {d.spread == null ? '—' : (d.spread * 100).toFixed(1) + '¢'}</span></span>
                <TrustPill score={d.trust.score} leak={d.trust.leakage_flag} />
              </div>
              <div className="mt-2 space-y-1.5">
                {Object.entries(d.trust.components).map(([k, x]) => (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-24 text-slate-400">{k} <span className="text-slate-600">×{d.trust.weights[k]}</span></span>
                    <div className="flex-1 h-2 rounded bg-slate-800 overflow-hidden"><div className="h-full bg-amber-400" style={{ width: `${x * 100}%` }} /></div>
                    <span className="w-8 text-right mono text-slate-300">{x.toFixed(2)}</span>
                  </div>
                ))}
                <div className="text-xs text-slate-500">horizon multiplier {d.trust.horizon_multiplier} · {d.trust.inputs.hours_since_trade ?? '—'}h since last trade · top10 holders {d.trust.inputs.top10_holder_share == null ? 'n/a' : pct(d.trust.inputs.top10_holder_share)}</div>
                {d.trust.leakage_flag && <div className="text-xs text-amber-300">⚠ largest single trade (${Math.round(d.largest_trade_24h).toLocaleString()}) &gt; 5% of 24h volume</div>}
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="text-sm font-medium text-white">What moves if this flips <span className="text-slate-500 font-normal text-xs">— co-movement, not causation</span></div>
          <div className="mt-3 flex items-center gap-3 text-sm">
            <span className="text-slate-400 w-16">p_new</span>
            <input type="range" min="0" max="1" step="0.01" value={pNew ?? 0.5} onChange={e => setPNew(parseFloat(e.target.value))} className="flex-1" />
            <span className="mono text-white w-14 text-right">{pct(pNew)}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">now {pct(ev.p_raw, 1)} → {pct(pNew)} ({pp((pNew ?? 0) - (ev.p_raw ?? 0))})</div>
          <table className="w-full text-sm mt-3">
            <thead><tr className="text-xs text-slate-500"><th className="text-left py-1">asset</th><th className="text-right">β / pp</th><th className="text-right">R²</th><th className="text-right">n</th><th className="text-right">expected move</th></tr></thead>
            <tbody>
              {(sc?.moves || ev.betas).map(b => (
                <tr key={b.ticker} className="border-t border-slate-800/60">
                  <td className="py-1.5 text-white">{b.ticker}</td>
                  <td className="text-right mono text-slate-300">{b.beta_per_pp == null ? '—' : b.beta_per_pp.toFixed(3)}</td>
                  <td className="text-right mono text-slate-500">{b.r2 == null ? '—' : b.r2.toFixed(2)}</td>
                  <td className="text-right mono text-slate-500">{b.n_obs}</td>
                  <td className={`text-right mono ${b.expected_move_pct == null ? 'text-slate-600' : b.expected_move_pct > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{b.expected_move_pct == null ? '—' : `${b.expected_move_pct > 0 ? '+' : ''}${b.expected_move_pct.toFixed(2)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-xs text-slate-500 mt-2">{ev.betas_note}</div>
        </div>
      </div>
    </div>
  )
}
