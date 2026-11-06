const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const route = 'pages/recruitment/index';
const ids = {
  actor: '10000000-0000-4000-8000-000000000001',
  applicant: '10000000-0000-4000-8000-000000000002',
  org: '20000000-0000-4000-8000-000000000001',
  event: '30000000-0000-4000-8000-000000000001',
  application: '40000000-0000-4000-8000-000000000001',
  command: '50000000-0000-4000-8000-000000000001',
};
const base = '/v1/orgs/' + ids.org + '/events/' + ids.event;
const reviewPath = base + '/recruitment-applications/' + ids.application + '/commands';
const copy = (value) => JSON.parse(JSON.stringify(value));
function setup({ status = 'REVOKED', authorized = true, mode = 'manage', pending = null } = {}) {
  const calls = [],
    storage = new Map();
  const application = {
    id: ids.application,
    orgId: ids.org,
    eventId: ids.event,
    applicantId: mode === 'manage' ? ids.applicant : ids.actor,
    teamName: '合成待审球队',
    status: 'PENDING',
    version: 7,
    publicationId: ids.command,
    teamId: null,
    note: '合成申请说明',
    entryId: null,
    reviewReason: null,
    createdAt: '2026-11-01T00:00:00Z',
    decidedAt: null,
  };
  const workspace = {
    event: {
      id: ids.event,
      name: '合成城市邀请赛',
      version: 3,
      status: status === 'ACTIVE' ? 'REGISTRATION_OPEN' : 'REGISTRATION_CLOSED',
    },
    publication: { id: ids.command, status, version: 2 },
    capabilities: {
      canPublish: false,
      canRevoke: status === 'ACTIVE',
      canImport: false,
      canInvite: status === 'ACTIVE',
    },
  };
  const client = {
    viewerId: () => ids.actor,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body: copy(body || {}) });
      if (url === '/v1/auth/session')
        return { data: { user: { id: ids.actor }, organizations: [], teamContexts: [] } };
      if (url === base + '/recruitment') {
        if (!authorized) throw Object.assign(Error('当前账号没有招募管理权限'), { status: 403 });
        return { data: copy(workspace) };
      }
      if (method === 'GET')
        return {
          data: {
            items: url.includes('recruitment-applications') ? [copy(application)] : [],
            nextCursor: null,
          },
        };
      assert.equal(url, reviewPath);
      assert.ok(body.reason.trim().length >= 4);
      assert.equal(body.expectedVersion, 7);
      if (body.type === 'APPROVE') assert.equal(status, 'ACTIVE');
      if (body.type === 'WITHDRAW') assert.equal(application.applicantId, ids.actor);
      else assert.equal(authorized, true);
      return {
        data: {
          application: {
            ...application,
            status:
              body.type === 'REJECT'
                ? 'REJECTED'
                : body.type === 'APPROVE'
                  ? 'APPROVED'
                  : 'WITHDRAWN',
          },
        },
      };
    },
  };
  const api = { ...require('../utils/api'), getClient: () => client };
  const h = loadPage({
    root,
    route,
    wx: createWx({ storage, modalAnswers: [true] }),
    modules: { [path.join(root, 'utils/api.js')]: api },
  });
  if (pending) h.requireLocal('utils/recruitment-recovery.js').save(ids.actor, pending);
  h.page.onLoad(mode === 'manage' ? { orgId: ids.org, eventId: ids.event } : {});
  return { ...h, calls, application };
}
const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
const reasons = (html) => html.match(/<textarea\b[^>]*data-field="reason"[^>]*>/g) || [];
const reviewButtons = (html) => html.match(/<button\b[^>]*data-mini-bindtap="review"[^>]*>/g) || [];
function typeReason(page, html, value) {
  assert.equal(
    reasons(html).length,
    1,
    'the visible review workflow must expose exactly one reason input',
  );
  assert.match(reasons(html)[0], /data-mini-bindinput="input"/);
  page.input({
    currentTarget: { dataset: { field: reasons(html)[0].match(/data-field="([^"]+)"/)[1] } },
    detail: { value },
  });
}
function event(button) {
  assert.ok(button, 'the existing review action must be rendered');
  return {
    currentTarget: {
      dataset: {
        id: button.match(/data-id="([^"]+)"/)[1],
        decision: button.match(/data-decision="([^"]+)"/)[1],
      },
    },
  };
}

test('a manager can enter reasons and reject a pending historical application after publication revocation', async () => {
  const h = setup();
  await h.page.load();
  assert.equal(h.page.data.workspace.capabilities.canRevoke, false);
  for (const width of [320, 390, 430]) assert.equal(reasons(render(h.page, width)).length, 1);
  const html = render(h.page);
  assert.doesNotMatch(html, /data-mini-bindtap="revoke"/);
  typeReason(h.page, html, '合成招募已撤销，说明原申请拒绝依据。');
  await h.page.review(
    event(reviewButtons(html).find((button) => /data-decision="REJECT"/.test(button))),
  );
  const writes = h.calls.filter((call) => call.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.type, 'REJECT');
  assert.equal(writes[0].body.reason, '合成招募已撤销，说明原申请拒绝依据。');
  assert.match(writes[0].body.clientRequestId, /^[0-9a-f-]{36}$/);
  assert.equal(h.wx.calls.filter((call) => call.type === 'showModal').length, 1);
});

test('active publication management keeps its existing shared reason and approval command', async () => {
  const h = setup({ status: 'ACTIVE' });
  await h.page.load();
  const html = render(h.page);
  assert.match(html, /data-mini-bindtap="revoke"/);
  typeReason(h.page, html, '合成球队申请符合本届审核条件。');
  await h.page.review(
    event(reviewButtons(html).find((button) => /data-decision="APPROVE"/.test(button))),
  );
  assert.equal(h.calls.find((call) => call.method === 'POST').body.type, 'APPROVE');
});

test('an unauthorized management query cannot obtain a review reason field or review actions', async () => {
  const h = setup({ authorized: false });
  await h.page.load();
  const html = render(h.page);
  assert.equal(h.page.data.workspace, null);
  assert.equal(reasons(html).length, 0);
  assert.equal(reviewButtons(html).length, 0);
  await h.page.review({ currentTarget: { dataset: { id: ids.application, decision: 'REJECT' } } });
  assert.equal(h.calls.filter((call) => call.method === 'POST').length, 0);
});

test('an applicant keeps their own withdrawal reason and never gains management review actions', async () => {
  const h = setup({ mode: 'mine', authorized: false });
  await h.page.load();
  const html = render(h.page);
  assert.match(html, /撤回理由/);
  const buttons = reviewButtons(html);
  assert.equal(buttons.length, 1);
  assert.match(buttons[0], /data-decision="WITHDRAW"/);
  typeReason(h.page, html, '合成球队时间调整，撤回本人申请。');
  await h.page.review(event(buttons[0]));
  assert.equal(h.calls.find((call) => call.method === 'POST').body.type, 'WITHDRAW');
});

test('busy and unknown requests disable reasons and review controls without replacing the original', async () => {
  const original = {
    kind: 'REVIEW',
    path: reviewPath,
    body: {
      clientRequestId: ids.command,
      expectedVersion: 7,
      type: 'REJECT',
      reason: '合成原请求拒绝依据',
    },
  };
  for (const pending of [null, original]) {
    const h = setup({ pending });
    await h.page.load();
    h.page.setData({ reason: '合成原说明', ...(!pending ? { busy: true } : {}) });
    const html = render(h.page);
    assert.match(reasons(html)[0], /\sdisabled(?:\s|>)/);
    for (const button of reviewButtons(html)) assert.match(button, /\sdisabled(?:\s|>)/);
    typeReason(h.page, html, '不应改写原操作');
    assert.equal(h.page.data.reason, '合成原说明');
    await h.page.review(event(reviewButtons(html)[0]));
    assert.equal(h.calls.filter((call) => call.method === 'POST').length, 0);
    assert.equal(h.wx.calls.filter((call) => call.type === 'showModal').length, 0);
    if (pending)
      assert.deepEqual(
        copy(h.requireLocal('utils/recruitment-recovery.js').read(ids.actor)),
        original,
      );
  }
});

test('the revoked recruitment CI fixture exposes the reason and rejection action at all widths', () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../tests/mini-program/fixtures/int01-recruitment-revoked-review.json',
      ),
      'utf8',
    ),
  );
  assert.equal(fixture.data.workspace.publication.status, 'REVOKED');
  assert.equal(fixture.data.workspace.capabilities.canRevoke, false);
  const h = setup();
  h.page.setData(fixture.data);
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
    assert.equal(reasons(html).length, 1);
    assert.doesNotMatch(reasons(html)[0], /\sdisabled(?:\s|>)/);
    assert.doesNotMatch(html, /data-mini-bindtap="revoke"/);
    assert.ok(reviewButtons(html).some((button) => /data-decision="REJECT"/.test(button)));
  }
});
