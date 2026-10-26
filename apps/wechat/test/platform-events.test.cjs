const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathAllowed } = require('../utils/api');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');

const orgA = '11111111-1111-4111-8111-111111111111';
const orgB = '22222222-2222-4222-8222-222222222222';
const eventA = '33333333-3333-4333-8333-333333333333';
const eventB = '44444444-4444-4444-8444-444444444444';
const viewer = '55555555-5555-4555-8555-555555555555';
const publicKey = 'p'.repeat(43);
const cookie = 'c'.repeat(43);
const envelope = (data, nextCursor = null) => ({
  data,
  meta: { requestId: 'explicit-platform-fixture', nextCursor },
});
const ok = (data, nextCursor) => ({
  statusCode: 200,
  data: envelope(data, nextCursor),
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const fail = (statusCode, code = 'FORBIDDEN') => ({
  statusCode,
  data: { error: { code, message: '合成错误 ' + statusCode } },
});
const session = (organizations = [], teamContexts = []) => ({
  user: { id: viewer, email: 'synthetic@example.test', displayName: '合成账号' },
  organizations,
  teamContexts,
});
const event = (id, status, name, startDate = '2026-11-01') => ({
  id,
  name,
  startDate,
  endDate: '2026-11-03',
  timezone: 'Asia/Shanghai',
  venueName: '合成体育馆',
  format: 'ROUND_ROBIN',
  status,
  version: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
});

function harness(route, routes) {
  const wx = createWx({
    request(options) {
      const url = options.url.replace(/^https:\/\/[^/]+/, '');
      for (const [pattern, reply] of routes)
        if (typeof pattern === 'string' ? url === pattern : pattern.test(url))
          return typeof reply === 'function' ? reply(url) : reply;
      return fail(404, 'TEST_UNHANDLED');
    },
  });
  const h = loadPage({ root, route, wx });
  const requests = () => wx.calls.filter((c) => c.type === 'request').map((c) => c.url);
  return { ...h, requests };
}
async function signIn(h) {
  await h.requireLocal('utils/api.js').getClient().request('/v1/auth/session');
}

test('platform paths allow own-organization reads and existing role-checked commands only', () => {
  const match = '/v1/orgs/' + orgA + '/matches/' + eventA;
  for (const [url, method] of [
    ['/v1/orgs/' + orgA + '/events?limit=50', 'GET'],
    ['/v1/orgs/' + orgA + '/events?limit=50&cursor=abc_DEF-1', 'GET'],
    ['/v1/orgs/' + orgA + '/events/' + eventA, 'GET'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/standings', 'GET'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/groups', 'GET'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/knockout', 'GET'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/player-statistics', 'GET'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/matches?limit=100', 'GET'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/lifecycle', 'GET'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/lifecycle-commands', 'POST'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/registration-commands', 'POST'],
    ['/v1/orgs/' + orgA + '/scoring-matches', 'GET'],
    ['/v1/orgs/' + orgA + '/scoring-matches?eventId=' + eventA + '&limit=100', 'GET'],
    [match + '/scoring', 'GET'],
    [match + '/snapshot', 'GET'],
    [match + '/scoring-events?limit=100', 'GET'],
    [match + '/result-confirmations?limit=100', 'GET'],
    [match + '/commands', 'POST'],
    [match + '/commands/' + orgA, 'GET'],
    [match + '/scorekeeper-lease', 'POST'],
    [match + '/scorekeeper-lease', 'DELETE'],
    [match + '/scorekeeper-lease/renew', 'POST'],
    ['/v1/orgs/' + orgA + '/events', 'POST'],
    ['/v1/orgs/' + orgA + '/events/' + eventA, 'PATCH'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/registration-rules', 'PUT'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/scoring-rules', 'PUT'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/standings-rules', 'PUT'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/standings-rule-commands', 'POST'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/public-viewing-commands', 'POST'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/scheduling', 'GET'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/schedule-revisions', 'POST'],
    ['/v1/orgs/' + orgA + '/courts?limit=100', 'GET'],
    ['/v1/orgs/' + orgA + '/courts', 'POST'],
    ['/v1/orgs/' + orgA + '/schedule-revisions/' + eventA, 'GET'],
    ['/v1/orgs/' + orgA + '/schedule-revisions/' + eventA + '/allocations', 'PUT'],
    ['/v1/orgs/' + orgA + '/schedule-revisions/' + eventA + '/validate', 'POST'],
    ['/v1/orgs/' + orgA + '/schedule-revisions/' + eventA + '/publish', 'POST'],
    ['/v1/orgs/' + orgA + '/members', 'GET'],
    [match + '/staff/' + orgA, 'PUT'],
  ])
    assert.equal(pathAllowed(url, method), true, method + ' ' + url);
  for (const [url, method] of [
    ['/v1/orgs/' + orgA + '/events', 'GET'],
    ['/v1/orgs/' + orgA + '/events?limit=100', 'GET'],
    ['/v1/orgs/' + orgA + '/events?limit=50&q=private', 'GET'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/lifecycle', 'POST'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/player-statistics?asOf=1', 'GET'],
    ['/v1/orgs/' + orgA + '/scoring-matches?status=LIVE', 'GET'],
    ['/v1/orgs/' + orgA + '/scoring-matches?eventId=private', 'GET'],
    [match + '/commands', 'GET'],
    [match + '/scorekeeper-lease', 'GET'],
    [match + '/reschedule-commands', 'POST'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/public-viewing-commands', 'PUT'],
    ['/v1/orgs/' + orgA + '/events/' + eventA, 'DELETE'],
    ['/v1/orgs/' + orgA + '/courts/' + eventA, 'PATCH'],
    ['/v1/orgs/' + orgA + '/members/' + eventA, 'PUT'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/staff/' + orgA, 'PUT'],
    ['/v1/orgs/' + orgA + '/events/' + eventA + '/lifecycle', 'POST'],
    [match + '/scoring-events?limit=20', 'GET'],
    ['/v1/orgs/not-a-uuid/events?limit=50', 'GET'],
  ])
    assert.equal(pathAllowed(url, method), false, method + ' ' + url);
});

test('signed-out events tab issues no private request and keeps the public watch entry', async () => {
  const h = harness('pages/watch/index', []);
  h.page.onLoad();
  await h.page.load();
  await h.flush();
  assert.deepEqual(h.requests(), []);
  assert.equal(h.page.data.signedIn, false);
  const preview = buildPreview({ root, route: 'pages/watch/index', data: h.page.data });
  assert.match(preview.phone, /登录后查看你参与的赛事/);
  assert.match(preview.phone, /粘贴观赛链接/);
  assert.match(preview.phone, /公开赛事目录尚未开放/);
});

test('a player without an organization role never reads institution events and sees teams entry', async () => {
  const h = harness('pages/watch/index', [
    [
      '/v1/auth/session',
      ok(session([], [{ orgId: orgA, teamId: eventA, organizationName: '合成机构' }])),
    ],
  ]);
  await signIn(h);
  h.page.onLoad();
  await h.page.load();
  await h.flush();
  assert.equal(
    h.requests().some((url) => url.includes('/events')),
    false,
  );
  assert.equal(h.page.data.signedIn, true);
  assert.equal(h.page.data.teamCount, 1);
  const preview = buildPreview({ root, route: 'pages/watch/index', data: h.page.data });
  assert.match(preview.phone, /当前账号没有机构赛事身份/);
  assert.match(preview.phone, /进入我的球队（1支）/);
});

test('my events groups by real status, keeps per-organization failures and opens the org page', async () => {
  const h = harness('pages/watch/index', [
    [
      '/v1/auth/session',
      ok(
        session([
          { id: orgA, name: '合成机构A', role: 'ORG_ADMIN' },
          { id: orgB, name: '合成机构B', role: 'SCORER' },
          { id: 'not-a-uuid', name: '坏数据', role: 'ORG_ADMIN' },
        ]),
      ),
    ],
    [
      '/v1/orgs/' + orgA + '/events?limit=50',
      ok(
        [
          event(eventA, 'COMPLETED', '合成秋季联赛', '2026-09-01'),
          event(eventB, 'RUNNING', '合成冬季杯'),
        ],
        'next-cursor',
      ),
    ],
    ['/v1/orgs/' + orgB + '/events?limit=50', fail(403)],
  ]);
  await signIn(h);
  h.page.onLoad();
  await h.page.load();
  await h.flush();
  const requested = h.requests().filter((url) => url.includes('/events'));
  assert.equal(requested.length, 2);
  assert.deepEqual(
    h.page.data.sections.map((s) => s.key),
    ['live', 'finished'],
  );
  assert.equal(h.page.data.sections[0].events[0].name, '合成冬季杯');
  assert.equal(h.page.data.failures.length, 1);
  assert.match(h.page.data.failures[0].message, /不能查看该机构/);
  assert.deepEqual(h.page.data.truncated, ['合成机构A']);
  h.page.openEvent({ currentTarget: { dataset: { org: orgA, id: eventB } } });
  assert.ok(
    h.wx.calls.some(
      (c) =>
        c.type === 'navigateTo' &&
        c.url === '/pages/org-event/index?orgId=' + orgA + '&eventId=' + eventB,
    ),
  );
  h.page.openEvent({ currentTarget: { dataset: { org: '__proto__', id: eventB } } });
  assert.match(h.page.data.eventsError, /入口无效/);
});

test('a late private list from a previous account is discarded', async () => {
  let release;
  const h = harness('pages/watch/index', [
    ['/v1/auth/session', ok(session([{ id: orgA, name: '合成机构A', role: 'ORG_ADMIN' }]))],
    [
      '/v1/orgs/' + orgA + '/events?limit=50',
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok([event(eventA, 'RUNNING', '旧账号赛事')]));
        }),
    ],
  ]);
  await signIn(h);
  h.page.onLoad();
  const pending = h.page.load();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  h.requireLocal('utils/api.js').getClient().clearSession();
  release();
  await pending;
  await h.flush();
  assert.equal(JSON.stringify(h.page.data).includes('旧账号赛事'), false);
});

test('home puts events first and keeps the booking extension intact', async () => {
  const h = harness('pages/home/index', [
    ['/v1/auth/session', ok(session([{ id: orgA, name: '合成机构A', role: 'EVENT_MANAGER' }]))],
    [
      '/v1/orgs/' + orgA + '/events?limit=50',
      ok([
        event(eventA, 'SCHEDULED', '合成冬季杯'),
        event(eventB, 'ARCHIVED', '合成旧赛事', '2025-01-01'),
      ]),
    ],
  ]);
  await signIn(h);
  h.page.onLoad();
  await h.page.loadEvents();
  await h.flush();
  assert.deepEqual(
    h.page.data.featured.map((e) => e.name),
    ['合成冬季杯'],
  );
  const preview = buildPreview({ root, route: 'pages/home/index', data: h.page.data });
  const html = preview.phone;
  assert.ok(html.indexOf('我的赛事') < html.indexOf('按位置找球员'));
  for (const text of ['合成冬季杯', '赛事数据', '扩展服务', '查看我的预约', '进入本人球员中心'])
    assert.match(html, new RegExp(text));
  const signedOut = buildPreview({ root, route: 'pages/home/index' });
  assert.match(signedOut.phone, /登录后查看你参与的赛事/);
});

function orgEventRoutes(overrides = {}) {
  const base = '/v1/orgs/' + orgA + '/events/' + eventA;
  return [
    ['/v1/auth/session', ok(session([{ id: orgA, name: '合成机构A', role: 'ORG_ADMIN' }]))],
    [base, overrides.event || ok(event(eventA, 'RUNNING', '合成冬季杯'))],
    [
      base + '/matches?limit=100',
      ok([
        {
          id: eventB,
          roundNo: 1,
          positionNo: 1,
          home: { teamName: '合成主队' },
          away: { teamName: '合成客队' },
          courtName: '一号场',
          startsAt: '2026-11-01T11:30:00Z',
          endsAt: '2026-11-01T13:00:00Z',
          status: 'SCHEDULED',
          version: 1,
        },
      ]),
    ],
    [
      base + '/standings',
      overrides.standings ||
        ok({
          locked: true,
          publication: {
            publicEventId: publicKey,
            status: 'ACTIVE',
            createdAt: '2026-10-01T00:00:00Z',
            revokedAt: null,
          },
          standings: {
            mode: 'PUBLISHED',
            confirmedMatchCount: 1,
            totalMatchCount: 3,
            rows: [
              {
                entryId: orgB,
                teamName: '合成主队',
                rank: 1,
                tied: false,
                wins: 1,
                losses: 0,
                scoreDifference: 6,
                leaguePoints: 2,
              },
            ],
          },
        }),
    ],
    [
      base + '/player-statistics',
      overrides.stats ||
        ok({
          summary: {
            totalMatchCount: 3,
            includedMatchCount: 1,
            pendingMatchCount: 2,
            coverageComplete: false,
            attributionComplete: true,
            rows: [
              {
                entryId: orgB,
                memberId: viewer,
                name: '合成球员',
                jerseyNo: '7',
                teamName: '合成主队',
                score: 18,
                fouls: 2,
                rosterSampleMatchCount: 1,
                rank: 1,
                tied: false,
              },
            ],
            teams: [],
          },
        }),
    ],
  ];
}

test('org event page rejects malformed entry without a request', async () => {
  const h = harness('pages/org-event/index', []);
  h.page.onLoad({ orgId: '__proto__', eventId: eventA });
  await h.flush();
  assert.deepEqual(h.requests(), []);
  assert.equal(h.page.data.unavailable, true);
});

test('org event page renders schedule, published standings and basic stats with uncollected fields', async () => {
  const h = harness('pages/org-event/index', orgEventRoutes());
  await signIn(h);
  h.page.onLoad({ orgId: orgA, eventId: eventA, tab: 'stats' });
  await h.flush();
  assert.equal(h.page.data.event.name, '合成冬季杯');
  assert.equal(h.page.data.matches[0].home, '合成主队');
  assert.equal(h.page.data.ranking.rows[0].points, 2);
  assert.equal(h.page.data.publicEventId, publicKey);
  assert.equal(h.page.data.stats.rows[0].score, 18);
  const stats = buildPreview({ root, route: 'pages/org-event/index', data: h.page.data });
  assert.match(stats.phone, /篮板、助攻、抢断、盖帽、失误、命中率与上场时间：未统计/);
  assert.match(stats.phone, /2 场待确认，未纳入/);
  h.page.tab({ currentTarget: { dataset: { tab: 'ranking' } } });
  const ranking = buildPreview({ root, route: 'pages/org-event/index', data: h.page.data });
  assert.match(ranking.phone, /正式积分/);
  h.page.openPublic();
  assert.ok(h.wx.calls.some((c) => c.url === '/pages/event/index?event=' + publicKey));
  h.page.tab({ currentTarget: { dataset: { tab: 'schedule' } } });
  const schedule = buildPreview({ root, route: 'pages/org-event/index', data: h.page.data });
  assert.match(schedule.phone, /点击比赛查看比分、记录与确认状态/);
});

test('a forbidden section stays local; a hidden event clears the page', async () => {
  const partial = harness('pages/org-event/index', orgEventRoutes({ stats: fail(403) }));
  await signIn(partial);
  partial.page.onLoad({ orgId: orgA, eventId: eventA });
  await partial.flush();
  assert.equal(partial.page.data.event.name, '合成冬季杯');
  assert.match(partial.page.data.statsError, /无权查看/);
  assert.equal(partial.page.data.stats, null);
  const hidden = harness(
    'pages/org-event/index',
    orgEventRoutes({ event: fail(404, 'RESOURCE_NOT_FOUND') }),
  );
  await signIn(hidden);
  hidden.page.onLoad({ orgId: orgA, eventId: eventA });
  await hidden.flush();
  assert.equal(hidden.page.data.event, null);
  assert.equal(hidden.page.data.unavailable, true);
  assert.equal(
    hidden.requests().some((url) => url.endsWith('/player-statistics')),
    false,
  );
});

test('platform synthetic fixtures render their states at three widths and are catalogued once', () => {
  const fs = require('node:fs');
  const fixtureRoot = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
  const catalog = JSON.parse(
    fs.readFileSync(path.resolve(fixtureRoot, '../platform-catalog.json'), 'utf8'),
  );
  const files = fs.readdirSync(fixtureRoot).filter((name) => name.startsWith('platform-'));
  assert.deepEqual(
    files.map((name) => name.replace(/\.json$/, '')).sort(),
    catalog.scenarios.map((s) => s.name).sort(),
  );
  for (const file of files) {
    const f = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), 'utf8'));
    assert.equal(f.designSource, 'synthetic:platform-alignment', file);
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({ root, route: f.route, data: f.data, width, height: 844 });
      for (const text of f.expectText) assert.ok(preview.phone.includes(text), file + ': ' + text);
      for (const text of f.expectAbsentText || [])
        assert.equal(preview.phone.includes(text), false, file + ': ' + text);
    }
  }
});

test('invalid result sources are not shown as standings', async () => {
  const h = harness(
    'pages/org-event/index',
    orgEventRoutes({ standings: fail(409, 'RESULT_SOURCE_INVALID') }),
  );
  await signIn(h);
  h.page.onLoad({ orgId: orgA, eventId: eventA, tab: 'ranking' });
  await h.flush();
  assert.equal(h.page.data.ranking, null);
  assert.match(h.page.data.rankingError, /正式赛果来源待核对/);
  assert.equal(h.page.data.publicEventId, '');
});
