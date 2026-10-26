const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const core = require('../utils/api');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const fixtureRoot = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
const publicId = 'e'.repeat(43);

function fixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, 'c10-public-' + name + '.json'), 'utf8'),
  );
}
function eventPage(request) {
  return loadPage({
    root,
    route: 'pages/event/index',
    modules: {
      '../../utils/api': {
        ...core,
        getClient() {
          return { request };
        },
      },
    },
  });
}

test('public event overview switches only display sections and locks tabs during refresh', () => {
  const h = eventPage(() => assert.fail('A display transition must not issue HTTP requests'));
  const event = { name: '合成赛事' };
  h.page.setData({ event });
  assert.equal(h.page.data.overview, true);
  h.page.setData({ loading: true });
  h.page.tab({ currentTarget: { dataset: { tab: 'ranking' } } });
  assert.equal(h.page.data.overview, true);
  assert.equal(h.page.data.tab, 'schedule');
  h.page.setData({ loading: false });
  h.page.tab({ currentTarget: { dataset: { tab: 'ranking' } } });
  assert.equal(h.page.data.overview, false);
  assert.equal(h.page.data.tab, 'ranking');
  h.page.backToOverview();
  assert.equal(h.page.data.overview, true);
  assert.equal(h.page.data.tab, 'schedule');
  assert.deepEqual(h.page.data.event, event);
  assert.equal(h.wx.calls.filter((call) => call.type === 'request').length, 0);
});

test('event display labels retain original public records and no cross-group total is invented', async () => {
  const raw = {
    name: '合成赛事',
    startDate: '2026-10-24',
    endDate: '2026-11-08',
    format: 'GROUP_KNOCKOUT',
  };
  const bracket = {
    rounds: [{ roundNo: 1, slots: [{ positionNo: 1, status: 'WAITING', home: null, away: null }] }],
  };
  const before = JSON.stringify({ raw, bracket });
  const paths = [];
  const h = eventPage(async (p) => {
    paths.push(p);
    if (p.includes('/schedule')) return { data: [], meta: { nextCursor: null } };
    if (p.endsWith('/groups'))
      return { data: { qualificationStatus: 'TIE_BREAK_REQUIRED', groups: [], bracket } };
    return { data: raw };
  });
  h.page.id = publicId;
  await h.page.load();
  assert.equal(h.page.data.event.dateLabel, '10/24–11/08');
  assert.match(h.page.data.qualificationLabel, /同分/);
  assert.equal(h.page.data.bracket.rounds[0].slots[0].status, 'WAITING');
  assert.equal(h.page.data.bracket.rounds[0].slots[0].statusLabel, '尚未发布');
  assert.equal(JSON.stringify({ raw, bracket }), before);
  assert.equal(
    paths.some((p) => p.endsWith('/standings')),
    false,
  );
});

test('revoked event clears old content before the new unavailable state is rendered', async () => {
  const h = eventPage(async () => {
    throw { status: 404 };
  });
  h.page.id = publicId;
  h.page.setData({ event: { name: 'old-hidden-title' }, matches: [{ publicMatchId: 'old' }] });
  await h.page.load();
  const preview = buildPreview({ root, route: 'pages/event/index', data: h.page.data });
  assert.equal(h.page.data.unavailable, true);
  assert.equal(h.page.data.event, null);
  assert.deepEqual(h.page.data.matches, []);
  assert.match(preview.phone, /该内容已停止公开/);
  assert.doesNotMatch(preview.phone, /old-hidden-title/);
  // Only the shared bottom-bar UI icons may load; no event imagery survives revocation.
  assert.deepEqual(
    preview.assets.filter(
      (asset) => !/^assets[\\/]approved-ui[\\/]icon-[a-z-]+\.png$/.test(asset.path),
    ),
    [],
  );
});

test('all public UI fixtures render actual templates at three widths with valid local assets', () => {
  const files = fs.readdirSync(fixtureRoot).filter((name) => name.startsWith('c10-public-'));
  assert.equal(files.length, 22);
  for (const file of files) {
    const f = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), 'utf8'));
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({ root, route: f.route, data: f.data, width, height: 844 });
      for (const text of f.expectText) assert.ok(preview.phone.includes(text), file + ': ' + text);
      assert.doesNotMatch(preview.phone, /\ssrc="https:/, file);
      assert.match(preview.html, /非微信运行时/, file);
      for (const asset of preview.assets) assert.ok(asset.bytes > 0, file);
    }
  }
});

test('public media keeps current data driven image/video types and default empty state', () => {
  const media = fixture('match-media');
  const preview = buildPreview({ root, route: media.route, data: media.data });
  assert.match(preview.phone, /data-mini-tag="video"/);
  assert.match(preview.phone, /定位本场片段/);
  assert.match(preview.phone, /复制外部媒体链接/);
  assert.ok(preview.assets.some((asset) => asset.path === 'assets/court.png'));
  const empty = fixture('match-media-empty');
  const blank = buildPreview({ root, route: empty.route, data: empty.data });
  assert.match(blank.phone, /尚未发布媒体/);
  assert.doesNotMatch(blank.phone, /data-mini-tag="video"/);
});

test('watch invalid input is retained for correction and never starts a hidden request', () => {
  const wx = createWx();
  const h = loadPage({ root, route: 'pages/watch/index', wx });
  h.page.input({ detail: { value: '合成错误链接' } });
  h.page.open();
  assert.equal(h.page.data.value, '合成错误链接');
  assert.match(h.page.data.error, /有效观赛链接/);
  assert.equal(
    wx.calls.some((call) => call.type === 'request' || call.type === 'navigateTo'),
    false,
  );
  h.page.input({ detail: { value: 'https://basketball.playhubs.cn/watch/' + publicId } });
  h.page.open();
  assert.equal(h.page.data.error, '');
  assert.equal(
    wx.calls.some((call) => call.type === 'navigateTo' && call.url.endsWith('?event=' + publicId)),
    true,
  );
  assert.equal(
    wx.calls.some((call) => call.type === 'request'),
    false,
  );
});
