import { PROVIDER_LABELS } from '../format.js';

export default function ScanControls({
  providers, provider, onProvider,
  days, onDays,
  tickers, onTickers, onLoadDefaults,
  onScan, busy, selectedCount,
}) {
  const disabled = busy || selectedCount === 0;
  return (
    <form
      className="controls"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onScan();
      }}
    >
      <div className="field">
        <label htmlFor="provider">Data source</label>
        <select id="provider" value={provider} onChange={(e) => onProvider(e.target.value)}>
          {providers.map((p) => (
            <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="days">Lookback in trading days</label>
        <input
          id="days"
          type="number"
          min="120"
          max="2500"
          step="10"
          value={days}
          onChange={(e) => onDays(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="tickers">Tickers</label>
        <textarea
          id="tickers"
          rows="3"
          value={tickers}
          placeholder="Leave blank to scan the default universe"
          onChange={(e) => onTickers(e.target.value)}
        />
        <button type="button" className="link" onClick={onLoadDefaults}>
          Fill in the default universe
        </button>
      </div>

      <button type="submit" className="primary" disabled={disabled}>
        {busy ? 'Scanning…' : selectedCount === 0 ? 'Pick a strategy first' : 'Find pairs'}
      </button>
    </form>
  );
}