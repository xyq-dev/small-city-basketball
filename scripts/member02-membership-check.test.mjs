import assert from 'node:assert/strict';
import { test } from 'node:test';
import { membershipFacts } from './member02-membership-check.mjs';

const sample = () => ({
  orgId: 'org-a',
  serverTime: '2026-11-10T00:00:00Z',
  membershipVersion: 'immutable-facts-token',
  plans: [{ id: 'plan', amountFen: 100, version: 1 }],
  orders: [
    { id: 'order', status: 'PAID', quote: { amountFen: 100 }, capabilities: { canCancel: false } },
  ],
  periods: [
    {
      id: 'period',
      orderId: 'order',
      startsAt: '2026-11-10T00:00:00Z',
      endsAt: '2027-11-10T00:00:00Z',
      usedEvents: 1,
      remainingEvents: 35,
      state: 'ACTIVE',
    },
  ],
  allocations: [{ eventId: 'event', periodId: 'period', source: 'MEMBERSHIP' }],
});
test('membership recovery ignores only the read clock and per-order capabilities, without mutating input', () => {
  const before = sample();
  const after = structuredClone(before);
  after.serverTime = '2026-11-10T00:05:00Z';
  after.orders[0].capabilities.canCancel = true;
  assert.deepEqual(membershipFacts(after), membershipFacts(before));
  assert.equal(before.serverTime, '2026-11-10T00:00:00Z');
  assert.equal(before.orders[0].capabilities.canCancel, false);
});
test('membership recovery detects altered payment, period, consumed quota and original event allocation', () => {
  const original = sample();
  const changes = [
    (v) => {
      v.plans[0].amountFen = 999;
    },
    (v) => {
      v.orders[0].quote.amountFen = 999;
    },
    (v) => {
      v.orders[0].status = 'REFUNDED';
    },
    (v) => {
      v.periods[0].endsAt = '2028-11-10T00:00:00Z';
    },
    (v) => {
      v.periods[0].usedEvents = 0;
    },
    (v) => {
      v.periods[0].remainingEvents = 36;
    },
    (v) => {
      v.periods[0].state = 'REVOKED';
    },
    (v) => {
      v.allocations[0].periodId = 'other-period';
    },
    (v) => {
      v.allocations[0].eventId = 'other-event';
    },
    (v) => {
      v.orgId = 'other-org';
    },
  ];
  for (const change of changes) {
    const altered = sample();
    change(altered);
    altered.serverTime = '2026-11-10T00:05:00Z';
    assert.notDeepEqual(membershipFacts(altered), membershipFacts(original));
  }
});
