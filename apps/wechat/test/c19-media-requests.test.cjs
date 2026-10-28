const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const requests = require('../utils/media-request.js');

// C19 match media request identity and chunked upload sessions, against a synthetic in-memory
// server that applies the frozen contract (docs/design/C19_CONTRACTS.md §2). Real API behaviour is
// covered by apps/api/test/c19-media-requests.integration.test.ts and the real-API page loop in
// tests/wechat-api/c19-media.test.mjs.
const org = '11111111-1111-4111-8111-111111111111';
const matchId = '44444444-4444-4444-8444-444444444444';
const userA = '55555555-5555-4555-8555-555555555555';
const userB = '66666666-6666-4666-8666-666666666666';
const cookieA = 'a'.repeat(43);
const cookieB = 'b'.repeat(43);
const CHUNK = 524288;
const matchBase = '/v1/orgs/' + org + '/matches/' + matchId;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const ticks = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
const tap = (dataset = {}, detail = {}) => ({ type: 'tap', currentTarget: { dataset }, detail });
const ok = (data, cookie) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-c19' } },
  header: cookie ? { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' } : {},
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
const workspace = (files) => ({
  matchId,
  eventId: '33333333-3333-4333-8333-333333333333',
  matchStatus: 'FINAL',
  matchVersion: 3,
  currentConfirmationId: null,
  files,
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
});

// Shared verbatim with apps/api/src/media-request-domain.test.ts.
const VECTORS = [
  {
    operation: 'MATCH_FILE_UPLOAD',
    fields: ['MATCH_IMAGE', '决赛.png', 'image/png', 68, 'a'.repeat(64)],
    hash: 'd5a9800aab85345850ef66d219c7fc80baf1282d43d1dfad73902356711007e8',
  },
  {
    operation: 'MATCH_MEDIA_CREATE',
    fields: [
      'EXTERNAL_LINK',
      'Café 决赛',
      null,
      'https://video.example.test/v/1',
      '主办方授权平台发布',
    ],
    hash: '99f08542eba739e6e3f843a4f00395b1378140ca2af9e499fe603b0ce8308817',
  },
  {
    operation: 'MATCH_MEDIA_CREATE',
    fields: [
      'IMAGE',
      '决赛最后一攻',
      '77777777-7777-4777-8777-777777777771',
      null,
      '主办方摄影组拍摄',
    ],
    hash: 'c7d769d71667fdd050236d4d7e4b78c0f6dcac37f2e90beea14310181d310f4c',
  },
];

/** A synthetic server implementing the receipt and session rules, plus a device double. */
function deviceFor({ size = CHUNK * 2 + 777 } = {}) {
  const BIG = randomBytes(size);
  const server = {
    files: [],
    receipts: new Map(),
    sessions: new Map(),
    log: [],
    drops: [],
    holds: new Map(),
    override: new Map(),
  };
  const fsFiles = new Map([['wxfile://tmp/clip.mp4', BIG]]);
  const unlinked = [];
  let who = userA;
  const fileOf = (s) => ({
    id: 'f' + s.id.slice(1),
    purpose: s.meta.purpose,
    rosterRevisionId: null,
    fileName: s.meta.fileName,
    contentType: s.meta.contentType,
    byteLength: s.meta.byteLength,
    sha256: s.meta.contentSha256,
    version: 1,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    revokedAt: null,
    purgedAt: null,
  });
  const dto = (s) => ({
    id: s.id,
    clientRequestId: s.meta.clientRequestId,
    status: s.status,
    byteLength: s.meta.byteLength,
    chunkSize: CHUNK,
    chunkCount: Math.ceil(s.meta.byteLength / CHUNK),
    receivedBytes:
      s.status === 'COMPLETED'
        ? s.meta.byteLength
        : s.status === 'OPEN'
          ? [...s.chunks.values()].reduce((n, c) => n + c.length, 0)
          : 0,
    chunks:
      s.status === 'OPEN'
        ? [...s.chunks.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([index, c]) => ({ index, byteLength: c.length, sha256: sha(c) }))
        : [],
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    file: s.file || null,
  });
  function apply(method, url, body) {
    const p = url.slice(matchBase.length);
    let m;
    if (method === 'GET' && p === '/media') return ok(workspace(server.files));
    if (method === 'POST' && p === '/media-upload-sessions') {
      const r = server.receipts.get(who + body.clientRequestId);
      if (r) return ok(dto(server.sessions.get(r.sessionId)));
      const id = 'a' + sha(body.clientRequestId).slice(1, 8) + '-0000-4000-8000-000000000000';
      const s = { id, owner: who, meta: body, status: 'OPEN', chunks: new Map() };
      server.sessions.set(id, s);
      server.receipts.set(who + body.clientRequestId, { sessionId: id });
      return { ...ok(dto(s)), statusCode: 201 };
    }
    if ((m = /^\/media-upload-sessions\/([^/]+)$/.exec(p)) && method === 'GET') {
      const s = server.sessions.get(m[1]);
      return s && s.owner === who ? ok(dto(s)) : fail(404, 'RESOURCE_NOT_FOUND');
    }
    if ((m = /^\/media-upload-sessions\/([^/]+)\/chunks\/(\d+)$/.exec(p)) && method === 'PUT') {
      const s = server.sessions.get(m[1]);
      if (!s || s.owner !== who) return fail(404, 'RESOURCE_NOT_FOUND');
      if (s.status === 'COMPLETED') return fail(409, 'UPLOAD_SESSION_COMPLETED');
      if (s.status !== 'OPEN') return fail(409, 'REQUEST_CLOSED');
      const bytes = Buffer.from(body.contentBase64, 'base64');
      assert.equal(sha(bytes), body.sha256, 'client chunk digest');
      assert.equal(bytes.length, body.byteLength);
      const index = Number(m[2]);
      const prev = s.chunks.get(index);
      if (prev && !prev.equals(bytes)) return fail(409, 'CHUNK_CONFLICT');
      s.chunks.set(index, bytes);
      return ok(dto(s));
    }
    if ((m = /^\/media-upload-sessions\/([^/]+)\/complete$/.exec(p)) && method === 'POST') {
      const s = server.sessions.get(m[1]);
      if (s.status === 'COMPLETED') return ok({ state: 'FILE', file: s.file });
      if (s.status !== 'OPEN') return fail(409, 'REQUEST_CLOSED');
      const whole = Buffer.concat(
        [...s.chunks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]),
      );
      if (sha(whole) !== s.meta.contentSha256) return fail(409, 'UPLOAD_INCOMPLETE');
      s.status = 'COMPLETED';
      s.file = fileOf(s);
      server.files.push(s.file);
      return ok({ state: 'FILE', file: s.file });
    }
    if ((m = /^\/media-upload-sessions\/([^/]+)\/cancel$/.exec(p)) && method === 'POST') {
      const s = server.sessions.get(m[1]);
      if (s.status === 'COMPLETED') return fail(409, 'UPLOAD_SESSION_COMPLETED');
      s.status = 'CANCELLED';
      s.chunks.clear();
      return ok(dto(s));
    }
    if ((m = /^\/media-file-requests\/([^/]+)$/.exec(p)) && method === 'GET') {
      const r = server.receipts.get(who + m[1]);
      if (!r) return fail(404, 'RECEIPT_NOT_FOUND');
      const s = server.sessions.get(r.sessionId);
      return ok(s.file ? { state: 'FILE', file: s.file } : { state: 'SESSION', session: dto(s) });
    }
    return fail(404, 'TEST_UNHANDLED');
  }
  const wx = createWx({
    modalAnswers: Array(40).fill(true),
    async request(options) {
      const method = options.method || 'GET';
      const url = options.url.replace(/^https:\/\/[^/]+/, '');
      const key = method + ' ' + url;
      if (key === 'GET /v1/auth/session')
        return ok(sessionOf(who), who === userA ? cookieA : cookieB);
      if (key === 'POST /v1/auth/login') {
        who = userB;
        return ok(sessionOf(userB), cookieB);
      }
      server.log.push({
        key,
        who,
        body: options.data ? JSON.parse(JSON.stringify(options.data)) : null,
      });
      const hold = [...server.holds.entries()].find(([re]) => re.test(key));
      if (hold) {
        server.holds.delete(hold[0]);
        await hold[1];
      }
      const override = [...server.override.entries()].find(([re]) => re.test(key));
      const response = override ? override[1]() : apply(method, url, options.data);
      const drop = server.drops.findIndex((re) => re.test(key));
      if (drop >= 0) {
        server.drops.splice(drop, 1);
        throw new Error('synthetic lost response (server applied it)');
      }
      return response;
    },
  });
  wx.env = { USER_DATA_PATH: 'wxfile://usr' };
  wx.chooseMedia = (o) =>
    o.success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/clip.mp4', size: BIG.length }] });
  wx.getFileSystemManager = () => ({
    readFile(o) {
      const b = fsFiles.get(o.filePath);
      if (!b) return o.fail({ errMsg: 'readFile:fail no such file' });
      o.success({ data: b.toString('base64') });
    },
    copyFile(o) {
      const b = fsFiles.get(o.srcPath);
      if (!b) return o.fail({ errMsg: 'copyFile:fail no such file' });
      fsFiles.set(o.destPath, Buffer.from(b));
      o.success();
    },
    writeFile(o) {
      fsFiles.set(o.filePath, Buffer.from(o.data));
      o.success();
    },
    unlink(o) {
      unlinked.push(o.filePath);
      fsFiles.delete(o.filePath);
      o.success && o.success();
    },
  });
  const sent = (re) => server.log.filter((l) => re.test(l.key));
  return {
    wx,
    BIG,
    server,
    fsFiles,
    unlinked,
    sent,
    hold(re) {
      let release;
      server.holds.set(re, new Promise((r) => (release = r)));
      return () => release();
    },
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
const CHUNKS = /^PUT .*\/media-upload-sessions\/[^/]+\/chunks\/\d+$/;
const CREATE = /^POST .*\/media-upload-sessions$/;
const COMPLETE = /\/complete$/;
const STORE = 'scb.mediaRequests.v2';
const keyA = userA + ':' + org + ':' + matchId;
const record = (d, key = keyA) => (d.wx.storage.get(STORE) || {})[key];

test('client fingerprints match the shared known vectors and the NFC/trim rule', () => {
  for (const v of VECTORS) assert.equal(requests.fingerprint(v.operation, v.fields), v.hash);
  assert.equal(requests.normalizeText('  Café 决赛 '), 'Café 决赛');
  assert.equal(
    requests.fingerprint('MATCH_MEDIA_CREATE', [
      'EXTERNAL_LINK',
      requests.normalizeText(' Café 决赛'),
      null,
      requests.canonicalLink('https://VIDEO.example.test/v/1'),
      '主办方授权平台发布',
    ]),
    VECTORS[1].hash,
  );
  for (const n of [0, 55, 64, 1000, CHUNK + 3]) {
    const b = randomBytes(n);
    assert.equal(requests.sha256(new Uint8Array(b)), sha(b));
  }
  assert.equal(requests.canonicalLink('https://video.example.test/a b'), '');
  assert.equal(requests.canonicalLink('https://video.example.test:8443/'), '');
});

test('orphan cleanup preserves a staging copy until its request is stored, even on another page', async () => {
  const d = deviceFor();
  const fs = d.wx.getFileSystemManager();
  let pending;
  d.wx.getFileSystemManager = () => ({
    ...fs,
    copyFile(options) {
      pending = options;
    },
  });
  const copying = requests.stage(
    d.wx,
    'wxfile://tmp/clip.mp4',
    '77777777-7777-4777-8777-777777777777',
    'video/mp4',
  );
  requests.sweepStaged(d.wx);
  assert.deepEqual(d.unlinked, [], 'a pending copy is not an abandoned upload');
  fs.copyFile(pending);
  const path = await copying;
  requests.sweepStaged(d.wx);
  assert.ok(d.fsFiles.has(path), 'the copied file stays protected until the request is saved');
  assert.equal(requests.saveRecord(d.wx, keyA, { path }), '');
  requests.completeStaging(path);
  requests.sweepStaged(d.wx);
  assert.ok(d.fsFiles.has(path), 'the stored request takes over protection');
  assert.equal(requests.saveRecord(d.wx, keyA, null), '');
  requests.sweepStaged(d.wx);
  assert.deepEqual(d.unlinked, [path], 'only an actually abandoned copy is removed');
});

test('a failed staging copy releases its cleanup protection and retains failed deletion for retry', async () => {
  const d = deviceFor();
  const fs = d.wx.getFileSystemManager();
  d.wx.getFileSystemManager = () => ({
    ...fs,
    copyFile(options) {
      fs.copyFile({ ...options, success() {} });
      options.fail({ errMsg: 'synthetic copy interrupted after partial write' });
    },
    unlink(options) {
      options.fail({ errMsg: 'synthetic temporarily locked file' });
    },
  });
  await assert.rejects(
    requests.stage(
      d.wx,
      'wxfile://tmp/clip.mp4',
      '88888888-8888-4888-8888-888888888888',
      'video/mp4',
    ),
    /暂存待上传文件失败/,
  );
  assert.equal(d.wx.storage.get(requests.STAGING_KEY).length, 1);
  d.wx.getFileSystemManager = () => fs;
  requests.sweepStaged(d.wx);
  assert.equal(d.unlinked.length, 1);
  assert.deepEqual(d.wx.storage.get(requests.STAGING_KEY), []);
});

test('chunked upload: only server-confirmed bytes are shown; verification and success are separate', async () => {
  const d = deviceFor();
  const page = await d.open();
  const release = d.hold(COMPLETE);
  const uploading = page.page.uploadVideo();
  for (let i = 0; i < 40 && !d.sent(COMPLETE).length; i++) await ticks();
  assert.equal(page.page.data.upload.stage, 'verifying');
  assert.equal(page.page.data.upload.confirmed, d.BIG.length);
  assert.match(page.page.data.upload.label, /分片已全部被服务端确认/);
  assert.equal(page.page.data.files.length, 0, 'not shown as saved before the final receipt');
  const shown = page.updates
    .filter((u) => u.upload && u.upload.stage === 'chunks')
    .map((u) => u.upload.confirmed);
  assert.deepEqual(
    shown,
    [0, CHUNK, CHUNK * 2, d.BIG.length],
    'each value came from a server reply',
  );
  release();
  await uploading;
  await page.flush();
  assert.equal(page.page.data.upload.stage, 'saved');
  assert.equal(page.page.data.files.length, 1);
  assert.equal(d.sent(CREATE).length, 1);
  assert.deepEqual(
    d.sent(CHUNKS).map((l) => Number(l.key.split('/').pop())),
    [0, 1, 2],
  );
  assert.equal(record(d), undefined, 'record cleared');
  assert.ok(
    d.unlinked.some((p) => /\/scb-upload-[0-9a-f-]{36}\.mp4$/.test(p)),
    'staged file released',
  );
  const meta = d.sent(CREATE)[0].body;
  assert.equal(meta.contentSha256, sha(d.BIG));
  assert.equal(meta.byteLength, d.BIG.length);
  page.unload();
});

test('an interrupted upload resumes from server-confirmed chunks with the same ID after re-entry', async () => {
  const d = deviceFor();
  const page = await d.open();
  d.server.drops.push(/\/chunks\/1$/); // chunk 1 was stored, the reply was lost
  await page.page.uploadVideo();
  await page.flush();
  assert.equal(page.page.data.request.state, 'unknown');
  const stored = record(d);
  assert.ok(stored.sessionId && /scb-upload-/.test(stored.path));
  // Preview cleanup never touches the staged upload file.
  page.requireLocal('utils/media.js').sweepTemps(d.wx);
  page.unload();
  assert.ok(d.fsFiles.has(stored.path), 'staged file kept for resumption');
  const again = await d.open(); // re-entry queries the original ID's receipt
  assert.equal(again.page.data.request.state, 'session');
  assert.equal(again.page.data.request.canContinue, true);
  assert.equal(again.page.data.upload.confirmed, CHUNK * 2);
  assert.match(again.page.data.request.message, /已确认 1\.0 MB/);
  await again.page.continueRequest();
  await again.flush();
  assert.equal(again.page.data.upload.stage, 'saved');
  assert.deepEqual(
    d.sent(CHUNKS).map((l) => Number(l.key.split('/').pop())),
    [0, 1, 2],
    'only the missing chunk was sent after resuming',
  );
  assert.equal(d.sent(CREATE).length, 1, 'never a second session or request ID');
  assert.equal(d.server.files.length, 1);
  assert.ok(!d.fsFiles.has(stored.path));
  again.unload();
});

test('a changed or missing local file is never sent and never swapped for a new ID', async () => {
  for (const change of ['changed', 'missing']) {
    const d = deviceFor();
    const page = await d.open();
    d.server.drops.push(/\/chunks\/0$/);
    await page.page.uploadVideo();
    await page.flush();
    await page.page.queryRequest();
    await page.flush();
    const stored = record(d);
    if (change === 'changed') d.fsFiles.set(stored.path, randomBytes(d.BIG.length));
    else d.fsFiles.delete(stored.path);
    const before = d.server.log.length;
    await page.page.continueRequest();
    await page.flush();
    assert.equal(page.page.data.request.state, 'local', change);
    assert.equal(d.server.log.length, before, change + ': nothing sent');
    assert.equal(record(d).clientRequestId, stored.clientRequestId);
    assert.equal(page.page.data.request.canCancel, true);
    await page.page.cancelRequest();
    await page.flush();
    assert.equal(record(d), undefined, change + ': cancelled on the server, record ended');
    assert.equal(d.server.sessions.get(stored.sessionId).status, 'CANCELLED');
    page.unload();
  }
});

test('an account switch or unload mid-upload stops sending and leaves the record to its owner', async () => {
  for (const change of ['switch', 'unload']) {
    const d = deviceFor();
    const page = await d.open();
    const release = d.hold(/\/chunks\/0$/);
    const uploading = page.page.uploadVideo();
    for (let i = 0; i < 40 && !d.sent(CHUNKS).length; i++) await ticks();
    if (change === 'switch')
      await page.client.request('/v1/auth/login', 'POST', { email: 'b@example.test' });
    else page.unload();
    release();
    await uploading;
    await ticks(30);
    assert.equal(d.sent(CHUNKS).length, 1, change + ': no further chunk');
    assert.equal(d.sent(COMPLETE).length, 0);
    assert.ok(record(d), change + ': the owner keeps the record');
    assert.ok(d.fsFiles.has(record(d).path), change + ': the staged file is kept');
    if (change === 'switch') {
      assert.equal(page.page.data.request, null, 'account B sees nothing of account A');
      await page.page.load();
      await page.flush();
      assert.equal(page.page.data.request, null);
      assert.ok(
        d.server.log
          .filter((l) => l.who === userB)
          .every((l) => !/media-(file-requests|requests|upload-sessions)/.test(l.key)),
        'no request of account A is touched with account B',
      );
      page.unload();
    }
  }
});

test('a record that cannot be stored sends nothing and releases the staged copy', async () => {
  const d = deviceFor();
  const page = await d.open();
  const set = d.wx.setStorageSync;
  d.wx.setStorageSync = (key, value) => {
    if (key === STORE) throw new Error('synthetic storage failure');
    return set(key, value);
  };
  await page.page.uploadVideo();
  await page.flush();
  assert.equal(d.sent(CREATE).length + d.sent(CHUNKS).length, 0);
  assert.match(page.page.data.error, /本机存储/);
  assert.ok(d.unlinked.some((p) => /scb-upload-/.test(p)));
  page.unload();
});

test('conflicts keep the record without resending; a closed session ends it truthfully', async () => {
  const d = deviceFor();
  const page = await d.open();
  d.server.override.set(CREATE, () => fail(409, 'IDEMPOTENCY_CONFLICT'));
  await page.page.uploadVideo();
  await page.flush();
  assert.equal(page.page.data.request.state, 'conflict');
  assert.equal(page.page.data.request.canResend, false);
  const before = d.server.log.length;
  await page.page.resendRequest();
  assert.equal(d.server.log.length, before, 'no resend of a conflicting request');
  await page.page.endRequest();
  assert.equal(record(d), undefined);
  d.server.override.clear();
  d.server.override.set(/\/chunks\/1$/, () => fail(409, 'REQUEST_CLOSED'));
  await page.page.uploadVideo();
  await page.flush();
  assert.equal(record(d), undefined, 'a closed session ends the record');
  assert.match(page.page.data.error, /已取消或过期/);
  assert.notEqual(page.page.data.upload.stage, 'saved');
  page.unload();
});

test('cancelling after the server already completed shows the completed file, not a cancellation', async () => {
  const d = deviceFor();
  const page = await d.open();
  d.server.drops.push(COMPLETE); // completed on the server, reply lost
  await page.page.uploadVideo();
  await page.flush();
  assert.equal(page.page.data.request.state, 'unknown');
  // Force a "session" view as if the user acts before the receipt is read.
  const r = record(d);
  d.wx.storage.set(STORE, { [keyA]: { ...r, state: 'session' } });
  await page.page.cancelRequest();
  await page.flush();
  assert.equal(page.page.data.upload.stage, 'saved');
  assert.equal(page.page.data.request, null);
  assert.equal(d.server.sessions.get(r.sessionId).status, 'COMPLETED');
  page.unload();
});

test('a legacy unknown record keeps the manual check path and is not looked up as a request', async () => {
  const d = deviceFor();
  d.wx.storage.set('scb.mediaPending.v1', {
    [keyA]: { op: 'upload', name: 'clip.mp4', size: 10, at: Date.now(), known: [] },
  });
  const page = await d.open();
  assert.ok(page.page.data.pending, 'legacy record shown for manual checking');
  assert.equal(page.page.data.request, null);
  assert.equal(d.sent(/media-file-requests\//).length, 0, 'no receipt lookup for a legacy record');
  await page.page.uploadVideo();
  assert.equal(d.sent(CREATE).length, 0, 'still blocked until the organizer resolves it');
  await page.page.dismissPending();
  assert.equal(page.page.data.pending, null);
  page.unload();
});
