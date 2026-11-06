const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage, loadComponent } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const { parseWxml, walk } = require('./helpers/wxml.cjs');
const root = path.resolve(__dirname, '..');
const route = 'pages/training/index';
const actor = '10000000-0000-4000-8000-000000000001';
function setup({ authenticated = false, catalogFailure = false } = {}) {
  const state = { authenticated, catalogFailure },
    calls = [];
  const client = {
    viewerId: () => (state.authenticated ? actor : ''),
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET') {
      calls.push({ url, method });
      assert.equal(method, 'GET', 'login recovery must never submit an enrollment');
      if (url === '/v1/auth/session') {
        if (!state.authenticated)
          throw Object.assign(Error('合成尚未登录，请登录后继续。'), { status: 401 });
        return { data: { user: { id: actor }, organizations: [], teamContexts: [] } };
      }
      if (url === '/v1/training/catalog') {
        if (state.catalogFailure)
          throw Object.assign(Error('合成公开课程目录读取失败。'), { status: 503 });
        return { data: { items: [], capabilities: { enabled: true } } };
      }
      assert.equal(url, '/v1/training/mine');
      return { data: { items: [], teaching: [], coachProfiles: [] } };
    },
  };
  const api = { ...require('../utils/api'), getClient: () => client };
  const h = loadPage({
    root,
    route,
    wx: createWx(),
    modules: { [path.join(root, 'utils/api.js')]: api },
  });
  h.page.onLoad({});
  return { ...h, calls, state };
}
const preview = (page, width = 390) => buildPreview({ root, route, data: page.data, width });
function feedbackNode(handler) {
  let found;
  walk(parseWxml(fs.readFileSync(path.join(root, route + '.wxml'), 'utf8')), (node) => {
    if (node.name === 'figma-feedback' && node.attributes['bind:action'] === handler) found = node;
  });
  assert.ok(found, 'native page must bind the visible feedback action to ' + handler);
  return found;
}
async function pressFeedback(h, handler) {
  const node = feedbackNode(handler),
    rendered = preview(h.page);
  const component = rendered.components.find(
    (c) => c.tag === 'figma-feedback' && c.properties.title === node.attributes.title,
  );
  assert.ok(component, 'feedback must actually be visible before its action can run');
  const loaded = loadComponent({ root, route: component.path, properties: component.properties });
  let action;
  loaded.instance.triggerEvent = (name) => {
    assert.equal(name, 'action');
    action = h.page[node.attributes['bind:action']]();
  };
  loaded.instance.action();
  await action;
  return component;
}
async function enterMine(h) {
  const button = preview(h.page).phone.match(
    /<button\b[^>]*data-mini-bindtap="loadMine"[^>]*>/,
  )?.[0];
  assert.ok(button, 'the guest must enter through the existing My enrollments action');
  await h.page[button.match(/data-mini-bindtap="([^"]+)"/)[1]]();
}

test('signed-out My enrollments exposes login and preserves the original training return path', async () => {
  const h = setup();
  await h.page.load();
  await enterMine(h);
  assert.equal(h.page.data.loginRequired, true);
  assert.equal(
    h.wx.calls.some((call) => call.type === 'navigateTo'),
    false,
    'ui.session does not auto-navigate',
  );
  for (const width of [320, 390, 430])
    assert.match(preview(h.page, width).phone, /登录后查看我的报名/);
  await pressFeedback(h, 'login');
  const navigation = h.wx.calls.find((call) => call.type === 'navigateTo');
  const target = new URL(navigation.url, 'https://synthetic.invalid');
  assert.equal(target.pathname, '/pages/account/index');
  assert.equal(target.searchParams.get('returnTo'), '/pages/training/index');
  assert.equal(
    h.calls.some((call) => call.url === '/v1/training/mine'),
    false,
  );
  assert.equal(
    h.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('a newly authenticated session clears the login recovery prompt and reads own enrollments', async () => {
  const h = setup();
  await enterMine(h);
  assert.equal(h.page.data.loginRequired, true);
  h.state.authenticated = true;
  await enterMine(h);
  assert.equal(h.page.data.loginRequired, false);
  assert.doesNotMatch(preview(h.page).phone, /登录后查看我的报名/);
  assert.ok(h.calls.some((call) => call.url === '/v1/training/mine'));
  assert.equal(
    h.wx.calls.some((call) => call.type === 'navigateTo'),
    false,
  );
});

test('a public catalog failure retains its original public retry without login or enrollment writes', async () => {
  const h = setup({ catalogFailure: true });
  await h.page.load();
  assert.equal(h.page.data.loginRequired, false);
  assert.doesNotMatch(preview(h.page).phone, /登录后查看我的报名/);
  await pressFeedback(h, 'load');
  assert.deepEqual(h.calls, [
    { url: '/v1/training/catalog', method: 'GET' },
    { url: '/v1/training/catalog', method: 'GET' },
  ]);
  assert.equal(
    h.wx.calls.some((call) => call.type === 'navigateTo'),
    false,
  );
});

test('busy, loading and unknown requests disable the actual login feedback action', async () => {
  for (const flag of ['busy', 'loading', 'mineLoading', 'pending']) {
    const h = setup();
    await enterMine(h);
    h.page.setData({ [flag]: true });
    const component = await pressFeedback(h, 'login');
    assert.equal(component.properties.disabled, true);
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

test('the CI guest fixture matches a real signed-out My enrollments attempt and visible login action', async () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../tests/mini-program/fixtures/int01-training-login-required.json',
      ),
      'utf8',
    ),
  );
  const h = setup();
  await h.page.load();
  await enterMine(h);
  assert.equal(h.page.data.loginRequired, fixture.data.loginRequired);
  assert.equal(h.page.data.viewTab, fixture.data.viewTab);
  assert.equal(h.page.data.error, fixture.data.error);
  for (const width of [320, 390, 430]) {
    const html = preview(h.page, width).phone;
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
  }
  assert.equal(feedbackNode('login').attributes['bind:action'], 'login');
});
