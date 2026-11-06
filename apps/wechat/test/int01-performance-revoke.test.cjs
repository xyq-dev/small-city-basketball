const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const performanceData = require('../utils/performance-data');

const root = path.resolve(__dirname, '..');
const route = 'pages/performance/index';
const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../tests/mini-program/fixtures/int01-performance-revoke-only.json',
    ),
    'utf8',
  ),
);
const clone = (value) => structuredClone(value);
const id = (n) => '20000000-0000-4000-8000-' + String(n).padStart(12, '0');
const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
const disabled = (tag) => /\sdisabled(?:\s|>)/.test(tag || '');

function button(html, handler, target, type) {
  return (html.match(/<button\b[^>]*>/g) || []).find(
    (tag) =>
      tag.includes('data-mini-bindtap="' + handler + '"') &&
      (!target || tag.includes('data-id="' + target + '"')) &&
      (!type || tag.includes('data-type="' + type + '"')),
  );
}
async function tap(h, tag) {
  assert.ok(tag, 'The eligible record must have a rendered action');
  assert.equal(disabled(tag), false, 'The action must be enabled');
  const handler = tag.match(/data-mini-bindtap="([^"]+)"/)[1];
  const dataset = Object.fromEntries(
    [...tag.matchAll(/\sdata-(id|type)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
  await h.page[handler]({ currentTarget: { dataset } });
  await h.flush();
}
function harness({ first = 0, links = fixture.data.links, unknown = false } = {}) {
  const records = clone(links);
  if (first) records.unshift(records.splice(first, 1)[0]);
  for (const row of records) assert.equal(performanceData.link(row), true, 'Use actual link DTOs');
  const reads = [],
    writes = [];
  let fail = unknown;
  const client = {
    sessionRevision: () => 1,
    request: async (url, method = 'GET', body) => {
      const target = records.find((row) => url.includes('/' + row.id));
      assert.ok(target, 'Unexpected request: ' + url);
      if (method === 'GET') {
        assert.equal(url, '/v1/player-bookings/performance/links/' + target.id);
        reads.push(url);
        return { data: clone(target) };
      }
      assert.equal(method, 'POST');
      assert.equal(url, '/v1/player-bookings/performance/links/' + target.id + '/commands');
      writes.push({ url, method, body: clone(body) });
      if (fail) {
        fail = false;
        throw new Error('合成连接中断，结果未知');
      }
      return {
        data: {
          ...clone(target),
          status: body.type === 'REVOKE' ? 'REVOKED' : 'APPROVED',
          version: target.version + 1,
          capabilities: { canConsent: false, canRevoke: body.type !== 'REVOKE' },
        },
      };
    },
  };
  const h = loadPage({ root, route, wx: createWx() });
  h.requireLocal('utils/api.js').getClient = () => client;
  h.page.onLoad({});
  h.page._actor = id(90);
  h.page._revision = 1;
  h.page._links = records;
  h.page.load = async () => {};
  h.page.setData({ ...clone(fixture.data), links: [] });
  h.page.updateLinks();
  return { ...h, reads, writes, records };
}
async function openRevoke(h, target) {
  await tap(h, button(render(h.page), 'checkLink', target, 'REVOKE'));
  assert.equal(h.page.data.pending.type, 'REVOKE');
  assert.equal(h.page.data.pending.link.id, target);
  assert.equal(h.page.data.pending.consent, false);
  assert.equal(h.writes.length, 0, 'Opening the confirmation must not write');
  const html = render(h.page);
  assert.match(html, /拒绝原因/);
  assert.doesNotMatch(html, /data-mini-bindchange="playerConsent"/);
  assert.ok(disabled(button(html, 'submitDialog')), 'A reason is required');
}
function reason(h, value = '  当前不公开本次参赛数据  ') {
  const html = render(h.page);
  assert.match(html, /<textarea[^>]*data-mini-bindinput="dialogReason"/);
  h.page.dialogReason({ detail: { value } });
}

for (const [label, first] of [
  ['owner with unavailable upstream', 0],
  ['event organization manager', 1],
]) {
  test('default pending first card exposes revoke independently of consent for ' + label, () => {
    const h = harness({ first });
    const row = h.records[0];
    assert.equal(row.status, 'PENDING');
    assert.deepEqual(row.capabilities, { canConsent: false, canRevoke: true });
    if (first === 0) {
      assert.equal(row.profileId, h.page.data.ownProfileId);
      assert.equal(row.sourceCurrentlyAvailable, false);
    } else {
      assert.notEqual(row.profileId, h.page.data.ownProfileId);
      assert.ok(h.page.data.manageableEvents.some((event) => event.id === row.eventId));
    }
    assert.equal(h.page.data.filter, 'PENDING');
    for (const width of [320, 390, 430]) {
      const html = render(h.page, width);
      assert.equal(disabled(button(html, 'checkLink', row.id, 'REVOKE')), false);
      assert.ok(button(html, 'checkLink', row.id, 'REVOKE'));
      assert.equal(button(html, 'checkLink', row.id, 'CONSENT'), undefined);
      assert.equal((html.match(new RegExp('data-id="' + row.id + '"', 'g')) || []).length, 1);
    }
  });
  test(
    'rendered first-card rejection keeps original id/version/reason through explicit confirmation for ' +
      label,
    async () => {
      const h = harness({ first });
      const row = h.records[0];
      await openRevoke(h, row.id);
      reason(h);
      assert.equal(h.page.data.pending.consent, false, 'Rejection requires no consent checkbox');
      assert.match(render(h.page), /确认拒绝或撤销/);
      await tap(h, button(render(h.page), 'submitDialog'));
      assert.equal(h.writes.length, 1);
      assert.equal(h.reads.length, 2, 'Recheck the current record at open and confirmation');
      assert.equal(
        h.writes[0].url,
        '/v1/player-bookings/performance/links/' + row.id + '/commands',
      );
      assert.deepEqual(h.writes[0].body, {
        commandId: h.writes[0].body.commandId,
        expectedVersion: row.version,
        type: 'REVOKE',
        reason: '当前不公开本次参赛数据',
      });
      assert.match(h.writes[0].body.commandId, /^[a-f0-9-]{36}$/i);
      assert.equal(Object.hasOwn(h.writes[0].body, 'playerConsent'), false);
      assert.equal(h.page.data.pending, null);
    },
  );
}

test('leaving the first rejection confirmation cancels without a write', async () => {
  const h = harness();
  await openRevoke(h, id(1));
  reason(h);
  await tap(h, button(render(h.page), 'closeDialog'));
  assert.equal(h.page.data.pending, null);
  assert.equal(h.page._pendingCommand, null);
  assert.equal(h.writes.length, 0);
  assert.ok(button(render(h.page), 'checkLink', id(1), 'REVOKE'));
});

test('second and later pending rows retain their own independent capabilities and exact requests', async () => {
  const h = harness();
  const html = render(h.page);
  assert.ok(button(html, 'checkLink', id(2), 'REVOKE'));
  assert.equal(button(html, 'checkLink', id(2), 'CONSENT'), undefined);
  for (const type of ['CONSENT', 'REVOKE']) assert.ok(button(html, 'checkLink', id(3), type));
  await openRevoke(h, id(2));
  reason(h, '管理方停止本次公开');
  await tap(h, button(render(h.page), 'submitDialog'));
  assert.equal(h.writes[0].url, '/v1/player-bookings/performance/links/' + id(2) + '/commands');
  assert.equal(h.writes[0].body.expectedVersion, 7);
  assert.equal(h.writes[0].body.type, 'REVOKE');
});

test('ordinary owner consent remains reachable from a later row and still requires explicit consent', async () => {
  const h = harness();
  await tap(h, button(render(h.page), 'checkLink', id(3), 'CONSENT'));
  reason(h, '本人确认有限公开本场统计');
  assert.ok(disabled(button(render(h.page), 'submitDialog')));
  assert.match(render(h.page), /data-mini-bindchange="playerConsent"/);
  h.page.playerConsent({ detail: { value: ['yes'] } });
  await tap(h, button(render(h.page), 'submitDialog'));
  assert.equal(h.writes[0].url, '/v1/player-bookings/performance/links/' + id(3) + '/commands');
  assert.equal(h.writes[0].body.expectedVersion, 9);
  assert.equal(h.writes[0].body.type, 'CONSENT');
  assert.equal(h.writes[0].body.playerConsent, true);
});

test('ordinary first-card owner retains both eligible actions', () => {
  const h = harness({ first: 2 });
  for (const type of ['CONSENT', 'REVOKE']) {
    const tag = button(render(h.page), 'checkLink', id(3), type);
    assert.ok(tag);
    assert.equal(disabled(tag), false);
  }
});

test('a first record without either permission exposes neither action and cannot open a dialog', async () => {
  const links = clone(fixture.data.links);
  links[0].capabilities = { canConsent: false, canRevoke: false };
  const h = harness({ links });
  for (const type of ['CONSENT', 'REVOKE']) {
    assert.equal(button(render(h.page), 'checkLink', id(1), type), undefined);
    await h.page.checkLink({ currentTarget: { dataset: { id: id(1), type } } });
  }
  assert.equal(h.page.data.pending, null);
  assert.equal(h.reads.length, 0);
  assert.equal(h.writes.length, 0);
});

for (const field of [
  'dirty',
  'busy',
  'pageLoading',
  'sourceLoading',
  'checking',
  'nominationUnknown',
]) {
  test('first-card rejection keeps existing ' + field + ' lock', () => {
    const h = harness();
    h.page.setData({ [field]: true });
    const tag = button(render(h.page), 'checkLink', id(1), 'REVOKE');
    assert.ok(tag);
    assert.ok(disabled(tag));
    assert.equal(h.writes.length, 0);
  });
}

test('unknown rejection keeps original immutable command and locks edits/cancellation until replay', async () => {
  const h = harness({ unknown: true });
  await openRevoke(h, id(1));
  reason(h, '本人拒绝本次公开');
  await tap(h, button(render(h.page), 'submitDialog'));
  assert.equal(h.writes.length, 1);
  assert.equal(h.page.data.pendingUnknown, true);
  const original = clone(h.writes[0]);
  const html = render(h.page);
  assert.match(html, /核对原结果/);
  assert.ok(disabled(button(html, 'closeDialog')));
  assert.match(html, /<textarea[^>]*data-mini-bindinput="dialogReason"[^>]*disabled/);
  assert.equal(button(html, 'checkLink', id(2), 'REVOKE'), undefined);
  h.page.dialogReason({ detail: { value: '不应更换的原因' } });
  h.page.closeDialog();
  assert.equal(h.page.data.pending.reason, '本人拒绝本次公开');
  await tap(h, button(render(h.page), 'submitDialog'));
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes[1], original);
  assert.equal(h.page.data.pendingUnknown, false);
});

test('approved authorization revocation stays independent of consent on the existing approved tab', async () => {
  const links = clone(fixture.data.links);
  links[0].status = 'APPROVED';
  links[0].consentedAt = '2026-11-06T03:00:00Z';
  const h = harness({ links });
  await h.page.filter({ currentTarget: { dataset: { filter: 'APPROVED' } } });
  await tap(h, button(render(h.page), 'checkLink', id(1), 'REVOKE'));
  assert.match(render(h.page), /撤销原因/);
  reason(h, '本人撤销现有公开授权');
  await tap(h, button(render(h.page), 'submitDialog'));
  assert.equal(h.writes[0].body.type, 'REVOKE');
  assert.equal(Object.hasOwn(h.writes[0].body, 'playerConsent'), false);
});

test('new fixture uses complete real DTOs and its default first control is rendered at all widths', () => {
  assert.equal(fixture.route, route);
  const keys = [
    'id',
    'profileId',
    'profileName',
    'orgId',
    'eventId',
    'eventName',
    'teamId',
    'teamName',
    'memberId',
    'memberName',
    'status',
    'version',
    'nominatedByUserId',
    'consentedAt',
    'revokedAt',
    'reason',
    'sourceCurrentlyAvailable',
    'createdAt',
    'capabilities',
  ];
  for (const row of fixture.data.links) {
    assert.equal(performanceData.link(row), true);
    for (const key of keys) assert.ok(Object.hasOwn(row, key), key);
    assert.deepEqual(Object.keys(row.capabilities).sort(), ['canConsent', 'canRevoke']);
  }
  for (const width of [320, 390, 430]) {
    const html = buildPreview({ root, ...fixture, width }).phone;
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
    assert.ok(button(html, 'checkLink', id(1), 'REVOKE'));
    assert.equal(button(html, 'checkLink', id(1), 'CONSENT'), undefined);
  }
});
