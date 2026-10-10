// Holdings normalisation against the shapes in snaptrade-typescript-sdk's own
// type definitions (Position.symbol.symbol.symbol, OptionsPosition.symbol.option_symbol).
const assert = require('assert');
const { __test: { equityRow, optionRow } } = require('../lib/snaptrade');

const acct = { name: 'Robinhood Individual', broker: 'Robinhood' };

const eq = equityRow(acct, {
  symbol: { id: 'x', description: 'NVIDIA CORP', symbol: { id: 'y', symbol: 'nvda', raw_symbol: 'NVDA', description: 'NVIDIA CORP', currency: {} } },
  units: 12.5, price: 186.5, average_purchase_price: 120.1, open_pnl: 830,
});
assert.strictEqual(eq.symbol, 'NVDA');
assert.strictEqual(eq.type, 'equity');
assert.ok(Math.abs(eq.value - 12.5 * 186.5) < 1e-9);
assert.strictEqual(eq.description, 'NVIDIA CORP');
console.log('ok   equity row', eq.symbol, eq.units, eq.value);

const frac = equityRow(acct, { symbol: { symbol: { symbol: 'VOO' } }, units: null, fractional_units: 0.37, price: 610 });
assert.ok(Math.abs(frac.value - 0.37 * 610) < 1e-9);
console.log('ok   fractional shares fall back to fractional_units');

const op = optionRow(acct, {
  symbol: { option_symbol: { id: 'o', ticker: 'NVDA  261120C00200000', option_type: 'CALL', strike_price: 200,
    expiration_date: '2026-11-20', underlying_symbol: { symbol: 'NVDA' } } },
  units: 2, price: 6.1,
});
assert.strictEqual(op.type, 'option');
assert.strictEqual(op.underlying, 'NVDA');
assert.strictEqual(op.right, 'call');
assert.strictEqual(op.value, 2 * 6.1 * 100);
console.log('ok   option row', op.underlying, op.strike, op.right, op.expiry, op.value);

const mini = optionRow(acct, { symbol: { option_symbol: { ticker: 'AAPL7', option_type: 'PUT', strike_price: 240,
  expiration_date: '2026-12-18', is_mini_option: true, underlying_symbol: { symbol: 'AAPL' } } }, units: 1, price: 2 });
assert.strictEqual(mini.value, 20);
console.log('ok   mini options use a 10-share multiplier');
console.log('\n4 passed');
