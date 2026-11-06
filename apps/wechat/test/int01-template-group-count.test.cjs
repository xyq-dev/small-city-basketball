const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/event-setup/index';
const org = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';

function setup({ format = 'GROUP_KNOCKOUT', confirm = true } = {}) {
  const requests = [];
  const client = {
    viewerId: () => actor,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      requests.push({ url, method, body: body && structuredClone(body) });
      if (method === 'GET') throw { status: 404, message: '未找到回执' };
      return {
        data: {
          clientRequestId: body.clientRequestId,
          operation: 'CREATE_TEMPLATE',
          template: { id: org, versionId: eventId, version: 1 },
          event: null,
        },
      };
    },
  };
  const h = loadPage({
    root,
    route,
    wx: createWx({ modalAnswers: [confirm] }),
    modules: {
      [path.join(root, 'utils/api.js')]: {
        getClient: () => client,
        uuid: (value) => value,
      },
    },
  });
  h.page.orgId = org;
  h.page._event = { id: eventId, version: 7, format };
  h.page.setData({
    creating: false,
    event: { groups: format === 'GROUP_KNOCKOUT', knockout: format === 'SINGLE_ELIMINATION' },
    templateCanManage: true,
    templateName: '合成分组办赛模板',
    templateExpectedTeams: '32',
    templateScheduling: {
      dailyStart: '09:00',
      dailyEnd: '21:00',
      slotDurationMinutes: 60,
      minRestMinutes: 0,
      minLocalDayGap: 0,
      groupCount: 2,
      thirdPlaceMatch: false,
    },
  });
  h.page.loadTemplates = async () => {};
  return { ...h, requests };
}

const render = (page) => buildPreview({ root, route, data: page.data }).phone;
function input(html) {
  return (html.match(/<input\b[^>]*>/g) || []).find((tag) =>
    tag.includes('data-field="groupCount"'),
  );
}
function saveButton(html) {
  return (html.match(/<button\b[^>]*>/g) || []).find((tag) =>
    tag.includes('data-mini-bindtap="saveAsTemplate"'),
  );
}
function changeGroupCount(page, tag, value) {
  assert.ok(tag, 'The real template must expose the group-count control');
  const handler = tag.match(/data-mini-bindinput="([^"]+)"/)?.[1];
  assert.ok(handler && typeof page[handler] === 'function');
  page[handler]({ currentTarget: { dataset: { field: 'groupCount' } }, detail: { value } });
}

for (const groups of [4, 8]) {
  test(`grouped template input reaches the confirmed ${groups}-group server command`, async () => {
    const h = setup();
    const tag = input(render(h.page));
    assert.match(tag, /value="2"/);
    assert.doesNotMatch(tag, /\bdisabled\b/);
    changeGroupCount(h.page, tag, String(groups));
    assert.match(input(render(h.page)), new RegExp(`value="${groups}"`));
    const save = saveButton(render(h.page));
    assert.ok(save);
    assert.doesNotMatch(save, /\bdisabled\b/);
    const handler = save.match(/data-mini-bindtap="([^"]+)"/)[1];
    await h.page[handler]();
    const posts = h.requests.filter((request) => request.method === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, `/v1/orgs/${org}/event-template-commands`);
    assert.equal(posts[0].body.type, 'CREATE_FROM_EVENT');
    assert.equal(posts[0].body.eventId, eventId);
    assert.equal(posts[0].body.expectedEventVersion, 7);
    assert.equal(posts[0].body.scheduling.groupCount, groups);
    assert.equal(posts[0].body.expectedTeams, 32);
    assert.equal(h.page.data.templatePending, false);
    assert.match(h.page.data.notice, /已完成/);
  });
}

test('non-grouped templates hide group count and send null despite a stale value', async () => {
  for (const format of ['ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'SINGLE_ELIMINATION']) {
    const h = setup({ format });
    assert.equal(input(render(h.page)), undefined, format);
    await h.page.saveAsTemplate();
    assert.equal(
      h.requests.find((request) => request.method === 'POST').body.scheduling.groupCount,
      null,
    );
  }
});

for (const blocked of ['busy', 'templatePending']) {
  test(`${blocked} prevents editing group count or sending a template command`, async () => {
    const h = setup();
    h.page.setData({ [blocked]: true });
    const html = render(h.page);
    const tag = input(html);
    assert.match(tag, /\bdisabled\b/);
    assert.match(saveButton(html), /\bdisabled\b/);
    changeGroupCount(h.page, tag, '8');
    assert.equal(h.page.data.templateScheduling.groupCount, 2);
    await h.page.saveAsTemplate();
    assert.equal(h.requests.length, 0);
    assert.equal(
      h.wx.calls.some((call) => call.type === 'showModal'),
      false,
    );
  });
}

test('read-only viewers cannot see template controls or send a template command', async () => {
  const h = setup();
  h.page.setData({ templateCanManage: false });
  const html = render(h.page);
  assert.equal(input(html), undefined);
  assert.equal(saveButton(html), undefined);
  await h.page.saveAsTemplate();
  assert.equal(h.requests.length, 0);
});

test('choosing a group count still requires the existing explicit save confirmation', async () => {
  const h = setup({ confirm: false });
  changeGroupCount(h.page, input(render(h.page)), '4');
  await h.page.saveAsTemplate();
  assert.equal(h.requests.length, 0);
  assert.equal(h.wx.calls.filter((call) => call.type === 'showModal').length, 1);
});
