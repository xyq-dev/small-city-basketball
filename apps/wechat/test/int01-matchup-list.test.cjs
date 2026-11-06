const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/local-matchups/index';
const uid = (number) => '10000000-0000-4000-8000-' + String(number).padStart(12, '0');
const actor = uid(10);
const homeOrg = uid(20);
const awayOrg = uid(21);
const homeTeam = uid(30);
const awayTeam = uid(31);
const items = () =>
  ['CANCELLED', 'OPEN', 'CONFIRMED'].map((status, index) => ({
    id: uid(index + 1),
    homeTeamId: homeTeam,
    awayTeamId: awayTeam,
    homeOrgId: homeOrg,
    awayOrgId: awayOrg,
    courtId: uid(40),
    courtOrgId: homeOrg,
    homeTeamName: '合成主队' + (index + 1),
    awayTeamName: '合成客队' + (index + 1),
    startsAt: `2028-06-0${index + 1}T11:00:00Z`,
    endsAt: `2028-06-0${index + 1}T13:00:00Z`,
    address: '合成球场' + (index + 1),
    terms: '合成第' + (index + 1) + '项约赛的独立约定',
    status,
    version: index + 2,
    homeConfirmed: true,
    awayConfirmed: status === 'CONFIRMED',
    canConfirm: status === 'OPEN',
  }));

async function setup({ confirm = true } = {}) {
  const rows = items();
  const calls = [];
  const client = {
    hasSession: () => true,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body: body && structuredClone(body) });
      if (url === '/v1/auth/session')
        return {
          data: {
            user: { id: actor },
            organizations: [],
            teamContexts: [
              {
                orgId: awayOrg,
                teamId: awayTeam,
                teamName: '合成客队',
                organizationName: '合成机构',
              },
            ],
          },
        };
      if (method === 'POST') {
        assert.match(url, /^\/v1\/local-matchups\/[0-9a-f-]{36}\/commands$/);
        return { data: { resourceType: 'MATCHUP', resourceId: url.split('/')[3], version: 9 } };
      }
      if (url === '/v1/local-matchups')
        return { data: { items: structuredClone(rows), limit: 200 } };
      if (url === '/v1/local-bookings') return { data: { items: [], limit: 200 } };
      throw new Error('Unexpected request: ' + url);
    },
  };
  const api = { getClient: () => client, uuid: (value) => value };
  const h = loadPage({
    root,
    route,
    wx: createWx({ modalAnswers: [confirm] }),
    modules: { './api': api, '../../utils/api': api },
  });
  h.page.onLoad();
  await h.page.load();
  assert.equal(h.page.data.error, '');
  assert.equal(h.page.data.items.length, 3);
  return { ...h, rows, calls };
}

const render = (page) => buildPreview({ root, route, data: page.data }).phone;
const buttons = (html) => html.match(/<button\b[^>]*>/g) || [];
const selectButton = (page, id) =>
  buttons(render(page)).find(
    (tag) => tag.includes('data-mini-bindtap="select"') && tag.includes(`data-id="${id}"`),
  );
const commandButton = (page, type) =>
  buttons(render(page)).find(
    (tag) => tag.includes('data-mini-bindtap="command"') && tag.includes(`data-type="${type}"`),
  );
function invoke(page, tag) {
  assert.ok(tag, 'The real template must render the requested actionable row');
  const handler = tag.match(/data-mini-bindtap="([^"]+)"/)?.[1];
  assert.equal(typeof page[handler], 'function');
  const dataset = {};
  for (const key of ['id', 'type', 'key']) {
    const value = tag.match(new RegExp(`data-${key}="([^"]+)"`))?.[1];
    if (value !== undefined) dataset[key] = value;
  }
  return page[handler]({ currentTarget: { dataset } });
}
function inputReason(page) {
  const textarea = (render(page).match(/<textarea\b[^>]*>/g) || []).find((tag) =>
    tag.includes('data-field="reason"'),
  );
  assert.ok(textarea);
  const handler = textarea.match(/data-mini-bindinput="([^"]+)"/)[1];
  page[handler]({
    currentTarget: { dataset: { field: 'reason' } },
    detail: { value: '合成独立核对说明' },
  });
}

test('every returned matchup has a selectable row while the first summary remains visible', async () => {
  const h = await setup();
  const html = render(h.page);
  const ids = buttons(html)
    .filter((tag) => tag.includes('data-mini-bindtap="select"'))
    .map((tag) => tag.match(/data-id="([^"]+)"/)[1]);
  assert.deepEqual(
    ids,
    h.rows.map((row) => row.id),
  );
  for (const text of ['场地预约', '双方球队', '约赛进度', '合成主队1', '合成球场1'])
    assert.ok(html.includes(text), text);
  for (const row of h.rows) {
    assert.ok(html.includes(row.homeTeamName));
    assert.ok(html.includes(row.awayTeamName));
    assert.ok(html.includes(row.address));
  }
});

for (const [index, type] of [
  [1, 'CONFIRM'],
  [2, 'COMPLETE'],
]) {
  test(`returned row ${index + 1} reaches its own detail and ${type} command`, async () => {
    const h = await setup();
    const row = h.rows[index];
    invoke(h.page, selectButton(h.page, row.id));
    assert.equal(h.page.data.selected.id, row.id);
    assert.ok(render(h.page).includes(row.terms));
    if (index === 2) assert.equal(commandButton(h.page, 'CONFIRM'), undefined);
    inputReason(h.page);
    const control = commandButton(h.page, type);
    assert.ok(control);
    assert.doesNotMatch(control, /\bdisabled\b/);
    await invoke(h.page, control);
    const posts = h.calls.filter((call) => call.method === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, `/v1/local-matchups/${row.id}/commands`);
    assert.equal(posts[0].body.expectedVersion, row.version);
    assert.equal(posts[0].body.type, type);
    assert.equal(posts[0].body.reason, '合成独立核对说明');
    assert.match(posts[0].body.commandId, /^[0-9a-f-]{36}$/);
    assert.equal(h.wx.calls.filter((call) => call.type === 'showModal').length, 1);
  });
}

test('a busy page disables every returned row and ignores a late row selection', async () => {
  const h = await setup();
  h.page.setData({ busy: true });
  for (const row of h.rows) assert.match(selectButton(h.page, row.id), /\bdisabled\b/);
  invoke(h.page, selectButton(h.page, h.rows[2].id));
  assert.equal(h.page.data.selected, null);
  assert.equal(
    h.calls.some((call) => call.method === 'POST'),
    false,
  );
});

for (const blocked of ['busy', 'pending', 'pendingError']) {
  test(`${blocked} keeps later-row commands disabled and sends no replacement request`, async () => {
    const h = await setup();
    invoke(h.page, selectButton(h.page, h.rows[1].id));
    inputReason(h.page);
    h.page.setData({ [blocked]: blocked === 'busy' ? true : '合成原操作待核对' });
    const control = commandButton(h.page, 'CONFIRM');
    assert.match(control, /\bdisabled\b/);
    await invoke(h.page, control);
    assert.equal(
      h.calls.some((call) => call.method === 'POST'),
      false,
    );
    assert.equal(
      h.wx.calls.some((call) => call.type === 'showModal'),
      false,
    );
  });
}

test('a later row without recipient confirmation rights hides both response actions', async () => {
  const h = await setup();
  h.page.data.items[1].canConfirm = false;
  invoke(h.page, selectButton(h.page, h.rows[1].id));
  assert.equal(commandButton(h.page, 'CONFIRM'), undefined);
  assert.equal(commandButton(h.page, 'DECLINE'), undefined);
  assert.equal(
    h.calls.some((call) => call.method === 'POST'),
    false,
  );
});

test('cancelling confirmation from the third row preserves its identity and sends nothing', async () => {
  const h = await setup({ confirm: false });
  invoke(h.page, selectButton(h.page, h.rows[2].id));
  inputReason(h.page);
  await invoke(h.page, commandButton(h.page, 'COMPLETE'));
  assert.equal(h.page.data.selected.id, h.rows[2].id);
  assert.equal(
    h.calls.some((call) => call.method === 'POST'),
    false,
  );
});

test('a later row still requires the existing operation explanation before confirmation', async () => {
  const h = await setup();
  invoke(h.page, selectButton(h.page, h.rows[1].id));
  await invoke(h.page, commandButton(h.page, 'CONFIRM'));
  assert.match(h.page.data.error, /约赛操作说明/);
  assert.equal(
    h.calls.some((call) => call.method === 'POST'),
    false,
  );
  assert.equal(
    h.wx.calls.some((call) => call.type === 'showModal'),
    false,
  );
});
