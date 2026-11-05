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

test('signed-out account shows the five-tab navigation and keeps email login in a secondary panel', () => {
  const result = buildPreview({
    root,
    route: 'pages/account/index',
    data: { user: null, loading: false, enabled: false, wechatState: 'closed' },
  });
  assert.equal(result.components.find((c) => c.tag === 'scb-nav').properties.active, 'Account');
  assert.doesNotMatch(result.phone, /class="action-bar"/);
  assert.match(result.phone, />邮箱登录</);
  assert.match(result.phone, /微信登录暂未开放/);
  assert.doesNotMatch(result.phone, /data-mini-bindtap="login"/);
  const email = buildPreview({
    root,
    route: 'pages/account/index',
    data: { user: null, loading: false, emailOpen: true, wechatState: 'closed' },
  });
  assert.match(email.phone, />登录已有账号<\/button>/);
  assert.doesNotMatch(result.phone, /主办方数据提名/);
  assert.doesNotMatch(result.phone, /data-mini-bindtap="bind"/);
  const signedIn = buildPreview({
    root,
    route: 'pages/account/index',
    data: { user, loading: false, navigationMoreOpen: true },
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

test('wechat progress can switch to email only after the in-flight command releases its lock', () => {
  const h = loadPage({ root, route: 'pages/account/index' });
  h.page.setData({
    user: null,
    busy: true,
    loginPhase: 'wechat',
    loginNotice: 'failed',
    consent: true,
    emailOpen: false,
  });
  h.page.useEmailAfterWechat();
  assert.equal(h.page.data.loginPhase, 'wechat');
  assert.equal(h.page.data.emailOpen, false);
  h.page.setData({ busy: false });
  h.page.commandBusy = true;
  h.page.useEmailAfterWechat();
  assert.equal(h.page.data.loginPhase, 'wechat');
  h.page.commandBusy = false;
  h.page.useEmailAfterWechat();
  assert.equal(h.page.data.loginPhase, '');
  assert.equal(h.page.data.loginNotice, '');
  assert.equal(h.page.data.emailOpen, true);
  assert.equal(h.page.data.consent, false);
  assert.equal(
    h.wx.calls.some((call) => call.type === 'request'),
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

test('blank credentials stay on the page and a failed wechat capability read stays unknown', async () => {
  let loginBody = null;
  const client = {
    hasSession: () => false,
    request: async (url, method, payload) => {
      if (url === '/v1/auth/login') loginBody = payload;
      if (String(url).includes('/v1/auth/wechat/capabilities')) throw new Error('network');
      return { data: { canRegisterParticipant: false, enabled: false } };
    },
  };
  const h = loadPage({
    root,
    route: 'pages/account/index',
    modules: { [path.join(root, 'utils/api.js')]: { ...api, getClient: () => client } },
  });
  h.page.setData({ email: '', password: '  secret  ', emailOpen: true });
  h.page.login();
  await h.flush();
  assert.equal(loginBody, null);
  assert.equal(h.page.data.password, '  secret  ');
  assert.match(h.page.data.message, /请填写账号或邮箱/);
  h.page.openAgreement({ currentTarget: { dataset: { doc: 'privacy' } } });
  assert.equal(h.page.data.consent, false);
  assert.equal(h.page.data.agreement, 'privacy');
  h.page.setData({ email: 'a@example.test', password: '  secret  ', message: '' });
  h.page.login();
  await h.flush();
  assert.equal(loginBody.password, '  secret  ');
  await h.page.load();
  assert.equal(h.page.data.wechatState, 'unknown');
  assert.equal(h.page.data.enabled, false);
  assert.equal(h.page.data.message, '');
  const unknown = buildPreview({ root, route: 'pages/account/index', data: h.page.data });
  assert.match(unknown.phone, /重新核对登录状态/);
  assert.match(unknown.phone, /暂时无法核对微信登录状态/);
  assert.match(unknown.phone, /不代表服务已关闭/);
  assert.doesNotMatch(unknown.phone, /微信登录暂未开放/);
  const closed = {
    hasSession: () => false,
    request: async (url) =>
      String(url).includes('/v1/auth/wechat/capabilities')
        ? { data: { enabled: false } }
        : { data: { canRegisterParticipant: false } },
  };
  const closedPage = loadPage({
    root,
    route: 'pages/account/index',
    modules: { [path.join(root, 'utils/api.js')]: { ...api, getClient: () => closed } },
  });
  await closedPage.page.load();
  assert.equal(closedPage.page.data.wechatState, 'closed');
  assert.match(
    buildPreview({ root, route: 'pages/account/index', data: closedPage.page.data }).phone,
    /微信登录暂未开放/,
  );
});

test('wechat login keeps an unbound identity and a failed attempt signed out', async () => {
  async function attempt(code) {
    const calls = [];
    const client = {
      hasSession: () => false,
      sessionRevision: () => 1,
      viewerId: () => null,
      request: async (url) => {
        calls.push(url);
        if (url === '/v1/auth/wechat/challenges')
          return { data: { challengeId: 'synthetic-challenge', state: 'synthetic-state' } };
        if (url === '/v1/auth/wechat/login') {
          const error = new Error(
            code === 'WECHAT_BINDING_REQUIRED'
              ? '请先使用已有账号登录并明确绑定微信'
              : '微信认证暂时不可用，请重新发起',
          );
          error.code = code;
          throw error;
        }
        return { data: { enabled: true } };
      },
    };
    const wx = createWx();
    wx.login = (options) => options.success({ code: 'synthetic-code' });
    const h = loadPage({
      root,
      route: 'pages/account/index',
      wx,
      modules: { [path.join(root, 'utils/api.js')]: { ...api, getClient: () => client } },
    });
    h.page.setData({ enabled: true, wechatState: 'open', consent: true, user: null });
    h.page.wechatLogin();
    await h.flush();
    return { h, calls };
  }
  const unbound = await attempt('WECHAT_BINDING_REQUIRED');
  assert.equal(unbound.h.page.data.user, null);
  assert.equal(unbound.h.page.data.loginNotice, 'unbound');
  assert.equal(unbound.h.page.data.loginPhase, '');
  assert.equal(unbound.calls.includes('/v1/auth/wechat/login'), true);
  assert.equal(unbound.calls.includes('/v1/auth/register-participant'), false);
  const unboundView = buildPreview({
    root,
    route: 'pages/account/index',
    data: unbound.h.page.data,
  });
  assert.match(unboundView.phone, /当前微信尚未绑定应用账号/);
  assert.match(unboundView.phone, /请先登录已有账号，再从隐私与账号中明确绑定/);
  assert.doesNotMatch(unboundView.phone, /微信登录暂未开放|已退出登录/);
  const failed = await attempt('WECHAT_UNAVAILABLE');
  assert.equal(failed.h.page.data.user, null);
  assert.equal(failed.h.page.data.loginNotice, 'failed');
  const failedView = buildPreview({ root, route: 'pages/account/index', data: failed.h.page.data });
  assert.match(failedView.phone, /本次登录尚未完成/);
  assert.match(failedView.phone, /重新核对登录状态/);
  assert.doesNotMatch(failedView.phone, /当前微信尚未绑定应用账号/);
  const quiet = loadPage({ root, route: 'pages/account/index' });
  quiet.page.setData({ enabled: true, wechatState: 'open', consent: false });
  quiet.page.startWechat();
  await quiet.flush();
  assert.equal(quiet.page.data.consentOpen, true);
  assert.equal(quiet.page.data.consent, false);
  assert.equal(
    quiet.wx.calls.some((call) => call.type === 'request'),
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
  assert.equal(fixtures.length, 24);
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
      // Shared bottom-bar icons plus the account header's existing brand mark.
      // Court photos and other homepage pack files stay rejected on account fixtures.
      const homepageContent = result.assets.filter(
        (asset) =>
          /^assets[\\/]home[\\/]/.test(asset.path) &&
          !/^assets[\\/]home[\\/](?:brandmark|home|trophy|pin|team|profile)(?:-active)?\.svg$/.test(
            asset.path,
          ),
      );
      assert.deepEqual(homepageContent, [], name + ': homepage pack content');
      assert.deepEqual(
        result.assets.filter(
          (asset) =>
            !/^assets[\\/]approved-ui[\\/]icon-[a-z-]+\.png$/.test(asset.path) &&
            !/^assets[\\/]ui002[\\/][^\\/]+\.svg$/.test(asset.path) &&
            !/^assets[\\/]home[\\/](?:brandmark|home|trophy|pin|team|profile)(?:-active)?\.svg$/.test(
              asset.path,
            ),
        ),
        [],
        name,
      );
      if (
        fixture.route === 'pages/planned/index' &&
        ['payment', 'unknown', 'refund', 'settlement'].includes(fixture.data.selected)
      )
        assert.match(result.phone, /<button[^>]*disabled>/, name);
    }
  }
});
