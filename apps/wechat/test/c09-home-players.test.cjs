const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');

const root = path.resolve(__dirname, '..');
const actor = '10000000-0000-4000-8000-000000000900';
const profile = {
  id: '10000000-0000-4000-8000-000000000001',
  userId: '10000000-0000-4000-8000-000000000501',
  displayName: '合成球员',
  position: 'PG',
  heightCm: 182,
  city: '石鼓',
  bio: '合成资料',
  priceFen: 30000,
  travelFen: 0,
  accommodationFen: 0,
  status: 'APPROVED',
  availability: [{ startAt: '2026-10-28T09:00:00Z', endAt: '2026-10-28T14:00:00Z' }],
};

function fixture() {
  let read = 0;
  let resolveStatistics;
  let hold = false;
  const sdk = {
    workspace: async () => ({
      viewerUserId: actor,
      players: [profile],
      settings: { feeBps: 1000 },
    }),
    performances: async () => {
      if (hold) await new Promise((resolve) => (resolveStatistics = resolve));
      return { players: [], unavailableProfileIds: [] };
    },
  };
  const ui = {
    session: async () => ({ user: { id: actor } }),
    begin() {
      return ++read;
    },
    live: (_, token) => token === read,
    message: (error) => error.message,
  };
  const harness = loadPage({
    root,
    route: 'pages/players/index',
    modules: { '../../utils/ui': ui, '../../utils/booking': sdk },
  });
  return {
    ...harness,
    holdStatistics() {
      hold = true;
    },
    releaseStatistics() {
      hold = false;
      resolveStatistics();
    },
  };
}

test('catalog summary describes the completed result rather than unapplied or in-flight drafts', async () => {
  const f = fixture();
  await f.page.onShow();
  assert.equal(f.page.data.filtersOpen, false);
  assert.equal(f.page.data.filterSummary.price, '不限价格');
  f.page.positionChange({ detail: { value: '1' } });
  f.page.input({ currentTarget: { dataset: { field: 'price' } }, detail: { value: '300' } });
  f.page.dateChange({ detail: { value: '2026-10-28' } });
  assert.equal(f.page.data.filterSummary.price, '不限价格');
  f.holdStatistics();
  const applying = f.page.applyFilters();
  await new Promise((resolve) => setImmediate(resolve));
  f.page.input({ currentTarget: { dataset: { field: 'price' } }, detail: { value: '450' } });
  f.releaseStatistics();
  await applying;
  assert.equal(f.page.data.cards[0].price, '¥300.00');
  assert.equal(f.page.data.filterSummary.position, '控球后卫');
  assert.equal(f.page.data.filterSummary.price, '同价 ¥300');
  assert.equal(f.page.data.filterSummary.date, '10月28日');
  assert.equal(f.page.data.filters.price, '450');
});

test('invalid filter correction keeps the last applied summary and the authenticated catalog recoverable', async () => {
  const f = fixture();
  await f.page.onShow();
  f.page.input({ currentTarget: { dataset: { field: 'price' } }, detail: { value: '300' } });
  await f.page.applyFilters();
  assert.equal(f.page.data.filterSummary.price, '同价 ¥300');
  f.page.input({ currentTarget: { dataset: { field: 'price' } }, detail: { value: 'oops' } });
  await f.page.applyFilters();
  assert.match(f.page.data.error, /金额/);
  assert.equal(f.page.data.filterSummary.price, '同价 ¥300');
  await f.page.clearFilters();
  assert.equal(f.page.data.error, '');
  assert.equal(f.page.data.filterSummary.price, '不限价格');
  assert.equal(f.page.data.cards.length, 1);
});
