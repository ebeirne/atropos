// Read-only SnapTrade smoke test: API status, linked accounts, broker slugs,
// and whether a connection-portal link can be generated. Places no orders.
const path = require('path');
require('../lib/env').load(path.join(__dirname, '..', '.env'));
const { Snaptrade, SnaptradeAuth } = require('snaptrade-typescript-sdk');

const st = new Snaptrade({
  auth: SnaptradeAuth.personalApiKey({
    clientId: process.env.SNAPTRADE_CLIENT_ID,
    consumerKey: process.env.SNAPTRADE_CONSUMER_KEY,
  }),
});

async function step(name, fn) {
  const t = Date.now();
  try {
    const out = await fn();
    console.log(`ok   ${name} (${Date.now() - t}ms)`, out === undefined ? '' : out);
  } catch (e) {
    const body = e.responseBody ? JSON.stringify(e.responseBody).slice(0, 220) : e.message;
    console.log(`FAIL ${name} (${Date.now() - t}ms) status=${e.status || ''} ${body}`);
  }
}

(async () => {
  await step('api status', async () => (await st.apiStatus.check()).data);

  await step('linked accounts', async () => {
    const { data } = await st.accountInformation.listUserAccounts();
    return data.length + ' account(s)' +
      (data.length ? ': ' + data.map((a) => `${a.institution_name} ${a.name || ''}`.trim()).join(', ') : '');
  });

  await step('broker slugs', async () => {
    const { data } = await st.referenceData.listAllBrokerages();
    const want = data.filter((b) => /robinhood|fidelity/i.test(b.name || b.display_name || b.slug || ''));
    return want.map((b) => `${b.display_name || b.name} -> slug=${b.slug} trading=${b.allows_trading} enabled=${b.enabled}`).join(' | ');
  });

  for (const broker of ['ROBINHOOD', 'FIDELITY']) {
    await step(`portal link (${broker})`, async () => {
      const { data } = await st.authentication.loginSnapTradeUser({ broker, connectionType: 'read' });
      return data.redirectURI ? 'got link on ' + new URL(data.redirectURI).host : JSON.stringify(data).slice(0, 120);
    });
  }
})();
