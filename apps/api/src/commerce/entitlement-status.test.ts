import { describe, expect, test } from 'vitest';
import { entitlementActivationStatus } from './entitlement-status.js';

const checkedAt = '2026-11-10T08:00:00.000Z';
const input = {
  revokedAt: null,
  activated: false,
  orderStatus: 'PAID',
  validUntil: '2026-11-10T08:00:00.001Z',
  statusCheckedAt: checkedAt,
};

describe('database-clock event entitlement display projection', () => {
  test('keeps the final millisecond before the activation deadline ready', () => {
    expect(entitlementActivationStatus(input)).toBe('READY');
  });

  test.each(['2026-11-10T08:00:00.000Z', '2026-11-10T07:59:59.999Z'])(
    'expires at or after the deadline %s without a grace millisecond',
    (validUntil) => {
      expect(entitlementActivationStatus({ ...input, validUntil })).toBe('EXPIRED');
    },
  );

  test('compares database Date objects and timezone offsets as the same instant', () => {
    expect(
      entitlementActivationStatus({
        ...input,
        validUntil: new Date('2026-11-10T16:00:00.001+08:00'),
        statusCheckedAt: new Date(checkedAt),
      }),
    ).toBe('READY');
    expect(entitlementActivationStatus({ ...input, validUntil: '2026-11-10T16:00:00+08:00' })).toBe(
      'EXPIRED',
    );
  });

  test('uses only the supplied database check time rather than an ambient process clock', () => {
    const futureDeadline = { ...input, validUntil: '2040-01-01T00:00:00Z' };
    expect(
      entitlementActivationStatus({
        ...futureDeadline,
        statusCheckedAt: '2039-12-31T23:59:59Z',
      }),
    ).toBe('READY');
    expect(
      entitlementActivationStatus({
        ...futureDeadline,
        statusCheckedAt: '2040-01-01T00:00:01Z',
      }),
    ).toBe('EXPIRED');
  });

  test('an activated event continues after its deadline and is not turned into a new purchase', () => {
    expect(
      entitlementActivationStatus({
        ...input,
        activated: true,
        validUntil: '2020-01-01T00:00:00Z',
      }),
    ).toBe('ACTIVATED');
  });

  test('revocation wins over activation, refunds and expiry', () => {
    expect(
      entitlementActivationStatus({
        ...input,
        revokedAt: checkedAt,
        activated: true,
        orderStatus: 'REFUNDED',
        validUntil: '2020-01-01T00:00:00Z',
      }),
    ).toBe('REVOKED');
  });

  test('an unactivated refund keeps its own pending state even after the deadline', () => {
    expect(
      entitlementActivationStatus({
        ...input,
        orderStatus: 'REFUND_PENDING',
        validUntil: '2020-01-01T00:00:00Z',
      }),
    ).toBe('REFUND_PENDING');
  });

  test.each(['PENDING_PAYMENT', 'REFUNDED', 'CANCELLED', 'EXPIRED', 'UNKNOWN', null, undefined])(
    'does not label non-paid or unknown order state %s ready',
    (orderStatus) => {
      expect(entitlementActivationStatus({ ...input, orderStatus })).toBe('UNAVAILABLE');
    },
  );

  test.each([
    { statusCheckedAt: undefined },
    { statusCheckedAt: new Date(Number.NaN) },
    { statusCheckedAt: 'not-a-time' },
    { statusCheckedAt: '2026-11-10' },
    { statusCheckedAt: 1794297600000 },
    { validUntil: null },
    { validUntil: '2026-11-10T99:00:00Z' },
    { validUntil: '2026-02-30T08:00:00Z' },
    { validUntil: '0' },
    { validUntil: new Date(Number.NaN) },
    { activated: 'true' },
    { revokedAt: undefined },
    { revokedAt: 'invalid' },
  ])('fails closed for incomplete or invalid projection facts %o', (delta) => {
    expect(entitlementActivationStatus({ ...input, ...delta })).toBe('UNAVAILABLE');
  });
});
