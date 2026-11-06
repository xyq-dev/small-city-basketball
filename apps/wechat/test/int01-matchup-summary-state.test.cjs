const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/local-matchups/index';
const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const raw = (status, awayConfirmed) => ({
  id: id(1),
  homeTeamId: id(2),
  awayTeamId: id(3),
  homeOrgId: id(4),
  awayOrgId: id(5),
  courtId: id(6),
  courtOrgId: id(4),
  homeTeamName: '合成当前主队',
  awayTeamName: '合成当前客队',
  startsAt: '2028-06-01T11:00:00Z',
  endsAt: '2028-06-01T13:00:00Z',
  address: '合成约赛状态核对球场',
  terms: '合成双方独立确认的本次约赛约定',
  status,
  version: 4,
  homeConfirmed: true,
  awayConfirmed,
  canConfirm: status === 'OPEN' && !awayConfirmed,
});
function harness(status, awayConfirmed) {
  const h = loadPage({ root, route, wx: createWx() });
  const dto = h.requireLocal('utils/local-services.js').matchup(raw(status, awayConfirmed));
  h.page.onLoad();
  h.page.setData({ items: [dto], selected: null, matchupView: 'list', teams: [] });
  return { ...h, dto };
}
function progress(page, width = 390) {
  const html = buildPreview({ root, route, data: page.data, width }).phone;
  const start = html.indexOf('class="figma-section status-banner"');
  const end = html.indexOf('全部约赛', start);
  assert.ok(start >= 0 && end > start, 'The real first-matchup progress summary must remain');
  const summary = html.slice(start, end);
  const statuses = [...summary.matchAll(/class="figma-status(?: [^"]*)?">([^<]*)</g)].map(
    (match) => match[1],
  );
  assert.equal(statuses.length, 3);
  return { html, summary, statuses };
}

const cases = [
  ['OPEN', false, ['已发出', '待确认', '待双方确认']],
  ['CONFIRMED', true, ['已确认', '已确认', '待登记完成']],
  ['COMPLETED', true, ['已完成', '已确认', '已完成']],
  ['DECLINED', false, ['已拒绝', '已拒绝', '已拒绝']],
  ['CANCELLED', false, ['已取消', '已取消', '已取消']],
  ['CANCELLED', true, ['已取消', '已确认', '已取消']],
];
for (const [status, awayConfirmed, expected] of cases) {
  test(`${status} with awayConfirmed=${awayConfirmed} renders its real confirmation and completion state`, () => {
    const h = harness(status, awayConfirmed);
    for (const width of [320, 390, 430]) {
      const result = progress(h.page, width);
      assert.deepEqual(result.statuses, expected, String(width));
      assert.ok(
        result.html.includes('预约来源'),
        'The DTO exposes the saved court source, not live booking status',
      );
      if (['COMPLETED', 'DECLINED', 'CANCELLED'].includes(status)) {
        assert.doesNotMatch(result.summary, /待确认|待对方确认|待双方确认|待办理|待登记完成/);
        assert.doesNotMatch(result.summary, />邀请有效30分钟</);
      }
      const rows = (result.html.match(/<button\b[^>]*>/g) || []).filter((button) =>
        button.includes('data-mini-bindtap="select"'),
      );
      assert.equal(rows.length, 1);
      assert.ok(rows[0].includes('data-id="' + h.dto.id + '"'));
    }
    assert.equal(
      h.wx.calls.some((call) => call.type === 'request'),
      false,
    );
  });
}

test('a refreshed first matchup replaces the previous summary and keeps the complete list', () => {
  const h = harness('OPEN', false);
  const mapper = h.requireLocal('utils/local-services.js').matchup;
  const completed = mapper({
    ...raw('COMPLETED', true),
    id: id(7),
    homeTeamName: '合成已完成主队',
  });
  h.page.setData({ items: [completed, h.dto] });
  const current = progress(h.page);
  assert.deepEqual(current.statuses, ['已完成', '已确认', '已完成']);
  assert.doesNotMatch(current.summary, /待办理|待确认|待双方确认/);
  assert.ok(current.html.includes('合成已完成主队'));
  assert.equal((current.html.match(/data-mini-bindtap="select"/g) || []).length, 2);
});

test('the completed-state CI fixture exposes the real terminal summary without pending labels', () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../../tests/mini-program/fixtures/int01-matchup-completed.json'),
      'utf8',
    ),
  );
  assert.equal(fixture.data.items[0].status, 'COMPLETED');
  assert.equal(fixture.data.items[0].awayConfirmed, true);
  const h = harness('COMPLETED', true);
  h.page.setData(fixture.data);
  for (const width of [320, 390, 430]) {
    const current = progress(h.page, width);
    assert.deepEqual(current.statuses, ['已完成', '已确认', '已完成']);
    for (const text of fixture.expectText) assert.ok(current.html.includes(text), text);
    for (const text of fixture.expectAbsentText) assert.ok(!current.html.includes(text), text);
  }
});
