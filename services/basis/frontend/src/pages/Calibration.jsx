import React from 'react'
import { ComposedChart, Scatter, Line, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { api, COLORS } from '../api.js'

export default function Calibration() {
  const [c, setC] = React.useState(null)
  const [err, setErr] = React.useState(null)
  React.useEffect(() => { api.calibration().then(setC).catch(e => setErr(String(e))) }, [])
  if (err) return <div className="card text-rose-300">{err}</div>
  if (!c) return <div className="text-slate-500">Loading…</div>
  const bins = c.bins.map(b => ({ x: b.raw_p, y: b.win_rate, n: b.n, bin: b.bin }))
  const curve = c.curve.map(p => ({ x: p.p, fit: p.p_cal }))
  const diag = [{ x: 0, d: 0 }, { x: 1, d: 1 }]
  const lowBins = c.bins.filter(b => b.hi <= 0.2)
  const low = lowBins.length ? lowBins.reduce((a, b) => a + b.n * (b.raw_p - b.win_rate), 0) / lowBins.reduce((a, b) => a + b.n, 0) : 0
  const hiBins = c.bins.filter(b => b.lo >= 0.8)
  const hi = hiBins.length ? hiBins.reduce((a, b) => a + b.n * (b.win_rate - b.raw_p), 0) / hiBins.reduce((a, b) => a + b.n, 0) : 0
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Are Kalshi prices calibrated?</h1>
        <p className="text-sm text-slate-400 mt-1">{c.n_markets.toLocaleString()} settled Kalshi markets. Price ~1 day before close vs. how often YES actually happened. Perfect calibration is the 45° line.</p>
      </div>
      <div className="grid gap-3 grid-cols-3">
        <div className="card py-3"><div className="text-xs text-slate-500">settled markets</div><div className="text-xl text-white mono">{c.n_markets.toLocaleString()}</div></div>
        <div className="card py-3"><div className="text-xs text-slate-500">longshots (≤20¢): price − win rate</div><div className="text-xl text-white mono">{(low * 100).toFixed(1)}pp</div></div>
        <div className="card py-3"><div className="text-xs text-slate-500">favorites (≥80¢): win rate − price</div><div className="text-xl text-white mono">{(hi * 100).toFixed(1)}pp</div></div>
      </div>
      <div className="card">
        <div className="h-[520px]">
          <ResponsiveContainer>
            <ComposedChart margin={{ top: 10, right: 30, bottom: 24, left: 10 }}>
              <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" />
              <XAxis dataKey="x" type="number" domain={[0, 1]} tickFormatter={v => `${Math.round(v * 100)}¢`} tick={{ fill: COLORS.text, fontSize: 11 }} label={{ value: 'market price (YES)', position: 'insideBottom', offset: -8, fill: COLORS.text, fontSize: 12 }} />
              <YAxis dataKey="y" type="number" domain={[0, 1]} tickFormatter={v => `${Math.round(v * 100)}%`} tick={{ fill: COLORS.text, fontSize: 11 }} width={48} label={{ value: 'empirical win rate', angle: -90, position: 'insideLeft', fill: COLORS.text, fontSize: 12 }} />
              <ZAxis dataKey="n" range={[40, 900]} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: '#0b0f14', border: '1px solid #1f2937', fontSize: 12 }}
                content={({ payload }) => {
                  const p = payload?.[0]?.payload
                  if (!p) return null
                  if (p.bin) return <div className="rounded border border-slate-700 bg-[#0b0f14] p-2 text-xs"><div className="text-white">bin {p.bin}</div><div>n = {p.n.toLocaleString()}</div><div>avg price {(p.x * 100).toFixed(1)}¢</div><div>win rate {(p.y * 100).toFixed(1)}%</div></div>
                  return <div className="rounded border border-slate-700 bg-[#0b0f14] p-2 text-xs"><div>price {(p.x * 100).toFixed(0)}¢ → calibrated {(p.fit * 100).toFixed(1)}%</div></div>
                }} />
              <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
              <Line data={diag} dataKey="d" name="perfect calibration" stroke={COLORS.ref} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
              <Line data={curve} dataKey="fit" name="isotonic fit" stroke={COLORS.proxy} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              <Scatter data={bins} name="5¢ bins (size = n)" fill={COLORS.kalshi} fillOpacity={0.75} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-xs text-slate-500 mt-2">Below the 45° line = buyers of YES overpaid at that price; above = underpaid. The isotonic fit is the monotone correction Basis applies to every raw price.</div>
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 text-xs text-slate-400"><tr><th className="px-3 py-2 text-left">bin</th><th className="px-3 py-2 text-right">n</th><th className="px-3 py-2 text-right">avg price</th><th className="px-3 py-2 text-right">win rate</th><th className="px-3 py-2 text-right">gap</th></tr></thead>
          <tbody>{c.bins.map(b => (
            <tr key={b.bin} className="border-b border-slate-800/60 mono">
              <td className="px-3 py-1.5 text-slate-300">{b.bin}</td><td className="px-3 py-1.5 text-right">{b.n.toLocaleString()}</td>
              <td className="px-3 py-1.5 text-right">{(b.raw_p * 100).toFixed(1)}¢</td><td className="px-3 py-1.5 text-right text-white">{(b.win_rate * 100).toFixed(1)}%</td>
              <td className={`px-3 py-1.5 text-right ${b.win_rate - b.raw_p < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{((b.win_rate - b.raw_p) * 100).toFixed(1)}pp</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  )
}
