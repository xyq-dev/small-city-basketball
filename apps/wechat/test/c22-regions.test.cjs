const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const regions = require('../utils/regions');
const { pathAllowed } = require('../utils/api');
const root = path.resolve(__dirname, '..');
// Synthetic identities deliberately have no dependency on the packaged production catalog.
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const version = 'synthetic-2025-v1';
const catalog = () => ({
  catalogVersion: version,
  dataDate: '2025-12-31',
  partialRootIds: [id(10)],
  regions: [
    [1, null, '广东省', 'PROVINCE'],
    [2, 1, '茂名市', 'PREFECTURE'],
    [3, 2, '高州市', 'COUNTY'],
    [4, 1, '东莞市', 'PREFECTURE'],
    [5, null, '北京市', 'PROVINCE'],
    [6, 5, '朝阳区', 'COUNTY'],
    [7, null, '吉林省', 'PROVINCE'],
    [8, 7, '长春市', 'PREFECTURE'],
    [9, 8, '朝阳区', 'COUNTY'],
    [10, null, '香港特别行政区', 'PROVINCE'],
    [11, null, '河南省', 'PROVINCE'],
    [12, 11, '济源市', 'COUNTY'],
  ].map(([n, p, name, level]) => ({ id: id(n), parentId: p === null ? null : id(p), name, level })),
});
const selected = (n = 3, v = version) => ({
  ...regions.selection(regions.validate(catalog()), id(n)),
  catalogVersion: v,
});
const tap = (idOrData = {}, value = '') => ({
  currentTarget: { dataset: typeof idOrData === 'number' ? { id: id(idOrData) } : idOrData },
  detail: { value },
});
const ok = (data, nextCursor = null) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-c22', nextCursor } },
  header: { 'Set-Cookie': 'scb.sid=' + 'a'.repeat(43) + '; Path=/' },
});
const fail = (statusCode, code) => ({
  statusCode,
  data: { error: { code, message: '合成错误 ' + code } },
});
const row = (letter) => ({
  publicEventId: letter.repeat(43),
  name: '合成赛事' + letter,
  startDate: '2028-05-01',
  endDate: '2028-05-03',
  venueName: '合成体育馆',
  status: 'RUNNING',
  purpose: 'LIVE',
  displayCity: '高州',
});
const ticks = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { resolve, promise };
};
const json = (v) => JSON.parse(JSON.stringify(v));
const V2 = 'scb.browseRegion.v2',
  V1 = 'scb.browseCity.v1';
function device({ storage = new Map(), request } = {}) {
  const app = { globalData: {} };
  const wx = createWx({
    storage,
    request: (options) => {
      const url = new URL(options.url);
      if (request) {
        const r = request(options, url);
        if (r !== undefined) return r;
      }
      if (url.pathname === '/v1/public/regions') return ok(catalog());
      if (url.pathname === '/v1/public/directory') return ok([]);
      return fail(404, 'TEST_UNHANDLED');
    },
  });
  wx.getLocation = wx.getFuzzyLocation = () => {
    throw new Error('No device location is permitted');
  };
  return {
    wx,
    storage,
    open(name, query = {}) {
      const h = loadPage({
        root,
        route: 'pages/' + name + '/index',
        wx,
        globals: { getApp: () => app, getCurrentPages: () => [{}, {}] },
      });
      h.page.onLoad?.(query);
      h.page.onShow?.();
      return h;
    },
  };
}
const publicCalls = (d) =>
  d.wx.calls.filter((c) => c.type === 'request' && c.url.includes('/v1/public/directory'));

test('region API allowlist enforces no catalog query, paired region filter and legacy separation', () => {
  for (const url of [
    '/v1/public/regions',
    '/v1/public/directory?regionId=' + id(3) + '&catalogVersion=' + version,
  ])
    assert.equal(pathAllowed(url, 'GET'), true, url);
  for (const url of [
    '/v1/public/regions?',
    '/v1/public/regions?city=x',
    '/v1/public/regions/extra',
    '/v1/public/directory?regionId=' + id(3),
    '/v1/public/directory?catalogVersion=' + version,
    '/v1/public/directory?regionId=' + id(3) + '&catalogVersion=' + version + '&city=高州',
  ])
    assert.equal(pathAllowed(url, 'GET'), false, url);
  assert.equal(pathAllowed('/v1/public/regions', 'POST'), false);
});

test('catalog parser keeps true two-level/direct-county/leaf structure and distinct names', () => {
  const c = regions.validate(catalog());
  assert.equal(c.index[id(3)].path, '广东省 / 茂名市 / 高州市');
  assert.equal(c.index[id(6)].path, '北京市 / 朝阳区');
  assert.equal(c.index[id(12)].path, '河南省 / 济源市');
  assert.equal(c.index[id(4)].hasChildren, false);
  assert.equal(c.index[id(10)].partial, true);
  assert.equal(c.nodes.filter((r) => r.name === '朝阳区').length, 2);
  assert.equal(
    c.nodes.some((r) => r.name === '市辖区'),
    false,
  );
});
for (const [name, mutate] of [
  ['missing parent', (c) => (c.regions[2].parentId = id(999))],
  ['duplicate node', (c) => c.regions.push(c.regions[0])],
  ['cyclic parent', (c) => (c.regions[1].parentId = id(3))],
  ['orphan county', (c) => (c.regions[2].parentId = null)],
  ['unknown field', (c) => (c.regions[0].coordinates = [1, 2])],
  ['bad version', (c) => (c.catalogVersion = 'bad/version')],
  ['partial county', (c) => (c.partialRootIds = [id(3)])],
  ['duplicate partial', (c) => (c.partialRootIds = [id(10), id(10)])],
  ['unknown root field', (c) => (c.total = 2)],
])
  test('invalid complete catalog is rejected: ' + name, () => {
    const c = catalog();
    mutate(c);
    assert.throws(() => regions.validate(c), /目录资料无效/);
  });

test('catalog read is anonymous and hostile Set-Cookie cannot alter a signed-in session', async () => {
  const d = device({
    request: (o, u) =>
      u.pathname === '/v1/auth/session'
        ? ok({
            user: { id: id(90), email: 'a@example.test', displayName: '合成用户' },
            organizations: [],
            teamContexts: [],
          })
        : undefined,
  });
  const h = d.open('city-select');
  await h.flush();
  const client = h.requireLocal('utils/api.js').getClient();
  await client.request('/v1/auth/session');
  const rev = client.sessionRevision();
  assert.equal(client.hasSession(), true);
  await h.page.loadCatalog();
  const read = d.wx.calls
    .filter((c) => c.type === 'request' && c.url.endsWith('/v1/public/regions'))
    .at(-1);
  assert.equal(
    Object.keys(read.header).some((k) => k.toLowerCase() === 'cookie'),
    false,
  );
  assert.equal(client.hasSession(), true);
  assert.equal(client.sessionRevision(), rev);
});

test('picker searches ambiguous names with complete paths and traverses real children', async () => {
  const d = device();
  const p = d.open('city-select');
  await p.flush();
  assert.ok(p.page.data.rows.every((n) => n.level === 'PROVINCE'));
  p.page.searchRegion(tap({}, '朝阳'));
  assert.equal(p.page.data.rows.length, 2);
  const html = buildPreview({ root, route: p.page.route, data: p.page.data }).phone;
  assert.match(html, /北京市 \/ 朝阳区/);
  assert.match(html, /吉林省 \/ 长春市 \/ 朝阳区/);
  p.page.browseRegion(tap(1));
  assert.deepEqual(
    p.page.data.rows.map((n) => n.id),
    [id(2), id(4)],
  );
  p.page.browseRegion(tap(2));
  assert.equal(p.page.data.rows[0].id, id(3));
  p.page.chooseParent();
  assert.equal(d.storage.get(V2).selected.regionId, id(2));
  p.page.rootRegions();
  p.page.browseRegion(tap(5));
  assert.equal(p.page.data.rows[0].id, id(6));
  p.page.rootRegions();
  p.page.browseRegion(tap(10));
  assert.equal(p.page.data.partial, true);
  assert.equal(p.page.data.rows.length, 0);
  assert.match(
    buildPreview({ root, route: p.page.route, data: p.page.data }).phone,
    /尚未收录下级/,
  );
});

test('full catalog search has bounded rendering but all candidates remain reachable', async () => {
  const c = catalog();
  for (let n = 100; n < 155; n++)
    c.regions.push({ id: id(n), parentId: id(1), name: '合成区县' + n, level: 'COUNTY' });
  const d = device({
    request: (_o, u) => (u.pathname === '/v1/public/regions' ? ok(c) : undefined),
  });
  const p = d.open('city-select');
  await p.flush();
  p.page.searchRegion(tap({}, '合成区县'));
  assert.equal(p.page.data.rows.length, 40);
  assert.equal(p.page.data.hasMore, true);
  p.page.moreRegions();
  assert.equal(p.page.data.rows.length, 55);
  assert.equal(p.page.data.hasMore, false);
  p.page.selectRegion(tap(154));
  assert.equal(d.storage.get(V2).selected.regionId, id(154));
});
for (const city of ['高州', '高州市', '朝阳区', '未知城'])
  test('legacy preference stays exact and never guesses a region: ' + city, async () => {
    const old = { version: 1, selected: city, chosen: true, recent: [city] };
    const d = device({ storage: new Map([[V1, old]]) });
    const p = d.open('city-select');
    await p.flush();
    assert.equal(p.page.data.mode, 'LEGACY_CITY');
    assert.equal(p.page.data.city, city);
    assert.equal(d.storage.has(V2), false);
    assert.deepEqual(d.storage.get(V1), old);
    const h = d.open('home');
    await h.flush();
    const url = new URL(publicCalls(d).at(-1).url);
    assert.equal(url.searchParams.get('city'), city);
    assert.equal(url.searchParams.has('regionId'), false);
    p.page.searchRegion(tap({}, '高州'));
    assert.equal(p.page.data.mode, 'LEGACY_CITY');
    p.page.selectRegion(tap(3));
    assert.equal(d.storage.get(V2).selected.mode, 'REGION');
    assert.deepEqual(d.storage.get(V1), old);
  });

test('corrupt v2 restores valid v1, sanitizes extra fields, bounds recent and clears both histories', async () => {
  const storage = new Map([
    [V2, { version: 2, selected: { mode: 'REGION', regionId: 'bad' }, chosen: true }],
    [V1, { version: 1, selected: '高州', chosen: true, recent: ['高州'] }],
    ['unrelated-private', { keep: true }],
  ]);
  const d = device({ storage });
  const p = d.open('city-select');
  await p.flush();
  const pref = p.requireLocal('utils/city-preference.js');
  assert.equal(pref.snapshot().mode, 'LEGACY_CITY');
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8])
    pref.chooseSelection({ ...selected(n), privateAccount: 'never-save' });
  pref.chooseSelection(selected(3));
  assert.equal(pref.snapshot().recentChoices.length, 6);
  assert.equal(pref.snapshot().recentChoices[0].regionId, id(3));
  assert.equal(JSON.stringify(storage.get(V2)).includes('privateAccount'), false);
  pref.clearRecent();
  assert.deepEqual(storage.get(V2).recent, []);
  assert.deepEqual(storage.get(V1).recent, []);
  assert.equal(storage.get(V2).selected.regionId, id(3));
  assert.deepEqual(storage.get('unrelated-private'), { keep: true });
});

test('failed v2 save is temporary and partial legacy history clearing failure is disclosed', async () => {
  const old = { version: 1, selected: '高州', chosen: true, recent: ['高州'] };
  const d = device({ storage: new Map([[V1, old]]) });
  const p = d.open('city-select');
  await p.flush();
  const pref = p.requireLocal('utils/city-preference.js'),
    save = d.wx.setStorageSync;
  d.wx.setStorageSync = () => {
    throw new Error('disk full');
  };
  pref.chooseSelection(selected());
  assert.equal(pref.snapshot().mode, 'REGION');
  assert.match(pref.snapshot().warning, /无法保存/);
  assert.equal(
    device({ storage: d.storage }).open('home').page.data.citySelection.mode,
    'LEGACY_CITY',
  );
  d.wx.setStorageSync = (k, v) => {
    if (k === V1) throw new Error('legacy blocked');
    save(k, v);
  };
  const after = pref.clearRecent();
  assert.match(after.warning, /无法保存/);
  assert.deepEqual(d.storage.get(V2).recent, []);
  assert.deepEqual(d.storage.get(V1).recent, ['高州']);
});

test('saved region with changed catalog requires explicit reconfirmation and retains original selection', async () => {
  const saved = selected(3, 'synthetic-old');
  const d = device({
    storage: new Map([[V2, { version: 2, selected: saved, chosen: true, recent: [saved] }]]),
  });
  const p = d.open('city-select');
  await p.flush();
  assert.match(p.page.data.versionNote, /地区目录已更新/);
  p.page.pickRecent(tap({ key: 'region:' + id(3) }));
  assert.equal(d.storage.get(V2).selected.catalogVersion, 'synthetic-old');
  assert.match(p.page.data.versionNote, /重新选择确认/);
  assert.equal(
    d.wx.calls.some((c) => c.type === 'navigateBack'),
    false,
  );
  p.page.selectRegion(tap(3));
  assert.equal(d.storage.get(V2).selected.catalogVersion, version);
});

test('retired saved region is retained with a reselect/nationwide notice', async () => {
  const saved = { ...selected(), regionId: id(999) };
  const d = device({
    storage: new Map([[V2, { version: 2, selected: saved, chosen: true, recent: [saved] }]]),
  });
  const p = d.open('city-select');
  await p.flush();
  p.page.pickRecent(tap({ key: 'region:' + id(999) }));
  assert.match(p.page.data.error, /暂不可用/);
  assert.equal(d.storage.get(V2).selected.regionId, id(999));
});

test('home and watch share explicit region filters, nationwide resets without using a city label', async () => {
  const d = device({
    request: (_o, u) => (u.pathname === '/v1/public/directory' ? ok([row('a')]) : undefined),
  });
  const p = d.open('city-select');
  await p.flush();
  p.page.selectRegion(tap(2));
  const home = d.open('home'),
    watch = d.open('watch');
  await home.flush();
  for (const call of publicCalls(d)) {
    const q = new URL(call.url).searchParams;
    assert.equal(q.get('regionId'), id(2));
    assert.equal(q.get('catalogVersion'), version);
    assert.equal(q.has('city'), false);
  }
  assert.equal(home.page.data.citySelection.label, '广东省 / 茂名市');
  assert.equal(watch.page.data.citySelection.mode, 'REGION');
  home.page.nationwide();
  await home.flush();
  assert.equal(new URL(publicCalls(d).at(-1).url).searchParams.has('regionId'), false);
  watch.page.onShow();
  await watch.flush();
  assert.equal(watch.page.data.citySelection.mode, 'NATIONWIDE');
});

for (const name of ['home', 'watch'])
  test(name + ': late first-page response cannot replace the newer region', async () => {
    const old = deferred();
    const d = device({
      request: (_o, u) =>
        u.pathname === '/v1/public/directory'
          ? u.searchParams.get('regionId') === id(2)
            ? old.promise
            : ok([row('b')])
          : undefined,
    });
    const p = d.open('city-select');
    await p.flush();
    p.page.selectRegion(tap(2));
    const h = d.open(name);
    await ticks();
    p.page.selectRegion(tap(3));
    h.page.onShow();
    await ticks();
    old.resolve(ok([row('a')]));
    await h.flush();
    const items = name === 'home' ? h.page.data.publicEvents : h.page.data.dir.items;
    assert.deepEqual(
      items.map((i) => i.publicEventId),
      ['b'.repeat(43)],
    );
    assert.equal(h.page.data.citySelection.regionId, id(3));
  });

test('watch region switch resets the cursor and discards a late next page', async () => {
  const late = deferred();
  const d = device({
    request: (_o, u) =>
      u.pathname === '/v1/public/directory'
        ? u.searchParams.has('cursor')
          ? late.promise
          : ok([row(u.searchParams.get('regionId') === id(2) ? 'a' : 'b')], 'cursor_one')
        : undefined,
  });
  const p = d.open('city-select');
  await p.flush();
  p.page.selectRegion(tap(2));
  const w = d.open('watch');
  await w.flush();
  const pending = w.page.loadMoreDirectory();
  await ticks();
  p.page.selectRegion(tap(3));
  w.page.onShow();
  await ticks();
  late.resolve(ok([row('z')]));
  await pending;
  await w.flush();
  assert.deepEqual(
    w.page.data.dir.items.map((i) => i.publicEventId),
    ['b'.repeat(43)],
  );
  const calls = publicCalls(d);
  assert.equal(new URL(calls.at(-1).url).searchParams.has('cursor'), false);
  assert.equal(new URL(calls.at(-1).url).searchParams.get('regionId'), id(3));
});
for (const code of ['INVALID_CURSOR', 'REGION_CATALOG_CHANGED', 'INVALID_REGION'])
  test(
    'watch failed pagination ' +
      code +
      ' preserves rows but invalidates cursor until explicit restart',
    async () => {
      const d = device({
        request: (_o, u) =>
          u.pathname === '/v1/public/directory'
            ? u.searchParams.has('cursor')
              ? fail(code === 'REGION_CATALOG_CHANGED' ? 409 : 400, code)
              : ok([row('a')], 'cursor_one')
            : undefined,
      });
      const p = d.open('city-select');
      await p.flush();
      p.page.selectRegion(tap(2));
      const w = d.open('watch');
      await w.flush();
      await w.page.loadMoreDirectory();
      assert.equal(w.page.data.dir.items.length, 1);
      assert.match(w.page.data.dir.moreError, /已显示的 1 届保留/);
      assert.equal(w.page._dirCursor, null);
      const count = publicCalls(d).length;
      await w.page.loadMoreDirectory();
      assert.equal(publicCalls(d).length, count);
      await w.page.loadDirectory();
      assert.equal(publicCalls(d).length, count + 1);
      assert.equal(new URL(publicCalls(d).at(-1).url).searchParams.has('cursor'), false);
    },
  );

test('stale region error never silently falls back to nationwide or old city text', async () => {
  const d = device({
    request: (_o, u) =>
      u.pathname === '/v1/public/directory' ? fail(409, 'REGION_CATALOG_CHANGED') : undefined,
  });
  const p = d.open('city-select');
  await p.flush();
  p.page.selectRegion(tap(3));
  const h = d.open('home'),
    w = d.open('watch');
  await h.flush();
  assert.match(h.page.data.publicError, /地区目录已更新/);
  assert.match(w.page.data.dir.error, /地区目录已更新/);
  assert.equal(publicCalls(d).length, 2);
  assert.ok(publicCalls(d).every((c) => new URL(c.url).searchParams.get('regionId') === id(3)));
});
for (const mode of ['hide', 'unload'])
  test('picker ' + mode + ' discards late catalog and cannot save selection', async () => {
    const late = deferred();
    const d = device({
      request: (_o, u) => (u.pathname === '/v1/public/regions' ? late.promise : undefined),
    });
    const p = d.open('city-select');
    await ticks();
    if (mode === 'hide') p.page.onHide();
    else p.unload();
    const count = p.updates.length;
    late.resolve(ok(catalog()));
    await p.flush();
    assert.equal(p.updates.length, count);
    p.page.selectRegion(tap(3));
    assert.equal(d.storage.has(V2), false);
  });

// Organizer tests drive the actual event channel and request/confirmation guards.
const org = id(70),
  eventId = id(71),
  listingId = id(72),
  userA = id(80),
  userB = id(81),
  evBase = '/v1/orgs/' + org + '/events/' + eventId;
async function organizer({ listed = true, command } = {}) {
  const state = {
    listed,
    eventVersion: 4,
    listingId,
    publicEventId: 'p'.repeat(43),
    catalogVersion: version,
    region: null,
    writes: [],
    modal: null,
    who: userA,
  };
  const d = device({
    request: (o, u) => {
      const key = (o.method || 'GET') + ' ' + u.pathname;
      const session = () => ({
        user: { id: state.who, email: 'owner@example.test', displayName: '合成管理' },
        organizations: [{ id: org, name: '合成机构', role: 'ORG_OWNER' }],
        teamContexts: [],
      });
      if (u.pathname === '/v1/auth/session') return ok(session());
      if (key === 'POST /v1/auth/login') {
        state.who = userB;
        return ok(session());
      }
      if (key === 'GET ' + evBase && state.pendingEventRead) return state.pendingEventRead.promise;
      if (key === 'GET ' + evBase)
        return ok({
          id: eventId,
          name: '合成赛事',
          startDate: '2028-03-01',
          endDate: '2028-03-02',
          venueName: '合成馆',
          format: 'ROUND_ROBIN',
          status: 'SCHEDULED',
          version: state.eventVersion,
          permissions: { canEditDraft: false },
        });
      if (key === 'GET ' + evBase + '/registration')
        return ok({ rules: null, capabilities: { canManageRules: false } });
      if (key === 'GET ' + evBase + '/scoring')
        return ok({ rules: null, locked: false, capabilities: { canManageRules: false } });
      if (key === 'GET ' + evBase + '/standings')
        return ok({
          rules: null,
          locked: true,
          publication: { publicEventId: state.publicEventId, status: 'ACTIVE', purpose: 'LIVE' },
          capabilities: {
            canManageRules: false,
            canPublishRules: false,
            canEnablePublicViewing: false,
            canDisablePublicViewing: true,
          },
        });
      if (key === 'GET ' + evBase + '/directory')
        return ok({
          event: { id: eventId, status: 'SCHEDULED', version: state.eventVersion },
          publication: { publicEventId: state.publicEventId, status: 'ACTIVE', purpose: 'LIVE' },
          listing: state.listed
            ? {
                id: state.listingId,
                status: 'ACTIVE',
                publicEventId: state.publicEventId,
                displayCity: '高州',
                region: state.region,
                listedAt: '2026-10-28T01:00:00Z',
                revokedAt: null,
                revokeSource: null,
              }
            : null,
          lastListing: null,
          group: 'UPCOMING',
          regionCatalogVersion: state.catalogVersion,
          capabilities: {
            canList: !state.listed,
            canUnlist: state.listed,
            canReplaceRegion: state.listed,
          },
        });
      if (key === 'POST ' + evBase + '/directory-commands') {
        state.writes.push(json(o.data));
        if (command) return command(state, o.data);
        state.listed = o.data.type !== 'UNLIST';
        state.eventVersion++;
        state.listingId = id(73);
        state.region = o.data.region || null;
        return ok({ ok: true });
      }
    },
  });
  d.wx.showModal = (m) => (state.modal = m);
  const h = loadPage({ root, route: 'pages/event-setup/index', wx: d.wx });
  const client = h.requireLocal('utils/api.js').getClient();
  await client.request('/v1/auth/session');
  h.page.onLoad({ orgId: org, eventId });
  h.page.onShow?.();
  await h.flush();
  return {
    d,
    p: { ...h, client },
    state,
    answer(confirm) {
      const m = state.modal;
      state.modal = null;
      m.success({ confirm, cancel: !confirm });
    },
    async pick(n = 3) {
      h.page.chooseDirectoryRegion();
      const nav = d.wx.calls.filter((c) => c.type === 'navigateTo').at(-1);
      assert.match(nav.url, /context=directory/);
      const picker = d.open('city-select', { context: 'directory' });
      picker.page.getOpenerEventChannel = () => ({
        emit: (name, value) => nav.events[name](value),
      });
      await picker.flush();
      picker.page.selectRegion(tap(n));
      return picker;
    },
  };
}
async function invalidate(p, kind) {
  if (kind === 'switch') await p.client.request('/v1/auth/login', 'POST', {});
  if (kind === 'logout') p.client.clearSession();
  if (kind === 'unload') p.unload();
}
const start = (p, type) => {
  p.page.directoryReasonInput(tap({}, '确认公开赛事归属地区'));
  return type === 'LIST' ? p.page.listDirectory() : p.page.replaceDirectoryRegion();
};

test('organizer selection only updates its form and browsing selection only updates browsing', async () => {
  const o = await organizer();
  const browse = o.d.open('city-select');
  await browse.flush();
  browse.page.selectRegion(tap(5));
  await o.pick(3);
  assert.equal(o.p.page.data.directory.selectedRegion.regionId, id(3));
  assert.equal(o.d.storage.get(V2).selected.regionId, id(5));
  browse.page.selectRegion(tap(1));
  assert.equal(o.p.page.data.directory.selectedRegion.regionId, id(3));
  assert.equal(o.d.storage.get(V2).selected.regionId, id(1));
  assert.equal(o.state.writes.length, 0);
});
for (const kind of [
  'switch',
  'logout',
  'unload',
  'event-version',
  'listing',
  'publication',
  'superseded',
  'catalog-version',
])
  test('organizer rejects stale picker return: ' + kind, async () => {
    const o = await organizer();
    o.p.page.chooseDirectoryRegion();
    const nav = o.d.wx.calls.filter((c) => c.type === 'navigateTo').at(-1);
    await invalidate(o.p, kind);
    if (kind === 'event-version') o.state.eventVersion++;
    if (kind === 'listing') o.state.listingId = id(79);
    if (kind === 'publication') o.state.publicEventId = 'q'.repeat(43);
    if (kind === 'catalog-version') o.state.catalogVersion = 'synthetic-new';
    if (['event-version', 'listing', 'publication', 'catalog-version'].includes(kind))
      await o.p.page.load();
    if (kind === 'superseded') o.p.page.chooseDirectoryRegion();
    nav.events.regionSelected(selected());
    assert.ok(!o.p.page.data.directory?.selectedRegion);
    assert.equal(o.state.writes.length, 0);
  });
for (const type of ['LIST', 'REPLACE_REGION']) {
  for (const kind of [
    'switch',
    'logout',
    'unload',
    'event-version',
    'listing',
    'publication',
    'catalog-version',
    'selection',
  ])
    test(type + ' late confirmation ' + kind + ' sends zero writes', async () => {
      const o = await organizer({ listed: type !== 'LIST' });
      await o.pick(3);
      const pending = start(o.p, type);
      await ticks();
      assert.ok(o.state.modal);
      await invalidate(o.p, kind);
      if (kind === 'event-version') o.state.eventVersion++;
      if (kind === 'listing') {
        o.state.listed = true;
        o.state.listingId = id(79);
      }
      if (kind === 'publication') o.state.publicEventId = 'q'.repeat(43);
      if (kind === 'catalog-version') o.state.catalogVersion = 'synthetic-new';
      if (['event-version', 'listing', 'publication', 'catalog-version'].includes(kind))
        await o.p.page.load();
      if (kind === 'selection') await o.pick(2);
      o.answer(true);
      await pending;
      assert.equal(o.state.writes.length, 0);
    });
  test(
    type + ' normal/cancel sends at most once with selected version and no displayCity',
    async () => {
      const o = await organizer({ listed: type !== 'LIST' });
      await o.pick(3);
      let pending = start(o.p, type);
      await ticks();
      o.answer(false);
      await pending;
      assert.equal(o.state.writes.length, 0);
      pending = start(o.p, type);
      await ticks();
      assert.match(o.state.modal.content, /广东省 \/ 茂名市 \/ 高州市/);
      if (type === 'REPLACE_REGION') assert.match(o.state.modal.content, /原公开标签：高州/);
      o.answer(true);
      await pending;
      await o.p.flush();
      assert.equal(o.state.writes.length, 1);
      assert.deepEqual(o.state.writes[0], {
        type,
        expectedEventVersion: 4,
        reason: '确认公开赛事归属地区',
        region: { catalogVersion: version, regionId: id(3) },
        ...(type === 'REPLACE_REGION' ? { expectedListingId: listingId } : {}),
      });
      assert.equal(o.p.page._directory.publication.publicEventId, 'p'.repeat(43));
      assert.equal(o.p.page._directory.listing.id, id(73));
    },
  );
}

test('region correction lost response is unknown; reread discovers new listing without resending', async () => {
  const o = await organizer({
    command: (s, body) => {
      s.listingId = id(73);
      s.eventVersion++;
      s.region = body.region;
      return Promise.reject(new Error('response lost'));
    },
  });
  await o.pick(3);
  const pending = start(o.p, 'REPLACE_REGION');
  await ticks();
  o.answer(true);
  await pending;
  assert.match(o.p.page.data.error, /结果未知/);
  assert.equal(o.state.writes.length, 1);
  await o.p.page.load();
  assert.equal(o.p.page._directory.listing.id, id(73));
  assert.equal(o.p.page._event.version, 5);
  assert.equal(o.state.writes.length, 1);
});

test('catalog changed response clears selected region and keeps the reason for explicit reselect', async () => {
  const o = await organizer({
    command: (s) => {
      s.catalogVersion = 'synthetic-new';
      return fail(409, 'REGION_CATALOG_CHANGED');
    },
  });
  await o.pick(3);
  const pending = start(o.p, 'REPLACE_REGION');
  await ticks();
  o.answer(true);
  await pending;
  await o.p.flush();
  assert.equal(o.p.page.data.directory.selectedRegion, null);
  assert.equal(o.p.page.data.directory.reason, '确认公开赛事归属地区');
  assert.match(o.p.page.data.error, /地区目录已更新/);
  assert.equal(o.state.writes.length, 1);
});

test('organizer picker never writes browser history and a missing return channel is an error', async () => {
  const d = device();
  const p = d.open('city-select', { context: 'directory' });
  await p.flush();
  p.page.selectRegion(tap(3));
  assert.match(p.page.data.error, /选地入口已失效/);
  assert.equal(d.storage.has(V2), false);
  p.page.nationwide();
  p.page.inputCity(tap({}, '高州'));
  p.page.apply();
  assert.equal(d.storage.has(V2), false);
});

for (const kind of ['switch', 'logout', 'unload'])
  test('organizer picker itself rejects ' + kind + ' before emitting any result', async () => {
    let who = id(90);
    const d = device({
      request: (o, u) => {
        if (u.pathname === '/v1/auth/login') who = id(91);
        if (['/v1/auth/login', '/v1/auth/session'].includes(u.pathname))
          return ok({
            user: { id: who, email: 'user@example.test', displayName: '合成用户' },
            organizations: [],
            teamContexts: [],
          });
      },
    });
    const p = d.open('city-select', { context: 'directory' });
    const client = p.requireLocal('utils/api.js').getClient();
    await client.request('/v1/auth/session');
    p.page.onLoad({ context: 'directory' });
    await p.flush();
    let emits = 0;
    p.page.getOpenerEventChannel = () => ({ emit: () => emits++ });
    if (kind === 'switch') await client.request('/v1/auth/login', 'POST', {});
    if (kind === 'logout') client.clearSession();
    if (kind === 'unload') p.unload();
    p.page.selectRegion(tap(3));
    assert.equal(emits, 0);
    assert.equal(d.storage.has(V2), false);
  });

test('saved standard listing shows its current full path after reread', async () => {
  const o = await organizer();
  await o.pick(3);
  const pending = start(o.p, 'REPLACE_REGION');
  await ticks();
  o.answer(true);
  await pending;
  await o.p.flush();
  assert.equal(o.p.page.data.directory.currentRegionLabel, '广东省 / 茂名市 / 高州市（标准地区）');
  o.state.region = { catalogVersion: 'old', regionId: id(999) };
  await o.p.page.load();
  await o.p.flush();
  assert.match(o.p.page.data.directory.currentRegionLabel, /已不在当前目录/);
});

for (const result of ['cancel', 'return'])
  test(
    'opening organizer picker during refresh preserves the pending read: ' + result,
    async () => {
      const o = await organizer();
      const event = json(o.p.page._event);
      const late = deferred();
      o.state.pendingEventRead = late;
      const pending = o.p.page.load();
      await ticks();
      assert.equal(o.p.page.data.loading, true);
      o.p.page.chooseDirectoryRegion();
      const nav = o.d.wx.calls.filter((c) => c.type === 'navigateTo').at(-1);
      if (result === 'return') nav.events.regionSelected(selected());
      delete o.state.pendingEventRead;
      late.resolve(ok(event));
      await pending;
      await o.p.flush();
      assert.equal(o.p.page.data.loading, false);
      assert.equal(o.state.writes.length, 0);
      if (result === 'return') assert.equal(o.p.page.data.directory.selectedRegion.regionId, id(3));
      else assert.equal(o.p.page.data.directory.selectedRegion, null);
      const reads = o.d.wx.calls.filter(
        (c) => c.type === 'request' && c.url.endsWith(evBase),
      ).length;
      await o.p.page.load();
      await o.p.flush();
      assert.equal(
        o.d.wx.calls.filter((c) => c.type === 'request' && c.url.endsWith(evBase)).length,
        reads + 1,
      );
    },
  );
