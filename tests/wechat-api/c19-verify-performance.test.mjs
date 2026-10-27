import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  device,
  finalMatchFixture,
  frozenEventFixture,
  organizationFixture,
  publishedEventFixture,
  register,
  signIn,
  startServer,
  tap,
} from './support.mjs';

// C19 F: C07 performance links through the real performance and player pages -> real API ->
// owned PostgreSQL: organizer nomination (with a lost response recovered by the original
// command), the player's own consent, refusal and revocation (by player and by organizer),
// and the public statistics disappearing after revocation. HTTP only prepares a FINAL match
// whose confirmed result attributes 5 points to one frozen roster member.
let server, f, event, match, memberId, teamA, profileId;
const pad = (v) => String(v).padStart(2, '0');
function china(ms) {
  const d = new Date(ms + 8 * 3600000);
  return {
    date: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()),
  };
}
const devices = {};

async function playerProfile(d, name) {
  const center = d.open('pages/player-center/index');
  await d.settle(center);
  assert.equal(center.page.data.authorized, true, center.page.data.error);
  center.page.edit(tap({}));
  for (const [field, value] of [
    ['displayName', name],
    ['heightCm', '182'],
    ['city', '合成高州'],
    ['bio', '合成资料，仅用于隔离联调'],
    ['price', '300.00'],
    ['travel', '0.00'],
    ['accommodation', '0.00'],
  ])
    center.page.input(tap({ field }, { value }));
  center.page.position(tap({}, { value: 0 }));
  center.page.addWindow();
  const until = china(Date.now() + 5 * 86400000);
  center.page.windowInput(tap({ field: 'startTime', index: 0 }, { value: '00:00' }));
  center.page.windowInput(tap({ field: 'endDate', index: 0 }, { value: until.date }));
  center.page.windowInput(tap({ field: 'endTime', index: 0 }, { value: '23:00' }));
  center.page.consent(tap({}, { value: ['yes'] }));
  await center.page.save();
  await d.settle(center);
  assert.equal(center.page.data.error, '');
  center.unload();
}

before(async () => {
  server = await startServer();
  f = await organizationFixture(server);
  for (const [key, email, name] of [
    ['operator', 'operator@example.test', '合成平台运营'],
    ['leader', 'leader@example.test', '合成领队'],
    ['scorer', 'scorer@example.test', '合成记分员'],
    ['player', 'player@example.test', '合成球员林越'],
    ['viewer', 'viewer@example.test', '合成观众'],
  ]) {
    devices[key] = device(server);
    await register(devices[key], email, name);
    devices[key].id = (await devices[key].client.request('/v1/auth/session')).data.user.id;
    devices[key].cookie = await f.login(email);
  }
  await server.grantOperator('operator@example.test');
  await f.call(`${f.root}/members/${devices.scorer.id}`, {
    method: 'PUT',
    cookie: f.ownerCookie,
    body: { role: 'SCORER', status: 'ACTIVE' },
  });
  await playerProfile(devices.player, '合成林越');
  // Independent platform approval of the profile (fixture via the platform page).
  await signIn(devices.operator, 'operator@example.test');
  const platform = devices.operator.open('pages/platform/index');
  await devices.operator.settle(platform);
  for (const profile of platform.page.raw.reviewQueue.slice()) {
    platform.page.review(tap({ id: profile.id }));
    platform.page.status(tap({}, { value: 0 }));
    platform.page.reason(tap({}, { value: '资料核对一致' }));
    platform.page.agree(tap({}, { value: ['yes'] }));
    await platform.page.submitReview();
    await devices.operator.settle(platform);
  }
  profileId = (await server.pool.query("SELECT id FROM booking_profiles WHERE status='APPROVED'"))
    .rows[0].id;
  event = await frozenEventFixture(f, { id: devices.leader.id, cookie: devices.leader.cookie }, [
    { name: '合成石鼓青锋', members: ['林越', '陈凯', '黄河'] },
    { name: '合成高州猛龙', members: ['周丁', '吴戊', '郑己'] },
  ]);
  teamA = event.teams[0];
  memberId = teamA.members.find((m) => m.name === '林越').id;
  [match] = await publishedEventFixture(f, event);
  const side = match.home.teamId === teamA.id ? 'HOME' : 'AWAY';
  const other = event.teams[1].members[0].id;
  await finalMatchFixture(f, match.id, devices.scorer, [
    { side, value: 2, memberId },
    { side, value: 3, memberId },
    { side: side === 'HOME' ? 'AWAY' : 'HOME', value: 1, memberId: other },
  ]);
});
after(async () => {
  await server?.close();
});

const publicStats = async () =>
  (await f.call(`/v1/player-bookings/players/${profileId}/performance`)).data;
const links = async () =>
  (
    await server.pool.query(
      'SELECT id,status,member_id,profile_id,consented_by,nominated_by FROM booking_performance_links ORDER BY created_at',
    )
  ).rows;

async function nominate(owner, page, reason) {
  const eventIndex = page.page.data.manageableEvents.findIndex((e) => e.id === event.id);
  assert.ok(eventIndex >= 0, page.page.data.error);
  await page.page.chooseEvent(tap({}, { value: String(eventIndex) }));
  await owner.settle(page);
  page.page.chooseTeam(
    tap({}, { value: page.page.data.teams.findIndex((t) => t.id === teamA.id) }),
  );
  page.page.chooseMember(
    tap({}, { value: page.page.data.members.findIndex((m) => m.id === memberId) }),
  );
  page.page.chooseProfile(
    tap({}, { value: page.page.data.profiles.findIndex((p) => p.id === profileId) }),
  );
  page.page.draftReason(tap({}, { value: reason }));
  page.page.publisherConsent(tap({}, { value: ['yes'] }));
}
async function playerCommand(d, page, linkId, type, reason) {
  await page.page.checkLink(tap({ id: linkId, type }));
  await d.settle(page);
  assert.ok(page.page.data.pending, page.page.data.error);
  page.page.dialogReason(tap({}, { value: reason }));
  if (type === 'CONSENT') page.page.playerConsent(tap({}, { value: ['yes'] }));
  await page.page.submitDialog();
  await d.settle(page);
  assert.equal(page.page.data.error, '', page.page.data.error);
}
async function playerPageStats(d) {
  const page = d.open('pages/player/index', { id: profileId });
  await d.settle(page);
  assert.ok(page.page.data.profile, page.page.data.error);
  const value = page.page.data.profile.performance;
  page.unload();
  return value;
}

test('C07: nomination, own consent, refusal and revocation; revoked statistics disappear', async () => {
  const owner = device(server);
  await signIn(owner, 'owner@example.test');
  const manage = owner.open('pages/performance/index');
  await owner.settle(manage);
  assert.equal(manage.page.data.authorized, true, manage.page.data.error);
  assert.deepEqual((await publicStats()).sourceCount, 0);

  // 1. Nomination with a lost response; the retry sends the ORIGINAL command id once.
  await nominate(owner, manage, '本届固定名单成员，申请公开有限统计');
  owner.dropNextResponse(
    (o) => o.method === 'POST' && o.url.endsWith('/v1/player-bookings/performance/links'),
  );
  await manage.page.nominate();
  await owner.settle(manage);
  assert.equal(manage.page.data.nominationUnknown, true, 'unknown result keeps the original');
  await manage.page.nominate();
  await owner.settle(manage);
  assert.equal(manage.page.data.error, '', manage.page.data.error);
  const sent = owner.wx.calls.filter(
    (c) =>
      c.type === 'request' &&
      c.method === 'POST' &&
      c.url.endsWith('/v1/player-bookings/performance/links'),
  );
  assert.equal(sent.length, 2);
  assert.equal(sent[0].data.commandId, sent[1].data.commandId, 'same command id on recovery');
  let rows = await links();
  assert.equal(rows.length, 1, 'exactly one link despite the lost response');
  assert.equal(rows[0].status, 'PENDING');
  // Pending is not public.
  assert.equal((await publicStats()).sourceCount, 0);
  assert.equal((await playerPageStats(devices.viewer)).points, '未统计');

  // 2. The player consents on their own page.
  await signIn(devices.player, 'player@example.test');
  const own = devices.player.open('pages/performance/index', { own: '1' });
  await devices.player.settle(own);
  assert.equal(own.page.data.links.length, 1, own.page.data.error);
  await playerCommand(devices.player, own, rows[0].id, 'CONSENT', '确认是本人记录，同意公开');
  rows = await links();
  assert.equal(rows[0].status, 'APPROVED');
  assert.equal(rows[0].consented_by, devices.player.id);
  let stats = await publicStats();
  assert.equal(stats.sourceCount, 1);
  assert.equal(stats.totalPoints, 5, JSON.stringify(stats));
  const shown = await playerPageStats(devices.viewer);
  assert.equal(shown.sourceCount, '1');
  assert.notEqual(shown.points, '未统计');

  // 3. The player revokes: public statistics vanish (no stale numbers, no zero-filling).
  await playerCommand(devices.player, own, rows[0].id, 'REVOKE', '不再同意公开本人统计');
  rows = await links();
  assert.equal(rows[0].status, 'REVOKED');
  stats = await publicStats();
  assert.equal(stats.sourceCount, 0);
  assert.equal(stats.totalPoints, null);
  assert.deepEqual(stats.recentRecords, []);
  const after1 = await playerPageStats(devices.viewer);
  assert.equal(after1.sourceCount, '0');
  assert.deepEqual(after1.records, []);

  // 4. A new nomination the player refuses: nothing becomes public.
  await manage.page.load(true);
  await owner.settle(manage);
  await nominate(owner, manage, '再次提名：本届固定名单成员');
  await manage.page.nominate();
  await owner.settle(manage);
  assert.equal(manage.page.data.error, '', manage.page.data.error);
  rows = await links();
  assert.equal(rows.length, 2);
  await own.page.load(true);
  await devices.player.settle(own);
  await playerCommand(devices.player, own, rows[1].id, 'REVOKE', '拒绝本次公开');
  rows = await links();
  assert.equal(rows[1].status, 'REVOKED');
  assert.equal((await publicStats()).sourceCount, 0);

  // 5. A third nomination is consented, then the organizer revokes it: data disappears.
  await manage.page.load(true);
  await owner.settle(manage);
  await nominate(owner, manage, '第三次提名：本届固定名单成员');
  await manage.page.nominate();
  await owner.settle(manage);
  rows = await links();
  await own.page.load(true);
  await devices.player.settle(own);
  await playerCommand(devices.player, own, rows[2].id, 'CONSENT', '确认本人记录同意公开');
  assert.equal((await publicStats()).totalPoints, 5);
  await manage.page.load(true);
  await owner.settle(manage);
  await playerCommand(owner, manage, rows[2].id, 'REVOKE', '主办方撤回公开授权');
  assert.equal((await links())[2].status, 'REVOKED');
  stats = await publicStats();
  assert.equal(stats.sourceCount, 0);
  assert.equal(stats.totalPoints, null);

  // 6. Isolation: a team leader (not an event manager) cannot nominate or see sources.
  await signIn(devices.leader, 'leader@example.test');
  const leaderPage = devices.leader.open('pages/performance/index');
  await devices.leader.settle(leaderPage);
  assert.deepEqual(leaderPage.page.data.manageableEvents, []);
  assert.deepEqual(leaderPage.page.data.links, []);
  const sources = await f.call(
    `/v1/player-bookings/performance/sources?orgId=${f.org}&eventId=${event.id}`,
    {
      cookie: devices.leader.cookie,
      expect: [403, 404],
    },
  );
  assert.ok([403, 404].includes(sources.status));
  // The audit trail keeps every decision.
  const audit = (
    await server.pool.query(
      "SELECT count(*)::int n FROM audit_logs WHERE resource_type ILIKE '%performance%'",
    )
  ).rows[0].n;
  assert.ok(audit >= 6, 'nominations, consents and revocations are audited: ' + audit);
  for (const p of [manage, own, leaderPage]) p.unload();
});
