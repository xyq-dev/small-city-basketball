const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const fixture = require('../../../tests/mini-program/fixtures/int01-local-slot-status.json');

const root = path.resolve(__dirname, '..');
const route = fixture.route;
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function setup() {
  const h = loadPage({ root, route });
  h.page.onLoad({});
  h.page.setData(structuredClone(fixture.data));
  return { ...h, ls: h.requireLocal('utils/local-services.js') };
}
function slot(h, patch = {}) {
  return h.ls.slot({
    id: id(3),
    listingId: fixture.data.listings[0].id,
    startsAt: '2028-05-01T01:00:00Z',
    endsAt: '2028-05-01T03:00:00Z',
    status: 'OPEN',
    version: 7,
    available: false,
    ...patch,
  });
}
const preview = (h, width = 390) =>
  buildPreview({ root, route, data: h.page.data, width, height: 844 }).phone;
const text = (h, width = 390) =>
  preview(h, width)
    .split('<body>')[1]
    .replace(/<[^>]*>/g, ' ');
function selectSlots(h, slots) {
  h.page.setData({
    selected: {
      listing: fixture.data.listings[0],
      terms: '合成档期合作约定',
      slots,
      capabilities: { canManage: true, canReview: false, canConfirmProvider: false },
    },
    reason: '合成天气关闭原因',
  });
}
const closeButtons = (h) =>
  [...preview(h).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter((match) => match[1].includes('data-mini-bindtap="closeSlot"'))
    .map((match) => ({ attributes: match[1], text: match[2] }));

test('real OPEN slot mapper data distinguishes availability without claiming a pending opening or opponent', () => {
  const h = setup();
  for (const available of [true, false]) {
    const mapped = slot(h, { available });
    assert.equal(mapped.status, 'OPEN');
    assert.equal(mapped.available, available);
    h.page.setData({ overviewSlots: [mapped] });
    for (const width of [320, 390, 430]) {
      const body = text(h, width);
      assert.match(body, /档期已开放/);
      assert.ok(body.includes(available ? '可预约' : '当前不可用'));
      assert.doesNotMatch(body, /待开放|待对方确认/);
      assert.ok(body.includes(mapped.timeText));
    }
  }
});
test('detailed slots show their own OPEN/CLOSED state and retain only the original OPEN close action', () => {
  const h = setup();
  const open = slot(h),
    closed = slot(h, { id: id(4), status: 'CLOSED' });
  selectSlots(h, [open, closed]);
  const body = text(h);
  assert.match(body, /档期已开放/);
  assert.match(body, /档期已关闭/);
  assert.doesNotMatch(body, /待对方确认/);
  const buttons = closeButtons(h);
  assert.equal(buttons.length, 1);
  assert.ok(buttons[0].attributes.includes('data-id="' + open.id + '"'));
  assert.doesNotMatch(buttons[0].attributes, /\bdisabled\b/);
});
test('unknown slot states and absent or non-boolean availability remain neutral', () => {
  const h = setup();
  for (const available of [undefined, null, 'true']) {
    const unknown = { ...slot(h), status: 'UNKNOWN', available };
    h.page.setData({ overviewSlots: [unknown] });
    const body = text(h);
    assert.match(body, /档期状态待核对/);
    assert.match(body, /当前不可用/);
    assert.doesNotMatch(body, /可预约|档期已开放|待开放|待对方确认/);
    selectSlots(h, [unknown]);
    assert.match(text(h), /档期状态待核对/);
    assert.equal(closeButtons(h).length, 0);
    h.page.setData({ selected: null });
  }
});
test('busy and unknown operation protection still disable the existing close action', () => {
  const h = setup();
  selectSlots(h, [slot(h)]);
  for (const state of [
    { busy: true, pending: null, pendingError: '' },
    { busy: false, pending: { commandId: id(8) }, pendingError: '' },
    { busy: false, pending: null, pendingError: '合成原操作待核对' },
  ]) {
    h.page.setData(state);
    assert.match(closeButtons(h)[0].attributes, /\bdisabled\b/);
    assert.match(text(h), /档期已开放/);
  }
});
test('the rendered close action retains its slot ID, version, time and original execute handler', async () => {
  const h = setup();
  const first = slot(h),
    second = slot(h, { id: id(5), version: 9 });
  selectSlots(h, [first, second]);
  const button = closeButtons(h)[1];
  const handler = button.attributes.match(/data-mini-bindtap="([^"]+)"/)[1];
  const slotId = button.attributes.match(/data-id="([^"]+)"/)[1];
  let command;
  h.page.execute = async (value) => {
    command = value;
  };
  await h.page[handler]({ currentTarget: { dataset: { id: slotId } } });
  assert.equal(
    command.path,
    '/v1/local-services/listings/' + second.listingId + '/slots/' + second.id + '/close',
  );
  assert.deepEqual(structuredClone(command.body), {
    expectedVersion: second.version,
    reason: h.page.data.reason,
  });
  assert.ok(command.content.includes(second.timeText));
});
test('the new synthetic overview fixture exposes both real availability states at every width', () => {
  const h = setup();
  for (const width of [320, 390, 430]) {
    const body = text(h, width);
    for (const expected of fixture.expectText) assert.ok(body.includes(expected), expected);
    for (const absent of fixture.expectAbsentText) assert.ok(!body.includes(absent), absent);
  }
});
