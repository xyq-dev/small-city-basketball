const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../utils/player-center');

function profile(actor = 'actor-a') {
  return {
    id: 'profile-a',
    userId: actor,
    displayName: '合成球员',
    position: 'PG',
    heightCm: 182,
    city: '石鼓',
    bio: '合成服务介绍',
    priceFen: 30000,
    travelFen: 8000,
    accommodationFen: 0,
    version: 1,
    status: 'APPROVED',
    reviewReason: null,
    availability: [{ startAt: '2026-10-28T10:00:00.000Z', endAt: '2026-10-28T14:00:00.000Z' }],
  };
}
function harness(sdk = {}) {
  let definition,
    revision = 1,
    actor = 'actor-a',
    uuidCalls = 0;
  const ui = {
    session: async () => ({ user: { id: actor } }),
    begin(p) {
      return { generation: (p._generation = (p._generation || 0) + 1), revision };
    },
    live(p, t) {
      return !p._closed && p._generation === t.generation && revision === t.revision;
    },
    close(p) {
      p._closed = true;
    },
    money: (n) => '¥' + (n / 100).toFixed(2),
    position: (s) => s,
    today: () => '2026-10-28',
    uuid: async () => 'secure-' + ++uuidCalls,
    confirm: async () => true,
    message: (e) => e.message || '操作失败',
    open() {},
    login() {},
  };
  const service = {
    workspace: async () => ({
      viewerUserId: actor,
      settings: { feeBps: 1000 },
      ownProfile: profile(actor),
    }),
    ...sdk,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../pages/player-center/index.js'), 'utf8'),
    {
      Page(d) {
        definition = d;
      },
      require(name) {
        return name.endsWith('/booking')
          ? service
          : name.endsWith('/ui')
            ? ui
            : name.endsWith('/api')
              ? { getClient: () => ({ sessionRevision: () => revision }) }
              : model;
      },
      console,
      Date,
      Promise,
      Set,
      Map,
    },
  );
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(v) {
      Object.assign(this.data, v);
    },
  };
  return {
    page,
    ui,
    sdk: service,
    uuidCalls: () => uuidCalls,
    changeActor(id) {
      actor = id;
      revision++;
    },
    revoke() {
      revision++;
    },
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('amount input produces exact fen and rejects rounding, exponent and unsafe prices', () => {
  assert.equal(model.fen('300.20', '费'), 30020);
  assert.equal(model.fen('0.01', '费', 1), 1);
  for (const value of ['0.001', '1e3', 'Infinity', '-1', '', '100000.01'])
    assert.throws(() => model.fen(value, '费'));
  assert.throws(() => model.fen('0', '费', 1));
});
test('profile drafts never inherit adult consent, use Beijing date parts, and preserve actual fee components', () => {
  const form = model.formFromProfile(profile());
  assert.equal(form.adultConfirmed, false);
  assert.equal(form.availability[0].startTime, '18:00');
  assert.equal(form.travel, '80.00');
  const q = model.quote(form, 1000);
  assert.deepEqual(q, {
    service: 30000,
    travel: 8000,
    accommodation: 0,
    platform: 3000,
    total: 41000,
  });
});
test('availability validates real calendar days, timezone, overlaps and bounds', () => {
  assert.equal(model.stamp('2026-10-28', '18:00'), '2026-10-28T10:00:00.000Z');
  for (const parts of [
    ['2026-02-30', '18:00'],
    ['2026-10-28', '24:30'],
    ['2026-10-28', '18:99'],
  ])
    assert.throws(() => model.stamp(...parts));
  const a = {
    startDate: '2026-10-28',
    startTime: '18:00',
    endDate: '2026-10-28',
    endTime: '22:00',
  };
  assert.throws(() => model.windows([]));
  assert.throws(() => model.windows([a, a]));
  assert.throws(() => model.windows(Array.from({ length: 61 }, () => a)));
  assert.throws(() => model.windows([{ ...a, endDate: '2026-12-28' }]));
});
test('submitting requires explicit adult declaration, valid height and whole original version', () => {
  const form = model.formFromProfile(profile());
  assert.throws(() => model.profileInput(form, 1, 'command'));
  form.adultConfirmed = true;
  const input = model.profileInput(form, 3, 'secure-command');
  assert.equal(input.expectedVersion, 3);
  assert.equal(input.priceFen, 30000);
  assert.equal(input.commandId, 'secure-command');
  assert.equal(input.availability[0].startAt, '2026-10-28T10:00:00.000Z');
  form.heightCm = '119';
  assert.throws(() => model.profileInput(form, 3, 'command'));
});
test('late workspace after session change clears private profile rather than rendering old actor', async () => {
  const wait = deferred(),
    started = deferred();
  const h = harness({
    workspace: () => {
      started.resolve();
      return wait.promise;
    },
  });
  const loading = h.page.load();
  await started.promise;
  h.changeActor('actor-b');
  wait.resolve({ viewerUserId: 'actor-a', settings: { feeBps: 1000 }, ownProfile: profile() });
  await loading;
  assert.equal(h.page.data.authorized, false);
  assert.equal(h.page.data.profile, null);
  assert.equal(h.page.data.form.displayName, '');
});
test('unknown profile result locks edits and reuses original immutable command, no second UUID', async () => {
  const calls = [];
  const h = harness({
    saveProfile: async (input) => {
      calls.push(JSON.parse(JSON.stringify(input)));
      if (calls.length === 1) throw { code: 'NETWORK_ERROR', message: '连接中断' };
      return { ...profile(), version: 2, status: 'PENDING' };
    },
  });
  await h.page.load();
  h.page.edit();
  h.page.data.form.adultConfirmed = true;
  await h.page.save();
  assert.equal(h.page.data.pending, true);
  h.page.input({ currentTarget: { dataset: { field: 'city' } }, detail: { value: '不得改写' } });
  assert.equal(h.page.data.form.city, '石鼓');
  await h.page.save();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(h.uuidCalls(), 1);
  assert.equal(h.page.data.profile.status, 'PENDING');
  assert.equal(h.page.data.form.adultConfirmed, false);
  assert.equal(h.page.data.pending, false);
});
test('in-flight save is serialized and late actor response cannot update private view', async () => {
  const wait = deferred();
  let count = 0;
  const h = harness({
    saveProfile: async () => {
      count++;
      return wait.promise;
    },
  });
  await h.page.load();
  h.page.edit();
  h.page.data.form.adultConfirmed = true;
  const first = h.page.save();
  await Promise.resolve();
  await Promise.resolve();
  await h.page.save();
  assert.equal(count, 1);
  h.changeActor('actor-b');
  wait.resolve(profile());
  await first;
  assert.equal(h.page.data.authorized, false);
  assert.equal(h.page.data.profile, null);
});
test('unsaved profile keeps draft on same-actor show and refresh requires explicit discard', async () => {
  const h = harness();
  await h.page.load();
  h.page.edit();
  h.page.input({
    currentTarget: { dataset: { field: 'bio' } },
    detail: { value: '尚未保存的修改' },
  });
  await h.page.load();
  assert.equal(h.page.data.form.bio, '尚未保存的修改');
  assert.equal(h.page.data.form.adultConfirmed, false);
  h.ui.confirm = async () => false;
  await h.page.refresh();
  assert.equal(h.page.data.form.bio, '尚未保存的修改');
});

test('returning while an old save settles releases retry lock without using its late response', async () => {
  const wait = deferred(),
    started = deferred();
  const calls = [];
  const h = harness({
    saveProfile: async (input) => {
      calls.push(JSON.parse(JSON.stringify(input)));
      if (calls.length === 1) {
        started.resolve();
        return wait.promise;
      }
      return { ...profile(), version: 2, status: 'PENDING' };
    },
  });
  await h.page.load();
  h.page.edit();
  h.page.data.form.adultConfirmed = true;
  const saving = h.page.save();
  await started.promise;
  h.page.onHide();
  h.page._hidden = false;
  await h.page.load();
  assert.equal(h.page.data.pendingInFlight, true);
  wait.resolve({ ...profile(), version: 2, status: 'PENDING' });
  await saving;
  assert.equal(h.page.data.pendingInFlight, false);
  assert.equal(h.page.data.pending, true);
  await h.page.save();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(h.page.data.pending, false);
});

test('a new login revision for the same actor drops previous unconfirmed draft', async () => {
  const h = harness();
  await h.page.load();
  h.page.edit();
  h.page.input({ currentTarget: { dataset: { field: 'bio' } }, detail: { value: '旧会话草稿' } });
  h.changeActor('actor-a');
  await h.page.load();
  assert.equal(h.page.data.form.bio, '合成服务介绍');
  assert.equal(h.page.data.dirty, false);
  assert.equal(h.page.data.form.adultConfirmed, false);
});
