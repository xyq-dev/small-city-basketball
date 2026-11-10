import assert from 'node:assert/strict';
import { test } from 'node:test';
import { facts } from './c05-commerce-check.mjs';

const snapshot = () => ({
  plans: [{ id: 'plan', amountFen: 9900, version: 1 }],
  orders: [
    {
      id: 'order',
      quote: { amountFen: 9900, hash: 'quote' },
      status: 'PAID',
      version: 3,
      capabilities: { canCancel: false },
    },
  ],
  entitlements: [
    {
      id: 'entitlement',
      orderId: 'order',
      maxTeams: 8,
      maxMatches: 32,
      validUntil: '2028-01-01T00:00:00Z',
      activated: true,
      revokedAt: null,
      activationStatus: 'ACTIVATED',
      statusCheckedAt: '2026-11-10T00:00:00Z',
    },
  ],
  activations: [
    { eventId: 'event', entitlementId: 'entitlement', activatedAt: '2026-11-10T00:00:00Z' },
  ],
  reconciliations: [{ id: 'reconciliation', issues: [] }],
});

test('a later database read time alone does not masquerade as damaged restored billing history', () => {
  const before = snapshot();
  const after = structuredClone(before);
  after.entitlements[0].statusCheckedAt = '2026-11-10T00:05:00Z';
  assert.deepEqual(facts(after), facts(before));
  assert.equal(before.entitlements[0].statusCheckedAt, '2026-11-10T00:00:00Z');
  assert.equal(after.entitlements[0].statusCheckedAt, '2026-11-10T00:05:00Z');
});

test('the recovery projection still detects changed price, quote, source, quota, status, activation and refund facts', () => {
  const original = snapshot();
  const mutations = [
    (v) => {
      v.plans[0].amountFen = 1;
    },
    (v) => {
      v.orders[0].quote.hash = 'changed';
    },
    (v) => {
      v.orders[0].status = 'REFUNDED';
    },
    (v) => {
      v.orders[0].version += 1;
    },
    (v) => {
      v.entitlements[0].orderId = 'other-order';
    },
    (v) => {
      v.entitlements[0].maxTeams = 32;
    },
    (v) => {
      v.entitlements[0].validUntil = '2029-01-01T00:00:00Z';
    },
    (v) => {
      v.entitlements[0].activationStatus = 'REVOKED';
    },
    (v) => {
      v.entitlements[0].revokedAt = '2026-11-10T00:01:00Z';
    },
    (v) => {
      v.entitlements[0].activated = false;
    },
    (v) => {
      v.activations[0].entitlementId = 'other-source';
    },
    (v) => {
      v.reconciliations[0].issues.push({ code: 'MISMATCH' });
    },
  ];
  for (const mutate of mutations) {
    const changed = snapshot();
    mutate(changed);
    changed.entitlements[0].statusCheckedAt = '2026-11-10T00:05:00Z';
    assert.notDeepEqual(facts(changed), facts(original));
  }
});

test('old snapshots without the optional read time preserve all their own commercial fields', () => {
  const old = snapshot();
  delete old.entitlements[0].statusCheckedAt;
  const projected = facts(old);
  assert.deepEqual(projected.entitlements, old.entitlements);
  assert.equal(projected.entitlements[0].activationStatus, 'ACTIVATED');
});
