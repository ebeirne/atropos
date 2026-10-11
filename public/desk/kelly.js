// How much to put on a contract: the Kelly criterion on a binary contract that pays $1.
// Shared by the server (lib) and the desk page, like atty/beats.js.
//
//   kelly({ p, price, capital, fraction, cap })
//     p        the calibrated probability the event happens (YES)
//     price    the YES price in dollars (0..1); NO costs 1 - price
//     capital  dollars you are willing to run this on
//     fraction share of full Kelly to use (default half: the usual hedge against a wrong p)
//     cap      most of capital on one contract (default 10%)
//
// Picks the side with the edge. For a side that costs c and pays 1 when right:
//   b = (1 - c) / c (net odds), q = 1 - pSuccess, f* = (pSuccess * b - q) / b.
(function (root) {
  function kelly(o) {
    var p = Number(o.p), price = Number(o.price), capital = Number(o.capital) || 0;
    var fraction = o.fraction == null ? 0.5 : Number(o.fraction), cap = o.cap == null ? 0.1 : Number(o.cap);
    if (!(p >= 0 && p <= 1) || !(price > 0 && price < 1)) return null;
    var side = p > price ? 'yes' : 'no';
    var cost = side === 'yes' ? price : 1 - price, pSuccess = side === 'yes' ? p : 1 - p;
    var b = (1 - cost) / cost, q = 1 - pSuccess;
    var full = (pSuccess * b - q) / b;                 // share of capital at full Kelly
    var edge = pSuccess - cost;                        // expected profit per $1 of payout
    if (full <= 0 || edge <= 0) return { side: side, pSuccess: pSuccess, cost: cost, b: b, edge: edge, fullKelly: Math.max(0, full), fraction: fraction, share: 0, dollars: 0, contracts: 0, capped: false };
    var share = Math.min(cap, full * fraction), capped = full * fraction > cap;
    var dollars = capital * share, contracts = Math.floor(dollars / cost);
    return { side: side, pSuccess: pSuccess, cost: cost, b: b, edge: edge, fullKelly: full, fraction: fraction, share: share, dollars: contracts * cost, contracts: contracts, payout: contracts, capped: capped };
  }
  var api = { kelly: kelly };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Kelly = api;
})(typeof window !== 'undefined' ? window : globalThis);
