// Brokerage link through SnapTrade, personal-key mode: one person, their own
// accounts, no user registration. Robinhood and Fidelity are read-only on
// SnapTrade (the live brokerage list reports allows_trading=false for both), so
// this module reads holdings and never places orders.

const { Snaptrade, SnaptradeAuth } = require('snaptrade-typescript-sdk');

let client = null;

function configured() {
  return !!(process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY);
}

function api() {
  if (!configured()) throw new Error('SnapTrade keys are not set');
  if (!client) {
    client = new Snaptrade({
      auth: SnaptradeAuth.personalApiKey({
        clientId: process.env.SNAPTRADE_CLIENT_ID,
        consumerKey: process.env.SNAPTRADE_CONSUMER_KEY,
      }),
    });
  }
  return client;
}

function describe(e) {
  if (e && e.responseBody) return `${e.status || ''} ${JSON.stringify(e.responseBody).slice(0, 200)}`;
  return e && e.message ? e.message : String(e);
}

async function linkUrl(broker, redirect) {
  const { data } = await api().authentication.loginSnapTradeUser({
    broker, connectionType: 'read', customRedirect: redirect, immediateRedirect: true,
  });
  if (!data.redirectURI) throw new Error('SnapTrade returned no portal link');
  return data.redirectURI;
}

async function accounts() {
  const { data } = await api().accountInformation.listUserAccounts();
  return data.map((a) => ({
    id: a.id, broker: a.institution_name, name: a.name || a.institution_name,
    number: a.number ? '...' + String(a.number).slice(-4) : '',
  }));
}

function equityRow(acct, p) {
  const sym = p.symbol && p.symbol.symbol;
  const units = Number(p.units ?? p.fractional_units ?? 0);
  const price = Number(p.price ?? 0);
  return {
    account: acct.name, broker: acct.broker, type: 'equity',
    symbol: sym ? String(sym.symbol || sym.raw_symbol || '').toUpperCase() : '?',
    description: (sym && sym.description) || (p.symbol && p.symbol.description) || '',
    units, price, value: units * price,
    avgCost: p.average_purchase_price ?? null, openPnl: p.open_pnl ?? null,
  };
}

function optionRow(acct, p) {
  const o = p.symbol && p.symbol.option_symbol;
  const units = Number(p.units ?? 0);
  const price = Number(p.price ?? 0);
  return {
    account: acct.name, broker: acct.broker, type: 'option',
    symbol: o ? o.ticker : '?',
    underlying: o && o.underlying_symbol ? String(o.underlying_symbol.symbol || '').toUpperCase() : '',
    right: o ? String(o.option_type).toLowerCase() : '', strike: o ? o.strike_price : null,
    expiry: o ? o.expiration_date : null,
    units, price, value: units * price * (o && o.is_mini_option ? 10 : 100),
    avgCost: p.average_purchase_price ?? null,
  };
}

async function holdings() {
  const accts = await accounts();
  const rows = [];
  let cash = 0;
  for (const a of accts) {
    const { data } = await api().accountInformation.getUserHoldings({ accountId: a.id });
    for (const p of data.positions || []) rows.push(equityRow(a, p));
    for (const p of data.option_positions || []) rows.push(optionRow(a, p));
    for (const b of data.balances || []) if (b.cash != null) cash += Number(b.cash);
  }
  return { accounts: accts, positions: rows, cash };
}

// Quotes for proxies the user does not hold. Read-only connections often still
// serve quotes; when they do not, the caller falls back to reference prices.
async function quotes(accountId, symbols) {
  try {
    const { data } = await api().trading.getUserAccountQuotes({
      accountId, symbols: symbols.join(','), useTicker: true,
    });
    const out = {};
    for (const q of data || []) {
      const sym = q.symbol && (q.symbol.symbol || q.symbol.raw_symbol);
      const px = q.last_trade_price ?? ((q.bid_price + q.ask_price) / 2);
      if (sym && px) out[String(sym).toUpperCase()] = Number(px);
    }
    return out;
  } catch (_) { return {}; }
}

async function brokers() {
  const { data } = await api().referenceData.listAllBrokerages();
  return data.filter((b) => /^(ROBINHOOD|FIDELITY)$/.test(b.slug))
    .map((b) => ({ slug: b.slug, name: b.display_name || b.name, trading: !!b.allows_trading, enabled: !!b.enabled }));
}

module.exports = { configured, linkUrl, accounts, holdings, quotes, brokers, describe, __test: { equityRow, optionRow } };
