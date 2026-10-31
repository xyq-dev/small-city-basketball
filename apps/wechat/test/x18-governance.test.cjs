const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function fixture({
  request = async () => ({ data: { id: id(9), version: 1 } }),
  answers = [true],
  route = 'governance',
} = {}) {
  let revision = 0;
  const listeners = new Set();
  const wx = createWx({ modalAnswers: answers });
  const client = {
    request,
    sessionRevision: () => revision,
    onSessionChange: (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  };
  const api = { getClient: () => client, uuid: (v) => v, publicId: (v) => v };
  const h = loadPage({
    root,
    route: 'pages/' + route + '/index',
    wx,
    modules: { [path.join(root, 'utils/api.js')]: api },
  });
  h.page.onLoad({});
  h.page._viewer = id(1);
  h.requireLocal('utils/ui.js').begin(h.page);
  return {
    ...h,
    gov: h.requireLocal('utils/governance.js'),
    change() {
      revision++;
      for (const f of [...listeners]) f();
    },
  };
}
test('an unknown write keeps only actor/kind/command metadata and refuses a replacement ID', async () => {
  let calls = 0;
  const h = fixture({
    request: async () => {
      calls++;
      throw { status: 503, code: 'UNAVAILABLE' };
    },
  });
  await h.gov.perform(h.page, 'CASE', '/v1/me/governance/cases', {
    body: 'secret identity body',
    base64: 'secret file',
  });
  assert.equal(calls, 1);
  const records = [...h.wx.storage.values()];
  assert.equal(records.length, 1);
  assert.deepEqual(Object.keys(records[0]).sort(), ['commandId', 'kind', 'userId']);
  assert.equal(JSON.stringify(records).includes('secret'), false);
  h.wx.showModal = (o) => o.success({ confirm: true });
  await assert.rejects(h.gov.perform(h.page, 'CASE', '/v1/me/governance/cases', {}), /核对/);
  assert.equal(calls, 1);
});
test('unwritable journal stops the write before any network request', async () => {
  let calls = 0;
  const h = fixture({
    request: async () => {
      calls++;
      return { data: {} };
    },
  });
  h.wx.setStorageSync = () => {
    throw new Error('full');
  };
  await assert.rejects(h.gov.perform(h.page, 'CASE', '/v1/me/governance/cases', {}), /保存失败/);
  assert.equal(calls, 0);
});
test('late confirmation after account change cannot start a write', async () => {
  let confirm,
    calls = 0;
  const h = fixture({
    request: async () => {
      calls++;
      return { data: {} };
    },
  });
  h.wx.showModal = (o) => {
    confirm = o.success;
  };
  const pending = h.gov.perform(h.page, 'CASE', '/v1/me/governance/cases', { body: 'old secret' });
  h.change();
  confirm({ confirm: true });
  assert.equal(await pending, null);
  assert.equal(calls, 0);
  assert.equal(h.wx.storage.size, 0);
  assert.equal(h.page._viewer, null);
});
test('success after page hide clears only its original journal and never restores private UI', async () => {
  let finish;
  const h = fixture({
    request: () =>
      new Promise((r) => {
        finish = r;
      }),
  });
  const pending = h.gov.perform(h.page, 'CASE', '/v1/me/governance/cases', { body: 'private' });
  await new Promise((r) => setImmediate(r));
  assert.ok(finish);
  h.page.onHide();
  finish({ data: { id: id(9), version: 1 } });
  assert.equal(await pending, null);
  assert.equal(h.wx.storage.size, 0);
  assert.equal(h.page.data.selected, null);
  assert.equal(h.page.data.body, '');
});
test('receipt 404 keeps the original ID; explicit cancellation uses that exact ID', async () => {
  const paths = [];
  let missing = true;
  const h = fixture({
    request: async (p, m) => {
      paths.push([p, m]);
      if (missing) throw { status: 503 };
      return { data: { cancelled: true, commandId: record.commandId } };
    },
    answers: [true, true],
  });
  await h.gov.perform(h.page, 'CASE', '/v1/me/governance/cases', {});
  const record = h.gov.readPending(id(1), 'CASE');
  await h.gov.recover(h.page, 'CASE');
  assert.equal(h.gov.readPending(id(1), 'CASE').commandId, record.commandId);
  missing = false;
  await h.gov.recover(h.page, 'CASE', true);
  assert.equal(h.gov.readPending(id(1), 'CASE'), null);
  assert.deepEqual(paths.at(-1), [
    '/v1/me/governance/operations/' + record.commandId + '/cancel',
    'POST',
  ]);
});
test('definite validation rejection releases journal; idempotency conflict does not', async () => {
  const h = fixture({
    request: async () => {
      throw { status: 422, code: 'VALIDATION_ERROR' };
    },
  });
  await h.gov.perform(h.page, 'CASE', '/v1/me/governance/cases', {});
  assert.equal(h.wx.storage.size, 0);
  assert.equal(h.gov.unknown({ status: 409, code: 'IDEMPOTENCY_CONFLICT' }), true);
});
test('an already completed original operation resolves protection without returning lost-scope private details or undoing its effect', async () => {
  let available = false,
    record;
  const h = fixture({
    answers: [true, true],
    request: async (path, method) => {
      if (!available) throw { status: 503 };
      assert.equal(method, 'POST');
      assert.equal(path, '/v1/me/governance/operations/' + record.commandId + '/cancel');
      return { data: { commandId: record.commandId, completed: true, cancelled: false } };
    },
  });
  await h.gov.perform(h.page, 'CASE', '/v1/me/governance/cases', {
    body: 'secret previously submitted',
  });
  record = h.gov.readPending(id(1), 'CASE');
  available = true;
  const outcome = await h.gov.recover(h.page, 'CASE', true);
  assert.equal(outcome.completed, true);
  assert.equal(outcome.cancelled, false);
  assert.deepEqual(Object.keys(outcome).sort(), ['cancelled', 'commandId', 'completed']);
  assert.equal(h.gov.readPending(id(1), 'CASE'), null);
  assert.match(h.page.data.notice, /已经生效/);
});
test('case, city and review pages clear sensitive lists/forms on lifecycle reset', () => {
  for (const route of [
    'governance',
    'governance-reviews',
    'city-operations',
    'sponsorships',
    'public-ledgers',
  ]) {
    const h = fixture({ route });
    h.page.setData({
      items: [{ body: 'secret' }],
      reason: 'secret',
      pending: { commandId: id(7) },
    });
    h.page.onHide();
    assert.equal(h.page.data.items.length, 0);
    assert.equal(h.page.data.reason, '');
    assert.equal(h.page._viewer, null);
    assert.equal(h.page.data.pending, null);
  }
});
test('oversized attachments are refused before reading any file', async () => {
  const h = fixture();
  await assert.rejects(
    h.gov.attachmentBody({}, { size: 4 * 1024 * 1024 + 1 }, 1, 'REQUESTER'),
    /4MiB/,
  );
});
test('a late chosen attachment never moves to a different selected case', async () => {
  const h = fixture();
  let finish;
  h.requireLocal('utils/participant-materials.js').chooseFile = () =>
    new Promise((r) => {
      finish = r;
    });
  h.page.setData({ selected: { id: id(8), version: 1, capabilities: { canReply: true } } });
  const pending = h.page.choose();
  h.page.setData({ selected: { id: id(9), version: 1, capabilities: { canReply: true } } });
  finish({ name: 'private.pdf', size: 20, path: '/secret', contentType: 'application/pdf' });
  await pending;
  assert.equal(h.page._file, null);
  assert.equal(h.page.data.chosenFile, '');
});
test('all X18 templates parse with direct binding operators and default/denied states render', () => {
  const fs = require('node:fs');
  const { parseWxml } = require('./helpers/wxml.cjs');
  const { renderWxml } = require('./helpers/native-preview.cjs');
  for (const route of [
    'governance',
    'governance-reviews',
    'city-operations',
    'sponsorships',
    'public-ledgers',
  ]) {
    const h = fixture({ route });
    const source = fs.readFileSync(path.join(root, 'pages', route, 'index.wxml'), 'utf8');
    const mapping = JSON.parse(
      fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
    ).usingComponents;
    const options = {
      root,
      pageDirectory: path.join(root, 'pages', route),
      usingComponents: mapping,
      globalComponents: mapping,
    };
    assert.doesNotThrow(() => parseWxml(source));
    assert.doesNotThrow(() => renderWxml(source, h.page.data, options));
    h.page.setData({ loginRequired: true });
    assert.doesNotThrow(() => renderWxml(source, h.page.data, options));
  }
});
test('sponsor only reports a visible current card and concurrent callbacks share one command', async () => {
  let calls = 0,
    callback;
  const h = fixture({
    route: 'sponsorships',
    request: async (p, m, b, anonymous) => {
      calls++;
      assert.equal(anonymous, true);
      return { data: {} };
    },
  });
  h.wx.createIntersectionObserver = () => ({
    relativeToViewport() {
      return this;
    },
    observe(selector, fn) {
      callback = fn;
    },
    disconnect() {},
  });
  h.page.setData({ mode: 'public', publicCard: { publicKey: 'a'.repeat(43) } });
  h.page.armPublication(h.page.data.publicCard, 10000, Date.now());
  h.page.observe();
  callback({ intersectionRatio: 0.2 });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 0);
  callback({ intersectionRatio: 0.7 });
  callback({ intersectionRatio: 0.8 });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  h.page.onHide();
  callback({ intersectionRatio: 1 });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
});
test('offline money uses exact cents and rejects coercion, signs, excess fractions and out-of-range values', () => {
  const h = fixture({ route: 'public-ledgers' });
  const ledger = h.requireLocal('utils/public-ledger.js');
  assert.equal(ledger.fen('0.29'), 29);
  assert.equal(ledger.fen('1000000.00'), 100000000);
  assert.equal(ledger.money(-5001), '-50.01');
  for (const invalid of ['0', '-5', '+5', '1e2', '1.001', '1000000.01', '1,000', 'NaN'])
    assert.throws(() => ledger.fen(invalid));
});
test('platform query modes are explicit and public ledger hide releases its polling timer', () => {
  for (const route of ['governance', 'governance-reviews', 'city-operations']) {
    const h = fixture({ route });
    h.page.onLoad({ mode: 'platform' });
    assert.equal(
      route === 'city-operations' ? h.page.data.platform : h.page.data.mode,
      route === 'city-operations' ? true : 'platform',
    );
  }
  const h = fixture({ route: 'public-ledgers' });
  h.page.onLoad({ publicKey: 'a'.repeat(43) });
  h.page.onShow();
  assert.equal(h.intervals.size, 1);
  h.page.onHide();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.page._timer, null);
  assert.equal(h.page.data.publicSnapshot, null);
  assert.equal(h.page.data.isPublic, true);
});
