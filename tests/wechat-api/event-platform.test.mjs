import assert from 'node:assert/strict';
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

// Event mainline against the real API: registration (leader) -> independent review and
// freeze (staff) -> native prepare -> native scoring with lease and lost-response recovery
// -> independent confirmation -> standings/statistics -> lifecycle -> session switch.
let server, call, org, ownerCookie, leaderCookie;
const people = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  server = await startServer();
  call = http(server);
  const owner = await server.bootstrapOwner({
    email: 'owner@example.test',
    password: PASSWORD,
    displayName: '合成负责人',
    organizationName: '合成高州篮协',
  });
  org = owner.organizationId;
  ownerCookie = (
    await call('/v1/auth/login', {
      method: 'POST',
      body: { email: 'owner@example.test', password: PASSWORD },
    })
  ).cookie;
});
after(async () => {
  await server?.close();
});

test('event mainline runs end to end through native pages on the real API', async () => {
  const root = `/v1/orgs/${org}`;
  // People: the organizer, a team leader and a scorer each use their own device.
  const ownerDevice = device(server);
  await signIn(ownerDevice, 'owner@example.test');
  const leaderDevice = device(server);
  await register(leaderDevice, 'leader@example.test', '合成领队');
  const scorerDevice = device(server);
  await register(scorerDevice, 'scorer@example.test', '合成记分员');
  for (const [key, d] of [
    ['leader', leaderDevice],
    ['scorer', scorerDevice],
  ])
    people[key] = (await d.client.request('/v1/auth/session')).data.user.id;
  leaderCookie = (
    await call('/v1/auth/login', {
      method: 'POST',
      body: { email: 'leader@example.test', password: PASSWORD },
    })
  ).cookie;
  await call(`${root}/members/${people.scorer}`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: { role: 'SCORER', status: 'ACTIVE' },
  });

  // The organizer creates the event and sets registration rules natively.
  const created = ownerDevice.open('pages/event-setup/index', { orgId: org });
  for (const [field, value] of [
    ['name', '合成青锋杯'],
    ['startDate', '2028-03-01'],
    ['endDate', '2028-03-02'],
    ['venueName', '合成体育馆'],
  ])
    created.page.field(tap({ section: 'draft', field }, { value }));
  ownerDevice.approve();
  await created.page.create();
  await ownerDevice.settle(created);
  assert.equal(created.page.data.event?.name, '合成青锋杯', created.page.data.error);
  const event = { id: created.page.eventId };
  const eventPath = `${root}/events/${event.id}`;
  assert.equal(created.page.data.registration.editable, true);
  created.page.field(tap({ section: 'registration', field: 'minPlayers' }, { value: '2' }));
  created.page.field(tap({ section: 'registration', field: 'maxPlayers' }, { value: '3' }));
  await created.page.saveRegistration();
  await ownerDevice.settle(created);
  assert.equal(created.page.data.registration.saved, true, created.page.data.error);
  snapshot(created, 'event-setup-draft');
  // Rule violations are explained before any request is sent.
  created.page.field(tap({ section: 'registration', field: 'maxPlayers' }, { value: '1' }));
  await created.page.saveRegistration();
  assert.match(created.page.data.error, /最多人数不能少于最少人数/);

  const teams = [];
  for (const name of ['合成石鼓青锋', '合成高州猛龙']) {
    let team = (
      await call(`${root}/teams`, { method: 'POST', cookie: ownerCookie, body: { name } })
    ).data;
    team = (
      await call(`${root}/teams/${team.id}/members`, {
        method: 'PUT',
        cookie: ownerCookie,
        body: {
          expectedVersion: team.version,
          members: [{ name: name + '甲' }, { name: name + '乙' }, { name: name + '丙' }],
        },
      })
    ).data;
    teams.push(team);
  }

  // Staff opens registration natively.
  const review = ownerDevice.open('pages/entry-review/index', { orgId: org, eventId: event.id });
  await ownerDevice.settle(review);
  assert.deepEqual(
    review.page.data.stages.map((s) => s.type),
    ['OPEN_REGISTRATION'],
  );
  ownerDevice.approve();
  await review.page.stage(tap({ type: 'OPEN_REGISTRATION' }));
  await ownerDevice.settle(review);
  assert.equal(review.page.data.event.status, 'REGISTRATION_OPEN', review.page.data.error);

  // Leader: accept the invitation natively, create the entry, save the roster, submit.
  const issued = (
    await call(`${root}/teams/${teams[0].id}/invitations`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { targetUserId: people.leader, expiresInHours: 1 },
    })
  ).data;
  const invitation = leaderDevice.open('pages/invitation/index', {
    id: issued.invitation.id,
    token: issued.token,
  });
  await leaderDevice.settle(invitation);
  invitation.page.consent(tap({}, { value: ['yes'] }));
  leaderDevice.approve();
  await invitation.page.accept();
  await leaderDevice.settle(invitation);
  assert.ok(invitation.page.data.accepted, invitation.page.data.error);
  const regEvents = leaderDevice.open('pages/registration-events/index', {
    orgId: org,
    teamId: teams[0].id,
  });
  await leaderDevice.settle(regEvents);
  leaderDevice.approve();
  await regEvents.page.enter(tap({ id: event.id }));
  await leaderDevice.settle(regEvents);
  const entryUrl = leaderDevice.navigations.at(-1);
  const entryId = /entryId=([0-9a-f-]{36})/.exec(entryUrl)?.[1];
  assert.ok(entryId, 'entry page opened after creating the draft: ' + entryUrl);
  const entry = leaderDevice.open('pages/entry/index', { orgId: org, entryId });
  await leaderDevice.settle(entry);
  entry.page.data.rows.forEach((row, index) => {
    entry.page.togglePlayer(tap({ index }));
    entry.page.jersey(tap({ index }, { value: String(index + 4) }));
  });
  await entry.page.saveRoster();
  await leaderDevice.settle(entry);
  assert.equal(entry.page.data.dirty, false, entry.page.data.error);
  entry.page.consent(tap({}, { value: ['yes'] }));
  leaderDevice.approve();
  await entry.page.command(tap({ type: 'SUBMIT' }));
  await leaderDevice.settle(entry);
  assert.equal(
    entry.page.data.entry?.status ?? entry.page.data.status,
    'SUBMITTED',
    entry.page.data.error,
  );

  // Second team registers through HTTP (same leader) to reach the two-team freeze minimum.
  const second = (
    await call(`${root}/teams/${teams[1].id}/invitations`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { targetUserId: people.leader, expiresInHours: 1 },
    })
  ).data;
  await call(`/v1/invitations/${second.invitation.id}/accept`, {
    method: 'POST',
    cookie: leaderCookie,
    body: { token: second.token },
  });
  let other = (
    await call(`${eventPath}/entries`, {
      method: 'POST',
      cookie: leaderCookie,
      body: { teamId: teams[1].id },
    })
  ).data;
  other = (
    await call(`${root}/entries/${other.id}/roster`, {
      method: 'PUT',
      cookie: leaderCookie,
      body: {
        expectedVersion: other.version,
        players: teams[1].members.map((m, i) => ({ memberId: m.id, jerseyNo: String(i + 10) })),
      },
    })
  ).data;
  await call(`${root}/entries/${other.id}/commands`, {
    method: 'POST',
    cookie: leaderCookie,
    body: { type: 'SUBMIT', expectedVersion: other.version },
  });

  // Independent review and freeze, natively.
  await review.page.load();
  await ownerDevice.settle(review);
  assert.equal(review.page.data.entries.filter((e) => e.status === 'SUBMITTED').length, 2);
  for (const row of review.page.data.entries) {
    await review.page.openEntry(tap({ id: row.id }));
    await ownerDevice.settle(review);
    assert.equal(review.page.data.detail.approve, true, review.page.data.error);
    ownerDevice.approve();
    await review.page.review(tap({ type: 'APPROVE' }));
    await ownerDevice.settle(review);
    assert.equal(review.page.data.error, '');
  }
  for (const type of ['CLOSE_REGISTRATION', 'FREEZE_REGISTRATION']) {
    assert.ok(
      review.page.data.stages.some((s) => s.type === type),
      type,
    );
    ownerDevice.approve();
    await review.page.stage(tap({ type }));
    await ownerDevice.settle(review);
    assert.equal(review.page.data.error, '', type);
  }
  assert.equal(review.page.data.freeze.teams, 2);
  snapshot(review, 'entry-review-frozen');

  // Native scheduling: add a court, generate the draw, propose times, validate, publish.
  const schedule = ownerDevice.open('pages/schedule/index', { orgId: org, eventId: event.id });
  await ownerDevice.settle(schedule);
  assert.equal(schedule.page.data.state, 'generate', schedule.page.data.error);
  schedule.page.courtInput(tap({}, { value: '合成一号场' }));
  await schedule.page.addCourt();
  await ownerDevice.settle(schedule);
  assert.equal(schedule.page.data.courts.length, 1, schedule.page.data.error);
  ownerDevice.approve();
  await schedule.page.generate();
  await ownerDevice.settle(schedule);
  assert.equal(schedule.page.data.state, 'draft', schedule.page.data.error);
  await schedule.page.validate();
  await ownerDevice.settle(schedule);
  assert.ok(
    schedule.page.data.conflicts.some((c) => /尚未安排/.test(c.label)),
    'unassigned draft fails validation',
  );
  await schedule.page.autoAssign();
  await ownerDevice.settle(schedule);
  assert.ok(
    schedule.page.data.fixtures.every((f) => f.assigned),
    schedule.page.data.error,
  );
  await schedule.page.validate();
  await ownerDevice.settle(schedule);
  assert.deepEqual(schedule.page.data.conflicts, []);
  snapshot(schedule, 'schedule-draft');
  ownerDevice.approve();
  await schedule.page.publish();
  await ownerDevice.settle(schedule);
  assert.equal(schedule.page.data.state, 'published', schedule.page.data.error);

  // Scoring and standings rules natively; standings are locked before public viewing.
  const setup = ownerDevice.open('pages/event-setup/index', { orgId: org, eventId: event.id });
  await ownerDevice.settle(setup);
  assert.equal(
    setup.page.data.registration.editable,
    false,
    'registration rules freeze after draft',
  );
  // A 1-second period is set natively: durations are exact seconds, never rounded to minutes.
  setup.page.field(tap({ section: 'scoring', field: 'periods' }, { value: '1' }));
  setup.page.field(tap({ section: 'scoring', field: 'minutes' }, { value: '0' }));
  setup.page.field(tap({ section: 'scoring', field: 'seconds' }, { value: '1' }));
  setup.page.toggle(tap({ section: 'scoring', field: 'overtime' }));
  await setup.page.saveScoring();
  await ownerDevice.settle(setup);
  assert.equal(setup.page.data.scoring.saved, true, setup.page.data.error);
  assert.deepEqual(
    [setup.page.data.scoring.minutes, setup.page.data.scoring.seconds],
    ['0', '1'],
    'read back exactly',
  );
  await setup.page.saveScoring();
  await ownerDevice.settle(setup);
  // Non-default comparison order chosen explicitly (胜场 first), then only the points change.
  const wins = () => setup.page.data.standings.tiebreakers.findIndex((t) => t.value === 'WINS');
  setup.page.toggle(tap({ section: 'standings', field: 'tiebreakers', index: wins() }));
  while (wins() > 0) setup.page.moveTiebreaker(tap({ index: wins() }));
  await setup.page.saveStandings();
  await ownerDevice.settle(setup);
  setup.page.field(tap({ section: 'standings', field: 'win' }, { value: '3' }));
  await setup.page.saveStandings();
  await ownerDevice.settle(setup);
  assert.equal(setup.page.data.standings.canPublish, true, setup.page.data.error);
  const saved = {
    scoring: (await call(`${eventPath}/scoring`, { cookie: ownerCookie })).data.rules,
    standings: (await call(`${eventPath}/standings`, { cookie: ownerCookie })).data.rules,
  };
  assert.equal(saved.scoring.periodDurationSeconds, 1);
  assert.equal(saved.scoring.tiePolicy, 'ALLOW_DRAW');
  assert.equal(saved.standings.winPoints, 3);
  assert.deepEqual(saved.standings.tiebreakers, ['WINS', 'SCORE_DIFFERENCE', 'POINTS_FOR']);
  assert.equal(setup.page.data.standings.orderLabel, '胜场 → 净胜分 → 总得分');
  snapshot(setup, 'event-setup-rules');
  ownerDevice.approve();
  await setup.page.publishStandings();
  await ownerDevice.settle(setup);
  assert.equal(setup.page.data.standings.locked, true, setup.page.data.error);
  const [match] = (await call(`${eventPath}/matches?limit=100`, { cookie: ownerCookie })).data;

  // Organizer: event page lists the match and opens it; prepare natively (per-player mode).
  const orgEvent = ownerDevice.open('pages/org-event/index', { orgId: org, eventId: event.id });
  await ownerDevice.settle(orgEvent);
  assert.equal(orgEvent.page.data.matches.length, 1, orgEvent.page.data.scheduleError);
  assert.equal(orgEvent.page.data.manage.review, true);
  orgEvent.page.openMatch(tap({ id: match.id }));
  assert.match(ownerDevice.navigations.at(-1), new RegExp('/pages/org-match/index\\?orgId=' + org));
  const ownerMatch = ownerDevice.open('pages/org-match/index', { orgId: org, matchId: match.id });
  await ownerDevice.settle(ownerMatch);
  // Owner assigns the scorer natively from the organization's member list.
  assert.equal(ownerMatch.page.data.caps.staff, true);
  const scorerIndex = ownerMatch.page.data.members.findIndex((m) => /合成记分员/.test(m.label));
  assert.ok(scorerIndex >= 0, ownerMatch.page.data.staffNote);
  ownerMatch.page.pickMember(tap({}, { value: scorerIndex }));
  ownerMatch.page.pickRole(tap({}, { value: 0 }));
  await ownerMatch.page.assign();
  await ownerDevice.settle(ownerMatch);
  assert.equal(ownerMatch.page.data.staff[0]?.name, '合成记分员', ownerMatch.page.data.error);
  assert.equal(ownerMatch.page.data.caps.prepare, true, ownerMatch.page.data.error);
  assert.equal(ownerMatch.page.data.caps.score, false, 'owners never score automatically');
  ownerMatch.page.setMode(tap({ mode: 'PLAYER_BASIC' }));
  ownerDevice.approve();
  ownerMatch.page.prepare();
  await ownerDevice.settle(ownerMatch);
  assert.equal(ownerMatch.page.data.match.status, 'READY', ownerMatch.page.data.error);
  snapshot(ownerMatch, 'org-match-ready');

  // Scorer: task list -> record table with lease.
  const tasks = scorerDevice.open('pages/scoring-tasks/index');
  await scorerDevice.settle(tasks);
  assert.equal(tasks.page.data.sections[0]?.key, 'ready', tasks.page.data.error);
  snapshot(tasks, 'scoring-tasks');
  const scorer = scorerDevice.open('pages/scorer/index', { orgId: org, matchId: match.id });
  await scorerDevice.settle(scorer);
  assert.equal(scorer.page.data.canControl, true, scorer.page.data.error);
  await scorer.page.acquire();
  await scorerDevice.settle(scorer);
  assert.equal(scorer.page.data.held, true, scorer.page.data.error);
  await scorer.page.renew();
  assert.equal(scorer.page.data.held, true, 'renewal keeps control');
  await scorer.page.start();
  await scorerDevice.settle(scorer);
  assert.equal(scorer.page.data.match.status, 'LIVE', scorer.page.data.error);
  assert.equal(scorer.page.data.board.playerMode, true);
  scorer.page.pickPlayer(tap({ side: 'home' }, { value: 1 }));
  await scorer.page.stat(tap({ side: 'HOME', kind: 'SCORE', value: 2 }));
  await scorerDevice.settle(scorer);
  await scorer.page.stat(tap({ side: 'AWAY', kind: 'FOUL' }));
  await scorerDevice.settle(scorer);
  assert.equal(scorer.page.data.board.home.score, 2, scorer.page.data.error);
  assert.equal(scorer.page.data.board.away.fouls, 1);
  await scorer.page.refreshHistory();
  snapshot(scorer, 'scorer-live');

  // Lost response: the server records +3 but the device never hears; recovery must use the
  // same commandId and must not count it twice.
  scorerDevice.dropNextResponse((o) => o.method === 'POST' && /\/commands$/.test(o.url));
  await scorer.page.stat(tap({ side: 'AWAY', kind: 'SCORE', value: 3 }));
  await scorerDevice.settle(scorer);
  assert.ok(scorer.page.data.pending, 'unknown result keeps the original envelope');
  snapshot(scorer, 'scorer-pending');
  await scorer.page.stat(tap({ side: 'AWAY', kind: 'SCORE', value: 1 }));
  assert.equal(scorerDevice.wx.pendingRequests, 0, 'no new write while a result is unknown');
  await scorer.page.checkPending();
  await scorerDevice.settle(scorer);
  assert.equal(scorer.page.data.pending, null, scorer.page.data.error);
  assert.equal(scorer.page.data.board.away.score, 3, 'recorded exactly once');

  // Void a wrong record with a reason; the board recomputes server-side.
  await scorer.page.refreshHistory();
  await scorerDevice.settle(scorer);
  const foul = scorer.page.data.history.find((h) => h.canVoid && /犯规/.test(h.text));
  scorer.page.askVoid(tap({ id: foul.id }));
  scorer.page.voidInput(tap({}, { value: '记错球队' }));
  await scorer.page.submitVoid();
  await scorerDevice.settle(scorer);
  assert.equal(scorer.page.data.board.away.fouls, 0, scorer.page.data.error);

  // Run the 1-second period down, pause and end; then the scorer may not confirm.
  await scorer.page.clock();
  await scorerDevice.settle(scorer);
  assert.equal(scorer.page.data.board.running, true, scorer.page.data.error);
  await sleep(1300);
  await scorer.page.clock();
  await scorerDevice.settle(scorer);
  scorerDevice.approve();
  await scorer.page.end();
  await scorerDevice.settle(scorer);
  assert.equal(scorer.page.data.match.status, 'PENDING_CONFIRMATION', scorer.page.data.error);
  const scorerView = scorerDevice.open('pages/org-match/index', { orgId: org, matchId: match.id });
  await scorerDevice.settle(scorerView);
  assert.equal(scorerView.page.data.caps.confirm, false, 'the scorer cannot confirm own match');
  scorer.unload();

  // Independent confirmation by the organizer.
  await ownerMatch.page.load();
  await ownerDevice.settle(ownerMatch);
  assert.equal(ownerMatch.page.data.caps.confirm, true, ownerMatch.page.data.error);
  ownerDevice.approve();
  const confirming = ownerMatch.page.confirmResult();
  for (let i = 0; i < 200 && !ownerMatch.page.data.busy; i++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(ownerMatch.page.data.busy, true, 'confirmation in flight');
  // A refresh tap while the command is in flight must neither cancel it nor leave busy set.
  ownerMatch.page.refresh(tap());
  await confirming;
  await ownerDevice.settle(ownerMatch);
  assert.equal(ownerMatch.page.data.busy, false);
  assert.match(ownerMatch.page.data.notice, /已完成/);
  assert.equal(ownerMatch.page.data.match.status, 'FINAL', ownerMatch.page.data.error);
  assert.equal(ownerMatch.page.data.board.final, true);
  assert.equal(ownerMatch.page.data.confirmations.length, 1);
  assert.ok(
    ownerMatch.page.data.history.some((h) => h.voided),
    'voided record stays visible',
  );
  snapshot(ownerMatch, 'org-match-final');

  // Standings and per-player statistics come only from the confirmed result.
  await orgEvent.page.load();
  await ownerDevice.settle(orgEvent);
  assert.match(orgEvent.page.data.ranking.progress, /已确认 1 \/ 1 场/);
  assert.equal(orgEvent.page.data.ranking.rows[0].teamName, ownerMatch.page.data.board.away.name);
  const scorerRow = orgEvent.page.data.stats.rows.find((r) => r.score === 2);
  assert.ok(scorerRow, 'attributed player basket appears in the statistics');
  assert.equal(orgEvent.page.data.manage.ready, true, JSON.stringify(orgEvent.page.data.manage));
  snapshot(orgEvent, 'org-event-manage');

  // Public viewing is switched on natively; spectators arrive by the shared card.
  await setup.page.load();
  await ownerDevice.settle(setup);
  assert.equal(setup.page.data.viewing.canEnable, true, setup.page.data.error);
  ownerDevice.approve();
  await setup.page.viewing(tap({ type: 'ENABLE' }));
  await ownerDevice.settle(setup);
  assert.equal(setup.page.data.viewing.active, true, setup.page.data.error);
  snapshot(setup, 'event-setup-viewing');
  await orgEvent.page.load();
  await ownerDevice.settle(orgEvent);
  const publicEventId = orgEvent.page.data.publicEventId;
  assert.match(publicEventId, /^[A-Za-z0-9_-]{43}$/);

  // C18: enabling public viewing never lists; the organizer lists explicitly with a reason.
  await setup.page.load();
  await ownerDevice.settle(setup);
  assert.equal(setup.page.data.directory.listed, false, setup.page.data.error);
  assert.equal(setup.page.data.directory.canList, true);
  const browser = device(server);
  const directoryTab = browser.open('pages/watch/index');
  await browser.settle(directoryTab);
  assert.equal(directoryTab.page.data.dir.loaded, true, directoryTab.page.data.dir.error);
  assert.deepEqual(directoryTab.page.data.dir.items, [], 'not listed by enabling viewing');
  setup.page.directoryCityInput(tap({}, { value: ' 高州 ' }));
  setup.page.directoryReasonInput(tap({}, { value: '赛程已发布，欢迎观众关注' }));
  ownerDevice.approve();
  await setup.page.listDirectory();
  await ownerDevice.settle(setup);
  assert.equal(setup.page.data.directory.listed, true, setup.page.data.error);
  assert.equal(setup.page.data.directory.city, '高州');
  assert.equal(setup.page.data.directory.group, '进行中');
  snapshot(setup, 'event-setup-directory-listed');
  // An anonymous viewer finds it under 进行中, filtered by city, and opens the existing page.
  // C20: a manual choice is shared by the existing directory and the public homepage.
  directoryTab.page.onHide();
  const cityPicker = browser.open('pages/city-select/index');
  cityPicker.page.inputCity(tap({}, { value: ' 高州 ' }));
  cityPicker.page.apply();
  directoryTab.page.onShow();
  await browser.settle(directoryTab);
  assert.deepEqual(
    directoryTab.page.data.dir.items.map((e) => [e.publicEventId, e.name, e.displayCity]),
    [[publicEventId, '合成青锋杯', '高州']],
    directoryTab.page.data.dir.error,
  );
  snapshot(directoryTab, 'watch-directory');
  const discoveryHome = browser.open('pages/home/index');
  await browser.settle(discoveryHome);
  assert.equal(discoveryHome.page.data.citySelection.city, '高州');
  assert.deepEqual(
    discoveryHome.page.data.publicEvents.map((e) => e.publicEventId),
    [publicEventId],
    discoveryHome.page.data.publicError,
  );
  snapshot(discoveryHome, 'home-city-discovery');
  cityPicker.page.inputCity(tap({}, { value: '合成未覆盖城市' }));
  cityPicker.page.apply();
  directoryTab.page.onShow();
  await browser.settle(directoryTab);
  assert.equal(directoryTab.page.data.dir.city, '合成未覆盖城市');
  assert.equal(directoryTab.page.data.dir.loaded, true, directoryTab.page.data.dir.error);
  assert.deepEqual(directoryTab.page.data.dir.items, []);
  directoryTab.page.clearDirCity();
  await browser.settle(directoryTab);
  assert.equal(directoryTab.page.data.dir.city, '');
  assert.deepEqual(
    directoryTab.page.data.dir.items.map((e) => e.publicEventId),
    [publicEventId],
  );
  directoryTab.page.openDirectory(tap({ id: publicEventId }));
  assert.equal(browser.navigations.at(-1), '/pages/event/index?event=' + publicEventId);
  const found = browser.open('pages/event/index', { event: publicEventId });
  await browser.settle(found);
  assert.equal(found.page.data.event?.name, '合成青锋杯', found.page.data.error);
  // Unlisting removes it from the directory only; the share link keeps working.
  setup.page.directoryReasonInput(tap({}, { value: '赛事信息需更新后再列入' }));
  ownerDevice.approve();
  await setup.page.unlistDirectory();
  await ownerDevice.settle(setup);
  assert.equal(setup.page.data.directory.listed, false, setup.page.data.error);
  assert.match(setup.page.data.directory.lastNote, /已手动撤出/);
  directoryTab.page.onShow();
  await browser.settle(directoryTab);
  assert.equal(directoryTab.page.data.dir.loaded, true, directoryTab.page.data.dir.error);
  assert.deepEqual(directoryTab.page.data.dir.items, [], 'refresh removes the unlisted event');
  discoveryHome.page.onShow();
  await browser.settle(discoveryHome);
  assert.equal(discoveryHome.page.data.publicLoaded, true, discoveryHome.page.data.publicError);
  assert.equal(discoveryHome.page.data.citySelection.city, '');
  assert.deepEqual(discoveryHome.page.data.publicEvents, [], 'homepage refresh also honors UNLIST');
  await found.page.load();
  await browser.settle(found);
  assert.equal(found.page.data.event?.name, '合成青锋杯', 'share link still valid after UNLIST');
  assert.equal(
    browser.wx.calls.some((c) => c.type === 'request' && c.url.includes('/v1/orgs/')),
    false,
    'the anonymous directory viewer never calls private endpoints',
  );
  assert.equal(
    browser.wx.calls.some(
      (c) =>
        c.type === 'request' &&
        c.url.includes('/v1/public/directory') &&
        Object.keys(c.header || {}).some((k) => k.toLowerCase() === 'cookie'),
    ),
    false,
  );

  const spectator = device(server);
  const shared = spectator.open('pages/event/index', { event: publicEventId });
  await spectator.settle(shared);
  assert.equal(shared.page.data.event?.name, '合成青锋杯', shared.page.data.error);
  assert.equal(shared.page.onShareAppMessage().path, '/pages/event/index?event=' + publicEventId);
  assert.equal(shared.page.data.matches[0].resultLabel, '赛果已独立确认');
  const watch = spectator.open('pages/watch/index');
  await spectator.settle(watch);
  assert.deepEqual(
    watch.page.data.recentEvents.map((e) => e.publicEventId),
    [publicEventId],
  );
  snapshot(watch, 'watch-recent');
  snapshot(shared, 'public-event');
  assert.equal(
    spectator.wx.calls.some((c) => c.type === 'request' && c.url.includes('/v1/orgs/')),
    false,
    'a signed-out spectator never calls private endpoints',
  );

  // Lifecycle: complete natively with a reason. LIST/UNLIST bumped the event version, so the
  // organizer page re-reads first (a stale version is never sent).
  await orgEvent.page.load();
  await ownerDevice.settle(orgEvent);
  orgEvent.page.chooseLifecycle(tap({ type: 'COMPLETE' }));
  orgEvent.page.lifecycleInput(tap({}, { value: '全部比赛已独立确认' }));
  ownerDevice.approve();
  await orgEvent.page.runLifecycle();
  await ownerDevice.settle(orgEvent);
  assert.equal(orgEvent.page.data.event.status, 'COMPLETED', orgEvent.page.data.error);
  // Completing revokes the live public identity: the shared page clears and is forgotten.
  await shared.page.load();
  await spectator.settle(shared);
  assert.equal(shared.page.data.event, null);
  assert.equal(shared.page.data.unavailable, true);
  const media = spectator.open('pages/media/index');
  assert.deepEqual(media.page.data.recentEvents, []);

  // Signing out clears every private page immediately.
  const account = ownerDevice.open('pages/account/index');
  await ownerDevice.settle(account);
  snapshot(account, 'account-hub');
  ownerDevice.approve();
  account.page.logout();
  await ownerDevice.settle(account);
  assert.equal(ownerMatch.page.data.match, null);
  assert.equal(orgEvent.page.data.event, null);
  assert.equal(review.page.data.event, null);
});
