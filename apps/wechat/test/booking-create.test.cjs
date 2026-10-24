const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const form = require('../utils/booking-form');
const recovery = require('../utils/booking-recovery');
const commonUi = require('../utils/ui');
const ids = {
  actor: '10000000-0000-4000-8000-000000000001',
  other: '10000000-0000-4000-8000-000000000002',
  org: '20000000-0000-4000-8000-000000000001',
  team: '30000000-0000-4000-8000-000000000001',
  player: '40000000-0000-4000-8000-000000000001',
  second: '40000000-0000-4000-8000-000000000002',
  order: '50000000-0000-4000-8000-000000000001',
  command: '60000000-0000-4000-8000-000000000001',
  event: '70000000-0000-4000-8000-000000000001',
  match: '80000000-0000-4000-8000-000000000001',
};
const clone = (value) => JSON.parse(JSON.stringify(value));
function workspace(actor = ids.actor) {
  return {
    viewerUserId: actor,
    settings: { version: 2, feeBps: 1000 },
    teams: [{ id: ids.team, orgId: ids.org, name: '合成球队' }],
    events: [{ id: ids.event, orgId: ids.org, name: '合成赛事', status: 'PUBLISHED' }],
    players: [
      {
        id: ids.player,
        userId: ids.other,
        displayName: '合成甲',
        position: 'PG',
        status: 'APPROVED',
        priceFen: 30000,
        travelFen: 0,
        accommodationFen: 0,
        version: 3,
      },
      {
        id: ids.second,
        userId: '10000000-0000-4000-8000-000000000003',
        displayName: '合成乙',
        position: 'PG',
        status: 'APPROVED',
        priceFen: 30000,
        travelFen: 8000,
        accommodationFen: 0,
        version: 4,
      },
    ],
    matches: [
      {
        id: ids.match,
        orgId: ids.org,
        eventId: ids.event,
        homeTeamId: ids.team,
        awayTeamId: '30000000-0000-4000-8000-000000000002',
        label: '合成正式场次',
        startAt: '2026-11-10T11:30:00.000Z',
        endAt: '2026-11-10T13:00:00.000Z',
        venue: '合成球场',
      },
    ],
  };
}
function slot(date = '2026-11-10', profileIds = [ids.player]) {
  return { ...form.initialSlot(date, profileIds), label: '小组第1场', venue: '合成球场' };
}
function draft(scope = 'SINGLE') {
  return {
    scope,
    teamId: ids.team,
    eventId: '',
    eventName: '合成赛事',
    selectedIds: [ids.player],
    slots: [slot()],
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    consent: true,
  };
}
function payload() {
  return JSON.stringify(form.buildCreate(draft(), workspace(), ids.command));
}
function backing() {
  const map = new Map();
  return {
    map,
    getStorageSync(key) {
      return map.get(key) || '';
    },
    setStorageSync(key, value) {
      map.set(key, value);
    },
    removeStorageSync(key) {
      map.delete(key);
    },
  };
}
function defer() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

test('five collaboration modes preserve authoritative profile and fee snapshots; UTC conversion uses Beijing time', () => {
  for (const mode of ['SINGLE', 'MULTI', 'TOURNAMENT', 'SEASON', 'TIME_BLOCK']) {
    const input = form.buildCreate(draft(mode), workspace(), ids.command);
    assert.equal(input.scope, mode);
    assert.equal(input.appearances[0].startAt, '2026-11-10T11:30:00.000Z');
    assert.equal(input.reviewedSettingsVersion, 2);
    assert.equal(input.reviewedProfileVersions[ids.player], 3);
    assert.equal(input.eligibilityConfirmed, true);
    assert.equal(form.validPayload(JSON.stringify(input)), true);
  }
});
test('multi-player per-game selection separates certain and conditional costs; transport is not platform fee base', () => {
  const value = draft('TOURNAMENT');
  value.selectedIds = [ids.player, ids.second];
  value.slots = [
    slot('2026-11-10', [ids.player, ids.second]),
    {
      ...slot('2026-11-12'),
      label: '半决赛意向',
      conditional: true,
      conditionText: '本队晋级后重新确认',
    },
  ];
  const quote = form.quoteDraft(value, workspace());
  assert.deepEqual(quote, {
    serviceFen: 60000,
    platformFeeFen: 6000,
    travelFen: 8000,
    accommodationFen: 0,
    confirmedTotalFen: 74000,
    conditionalTotalFen: 33000,
    fixedCount: 2,
    conditionalCount: 1,
    appearanceCount: 3,
  });
  const input = form.buildCreate(value, workspace(), ids.command);
  assert.equal(input.appearances.length, 3);
  assert.equal(Object.hasOwn(input.appearances[2], 'reportAt'), false);
  assert.equal(Object.hasOwn(input.appearances[2], 'startAt'), false);
});
test('only profiles present in actual per-game items enter reviewed versions', () => {
  const value = draft('MULTI');
  value.selectedIds.push(ids.second);
  const input = form.buildCreate(value, workspace(), ids.command);
  assert.deepEqual(Object.keys(input.reviewedProfileVersions), [ids.player]);
  assert.equal(form.validPayload(JSON.stringify(input)), true);
});
test('invalid dates, incorrect ordering, overlong service and missing explicit consent fail before requests', () => {
  assert.throws(() => form.chinaStamp('2026-02-30', '19:00'));
  assert.throws(() => form.chinaStamp('2026-11-10', '24:01'));
  let value = draft();
  value.consent = false;
  assert.throws(() => form.buildCreate(value, workspace(), ids.command), /明确同意/);
  value = draft();
  value.slots[0].reportTime = '20:00';
  assert.throws(() => form.buildCreate(value, workspace(), ids.command), /报到/);
  value = draft();
  value.slots[0].endDate = '2026-11-11';
  assert.throws(() => form.buildCreate(value, workspace(), ids.command), /12小时/);
});
test('single and time-block reject conditionals/multiple slots; season validates its actual period', () => {
  for (const mode of ['SINGLE', 'TIME_BLOCK']) {
    const value = draft(mode);
    value.slots[0].conditional = true;
    value.slots[0].conditionText = '晋级';
    assert.throws(() => form.buildCreate(value, workspace(), ids.command), /不能使用条件/);
    value.slots = [slot(), slot('2026-11-12')];
    assert.throws(() => form.buildCreate(value, workspace(), ids.command), /仅包含一个/);
  }
  const season = draft('SEASON');
  season.periodEnd = '2026-11-09';
  assert.throws(() => form.buildCreate(season, workspace(), ids.command), /周期内/);
});
test('current team access, profile status, self-booking, official match ownership and slot count are checked', () => {
  assert.throws(
    () => form.buildCreate(draft(), { ...workspace(), teams: [] }, ids.command),
    /球队/,
  );
  const own = workspace();
  own.players[0].userId = ids.actor;
  assert.throws(() => form.buildCreate(draft(), own, ids.command), /自己/);
  const value = draft();
  value.eventId = ids.event;
  value.slots[0] = form.fromMatch(
    workspace().matches[0],
    [ids.player],
    commonUi.datePart,
    commonUi.timePart,
  );
  assert.equal(form.buildCreate(value, workspace(), ids.command).appearances[0].matchId, ids.match);
  const moved = workspace();
  moved.matches[0].venue = '另一球场';
  assert.throws(() => form.buildCreate(value, moved, ids.command), /赛程已变化/);
  const many = draft('MULTI');
  many.selectedIds.push(ids.second);
  many.slots = Array.from({ length: 33 }, (_, i) => ({
    ...slot('2026-11-10', many.selectedIds),
    label: '场次' + i,
  }));
  assert.throws(() => form.buildCreate(many, workspace(), ids.command), /64项/);
});
test('duplicate appearances and overlapping same-player traffic buffer are rejected', () => {
  const value = draft('MULTI');
  value.slots.push(slot());
  assert.throws(() => form.buildCreate(value, workspace(), ids.command), /不能重复/);
  value.slots[1].label = '下一场';
  value.slots[1].reportTime = '21:15';
  value.slots[1].startTime = '21:30';
  value.slots[1].endTime = '22:00';
  assert.throws(() => form.buildCreate(value, workspace(), ids.command), /30分钟/);
});
test('native storage restores byte-identical original payload, no in-flight replay or credentials across restart', () => {
  const storage = backing(),
    first = recovery.createRecoveryStore(() => storage),
    original = payload();
  const entry = first.begin(ids.actor, original);
  entry.payload = 'tampered';
  assert.equal(entry.payload, original);
  const restored = recovery.createRecoveryStore(() => storage).load(ids.actor);
  assert.equal(restored.entry.payload, original);
  assert.equal(restored.entry.inFlight, false);
  assert.equal(restored.entry.promise, null);
  const envelope = JSON.parse(storage.map.get(recovery.PREFIX + ids.actor));
  assert.deepEqual(Object.keys(envelope).sort(), [
    'actorUserId',
    'payload',
    'schemaVersion',
    'status',
  ]);
  assert.equal(envelope.status, 'UNKNOWN');
  assert.equal(recovery.createRecoveryStore(() => storage).load(ids.other).entry, null);
});
test('concurrent mounted pages share a single original create; both can observe the final receipt', async () => {
  const storage = backing(),
    store = recovery.createRecoveryStore(() => storage),
    pending = defer();
  const entry = store.begin(ids.actor, payload());
  let calls = 0;
  const sender = (input) => {
    calls++;
    assert.equal(input.commandId, ids.command);
    return pending.promise;
  };
  const first = store.execute(ids.actor, entry, sender),
    second = store.execute(ids.actor, store.load(ids.actor).entry, sender);
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve({ id: ids.order });
  await Promise.all([first, second]);
  assert.equal(store.clear(ids.actor, entry), true);
  assert.equal(store.clear(ids.actor, entry), true);
  assert.equal(storage.map.size, 0);
});
test('unknown results survive ordinary 4xx, opaque proxy errors, wrong command marker, auth and 5xx', async () => {
  for (const error of [
    { status: 401, code: 'UNAUTHENTICATED' },
    { status: 429, code: 'RATE_LIMITED' },
    { status: 409, code: 'QUOTE_CHANGED' },
    { status: 408, code: 'HTTP_408' },
    { status: 500, details: { bookingCreateOutcome: 'REJECTED', commandId: ids.command } },
    { status: 409, details: { bookingCreateOutcome: 'REJECTED', commandId: ids.order } },
  ]) {
    const storage = backing(),
      store = recovery.createRecoveryStore(() => storage),
      entry = store.begin(ids.actor, payload());
    await assert.rejects(
      store.execute(ids.actor, entry, async () => {
        throw error;
      }),
    );
    assert.equal(entry.rejectedMessage, undefined);
    assert.equal(store.clear(ids.actor, entry), false);
    assert.equal(JSON.parse(storage.map.get(recovery.PREFIX + ids.actor)).status, 'UNKNOWN');
  }
});
test('only matching committed rejection unlocks re-review, retained across a fresh native store', async () => {
  const storage = backing(),
    store = recovery.createRecoveryStore(() => storage),
    entry = store.begin(ids.actor, payload());
  await assert.rejects(
    store.execute(ids.actor, entry, async () => {
      throw {
        status: 409,
        message: '报价变化',
        details: { bookingCreateOutcome: 'REJECTED', commandId: ids.command },
      };
    }),
  );
  const second = recovery.createRecoveryStore(() => storage),
    restored = second.load(ids.actor).entry;
  assert.equal(restored.rejectedMessage, '报价变化');
  let calls = 0;
  await assert.rejects(
    second.execute(ids.actor, restored, async () => {
      calls++;
    }),
  );
  assert.equal(calls, 0);
  assert.equal(second.clear(ids.actor, restored), true);
});
test('corruption becomes a persistent actor-specific tombstone until acknowledged, including failed removal', () => {
  const storage = backing();
  storage.map.set(recovery.PREFIX + ids.actor, '{broken');
  const first = recovery.createRecoveryStore(() => storage);
  assert.equal(first.load(ids.actor).invalid, true);
  assert.equal(JSON.parse(storage.map.get(recovery.PREFIX + ids.actor)).status, 'INVALID');
  const second = recovery.createRecoveryStore(() => storage);
  assert.equal(second.load(ids.actor).invalid, true);
  assert.throws(() => second.begin(ids.actor, payload()), /原预约待核对/);
  storage.removeStorageSync = () => {
    throw new Error('denied');
  };
  assert.equal(second.acknowledgeInvalid(ids.actor), false);
  assert.equal(second.load(ids.actor).invalid, true);
  assert.equal(second.load(ids.other).invalid, false);
});
test('recovery rejects unknown/private fields, oversized input and malicious profile-version keys', () => {
  const bad = JSON.parse(payload());
  bad.password = 'never-store';
  assert.equal(form.validPayload(JSON.stringify(bad)), false);
  const storage = backing(),
    store = recovery.createRecoveryStore(() => storage);
  assert.throws(() => store.begin(ids.actor, JSON.stringify(bad)), /恢复内容无效/);
  assert.equal(storage.map.size, 0);
  assert.equal(form.validPayload('x'.repeat(recovery.MAX_CHARS + 1)), false);
  const poisoned = JSON.parse(payload());
  poisoned.reviewedProfileVersions = JSON.parse('{"__proto__":1}');
  assert.equal(form.validPayload(JSON.stringify(poisoned)), false);
});
test('unreadable native journal blocks new intents without overwriting the original and safely rereads it', async () => {
  const storage = backing(),
    original = payload();
  recovery.createRecoveryStore(() => storage).begin(ids.actor, original);
  const journal = storage.map.get(recovery.PREFIX + ids.actor);
  const read = storage.getStorageSync;
  let denied = true;
  storage.getStorageSync = (key) => {
    if (denied && key === recovery.PREFIX + ids.actor) throw new Error('read denied');
    return read(key);
  };
  const restarted = recovery.createRecoveryStore(() => storage);
  const blocked = restarted.load(ids.actor);
  assert.equal(blocked.entry, null);
  assert.equal(blocked.invalid, false);
  assert.equal(blocked.storageReadBlocked, true);
  assert.equal(blocked.storageUnavailable, true);
  const next = JSON.parse(original);
  next.commandId = ids.order;
  assert.throws(() => restarted.begin(ids.actor, JSON.stringify(next)), {
    code: 'RECOVERY_READ_BLOCKED',
  });
  assert.equal(restarted.acknowledgeInvalid(ids.actor), false);
  assert.equal(storage.map.get(recovery.PREFIX + ids.actor), journal);
  assert.equal(restarted.load(ids.other).storageReadBlocked, undefined);
  denied = false;
  const restored = restarted.load(ids.actor);
  assert.equal(restored.entry.payload, original);
  assert.equal(restored.entry.inFlight, false);
  let calls = 0;
  await restarted.execute(ids.actor, restored.entry, async (input) => {
    calls++;
    assert.deepEqual(input, JSON.parse(original));
    return { id: ids.order };
  });
  assert.equal(calls, 1);
});
test('a confirmed empty journal can start a new intent after a successful safe reread', () => {
  const storage = backing(),
    read = storage.getStorageSync;
  storage.getStorageSync = () => {
    throw new Error('read denied');
  };
  const store = recovery.createRecoveryStore(() => storage);
  assert.equal(store.load(ids.actor).storageReadBlocked, true);
  assert.throws(() => store.begin(ids.actor, payload()), { code: 'RECOVERY_READ_BLOCKED' });
  assert.equal(storage.map.size, 0);
  storage.getStorageSync = read;
  assert.equal(store.load(ids.actor).entry, null);
  assert.equal(store.begin(ids.actor, payload()).payload, payload());
});
test('storage write failure after confirmed empty read warns while retaining this process original request and lock', async () => {
  const storage = backing();
  storage.setStorageSync = () => {
    throw new Error('denied');
  };
  storage.removeStorageSync = () => {
    throw new Error('denied');
  };
  const store = recovery.createRecoveryStore(() => storage);
  const entry = store.begin(ids.actor, payload());
  assert.equal(entry.persistenceWarning, true);
  assert.equal(store.load(ids.actor).storageUnavailable, true);
  await store.execute(ids.actor, entry, async () => ({ id: ids.order }));
  assert.equal(entry.resolvedOrderId, ids.order);
  assert.equal(store.clear(ids.actor, entry), false);
  assert.throws(() => store.begin(ids.actor, payload()), /原预约待核对/);
});

function nativePage(options = {}) {
  const storage = options.storage || backing(),
    store = options.store || recovery.createRecoveryStore(() => storage);
  const current = options.current || { actor: ids.actor, revision: 1 };
  const calls = [],
    navigation = [];
  let number = 10,
    definition;
  const ui = {
    ...commonUi,
    today: () => '2026-11-10',
    async session(page) {
      if (options.session) return options.session(page, current);
      if (!current.actor) {
        page.setData({ loginRequired: true });
        return null;
      }
      return { user: { id: current.actor }, organizations: [], teamContexts: [] };
    },
    begin(page) {
      page._requestRevision = (page._requestRevision || 0) + 1;
      return { request: page._requestRevision, revision: current.revision };
    },
    live(page, token) {
      return (
        !page._closed &&
        token.request === page._requestRevision &&
        token.revision === current.revision
      );
    },
    close(page) {
      page._closed = true;
    },
    async uuid() {
      if (options.uuid) return options.uuid();
      return '60000000-0000-4000-8000-' + String(number++).padStart(12, '0');
    },
    async confirm() {
      return true;
    },
    open(name, query) {
      navigation.push({ name, query });
    },
    login(returnPath) {
      navigation.push({ name: 'account', returnPath });
    },
  };
  const sdk = {
    workspace: options.workspace || (async () => workspace(current.actor)),
    async create(input) {
      calls.push(clone(input));
      return options.create ? options.create(input) : { id: ids.order };
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '../pages/booking-create/index.js'), 'utf8');
  vm.runInNewContext(source, {
    Page(value) {
      definition = value;
    },
    require(name) {
      if (name.endsWith('/api'))
        return { getClient: () => ({ sessionRevision: () => current.revision }) };
      if (name.endsWith('/ui')) return ui;
      if (name.endsWith('/booking')) return sdk;
      if (name.endsWith('/booking-form')) return form;
      if (name.endsWith('/booking-recovery')) return { recoveryStore: store };
      throw new Error('Unexpected module ' + name);
    },
  });
  const page = {
    ...definition,
    data: clone(definition.data),
    setData(values) {
      Object.assign(this.data, values);
    },
  };
  page.onLoad(options.query || { playerId: ids.player });
  return { page, current, calls, navigation, store, storage };
}
function fillPage(page) {
  page.draft.eventName = '合成赛事';
  page.draft.slots[0].label = '小组第1场';
  page.draft.slots[0].venue = '合成球场';
  page.renderForm();
  page.review();
}
test('typing a new event name keeps the required party editor mounted until explicitly collapsed', async () => {
  const app = nativePage();
  await app.page.load();
  assert.equal(app.page.data.selectedCount, 1);
  assert.equal(app.page.data.eventName, '');
  assert.equal(app.page.data.detailsOpen, true);
  app.page.input({ currentTarget: { dataset: { field: 'eventName' } }, detail: { value: '青' } });
  assert.equal(app.page.draft.eventName, '青');
  assert.equal(app.page.data.detailsOpen, true);
  app.page.input({
    currentTarget: { dataset: { field: 'eventName' } },
    detail: { value: '青锋杯' },
  });
  assert.equal(app.page.draft.eventName, '青锋杯');
  assert.equal(app.page.data.detailsOpen, true);
  const original = JSON.stringify(app.page.draft);
  app.page.toggleDetails();
  assert.equal(app.page.data.detailsOpen, false);
  assert.equal(JSON.stringify(app.page.draft), original);
  app.page.renderForm();
  assert.equal(app.page.data.detailsOpen, false);
  assert.equal(JSON.stringify(app.page.draft), original);
  assert.equal(app.calls.length, 0);
});
test('choosing the first player does not auto-collapse an editor opened for missing party details', async () => {
  const app = nativePage({ query: {} });
  await app.page.load();
  assert.equal(app.page.data.selectedCount, 0);
  assert.equal(app.page.data.detailsOpen, true);
  app.page.input({
    currentTarget: { dataset: { field: 'eventName' } },
    detail: { value: '合成赛事' },
  });
  app.page.playerPick({ detail: { value: [ids.player] } });
  assert.equal(app.page.data.selectedCount, 1);
  assert.equal(app.page.data.detailsOpen, true);
  assert.deepEqual(Array.from(app.page.draft.selectedIds), [ids.player]);
  assert.equal(app.page.data.review, false);
  assert.equal(app.page.data.consent, false);
  assert.equal(app.calls.length, 0);
  app.page.toggleDetails();
  assert.equal(app.page.data.detailsOpen, false);
  app.page.teamPick({ detail: { value: 0 } });
  assert.equal(app.page.data.eventName, '');
  assert.equal(app.page.data.detailsOpen, true);
});
test('page blocks unreadable recovery until explicit safe reread restores the original without automatic sends', async () => {
  const storage = backing(),
    original = payload();
  recovery.createRecoveryStore(() => storage).begin(ids.actor, original);
  const journal = storage.map.get(recovery.PREFIX + ids.actor),
    read = storage.getStorageSync;
  let denied = true,
    uuidCalls = 0;
  storage.getStorageSync = (key) => {
    if (denied) throw new Error('read denied');
    return read(key);
  };
  const app = nativePage({
    storage,
    uuid: async () => {
      uuidCalls++;
      return ids.order;
    },
  });
  await app.page.load();
  assert.equal(app.page.data.storageReadBlocked, true);
  assert.equal(app.page.data.invalidRecovery, false);
  assert.equal(app.page.data.pending, false);
  fillPage(app.page);
  app.page.consent({ detail: { value: ['agree'] } });
  await app.page.submit();
  app.page.recoveryCheck({ detail: { value: ['checked'] } });
  await app.page.acknowledgeInvalid();
  assert.equal(app.page.data.review, false);
  assert.equal(app.page.data.consent, false);
  assert.equal(app.calls.length, 0);
  assert.equal(uuidCalls, 0);
  assert.equal(storage.map.get(recovery.PREFIX + ids.actor), journal);
  denied = false;
  await app.page.load();
  assert.equal(app.page.data.storageReadBlocked, false);
  assert.equal(app.page.data.pending, true);
  assert.equal(app.page.data.recoveryCommand, ids.command);
  assert.equal(app.calls.length, 0);
  await app.page.recover();
  assert.equal(app.calls.length, 1);
  assert.deepEqual(app.calls[0], JSON.parse(original));
  assert.equal(uuidCalls, 0);
});
test('a journal read failing after review blocks before UUID and requires another explicit review after reread', async () => {
  const storage = backing(),
    read = storage.getStorageSync;
  let denied = false,
    uuidCalls = 0;
  storage.getStorageSync = (key) => {
    if (denied) throw new Error('read denied');
    return read(key);
  };
  const app = nativePage({
    storage,
    uuid: async () => {
      uuidCalls++;
      return ids.command;
    },
  });
  await app.page.load();
  fillPage(app.page);
  app.page.consent({ detail: { value: ['agree'] } });
  denied = true;
  await app.page.submit();
  assert.equal(app.page.data.storageReadBlocked, true);
  assert.equal(app.page.data.consent, false);
  assert.equal(app.page.data.review, false);
  assert.equal(uuidCalls, 0);
  assert.equal(app.calls.length, 0);
  denied = false;
  await app.page.load();
  assert.equal(app.page.data.storageReadBlocked, false);
  await app.page.submit();
  assert.equal(app.calls.length, 0);
  assert.equal(uuidCalls, 0);
});
test('a journal read failing after secure UUID cannot overwrite a separately persisted original intent', async () => {
  const storage = backing(),
    read = storage.getStorageSync,
    original = payload();
  let denied = false;
  storage.getStorageSync = (key) => {
    if (denied) throw new Error('read denied');
    return read(key);
  };
  const app = nativePage({
    storage,
    uuid: async () => {
      recovery.createRecoveryStore(() => storage).begin(ids.actor, original);
      denied = true;
      return ids.order;
    },
  });
  await app.page.load();
  fillPage(app.page);
  app.page.consent({ detail: { value: ['agree'] } });
  await app.page.submit();
  assert.equal(app.page.data.storageReadBlocked, true);
  assert.equal(app.page.data.review, false);
  assert.equal(app.page.data.consent, false);
  assert.equal(app.calls.length, 0);
  assert.equal(JSON.parse(storage.map.get(recovery.PREFIX + ids.actor)).payload, original);
  denied = false;
  await app.page.load();
  assert.equal(app.page.data.pending, true);
  assert.equal(app.page.data.recoveryCommand, ids.command);
  assert.equal(app.calls.length, 0);
});
test('native page starts consent unchecked, builds real scoped payload and never calls a payment operation', async () => {
  const app = nativePage();
  await app.page.load();
  fillPage(app.page);
  assert.equal(app.page.data.review, true);
  assert.equal(app.page.data.consent, false);
  await app.page.submit();
  assert.equal(app.calls.length, 0);
  app.page.consent({ detail: { value: ['agree'] } });
  await app.page.submit();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].reviewedSettingsVersion, 2);
  assert.equal(app.calls[0].appearances[0].profileId, ids.player);
  assert.equal(app.page.data.success, true);
  assert.equal(app.page.data.successOrderId, ids.order);
  assert.equal(app.storage.map.size, 0);
});
test('page network unknown blocks editing/requote and retries the exact original ID and content', async () => {
  let first = true;
  const app = nativePage({
    create: async () => {
      if (first) {
        first = false;
        throw { code: 'NETWORK_ERROR', message: '离线' };
      }
      return { id: ids.order };
    },
  });
  await app.page.load();
  fillPage(app.page);
  app.page.consent({ detail: { value: ['agree'] } });
  await app.page.submit();
  assert.equal(app.page.data.pending, true);
  const original = clone(app.calls[0]);
  app.page.input({
    currentTarget: { dataset: { field: 'eventName' } },
    detail: { value: '偷偷改名' },
  });
  assert.equal(app.page.draft.eventName, '合成赛事');
  await app.page.submit();
  assert.equal(app.calls.length, 1);
  await app.page.recover();
  assert.equal(app.calls.length, 2);
  assert.deepEqual(app.calls[1], original);
  assert.equal(app.page.data.success, true);
});
test('matching quote rejection requires explicit refresh then new review/consent; editing cannot bypass requote', async () => {
  const app = nativePage({
    create: async (input) => {
      throw {
        status: 409,
        code: 'QUOTE_CHANGED',
        message: '报价已变化',
        details: { bookingCreateOutcome: 'REJECTED', commandId: input.commandId },
      };
    },
  });
  await app.page.load();
  fillPage(app.page);
  app.page.consent({ detail: { value: ['agree'] } });
  await app.page.submit();
  assert.equal(app.page.data.pending, false);
  assert.equal(app.page.data.canRequote, true);
  assert.equal(app.page.data.consent, false);
  app.page.input({
    currentTarget: { dataset: { field: 'eventName' } },
    detail: { value: '新名称' },
  });
  app.page.review();
  assert.equal(app.page.data.review, false);
  assert.match(app.page.data.error, /读取最新报价/);
  await app.page.load();
  assert.equal(app.page.data.canRequote, false);
  assert.equal(app.page.data.consent, false);
});
test('restart displays pending original without sending it; current loss of team grant hides private original content', async () => {
  const storage = backing(),
    prior = recovery.createRecoveryStore(() => storage);
  prior.begin(ids.actor, payload());
  const app = nativePage({ storage, workspace: async () => ({ ...workspace(), teams: [] }) });
  await app.page.load();
  assert.equal(app.calls.length, 0);
  assert.equal(app.page.data.pending, true);
  assert.equal(app.page.data.canRecover, false);
  assert.equal(app.page.data.recoveryEventName, '');
  assert.equal(app.page.data.recoverySlots.length, 0);
  await app.page.recover();
  assert.equal(app.calls.length, 0);
});
test('late create success remains attached to original actor and cannot navigate or populate a switched page', async () => {
  const delayed = defer(),
    app = nativePage({ create: () => delayed.promise });
  await app.page.load();
  fillPage(app.page);
  app.page.consent({ detail: { value: ['agree'] } });
  const submitting = app.page.submit();
  while (!app.calls.length) await new Promise((resolve) => setImmediate(resolve));
  app.current.actor = ids.other;
  app.current.revision++;
  app.page.onUnload();
  delayed.resolve({ id: ids.order });
  await submitting;
  assert.equal(app.page.data.success, false);
  assert.equal(app.navigation.length, 0);
  assert.equal(app.store.load(ids.actor).entry.resolvedOrderId, ids.order);
  assert.equal(app.store.load(ids.other).entry, null);
});
test('unload before secure UUID resolves does not create a recovery record or send a request', async () => {
  const random = defer(),
    app = nativePage({ uuid: () => random.promise });
  await app.page.load();
  fillPage(app.page);
  app.page.consent({ detail: { value: ['agree'] } });
  const submitting = app.page.submit();
  await Promise.resolve();
  await Promise.resolve();
  app.page.onUnload();
  random.resolve(ids.command);
  await submitting;
  assert.equal(app.calls.length, 0);
  assert.equal(app.storage.map.size, 0);
});
test('unloaded workspace read never repopulates private player/team form data', async () => {
  const pending = defer(),
    app = nativePage({ workspace: () => pending.promise });
  const load = app.page.load();
  await Promise.resolve();
  app.page.onUnload();
  pending.resolve(workspace());
  await load;
  assert.equal(app.page.data.ready, false);
  assert.equal(app.page.data.players.length, 0);
  assert.equal(app.page.data.teams.length, 0);
});
test('known successful receipt can be removed after storage recovers without dispatching create again', async () => {
  const storage = backing();
  let deny = true;
  storage.removeStorageSync = (key) => {
    if (deny) throw new Error('denied');
    storage.map.delete(key);
  };
  const app = nativePage({ storage });
  await app.page.load();
  fillPage(app.page);
  app.page.consent({ detail: { value: ['agree'] } });
  await app.page.submit();
  assert.equal(app.page.data.pending, true);
  assert.equal(app.page.data.originalResolvedId, ids.order);
  deny = false;
  await app.page.recover();
  assert.equal(app.calls.length, 1);
  assert.equal(app.page.data.success, true);
  assert.equal(storage.map.size, 0);
});
test('unload during fresh mutation session validation cannot dispatch or overwrite the closed page', async () => {
  const pending = defer();
  let sessions = 0;
  const app = nativePage({
    session: async () => {
      sessions++;
      return sessions > 1
        ? pending.promise
        : { user: { id: ids.actor }, organizations: [], teamContexts: [] };
    },
  });
  await app.page.load();
  fillPage(app.page);
  app.page.consent({ detail: { value: ['agree'] } });
  const submitting = app.page.submit();
  await Promise.resolve();
  app.page.onUnload();
  const before = clone(app.page.data);
  pending.resolve({ user: { id: ids.actor }, organizations: [], teamContexts: [] });
  await submitting;
  assert.equal(app.calls.length, 0);
  assert.deepEqual(clone(app.page.data), before);
});
test('workspace viewer mismatch fails closed rather than displaying another actor player/team material', async () => {
  const app = nativePage({ workspace: async () => workspace(ids.other) });
  await app.page.load();
  assert.equal(app.page.data.ready, false);
  assert.equal(app.page.data.players.length, 0);
  assert.match(app.page.data.error, /身份已变化/);
});
