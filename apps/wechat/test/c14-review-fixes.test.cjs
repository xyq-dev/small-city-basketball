const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');

// PR #23 review: reads (poll, refresh, onShow) must not orphan a write in flight, and event-setup
// must round-trip the server's rules without reordering tiebreakers or rounding seconds.
const org = '11111111-1111-4111-8111-111111111111';
const eventId = '33333333-3333-4333-8333-333333333333';
const matchId = '44444444-4444-4444-8444-444444444444';
const userA = '55555555-5555-4555-8555-555555555555';
const userB = '66666666-6666-4666-8666-666666666666';
const entryId = '77777777-7777-4777-8777-777777777777';
const rulesetId = '88888888-8888-4888-8888-888888888888';
const cookie = 'a'.repeat(43);
const ok = (data) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-review-fixture', nextCursor: null } },
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const conflict = () => ({
  statusCode: 409,
  data: { error: { code: 'VERSION_CONFLICT', message: '合成版本冲突' } },
});
const session = {
  user: { id: userA, email: 'synthetic@example.test', displayName: '合成负责人' },
  organizations: [{ id: org, name: '合成机构', role: 'ORG_OWNER' }],
  teamContexts: [],
};
const ticks = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
// The handler a WXML button is bound to, so a test taps exactly what the runtime would call.
function bound(route, label) {
  const wxml = fs.readFileSync(path.join(root, route + '.wxml'), 'utf8');
  const tag = wxml.split('<button').find((t) => t.includes('>' + label + '<'));
  assert.ok(tag, 'button ' + label);
  return /bindtap="([A-Za-z]+)"/.exec(tag)[1];
}
const tap = (dataset = {}) => ({ type: 'tap', currentTarget: { dataset }, detail: {} });

// Synthetic server keyed by "METHOD path"; `hold` parks one route until `release`.
function server(route) {
  const state = { replies: new Map(), held: new Map(), bodies: [] };
  const wx = createWx({
    modalAnswers: Array(20).fill(true),
    request(options) {
      const key = (options.method || 'GET') + ' ' + options.url.replace(/^https:\/\/[^/]+/, '');
      if (options.method && options.method !== 'GET')
        state.bodies.push({
          key,
          body: typeof options.data === 'string' ? JSON.parse(options.data) : options.data,
        });
      if (state.held.has(key))
        return new Promise((resolve, reject) =>
          state.held.get(key).push(() => reply(key).then(resolve, reject)),
        );
      return reply(key);
    },
  });
  async function reply(key) {
    if (key === 'GET /v1/auth/session') return ok(session);
    const handler = state.replies.get(key);
    if (handler) return handler();
    return { statusCode: 404, data: { error: { code: 'TEST_UNHANDLED', message: key } } };
  }
  const h = loadPage({ root, route, wx });
  const client = h.requireLocal('utils/api.js').getClient();
  return {
    ...h,
    state,
    client,
    on(key, handler) {
      state.replies.set(key, handler);
    },
    hold(key) {
      state.held.set(key, []);
    },
    release(key) {
      const waiting = state.held.get(key) || [];
      state.held.delete(key);
      for (const resume of waiting) resume();
    },
    count(key) {
      return wx.calls.filter(
        (c) =>
          c.type === 'request' &&
          (c.method || 'GET') + ' ' + c.url.replace(/^https:\/\/[^/]+/, '') === key,
      ).length;
    },
  };
}

const matchBase = '/v1/orgs/' + org + '/matches/' + matchId;
const snapshot = (status, version) => ({
  status,
  version,
  home: { teamName: '合成主队' },
  away: { teamName: '合成客队' },
  totals: { home: { score: 5, fouls: 1, timeouts: 0 }, away: { score: 3, fouls: 0, timeouts: 1 } },
  periods: [{ period: 1, home: { score: 5 }, away: { score: 3 } }],
  rules: { regulationPeriods: 4, allowedScoreValues: [1, 2, 3] },
  clock: { period: 4, remainingMs: 0, running: false, anchorServerTime: '2026-10-27T10:00:00Z' },
  serverTime: '2026-10-27T10:00:10.000Z',
  collected: { playerStatistics: false },
  requiresReconfirmation: false,
});
function workbench(status, version, staff = []) {
  return {
    event: { id: eventId, name: '合成赛事', status: 'RUNNING', version: 3 },
    match: {
      roundNo: 1,
      startsAt: '2026-11-01T02:00:00Z',
      courtName: '合成1号场',
      home: { teamName: '合成主队' },
      away: { teamName: '合成客队' },
      status,
      version,
    },
    rules: { regulationPeriods: 4, periodDurationSeconds: 600, tiePolicy: 'OVERTIME' },
    snapshot: snapshot(status, version),
    playerRoster: { home: [], away: [] },
    staff,
    lease: null,
    capabilities: {
      canManageStaff: true,
      canPrepare: false,
      canAcquireControl: false,
      canConfirm: status === 'ENDED',
      canReopen: false,
    },
  };
}
async function matchPage(status) {
  const s = server('pages/org-match/index');
  let version = 5,
    staff = [];
  s.on('GET ' + matchBase + '/scoring', () => ok(workbench(status, version, staff)));
  s.on('GET ' + matchBase + '/scoring-events?limit=100', () => ok([]));
  s.on('GET ' + matchBase + '/result-confirmations?limit=100', () => ok([]));
  s.on('GET /v1/orgs/' + org + '/members', () =>
    ok([{ userId: userB, status: 'ACTIVE', displayName: '合成记分员', email: 'b@example.test' }]),
  );
  s.on('PUT ' + matchBase + '/staff/' + userB, () => {
    version++;
    staff = [{ userId: userB, role: 'SCORER', status: 'ACTIVE', displayName: '合成记分员' }];
    return ok({});
  });
  s.on('POST ' + matchBase + '/commands', () => {
    version++;
    return ok({ snapshot: snapshot('FINAL', version) });
  });
  await s.client.request('/v1/auth/session');
  s.page.onLoad({ orgId: org, matchId });
  await s.flush();
  assert.equal(s.page.data.loading, false);
  assert.equal(s.page.data.members.length, 1);
  return s;
}

test('org-match: a poll whose session read is slow cannot orphan a staff assignment', async () => {
  const s = await matchPage('LIVE');
  const poll = [...s.intervals.values()][0];
  assert.equal(typeof poll, 'function', 'LIVE match polls');
  s.hold('GET /v1/auth/session');
  s.hold('PUT ' + matchBase + '/staff/' + userB);
  poll();
  await ticks();
  s.page.assign();
  await ticks();
  assert.equal(s.page.data.busy, true);
  s.release('GET /v1/auth/session');
  await ticks();
  s.release('PUT ' + matchBase + '/staff/' + userB);
  await s.flush();
  assert.equal(s.page.data.busy, false);
  assert.equal(s.page.data.notice, '已分配记分员。');
  assert.equal(s.count('PUT ' + matchBase + '/staff/' + userB), 1);
  // The post-write reload shows the new assignment rather than the poll's older read.
  assert.deepEqual(
    s.page.data.staff.map((r) => r.name),
    ['合成记分员'],
  );
  s.unload();
});

test('org-match: tapping refresh while a result confirmation is in flight does not cancel it', async () => {
  const s = await matchPage('ENDED');
  const refresh = bound('pages/org-match/index', '刷新比赛');
  s.hold('POST ' + matchBase + '/commands');
  const confirming = s.page.confirmResult();
  await ticks();
  assert.equal(s.page.data.busy, true);
  const reads = s.count('GET ' + matchBase + '/scoring');
  s.page[refresh](tap());
  await ticks();
  assert.equal(s.count('GET ' + matchBase + '/scoring'), reads, 'no read during the write');
  s.release('POST ' + matchBase + '/commands');
  await confirming;
  await s.flush();
  assert.equal(s.page.data.busy, false);
  assert.match(s.page.data.notice, /已完成/);
  assert.equal(s.count('POST ' + matchBase + '/commands'), 1);
  assert.equal(s.count('GET ' + matchBase + '/scoring'), reads + 1, 'one reload after the write');
  s.unload();
});

test('org-match: the refresh button is a full read, not a quiet poll', async () => {
  const s = await matchPage('ENDED');
  const refresh = bound('pages/org-match/index', '刷新比赛');
  s.hold('GET ' + matchBase + '/scoring');
  s.page[refresh](tap());
  await ticks();
  assert.equal(s.page.data.loading, true);
  s.release('GET ' + matchBase + '/scoring');
  await s.flush();
  assert.equal(s.page.data.loading, false);
  s.unload();
});

test('org-match: a failed write during a poll ends busy and re-reads once', async () => {
  const s = await matchPage('LIVE');
  const poll = [...s.intervals.values()][0];
  s.on('PUT ' + matchBase + '/staff/' + userB, conflict);
  s.hold('GET /v1/auth/session');
  s.hold('PUT ' + matchBase + '/staff/' + userB);
  poll();
  await ticks();
  s.page.assign();
  await ticks();
  s.release('GET /v1/auth/session');
  await ticks();
  s.release('PUT ' + matchBase + '/staff/' + userB);
  await s.flush();
  assert.equal(s.page.data.busy, false);
  assert.match(s.page.data.error, /已被其他操作更新/);
  assert.equal(s.page.data.match.statusLabel.length > 0, true);
  s.unload();
});

test('org-match: a lost confirmation response stays recoverable by its original command id', async () => {
  const s = await matchPage('ENDED');
  let executed = null;
  s.on('POST ' + matchBase + '/commands', () => {
    executed = s.state.bodies.at(-1).body;
    return Promise.reject(new Error('synthetic lost response'));
  });
  await s.page.confirmResult();
  await s.flush();
  assert.equal(s.page.data.busy, false);
  assert.ok(s.page.data.pending, 'unknown result kept');
  assert.equal(s.page.data.pending.body.commandId, executed.commandId);
  s.on('GET ' + matchBase + '/commands/' + executed.commandId, () =>
    ok({ snapshot: snapshot('FINAL', 6) }),
  );
  // A refresh while checking must not cancel the receipt lookup either.
  s.hold('GET ' + matchBase + '/commands/' + executed.commandId);
  const checking = s.page.checkPending();
  await ticks();
  s.page[bound('pages/org-match/index', '刷新比赛')](tap());
  await ticks();
  s.release('GET ' + matchBase + '/commands/' + executed.commandId);
  await checking;
  await s.flush();
  assert.equal(s.page.data.busy, false);
  assert.equal(s.page.data.pending, null);
  assert.match(s.page.data.notice, /已在服务端完成/);
  assert.equal(s.count('POST ' + matchBase + '/commands'), 1, 'never sent as a new command');
  s.unload();
});

test('org-match: an account change during a write clears the page and ignores the late reply', async () => {
  const s = await matchPage('ENDED');
  s.hold('POST ' + matchBase + '/commands');
  const confirming = s.page.confirmResult();
  await ticks();
  assert.equal(s.page.data.busy, true);
  s.client.clearSession();
  assert.equal(s.page.data.busy, false);
  assert.equal(s.page.data.match, null);
  s.release('POST ' + matchBase + '/commands');
  await confirming;
  await s.flush();
  assert.equal(s.page.data.match, null);
  assert.equal(s.page.data.notice, '');
  assert.equal(s.page.data.busy, false);
  s.unload();
});

const regBase = '/v1/orgs/' + org + '/events/' + eventId;
test('entry-review: refreshing during a review neither cancels it nor leaves busy set', async () => {
  const s = server('pages/entry-review/index');
  let status = 'SUBMITTED';
  s.on('GET ' + regBase + '/registration', () =>
    ok({
      event: { name: '合成赛事', status: 'REGISTRATION_OPEN', version: 2 },
      rules: null,
      counts: { [status]: 1 },
      freeze: null,
      capabilities: {},
    }),
  );
  s.on('GET ' + regBase + '/entries?limit=100', () =>
    ok([{ id: entryId, teamName: '合成队', status, latestReviewReason: null }]),
  );
  const entry = () => ({
    id: entryId,
    version: 1,
    teamName: '合成队',
    status,
    players: [],
    history: [],
    capabilities: { canApprove: status === 'SUBMITTED', canReview: true },
  });
  s.on('GET /v1/orgs/' + org + '/entries/' + entryId, () => ok(entry()));
  s.on('POST /v1/orgs/' + org + '/entries/' + entryId + '/commands', () => {
    status = 'APPROVED';
    return ok(entry());
  });
  await s.client.request('/v1/auth/session');
  s.page.onLoad({ orgId: org, eventId });
  await s.flush();
  s.page.openEntry(tap({ id: entryId }));
  await s.flush();
  const post = 'POST /v1/orgs/' + org + '/entries/' + entryId + '/commands';
  s.hold(post);
  const reviewing = s.page.review(tap({ type: 'APPROVE' }));
  await ticks();
  assert.equal(s.page.data.busy, true);
  s.page[bound('pages/entry-review/index', '刷新报名')](tap());
  await ticks();
  s.release(post);
  await reviewing;
  await s.flush();
  assert.equal(s.page.data.busy, false);
  assert.match(s.page.data.notice, /已通过/);
  assert.equal(s.page.data.entries[0].status, 'APPROVED');
  s.unload();
});

function setupPage(rules) {
  const s = server('pages/event-setup/index');
  s.on('GET ' + regBase, () =>
    ok({
      id: eventId,
      name: '合成赛事',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      venueName: '合成体育馆',
      format: 'ROUND_ROBIN',
      status: 'DRAFT',
      version: 4,
      permissions: { canEditDraft: true },
    }),
  );
  s.on('GET ' + regBase + '/registration', () =>
    ok({ rules: null, capabilities: { canManageRules: true } }),
  );
  s.on('GET ' + regBase + '/scoring', () =>
    ok({ rules: rules.scoring, locked: false, capabilities: { canManageRules: true } }),
  );
  s.on('GET ' + regBase + '/standings', () =>
    ok({
      rules: rules.standings,
      locked: false,
      publication: null,
      capabilities: {
        canManageRules: true,
        canPublishRules: true,
        canEnablePublicViewing: false,
        canDisablePublicViewing: false,
      },
    }),
  );
  s.on('PUT ' + regBase + '/standings-rules', () => ok({}));
  s.on('PUT ' + regBase + '/scoring-rules', () => ok({}));
  return s;
}
const input = (section, field, value) => ({
  type: 'input',
  currentTarget: { dataset: { section, field } },
  detail: { value },
});
const standingsRules = (tiebreakers) => ({
  id: rulesetId,
  winPoints: 2,
  lossPoints: 1,
  drawPoints: 1,
  tiebreakers,
});
const scoringRules = {
  regulationPeriods: 4,
  periodDurationSeconds: 90,
  allowedScoreValues: [1, 2, 3],
  tiePolicy: 'OVERTIME',
  overtimeDurationSeconds: 30,
};
const sent = (s, key) => s.state.bodies.filter((b) => b.key === 'PUT ' + regBase + key);
const shownOrder = (s) => s.page.data.standings.tiebreakers.filter((t) => t.on).map((t) => t.value);

test('event-setup: changing only the win points keeps the server tiebreaker order', async () => {
  for (const order of [
    ['WINS', 'POINTS_FOR', 'SCORE_DIFFERENCE'],
    ['POINTS_FOR'],
    ['POINTS_FOR', 'WINS'],
    [],
  ]) {
    const s = setupPage({ scoring: scoringRules, standings: standingsRules(order) });
    await s.client.request('/v1/auth/session');
    s.page.onLoad({ orgId: org, eventId });
    await s.flush();
    assert.deepEqual([...shownOrder(s)], order, 'shown in server order');
    s.page.field(input('standings', 'win', '3'));
    await s.page.saveStandings();
    await s.flush();
    const [put] = sent(s, '/standings-rules');
    assert.equal(put.body.winPoints, 3);
    assert.deepEqual(put.body.tiebreakers, order);
    s.unload();
  }
});

test('event-setup: tiebreaker order changes only when the organizer reorders it', async () => {
  const s = setupPage({
    scoring: scoringRules,
    standings: standingsRules(['WINS', 'POINTS_FOR', 'SCORE_DIFFERENCE']),
  });
  await s.client.request('/v1/auth/session');
  s.page.onLoad({ orgId: org, eventId });
  await s.flush();
  const index = (v) => s.page.data.standings.tiebreakers.findIndex((t) => t.value === v);
  s.page.moveTiebreaker(tap({ index: index('SCORE_DIFFERENCE') }));
  assert.deepEqual([...shownOrder(s)], ['WINS', 'SCORE_DIFFERENCE', 'POINTS_FOR']);
  s.page.toggle(tap({ section: 'standings', field: 'tiebreakers', index: index('WINS') }));
  assert.deepEqual([...shownOrder(s)], ['SCORE_DIFFERENCE', 'POINTS_FOR']);
  await s.page.saveStandings();
  await s.flush();
  assert.deepEqual(sent(s, '/standings-rules')[0].body.tiebreakers, [
    'SCORE_DIFFERENCE',
    'POINTS_FOR',
  ]);
  s.unload();
});

test('event-setup: second-level period and overtime lengths save unchanged and edit exactly', async () => {
  const s = setupPage({
    scoring: scoringRules,
    standings: standingsRules(['WINS']),
  });
  await s.client.request('/v1/auth/session');
  s.page.onLoad({ orgId: org, eventId });
  await s.flush();
  await s.page.saveScoring();
  await s.flush();
  let put = sent(s, '/scoring-rules').at(-1).body;
  assert.equal(put.periodDurationSeconds, 90);
  assert.equal(put.overtimeDurationSeconds, 30);
  s.page.field(input('scoring', 'minutes', '1'));
  s.page.field(input('scoring', 'seconds', '45'));
  s.page.field(input('scoring', 'otMinutes', '0'));
  s.page.field(input('scoring', 'otSeconds', '50'));
  await s.page.saveScoring();
  await s.flush();
  put = sent(s, '/scoring-rules').at(-1).body;
  assert.equal(put.periodDurationSeconds, 105);
  assert.equal(put.overtimeDurationSeconds, 50);
  s.page.field(input('scoring', 'seconds', '60'));
  await s.page.saveScoring();
  assert.match(s.page.data.error, /秒/);
  assert.equal(sent(s, '/scoring-rules').length, 2, 'invalid seconds are not sent');
  s.unload();
});

test('event-setup: refreshing during a save does not leave the page busy', async () => {
  const s = setupPage({ scoring: scoringRules, standings: standingsRules(['WINS']) });
  await s.client.request('/v1/auth/session');
  s.page.onLoad({ orgId: org, eventId });
  await s.flush();
  s.hold('PUT ' + regBase + '/scoring-rules');
  const saving = s.page.saveScoring();
  await ticks();
  assert.equal(s.page.data.busy, true);
  s.page[bound('pages/event-setup/index', '刷新')](tap());
  await ticks();
  s.release('PUT ' + regBase + '/scoring-rules');
  await saving;
  await s.flush();
  assert.equal(s.page.data.busy, false);
  assert.match(s.page.data.notice, /记分规则已保存/);
  s.unload();
});

test('scorer: re-reading during a scoring command neither cancels it nor double-sends', async () => {
  const s = server('pages/scorer/index');
  const wb = workbench('READY', 5);
  wb.capabilities.canAcquireControl = true;
  s.on('GET ' + matchBase + '/scoring', () => ok(wb));
  s.on('GET ' + matchBase + '/scoring-events?limit=100', () => ok([]));
  s.on('POST ' + matchBase + '/scorekeeper-lease', () =>
    ok({
      leaseId: entryId,
      fencingToken: '1',
      clientInstanceId: s.state.bodies.at(-1).body.clientInstanceId,
    }),
  );
  s.on('POST ' + matchBase + '/commands', () => ok({ snapshot: snapshot('LIVE', 6) }));
  await s.client.request('/v1/auth/session');
  s.page.onLoad({ orgId: org, matchId });
  await s.flush();
  await s.page.acquire();
  assert.equal(s.page.data.held, true);
  s.hold('POST ' + matchBase + '/commands');
  const starting = s.page.start();
  await ticks();
  assert.equal(s.page.data.busy, true);
  const reads = s.count('GET ' + matchBase + '/scoring');
  s.page[bound('pages/scorer/index', '重新读取比分')](tap());
  await ticks();
  s.release('POST ' + matchBase + '/commands');
  await starting;
  await s.flush();
  assert.equal(s.page.data.busy, false);
  assert.match(s.page.data.notice, /开始比赛 已记录/);
  assert.equal(s.page.data.match.status, 'LIVE');
  assert.equal(s.count('POST ' + matchBase + '/commands'), 1);
  assert.equal(s.count('GET ' + matchBase + '/scoring'), reads, 'no board read during the write');
  s.unload();
});
