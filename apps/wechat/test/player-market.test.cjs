const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const market = require('../utils/player-market');
const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const actor = id(900);
const profile = (n, changes = {}) => ({
  id: id(n),
  displayName: '合成球员' + n,
  userId: id(n + 500),
  position: 'PG',
  heightCm: 182,
  city: '高州 / 石鼓',
  bio: '合成服务介绍',
  priceFen: 30000,
  travelFen: 0,
  accommodationFen: 0,
  status: 'APPROVED',
  availability: [{ startAt: '2026-10-27T17:00:00Z', endAt: '2026-10-27T20:00:00Z' }],
  ...changes,
});
const performance = (n, changes = {}) => ({
  profileId: id(n),
  dataStatus: 'AVAILABLE',
  sourceCount: 1,
  recordedMatchCount: 5,
  completedServiceCount: 1,
  pointsPerRecordedMatch: 8.4,
  foulsPerRecordedMatch: 1.6,
  denominatorNotice: '固定名单样本不代表实际出场',
  completenessNotice: '合成有限授权记录',
  pendingMatchCount: 0,
  invalidMatchCount: 0,
  teamOnlyMatchCount: 0,
  partialAttributionMatchCount: 0,
  truncated: false,
  asOf: '2026-10-24T00:00:00Z',
  recentRecords: [],
  ...changes,
});
const filters = (changes = {}) => ({
  search: '',
  city: '',
  position: '',
  price: '',
  date: '',
  sort: '',
  samePrice: false,
  ...changes,
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(name, options = {}) {
  let page;
  let revision = 1;
  const calls = [];
  const nav = [];
  const workspace = {
    viewerUserId: actor,
    players: [profile(1), profile(2)],
    settings: { feeBps: 1000 },
  };
  const sdk = {
    workspace: async () => workspace,
    performances: async (ids) => {
      calls.push(ids);
      return {
        players: ids.map((v) => performance(Number(v.slice(-12)))),
        unavailableProfileIds: [],
      };
    },
    performance: async (value) => performance(Number(value.slice(-12))),
    ...options.sdk,
  };
  const ui = {
    async session(instance) {
      if (options.session) return options.session(instance);
      return { user: { id: actor } };
    },
    begin(instance) {
      instance._read = (instance._read || 0) + 1;
      return { revision, read: instance._read };
    },
    live(instance, token) {
      return (
        !!token && !instance._closed && token.read === instance._read && token.revision === revision
      );
    },
    close(instance) {
      instance._closed = true;
    },
    message(error) {
      return error.message || '操作失败';
    },
    localTime(value) {
      return value;
    },
    open(route, query) {
      nav.push({ route, query });
    },
    login(value) {
      nav.push({ login: value });
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages', name, 'index.js'), 'utf8'), {
    Page(value) {
      page = value;
    },
    require(value) {
      if (value.endsWith('/ui')) return ui;
      if (value.endsWith('/booking')) return sdk;
      if (value.endsWith('/player-market')) return market;
      throw new Error('Unexpected dependency: ' + value);
    },
    console,
  });
  const instance = {
    ...page,
    data: JSON.parse(JSON.stringify(page.data)),
    setData(value) {
      Object.assign(this.data, value);
    },
  };
  return {
    page: instance,
    sdk,
    ui,
    calls,
    nav,
    workspace,
    changeSession() {
      revision++;
    },
  };
}
beforeEach(() => {
  market.setViewer(actor);
  market.setSelected([]);
});

test('query IDs are limited to three unique UUIDs and never accept a URL or credential', () => {
  assert.deepEqual(market.parseIds(id(1) + ',' + id(2)), [id(1), id(2)]);
  for (const input of [
    id(1) + ',' + id(1),
    'https://elsewhere.test',
    [id(1)],
    [1, 2, 3, 4].map(id).join(','),
    'scb.sid=secret',
  ])
    assert.throws(() => market.parseIds(input));
});
test('selection never exceeds3, is pruned to approved catalog and resets on identity change', () => {
  [1, 2, 3].forEach((n) => market.toggle(id(n)));
  assert.throws(() => market.toggle(id(4)), /最多/);
  market.syncSelection([profile(1), profile(2, { status: 'DISABLED' })]);
  assert.deepEqual(market.selectedIds(), [id(1)]);
  market.setViewer(id(901));
  assert.deepEqual(market.selectedIds(), []);
});
test('money parsing is exact in fen and rejects malformed or hidden negative filters', () => {
  assert.equal(market.parseFen('0.01'), 1);
  assert.equal(market.parseFen('300.10'), 30010);
  assert.equal(market.parseFen(''), null);
  for (const v of ['-1', '1.001', '1e3', 'NaN']) assert.throws(() => market.parseFen(v));
});
test('date filter uses Beijing day boundaries rather than execution host time', () => {
  assert.deepEqual(market.dayRange('2026-10-28'), [
    Date.parse('2026-10-27T16:00:00Z'),
    Date.parse('2026-10-28T16:00:00Z'),
  ]);
  assert.throws(() => market.dayRange('2026-02-30'));
  const matches = market.filterPlayers(
    [
      profile(1),
      profile(2, {
        availability: [{ startAt: '2026-10-28T16:00:00Z', endAt: '2026-10-28T18:00:00Z' }],
      }),
    ],
    filters({ date: '2026-10-28' }),
  );
  assert.deepEqual(
    matches.players.map((p) => p.id),
    [id(1)],
  );
});
test('same fee/position plus name/city filters do not compare all-in estimate as service price', () => {
  const rows = [
    profile(1),
    profile(2, { travelFen: 8000 }),
    profile(3, { position: 'C' }),
    profile(4, { priceFen: 31000 }),
    profile(5, { status: 'DISABLED' }),
  ];
  const result = market.filterPlayers(
    rows,
    filters({ search: '合成球员', city: '石鼓', samePrice: true }),
    rows[0],
  );
  assert.deepEqual(
    result.players.map((p) => p.id),
    [id(1), id(2)],
  );
  assert.match(market.filterPlayers(rows, filters({ samePrice: true })).error, /先选择/);
  assert.match(market.filterPlayers(rows, filters({ price: 'oops' })).error, /金额/);
});
test('sorting does not mutate original server order', () => {
  const rows = [profile(1, { priceFen: 50000 }), profile(2, { priceFen: 10000 })];
  assert.deepEqual(
    market.filterPlayers(rows, filters({ sort: 'PRICE_ASC' })).players.map((p) => p.id),
    [id(2), id(1)],
  );
  assert.deepEqual(
    rows.map((p) => p.id),
    [id(1), id(2)],
  );
});
test('real0 is retained, absent metrics stay missing and incomplete records remain explicit', () => {
  const p = market.performanceView(
    performance(1, {
      pointsPerRecordedMatch: 0,
      foulsPerRecordedMatch: null,
      dataStatus: 'PARTIAL',
      recentRecords: [
        {
          recordKey: 'one',
          eventName: '合成赛事',
          date: '2026-10-20',
          format: 'ROUND_ROBIN',
          points: 0,
          fouls: null,
          collectionMode: 'TEAM_ONLY',
        },
      ],
    }),
  );
  assert.equal(p.points, '0');
  assert.equal(p.fouls, '未统计');
  assert.equal(p.status, '部分记录');
  assert.equal(p.records[0].points, '0');
  assert.equal(p.records[0].fouls, '未统计');
  assert.match(p.records[0].note, /仅球队/);
  assert.equal(market.performanceView(null, true).services, '暂不可用');
});
test('quoted fee uses service only and comparison keeps differing traffic cost visible', () => {
  const a = market.profileView(profile(1), 1000, performance(1));
  const b = market.profileView(profile(2, { travelFen: 8000 }), 1000, null, true);
  assert.equal(a.total, '¥330.00');
  assert.equal(b.total, '¥410.00');
  assert.equal(b.platformFee, '¥30.00');
  const table = market.comparisonRows([a, b]);
  assert.equal(table.columns[0].cells.find((c) => c.id === 'points').value, '8.4');
  assert.equal(table.columns[1].cells.find((c) => c.id === 'points').value, '暂不可用');
});
test('recent records are bounded to5 while sample denominator stays from server', () => {
  const rows = Array.from({ length: 8 }, (_, n) => ({
    recordKey: String(n),
    eventName: '合成',
    date: '2026-10-20',
    points: 1,
    fouls: 0,
    collectionMode: 'PLAYER_BASIC',
  }));
  const view = market.performanceView(
    performance(1, { recordedMatchCount: 100, truncated: true, recentRecords: rows }),
  );
  assert.equal(view.records.length, 5);
  assert.equal(view.sample, '100');
  assert.equal(view.truncated, true);
});

test('catalog loads only20 public statistics per batch and uses real workspace fee', async () => {
  const f = fixture('players');
  f.workspace.players = Array.from({ length: 45 }, (_, n) => profile(n + 1));
  await f.page.onShow();
  assert.equal(f.page.data.cards.length, 20);
  assert.equal(f.calls[0].length, 20);
  assert.equal(f.page.data.cards[0].total, '¥330.00');
  await f.page.more();
  assert.equal(f.page.data.cards.length, 40);
  assert.equal(
    f.calls.every((ids) => ids.length <= 20),
    true,
  );
});
test('catalog can recover after applying same fee without a selected anchor', async () => {
  const f = fixture('players');
  await f.page.onShow();
  f.page.samePriceChange({ detail: { value: ['same'] } });
  await f.page.applyFilters();
  assert.match(f.page.data.error, /先选择/);
  assert.equal(f.calls.length, 1);
  f.page.samePriceChange({ detail: { value: [] } });
  await f.page.applyFilters();
  assert.equal(f.page.data.error, '');
  assert.equal(f.page.data.cards.length, 2);
  assert.equal(f.calls.length, 2);
  f.page.detail({ currentTarget: { dataset: { id: id(1) } } });
  assert.equal(f.nav[0].route, 'player');
});
test('clearing invalid filters restores the loaded catalog without reentering the page', async () => {
  const f = fixture('players');
  await f.page.onShow();
  f.page.input({ currentTarget: { dataset: { field: 'price' } }, detail: { value: 'oops' } });
  await f.page.applyFilters();
  assert.match(f.page.data.error, /金额/);
  assert.equal(f.calls.length, 1);
  await f.page.clearFilters();
  assert.equal(f.page.data.error, '');
  assert.equal(f.page.data.filters.price, '');
  assert.equal(f.page.data.cards.length, 2);
  assert.equal(f.calls.length, 2);
});
test('correcting invalid filters after identity changes cannot revive cached catalog', async () => {
  const f = fixture('players');
  await f.page.onShow();
  f.page.samePriceChange({ detail: { value: ['same'] } });
  await f.page.applyFilters();
  assert.match(f.page.data.error, /先选择/);
  f.changeSession();
  f.page.samePriceChange({ detail: { value: [] } });
  await f.page.applyFilters();
  assert.match(f.page.data.error, /当前账号或资料已变化/);
  assert.equal(f.page.data.cards.length, 0);
  assert.equal(f.page._catalog.length, 0);
  await f.page.clearFilters();
  f.page.detail({ currentTarget: { dataset: { id: id(1) } } });
  assert.equal(f.page.data.cards.length, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.nav.length, 0);
});
test('catalog statistics failure clears prior metrics and never substitutes0', async () => {
  const f = fixture('players');
  await f.page.onShow();
  assert.equal(f.page.data.cards[0].performance.points, '8.4');
  f.sdk.performances = async () => {
    throw { message: '统计离线' };
  };
  await f.page.load();
  assert.equal(f.page.data.cards[0].performance.points, '暂不可用');
  assert.equal(f.page.data.statisticsError, '统计离线');
});
test('catalog unavailable profiles are removed from both cards and comparison IDs', async () => {
  market.setSelected([id(1), id(2)]);
  const f = fixture('players', {
    sdk: {
      performances: async () => ({ players: [performance(2)], unavailableProfileIds: [id(1)] }),
    },
  });
  await f.page.onShow();
  assert.deepEqual(
    Array.from(f.page.data.cards, (p) => p.id),
    [id(2)],
  );
  assert.deepEqual(market.selectedIds(), [id(2)]);
});
test('a hidden catalog cannot be revived by a late workspace response', async () => {
  const pending = deferred();
  const started = deferred();
  const f = fixture('players', {
    sdk: {
      workspace: () => {
        started.resolve();
        return pending.promise;
      },
    },
  });
  const reading = f.page.onShow();
  await started.promise;
  f.page.onHide();
  pending.resolve(f.workspace);
  await reading;
  assert.equal(f.page.data.cards.length, 0);
});
test('session change invalidates delayed statistics and all selection navigation', async () => {
  const pending = deferred();
  const started = deferred();
  const f = fixture('players', {
    sdk: {
      performances: () => {
        started.resolve();
        return pending.promise;
      },
    },
  });
  const reading = f.page.onShow();
  await started.promise;
  f.changeSession();
  pending.resolve({ players: [performance(1), performance(2)], unavailableProfileIds: [] });
  await reading;
  assert.equal(f.page.data.cards.length, 0);
  f.page.detail({ currentTarget: { dataset: { id: id(1) } } });
  assert.equal(f.nav.length, 0);
});
test('missing login never reads private catalog or renders fabricated profiles', async () => {
  let calls = 0;
  const f = fixture('players', {
    session: async (page) => {
      page.setData({ loginRequired: true });
      return null;
    },
    sdk: {
      workspace: async () => {
        calls++;
      },
    },
  });
  await f.page.onShow();
  assert.equal(calls, 0);
  assert.equal(f.page.data.cards.length, 0);
  assert.equal(f.page.data.loginRequired, true);
});
test('detail resets old statistics on read failure and keeps explicit finite denominator', async () => {
  const f = fixture('player');
  f.page.onLoad({ id: id(1) });
  await f.page.onShow();
  assert.equal(f.page.data.profile.performance.points, '8.4');
  f.sdk.performance = async () => {
    throw { status: 503, message: '读取失败' };
  };
  await f.page.load();
  assert.equal(f.page.data.profile.performance.points, '暂不可用');
  assert.match(f.page.data.profile.performance.denominator, /固定名单/);
});
test('detail unavailable profile removes selection and cannot continue booking', async () => {
  market.setSelected([id(1), id(2)]);
  const f = fixture('player', {
    sdk: {
      performance: async () => {
        throw { status: 404 };
      },
    },
  });
  f.page.onLoad({ id: id(1) });
  await f.page.onShow();
  assert.equal(f.page.data.profile, null);
  assert.deepEqual(market.selectedIds(), [id(2)]);
  f.page.book();
  assert.equal(f.nav.length, 0);
});
test('late404 from previous identity cannot remove current identity comparison choice', async () => {
  const pending = deferred();
  const started = deferred();
  const f = fixture('player', {
    sdk: {
      performance: () => {
        started.resolve();
        return pending.promise;
      },
    },
  });
  f.page.onLoad({ id: id(1) });
  const reading = f.page.onShow();
  await started.promise;
  f.changeSession();
  market.setViewer(id(901));
  market.setSelected([id(1), id(2)]);
  pending.reject({ status: 404 });
  await reading;
  assert.deepEqual(market.selectedIds(), [id(1), id(2)]);
  assert.equal(f.page.data.profile, null);
});
test('malformed detail URL never requests a workspace', async () => {
  let calls = 0;
  const f = fixture('player', {
    sdk: {
      workspace: async () => {
        calls++;
      },
    },
  });
  f.page.onLoad({ id: 'https://attacker.test/' });
  await f.page.onShow();
  await f.page.load();
  assert.equal(calls, 0);
});
test('comparison reads at most3 and labels missing metrics without invented scores', async () => {
  const f = fixture('compare');
  f.workspace.players.push(profile(3));
  f.page.onLoad({ ids: [1, 2, 3].map(id).join(',') });
  await f.page.onShow();
  assert.equal(f.page.data.columns.length, 3);
  assert.equal(f.calls[0].length, 3);
  assert.equal(f.page.data.columnsWidth, '375px');
  assert.equal(f.page.data.tableHeight, '456px');
  assert.deepEqual(
    Array.from(f.page.data.labels, (row) => row.id),
    ['price', 'total', 'sample', 'points', 'fouls', 'services', 'status'],
  );
  assert.equal(f.page.data.profiles[0].platformFee, '¥30.00');
  assert.equal(f.page.data.profiles[0].travel, '¥0.00');
  f.sdk.performances = async () => {
    throw { message: '数据服务失败' };
  };
  await f.page.load();
  assert.equal(f.page.data.columns[0].cells.find((c) => c.id === 'points').value, '暂不可用');
});
test('comparison revalidates approved profiles and prevents use after removal leaves1', async () => {
  const f = fixture('compare');
  f.workspace.players[1].status = 'DISABLED';
  f.page.onLoad({ ids: id(1) + ',' + id(2) });
  await f.page.onShow();
  assert.equal(f.page.data.columns.length, 0);
  assert.equal(f.page.data.selectedCount, 1);
  assert.match(f.page.data.error, /至少选择2位/);
  f.page.book({ currentTarget: { dataset: { id: id(1) } } });
  assert.equal(f.nav.length, 0);
});
test('comparison hides private-derived catalog after actor change before workspace returns', async () => {
  const pending = deferred();
  const started = deferred();
  const f = fixture('compare', {
    sdk: {
      workspace: () => {
        started.resolve();
        return pending.promise;
      },
    },
  });
  f.page.onLoad({ ids: id(1) + ',' + id(2) });
  const reading = f.page.onShow();
  await started.promise;
  f.changeSession();
  pending.resolve(f.workspace);
  await reading;
  assert.equal(f.page.data.columns.length, 0);
});
