const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/training-manage/index';
const actorId = '10000000-0000-4000-8000-000000000001';
const ownCoachId = '20000000-0000-4000-8000-000000000001';
const otherCoachId = '20000000-0000-4000-8000-000000000002';
const orgId = '30000000-0000-4000-8000-000000000001';
const ownProfile = {
  id: ownCoachId,
  org_id: orgId,
  display_name: '合成本人教练',
  status: 'PENDING_REVIEW',
  consented: false,
  version: 3,
};
const copy = (value) => JSON.parse(JSON.stringify(value));
function harness({ profiles = [ownProfile], workspace = null, pending = null } = {}) {
  const state = { profiles: copy(profiles) };
  const calls = [];
  const storage = new Map();
  if (pending) storage.set('scb-training-pending-v1:' + actorId, copy(pending));
  const client = {
    viewerId: () => actorId,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body: copy(body || {}) });
      if (url === '/v1/auth/session')
        return {
          data: {
            user: { id: actorId },
            organizations: workspace ? [{ id: orgId, name: '合成培训机构' }] : [],
            teamContexts: [],
          },
        };
      if (url === '/v1/training/mine')
        return { data: { teaching: [], coachProfiles: copy(state.profiles) } };
      if (url === '/v1/orgs/' + orgId + '/training') return { data: copy(workspace) };
      assert.equal(url, '/v1/training/coaches/' + ownCoachId + '/commands');
      assert.equal(method, 'POST');
      assert.equal(body.action, 'CONSENT');
      assert.equal(body.expectedVersion, 3);
      state.profiles[0].consented = true;
      state.profiles[0].version++;
      return { data: { coachId: ownCoachId } };
    },
  };
  const api = { getClient: () => client, uuid: (value) => value };
  const h = loadPage({
    root,
    route,
    wx: createWx({ storage }),
    modules: { './api': api, '../../utils/api': api },
  });
  h.page.onLoad({});
  return { ...h, calls, state, storage };
}
const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
const consentButtons = (html) => html.match(/<button\b[^>]*data-action="CONSENT"[^>]*>/g) || [];
function eventFor(button) {
  assert.match(button, /data-mini-bindtap="coachAction"/);
  return {
    currentTarget: {
      dataset: {
        id: button.match(/data-id="([^"]+)"/)[1],
        action: button.match(/data-action="([^"]+)"/)[1],
      },
    },
  };
}

test('a coach without an institution workspace can reach their own confirmation in all widths', async () => {
  const h = harness();
  await h.page.load();
  assert.equal(h.page.data.workspace, null);
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    assert.match(html, /我的教练资料/);
    assert.match(html, /合成本人教练/);
    const buttons = consentButtons(html);
    assert.equal(buttons.length, 1);
    assert.equal(eventFor(buttons[0]).currentTarget.dataset.id, ownCoachId);
    assert.doesNotMatch(buttons[0], /\sdisabled(?:\s|>)/);
    assert.doesNotMatch(html, /data-action="APPROVE"/);
  }
  assert.equal(h.calls.filter((call) => call.method === 'POST').length, 0);
});

test('the rendered confirmation invokes the existing versioned own-coach command and refreshes it', async () => {
  const h = harness();
  await h.page.load();
  await h.page.coachAction(eventFor(consentButtons(render(h.page))[0]));
  const writes = h.calls.filter((call) => call.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, '/v1/training/coaches/' + ownCoachId + '/commands');
  assert.equal(writes[0].body.action, 'CONSENT');
  assert.equal(writes[0].body.expectedVersion, 3);
  assert.match(writes[0].body.commandId, /^[0-9a-f-]{36}$/);
  assert.equal(Object.hasOwn(writes[0].body, 'reason'), false);
  assert.equal(h.page.data.coachProfiles[0].consented, true);
  assert.equal(consentButtons(render(h.page)).length, 0);
  assert.match(render(h.page), /本人确认 已完成/);
});

test('an already confirmed own profile stays visible without a repeat confirmation action', async () => {
  const h = harness({ profiles: [{ ...ownProfile, consented: true }] });
  await h.page.load();
  const html = render(h.page);
  assert.match(html, /合成本人教练/);
  assert.match(html, /本人确认 已完成/);
  assert.equal(consentButtons(html).length, 0);
});

test('institution access never offers consent for another coach and does not gate own consent', async () => {
  const workspace = {
    capabilities: { enabled: false },
    coaches: [{ ...ownProfile, id: otherCoachId, display_name: '合成其他教练' }],
    cohorts: [],
    courses: [],
    courts: [],
    enrollments: [],
    provider: { id: orgId, name: '合成培训机构', status: 'APPROVED' },
  };
  for (const profiles of [[], [ownProfile]]) {
    const h = harness({ profiles, workspace });
    await h.page.load();
    const buttons = consentButtons(render(h.page));
    assert.equal(buttons.length, profiles.length);
    for (const button of buttons) {
      assert.equal(eventFor(button).currentTarget.dataset.id, ownCoachId);
      assert.doesNotMatch(button, new RegExp(otherCoachId));
    }
    h.page.manageTab({ currentTarget: { dataset: { key: 'setup' } } });
    assert.equal(consentButtons(render(h.page)).length, 0);
    assert.match(render(h.page), /合成其他教练/);
  }
});

test('busy and unknown original commands keep own consent disabled and prevent a new write', async () => {
  const original = {
    actor: actorId,
    path: '/v1/training/coaches/' + ownCoachId + '/commands',
    body: {
      action: 'CONSENT',
      expectedVersion: 3,
      commandId: '40000000-0000-4000-8000-000000000001',
    },
  };
  for (const pending of [null, original]) {
    const h = harness({ pending });
    await h.page.load();
    if (!pending) h.page.setData({ busy: true });
    const button = consentButtons(render(h.page))[0];
    assert.match(button, /\sdisabled(?:\s|>)/);
    await h.page.coachAction(eventFor(button));
    assert.equal(h.calls.filter((call) => call.method === 'POST').length, 0);
    if (pending) assert.deepEqual(h.storage.get('scb-training-pending-v1:' + actorId), original);
  }
});

test('identity reset removes the private own profile and its consent control', async () => {
  const h = harness();
  await h.page.load();
  assert.equal(consentButtons(render(h.page)).length, 1);
  h.page.onSessionReset();
  assert.equal(h.page.data.coachProfiles.length, 0);
  assert.equal(consentButtons(render(h.page)).length, 0);
  assert.doesNotMatch(render(h.page), /合成本人教练/);
});

test('the CI fixture retains the independent own confirmation without an institution workspace', () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../tests/mini-program/fixtures/int01-training-coach-consent.json',
      ),
      'utf8',
    ),
  );
  assert.equal(fixture.route, route);
  assert.equal(fixture.data.workspace, null);
  assert.equal(fixture.data.manageTab, 'teaching');
  const h = harness();
  h.page.setData(fixture.data);
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
    const buttons = consentButtons(html);
    assert.equal(buttons.length, 1);
    assert.equal(eventFor(buttons[0]).currentTarget.dataset.id, ownCoachId);
    assert.doesNotMatch(buttons[0], /\sdisabled(?:\s|>)/);
  }
});
