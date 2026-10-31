const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const orgId = '11111111-1111-4111-8111-111111111111';
const matchId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const leaseId = '44444444-4444-4444-8444-444444444444';
const base = '/v1/orgs/' + orgId + '/matches/' + matchId;
const ok = (data) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-hidden-scorer', nextCursor: null } },
  header: { 'set-cookie': 'scb.sid=' + 'a'.repeat(43) + '; Path=/; Secure; HttpOnly' },
});
const snapshot = {
  version: 5,
  status: 'LIVE',
  home: { teamName: '合成主队' },
  away: { teamName: '合成客队' },
  totals: {
    home: { score: 2, fouls: 0, timeouts: 0 },
    away: { score: 0, fouls: 0, timeouts: 0 },
  },
  periods: [],
  rules: { regulationPeriods: 4, allowedScoreValues: [1, 2, 3] },
  clock: { period: 1, remainingMs: 600000, running: false },
  serverTime: '2026-10-31T10:00:00.000Z',
  collected: { playerStatistics: false },
};
async function open() {
  const state = {
    holdLease: false,
    holdCommand: false,
    leases: [],
    commands: [],
    offline: [],
    modal: null,
  };
  const wx = createWx({
    request(options) {
      const url = options.url.replace(/^https:\/\/[^/]+/, '');
      if (url === '/v1/auth/session')
        return ok({ user: { id: actorId }, organizations: [], teamContexts: [] });
      if (url === base + '/scoring')
        return ok({
          event: { name: '合成赛事', status: 'RUNNING', version: 1 },
          match: { ...snapshot },
          snapshot,
          capabilities: { canAcquireControl: true },
          playerRoster: { home: [], away: [] },
          lease: null,
        });
      if (url.includes('/scoring-events?')) return ok([]);
      if (url === base + '/scorekeeper-lease' && options.method === 'POST') {
        const reply = () => ok({ leaseId, clientInstanceId: leaseId, fencingToken: '1' });
        return state.holdLease
          ? new Promise((resolve) => state.leases.push(() => resolve(reply())))
          : reply();
      }
      if (url === base + '/commands' && options.method === 'POST') {
        const reply = () => ok({ snapshot: { ...snapshot, version: 6 } });
        return state.holdCommand
          ? new Promise((resolve) => state.commands.push(() => resolve(reply())))
          : reply();
      }
      if (url.startsWith(base + '/commands/')) return ok({ snapshot: { ...snapshot, version: 6 } });
      if (url.startsWith(base + '/offline-intents/'))
        return { statusCode: 404, data: { error: { code: 'OFFLINE_INTENT_NOT_FOUND' } } };
      if (url === base + '/offline-intents')
        return new Promise((resolve) =>
          state.offline.push(() =>
            resolve(
              ok({
                intentId: options.data.intent.intentId,
                receipt: { commandId: options.data.intent.intentId, appliedVersion: 6 },
                snapshot: { ...snapshot, version: 6 },
              }),
            ),
          ),
        );
      if (url.includes('/scorekeeper-lease')) return ok({});
      return { statusCode: 404, data: { error: { code: 'TEST_UNHANDLED', message: url } } };
    },
  });
  wx.showModal = (value) => {
    state.modal = value;
  };
  const h = loadPage({ root, route: 'pages/scorer/index', wx });
  await h.requireLocal('utils/api.js').getClient().request('/v1/auth/session');
  h.page.onLoad({ orgId, matchId });
  await h.flush();
  const sent = (suffix, method = 'POST') =>
    wx.calls.filter(
      (c) => c.type === 'request' && c.method === method && c.url.endsWith(base + suffix),
    );
  return { ...h, state, sent };
}
const ticks = async () => {
  for (let i = 0; i < 12; i++) await new Promise(setImmediate);
};

test('navigating away from scorer stops lease renewal and control, without waiting for unload', async () => {
  const h = await open();
  await h.page.acquire();
  assert.equal(h.page.data.held, true);
  h.wx.navigateTo({ url: '/pages/scoring-tasks/index' });
  h.page.onHide?.();
  for (const callback of [...h.intervals.values()]) await callback();
  await h.flush();
  assert.equal(h.sent('/scorekeeper-lease/renew').length, 0, 'hidden page must not renew');
  assert.equal(h.page.data.held, false);
  assert.equal(h.sent('/scorekeeper-lease', 'DELETE').length, 1);
});

test('hidden scorer discards a late acquire reply and never restarts its timer or control', async () => {
  const h = await open();
  h.state.holdLease = true;
  const acquiring = h.page.acquire();
  await ticks();
  assert.equal(h.state.leases.length, 1);
  h.page.onHide();
  h.page.onShow();
  await ticks();
  h.state.leases.shift()();
  await acquiring;
  await h.flush();
  assert.equal(h.page.data.held, false);
  assert.equal(h.page._control || null, null);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.sent('/scorekeeper-lease').length, 1, 'returning does not acquire automatically');
});

test('hiding during secure random wait cancels acquire and confirmed commands before sending', async () => {
  const h = await open();
  const random = h.wx.getRandomValues;
  let answer;
  h.wx.getRandomValues = (options) => {
    answer = () => random(options);
  };
  const acquiring = h.page.acquire();
  await ticks();
  h.page.onHide();
  answer();
  await acquiring;
  assert.equal(h.sent('/scorekeeper-lease').length, 0);
  h.wx.getRandomValues = random;
  h.page.onShow();
  await h.flush();
  await h.page.acquire();
  const ending = h.page.end();
  await ticks();
  assert.ok(h.state.modal);
  h.page.onHide();
  h.state.modal.success({ confirm: true });
  await ending;
  await h.flush();
  assert.equal(h.sent('/commands').length, 0);
});

test('unknown command survives hide and return unchanged; late success does not silently resolve or replay it', async () => {
  const h = await open();
  await h.page.acquire();
  h.state.holdCommand = true;
  const writing = h.page.command('RECORD_STAT', { kind: 'SCORE', side: 'HOME', value: 2 }, '得分');
  await ticks();
  assert.equal(h.state.commands.length, 1);
  const original = structuredClone(h.sent('/commands')[0].data);
  h.page.onHide();
  assert.deepEqual(structuredClone(h.page.data.pending.body), original);
  assert.equal(
    h.sent('/scorekeeper-lease', 'DELETE').length,
    0,
    'unknown acceptance lets lease expire',
  );
  h.page.onShow();
  await ticks();
  assert.equal(h.sent('/commands').length, 1, 'returning never replays');
  assert.equal(h.sent('/scorekeeper-lease').length, 1, 'returning never reacquires');
  h.state.commands.shift()();
  await writing;
  await h.flush();
  assert.deepEqual(structuredClone(h.page.data.pending.body), original);
  assert.equal(h.page.data.held, false);
  assert.equal(h.intervals.size, 0);
  await h.page.checkPending();
  assert.equal(h.page.data.pending, null, 'only explicit receipt check clears unknown operation');
  assert.equal(h.sent('/commands').length, 1);
});

test('offline originals survive hide/return and an in-flight import acknowledgement', async () => {
  const h = await open();
  await h.page.acquire();
  h.page.toggleOffline();
  await h.page.command('RECORD_STAT', { kind: 'SCORE', side: 'HOME', value: 2 }, '得分');
  const stored = structuredClone([...h.wx.storage.entries()]);
  const syncing = h.page.syncOffline();
  await ticks();
  h.state.modal.success({ confirm: true });
  await ticks();
  assert.equal(
    h.state.offline.length,
    1,
    JSON.stringify({ error: h.page.data.error, items: h.page.data.offlineItems }),
  );
  h.page.onHide();
  assert.equal(h.sent('/scorekeeper-lease', 'DELETE').length, 0);
  h.page.onShow();
  await ticks();
  assert.deepEqual(structuredClone([...h.wx.storage.entries()]), stored);
  assert.equal(h.page.data.offlineItems.length, 1);
  assert.equal(h.sent('/offline-intents').length, 1, 'returning never imports automatically');
  h.state.offline.shift()();
  await syncing;
  await h.flush();
  assert.deepEqual(
    structuredClone([...h.wx.storage.entries()]),
    stored,
    'late ACK retains original for receipt recovery',
  );
  assert.equal(h.page.data.offlineItems.length, 1);
  assert.equal(h.page.data.held, false);
  assert.equal(h.intervals.size, 0);
});

test('session reset removes an in-flight private envelope before a subsequent hide', async () => {
  const h = await open();
  await h.page.acquire();
  h.state.holdCommand = true;
  const writing = h.page.command('RECORD_STAT', { kind: 'SCORE', side: 'HOME', value: 2 }, '得分');
  await ticks();
  h.requireLocal('utils/api.js').getClient().clearSession();
  h.page.onHide();
  assert.equal(h.page.data.pending, null);
  assert.equal(h.page._inflightCommand, null);
  h.state.commands.shift()();
  await writing;
  assert.equal(h.page.data.pending, null);
  assert.equal(h.page.data.held, false);
});
