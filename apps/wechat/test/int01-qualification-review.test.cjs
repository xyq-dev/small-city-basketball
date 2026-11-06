const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage, loadComponent } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/qualification-precheck/index';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const org = id(1),
  entry = id(2),
  user = id(3),
  member = id(4),
  request = id(5);
const base = `/v1/orgs/${org}/entries/${entry}/qualification-precheck`;
const participant = (patch = {}) => ({
  memberId: member,
  memberName: '合成待核验成员',
  materialVersion: 4,
  materialRevisionId: id(6),
  requestId: request,
  requestCurrent: true,
  canRequest: false,
  hasIdentity: true,
  hasRealName: true,
  hasPortrait: true,
  hasSignature: true,
  qualification: null,
  ...patch,
});
function setup({
  canReview = true,
  participants = [participant()],
  answers = [true, true],
  unknown = false,
} = {}) {
  const calls = [];
  const workspace = { entryId: entry, eventName: '合成资格杯', canReview, participants };
  const client = {
    viewerId: () => user,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body });
      if (url === '/v1/auth/session')
        return { data: { user: { id: user }, organizations: [], teamContexts: [] } };
      if (url === base && method === 'GET') return { data: workspace };
      if (url === base + '/reviews' && method === 'POST') {
        if (unknown) throw new Error('Synthetic response lost');
        return { data: {} };
      }
      throw new Error('Unexpected synthetic request: ' + method + ' ' + url);
    },
  };
  const h = loadPage({
    root,
    route,
    wx: createWx({ modalAnswers: answers }),
    modules: {
      [path.join(root, 'utils/api.js')]: { getClient: () => client, uuid: (value) => value },
    },
  });
  h.page.onLoad({ orgId: org, entryId: entry });
  return { ...h, calls, workspace };
}
const html = (h) => buildPreview({ root, route, data: h.page.data }).phone;
function buttons(h, handler) {
  return [...html(h).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter((match) => match[1].includes(`data-mini-bindtap="${handler}"`))
    .map((match) => ({ attributes: match[1], text: match[2] }));
}
function invoke(h, button) {
  assert.ok(button, 'The real template must expose the requested action');
  assert.doesNotMatch(button.attributes, /\bdisabled\b/);
  const handler = button.attributes.match(/data-mini-bindtap="([^"]+)"/)[1];
  const dataset = Object.fromEntries(
    [...button.attributes.matchAll(/data-(id|decision)="([^"]+)"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  return h.page[handler]({ currentTarget: { dataset } });
}
async function select(h, memberId = member) {
  await h.page.load();
  const item = buttons(h, 'selectParticipant').find((button) =>
    button.attributes.includes(`data-id="${memberId}"`),
  );
  invoke(h, item);
}
const writes = (h) => h.calls.filter((call) => call.method === 'POST');

for (const decision of ['APPROVED', 'REJECTED'])
  test(
    'an independent reviewer can ' + decision + ' the current request from the rendered action',
    async () => {
      const h = setup();
      await select(h);
      assert.equal(h.page.data.selectedParticipant.requestCurrent, true);
      assert.match(html(h), /独立审核当前成员/);
      assert.doesNotMatch(html(h), /<div class="figma-section__title">本人材料<\/div>/);
      const actions = buttons(h, 'review');
      assert.equal(actions.length, 2);
      await invoke(
        h,
        actions.find((button) => button.attributes.includes(`data-decision="${decision}"`)),
      );
      assert.equal(writes(h).length, 1);
      const command = writes(h)[0];
      assert.equal(command.url, base + '/reviews');
      assert.equal(command.body.memberId, member);
      assert.equal(command.body.requestId, request);
      assert.equal(command.body.expectedMaterialVersion, 4);
      assert.equal(command.body.decision, decision);
      assert.equal(command.body.identityReviewed, decision === 'APPROVED');
      assert.equal(command.body.portraitReviewed, decision === 'APPROVED');
      assert.equal(command.body.signatureReviewed, decision === 'APPROVED');
      assert.match(command.body.clientRequestId, /^[0-9a-f-]{36}$/);
      assert.ok(command.body.reason.length >= 4);
      assert.equal(h.wx.calls.filter((call) => call.type === 'showModal').length, 1);
    },
  );

test('a current selection keeps the member selector reachable and stale requests remain disabled', async () => {
  const other = participant({ memberId: id(7), requestId: id(8), requestCurrent: false });
  const h = setup({ participants: [participant(), other] });
  await select(h);
  assert.equal(buttons(h, 'selectParticipant').length, 2);
  invoke(
    h,
    buttons(h, 'selectParticipant').find((button) =>
      button.attributes.includes(`data-id="${id(7)}"`),
    ),
  );
  assert.equal(h.page.data.selectedMemberId, id(7));
  assert.equal(buttons(h, 'review').length, 2);
  for (const button of buttons(h, 'review')) assert.match(button.attributes, /\bdisabled\b/);
  await h.page.review({ currentTarget: { dataset: { id: id(7), decision: 'APPROVED' } } });
  assert.equal(writes(h).length, 0);
});

test('an applicant with a current request retains progress and cannot see reviewer commands', async () => {
  const h = setup({ canReview: false, participants: [participant({ canRequest: true })] });
  await h.page.load();
  assert.match(html(h), /资格核验进度/);
  assert.match(html(h), /本人材料/);
  assert.equal(buttons(h, 'review').length, 0);
  assert.equal(buttons(h, 'request').length, 0);
  await h.page.review({ currentTarget: { dataset: { id: member, decision: 'APPROVED' } } });
  assert.equal(writes(h).length, 0);
});

test('a non-current applicant can still explicitly submit and an unprivileged reader gets no review action', async () => {
  const h = setup({
    canReview: false,
    participants: [participant({ canRequest: true, requestCurrent: false })],
  });
  await h.page.load();
  assert.equal(buttons(h, 'request').length, 1);
  assert.match(buttons(h, 'request')[0].attributes, /\bdisabled\b/);
  assert.equal(buttons(h, 'review').length, 0);
  const unprivileged = setup({
    canReview: false,
    participants: [participant({ canRequest: false })],
  });
  await unprivileged.page.load();
  unprivileged.page.selectParticipant({ currentTarget: { dataset: { id: member } } });
  assert.equal(buttons(unprivileged, 'review').length, 0);
  await unprivileged.page.review({
    currentTarget: { dataset: { id: member, decision: 'APPROVED' } },
  });
  assert.equal(writes(unprivileged).length, 0);
});

test('busy, loading and unknown-result states keep real review controls disabled', async () => {
  for (const key of ['busy', 'loading', 'pending']) {
    const h = setup();
    await select(h);
    h.page.setData({ [key]: true });
    assert.equal(buttons(h, 'review').length, 2, key);
    for (const button of buttons(h, 'review')) assert.match(button.attributes, /\bdisabled\b/, key);
    if (key !== 'loading')
      await h.page.review({ currentTarget: { dataset: { id: member, decision: 'APPROVED' } } });
    assert.equal(writes(h).length, 0);
  }
});

test('declined and late confirmation cannot approve a current request', async () => {
  const declined = setup({ answers: [false] });
  await select(declined);
  await invoke(declined, buttons(declined, 'review')[0]);
  assert.equal(writes(declined).length, 0);
  const hidden = setup();
  await select(hidden);
  let modal;
  hidden.wx.showModal = (options) => {
    modal = options;
  };
  const operation = invoke(hidden, buttons(hidden, 'review')[0]);
  hidden.page.onHide();
  modal.success({ confirm: true });
  await operation;
  assert.equal(writes(hidden).length, 0);
});

test('an unknown review result retains the exact operation and prevents a second send', async () => {
  const h = setup({ unknown: true });
  await select(h);
  await invoke(h, buttons(h, 'review')[0]);
  assert.equal(writes(h).length, 1);
  assert.ok(h.page.data.pending);
  assert.equal(h.page.data.pending.body.clientRequestId, writes(h)[0].body.clientRequestId);
  for (const button of buttons(h, 'review')) assert.match(button.attributes, /\bdisabled\b/);
  await h.page.review({ currentTarget: { dataset: { id: member, decision: 'APPROVED' } } });
  assert.equal(writes(h).length, 1);
});

test('current reviewer records stay reachable through the history tab', async () => {
  const h = setup({
    participants: [
      participant({
        qualification: { status: 'REJECTED', current: true, reason: '合成需补充原因' },
      }),
    ],
  });
  await select(h);
  const tab = buildPreview({ root, route, data: h.page.data }).components.find(
    (component) => component.tag === 'figma-tabs',
  );
  assert.ok(tab, 'Current reviewer must retain the actual tab component');
  const component = loadComponent({ root, route: tab.path, properties: tab.properties });
  component.instance.triggerEvent = (name, detail) => {
    assert.equal(name, 'change');
    h.page.changeView({ detail });
  };
  component.instance.change({ currentTarget: { dataset: { key: 'history' } } });
  assert.match(html(h), /合成需补充原因/);
  assert.equal(buttons(h, 'review').length, 0);
});
