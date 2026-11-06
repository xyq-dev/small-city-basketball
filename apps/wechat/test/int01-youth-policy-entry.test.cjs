const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/youth-review/index';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const user = id(1),
  org = id(2),
  event = id(3);
const base = `/v1/orgs/${org}/events/${event}`;
const tap = (field, value) => ({ currentTarget: { dataset: { field } }, detail: { value } });
function setup(canConfigure = true) {
  const calls = [];
  const client = {
    viewerId: () => user,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body });
      if (url === '/v1/auth/session')
        return { data: { user: { id: user }, organizations: [], teamContexts: [] } };
      if (url.startsWith(base + '/youth-guardian-requests'))
        return { data: { requests: [], nextCursor: null } };
      if (url === base + '/youth-policy') {
        if (method === 'PUT') return { data: {} };
        return {
          data: {
            event: { name: '合成青年杯' },
            policy: {
              enabled: false,
              version: 4,
              guardianAgeThreshold: 18,
              termsVersion: 'youth-participation-v1',
            },
            capabilities: { canConfigure, canInviteData: false },
          },
        };
      }
      throw new Error('Unexpected synthetic API request: ' + url);
    },
  };
  const h = loadPage({
    root,
    route,
    wx: createWx({ modalAnswers: [true] }),
    modules: { [path.join(root, 'utils/api.js')]: { getClient: () => client, uuid: (v) => v } },
  });
  h.page.onLoad({ orgId: org, eventId: event });
  return { ...h, calls };
}
const render = (h) => buildPreview({ root, route, data: h.page.data }).phone;
const button = (h) => render(h).match(/<button\b([^>]*)>保存本届青年规则<\/button>/)?.[1];

test('the institution review route can configure an empty draft queue through the rendered action', async () => {
  const h = setup();
  await h.page.load();
  assert.equal(h.page.data.error, '');
  assert.equal(h.page.data.requests.length, 0);
  assert.match(button(h) || '', /data-mini-bindtap="configure"/);
  assert.doesNotMatch(button(h), /\bdisabled\b/);
  const html = render(h);
  assert.match(html, /data-field="policyEnabled" data-mini-bindchange="checkbox"/);
  assert.match(html, /data-field="threshold"[^>]*data-mini-bindinput="field"/);
  h.page.checkbox(tap('policyEnabled', ['yes']));
  h.page.field(tap('threshold', '20'));
  const handler = button(h).match(/data-mini-bindtap="([^"]+)"/)[1];
  await h.page[handler]();
  const writes = h.calls.filter((call) => call.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, base + '/youth-policy');
  assert.equal(writes[0].body.expectedVersion, 4);
  assert.equal(writes[0].body.enabled, true);
  assert.equal(writes[0].body.guardianAgeThreshold, 20);
  assert.match(writes[0].body.clientRequestId, /^[0-9a-f-]{36}$/);
});

test('policy configuration remains absent without the server capability', async () => {
  const h = setup(false);
  await h.page.load();
  assert.equal(button(h), undefined);
  await h.page.configure();
  assert.equal(
    h.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('busy, pending and loading states disable the configuration action and preserve write guards', async () => {
  for (const key of ['busy', 'pending', 'loading']) {
    const h = setup();
    await h.page.load();
    h.page.setData({ [key]: true });
    assert.match(button(h), /\bdisabled\b/, key);
    await h.page.configure();
    assert.equal(
      h.calls.some((call) => call.method !== 'GET'),
      false,
      key,
    );
  }
});
