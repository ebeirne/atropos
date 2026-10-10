// Atty's walkthrough: one short sentence per step, built only from computed numbers
// (the agent's quotes, the 13F benchmark and the release odds). Shared by the page and
// by scripts/build-atty.js, which pre-records each line so the artifact can speak offline.
(function (root) {
  var FEE = 0.01;   // the per-contract cost lib/agent.js adds to every quote
  var NAME = { cpi: 'inflation report', nfp: 'jobs report', fomc: 'Fed decision' };
  var DAY_NAME = { cpi: 'inflation report', nfp: 'jobs report', fomc: 'Fed' };
  var SIDE_PHRASE = { 'cpi:high': 'Inflation came in above the month before', 'cpi:low': 'Inflation came in below the month before',
    'nfp:low': 'Job growth came in below the month before', 'nfp:high': 'Job growth came in above the month before' };
  var LONGM = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function monthName(releaseIso) { var m = +String(releaseIso).split('-')[1]; return LONGM[(m + 10) % 12]; }   // the month a release reports on
  function dayY(iso) { return day(iso) + ', ' + String(iso).slice(0, 4); }
  function money(x) { return '$' + Math.round(Math.abs(x)).toLocaleString('en-US'); }
  function money2(x) { return '$' + Number(x).toFixed(2); }
  function price(x) { var c = x * 100; return Math.abs(c - Math.round(c)) > 1e-6 ? '$' + Number(x).toFixed(3) : money2(x); }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function day(iso) { var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], p = String(iso).split('-'); return m[+p[1] - 1] + ' ' + (+p[2]); }
  function moveWord(x) { return (x < 0 ? 'drop ' : 'rise ') + Math.abs(x).toFixed(2) + '%'; }
  function bucket(id, label) {
    if (id === 'cpi') return label.replace('-', ' to ') + '%';
    if (id === 'nfp') return label.replace('-', 'K to ') + 'K jobs';
    return label;
  }
  // FNV-1a, so the page and the build name each recorded line the same way
  function hash(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }

  function beats(d) {
    var r = d.agent && d.agent.result; if (!r) return [];
    var hs = r.holdings, total = hs.reduce(function (s, h) { return s + h.value; }, 0);
    var sig = function (id) { return ((d.tape && d.tape.signals) || []).filter(function (s) { return s.id === id; })[0]; };
    var out = [];

    // 1. hello, and what is coming up
    var rows = ['cpi', 'fomc', 'nfp'].map(function (id) {
      var s = sig(id); if (!s) return null;
      var i = s.p.indexOf(Math.max.apply(null, s.p));
      return { name: NAME[id].charAt(0).toUpperCase() + NAME[id].slice(1), date: day(s.date), fav: bucket(id, s.labels[i]), p: pct(s.p[i]) };
    }).filter(Boolean);
    out.push({ id: 'hello', say: "Hi, I'm Atty. You have " + money(total) + ' in ' + hs.length + ' holdings, and I watch the reports that could move it.',
      show: { kind: 'reports', rows: rows }, numbers: { total: Math.round(total), holdings: hs.length } });

    // 2. the biggest risk
    var p = r.portfolio[0];
    if (p) {
      var odds = null; hs.forEach(function (h) { h.exposures.forEach(function (e) { if (e.release === p.release && e.side === p.side && odds == null) odds = e.odds; }); });
      var s2 = sig(p.release), hits = hs.map(function (h) { var e = h.exposures.filter(function (x) { return x.release === p.release && x.side === p.side; })[0]; return e ? { sym: h.symbol, loss: e.loss } : null; })
        .filter(Boolean).sort(function (a, b) { return b.loss - a.loss; }).slice(0, 4);
      out.push({ id: 'risk', say: 'If the ' + p.releaseName + (s2 ? ' on ' + day(s2.date) : '') + ' comes in ' + p.word + ', you could lose about ' + money(p.loss) + '.',
        sub: odds != null ? 'Markets give that a ' + pct(odds) + ' chance.' : '',
        show: { kind: 'hits', rows: hits.map(function (x) { return { sym: x.sym, loss: money(x.loss) }; }) },
        numbers: { release: p.release, side: p.side, loss: p.loss, odds: odds, date: s2 && s2.date } });

      // 3. the one trade, if it is worth it
      var k = p.knot;
      if (k && (k.verdict === 'good' || k.verdict === 'fair')) {
        out.push({ id: 'trade', say: 'You can cover all of it with one trade: ' + k.contracts + ' contracts on ' + p.best.venue + ' for ' + money2(k.cost) + '. ' +
            (k.verdict === 'good' ? "That's cheaper than the odds, so I'd take it." : "That's a fair price, so it's your call."),
          sub: 'They pay ' + money(k.payout) + ' if it happens.',
          show: { kind: 'trade', contract: p.best.contract, venue: p.best.venue, ask: price(p.best.ask + FEE), fair: p.best.fair != null ? price(p.best.fair) : 'n/a', cost: money2(k.cost), payout: money(k.payout) },
          numbers: { contracts: k.contracts, venue: p.best.venue, cost: k.cost, payout: k.payout, verdict: k.verdict } });
      }
    }

    // 3b. does it pay when you lose? (release-day history) and the fine print (contract terms)
    var th = d.thread || {};
    if (p && th.history && th.history.fits) {
      var f0 = th.history.fits[p.release + ':' + p.side], what = DAY_NAME[p.release];
      if (f0 && f0.lossDays) {
        var hr = f0.paidOnLoss / f0.lossDays;
        out.push({ id: 'fit', say: 'But does it pay when you lose? Since ' + f0.from.slice(0, 4) + ', your holdings fell half a percent or more on ' + f0.lossDays + ' ' + what + ' days. ' +
            SIDE_PHRASE[p.release + ':' + p.side] + ' on ' + (hr < 0.5 ? 'only ' : '') + f0.paidOnLoss + ' of them.',
          sub: hr >= 0.6 ? 'So this protection usually lines up with your losses.' : hr >= 0.4 ? "That's close to a coin flip, so don't count on it alone." : 'So it usually misses the days you actually lose.',
          show: { kind: 'fit', unit: p.release === 'cpi' ? '%' : 'K', rows: f0.worst.map(function (w) { return { date: dayY(w.date), ret: w.ret, value: w.value, before: w.before, happened: w.happened }; }) },
          numbers: { lossDays: f0.lossDays, paidOnLoss: f0.paidOnLoss, since: f0.from, test: 'came in above/below the month before, first print' } });
      }
    }
    if (p && th.fine) {
      var fn = th.fine[p.release + ':' + p.side];
      if (fn && fn.fallback && fn.fallback.basedOn) {
        var fb = fn.fallback, measured = monthName(fn.releaseDate);
        var how = fb.kind === 'formula' ? "settles on a formula from " + fb.basedOn.split(' ')[0] + "'s numbers, which works out to " + fb.value + '%'
          : 'settles on ' + fb.basedOn.split(' ')[0] + "'s number, " + fb.value + 'K';
        var prec = (fn.precedent || [])[0];
        out.push({ id: 'fine', say: 'One more thing in the fine print: if the government never publishes ' + measured + "'s number, this contract " + how + ', so it would ' + (fb.pays ? 'still pay.' : 'not pay.'),
          sub: prec ? 'That really happened in ' + prec.month + ', during the government shutdown.' : '',
          show: { kind: 'fine', stops: fn.stopsTrading + ', ' + day(fn.releaseDate), fallback: (fb.kind === 'formula' ? 'Formula on ' + fb.basedOn + ' CPI: ' + fb.value + '%' : fb.basedOn + ': ' + fb.value + 'K'), pays: fb.pays, latest: fn.latestSettle ? dayY(fn.latestSettle) : null, url: fn.url },
          numbers: { measuredMonth: measured, releaseDate: fn.releaseDate, ifNeverPublished: fb.kind === 'formula' ? 'settles on (last published CPI / CPI 12 months earlier)^(13/12) - 1, using ' + fb.basedOn + ' data' : 'settles on the last published month, ' + fb.basedOn, fallbackValue: fb.value + (fb.kind === 'formula' ? '%' : 'K'), contract: p.best.contract, contractPaysIfFallbackValue: fb.pays, precedent: prec ? prec.month + ': ' + prec.note : null } });
      }
    }

    // 4. the snip: protection that is not worth buying
    var q = r.portfolio.filter(function (x) { return x.knot && x.knot.verdict === 'overpriced'; })[0];
    if (q) {
      var raw = q.knot.overFair * 100, c = Math.round(raw), about = Math.abs(raw - c) > 0.05 ? 'about ' : '';
      out.push({ id: 'skip', snip: true, say: 'A ' + q.word + ' ' + q.releaseName + ' could cost you ' + money(q.loss) + ', but protection costs ' + about + c + (c === 1 ? ' cent' : ' cents') + " more per contract than the odds say it's worth. I'd skip it.",
        show: { kind: 'skip', contract: q.best.contract, ask: price(q.best.ask + FEE), fair: price(q.best.fair) },
        numbers: { release: q.release, side: q.side, loss: q.loss, ask: q.best.ask, fair: q.best.fair, overFair: q.knot.overFair } });
    } else {
      var small = null; hs.forEach(function (h) { var e = h.exposures[0]; if (!small && e && e.knot && e.knot.verdict === 'too_small') small = { sym: h.symbol, loss: e.loss }; });
      if (small) out.push({ id: 'skip', snip: true, say: small.sym + ' could only lose about ' + money(small.loss) + ". That's too small to be worth protecting, so I'd skip it.",
        show: { kind: 'skip' }, numbers: small });
    }

    // 5. next to the public funds
    var f = d.funds;
    if (f && f.ready) {
      var you = -hs.reduce(function (s, h) { var e = h.exposures.filter(function (x) { return x.release === 'cpi' && x.side === 'high'; })[0]; return s + (e ? e.loss : 0); }, 0) / total * 100;
      var kind = function (id) { var x = f.byKind.filter(function (y) { return y.kind === id; })[0]; return x && x.exposure.cpi ? x.exposure.cpi.high : null; };
      var st = kind('state_pension');
      if (st != null) {
        var diff = you - st, tail = Math.abs(diff) < 0.1 ? "You're about as exposed as they are." : diff < 0 ? "You're a bit more exposed than they are." : "You're a bit less exposed than they are.";
        var bars = [{ who: 'You', v: you, you: true }, { who: 'State pensions', v: st }, { who: 'City pensions', v: kind('municipal_pension') }, { who: 'Public universities', v: kind('public_university') }]
          .filter(function (b) { return b.v != null; });
        out.push({ id: 'peers', say: "If inflation runs hot, you'd " + moveWord(you) + '. State pensions would ' + moveWord(st) + '. ' + tail,
          show: { kind: 'bars', rows: bars }, numbers: { you: Math.round(you * 100) / 100, statePensions: st } });
      }
    }

    // 6. keeping score: her calls, settled once the numbers are out
    var calls = (th.ledger || []).slice();
    if (calls.length) {
      var done = calls.filter(function (c) { return c.settled; }), open = calls.filter(function (c) { return !c.settled; });
      var said = open.slice(0, 2).map(function (c) { return DAY_NAME[c.release] + ' on ' + day(c.releaseDate) + ', ' + c.call; });
      var lastDone = done[done.length - 1];
      out.push({ id: 'record', say: (lastDone
          ? 'Keeping score: on ' + day(lastDone.releaseDate) + ' I said ' + lastDone.call + ', and the protection ' + (lastDone.settled.paid ? 'paid.' : "didn't pay.") + ' '
          : "I keep score, so you can check me. ") + (said.length ? 'Still open: ' + said.join('; ') + '.' : ''),
        show: { kind: 'ledger', rows: calls.slice(-5).map(function (c) { return { date: day(c.releaseDate), what: DAY_NAME[c.release].replace(/^./, function (x) { return x.toUpperCase(); }) + ', ' + c.word, call: c.call,
          status: c.settled ? (c.settled.paid ? 'paid ' + money(c.payout) : 'no payout') : 'open' }; }) },
        numbers: { open: said, settled: done.length } });
    }

    // 7. the end
    out.push({ id: 'end', say: "That's this week. Ask me about anything in the news, or see everything below.", show: { kind: 'end' }, numbers: {} });
    out.forEach(function (b) { b.hash = hash(b.say); });
    return out;
  }

  var api = { beats: beats, hash: hash };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AttyBeats = api;
})(this);
