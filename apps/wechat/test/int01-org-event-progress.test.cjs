const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const fixture = require('../../../tests/mini-program/fixtures/int01-org-event-progress.json');

const root = path.resolve(__dirname, '..');
const route = fixture.route;
const orgId = '10000000-0000-4000-8000-000000000001';
const eventId = fixture.data.event.id;
async function setup({
  status = 'COMPLETED',
  submitted = 0,
  approved = 2,
  frozen = true,
  review = true,
  readable = true,
} = {}) {
  const h = loadPage({ root, route });
  const api = h.requireLocal('utils/api.js');
  api.getClient = () => ({ hasSession: () => false });
  h.page.onLoad({ orgId, eventId });
  const requests = [];
  const registration = {
    counts: { SUBMITTED: submitted, APPROVED: approved },
    freeze: frozen ? { version: 3 } : null,
  };
  const manage = await h.page.readManage({
    async request(url) {
      requests.push(url);
      if (url.endsWith('/registration') && review) return { data: registration };
      if (url.endsWith('/lifecycle') && readable)
        return { data: { capabilities: {}, completion: null } };
      throw { status: 403, code: 'FORBIDDEN' };
    },
  });
  h.page.setData({
    ...structuredClone(fixture.data),
    event: { ...fixture.data.event, status, statusLabel: api.eventStatus(status) },
    manage,
  });
  return { ...h, requests, registration };
}
const html = (h, width = 390) =>
  buildPreview({ root, route, data: h.page.data, width, height: 844 }).phone;
function steps(h, width = 390) {
  const rendered = html(h, width);
  const start = rendered.indexOf('org-event-step');
  return rendered.slice(start, rendered.indexOf('赛事待办', start));
}
const stepStatuses = (h, width = 390) =>
  [...steps(h, width).matchAll(/class="figma-status(?: [^"]*)?">([^<]*)</g)].map(
    (match) => match[1],
  );
function buttons(h, handler) {
  return [...html(h).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter((match) => match[1].includes('data-mini-bindtap="' + handler + '"'))
    .map((match) => ({ attributes: match[1], content: match[2] }));
}
const reviewRow = (h) =>
  buttons(h, 'openReview').find((button) => button.attributes.includes('class="figma-row"'));
function invoke(h, button) {
  assert.ok(button, 'Use a currently rendered original navigation control');
  assert.doesNotMatch(button.attributes, /\bdisabled\b/);
  const handler = button.attributes.match(/data-mini-bindtap="([^"]+)"/)[1];
  return h.page[handler]({ currentTarget: { dataset: {} } });
}

for (const status of ['DRAFT', 'COMPLETED', 'ARCHIVED']) {
  test(
    status + ' and read permission do not fabricate rule completion or pending registration work',
    async () => {
      const draft = status === 'DRAFT';
      const h = await setup({ status, approved: draft ? 0 : 2, frozen: !draft });
      const expected = draft ? '已提交 0 · 已通过 0' : '已提交 0 · 已通过 2 · 名单已冻结';
      assert.equal(h.page.data.manage.review, true);
      assert.equal(h.page.data.manage.reviewLabel, expected);
      for (const width of [320, 390, 430]) {
        assert.deepEqual(stepStatuses(h, width).slice(0, 2), ['查看规程', '查看进度']);
        const row = reviewRow(h);
        assert.ok(row);
        assert.ok(row.content.includes(expected));
        assert.match(row.content, /class="figma-status(?: [^"]*)?">查看</);
        assert.doesNotMatch(steps(h, width) + row.content, /进行中|待审核|>已完成</);
      }
    },
  );
}
test('actual readManage registration counts and unfrozen status remain visible without replacing them with permissions', async () => {
  const h = await setup({ status: 'REGISTRATION_OPEN', submitted: 3, approved: 1, frozen: false });
  assert.equal(h.page.data.manage.reviewLabel, '已提交 3 · 已通过 1');
  assert.match(reviewRow(h).content, /已提交 3 · 已通过 1/);
  assert.doesNotMatch(reviewRow(h).content, /名单已冻结|待审核/);
  assert.equal(h.requests.length, 3);
  assert.ok(h.requests.includes('/v1/orgs/' + orgId + '/events/' + eventId + '/registration'));
});
test('an unreadable schedule never implies unfinished scheduling and known matches retain their existing status', async () => {
  const h = await setup();
  const failed = await h.page.readSchedule({
    async request() {
      throw { status: 503, code: 'UNAVAILABLE' };
    },
  });
  assert.equal(failed.matches.length, 0);
  assert.ok(failed.error);
  h.page.setData({ matches: failed.matches, scheduleError: failed.error });
  assert.equal(stepStatuses(h)[2], '查看排程');
  assert.doesNotMatch(steps(h), /待办理/);
  const known = await h.page.readSchedule({
    async request() {
      return {
        data: [{ id: eventId, roundNo: 1, startsAt: '2026-11-06T01:00:00Z', status: 'SCHEDULED' }],
        meta: { nextCursor: null },
      };
    },
  });
  h.page.setData({ matches: known.matches, scheduleError: known.error });
  assert.equal(stepStatuses(h)[2], '已排程');
});
test('denied registration reads do not expose the original review row and retain the disabled footer', async () => {
  for (const readable of [true, false]) {
    const h = await setup({ review: false, readable });
    assert.equal(reviewRow(h), undefined);
    const footer = buttons(h, 'openReview');
    assert.equal(footer.length, 1);
    assert.match(footer[0].attributes, /\bdisabled\b/);
  }
});
test('the original visible review and settings controls keep the exact organization/event navigation', async () => {
  const h = await setup();
  await invoke(h, reviewRow(h));
  await invoke(h, buttons(h, 'openSetup').at(-1));
  const calls = h.wx.calls.filter((call) => call.type === 'navigateTo');
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      '/pages/entry-review/index?orgId=' + orgId + '&eventId=' + eventId,
      '/pages/event-setup/index?orgId=' + orgId + '&eventId=' + eventId,
    ],
  );
  assert.equal(h.wx.calls.filter((call) => call.type === 'request').length, 0);
});
test('the existing loading gates on footer navigation remain disabled', async () => {
  const h = await setup();
  h.page.setData({ loading: true });
  assert.match(buttons(h, 'openReview').at(-1).attributes, /\bdisabled\b/);
  assert.match(buttons(h, 'openSetup').at(-1).attributes, /\bdisabled\b/);
});
test('the new no-pending fixture retains actual readManage output and three-width assertions', async () => {
  const h = await setup();
  assert.deepEqual(fixture.data.manage, structuredClone(h.page.data.manage));
  for (const width of [320, 390, 430]) {
    const body = html(h, width)
      .split('<body>')[1]
      .replace(/<[^>]*>/g, ' ');
    for (const expected of fixture.expectText) assert.ok(body.includes(expected), expected);
    for (const absent of fixture.expectAbsentText) assert.ok(!body.includes(absent), absent);
  }
});
