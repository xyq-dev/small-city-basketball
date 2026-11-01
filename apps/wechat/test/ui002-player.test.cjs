const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const actor = '10000000-0000-4000-8000-000000000001';
const fixtureRoot = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name + '.json')));
const render = (data, width = 390) => {
  const result = buildPreview({ root, route: 'pages/player/index', data, width, height: 844 });
  return { ...result, phone: result.phone.slice(result.phone.indexOf('<body')) };
};
const actions = (html) => html.slice(html.indexOf('action-bar profile-action'));
async function actualPage(input, performance = null) {
  const client = {
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    request: async (url) => {
      assert.equal(url, '/v1/auth/session');
      return { data: { user: { id: actor }, organizations: [], teamContexts: [] } };
    },
  };
  const api = { getClient: () => client, uuid: (value) => value };
  const sdk = {
    workspace: async () => ({
      viewerUserId: actor,
      settings: { feeBps: input.bps },
      players: [input.profile],
    }),
    performance: async () => performance,
  };
  const h = loadPage({
    root,
    route: 'pages/player/index',
    wx: createWx(),
    modules: { '../../utils/api': api, './api': api, '../../utils/booking': sdk },
  });
  h.page.onLoad({ id: input.profile.id });
  await h.page.onShow();
  return h;
}

test('T07 renders an identity, two real overview facts, available windows and visible fee components without the previous hero', () => {
  const data = fixture('c10-profile-player-ready').data;
  for (const width of [320, 390, 430]) {
    const result = render(data, width);
    const html = result.phone;
    for (const name of [
      'profile-identity',
      'profile-avatar',
      'profile-name',
      'profile-meta',
      'profile-samples',
      'availability-card',
      'profile-quote',
    ])
      assert.ok(html.includes(name), name);
    assert.ok(html.indexOf('profile-identity') < html.indexOf('profile-samples'));
    assert.ok(html.indexOf('availability-card') < html.indexOf('profile-quote'));
    for (const text of [
      '授权统计样本',
      '完成服务记录',
      '平台费预计',
      '交通费',
      '食宿费',
      '含费预计',
      data.profile.travel,
      data.profile.accommodation,
      data.profile.total,
    ])
      assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /profile-hero|profile-hero-image|heroPortrait|player-placeholder/);
    assert.equal((html.match(/class="scb-header /g) || []).length, 1);
    assert.doesNotMatch(html, /class="scb-header dark/);
    const avatar = result.assets.find((asset) => asset.path.endsWith('/avatar-user.svg'));
    assert.ok(avatar);
    assert.ok(fs.statSync(path.join(root, 'assets/ui002/avatar-user.svg')).size > 0);
    assert.equal((actions(html).match(/<button\b/g) || []).length, 2);
    assert.match(actions(html), /data-mini-bindtap="toggle"/);
    assert.match(actions(html), /data-mini-bindtap="book"/);
    assert.match(actions(html), /加入同价对比/);
    assert.match(actions(html), /发起预约/);
  }
});

test('the directly visible compare and booking actions still require the real current display token', async () => {
  const input = fixture('ui002-services-player-decimal').syntheticInput;
  const h = await actualPage(input);
  assert.equal(h.page.data.profile.priceLabel, '¥300.01');
  assert.equal(h.page.data.profile.totalLabel, '¥330.01');
  assert.equal(h.page.data.profile.portrait, undefined);
  h.page.toggle();
  assert.equal(h.page.data.selected, true);
  assert.match(actions(render(h.page.data).phone), /移出同价对比/);
  h.page.compare();
  assert.equal(h.wx.calls.at(-1).url, '/pages/players/index');
  h.page.book();
  assert.equal(h.wx.calls.at(-1).url, '/pages/booking-create/index?playerId=' + input.profile.id);
  h.page.recordsToggle();
  assert.match(actions(render(h.page.data).phone), /data-mini-bindtap="recordsToggle"/);
  assert.match(actions(render(h.page.data).phone), /返回球员详情/);
  h.page.recordsToggle();
  h.page.informationToggle();
  const expanded = render(h.page.data).phone;
  assert.match(expanded, /data-mini-bindtap="compare"/);
  assert.match(expanded, /固定名单统计样本不代表实际出场/);
  const navigations = h.wx.calls.filter((call) => call.type === 'navigateTo').length;
  h.page.onHide();
  h.page.toggle();
  h.page.book();
  assert.equal(h.wx.calls.filter((call) => call.type === 'navigateTo').length, navigations);
  assert.equal(h.page.data.profile, null);
});

test('missing, failed and real zero statistics remain distinct and recent records remain reachable', () => {
  const original = fixture('c10-profile-player-ready').data;
  for (const value of ['未统计', '暂不可用', '0']) {
    const data = structuredClone(original);
    data.profile.performance.points = value;
    data.profile.performance.fouls = value;
    data.profile.performance.sample = value === '暂不可用' ? value : '0';
    if (value === '暂不可用') data.statisticsError = '合成读取故障';
    const normal = render(data).phone;
    assert.match(normal, /data-mini-bindtap="recordsToggle"/);
    if (value === '未统计') assert.match(normal, /个人比赛数据：未统计，不以0分替代缺失/);
    if (value === '暂不可用') assert.match(normal, /统计暂时无法读取：合成读取故障/);
    if (value === '0') assert.match(normal, /每场记录 0 分 \/ 0 犯规 · 真实0与未统计分开/);
    const records = render({ ...data, recordsOpen: true }).phone;
    if (value === '未统计') assert.match(records, /不以0分替代缺失，不生成综合能力分/);
    else assert.match(records, /有限授权记录/);
    assert.match(actions(records), /返回球员详情/);
  }
});

test('both decimal and upper range totals retain real Page-derived amounts at each native template width', async () => {
  for (const name of ['decimal', 'large']) {
    const sample = fixture('ui002-services-player-' + name);
    const h = await actualPage(sample.syntheticInput);
    assert.deepEqual(h.page.data.profile, sample.data.profile);
    for (const width of [320, 390, 430]) {
      const html = render(h.page.data, width).phone;
      for (const field of [
        'priceLabel',
        'platformFeeLabel',
        'travel',
        'accommodation',
        'totalLabel',
      ])
        assert.ok(html.includes(h.page.data.profile[field]), name + ': ' + field);
      assert.match(html, /class="quote-price"/);
      assert.match(html, /class="quote-total-price"/);
    }
  }
});

test('loading, login and unavailable profile states retain their recovery paths and disable the two primary task actions', () => {
  for (const data of [
    { loading: true },
    { loginRequired: true },
    { error: '合成授权已变更', loading: false },
  ]) {
    const html = render(data).phone;
    const footer = actions(html);
    assert.equal((footer.match(/<button\b[^>]*disabled/g) || []).length, 2);
    assert.doesNotMatch(html, /profile-identity/);
    if (data.loginRequired) assert.match(html, /data-mini-bindtap="login"/);
    else if (!data.loading) {
      assert.match(html, /data-mini-bindtap="load"/);
      assert.match(html, /data-mini-bindtap="market"/);
    }
  }
});
