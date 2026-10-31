import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import sharp from 'sharp';
import { PASSWORD, device, http, register, signIn, startServer, tap } from './support.mjs';
let server, org;
before(async () => {
  server = await startServer();
  const owner = await server.bootstrapOwner({
    email: 'x05-owner@example.test',
    password: PASSWORD,
    displayName: '合成独立办赛人',
    organizationName: '合成招募机构',
  });
  org = owner.organizationId;
});
after(async () => {
  await server?.close();
});
test('actual native recruitment/import/invite/poster pages through HTTP and owned PostgreSQL', async () => {
  const owner = device(server),
    leader = device(server),
    invitee = device(server),
    visitor = device(server);
  await signIn(owner, 'x05-owner@example.test');
  await register(leader, 'x05-leader@example.test', '合成申请领队');
  await register(invitee, 'x05-invitee@example.test', '合成本届受邀人');
  const inviteeId = (await invitee.client.request('/v1/auth/session')).data.user.id;
  const root = '/v1/orgs/' + org;
  let event = (
    await owner.client.request(root + '/events', 'POST', {
      name: '合成招募海报杯',
      startDate: '2028-06-01',
      endDate: '2028-06-03',
      timezone: 'Asia/Shanghai',
      format: 'ROUND_ROBIN',
    })
  ).data;
  const eventPath = root + '/events/' + event.id;
  await owner.client.request(eventPath + '/registration-rules', 'PUT', {
    expectedVersion: event.version,
    minPlayers: 2,
    maxPlayers: 2,
    zeroAndDoubleZeroDistinct: true,
    requireIdentity: false,
    requireInsurance: false,
  });
  event = (await owner.client.request(eventPath)).data;
  await owner.client.request(eventPath + '/registration-commands', 'POST', {
    type: 'OPEN_REGISTRATION',
    expectedVersion: event.version,
  });
  const management = owner.open('pages/recruitment/index', { orgId: org, eventId: event.id });
  await owner.settle(management);
  for (const [field, value] of Object.entries({
    title: '合成公开招募',
    description: '正式赛程发布前可独立报名；申请后仍须补齐名单并独立审核。',
    closesAt: new Date(Date.now() + 86400000).toISOString(),
    maxApplications: '32',
  }))
    management.page.input(tap({ field }, { value }));
  owner.approve();
  await management.page.publish();
  await owner.settle(management);
  assert.equal(management.page.data.pending, null, management.page.data.error);
  await management.page.load();
  await owner.settle(management);
  const publicId = management.page.data.workspace.publication.publicId,
    link = management.page.onShareAppMessage();
  assert.equal(link.path, '/pages/recruitment/index?publicId=' + publicId);
  assert.equal(link.path.includes(org), false);
  const anonymous = visitor.open('pages/recruitment/index', { publicId });
  await visitor.settle(anonymous);
  assert.equal(anonymous.page.data.public.title, '合成公开招募', anonymous.page.data.error);
  assert.equal(anonymous.page.data.loginRequired, true);
  assert.equal(JSON.stringify(anonymous.page.data.public).includes(org), false);
  const application = leader.open('pages/recruitment/index', { publicId });
  await leader.settle(application);
  application.page.input(tap({ field: 'teamName' }, { value: '合成申请青锋队' }));
  leader.dropNextResponse((o) => o.method === 'POST' && o.url.endsWith('/applications'));
  leader.approve();
  await application.page.apply();
  await leader.settle(application);
  assert.ok(application.page.data.pending, application.page.data.error);
  const applyId = application.page.data.pending.body.clientRequestId;
  leader.approve();
  await application.page.recover(tap());
  await leader.settle(application);
  assert.equal(application.page.data.pending, null, application.page.data.error);
  const original = (await leader.client.request('/v1/me/recruitment-requests/' + applyId)).data;
  assert.equal(original.result.application.teamName, '合成申请青锋队');
  await management.page.load();
  await owner.settle(management);
  const request = management.page.data.applications.find((a) => a.teamName === '合成申请青锋队');
  assert.ok(request);
  management.page.input(tap({ field: 'reason' }, { value: '独立核对合成申请' }));
  owner.approve();
  await management.page.review(tap({ id: request.id, decision: 'APPROVE' }));
  await owner.settle(management);
  await management.page.load();
  await owner.settle(management);
  assert.equal(
    management.page.data.applications.find((a) => a.id === request.id).status,
    'APPROVED',
  );
  management.page.input(
    tap({ field: 'bulk' }, { value: '合成受邀猛龙队\t\t' + inviteeId + '\n\n' }),
  );
  owner.approve();
  await management.page.preview();
  await owner.settle(management);
  assert.equal(management.page.data.preview.canCommit, false);
  assert.ok(management.page.data.preview.issues.some((i) => i.row === 2));
  management.page.input(tap({ field: 'bulk' }, { value: '合成受邀猛龙队\t\t' + inviteeId }));
  owner.approve();
  await management.page.preview();
  await owner.settle(management);
  assert.equal(management.page.data.preview.canCommit, true, management.page.data.error);
  owner.dropNextResponse((o) => o.method === 'POST' && o.url.endsWith('/team-import/commit'));
  owner.approve();
  await management.page.commit();
  await owner.settle(management);
  assert.ok(management.page.data.pending);
  const commitId = management.page.data.pending.body.clientRequestId;
  management.page.onHide();
  const resumed = owner.open('pages/recruitment/index', { orgId: org, eventId: event.id });
  await owner.settle(resumed);
  assert.equal(resumed.page.data.pending.body.clientRequestId, commitId);
  owner.approve();
  await resumed.page.recover(tap({ replay: 'yes' }));
  await owner.settle(resumed);
  assert.equal(resumed.page.data.pending, null, resumed.page.data.error);
  const invited = invitee.open('pages/recruitment/index');
  await invitee.settle(invited);
  const invitation = invited.page.data.invitations.find((i) => i.eventId === event.id);
  assert.ok(invitation, invited.page.data.error);
  invitee.approve();
  await invited.page.decide(tap({ id: invitation.id, decision: 'ACCEPT' }));
  await invitee.settle(invited);
  const context = (await invitee.client.request('/v1/auth/session')).data;
  assert.equal(context.organizations.length, 0);
  assert.ok(context.teamContexts.some((t) => t.teamId === invitation.teamId));
  const entries = (await owner.client.request(eventPath + '/entries')).data;
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.status === 'DRAFT'));
  for (const item of entries) {
    const actor = item.teamId === invitation.teamId ? invitee : leader;
    let team = (await owner.client.request(root + '/teams/' + item.teamId)).data;
    team = (
      await owner.client.request(root + '/teams/' + team.id + '/members', 'PUT', {
        expectedVersion: team.version,
        members: [{ name: '合成队员甲' }, { name: '合成队员乙' }],
      })
    ).data;
    const ep = root + '/entries/' + item.id;
    let draft = (await actor.client.request(ep)).data;
    draft = (
      await actor.client.request(ep + '/roster', 'PUT', {
        expectedVersion: draft.version,
        players: team.members.map((m, i) => ({ memberId: m.id, jerseyNo: String(i + 1) })),
      })
    ).data;
    draft = (
      await actor.client.request(ep + '/commands', 'POST', {
        type: 'SUBMIT',
        expectedVersion: draft.version,
      })
    ).data;
    await owner.client.request(ep + '/commands', 'POST', {
      type: 'APPROVE',
      expectedVersion: draft.version,
    });
  }
  let registration = (await owner.client.request(eventPath + '/registration')).data;
  for (const type of ['CLOSE_REGISTRATION', 'FREEZE_REGISTRATION'])
    registration = (
      await owner.client.request(eventPath + '/registration-commands', 'POST', {
        type,
        expectedVersion: registration.event.version,
      })
    ).data;
  await anonymous.page.load();
  await visitor.settle(anonymous);
  assert.equal(
    anonymous.page.data.public,
    null,
    'withdrawn public recruitment must clear a previously displayed snapshot',
  );
  const call = http(server),
    login = await call('/v1/auth/login', {
      method: 'POST',
      body: { email: 'x05-owner@example.test', password: PASSWORD },
    }),
    cookie = login.cookie;
  const court = (
    await call(root + '/courts', { method: 'POST', cookie, body: { name: '合成宣传球场' } })
  ).data;
  let plan = (
    await call(eventPath + '/schedule-revisions', {
      method: 'POST',
      cookie,
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
              startsAt: '2028-06-01T00:00:00+08:00',
              endsAt: '2028-06-04T02:00:00+08:00',
            },
          ],
        },
      },
    })
  ).data;
  plan = (
    await call(root + '/schedule-revisions/' + plan.id + '/allocations', {
      method: 'PUT',
      cookie,
      body: {
        expectedEventVersion: plan.eventVersion,
        expectedRevisionVersion: plan.version,
        allocations: plan.fixtures.map((f, i) => ({
          fixtureKey: f.fixtureKey,
          courtId: court.id,
          startsAt: new Date(Date.parse('2028-06-01T09:00:00+08:00') + i * 3600000).toISOString(),
        })),
      },
    })
  ).data;
  await call(root + '/schedule-revisions/' + plan.id + '/publish', {
    method: 'POST',
    cookie,
    body: { expectedEventVersion: plan.eventVersion, expectedRevisionVersion: plan.version },
  });
  event = (await owner.client.request(eventPath)).data;
  let standings = (
    await call(eventPath + '/standings-rules', {
      method: 'PUT',
      cookie,
      body: {
        expectedEventVersion: event.version,
        winPoints: 3,
        lossPoints: 0,
        drawPoints: 1,
        tiebreakers: [],
      },
    })
  ).data;
  standings = (
    await call(eventPath + '/standings-rule-commands', {
      method: 'POST',
      cookie,
      body: {
        type: 'PUBLISH_STANDINGS_RULES',
        rulesetId: standings.rules.id,
        expectedEventVersion: standings.event.version,
      },
    })
  ).data;
  await call(eventPath + '/public-viewing-commands', {
    method: 'POST',
    cookie,
    body: { type: 'ENABLE', expectedEventVersion: standings.event.version },
  });
  const posters = owner.open('pages/poster/index', { orgId: org, eventId: event.id });
  await owner.settle(posters);
  posters.page.kind(tap({}, { value: '1' }));
  posters.page.match(tap({}, { value: '0' }));
  owner.approve();
  await posters.page.generate();
  await owner.settle(posters);
  assert.equal(posters.page.data.pending, null, posters.page.data.error);
  await posters.page.load();
  await owner.settle(posters);
  assert.equal(posters.page.data.workspace.exports.length, 1, posters.page.data.error);
  const files = new Map();
  owner.wx.env = { USER_DATA_PATH: '/synthetic' };
  owner.wx.getFileSystemManager = () => ({
    writeFile: (o) => {
      files.set(o.filePath, Buffer.from(o.data));
      o.success();
    },
    unlink: (o) => {
      files.delete(o.filePath);
    },
  });
  owner.wx.saveImageToPhotosAlbum = (o) => o.success();
  owner.wx.previewImage = (o) => o.success();
  const exportId = posters.page.data.workspace.exports[0].id;
  owner.approve();
  await posters.page.image(tap({ id: exportId, save: 'yes' }));
  await owner.settle(posters);
  assert.equal(files.size, 1, posters.page.data.error);
  assert.deepEqual(
    {
      format: (await sharp([...files.values()][0]).metadata()).format,
      width: (await sharp([...files.values()][0]).metadata()).width,
    },
    { format: 'png', width: 1080 },
  );
  posters.page.reason(tap({}, { value: '合成宣传导出撤销' }));
  owner.approve();
  await posters.page.revoke(tap({ id: exportId }));
  await owner.settle(posters);
  await posters.page.image(tap({ id: exportId }));
  await owner.settle(posters);
  assert.match(posters.page.data.error, /不可读取|撤销|权限/);
  posters.page.onHide();
  assert.equal(files.size, 0);
});
