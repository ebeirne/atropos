import React from 'react'
import ReactDOM from 'react-dom/client'
// Hash routes, so the built app can be served from any folder (the Atropos site, GitHub Pages).
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import './index.css'
import Overview from './pages/Overview.jsx'
import Event from './pages/Event.jsx'
import Calibration from './pages/Calibration.jsx'
import { api } from './api.js'

function Shell() {
  const [health, setHealth] = React.useState(null)
  React.useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ ok: false })) }, [])
  const link = ({ isActive }) => `px-3 py-1.5 rounded-md text-sm ${isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-800 bg-[#0b0f14]/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-6">
          <NavLink to="/" className="font-semibold tracking-tight text-white text-lg">Basis<span className="text-amber-400">.</span></NavLink>
          <nav className="flex gap-1">
            <NavLink to="/" end className={link}>Overview</NavLink>
            <NavLink to="/calibration" className={link}>Calibration</NavLink>
          </nav>
          <div className="ml-auto text-xs text-slate-500 flex items-center gap-3">
            {health?.demo_mode && <span className="rounded border border-amber-500/40 text-amber-300 px-2 py-0.5">DEMO SNAPSHOT</span>}
            {health && !health.ok && <span className="rounded border border-rose-500/40 text-rose-300 px-2 py-0.5">API DOWN</span>}
            {health?.last_refresh?.ts && <span>refreshed {new Date(health.last_refresh.ts).toLocaleTimeString()}</span>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/events/:id" element={<Event />} />
          <Route path="/calibration" element={<Calibration />} />
        </Routes>
      </main>
    </div>
  )
}
ReactDOM.createRoot(document.getElementById('root')).render(<HashRouter><Shell /></HashRouter>)
