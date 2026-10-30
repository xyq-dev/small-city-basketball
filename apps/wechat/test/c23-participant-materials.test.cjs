const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const materials = require('../utils/participant-materials');
const { pathAllowed, createClient } = require('../utils/api');
const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const org = id(1),
  entry = id(2),
  member = id(3),
  user = id(4),
  request = id(5);
const base = '/v1/orgs/' + org + '/entries/' + entry + '/participant-materials';
const ok = (data) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-c23' } },
  header: { 'Set-Cookie': 'scb.sid=' + 'a'.repeat(43) + '; Path=/' },
});
const fail = (statusCode, code) => ({ statusCode, data: { error: { code, message: '合成错误' } } });
const session = () => ({
  user: { id: user, email: 'synthetic@example.test', displayName: '合成本人' },
  organizations: [],
  teamContexts: [],
});
const file = () => ({
  fileName: 'synthetic.jpg',
  contentType: 'image/jpeg',
  byteLength: 3,
  sha256: 'a'.repeat(64),
});
const row = (over = {}) => ({
  id: id(6),
  memberId: member,
  memberName: '合成队员',
  status: 'DRAFT',
  storedStatus: 'DRAFT',
  version: 1,
  revisionId: id(7),
  clientRequestId: request,
  realName: '合成姓名',
  identityMasked: '**************0000',
  portrait: file(),
  insurance: null,
  acceptedTerms: true,
  publicityConsent: false,
  reviewReason: null,
  reviewedAt: null,
  blockers: [],
  capabilities: { canReadPrivate: true, canReview: false },
  ...over,
});
const mine = (material = row(), over = {}) => ({
  entryId: entry,
  memberId: member,
  eventName: '合成本人报名杯',
  teamName: '合成青锋',
  startDate: '2028-05-01',
  endDate: '2028-05-03',
  rules: { requireInsurance: false, termsVersion: 'registration-materials-v1' },
  enabled: true,
  frozen: false,
  material,
  capabilities: { canSave: true, canSubmit: true, canWithdrawPublicity: false },
  ...over,
});
const tap = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });
const ticks = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { resolve, promise };
};
function setup({
  data = mine(),
  request: custom,
  storage = new Map(),
  mode = 'mine',
  modalAnswers = [true, true],
} = {}) {
  let current = data;
  const wx = createWx({
    storage,
    modalAnswers,
    request: (o) => {
      const p = new URL(o.url).pathname;
      if (custom) {
        const value = custom(o, p);
        if (value !== undefined) return value;
      }
      if (p === '/v1/auth/session') return ok(session());
      if (p === '/v1/me/participant-entries')
        return ok([
          {
            orgId: org,
            entryId: entry,
            memberId: member,
            eventName: current.eventName,
            teamName: current.teamName,
            startDate: current.startDate,
            endDate: current.endDate,
          },
        ]);
      if (p === base && o.method === 'GET')
        return ok({
          entryId: entry,
          eventName: current.eventName,
          teamName: current.teamName,
          enabled: true,
          frozen: false,
          members: [current.material],
        });
      if (p === base + '/mine' && o.method === 'GET') return ok(current);
      if (p === base + '/mine' && o.method === 'PUT') {
        current = mine(
          row({
            version: (current.material?.version || 0) + 1,
            clientRequestId: o.data.clientRequestId,
            realName: o.data.realName || current.material?.realName || null,
            acceptedTerms: o.data.acceptedTerms,
            publicityConsent: o.data.publicityConsent,
          }),
        );
        return ok(current);
      }
      if (p === base + '/mine/submit') {
        current = mine(row({ status: 'SUBMITTED', version: current.material.version + 1 }));
        return ok(current);
      }
      if (p === base + '/' + member) return ok(current.material);
      return fail(404, 'TEST_UNHANDLED');
    },
  });
  const h = loadPage({ root, route: 'pages/participant-materials/index', wx });
  h.page.onLoad(
    mode === 'list'
      ? {}
      : { orgId: org, entryId: entry, mode: mode === 'review' ? 'review' : undefined },
  );
  h.page.onShow();
  return {
    ...h,
    storage,
    calls: () => wx.calls.filter((c) => c.type === 'request'),
    current: () => current,
  };
}
const writes = (h) => h.calls().filter((c) => c.method !== 'GET');

test('C23 JSON and binary allowlists only permit explicit private routes and methods', async () => {
  for (const [url, method] of [
    [base, 'GET'],
    [base + '/mine', 'GET'],
    [base + '/mine', 'PUT'],
    [base + '/mine/submit', 'POST'],
    [base + '/mine/publicity-withdraw', 'POST'],
    [base + '/mine/receipts/' + request, 'GET'],
    [base + '/' + member + '/private', 'GET'],
    [base + '/' + member + '/review', 'POST'],
    ['/v1/me/participant-entries', 'GET'],
  ])
    assert.equal(pathAllowed(url, method), true, url);
  for (const [url, method] of [
    [base + '/mine', 'POST'],
    [base + '/mine?userId=' + user, 'GET'],
    [base + '/' + member + '/private', 'PUT'],
    [base + '/mine/receipts/' + request, 'POST'],
    ['/v1/me/participant-entries?all=true', 'GET'],
  ])
    assert.equal(pathAllowed(url, method), false, url);
  const wx = createWx({
    request: () => ({
      statusCode: 200,
      data: new ArrayBuffer(3),
      header: { 'Content-Type': 'image/jpeg' },
    }),
  });
  const client = createClient(wx);
  assert.equal((await client.download(base + '/' + member + '/files/portrait')).data.byteLength, 3);
  await assert.rejects(client.download(base + '/' + member + '/files/other'));
});

test('C23 normal DTO rejects accidental unmasked identity or raw file body', async () => {
  assert.equal(materials.material(row({ identityNumber: 'SYNTHETIC_RAW_ID' })), false);
  assert.equal(materials.material(row({ portrait: { ...file(), base64: 'YWJj' } })), false);
  const h = setup({ data: mine(row({ identityNumber: 'SYNTHETIC_RAW_ID' })) });
  await h.flush();
  assert.equal(h.page.data.material, null);
  assert.match(h.page.data.error, /不完整/);
});

test('C23 discovers own current entries through a distinct personal menu route', async () => {
  const h = setup({ mode: 'list' });
  await h.flush();
  assert.equal(h.page.data.entries.length, 1);
  h.page.openEntry(tap({ id: entry, org }));
  assert.match(
    h.wx.calls.find((c) => c.type === 'navigateTo').url,
    /participant-materials\/index\?orgId=/,
  );
  assert.match(
    fs.readFileSync(path.join(root, 'pages/account/index.wxml'), 'utf8'),
    /本人赛事报名与照片/,
  );
});

test('C23 missing portrait cannot submit even if a stale capability accidentally says yes', async () => {
  const h = setup({ data: mine(row({ portrait: null })) });
  await h.flush();
  await h.page.command(tap({ action: 'submit' }));
  assert.equal(writes(h).length, 0);
  assert.match(h.page.data.error, /本人照片/);
});

test('C23 rejecting optional publicity still saves and submits the confirmed participant draft', async () => {
  const h = setup();
  await h.flush();
  h.page.field(tap({ field: 'realName' }, '合成本人原文'));
  h.page.field(tap({ field: 'identityNumber' }, 'SYNTHETIC-IDENTITY'));
  h.page.checkbox(tap({ field: 'publicityConsent' }, []));
  await h.page.save();
  assert.equal(writes(h)[0].data.publicityConsent, false);
  assert.equal(h.page.data.form.identityNumber, '');
  const pendingWrites = h.wx.calls.filter(
    (c) => c.type === 'setStorageSync' && c.key === materials.PENDING_KEY,
  );
  assert.ok(pendingWrites.length >= 1);
  for (const call of pendingWrites)
    assert.doesNotMatch(
      JSON.stringify(call.value),
      /合成本人原文|SYNTHETIC-IDENTITY|base64|policyNumber/,
    );
  await h.page.command(tap({ action: 'submit' }));
  assert.equal(writes(h).at(-1).url.endsWith('/mine/submit'), true);
});

test('C23 durable pending storage failure prevents sending identity or any upload', async () => {
  const h = setup();
  await h.flush();
  h.wx.setStorageSync = () => {
    throw new Error('synthetic storage failure');
  };
  await h.page.save();
  assert.equal(writes(h).length, 0);
  assert.match(h.page.data.error, /未发送任何资料/);
});

test('C23 response loss keeps original receipt protection across page reload; 404 cannot clear it', async () => {
  const h = setup({
    request: (o, p) => {
      if (p === base + '/mine' && o.method === 'PUT')
        return Promise.reject(new Error('synthetic lost'));
    },
  });
  await h.flush();
  await h.page.save();
  assert.equal(h.page.data.pending, true);
  const sentId = writes(h)[0].data.clientRequestId;
  await h.page.load();
  await h.flush();
  assert.equal(h.page.data.pending, true);
  assert.match(h.page.data.error, /仍可能在途/);
  await h.page.save();
  assert.equal(writes(h).length, 1);
  assert.equal(materials.readPending(h.wx, user, org, entry).record.clientRequestId, sentId);
});

test('C23 receipt recovery clears original pending without replaying private bytes or stale revisions', async () => {
  const storage = new Map(),
    wx = createWx({ storage });
  materials.writePending(wx, {
    userId: user,
    orgId: org,
    entryId: entry,
    clientRequestId: request,
    expectedVersion: 0,
  });
  const h = setup({
    storage,
    request: (o, p) =>
      p === base + '/mine/receipts/' + request
        ? ok({ clientRequestId: request, revisionId: id(7), isCurrent: false, currentVersion: 4 })
        : undefined,
  });
  await h.flush();
  assert.equal(h.page.data.pending, false);
  assert.equal(writes(h).length, 0);
  assert.match(h.page.data.message, /已有新版本/);
});

test('C23 failed pending removal retains protection after server success', async () => {
  const h = setup();
  await h.flush();
  const set = h.wx.setStorageSync;
  h.wx.setStorageSync = (key, value) => {
    if (key === materials.PENDING_KEY && Object.keys(value).length === 0)
      throw new Error('synthetic clear failed');
    return set(key, value);
  };
  await h.page.save();
  assert.equal(h.page.data.pending, true);
  await h.page.save();
  assert.equal(writes(h).length, 1);
});

test('C23 late file selection after account reset reads and sends no old private file', async () => {
  const picker = deferred();
  const h = setup();
  await h.flush();
  let read = 0;
  h.wx.chooseMessageFile = (options) =>
    picker.promise.then(() =>
      options.success({ tempFiles: [{ path: '/synthetic.jpg', name: 'synthetic.jpg', size: 3 }] }),
    );
  h.wx.getFileSystemManager = () => ({
    readFile: () => {
      read++;
    },
  });
  const task = h.page.upload(tap({ kind: 'portrait' }));
  await ticks();
  h.requireLocal('utils/api.js').getClient().clearSession();
  picker.resolve();
  await task;
  assert.equal(read, 0);
  assert.equal(writes(h).length, 0);
  assert.equal(h.page.data.workspace, null);
  assert.equal(h.page.data.form.identityNumber, '');
});

test('C23 hide while a selection is open cancels it before private bytes are read', async () => {
  const picker = deferred();
  const h = setup();
  await h.flush();
  let read = 0;
  h.wx.chooseMessageFile = (options) =>
    picker.promise.then(() =>
      options.success({ tempFiles: [{ path: '/synthetic.jpg', name: 'synthetic.jpg', size: 3 }] }),
    );
  h.wx.getFileSystemManager = () => ({
    readFile: () => {
      read++;
    },
  });
  const task = h.page.upload(tap({ kind: 'portrait' }));
  await ticks();
  h.page.onHide();
  picker.resolve();
  await task;
  assert.equal(read, 0);
  assert.equal(writes(h).length, 0);
  assert.equal(h.page.data.material, null);
});

test('C23 late review confirmation cannot act on a changed selection or account', async () => {
  const h = setup({
    mode: 'review',
    data: mine(
      row({ status: 'SUBMITTED', capabilities: { canReadPrivate: true, canReview: true } }),
    ),
  });
  await h.flush();
  await h.page.openMember(tap({ id: member }));
  h.page.setData({ reason: '合成人工核对', identityChecked: true, portraitChecked: true });
  let modal;
  h.wx.showModal = (o) => {
    modal = o;
  };
  const task = h.page.review(tap({ decision: 'APPROVE' }));
  await ticks();
  h.requireLocal('utils/api.js').getClient().clearSession();
  modal.success({ confirm: true });
  await task;
  assert.equal(writes(h).length, 0);
  assert.equal(h.page.data.material, null);
});

test('C23 explicit private text is hidden immediately on session reset and hide', async () => {
  const h = setup({
    request: (o, p) =>
      p === base + '/' + member + '/private'
        ? ok({ realName: '合成私有姓名', identityNumber: 'SYNTHETIC_RAW_ID', insurance: null })
        : undefined,
  });
  await h.flush();
  await h.page.revealPrivate();
  assert.ok(h.page.data.privateDetails);
  h.requireLocal('utils/api.js').getClient().clearSession();
  assert.equal(h.page.data.privateDetails, null);
  assert.equal(h.page.data.form.identityNumber, '');
});

test('C23 saving holds the write token: refresh cannot start a competing read or orphan the save', async () => {
  const answer = deferred();
  const h = setup({
    request: (o, p) => (p === base + '/mine' && o.method === 'PUT' ? answer.promise : undefined),
  });
  await h.flush();
  const task = h.page.save();
  await ticks();
  const before = h.calls().length;
  await h.page.load();
  assert.equal(h.calls().length, before);
  assert.equal(h.page.data.busy, true);
  answer.resolve(ok(mine(row({ version: 2 }))));
  await task;
  assert.equal(h.page.data.busy, false);
  assert.equal(h.page.data.material.version, 2);
});

test('C23 stale roster requires an explicit fresh signature; consent defaults remain independent', async () => {
  const h = setup({
    data: mine(row({ status: 'STALE', acceptedTerms: true, publicityConsent: false })),
  });
  await h.flush();
  assert.equal(h.page.data.form.acceptedTerms, false);
  assert.equal(h.page.data.form.publicityConsent, false);
  h.page.checkbox(tap({ field: 'acceptedTerms' }, ['yes']));
  await h.page.save();
  assert.equal(writes(h)[0].data.acceptedTerms, true);
  assert.equal(writes(h)[0].data.publicityConsent, false);
});

test('C23 preview temporary path is registered before write and late completion is removed after unload', async () => {
  const writing = deferred();
  let writeOptions,
    removed = [];
  const h = setup({
    request: (o, p) =>
      p === base + '/' + member + '/files/portrait'
        ? { statusCode: 200, data: new ArrayBuffer(3), header: { 'Content-Type': 'image/jpeg' } }
        : undefined,
  });
  await h.flush();
  h.wx.env = { USER_DATA_PATH: '/synthetic' };
  h.wx.getFileSystemManager = () => ({
    writeFile(o) {
      writeOptions = o;
      writing.promise.then(() => o.success());
    },
    unlink(o) {
      removed.push(o.filePath);
      o.success();
    },
  });
  h.wx.previewImage = () => {
    throw new Error('late preview must never open');
  };
  const task = h.page.viewFile(tap({ kind: 'portrait' }));
  await ticks();
  assert.ok(h.storage.get(materials.TEMP_KEY).includes(writeOptions.filePath));
  h.page.onUnload();
  writing.resolve();
  await task;
  assert.ok(removed.includes(writeOptions.filePath));
});

for (const filename of ['c23-materials-draft', 'c23-materials-review', 'c23-materials-pending'])
  test('C23 real WXML fixture renders expected privacy and state text: ' + filename, () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../tests/mini-program/fixtures', filename + '.json'),
        'utf8',
      ),
    );
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({
        root,
        route: fixture.route,
        data: fixture.data,
        width,
        height: 844,
      });
      for (const text of fixture.expectText) assert.ok(preview.html.includes(text), text);
    }
  });

test('C23 partial insurance drafts accept null fields without exposing a raw policy number', async () => {
  const data = mine(
    row({
      insurance: {
        insurer: null,
        policyNumberMasked: null,
        startDate: null,
        endDate: null,
        document: null,
      },
    }),
  );
  assert.equal(materials.mine(data), true);
  assert.equal(
    materials.material(
      row({ insurance: { ...data.material.insurance, policyNumber: 'SYNTHETIC_RAW_POLICY' } }),
    ),
    false,
  );
  const h = setup({ data });
  await h.flush();
  assert.equal(h.page.data.form.insurer, '');
  assert.equal(h.page.data.form.policyNumber, '');
});

test('C23 a replacement photograph explicitly resets previous publicity consent', async () => {
  const h = setup({ data: mine(row({ publicityConsent: true })) });
  await h.flush();
  h.wx.chooseMessageFile = (o) =>
    o.success({ tempFiles: [{ path: '/synthetic.jpg', name: 'synthetic.jpg', size: 3 }] });
  h.wx.getFileSystemManager = () => ({ readFile: (o) => o.success({ data: 'YWJj' }) });
  await h.page.upload(tap({ kind: 'portrait' }));
  assert.equal(writes(h).length, 1);
  assert.equal(writes(h)[0].data.publicityConsent, false);
  assert.equal(h.page.data.form.publicityConsent, false);
});

test('C23 a policy document can be saved separately without re-reading a private policy number', async () => {
  const h = setup();
  await h.flush();
  h.wx.chooseMessageFile = (o) =>
    o.success({ tempFiles: [{ path: '/synthetic.pdf', name: 'synthetic.pdf', size: 3 }] });
  h.wx.getFileSystemManager = () => ({ readFile: (o) => o.success({ data: 'YWJj' }) });
  await h.page.upload(tap({ kind: 'insurance' }));
  assert.deepEqual(Object.keys(writes(h)[0].data.insurance), ['document']);
  assert.equal(
    h.calls().some((c) => c.url.endsWith('/private')),
    false,
  );
});

test('C23 pending protection rejects private extra fields before any durable write', () => {
  const wx = createWx();
  assert.equal(
    materials.writePending(wx, {
      userId: user,
      orgId: org,
      entryId: entry,
      clientRequestId: request,
      expectedVersion: 0,
      identityNumber: 'SYNTHETIC_RAW_ID',
    }),
    false,
  );
  assert.equal(
    wx.calls.some((c) => c.type === 'setStorageSync'),
    false,
  );
  for (let n = 1; n <= 20; n++)
    assert.equal(
      materials.writePending(wx, {
        userId: user,
        orgId: org,
        entryId: id(100 + n),
        clientRequestId: id(200 + n),
        expectedVersion: 0,
      }),
      true,
    );
  assert.equal(
    materials.writePending(wx, {
      userId: user,
      orgId: org,
      entryId: entry,
      clientRequestId: request,
      expectedVersion: 0,
    }),
    false,
  );
  assert.equal(materials.readPending(wx, user, org, id(101)).record.clientRequestId, id(201));
});

test('C23 old participants retain the separate publicity withdrawal action after roster freeze', async () => {
  const caps = { canSave: false, canSubmit: false, canWithdrawPublicity: true };
  const data = mine(row({ status: 'APPROVED', publicityConsent: true }), {
    frozen: true,
    capabilities: caps,
  });
  const h = setup({
    data,
    request: (o, p) =>
      p === base + '/mine/publicity-withdraw'
        ? ok(
            mine(row({ status: 'APPROVED', publicityConsent: false }), {
              frozen: true,
              capabilities: { ...caps, canWithdrawPublicity: false },
            }),
          )
        : undefined,
  });
  await h.flush();
  await h.page.command(tap({ action: 'withdraw' }));
  assert.equal(writes(h).length, 1);
  assert.equal(h.page.data.material.status, 'APPROVED');
  assert.equal(h.page.data.material.publicityConsent, false);
});

test('C23 response-lost partial insurance draft can reload and resolve its original receipt', async () => {
  let saved, originalId;
  const initial = mine(
    row({
      insurance: {
        insurer: null,
        policyNumberMasked: null,
        startDate: null,
        endDate: null,
        document: null,
      },
    }),
  );
  const h = setup({
    data: initial,
    request: (o, p) => {
      if (p === base + '/mine' && o.method === 'PUT') {
        originalId = o.data.clientRequestId;
        saved = mine(
          row({
            version: 2,
            clientRequestId: originalId,
            insurance: {
              insurer: '合成保险',
              policyNumberMasked: null,
              startDate: null,
              endDate: null,
              document: null,
            },
          }),
        );
        return Promise.reject(new Error('synthetic response lost after save'));
      }
      if (p === base + '/mine' && o.method === 'GET' && saved) return ok(saved);
      if (originalId && p === base + '/mine/receipts/' + originalId)
        return ok({
          clientRequestId: originalId,
          revisionId: id(7),
          isCurrent: true,
          currentVersion: 2,
        });
    },
  });
  await h.flush();
  h.page.field(tap({ field: 'insurer' }, '合成保险'));
  await h.page.saveInsurance();
  assert.equal(h.page.data.pending, true);
  await h.page.load();
  await h.flush();
  assert.equal(h.page.data.pending, false);
  assert.equal(h.page.data.material.version, 2);
  assert.equal(h.page.data.form.insurer, '合成保险');
  assert.equal(writes(h).length, 1);
});

for (const lifecycle of ['onHide', 'onUnload'])
  test('C23 definitive late 422 clears only its original pending after ' + lifecycle, async () => {
    const reply = deferred();
    const h = setup({
      request: (o, p) => (p === base + '/mine' && o.method === 'PUT' ? reply.promise : undefined),
    });
    await h.flush();
    const task = h.page.save();
    await ticks();
    const original = materials.readPending(h.wx, user, org, entry).record;
    assert.ok(original);
    h.page[lifecycle]();
    reply.resolve(fail(422, 'INVALID_PARTICIPANT_MATERIALS'));
    await task;
    assert.equal(materials.readPending(h.wx, user, org, entry).record, null);
    assert.equal(h.page.data.material, null);
    assert.equal(h.page.data.message, '');
  });

test('C23 late definitive rejection does not release protection when durable removal fails', async () => {
  const reply = deferred();
  const h = setup({
    request: (o, p) => (p === base + '/mine' && o.method === 'PUT' ? reply.promise : undefined),
  });
  await h.flush();
  const task = h.page.save();
  await ticks();
  const set = h.wx.setStorageSync;
  h.wx.setStorageSync = (key, value) => {
    if (key === materials.PENDING_KEY && Object.keys(value).length === 0)
      throw new Error('synthetic storage failure');
    return set(key, value);
  };
  h.page.onHide();
  reply.resolve(fail(422, 'INVALID_PARTICIPANT_MATERIALS'));
  await task;
  assert.ok(materials.readPending(h.wx, user, org, entry).record);
  h.page.onShow();
  await h.flush();
  assert.equal(h.page.data.pending, true);
  await h.page.save();
  assert.equal(writes(h).length, 1);
});

test('C23 native mainline fixture keeps Web-only grant administration outside the client', () => {
  const organization = '/v1/orgs/' + org;
  assert.equal(pathAllowed(organization + '/teams/' + id(20) + '/grants/' + user, 'PUT'), false);
  for (const [route, method] of [
    [organization + '/teams', 'POST'],
    [organization + '/teams/' + id(20) + '/join-codes', 'POST'],
    [organization + '/events', 'POST'],
    [organization + '/events/' + id(21), 'GET'],
    [organization + '/events/' + id(21) + '/registration-rules', 'PUT'],
    [organization + '/events/' + id(21) + '/registration-commands', 'POST'],
    [organization + '/events/' + id(21) + '/entries', 'POST'],
    [organization + '/entries/' + entry, 'GET'],
    [organization + '/entries/' + entry + '/roster', 'PUT'],
    [organization + '/entries/' + entry + '/commands', 'POST'],
  ])
    assert.equal(pathAllowed(route, method), true, method + ' ' + route);
});
