const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const scope = { actorId: id(1), orgId: id(2), matchId: id(3) };
function setup(storage = new Map()) {
  const wx = createWx({ storage });
  const h = loadPage({ root, route: 'pages/scorer/index', wx });
  return { ...h, store: h.requireLocal('utils/scoring-offline.js'), wx };
}
const payload = { side: 'HOME', kind: 'SCORE', value: 2 };
test('durable drafts survive reload, preserve original IDs/version chain and exclude all lease/session secrets', async () => {
  const a = setup();
  await a.store.append(a.wx, scope, 'RECORD_STAT', payload, 8);
  const q = await a.store.append(a.wx, scope, 'RECORD_STAT', payload, 999);
  const b = setup(a.wx.storage),
    restored = b.store.read(b.wx, scope);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), JSON.parse(JSON.stringify(q)));
  assert.deepEqual(
    Array.from(restored.items, (i) => i.command.expectedVersion),
    [8, 9],
  );
  assert.equal(restored.items[1].previousIntentId, restored.items[0].intentId);
  const persisted = JSON.stringify([...a.wx.storage.values()]);
  for (const secret of ['control', 'leaseId', 'fencingToken', 'cookie', 'session'])
    assert.equal(persisted.includes(secret), false);
  assert.equal(b.store.read(b.wx, { ...scope, actorId: id(99) }), null);
});
test('lost reply recovers original permanent receipt; renewed lease never changes original logical operation', async () => {
  const h = setup();
  await h.store.append(h.wx, scope, 'RECORD_STAT', payload, 8);
  const original = h.store.read(h.wx, scope).items[0];
  let accepted = null,
    posts = 0;
  const client = {
    async request(path, method, body) {
      if (method !== 'POST') {
        if (!accepted) throw { code: 'OFFLINE_INTENT_NOT_FOUND' };
        return { data: accepted };
      }
      posts++;
      accepted = {
        intentId: body.intent.intentId,
        receipt: { commandId: body.intent.intentId, appliedVersion: 9 },
        snapshot: { version: 9 },
      };
      throw { code: 'NETWORK_ERROR' };
    },
  };
  await assert.rejects(() =>
    h.store.sync(h.wx, scope, client, '/match', { leaseId: id(7) }, () => true),
  );
  assert.equal(h.store.read(h.wx, scope).items[0].intentId, original.intentId);
  const result = await h.store.sync(h.wx, scope, client, '/match', { leaseId: id(8) }, () => true);
  assert.equal(result.accepted, 1);
  assert.equal(posts, 1);
  assert.equal(h.store.read(h.wx, scope).items.length, 0);
});
test('partial acceptance removes only acknowledged entries; version conflict preserves original remainder and stops', async () => {
  const h = setup();
  await h.store.append(h.wx, scope, 'RECORD_STAT', payload, 8);
  await h.store.append(h.wx, scope, 'RECORD_STAT', payload, 8);
  const q = h.store.read(h.wx, scope);
  let posts = 0;
  const client = {
    async request(path, method, body) {
      if (method !== 'POST') throw { code: 'OFFLINE_INTENT_NOT_FOUND' };
      posts++;
      if (posts === 2) throw { status: 409, code: 'VERSION_CONFLICT' };
      return {
        data: {
          intentId: body.intent.intentId,
          receipt: { commandId: body.intent.intentId, appliedVersion: 9 },
          snapshot: { version: 9 },
        },
      };
    },
  };
  await assert.rejects(() => h.store.sync(h.wx, scope, client, '/match', {}, () => true));
  const remainder = h.store.read(h.wx, scope).items;
  assert.equal(remainder.length, 1);
  assert.equal(remainder[0].intentId, q.items[1].intentId);
  assert.equal(remainder[0].command.expectedVersion, 9);
  assert.equal(posts, 2);
});
test('storage failure, account change and malformed queue fail closed without fabricated saved or accepted entries', async () => {
  const h = setup();
  h.wx.setStorageSync = () => {
    throw Error('磁盘不可写');
  };
  await assert.rejects(() => h.store.append(h.wx, scope, 'RECORD_STAT', payload, 8));
  assert.equal(h.wx.storage.size, 0);
  const b = setup();
  await b.store.append(b.wx, scope, 'RECORD_STAT', payload, 8);
  let called = 0;
  await assert.rejects(() =>
    b.store.sync(
      b.wx,
      scope,
      {
        request() {
          called++;
        },
      },
      '/match',
      {},
      () => false,
    ),
  );
  assert.equal(called, 0);
  assert.equal(b.store.read(b.wx, scope).items.length, 1);
  const corrupt = b.store.read(b.wx, scope);
  corrupt.items[0].command.control = { leaseId: id(4) };
  b.wx.storage.set(b.store.key(scope), corrupt);
  assert.throws(() => b.store.read(b.wx, scope));
  await assert.rejects(() => b.store.append(b.wx, scope, 'CLOCK_START', {}, 8));
});
test('explicit draft mode saves statistics without changing authoritative score and resets display on account change', async () => {
  const h = setup();
  h.page._viewer = scope.actorId;
  h.page.orgId = scope.orgId;
  h.page.matchId = scope.matchId;
  h.page._snapshot = { version: 8 };
  h.page._matchVersion = 8;
  h.page.setData({ canControl: true, board: { home: { score: 4 } }, match: { status: 'LIVE' } });
  h.page.toggleOffline();
  await h.page.command('RECORD_STAT', payload, '得分');
  assert.equal(h.page.data.offlineItems.length, 1);
  assert.equal(h.page.data.board.home.score, 4);
  assert.match(h.page.data.notice, /尚未同步/);
  h.page.onSessionReset();
  assert.equal(h.page.data.offlineItems.length, 0);
  assert.equal(h.page.data.offlineDraft, false);
  assert.equal(h.store.read(h.wx, scope).items.length, 1);
});

test('private season coverage explicitly removes administrative games from statistical denominator', () => {
  const h = setup(),
    model = h.requireLocal('utils/seasons.js');
  const rows = model.coverageRows({
    events: [
      {
        eventId: id(4),
        name: '合成赛事',
        state: 'INCLUDED',
        totalMatchCount: 3,
        recordableMatchCount: 2,
        includedMatchCount: 2,
        teamOnlyConfirmedMatchCount: 0,
        pendingMatchCount: 0,
        excludedAdministrativeMatchCount: 1,
      },
    ],
  });
  assert.match(rows[0].text, /逐人确认 2 \/ 2/);
  assert.match(rows[0].text, /行政裁定.*排除 1 场，不记出场/);
});

test('partial synchronization exposes each verified server snapshot even when a later item conflicts', async () => {
  const h = setup();
  await h.store.append(h.wx, scope, 'RECORD_STAT', payload, 8);
  await h.store.append(h.wx, scope, 'RECORD_STAT', payload, 8);
  let posts = 0;
  const snapshots = [];
  const client = {
    async request(path, method, body) {
      if (method !== 'POST') throw { code: 'OFFLINE_INTENT_NOT_FOUND' };
      if (++posts === 2) throw { status: 409, code: 'VERSION_CONFLICT' };
      return {
        data: {
          intentId: body.intent.intentId,
          receipt: { commandId: body.intent.intentId, appliedVersion: 9 },
          snapshot: { version: 9, knownScore: 2 },
        },
      };
    },
  };
  await assert.rejects(() =>
    h.store.sync(
      h.wx,
      scope,
      client,
      '/match',
      {},
      () => true,
      (result) => snapshots.push(result.snapshot),
    ),
  );
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].knownScore, 2);
  assert.equal(h.store.read(h.wx, scope).items.length, 1);
});
test('deleting or exporting a draft handles local failures without claiming success or losing the queue', async () => {
  const h = setup(),
    answers = [true, true];
  h.wx.showModal = (options) =>
    queueMicrotask(() => options.success({ confirm: answers.shift(), cancel: false }));
  h.page._viewer = scope.actorId;
  h.page.orgId = scope.orgId;
  h.page.matchId = scope.matchId;
  await h.store.append(h.wx, scope, 'RECORD_STAT', payload, 8);
  h.page.refreshOffline();
  h.wx.removeStorageSync = () => {
    throw Error('磁盘不可写');
  };
  await h.page.discardOffline();
  assert.match(h.page.data.error, /不可写/);
  assert.equal(h.store.read(h.wx, scope).items.length, 1);
  assert.doesNotMatch(h.page.data.notice, /已删除/);
  h.wx.setClipboardData = (options) => options.fail({ message: '复制失败' });
  await h.page.exportOffline();
  assert.match(h.page.data.error, /复制失败/);
  assert.equal(h.store.read(h.wx, scope).items.length, 1);
  assert.doesNotMatch(h.page.data.notice, /已复制/);
});

test('concurrent draft appends cannot overwrite another original operation', async () => {
  const h = setup();
  await Promise.all([
    h.store.append(h.wx, scope, 'RECORD_STAT', payload, 8),
    h.store.append(h.wx, scope, 'RECORD_STAT', { side: 'HOME', kind: 'FOUL', value: 1 }, 8),
  ]);
  const queue = h.store.read(h.wx, scope);
  assert.equal(queue.items.length, 2);
  assert.deepEqual(
    Array.from(queue.items, (item) => item.ordinal),
    [1, 2],
  );
  assert.equal(new Set(queue.items.map((item) => item.intentId)).size, 2);
});

test('an append during a pending receipt stays queued outside the explicitly confirmed sync prefix', async () => {
  const h = setup();
  await h.store.append(h.wx, scope, 'RECORD_STAT', payload, 8);
  let started, resume;
  const posting = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  const requests = [];
  const client = {
    async request(path, method, body) {
      if (method !== 'POST') throw { code: 'OFFLINE_INTENT_NOT_FOUND' };
      requests.push(body.intent);
      started();
      await gate;
      return {
        data: {
          intentId: body.intent.intentId,
          receipt: {
            commandId: body.intent.intentId,
            appliedVersion: body.intent.command.expectedVersion + 1,
          },
          snapshot: { version: body.intent.command.expectedVersion + 1 },
        },
      };
    },
  };
  const syncing = h.store.sync(h.wx, scope, client, '/match', {}, () => true);
  await posting;
  const appended = await h.store.append(
    h.wx,
    scope,
    'RECORD_STAT',
    { side: 'AWAY', kind: 'SCORE', value: 3 },
    8,
  );
  const tailId = appended.items[1].intentId;
  resume();
  const result = await syncing;
  assert.equal(result.accepted, 1);
  assert.equal(requests.length, 1);
  const remaining = h.store.read(h.wx, scope).items;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].intentId, tailId);
  assert.equal(remaining[0].command.expectedVersion, 9);
});

test('a replaced queue during a pending acceptance is preserved and cannot be silently imported', async () => {
  const h = setup();
  const original = await h.store.append(h.wx, scope, 'RECORD_STAT', payload, 8);
  let started, resume;
  const posting = new Promise((resolve) => {
      started = resolve;
    }),
    gate = new Promise((resolve) => {
      resume = resolve;
    });
  const client = {
    async request(path, method, body) {
      if (method !== 'POST') throw { code: 'OFFLINE_INTENT_NOT_FOUND' };
      started();
      await gate;
      return {
        data: {
          intentId: body.intent.intentId,
          receipt: { commandId: body.intent.intentId, appliedVersion: 9 },
          snapshot: { version: 9 },
        },
      };
    },
  };
  const syncing = h.store.sync(h.wx, scope, client, '/match', {}, () => true);
  await posting;
  h.store.discard(h.wx, scope);
  const replacement = await h.store.append(
    h.wx,
    scope,
    'RECORD_STAT',
    { side: 'AWAY', kind: 'SCORE', value: 3 },
    9,
  );
  resume();
  await assert.rejects(syncing, (error) => error.code === 'OFFLINE_QUEUE_CHANGED');
  const current = h.store.read(h.wx, scope);
  assert.notEqual(current.queueId, original.queueId);
  assert.equal(current.queueId, replacement.queueId);
  assert.equal(current.items[0].intentId, replacement.items[0].intentId);
  assert.equal(current.items.length, 1);
});
