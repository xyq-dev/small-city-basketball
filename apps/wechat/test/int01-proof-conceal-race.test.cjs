const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');

const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function until(check) {
  for (let i = 0; i < 30; i++) {
    if (check()) return;
    await new Promise(setImmediate);
  }
  throw Error('Controlled private operation did not reach its expected stage');
}
function harness(stage, review = false) {
  const pending = deferred(),
    events = [],
    disk = new Map(),
    listeners = new Set(),
    timers = [];
  let viewer = id(1),
    revision = 1,
    waiting = false,
    completeWrite,
    completeUuid;
  const client = {
    viewerId: () => viewer,
    sessionRevision: () => revision,
    onSessionChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async request(url) {
      assert.equal(url, '/v1/auth/session');
      if (stage === 'actor') {
        waiting = true;
        await pending.promise;
      }
      return { data: { user: { id: viewer }, organizations: [], teamContexts: [] } };
    },
  };
  const wx = createWx({ modalAnswers: [true, true] });
  wx.env = { USER_DATA_PATH: '/synthetic-private' };
  wx.getFileSystemManager = () => ({
    writeFile(options) {
      const write = () => {
        disk.set(options.filePath, options.data);
        options.success();
      };
      events.push('writeFile');
      if (stage === 'write') {
        waiting = true;
        completeWrite = write;
      } else write();
    },
    unlink(options) {
      events.push('unlink');
      if (disk.delete(options.filePath)) options.success();
      else options.fail({ errMsg: 'ENOENT' });
    },
  });
  wx.previewImage = (options) => events.push(['previewImage', options.current]);
  wx.openDocument = (options) => events.push(['openDocument', options.filePath]);
  if (stage === 'uuid')
    wx.getRandomValues = (options) => {
      waiting = true;
      completeUuid = () => options.success({ randomValues: new Uint8Array(16).fill(3).buffer });
    };
  const h = loadPage({
    root,
    route: 'pages/' + (review ? 'youth-review' : 'guardian') + '/index',
    wx,
    modules: { [path.join(root, 'utils/api.js')]: { getClient: () => client, uuid: (v) => v } },
    globals: {
      setTimeout(fn) {
        timers.push(fn);
        return timers.length;
      },
    },
  });
  h.page.onLoad(review ? { orgId: id(2), eventId: id(3) } : {});
  const selected = {
    id: id(4),
    version: 1,
    capabilities: { canReadProof: true, canConfirm: true },
  };
  const details = {
    realName: 'SYNTHETIC_PRIVATE_NAME',
    proof: { contentType: 'image/png', byteLength: 8 },
  };
  const services = h.requireLocal('utils/youth-guardians.js');
  services.repository = () => ({
    async private() {
      events.push('private');
      if (stage === 'reveal') {
        waiting = true;
        await pending.promise;
      }
      return details;
    },
    async download() {
      events.push('download');
      if (stage === 'download') {
        waiting = true;
        await pending.promise;
      }
      return { contentType: details.proof.contentType, data: new ArrayBuffer(8) };
    },
    async detail(target) {
      return { ...selected, id: target };
    },
  });
  h.page._viewer = viewer;
  h.page._selected = selected;
  h.page.setData({
    selected,
    privateDetails: details,
    requests: [selected, { ...selected, id: id(5) }],
  });
  return {
    ...h,
    events,
    disk,
    waiting: () => waiting,
    details,
    complete() {
      pending.resolve();
      completeUuid?.();
      completeWrite?.();
    },
    switchActor() {
      viewer = id(9);
      revision++;
      for (const fn of [...listeners]) fn();
    },
  };
}
const previews = (h) => h.events.filter((event) => Array.isArray(event));
const tracked = (h) =>
  h.wx.storage.get(h.requireLocal('utils/participant-materials.js').TEMP_KEY) || [];

for (const review of [false, true])
  for (const stage of ['actor', 'download', 'uuid', 'write'])
    test(`${review ? 'reviewer' : 'guardian'} concealing during ${stage} prevents late preview and removes every private file`, async () => {
      const h = harness(stage, review);
      const operation = h.page.viewProof();
      await until(h.waiting);
      h.page.conceal();
      assert.equal(h.page.data.privateDetails, null);
      assert.deepEqual(Array.from(h.page._temps), []);
      h.complete();
      await operation;
      assert.deepEqual(previews(h), []);
      assert.equal(h.disk.size, 0);
      assert.deepEqual(tracked(h), []);
      assert.equal(h.page.data.busy, false);
      if (stage === 'actor')
        assert.ok(
          !h.events.includes('download'),
          'concealed actor verification cannot start a download',
        );
      if (stage === 'download' || stage === 'uuid') assert.ok(!h.events.includes('writeFile'));
    });

test('concealing a private read prevents its late protected details from returning', async () => {
  const h = harness('reveal');
  const operation = h.page.reveal();
  await until(h.waiting);
  h.page.conceal();
  h.complete();
  await operation;
  assert.equal(h.page.data.privateDetails, null);
  assert.deepEqual(previews(h), []);
  assert.equal(h.page.data.busy, false);
});

for (const [name, invalidate] of [
  ['hide', (h) => h.page.onHide()],
  ['unload', (h) => h.page.onUnload()],
  ['identity change', (h) => h.switchActor()],
])
  for (const stage of ['download', 'write'])
    test(`${name} during ${stage} clears late bytes and proof previews`, async () => {
      const h = harness(stage);
      const operation = h.page.viewProof();
      await until(h.waiting);
      invalidate(h);
      h.complete();
      await operation;
      assert.equal(h.page.data.privateDetails, null);
      assert.deepEqual(previews(h), []);
      assert.equal(h.disk.size, 0);
      assert.deepEqual(tracked(h), []);
    });

test('a new selected relationship invalidates a prior proof confirmation before private data is read', async () => {
  const h = harness('normal');
  let answer;
  h.wx.showModal = (options) => {
    answer = options;
  };
  const operation = h.page.reveal();
  await until(() => !!answer);
  await h.page.select({ currentTarget: { dataset: { id: id(5) } } });
  answer.success({ confirm: true });
  await operation;
  assert.equal(h.page.data.selected.id, id(5));
  assert.equal(h.page.data.privateDetails, null);
  assert.ok(!h.events.includes('private'));
});

test('concealing a completed preview deletes the tracked file and does not affect unrelated write tokens', async () => {
  const h = harness('normal');
  await h.page.viewProof();
  assert.equal(previews(h).length, 1);
  assert.equal(h.disk.size, 1);
  const ui = h.requireLocal('utils/ui.js');
  const token = ui.hold(h.page);
  h.page.conceal();
  assert.equal(ui.held(h.page, token), true);
  assert.equal(h.disk.size, 0);
  assert.deepEqual(tracked(h), []);
  assert.equal(h.page.data.privateDetails, null);
});

test('selecting a new proof file discards the previously revealed protected details and temporary preview', async () => {
  const h = harness('normal');
  await h.page.viewProof();
  const files = h.requireLocal('utils/participant-materials.js');
  files.chooseFile = async () => ({
    path: '/synthetic-input/proof.png',
    name: 'new-proof.png',
    size: 8,
    contentType: 'image/png',
  });
  await h.page.chooseProof();
  assert.equal(h.page.data.proofName, 'new-proof.png');
  assert.equal(h.page.data.privateDetails, null);
  assert.equal(h.disk.size, 0);
  assert.deepEqual(tracked(h), []);
});

test('late private-file deletion failure remains tracked for a later sweep after conceal', async () => {
  const h = harness('write');
  const operation = h.page.viewProof();
  await until(h.waiting);
  h.page.conceal();
  assert.deepEqual(tracked(h), [], 'early ENOENT may clear the original registration');
  const manager = h.wx.getFileSystemManager;
  h.wx.getFileSystemManager = () => ({
    ...manager(),
    unlink(options) {
      options.fail({ errMsg: 'EACCES' });
    },
  });
  h.complete();
  await operation;
  assert.deepEqual(previews(h), []);
  assert.equal(h.disk.size, 1);
  assert.deepEqual(tracked(h), [...h.disk.keys()], 'late bytes remain discoverable for cleanup');
  h.wx.getFileSystemManager = manager;
  h.requireLocal('utils/participant-materials.js').sweepTemps(h.wx);
  assert.equal(h.disk.size, 0);
  assert.deepEqual(tracked(h), []);
});

for (const [contentType, preview] of [
  ['image/png', 'previewImage'],
  ['application/pdf', 'openDocument'],
])
  test(
    'current authorized ' + contentType + ' proof still previews and cleans up normally',
    async () => {
      const h = harness('normal');
      h.details.proof.contentType = contentType;
      h.page.setData({ privateDetails: h.details });
      await h.page.viewProof();
      assert.equal(previews(h).length, 1);
      assert.equal(previews(h)[0][0], preview);
      assert.equal(h.disk.size, 1);
      assert.equal(tracked(h).length, 1);
      h.page.conceal();
      assert.equal(h.disk.size, 0);
      assert.deepEqual(tracked(h), []);
    },
  );

test('conceal blocks new reads until old finally finishes, then a new explicit reveal can preview', async () => {
  const h = harness('download');
  const old = h.page.viewProof();
  await until(h.waiting);
  h.page.conceal();
  assert.equal(h.page.data.busy, true);
  await h.page.reveal();
  assert.ok(!h.events.includes('private'));
  h.complete();
  await old;
  assert.equal(h.page.data.busy, false);
  await h.page.reveal();
  assert.ok(h.page.data.privateDetails);
  await h.page.viewProof();
  assert.equal(previews(h).length, 1);
  h.page.conceal();
  assert.equal(h.disk.size, 0);
});
