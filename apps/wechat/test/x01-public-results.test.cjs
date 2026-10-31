const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..'),
  pub = 'e'.repeat(43),
  publicMatch = 'm'.repeat(43),
  uid = '11111111-1111-4111-8111-111111111111';
const ok = (data) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-public', nextCursor: null } },
  header: {},
});
const counts = {
  confirmedMatchCount: 1,
  totalMatchCount: 4,
  resolvedMatchCount: 3,
  adjudicatedMatchCount: 1,
  cancelledMatchCount: 1,
};
function board() {
  return {
    name: '合成行政赛果赛事',
    status: 'RUNNING',
    format: 'SINGLE_ELIMINATION',
    startDate: '2026-11-01',
    endDate: '2026-11-08',
    ...counts,
  };
}
function match(kind = 'CANCELLED') {
  return {
    publicMatchId: publicMatch,
    status: 'SCHEDULED',
    resultStatus: 'UNCONFIRMED',
    home: { teamName: '合成甲队' },
    away: { teamName: '合成乙队' },
    startsAt: '2026-11-01T02:00:00.000Z',
    endsAt: '2026-11-01T03:00:00.000Z',
    score: { home: 0, away: 0 },
    clock: { period: 1 },
    adjudication: { kind, winner: kind === 'FORFEIT' ? { teamName: '合成乙队' } : null },
  };
}
function bracket() {
  return {
    rounds: [
      {
        roundNo: 2,
        label: '决赛与季军赛',
        published: false,
        slots: [
          {
            positionNo: 1,
            kind: 'CHAMPIONSHIP',
            sourceOutcome: 'WINNER',
            status: 'SCHEDULED',
            home: { teamName: '甲' },
            away: { teamName: '乙' },
            adjudication: { kind: 'FORFEIT' },
            winner: { teamName: '乙' },
          },
          {
            positionNo: 2,
            kind: 'THIRD_PLACE',
            sourceOutcome: 'LOSER',
            status: 'WAITING',
            home: null,
            away: null,
            winner: null,
          },
        ],
      },
    ],
    ...counts,
  };
}
function device(route) {
  const wx = createWx({
    request: (o) => {
      const p = new URL(o.url).pathname;
      if (p === '/v1/auth/login')
        return {
          ...ok({
            user: { id: uid, email: 'synthetic@example.test', displayName: '合成观众' },
            organizations: [],
            teamContexts: [],
          }),
          header: { 'set-cookie': 'scb.sid=' + 'a'.repeat(43) + '; Secure; HttpOnly' },
        };
      if (p === '/v1/auth/session')
        return ok({ user: { id: uid }, organizations: [], teamContexts: [] });
      if (p.endsWith('/follows/lookup')) return ok(null);
      if (p.endsWith('/schedule')) return ok([match()]);
      if (p.endsWith('/knockout')) return ok(bracket());
      if (p.endsWith('/media')) return ok({ media: [] });
      if (p.includes('/matches/')) return ok(match());
      return ok(board());
    },
  });
  return loadPage({ root, route, wx });
}
test('X01 signed-in public event reads are cookie-less and show administrative counts and genuine bronze labels', async () => {
  const h = device('pages/event/index'),
    client = h.requireLocal('utils/api.js').getClient();
  await client.request('/v1/auth/login', 'POST', {
    email: 'synthetic@example.test',
    password: 'not-a-real-password',
  });
  h.page.id = pub;
  await h.page.load();
  await h.flush();
  assert.ok(h.page.data.event);
  assert.match(h.page.data.event.progressLabel, /已处理 3 \/ 4.*记分确认 1.*弃权 1.*取消 1/);
  assert.equal(h.page.data.matches[0].statusLabel, '本场取消');
  assert.equal(h.page.data.matches[0].score, null);
  assert.equal(h.page.data.bracket.rounds[0].slots[0].winnerLabel, '冠军');
  assert.equal(h.page.data.bracket.rounds[0].slots[1].label, '季军赛');
  assert.equal(h.page.data.bracket.rounds[0].slots[1].homeLabel, '待半决赛负者');
  const reads = h.wx.calls.filter(
    (c) => c.type === 'request' && c.url.includes('/v1/public/events/'),
  );
  assert.ok(reads.length >= 3);
  for (const c of reads) assert.equal(c.header.Cookie, undefined);
  assert.equal(typeof h.page.report, 'function');
});
test('X02 public cancelled match never displays a fabricated zero score or prepared clock', async () => {
  const h = device('pages/match/index'),
    client = h.requireLocal('utils/api.js').getClient();
  await client.request('/v1/auth/login', 'POST', {});
  h.page.event = pub;
  h.page.matchId = publicMatch;
  await h.page.load();
  assert.equal(h.page.data.snapshot.status, 'SCHEDULED');
  assert.equal(h.page.data.snapshot.statusLabel, '本场取消');
  assert.equal(h.page.data.snapshot.score, null);
  assert.equal(h.page.data.snapshot.clock, null);
  assert.match(h.page.data.clock, /无实际计时记录/);
  const preview = buildPreview({ root, route: 'pages/match/index', data: h.page.data });
  assert.match(preview.phone, /行政裁定/);
  assert.match(preview.phone, /不产生胜负/);
  assert.doesNotMatch(preview.phone, /0 : 0|尚未准备/);
  for (const c of h.wx.calls.filter((c) => c.type === 'request' && c.url.includes('/v1/public/')))
    assert.equal(c.header.Cookie, undefined);
});
test('X01 organization progress keeps ordinary confirmations separate and labels bronze winners', async () => {
  const h = loadPage({ root, route: 'pages/org-event/index', wx: createWx() });
  h.page.orgId = uid;
  h.page.eventId = uid;
  const b = bracket();
  b.rounds[0].slots[0] = {
    fixtureKey: 'R2-P1',
    positionNo: 1,
    kind: 'CHAMPIONSHIP',
    status: 'SCHEDULED',
    homeEntryId: 'a',
    awayEntryId: 'b',
    winnerEntryId: 'b',
    adjudication: { kind: 'FORFEIT' },
  };
  b.rounds[0].slots[1] = {
    fixtureKey: 'R2-P2',
    positionNo: 2,
    kind: 'THIRD_PLACE',
    sourceOutcome: 'LOSER',
    status: 'WAITING',
    homeEntryId: null,
    awayEntryId: null,
    winnerEntryId: null,
  };
  const ranking = await h.page.readRanking(
    {
      request: async () => ({
        data: {
          bracket: b,
          participants: [
            { entryId: 'a', teamName: '甲' },
            { entryId: 'b', teamName: '乙' },
          ],
        },
      }),
    },
    'SINGLE_ELIMINATION',
  );
  assert.match(ranking.value.bracket.progress, /记分确认 1.*弃权 1.*取消 1/);
  assert.equal(ranking.value.bracket.rounds[0].slots[0].winnerLabel, '冠军');
  assert.equal(ranking.value.bracket.rounds[0].slots[1].label, '季军赛');
  assert.equal(ranking.value.bracket.rounds[0].slots[1].home, '待半决赛负者');
});
