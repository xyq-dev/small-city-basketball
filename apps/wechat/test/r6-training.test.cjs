const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { parseWxml, eventHandlers } = require('./helpers/wxml.cjs');
const { renderWxml } = require('./helpers/native-preview.cjs');
const { trainingPathAllowed } = require('../utils/training-paths');
const root = path.resolve(__dirname, '..');
const U = '10000000-0000-4000-8000-000000000001',
  V = '10000000-0000-4000-8000-000000000002',
  C = '20000000-0000-4000-8000-000000000001',
  O = '30000000-0000-4000-8000-000000000001';
const pattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
function harness(
  name = 'training',
  handler = async () => ({ items: [], capabilities: { enabled: false } }),
) {
  let viewer = U,
    revision = 0;
  const listeners = new Set(),
    calls = [],
    storage = new Map();
  const client = {
    viewerId: () => viewer,
    sessionRevision: () => revision,
    onSessionChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body });
      return {
        data:
          url === '/v1/auth/session'
            ? { user: { id: viewer }, organizations: [], teamContexts: [] }
            : await handler(url, method, body),
        meta: { requestId: 'synthetic-training' },
      };
    },
  };
  const api = { getClient: () => client, uuid: (v) => v };
  const h = loadPage({
    root,
    route: 'pages/' + name + '/index',
    wx: createWx({ storage }),
    modules: { './api': api, '../../utils/api': api },
  });
  h.page.onLoad({});
  return {
    ...h,
    calls,
    storage,
    client,
    switchUser() {
      viewer = V;
      revision++;
      for (const f of listeners) f();
    },
  };
}
test('training paths are exact and reject arbitrary methods, ids and query parameters', () => {
  assert.equal(
    trainingPathAllowed('/v1/training/cohorts/' + C + '/enrollments', 'POST', {}, pattern),
    true,
  );
  assert.equal(
    trainingPathAllowed('/v1/training/cohorts/' + C, 'GET', { orgId: O }, pattern),
    false,
  );
  assert.equal(
    trainingPathAllowed('/v1/training/enrollments/' + C + '/commands', 'GET', {}, pattern),
    false,
  );
  assert.equal(
    trainingPathAllowed('/v1/orgs/' + O + '/training/provider/commands', 'POST', {}, pattern),
    true,
  );
  assert.equal(
    trainingPathAllowed('/v1/training/entitlements/' + O + '/makeup-options', 'GET', {}, pattern),
    true,
  );
  assert.equal(
    trainingPathAllowed('/v1/training/entitlements/' + O + '/makeup-options', 'POST', {}, pattern),
    false,
  );
  assert.equal(
    trainingPathAllowed(
      '/v1/training/entitlements/' + O + '/makeup-options',
      'GET',
      { learnerUserId: V },
      pattern,
    ),
    false,
  );
  assert.equal(trainingPathAllowed('/v1/training/../../admin', 'POST', {}, pattern), false);
});
test('closed rollout displays no fake available classes', async () => {
  const h = harness();
  await h.page.load();
  assert.equal(h.page.data.enabled, false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.page.data.items)), []);
  assert.equal(h.calls.filter((x) => x.method === 'POST').length, 0);
});
test('adult and contract consent is explicit before signup', async () => {
  const h = harness();
  h.page.setData({ detail: { id: C, totalFen: 0 } });
  await h.page.enroll();
  assert.match(h.page.data.error, /成年/);
  assert.equal(h.calls.length, 0);
});
test('a hidden page cannot replace data with a late catalog response', async () => {
  let resolve;
  const h = harness('training', () => new Promise((r) => (resolve = r)));
  const work = h.page.load();
  h.page.onHide();
  resolve({
    items: [{ id: C, totalFen: 0, state: 'ENROLLING', sessions: [] }],
    capabilities: { enabled: true },
  });
  await work;
  assert.equal(h.page.data.items.length, 0);
});
test('unknown writes keep original command id and retry without duplication', async () => {
  let count = 0;
  const h = harness('training', async (url, method, body) => {
    if (method === 'POST' && ++count === 1) throw Error('synthetic connection lost');
    return { enrollmentId: C };
  });
  const t = h.requireLocal('utils/training.js');
  await assert.rejects(
    t.write(U, '/v1/training/cohorts/' + C + '/enrollments', { acceptedTermsId: O }),
    /connection lost/,
  );
  const first = h.calls.find((x) => x.method === 'POST').body.commandId;
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  assert.equal(t.pending(U).body.commandId, first);
  await t.retry(U);
  assert.equal(h.calls.filter((x) => x.method === 'POST')[1].body.commandId, first);
  assert.equal(t.pending(U), null);
});
test('switching accounts stops replay and clears private page data', async () => {
  const h = harness('training', async () => {
    throw Error('uncertain');
  });
  const t = h.requireLocal('utils/training.js');
  await h.page.identify();
  h.page.setData({ enrollment: { id: C }, mine: [{ id: C }] });
  await assert.rejects(
    t.write(U, '/v1/training/enrollments/' + C + '/commands', {
      action: 'CONFIRM',
      expectedVersion: 1,
    }),
    /uncertain/,
  );
  h.switchUser();
  assert.equal(h.page.data.enrollment, null);
  assert.equal(h.page.data.mine.length, 0);
  await assert.rejects(t.retry(U), /身份/);
  assert.equal(h.calls.filter((x) => x.method === 'POST').length, 1);
});
test('a write completing while hidden releases busy and the next onShow can load again', async () => {
  for (const outcome of ['success', 'unknown']) {
    let settle;
    const h = harness('training', (url, method) => {
      if (method === 'POST')
        return new Promise((resolve, reject) => {
          settle = () =>
            outcome === 'success'
              ? resolve({ enrollmentId: C })
              : reject(Error('synthetic unknown outcome'));
        });
      return { items: [], capabilities: { enabled: true } };
    });
    const sending = h.page.send('/v1/training/enrollments/' + C + '/commands', {
      action: 'REFRESH',
      expectedVersion: 1,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(h.page.data.busy, true);
    h.page.onHide();
    settle();
    await sending;
    assert.equal(h.page.data.busy, false);
    assert.equal(h.page.data.enrollment, null);
    assert.equal(h.page.data.message, '');
    const t = h.requireLocal('utils/training.js');
    assert.equal(!!t.pending(U), outcome === 'unknown');
    h.page.onShow();
    await new Promise((r) => setImmediate(r));
    assert.equal(h.calls.filter((x) => x.url === '/v1/training/catalog').length, 1);
    assert.equal(h.page.data.loading, false);
    assert.equal(h.page.data.enabled, true);
  }
});
test('an old account write cannot clear a new account command lock or refill private data', async () => {
  const responses = [];
  const h = harness('training', (url, method) => {
    if (method === 'POST') return new Promise((resolve) => responses.push(resolve));
    return { items: [], capabilities: { enabled: true } };
  });
  const oldWrite = h.page.send('/v1/training/enrollments/' + C + '/commands', {
    action: 'REFRESH',
    expectedVersion: 1,
  });
  await new Promise((r) => setImmediate(r));
  h.switchUser();
  const newWrite = h.page.send('/v1/training/enrollments/' + O + '/commands', {
    action: 'REFRESH',
    expectedVersion: 1,
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(responses.length, 2);
  responses[0]({ enrollmentId: C });
  await oldWrite;
  assert.equal(h.page.data.busy, true);
  assert.equal(h.page.data.enrollment, null);
  assert.equal(h.page.data.message, '');
  responses[1]({});
  await newWrite;
  assert.equal(h.page.data.busy, false);
  assert.equal(h.page.data.enrollment, null);
});
test('the training workspace also releases a hidden completed command before returning', async () => {
  for (const outcome of ['success', 'unknown']) {
    let settle;
    const h = harness('training-manage', (url, method) => {
      if (method === 'POST')
        return new Promise((resolve, reject) => {
          settle = () =>
            outcome === 'success'
              ? resolve({ enrollmentId: C })
              : reject(Error('synthetic unknown outcome'));
        });
      return { teaching: [], coachProfiles: [] };
    });
    await h.page.load();
    const sending = h.page.send('/v1/training/enrollments/' + C + '/commands', {
      action: 'REFRESH',
      expectedVersion: 1,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(h.page.data.busy, true);
    h.page.onHide();
    settle();
    await sending;
    assert.equal(h.page.data.busy, false);
    assert.equal(h.page.data.enrollment, null);
    assert.equal(h.page.data.message, '');
    h.page.onShow();
    await new Promise((r) => setImmediate(r));
    assert.equal(h.calls.filter((x) => x.url === '/v1/training/mine').length, 2);
    assert.equal(h.page.data.loading, false);
    assert.equal(!!h.page.data.pending, outcome === 'unknown');
  }
});
function cohortCommandHarness(capabilities, state = 'RUNNING', resultState = 'COMPLETED') {
  let cohort = {
    id: C,
    title: '成人正常结课班',
    state,
    version: 7,
    totalFen: 0,
    capacity: 2,
    available: 0,
    sessions: [],
    capabilities,
  };
  const h = harness('training-manage', (url, method) => {
    if (method === 'POST') {
      cohort = {
        ...cohort,
        state: resultState,
        version: 8,
        capabilities: {
          canComplete: false,
          completionBlocker: null,
          canResume: false,
          resumeBlocker: null,
        },
      };
      return { cohortId: C };
    }
    if (url === '/v1/training/mine') return { teaching: [], coachProfiles: [] };
    assert.equal(url, '/v1/orgs/' + O + '/training');
    return {
      provider: null,
      coaches: [],
      courses: [],
      courts: [],
      cohorts: [cohort],
      enrollments: [],
    };
  });
  h.page.setData({ orgId: O });
  h.render = () =>
    renderWxml(
      fs.readFileSync(path.join(root, 'pages/training-manage/index.wxml'), 'utf8'),
      h.page.data,
      { root, pageDirectory: path.join(root, 'pages/training-manage') },
    );
  h.click = (action = 'COMPLETE') =>
    h.page.cohortAction({ currentTarget: { dataset: { id: C, action } } });
  return h;
}
test('a manager completes a cohort through the real page command and reloads its terminal state', async () => {
  const h = cohortCommandHarness({ canComplete: true, completionBlocker: null });
  await h.page.load();
  const complete = h.render().match(/<button\b[^>]*data-action="COMPLETE"[^>]*>正常结课<\/button>/);
  assert.ok(complete, 'normal completion has a visible bound button');
  assert.doesNotMatch(complete[0], /\bdisabled\b/);
  h.page.input({
    currentTarget: { dataset: { field: 'reason' } },
    detail: { value: '全部课次和学员权益已独立核对完成' },
  });
  await h.click();
  const posted = h.calls.filter((x) => x.method === 'POST');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, '/v1/training/cohorts/' + C + '/commands');
  assert.equal(posted[0].body.action, 'COMPLETE');
  assert.equal(posted[0].body.expectedVersion, 7);
  assert.equal(posted[0].body.reason, '全部课次和学员权益已独立核对完成');
  assert.match(posted[0].body.commandId, new RegExp('^' + pattern + '$'));
  assert.equal(h.page.data.workspace.cohorts[0].state, 'COMPLETED');
  assert.equal(h.page.data.busy, false);
  assert.equal(h.page.data.pending, null);
  assert.equal(h.requireLocal('utils/training.js').pending(U), null);
  assert.doesNotMatch(h.render(), /data-action="(?:COMPLETE|SUSPEND|CANCEL)"/);
});
test('completion stays disabled and sends nothing without server permission or settled obligations', async () => {
  for (const capabilities of [
    { canComplete: false, completionBlocker: '还有待补课权益，请先完成补课或退款' },
    {},
  ]) {
    const h = cohortCommandHarness(capabilities);
    await h.page.load();
    h.page.setData({ reason: '申请正常结课' });
    const html = h.render(),
      complete = html.match(/<button\b[^>]*data-action="COMPLETE"[^>]*>正常结课<\/button>/);
    assert.ok(complete);
    assert.match(complete[0], /\bdisabled\b/);
    if (capabilities.completionBlocker) assert.ok(html.includes(capabilities.completionBlocker));
    await h.click();
    assert.equal(h.calls.filter((x) => x.method === 'POST').length, 0);
    assert.equal(
      h.page.data.error,
      capabilities.completionBlocker || '当前班期不能结课，请刷新后核对。',
    );
    assert.equal(h.requireLocal('utils/training.js').pending(U), null);
  }
});
test('completion requires written grounds and terminal cohorts have no lifecycle mutation controls', async () => {
  const h = cohortCommandHarness({ canComplete: true, completionBlocker: null });
  await h.page.load();
  h.page.setData({ reason: '   ' });
  await h.click();
  assert.equal(h.calls.filter((x) => x.method === 'POST').length, 0);
  assert.match(h.page.data.error, /填写正常结课的事实依据/);
  for (const state of ['COMPLETED', 'CANCELLED']) {
    const terminal = cohortCommandHarness({ canComplete: false, completionBlocker: null }, state);
    await terminal.page.load();
    assert.doesNotMatch(terminal.render(), /data-action="(?:COMPLETE|SUSPEND|CANCEL)"/);
    for (const action of ['COMPLETE', 'SUSPEND', 'CANCEL']) await terminal.click(action);
    assert.equal(terminal.calls.filter((x) => x.method === 'POST').length, 0);
  }
});
test('a manager resumes a suspended cohort with its original version and written grounds', async () => {
  const h = cohortCommandHarness({ canResume: true, resumeBlocker: null }, 'SUSPENDED', 'RUNNING');
  await h.page.load();
  const html = h.render(),
    resume = html.match(/<button\b[^>]*data-action="RESUME"[^>]*>恢复班期<\/button>/);
  assert.ok(resume, 'a suspended cohort has a visible recovery action');
  assert.doesNotMatch(resume[0], /\bdisabled\b/);
  assert.doesNotMatch(html, /data-action="SUSPEND"/);
  h.page.input({
    currentTarget: { dataset: { field: 'reason' } },
    detail: { value: '已复核当前资质和原课次安排，可以恢复授课' },
  });
  await h.click('RESUME');
  const posted = h.calls.filter((x) => x.method === 'POST');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, '/v1/training/cohorts/' + C + '/commands');
  assert.equal(posted[0].body.action, 'RESUME');
  assert.equal(posted[0].body.expectedVersion, 7);
  assert.equal(posted[0].body.reason, '已复核当前资质和原课次安排，可以恢复授课');
  assert.match(posted[0].body.commandId, new RegExp('^' + pattern + '$'));
  assert.equal(h.page.data.workspace.cohorts[0].state, 'RUNNING');
  assert.equal(h.page.data.busy, false);
  assert.equal(h.page.data.pending, null);
  assert.equal(h.requireLocal('utils/training.js').pending(U), null);
  assert.doesNotMatch(h.render(), /data-action="RESUME"/);
  assert.match(h.render(), /data-action="SUSPEND"[^>]*>暂停班期<\/button>/);
});
test('resume requires server capability and written grounds without creating a command when blocked', async () => {
  for (const capabilities of [{ canResume: false, resumeBlocker: '教练资格待重新核验' }, {}]) {
    const h = cohortCommandHarness(capabilities, 'SUSPENDED');
    await h.page.load();
    h.page.setData({ reason: '申请恢复班期' });
    const html = h.render(),
      resume = html.match(/<button\b[^>]*data-action="RESUME"[^>]*>恢复班期<\/button>/);
    assert.ok(resume);
    assert.match(resume[0], /\bdisabled\b/);
    if (capabilities.resumeBlocker) assert.ok(html.includes(capabilities.resumeBlocker));
    await h.click('RESUME');
    assert.equal(h.calls.filter((x) => x.method === 'POST').length, 0);
    assert.equal(
      h.page.data.error,
      capabilities.resumeBlocker || '当前班期不能恢复，请刷新后核对。',
    );
    assert.equal(h.requireLocal('utils/training.js').pending(U), null);
  }
  const h = cohortCommandHarness({ canResume: true, resumeBlocker: null }, 'SUSPENDED');
  await h.page.load();
  h.page.setData({ reason: '   ' });
  await h.click('RESUME');
  assert.equal(h.calls.filter((x) => x.method === 'POST').length, 0);
  assert.match(h.page.data.error, /填写恢复班期的事实依据/);
});
test('draft, already suspended and terminal cohorts cannot be suspended and only suspended cohorts can resume', async () => {
  for (const state of ['DRAFT', 'SUSPENDED', 'COMPLETED', 'CANCELLED']) {
    const h = cohortCommandHarness({ canResume: false, resumeBlocker: null }, state);
    await h.page.load();
    assert.doesNotMatch(h.render(), /data-action="SUSPEND"/);
    await h.click('SUSPEND');
    assert.equal(h.calls.filter((x) => x.method === 'POST').length, 0);
  }
  for (const state of ['DRAFT', 'ENROLLING', 'RUNNING', 'COMPLETED', 'CANCELLED']) {
    const h = cohortCommandHarness({ canResume: true, resumeBlocker: null }, state);
    await h.page.load();
    h.page.setData({ reason: '只允许暂停班期恢复' });
    assert.doesNotMatch(h.render(), /data-action="RESUME"/);
    await h.click('RESUME');
    assert.equal(h.calls.filter((x) => x.method === 'POST').length, 0);
  }
});
test('both native pages have bound handlers, balanced templates, and no simulated success copy', () => {
  for (const name of ['training', 'training-manage']) {
    const h = harness(name);
    const source = fs.readFileSync(path.join(root, 'pages', name, 'index.wxml'), 'utf8');
    parseWxml(source);
    for (const handler of eventHandlers(source))
      assert.equal(typeof h.page[handler], 'function', name + ' ' + handler);
    assert.doesNotMatch(source, /模拟支付|点击即到账|默认已审核/);
  }
});

test('native empty and unknown-refund layouts render without leaking hidden participant data', () => {
  for (const name of ['training', 'training-manage']) {
    const h = harness(name),
      source = fs.readFileSync(path.join(root, 'pages', name, 'index.wxml'), 'utf8');
    const options = { root, pageDirectory: path.join(root, 'pages', name) };
    assert.doesNotThrow(() => renderWxml(source, h.page.data, options));
    if (name === 'training') {
      h.page.setData({
        enrollment: {
          id: C,
          state: 'PAID_UNALLOCATED',
          stateLabel: '已付款但未取得名额',
          amount: '¥1.01',
          capabilities: {},
          termsSnapshot: { termsText: '冻结合同' },
          entitlements: [],
          consumptions: [],
          refunds: [
            { id: O, status: 'UNKNOWN', stateLabel: '结果未知 · 保留退款额度', amount: '¥1.01' },
          ],
        },
      });
      const html = renderWxml(source, h.page.data, options);
      assert.match(html, /结果未知/);
      assert.match(html, /核对真实退款回执/);
      assert.doesNotMatch(html, /真实退款成功/);
    }
  }
});

const option = (sessionId, title) => ({
  sessionId,
  cohortId: C,
  cohortTitle: title,
  address: '合成训练馆',
  startsAt: '2099-01-02T00:00:00Z',
  endsAt: '2099-01-02T01:00:00Z',
  availableSeats: 2,
  coaches: [{ name: '合成教练' }],
});
test('learner loads makeup choices and submits the selected server-returned session with the current entitlement version', async () => {
  let submitted = false;
  const h = harness('training', async (url, method) => {
    if (url.endsWith('/makeup-options'))
      return {
        entitlementId: O,
        entitlementVersion: 7,
        items: [option(U, '上午班'), option(V, '下午班')],
        truncated: false,
      };
    if (method === 'POST') {
      submitted = true;
      return { enrollmentId: C };
    }
    return {
      id: C,
      learnerUserId: U,
      totalFen: 0,
      state: 'CONFIRMED',
      termsSnapshot: {},
      capabilities: {},
      entitlements: [
        {
          id: O,
          state: submitted ? 'AVAILABLE' : 'MAKEUP_DUE',
          netFen: 0,
          sessionId: V,
          originalSessionId: U,
          version: submitted ? 8 : 6,
        },
      ],
      consumptions: [],
      refunds: [],
    };
  });
  await h.page.showEnrollment(C);
  assert.equal(h.page.data.isLearner, true);
  const template = fs.readFileSync(path.join(root, 'pages/training/index.wxml'), 'utf8');
  const html = renderWxml(template, h.page.data, {
    root,
    pageDirectory: path.join(root, 'pages/training'),
  });
  assert.match(html, /选择补课课次/);
  await h.page.chooseMakeup({ currentTarget: { dataset: { id: O } } });
  assert.equal(h.page.data.makeup.items.length, 2);
  assert.match(h.page.data.makeup.items[1].label, /下午班.*合成教练/);
  h.page.selectMakeup({ detail: { value: '1' } });
  await h.page.confirmMakeup();
  const posted = h.calls.find((x) => x.method === 'POST');
  assert.equal(posted.url, '/v1/training/entitlements/' + O + '/commands');
  assert.equal(posted.body.action, 'MAKEUP');
  assert.equal(posted.body.sessionId, V);
  assert.equal(posted.body.expectedVersion, 7);
  assert.equal(h.page.data.makeup, null);
  assert.doesNotMatch(template, /makeupSessionId|补课课次编号/);
  assert.match(template, /选择补课课次/);
});
test('a late makeup response is discarded after account change and the picker has a useful empty state', async () => {
  let resolve;
  const h = harness('training', (url) =>
    url.endsWith('/makeup-options') ? new Promise((r) => (resolve = r)) : {},
  );
  h.page.setData({
    enrollment: {
      id: C,
      learnerUserId: U,
      entitlements: [{ id: O, state: 'MAKEUP_DUE', version: 2 }],
    },
    isLearner: true,
  });
  const waiting = h.page.chooseMakeup({ currentTarget: { dataset: { id: O } } });
  await new Promise((r) => setImmediate(r));
  assert.equal(typeof resolve, 'function');
  h.switchUser();
  resolve({
    entitlementId: O,
    entitlementVersion: 2,
    items: [option(V, '晚间班')],
    truncated: false,
  });
  await waiting;
  assert.equal(h.page.data.makeup, null);
  assert.equal(h.page.data.makeupLoading, false);
  const t = h.requireLocal('utils/training.js');
  assert.throws(
    () => t.makeupOptions({ entitlementId: C, entitlementVersion: 2, items: [] }, O),
    /补课候选/,
  );
  h.page.setData({
    enrollment: {
      id: C,
      state: 'CONFIRMED',
      capabilities: {},
      termsSnapshot: {},
      entitlements: [],
      consumptions: [],
      refunds: [],
    },
    makeup: { entitlementId: O, items: [], selected: null },
  });
  const html = renderWxml(
    fs.readFileSync(path.join(root, 'pages/training/index.wxml'), 'utf8'),
    h.page.data,
    { root, pageDirectory: path.join(root, 'pages/training') },
  );
  assert.match(html, /暂无符合当前资格/);
  assert.doesNotMatch(html, /确认这节补课/);
});
