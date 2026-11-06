const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/reschedule/index';
const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const org = id(1),
  matchId = id(2),
  court = id(3),
  otherCourt = id(4);
const base = `/v1/orgs/${org}/matches/${matchId}`;
const plan = (hour) => ({
  courtId: court,
  courtName: '合成原比赛场地',
  startsAt: `2028-06-01T${hour}:00:00Z`,
  endsAt: `2028-06-01T${String(Number(hour) + 1).padStart(2, '0')}:00:00Z`,
});
async function setup({ empty = false, canReschedule = true, denied = false } = {}) {
  const calls = [];
  const data = {
    event: { id: id(5), name: '合成改期杯赛', status: 'RUNNING', version: 6 },
    match: {
      id: matchId,
      version: 3,
      status: 'SCHEDULED',
      roundNo: 2,
      home: { teamName: '合成主队' },
      away: { teamName: '合成客队' },
      ...plan('11'),
    },
    policy: { slotDurationMinutes: 60 },
    history: empty
      ? []
      : [
          {
            id: id(6),
            from: plan('09'),
            to: plan('11'),
            reason: '合成已保存的场地维护改期',
            createdAt: '2028-05-01T10:00:00Z',
          },
        ],
    historyTruncated: false,
    capabilities: { canReschedule },
  };
  const client = {
    hasSession: () => true,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body });
      assert.equal(method, 'GET', 'Tab navigation must not initiate a write');
      if (url === '/v1/auth/session')
        return { data: { user: { id: id(7) }, organizations: [], teamContexts: [] } };
      if (url === base + '/rescheduling') {
        if (denied) throw { status: 403, message: '合成无读取权限' };
        return { data: structuredClone(data) };
      }
      assert.equal(url, `/v1/orgs/${org}/courts?limit=100`);
      return {
        data: [
          { id: court, name: '合成原比赛场地', status: 'ACTIVE' },
          { id: otherCourt, name: '合成新比赛场地', status: 'ACTIVE' },
        ],
        meta: { nextCursor: null },
      };
    },
  };
  const h = loadPage({ root, route, wx: createWx() });
  h.requireLocal('utils/api.js').getClient = () => client;
  h.page.onLoad({ orgId: org, matchId });
  await h.flush();
  assert.equal(h.page.data.loading, false);
  if (!denied) assert.ok(h.page.data.match, h.page.data.error);
  return { ...h, calls };
}

const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
const buttons = (html) => html.match(/<button\b[^>]*>/g) || [];
const tabs = (page, width = 390) =>
  buttons(render(page, width)).filter(
    (tag) => tag.includes('data-mini-bindtap="changeRescheduleTab"') && tag.includes('role="tab"'),
  );
function tab(page, value) {
  return tabs(page).find((tag) => tag.includes(`data-tab="${value}"`));
}
function change(page, value) {
  const control = tab(page, value);
  assert.ok(control, 'The selected view must keep its own navigation controls');
  assert.doesNotMatch(control, /\bdisabled\b/);
  const handler = control.match(/data-mini-bindtap="([^"]+)"/)[1];
  page[handler]({ currentTarget: { dataset: { tab: control.match(/data-tab="([^"]+)"/)[1] } } });
}
function edit(page, handler, value) {
  const control = (render(page).match(/<[^>]+>/g) || []).find(
    (tag) =>
      tag.includes(`data-mini-bindchange="${handler}"`) ||
      tag.includes(`data-mini-bindinput="${handler}"`),
  );
  assert.ok(control, 'The actual form must expose ' + handler);
  page[handler]({ detail: { value } });
}
const snapshot = (page) => ({
  date: page.data.date,
  time: page.data.time,
  courtIndex: page.data.courtIndex,
  reason: page.data.reason,
});

test('default history-bearing rescheduling can return from history to the unchanged unsaved form', async () => {
  const h = await setup();
  assert.equal(h.page.data.rescheduleTab, 'original');
  assert.equal(h.page.data.history.length, 1);
  edit(h.page, 'pickDate', '2028-06-05');
  edit(h.page, 'pickTime', '21:30');
  edit(h.page, 'pickCourt', 1);
  edit(h.page, 'reasonInput', '合成未提交的改期原因');
  const input = snapshot(h.page),
    before = h.calls.length;
  for (const target of ['history', 'new', 'history', 'original']) {
    change(h.page, target);
    assert.equal(tabs(h.page).length, 3);
    assert.deepEqual(snapshot(h.page), input);
    const html = render(h.page);
    if (target === 'history') {
      assert.ok(html.includes('合成已保存的场地维护改期'));
      assert.doesNotMatch(
        html,
        /id="reschedule-original"|id="reschedule-new"|data-mini-bindinput="reasonInput"|data-mini-bindtap="submit"/,
      );
    } else {
      assert.ok(html.includes('id="reschedule-new"'));
      assert.ok(html.includes('合成未提交的改期原因'));
      assert.ok(html.includes('2028-06-05'));
      assert.ok(html.includes('21:30'));
    }
  }
  assert.equal(h.calls.length, before);
  assert.equal(
    h.wx.calls.some((call) => call.type === 'showModal' || call.type === 'navigateTo'),
    false,
  );
});

test('an empty history stays an exclusive empty view and can return to the original editable form', async () => {
  const h = await setup({ empty: true });
  edit(h.page, 'reasonInput', '合成空历史未提交输入');
  const before = h.calls.length;
  change(h.page, 'history');
  assert.equal(tabs(h.page).length, 3);
  assert.ok(render(h.page).includes('尚无改期'));
  assert.doesNotMatch(
    render(h.page),
    /id="reschedule-new"|data-mini-bindinput="reasonInput"|data-mini-bindtap="submit"/,
  );
  change(h.page, 'new');
  assert.ok(render(h.page).includes('合成空历史未提交输入'));
  assert.doesNotMatch(render(h.page), /id="reschedule-history"/);
  change(h.page, 'history');
  change(h.page, 'original');
  assert.equal(h.page.data.reason, '合成空历史未提交输入');
  assert.equal(h.calls.length, before);
});

test('a reader without rescheduling capability can browse both views but receives no editing form', async () => {
  const h = await setup({ canReschedule: false });
  const before = h.calls.length;
  change(h.page, 'history');
  change(h.page, 'new');
  assert.ok(render(h.page).includes('当前不能改期'));
  assert.doesNotMatch(render(h.page), /id="reschedule-new"|data-mini-bindinput="reasonInput"/);
  const submit = buttons(render(h.page)).find((tag) => tag.includes('data-mini-bindtap="submit"'));
  assert.match(submit, /\bdisabled\b/);
  await h.page.submit();
  assert.equal(h.calls.length, before);
});

test('busy keeps history navigation disabled and ignores a late tab event', async () => {
  const h = await setup();
  change(h.page, 'history');
  h.page.setData({ busy: true });
  assert.equal(tabs(h.page).length, 3);
  for (const control of tabs(h.page)) assert.match(control, /\bdisabled\b/);
  const before = h.calls.length;
  h.page.changeRescheduleTab({ currentTarget: { dataset: { tab: 'new' } } });
  assert.equal(h.page.data.rescheduleTab, 'history');
  assert.equal(h.calls.length, before);
});

test('unknown results retain the original recovery view and prevent tab navigation or resubmission', async () => {
  const h = await setup();
  h.page.setData({ uncertain: true });
  assert.equal(tabs(h.page).length, 0);
  assert.ok(render(h.page).includes('提交结果待核对'));
  const before = h.calls.length;
  h.page.changeRescheduleTab({ currentTarget: { dataset: { tab: 'history' } } });
  await h.page.submit();
  assert.equal(h.page.data.rescheduleTab, 'original');
  assert.equal(h.calls.length, before);
});

test('loading retains the existing read-only navigation behavior and missing matches expose no tabs', async () => {
  const h = await setup();
  h.page.setData({ loading: true });
  const before = h.calls.length;
  change(h.page, 'history');
  change(h.page, 'new');
  assert.equal(h.calls.length, before);
  h.page.setData({ match: null });
  assert.equal(tabs(h.page).length, 0);
  const hidden = await setup({ denied: true });
  assert.equal(tabs(hidden.page).length, 0);
  assert.doesNotMatch(
    render(hidden.page),
    /data-mini-bindinput="reasonInput"|data-mini-bindtap="submit"/,
  );
});

test('the history-navigation CI fixture exposes all return tabs at every logical width', () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../tests/mini-program/fixtures/int01-reschedule-history-nav.json',
      ),
      'utf8',
    ),
  );
  const h = loadPage({ root, route });
  h.page.setData(fixture.data);
  for (const width of [320, 390, 430]) {
    assert.equal(tabs(h.page, width).length, 3);
    const html = render(h.page, width);
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /data-mini-bindinput="reasonInput"|data-mini-bindtap="submit"/);
  }
});
