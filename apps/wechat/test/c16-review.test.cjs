const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');

// PR #25 review: (1) a confirmation that returns after an account change, sign-out or unload
// must not start the write it was opened for; (2) private preview must stay cancelled after
// close/hide (even when the page shows again) and must not lose track of a temporary file whose
// removal failed.
const org = '11111111-1111-4111-8111-111111111111';
const eventId = '33333333-3333-4333-8333-333333333333';
const matchId = '44444444-4444-4444-8444-444444444444';
const userA = '55555555-5555-4555-8555-555555555555';
const userB = '66666666-6666-4666-8666-666666666666';
const fileId = '77777777-7777-4777-8777-777777777771';
const mediaId = '77777777-7777-4777-8777-777777777772';
const courtA = '66666666-6666-4666-8666-666666666661';
const cookieA = 'a'.repeat(43);
const cookieB = 'b'.repeat(43);
const TEMP_KEY = 'scb.mediaTemp.v1';
const PENDING_KEY = 'scb.mediaPending.v1';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const ok = (data, cookie = cookieA, meta = {}) => ({
  statusCode: 200,
  data: { data, meta: { requestId: 'synthetic-c16-review', nextCursor: null, ...meta } },
  header: { 'set-cookie': 'scb.sid=' + cookie + '; Path=/; Secure; HttpOnly' },
});
const sessionOf = (id) => ({
  user: { id, email: id.slice(0, 4) + '@example.test', displayName: '合成账号' },
  organizations: [{ id: org, name: '合成机构', role: 'ORG_OWNER' }],
  teamContexts: [],
});
const ticks = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tap = (dataset = {}, detail = {}) => ({ type: 'tap', currentTarget: { dataset }, detail });
const matchBase = '/v1/orgs/' + org + '/matches/' + matchId;

const fileRow = (over = {}) => ({
  id: fileId,
  purpose: 'MATCH_IMAGE',
  rosterRevisionId: null,
  fileName: 'photo.png',
  contentType: 'image/png',
  byteLength: PNG.length,
  sha256: '2'.repeat(64),
  version: 2,
  status: 'ACTIVE',
  createdAt: new Date().toISOString(),
  revokedAt: null,
  purgedAt: null,
  ...over,
});
const mediaRow = (status) => ({
  id: mediaId,
  kind: 'IMAGE',
  title: '决赛最后一攻',
  fileId,
  externalUrl: null,
  rightsDeclaration: '主办方摄影组拍摄',
  status,
  version: 4,
  createdAt: new Date().toISOString(),
  markers: [],
});
const workspace = (over = {}) => ({
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
});

// One device: shared wx/storage, sessions A then B, controllable modal and file system.
function device(ws) {
  const state = {
    ws,
    who: userA,
    bodies: [],
    modal: null,
    downloads: [],
    writes: [],
    files: new Map(),
    unlinked: [],
    unlinkFails: 0,
    previews: [],
    holdDownload: false,
    holdWrite: false,
  };
  const wx = createWx({
    request(options) {
      const url = options.url.replace(/^https:\/\/[^/]+/, '');
      const key = (options.method || 'GET') + ' ' + url;
      if (options.method && options.method !== 'GET')
        state.bodies.push({ key, cookie: (options.header || {}).Cookie || '' });
      if (url === '/v1/auth/session')
        return ok(sessionOf(state.who), state.who === userA ? cookieA : cookieB);
      if (key === 'POST /v1/auth/login') {
        state.who = userB;
        return ok(sessionOf(userB), cookieB);
      }
      if (key === 'GET ' + matchBase + '/media') return ok(state.ws);
      if (/\/media-files\/[^/]+\/content$/.test(url)) {
        const reply = () => ({
          statusCode: 200,
          data: PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
          header: { 'Content-Type': 'image/png' },
        });
        if (!state.holdDownload) return reply();
        return new Promise((resolve) => state.downloads.push(() => resolve(reply())));
      }
      if (options.method === 'POST' || options.method === 'PATCH') return ok({});
      return { statusCode: 404, data: { error: { code: 'TEST_UNHANDLED', message: key } } };
    },
  });
  wx.showModal = (o) => {
    state.modal = o;
  };
  wx.env = { USER_DATA_PATH: 'wxfile://usr' };
  wx.getFileSystemManager = () => ({
    writeFile(o) {
      const done = () => {
        state.files.set(o.filePath, o.data);
        o.success();
      };
      if (state.holdWrite) state.writes.push(done);
      else done();
    },
    unlink(o) {
      if (state.unlinkFails > 0) {
        state.unlinkFails--;
        o.fail && o.fail({ errMsg: 'unlink:fail resource busy' });
        return;
      }
      if (!state.files.has(o.filePath)) {
        o.fail && o.fail({ errMsg: 'unlink:fail no such file or directory' });
        return;
      }
      state.files.delete(o.filePath);
      state.unlinked.push(o.filePath);
      o.success && o.success();
    },
  });
  wx.previewImage = (o) => {
    state.previews.push(o.current);
    o.success();
  };
  const answer = (confirm) => {
    const m = state.modal;
    state.modal = null;
    m.success({ confirm, cancel: !confirm });
  };
  return {
    wx,
    state,
    answer,
    writes: (re) => state.bodies.filter((b) => re.test(b.key)),
    async open(route = 'pages/match-media/index', query = { orgId: org, matchId }) {
      const h = loadPage({ root, route, wx });
      const client = h.requireLocal('utils/api.js').getClient();
      await client.request('/v1/auth/session');
      h.page.onLoad(query);
      await h.flush();
      return { ...h, client };
    },
  };
}
async function change(page, kind) {
  if (kind === 'logout') page.client.clearSession();
  if (kind === 'switch')
    await page.client.request('/v1/auth/login', 'POST', { email: 'b@example.test' });
  if (kind === 'unload') page.unload();
}

// ---------- 1. confirmations bound to their account, page and target ----------
const flows = [
  {
    name: 'purge',
    ws: () => workspace({ files: [fileRow({ status: 'REVOKED' })] }),
    start: (p) => {
      p.page.askPurgeFile(tap({ id: fileId }));
      p.page.purgeReasonInput(tap({}, { value: '按要求永久删除正文' }));
      return p.page.purgeFile();
    },
    sent: /media-files\/.*\/commands$/,
  },
  {
    name: 'revoke file',
    ws: () => workspace({ files: [fileRow()] }),
    start: (p) => {
      p.page.askRevokeFile(tap({ id: fileId }));
      p.page.revokeReasonInput(tap({}, { value: '误传的测试图片' }));
      return p.page.revokeFile();
    },
    sent: /media-files\/.*\/commands$/,
  },
  {
    name: 'publish',
    ws: () => workspace({ files: [fileRow()], media: [mediaRow('DRAFT')] }),
    start: (p) => p.page.publish(tap({ id: mediaId })),
    sent: /\/media\/.*\/commands$/,
  },
  {
    name: 'revoke media',
    ws: () => workspace({ files: [fileRow()], media: [mediaRow('PUBLISHED')] }),
    start: (p) => p.page.revoke(tap({ id: mediaId })),
    sent: /\/media\/.*\/commands$/,
  },
];
for (const flow of flows)
  for (const kind of ['switch', 'logout', 'unload'])
    test('a late confirmation of ' + flow.name + ' after ' + kind + ' sends nothing', async () => {
      const d = device(flow.ws());
      const p = await d.open();
      const pending = flow.start(p);
      await ticks();
      assert.ok(d.state.modal, 'confirmation is open');
      await change(p, kind);
      d.answer(true);
      await pending;
      await ticks();
      assert.equal(d.writes(flow.sent).length, 0, 'no ' + flow.name + ' request');
      if (kind === 'unload') assert.equal(p.page._closed, true, 'the page stays closed');
    });

test('a late confirmation to end an unknown record after an account change keeps the record', async () => {
  const d = device(workspace());
  d.wx.storage.set(PENDING_KEY, {
    [userA + ':' + org + ':' + matchId]: {
      op: 'upload',
      name: 'photo.png',
      size: PNG.length,
      at: 1,
      known: [],
    },
  });
  const p = await d.open();
  assert.ok(p.page.data.pending);
  const pending = p.page.dismissPending();
  await ticks();
  await change(p, 'switch');
  d.answer(true);
  await pending;
  assert.ok(
    d.wx.storage.get(PENDING_KEY)[userA + ':' + org + ':' + matchId],
    'account A record untouched',
  );
});

test('a confirmation whose target changed meanwhile sends nothing', async () => {
  const d = device(workspace({ files: [fileRow({ status: 'REVOKED' })] }));
  const p = await d.open();
  p.page.askPurgeFile(tap({ id: fileId }));
  p.page.purgeReasonInput(tap({}, { value: '按要求永久删除正文' }));
  const pending = p.page.purgeFile();
  await ticks();
  // A re-read while the dialog is open shows the file already purged elsewhere.
  d.state.ws = workspace({ files: [fileRow({ status: 'PURGED', version: 3 })] });
  p.page.show(d.state.ws, null);
  d.answer(true);
  await pending;
  assert.equal(d.writes(/commands$/).length, 0);
});

test('normal confirm still writes once, and cancel writes nothing', async () => {
  const d = device(workspace({ files: [fileRow({ status: 'REVOKED' })] }));
  const p = await d.open();
  p.page.askPurgeFile(tap({ id: fileId }));
  p.page.purgeReasonInput(tap({}, { value: '按要求永久删除正文' }));
  let pending = p.page.purgeFile();
  await ticks();
  d.answer(false);
  await pending;
  assert.equal(d.writes(/commands$/).length, 0);
  pending = p.page.purgeFile();
  await ticks();
  d.answer(true);
  await pending;
  await p.flush();
  assert.equal(d.writes(/commands$/).length, 1);
  assert.equal(d.writes(/commands$/)[0].cookie, 'scb.sid=' + cookieA);
});

test('court disable: a late confirmation after logout or unload sends nothing', async () => {
  for (const kind of ['logout', 'switch', 'unload']) {
    const d = device(workspace());
    const evBase = '/v1/orgs/' + org + '/events/' + eventId;
    const base = d.wx.request;
    d.wx.request = (o) => {
      const url = o.url.replace(/^https:\/\/[^/]+/, '');
      if (url === evBase + '/scheduling') {
        o.success(
          ok({
            event: {
              id: eventId,
              name: '合成赛事',
              status: 'REGISTRATION_FROZEN',
              version: 5,
              startDate: '2028-03-01',
              endDate: '2028-03-02',
              format: 'ROUND_ROBIN',
            },
            freeze: null,
            currentRevision: null,
            publication: null,
            support: { supported: true, reason: null },
            capabilities: { canGenerate: true, canRedraw: false, canReadMatches: true },
          }),
        );
        o.complete && o.complete();
        return { abort() {} };
      }
      if (url === '/v1/orgs/' + org + '/courts?limit=100') {
        o.success(
          ok(
            [
              {
                id: courtA,
                name: '一号场',
                status: 'ACTIVE',
                version: 4,
                capabilities: { canManage: true },
              },
            ],
            cookieA,
            { capabilities: { canCreateCourt: true } },
          ),
        );
        o.complete && o.complete();
        return { abort() {} };
      }
      return base(o);
    };
    const p = await d.open('pages/schedule/index', { orgId: org, eventId });
    assert.equal(p.page.data.courtAdmin.length, 1);
    const pending = p.page.toggleCourtStatus(tap({ id: courtA }));
    await ticks();
    await change(p, kind);
    d.answer(true);
    await pending;
    await ticks();
    assert.equal(d.writes(/PATCH .*\/courts\//).length, 0, kind);
  }
});

// ---------- 2. preview cancellation and cleanup ----------
async function previewDevice() {
  const d = device(workspace({ files: [fileRow()] }));
  const p = await d.open();
  return { d, p };
}

test('closing then returning never revives an old download', async () => {
  const { d, p } = await previewDevice();
  d.state.holdDownload = true;
  const pending = p.page.preview(tap({ id: fileId }));
  await ticks();
  p.page.onHide();
  p.page.onShow();
  d.state.downloads.shift()();
  await pending;
  await ticks();
  assert.equal(d.state.files.size, 0, 'nothing written');
  assert.equal(d.state.previews.length, 0, 'nothing opened');
  assert.equal(p.page.data.busy, false);
});

test('a write still in progress when the preview closes is removed when it finishes', async () => {
  const { d, p } = await previewDevice();
  d.state.holdWrite = true;
  const pending = p.page.preview(tap({ id: fileId }));
  await ticks();
  assert.equal(d.state.writes.length, 1, 'write started');
  p.page.closePreview();
  p.page.onShow();
  d.state.writes.shift()();
  await pending;
  await ticks();
  assert.equal(d.state.previews.length, 0, 'the stale write does not open a preview');
  assert.equal(d.state.files.size, 0, 'and its file is removed');
  assert.deepEqual(d.wx.storage.get(TEMP_KEY) || [], [], 'nothing left to clean');
});

test('a failed removal stays tracked, is retried, and survives the page', async () => {
  const { d, p } = await previewDevice();
  const media = p.requireLocal('utils/media.js');
  media.TEMP_RETRY_DELAYS.splice(0, Infinity, 5, 5);
  await p.page.preview(tap({ id: fileId }));
  await p.flush();
  const written = [...d.state.files.keys()][0];
  assert.ok(written, 'preview file written');
  assert.deepEqual(d.wx.storage.get(TEMP_KEY), [written], 'tracked before writing');
  d.state.unlinkFails = 10; // busy: every retry fails for now
  p.page.onHide();
  await sleep(40);
  assert.ok(d.state.files.has(written), 'still on disk');
  assert.deepEqual(d.wx.storage.get(TEMP_KEY), [written], 'not forgotten after failures');
  assert.doesNotMatch(JSON.stringify(p.page.data), /已删除/);
  p.unload();
  // A later page (or app launch) sweeps what is still tracked once removal works again.
  d.state.unlinkFails = 0;
  const again = await d.open();
  await again.flush();
  assert.equal(d.state.files.has(written), false, 'removed by the next sweep');
  assert.deepEqual(d.wx.storage.get(TEMP_KEY), []);
  again.unload();
});

test('a transient removal failure is retried without a page', async () => {
  const { d, p } = await previewDevice();
  const media = p.requireLocal('utils/media.js');
  media.TEMP_RETRY_DELAYS.splice(0, Infinity, 5, 5);
  await p.page.preview(tap({ id: fileId }));
  await p.flush();
  const written = [...d.state.files.keys()][0];
  d.state.unlinkFails = 1;
  p.unload();
  await sleep(40);
  assert.equal(d.state.files.has(written), false, 'the retry removed it after unload');
  assert.deepEqual(d.wx.storage.get(TEMP_KEY), []);
});

test('only files this feature created are ever removed; untracked storage blocks preview', async () => {
  const { d, p } = await previewDevice();
  const media = p.requireLocal('utils/media.js');
  d.state.files.set('wxfile://usr/other.png', 'x');
  d.state.files.set('wxfile://usr/scb-private-x.png', 'x');
  d.wx.storage.set(TEMP_KEY, ['wxfile://usr/other.png', 'wxfile://usr/scb-private-x.png', '../x']);
  media.sweepTemps(d.wx);
  await ticks();
  assert.ok(d.state.files.has('wxfile://usr/other.png'));
  assert.ok(d.state.files.has('wxfile://usr/scb-private-x.png'));
  // When the cleanup record cannot be written, nothing is downloaded or written.
  const set = d.wx.setStorageSync;
  d.wx.setStorageSync = (key, value) => {
    if (key === TEMP_KEY) throw new Error('synthetic storage failure');
    return set(key, value);
  };
  await p.page.preview(tap({ id: fileId }));
  await p.flush();
  assert.match(p.page.data.error, /临时文件/);
  assert.equal(d.state.previews.length, 0);
  assert.equal([...d.state.files.keys()].filter((k) => k.includes('scb-media-')).length, 0);
});
