import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import sharp from 'sharp';
import { NotificationService } from '../../apps/api/dist/notification-service.js';
import {
  APP_ORIGIN,
  PASSWORD,
  device,
  frozenEventFixture,
  http,
  organizationFixture,
  publishedEventFixture,
  register,
  signIn,
  snapshot,
  startServerWith,
  tap,
} from './support.mjs';

// Actual native Page + unchanged createClient/pathAllowed -> loopback HTTP -> owned scb_test_*.
// Only organizer setup uses direct HTTP. No path, API response, authorization, or provider is stubbed.
const require = createRequire(import.meta.url);
const { pathAllowed } = require('../../apps/wechat/utils/api.js');
const requests = (d) => d.wx.calls.filter((c) => c.type === 'request');
const pathname = (c) => new URL(c.url).pathname;
function reached(d, path, method = 'GET') {
  assert.equal(
    pathAllowed(path, method),
    true,
    'native path must be allowed: ' + method + ' ' + path,
  );
  assert.ok(
    requests(d).some((c) => c.url === APP_ORIGIN + path && (c.method || 'GET') === method),
    'real wx transport must reach HTTP: ' + method + ' ' + path,
  );
}
async function forbiddenClientPath(d, path, method = 'GET') {
  assert.equal(pathAllowed(path, method), false);
  const before = requests(d).length;
  await assert.rejects(d.client.request(path, method), (e) => e.code === 'INVALID_PATH');
  assert.equal(requests(d).length, before, 'invalid path must stop before network');
}
let server, f, owner, leader, leaderId, leaderCookie, event, publicKey;
const eventName = '合成统一搜索与通知验收杯';
const sourceService = () =>
  new NotificationService(
    server.pool,
    { databaseUrl: server.pool.options.connectionString, appOrigin: APP_ORIGIN },
    { autoDispatch: false },
  );
const rows = async (sql, values = []) => (await server.pool.query(sql, values)).rows;
before(async () => {
  server = await startServerWith({
    participantDataKey: Buffer.alloc(32, 31).toString('base64'),
    backgroundWorkersEnabled: false,
    notifications: { autoDispatch: false },
    insurance: { autoDispatch: false },
    accountClosure: { enabled: true, autoDispatch: false },
    streaming: { autoDispatch: false },
  });
  f = await organizationFixture(server, '合成扩展消费者篮协');
  owner = device(server);
  leader = device(server);
  await signIn(owner, 'owner@example.test');
  await register(leader, 'expansion-leader@example.test', '合成扩展领队');
  leaderId = (await leader.client.request('/v1/auth/session')).data.user.id;
  leaderCookie = (
    await f.call('/v1/auth/login', {
      method: 'POST',
      body: { email: 'expansion-leader@example.test', password: PASSWORD },
    })
  ).cookie;
  event = await frozenEventFixture(
    f,
    { id: leaderId, cookie: leaderCookie },
    [
      { name: '合成扩展甲队', members: ['合成甲一', '合成甲二'] },
      { name: '合成扩展乙队', members: ['合成乙一', '合成乙二'] },
    ],
    eventName,
  );
  await publishedEventFixture(f, event);
  const standing = (await f.call(event.path + '/standings', { cookie: f.ownerCookie })).data;
  publicKey = (
    await f.call(event.path + '/public-viewing-commands', {
      method: 'POST',
      cookie: f.ownerCookie,
      body: { type: 'ENABLE', expectedEventVersion: standing.event.version },
    })
  ).data.publication.publicEventId;
  const directory = (await f.call(event.path + '/directory', { cookie: f.ownerCookie })).data;
  await f.call(event.path + '/directory-commands', {
    method: 'POST',
    cookie: f.ownerCookie,
    body: {
      type: 'LIST',
      expectedEventVersion: directory.event.version,
      displayCity: '合成市',
      reason: '合成最小消费者验收的主动公开目录',
    },
  });
});
after(async () => {
  await server?.close();
});

test('anonymous unified search uses current public authority, no cookie, and loses revoked sources', async () => {
  const anonymous = device(server),
    page = anonymous.open('pages/search/index', { q: eventName });
  await page.page.search();
  await anonymous.settle(page);
  assert.equal(page.page.data.error, '');
  assert.deepEqual(
    page.page.data.items.map((v) => [v.kind, v.displayName, v.publicKey]),
    [['EVENT', eventName, publicKey]],
  );
  const requestPath = '/v1/public/search?q=' + encodeURIComponent(eventName) + '&kind=ALL&limit=20';
  reached(anonymous, requestPath);
  for (const r of requests(anonymous))
    assert.equal(r.header.Cookie, undefined, 'anonymous search never sends an application session');
  assert.equal(
    JSON.stringify(page.page.data.items).includes(f.org),
    false,
    'no private IDs in search projection',
  );
  snapshot(page, 'expansion-search-current');
  await forbiddenClientPath(anonymous, requestPath + '&unexpected=1');
  await forbiddenClientPath(anonymous, requestPath, 'POST');
  const standing = (await f.call(event.path + '/standings', { cookie: f.ownerCookie })).data;
  await f.call(event.path + '/public-viewing-commands', {
    method: 'POST',
    cookie: f.ownerCookie,
    body: { type: 'DISABLE', expectedEventVersion: standing.event.version },
  });
  await page.page.search();
  await anonymous.settle(page);
  assert.deepEqual(page.page.data.items, []);
  await assert.rejects(
    anonymous.client.request('/v1/public/events/' + publicKey, 'GET', undefined, true),
    (e) => e.status === 404,
  );
  snapshot(page, 'expansion-search-revoked');
});

test('committed review hooks reach the real private inbox while WeChat stays closed and permission-free', async () => {
  const source = (
    await rows(
      "SELECT id FROM notification_source_events WHERE org_id=$1 AND resource_id=$2 AND kind='REGISTRATION_REVIEW'",
      [f.org, event.teams[0].entryId],
    )
  )[0];
  assert.ok(source, 'the actual APPROVE transaction must capture notification facts');
  const service = sourceService();
  try {
    await service.fanout(source.id);
  } finally {
    service.onModuleDestroy();
  }
  const messages = leader.open('pages/messages/index');
  await leader.settle(messages);
  assert.equal(messages.page.data.error, '');
  const message = messages.page.data.items.find(
    (v) => v.eventName === eventName && v.kind === 'REGISTRATION_REVIEW',
  );
  assert.ok(message, 'current authorized leader sees the actual review notification');
  assert.equal(message.detail, '报名审核通过');
  assert.equal(message.delivery, 'WAITING_PERMISSION');
  reached(leader, '/v1/me/notifications');
  await messages.page.read(tap({ id: message.id }));
  await leader.settle(messages);
  reached(leader, '/v1/me/notifications/' + message.id + '/read', 'POST');
  assert.ok(
    (
      await rows('SELECT read_at FROM notification_messages WHERE id=$1 AND user_id=$2', [
        message.id,
        leaderId,
      ])
    )[0].read_at,
  );
  const settings = leader.open('pages/notification-settings/index');
  await leader.settle(settings);
  reached(leader, '/v1/me/notifications/settings');
  assert.equal(settings.page.data.enabled, false);
  assert.deepEqual(settings.page.data.subscriptions, []);
  const before = requests(leader).length;
  await settings.page.prepare();
  await leader.settle(settings);
  assert.equal(
    requests(leader).length,
    before,
    'closed WeChat cannot create intents from the page',
  );
  await assert.rejects(
    leader.client.request('/v1/me/notifications/intents', 'POST', {
      clientRequestId: randomUUID(),
      kind: 'MATCH_STARTING',
    }),
    (e) => e.status === 503 && e.code === 'NOTIFICATIONS_DISABLED',
  );
  reached(leader, '/v1/me/notifications/intents', 'POST');
  assert.equal(
    (
      await rows(
        'SELECT count(*)::int AS n FROM notification_subscription_grants WHERE user_id=$1',
        [leaderId],
      )
    )[0].n,
    0,
  );
  await forbiddenClientPath(leader, '/v1/me/notifications/settings?userId=' + leaderId);
  await forbiddenClientPath(leader, '/v1/me/notifications/' + message.id + '/read', 'GET');
  const outsider = device(server);
  await register(outsider, 'expansion-outsider@example.test', '合成无关账号');
  await assert.rejects(
    outsider.client.request('/v1/me/notifications/' + message.id + '/read', 'POST', {
      clientRequestId: randomUUID(),
    }),
    (e) => e.status === 404,
  );
  snapshot(messages, 'expansion-messages-current');
  snapshot(settings, 'expansion-wechat-disabled');
});

test('free finance preview and disabled insurance keep their exact real JSON contracts', async () => {
  for (const kind of ['ENTRY_FEE', 'ENTRY_DEPOSIT']) {
    const result = await leader.client.request('/v1/trades/preview', 'POST', {
      kind,
      sourceId: event.id,
    });
    assert.deepEqual(result.data, { enabled: false });
    reached(leader, '/v1/trades/preview', 'POST');
  }
  await assert.rejects(
    leader.client.request('/v1/trades/preview', 'POST', {
      kind: 'ENTRY_FEE',
      sourceId: randomUUID(),
    }),
    (e) => e.status === 404,
  );
  const insurance = leader.open('pages/insurance/index');
  await leader.settle(insurance);
  reached(leader, '/v1/insurance');
  assert.equal(insurance.page.data.workspace.enabled, false);
  assert.deepEqual(insurance.page.data.workspace.products, []);
  assert.deepEqual(insurance.page.data.workspace.orders, []);
  assert.match(insurance.page.data.workspace.reason, /供应商尚未接入/);
  const result = await leader.client.request('/v1/insurance/capabilities');
  assert.equal(result.data.enabled, false);
  reached(leader, '/v1/insurance/capabilities');
  await forbiddenClientPath(leader, '/v1/trades/preview?sourceId=' + event.id, 'POST');
  await forbiddenClientPath(leader, '/v1/insurance?userId=' + leaderId);
  assert.equal((await rows('SELECT count(*)::int AS n FROM trade_orders'))[0].n, 0);
  assert.equal((await rows('SELECT count(*)::int AS n FROM insurance_orders'))[0].n, 0);
});

test('complete closure composition accepts and cancels the current account request through the actual page', async () => {
  const person = device(server);
  await register(person, 'expansion-closure@example.test', '合成本人注销检查');
  const me = (await person.client.request('/v1/auth/session')).data.user.id;
  const page = person.open('pages/account-closure/index');
  await person.settle(page);
  assert.equal(page.page.data.enabled, true, 'all required closure domain hooks must be composed');
  assert.equal(page.page.data.request, null);
  reached(person, '/v1/account-closure/me');
  await page.page.requestClosure();
  assert.equal(
    requests(person).some((r) => pathname(r) === '/v1/account-closure/requests'),
    false,
    'unchecked statement does not create a request',
  );
  page.page.input(tap({ field: 'password' }, { value: PASSWORD }));
  page.page.chooseDays(tap({}, { value: '1' }));
  page.page.confirmTerms(tap({}, { value: ['close'] }));
  person.approve();
  await page.page.requestClosure();
  await person.settle(page);
  assert.equal(page.page.data.request.status, 'PENDING', page.page.data.error);
  assert.equal(page.page.data.request.canCancel, true);
  assert.equal(page.page.data.request.coolingOffDays, 1);
  reached(person, '/v1/account-closure/requests', 'POST');
  const requestId = page.page.data.request.id;
  assert.deepEqual(
    (
      await rows(
        'SELECT status,cooling_off_days FROM account_closure_requests WHERE id=$1 AND user_id=$2',
        [requestId, me],
      )
    )[0],
    { status: 'PENDING', cooling_off_days: 1 },
  );
  await page.page.load();
  await person.settle(page);
  assert.equal(page.page.data.request.id, requestId);
  page.page.input(tap({ field: 'password' }, { value: PASSWORD }));
  person.approve();
  await page.page.cancelClosure();
  await person.settle(page);
  assert.equal(page.page.data.request.status, 'CANCELLED', page.page.data.error);
  reached(person, '/v1/account-closure/cancel', 'POST');
  assert.equal((await rows('SELECT status FROM users WHERE id=$1', [me]))[0].status, 'ACTIVE');
  assert.equal(
    (
      await rows('SELECT count(*)::int AS n FROM account_closure_operations WHERE actor_id=$1', [
        me,
      ])
    )[0].n,
    2,
  );
  assert.equal(
    JSON.stringify([...person.wx.storage.values()]).includes(PASSWORD),
    false,
    'passwords are not persistent recovery data',
  );
  await forbiddenClientPath(person, '/v1/account-closure/me?userId=' + me);
  await forbiddenClientPath(person, '/v1/account-closure/cancel', 'GET');
  snapshot(page, 'expansion-closure-cancelled');
});

function syntheticIdentity() {
  const first = '99000019900101091',
    weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  return (
    first + '10X98765432'[[...first].reduce((sum, n, i) => sum + Number(n) * weights[i], 0) % 11]
  );
}
test('qualification precheck requests originate only from the current subject and actual saved material', async () => {
  const subject = device(server);
  await register(subject, 'expansion-subject@example.test', '合成资格预审本人');
  const userId = (await subject.client.request('/v1/auth/session')).data.user.id;
  const team = (
    await f.call(f.root + '/teams', {
      method: 'POST',
      cookie: f.ownerCookie,
      body: { name: '合成资格预审本人队' },
    })
  ).data;
  await f.call(f.root + '/teams/' + team.id + '/grants/' + leaderId, {
    method: 'PUT',
    cookie: f.ownerCookie,
    body: { status: 'ACTIVE' },
  });
  const code = (
    await f.call(f.root + '/teams/' + team.id + '/join-codes', {
      method: 'POST',
      cookie: f.ownerCookie,
      body: { expiresInHours: 1, maxUses: 1 },
    })
  ).data;
  const join = subject.open('pages/team-join/index');
  await subject.settle(join);
  join.page.input(tap({ field: 'code' }, { value: code.code }));
  join.page.input(tap({ field: 'displayName' }, { value: '合成预审九号' }));
  subject.approve();
  await join.page.join();
  await subject.settle(join);
  const memberId = join.page.data.joined.memberId;
  const draft = (
    await f.call(f.root + '/events', {
      method: 'POST',
      cookie: f.ownerCookie,
      body: {
        name: '合成本人资格草稿杯',
        startDate: '2028-07-01',
        endDate: '2028-07-03',
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
      },
    })
  ).data;
  const eventPath = f.root + '/events/' + draft.id;
  const configured = (
    await f.call(eventPath + '/registration-rules', {
      method: 'PUT',
      cookie: f.ownerCookie,
      body: {
        expectedVersion: draft.version,
        minPlayers: 1,
        maxPlayers: 2,
        zeroAndDoubleZeroDistinct: false,
        requireIdentity: true,
        requireInsurance: true,
        requireParticipantMaterials: true,
      },
    })
  ).data;
  await f.call(eventPath + '/registration-commands', {
    method: 'POST',
    cookie: f.ownerCookie,
    body: { type: 'OPEN_REGISTRATION', expectedVersion: configured.event.version },
  });
  let entry = (await leader.client.request(eventPath + '/entries', 'POST', { teamId: team.id }))
    .data;
  const entryPath = f.root + '/entries/' + entry.id;
  entry = (
    await leader.client.request(entryPath + '/roster', 'PUT', {
      expectedVersion: entry.version,
      players: [{ memberId, jerseyNo: '9' }],
    })
  ).data;
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#6a798a' } })
    .png()
    .toBuffer();
  const material = (
    await subject.client.request(entryPath + '/participant-materials/mine', 'PUT', {
      clientRequestId: randomUUID(),
      expectedVersion: 0,
      realName: '合成参赛本人',
      identityNumber: syntheticIdentity(),
      portrait: {
        fileName: 'synthetic-precheck.png',
        contentType: 'image/png',
        base64: png.toString('base64'),
      },
      insurance: null,
      acceptedTerms: true,
      publicityConsent: false,
    })
  ).data;
  assert.equal(material.material.storedStatus, 'DRAFT');
  const base = entryPath + '/qualification-precheck';
  const page = subject.open('pages/qualification-precheck/index', {
    orgId: f.org,
    entryId: entry.id,
  });
  await subject.settle(page);
  reached(subject, base);
  assert.equal(page.page.data.error, '');
  assert.deepEqual(
    page.page.data.workspace.participants.map((p) => [p.memberId, p.canRequest]),
    [[memberId, true]],
  );
  const before = requests(subject).length;
  await page.page.request(tap({ id: memberId }));
  assert.equal(requests(subject).length, before, 'unchecked precheck cannot write');
  page.page.consent();
  await page.page.request(tap({ id: randomUUID() }));
  assert.equal(
    requests(subject).length,
    before,
    'a non-owned member is never synthesized from a tap',
  );
  await page.page.request(tap({ id: memberId }));
  await subject.settle(page);
  reached(subject, base + '/requests', 'POST');
  assert.equal(page.page.data.pending, null, page.page.data.error);
  assert.match(page.page.data.message, /预审操作已记录/);
  const own = await rows(
    'SELECT user_id,member_id FROM participant_qualification_requests WHERE org_id=$1 AND entry_id=$2',
    [f.org, entry.id],
  );
  assert.deepEqual(own, [{ user_id: userId, member_id: memberId }]);
  await assert.rejects(
    owner.client.request(base + '/requests', 'POST', {
      clientRequestId: randomUUID(),
      memberId,
      expectedMaterialVersion: material.material.version,
      acceptedTermsVersion: 'qualification-precheck-v1',
    }),
    (e) => e.status === 404,
  );
  await assert.rejects(
    subject.client.request(base + '/requests', 'POST', {
      clientRequestId: randomUUID(),
      memberId: randomUUID(),
      expectedMaterialVersion: material.material.version,
      acceptedTermsVersion: 'qualification-precheck-v1',
    }),
    (e) => e.status === 404,
  );
  await assert.rejects(leader.client.request(base), (e) => e.status === 404);
  await forbiddenClientPath(subject, base + '/requests', 'GET');
  await forbiddenClientPath(subject, base + '?userId=' + userId);
  snapshot(page, 'expansion-precheck-current-subject');
});
