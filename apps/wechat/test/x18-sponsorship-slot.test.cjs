const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { parseWxml } = require('./helpers/wxml.cjs');
const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const flush = () => new Promise((r) => setImmediate(r));
const data = (key = 'a'.repeat(43), regionId = id(1)) => ({
  publicKey: key,
  label: '广告／赞助',
  brand: '合成赞助方',
  title: '合成当前投放',
  body: '公开文案，无私人资料',
  startsAt: '2026-01-01T00:00:00Z',
  endsAt: '2028-01-01T00:00:00Z',
  serverTime: new Date().toISOString(),
  region: { catalogVersion: 'test-v1', regionId },
  measurement: 'CLIENT_REPORTED_DEDUPLICATED',
});
function fixture({
  properties = {},
  read = async () => ({ data: { items: [data()] } }),
  report = async (p, m, b) => ({
    data: {
      publicKey: p.split('/')[4],
      commandId: b.commandId,
      measurement: 'CLIENT_REPORTED_DEDUPLICATED',
    },
  }),
} = {}) {
  const requests = [],
    writes = [],
    observers = [];
  const timeouts = new Map();
  let nextTimeout = 0;
  const wx = createWx();
  const client = {
    requestPublic: async (p) => {
      requests.push(p);
      return read(p);
    },
    request: async (...args) => {
      writes.push(args);
      return report(...args);
    },
  };
  wx.createIntersectionObserver = () => {
    const observer = {
      relativeToViewport() {
        return this;
      },
      observe(selector, callback) {
        this.callback = callback;
      },
      disconnect() {
        this.disconnected = true;
      },
    };
    observers.push(observer);
    return observer;
  };
  const h = loadPage({
    root,
    route: 'components/sponsorship-slot/index',
    component: true,
    wx,
    globals: {
      setTimeout(fn) {
        const id = ++nextTimeout;
        timeouts.set(id, fn);
        return id;
      },
      clearTimeout(id) {
        timeouts.delete(id);
      },
    },
    modules: { [path.join(root, 'utils/api.js')]: { getClient: () => client } },
  });
  Object.assign(h.page, h.definition.methods);
  h.page.properties = {
    regionId: '',
    catalogVersion: '',
    eventPublicId: '',
    visible: true,
    ...properties,
  };
  h.page.setData(h.page.properties);
  return {
    ...h,
    requests,
    writes,
    observers,
    timeouts,
    attach() {
      h.definition.lifetimes.attached.call(h.page);
    },
    hide() {
      h.definition.pageLifetimes.hide.call(h.page);
    },
    show() {
      h.definition.pageLifetimes.show.call(h.page);
    },
    props(next) {
      Object.assign(h.page.properties, next);
      h.page.setData(next);
      h.definition.observers['regionId,catalogVersion,eventPublicId,visible'].call(h.page);
    },
    detach() {
      h.definition.lifetimes.detached.call(h.page);
    },
  };
}
test('no selected region, catalog mismatch or malformed event never invents a region or reports exposure', async () => {
  for (const properties of [
    {},
    { regionId: id(1) },
    { regionId: id(1), catalogVersion: 'test-v1', eventPublicId: 'bad' },
  ]) {
    const h = fixture({ properties });
    h.attach();
    await flush();
    assert.equal(h.requests.length, 0);
    assert.equal(h.writes.length, 0);
    assert.equal(h.page.data.card, null);
    h.detach();
  }
});
test('late old-region response cannot replace a newer explicit selection', async () => {
  let first;
  const h = fixture({
    properties: { regionId: id(1), catalogVersion: 'test-v1' },
    read: (p) =>
      p.includes(id(1))
        ? new Promise((r) => {
            first = r;
          })
        : Promise.resolve({ data: { items: [data('b'.repeat(43), id(2))] } }),
  });
  h.attach();
  h.props({ regionId: id(2) });
  await flush();
  assert.equal(h.page.data.card.publicKey, 'b'.repeat(43));
  first({ data: { items: [data()] } });
  await flush();
  assert.equal(h.page.data.card.publicKey, 'b'.repeat(43));
  assert.equal(h.writes.length, 0);
  h.detach();
});
test('only current >=50% visibility reports, concurrent callbacks share one ID, unknown retries retain that exact ID', async () => {
  let fail = true;
  const h = fixture({
    properties: { regionId: id(1), catalogVersion: 'test-v1' },
    report: async (p, m, b, anonymous) => {
      assert.equal(anonymous, true);
      if (fail) throw { status: 503 };
      return {
        data: {
          publicKey: 'a'.repeat(43),
          commandId: b.commandId,
          measurement: 'CLIENT_REPORTED_DEDUPLICATED',
        },
      };
    },
  });
  h.attach();
  await flush();
  h.observers.at(-1).callback({ intersectionRatio: 0.3 });
  await flush();
  assert.equal(h.writes.length, 0);
  h.observers.at(-1).callback({ intersectionRatio: 0.7 });
  h.observers.at(-1).callback({ intersectionRatio: 0.8 });
  await flush();
  assert.equal(h.writes.length, 1);
  const commandId = h.writes[0][2].commandId;
  fail = false;
  await h.page.refresh();
  h.observers.at(-1).callback({ intersectionRatio: 0.8 });
  await flush();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1][2].commandId, commandId);
  await h.page.refresh();
  assert.equal(h.writes.length, 2);
  assert.equal(h.wx.storage.size, 0);
  h.detach();
});
test('page hide stops polling, clears the card and prevents late read/observer effects', async () => {
  let finish;
  const h = fixture({
    properties: { regionId: id(1), catalogVersion: 'test-v1' },
    read: () =>
      new Promise((r) => {
        finish = r;
      }),
  });
  h.attach();
  assert.equal(h.intervals.size, 1);
  h.hide();
  assert.equal(h.intervals.size, 0);
  finish({ data: { items: [data()] } });
  await flush();
  assert.equal(h.page.data.card, null);
  assert.equal(h.writes.length, 0);
  assert.equal(h.observers.length, 0);
  h.detach();
});
test('revoked or unavailable current publication clears the old card on the next visible refresh', async () => {
  let revoked = false;
  const h = fixture({
    properties: { regionId: id(1), catalogVersion: 'test-v1' },
    read: async () => {
      if (revoked) throw { status: 404 };
      return { data: { items: [data()] } };
    },
  });
  h.attach();
  await flush();
  assert.ok(h.page.data.card);
  revoked = true;
  await h.page.refresh();
  assert.equal(h.page.data.card, null);
  assert.equal(h.writes.length, 0);
  h.detach();
});
test('revocation discovered while reporting removes the current card without replacing its unknown ID', async () => {
  const h = fixture({
    properties: { regionId: id(1), catalogVersion: 'test-v1' },
    report: async () => {
      throw { status: 404 };
    },
  });
  h.attach();
  await flush();
  h.observers.at(-1).callback({ intersectionRatio: 1 });
  await flush();
  assert.equal(h.page.data.card, null);
  assert.equal(h.writes.length, 1);
  const first = h.writes[0][2].commandId;
  await h.page.refresh();
  h.observers.at(-1).callback({ intersectionRatio: 1 });
  await flush();
  assert.equal(h.writes[1][2].commandId, first);
  h.detach();
});
test('explicit event key travels only as a filter and component template has a clear ad label', async () => {
  const key = 'z'.repeat(43);
  const h = fixture({
    properties: { regionId: id(1), catalogVersion: 'test-v1', eventPublicId: key },
  });
  h.attach();
  await flush();
  assert.match(h.requests[0], new RegExp('eventPublicId=' + key));
  const source = fs.readFileSync(path.join(root, 'components/sponsorship-slot/index.wxml'), 'utf8');
  assert.doesNotThrow(() => parseWxml(source));
  assert.match(source, /广告／赞助/);
  assert.doesNotMatch(source, /reportedImpressions|人气|付款|余额/);
  h.detach();
});
test('authoritative window subtracts the entire request duration and refuses future, expired or backward-clock data', () => {
  const h = fixture();
  const time = h.requireLocal('utils/sponsorship.js');
  const v = {
    startsAt: '2026-10-30T23:00:00Z',
    endsAt: '2026-10-31T00:00:05Z',
    serverTime: '2026-10-31T00:00:00Z',
  };
  assert.equal(time.remaining(v, 1000, 3000), 3000);
  assert.throws(() => time.remaining(v, 1000, 6000));
  assert.throws(() => time.remaining({ ...v, serverTime: v.endsAt }, 1000, 1000));
  assert.throws(() => time.remaining({ ...v, serverTime: '2026-10-30T22:00:00Z' }, 1000, 1000));
  assert.throws(() => time.remaining(v, 3000, 1000));
});
test('a loaded card expires independently of polling and stops late visibility callbacks and navigation', async () => {
  const h = fixture({ properties: { regionId: id(1), catalogVersion: 'test-v1' } });
  h.attach();
  await flush();
  const observer = h.observers.at(-1),
    expiry = h.page._expiryTimer;
  assert.ok(expiry);
  h.page._cardDeadline = Date.now() - 1;
  observer.callback({ intersectionRatio: 1 });
  h.page.open();
  await flush();
  assert.equal(h.writes.length, 0);
  assert.equal(h.wx.calls.filter((c) => c.type === 'navigateTo').length, 0);
  const fn = h.timeouts.get(expiry);
  h.timeouts.delete(expiry);
  fn();
  assert.equal(h.page.data.card, null);
  h.detach();
  assert.equal(h.timeouts.size, 0);
});
test('turning explicit visibility off clears the card and invalidates its old observer', async () => {
  const h = fixture({ properties: { regionId: id(1), catalogVersion: 'test-v1' } });
  h.attach();
  await flush();
  const observer = h.observers.at(-1);
  h.props({ visible: false });
  observer.callback({ intersectionRatio: 1 });
  await flush();
  assert.equal(h.page.data.card, null);
  assert.equal(h.writes.length, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 0);
  h.detach();
});
