// Sends a strategy card to the backend's EX step and prints what EX will hand to Lego.
// Temporary dev aid: it only logs to the browser console. Nothing on screen changes.

const done = new Map(); // strategy key -> the promise of its result, so a card is only asked once

// The card's own words. The old hard-coded `requires` numbers are left out on purpose:
// EX should work the numbers out from the description, not copy them.
export function strategyText(s) {
  const parts = [s.label, s.summary, ...(Array.isArray(s.math) ? s.math : [])];
  return parts.filter(Boolean).join('. ').replace(/\.\s*\./g, '.').slice(0, 4000);
}

async function ask(text) {
  let res;
  try {
    res = await fetch('/api/ex/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: text }),
    });
  } catch {
    throw new Error('Cannot reach the Leaf API. Start the backend with: sh Backend/run.sh');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !body.detail && res.status === 502) throw new Error('Cannot reach the Leaf API. Start the backend with: sh Backend/run.sh');
  if (!res.ok) throw new Error(body.detail || `The server returned an error (${res.status}).`);
  return body;
}

export function logExSpec(key, strategy) {
  if (!done.has(key)) {
    const text = strategyText(strategy);
    done.set(key, ask(text).then((body) => ({ text, body })));
    done.get(key).catch(() => done.delete(key)); // a failure can be retried by clicking again
  }
  return done.get(key).then(
    ({ text, body }) => {
      console.groupCollapsed(`[EX] ${strategy.label || key} -> Lego (${body.attempts} attempt${body.attempts > 1 ? 's' : ''})`);
      console.log('Sent to EX:\n' + text);
      console.log('EX sends to Lego:\n' + JSON.stringify(body.spec, null, 2));
      console.groupEnd();
      return body.spec;
    },
    (err) => {
      console.error(`[EX] ${strategy.label || key}: ${err.message}`);
    },
  );
}