const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');

// PR #24 review: a picker result must stay bound to the account and page that opened it, and
// name/size/time matches are never treated as proof. C19 replaced the identity-less uploads with
// request IDs: tests below cover receipt-first recovery; legacy unknown records keep their path.
const org = '11111111-1111-4111-8111-111111111111';
const eventId = '33333333-3333-4333-8333-333333333333';
const matchId = '44444444-4444-4444-8444-444444444444';
const userA = '55555555-5555-4555-8555-555555555555';
const userB = '66666666-6666-4666-8666-666666666666';
const oldFile = '77777777-7777-4777-8777-777777777770';
const newFile = '77777777-7777-4777-8777-777777777771';
const mediaId = '77777777-7777-4777-8777-777777777772';
const cookieA = 'a'.repeat(43);
const cookieB = 'b'.repeat(43);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const ok = (data, cookie = cookieA) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-media-review', nextCursor: null } },
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const fail = (statusCode, code) => ({
  statusCode,
  data: { error: { code, message: '合成错误 ' + code } },
});
const sessionOf = (id) => ({
  user: { id, email: id.slice(0, 4) + '@example.test', displayName: '合成账号' },
  organizations: [{ id: org, name: '合成机构', role: 'ORG_OWNER' }],
  teamContexts: [],
});
const lost = () => Promise.reject(new Error('synthetic lost response'));
const ticks = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
const tap = (dataset = {}, detail = {}) => ({ type: 'tap', currentTarget: { dataset }, detail });
const matchBase = '/v1/orgs/' + org + '/matches/' + matchId;
const UPLOAD = 'POST ' + matchBase + '/media-file-requests';
const CREATE = 'POST ' + matchBase + '/media-requests';
const fileRow = (id, minutesAgo = 0) => ({
  id,
  purpose: 'MATCH_IMAGE',
  rosterRevisionId: null,
  fileName: 'photo.png',
  contentType: 'image/png',
  byteLength: PNG.length,
  sha256: (id === oldFile ? '1' : '2').repeat(64),
  version: 1,
  status: 'ACTIVE',
  createdAt: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  revokedAt: null,
  purgedAt: null,
});
const mediaRow = (status, version) => ({
  id: mediaId,
  kind: 'IMAGE',
  title: '决赛最后一攻',
  fileId: newFile,
  externalUrl: null,
  rightsDeclaration: '主办方摄影组拍摄',
  status,
  version,
  createdAt: new Date().toISOString(),
  markers: [],
});
function workspace(over = {}) {
  return {
    matchId,
    eventId,
    matchStatus: 'FINAL',
    matchVersion: 9,
    currentConfirmationId: null,
    files: [],
    media: [],
    sourceEvents: [],
    trustedExternalHosts: [],
    usage: { usedBytes: 0, limitBytes: 134217728, maxFileBytes: 8388608 },
    capabilities: {
      canUpload: true,
      canManage: true,
      canPublish: true,
      canMark: false,
      canPurge: true,
    },
    ...over,
  };
}

// One device: shared wx (storage survives page re-entry), synthetic server, sessions A and B.
function deviceFor() {
  const state = {
    replies: new Map(),
    patterns: [],
    bodies: [],
    getKeys: [],
    reads: 0,
    picker: null,
    ws: workspace(),
  };
  let who = userA;
  const wx = createWx({
    modalAnswers: Array(40).fill(true),
    request(options) {
      const key = (options.method || 'GET') + ' ' + options.url.replace(/^https:\/\/[^/]+/, '');
      if (options.method && options.method !== 'GET')
        state.bodies.push({
          key,
          body: JSON.parse(JSON.stringify(options.data ?? null)),
          cookie: (options.header || {}).Cookie || '',
        });
      if (key === 'GET /v1/auth/session')
        return ok(sessionOf(who), who === userA ? cookieA : cookieB);
      if (key === 'POST /v1/auth/login') {
        who = userB;
        return ok(sessionOf(userB), cookieB);
      }
      if (key === 'GET ' + matchBase + '/media') return ok(state.ws);
      const handler = state.replies.get(key);
      if (handler) return handler();
      if (!options.method || options.method === 'GET') state.getKeys.push(key);
      const pattern = state.patterns.find(([re]) => re.test(key));
      if (pattern) return pattern[1]();
      return { statusCode: 404, data: { error: { code: 'TEST_UNHANDLED', message: key } } };
    },
  });
  wx.chooseMedia = (o) => {
    state.picker = o;
  };
  wx.getFileSystemManager = () => ({
    readFile(o) {
      state.reads++;
      o.success({ data: PNG.toString('base64') });
    },
  });
  const pick = () =>
    state.picker.success({
      tempFiles: [{ tempFilePath: 'wxfile://tmp/photo.png', size: PNG.length }],
    });
  return {
    wx,
    state,
    pick,
    sent: (key) => state.bodies.filter((b) => b.key === key),
    gets: (re) => state.getKeys.filter((k) => re.test(k)),
    async open() {
      const h = loadPage({ root, route: 'pages/match-media/index', wx });
      const client = h.requireLocal('utils/api.js').getClient();
      await client.request('/v1/auth/session');
      h.page.onLoad({ orgId: org, matchId });
      await h.flush();
      return { ...h, client };
    },
  };
}

test('a picker result arriving after logout, account switch or unload is discarded unread', async () => {
  for (const change of ['logout', 'switch', 'unload']) {
    const d = deviceFor();
    const page = await d.open();
    assert.equal(page.page.data.caps.upload, true);
    const uploading = page.page.uploadImage();
    await ticks();
    assert.ok(d.state.picker, 'picker opened');
    if (change === 'logout') page.client.clearSession();
    if (change === 'switch')
      await page.client.request('/v1/auth/login', 'POST', { email: 'b@example.test' });
    if (change === 'unload') page.unload();
    d.pick();
    await uploading;
    await ticks();
    assert.equal(d.state.reads, 0, change + ': the chosen file is never read');
    assert.equal(d.sent(UPLOAD).length, 0, change + ': nothing is uploaded');
    if (change !== 'unload') assert.equal(page.page.data.busy, false, change);
  }
});

// C19: new uploads and drafts carry a request identity. A lost response is resolved by the
// original ID's receipt; a missing receipt (404) never opens a new ID — only the same request may
// be resent. Name/size matches are still never taken as proof of anything.
const RECEIPT_UPLOAD = new RegExp('^GET ' + matchBase + '/media-file-requests/[0-9a-f-]{36}$');
const RECEIPT_DRAFT = new RegExp('^GET ' + matchBase + '/media-requests/[0-9a-f-]{36}$');
const noReceipt = () => fail(404, 'RECEIPT_NOT_FOUND');
const STORE_KEY = 'scb.mediaRequests.v2';
const pageKey = userA + ':' + org + ':' + matchId;

test('an older file with the same name and size is never taken as proof of a lost upload', async () => {
  const d = deviceFor();
  d.state.ws = workspace({ files: [fileRow(oldFile, 1)] });
  const page = await d.open();
  d.state.replies.set(UPLOAD, lost); // the server did not store anything
  d.state.patterns.push([RECEIPT_UPLOAD, noReceipt]);
  const uploading = page.page.uploadImage();
  await ticks();
  d.pick();
  await uploading;
  await page.flush();
  assert.equal(page.page.data.request.state, 'unknown', 'the outcome is unknown');
  await page.page.load();
  await page.flush();
  const id = d.sent(UPLOAD)[0].body.clientRequestId;
  assert.deepEqual(d.gets(RECEIPT_UPLOAD), ['GET ' + matchBase + '/media-file-requests/' + id]);
  assert.equal(page.page.data.request.state, 'absent', 'no receipt: still unresolved');
  assert.notEqual(page.page.data.upload && page.page.data.upload.stage, 'saved');
  assert.equal(page.page.data.pending, null, 'no name/size candidates are offered as proof');
  page.unload();
});

test('a delayed original request keeps new uploads closed until its own receipt resolves it', async () => {
  const d = deviceFor();
  const page = await d.open();
  d.state.replies.set(UPLOAD, lost); // the server is still processing; no receipt yet
  d.state.patterns.push([RECEIPT_UPLOAD, noReceipt]);
  const uploading = page.page.uploadImage();
  await ticks();
  d.pick();
  await uploading;
  await page.flush();
  await page.page.queryRequest();
  await page.flush();
  assert.equal(page.page.data.request.state, 'absent', 'one missing receipt is not a failure');
  d.state.picker = null;
  await page.page.uploadImage();
  assert.equal(d.state.picker, null, 'choosing another file is blocked');
  assert.equal(d.sent(UPLOAD).length, 1);
  const id = d.sent(UPLOAD)[0].body.clientRequestId;
  page.unload();
  // The original lands later; a fresh page looks up the same ID on load and shows it as saved.
  d.state.ws = workspace({ files: [fileRow(newFile)] });
  d.state.patterns.unshift([RECEIPT_UPLOAD, () => ok({ state: 'FILE', file: fileRow(newFile) })]);
  const again = await d.open();
  assert.equal(again.page.data.request, null, 'resolved by its receipt');
  assert.equal(again.page.data.upload.stage, 'saved');
  assert.match(again.page.data.upload.label, /最终校验通过/);
  assert.ok(
    d.gets(RECEIPT_UPLOAD).every((k) => k.endsWith('/' + id)),
    'always the same ID',
  );
  assert.equal(d.sent(UPLOAD).length, 1, 'never sent twice');
  assert.deepEqual(stored(d, STORE_KEY), {});
  again.unload();
});

test('a known rejection is retried with the same request ID and content', async () => {
  const d = deviceFor();
  const page = await d.open();
  d.state.replies.set(UPLOAD, () => fail(409, 'MEDIA_STORAGE_LIMIT'));
  const uploading = page.page.uploadImage();
  await ticks();
  d.pick();
  await uploading;
  await page.flush();
  assert.equal(page.page.data.request.state, 'rejected');
  assert.equal(page.page.data.canRetry, true);
  d.state.replies.set(UPLOAD, () => {
    d.state.ws = workspace({ files: [fileRow(newFile)] });
    return ok(fileRow(newFile));
  });
  await page.page.retryUpload();
  await page.flush();
  assert.equal(d.sent(UPLOAD).length, 2);
  assert.deepEqual(d.sent(UPLOAD)[1].body, d.sent(UPLOAD)[0].body, 'same ID, same file');
  assert.equal(page.page.data.upload.stage, 'saved');
  assert.equal(page.page.data.request, null);
  page.unload();
});

test('a draft whose response was lost is only ever resent with its original ID', async () => {
  const d = deviceFor();
  d.state.ws = workspace({ files: [fileRow(newFile)] });
  const page = await d.open();
  page.page.titleInput(tap({}, { value: '决赛最后一攻' }));
  page.page.rightsInput(tap({}, { value: '主办方摄影组拍摄' }));
  d.state.replies.set(CREATE, lost);
  d.state.patterns.push([RECEIPT_DRAFT, noReceipt]);
  await page.page.createDraft();
  await page.flush();
  await page.page.load();
  await page.flush();
  assert.equal(page.page.data.request.state, 'absent');
  await page.page.createDraft();
  await page.flush();
  assert.equal(d.sent(CREATE).length, 1, 'no second draft request');
  page.unload();
  const again = await d.open();
  await again.page.createDraft();
  assert.equal(d.sent(CREATE).length, 1, 'not after re-entry either');
  d.state.replies.set(CREATE, () => {
    d.state.ws = workspace({ files: [fileRow(newFile)], media: [mediaRow('DRAFT', 1)] });
    return ok(mediaRow('DRAFT', 1));
  });
  await again.page.resendRequest();
  await again.flush();
  assert.equal(d.sent(CREATE).length, 2);
  assert.deepEqual(d.sent(CREATE)[1].body, d.sent(CREATE)[0].body, 'the original request again');
  assert.equal(again.page.data.items[0].status, 'DRAFT');
  assert.equal(again.page.data.request, null);
  again.unload();
});

test('the normal path stays usable: upload, draft, publish and revoke', async () => {
  const d = deviceFor();
  const page = await d.open();
  d.state.replies.set(UPLOAD, () => {
    d.state.ws = workspace({ files: [fileRow(newFile)] });
    return ok(fileRow(newFile));
  });
  const uploading = page.page.uploadImage();
  await ticks();
  d.pick();
  await uploading;
  await page.flush();
  assert.equal(page.page.data.upload.stage, 'saved');
  assert.equal(page.page.data.request, null);
  const body = d.sent(UPLOAD)[0].body;
  assert.match(
    body.clientRequestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(
    body.contentSha256,
    require('node:crypto').createHash('sha256').update(PNG).digest('hex'),
  );
  assert.equal(body.byteLength, PNG.length);
  page.page.titleInput(tap({}, { value: '决赛最后一攻' }));
  page.page.rightsInput(tap({}, { value: '主办方摄影组拍摄' }));
  d.state.replies.set(CREATE, () => {
    d.state.ws = workspace({ files: [fileRow(newFile)], media: [mediaRow('DRAFT', 1)] });
    return ok(mediaRow('DRAFT', 1));
  });
  await page.page.createDraft();
  await page.flush();
  assert.equal(page.page.data.items[0].status, 'DRAFT');
  const command = 'POST ' + matchBase + '/media/' + mediaId + '/commands';
  d.state.replies.set(command, () => {
    d.state.ws = workspace({ files: [fileRow(newFile)], media: [mediaRow('PUBLISHED', 2)] });
    return ok(mediaRow('PUBLISHED', 2));
  });
  await page.page.publish(tap({ id: mediaId }));
  await page.flush();
  assert.equal(page.page.data.items[0].status, 'PUBLISHED');
  d.state.replies.set(command, () => {
    d.state.ws = workspace({ files: [fileRow(newFile)], media: [mediaRow('REVOKED', 3)] });
    return ok(mediaRow('REVOKED', 3));
  });
  await page.page.revoke(tap({ id: mediaId }));
  await page.flush();
  assert.equal(page.page.data.items[0].status, 'REVOKED');
  page.unload();
});

// ---------- the stored record is the protection itself ----------
const PENDING_KEY = 'scb.mediaPending.v1';
function breakPending(d, which, storageKey = PENDING_KEY) {
  const get = d.wx.getStorageSync,
    set = d.wx.setStorageSync;
  const boom = () => {
    throw new Error('synthetic storage ' + which + ' failure');
  };
  if (which === 'read') d.wx.getStorageSync = (key) => (key === storageKey ? boom() : get(key));
  if (which === 'write')
    d.wx.setStorageSync = (key, value) => (key === storageKey ? boom() : set(key, value));
  return () => {
    d.wx.getStorageSync = get;
    d.wx.setStorageSync = set;
  };
}
const stored = (d, key = PENDING_KEY) => JSON.parse(JSON.stringify(d.wx.storage.get(key) || {}));

test('a record that cannot be stored stops the upload and the draft before sending', async () => {
  const d = deviceFor();
  d.state.ws = workspace({ files: [fileRow(newFile)] });
  const page = await d.open();
  breakPending(d, 'write', STORE_KEY);
  d.state.replies.set(UPLOAD, lost);
  const uploading = page.page.uploadImage();
  await ticks();
  d.pick();
  await uploading;
  await page.flush();
  assert.equal(d.sent(UPLOAD).length, 0, 'not sent without a stored record');
  assert.match(page.page.data.error, /本机存储/);
  assert.equal(page.page.data.request, null);
  page.page.titleInput(tap({}, { value: '决赛最后一攻' }));
  page.page.rightsInput(tap({}, { value: '主办方摄影组拍摄' }));
  await page.page.createDraft();
  await page.flush();
  assert.equal(d.sent(CREATE).length, 0);
  assert.equal(page.page.data.busy, false);
  page.unload();
});

test('unreadable storage is not taken as "no record": new requests stay blocked', async () => {
  for (const storageKey of [PENDING_KEY, STORE_KEY]) {
    const d = deviceFor();
    d.state.ws = workspace({ files: [fileRow(newFile)] });
    // An unresolved record may exist, but storage cannot be read right now.
    if (storageKey === PENDING_KEY)
      d.wx.storage.set(PENDING_KEY, {
        [pageKey]: { op: 'upload', name: 'photo.png', size: PNG.length, at: Date.now(), known: [] },
      });
    breakPending(d, 'read', storageKey);
    const page = await d.open();
    assert.match(page.page.data.storageError, /本机存储/, storageKey);
    d.state.picker = null;
    await page.page.uploadImage();
    assert.equal(d.state.picker, null, 'the picker is not even opened');
    page.page.titleInput(tap({}, { value: '决赛最后一攻' }));
    page.page.rightsInput(tap({}, { value: '主办方摄影组拍摄' }));
    await page.page.createDraft();
    assert.equal(d.sent(CREATE).length + d.sent(UPLOAD).length, 0);
    page.unload();
  }
});

test('a record whose removal cannot be written keeps protecting, also after re-entry', async () => {
  const d = deviceFor();
  const page = await d.open();
  d.state.replies.set(UPLOAD, () => {
    d.state.ws = workspace({ files: [fileRow(newFile)] });
    return lost();
  });
  const uploading = page.page.uploadImage();
  await ticks();
  d.pick();
  await uploading;
  await page.flush();
  const before = stored(d, STORE_KEY);
  assert.ok(before[pageKey], 'the request is stored');
  d.state.patterns.push([RECEIPT_UPLOAD, () => ok({ state: 'FILE', file: fileRow(newFile) })]);
  const restore = breakPending(d, 'write', STORE_KEY);
  await page.page.queryRequest();
  await page.flush();
  assert.match(page.page.data.error, /本机记录未能结束/);
  assert.deepEqual(stored(d, STORE_KEY), before, 'the stored record is intact');
  page.unload();
  const again = await d.open();
  assert.ok(stored(d, STORE_KEY)[pageKey], 'still stored after re-entry');
  d.state.picker = null;
  await again.page.uploadImage();
  assert.equal(d.state.picker, null);
  restore();
  await again.page.queryRequest();
  await again.flush();
  assert.equal(again.page.data.request, null, 'released once the removal is written');
  assert.deepEqual(stored(d, STORE_KEY), {});
  assert.equal(d.sent(UPLOAD).length, 1, 'the receipt resolved it; nothing was sent again');
  again.unload();
});

test('20 unresolved records are never evicted; a 21st operation is refused', async () => {
  const d = deviceFor();
  d.state.ws = workspace({ files: [fileRow(newFile)] });
  const others = {};
  for (let i = 0; i < 20; i++)
    others[userA + ':' + org + ':' + String(i).padStart(12, '0')] = {
      v: 2,
      op: 'draft',
      clientRequestId: '0b0f8f5e-6c1d-4a3b-9e2f-' + String(i).padStart(12, '0'),
      title: 'other-' + i,
      body: {},
      at: Date.now() - i,
    };
  d.wx.storage.set(STORE_KEY, others);
  const page = await d.open();
  assert.equal(page.page.data.request, null, 'none of them belongs to this match');
  d.state.replies.set(UPLOAD, lost);
  const uploading = page.page.uploadImage();
  await ticks();
  d.pick();
  await uploading;
  await page.flush();
  assert.equal(d.sent(UPLOAD).length, 0);
  assert.match(page.page.data.error, /20 条未完成/);
  page.page.titleInput(tap({}, { value: '决赛最后一攻' }));
  page.page.rightsInput(tap({}, { value: '主办方摄影组拍摄' }));
  await page.page.createDraft();
  assert.equal(d.sent(CREATE).length, 0);
  assert.deepEqual(stored(d, STORE_KEY), JSON.parse(JSON.stringify(others)), 'all kept');
  page.unload();
});
