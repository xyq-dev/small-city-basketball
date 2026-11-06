const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const fixture = require('../../../tests/mini-program/fixtures/int01-matching-conversion.json');

const root = path.resolve(__dirname, '..');
const route = 'pages/matching/index';
const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const copy = (value) => JSON.parse(JSON.stringify(value));
function harness({ manager = true, capability = {}, state = {}, kind = 'ADULT_PLAYER' } = {}) {
  const h = loadPage({
    root,
    route,
    wx: createWx(),
    modules: {
      './api': {
        getClient: () => ({ sessionRevision: () => 1, onSessionChange: () => () => {} }),
      },
    },
  });
  h.page.onLoad({});
  const selected = copy(fixture.data.selected);
  selected.id = id(1);
  selected.version = 7;
  selected.kind = kind;
  selected.canManage = manager;
  selected.intents = [
    {
      id: id(2),
      version: 4,
      status: 'PENDING',
      statusText: '待确认',
      canAccept: false,
      canWithdraw: false,
      canConvert: false,
      sourceId: null,
      candidate: { ...selected.candidates[0], settingsVersion: 3 },
      ...capability,
    },
  ];
  h.page.setData({ enabled: true, conversionEnabled: true, selected, ...state });
  const writes = [];
  h.page.write = async (...args) => writes.push(copy(args));
  return { ...h, writes };
}
function buttons(h) {
  const html = buildPreview({ root, route, data: h.page.data, width: 320, height: 844 }).phone;
  return [...html.matchAll(/<button\b([^>]*)>/g)].map((match) => {
    const attrs = Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    return {
      handler: attrs['data-mini-bindtap'],
      dataset: Object.fromEntries(
        Object.entries(attrs)
          .filter(([key]) => key.startsWith('data-') && !key.startsWith('data-mini-'))
          .map(([key, value]) => [key.slice(5), value]),
      ),
      disabled: /\sdisabled(?:\s|$)/.test(match[1]),
    };
  });
}
function control(h, handler, type) {
  return buttons(h).find(
    (button) => button.handler === handler && (!type || button.dataset.type === type),
  );
}
async function tap(h, handler, type) {
  const button = control(h, handler, type);
  if (!button || button.disabled) return false;
  await h.page[handler]({ currentTarget: { dataset: button.dataset } });
  return true;
}

test('received intents expose ACCEPT and DECLINE without granting need management', async () => {
  const h = harness({ manager: false, capability: { canAccept: true } });
  for (const type of ['ACCEPT', 'DECLINE']) {
    assert.equal(await tap(h, 'intentCommand', type), true, type);
    assert.equal(h.writes.at(-1)[0], '/v1/matching/intents/' + id(2) + '/commands');
    assert.deepEqual(h.writes.at(-1)[1], { type, expectedVersion: 4 });
  }
  for (const handler of ['run', 'needCommand', 'send', 'reviewConversion'])
    assert.equal(control(h, handler), undefined, handler);
});

test('the sender can withdraw independently of the receiver acceptance capability', async () => {
  const h = harness({ capability: { canWithdraw: true } });
  assert.equal(await tap(h, 'intentCommand', 'WITHDRAW'), true);
  assert.deepEqual(h.writes[0][1], { type: 'WITHDRAW', expectedVersion: 4 });
  assert.equal(control(h, 'intentCommand', 'ACCEPT'), undefined);
  assert.equal(control(h, 'intentCommand', 'DECLINE'), undefined);
});

for (const kind of ['ADULT_PLAYER', 'STAFF_SERVICE', 'TEAM_MATCHUP'])
  test(kind + ' accepted intent reaches the existing review and conversion handlers', async () => {
    const h = harness({ kind, capability: { canConvert: true, status: 'MUTUAL_INTEREST' } });
    const previews = [];
    h.requireLocal('utils/matching.js').repository = () => ({
      preview: async (need, candidate) => {
        previews.push([need.id, candidate.id]);
        return {
          enabled: true,
          merchantName: '合成收款方',
          terms: '本次收费与退费条款',
          acceptedTermsId: 'a'.repeat(64),
        };
      },
    });
    h.requireLocal('utils/local-services.js').repository = () => ({
      bookings: async () => [
        {
          id: id(9),
          kind: 'COURT',
          canActAs: 'BUYER',
          status: 'CONFIRMED',
          startsAt: h.page.data.selected.windows[0].reportAt,
          endsAt: h.page.data.selected.windows[0].endAt,
        },
      ],
    });
    h.page.data.selected.windows[0].endAt = '2028-01-01T12:00:00Z';
    assert.equal(await tap(h, 'reviewConversion'), true);
    assert.deepEqual(previews, [[id(1), h.page.data.selected.intents[0].candidate.id]]);
    assert.equal(h.page.data.conversion.id, id(2));
    assert.equal(h.writes.length, 0, 'review never submits a conversion');
    for (const field of ['eligibility', 'chargeConsent'])
      h.page.check({ currentTarget: { dataset: { field } }, detail: { value: ['yes'] } });
    h.page.setData({ terms: '合成场地与天气约定' });
    assert.equal(await tap(h, 'convert'), true);
    assert.equal(h.writes[0][0], '/v1/matching/intents/' + id(2) + '/commands');
    assert.equal(h.writes[0][1].type, 'CONVERT');
    assert.equal(h.writes[0][1].expectedVersion, 4);
    assert.equal(h.writes[0][1].sourceInput.acceptedTermsId, 'a'.repeat(64));
    assert.equal(h.writes[0][1].sourceInput.chargeConsent, true);
    if (kind === 'TEAM_MATCHUP') assert.equal(h.writes[0][1].sourceInput.courtBookingId, id(9));
  });

test('missing intent capabilities keep all intent mutation entry points absent', () => {
  for (const manager of [false, true]) {
    const h = harness({ manager });
    assert.equal(control(h, 'intentCommand'), undefined);
    assert.equal(control(h, 'reviewConversion'), undefined);
    assert.equal(control(h, 'openSource'), undefined);
  }
});

for (const state of [
  { busy: true },
  { loading: true },
  { pending: { body: { commandId: id(10) } } },
  { pendingError: '原操作待核对' },
  { enabled: false },
])
  test(
    'busy, loading, unknown results and closure block newly restored intent actions: ' +
      JSON.stringify(state),
    async () => {
      for (const [capability, handler, type] of [
        [{ canAccept: true }, 'intentCommand', 'ACCEPT'],
        [{ canAccept: true }, 'intentCommand', 'DECLINE'],
        [{ canWithdraw: true }, 'intentCommand', 'WITHDRAW'],
        [{ canConvert: true }, 'reviewConversion', undefined],
      ]) {
        const h = harness({ capability, state });
        assert.equal(control(h, handler, type)?.disabled, true);
        assert.equal(await tap(h, handler, type), false);
        assert.deepEqual(h.writes, []);
      }
    },
  );

test('converted slots restore the existing guarded reopening command only for the manager', async () => {
  const h = harness();
  h.page.data.selected.slots[0].status = 'CONVERTED';
  assert.equal(await tap(h, 'needCommand', 'REOPEN_SLOT'), true);
  assert.deepEqual(h.writes[0][1], {
    type: 'REOPEN_SLOT',
    expectedVersion: 7,
    slotId: h.page.data.selected.slots[0].id,
  });
  for (const state of [
    { busy: true },
    { pendingError: '待核对' },
    { pending: { body: { commandId: id(10) } } },
  ]) {
    h.page.setData({ busy: false, pendingError: '', pending: null, ...state });
    assert.equal(control(h, 'needCommand', 'REOPEN_SLOT').disabled, true);
  }
  for (const state of [
    { canManage: false },
    { canManage: true, status: 'CLOSED' },
    { canManage: true, status: 'ACTIVE', slots: [{ id: id(3), status: 'OPEN' }] },
  ]) {
    h.page.setData({ selected: { ...h.page.data.selected, ...state } });
    assert.equal(control(h, 'needCommand', 'REOPEN_SLOT'), undefined);
  }
});

test('source links remain reachable for either party and use the existing source navigation', async () => {
  for (const manager of [false, true])
    for (const [sourceKind, url] of [
      ['PLAYER_ORDER', '/pages/booking-detail/index?id=' + id(8)],
      ['TEAM_MATCHUP', '/pages/local-matchups/index'],
      ['LOCAL_BOOKING', '/pages/local-bookings/index'],
    ]) {
      const h = harness({
        manager,
        capability: { sourceId: id(8), sourceKind, status: 'CONVERTED' },
      });
      assert.equal(await tap(h, 'openSource'), true);
      assert.equal(h.wx.calls.find((call) => call.type === 'navigateTo').url, url);
      h.page.setData({ busy: true });
      assert.equal(control(h, 'openSource').disabled, true);
    }
});

test('detail can return to the existing workspace without discarding unknown-operation recovery', async () => {
  const pending = { body: { commandId: id(10) } };
  const h = harness({ manager: false, state: { pending } });
  assert.equal(await tap(h, 'overview'), true);
  assert.equal(h.page.data.selected, null);
  assert.deepEqual(copy(h.page.data.pending), pending);
  assert.equal(control(h, 'retry').disabled, false);
});

test('incoming, conversion and converted fixtures retain their capability entries at all three widths', () => {
  for (const suffix of ['incoming', 'conversion', 'converted']) {
    const fixture = require(
      '../../../tests/mini-program/fixtures/int01-matching-' + suffix + '.json',
    );
    const h = loadPage({ root, route });
    h.page.setData(fixture.data);
    for (const width of [320, 390, 430]) {
      const html = buildPreview({ root, route, data: h.page.data, width, height: 844 }).phone;
      for (const text of fixture.expectText) assert.ok(html.includes(text), suffix + ': ' + text);
      for (const text of fixture.expectAbsentText)
        assert.ok(!html.includes(text), suffix + ': ' + text);
      const entries = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
      for (const [field, disabled] of [
        ['expectEnabled', false],
        ['expectDisabled', true],
      ])
        for (const text of fixture[field]) {
          const entry = entries.find((match) => match[2].includes(text));
          assert.ok(entry, suffix + '/' + width + ': ' + text);
          assert.equal(
            /\sdisabled(?:\s|$)/.test(entry[1]),
            disabled,
            suffix + '/' + width + ': ' + text,
          );
        }
    }
  }
});
