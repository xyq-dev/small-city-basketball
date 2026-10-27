const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');

// PR #24 review: a picker result must stay bound to the account and page that opened it, and
// an upload or draft whose response was lost stays "unknown" — the existing API has no request
// identity, so name/size/time matches are never treated as proof and never reopen a retry.
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
const UPLOAD = 'POST ' + matchBase + '/media-files';
const CREATE = 'POST ' + matchBase + '/media';
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
  const state = { replies: new Map(), bodies: [], reads: 0, picker: null, ws: workspace() };
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

test('an older file with the same name and size is never taken as proof of a lost upload', async () => {
  const d = deviceFor();
  d.state.ws = workspace({ files: [fileRow(oldFile, 1)] });
  const page = await d.open();
  d.state.replies.set(UPLOAD, lost); // the server did not store anything
  const uploading = page.page.uploadImage();
  await ticks();
  d.pick();
  await uploading;
  await page.flush();
  await page.page.load();
  await page.flush();
  assert.ok(page.page.data.pending, 'the outcome stays unknown');
  assert.deepEqual(page.page.data.pending.candidates, [], 'the old file is not a candidate');
  assert.notEqual(page.page.data.upload && page.page.data.upload.stage, 'saved');
  assert.doesNotMatch(JSON.stringify(page.page.data), /已核对/);
  page.unload();
});

test('a delayed original request keeps every retry path closed, even after re-entering', async () => {
  const d = deviceFor();
  const page = await d.open();
  d.state.replies.set(UPLOAD, lost); // the server is still processing; nothing listed yet
  const uploading = page.page.uploadImage();
  await ticks();
  d.pick();
  await uploading;
  await page.flush();
  await page.page.load();
  await page.flush();
  assert.ok(page.page.data.pending, 'one empty listing is not a failure');
  assert.equal(page.page.data.canRetry, false);
  await page.page.retryUpload();
  d.state.picker = null;
  await page.page.uploadImage();
  assert.equal(d.state.picker, null, 'choosing another file is blocked as well');
  assert.equal(d.sent(UPLOAD).length, 1);
  page.unload();
  // The original lands later; a fresh page still remembers the unknown attempt.
  d.state.ws = workspace({ files: [fileRow(newFile)] });
  const again = await d.open();
  assert.ok(again.page.data.pending, 'pending survives page re-entry');
  assert.equal(again.page.data.pending.candidates.length, 1, 'shown for the organizer to check');
  await again.page.uploadImage();
  assert.equal(d.state.picker, null);
  assert.equal(d.sent(UPLOAD).length, 1, 'never sent twice');
  // Only the organizer's explicit check ends it; the page does not claim proof.
  await again.page.confirmPending(tap({ id: newFile }));
  assert.equal(again.page.data.pending, null);
  assert.match(again.page.data.upload.label, /由你核对/);
  again.unload();
});

test('a known rejection can still be retried with the original file', async () => {
  const d = deviceFor();
  const page = await d.open();
  d.state.replies.set(UPLOAD, () => fail(409, 'MEDIA_STORAGE_LIMIT'));
  const uploading = page.page.uploadImage();
  await ticks();
  d.pick();
  await uploading;
  await page.flush();
  assert.equal(page.page.data.pending, null);
  assert.equal(page.page.data.canRetry, true);
  d.state.replies.set(UPLOAD, () => {
    d.state.ws = workspace({ files: [fileRow(newFile)] });
    return ok(fileRow(newFile));
  });
  await page.page.retryUpload();
  await page.flush();
  assert.equal(d.sent(UPLOAD).length, 2);
  assert.deepEqual(d.sent(UPLOAD)[1].body, d.sent(UPLOAD)[0].body, 'the same file again');
  assert.equal(page.page.data.upload.stage, 'saved');
  page.unload();
});

test('a draft whose response was lost is not created again', async () => {
  const d = deviceFor();
  d.state.ws = workspace({ files: [fileRow(newFile)] });
  const page = await d.open();
  page.page.titleInput(tap({}, { value: '决赛最后一攻' }));
  page.page.rightsInput(tap({}, { value: '主办方摄影组拍摄' }));
  d.state.replies.set(CREATE, lost);
  await page.page.createDraft();
  await page.flush();
  await page.page.load();
  await page.flush();
  assert.ok(page.page.data.pending, 'draft outcome stays unknown');
  await page.page.createDraft();
  await page.flush();
  assert.equal(d.sent(CREATE).length, 1, 'no second draft');
  page.unload();
  const again = await d.open();
  await again.page.createDraft();
  assert.equal(d.sent(CREATE).length, 1, 'not after re-entry either');
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
  assert.equal(page.page.data.pending, null);
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
