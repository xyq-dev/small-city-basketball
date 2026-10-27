import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
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

// C15 native management against the real API: group draw, tie draw, qualification and
// round-by-round knockout publication; formal rescheduling with server conflicts and history;
// match media upload, publication and revocation with public visibility checked anonymously.
// Pages under test are driven natively; HTTP is used only to reach the states between them
// (team registration, and scoring each match to an independently confirmed result).
let server, call, org, root, ownerCookie, leaderCookie, scorerCookie;
const people = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

before(async () => {
  server = await startServer();
  call = http(server);
  const owner = await server.bootstrapOwner({
    email: 'owner@example.test',
    password: PASSWORD,
    displayName: '合成负责人',
    organizationName: '合成茂名篮协',
  });
  org = owner.organizationId;
  root = `/v1/orgs/${org}`;
  const login = async (email) =>
    (await call('/v1/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).cookie;
  ownerCookie = await login('owner@example.test');
  for (const [key, email, name] of [
    ['leader', 'leader@example.test', '合成领队'],
    ['scorer', 'scorer@example.test', '合成记分员'],
  ]) {
    const d = device(server);
    await register(d, email, name);
    people[key] = (await d.client.request('/v1/auth/session')).data.user.id;
  }
  leaderCookie = await login('leader@example.test');
  scorerCookie = await login('scorer@example.test');
  await call(`${root}/members/${people.scorer}`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: { role: 'SCORER', status: 'ACTIVE' },
  });
});
after(async () => {
  await server?.close();
});

const version = async (eventPath) => (await call(eventPath, { cookie: ownerCookie })).data.version;

/** HTTP only: an event with `names.length` approved, frozen teams. */
async function frozenEvent(name, format, names, month = '04') {
  const event = (
    await call(`${root}/events`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        name,
        startDate: '2028-' + month + '-01',
        endDate: '2028-' + month + '-03',
        timezone: 'Asia/Shanghai',
        format,
      },
    })
  ).data;
  const eventPath = `${root}/events/${event.id}`;
  await call(`${eventPath}/registration-rules`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: {
      expectedVersion: await version(eventPath),
      minPlayers: 2,
      maxPlayers: 3,
      zeroAndDoubleZeroDistinct: true,
      requireIdentity: false,
      requireInsurance: false,
    },
  });
  const stage = async (type) =>
    call(`${eventPath}/registration-commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { type, expectedVersion: await version(eventPath) },
    });
  await stage('OPEN_REGISTRATION');
  for (const teamName of names) {
    let team = (
      await call(`${root}/teams`, { method: 'POST', cookie: ownerCookie, body: { name: teamName } })
    ).data;
    team = (
      await call(`${root}/teams/${team.id}/members`, {
        method: 'PUT',
        cookie: ownerCookie,
        body: {
          expectedVersion: team.version,
          members: [{ name: teamName + '甲' }, { name: teamName + '乙' }],
        },
      })
    ).data;
    const issued = (
      await call(`${root}/teams/${team.id}/invitations`, {
        method: 'POST',
        cookie: ownerCookie,
        body: { targetUserId: people.leader, expiresInHours: 1 },
      })
    ).data;
    await call(`/v1/invitations/${issued.invitation.id}/accept`, {
      method: 'POST',
      cookie: leaderCookie,
      body: { token: issued.token },
    });
    let entry = (
      await call(`${eventPath}/entries`, {
        method: 'POST',
        cookie: leaderCookie,
        body: { teamId: team.id },
      })
    ).data;
    entry = (
      await call(`${root}/entries/${entry.id}/roster`, {
        method: 'PUT',
        cookie: leaderCookie,
        body: {
          expectedVersion: entry.version,
          players: team.members.map((m, i) => ({ memberId: m.id, jerseyNo: String(i + 4) })),
        },
      })
    ).data;
    entry = (
      await call(`${root}/entries/${entry.id}/commands`, {
        method: 'POST',
        cookie: leaderCookie,
        body: { type: 'SUBMIT', expectedVersion: entry.version },
      })
    ).data;
    await call(`${root}/entries/${entry.id}/commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { type: 'APPROVE', expectedVersion: entry.version },
    });
  }
  await stage('CLOSE_REGISTRATION');
  await stage('FREEZE_REGISTRATION');
  return { id: event.id, path: eventPath };
}

/** Native: add a court once, generate, auto-assign, validate and publish. */
async function publishSchedule(d, event, configure) {
  const schedule = d.open('pages/schedule/index', { orgId: org, eventId: event.id });
  await d.settle(schedule);
  assert.equal(schedule.page.data.state, 'generate', schedule.page.data.error);
  if (!schedule.page.data.courts.length) {
    schedule.page.courtInput(tap({}, { value: '合成一号场' }));
    await schedule.page.addCourt();
    await d.settle(schedule);
  }
  configure?.(schedule);
  d.approve();
  await schedule.page.generate();
  await d.settle(schedule);
  assert.equal(schedule.page.data.state, 'draft', schedule.page.data.error);
  await schedule.page.autoAssign();
  await d.settle(schedule);
  await schedule.page.validate();
  await d.settle(schedule);
  assert.deepEqual(schedule.page.data.conflicts, [], schedule.page.data.error);
  return schedule;
}

/** HTTP: one scorer records a decisive result; the organizer confirms independently. */
async function play(matchId, winner) {
  const base = `${root}/matches/${matchId}`;
  let wb = (await call(`${base}/scoring`, { cookie: ownerCookie })).data;
  if (!wb.staff.some((s) => s.userId === people.scorer && s.status === 'ACTIVE')) {
    await call(`${base}/staff/${people.scorer}`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: { expectedMatchVersion: wb.match.version, role: 'SCORER', status: 'ACTIVE' },
    });
    wb = (await call(`${base}/scoring`, { cookie: ownerCookie })).data;
  }
  const command = async (cookie, expectedVersion, type, payload = {}, control) =>
    (
      await call(`${base}/commands`, {
        method: 'POST',
        cookie,
        body: {
          commandId: randomUUID(),
          expectedVersion,
          type,
          payload,
          capturedAt: new Date().toISOString(),
          ...(control ? { control } : {}),
        },
      })
    ).data.snapshot;
  let snap = await command(ownerCookie, wb.match.version, 'PREPARE_MATCH', {
    expectedEventVersion: wb.event.version,
    collectionMode: 'TEAM_ONLY',
  });
  const lease = (
    await call(`${base}/scorekeeper-lease`, {
      method: 'POST',
      cookie: scorerCookie,
      body: { clientInstanceId: randomUUID() },
    })
  ).data;
  const control = {
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    clientInstanceId: lease.clientInstanceId,
  };
  const eventVersion = (await call(`${base}/scoring`, { cookie: ownerCookie })).data.event.version;
  snap = await command(
    scorerCookie,
    snap.version,
    'START_MATCH',
    { expectedEventVersion: eventVersion },
    control,
  );
  snap = await command(
    scorerCookie,
    snap.version,
    'RECORD_STAT',
    { kind: 'SCORE', side: winner, value: 2 },
    control,
  );
  snap = await command(scorerCookie, snap.version, 'CLOCK_START', {}, control);
  await sleep(1200);
  snap = await command(scorerCookie, snap.version, 'CLOCK_PAUSE', {}, control);
  snap = await command(scorerCookie, snap.version, 'END_MATCH', {}, control);
  await call(`${base}/scorekeeper-lease`, {
    method: 'DELETE',
    cookie: scorerCookie,
    body: { control },
    expect: [200, 204],
  });
  snap = await command(ownerCookie, snap.version, 'CONFIRM_RESULT');
  assert.equal(snap.status, 'FINAL');
}

async function matchesOf(event) {
  return (await call(`${event.path}/matches?limit=100`, { cookie: ownerCookie })).data;
}

/** Native scoring rules (after publication): 1-second periods and 1-second overtime. */
async function nativeScoring(d, event) {
  const setup = d.open('pages/event-setup/index', { orgId: org, eventId: event.id });
  await d.settle(setup);
  for (const [field, value] of [
    ['periods', '1'],
    ['minutes', '0'],
    ['seconds', '1'],
    ['otMinutes', '0'],
    ['otSeconds', '1'],
  ])
    setup.page.field(tap({ section: 'scoring', field }, { value }));
  await setup.page.saveScoring();
  await d.settle(setup);
  assert.equal(setup.page.data.scoring.saved, true, setup.page.data.error);
  return setup;
}
/** Native group standings, locked before the group schedule can be published. */
async function nativeGroupStandings(d, event) {
  const setup = d.open('pages/event-setup/index', { orgId: org, eventId: event.id });
  await d.settle(setup);
  assert.ok(setup.page.data.standings?.editable, 'group standings are native now');
  // No tiebreakers at all: equal records go straight to a persisted draw.
  for (const value of ['SCORE_DIFFERENCE', 'POINTS_FOR']) {
    const index = setup.page.data.standings.tiebreakers.findIndex((t) => t.value === value);
    setup.page.toggle(tap({ section: 'standings', field: 'tiebreakers', index }));
  }
  await setup.page.saveStandings();
  await d.settle(setup);
  assert.equal(setup.page.data.standings.orderLabel, '不设同分比较', setup.page.data.error);
  d.approve();
  await setup.page.publishStandings();
  await d.settle(setup);
  assert.equal(setup.page.data.standings.locked, true, setup.page.data.error);
}

function allocate(bracket, slots) {
  bracket.page.data.fixtures.forEach((f, i) => {
    bracket.page.pickCourt(tap({ index: i }, { value: 0 }));
    bracket.page.pickDate(tap({ index: i }, { value: slots[i][0] }));
    bracket.page.pickTime(tap({ index: i }, { value: slots[i][1] }));
  });
}

test('groups, tie draw, qualification, knockout rounds, rescheduling and media through native pages', async () => {
  const owner = device(server);
  await signIn(owner, 'owner@example.test');
  const names = ['合成一队', '合成二队', '合成三队', '合成四队', '合成五队', '合成六队'];
  const event = await frozenEvent('合成分组杯', 'GROUP_KNOCKOUT', names);

  // Group draw natively: two groups, one seed; the server's replayed groups are shown.
  const schedule = await publishSchedule(owner, event, (page) => {
    assert.deepEqual(
      page.page.data.groupCounts.map((g) => g.value),
      [2],
      '6 teams allow 2 groups of at least 2',
    );
    page.page.toggleSeed(tap({ index: 0 }));
  });
  assert.equal(schedule.page.data.draftGroups.length, 2, schedule.page.data.error);
  snapshot(schedule, 'schedule-groups-draft');
  // The server refuses to publish groups before their standings rules are locked.
  owner.approve();
  await schedule.page.publish();
  await owner.settle(schedule);
  assert.equal(schedule.page.data.state, 'draft');
  assert.match(schedule.page.data.error, /锁定组内积分规则/);
  await nativeGroupStandings(owner, event);
  await schedule.page.load();
  await owner.settle(schedule);
  owner.approve();
  await schedule.page.publish();
  await owner.settle(schedule);
  assert.equal(schedule.page.data.state, 'published', schedule.page.data.error);
  await nativeScoring(owner, event);

  const bracket = owner.open('pages/bracket/index', { orgId: org, eventId: event.id });
  await owner.settle(bracket);
  assert.equal(bracket.page.data.kind, 'GROUP_KNOCKOUT', bracket.page.data.error);
  assert.match(bracket.page.data.blocker, /等待全部组赛有效独立确认/);
  assert.equal(bracket.page.data.next, null);

  // Group A ends in a three-way cycle (a tie), group B in a strict order.
  const groupData = (await call(`${event.path}/groups`, { cookie: ownerCookie })).data;
  const [groupA, groupB] = groupData.competition.groups;
  const groupOf = (entryId) => (groupA.participants.some((p) => p.entryId === entryId) ? 'A' : 'B');
  const orderB = groupB.participants.map((p) => p.entryId).sort();
  const cycle = groupA.participants.map((p) => p.entryId);
  for (const m of await matchesOf(event)) {
    const home = m.home.entryId,
      away = m.away.entryId;
    let homeWins;
    if (groupOf(home) === 'A') {
      const i = cycle.indexOf(home),
        j = cycle.indexOf(away);
      homeWins = (i + 1) % 3 === j;
    } else homeWins = orderB.indexOf(home) < orderB.indexOf(away);
    await play(m.id, homeWins ? 'HOME' : 'AWAY');
  }

  await bracket.page.load();
  await owner.settle(bracket);
  assert.equal(bracket.page.data.qualification, '需独立保存同分抽签', bracket.page.data.error);
  const tied = bracket.page.data.groups.find((g) => g.needsDraw);
  assert.ok(tied, 'one group needs a draw');
  assert.equal(tied.ties.split('、').length, 3);
  snapshot(bracket, 'bracket-tie');
  bracket.page.tieInput(
    tap({ key: tied.key }, { value: '三队胜负循环且不设同分比较，按规则抽签' }),
  );
  owner.approve();
  await bracket.page.drawTie(tap({ key: tied.key }));
  await owner.settle(bracket);
  assert.equal(bracket.page.data.qualification, '可发布淘汰首轮', bracket.page.data.error);
  assert.ok(bracket.page.data.groups.find((g) => g.key === tied.key).draw, 'draw record shown');
  assert.equal(bracket.page.data.next?.qualifying, true);

  // Source change between reading and publishing: a group-B result is reopened and
  // re-confirmed over HTTP, so the qualification the page pinned is no longer current.
  allocate(bracket, [
    ['2028-04-02', '09:00'],
    ['2028-04-02', '11:00'],
  ]);
  bracket.page.reasonInput(tap({}, { value: '组赛全部独立确认' }));
  const groupBMatch = (await matchesOf(event)).find((m) => groupOf(m.home.entryId) === 'B');
  const reopenBase = `${root}/matches/${groupBMatch.id}`;
  let wb = (await call(`${reopenBase}/scoring`, { cookie: ownerCookie })).data;
  let snap = (
    await call(`${reopenBase}/commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        commandId: randomUUID(),
        expectedVersion: wb.snapshot.version,
        type: 'REOPEN_RESULT',
        payload: { reason: '核对记录后重新确认' },
        capturedAt: new Date().toISOString(),
      },
    })
  ).data.snapshot;
  await call(`${reopenBase}/commands`, {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      commandId: randomUUID(),
      expectedVersion: snap.version,
      type: 'CONFIRM_RESULT',
      payload: {},
      capturedAt: new Date().toISOString(),
    },
  });
  owner.approve();
  await bracket.page.publish();
  await owner.settle(bracket);
  assert.match(bracket.page.data.error, /已变化|已被其他操作更新/, 'stale source rejected');
  assert.equal(bracket.page.data.fixtures[1]?.time, '11:00', 'allocations kept');
  assert.equal(bracket.page.data.reason, '组赛全部独立确认');
  owner.approve();
  await bracket.page.publish();
  await owner.settle(bracket);
  assert.equal(bracket.page.data.qualification, '淘汰首轮已发布', bracket.page.data.error);
  assert.equal(bracket.page.data.rounds[0].published, true);

  // A group result consumed by the published qualification can no longer be reopened.
  const consumed = owner.open('pages/org-match/index', { orgId: org, matchId: groupBMatch.id });
  await owner.settle(consumed);
  assert.equal(consumed.page.data.caps.reopen, false, consumed.page.data.error);

  // Formal rescheduling of a semi-final: a clash is reported, then a free slot is saved.
  const semis = bracket.page.data.rounds[0].slots;
  const [first, second] = semis.map((s) => s.matchId);
  const resched = owner.open('pages/reschedule/index', { orgId: org, matchId: second });
  await owner.settle(resched);
  assert.equal(resched.page.data.canReschedule, true, resched.page.data.error);
  assert.equal(resched.page.data.history.length, 0);
  resched.page.pickTime(tap({}, { value: '09:00' }));
  resched.page.reasonInput(tap({}, { value: '尝试与另一场同时开赛' }));
  owner.approve();
  await resched.page.submit();
  await owner.settle(resched);
  assert.match(resched.page.data.error, /冲突/, resched.page.data.error);
  assert.ok(resched.page.data.conflicts.some((c) => c.label === '同一场地时间重叠'));
  resched.page.pickTime(tap({}, { value: '13:30' }));
  resched.page.reasonInput(tap({}, { value: '球队申请延后' }));
  owner.approve();
  await resched.page.submit();
  await owner.settle(resched);
  assert.equal(resched.page.data.error, '');
  assert.equal(resched.page.data.history.length, 1);
  assert.match(resched.page.data.history[0].to, /13:30/);
  assert.match(resched.page.data.history[0].from, /11:00/);
  snapshot(resched, 'reschedule-history');
  const scheduling = (await call(`${event.path}/scheduling`, { cookie: ownerCookie })).data;
  assert.ok(scheduling.publication, 'the original group publication record is untouched');

  // Semi-finals, then the final is published natively.
  for (const id of [first, second]) await play(id, 'HOME');
  await bracket.page.load();
  await owner.settle(bracket);
  assert.equal(bracket.page.data.next?.qualifying, false, bracket.page.data.error);
  allocate(bracket, [['2028-04-03', '10:00']]);
  bracket.page.reasonInput(tap({}, { value: '半决赛均已独立确认' }));
  owner.approve();
  await bracket.page.publish();
  await owner.settle(bracket);
  assert.equal(bracket.page.data.error, '');
  const finalId = bracket.page.data.rounds[1].slots[0].matchId;
  assert.ok(finalId, 'final published');
  await play(finalId, 'AWAY');
  await bracket.page.load();
  await owner.settle(bracket);
  assert.equal(bracket.page.data.placements[0]?.rank, '第1名', bracket.page.data.error);
  snapshot(bracket, 'bracket-complete');

  // Public viewing must be re-enabled after round publication; then media visibility.
  const setup = owner.open('pages/event-setup/index', { orgId: org, eventId: event.id });
  await owner.settle(setup);
  owner.approve();
  await setup.page.viewing(tap({ type: 'ENABLE' }));
  await owner.settle(setup);
  const publicId = setup.page.data.viewing.publicEventId;
  assert.match(publicId, /^[A-Za-z0-9_-]{43}$/, setup.page.data.error);
  const publicSchedule = (await call(`/v1/public/events/${publicId}/schedule?limit=50`)).data;
  const finalPublic = publicSchedule.find((m) => m.startsAt === '2028-04-03T02:00:00.000Z');
  assert.ok(finalPublic, 'final listed publicly');
  const publicMedia = async () =>
    (await call(`/v1/public/events/${publicId}/matches/${finalPublic.publicMatchId}/media`)).data
      .media;

  // A plain scorer cannot manage media.
  const scorer = device(server);
  await signIn(scorer, 'scorer@example.test');
  const denied = scorer.open('pages/match-media/index', { orgId: org, matchId: finalId });
  await scorer.settle(denied);
  assert.equal(denied.page.data.unavailable, true, JSON.stringify(denied.page.data.caps));

  owner.wx.chooseMedia = (o) =>
    o.success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/final-moment.png', size: PNG.length }] });
  owner.wx.getFileSystemManager = () => ({
    readFile: (o) => o.success({ data: PNG.toString('base64') }),
  });
  const mediaPage = owner.open('pages/match-media/index', { orgId: org, matchId: finalId });
  await owner.settle(mediaPage);
  assert.equal(mediaPage.page.data.caps.upload, true, mediaPage.page.data.error);
  // Lost upload response: the server stores the file, but the API has no request identity, so
  // the page keeps the outcome unknown and only shows the new file as a candidate to check.
  owner.dropNextResponse((o) => o.method === 'POST' && /\/media-files$/.test(o.url));
  await mediaPage.page.uploadImage();
  await owner.settle(mediaPage);
  assert.ok(mediaPage.page.data.pending, mediaPage.page.data.error);
  await mediaPage.page.load();
  await owner.settle(mediaPage);
  assert.equal(mediaPage.page.data.files.length, 1, 'the page did not send it twice');
  assert.equal(mediaPage.page.data.canRetry, false);
  assert.equal(mediaPage.page.data.pending?.candidates.length, 1, 'shown for checking');
  await mediaPage.page.uploadImage();
  assert.equal(mediaPage.page.data.files.length, 1, 'no new upload while unknown');
  await mediaPage.page.confirmPending(tap({ id: mediaPage.page.data.pending.candidates[0].id }));
  assert.equal(mediaPage.page.data.pending, null);
  assert.match(mediaPage.page.data.files[0].statusLabel, /未关联、未发布/);
  assert.deepEqual(await publicMedia(), [], 'an upload alone is not public');
  mediaPage.page.titleInput(tap({}, { value: '决赛最后一攻' }));
  mediaPage.page.rightsInput(tap({}, { value: '主办方摄影组拍摄，仅限本届公开观赛' }));
  await mediaPage.page.createDraft();
  await owner.settle(mediaPage);
  assert.equal(mediaPage.page.data.items[0]?.status, 'DRAFT', mediaPage.page.data.error);
  assert.deepEqual(await publicMedia(), [], 'a draft is not public');
  owner.approve();
  await mediaPage.page.publish(tap({ id: mediaPage.page.data.items[0].id }));
  await owner.settle(mediaPage);
  assert.equal(mediaPage.page.data.items[0].status, 'PUBLISHED', mediaPage.page.data.error);
  const shown = await publicMedia();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, '决赛最后一攻');
  snapshot(mediaPage, 'match-media-published');
  owner.approve();
  await mediaPage.page.revoke(tap({ id: mediaPage.page.data.items[0].id }));
  await owner.settle(mediaPage);
  assert.equal(mediaPage.page.data.items[0].status, 'REVOKED', mediaPage.page.data.error);
  assert.deepEqual(await publicMedia(), [], 'revoked media disappears publicly');

  // C16: private preview, revoke then irreversible purge, and a manual time marker on a video
  // draft of the confirmed final. The MP4 is the API tests' own synthetic fixture.
  const fixtures = fs.readFileSync(
    new URL('../../apps/api/test/media-fixtures.ts', import.meta.url),
    'utf8',
  );
  const MP4 = Buffer.from(/syntheticMp4 = Buffer\.from\(\s*'([^']+)'/.exec(fixtures)[1], 'base64');
  const temp = new Map(),
    previewed = [];
  owner.wx.env = { USER_DATA_PATH: 'wxfile://usr' };
  owner.wx.getFileSystemManager = () => ({
    readFile: (o) =>
      o.success({ data: (/\.mp4$/.test(o.filePath) ? MP4 : PNG).toString('base64') }),
    writeFile: (o) => {
      temp.set(o.filePath, Buffer.from(o.data));
      o.success();
    },
    unlink: (o) => {
      temp.delete(o.filePath);
      o.success?.();
    },
  });
  owner.wx.previewImage = (o) => {
    previewed.push(temp.get(o.current));
    o.success();
  };
  const png = mediaPage.page.data.files[0];
  await mediaPage.page.preview(tap({ id: png.id }));
  await owner.settle(mediaPage);
  assert.ok(
    previewed[0]?.equals(PNG),
    'the private bytes were previewed: ' + mediaPage.page.data.error,
  );
  mediaPage.page.askRevokeFile(tap({ id: png.id }));
  mediaPage.page.revokeReasonInput(tap({}, { value: '误传的测试图片' }));
  owner.approve();
  await mediaPage.page.revokeFile();
  await owner.settle(mediaPage);
  assert.equal(mediaPage.page.data.files[0].status, 'REVOKED', mediaPage.page.data.error);
  assert.equal(mediaPage.page.data.files[0].canPurge, true);
  mediaPage.page.askPurgeFile(tap({ id: png.id }));
  mediaPage.page.purgeReasonInput(tap({}, { value: '按要求永久删除正文' }));
  snapshot(mediaPage, 'match-media-purge');
  owner.approve();
  await mediaPage.page.purgeFile();
  await owner.settle(mediaPage);
  assert.equal(mediaPage.page.data.files[0].status, 'PURGED', mediaPage.page.data.error);
  owner.wx.chooseMedia = (o) =>
    o.success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/final-replay.mp4', size: MP4.length }] });
  await mediaPage.page.uploadVideo();
  await owner.settle(mediaPage);
  assert.equal(mediaPage.page.data.upload.stage, 'saved', mediaPage.page.data.error);
  assert.equal(mediaPage.page.data.draftFiles[0]?.name, 'final-replay.mp4');
  mediaPage.page.titleInput(tap({}, { value: '决赛回放' }));
  mediaPage.page.rightsInput(tap({}, { value: '主办方摄影组拍摄，仅限本届公开观赛' }));
  await mediaPage.page.createDraft();
  await owner.settle(mediaPage);
  const replay = mediaPage.page.data.items.find((m) => m.title === '决赛回放');
  assert.equal(replay?.canMark, true, mediaPage.page.data.error);
  mediaPage.page.openMarker(tap({ id: replay.id }));
  mediaPage.page.markerInput(tap({ field: 'label' }, { value: '决胜一投' }));
  mediaPage.page.markerInput(tap({ field: 'start' }, { value: '0' }));
  mediaPage.page.markerInput(tap({ field: 'end' }, { value: '0.5' }));
  snapshot(mediaPage, 'match-media-marker');
  await mediaPage.page.addMarker();
  await owner.settle(mediaPage);
  const marked = mediaPage.page.data.items.find((m) => m.id === replay.id);
  assert.equal(marked.markerList.length, 1, mediaPage.page.data.error);
  owner.approve();
  await mediaPage.page.publish(tap({ id: replay.id }));
  await owner.settle(mediaPage);
  const withMarker = (await publicMedia()).find((m) => m.title === '决赛回放');
  assert.equal(withMarker?.markers.length, 1, 'the published video carries its time marker');
  assert.equal(withMarker.markers[0].label, '决胜一投');

  // Account switch clears every new page.
  owner.client.clearSession();
  for (const page of [bracket, resched, mediaPage])
    assert.match(page.page.data.error, /登录身份已变化/);
  assert.equal(bracket.page.data.event, null);
  assert.equal(resched.page.data.match, null);
  assert.equal(mediaPage.page.data.match, null);
});

test('single elimination with a bye: native first round, then the final round', async () => {
  const owner = device(server);
  await signIn(owner, 'owner@example.test');
  const event = await frozenEvent(
    '合成淘汰杯',
    'SINGLE_ELIMINATION',
    ['合成七队', '合成八队', '合成九队'],
    '05',
  ); // its own dates: both tests share one organization and court
  const schedule = await publishSchedule(owner, event);
  assert.ok(schedule.page.data.byes, 'the bye is named before publishing');
  owner.approve();
  await schedule.page.publish();
  await owner.settle(schedule);
  assert.equal(schedule.page.data.state, 'published', schedule.page.data.error);
  await nativeScoring(owner, event);
  const bracket = owner.open('pages/bracket/index', { orgId: org, eventId: event.id });
  await owner.settle(bracket);
  const first = bracket.page.data.rounds[0].slots;
  assert.ok(
    first.some((s) => s.bye && s.statusLabel === '轮空晋级'),
    bracket.page.data.error,
  );
  assert.match(bracket.page.data.rounds[1].slots[0].statusLabel, /待来源赛果/);
  assert.equal(bracket.page.data.next, null);
  const played = first.find((s) => !s.bye);
  await play(played.matchId, 'HOME');
  await bracket.page.load();
  await owner.settle(bracket);
  allocate(bracket, [['2028-05-03', '15:00']]);
  bracket.page.reasonInput(tap({}, { value: '首轮已独立确认' }));
  owner.approve();
  await bracket.page.publish();
  await owner.settle(bracket);
  assert.equal(bracket.page.data.error, '');
  assert.equal(bracket.page.data.rounds[1].published, true);
  snapshot(bracket, 'bracket-knockout');
});
