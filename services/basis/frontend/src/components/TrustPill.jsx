import { trustColor } from '../api.js'
export default function TrustPill({ score, leak }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium mono ${trustColor(score)}`}>
      {score}
      {leak && <span title="Leakage flag: a single trade in the last 24h exceeded 5% of 24h volume">⚠</span>}
    </span>
  )
}
