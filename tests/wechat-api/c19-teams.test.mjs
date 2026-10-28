import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PASSWORD, device, register, signIn, snapshot, startServer, tap } from './support.mjs';

// C19 team request -> approval -> join code -> join -> leader view -> removal, driven through
// the real mini program pages against the real API on loopback and an owned isolated database.
// Fixtures only bootstrap the organization owner; every business step is a page interaction.
let server, org;
before(async () => {
  server = await startServer();
  const owner = await server.bootstrapOwner({
    email: 'c19-owner@example.test',
    password: PASSWORD,
    displayName: '合成负责人',
    organizationName: '合成茂名篮协',
  });
  org = owner.organizationId;
});
after(async () => {
  await server?.close();
});
const rows = async (sql, params) => (await server.pool.query(sql, params)).rows;

test('team request, approval, join code, join, leader view and removal through native pages', async () => {
  // 1. The organization admin issues a share link on the review page.
  const admin = device(server);
  await signIn(admin, 'c19-owner@example.test');
  const review = admin.open('pages/team-requests/index', { orgId: org });
  await admin.settle(review);
  assert.equal(review.page.data.allowed, true, review.page.data.error);
  review.page.input(tap({ field: 'linkReason' }, { value: '合成春季联赛新队' }));
  admin.approve();
  await review.page.createLink();
  await admin.settle(review);
  const issued = review.page.data.issued;
  assert.ok(issued, review.page.data.error);
  const token = /token=([A-Za-z0-9_-]{22})$/.exec(issued.path)[1];
  snapshot(review, 'c19-team-requests-link');

  // 2. The applicant opens the shared path, submits, and the first reply is lost.
  const applicant = device(server);
  await register(applicant, 'c19-applicant@example.test', '合成申请人');
  const apply = applicant.open('pages/team-request/index', { token });
  await applicant.settle(apply);
  assert.equal(apply.page.data.link?.orgName, '合成茂名篮协', apply.page.data.error);
  apply.page.input(tap({ field: 'teamName' }, { value: '合成青锋' }));
  applicant.dropNextResponse((o) => o.method === 'POST' && o.url.endsWith('/v1/team-requests'));
  applicant.approve();
  await apply.page.submit();
  await applicant.settle(apply);
  assert.equal(apply.page.data.uncertain, true);
  assert.ok(apply.page.data.pending);
  const [stored] = await rows('SELECT id,client_request_id FROM team_requests');
  assert.equal(stored.client_request_id, apply.page.data.pending.clientRequestId);
  applicant.approve();
  await apply.page.recover();
  await applicant.settle(apply);
  assert.equal(apply.page.data.pending, null, apply.page.data.error);
  assert.deepEqual(
    apply.page.data.requests.map((r) => [r.id, r.status]),
    [[stored.id, 'PENDING']],
  );
  assert.equal((await rows('SELECT count(*)::int AS n FROM team_requests'))[0].n, 1);
  assert.equal((await rows('SELECT use_count FROM team_request_links'))[0].use_count, 1);

  // 3. The admin approves on the review page.
  review.page.refresh();
  await admin.settle(review);
  assert.equal(review.page.data.requests[0].requesterDisplayName, '合成申请人');
  assert.equal(JSON.stringify(review.page.data.requests).includes('@example.test'), false);
  review.page.select(tap({ id: stored.id }));
  review.page.input(tap({ field: 'reviewReason' }, { value: '资料核对无误' }));
  admin.approve();
  await review.page.review(tap({ decision: 'APPROVE' }));
  await admin.settle(review);
  assert.equal(review.page.data.requests[0].status, 'APPROVED', review.page.data.error);
  const teamId = review.page.data.requests[0].teamId;

  // 4. The applicant now manages exactly this team and issues a join code on the team page.
  apply.page.refresh();
  await applicant.settle(apply);
  assert.equal(apply.page.data.requests[0].teamId, teamId);
  const session = (await applicant.client.request('/v1/auth/session')).data;
  assert.deepEqual(
    session.teamContexts.map((c) => c.teamId),
    [teamId],
  );
  assert.deepEqual(session.organizations, []);
  apply.page.openTeam(tap({ id: stored.id }));
  assert.equal(applicant.navigations.at(-1), `/pages/team/index?orgId=${org}&teamId=${teamId}`);
  const team = applicant.open('pages/team/index', { orgId: org, teamId });
  await applicant.settle(team);
  assert.equal(team.page.data.team?.name, '合成青锋', team.page.data.error);
  assert.ok(team.page.data.roster, team.page.data.playersError);
  applicant.approve();
  await team.page.issueJoinCode();
  await applicant.settle(team);
  const code = team.page.data.issuedCode;
  assert.match(code, /^([A-Z2-7]{4} ){6}[A-Z2-7]{2}$/, team.page.data.error);

  // 5. A player joins with the code on the join page.
  const player = device(server);
  await register(player, 'c19-player@example.test', '合成球员账号');
  const joinPage = player.open('pages/team-join/index', {});
  await player.settle(joinPage);
  joinPage.page.input(tap({ field: 'code' }, { value: code.toLowerCase() }));
  joinPage.page.input(tap({ field: 'displayName' }, { value: '合成七号' }));
  player.approve();
  await joinPage.page.join();
  await player.settle(joinPage);
  assert.equal(joinPage.page.data.joined?.teamName, '合成青锋', joinPage.page.data.error);
  const playerId = (await player.client.request('/v1/auth/session')).data.user.id;
  // The player binding is not a management grant and not a session team context.
  assert.equal(
    (
      await rows('SELECT count(*)::int AS n FROM team_access_grants WHERE user_id=$1', [playerId])
    )[0].n,
    0,
  );
  assert.deepEqual((await player.client.request('/v1/auth/session')).data.teamContexts, []);
  const memberships = player.open('pages/memberships/index', {});
  await player.settle(memberships);
  assert.deepEqual(
    memberships.page.data.items.map((m) => [m.teamName, m.memberName, m.status]),
    [['合成青锋', '合成七号', 'ACTIVE']],
  );

  // 6. The leader sees the member name, account display name and status only.
  team.page.refresh();
  await applicant.settle(team);
  const binding = team.page.data.roster.bindings[0];
  assert.deepEqual(
    [binding.memberName, binding.accountDisplayName, binding.status],
    ['合成七号', '合成球员账号', 'ACTIVE'],
  );
  assert.equal(JSON.stringify(team.page.data.roster).includes('c19-player@example.test'), false);
  assert.equal(JSON.stringify(team.page.data.roster).includes(playerId), false);
  snapshot(team, 'c19-team-players');

  // 7. The leader removes the player.
  team.page.playerField(tap({ field: 'removeReason' }, { value: '本人申请离队' }));
  applicant.approve();
  await team.page.removeBinding(tap({ id: binding.bindingId }));
  await applicant.settle(team);
  assert.equal(team.page.data.roster.bindings[0].status, 'ENDED', team.page.data.error);
  const [ended] = await rows(
    'SELECT b.status,b.ended_reason,m.status AS member_status FROM team_member_bindings b JOIN team_members m ON m.id=b.member_id WHERE b.id=$1',
    [binding.bindingId],
  );
  assert.deepEqual(ended, { status: 'ENDED', ended_reason: 'REMOVED', member_status: 'ARCHIVED' });

  // 8. The removed player cannot rejoin with the old code.
  joinPage.page.input(tap({ field: 'code' }, { value: code }));
  player.approve();
  await joinPage.page.join();
  await player.settle(joinPage);
  assert.match(joinPage.page.data.error, /上次离队之前/);
  assert.equal(joinPage.page.data.uncertain, false);
  assert.equal(
    (
      await rows(
        "SELECT count(*)::int AS n FROM team_member_bindings WHERE user_id=$1 AND status='ACTIVE'",
        [playerId],
      )
    )[0].n,
    0,
  );
  memberships.page.refresh();
  await player.settle(memberships);
  assert.equal(memberships.page.data.items[0].stateText, '已被移除');
});
