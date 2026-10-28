const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('../utils/api');

// C19: a listener that re-subscribes while being notified (ui.subscribe does this when a reset
// re-loads the page) must not be revisited by the same notification, and a listener removed
// during notification must not run afterwards.
test('session notification iterates a snapshot: re-subscribing listeners run once', () => {
  const client = createClient({ request() {} });
  let calls = 0;
  let unsubscribe;
  const listener = () => {
    calls++;
    if (calls > 50) throw new Error('re-entrant loop');
    unsubscribe();
    unsubscribe = client.onSessionChange(listener);
  };
  unsubscribe = client.onSessionChange(listener);
  client.clearSession();
  assert.equal(calls, 1);
  client.clearSession();
  assert.equal(calls, 2, 'the re-added listener still receives the next change');
});

test('a listener removed by an earlier listener in the same notification does not run', () => {
  const client = createClient({ request() {} });
  const seen = [];
  let offB;
  client.onSessionChange(() => {
    seen.push('a');
    offB();
  });
  offB = client.onSessionChange(() => seen.push('b'));
  client.clearSession();
  assert.deepEqual(seen, ['a']);
});
