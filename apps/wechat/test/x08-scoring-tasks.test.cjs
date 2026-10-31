const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..'),
  id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
async function page(rows) {
  const h = loadPage({ root, route: 'pages/scoring-tasks/index' }),
    api = h.requireLocal('utils/api.js');
  const client = {
    hasSession: () => true,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url) {
      if (url === '/v1/auth/session')
        return {
          data: {
            user: { id: id(1) },
            organizations: [{ id: id(2), name: '合成机构', role: 'ORG_OWNER' }],
            teamContexts: [],
          },
        };
      return { data: rows, meta: { nextCursor: null } };
    },
  };
  api.getClient = () => client;
  await h.page.load();
  return h;
}
const match = (n, status = 'READY') => ({
  matchId: id(n),
  eventId: id(3),
  eventName: '合成赛事',
  homeTeamName: '主队',
  awayTeamName: '客队',
  courtName: '场地',
  startsAt: '2026-11-01T00:00:00Z',
  status,
  score: { home: 0, away: 0 },
});
test('adjudicated scheduled and ready matches use a separate task group and never show preparation scores', async () => {
  const h = await page([
    { ...match(4), adjudication: { kind: 'FORFEIT' } },
    { ...match(5, 'SCHEDULED'), score: null, adjudication: { kind: 'CANCELLED' } },
    match(6),
  ]);
  const groups = h.page.data.sections,
    admin = groups.find((g) => g.key === 'adjudicated'),
    ready = groups.find((g) => g.key === 'ready');
  assert.equal(admin.items.length, 2);
  assert.deepEqual(
    Array.from(admin.items, (m) => m.score),
    ['', ''],
  );
  assert.match(admin.items[0].statusLabel, /弃权/);
  assert.match(admin.items[1].statusLabel, /已取消/);
  assert.equal(ready.items.length, 1);
  assert.equal(ready.items[0].matchId, id(6));
  assert.equal(ready.items[0].score, '0 : 0');
  for (const width of [320, 390, 430]) {
    const preview = buildPreview({
      root,
      route: 'pages/scoring-tasks/index',
      data: { ...h.page.data, sections: [admin] },
      width,
    });
    assert.match(preview.html, /行政弃权.*不计个人统计/);
    assert.doesNotMatch(preview.html, /0 : 0|待开赛|待准备/);
  }
});
test('an invalid administrative marker fails the organization read instead of falling into a preparation group', async () => {
  const h = await page([{ ...match(4), adjudication: { kind: 'UNKNOWN' } }]);
  assert.equal(h.page.data.sections.length, 0);
  assert.equal(h.page.data.orgErrors.length, 1);
  assert.match(h.page.data.orgErrors[0].text, /裁定资料格式无效/);
});
