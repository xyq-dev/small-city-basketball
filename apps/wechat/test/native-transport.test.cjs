const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createClient, pathAllowed } = require('../utils/api');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const c = '33333333-3333-4333-8333-333333333333';
const cookieA = 'a'.repeat(43),
  cookieB = 'b'.repeat(43);
const envelope = (data) => ({ data, meta: { requestId: 'explicit-native-fixture' } });
const session = (id) => ({
  user: { id, email: 'synthetic@example.test', displayName: '合成账号' },
  organizations: [],
  teamContexts: [],
});
const response = (data, cookie) => ({
  statusCode: 200,
  data: envelope(data),
  header: cookie ? { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' } : {},
});

function controlled() {
  const calls = [];
  const client = createClient({
    request(options) {
      calls.push(options);
    },
  });
  return { client, calls };
}

test('native allowlist distinguishes exact routes, verbs, UUIDs and query contracts', () => {
  for (const [url, method] of [
    ['/v1/auth/session', 'GET'],
    ['/v1/auth/login', 'POST'],
    ['/v1/player-bookings/workspace', 'GET'],
    ['/v1/player-bookings/profile', 'PUT'],
    ['/v1/player-bookings/orders/' + a + '/commands', 'POST'],
    ['/v1/player-bookings/players/performance?ids=' + encodeURIComponent(a + ',' + b), 'GET'],
    ['/v1/player-bookings/performance/sources?orgId=' + a + '&eventId=' + b, 'GET'],
    ['/v1/orgs/' + a + '/teams/' + b + '/members', 'PUT'],
    ['/v1/orgs/' + a + '/entries/' + b + '/media-files/' + c + '/content', 'GET'],
  ])
    assert.equal(pathAllowed(url, method), true, method + ' ' + url);
  for (const [url, method] of [
    ['/v1/auth/session', 'POST'],
    ['/v1/auth/login', 'GET'],
    ['/v1/player-bookings/profile', 'GET'],
    ['/v1/player-bookings/workspace?orgId=' + a, 'GET'],
    ['/v1/player-bookings/players/performance?ids=' + a + ',' + a, 'GET'],
    ['/v1/player-bookings/players/performance?ids=' + a + '&ids=' + b, 'GET'],
    ['/v1/player-bookings/performance/workspace?cursor=%ZZ', 'GET'],
    ['/v1/player-bookings/performance/sources?orgId=' + a, 'GET'],
    ['/v1/orgs/' + a + '/teams/' + b + '/grants/' + c, 'PUT'],
    ['/v1/player-bookings/orders/' + a + '/../workspace', 'GET'],
    ['https://elsewhere.example/v1/auth/session', 'GET'],
    ['/v1/auth/session#secret', 'GET'],
  ])
    assert.equal(pathAllowed(url, method), false, method + ' ' + url);
});

test('anonymous performance requests omit cookies and ignore public Set-Cookie plus 401', async () => {
  const { client, calls } = controlled();
  const login = client.request('/v1/auth/login', 'POST', {});
  calls[0].success(response(session(a), cookieA));
  await login;
  const revision = client.sessionRevision();
  const stats = client.requestPublic('/v1/player-bookings/players/' + a + '/performance');
  assert.equal(calls[1].header.Cookie, undefined);
  calls[1].success({
    statusCode: 401,
    header: { 'set-cookie': 'scb.sid=' + cookieB },
    data: { error: { code: 'PUBLIC_UNAVAILABLE' } },
  });
  await assert.rejects(stats, (error) => error.status === 401);
  assert.equal(client.hasSession(), true);
  assert.equal(client.viewerId(), a);
  assert.equal(client.sessionRevision(), revision);
  const read = client.request('/v1/auth/session');
  assert.equal(calls[2].header.Cookie, 'scb.sid=' + cookieA);
  calls[2].success(response(session(a)));
  await read;
  await assert.rejects(
    client.requestPublic('/v1/auth/session'),
    (error) => error.code === 'INVALID_PATH',
  );
  assert.equal(calls.length, 3);
});

test('late older login cannot replace a newer account or its cookie', async () => {
  const { client, calls } = controlled();
  const first = client.request('/v1/auth/login', 'POST', {});
  const second = client.request('/v1/auth/login', 'POST', {});
  const rejected = assert.rejects(first, (error) => error.code === 'SESSION_CHANGED');
  calls[1].success(response(session(b), cookieB));
  await second;
  const revision = client.sessionRevision();
  calls[0].success(response(session(a), cookieA));
  await rejected;
  assert.equal(client.viewerId(), b);
  assert.equal(client.sessionRevision(), revision);
  const read = client.request('/v1/auth/session');
  assert.equal(calls[2].header.Cookie, 'scb.sid=' + cookieB);
  calls[2].success(response(session(b)));
  await read;
});

test('late private 401 from a previous account cannot clear the current account', async () => {
  const { client, calls } = controlled();
  const loginA = client.request('/v1/auth/login', 'POST', {});
  calls[0].success(response(session(a), cookieA));
  await loginA;
  const old = client.request('/v1/player-bookings/workspace');
  const rejected = assert.rejects(old, (error) => error.code === 'SESSION_CHANGED');
  client.clearSession();
  const loginB = client.request('/v1/auth/login', 'POST', {});
  calls[2].success(response(session(b), cookieB));
  await loginB;
  const revision = client.sessionRevision();
  calls[1].success({ statusCode: 401, data: { error: { code: 'OLD_SESSION' } } });
  await rejected;
  assert.equal(client.sessionRevision(), revision);
  assert.equal(client.hasSession(), true);
  assert.equal(client.viewerId(), b);
});

test('private download has finite paths, ignores cookie changes and drops bytes after identity changes', async () => {
  const { client, calls } = controlled();
  const loginA = client.request('/v1/auth/login', 'POST', {});
  calls[0].success(response(session(a), cookieA));
  await loginA;
  const file = '/v1/orgs/' + a + '/entries/' + b + '/media-files/' + c + '/content';
  const download = client.download(file);
  assert.equal(calls[1].responseType, 'arraybuffer');
  const rejected = assert.rejects(download, (error) => error.code === 'SESSION_CHANGED');
  client.clearSession();
  const loginB = client.request('/v1/auth/login', 'POST', {});
  calls[2].success(response(session(b), cookieB));
  await loginB;
  calls[1].success({
    statusCode: 200,
    data: new Uint8Array([1, 2]).buffer,
    header: { 'Content-Type': 'image/png', 'Set-Cookie': 'scb.sid=' + cookieA },
  });
  await rejected;
  assert.equal(client.viewerId(), b);
  const good = client.download(file);
  calls[3].success({
    statusCode: 200,
    data: new Uint8Array([1, 2]).buffer,
    header: { 'Content-Type': 'application/pdf', 'Set-Cookie': 'scb.sid=' + cookieA },
  });
  assert.equal((await good).contentType, 'application/pdf');
  const read = client.request('/v1/auth/session');
  assert.equal(calls[4].header.Cookie, 'scb.sid=' + cookieB);
  calls[4].success(response(session(b)));
  await read;
  await assert.rejects(
    client.download('https://elsewhere.example/file'),
    (error) => error.code === 'INVALID_PATH',
  );
});

test('native error envelope preserves the exact terminal create receipt marker', async () => {
  const { client, calls } = controlled();
  const pending = client.request('/v1/player-bookings/orders', 'POST', {});
  calls[0].success({
    statusCode: 409,
    data: {
      error: {
        code: 'BOOKING_TIME_CONFLICT',
        message: '冲突',
        details: { bookingCreateOutcome: 'REJECTED', commandId: a },
      },
    },
  });
  await assert.rejects(
    pending,
    (error) =>
      error.status === 409 &&
      error.details.bookingCreateOutcome === 'REJECTED' &&
      error.details.commandId === a,
  );
});

test('shared UI tokens invalidate in-flight views and clear displayed private state on account change', async () => {
  const wx = createWx({ request: () => response(session(a), cookieA) });
  // Hosted on a page that uses the shared default reset (home/events pages supply their own).
  const h = loadPage({ root, route: 'pages/teams/index', wx });
  const ui = h.requireLocal('utils/ui.js');
  const api = h.requireLocal('utils/api.js');
  assert.equal((await ui.session(h.page, '/pages/players/index')).user.id, a);
  const token = ui.begin(h.page);
  h.page.setData({ newName: 'private-value' });
  assert.equal(ui.live(h.page, token), true);
  api.getClient().clearSession();
  assert.equal(ui.live(h.page, token), false);
  assert.equal(h.page.data.newName, '');
  assert.equal(h.page.data.loginRequired, true);
  const next = ui.begin(h.page);
  ui.close(h.page);
  assert.equal(ui.live(h.page, next), false);
});

test('shared dates stay in Beijing time and reject overflow dates independently of device timezone', () => {
  const h = loadPage({ root, route: 'pages/home/index' });
  const ui = h.requireLocal('utils/ui.js');
  assert.equal(ui.datePart('2026-10-24T23:30:00Z'), '2026-10-25');
  assert.equal(ui.timePart('2026-10-24T23:30:00Z'), '07:30');
  assert.equal(ui.chinaStamp('2026-10-24', '19:30'), '2026-10-24T11:30:00.000Z');
  for (const [date, time] of [
    ['2026-02-30', '19:30'],
    ['2026-10-24', '24:01'],
    ['2026-1-4', '9:30'],
  ])
    assert.throws(() => ui.chinaStamp(date, time));
});

test('secure command IDs fail closed when native randomness is missing or malformed', async () => {
  const wx = createWx();
  delete wx.getRandomValues;
  const h = loadPage({ root, route: 'pages/home/index', wx });
  const ui = h.requireLocal('utils/ui.js');
  await assert.rejects(ui.uuid(), /安全随机数/);
  wx.getRandomValues = ({ success }) => success({ randomValues: new Uint8Array(8).buffer });
  await assert.rejects(ui.uuid(), /安全随机数/);
  wx.getRandomValues = ({ success }) =>
    success({ randomValues: new Uint8Array(16).fill(255).buffer });
  assert.match(
    await ui.uuid(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test('booking workspace rejects money that cannot have occurred while payments are unavailable', async () => {
  const base = {
    viewerUserId: a,
    isPlatformOperator: false,
    paymentAvailable: false,
    paymentNotice: '未开放',
    settings: { feeBps: 1000, version: 1 },
    players: [],
    ownProfile: null,
    reviewQueue: [],
    teams: [],
    events: [],
    matches: [],
    ordersHasMore: false,
    statistics: {
      orders: 1,
      completedAppearances: 0,
      quotedPlatformFeeFen: 0,
      collectedPlatformFeeFen: 0,
      settledPlayerFen: 0,
    },
    orders: [
      {
        id: a,
        orgId: a,
        teamId: a,
        teamName: '合成队',
        buyerUserId: a,
        eventName: '合成赛事',
        eligibilityStatus: 'DECLARED_NOT_VERIFIED',
        eligibilityNotice: '未核验',
        scope: 'SINGLE',
        status: 'ACTIVE',
        version: 1,
        feeBps: 1000,
        settingsVersion: 1,
        createdAt: '2026-10-24T00:00:00Z',
        appearances: [],
        totals: {
          confirmedServiceFen: 0,
          confirmedPlatformFeeFen: 0,
          confirmedTravelFen: 0,
          confirmedAccommodationFen: 0,
          confirmedTotalFen: 0,
          conditionalTotalFen: 0,
          paidFen: 0,
          settledFen: 0,
          refundedFen: 0,
        },
      },
    ],
  };
  let current = base;
  const wx = createWx({
    request: (options) => response(options.url.endsWith('/session') ? session(a) : current),
  });
  const h = loadPage({ root, route: 'pages/home/index', wx });
  await h.requireLocal('utils/api.js').getClient().request('/v1/auth/session');
  const sdk = h.requireLocal('utils/booking.js');
  assert.equal((await sdk.workspace()).orders[0].totals.paidFen, 0);
  for (const key of ['paidFen', 'settledFen', 'refundedFen']) {
    current = structuredClone(base);
    current.orders[0].totals[key] = 1;
    await assert.rejects(sdk.workspace(), (error) => error.code === 'INVALID_RESPONSE', key);
  }
  for (const key of ['collectedPlatformFeeFen', 'settledPlayerFen']) {
    current = structuredClone(base);
    current.statistics[key] = 1;
    await assert.rejects(sdk.workspace(), (error) => error.code === 'INVALID_RESPONSE', key);
  }
});
