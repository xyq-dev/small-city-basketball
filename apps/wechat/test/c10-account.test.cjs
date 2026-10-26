const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../utils/api');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: '合成参与者',
  email: 'synthetic@example.test',
};

test('signed-out login uses its fixed action footer without overlapping the account navigation', () => {
  const result = buildPreview({ root, route: 'pages/account/index' });
  assert.equal(
    result.components.some((c) => c.tag === 'scb-nav'),
    false,
  );
  assert.match(result.phone, /class="action-bar"/);
  assert.match(result.phone, />登录已有账号<\/button>/);
  assert.doesNotMatch(result.phone, /主办方数据提名/);
  assert.doesNotMatch(result.phone, /data-mini-bindtap="bind"/);
  const signedIn = buildPreview({
    root,
    route: 'pages/account/index',
    data: { user, loading: false },
  });
  assert.equal(signedIn.components.find((c) => c.tag === 'scb-nav').properties.active, 'Account');
  assert.doesNotMatch(signedIn.phone, /class="action-bar"/);
  assert.ok(
    signedIn.phone.indexOf('我的球队与本届报名') < signedIn.phone.indexOf('账号与微信绑定'),
  );
});

test('security view switching preserves the reviewed draft and cannot bypass an in-flight account action', () => {
  const h = loadPage({ root, route: 'pages/account/index' });
  h.page.setData({ user, password: 'synthetic-draft', consent: true, message: '合成待核对信息' });
  h.page.showSecurity();
  assert.equal(h.page.data.securityOpen, true);
  h.page.closeSecurity();
  assert.equal(h.page.data.securityOpen, false);
  for (const guard of ['busy', 'commandBusy']) {
    h.page.data.busy = guard === 'busy';
    h.page.commandBusy = guard === 'commandBusy';
    h.page.showSecurity();
    assert.equal(h.page.data.securityOpen, false);
    h.page.data.securityOpen = true;
    h.page.closeSecurity();
    assert.equal(h.page.data.securityOpen, true);
    h.page.data.securityOpen = false;
  }
  assert.equal(h.page.data.password, 'synthetic-draft');
  assert.equal(h.page.data.consent, true);
  assert.equal(h.page.data.message, '合成待核对信息');
  assert.equal(
    h.wx.calls.some((c) => c.type === 'request'),
    false,
  );
});

test('revoked registration capability still leaves a path back to existing-account login', () => {
  const h = loadPage({ root, route: 'pages/account/index' });
  h.page.setData({ registerMode: true, canRegister: false });
  const preview = buildPreview({ root, route: 'pages/account/index', data: h.page.data });
  assert.match(preview.phone, /data-mini-bindtap="toggleRegister"[^>]*>返回已有账号登录/);
  assert.match(preview.phone, /data-mini-bindtap="register"[^>]*disabled/);
  h.page.toggleRegister();
  assert.equal(h.page.data.registerMode, false);
  assert.equal(
    h.wx.calls.some((c) => c.type === 'request'),
    false,
  );
});

test('failed account reads render the explicit error tone after clearing private identity', async () => {
  const client = {
    hasSession: () => true,
    request: async () => {
      throw new Error('合成读取失败');
    },
  };
  const h = loadPage({
    root,
    route: 'pages/account/index',
    wx: createWx(),
    modules: { [path.join(root, 'utils/api.js')]: { ...api, getClient: () => client } },
  });
  h.page.setData({ user, connected: true, binding: { connected: true, version: 2 } });
  await h.page.load();
  assert.equal(h.page.data.user, null);
  assert.equal(h.page.data.connected, false);
  assert.equal(h.page.data.messageTone, 'error');
  assert.match(h.page.data.message, /合成读取失败/);
  const preview = buildPreview({ root, route: 'pages/account/index', data: h.page.data });
  assert.match(preview.phone, /account-feedback danger/);
  assert.doesNotMatch(preview.phone, /合成参与者/);
});

test('planned mode and refund-progress switching are presentation-only and reject unknown keys', () => {
  const h = loadPage({ root, route: 'pages/planned/index' });
  h.page.onLoad({ kind: 'https://untrusted.example' });
  assert.equal(h.page.data.selected, 'funds');
  h.page.toggleOptions();
  assert.equal(h.page.data.optionsOpen, true);
  h.page.select({ currentTarget: { dataset: { key: 'refund' } } });
  assert.equal(h.page.data.selected, 'refund');
  assert.equal(h.page.data.optionsOpen, false);
  h.page.showRefundProgress();
  assert.equal(h.page.data.refundProgress, true);
  h.page.select({ currentTarget: { dataset: { key: 'messages' } } });
  h.page.showRefundProgress();
  assert.equal(h.page.data.refundProgress, false);
  assert.equal(
    h.wx.calls.some((c) => c.type === 'request'),
    false,
  );
});

test('all account and planned visual fixtures expand real WXML and retain disabled future actions', () => {
  const directory = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
  const fixtures = fs
    .readdirSync(directory)
    .filter((name) => name.startsWith('c10-account-') && name.endsWith('.json'));
  assert.equal(fixtures.length, 22);
  for (const name of fixtures) {
    const fixture = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    for (const width of [320, 390, 430]) {
      const result = buildPreview({
        root,
        route: fixture.route,
        data: fixture.data,
        width,
        height: 844,
      });
      for (const text of fixture.expectText)
        assert.ok(result.phone.includes(text), name + ': ' + text);
      // Only the shared bottom-bar UI icons; no portraits or other imagery on account pages.
      assert.deepEqual(
        result.assets.filter(
          (asset) => !/^assets[\\/]approved-ui[\\/]icon-[a-z-]+\.png$/.test(asset.path),
        ),
        [],
      );
      if (
        fixture.route === 'pages/planned/index' &&
        ['payment', 'unknown', 'refund', 'settlement'].includes(fixture.data.selected)
      )
        assert.match(result.phone, /<button[^>]*disabled>/, name);
    }
  }
});
