const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');

// C15: groups/knockout publication, formal rescheduling and match media. Each page is driven
// through its real code against a synthetic server; eligibility, versions and visibility stay
// server-side, so the checks are about what the page sends, blocks, keeps and shows.
const org = '11111111-1111-4111-8111-111111111111';
const eventId = '33333333-3333-4333-8333-333333333333';
const matchId = '44444444-4444-4444-8444-444444444444';
const userA = '55555555-5555-4555-8555-555555555555';
const court1 = '66666666-6666-4666-8666-666666666661';
const court2 = '66666666-6666-4666-8666-666666666662';
const fileId = '77777777-7777-4777-8777-777777777771';
const mediaId = '77777777-7777-4777-8777-777777777772';
const entry = (n) => '88888888-8888-4888-8888-88888888888' + n;
const hash = (c) => c.repeat(64);
const cookie = 'a'.repeat(43);
const ok = (data) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-c15', nextCursor: null } },
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const fail = (statusCode, code, details) => ({
  statusCode,
  data: { error: { code, message: '合成错误 ' + code, ...(details ? { details } : {}) } },
});
const session = {
  user: { id: userA, email: 'synthetic@example.test', displayName: '合成负责人' },
  organizations: [{ id: org, name: '合成机构', role: 'ORG_OWNER' }],
  teamContexts: [],
};
const ticks = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
const tap = (dataset = {}, detail = {}) => ({ type: 'tap', currentTarget: { dataset }, detail });

function server(route, answers = 20) {
  const state = { replies: new Map(), held: new Map(), bodies: [] };
  const wx = createWx({
    modalAnswers: Array(answers).fill(true),
    request(options) {
      const key = (options.method || 'GET') + ' ' + options.url.replace(/^https:\/\/[^/]+/, '');
      if (options.method && options.method !== 'GET')
        state.bodies.push({
          key,
          body: JSON.parse(JSON.stringify(options.data ?? null)),
          timeout: options.timeout,
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
    sent(key) {
      return state.bodies.filter((b) => b.key === key);
    },
    async open(query) {
      await client.request('/v1/auth/session');
      h.page.onLoad(query);
      await h.flush();
    },
  };
}
const lost = () => Promise.reject(new Error('synthetic lost response'));

// ---------- groups and knockout ----------
const evBase = '/v1/orgs/' + org + '/events/' + eventId;
const team = (n, name) => ({
  entryId: entry(n),
  teamId: entry(n),
  teamName: name,
  rosterRevisionId: entry(n),
});
const teams = [team(1, '合成甲'), team(2, '合成乙'), team(3, '合成丙'), team(4, '合成丁')];
const row = (t, rank, tied, wins, losses) => ({
  entryId: t.entryId,
  teamId: t.teamId,
  teamName: t.teamName,
  rank,
  tied,
  played: wins + losses,
  wins,
  draws: 0,
  losses,
  pointsFor: 10,
  pointsAgainst: 10,
  scoreDifference: 0,
  leaguePoints: wins * 2 + losses,
});
const fixture = (key, round, home, away) => ({
  fixtureKey: key,
  roundNo: round,
  positionNo: 1,
  homeEntryId: home.entryId,
  awayEntryId: away.entryId,
  courtId: null,
  startsAt: null,
  endsAt: null,
});
function groupsData({ status, qHash = hash('a'), caps = {}, tieA = false, draw = null }) {
  const groupA = {
    groupKey: 'A',
    label: 'A组',
    participants: [teams[0], teams[1]],
    standings: {
      sourceHash: hash('c'),
      rows: [row(teams[0], 1, tieA, 1, 0), row(teams[1], tieA ? 1 : 2, tieA, tieA ? 1 : 0, 0)],
    },
    qualifiedEntryIds: tieA && !draw ? null : [teams[0].entryId, teams[1].entryId],
    unresolvedTieEntryIds: tieA && !draw ? [teams[0].entryId, teams[1].entryId] : [],
    draw,
  };
  const groupB = {
    groupKey: 'B',
    label: 'B组',
    participants: [teams[2], teams[3]],
    standings: {
      sourceHash: hash('d'),
      rows: [row(teams[2], 1, false, 1, 0), row(teams[3], 2, false, 0, 1)],
    },
    qualifiedEntryIds: [teams[2].entryId, teams[3].entryId],
    unresolvedTieEntryIds: [],
    draw: null,
  };
  return {
    event: {
      id: eventId,
      name: '合成分组赛',
      format: 'GROUP_KNOCKOUT',
      status: 'RUNNING',
      version: 7,
    },
    publicationId: entry(9),
    config: { groupCount: 2, seededEntryIds: [] },
    competition: {
      algorithmVersion: 'GK_BALANCED_V1',
      groupCount: 2,
      sourceHash: hash('b'),
      asOf: '2026-10-27T10:00:00Z',
      groupRoundCount: 1,
      totalMatchCount: 5,
      publishedMatchCount: 2,
      confirmedMatchCount: status === 'WAITING' ? 1 : 2,
      isComplete: false,
      groups: [groupA, groupB],
      qualification: {
        status,
        sourceHash: qHash,
        sources: [],
        slots: ['A1', 'B2', 'B1', 'A2'],
        unresolvedGroups: tieA && !draw ? ['A'] : [],
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
                fixture('K1-1', 2, teams[0], teams[3]),
                fixture('K1-2', 2, teams[2], teams[1]),
              ],
            }
          : null,
    },
    capabilities: {
      canDrawTies: true,
      canPublishQualification: true,
      canPublishNextRound: true,
      ...caps,
    },
  };
}
function bracketPage(data) {
  const s = server('pages/bracket/index');
  let current = data;
  s.set = (next) => {
    current = next;
  };
  s.on('GET ' + evBase, () => ok({ ...current.event }));
  s.on('GET ' + evBase + '/groups', () => ok(current));
  s.on('GET ' + evBase + '/knockout', () => ok(current));
  s.on('GET /v1/orgs/' + org + '/courts?limit=100', () =>
    ok([
      { id: court1, name: '合成一号场', status: 'ACTIVE' },
      { id: court2, name: '停用场', status: 'DISABLED' },
    ]),
  );
  return s;
}
function fillAllocations(s) {
  s.page.data.fixtures.forEach((f, i) => {
    s.page.pickCourt(tap({ index: i }, { value: 0 }));
    s.page.pickDate(tap({ index: i }, { value: '2028-03-02' }));
    s.page.pickTime(tap({ index: i }, { value: i ? '11:00' : '09:00' }));
  });
}

test('bracket: waiting groups explain why nothing can be published and send nothing', async () => {
  const s = bracketPage(groupsData({ status: 'WAITING' }));
  await s.open({ orgId: org, eventId });
  assert.equal(s.page.data.next, null);
  assert.match(s.page.data.blocker, /等待全部组赛有效独立确认/);
  assert.equal(s.page.data.qualification, '等待全部组赛有效独立确认');
  assert.deepEqual(
    s.page.data.courts.map((c) => c.name),
    ['合成一号场'],
    'disabled courts are not offered',
  );
  await s.page.publish();
  assert.equal(s.state.bodies.length, 0);
  s.unload();
});

test('bracket: a tie draw needs a reason, pins the group source hash and is sent once', async () => {
  const s = bracketPage(groupsData({ status: 'TIE_BREAK_REQUIRED', tieA: true }));
  await s.open({ orgId: org, eventId });
  const a = s.page.data.groups.find((g) => g.key === 'A');
  assert.equal(a.needsDraw, true);
  assert.match(a.ties, /合成甲、合成乙/);
  await s.page.drawTie(tap({ key: 'A' }));
  assert.match(s.page.data.error, /4–500字/);
  assert.equal(s.state.bodies.length, 0);
  s.page.tieInput(tap({ key: 'A' }, { value: '积分完全相同按规则抽签' }));
  const key = 'POST ' + evBase + '/group-tie-commands';
  s.on(key, () => {
    s.set(
      groupsData({
        status: 'READY',
        tieA: true,
        draw: {
          id: entry(7),
          groupKey: 'A',
          sourceHash: hash('c'),
          seed: hash('f'),
          tiedEntryIds: [teams[0].entryId, teams[1].entryId],
          orderedEntryIds: [teams[1].entryId, teams[0].entryId],
          reason: '积分完全相同按规则抽签',
          createdAt: '2026-10-27T10:05:00Z',
        },
      }),
    );
    return ok({});
  });
  s.hold(key);
  const first = s.page.drawTie(tap({ key: 'A' }));
  await ticks();
  await s.page.drawTie(tap({ key: 'A' }));
  s.release(key);
  await first;
  await s.flush();
  assert.equal(s.sent(key).length, 1, 'a double tap sends one draw');
  assert.deepEqual(s.sent(key)[0].body, {
    type: 'DRAW_GROUP_TIE',
    expectedEventVersion: 7,
    expectedSourceHash: hash('c'),
    groupKey: 'A',
    reason: '积分完全相同按规则抽签',
  });
  const drawn = s.page.data.groups.find((g) => g.key === 'A');
  assert.equal(drawn.needsDraw, false);
  assert.match(drawn.draw.order, /合成乙 → 合成甲/);
  assert.equal(s.page.data.next.qualifying, true);
  s.unload();
});

test('bracket: a changed group result rejects qualification, keeps the plan and shows why', async () => {
  const s = bracketPage(groupsData({ status: 'READY', qHash: hash('1') }));
  await s.open({ orgId: org, eventId });
  assert.equal(s.page.data.fixtures.length, 2);
  fillAllocations(s);
  s.page.reasonInput(tap({}, { value: '组赛全部独立确认' }));
  const key = 'POST ' + evBase + '/group-qualification-commands';
  s.on(key, () => {
    s.set(groupsData({ status: 'READY', qHash: hash('2') }));
    return fail(409, 'GROUP_SOURCE_CONFLICT');
  });
  await s.page.publish();
  await s.flush();
  assert.equal(s.sent(key).length, 1);
  assert.equal(s.sent(key)[0].body.expectedSourceHash, hash('1'));
  assert.equal(s.sent(key)[0].body.allocations[0].startsAt, '2028-03-02T01:00:00.000Z');
  assert.match(s.page.data.error, /组赛赛果已变化/);
  assert.equal(s.page.data.busy, false);
  assert.equal(s.page.data.fixtures[1].time, '11:00', 'typed allocations survive the re-read');
  assert.equal(s.page.data.reason, '组赛全部独立确认');
  s.on(key, () => ok({}));
  await s.page.publish();
  await s.flush();
  assert.equal(
    s.sent(key)[1].body.expectedSourceHash,
    hash('2'),
    'the next try pins the new source',
  );
  s.unload();
});

test('bracket: a lost publish response blocks further publishing until a fresh read', async () => {
  const s = bracketPage(groupsData({ status: 'READY' }));
  await s.open({ orgId: org, eventId });
  fillAllocations(s);
  s.page.reasonInput(tap({}, { value: '组赛全部独立确认' }));
  const key = 'POST ' + evBase + '/group-qualification-commands';
  s.on(key, lost);
  await s.page.publish();
  await s.flush();
  assert.equal(s.page.data.uncertain, true);
  assert.match(s.page.data.error, /结果未知/);
  await s.page.publish();
  assert.equal(s.sent(key).length, 1, 'never replayed automatically');
  s.set(groupsData({ status: 'PUBLISHED' }));
  await s.page.load();
  await s.flush();
  assert.equal(s.page.data.uncertain, false);
  assert.equal(s.page.data.qualification, '淘汰首轮已发布');
  s.unload();
});

test('bracket: without publish rights the plan form is hidden and the reason shown', async () => {
  const s = bracketPage(groupsData({ status: 'READY', caps: { canPublishQualification: false } }));
  await s.open({ orgId: org, eventId });
  assert.equal(s.page.data.next, null);
  assert.match(s.page.data.blocker, /没有发布晋级的权限/);
  s.unload();
});

test('bracket: an account switch mid-publish clears the page and ignores the late reply', async () => {
  const s = bracketPage(groupsData({ status: 'READY' }));
  await s.open({ orgId: org, eventId });
  fillAllocations(s);
  s.page.reasonInput(tap({}, { value: '组赛全部独立确认' }));
  const key = 'POST ' + evBase + '/group-qualification-commands';
  s.on(key, () => ok({}));
  s.hold(key);
  const publishing = s.page.publish();
  await ticks();
  assert.equal(s.page.data.busy, true);
  s.client.clearSession();
  assert.equal(s.page.data.event, null);
  assert.equal(s.page.data.busy, false);
  s.release(key);
  await publishing;
  await s.flush();
  assert.equal(s.page.data.event, null);
  assert.equal(s.page.data.notice, '');
  s.unload();
});

test('bracket: single elimination labels byes and pending sources and publishes by round', async () => {
  const ko = {
    event: {
      id: eventId,
      name: '合成淘汰赛',
      format: 'SINGLE_ELIMINATION',
      status: 'RUNNING',
      version: 4,
    },
    publicationId: entry(9),
    participants: teams.slice(0, 3),
    bracket: {
      algorithmVersion: 'SE_SEEDED_V1',
      sourceHash: hash('b'),
      asOf: '2026-10-27T10:00:00Z',
      participantCount: 3,
      totalMatchCount: 2,
      publishedMatchCount: 1,
      confirmedMatchCount: 1,
      isComplete: false,
      rounds: [
        {
          roundNo: 1,
          label: '半决赛',
          published: true,
          slots: [
            {
              fixtureKey: 'R1-1',
              roundNo: 1,
              positionNo: 1,
              homeEntryId: null,
              awayEntryId: null,
              homeSource: null,
              awaySource: null,
              byeEntryId: teams[0].entryId,
              matchId: null,
              status: 'BYE',
              winnerEntryId: teams[0].entryId,
            },
            {
              fixtureKey: 'R1-2',
              roundNo: 1,
              positionNo: 2,
              homeEntryId: teams[1].entryId,
              awayEntryId: teams[2].entryId,
              homeSource: null,
              awaySource: null,
              byeEntryId: null,
              matchId,
              status: 'FINAL',
              winnerEntryId: teams[2].entryId,
            },
          ],
        },
        {
          roundNo: 2,
          label: '决赛',
          published: false,
          slots: [
            {
              fixtureKey: 'R2-1',
              roundNo: 2,
              positionNo: 1,
              homeEntryId: teams[0].entryId,
              awayEntryId: null,
              homeSource: 'R1-1',
              awaySource: 'R1-2',
              byeEntryId: null,
              matchId: null,
              status: 'WAITING',
              winnerEntryId: null,
            },
          ],
        },
      ],
      placements: [],
      nextRound: {
        roundNo: 2,
        sourceHash: hash('9'),
        sources: [],
        fixtures: [fixture('R2-1', 2, teams[0], teams[2])],
      },
    },
    capabilities: { canPublishNextRound: true },
  };
  const s = bracketPage(ko);
  await s.open({ orgId: org, eventId });
  const [semi, final] = s.page.data.rounds;
  assert.equal(semi.slots[0].statusLabel, '轮空晋级');
  assert.equal(semi.slots[0].away, '轮空');
  assert.equal(semi.slots[1].winner, '合成丙');
  assert.equal(final.slots[0].away, '待定（R1-2胜者）');
  assert.equal(final.slots[0].statusLabel, '待来源赛果');
  assert.equal(s.page.data.groups.length, 0);
  fillAllocations(s);
  s.page.reasonInput(tap({}, { value: '半决赛已独立确认' }));
  const key = 'POST ' + evBase + '/knockout-round-commands';
  s.on(key, () => ok({}));
  await s.page.publish();
  await s.flush();
  assert.deepEqual(
    { ...s.sent(key)[0].body, allocations: undefined },
    {
      type: 'PUBLISH_ROUND',
      expectedEventVersion: 4,
      expectedSourceHash: hash('9'),
      roundNo: 2,
      reason: '半决赛已独立确认',
      allocations: undefined,
    },
  );
  assert.match(s.page.data.notice, /已正式发布/);
  s.unload();
});

// ---------- formal rescheduling ----------
const matchBase = '/v1/orgs/' + org + '/matches/' + matchId;
function rescheduling(over = {}) {
  return {
    event: { id: eventId, name: '合成赛事', status: 'RUNNING', version: 5 },
    match: {
      id: matchId,
      eventId,
      publicationId: entry(9),
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
      version: 2,
    },
    policy: { slotDurationMinutes: 60, minRestMinutes: 0, minLocalDayGap: 0, courtWindows: [] },
    history: [],
    historyLimit: 20,
    historyTruncated: false,
    capabilities: { canReschedule: true },
    ...over,
  };
}
function reschedulePage(data) {
  const s = server('pages/reschedule/index');
  let current = data;
  s.set = (next) => {
    current = next;
  };
  s.on('GET ' + matchBase + '/rescheduling', () => ok(current));
  s.on('GET /v1/orgs/' + org + '/courts?limit=100', () =>
    ok([
      { id: court1, name: '合成一号场', status: 'ACTIVE' },
      { id: court2, name: '合成二号场', status: 'ACTIVE' },
    ]),
  );
  return s;
}

test('reschedule: starts from the current plan and reports server conflicts without losing input', async () => {
  const s = reschedulePage(rescheduling());
  await s.open({ orgId: org, matchId });
  assert.equal(s.page.data.date, '2028-03-01');
  assert.equal(s.page.data.time, '09:00');
  assert.match(s.page.data.match.plan, /合成一号场 · 2028-03-01 09:00–10:00/);
  await s.page.submit();
  assert.match(s.page.data.error, /改期原因/);
  assert.equal(s.state.bodies.length, 0);
  s.page.pickCourt(tap({}, { value: 1 }));
  s.page.pickTime(tap({}, { value: '10:30' }));
  s.page.reasonInput(tap({}, { value: '原场地灯光检修' }));
  const key = 'POST ' + matchBase + '/reschedule-commands';
  s.on(key, () =>
    fail(409, 'SCHEDULE_CONFLICT', {
      conflicts: [
        { code: 'TEAM_OVERLAP', fixtureKeys: ['R1-1', 'R1-2'] },
        { code: 'COURT_OVERLAP', fixtureKeys: ['X'], external: true },
      ],
    }),
  );
  await s.page.submit();
  await s.flush();
  assert.deepEqual(s.sent(key)[0].body, {
    type: 'RESCHEDULE',
    expectedEventVersion: 5,
    expectedMatchVersion: 2,
    courtId: court2,
    startsAt: '2028-03-01T02:30:00.000Z',
    reason: '原场地灯光检修',
  });
  assert.match(s.page.data.error, /存在冲突/);
  assert.deepEqual(
    s.page.data.conflicts.map((c) => [c.label, c.scope, c.external]),
    [
      ['同一球队时间重叠', '与同届其他比赛', false],
      ['同一场地时间重叠', '其他比赛', true],
    ],
  );
  assert.equal(s.page.data.reason, '原场地灯光检修');
  assert.equal(s.page.data.busy, false);
  s.unload();
});

test('reschedule: success appends a history record; the original plan stays as history "from"', async () => {
  const s = reschedulePage(rescheduling());
  await s.open({ orgId: org, matchId });
  s.page.pickTime(tap({}, { value: '15:00' }));
  s.page.reasonInput(tap({}, { value: '球队申请延后' }));
  const key = 'POST ' + matchBase + '/reschedule-commands';
  s.on(key, () => {
    const base = rescheduling();
    s.set(
      rescheduling({
        match: {
          ...base.match,
          startsAt: '2028-03-01T07:00:00.000Z',
          endsAt: '2028-03-01T08:00:00.000Z',
          version: 3,
        },
        event: { ...base.event, version: 6 },
        history: [
          {
            id: entry(5),
            fromMatchVersion: 2,
            toMatchVersion: 3,
            from: {
              courtId: court1,
              courtName: '合成一号场',
              startsAt: base.match.startsAt,
              endsAt: base.match.endsAt,
            },
            to: {
              courtId: court1,
              courtName: '合成一号场',
              startsAt: '2028-03-01T07:00:00.000Z',
              endsAt: '2028-03-01T08:00:00.000Z',
            },
            reason: '球队申请延后',
            createdAt: '2026-10-27T10:00:00Z',
          },
        ],
      }),
    );
    return ok({});
  });
  await s.page.submit();
  await s.flush();
  assert.match(s.page.data.notice, /改期记录已追加/);
  assert.equal(s.page.data.history.length, 1);
  assert.match(s.page.data.history[0].from, /09:00–10:00/);
  assert.match(s.page.data.history[0].to, /15:00–16:00/);
  assert.equal(s.page.data.reason, '', 'a saved change starts the next edit fresh');
  s.unload();
});

test('reschedule: a lost response must be checked by re-reading; a started match cannot move', async () => {
  const s = reschedulePage(rescheduling());
  await s.open({ orgId: org, matchId });
  s.page.pickTime(tap({}, { value: '15:00' }));
  s.page.reasonInput(tap({}, { value: '球队申请延后' }));
  const key = 'POST ' + matchBase + '/reschedule-commands';
  s.on(key, lost);
  await s.page.submit();
  await s.flush();
  assert.equal(s.page.data.uncertain, true);
  await s.page.submit();
  assert.equal(s.sent(key).length, 1, 'no automatic replay');
  s.set({
    ...rescheduling({ capabilities: { canReschedule: false } }),
    match: { ...rescheduling().match, status: 'LIVE' },
  });
  await s.page.load();
  await s.flush();
  assert.equal(s.page.data.uncertain, false);
  assert.equal(s.page.data.canReschedule, false);
  assert.match(s.page.data.blocker, /已开始/);
  s.unload();
});

test('reschedule: a version conflict re-reads and keeps what was typed; unchanged plans are named', async () => {
  const s = reschedulePage(rescheduling());
  await s.open({ orgId: org, matchId });
  s.page.reasonInput(tap({}, { value: '核对原安排' }));
  const key = 'POST ' + matchBase + '/reschedule-commands';
  s.on(key, () => fail(409, 'RESCHEDULE_UNCHANGED'));
  await s.page.submit();
  await s.flush();
  assert.match(s.page.data.error, /没有变化/);
  s.page.pickTime(tap({}, { value: '18:00' }));
  s.on(key, () => fail(409, 'VERSION_CONFLICT'));
  const reads = s.wx.calls.filter(
    (c) => c.type === 'request' && /rescheduling$/.test(c.url),
  ).length;
  await s.page.submit();
  await s.flush();
  assert.equal(
    s.wx.calls.filter((c) => c.type === 'request' && /rescheduling$/.test(c.url)).length,
    reads + 1,
  );
  assert.match(s.page.data.error, /已被其他操作更新/);
  assert.equal(s.page.data.time, '18:00');
  assert.equal(s.page.data.reason, '核对原安排');
  s.unload();
});

// ---------- match media ----------
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
function workspace(over = {}) {
  return {
    matchId,
    eventId,
    matchStatus: 'FINAL',
    matchVersion: 9,
    currentConfirmationId: entry(6),
    files: [],
    media: [],
    sourceEvents: [],
    trustedExternalHosts: [],
    usage: { usedBytes: 0, limitBytes: 134217728, maxFileBytes: 8388608 },
    capabilities: {
      canUpload: true,
      canManage: true,
      canPublish: true,
      canMark: true,
      canPurge: true,
    },
    ...over,
  };
}
const fileRow = (status = 'ACTIVE', version = 1) => ({
  id: fileId,
  purpose: 'MATCH_IMAGE',
  rosterRevisionId: null,
  fileName: 'photo.png',
  contentType: 'image/png',
  byteLength: PNG.length,
  sha256: hash('3'),
  version,
  status,
  createdAt: new Date().toISOString(),
  revokedAt: null,
  purgedAt: null,
});
const mediaRow = (status, version) => ({
  id: mediaId,
  kind: 'IMAGE',
  title: '决赛最后一攻',
  fileId,
  externalUrl: null,
  rightsDeclaration: '主办方摄影组拍摄',
  status,
  version,
  createdAt: '2026-10-27T10:00:00Z',
  markers: [],
});
function mediaPage(data, file = { tempFilePath: 'wxfile://tmp/photo.png', size: PNG.length }) {
  const s = server('pages/match-media/index');
  let current = data;
  s.set = (next) => {
    current = next;
  };
  s.on('GET ' + matchBase + '/media', () => ok(current));
  s.wx.chooseMedia = (o) => o.success({ tempFiles: [file] });
  s.wx.getFileSystemManager = () => ({
    readFile: (o) => o.success({ data: PNG.toString('base64') }),
  });
  return s;
}

test('media: upload is private; only an explicit publish makes it public, and revoke hides it', async () => {
  const s = mediaPage(workspace());
  await s.open({ orgId: org, matchId });
  // C19: the idempotent whole-file request (one chunk or less); progress is server-confirmed only.
  const upload = 'POST ' + matchBase + '/media-file-requests';
  s.on(upload, () => {
    s.set(workspace({ files: [fileRow()] }));
    return ok(fileRow());
  });
  s.hold(upload);
  const uploading = s.page.uploadImage();
  await ticks();
  assert.equal(s.page.data.upload.stage, 'sending');
  assert.match(s.page.data.upload.label, /服务端已确认上传 0 B/);
  assert.equal(s.page.data.upload.confirmed, 0, 'nothing is shown as uploaded before a reply');
  s.release(upload);
  await uploading;
  await s.flush();
  const sent = s.sent(upload)[0];
  assert.deepEqual(
    {
      ...sent.body,
      clientRequestId: /^[0-9a-f-]{36}$/.test(sent.body.clientRequestId),
      contentBase64: sent.body.contentBase64 === PNG.toString('base64'),
    },
    {
      clientRequestId: true,
      purpose: 'MATCH_IMAGE',
      fileName: 'photo.png',
      contentType: 'image/png',
      byteLength: PNG.length,
      contentSha256: require('node:crypto').createHash('sha256').update(PNG).digest('hex'),
      contentBase64: true,
    },
  );
  assert.equal(sent.timeout, 120000);
  assert.equal(s.page.data.upload.stage, 'saved');
  assert.match(s.page.data.files[0].statusLabel, /未关联、未发布/);
  assert.equal(s.page.data.items.length, 0, 'uploading alone creates no media record');

  s.page.titleInput(tap({}, { value: '决赛最后一攻' }));
  s.page.rightsInput(tap({}, { value: '主办方摄影组拍摄' }));
  const create = 'POST ' + matchBase + '/media-requests';
  s.on(create, () => {
    s.set(workspace({ files: [fileRow()], media: [mediaRow('DRAFT', 1)] }));
    return ok(mediaRow('DRAFT', 1));
  });
  await s.page.createDraft();
  await s.flush();
  const draftBody = s.sent(create)[0].body;
  assert.match(draftBody.clientRequestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(draftBody, {
    clientRequestId: draftBody.clientRequestId,
    kind: 'IMAGE',
    title: '决赛最后一攻',
    fileId,
    rightsDeclaration: '主办方摄影组拍摄',
  });
  assert.equal(s.page.data.items[0].statusLabel, '草稿 · 未公开');
  assert.equal(s.page.data.items[0].canPublish, true);

  const command = 'POST ' + matchBase + '/media/' + mediaId + '/commands';
  s.on(command, () => {
    s.set(workspace({ files: [fileRow()], media: [mediaRow('PUBLISHED', 2)] }));
    return ok(mediaRow('PUBLISHED', 2));
  });
  await s.page.publish(tap({ id: mediaId }));
  await s.flush();
  assert.deepEqual(s.sent(command)[0].body, { type: 'PUBLISH', expectedVersion: 1 });
  assert.match(s.page.data.items[0].statusLabel, /已发布/);
  s.on(command, () => {
    s.set(workspace({ files: [fileRow()], media: [mediaRow('REVOKED', 3)] }));
    return ok(mediaRow('REVOKED', 3));
  });
  await s.page.revoke(tap({ id: mediaId }));
  await s.flush();
  assert.deepEqual(s.sent(command)[1].body, { type: 'REVOKE', expectedVersion: 2 });
  assert.match(s.page.data.items[0].statusLabel, /已撤销/);
  assert.equal(s.page.data.items[0].canRevoke, false);
  s.unload();
});

test('media: oversized or wrong-type files are refused before reading or sending', async () => {
  const s = mediaPage(workspace(), { tempFilePath: 'wxfile://tmp/big.png', size: 8388609 });
  await s.open({ orgId: org, matchId });
  await s.page.uploadImage();
  assert.match(s.page.data.error, /不超过8\.0 MB/);
  s.wx.chooseMedia = (o) =>
    o.success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/x.gif', size: 10 }] });
  await s.page.uploadImage();
  assert.match(s.page.data.error, /PNG或JPEG/);
  assert.equal(s.state.bodies.length, 0);
  s.unload();
});

test('media: a rejected upload is retried with the same request ID; a lost one is resolved by its receipt', async () => {
  const s = mediaPage(workspace());
  await s.open({ orgId: org, matchId });
  const upload = 'POST ' + matchBase + '/media-file-requests';
  s.on(upload, () => fail(409, 'MEDIA_STORAGE_LIMIT'));
  await s.page.uploadImage();
  await s.flush();
  assert.match(s.page.data.error, /额度不足/);
  assert.equal(s.page.data.canRetry, true);
  assert.equal(s.page.data.uncertain, false);
  // Lost response: the server stored it, the device never heard.
  s.on(upload, () => {
    s.set(workspace({ files: [fileRow()] }));
    return lost();
  });
  await s.page.retryUpload();
  await s.flush();
  assert.equal(s.page.data.request.state, 'unknown', 'the outcome is unknown');
  assert.equal(s.page.data.canRetry, false, 'no resend while unknown');
  await s.page.retryUpload();
  assert.equal(s.sent(upload).length, 2);
  const [first, second] = s.sent(upload);
  assert.deepEqual(second.body, first.body, 'the retry kept the original ID and content');
  // The receipt of that same ID proves the result; nothing is sent again.
  s.on('GET ' + matchBase + '/media-file-requests/' + first.body.clientRequestId, () =>
    ok({ state: 'FILE', file: fileRow() }),
  );
  await s.page.queryRequest();
  await s.flush();
  assert.equal(s.page.data.request, null);
  assert.equal(s.page.data.upload.stage, 'saved');
  assert.equal(s.page.data.files.length, 1);
  assert.equal(s.sent(upload).length, 2, 'the page itself never sent it a third time');
  s.unload();
});

test('media: without upload rights nothing is sent; an account switch clears the page', async () => {
  const s = mediaPage(
    workspace({
      capabilities: {
        canUpload: false,
        canManage: false,
        canPublish: false,
        canMark: false,
        canPurge: false,
      },
    }),
  );
  await s.open({ orgId: org, matchId });
  assert.equal(s.page.data.caps.upload, false);
  await s.page.uploadImage();
  assert.equal(s.state.bodies.length, 0);
  s.client.clearSession();
  assert.equal(s.page.data.match, null);
  assert.equal(s.page.data.files.length, 0);
  s.unload();

  const denied = server('pages/match-media/index');
  denied.on('GET ' + matchBase + '/media', () => fail(403, 'FORBIDDEN'));
  await denied.open({ orgId: org, matchId });
  assert.equal(denied.page.data.unavailable, true);
  assert.match(denied.page.data.error, /不能管理本场媒体/);
  denied.unload();
});
