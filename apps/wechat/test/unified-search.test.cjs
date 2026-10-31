const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const page = () => loadPage({ root, route: 'pages/search/index', wx: createWx() });
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
test('public search omits credentials, binds its captured filters and ignores a changed query response', async () => {
  const h = page(),
    wait = deferred(),
    calls = [];
  h.page.onLoad({ q: '青锋' });
  h.requireLocal('utils/api.js').getClient = () => ({
    request: async (...args) => {
      calls.push(args);
      return wait.promise;
    },
  });
  const pending = h.page.search();
  assert.equal(calls[0][3], true);
  assert.match(calls[0][0], /^\/v1\/public\/search\?q=/);
  h.page.input({ currentTarget: { dataset: { field: 'query' } }, detail: { value: '另一队' } });
  wait.resolve({
    data: {
      items: [{ kind: 'TEAM', publicKey: 'a'.repeat(43), displayName: '旧名' }],
      nextCursor: null,
    },
  });
  await pending;
  assert.deepEqual(h.page.data.items, []);
  assert.equal(h.page.data.query, '另一队');
  assert.equal(h.page.data.busy, false);
});
test('pagination deduplicates public keys and a hidden page never restores results', async () => {
  const h = page();
  h.page.onLoad({ q: '青锋' });
  const item = { kind: 'TEAM', publicKey: 'a'.repeat(43), displayName: '青锋' };
  let count = 0;
  h.requireLocal('utils/api.js').getClient = () => ({
    request: async () => ({ data: { items: [item], nextCursor: ++count === 1 ? 'next' : null } }),
  });
  await h.page.search();
  await h.page.more();
  assert.equal(h.page.data.items.length, 1);
  assert.equal(h.page.data.cursor, null);
  const wait = deferred();
  h.requireLocal('utils/api.js').getClient = () => ({ request: async () => wait.promise });
  const pending = h.page.search();
  h.page.onHide();
  wait.resolve({ data: { items: [item], nextCursor: null } });
  await pending;
  assert.equal(h.page.data.items.length, 0);
});
