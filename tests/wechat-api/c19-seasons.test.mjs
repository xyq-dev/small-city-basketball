import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  PASSWORD,
  device,
  http,
  register,
  signIn,
  snapshot,
  startServer,
  tap,
} from './support.mjs';

// C19 private seasons on the real API: the actual seasons / season-grants page code runs in the
// VM harness, every wx.request goes to a real loopback API backed by an owned isolated database.
// FIXTURE PREPARATION (not page acceptance): the scored event is prepared through direct HTTP.
// The frozen historical member is then claimed through the actual manager and player pages;
// ordinary join deliberately creates a NEW member and must never claim an old frozen source.
let server, call, org, ownerCookie;
const root = () => `/v1/orgs/${org}`;

before(async () => {
  server = await startServer();
  call = http(server);
  const owner = await server.bootstrapOwner({
    email: 'season-owner@example.test',
    password: PASSWORD,
    displayName: '合成负责人',
    organizationName: '合成高州篮协',
  });
  org = owner.organizationId;
  ownerCookie = (
    await call('/v1/auth/login', {
      method: 'POST',
      body: { email: 'season-owner@example.test', password: PASSWORD },
    })
  ).cookie;
});
after(async () => {
  await server?.close();
});

async function participant(email, displayName) {
  const response = await call('/v1/auth/register-participant', {
    method: 'POST',
    body: { email, password: PASSWORD, displayName },
  });
  return { id: response.data.user.id, cookie: response.cookie };
}

/** FIXTURE: one frozen two-team event with one confirmed PLAYER_BASIC match (5 points, 1 foul). */
async function scoredEvent() {
  const leader = await participant('season-leader@example.test', '合成领队');
  const scorer = await participant('season-scorer@example.test', '合成记分员');
  await call(`${root()}/members/${scorer.id}`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: { role: 'SCORER', status: 'ACTIVE' },
  });
  const teams = [];
  for (const name of ['合成石鼓青锋', '合成高州猛龙']) {
    let team = (
      await call(`${root()}/teams`, { method: 'POST', cookie: ownerCookie, body: { name } })
    ).data;
    team = (
      await call(`${root()}/teams/${team.id}/members`, {
        method: 'PUT',
        cookie: ownerCookie,
        body: {
          expectedVersion: team.version,
          members: [{ name: name + '甲' }, { name: name + '乙' }],
        },
      })
    ).data;
    await call(`${root()}/teams/${team.id}/grants/${leader.id}`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: { status: 'ACTIVE' },
    });
    teams.push(team);
  }
  let event = (
    await call(`${root()}/events`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        name: '合成青锋杯',
        startDate: '2028-03-01',
        endDate: '2028-03-02',
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
        venueName: '合成体育馆',
      },
    })
  ).data;
  const eventPath = `${root()}/events/${event.id}`;
  let registration = (
    await call(`${eventPath}/registration-rules`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: {
        expectedVersion: event.version,
        minPlayers: 2,
        maxPlayers: 2,
        zeroAndDoubleZeroDistinct: false,
        requireIdentity: false,
        requireInsurance: false,
      },
    })
  ).data;
  const stage = async (type) =>
    (registration = (
      await call(`${eventPath}/registration-commands`, {
        method: 'POST',
        cookie: ownerCookie,
        body: { type, expectedVersion: registration.event.version },
      })
    ).data);
  await stage('OPEN_REGISTRATION');
  for (const team of teams) {
    let entry = (
      await call(`${eventPath}/entries`, {
        method: 'POST',
        cookie: leader.cookie,
        body: { teamId: team.id },
      })
    ).data;
    entry = (
      await call(`${root()}/entries/${entry.id}/roster`, {
        method: 'PUT',
        cookie: leader.cookie,
        body: {
          expectedVersion: entry.version,
          players: team.members.map((m, i) => ({ memberId: m.id, jerseyNo: String(i + 4) })),
        },
      })
    ).data;
    entry = (
      await call(`${root()}/entries/${entry.id}/commands`, {
        method: 'POST',
        cookie: leader.cookie,
        body: { type: 'SUBMIT', expectedVersion: entry.version },
      })
    ).data;
    await call(`${root()}/entries/${entry.id}/commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { type: 'APPROVE', expectedVersion: entry.version },
    });
  }
  await stage('CLOSE_REGISTRATION');
  await stage('FREEZE_REGISTRATION');
  const court = (
    await call(`${root()}/courts`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { name: '合成一号场' },
    })
  ).data;
  let revision = (
    await call(`${eventPath}/schedule-revisions`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        expectedEventVersion: registration.event.version,
        freezeId: registration.freeze.id,
        algorithmVersion: 'RR_CIRCLE_V1',
        policy: {
          slotDurationMinutes: 60,
          minRestMinutes: 0,
          minLocalDayGap: 0,
          courtWindows: [
            {
              courtId: court.id,
              startsAt: '2028-03-01T00:00:00+08:00',
              endsAt: '2028-03-03T02:00:00+08:00',
            },
          ],
        },
      },
    })
  ).data;
  revision = (
    await call(`${root()}/schedule-revisions/${revision.id}/allocations`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: {
        expectedEventVersion: revision.eventVersion,
        expectedRevisionVersion: revision.version,
        allocations: revision.fixtures.map((f, i) => ({
          fixtureKey: f.fixtureKey,
          courtId: court.id,
          startsAt: new Date(Date.parse('2028-03-01T09:00:00+08:00') + i * 3600000).toISOString(),
        })),
      },
    })
  ).data;
  const publication = (
    await call(`${root()}/schedule-revisions/${revision.id}/publish`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        expectedEventVersion: revision.eventVersion,
        expectedRevisionVersion: revision.version,
      },
    })
  ).data;
  await call(`${eventPath}/scoring-rules`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: {
      expectedEventVersion: publication.event.version,
      regulationPeriods: 1,
      periodDurationSeconds: 1,
      allowedScoreValues: [1, 2, 3],
      tiePolicy: 'ALLOW_DRAW',
      overtimeDurationSeconds: null,
    },
  });
  const [match] = (await call(`${eventPath}/matches?limit=100`, { cookie: ownerCookie })).data;
  const matchPath = `${root()}/matches/${match.id}`;
  const bench = async (cookie = ownerCookie) =>
    (await call(`${matchPath}/scoring`, { cookie })).data;
  let current = await bench();
  await call(`${matchPath}/staff/${scorer.id}`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: { expectedMatchVersion: current.match.version, role: 'SCORER', status: 'ACTIVE' },
  });
  const send = async (cookie, type, payload, control) => {
    const now = await bench(cookie);
    return call(`${matchPath}/commands`, {
      method: 'POST',
      cookie,
      body: {
        commandId: randomUUID(),
        expectedVersion: now.match.version,
        capturedAt: new Date().toISOString(),
        type,
        payload: typeof payload === 'function' ? payload(now) : payload,
        ...(control ? { control } : {}),
      },
    });
  };
  current = await bench();
  await send(ownerCookie, 'PREPARE_MATCH', {
    expectedEventVersion: current.event.version,
    collectionMode: 'PLAYER_BASIC',
  });
  const lease = (
    await call(`${matchPath}/scorekeeper-lease`, {
      method: 'POST',
      cookie: scorer.cookie,
      body: { clientInstanceId: randomUUID() },
    })
  ).data;
  const control = {
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    clientInstanceId: lease.clientInstanceId,
  };
  await send(
    scorer.cookie,
    'START_MATCH',
    (n) => ({ expectedEventVersion: n.event.version }),
    control,
  );
  const home = current.playerRoster.home[0];
  const homeTeamId = current.match.home.teamId;
  for (const value of [3, 2])
    await send(
      scorer.cookie,
      'RECORD_STAT',
      { kind: 'SCORE', side: 'HOME', value, memberId: home.memberId },
      control,
    );
  await send(
    scorer.cookie,
    'RECORD_STAT',
    { kind: 'FOUL', side: 'HOME', value: 1, memberId: home.memberId },
    control,
  );
  await send(
    scorer.cookie,
    'CLOCK_SET',
    { remainingMs: 0, reason: '合成测试节次计时完成' },
    control,
  );
  await send(scorer.cookie, 'END_MATCH', {}, control);
  await send(ownerCookie, 'CONFIRM_RESULT', {});
  assert.equal((await bench()).match.status, 'FINAL');
  return { eventId: event.id, teamId: homeTeamId, memberId: home.memberId, memberName: home.name };
}

test('season management, nomination, consent, own statistics, organization board and revocation through the real pages', async () => {
  const fixture = await scoredEvent();
  const ownerDevice = device(server);
  await signIn(ownerDevice, 'season-owner@example.test');
  const playerDevice = device(server);
  await register(playerDevice, 'season-player@example.test', '合成球员小林');
  const playerId = (await playerDevice.client.request('/v1/auth/session')).data.user.id;
  // Manager issues a directed claim for exactly this historical member and this account.
  const team = ownerDevice.open('pages/team/index', { orgId: org, teamId: fixture.teamId });
  await ownerDevice.settle(team);
  assert.ok(
    team.page.data.roster?.claimableMembers.some((m) => m.memberId === fixture.memberId),
    team.page.data.playersError,
  );
  team.page.setData({ claimMember: fixture.memberId, claimTarget: playerId });
  ownerDevice.approve();
  await team.page.createClaim();
  await ownerDevice.settle(team);
  assert.equal(team.page.data.error, '', team.page.data.error);
  const issuedClaim = team.page.data.roster.claims.find((c) => c.memberId === fixture.memberId);
  assert.ok(issuedClaim, team.page.data.playersError);
  assert.equal(issuedClaim.status, 'PENDING');
  const join = playerDevice.open('pages/team-join/index', {});
  await playerDevice.settle(join);
  const claim = join.page.data.claims.find((c) => c.claimId === issuedClaim.claimId);
  assert.ok(claim, join.page.data.error);
  assert.equal(claim.memberName, fixture.memberName);
  assert.equal(claim.status, 'PENDING');
  playerDevice.approve();
  await join.page.decide(tap({ id: claim.claimId, decision: 'accept' }));
  await playerDevice.settle(join);
  assert.equal(join.page.data.joined?.memberId, fixture.memberId, join.page.data.error);
  assert.equal(
    (await playerDevice.client.request('/v1/auth/session')).data.teamContexts.length,
    0,
    'claim does not grant management',
  );
  const bindings = await server.pool.query(
    "SELECT member_id,user_id,source FROM team_member_bindings WHERE org_id=$1 AND team_id=$2 AND status='ACTIVE'",
    [org, fixture.teamId],
  );
  assert.deepEqual(bindings.rows, [
    { member_id: fixture.memberId, user_id: playerId, source: 'CLAIM' },
  ]);

  // Admin: create a season on the list page (the original request id is sent once).
  const list = ownerDevice.open('pages/seasons/index', { orgId: org });
  await ownerDevice.settle(list);
  assert.equal(list.page.data.error, '');
  for (const [field, value] of [
    ['name', '合成2028春季'],
    ['startDate', '2028-01-01'],
    ['endDate', '2028-06-30'],
  ])
    list.page.input(tap({ section: 'draft', field }, { value }));
  ownerDevice.approve();
  await list.page.create();
  await ownerDevice.settle(list);
  assert.equal(list.page.data.error, '', list.page.data.error);
  const opened = ownerDevice.navigations.at(-1);
  const seasonId = /seasonId=([0-9a-f-]{36})/.exec(opened)?.[1];
  assert.ok(seasonId, 'detail page opened after creation: ' + opened);
  const created = (
    await server.pool.query('SELECT status,version FROM seasons WHERE id=$1', [seasonId])
  ).rows[0];
  assert.deepEqual(created, { status: 'DRAFT', version: 1 });

  // Admin: attach the event explicitly, then activate.
  const detail = ownerDevice.open('pages/seasons/index', { orgId: org, seasonId });
  await ownerDevice.settle(detail);
  assert.deepEqual(
    detail.page.data.season.candidates.map((c) => c.eventId),
    [fixture.eventId],
    'only explicit candidates, nothing attached automatically',
  );
  assert.deepEqual(detail.page.data.season.events, []);
  ownerDevice.approve();
  await detail.page.command(tap({ type: 'ATTACH_EVENT', id: fixture.eventId }));
  await ownerDevice.settle(detail);
  assert.deepEqual(
    detail.page.data.season.events.map((e) => e.eventId),
    [fixture.eventId],
    detail.page.data.error,
  );
  ownerDevice.approve();
  await detail.page.command(tap({ type: 'ACTIVATE' }));
  await ownerDevice.settle(detail);
  assert.equal(detail.page.data.season.status, 'ACTIVE', detail.page.data.error);
  // Binding alone aggregates nothing.
  assert.deepEqual(detail.page.data.board.rows, []);
  snapshot(detail, 'c19-season-detail-empty');

  // Organizer: open nomination from the season page and nominate the bound member.
  detail.page.openGrants(tap({ id: fixture.eventId }));
  assert.match(
    ownerDevice.navigations.at(-1),
    new RegExp('/pages/season-grants/index\\?orgId=' + org + '&eventId=' + fixture.eventId),
  );
  const nominate = ownerDevice.open('pages/season-grants/index', {
    orgId: org,
    eventId: fixture.eventId,
  });
  await ownerDevice.settle(nominate);
  assert.equal(nominate.page.data.mode, 'organizer');
  assert.equal(nominate.page.data.frozen, true, nominate.page.data.error);
  const teamIndex = nominate.page.data.sources.findIndex((t) => t.teamId === fixture.teamId);
  nominate.page.pickTeam(tap({}, { value: teamIndex }));
  const memberIndex = nominate.page.data.sources[teamIndex].members.findIndex(
    (m) => m.memberId === fixture.memberId,
  );
  assert.match(nominate.page.data.memberLabels[memberIndex], /绑定账号：合成球员小林/);
  nominate.page.pickMember(tap({}, { value: memberIndex }));
  nominate.page.input(tap({ field: 'reason' }, { value: '本届逐人得分提名' }));
  ownerDevice.approve();
  await nominate.page.nominate();
  await ownerDevice.settle(nominate);
  assert.equal(nominate.page.data.error, '', nominate.page.data.error);
  assert.equal(nominate.page.data.grants[0].status, 'PENDING');
  const grantRows = async () =>
    (
      await server.pool.query(
        'SELECT status,purpose,target_user_id,version FROM season_data_grants',
      )
    ).rows;
  assert.deepEqual(await grantRows(), [
    { status: 'PENDING', purpose: 'PRIVATE_SEASON', target_user_id: playerId, version: 1 },
  ]);
  // Nomination alone aggregates nothing.
  await detail.page.load();
  await ownerDevice.settle(detail);
  assert.deepEqual(detail.page.data.board.rows, []);

  // Player: the consent screen states scope, readers, metric definition and how to revoke.
  const mine = playerDevice.open('pages/season-grants/index', {});
  await playerDevice.settle(mine);
  assert.equal(mine.page.data.mode, 'player');
  const disclosure = mine.page.data.disclosure;
  assert.match(disclosure.scope, /范围/);
  assert.match(disclosure.readers, /读者.*OWNER\/ADMIN/);
  assert.match(disclosure.metrics, /统计口径.*未统计/);
  assert.match(disclosure.revocation, /撤销/);
  assert.match(disclosure.independence, /预约档案/);
  assert.equal(mine.page.data.grants.length, 1);
  const grant = mine.page.data.grants[0];
  assert.equal(grant.capabilities.canConsent, true);
  snapshot(mine, 'c19-season-consent');
  mine.page.acknowledge(tap({ id: grant.id }, { value: ['yes'] }));
  playerDevice.approve();
  await mine.page.answer(tap({ id: grant.id, type: 'CONSENT' }));
  await playerDevice.settle(mine);
  assert.equal(mine.page.data.error, '', mine.page.data.error);
  assert.equal(mine.page.data.grants[0].status, 'ACTIVE');
  assert.deepEqual(await grantRows(), [
    { status: 'ACTIVE', purpose: 'PRIVATE_SEASON', target_user_id: playerId, version: 2 },
  ]);

  // Player: own statistics only.
  await mine.page.showStats(tap({ org, season: seasonId }));
  await playerDevice.settle(mine);
  assert.equal(mine.page.data.statsError, '', mine.page.data.statsError);
  assert.equal(mine.page.data.stats.row.score, '5');
  assert.equal(mine.page.data.stats.row.fouls, '1');
  assert.equal(mine.page.data.stats.row.samples, '1');
  for (const key of ['rebounds', 'assists', 'minutes'])
    assert.equal(mine.page.data.stats.row[key], '未统计');
  snapshot(mine, 'c19-season-own-stats');

  // Admin: the organization board shows the player with “未统计” for uncollected items.
  await detail.page.load();
  await ownerDevice.settle(detail);
  const row = detail.page.data.board.rows.find((r) => r.userId === playerId);
  assert.ok(row, detail.page.data.boardError);
  assert.equal(row.displayName, '合成球员小林');
  assert.equal(row.score, '5');
  for (const key of ['rebounds', 'assists', 'minutes']) assert.equal(row[key], '未统计');
  assert.match(row.sources[0].text, /名单场次 1/);
  assert.equal(JSON.stringify(detail.page.data).includes('season-player@example.test'), false);
  snapshot(detail, 'c19-season-board');

  // Player: revoke; both views drop the data on their next read.
  playerDevice.approve();
  await mine.page.answer(tap({ id: grant.id, type: 'REVOKE' }));
  await playerDevice.settle(mine);
  assert.equal(mine.page.data.grants[0].status, 'REVOKED', mine.page.data.error);
  assert.equal(mine.page.data.stats.row, null, 'own statistics re-read after revocation');
  await detail.page.load();
  await ownerDevice.settle(detail);
  assert.equal(
    detail.page.data.board.rows.find((r) => r.userId === playerId),
    undefined,
  );
  assert.deepEqual(await grantRows(), [
    { status: 'REVOKED', purpose: 'PRIVATE_SEASON', target_user_id: playerId, version: 3 },
  ]);
  // A revoked grant offers no consent button again; the audit trail is complete.
  assert.equal(mine.page.data.grants[0].capabilities.canConsent, false);
  const actions = (
    await server.pool.query(
      "SELECT action FROM audit_logs WHERE action LIKE 'SEASON_%' ORDER BY created_at,id",
    )
  ).rows.map((r) => r.action);
  assert.deepEqual(actions, [
    'SEASON_CREATED',
    'SEASON_ATTACH_EVENT',
    'SEASON_ACTIVATE',
    'SEASON_GRANT_NOMINATED',
    'SEASON_GRANT_CONSENTED',
    'SEASON_GRANT_REVOKED',
  ]);

  // Identity switch on the player device: the page clears private data.
  await signIn(playerDevice, 'season-owner@example.test');
  await playerDevice.settle(mine);
  assert.deepEqual(mine.page.data.grants, []);
  assert.equal(mine.page.data.stats, null);
});
