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
const actions = (html) => {
  const start = html.indexOf('class="figma-fixed-actions"');
  return start < 0 ? '' : html.slice(start);
};
const action = (html, handler) =>
  actions(html).match(new RegExp('<button\\b[^>]*data-mini-bindtap="' + handler + '"[^>]*>'))?.[0];
const disabled = (tag) => /\sdisabled(?:\s|>)/.test(tag || '');
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
      'player-rebuild',
      'figma-summary--navy',
      'player-tabs',
      'metrics-grid',
    ])
      assert.ok(html.includes(name), name);
    assert.ok(html.indexOf('球员服务档案') < html.indexOf('授权比赛数据'));
    assert.ok(html.indexOf('可约时间') < html.indexOf('单场报价'));
    for (const text of [
      '个人统计样本',
      '完成服务记录',
      '平台服务费',
      '交通与食宿',
      data.profile.travel,
      data.profile.accommodation,
    ])
      assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /profile-hero|profile-hero-image|heroPortrait|player-placeholder/);
    assert.equal((html.match(/data-mini-component="scb-header"/g) || []).length, 1);
    assert.ok(result.assets.every((asset) => /^(?:assets|pages)\//.test(asset.path)));
    assert.equal((actions(html).match(/<button\b/g) || []).length, 2);
    assert.match(html, /data-mini-bindtap="toggle"/);
    assert.match(actions(html), /data-mini-bindtap="load"/);
    assert.match(actions(html), /data-mini-bindtap="book"/);
    assert.match(html, /同价对比名单/);
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
  assert.match(render(h.page.data).phone, /当前已选 1 位/);
  assert.match(render(h.page.data).phone, />移出<\/div>/);
  h.page.compare();
  assert.equal(h.wx.calls.at(-1).url, '/pages/players/index');
  h.page.book();
  assert.equal(h.wx.calls.at(-1).url, '/pages/booking-create/index?playerId=' + input.profile.id);
  h.page.changeTab({ currentTarget: { dataset: { tab: 'RECORDS' } } });
  assert.match(render(h.page.data).phone, /data-mini-bindtap="changeTab"/);
  assert.match(render(h.page.data).phone, /近期记录与来源/);
  h.page.changeTab({ currentTarget: { dataset: { tab: 'SERVICE' } } });
  h.page.informationToggle();
  const expanded = render(h.page.data).phone;
  assert.match(expanded, /费用与数据来源说明/);
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
    const normal = render({ ...data, informationOpen: true }).phone;
    assert.match(normal, /data-mini-bindtap="changeTab"/);
    if (value === '未统计') assert.match(normal, /未采集项目显示“未统计”，不以 0 代替/);
    if (value === '暂不可用') {
      assert.match(normal, /统计暂时无法读取/);
      assert.match(normal, /合成读取故障/);
    }
    const records = render({ ...data, activeTab: 'RECORDS' }).phone;
    if (value === '未统计') {
      assert.match(records, /每场 未统计 分 \/ 未统计 犯规/);
      assert.match(records, /暂无当前有效的个人近期记录|得分 0 \/ 犯规 0/);
    } else if (value === '0') {
      assert.match(records, /每场 0 分 \/ 0 犯规/);
      assert.match(records, /得分 0 \/ 犯规 0/);
    } else assert.match(records, /每场 暂不可用 分 \/ 暂不可用 犯规/);
    assert.match(records, /近期记录与来源/);
  }
});

test('decimal and upper range fee components render while Page-derived totals remain intact', async () => {
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
      ])
        assert.ok(html.includes(h.page.data.profile[field]), name + ': ' + field);
      assert.equal(h.page.data.profile.totalLabel, sample.data.profile.totalLabel);
      assert.match(html, /class="fee-row"/);
      assert.doesNotMatch(html, /fee-row--total/);
    }
  }
});

test('loading, login and unavailable profile states retain only their safe recovery actions', () => {
  for (const data of [
    { loading: true },
    { loginRequired: true },
    { error: '合成授权已变更', loading: false },
  ]) {
    const html = render(data).phone;
    const footer = actions(html);
    assert.equal((footer.match(/<button\b/g) || []).length, 2);
    assert.doesNotMatch(footer, /data-mini-bindtap="book"/);
    assert.doesNotMatch(html, /figma-summary--navy/);
    if (data.loading) {
      assert.ok(disabled(action(html, 'market')));
      assert.ok(disabled(action(html, 'load')));
    } else if (data.loginRequired) {
      assert.ok(action(html, 'login'));
      assert.equal(disabled(action(html, 'login')), false);
      assert.ok(action(html, 'market'));
    }
    else if (!data.loading) {
      assert.ok(action(html, 'load'));
      assert.equal(disabled(action(html, 'load')), false);
      assert.ok(action(html, 'market'));
      assert.equal(disabled(action(html, 'market')), false);
    }
  }
});
