const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../utils/booking-orders');
const ids = Array.from(
  { length: 9 },
  (_, i) => '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
);
const [
  actor,
  otherActor,
  orderId,
  teamId,
  orgId,
  appearanceId,
  otherAppearance,
  profileId,
  commandId,
] = ids;
const clone = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function storage() {
  const values = new Map();
  return {
    values,
    getStorageSync: (k) => values.get(k),
    setStorageSync: (k, v) => values.set(k, v),
    removeStorageSync: (k) => values.delete(k),
  };
}
function item(overrides = {}) {
  return {
    id: appearanceId,
    orderId,
    profileId,
    playerUserId: actor,
    playerName: '合成球员',
    position: 'PG',
    label: '合成赛事第1场',
    conditionText: null,
    status: 'REQUESTED',
    version: 7,
    reportAt: '2026-11-01T11:00:00.000Z',
    startAt: '2026-11-01T11:30:00.000Z',
    endAt: '2026-11-01T13:00:00.000Z',
    venue: '合成球场',
    serviceFen: 30000,
    platformFeeFen: 3000,
    travelFen: 0,
    accommodationFen: 0,
    totalFen: 33000,
    expiresAt: '2026-11-01T10:20:00.000Z',
    changeRequest: null,
    arrivedAt: null,
    completedAt: null,
    cancellationReason: null,
    scheduleChanged: false,
    capabilities: {
      canAccept: true,
      canDecline: true,
      canCancel: false,
      canActivate: false,
      canProposeChange: false,
      canAcceptChange: false,
      canRejectChange: false,
      canArrive: false,
      canComplete: false,
      canDispute: false,
      canResolveDispute: false,
    },
    ...overrides,
  };
}
function order(overrides = {}) {
  return {
    id: orderId,
    orgId,
    teamId,
    buyerUserId: otherActor,
    eventName: '合成青锋杯',
    teamName: '合成球队',
    scope: 'MULTI',
    status: 'ACTIVE',
    createdAt: '2026-10-28T00:00:00.000Z',
    eligibilityNotice: '仅声明，不代表核验',
    appearances: [item()],
    totals: {
      confirmedTotalFen: 33000,
      conditionalTotalFen: 0,
      paidFen: 0,
      refundedFen: 0,
      settledFen: 0,
    },
    ...overrides,
  };
}
const display = {
  money: (fen) => '¥' + (fen / 100).toFixed(2),
  localTime: (iso) => iso || '时间待定',
  datePart: () => '2026-11-01',
  timePart: (iso) => new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(11, 16),
  today: () => '2026-11-01',
  position: (v) => v,
  scope: (v) => v,
  state: (v) => v,
};
function page(name, options = {}) {
  let definition,
    revision = 0,
    userId = actor;
  const journal = options.journal || model.createJournal(storage());
  const ui = {
    ...display,
    session: options.session || (async () => ({ user: { id: userId } })),
    begin(p) {
      p.epoch = (p.epoch || 0) + 1;
      return { epoch: p.epoch, revision };
    },
    live(p, token) {
      return !p.closed && token.epoch === p.epoch && token.revision === revision;
    },
    close(p) {
      p.closed = true;
    },
    confirm: async () => true,
    message: (error) => error.message || '操作失败',
    uuid: options.uuid || (async () => commandId),
    open() {},
    login() {},
  };
  const sdk = {
    get: async () => order(),
    workspace: async () => ({
      viewerUserId: actor,
      teams: [{ id: teamId, orgId }],
      orders: [order()],
      ordersHasMore: false,
    }),
    command: async () => order(),
    ...options.sdk,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages', name, 'index.js'), 'utf8'), {
    Page(v) {
      definition = v;
    },
    require(p) {
      return p.endsWith('/ui')
        ? ui
        : p.endsWith('/booking-orders')
          ? { ...model, getJournal: () => journal }
          : sdk;
    },
    wx: { pageScrollTo() {} },
    Date,
    Promise,
    Set,
  });
  const p = {
    ...definition,
    data: clone(definition.data),
    visit: 1,
    hidden: false,
    setData(value, done) {
      Object.assign(this.data, value);
      if (done) done();
    },
  };
  if (name === 'booking-detail') p.onLoad({ id: orderId, view: 'received' });
  return {
    p,
    sdk,
    ui,
    journal,
    switchActor(id = otherActor) {
      userId = id;
      revision += 1;
    },
  };
}
async function readyDetail(options = {}) {
  const h = page('booking-detail', options);
  await h.p.load();
  return h;
}
async function acceptForm(h) {
  await h.p.chooseAction({ currentTarget: { dataset: { id: appearanceId, type: 'ACCEPT' } } });
  h.p.confirm({ detail: { value: ['yes'] } });
}

test('sent list derives from current team authorization, not operator or creator hints', () => {
  const workspace = {
    viewerUserId: actor,
    isPlatformOperator: true,
    teams: [{ id: teamId, orgId }],
    orders: [order(), order({ id: otherAppearance, orgId: otherActor, buyerUserId: actor })],
  };
  assert.deepEqual(
    model.list(workspace, actor, 'sent', 'ALL').map((r) => r.id),
    [orderId],
  );
  assert.throws(() => model.list(workspace, otherActor, 'sent', 'ALL'), /账号/);
});
test('received projection only includes this player and its quoted amounts, never another player', () => {
  const value = order({
    appearances: [item(), item({ id: otherAppearance, playerUserId: otherActor, totalFen: 99900 })],
    totals: {
      confirmedTotalFen: 132900,
      conditionalTotalFen: 0,
      paidFen: 0,
      refundedFen: 0,
      settledFen: 0,
    },
  });
  const result = model.decorateOrder(value, actor, 'received', display);
  assert.equal(result.appearances.length, 1);
  assert.equal(result.confirmedText, '¥330.00');
  assert.throws(() => model.appearance(value, otherAppearance, actor, 'received'));
});
test('capabilities must be literal true and never inferred from status or platform role', () => {
  assert.equal(model.allowed(item({ capabilities: { canAccept: 'true' } }), 'ACCEPT'), false);
  assert.equal(model.allowed(item({ capabilities: {} }), 'RESOLVE_DISPUTE'), false);
  assert.equal(
    model.decorateAppearance(
      item({ capabilities: { canAccept: true, canComplete: false } }),
      display,
    ).actions.length,
    1,
  );
});
test('every action form starts unchecked, even arrival and independent resolution', () => {
  for (const action of model.ACTIONS)
    assert.equal(model.form(action.type, item(), display).confirmed, false);
});
test('accept uses the appearance version and explicit consent, without payment or order version fields', () => {
  assert.throws(() => model.command('ACCEPT', item(), {}, commandId, false), /勾选/);
  assert.deepEqual(model.command('ACCEPT', item(), {}, commandId, true), {
    commandId,
    expectedVersion: 7,
    type: 'ACCEPT',
    appearanceId,
    eligibilityConfirmed: true,
  });
});
test('activation preserves quote snapshot: only exact schedule/eligibility command keys are sent', () => {
  const fields = model.form('ACTIVATE', item(), display).fields;
  const command = model.command('ACTIVATE', item(), fields, commandId, true);
  assert.equal(command.reportAt, '2026-11-01T11:00:00.000Z');
  assert.equal(command.eligibilityConfirmed, true);
  assert.equal(command.priceFen, undefined);
  assert.equal(command.feeBps, undefined);
});
test('schedule validates actual calendar/time order and twelve hour service boundary', () => {
  const fields = model.form('PROPOSE_CHANGE', item(), display).fields;
  for (const patch of [
    { reportTime: '' },
    { startDate: '2026-02-30' },
    { reportTime: '25:00' },
    { endTime: '19:30' },
    { endDate: '2026-11-02', endTime: '19:00' },
  ])
    assert.throws(() => model.schedule({ ...fields, ...patch }));
  assert.equal(
    model.schedule({ ...fields, endDate: '2026-11-02', endTime: '00:30' }).endAt,
    '2026-11-01T16:30:00.000Z',
  );
});
test('reason and resolution are mandatory only for relevant commands', () => {
  assert.throws(() => model.command('CANCEL', item(), { reason: ' ' }, commandId, true), /2至500/);
  assert.throws(
    () => model.command('RESOLVE_DISPUTE', item(), { reason: '独立核验' }, commandId, true),
    /处理结果/,
  );
  assert.equal(
    model.command(
      'RESOLVE_DISPUTE',
      item(),
      { reason: '独立核验', resolution: 'CANCEL' },
      commandId,
      true,
    ).resolution,
    'CANCEL',
  );
});
test('journal rejects injected unknown payload fields instead of persisting credentials', () => {
  const payload = model.command('ACCEPT', item(), {}, commandId, true);
  assert.equal(model.validPayload({ ...payload, password: 'must not persist' }), false);
  assert.equal(model.validPayload({ ...payload, venue: 'not a schedule command' }), false);
});
test('journal persists immutable actor/order-bound payload across a new store instance', () => {
  const wx = storage(),
    first = model.createJournal(wx),
    payload = model.command('ACCEPT', item(), {}, commandId, true);
  first.start(actor, orderId, payload);
  payload.type = 'CANCEL';
  assert.equal(model.createJournal(wx).read(actor, orderId).payload.type, 'ACCEPT');
  assert.equal(model.createJournal(wx).read(otherActor, orderId), null);
});
test('uncertain writes share one in-flight original request and cannot be discarded while active', async () => {
  const journal = model.createJournal(storage()),
    original = model.command('ACCEPT', item(), {}, commandId, true),
    wait = deferred();
  let calls = 0;
  journal.start(actor, orderId, original);
  const first = journal.run(actor, orderId, async (body) => {
    calls += 1;
    assert.deepEqual(body, original);
    return wait.promise;
  });
  const second = journal.run(actor, orderId, () => {
    calls += 1;
  });
  assert.equal(first, second);
  await tick();
  assert.equal(calls, 1);
  assert.throws(() => journal.clear(actor, orderId), /仍在/);
  wait.resolve(order());
  await first;
  assert.equal(journal.read(actor, orderId).payload.commandId, commandId);
});
test('corrupt recovery remains an invalid tombstone across reload until explicit acknowledgement', () => {
  const wx = storage(),
    key = 'scb.booking-command.v1.' + actor + '.' + orderId;
  wx.values.set(key, '{broken');
  assert.equal(model.createJournal(wx).read(actor, orderId).kind, 'INVALID');
  const again = model.createJournal(wx);
  assert.equal(again.read(actor, orderId).kind, 'INVALID');
  assert.throws(
    () => again.start(actor, orderId, model.command('ACCEPT', item(), {}, commandId, true)),
    /先核对/,
  );
  assert.equal(again.clear(actor, orderId), true);
  assert.equal(again.read(actor, orderId), null);
});
test('failed storage read blocks a fresh operation rather than treating unknown data as absent', () => {
  const journal = model.createJournal({
    getStorageSync() {
      throw new Error('storage error');
    },
  });
  assert.equal(journal.read(actor, orderId).kind, 'INVALID');
  assert.throws(
    () => journal.start(actor, orderId, model.command('ACCEPT', item(), {}, commandId, true)),
    /先核对/,
  );
});
test('failed marker removal keeps the recovery gate; unavailable initial storage remains explicit memory-only', () => {
  const wx = storage(),
    journal = model.createJournal(wx);
  journal.start(actor, orderId, model.command('ACCEPT', item(), {}, commandId, true));
  wx.removeStorageSync = () => {
    throw new Error('blocked');
  };
  assert.equal(journal.clear(actor, orderId), false);
  assert.ok(journal.read(actor, orderId));
  const memory = model.createJournal(null);
  assert.match(
    memory.start(actor, orderId, model.command('ACCEPT', item(), {}, commandId, true))
      .storageWarning,
    /无法/,
  );
  assert.equal(memory.clear(actor, orderId), true);
});
test('list refuses a workspace stamped with another actor and never displays its orders', async () => {
  const { p } = page('bookings', {
    sdk: { workspace: async () => ({ viewerUserId: otherActor, teams: [], orders: [order()] }) },
  });
  await p.load();
  assert.equal(p.data.rows.length, 0);
  assert.match(p.data.error, /账号/);
});
test('a late session completion cannot start an older list load after a newer request', async () => {
  const slow = deferred();
  let sessions = 0,
    reads = 0;
  const { p } = page('bookings', {
    session: () => (++sessions === 1 ? slow.promise : Promise.resolve({ user: { id: actor } })),
    sdk: {
      workspace: async () => {
        reads += 1;
        return { viewerUserId: actor, teams: [], orders: [] };
      },
    },
  });
  const first = p.load(),
    second = p.load();
  await second;
  slow.resolve({ user: { id: actor } });
  await first;
  assert.equal(reads, 1);
});
test('forged hidden actions do not open a form or issue a write', async () => {
  const h = await readyDetail();
  await h.p.chooseAction({ currentTarget: { dataset: { id: appearanceId, type: 'COMPLETE' } } });
  assert.equal(h.p.data.form, null);
  assert.match(h.p.data.error, /不允许/);
});
test('unchecked action cannot allocate a UUID or send a command', async () => {
  let writes = 0,
    uuids = 0;
  const h = await readyDetail({
    uuid: async () => {
      uuids += 1;
      return commandId;
    },
    sdk: {
      command: async () => {
        writes += 1;
      },
    },
  });
  await h.p.chooseAction({ currentTarget: { dataset: { id: appearanceId, type: 'ACCEPT' } } });
  assert.equal(h.p.data.formConfirmed, false);
  await h.p.submit();
  assert.equal(uuids, 0);
  assert.equal(writes, 0);
});
test('new command re-reads capability/version before allocating or sending the action', async () => {
  let gets = 0,
    writes = 0,
    uuids = 0;
  const h = await readyDetail({
    uuid: async () => {
      uuids += 1;
      return commandId;
    },
    sdk: {
      get: async () => order({ appearances: [item({ version: ++gets === 1 ? 7 : 8 })] }),
      command: async () => {
        writes += 1;
      },
    },
  });
  await acceptForm(h);
  await h.p.submit();
  assert.equal(writes, 0);
  assert.equal(uuids, 0);
  assert.equal(h.p.data.form, null);
  assert.match(h.p.data.error, /已变化/);
});
test('revoked preflight read clears private order/form instead of retaining old data', async () => {
  let gets = 0;
  const h = await readyDetail({
    sdk: {
      get: async () => {
        if (++gets > 1) throw { status: 403, message: '权限撤销' };
        return order();
      },
    },
  });
  await acceptForm(h);
  await h.p.submit();
  assert.equal(h.p.data.order, null);
  assert.equal(h.p.data.form, null);
  assert.equal(h.p.viewer, null);
});
test('uncertain command replays the exact original ID/body even after state changes, without a fresh UUID', async () => {
  const sent = [];
  let uuids = 0;
  const h = await readyDetail({
    uuid: async () => {
      uuids += 1;
      return commandId;
    },
    sdk: {
      command: async (_id, body) => {
        sent.push(clone(body));
        if (sent.length === 1) throw { code: 'NETWORK_ERROR', message: '响应丢失' };
        return order({ appearances: [item({ status: 'ACCEPTED', version: 8, capabilities: {} })] });
      },
    },
  });
  await acceptForm(h);
  await h.p.submit();
  assert.ok(h.p.data.pending);
  assert.equal(h.p.data.pending.payload.commandId, commandId);
  h.sdk.get = async () =>
    order({ appearances: [item({ status: 'ACCEPTED', version: 8, capabilities: {} })] });
  await h.p.recover();
  assert.equal(uuids, 1);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(h.p.data.pending, null);
});
test('hidden pages ignore late command results, keep recovery, and can load again on return', async () => {
  const wait = deferred();
  const h = await readyDetail({ sdk: { command: async () => wait.promise } });
  await acceptForm(h);
  const sending = h.p.submit();
  await tick();
  h.p.onHide();
  assert.equal(h.p.data.order, null);
  wait.resolve(order({ status: 'COMPLETED' }));
  await sending;
  assert.equal(h.p.data.order, null);
  assert.ok(h.journal.read(actor, orderId));
  h.p.onShow();
  await tick();
  assert.equal(h.p.data.busy, false);
  assert.ok(h.p.data.order);
});
test('an actor change in a write continuation clears old private data and never sends as the new actor', async () => {
  const wait = deferred();
  let gets = 0,
    writes = 0;
  const h = await readyDetail({
    sdk: {
      get: async () => (++gets === 1 ? order() : wait.promise),
      command: async () => {
        writes += 1;
      },
    },
  });
  await acceptForm(h);
  const sending = h.p.submit();
  await tick();
  h.switchActor();
  wait.resolve(order());
  await sending;
  assert.equal(writes, 0);
  assert.equal(h.p.data.order, null);
  assert.equal(h.p.data.busy, false);
});
test('a recovery marker cannot be cleared without explicit unchecked-by-default acknowledgement', async () => {
  const journal = model.createJournal(storage());
  journal.start(actor, orderId, model.command('ACCEPT', item(), {}, commandId, true));
  const h = await readyDetail({ journal });
  assert.equal(h.p.data.pendingAcknowledged, false);
  await h.p.clearPending();
  assert.ok(journal.read(actor, orderId));
  h.p.pendingConsent({ detail: { value: ['yes'] } });
  await h.p.clearPending();
  assert.ok(journal.read(actor, orderId));
  assert.equal(h.p.data.pendingAcknowledged, false);
  await h.p.clearPending();
  assert.ok(journal.read(actor, orderId));
  h.p.pendingConsent({ detail: { value: ['yes'] } });
  await h.p.clearPending();
  assert.equal(journal.read(actor, orderId), null);
});

test('a lost ACCEPT acknowledgement is displayed before renewed consent can remove its original marker', async () => {
  const h = await readyDetail({
    sdk: {
      command: async () => {
        throw { code: 'NETWORK_ERROR', message: '服务端已接单，但响应丢失' };
      },
    },
  });
  await acceptForm(h);
  await h.p.submit();
  assert.equal(h.p.data.order.appearances[0].status, 'REQUESTED');
  assert.equal(h.journal.read(actor, orderId).payload.commandId, commandId);
  h.sdk.get = async () =>
    order({ appearances: [item({ status: 'ACCEPTED', version: 8, capabilities: {} })] });
  let confirmations = 0;
  h.ui.confirm = async () => {
    confirmations++;
    assert.equal(h.p.data.order.appearances[0].status, 'ACCEPTED');
    assert.equal(h.journal.read(actor, orderId).payload.commandId, commandId);
    return true;
  };
  h.p.pendingConsent({ detail: { value: ['yes'] } });
  await h.p.clearPending();
  assert.equal(h.p.data.order.appearances[0].status, 'ACCEPTED');
  assert.equal(h.p.data.pendingAcknowledged, false);
  assert.equal(confirmations, 0);
  assert.equal(h.journal.read(actor, orderId).payload.commandId, commandId);
  h.p.pendingConsent({ detail: { value: ['yes'] } });
  await h.p.clearPending();
  assert.equal(confirmations, 1);
  assert.equal(h.journal.read(actor, orderId), null);
});

test('a newer record on the second clear attempt resets acknowledgement and retains the original command', async () => {
  const journal = model.createJournal(storage());
  journal.start(actor, orderId, model.command('ACCEPT', item(), {}, commandId, true));
  const h = await readyDetail({ journal });
  let confirmations = 0;
  h.ui.confirm = async () => {
    confirmations++;
    return true;
  };
  h.p.pendingConsent({ detail: { value: ['yes'] } });
  await h.p.clearPending();
  h.sdk.get = async () =>
    order({ appearances: [item({ status: 'CANCELLED', version: 9, capabilities: {} })] });
  h.p.pendingConsent({ detail: { value: ['yes'] } });
  await h.p.clearPending();
  assert.equal(h.p.data.order.appearances[0].status, 'CANCELLED');
  assert.equal(h.p.data.pendingAcknowledged, false);
  assert.equal(confirmations, 0);
  assert.equal(journal.read(actor, orderId).payload.commandId, commandId);
  h.p.pendingConsent({ detail: { value: ['yes'] } });
  await h.p.clearPending();
  assert.equal(confirmations, 1);
  assert.equal(journal.read(actor, orderId), null);
});

test('a record changing during the removal modal is presented for another review instead of losing recovery', async () => {
  const journal = model.createJournal(storage());
  journal.start(actor, orderId, model.command('ACCEPT', item(), {}, commandId, true));
  const h = await readyDetail({ journal });
  h.p.pendingConsent({ detail: { value: ['yes'] } });
  await h.p.clearPending();
  h.ui.confirm = async () => {
    h.sdk.get = async () =>
      order({ appearances: [item({ status: 'ACCEPTED', version: 8, capabilities: {} })] });
    return true;
  };
  h.p.pendingConsent({ detail: { value: ['yes'] } });
  await h.p.clearPending();
  assert.equal(h.p.data.order.appearances[0].status, 'ACCEPTED');
  assert.equal(h.p.data.pendingAcknowledged, false);
  assert.equal(journal.read(actor, orderId).payload.commandId, commandId);
  h.p.pendingConsent({ detail: { value: ['yes'] } });
  await h.p.clearPending();
  assert.equal(journal.read(actor, orderId), null);
});

function sharedUiPage(name) {
  let revision = 0,
    definition;
  const listeners = new Set();
  const wx = {
    navigateTo() {},
    pageScrollTo() {},
    showModal(options) {
      options.success({ confirm: true });
    },
  };
  const client = {
    sessionRevision: () => revision,
    onSessionChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async request() {
      return { data: { user: { id: actor }, organizations: [], teamContexts: [] } };
    },
  };
  const output = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/ui.js'), 'utf8'), {
    module: output,
    require() {
      return { getClient: () => client, uuid: model.id };
    },
    wx,
    Date,
  });
  const ui = output.exports,
    journal = model.createJournal(storage());
  const sdk = {
    get: async () => order(),
    workspace: async () => ({
      viewerUserId: actor,
      teams: [{ id: teamId, orgId }],
      orders: [order()],
      ordersHasMore: false,
    }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages', name, 'index.js'), 'utf8'), {
    Page(v) {
      definition = v;
    },
    require(p) {
      return p.endsWith('/ui')
        ? ui
        : p.endsWith('/booking-orders')
          ? { ...model, getJournal: () => journal }
          : sdk;
    },
    wx,
    Date,
    Promise,
  });
  const p = {
    ...definition,
    data: clone(definition.data),
    visit: 1,
    hidden: false,
    setData(value, done) {
      Object.assign(this.data, value);
      if (done) done();
    },
  };
  if (name === 'booking-detail') p.onLoad({ id: orderId });
  return {
    p,
    invalidate() {
      revision++;
      for (const listener of listeners) listener();
    },
  };
}
test('actual shared UI session observer clears detail and stale click cannot reconstruct it from raw cache', async () => {
  const { p, invalidate } = sharedUiPage('booking-detail');
  await p.load();
  assert.ok(p.data.order);
  invalidate();
  assert.equal(p.data.order, null);
  assert.equal(p.data.loginRequired, true);
  await p.chooseAction({ currentTarget: { dataset: { id: appearanceId, type: 'ACCEPT' } } });
  assert.equal(p.data.form, null);
  assert.equal(p.data.order, null);
});
test('actual shared UI observer prevents a status filter from restoring the previous actor list', async () => {
  const { p, invalidate } = sharedUiPage('bookings');
  await p.load();
  assert.equal(p.data.rows.length, 1);
  invalidate();
  assert.equal(p.data.rows.length, 0);
  p.changeStatus({ detail: { value: 1 } });
  assert.equal(p.data.rows.length, 0);
});
