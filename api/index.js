// Vercel: every /api/* request comes here (see vercel.json) and runs the same server handler.
// Static files in public/ are served by Vercel itself. The agent runs on demand (no timer
// between requests), writes under data/ go to /tmp, and trades need DATABASE_URL to last.
const path = require('path');
process.env.ATROPOS_PUBLIC = process.env.ATROPOS_PUBLIC || '1';
require('../lib/tmpfs').install(path.join(__dirname, '..', 'data'), '/tmp/atropos-data');

const server = require('../server');
const agent = require('../lib/agent');
const ledger = require('../lib/ledger');

// one quick round when the instance starts; later rounds only if the instance lives that long
const round = agent.start(server.agentInputs, Number(process.env.AGENT_EVERY_MIN || 60) * 60000, async (result) => {
  ledger.record(result);
  await ledger.settle(result.holdings.map((h) => ({ symbol: h.symbol, value: h.value })));
});
server.setAgentRound(round);

module.exports = (req, res) => server.handle(req, res);
