const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');

// C17: a confirmation (and any asynchronous preparation after it) must not turn into a write
// once the account changed, the user signed out, the page was unloaded, the target changed or a
// newer confirmation replaced it. Every check here counts business write requests actually
// sent (non-GET, excluding sign-in/out), not what the page displays.
const org = '11111111-1111-4111-8111-111111111111';
const eventId = '33333333-3333-4333-8333-333333333333';
const matchId = '44444444-4444-4444-8444-444444444444';
const userA = '55555555-5555-4555-8555-555555555555';
const userB = '66666666-6666-4666-8666-666666666666';
const staffUser = '67676767-6767-4767-8767-676767676767';
const entryId = '77777777-7777-4777-8777-777777777777';
const court1 = '66666666-6666-4666-8666-666666666661';
const revisionId = '99999999-9999-4999-8999-999999999999';
const freezeId = '98989898-9898-4898-8898-989898989898';
const cookieA = 'a'.repeat(43);
const cookieB = 'b'.repeat(43);
const hash = (c) => c.repeat(64);
const ok = (data, cookie = cookieA, meta = {}) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-c17', nextCursor: null, ...meta } },
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const sessionOf = (id) => ({
  user: { id, email: id.slice(0, 4) + '@example.test', displayName: '合成账号' },
  organizations: [{ id: org, name: '合成机构', role: 'ORG_OWNER' }],
  teamContexts: [],
});
const ticks = async (n = 15) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
const tap = (dataset = {}, detail = {}) => ({ type: 'tap', currentTarget: { dataset }, detail });

function device(routes) {
  const state = { who: userA, writes: [], modal: null, random: [], holdRandom: false };
  const wx = createWx({
    request(options) {
      const url = options.url.replace(/^https:\/\/[^/]+/, '');
      const method = options.method || 'GET';
      const key = method + ' ' + url;
      if (url === '/v1/auth/session')
        return ok(sessionOf(state.who), state.who === userA ? cookieA : cookieB);
      if (key === 'POST /v1/auth/login') {
        state.who = userB;
        return ok(sessionOf(userB), cookieB);
      }
      if (method !== 'GET')
        state.writes.push({ key, body: JSON.parse(JSON.stringify(options.data ?? null)) });
      const reply = routes(key, state);
      return (
        reply || { statusCode: 404, data: { error: { code: 'TEST_UNHANDLED', message: key } } }
      );
    },
  });
  wx.showModal = (o) => {
    state.modal = o;
  };
  const random = wx.getRandomValues;
  wx.getRandomValues = (o) => (state.holdRandom ? state.random.push(() => random(o)) : random(o));
  return {
    wx,
    state,
    answer(confirm = true) {
      const m = state.modal;
      state.modal = null;
      m.success({ confirm, cancel: !confirm });
    },
    async open(route, query) {
      const h = loadPage({ root, route, wx });
      const client = h.requireLocal('utils/api.js').getClient();
      await client.request('/v1/auth/session');
      h.page.onLoad(query);
      if (h.page.onShow) h.page.onShow();
      await h.flush();
      return { ...h, client };
    },
  };
}
async function change(p, kind) {
  if (kind === 'logout') p.client.clearSession();
  if (kind === 'switch')
    await p.client.request('/v1/auth/login', 'POST', { email: 'b@example.test' });
  if (kind === 'unload') p.unload();
  if (kind === 'unload' && p.page._closed !== true) throw new Error('unload did not close');
}

// ---------- fixtures ----------
const team = (n, name) => ({
  entryId: '88888888-8888-4888-8888-88888888888' + n,
  teamId: '88888888-8888-4888-8888-88888888888' + n,
  teamName: name,
  rosterRevisionId: '88888888-8888-4888-8888-88888888888' + n,
});
const teams = [team(1, '合成甲'), team(2, '合成乙'), team(3, '合成丙'), team(4, '合成丁')];
const matchBase = '/v1/orgs/' + org + '/matches/' + matchId;
const evBase = '/v1/orgs/' + org + '/events/' + eventId;
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
function workbench(state, over = {}) {
  const version = state.matchVersion || 5;
  return {
    event: { id: eventId, name: '合成赛事', status: 'RUNNING', version: 3 },
    match: {
      roundNo: 1,
      startsAt: '2026-11-01T02:00:00Z',
      courtName: '合成1号场',
      home: { teamName: '合成主队' },
      away: { teamName: '合成客队' },
      status: 'ENDED',
      version,
    },
    rules: { regulationPeriods: 4, periodDurationSeconds: 600, tiePolicy: 'OVERTIME' },
    snapshot: snapshot('ENDED', version),
    playerRoster: { home: [], away: [] },
    staff: [{ userId: staffUser, role: 'SCORER', status: 'ACTIVE', displayName: '合成记分员' }],
    lease: null,
    capabilities: {
      canManageStaff: true,
      canPrepare: true,
      canAcquireControl: true,
      canConfirm: true,
      canReopen: true,
    },
    ...over,
  };
}
const matchRoutes = (key, state) => {
  if (key === 'GET ' + matchBase + '/scoring') return ok(workbench(state));
  if (/\/(scoring-events|result-confirmations)\?/.test(key)) return ok([]);
  if (key === 'GET /v1/orgs/' + org + '/members') return ok([]);
  if (key === 'POST ' + matchBase + '/scorekeeper-lease')
    return ok({ leaseId: entryId, fencingToken: '1', clientInstanceId: entryId });
  if (key.startsWith('POST ') || key.startsWith('PUT '))
    return ok({ snapshot: snapshot('FINAL', 6) });
  return null;
};
function groupsData(status, tie) {
  const row = (t, rank, wins) => ({
    entryId: t.entryId,
    teamId: t.teamId,
    teamName: t.teamName,
    rank,
    tied: tie,
    played: 1,
    wins,
    draws: 0,
    losses: 1 - wins,
    pointsFor: 10,
    pointsAgainst: 10,
    scoreDifference: 0,
    leaguePoints: 1 + wins,
  });
  const group = (key, a, b) => ({
    groupKey: key,
    label: key + '组',
    participants: [a, b],
    standings: {
      sourceHash: hash(key === 'A' ? 'c' : 'd'),
      rows: [row(a, 1, 1), row(b, tie ? 1 : 2, tie ? 1 : 0)],
    },
    qualifiedEntryIds: tie ? null : [a.entryId, b.entryId],
    unresolvedTieEntryIds: tie ? [a.entryId, b.entryId] : [],
    draw: null,
  });
  return {
    event: {
      id: eventId,
      name: '合成分组赛',
      format: 'GROUP_KNOCKOUT',
      status: 'RUNNING',
      version: 7,
    },
    publicationId: entryId,
    config: { groupCount: 2, seededEntryIds: [] },
    competition: {
      algorithmVersion: 'GK_BALANCED_V1',
      groupCount: 2,
      sourceHash: hash('b'),
      asOf: '2026-10-27T10:00:00Z',
      groupRoundCount: 1,
      totalMatchCount: 5,
      publishedMatchCount: 2,
      confirmedMatchCount: 2,
      isComplete: false,
      groups: [group('A', teams[0], teams[1]), group('B', teams[2], teams[3])],
      qualification: {
        status,
        sourceHash: hash('a'),
        sources: [],
        slots: [],
        unresolvedGroups: tie ? ['A', 'B'] : [],
        publicationId: null,
      },
      bracket: null,
      placements: [],
      nextRound:
        status === 'READY'
          ? {
              roundNo: 2,
              sourceHash: hash('e'),
              sources: [],
              fixtures: [
                {
                  fixtureKey: 'K1-1',
                  roundNo: 2,
                  positionNo: 1,
                  homeEntryId: teams[0].entryId,
                  awayEntryId: teams[3].entryId,
                  courtId: null,
                  startsAt: null,
                  endsAt: null,
                },
              ],
            }
          : null,
    },
    capabilities: { canDrawTies: true, canPublishQualification: true, canPublishNextRound: true },
  };
}
const bracketRoutes = (status, tie) => (key) => {
  if (key === 'GET ' + evBase)
    return ok({
      id: eventId,
      name: '合成分组赛',
      format: 'GROUP_KNOCKOUT',
      status: 'RUNNING',
      version: 7,
    });
  if (key === 'GET ' + evBase + '/groups') return ok(groupsData(status, tie));
  if (key === 'GET /v1/orgs/' + org + '/courts?limit=100')
    return ok([
      {
        id: court1,
        name: '合成一号场',
        status: 'ACTIVE',
        version: 1,
        capabilities: { canManage: true },
      },
    ]);
  if (key.startsWith('POST ')) return ok({});
  return null;
};
const reschedulingData = (state) => ({
  event: { id: eventId, name: '合成赛事', status: 'RUNNING', version: 5 },
  match: {
    id: matchId,
    eventId,
    publicationId: entryId,
    fixtureKey: 'R1-1',
    roundNo: 1,
    positionNo: 1,
    home: teams[0],
    away: teams[1],
    courtId: court1,
    courtName: '合成一号场',
    startsAt: '2028-03-01T01:00:00.000Z',
    endsAt: '2028-03-01T02:00:00.000Z',
    status: 'SCHEDULED',
    version: state.matchVersion || 2,
  },
  policy: { slotDurationMinutes: 60, minRestMinutes: 0, minLocalDayGap: 0, courtWindows: [] },
  history: [],
  historyLimit: 20,
  historyTruncated: false,
  capabilities: { canReschedule: true },
});
const rescheduleRoutes = (key, state) => {
  if (key === 'GET ' + matchBase + '/rescheduling') return ok(reschedulingData(state));
  if (key === 'GET /v1/orgs/' + org + '/courts?limit=100')
    return ok([
      {
        id: court1,
        name: '合成一号场',
        status: 'ACTIVE',
        version: 1,
        capabilities: { canManage: true },
      },
    ]);
  if (key.startsWith('POST ')) return ok({});
  return null;
};
const scheduleRoutes = (withRevision) => (key, state) => {
  if (key === 'GET ' + evBase + '/scheduling')
    return ok({
      event: {
        id: eventId,
        name: '合成赛事',
        status: 'REGISTRATION_FROZEN',
        version: state.eventVersion || 5,
        startDate: '2028-03-01',
        endDate: '2028-03-02',
        format: 'ROUND_ROBIN',
      },
      freeze: {
        id: freezeId,
        rulesetId: freezeId,
        rulesetVersion: 1,
        eventVersion: 4,
        entryCount: 4,
      },
      currentRevision: withRevision ? { id: revisionId } : null,
      publication: null,
      support: { supported: true, reason: null },
      capabilities: { canGenerate: !withRevision, canRedraw: !!withRevision, canReadMatches: true },
    });
  if (key === 'GET /v1/orgs/' + org + '/courts?limit=100')
    return ok(
      [
        {
          id: court1,
          name: '合成一号场',
          status: 'ACTIVE',
          version: 1,
          capabilities: { canManage: true },
        },
      ],
      cookieA,
      { capabilities: { canCreateCourt: true } },
    );
  if (key === 'GET /v1/orgs/' + org + '/schedule-revisions/' + revisionId)
    return ok({
      id: revisionId,
      eventId,
      eventVersion: state.eventVersion || 5,
      version: 2,
      status: 'DRAFT',
      groupConfig: null,
      policy: { slotDurationMinutes: 60, minRestMinutes: 0, minLocalDayGap: 0, courtWindows: [] },
      participants: teams,
      rounds: [{ roundNo: 1, byeEntryId: null }],
      fixtures: [],
      capabilities: { canEditAllocations: true, canValidate: true, canPublish: true },
    });
  if (key.startsWith('POST ') || key.startsWith('PUT ') || key.startsWith('PATCH ')) return ok({});
  return null;
};
const setupRoutes = (key, state) => {
  if (key === 'GET ' + evBase)
    return ok({
      id: eventId,
      name: '合成赛事',
      startDate: '2028-03-01',
      endDate: '2028-03-02',
      venueName: '合成馆',
      format: 'ROUND_ROBIN',
      status: 'SCHEDULED',
      version: state.eventVersion || 4,
      permissions: { canEditDraft: false },
    });
  if (key === 'GET ' + evBase + '/registration')
    return ok({ rules: null, capabilities: { canManageRules: false } });
  if (key === 'GET ' + evBase + '/scoring')
    return ok({ rules: null, locked: false, capabilities: { canManageRules: false } });
  if (key === 'GET ' + evBase + '/standings')
    return ok({
      rules: { id: revisionId, winPoints: 2, lossPoints: 1, drawPoints: 1, tiebreakers: [] },
      locked: false,
      publication: null,
      capabilities: {
        canManageRules: true,
        canPublishRules: true,
        canEnablePublicViewing: true,
        canDisablePublicViewing: false,
      },
    });
  if (key.startsWith('POST ') || key.startsWith('PUT ')) return ok({ id: eventId });
  return null;
};
const reviewRoutes = (key, state) => {
  if (key === 'GET ' + evBase + '/registration')
    return ok({
      event: { name: '合成赛事', status: 'REGISTRATION_OPEN', version: state.eventVersion || 2 },
      rules: null,
      counts: { SUBMITTED: 1 },
      freeze: null,
      capabilities: { canOpen: false, canClose: true, canFreeze: false },
    });
  if (key === 'GET ' + evBase + '/entries?limit=100')
    return ok([{ id: entryId, teamName: '合成队', status: 'SUBMITTED', latestReviewReason: null }]);
  if (key === 'GET /v1/orgs/' + org + '/entries/' + entryId)
    return ok({
      id: entryId,
      version: state.entryVersion || 1,
      teamName: '合成队',
      status: 'SUBMITTED',
      players: [],
      history: [],
      capabilities: { canApprove: true, canRequestChanges: true, canReject: true, canReview: true },
    });
  if (key.startsWith('POST ')) return ok({});
  return null;
};
const orgEventRoutes = (key, state) => {
  if (key === 'GET ' + evBase)
    return ok({
      id: eventId,
      name: '合成赛事',
      startDate: '2028-03-01',
      endDate: '2028-03-02',
      timezone: 'Asia/Shanghai',
      venueName: '合成馆',
      format: 'ROUND_ROBIN',
      status: 'RUNNING',
      version: state.eventVersion || 9,
    });
  if (key === 'GET ' + evBase + '/lifecycle')
    return ok({
      event: { id: eventId, version: state.eventVersion || 9 },
      completion: { confirmedMatchCount: 1, totalMatchCount: 1, ready: true, blockers: [] },
      capabilities: { canComplete: true, canArchive: false, canReopen: false },
    });
  if (key.startsWith('GET ' + evBase + '/matches')) return ok([]);
  if (key.startsWith('POST ')) return ok({});
  return null;
};

// ---------- the write entries under test ----------
const entries = [
  {
    name: 'org-match 停用人员',
    route: 'pages/org-match/index',
    query: { orgId: org, matchId },
    routes: matchRoutes,
    start: (p) => p.page.disable(tap({ key: staffUser + ':SCORER' })),
    target: (d) => (d.state.matchVersion = 6),
  },
  {
    name: 'org-match 准备比赛',
    route: 'pages/org-match/index',
    query: { orgId: org, matchId },
    routes: matchRoutes,
    start: (p) => p.page.prepare(),
    target: (d) => (d.state.matchVersion = 6),
    uuid: true,
  },
  {
    name: 'org-match 独立确认',
    route: 'pages/org-match/index',
    query: { orgId: org, matchId },
    routes: matchRoutes,
    start: (p) => p.page.confirmResult(),
    target: (d) => (d.state.matchVersion = 6),
    uuid: true,
  },
  {
    name: 'org-match 重开',
    route: 'pages/org-match/index',
    query: { orgId: org, matchId },
    routes: matchRoutes,
    start: (p) => {
      p.page.toggleReopen();
      p.page.reopenInput(tap({}, { value: '更正一次记录' }));
      return p.page.reopen();
    },
    target: (d) => (d.state.matchVersion = 6),
    uuid: true,
  },
  {
    name: 'bracket 同分抽签',
    route: 'pages/bracket/index',
    query: { orgId: org, eventId },
    routes: bracketRoutes('TIE_BREAK_REQUIRED', true),
    start: (p) => {
      p.page.tieInput(tap({ key: 'A' }, { value: '积分完全相同按规则抽签' }));
      return p.page.drawTie(tap({ key: 'A' }));
    },
  },
  {
    name: 'bracket 发布晋级',
    route: 'pages/bracket/index',
    query: { orgId: org, eventId },
    routes: bracketRoutes('READY', false),
    start: (p) => {
      p.page.pickCourt(tap({ index: 0 }, { value: 0 }));
      p.page.pickDate(tap({ index: 0 }, { value: '2028-03-02' }));
      p.page.pickTime(tap({ index: 0 }, { value: '09:00' }));
      p.page.reasonInput(tap({}, { value: '组赛全部独立确认' }));
      return p.page.publish();
    },
  },
  {
    name: 'reschedule 正式改期',
    route: 'pages/reschedule/index',
    query: { orgId: org, matchId },
    routes: rescheduleRoutes,
    start: (p) => {
      p.page.pickTime(tap({}, { value: '15:00' }));
      p.page.reasonInput(tap({}, { value: '球队申请延后' }));
      return p.page.submit();
    },
    target: (d) => (d.state.matchVersion = 3),
  },
  {
    name: 'schedule 生成对阵',
    route: 'pages/schedule/index',
    query: { orgId: org, eventId },
    routes: scheduleRoutes(false),
    start: (p) => p.page.generate(),
    target: (d) => (d.state.eventVersion = 6),
  },
  {
    name: 'schedule 发布赛程',
    route: 'pages/schedule/index',
    query: { orgId: org, eventId },
    routes: scheduleRoutes(true),
    start: (p) => p.page.publish(),
    target: (d) => (d.state.eventVersion = 6),
  },
  {
    name: 'schedule 重新抽签',
    route: 'pages/schedule/index',
    query: { orgId: org, eventId },
    routes: scheduleRoutes(true),
    start: (p) => {
      p.page.toggleRedraw();
      p.page.redrawInput(tap({}, { value: '场地调整后重新抽签' }));
      return p.page.redraw();
    },
    target: (d) => (d.state.eventVersion = 6),
  },
  {
    name: 'event-setup 创建赛事',
    route: 'pages/event-setup/index',
    query: { orgId: org },
    routes: setupRoutes,
    start: (p) => {
      p.page.field(tap({ section: 'draft', field: 'name' }, { value: '合成新赛事' }));
      return p.page.create();
    },
  },
  {
    name: 'event-setup 锁定积分规则',
    route: 'pages/event-setup/index',
    query: { orgId: org, eventId },
    routes: setupRoutes,
    start: (p) => p.page.publishStandings(),
    target: (d) => (d.state.eventVersion = 5),
  },
  {
    name: 'event-setup 公开观赛',
    route: 'pages/event-setup/index',
    query: { orgId: org, eventId },
    routes: setupRoutes,
    start: (p) => p.page.viewing(tap({ type: 'ENABLE' })),
    target: (d) => (d.state.eventVersion = 5),
  },
  {
    name: 'entry-review 审核',
    route: 'pages/entry-review/index',
    query: { orgId: org, eventId },
    routes: reviewRoutes,
    prepare: async (p) => {
      await p.page.openEntry(tap({ id: entryId }));
      await p.flush();
    },
    start: (p) => p.page.review(tap({ type: 'APPROVE' })),
    target: (d) => (d.state.entryVersion = 2),
  },
  {
    name: 'entry-review 报名阶段',
    route: 'pages/entry-review/index',
    query: { orgId: org, eventId },
    routes: reviewRoutes,
    start: (p) => p.page.stage(tap({ type: 'CLOSE_REGISTRATION' })),
    target: (d) => (d.state.eventVersion = 3),
  },
  {
    name: 'org-event 生命周期',
    route: 'pages/org-event/index',
    query: { orgId: org, eventId },
    routes: orgEventRoutes,
    start: (p) => {
      if (p.page.data.lifecycleAction !== 'COMPLETE')
        p.page.chooseLifecycle(tap({ type: 'COMPLETE' }));
      p.page.lifecycleInput(tap({}, { value: '全部比赛已独立确认' }));
      return p.page.runLifecycle();
    },
    target: (d) => (d.state.eventVersion = 10),
  },
];

async function opened(entry) {
  const d = device(entry.routes);
  const p = await d.open(entry.route, entry.query);
  if (entry.prepare) await entry.prepare(p);
  return { d, p };
}

for (const entry of entries) {
  for (const kind of ['switch', 'logout', 'unload'])
    test(entry.name + '：确认等待期间' + kind + '，不发送任何写请求', async () => {
      const { d, p } = await opened(entry);
      const before = d.state.writes.length;
      const pending = entry.start(p);
      await ticks();
      assert.ok(d.state.modal, 'confirmation opened');
      await change(p, kind);
      d.answer(true);
      await pending;
      await ticks();
      assert.deepEqual(d.state.writes.slice(before), [], kind);
    });

  test(entry.name + '：正常确认只发送一次，取消不发送', async () => {
    const { d, p } = await opened(entry);
    const before = d.state.writes.length;
    let pending = entry.start(p);
    await ticks();
    d.answer(false);
    await pending;
    await ticks();
    assert.equal(d.state.writes.length, before, 'cancel sends nothing');
    pending = entry.start(p);
    await ticks();
    d.answer(true);
    await pending;
    await p.flush();
    assert.equal(d.state.writes.length - before, 1, 'one write');
  });

  if (entry.target)
    test(entry.name + '：确认期间目标版本变化，不发送', async () => {
      const { d, p } = await opened(entry);
      const before = d.state.writes.length;
      const pending = entry.start(p);
      await ticks();
      entry.target(d);
      // A read during the dialog (e.g. a poll or onShow) brings the newer version in.
      if (p.page.data.busy !== true) {
        p.page.setData({ loading: false });
        await (p.page.load.length ? p.page.load(true) : p.page.load());
        await ticks();
      }
      d.answer(true);
      await pending;
      await ticks();
      assert.deepEqual(d.state.writes.slice(before), []);
    });

  if (entry.uuid)
    for (const kind of ['switch', 'unload'])
      test(entry.name + '：确认后生成命令编号期间' + kind + '，不发送', async () => {
        const { d, p } = await opened(entry);
        const before = d.state.writes.length;
        const pending = entry.start(p);
        await ticks();
        d.state.holdRandom = true;
        d.answer(true);
        await ticks();
        assert.equal(d.state.random.length, 1, 'waiting for secure random');
        await change(p, kind);
        d.state.holdRandom = false;
        d.state.random.shift()();
        await pending;
        await ticks();
        assert.deepEqual(d.state.writes.slice(before), []);
      });
}

test('a newer confirmation replaces an older one on the same page', async () => {
  const d = device(rescheduleRoutes);
  const p = await d.open('pages/reschedule/index', { orgId: org, matchId });
  p.page.pickTime(tap({}, { value: '15:00' }));
  p.page.reasonInput(tap({}, { value: '球队申请延后' }));
  const first = p.page.submit();
  await ticks();
  const firstModal = d.state.modal;
  const second = p.page.submit();
  await ticks();
  const secondModal = d.state.modal;
  firstModal.success({ confirm: true, cancel: false });
  await first;
  await ticks();
  assert.equal(d.state.writes.length, 0, 'the replaced confirmation sends nothing');
  secondModal.success({ confirm: true, cancel: false });
  await second;
  await p.flush();
  assert.equal(d.state.writes.length, 1);
});

// ---------- scorer: confirmed commands and the secure-random window ----------
async function scorerWithControl() {
  const d = device((key, state) => {
    if (key === 'GET ' + matchBase + '/scoring')
      return ok(
        workbench(state, {
          match: { ...workbench(state).match, status: 'LIVE' },
          snapshot: snapshot('LIVE', 5),
        }),
      );
    return matchRoutes(key, state);
  });
  const p = await d.open('pages/scorer/index', { orgId: org, matchId });
  await p.page.acquire();
  await p.flush();
  assert.equal(p.page.data.held, true);
  return { d, p };
}
for (const kind of ['switch', 'logout', 'unload'])
  test('scorer 结束比赛：确认等待期间' + kind + '，不发送', async () => {
    const { d, p } = await scorerWithControl();
    const before = d.state.writes.length;
    const pending = p.page.end();
    await ticks();
    assert.ok(d.state.modal);
    await change(p, kind);
    d.answer(true);
    await pending;
    await ticks();
    const sent = d.state.writes.slice(before).filter((w) => /\/commands$/.test(w.key));
    assert.deepEqual(sent, [], kind);
  });
for (const kind of ['switch', 'unload'])
  test('scorer 记分：生成命令编号期间' + kind + '，不发送', async () => {
    const { d, p } = await scorerWithControl();
    const before = d.state.writes.length;
    d.state.holdRandom = true;
    const pending = p.page.stat(tap({ side: 'HOME', kind: 'SCORE', value: 2 }));
    await ticks();
    assert.equal(d.state.random.length, 1);
    await change(p, kind);
    d.state.holdRandom = false;
    d.state.random.shift()();
    await pending;
    await ticks();
    const sent = d.state.writes.slice(before).filter((w) => /\/commands$/.test(w.key));
    assert.deepEqual(sent, [], kind);
  });
