# Basis — pitch

## 90-second script

> Prediction markets now trade tens of billions of dollars a month, and trading desks have started
> reading them as signals. There's a problem: the raw odds are a bad signal. They're biased — the
> favorite–longshot bias is in every betting market ever studied — they're often thin, and they
> sometimes lag the real market by weeks.
>
> **Basis** is the trust layer. For every event we pull Kalshi and Polymarket, and we answer three
> questions. One: what's the *calibrated* probability? We fit an isotonic curve on 628 settled
> Kalshi markets using the price a day before close — a 40¢ contract resolved YES 30% of the time,
> a 98¢ contract only 84%. Two: what's the *basis* — how far is the prediction market
> from what the traditional market already implies? For the Fed we use fed-funds futures; for Bitcoin,
> Deribit option-implied probabilities. Three: should you *trust* this price at all? A 0–100 score
> from liquidity, spread, freshness, holder concentration and horizon, with a leakage flag when one
> trade dominates the tape.
>
> Then we tell you what moves. Event betas: if the odds flip, here's the expected co-movement in
> TLT, XLF, the dollar, bitcoin. Drag the slider.
>
> And you don't need to know the tickers. Type "the Fed hikes twice by December" and Claude maps
> it to the right events and explains, in two sentences, why the venues and the proxy disagree.
>
> The September FOMC is the demo: futures were at 90% for a hike by mid-June. Polymarket sat at 35%
> for two more months. That gap was the trade. Basis finds the next one.

## The three money charts

1. **Calibration curve** (`/calibration`). 628 settled Kalshi markets, 5¢ bins sized by n, isotonic
   fit vs. the 45° line. What the data actually says: contracts priced 20–45¢ resolved YES only ~30%
   of the time, 60–80¢ contracts resolved YES ~50%, and 95¢+ "sure things" resolved YES 84% — so
   buyers of mid-priced *and* near-certain YES overpaid, while 85–95¢ was well calibrated. The curve
   is the correction. Export: `data/charts/calibration.png`.
2. **Polymarket/Kalshi vs. fed-funds-implied P(hike), Sept 2026 FOMC** (`/events/fomc-2026-09`).
   The dashed futures line leads; the venues lag by ~2 months. Then the same chart for Dec 2026
   (`/events/fomc-2026-12`): futures 86%, venues 72–75% — the basis is open *right now*.
3. **Belief search → trust** (overview page). Type a belief, get matched cards with calibrated p,
   basis and trust pill, plus Claude's two-sentence explanation.

## Likely judge questions — one-line answers

- **Why not just use the raw odds?** Because a 10¢ contract isn't a 10% event — it resolves YES far less
  often — and a price with $300 of daily volume and one whale holding 98% isn't a market, it's a rumor.
- **Who pays for this?** Macro and event-driven desks already paying for alternative data; the output
  is a calibrated, trust-weighted probability feed plus a basis signal they can put in a model.
- **What's the hardest part?** Matching events across venues and to a traditional proxy. We hand-curated
  16; doing it generically (same resolution criteria, same date, same strike) is the real product.
- **Is the basis tradable?** Sometimes — the Sept FOMC gap was. Fees and half-spreads eat small gaps;
  `/arb` shows the fee-adjusted cross-venue gap and it is usually negative.
- **Why is calibration from Kalshi only?** Kalshi exposes settled markets with `result`; we use the
  pre-close candlestick, not the post-resolution last print. Polymarket calibration is a follow-up.
- **Risk-neutral vs. real-world?** Option-implied N(d2) has no risk premium and is a terminal, not
  touch, probability. We label it, and it's why BTC basis skews positive.
- **Betas are causal?** No — co-movement, labelled as such in the API, with R² and n shown.

## Demo checklist

```
make demo            # DEMO_MODE=1 — no external calls, serves data/snapshot
open http://localhost:5173
```
1. Overview → sort by trust → point at a leakage ⚠ → click the Dec FOMC row.
2. Dec FOMC event: futures above both venues; drag slider to 100% → TLT/XLF expected moves.
3. Sept FOMC event: the lag.
4. Calibration page.
5. Back to overview → belief box → "the Fed hikes twice by December".
