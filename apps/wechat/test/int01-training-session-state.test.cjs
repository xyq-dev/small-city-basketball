const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const route = 'pages/training/index';
const cohortId = '10000000-0000-4000-8000-000000000001';
const coachId = '10000000-0000-4000-8000-000000000002';
function cohort(states = ['DELIVERED'], state = 'COMPLETED') {
  return {
    id: cohortId,
    title: '合成已结课成人篮球班',
    description: '合成固定短班历史课次。',
    address: '合成篮球场',
    state,
    capacity: 1,
    available: 0,
    totalFen: 0,
    termsText: '合成课程合同。',
    sessions: states.map((sessionState, index) => ({
      id: '20000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
      startsAt: '2026-10-30T01:00:00.000Z',
      endsAt: '2026-10-30T02:00:00.000Z',
      state: sessionState,
      version: 2,
      coaches: [{ id: coachId, name: '合成教练' }],
    })),
    capabilities: { canEnroll: false, canManage: false, paidEnrollmentEnabled: false },
  };
}
async function setup(raw = cohort()) {
  const calls = [];
  const client = {
    viewerId: () => '',
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET') {
      calls.push({ url, method });
      assert.equal(method, 'GET', 'viewing session states must never write an enrollment');
      if (url === '/v1/training/catalog')
        return { data: { items: [], capabilities: { enabled: true } } };
      assert.equal(url, '/v1/training/cohorts/' + cohortId);
      return { data: raw };
    },
  };
  const api = { ...require('../utils/api'), getClient: () => client };
  const h = loadPage({
    root,
    route,
    wx: createWx(),
    modules: { [path.join(root, 'utils/api.js')]: api },
  });
  h.page.onLoad({ cohort: cohortId });
  await h.page.load();
  assert.equal(h.page.data.error, '');
  return { ...h, calls };
}
const preview = (data, width = 390) => buildPreview({ root, route, data, width }).phone;
function sessionStatuses(html) {
  return Array.from(
    html.matchAll(
      /<div\b[^>]*class="[^"]*\bsession-row\b[^"]*"[^>]*>[\s\S]*?<div\b[^>]*class="[^"]*\bfigma-status\b[^"]*"[^>]*>([^<]*)<\/div>/g,
    ),
    (match) => match[1],
  );
}

test('a completed full cohort renders its delivered first session from the actual detail DTO', async () => {
  const h = await setup();
  assert.equal(h.page.data.detail.state, 'COMPLETED');
  assert.equal(h.page.data.detail.available, 0);
  assert.equal(h.page.data.detail.sessions[0].stateLabel, '已记录授课');
  assert.equal(Object.hasOwn(h.page.data.detail.sessions[0], 'statusText'), false);
  for (const width of [320, 390, 430]) {
    const html = preview(h.page.data, width);
    assert.deepEqual(sessionStatuses(html), ['已记录授课']);
    assert.doesNotMatch(html, /有名额/);
    const signup = html.match(/<button\b[^>]*data-mini-bindtap="reviewSignup"[^>]*>/)?.[0];
    assert.ok(signup);
    assert.match(signup, /disabled/);
    assert.doesNotMatch(html, /data-mini-bindtap="enroll"/);
  }
  assert.deepEqual(h.calls, [
    { url: '/v1/training/catalog', method: 'GET' },
    { url: '/v1/training/cohorts/' + cohortId, method: 'GET' },
  ]);
});

test('scheduled, delivered and cancelled session labels follow each row instead of its position', async () => {
  const labels = { SCHEDULED: '待上课', DELIVERED: '已记录授课', CANCELLED: '已取消' };
  for (const states of [
    ['SCHEDULED', 'DELIVERED', 'CANCELLED'],
    ['DELIVERED', 'CANCELLED', 'SCHEDULED'],
    ['CANCELLED', 'SCHEDULED', 'DELIVERED'],
  ]) {
    const h = await setup(cohort(states, 'RUNNING'));
    assert.deepEqual(
      sessionStatuses(preview(h.page.data)),
      states.map((state) => labels[state]),
    );
    assert.equal(
      h.calls.some((call) => call.method !== 'GET'),
      false,
    );
  }
});

test('missing session labels are neutral in every row and busy or pending do not invent availability', async () => {
  const h = await setup(cohort([undefined, null, ''], 'RUNNING'));
  for (const flags of [{}, { busy: true }, { pending: { body: { commandId: cohortId } } }]) {
    h.page.setData({ busy: false, pending: null, ...flags });
    const html = preview(h.page.data);
    assert.deepEqual(sessionStatuses(html), ['待核对', '待核对', '待核对']);
    assert.doesNotMatch(html, /有名额/);
  }
  assert.equal(
    h.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('the synthetic completed fixture matches the real read and exposes the delivered label at three widths', async () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../tests/mini-program/fixtures/int01-training-session-completed.json',
      ),
      'utf8',
    ),
  );
  const h = await setup();
  assert.deepEqual(JSON.parse(JSON.stringify(h.page.data.detail)), fixture.data.detail);
  for (const width of [320, 390, 430]) {
    const html = preview({ ...h.page.data, ...fixture.data }, width);
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
    assert.deepEqual(sessionStatuses(html), ['已记录授课']);
    assert.doesNotMatch(html, /有名额/);
  }
});
