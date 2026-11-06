const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/local-bookings/index';
const id = (n) => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../tests/mini-program/fixtures/int01-local-booking-status-completed.json',
    ),
    'utf8',
  ),
);
const statusLabels = {
  HELD: '待确认锁位',
  REQUESTED: '待服务方接单',
  CONFIRMED: '已确认',
  ARRIVED: '服务方已到场',
  DELIVERED: '服务方已交付',
  COMPLETED: '已完成',
  DECLINED: '已拒绝',
  CANCELLED: '已取消',
  EXPIRED: '已过期',
  DISPUTED: '争议处理中',
};
const rawBooking = (status = 'COMPLETED', extra = {}) => ({
  id: id(1),
  listingId: id(2),
  slotId: id(3),
  status,
  version: 7,
  startsAt: '2026-11-06T01:00:00Z',
  endsAt: '2026-11-06T03:00:00Z',
  holdExpiresAt: ['HELD', 'REQUESTED'].includes(status) ? '2026-11-05T12:00:00Z' : null,
  title: '合成同城球场订单',
  kind: 'COURT',
  address: '合成城市体育中心',
  location: null,
  terms: '合成双方合作约定',
  reason: null,
  change: null,
  paymentStatus: 'NOT_ENABLED',
  canActAs: 'BUYER',
  ...extra,
});
function harness(records = [rawBooking()]) {
  const calls = [];
  const client = {
    sessionRevision: () => 1,
    request: async (url, method = 'GET', body) => {
      calls.push({ url, method, body });
      assert.equal(method, 'GET', 'Reading status must not issue a command');
      if (url === '/v1/auth/session')
        return { data: { user: { id: id(90) }, organizations: [], teamContexts: [] } };
      assert.equal(url, '/v1/local-bookings');
      return { data: { items: structuredClone(records), limit: 200 } };
    },
  };
  const h = loadPage({ root, route, wx: createWx() });
  h.requireLocal('utils/api.js').getClient = () => client;
  h.page.onLoad({});
  return { ...h, calls, records };
}
const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
function progress(html) {
  const start = html.indexOf('status-banner progress-section');
  assert.notEqual(start, -1, 'The real overview must render its progress section');
  return html.slice(start, html.indexOf('supplemental-link', start));
}
const badges = (html) =>
  [...progress(html).matchAll(/class="figma-status(?: [^"]*)?">([^<]*)</g)].map(
    (match) => match[1],
  );
function button(html, handler, key, value) {
  return (html.match(/<button\b[^>]*>/g) || []).find(
    (tag) =>
      tag.includes('data-mini-bindtap="' + handler + '"') &&
      (!key || tag.includes('data-' + key + '="' + value + '"')),
  );
}
async function tap(h, tag) {
  assert.ok(tag, 'Use an actual rendered control');
  assert.doesNotMatch(tag, /\sdisabled(?:\s|>)/);
  const handler = tag.match(/data-mini-bindtap="([^"]+)"/)[1];
  const dataset = Object.fromEntries(
    [...tag.matchAll(/\sdata-(id|key)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
  await h.page[handler]({ currentTarget: { dataset } });
}

for (const [status, label] of Object.entries(statusLabels)) {
  test(
    'server ' + status + ' booking maps to accurate overview progress at every width',
    async () => {
      const h = harness([rawBooking(status)]);
      await h.page.load();
      assert.equal(h.page.data.items[0].status, status);
      assert.equal(h.page.data.items[0].statusText, label);
      assert.equal(Object.hasOwn(h.page.data.items[0], 'checkinStatusText'), false);
      for (const width of [320, 390, 430]) {
        const html = render(h.page, width);
        assert.deepEqual(badges(html), [label, label, '可查询']);
        assert.match(progress(html), /到场进度/);
        assert.doesNotMatch(progress(html), /未核销|已核销|待办理|一次性码|完成时间|到场时间/);
      }
      assert.deepEqual(
        h.calls.map((call) => call.url),
        ['/v1/auth/session', '/v1/local-bookings'],
      );
    },
  );
}

test('personnel arrival remains a self-reported arrival without claiming code redemption', async () => {
  const h = harness([rawBooking('ARRIVED', { kind: 'REFEREE', canActAs: 'PROVIDER' })]);
  await h.page.load();
  assert.deepEqual(badges(render(h.page)), ['服务方已到场', '服务方已到场', '可查询']);
  assert.doesNotMatch(progress(render(h.page)), /核销|一次性码/);
});

test('unknown server status is rejected by the existing mapper and clears the former progress', async () => {
  const h = harness();
  await h.page.load();
  h.records[0].status = 'UNKNOWN';
  await h.page.load();
  assert.equal(h.page.data.items.length, 0);
  assert.match(h.page.data.error, /订单资料无效/);
  assert.doesNotMatch(render(h.page), /status-banner progress-section|未核销|待办理/);
});

test('a missing mapped status label stays unverified rather than claiming unfinished work', async () => {
  const h = harness();
  await h.page.load();
  const stale = { ...h.page.data.items[0] };
  delete stale.statusText;
  h.page.setData({ items: [stale] });
  assert.deepEqual(badges(render(h.page)), ['待核对', '待核对', '可查询']);
});

test('order filtering, selection and detail tabs still use the existing booking handlers', async () => {
  const h = harness([rawBooking(), rawBooking('DELIVERED', { id: id(4), canActAs: 'PROVIDER' })]);
  await h.page.load();
  await tap(h, button(render(h.page), 'filterOrders', 'key', 'PROVIDER'));
  assert.equal(h.page.data.orderFilter, 'PROVIDER');
  assert.equal(h.page.data.filteredCount, 1);
  assert.equal(button(render(h.page), 'select', 'id', id(1)), undefined);
  await tap(h, button(render(h.page), 'select', 'id', id(4)));
  assert.equal(h.page.data.selected.id, id(4));
  assert.equal(h.page.data.selected.statusText, '服务方已交付');
  assert.equal(h.page.data.serviceTab, 'overview');
  await tap(h, button(render(h.page), 'serviceTab', 'key', 'actions'));
  assert.equal(h.page.data.serviceTab, 'actions');
  await tap(h, button(render(h.page), 'closeBooking'));
  assert.equal(h.page.data.selected, null);
  assert.equal(h.page.data.serviceTab, 'overview');
  assert.equal(h.calls.length, 2, 'Navigation does not create a new booking command');
});

for (const firstRole of ['BUYER', 'PROVIDER']) {
  test(
    'filtering away from first ' +
      firstRole +
      ' hides both unrelated summaries and opens the matching order',
    async () => {
      const buyer = rawBooking();
      const provider = rawBooking('DELIVERED', { id: id(4), canActAs: 'PROVIDER' });
      const records = firstRole === 'BUYER' ? [buyer, provider] : [provider, buyer];
      const target = records[1];
      const h = harness(records);
      await h.page.load();
      assert.match(render(h.page), />本次服务</);
      assert.deepEqual(badges(render(h.page)), [
        statusLabels[records[0].status],
        statusLabels[records[0].status],
        '可查询',
      ]);

      await tap(h, button(render(h.page), 'filterOrders', 'key', target.canActAs));
      const filtered = render(h.page);
      assert.equal(h.page.data.filteredCount, 1);
      assert.doesNotMatch(filtered, />本次服务<|status-banner progress-section/);
      assert.ok(button(filtered, 'select', 'id', target.id));
      assert.equal(button(filtered, 'select', 'id', records[0].id), undefined);
      await tap(h, button(filtered, 'openCurrent'));
      assert.equal(h.page.data.selected.id, target.id);
      assert.equal(h.page.data.selected.statusText, statusLabels[target.status]);

      await tap(h, button(render(h.page), 'closeBooking'));
      assert.doesNotMatch(render(h.page), />本次服务<|status-banner progress-section/);
      for (const filter of [firstRole, 'ALL']) {
        await tap(h, button(render(h.page), 'filterOrders', 'key', filter));
        assert.match(render(h.page), />本次服务</);
        assert.deepEqual(badges(render(h.page)), [
          statusLabels[records[0].status],
          statusLabels[records[0].status],
          '可查询',
        ]);
      }
      assert.equal(h.calls.length, 2, 'Filtering and opening preserve read-only navigation');
    },
  );
}

test('new completed fixture is the real mapper projection and preserves its three-width assertions', () => {
  const h = harness();
  const expected = h.requireLocal('utils/local-services.js').booking(rawBooking());
  assert.deepEqual(fixture.data.items, JSON.parse(JSON.stringify([expected])));
  assert.equal(Object.hasOwn(fixture.data.items[0], 'checkinStatusText'), false);
  for (const width of [320, 390, 430]) {
    const html = buildPreview({ root, ...fixture, width }).phone;
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
    for (const text of fixture.expectAbsentText) assert.equal(html.includes(text), false, text);
    assert.deepEqual(badges(html), ['已完成', '已完成', '可查询']);
  }
});
