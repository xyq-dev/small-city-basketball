import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import sharp from 'sharp';
import { PASSWORD, device, http, register, signIn, startServer, tap } from './support.mjs';

// Actual Page/utils -> loopback API -> owned PostgreSQL. A generated test-only encryption key
// and obviously synthetic identity region are never production credentials or person data.
let server, org;
const syntheticIdentity = () => {
  const first = '99999920000101001';
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  return first + '10X98765432'[weights.reduce((sum, w, i) => sum + Number(first[i]) * w, 0) % 11];
};
before(async () => {
  server = await startServer({ participantDataKey: randomBytes(32).toString('base64') });
  const owner = await server.bootstrapOwner({
    email: 'c23-owner@example.test',
    password: PASSWORD,
    displayName: '合成独立审核人',
    organizationName: '合成篮球机构',
  });
  org = owner.organizationId;
});
after(async () => {
  await server?.close();
});

test('C23 native private draft, response recovery, photos, external policy and independent review', async () => {
  const owner = device(server),
    leader = device(server),
    player = device(server);
  // Client failures are normally plain transport objects. Give a forbidden test path a
  // stage/method/path stack without logging private request bodies or response payloads.
  for (const [stage, d] of [
    ['owner', owner],
    ['leader', leader],
    ['player', player],
  ]) {
    const request = d.client.request;
    d.client.request = async (path, method = 'GET', ...args) => {
      try {
        return await request(path, method, ...args);
      } catch (error) {
        if (error?.code !== 'INVALID_PATH') throw error;
        throw new Error(`C23 ${stage} ${method} ${path}: forbidden native-client test path`, {
          cause: error,
        });
      }
    };
  }
  await signIn(owner, 'c23-owner@example.test');
  await register(leader, 'c23-leader@example.test', '合成领队');
  await register(player, 'c23-player@example.test', '合成本人');
  const leaderId = (await leader.client.request('/v1/auth/session')).data.user.id;
  const root = '/v1/orgs/' + org;
  const team = (await owner.client.request(root + '/teams', 'POST', { name: '合成青锋本人资料队' }))
    .data;
  // Team-grant administration is Web-only. Bootstrap it through the existing isolated
  // HTTP fixture transport; adding this permission to the native allowlist is unnecessary.
  const call = http(server);
  const fixtureLogin = await call('/v1/auth/login', {
    method: 'POST',
    body: { email: 'c23-owner@example.test', password: PASSWORD },
  });
  await call(root + '/teams/' + team.id + '/grants/' + leaderId, {
    method: 'PUT',
    cookie: fixtureLogin.cookie,
    body: { status: 'ACTIVE' },
  });
  const issued = (
    await leader.client.request(root + '/teams/' + team.id + '/join-codes', 'POST', {})
  ).data;
  const join = player.open('pages/team-join/index');
  await player.settle(join);
  join.page.input(tap({ field: 'code' }, { value: issued.code }));
  join.page.input(tap({ field: 'displayName' }, { value: '合成本届七号' }));
  player.approve();
  await join.page.join();
  await player.settle(join);
  assert.ok(join.page.data.joined, join.page.data.error);
  const member = join.page.data.joined.memberId;

  let event = (
    await owner.client.request(root + '/events', 'POST', {
      name: '合成照片保险杯',
      startDate: '2028-06-01',
      endDate: '2028-06-03',
      timezone: 'Asia/Shanghai',
      format: 'ROUND_ROBIN',
    })
  ).data;
  const eventPath = root + '/events/' + event.id;
  await owner.client.request(eventPath + '/registration-rules', 'PUT', {
    expectedVersion: event.version,
    minPlayers: 1,
    maxPlayers: 3,
    zeroAndDoubleZeroDistinct: true,
    requireIdentity: true,
    requireInsurance: true,
    requireParticipantMaterials: true,
  });
  event = (await owner.client.request(eventPath)).data;
  await owner.client.request(eventPath + '/registration-commands', 'POST', {
    type: 'OPEN_REGISTRATION',
    expectedVersion: event.version,
  });
  let entry = (await leader.client.request(eventPath + '/entries', 'POST', { teamId: team.id }))
    .data;
  const entryPath = root + '/entries/' + entry.id;
  entry = (
    await leader.client.request(entryPath + '/roster', 'PUT', {
      expectedVersion: entry.version,
      players: [{ memberId: member, jerseyNo: '7' }],
    })
  ).data;
  assert.equal(entry.capabilities.canSubmit, false);

  const discovery = player.open('pages/participant-materials/index');
  await player.settle(discovery);
  assert.equal(discovery.page.data.entries.length, 1, discovery.page.data.error);
  discovery.page.openEntry(tap({ id: entry.id, org }));
  assert.ok(player.navigations.at(-1).includes('participant-materials'));
  const mine = player.openNavigated();
  await player.settle(mine);
  assert.equal(mine.page.data.workspace.material, null, mine.page.data.error);
  const identity = syntheticIdentity();
  mine.page.field(tap({ field: 'realName' }, { value: '合成参赛本人' }));
  mine.page.field(tap({ field: 'identityNumber' }, { value: identity }));
  await mine.page.save();
  await player.settle(mine);
  assert.ok(mine.page.data.material.identityMasked, mine.page.data.error);
  assert.equal(mine.page.data.form.identityNumber, '');
  assert.equal(mine.page.data.material.portrait, null);
  assert.equal(mine.page.data.workspace.capabilities.canSubmit, false);
  assert.equal(JSON.stringify(mine.page.data.workspace).includes(identity), false);

  // A legal, incomplete insurance draft must remain reloadable after a lost response.
  mine.page.field(tap({ field: 'insurer' }, { value: '合成保险服务方' }));
  player.dropNextResponse(
    (o) => o.method === 'PUT' && o.url.endsWith('/participant-materials/mine'),
  );
  await mine.page.saveInsurance();
  await player.settle(mine);
  assert.equal(mine.page.data.pending, true);
  await mine.page.load();
  await player.settle(mine);
  assert.equal(mine.page.data.pending, false, mine.page.data.error);
  assert.equal(mine.page.data.material.insurance.insurer, '合成保险服务方');
  assert.equal(mine.page.data.material.insurance.policyNumberMasked, null);

  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#607d9a' } })
    .png()
    .toBuffer();
  player.wx.chooseMedia = (o) =>
    o.success({ tempFiles: [{ tempFilePath: '/synthetic-portrait.png', size: png.length }] });
  player.wx.chooseMessageFile = (o) =>
    o.success({
      tempFiles: [
        { path: '/synthetic-policy.png', name: 'synthetic-policy.png', size: png.length },
      ],
    });
  player.wx.getFileSystemManager = () => ({
    readFile: (o) => o.success({ data: png.toString('base64') }),
  });
  player.approve();
  await mine.page.upload(tap({ kind: 'portrait' }));
  await player.settle(mine);
  assert.equal(mine.page.data.material.portrait.contentType, 'image/jpeg', mine.page.data.error);
  assert.equal(mine.page.data.form.publicityConsent, false);
  mine.page.field(tap({ field: 'policyNumber' }, { value: 'SYNTHETIC-C23-POLICY' }));
  mine.page.field(tap({ field: 'startDate' }, { value: '2028-06-01' }));
  mine.page.field(tap({ field: 'endDate' }, { value: '2028-06-03' }));
  player.approve();
  await mine.page.upload(tap({ kind: 'insurance' }));
  await player.settle(mine);
  assert.ok(mine.page.data.material.insurance.document, mine.page.data.error);
  assert.equal(mine.page.data.form.policyNumber, '');
  mine.page.checkbox(tap({ field: 'acceptedTerms' }, { value: ['yes'] }));
  // Declining the independent publicity choice must never prevent participation.
  mine.page.checkbox(tap({ field: 'publicityConsent' }, { value: [] }));
  await mine.page.save();
  await player.settle(mine);
  assert.equal(
    mine.page.data.workspace.capabilities.canSubmit,
    true,
    mine.page.data.material.blockerText,
  );
  player.approve();
  await mine.page.command(tap({ action: 'submit' }));
  await player.settle(mine);
  assert.equal(mine.page.data.material.status, 'SUBMITTED', mine.page.data.error);

  const progress = leader.open('pages/participant-materials/index', {
    orgId: org,
    entryId: entry.id,
    mode: 'review',
  });
  await leader.settle(progress);
  assert.equal(progress.page.data.members[0].status, 'SUBMITTED', progress.page.data.error);
  for (const field of ['realName', 'identityMasked', 'portrait', 'insurance'])
    assert.equal(progress.page.data.members[0][field], null);
  assert.equal(progress.page.data.members[0].capabilities.canReadPrivate, false);
  await assert.rejects(
    leader.client.request(entryPath + '/participant-materials/' + member + '/private'),
    (e) => [403, 404].includes(e.status),
  );

  const reviewer = owner.open('pages/participant-materials/index', {
    orgId: org,
    entryId: entry.id,
    mode: 'review',
  });
  await owner.settle(reviewer);
  await reviewer.page.openMember(tap({ id: member }));
  await owner.settle(reviewer);
  assert.equal(reviewer.page.data.material.capabilities.canReview, true, reviewer.page.data.error);
  owner.approve();
  await reviewer.page.revealPrivate();
  await owner.settle(reviewer);
  assert.equal(reviewer.page.data.privateDetails.identityNumber, identity);
  reviewer.page.concealPrivate();
  for (const field of ['identityChecked', 'portraitChecked', 'insuranceChecked'])
    reviewer.page.checkbox(tap({ field }, { value: ['yes'] }));
  reviewer.page.reasonInput(tap({}, { value: '合成资料照片与外部保障均已人工核对' }));
  owner.approve();
  await reviewer.page.review(tap({ decision: 'APPROVE' }));
  await owner.settle(reviewer);
  assert.equal(reviewer.page.data.members[0].status, 'APPROVED', reviewer.page.data.error);
  await mine.page.load();
  await player.settle(mine);
  assert.equal(mine.page.data.material.status, 'APPROVED');
  assert.equal(mine.page.data.material.publicityConsent, false);

  entry = (await leader.client.request(entryPath)).data;
  assert.equal(entry.capabilities.canSubmit, true);
  entry = (
    await leader.client.request(entryPath + '/commands', 'POST', {
      type: 'SUBMIT',
      expectedVersion: entry.version,
    })
  ).data;
  entry = (
    await owner.client.request(entryPath + '/commands', 'POST', {
      type: 'APPROVE',
      expectedVersion: entry.version,
    })
  ).data;
  assert.equal(entry.status, 'APPROVED');
  // Roster changes require a fresh participant confirmation and review; nothing is auto-filled.
  entry = (
    await owner.client.request(entryPath + '/commands', 'POST', {
      type: 'REQUEST_CHANGES',
      expectedVersion: entry.version,
      reason: '合成号码调整重新核对',
    })
  ).data;
  await leader.client.request(entryPath + '/roster', 'PUT', {
    expectedVersion: entry.version,
    players: [{ memberId: member, jerseyNo: '8' }],
  });
  await mine.page.load();
  await player.settle(mine);
  assert.equal(mine.page.data.material.status, 'STALE');
  assert.equal(mine.page.data.form.acceptedTerms, false);
  assert.equal(mine.page.data.workspace.capabilities.canSubmit, false);
  const revisions = (
    await server.pool.query('SELECT payload_ciphertext FROM participant_material_revisions')
  ).rows;
  assert.ok(revisions.length >= 5);
  assert.equal(
    revisions.some((r) => r.payload_ciphertext.includes(identity)),
    false,
  );
  assert.equal(
    revisions.some((r) => r.payload_ciphertext.includes('SYNTHETIC-C23-POLICY')),
    false,
  );
  for (const stored of player.wx.calls.filter((c) => c.type === 'setStorageSync'))
    assert.equal(JSON.stringify(stored.value).includes(identity), false);
  mine.page.onHide();
  assert.equal(mine.page.data.privateDetails, null);
});
