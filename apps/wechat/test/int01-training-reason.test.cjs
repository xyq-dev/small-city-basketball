const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const route = 'pages/training-manage/index';
const actor = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
const entitlementId = '30000000-0000-4000-8000-000000000001';
const commandId = '40000000-0000-4000-8000-000000000001';
const copy = (value) => JSON.parse(JSON.stringify(value));
function harness({ assigned = true, pending = null, sessionState = 'SCHEDULED' } = {}) {
  const calls = [],
    storage = new Map();
  if (pending) storage.set('scb-training-pending-v1:' + actor, copy(pending));
  const roster = {
    session: {
      id: sessionId,
      starts_at: '2026-11-01T01:00:00Z',
      ends_at: '2026-11-01T02:00:00Z',
      state: sessionState,
      version: 4,
    },
    learners: [{ id: entitlementId, display_name: '合成课次学员', state: 'AVAILABLE', version: 2 }],
    consumptions: [],
    attendance: [],
    canManage: false,
  };
  const client = {
    viewerId: () => actor,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body: copy(body || {}) });
      if (url === '/v1/auth/session')
        return { data: { user: { id: actor }, organizations: [], teamContexts: [] } };
      if (url === '/v1/training/mine')
        return {
          data: {
            teaching: assigned
              ? [
                  {
                    id: sessionId,
                    title: '合成授权教练课次',
                    starts_at: roster.session.starts_at,
                    state: roster.session.state,
                  },
                ]
              : [],
            coachProfiles: [],
          },
        };
      if (url === '/v1/training/sessions/' + sessionId + '/roster') {
        if (!assigned) throw Object.assign(Error('本课未授权'), { status: 403 });
        return { data: copy(roster) };
      }
      assert.equal(method, 'POST');
      assert.equal(assigned, true);
      assert.ok(body.reason.trim(), 'existing teaching commands must carry the entered facts');
      if (body.action === 'DELIVER') {
        assert.equal(url, '/v1/training/sessions/' + sessionId + '/commands');
        assert.equal(body.expectedVersion, 4);
        roster.session.state = 'DELIVERED';
        roster.session.version++;
      } else {
        assert.equal(body.action, 'PROPOSE_CONSUMPTION');
        assert.equal(url, '/v1/training/entitlements/' + entitlementId + '/commands');
        assert.equal(body.expectedVersion, 2);
      }
      return { data: { sessionId } };
    },
  };
  const api = { getClient: () => client, uuid: (value) => value };
  const h = loadPage({
    root,
    route,
    wx: createWx({ storage }),
    modules: { './api': api, '../../utils/api': api },
  });
  h.page.onLoad({ session: sessionId });
  return { ...h, calls, storage };
}
const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
const reasonControl = (html) => html.match(/<textarea\b[^>]*data-field="reason"[^>]*>/)?.[0];
const buttons = (html) => html.match(/<button\b[^>]*>/g) || [];
function enterReason(page, html, value) {
  const input = reasonControl(html);
  assert.ok(input, 'the assigned coach must have a visible facts field');
  assert.match(input, /data-mini-bindinput="input"/);
  page.input({
    currentTarget: { dataset: { field: input.match(/data-field="([^"]+)"/)[1] } },
    detail: { value },
  });
}
function actionEvent(button) {
  return {
    currentTarget: {
      dataset: {
        id: button.match(/data-id="([^"]+)"/)[1],
        action: button.match(/data-action="([^"]+)"/)[1],
      },
    },
  };
}

test('an assigned coach without institution membership can enter facts and deliver the existing lesson', async () => {
  const h = harness();
  await h.page.load();
  assert.equal(h.page.data.organizations.length, 0);
  assert.equal(h.page.data.isOperator, false);
  assert.equal(h.page.data.workspace, null);
  assert.equal(h.page.data.roster.canManage, false);
  for (const width of [320, 390, 430]) assert.ok(reasonControl(render(h.page, width)));
  const html = render(h.page);
  assert.doesNotMatch(html, /data-mini-bindchange="pickOrg"/);
  assert.ok(buttons(html).some((button) => /data-mini-bindtap="sessionAction"/.test(button)));
  enterReason(h.page, html, '合成本课已完成传接球与投篮练习。');
  await h.page.sessionAction();
  const write = h.calls.find((call) => call.method === 'POST');
  assert.equal(write.body.action, 'DELIVER');
  assert.equal(write.body.reason, '合成本课已完成传接球与投篮练习。');
  assert.equal(h.page.data.roster.session.state, 'DELIVERED');
});

test('the assigned coach submits the visible learner consumption action with entered facts', async () => {
  const h = harness({ sessionState: 'DELIVERED' });
  await h.page.load();
  const html = render(h.page);
  const button = buttons(html).find((tag) => /data-action="PROPOSE_CONSUMPTION"/.test(tag));
  assert.ok(button);
  enterReason(h.page, html, '合成学员已签到并完成本课训练。');
  await h.page.lessonAction(actionEvent(button));
  const write = h.calls.find((call) => call.method === 'POST');
  assert.equal(write.body.action, 'PROPOSE_CONSUMPTION');
  assert.equal(write.body.reason, '合成学员已签到并完成本课训练。');
});

test('an unassigned ordinary account has neither facts field nor lesson write controls', async () => {
  const h = harness({ assigned: false });
  await h.page.load();
  const html = render(h.page);
  assert.equal(h.page.data.roster, null);
  assert.equal(reasonControl(html), undefined);
  assert.doesNotMatch(html, /data-mini-bindtap="sessionAction"|data-mini-bindtap="lessonAction"/);
  await h.page.sessionAction();
  await h.page.lessonAction({
    currentTarget: { dataset: { id: entitlementId, action: 'PROPOSE_CONSUMPTION' } },
  });
  assert.equal(h.calls.filter((call) => call.method === 'POST').length, 0);
});

test('busy and an unknown command disable the facts field and keep writes serialized', async () => {
  const original = {
    actor,
    path: '/v1/training/sessions/' + sessionId + '/commands',
    body: { action: 'DELIVER', expectedVersion: 4, reason: '合成原操作事实', commandId },
  };
  for (const pending of [null, original]) {
    const h = harness({ pending });
    await h.page.load();
    if (!pending) h.page.setData({ busy: true });
    const html = render(h.page);
    assert.match(reasonControl(html), /\sdisabled(?:\s|>)/);
    for (const button of buttons(html).filter((tag) =>
      /data-mini-bindtap="(?:sessionAction|lessonAction)"/.test(tag),
    ))
      assert.match(button, /\sdisabled(?:\s|>)/);
    await h.page.sessionAction();
    assert.equal(h.calls.filter((call) => call.method === 'POST').length, 0);
    if (pending) assert.deepEqual(h.storage.get('scb-training-pending-v1:' + actor), original);
  }
});

test('the CI assigned-coach fixture exposes the facts field without institution management controls', () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../tests/mini-program/fixtures/int01-training-assigned-coach.json',
      ),
      'utf8',
    ),
  );
  assert.equal(fixture.data.workspace, null);
  assert.equal(fixture.data.organizations.length, 0);
  assert.equal(fixture.data.isOperator, false);
  const h = harness();
  h.page.setData(fixture.data);
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
    assert.ok(reasonControl(html));
    assert.doesNotMatch(reasonControl(html), /\sdisabled(?:\s|>)/);
    assert.doesNotMatch(html, /data-mini-bindchange="pickOrg"/);
  }
});
