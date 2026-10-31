const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');
const org = '11111111-1111-4111-8111-111111111111',
  actor = '22222222-2222-4222-8222-222222222222',
  other = '33333333-3333-4333-8333-333333333333';
const cfg = () => ({
  format: 'GROUP_KNOCKOUT',
  expectedTeams: 8,
  registration: { minPlayers: 5, maxPlayers: 15 },
  scoring: { regulationPeriods: 4 },
  scheduling: {
    dailyStart: '09:00',
    dailyEnd: '21:00',
    slotDurationMinutes: 60,
    minRestMinutes: 60,
    minLocalDayGap: 0,
    groupCount: 2,
    thirdPlaceMatch: true,
  },
});
const ticks = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};
function device(storage = new Map()) {
  const state = { rev: 1, actor, listener: null, modal: null, fail: false, found: null },
    requests = [];
  const client = {
    viewerId: () => state.actor,
    sessionRevision: () => state.rev,
    hasSession: () => true,
    onSessionChange: (f) => {
      state.listener = f;
      return () => {};
    },
    request: async (url, method, body) => {
      requests.push({ url, method, body: body && structuredClone(body) });
      if (method === 'POST') {
        if (state.postStatus) throw { status: state.postStatus, message: '当前无法核对' };
        if (state.fail) throw { status: 503, message: '中断' };
        return { data: receipt(body) };
      }
      if (state.readStatus) throw { status: state.readStatus, message: '当前无法核对' };
      if (state.found) return { data: state.found };
      throw { status: 404, message: '未找到回执' };
    },
  };
  const wx = createWx({ storage });
  wx.showModal = (o) => {
    state.modal = o;
  };
  const h = loadPage({
    root,
    route: 'pages/event-setup/index',
    wx,
    modules: {
      [path.join(root, 'utils/api.js')]: {
        getClient: () => client,
        uuid: (v) => v,
        eventFormat: (v) => v,
      },
    },
  });
  h.page._alive = true;
  h.page.orgId = org;
  h.page.eventId = '';
  h.page.setData({
    creating: true,
    draft: {
      name: '新杯赛',
      startDate: '2030-01-01',
      endDate: '2030-01-07',
      venueName: '新场馆',
      format: 'GROUP_KNOCKOUT',
      formatIndex: 2,
    },
  });
  h.page._selectedTemplate = {
    key: org,
    versionId: other,
    version: 4,
    label: '8队模板',
    configuration: cfg(),
  };
  h.page.load = async () => {};
  h.page.loadTemplates = async () => {};
  return {
    h,
    state,
    requests,
    model: h.requireLocal('utils/event-templates.js'),
    client,
    storage,
    answer(yes = true) {
      assert.ok(state.modal);
      state.modal.success({ confirm: yes });
    },
    switch() {
      state.actor = other;
      state.rev++;
      state.listener && state.listener();
    },
  };
}
function receipt(body) {
  return {
    clientRequestId: body.clientRequestId,
    operation: body.type === 'CREATE_FROM_EVENT' ? 'CREATE_TEMPLATE' : body.type,
    template: { id: org, versionId: other, version: 4 },
    event: body.type === 'INSTANTIATE' ? { id: other, status: 'DRAFT' } : null,
  };
}
const start = async (d) => {
  const pending = d.h.page.create();
  await ticks();
  assert.ok(d.state.modal);
  return pending;
};
test('catalog and guide DTOs reject stale or forged data', () => {
  const d = device(),
    catalog = {
      templates: [],
      presets: [{ key: 'EIGHT_TEAM_GROUP_BRONZE_V1', name: '八队', configuration: cfg() }],
      capabilities: { canInstantiate: true, canManageTemplates: true },
    };
  assert.equal(d.model.catalog(catalog).rows.length, 2);
  assert.throws(() =>
    d.model.catalog({ ...catalog, presets: [{ ...catalog.presets[0], key: 'unknown' }] }),
  );
  const guide = {
    eventVersion: 7,
    counts: {},
    canManage: true,
    steps: ['CONFIGURE', 'REGISTRATION', 'FREEZE', 'DRAW', 'ALLOCATE', 'PUBLISH'].map((code) => ({
      code,
      state: 'WAITING',
      blockers: [],
      action: 'SETUP',
    })),
  };
  assert.equal(d.model.guide(guide, 7).steps[0].stateLabel, '待前序完成');
  assert.throws(() => d.model.guide(guide, 8));
  assert.throws(() => d.model.guide({ ...guide, steps: guide.steps.slice(1) }, 7));
});
test('creating from a saved template pins its version and stores before sending', async () => {
  const d = device();
  const pending = d.h.page.create();
  await ticks();
  assert.equal(d.requests.length, 0);
  d.answer();
  await pending;
  const post = d.requests.find((r) => r.method === 'POST');
  assert.ok(post);
  assert.equal(post.body.templateVersionId, other);
  assert.equal(post.body.expectedTemplateVersion, 4);
  assert.deepEqual(post.body.event, {
    name: '新杯赛',
    startDate: '2030-01-01',
    endDate: '2030-01-07',
    venueName: '新场馆',
  });
  assert.equal('configuration' in post.body, false);
  assert.equal('format' in post.body.event, false);
  const stored = d.h.wx.calls.findIndex((c) => c.type === 'setStorageSync');
  assert.ok(stored >= 0);
  assert.equal(d.h.page.eventId, other);
  assert.equal(d.model.read(actor, org), null);
});
test('unknown result survives page reload and a found receipt avoids another POST', async () => {
  const d = device();
  d.state.fail = true;
  const pending = d.h.page.create();
  await ticks();
  d.answer();
  await pending;
  const original = d.model.read(actor, org);
  assert.ok(original);
  assert.equal(d.h.page.data.templatePending, true);
  const next = device(d.storage);
  next.state.found = receipt(original);
  const retry = next.h.page.resumeTemplate();
  await ticks();
  next.answer();
  await retry;
  assert.equal(next.requests.filter((r) => r.method === 'POST').length, 0);
  assert.equal(next.requests.length, 1);
  assert.ok(next.requests[0].url.endsWith(original.clientRequestId));
  assert.equal(next.h.page.eventId, other);
});
test('retry without a receipt reuses exact original id and payload despite edited form', async () => {
  const d = device();
  d.state.fail = true;
  let pending = d.h.page.create();
  await ticks();
  d.answer();
  await pending;
  const original = d.model.read(actor, org);
  d.h.page.setData({ 'draft.name': '另一个赛事' });
  d.state.fail = false;
  pending = d.h.page.resumeTemplate();
  await ticks();
  d.answer();
  await pending;
  const posts = d.requests.filter((r) => r.method === 'POST');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].body, posts[1].body);
  assert.equal(posts[1].body.event.name, '新杯赛');
  assert.equal(posts[1].body.clientRequestId, original.clientRequestId);
});
test('account changes, unload, cancellation and changed creation form cannot start a write', async () => {
  for (const kind of ['account', 'unload', 'cancel', 'target']) {
    const d = device(),
      pending = d.h.page.create();
    await ticks();
    if (kind === 'account') d.switch();
    if (kind === 'unload') d.h.unload();
    if (kind === 'target') d.h.page.setData({ 'draft.name': '修改后' });
    d.answer(kind !== 'cancel');
    await pending;
    assert.equal(d.requests.length, 0, kind);
    assert.equal(d.storage.size, 0, kind);
  }
});
test('account switch during secure request-id generation cannot persist or send old intent', async () => {
  const d = device();
  let random;
  d.h.wx.getRandomValues = (o) => {
    random = o;
  };
  const pending = d.h.page.create();
  await ticks();
  d.answer();
  await ticks();
  assert.ok(random);
  d.switch();
  random.success({ randomValues: new Uint8Array(16).buffer });
  await pending;
  assert.equal(d.requests.length, 0);
  assert.equal(d.storage.size, 0);
});
test('failed local persistence prevents every network action', async () => {
  const d = device();
  d.h.wx.setStorageSync = () => {
    throw new Error('full');
  };
  const pending = d.h.page.create();
  await ticks();
  d.answer();
  await pending;
  assert.equal(d.requests.length, 0);
  assert.match(d.h.page.data.error, /保存/);
});
test('pending request is bound to actor and organization and cannot be overwritten', () => {
  const d = device(),
    body = {
      type: 'INSTANTIATE',
      clientRequestId: org,
      presetKey: 'EIGHT_TEAM_GROUP_BRONZE_V1',
      event: { name: '原赛事', startDate: '2030-01-01', endDate: '2030-01-07' },
    };
  d.model.save(actor, org, body);
  assert.equal(JSON.stringify(d.model.read(actor, org)), JSON.stringify(body));
  assert.equal(d.model.read(other, org), null);
  assert.equal(d.model.read(actor, other), null);
  assert.throws(() => d.model.save(actor, org, { ...body, clientRequestId: other }));
  assert.equal(d.model.clear(actor, org, { ...body, clientRequestId: other }), false);
  assert.equal(d.model.clear(actor, org, body), true);
});
test('authorization loss, hidden scope or temporary rejection preserves an unknown original request', async () => {
  for (const status of [401, 403, 404, 408, 429]) {
    const d = device();
    d.state.fail = true;
    let pending = d.h.page.create();
    await ticks();
    d.answer();
    await pending;
    const original = d.model.read(actor, org);
    assert.ok(original);
    d.state.fail = false;
    d.state.readStatus = status;
    d.state.postStatus = status;
    pending = d.h.page.resumeTemplate();
    await ticks();
    d.answer();
    await pending;
    assert.equal(
      JSON.stringify(d.model.read(actor, org)),
      JSON.stringify(original),
      String(status),
    );
    assert.equal(d.h.page.data.templatePending, true, String(status));
    const posts = d.requests.filter((r) => r.method === 'POST');
    assert.equal(posts.length, status === 404 ? 2 : 1);
  }
});
test('saving a template reads the pinned server event and sends no team or unsaved rule snapshots', async () => {
  const d = device();
  d.h.page._event = { id: org, version: 7, format: 'GROUP_KNOCKOUT' };
  d.h.page.setData({
    creating: false,
    templateCanManage: true,
    templateName: '本届可复用规则',
    templateExpectedTeams: '8',
    templateScheduling: cfg().scheduling,
  });
  const pending = d.h.page.saveAsTemplate();
  await ticks();
  d.answer();
  await pending;
  const post = d.requests.find((r) => r.method === 'POST');
  assert.ok(post);
  assert.equal(post.body.type, 'CREATE_FROM_EVENT');
  assert.equal(post.body.expectedEventVersion, 7);
  assert.equal(post.body.eventId, org);
  assert.equal(post.body.expectedTeams, 8);
  for (const key of ['registration', 'scoring', 'teams', 'players', 'courtId', 'startDate'])
    assert.equal(key in post.body, false);
});
test('archiving a template requires confirmation and its current version', async () => {
  const d = device();
  d.h.page.setData({ templateCanManage: true, templateArchiveReason: '旧赛事规则停用' });
  const pending = d.h.page.archiveTemplate();
  await ticks();
  assert.equal(d.requests.length, 0);
  d.answer();
  await pending;
  const post = d.requests.find((r) => r.method === 'POST');
  assert.equal(post.body.type, 'ARCHIVE_TEMPLATE');
  assert.equal(post.body.templateId, org);
  assert.equal(post.body.expectedTemplateVersion, 4);
  assert.equal(post.body.reason, '旧赛事规则停用');
});
