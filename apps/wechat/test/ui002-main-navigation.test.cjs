const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const tap = (page) => ({ currentTarget: { dataset: { page } } });

test('T01 onboarding and public-team navigation use existing scoped pages without granting or creating a team', () => {
  const h = loadPage({ root, route: 'pages/teams/index' });
  for (const page of ['team-request', 'team-join', 'public-archive', 'not-a-team-entry'])
    h.page.openTeamEntry(tap(page));
  assert.deepEqual(
    h.wx.calls.filter((call) => call.type === 'navigateTo').map((call) => call.url),
    [
      '/pages/team-request/index',
      '/pages/team-join/index',
      '/pages/public-archive/index?kind=TEAM',
    ],
  );
  assert.equal(h.page.data.canCreateTeam, false);
  assert.equal(h.wx.calls.filter((call) => call.type === 'request').length, 0);
});

test('T01 new entries cannot leave an active create, unresolved result or unsaved draft', () => {
  for (const [field, value] of [
    ['busy', true],
    ['loading', true],
    ['uncertain', true],
    ['newName', '合成尚未保存的球队'],
  ]) {
    const h = loadPage({ root, route: 'pages/teams/index' });
    h.page.setData({ [field]: value });
    for (const page of ['team-request', 'team-join', 'public-archive'])
      h.page.openTeamEntry(tap(page));
    assert.equal(h.wx.calls.filter((call) => call.type === 'navigateTo').length, 0, field);
    assert.equal(h.page.data[field], value);
  }
});

test('E01 directory and link disclosures preserve the original public filter, input and errors without writes', () => {
  const h = loadPage({ root, route: 'pages/watch/index' });
  const dir = structuredClone(h.page.data.dir);
  h.page.setData({ value: '合成原观赛输入', error: '合成待核对输入' });
  const scrolls = [];
  h.wx.pageScrollTo = (options) => scrolls.push(options.selector);
  h.wx.nextTick = (fn) => fn();
  h.page.toggleDirectoryFilters();
  h.page.toggleDirectoryFilters();
  h.page.toggleLink();
  h.page.toggleLink();
  assert.equal(h.page.data.directoryFiltersOpen, false);
  assert.equal(h.page.data.linkOpen, false);
  assert.equal(h.page.data.value, '合成原观赛输入');
  assert.equal(h.page.data.error, '合成待核对输入');
  assert.deepEqual(h.page.data.dir, dir);
  assert.deepEqual(scrolls, ['#watch-link-entry']);
  assert.equal(h.wx.calls.filter((call) => call.type === 'request').length, 0);
  h.page.recruitment();
  assert.equal(
    h.wx.calls.find((call) => call.type === 'navigateTo').url,
    '/pages/recruitment/index',
  );
});

test('E01 public rows precede tools and T01 renders real team identity, transactions and both onboarding actions', () => {
  const fixtures = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
  for (const width of [320, 390, 430]) {
    for (const [route, name, title] of [
      ['pages/watch/index', 'ui002-root-watch-directory', '赛事'],
      ['pages/teams/index', 'ui002-root-teams-managed', '球队'],
    ]) {
      const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, name + '.json'), 'utf8'));
      const html = buildPreview({ root, route, data: fixture.data, width, height: 844 }).phone;
      assert.ok(html.includes(title), title);
      if (route.includes('watch')) {
        assert.ok(html.indexOf('watch-public-card') < html.indexOf('watch-main-actions'));
        assert.ok(html.indexOf('watch-public-card') < html.indexOf('watch-discovery-settings'));
        assert.ok(html.includes('查看公开报名招募'));
        assert.ok(html.includes('用观赛链接打开'));
      } else {
        for (const text of ['球队事务', '球队主页与成员', '向机构申请建队', '输入球队加入码'])
          assert.ok(html.includes(text), text);
        assert.ok(html.includes('team-profile'));
      }
    }
  }
});
