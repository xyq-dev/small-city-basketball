const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { loadPage } = require('./helpers/native-page.cjs');
const api = require('../utils/api');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const fixtures = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
const tap = (key) => ({ currentTarget: { dataset: { key } } });

test('UI002 account view switches respect the current role and busy operation without issuing writes', () => {
  const h = loadPage({ root, route: 'pages/account/index' });
  h.page.workspace(tap('work'));
  assert.equal(h.page.data.workspaceTab, 'personal');
  h.page.setData({ roles: [{ key: 'synthetic-role', text: '合成工作人员' }], busy: true });
  h.page.workspace(tap('work'));
  assert.equal(h.page.data.workspaceTab, 'personal');
  h.page.setData({ busy: false });
  h.page.workspace(tap('work'));
  assert.equal(h.page.data.workspaceTab, 'work');
  h.page.workspace(tap('unexpected'));
  assert.equal(h.page.data.workspaceTab, 'work');
  h.page.workspace(tap('personal'));
  assert.equal(h.page.data.workspaceTab, 'personal');
  assert.equal(h.wx.calls.filter((call) => call.type === 'request').length, 0);
});

test('UI002 refreshing the same account after organization revocation returns to the personal view', async () => {
  const viewer = '00000000-0000-4000-8000-000000000001';
  const client = {
    hasSession: () => true,
    viewerId: () => viewer,
    async request(url) {
      if (url === '/v1/auth/session')
        return {
          data: {
            user: { id: viewer, displayName: '合成退权用户', email: 'revoked@example.test' },
            organizations: [],
            teamContexts: [],
          },
        };
      if (url === '/v1/auth/wechat/binding') return { data: { connected: false } };
      return { data: { enabled: false, canRegisterParticipant: false } };
    },
  };
  const h = loadPage({
    root,
    route: 'pages/account/index',
    modules: { [path.join(root, 'utils/api.js')]: { ...api, getClient: () => client } },
  });
  h.page.setData({
    workspaceTab: 'work',
    roles: [{ key: viewer, text: '旧机构管理员' }],
    managedOrgs: [{ id: viewer, name: '旧机构' }],
  });
  await h.page.load();
  assert.equal(h.page.data.workspaceTab, 'personal');
  assert.deepEqual(h.page.data.roles, []);
  assert.deepEqual(h.page.data.managedOrgs, []);
  const result = buildPreview({ root, route: 'pages/account/index', data: h.page.data });
  assert.match(result.phone, /我的成员关系/);
  assert.doesNotMatch(result.phone, /旧机构管理员|建队申请审批|当前授权工作台/);
});

test('UI002 local filter disclosure preserves original slot and charge facts and cannot hide unresolved commands', () => {
  const h = loadPage({ root, route: 'pages/local/index' });
  h.page.setData({
    q: '合成球场',
    selectedSlot: 'synthetic-slot',
    accepted: true,
    feeRead: true,
    chargeConsent: true,
  });
  h.page.toggleFilters();
  assert.equal(h.page.data.filtersOpen, true);
  h.page.toggleFilters();
  assert.equal(h.page.data.filtersOpen, false);
  for (const key of ['busy', 'pending', 'pendingError']) {
    h.page.setData({ [key]: key === 'pendingError' ? '原结果待核对' : true });
    h.page.toggleFilters();
    assert.equal(h.page.data.filtersOpen, false);
    h.page.setData({ [key]: key === 'pendingError' ? '' : false });
  }
  assert.equal(h.page.data.q, '合成球场');
  assert.equal(h.page.data.selectedSlot, 'synthetic-slot');
  assert.equal(h.page.data.accepted, true);
  assert.equal(h.page.data.feeRead, true);
  assert.equal(h.page.data.chargeConsent, true);
  assert.equal(h.wx.calls.filter((call) => call.type === 'request').length, 0);
});

test('UI002 nine root routes have populated scenarios and every state expands at 320/390/430 with local assets', () => {
  const routes = new Set();
  const files = fs.readdirSync(fixtures).filter((file) => file.startsWith('ui002-root-'));
  assert.ok(files.length >= 14);
  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, file), 'utf8'));
    if (fixture.state === 'populated') routes.add(fixture.route);
    assert.ok(Object.keys(fixture.data).length > 0, file);
    assert.ok(fixture.figmaNode && fixture.designSource.includes('synthetic'), file);
    for (const width of [320, 390, 430]) {
      const result = buildPreview({
        root,
        route: fixture.route,
        data: fixture.data,
        width,
        height: 844,
      });
      for (const text of fixture.expectText)
        assert.ok(result.phone.includes(text), file + ': ' + text);
      for (const text of fixture.expectAbsentText || [])
        assert.equal(result.phone.includes(text), false, file + ': ' + text);
      for (const asset of result.assets) assert.ok(asset.bytes > 0, file + ': ' + asset.path);
      assert.doesNotMatch(result.phone, /\ssrc="https:/, file);
      assert.match(result.html, /非微信运行时/, file);
    }
  }
  assert.deepEqual(
    [...routes].sort(),
    ['account', 'city-select', 'event', 'home', 'local', 'match', 'search', 'teams', 'watch']
      .map((route) => 'pages/' + route + '/index')
      .sort(),
  );
});
