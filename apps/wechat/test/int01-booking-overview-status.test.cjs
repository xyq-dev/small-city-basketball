const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/bookings/index';
const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const actor = id(1);
const clone = (value) => JSON.parse(JSON.stringify(value));

function order(status, n = 10, playerUserId = actor) {
  const inactive = ['CANCELLED', 'DECLINED', 'EXPIRED'].includes(status);
  return {
    id: id(n),
    orgId: id(2),
    teamId: id(3),
    buyerUserId: actor,
    teamName: '合成预约球队',
    eventName: '合成逐场状态赛事',
    scope: 'SINGLE',
    status: status === 'COMPLETED' ? 'COMPLETED' : status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
    version: 6,
    feeBps: 1000,
    settingsVersion: 1,
    eligibilityStatus: 'DECLARED_NOT_VERIFIED',
    eligibilityNotice: '合成资格声明，非核验结论',
    createdAt: '2026-10-20T00:00:00Z',
    appearances: [
      {
        id: id(n + 100),
        orderId: id(n),
        profileId: id(n + 200),
        playerUserId,
        playerName: '合成' + status + '球员',
        position: 'PG',
        label: '合成独立场次',
        conditionText: null,
        status,
        version: 4,
        bufferMinutes: 30,
        reportAt: '2026-10-28T11:00:00Z',
        startAt: '2026-10-28T11:30:00Z',
        endAt: '2026-10-28T13:00:00Z',
        venue: '合成预约球场',
        serviceFen: 30000,
        platformFeeFen: 3000,
        travelFen: 0,
        accommodationFen: 0,
        totalFen: 33000,
        expiresAt: null,
        changeRequest: null,
        arrivedAt: status === 'COMPLETED' || status === 'ARRIVED' ? '2026-10-28T11:00:00Z' : null,
        completedAt: status === 'COMPLETED' ? '2026-10-28T13:00:00Z' : null,
        cancellationReason: status === 'CANCELLED' ? '合成双方取消安排' : null,
        scheduleChanged: false,
        paymentStatus: 'UNAVAILABLE',
        settlementStatus: 'BLOCKED',
        capabilities: Object.fromEntries(
          [
            'canAccept',
            'canDecline',
            'canCancel',
            'canActivate',
            'canProposeChange',
            'canAcceptChange',
            'canRejectChange',
            'canArrive',
            'canComplete',
            'canDispute',
            'canResolveDispute',
          ].map((key) => [key, false]),
        ),
      },
    ],
    totals: {
      confirmedServiceFen: inactive ? 0 : 30000,
      confirmedPlatformFeeFen: inactive ? 0 : 3000,
      confirmedTravelFen: 0,
      confirmedAccommodationFen: 0,
      confirmedTotalFen: inactive ? 0 : 33000,
      conditionalTotalFen: 0,
      paidFen: 0,
      refundedFen: 0,
      settledFen: 0,
    },
  };
}

async function harness(
  orders,
  view = 'sent',
  teams = [{ id: id(3), orgId: id(2), name: '合成预约球队' }],
) {
  const h = loadPage({ root, route, wx: createWx() });
  const calls = [];
  const workspace = {
    viewerUserId: actor,
    isPlatformOperator: false,
    paymentAvailable: false,
    paymentNotice: '资金订单暂未开放',
    ordersHasMore: false,
    settings: { feeBps: 1000, version: 1 },
    players: [],
    ownProfile: null,
    reviewQueue: [],
    teams,
    events: [],
    matches: [],
    orders,
    statistics: {
      orders: orders.length,
      completedAppearances: 0,
      quotedPlatformFeeFen: 0,
      collectedPlatformFeeFen: 0,
      settledPlayerFen: 0,
    },
  };
  const client = {
    viewerId: () => actor,
    sessionRevision: () => 0,
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body });
      if (url === '/v1/auth/session')
        return { data: { user: { id: actor }, organizations: [], teamContexts: [] } };
      assert.equal(url, '/v1/player-bookings/workspace');
      assert.equal(method, 'GET');
      return { data: clone(workspace) };
    },
  };
  h.requireLocal('utils/api.js').getClient = () => client;
  h.page.onLoad({ view });
  await h.page.load();
  assert.equal(h.page.data.error, '');
  assert.equal(calls.length, 2, 'Use the real session, SDK response guard and page mapper');
  return { ...h, calls, workspace };
}

function render(page, width = 390) {
  const html = buildPreview({ root, route, data: page.data, width }).phone;
  const start = html.indexOf('合作进度');
  const end = html.indexOf('class="filter-toggle"', start);
  return { html, progress: start < 0 ? '' : html.slice(start, end) };
}
function neutralProgress(progress) {
  assert.ok(progress, 'Keep the existing cooperation progress section');
  assert.doesNotMatch(progress, /进行中|待办理/);
  assert.match(progress, /逐场查看/);
  assert.match(progress, /按当前记录核对/);
}
function button(html, handler, key) {
  const tags = html.match(/<button\b[^>]*>/g) || [];
  const result = tags.find(
    (tag) =>
      tag.includes('data-mini-bindtap="' + handler + '"') &&
      (!key || tag.includes('data-id="' + key + '"')),
  );
  assert.ok(result, handler + ' ' + (key || ''));
  return result;
}
function tap(h, tag) {
  assert.doesNotMatch(tag, /\sdisabled(?:\s|>)/);
  const handler = /data-mini-bindtap="([^"]+)"/.exec(tag)[1];
  const dataset = Object.fromEntries(
    [...tag.matchAll(/\sdata-(id|index|view)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
  return h.page[handler]({ currentTarget: { dataset } });
}

for (const [status, text] of [
  ['COMPLETED', '服务记录已完成'],
  ['CANCELLED', '已取消'],
]) {
  for (const view of ['sent', 'received']) {
    test(`${view}: a sole ${status} appearance keeps its true mapped state and no pending overview`, async () => {
      const raw = order(status);
      assert.equal(Object.hasOwn(raw.appearances[0], 'statusText'), false);
      const h = await harness([raw], view);
      const row = h.page.data.rows[0];
      assert.equal(row.appearances[0].status, status);
      assert.equal(row.appearances[0].statusText, text);
      assert.deepEqual(row.appearances[0].capabilities, raw.appearances[0].capabilities);
      assert.equal(row.appearances[0].actions.length, 0);
      for (const width of [320, 390, 430]) {
        const { html, progress } = render(h.page, width);
        neutralProgress(progress);
        assert.ok(html.includes(text));
        assert.equal(
          button(html, 'toggleInfo', raw.appearances[0].id).includes('is-green'),
          status === 'COMPLETED',
        );
        assert.ok(button(html, 'detail', raw.id));
      }
      assert.equal(h.calls.length, 2);
    });
  }
}

test('mixed current and terminal records keep per-appearance statuses rather than an aggregate claim', async () => {
  const h = await harness([order('REQUESTED', 10), order('COMPLETED', 20), order('CANCELLED', 30)]);
  const { html, progress } = render(h.page);
  neutralProgress(progress);
  assert.deepEqual(
    h.page.data.rows.map((row) => row.appearances[0].statusText),
    ['待球员接单', '服务记录已完成', '已取消'],
  );
  for (const text of ['待球员接单', '服务记录已完成', '已取消']) assert.ok(html.includes(text));
  assert.equal((html.match(/data-mini-bindtap="toggleInfo"/g) || []).length, 3);
});

test('original completed/cancelled filters, disclosures and navigation preserve exact order and appearance IDs', async () => {
  const h = await harness([order('REQUESTED', 10), order('COMPLETED', 20), order('CANCELLED', 30)]);
  h.page.toggleFilters();
  let html = render(h.page).html;
  const completedTab = (html.match(/<button\b[^>]*>/g) || []).find(
    (tag) => tag.includes('data-mini-bindtap="statusTab"') && tag.includes('data-index="5"'),
  );
  await tap(h, completedTab);
  assert.equal(h.page.data.status, 'COMPLETED');
  assert.deepEqual(
    h.page.data.rows.map((row) => row.id),
    [id(20)],
  );
  neutralProgress(render(h.page).progress);
  const picker = /<div\b[^>]*data-mini-bindchange="changeStatus"[^>]*>/.exec(render(h.page).html);
  assert.ok(picker, 'Retain the original more-status selector');
  h.page.changeStatus({ detail: { value: '8' } });
  assert.equal(h.page.data.status, 'CANCELLED');
  assert.deepEqual(
    h.page.data.rows.map((row) => row.id),
    [id(30)],
  );
  html = render(h.page).html;
  await tap(h, button(html, 'toggleInfo', id(130)));
  html = render(h.page).html;
  await tap(h, button(html, 'trade', id(130)));
  assert.equal(
    h.wx.calls.at(-1).url,
    '/pages/trade-order/index?kind=PLAYER_APPEARANCE&sourceId=' + id(130),
  );
  await tap(h, button(html, 'detail', id(30)));
  assert.equal(h.wx.calls.at(-1).url, '/pages/booking-detail/index?id=' + id(30) + '&view=sent');
  assert.equal(h.calls.length, 2, 'Status filters and navigation create no extra read or write');
});

test('received records stay limited to this player and unauthorized sent teams stay absent', async () => {
  const mine = order('COMPLETED', 10);
  mine.appearances.push(order('CANCELLED', 20, id(99)).appearances[0]);
  mine.appearances[1].orderId = mine.id;
  const h = await harness([mine], 'received', []);
  assert.equal(h.page.data.rows[0].appearances.length, 1);
  const { html, progress } = render(h.page);
  neutralProgress(progress);
  assert.ok(html.includes('合成COMPLETED球员'));
  assert.ok(!html.includes('合成CANCELLED球员'));
  const sent = await harness([mine], 'sent', []);
  assert.equal(sent.page.data.rows.length, 0);
  assert.equal(render(sent.page).progress, '');
});

test('loading locks original controls and hidden-page clearing removes the overview', async () => {
  const h = await harness([order('COMPLETED')]);
  h.page.setData({ loading: true });
  const html = render(h.page).html;
  for (const [handler, key] of [
    ['toggleInfo', id(110)],
    ['detail', id(10)],
    ['toggleFilters'],
    ['players'],
  ]) {
    assert.match(button(html, handler, key), /\sdisabled(?:\s|>)/);
  }
  h.page.toggleInfo({ currentTarget: { dataset: { id: id(110) } } });
  assert.equal(h.page.data.expandedAppearanceId, '');
  h.page.onHide();
  assert.equal(h.page.data.rows.length, 0);
  assert.equal(render(h.page).progress, '');
  assert.equal(
    h.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('minimal completed CI fixture carries a true mapped terminal state at all three widths', () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../tests/mini-program/fixtures/int01-booking-overview-status.json',
      ),
      'utf8',
    ),
  );
  assert.equal(fixture.route, route);
  assert.equal(fixture.data.rows.length, 1);
  assert.equal(require('../utils/booking-data').order(fixture.data.rows[0]), true);
  assert.equal(fixture.data.rows[0].appearances[0].status, 'COMPLETED');
  assert.equal(fixture.data.rows[0].appearances[0].statusText, '服务记录已完成');
  const h = loadPage({ root, route });
  h.page.setData(fixture.data);
  for (const width of [320, 390, 430]) {
    const { html, progress } = render(h.page, width);
    neutralProgress(progress);
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
    for (const text of fixture.expectAbsentText) assert.ok(!html.includes(text), text);
  }
});
