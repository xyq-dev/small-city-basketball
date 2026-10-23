const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api');
test('share entry never changes fixed API origin and rejects private/foreign links', () => {
  const id = 'a'.repeat(43);
  assert.equal(api.eventFromInput('https://basketball.playhubs.cn/watch/' + id), id);
  for (const bad of ['https://attacker.test/watch/' + id, '/events/private', 'scb.sid=secret'])
    assert.throws(() => api.eventFromInput(bad));
  assert.equal(api.pathAllowed('/v1/orgs/private/events', 'POST'), false);
});
test('native client explicitly supplies origin and keeps only scb.sid in memory, cleared by logout/401', async () => {
  let calls = [];
  let count = 0;
  const client = api.createClient({
    request(options) {
      calls.push(options);
      options.success({
        statusCode: count++ === 2 ? 401 : 200,
        header:
          count === 1
            ? { 'Set-Cookie': 'scb.sid=' + 'x'.repeat(43) + '; Path=/; HttpOnly; Secure' }
            : {},
        data:
          count === 3
            ? { error: { code: 'UNAUTHENTICATED' } }
            : { data: null, meta: { requestId: 'test' } },
      });
    },
  });
  await client.request('/v1/auth/login', 'POST', {});
  await client.request('/v1/auth/session');
  assert.equal(calls[0].header.Origin, api.API_ORIGIN);
  assert.equal(calls[1].header.Cookie, 'scb.sid=' + 'x'.repeat(43));
  assert.equal(client.hasSession(), true);
  await assert.rejects(client.request('/v1/auth/session'));
  assert.equal(client.hasSession(), false);
});
test('server authority clock anchor drives display, pause and stale client read time stay explicit', () => {
  const value = {
    serverTime: '2026-10-23T00:00:02Z',
    clock: { remainingMs: 60000, running: true, anchorServerTime: '2026-10-23T00:00:00Z' },
  };
  assert.equal(api.clockText(value, 1000, 2000), '0:57');
  value.clock.running = false;
  assert.equal(api.clockText(value, 1000, 9000), '1:00');
  assert.equal(api.clockText(null, 0), '未准备');
});
test('media URLs can only remain on the current opaque grant path', () => {
  const id = 'a'.repeat(43);
  assert.equal(
    api.mediaUrl('/v1/public/events/' + id + '/matches/' + id + '/media/' + id + '/content'),
    api.API_ORIGIN + '/v1/public/events/' + id + '/matches/' + id + '/media/' + id + '/content',
  );
  assert.throws(() => api.mediaUrl('https://attacker.test/private'));
});

test('native cookies array is supported without assuming a browser cookie jar or persistent storage', async () => {
  let calls = [];
  const client = api.createClient({
    request(options) {
      calls.push(options);
      options.success({
        statusCode: 200,
        header: {},
        cookies: [calls.length === 1 ? 'scb.sid=' + 'y'.repeat(43) : 'unrelated=cookie'],
        data: { data: null, meta: { requestId: 'cookie-array' } },
      });
    },
  });
  await client.request('/v1/auth/login', 'POST', {});
  await client.request('/v1/auth/session');
  assert.equal(calls[1].header.Cookie, 'scb.sid=' + 'y'.repeat(43));
  client.clearSession();
  assert.equal(client.hasSession(), false);
});
