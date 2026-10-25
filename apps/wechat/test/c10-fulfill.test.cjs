const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const fixtureRoot = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'c10-fulfill-' + name + '.json'), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

function detail(name = 'detail-requested') {
  const f = read(name);
  const h = loadPage({ root, route: f.route });
  const p = h.page;
  p.onLoad({ id: f.data.orderId, view: 'received' });
  p.hidden = false;
  p.visit = 1;
  p.viewer = f.data.order.appearances[0].playerUserId;
  p.raw = clone(f.data.order);
  const ui = h.requireLocal('utils/ui.js');
  p.render(ui.begin(p));
  return { ...h, ui, id: p.data.order.appearances[0].id };
}
const event = (id) => ({ currentTarget: { dataset: { id } } });
const teamName = '合成辨识球队';
const eventName = '合成辨识赛事';
function assertOrderIdentity(data) {
  const html = buildPreview({ root, route: 'pages/booking-detail/index', data }).phone;
  assert.equal(html.split(teamName).length - 1, 1, 'team context appears once');
  assert.equal(html.split(eventName).length - 1, 1, 'event context appears once');
  assert.ok(html.includes(teamName + ' · ' + eventName));
  assert.ok(
    html.includes('第一场'),
    'the legal appearance label need not repeat team/event context',
  );
  return html;
}
function identifyOrder(p) {
  p.raw.teamName = teamName;
  p.raw.eventName = eventName;
  p.raw.appearances.forEach((item) => {
    item.label = '第一场';
  });
  p.render();
}

test('current team and event remain identifiable in summary, status banner, command editor and unknown recovery', async () => {
  for (const name of ['detail-ready', 'detail-accepted']) {
    const h = detail(name);
    identifyOrder(h.page);
    assertOrderIdentity(h.page.data);
    if (name === 'detail-accepted') assert.ok(h.page.data.order.stateTitle);
  }
  const editing = detail('detail-accepted');
  identifyOrder(editing.page);
  await editing.page.chooseAction({
    currentTarget: { dataset: { id: editing.id, type: 'PROPOSE_CHANGE' } },
  });
  editing.page.input({
    currentTarget: { dataset: { field: 'reason' } },
    detail: { value: '合成持续核对改期原因' },
  });
  assert.equal(editing.page.data.form.type, 'PROPOSE_CHANGE');
  assertOrderIdentity(editing.page.data);

  const unknown = detail('detail-requested');
  identifyOrder(unknown.page);
  const original = clone(read('detail-recovery').data.pending.payload);
  unknown
    .requireLocal('utils/booking-orders.js')
    .getJournal()
    .start(unknown.page.viewer, unknown.page.data.orderId, original);
  unknown.page.render();
  const html = assertOrderIdentity(unknown.page.data);
  assert.deepEqual(clone(unknown.page.data.pending.payload), original);
  assert.ok(html.includes(original.commandId));
  assert.ok(html.includes('用原编号核对原操作结果'));
});

test('all command form templates keep one order identity when the appearance has only a local label', () => {
  for (const file of fs
    .readdirSync(fixtureRoot)
    .filter((file) => file.startsWith('c10-fulfill-detail-form-'))) {
    const f = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), 'utf8'));
    f.data.order.teamName = teamName;
    f.data.order.eventName = eventName;
    f.data.order.appearances.forEach((item) => {
      item.label = '第一场';
    });
    f.data.selected.label = '第一场';
    assertOrderIdentity(f.data);
  }
});

test('appearance disclosure changes only explicit display state, never the raw quote or command draft', () => {
  const h = detail();
  const p = h.page;
  const before = JSON.stringify(p.raw);
  assert.equal(p.data.expandedId, '');
  p.toggleAppearance(event(h.id));
  assert.equal(p.data.expandedId, h.id);
  assert.equal(JSON.stringify(p.raw), before);
  assert.equal(p.data.formConfirmed, false);
  assert.equal(p.data.pending, null);
  p.render();
  assert.equal(p.data.expandedId, h.id, 'ordinary repaint must not collapse the disclosure');
  p.toggleAppearance(event(h.id));
  assert.equal(p.data.expandedId, '');
  assert.equal(h.wx.calls.filter((call) => call.type === 'request').length, 0);
});

test('busy, unknown-command and open-editor barriers cannot be collapsed or discard a form draft', () => {
  const h = detail();
  const p = h.page;
  p.setData({ expandedId: h.id, busy: true });
  p.toggleAppearance(event(h.id));
  assert.equal(p.data.expandedId, h.id);
  p.setData({ busy: false, pending: { kind: 'PENDING', payload: { commandId: 'original' } } });
  p.toggleAppearance(event(h.id));
  assert.equal(p.data.expandedId, h.id);
  const fields = { reason: '合成尚未提交的连续编辑', venue: '合成球场' };
  p.setData({ pending: null, form: { type: 'PROPOSE_CHANGE' }, formFields: fields });
  const original = JSON.stringify(p.data.formFields);
  p.toggleAppearance(event(h.id));
  assert.equal(p.data.expandedId, h.id);
  assert.equal(JSON.stringify(p.data.formFields), original);
});

test('a stale display token and an absent appearance cannot open private disclosure content', () => {
  const h = detail();
  h.page.toggleAppearance(event('90000000-0000-4000-8000-000000009999'));
  assert.equal(h.page.data.expandedId, '');
  h.ui.begin(h.page);
  h.page.toggleAppearance(event(h.id));
  assert.equal(h.page.data.expandedId, '');
});

test('hiding the page clears the added disclosure and the original private order/editor state', () => {
  const h = detail();
  h.page.toggleAppearance(event(h.id));
  h.page.onHide();
  assert.equal(h.page.data.expandedId, '');
  assert.equal(h.page.data.order, null);
  assert.equal(h.page.data.form, null);
  assert.equal(h.page.raw, null);
  h.page.toggleAppearance(event(h.id));
  assert.equal(h.page.data.expandedId, '');
});

test('continuous input stays inside the explicit command editor and keeps the original snapshot', async () => {
  const h = detail('detail-accepted');
  h.page.toggleAppearance(event(h.id));
  await h.page.chooseAction({ currentTarget: { dataset: { id: h.id, type: 'PROPOSE_CHANGE' } } });
  assert.equal(h.page.data.form.type, 'PROPOSE_CHANGE');
  const rawBefore = JSON.stringify(h.page.raw);
  for (const value of ['合', '合成连续编辑原因']) {
    h.page.input({ currentTarget: { dataset: { field: 'reason' } }, detail: { value } });
    assert.equal(h.page.data.form.type, 'PROPOSE_CHANGE');
    assert.equal(h.page.data.formFields.reason, value);
    assert.equal(h.page.data.expandedId, h.id);
  }
  assert.equal(JSON.stringify(h.page.raw), rawBefore);
  assert.equal(h.page.data.formConfirmed, false);
  assert.equal(h.page.data.canSubmit, false);
  assert.equal(h.wx.calls.filter((call) => call.type === 'request').length, 0);
});

test('compact booking status tabs retain all original status options and current viewer projection', () => {
  const f = read('bookings-ready');
  const h = loadPage({ root, route: f.route });
  const p = h.page;
  const ui = h.requireLocal('utils/ui.js');
  const order = clone(f.data.rows[0]);
  p.viewer = order.buyerUserId;
  p.raw = {
    viewerUserId: p.viewer,
    teams: [{ id: order.teamId, orgId: order.orgId }],
    orders: [order],
  };
  p.loadedToken = ui.begin(p);
  p.statusTab({ currentTarget: { dataset: { index: 2 } } });
  assert.equal(p.data.status, 'ACCEPTED');
  assert.equal(p.data.rows.length, 1);
  assert.equal(p.data.statusLabels.length, 10);
  p.changeStatus({ detail: { value: 9 } });
  assert.equal(p.data.status, 'EXPIRED');
  assert.equal(p.data.rows.length, 0);
  assert.equal(h.wx.calls.filter((call) => call.type === 'request').length, 0);
});

test('all fulfillment visual fixtures use supported fields and meaningful, traceable template output', () => {
  const names = fs.readdirSync(fixtureRoot).filter((name) => name.startsWith('c10-fulfill-'));
  const primary = new Map();
  assert.equal(names.length, 39);
  for (const file of names) {
    const f = JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), 'utf8'));
    assert.ok(f.figmaNode && f.expectText.length, file);
    assert.ok(
      [
        'ready',
        'loading',
        'empty',
        'error',
        'permission',
        'review',
        'pending',
        'recovery',
      ].includes(f.state),
    );
    if (f.primary) primary.set(f.route, (primary.get(f.route) || 0) + 1);
    for (const width of [320, 390, 430]) {
      const output = buildPreview({ root, route: f.route, data: f.data, width, height: 844 });
      for (const text of f.expectText) assert.ok(output.phone.includes(text), file + ': ' + text);
      for (const asset of output.assets) {
        assert.match(
          asset.path,
          /^assets\/approved-ui\/(?:icon-[a-z-]+-(?:navy|orange|white|green)\.svg|player-placeholder\.svg)$/,
          'only UI icons and neutral placeholders; no sample identities or entire UI screenshot',
        );
      }
    }
  }
  assert.equal(primary.size, 3);
  assert.deepEqual([...primary.values()], [1, 1, 1]);
});

test('new disclosure does not hide pending command recovery, and all unchecked editors stay disabled', () => {
  const pending = read('detail-recovery');
  const output = buildPreview({ root, route: pending.route, data: pending.data }).phone;
  assert.ok(output.includes(pending.data.pending.payload.commandId));
  assert.ok(output.includes('用原编号核对原操作结果'));
  assert.ok(
    output.includes('本场约定与费用'),
    'a pending command forces details visible without a new UI action',
  );
  for (const name of [
    'detail-form-accept',
    'detail-form-decline',
    'detail-form-activate',
    'detail-form-cancel',
    'detail-form-dispute',
    'detail-form-accept-change',
    'detail-form-reject-change',
    'detail-form-propose-change',
    'detail-form-arrive',
    'detail-form-complete',
    'detail-form-resolve-dispute',
  ]) {
    const f = read(name);
    const html = buildPreview({ root, route: f.route, data: f.data }).phone;
    const submit = html.match(/<button\b[^>]*data-mini-bindtap="submit"[^>]*>/)?.[0];
    assert.ok(submit && /\sdisabled(?:\s|>)/.test(submit), name);
    assert.ok(html.includes('资格与服务约定'), name);
    assert.equal(f.data.formConfirmed, false);
  }
});

test('focused editors retain changed arrangements, original conditions, and service records before confirmation', () => {
  for (const name of ['detail-form-accept-change', 'detail-form-reject-change']) {
    const f = read(name);
    const selected = f.data.selected;
    const html = buildPreview({ root, route: f.route, data: f.data }).phone;
    for (const text of [
      selected.change.reportText,
      selected.change.startText,
      selected.change.endText,
      selected.change.venue,
      selected.change.reason,
    ])
      assert.ok(html.includes(text), name + ': ' + text);
    assert.ok(html.includes('同意前原约定保持'));
    f.data.selected.scheduleChanged = true;
    assert.ok(
      buildPreview({ root, route: f.route, data: f.data }).phone.includes('不能按过期约定继续处理'),
    );
  }
  const condition = read('detail-form-activate');
  assert.ok(
    buildPreview({ root, route: condition.route, data: condition.data }).phone.includes(
      condition.data.selected.conditionText,
    ),
  );
  const completed = read('detail-form-complete');
  assert.ok(
    buildPreview({ root, route: completed.route, data: completed.data }).phone.includes(
      completed.data.selected.arrivedText,
    ),
  );
});

test('synthetic snapshots preserve released quote totals and an explicit arrival window', () => {
  for (const suffix of ['cancelled', 'declined', 'expired']) {
    const f = read('detail-' + suffix);
    assert.equal(f.data.order.totals.confirmedTotalFen, 0);
    assert.equal(f.data.order.confirmedText, '¥0.00');
    assert.equal(f.data.order.status, 'CANCELLED');
    assert.equal(
      f.data.order.appearances[0].totalFen,
      33000,
      'historical per-appearance quote remains available',
    );
  }
  const arrive = read('detail-form-arrive');
  const a = arrive.data.order.appearances[0];
  const now = Date.parse(arrive.asOf);
  assert.ok(Date.parse(a.reportAt) - 30 * 60_000 <= now);
  assert.ok(now <= Date.parse(a.endAt) + 24 * 60 * 60_000);
  const request = read('detail-requested');
  assert.equal(
    Date.parse(request.data.order.appearances[0].expiresAt) -
      Date.parse(request.data.order.createdAt),
    20 * 60_000,
  );
  assert.ok(Date.parse(request.asOf) < Date.parse(request.data.order.appearances[0].expiresAt));
});
