const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage, loadComponent } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const { parseWxml, walk } = require('./helpers/wxml.cjs');
const root = path.resolve(__dirname, '..');
const route = 'pages/youth-review/index';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const actor = id(1),
  org = id(2),
  event = id(3);
const base = '/v1/orgs/' + org + '/events/' + event;
const returnPath = '/pages/youth-review/index?orgId=' + org + '&eventId=' + event;
function setup({ authenticated = false, valid = true } = {}) {
  const state = { authenticated },
    calls = [];
  const client = {
    viewerId: () => (state.authenticated ? actor : ''),
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET') {
      calls.push({ url, method });
      assert.equal(method, 'GET', 'login recovery must not review or configure youth requests');
      if (url === '/v1/auth/session') {
        if (!state.authenticated)
          throw Object.assign(Error('合成审核登录已失效，请重新登录。'), { status: 401 });
        return { data: { user: { id: actor }, organizations: [], teamContexts: [] } };
      }
      if (url.startsWith(base + '/youth-guardian-requests'))
        return { data: { requests: [], nextCursor: null } };
      assert.equal(url, base + '/youth-policy');
      return {
        data: {
          event: { name: '合成青年杯' },
          policy: {
            enabled: false,
            version: 1,
            guardianAgeThreshold: 18,
            termsVersion: 'youth-participation-v1',
          },
          capabilities: { canConfigure: false, canInviteData: false },
        },
      };
    },
  };
  const api = { ...require('../utils/api'), getClient: () => client };
  const h = loadPage({
    root,
    route,
    wx: createWx(),
    modules: { [path.join(root, 'utils/api.js')]: api },
  });
  h.page.onLoad(valid ? { orgId: org, eventId: event } : {});
  return { ...h, state, calls };
}
const preview = (page, width = 390) => buildPreview({ root, route, data: page.data, width });
function loginNode() {
  let found;
  walk(parseWxml(fs.readFileSync(path.join(root, route + '.wxml'), 'utf8')), (node) => {
    if (node.name === 'figma-feedback' && node.attributes['bind:action'] === 'login') found = node;
  });
  assert.ok(found, 'the shared review page must have its own explicit login binding');
  return found;
}
function pressLogin(h) {
  const node = loginNode();
  const component = preview(h.page).components.find(
    (item) => item.tag === node.name && item.properties.title === node.attributes.title,
  );
  assert.ok(component, 'login feedback must actually render after the failed session read');
  const loaded = loadComponent({ root, route: component.path, properties: component.properties });
  loaded.instance.triggerEvent = (name) => {
    assert.equal(name, 'action');
    h.page[node.attributes['bind:action']]();
  };
  loaded.instance.action();
  return component;
}
function assertReturn(h) {
  const navigation = h.wx.calls.filter((call) => call.type === 'navigateTo').at(-1);
  assert.ok(navigation);
  const target = new URL(navigation.url, 'https://synthetic.invalid');
  assert.equal(target.pathname, '/pages/account/index');
  assert.equal(target.searchParams.get('returnTo'), returnPath);
}

test('a signed-out valid youth review context exposes login with the exact organization and event return path', async () => {
  const h = setup();
  await h.page.load();
  assert.equal(h.page._invalid, undefined);
  assert.equal(h.page.data.loginRequired, true);
  assert.equal(h.page.data.loading, false);
  assert.equal(
    h.wx.calls.some((call) => call.type === 'navigateTo'),
    false,
  );
  for (const width of [320, 390, 430])
    assert.match(preview(h.page, width).phone, /登录后继续监护审核/);
  pressLogin(h);
  assertReturn(h);
  assert.deepEqual(h.calls, [{ url: '/v1/auth/session', method: 'GET' }]);
});

test('an expired review session can log in again without retaining review or configuration controls', async () => {
  const h = setup({ authenticated: true });
  await h.page.load();
  assert.equal(h.page.data.loginRequired, false);
  h.state.authenticated = false;
  await h.page.load();
  assert.equal(h.page.data.loginRequired, true);
  const html = preview(h.page).phone;
  assert.doesNotMatch(html, /data-mini-bindtap="review"|data-mini-bindtap="configure"/);
  pressLogin(h);
  assertReturn(h);
  assert.equal(
    h.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('authentication clears the prompt while a missing event context does not start a login read', async () => {
  const h = setup();
  await h.page.load();
  h.state.authenticated = true;
  await h.page.load();
  assert.equal(h.page.data.loginRequired, false);
  assert.doesNotMatch(preview(h.page).phone, /登录后继续监护审核/);
  const invalid = setup({ valid: false });
  await invalid.page.load();
  assert.equal(invalid.page._invalid, true);
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.page.data.loginRequired, false);
});

test('busy, loading and pending operations disable the actual shared-page login feedback', async () => {
  for (const flag of ['busy', 'loading', 'pending']) {
    const h = setup();
    await h.page.load();
    h.page.setData({ [flag]: true });
    assert.equal(pressLogin(h).properties.disabled, true);
    assert.equal(
      h.wx.calls.some((call) => call.type === 'navigateTo'),
      false,
    );
    assert.equal(
      h.calls.some((call) => call.method !== 'GET'),
      false,
    );
  }
});

test('the CI login fixture matches a real 401 from the valid shared review context', async () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../tests/mini-program/fixtures/int01-youth-login-required.json',
      ),
      'utf8',
    ),
  );
  const h = setup();
  await h.page.load();
  assert.equal(h.page.data.loginRequired, fixture.data.loginRequired);
  assert.equal(h.page.data.error, fixture.data.error);
  for (const width of [320, 390, 430]) {
    const html = preview(h.page, width).phone;
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
  }
  pressLogin(h);
  assertReturn(h);
});
