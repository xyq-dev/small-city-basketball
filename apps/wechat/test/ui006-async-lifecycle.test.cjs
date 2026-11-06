const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');

const root = path.resolve(__dirname, '..');
const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const copy = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
async function until(check) {
  for (let i = 0; i < 40; i++) {
    if (check()) return;
    await new Promise(setImmediate);
  }
  throw Error('Expected the controlled async read to start or finish');
}
function identity() {
  let revision = 1,
    viewer = id(1);
  const listeners = new Set();
  const client = {
    sessionRevision: () => revision,
    viewerId: () => viewer,
    hasSession: () => true,
    onSessionChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async request(url) {
      assert.equal(url, '/v1/auth/session');
      return {
        data: {
          user: { id: viewer },
          teamContexts: [],
          organizations: [
            { id: id(10), name: '合成旧机构', role: 'ORG_OWNER' },
            { id: id(11), name: '合成新机构', role: 'ORG_OWNER' },
          ],
        },
      };
    },
  };
  return {
    api: { getClient: () => client, uuid: (value) => value },
    switchUser() {
      viewer = id(2);
      revision++;
      for (const fn of [...listeners]) fn();
    },
  };
}
function scorer() {
  const session = identity();
  let sheet;
  const wx = createWx();
  wx.showActionSheet = (options) => {
    sheet = options;
  };
  const h = loadPage({
    root,
    route: 'pages/scorer/index',
    wx,
    modules: {
      './api': session.api,
      '../../utils/api': session.api,
    },
  });
  h.page._alive = true;
  h.page._visible = true;
  h.page._load = 1;
  h.page._matchVersion = 5;
  h.page.setData({
    match: { home: '合成主队', away: '合成客队' },
    board: { proMode: false, playerMode: false },
  });
  const commands = [];
  h.page.command = (...args) => commands.push(copy(args));
  return { ...h, ...session, commands, sheet: () => sheet };
}

test('team selection retains the normal FOUL and TIMEOUT command payloads for either side', () => {
  for (const [tapIndex, kind, side] of [
    [0, 'FOUL', 'HOME'],
    [1, 'TIMEOUT', 'AWAY'],
  ]) {
    const h = scorer();
    h.page.teamStat({ currentTarget: { dataset: { kind } } });
    assert.deepEqual(copy(h.sheet().itemList), ['合成主队', '合成客队']);
    h.sheet().success({ tapIndex });
    assert.equal(h.commands.length, 1);
    assert.deepEqual(h.commands[0].slice(0, 2), ['RECORD_STAT', { kind, side, value: 1 }]);
  }
});

for (const [name, change] of [
  ['session change', (h) => h.switchUser()],
  [
    'hide and return',
    (h) => {
      h.page.onHide();
      h.page.load = async () => {};
      h.page.onShow();
    },
  ],
  ['unload', (h) => h.page.onUnload()],
  [
    'refresh start',
    (h) => {
      h.page._load++;
    },
  ],
  ['replacement match', (h) => h.page.setData({ match: { home: '另一主队', away: '另一客队' } })],
  [
    'new match version',
    (h) => {
      h.page._matchVersion++;
    },
  ],
  ['loading', (h) => h.page.setData({ loading: true })],
  ['busy', (h) => h.page.setData({ busy: true })],
  ['unknown command', (h) => h.page.setData({ pending: { commandId: id(30) } })],
])
  test(`late team selection does nothing after ${name}`, () => {
    const h = scorer();
    h.page.teamStat({ currentTarget: { dataset: { kind: 'FOUL' } } });
    const reply = h.sheet().success;
    change(h);
    assert.doesNotThrow(() => reply({ tapIndex: 0 }));
    assert.deepEqual(h.commands, []);
  });

test('invalid team selection replies never become HOME commands', () => {
  for (const result of [
    null,
    undefined,
    {},
    { tapIndex: -1 },
    { tapIndex: 2 },
    { tapIndex: '0' },
  ]) {
    const h = scorer();
    h.page.teamStat({ currentTarget: { dataset: { kind: 'TIMEOUT' } } });
    assert.doesNotThrow(() => h.sheet().success(result));
    assert.deepEqual(h.commands, []);
  }
});

function supply() {
  const session = identity();
  const detail = deferred();
  let detailStarted = false;
  const rows = {
    [id(10)]: [{ id: id(20), title: '旧机构私有供给' }],
    [id(11)]: [{ id: id(21), title: '新机构私有供给' }],
  };
  const services = {
    KINDS: [],
    id: (value) => value,
    loadPending() {},
    repository: () => ({
      workspace: async (org) => rows[org],
      options: async (org) => ({
        providers: [{ id: id(40), name: org + '的提供者' }],
        courts: [{ id: id(41), name: org + '的球场' }],
      }),
      detail: (listing) => {
        if (listing === id(20)) {
          detailStarted = true;
          return detail.promise;
        }
        return Promise.resolve({ slots: [{ id: id(51) }] });
      },
    }),
  };
  const h = loadPage({
    root,
    route: 'pages/local-manage/index',
    wx: createWx(),
    modules: {
      './api': session.api,
      '../../utils/api': session.api,
      '../../utils/local-services': services,
    },
  });
  h.page.onLoad({ orgId: id(10) });
  return { ...h, ...session, detail, detailStarted: () => detailStarted };
}
function privateSupply(page) {
  return copy({
    orgId: page.data.orgId,
    listings: page.data.listings,
    providers: page.data.providers,
    courts: page.data.courts,
    overviewSlots: page.data.overviewSlots,
  });
}

for (const [name, change] of [
  ['session change', async (h) => h.switchUser()],
  [
    'organization change',
    async (h) => {
      h.page.org({ detail: { value: '2' } });
      await until(() => h.page.data.listings[0]?.id === id(21));
    },
  ],
  ['hide', async (h) => h.page.onHide()],
  ['unload', async (h) => h.page.onUnload()],
])
  for (const result of ['resolve', 'reject'])
    test(`old supply overview ${result} cannot restore private data after ${name}`, async () => {
      const h = supply();
      const pending = h.page.load();
      try {
        await until(h.detailStarted);
        await change(h);
        const before = privateSupply(h.page),
          updates = h.updates.length;
        if (result === 'resolve') h.detail.resolve({ slots: [{ id: id(50) }] });
        else h.detail.reject(Error('Old public overview is unavailable'));
        await pending;
        assert.deepEqual(privateSupply(h.page), before);
        assert.equal(h.updates.length, updates);
      } finally {
        h.detail.resolve({ slots: [] });
        await pending;
      }
    });

test('current supply overview failure preserves the current authorized workspace as a fallback', async () => {
  const h = supply();
  const pending = h.page.load();
  await until(h.detailStarted);
  h.detail.reject(Error('Current public overview is unavailable'));
  await pending;
  assert.equal(h.page.data.listings[0].id, id(20));
  assert.equal(h.page.data.providers[0].name, id(10) + '的提供者');
  assert.equal(h.page.data.courts[0].name, id(10) + '的球场');
  assert.deepEqual(copy(h.page.data.overviewSlots), []);
  assert.equal(h.page.data.loading, false);
});

test('current supply overview success keeps only its first two slots', async () => {
  const h = supply();
  const pending = h.page.load();
  await until(h.detailStarted);
  h.detail.resolve({ slots: [{ id: id(50) }, { id: id(51) }, { id: id(52) }] });
  await pending;
  assert.equal(h.page.data.listings[0].id, id(20));
  assert.deepEqual(copy(h.page.data.overviewSlots), [{ id: id(50) }, { id: id(51) }]);
  assert.equal(h.page.data.loading, false);
});
