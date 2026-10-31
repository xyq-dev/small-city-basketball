const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  org: '33333333-3333-4333-8333-333333333333',
  event: '44444444-4444-4444-8444-444444444444',
  item: '55555555-5555-4555-8555-555555555555',
};
function setup(route, handler, answers = []) {
  let actor = ids.actor,
    revision = 0;
  const listeners = new Set(),
    calls = [],
    wx = createWx({ modalAnswers: answers });
  const client = {
    sessionRevision: () => revision,
    onSessionChange: (f) => (listeners.add(f), () => listeners.delete(f)),
    request: async (p, m = 'GET', b) => {
      calls.push({ p, m, b: structuredClone(b) });
      if (p === '/v1/auth/session')
        return { data: { user: { id: actor }, organizations: [], teamContexts: [] } };
      return handler(p, m, b);
    },
    requestPublic: async (p) => {
      calls.push({ p, m: 'PUBLIC' });
      return handler(p, 'PUBLIC');
    },
    download: async (p) => {
      calls.push({ p, m: 'DOWNLOAD' });
      return handler(p, 'DOWNLOAD');
    },
  };
  const api = { ...require('../utils/api'), getClient: () => client };
  const h = loadPage({ root, route, wx, modules: { [path.join(root, 'utils/api.js')]: api } });
  return {
    ...h,
    calls,
    change(id) {
      actor = id;
      revision++;
      for (const f of [...listeners]) f();
    },
  };
}
const publicDto = {
  title: 'Synthetic 招募',
  description: '报名说明',
  event: {
    name: '合成赛事',
    startDate: '2028-01-01',
    endDate: '2028-01-02',
    venueName: '合成球场',
  },
  requirements: { minPlayers: 2, maxPlayers: 12 },
  notice: '需审核',
};
const list = { items: [], nextCursor: null };
test('TSV preview preserves blank rows for server row errors and enforces bounded input', () => {
  const h = setup('pages/recruitment/index', () => ({ data: list })),
    r = h.requireLocal('utils/recruitment.js');
  assert.deepEqual(structuredClone(r.parseTeams('队甲\t\t' + ids.actor + '\n\n队乙')), [
    { teamName: '队甲', teamId: null, leaderUserId: ids.actor },
    { teamName: '', teamId: null, leaderUserId: null },
    { teamName: '队乙', teamId: null, leaderUserId: null },
  ]);
  assert.throws(() => r.parseTeams(Array(34).fill('A').join('\n')));
  assert.throws(() => r.parseTeams('A\tB\tC\tD'));
});
test('durable account original rejects overwrite, private fields and corrupt storage', () => {
  const h = setup('pages/recruitment/index', () => ({ data: list })),
    r = h.requireLocal('utils/recruitment-recovery.js'),
    value = {
      kind: 'APPLY',
      path: '/v1/public/recruitments/' + 'a'.repeat(43) + '/applications',
      body: { clientRequestId: ids.item, teamName: '队伍', teamId: null, note: null },
    };
  r.save(ids.actor, value);
  assert.throws(() => r.save(ids.actor, { ...value, body: { ...value.body, teamName: '另一队' } }));
  assert.equal(r.read(ids.other), null);
  assert.equal(r.valid({ ...value, body: { ...value.body, identityNumber: 'private' } }), false);
  h.wx.storage.set('scb-x05-original-v1:' + ids.actor, { bad: true });
  assert.throws(() => r.read(ids.actor));
});
test('public GET is anonymous, uncertain apply persists exact original and replay does not duplicate intent', async () => {
  let fail = true;
  const h = setup(
    'pages/recruitment/index',
    (p, m) => {
      if (m === 'PUBLIC') return { data: publicDto };
      if (m === 'POST') {
        if (fail) throw { code: 'NETWORK_ERROR', message: '网络中断' };
        return { data: { application: { id: ids.item } } };
      }
      return { data: list };
    },
    [true, true],
  );
  h.page.onLoad({ publicId: 'a'.repeat(43) });
  h.page._visible = true;
  await h.page.load();
  assert.equal(h.calls[0].m, 'PUBLIC');
  h.page.setData({ teamName: '原队伍', note: '原说明' });
  await h.page.apply();
  assert.ok(h.page.data.pending);
  const before = h.calls.find((c) => c.m === 'POST');
  h.page.setData({ teamName: '不应改变原请求' });
  fail = false;
  await h.page.recover({ currentTarget: { dataset: { replay: 'yes' } } });
  const sends = h.calls.filter((c) => c.m === 'POST');
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[1].b, before.b);
  assert.equal(h.page.data.pending, null);
});
test('switching accounts during confirmation prevents all writes and clears private form', async () => {
  const h = setup(
    'pages/recruitment/index',
    (p, m) => (m === 'PUBLIC' ? { data: publicDto } : { data: list }),
    [true],
  );
  h.page.onLoad({ publicId: 'a'.repeat(43) });
  await h.page.load();
  h.page.setData({ teamName: '私有队名', note: '私有说明' });
  let resolve;
  h.wx.showModal = (options) => {
    resolve = options.success;
  };
  const pending = h.page.apply();
  h.change(ids.other);
  resolve({ confirm: true });
  await pending;
  assert.equal(h.calls.filter((c) => c.m === 'POST').length, 0);
  assert.equal(h.page.data.teamName, '');
  assert.equal(h.page.data.userId, '');
});
test('event application review uses server type command; invitation accepts no invented reason or staff role', async () => {
  const w = {
    event: { id: ids.event, name: '赛事', version: 2 },
    publication: null,
    capabilities: {},
  };
  const h = setup(
    'pages/recruitment/index',
    (p, m) => {
      if (m === 'POST') return { data: {} };
      return { data: p.endsWith('/recruitment') ? w : list };
    },
    [true, true],
  );
  h.page.onLoad({ orgId: ids.org, eventId: ids.event });
  await h.page.load();
  h.page.setData({
    applications: [{ id: ids.item, orgId: ids.org, eventId: ids.event, version: 1 }],
    reason: '独立核对通过',
  });
  await h.page.review({ currentTarget: { dataset: { id: ids.item, decision: 'APPROVE' } } });
  let body = h.calls.filter((c) => c.m === 'POST')[0].b;
  assert.equal(body.type, 'APPROVE');
  assert.equal(body.decision, undefined);
  h.page.setData({ invitations: [{ id: ids.item, version: 1 }] });
  await h.page.decide({ currentTarget: { dataset: { id: ids.item, decision: 'ACCEPT' } } });
  body = h.calls.filter((c) => c.m === 'POST')[1].b;
  assert.deepEqual(Object.keys(body).sort(), ['clientRequestId', 'expectedVersion', 'type']);
});
test('poster export re-downloads for every save and removes owned temporary images on account change', async () => {
  const w = {
    event: { version: 1 },
    participants: [],
    matches: [],
    exports: [],
    capabilities: { canGenerate: true },
  };
  const h = setup(
    'pages/poster/index',
    (p, m) =>
      m === 'DOWNLOAD'
        ? { data: new Uint8Array([1, 2, 3]).buffer, contentType: 'image/png' }
        : { data: w },
    [true, true],
  );
  const files = new Set();
  h.wx.env = { USER_DATA_PATH: '/synthetic' };
  h.wx.getFileSystemManager = () => ({
    writeFile: (o) => {
      files.add(o.filePath);
      o.success();
    },
    unlink: (o) => {
      files.delete(o.filePath);
    },
  });
  h.wx.saveImageToPhotosAlbum = (o) => o.success();
  h.wx.previewImage = (o) => o.success();
  h.page.onLoad({ orgId: ids.org, eventId: ids.event });
  h.page._visible = true;
  await h.page.load();
  const e = { currentTarget: { dataset: { id: ids.item, save: 'yes' } } };
  await h.page.image(e);
  await h.page.image(e);
  assert.equal(h.calls.filter((c) => c.m === 'DOWNLOAD').length, 2);
  assert.equal(files.size, 2);
  h.change(ids.other);
  assert.equal(files.size, 0);
  assert.equal(h.page.data.workspace, null);
});
test('revoked public recruitment removes a previously rendered snapshot on reload', async () => {
  let available = true;
  const h = setup('pages/recruitment/index', (p, m) => {
    if (m === 'PUBLIC') {
      if (!available) throw { status: 404, message: '招募已撤销' };
      return { data: publicDto };
    }
    return { data: list };
  });
  h.page.onLoad({ publicId: 'a'.repeat(43) });
  await h.page.load();
  assert.ok(h.page.data.public);
  available = false;
  await h.page.load();
  assert.equal(h.page.data.public, null);
  assert.equal(h.page.data.loading, false);
});
test('failed durable storage prevents sending an otherwise confirmed application', async () => {
  const h = setup(
    'pages/recruitment/index',
    (p, m) => (m === 'PUBLIC' ? { data: publicDto } : { data: list }),
    [true],
  );
  h.page.onLoad({ publicId: 'a'.repeat(43) });
  await h.page.load();
  h.page.setData({ teamName: '不能丢原编号的申请' });
  h.wx.setStorageSync = () => {
    throw new Error('storage full');
  };
  await h.page.apply();
  assert.equal(h.calls.filter((c) => c.m === 'POST').length, 0);
  assert.match(h.page.data.error, /无法保存/);
});
