const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const KEY = 'scb.browseCity.v1';
const V2_KEY = 'scb.browseRegion.v2';
const tap = (dataset = {}, value = '') => ({ currentTarget: { dataset }, detail: { value } });
const reply = (data = [], nextCursor = null) => ({
  statusCode: 200,
  data: { data, meta: { nextCursor, requestId: 'synthetic-c20' } },
  header: { 'Set-Cookie': 'scb.sid=hostile; Path=/' },
});
const row = (letter, city = '高州') => ({
  publicEventId: letter.repeat(43),
  name: '合成公开赛事' + letter,
  startDate: '2028-05-01',
  endDate: '2028-05-03',
  venueName: '合成体育馆',
  status: 'RUNNING',
  purpose: 'LIVE',
  displayCity: city,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const ticks = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

function device({ storage = new Map(), request = () => reply() } = {}) {
  const app = { globalData: {} };
  const wx = createWx({ storage, request });
  wx.getLocation = wx.getFuzzyLocation = () => {
    throw new Error('Manual city selection must never locate the device');
  };
  return {
    wx,
    storage,
    open(name) {
      const h = loadPage({
        root,
        route: 'pages/' + name + '/index',
        wx,
        globals: { getApp: () => app, getCurrentPages: () => [{}, {}] },
      });
      h.page.onLoad?.({});
      h.page.onShow?.();
      return h;
    },
  };
}

test('first visit: anonymous events and dismissible city guide', async () => {
  const d = device({ request: () => reply([row('a'), row('b'), row('c'), row('d')]) });
  const h = d.open('home');
  await h.flush();
  assert.equal(h.page.data.publicEvents.length, 3);
  assert.equal(h.page.data.citySelection.guide, true);
  assert.equal(h.page.data.citySelection.label, '全国');
  const calls = d.wx.calls.filter((c) => c.type === 'request');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/public\/directory\?status=LIVE&limit=20$/);
  assert.equal(
    Object.keys(calls[0].header).some((k) => k.toLowerCase() === 'cookie'),
    false,
  );
  assert.equal(h.requireLocal('utils/api.js').getClient().hasSession(), false);
  const html = buildPreview({ root, route: h.page.route, data: h.page.data }).phone;
  assert.match(html, /合成公开赛事a/);
  assert.match(html, /手动选城/);
  assert.match(html, /首页不读取当前位置/);
  h.page.nationwide();
  await h.flush();
  assert.equal(h.page.data.citySelection.guide, false);
  assert.equal(d.open('watch').page.data.citySelection.guide, false);
});

test('picker applies canonical city and home/watch share the explicit preference', async () => {
  const d = device({ request: () => reply([row('a')]) });
  const picker = d.open('city-select');
  picker.page.inputCity(tap({}, '  高州　 '));
  picker.page.apply();
  assert.equal(d.wx.calls.at(-1).type, 'navigateBack');
  const home = d.open('home');
  const watch = d.open('watch');
  await home.flush();
  assert.equal(home.page.data.citySelection.city, '高州');
  assert.equal(watch.page.data.dir.city, '高州');
  assert.equal(watch.page.data.dir.cityInput, '高州');
  assert.equal(home.page.data.citySelection.source, '本次选择');
  for (const r of d.wx.calls.filter(
    (c) => c.type === 'request' && c.url.includes('/public/directory'),
  ))
    assert.match(r.url, new RegExp('city=' + encodeURIComponent('高州') + '$'));
  assert.deepEqual(d.storage.get(V2_KEY), {
    version: 2,
    selected: { mode: 'LEGACY_CITY', city: '高州' },
    chosen: true,
    recent: [{ mode: 'LEGACY_CITY', city: '高州' }],
  });
});

test('manual city: county and prefecture names are not guessed', async () => {
  const d = device();
  const p = d.open('city-select');
  for (const city of ['高州', '高州市', '茂名', '高州 · 石鼓']) {
    p.page.inputCity(tap({}, city));
    p.page.apply();
    const watch = d.open('watch');
    await watch.flush();
    assert.equal(watch.page.data.dir.city, city);
    assert.ok(
      d.wx.calls.some(
        (c) => c.type === 'request' && c.url.endsWith('city=' + encodeURIComponent(city)),
      ),
    );
  }
});

test('blank and invalid cities do not save, navigate or send requests', () => {
  const d = device();
  const p = d.open('city-select');
  const before = d.wx.calls.length; // Opening the picker may read the public region catalog.
  for (const value of ['', ' ', '高州!', '城'.repeat(21), 'https://a.test', '高州\u0000']) {
    p.page.inputCity(tap({}, value));
    p.page.apply();
    assert.ok(p.page.data.error);
  }
  assert.equal(
    d.wx.calls
      .slice(before)
      .some((c) => ['request', 'setStorageSync', 'navigateBack'].includes(c.type)),
    false,
  );
});

test('recent choices: bounded, deduplicated, safe clearing', () => {
  const storage = new Map([['unrelated-private-draft', { originalCommandId: 'keep-me' }]]);
  const d = device({ storage });
  const p = d.open('city-select');
  const pref = p.requireLocal('utils/city-preference.js');
  for (let i = 0; i < 9; i++) pref.choose('合成城' + i);
  pref.choose('合成城6');
  p.page.onLoad();
  assert.equal(p.page.data.recent.length, 6);
  assert.equal(p.page.data.recent[0], '合成城6');
  assert.equal(new Set(p.page.data.recent).size, 6);
  p.page.clearHistory();
  assert.equal(p.page.data.city, '合成城6');
  assert.deepEqual(p.page.data.recent, []);
  assert.deepEqual(storage.get('unrelated-private-draft'), { originalCommandId: 'keep-me' });
  assert.deepEqual([...storage.keys()].sort(), [V2_KEY, 'unrelated-private-draft'].sort());
});

test('cold start restores choice without GPS; nationwide persists an empty filter', async () => {
  const storage = new Map();
  const a = device({ storage }).open('city-select');
  a.page.inputCity(tap({}, '高州'));
  a.page.apply();
  const d = device({ storage });
  const h = d.open('home');
  await h.flush();
  assert.equal(h.page.data.citySelection.source, '上次选择');
  h.page.nationwide();
  await h.flush();
  const next = device({ storage }).open('watch');
  await next.flush();
  assert.equal(next.page.data.dir.city, '');
  assert.equal(next.page.data.citySelection.source, '上次选择');
  assert.equal(next.page.data.citySelection.guide, false);
});

for (const raw of [
  null,
  'bad',
  { version: 99, selected: '高州', chosen: true },
  { version: 1, selected: 'bad!', chosen: true },
]) {
  test('corrupt preference falls back to nationwide: ' + JSON.stringify(raw), () => {
    const d = device({ storage: new Map([[KEY, raw]]) });
    const p = d.open('city-select');
    assert.equal(p.page.data.city, '');
    assert.deepEqual(p.page.data.recent, []);
  });
}

test('stored extra fields never reach UI or the next persisted preference', () => {
  const d = device({
    storage: new Map([
      [
        KEY,
        {
          version: 1,
          selected: '高州',
          chosen: true,
          recent: ['高州', 'bad!', { account: 'private' }],
          latitude: 9,
          account: 'private',
        },
      ],
    ]),
  });
  const p = d.open('city-select');
  assert.equal(JSON.stringify(p.page.data).includes('private'), false);
  p.page.nationwide();
  assert.deepEqual(Object.keys(d.storage.get(V2_KEY)).sort(), [
    'chosen',
    'recent',
    'selected',
    'version',
  ]);
});

test('storage failure: consistent temporary selection across pages', async () => {
  const d = device();
  d.wx.getStorageSync = () => {
    throw new Error('storage blocked');
  };
  d.wx.setStorageSync = () => {
    throw new Error('storage full');
  };
  const p = d.open('city-select');
  p.page.inputCity(tap({}, '高州'));
  p.page.apply();
  const h = d.open('home');
  const w = d.open('watch');
  await h.flush();
  assert.equal(h.page.data.citySelection.city, '高州');
  assert.equal(w.page.data.dir.city, '高州');
  assert.match(w.page.data.citySelection.warning, /无法保存/);
  assert.equal(w.page.data.dir.loaded, true);
});

test('failed preference writes warn that cold start can restore old content', async () => {
  const storage = new Map();
  const d = device({ storage });
  const p = d.open('city-select');
  p.page.inputCity(tap({}, '高州'));
  p.page.apply();
  d.wx.setStorageSync = () => {
    throw new Error('storage full');
  };
  p.page.nationwide();
  p.page.clearHistory();
  assert.equal(p.page.data.city, '');
  assert.deepEqual(p.page.data.recent, []);
  assert.match(p.page.data.warning, /可能恢复之前的城市和最近选择/);
  const restored = device({ storage }).open('watch');
  await restored.flush();
  assert.equal(restored.page.data.dir.city, '高州');
  assert.equal(restored.page.data.citySelection.source, '上次选择');
});

test('watch inline filter shares preference and invalid input keeps the old choice', async () => {
  const d = device();
  const w = d.open('watch');
  await w.flush();
  w.page.dirCityInput(tap({}, '高州'));
  w.page.applyDirCity();
  await w.flush();
  w.page.dirCityInput(tap({}, 'invalid!'));
  w.page.applyDirCity();
  assert.equal(d.open('city-select').page.data.city, '高州');
  assert.equal(d.open('home').page.data.citySelection.city, '高州');
});

test('old home response cannot overwrite new city after a picker round trip', async () => {
  const old = deferred();
  const d = device({ request: (o) => (o.url.includes('city=') ? reply([row('b')]) : old.promise) });
  const h = d.open('home');
  await ticks();
  h.page.onHide();
  const p = d.open('city-select');
  p.page.inputCity(tap({}, '高州'));
  p.page.apply();
  h.page.onShow();
  await ticks();
  assert.equal(h.page.data.publicEvents[0].publicEventId, 'b'.repeat(43));
  old.resolve(reply([row('a', '其他城市')]));
  await h.flush();
  assert.equal(h.page.data.publicEvents[0].publicEventId, 'b'.repeat(43));
  assert.equal(h.page.data.citySelection.city, '高州');
});

test('switching nationwide resets cursor and ignores old load-more', async () => {
  const oldMore = deferred();
  const d = device({
    request: (o) => {
      if (o.url.includes('cursor=old_cursor')) return oldMore.promise;
      return o.url.includes('city=')
        ? reply([row('a')], 'old_cursor')
        : reply([row('b', '广州')], 'new_cursor');
    },
  });
  d.open('city-select').requireLocal('utils/city-preference.js').choose('高州');
  const w = d.open('watch');
  await w.flush();
  w.page.loadMoreDirectory();
  await ticks();
  w.page.clearDirCity();
  await ticks();
  oldMore.resolve(reply([row('c')]));
  await w.flush();
  assert.deepEqual(
    w.page.data.dir.items.map((r) => r.publicEventId),
    ['b'.repeat(43)],
  );
  assert.equal(w.page._dirCursor, 'new_cursor');
  assert.equal(w.page.data.dir.loadingMore, false);
  assert.equal(d.open('home').page.data.citySelection.city, '');
});

for (const route of ['home', 'watch']) {
  for (const phase of ['onHide', 'onUnload']) {
    test(route + ': ' + phase + ' prevents late directory rows from appearing', async () => {
      const pending = deferred();
      const d = device({ request: () => pending.promise });
      const p = d.open(route);
      await ticks();
      p.page[phase]();
      const count = p.updates.length;
      pending.resolve(reply([row('a')]));
      await p.flush();
      assert.equal(p.updates.length, count);
    });
  }
}

test('a returned directory error is shown as an error, not as an empty city', async () => {
  const d = device({
    request: () => ({
      statusCode: 503,
      data: { error: { code: 'UNAVAILABLE', message: '合成服务暂不可用' } },
    }),
  });
  const h = d.open('home');
  await h.flush();
  const html = buildPreview({ root, route: h.page.route, data: h.page.data }).phone;
  assert.match(html, /公开赛事暂时无法读取/);
  assert.doesNotMatch(html, /暂无已列入目录/);
});

test('a shared event is opened directly even when its city differs from the current filter', () => {
  const d = device();
  const h = d.open('home');
  const pref = h.requireLocal('utils/city-preference.js');
  pref.choose('高州');
  h.page.input(tap({}, 'z'.repeat(43)));
  h.page.open();
  assert.equal(d.wx.calls.at(-1).url, '/pages/event/index?event=' + 'z'.repeat(43));
  assert.equal(pref.snapshot().city, '高州');
});

test('session reset preserves public preference and unrelated orders', async () => {
  const storage = new Map([['unrelated-order', { venue: '广州', commandId: 'keep' }]]);
  const d = device({ storage });
  const w = d.open('watch');
  w.page.dirCityInput(tap({}, '高州'));
  w.page.applyDirCity();
  await w.flush();
  w.page.onSessionReset();
  w.requireLocal('utils/api.js').getClient().clearSession();
  assert.equal(w.page.data.dir.city, '高州');
  assert.equal(w.requireLocal('utils/city-preference.js').snapshot().city, '高州');
  assert.deepEqual(storage.get('unrelated-order'), { venue: '广州', commandId: 'keep' });
});
