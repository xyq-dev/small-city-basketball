import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { digest, makeQuote } from './domain.js';
import { membershipLockKey } from './membership-store.js';
import {
  membershipLimits,
  parseMembershipOrder,
  parseMembershipPlan,
  makeMembershipQuote,
  membershipPeriodState,
  membershipPaymentIsTimely,
} from './membership-domain.js';
const input = {
  commandId: randomUUID(),
  code: 'scb_pro_year',
  name: '合成机构年费',
  currency: 'CNY',
  amountFen: 169900,
  tier: 'PRO',
  durationDays: 365,
  reason: '合成隔离会员价格发布',
};
describe('organization software membership immutable terms and read states', () => {
  test('allows Native second-precision settlement in the creation second, but not a previous second or manual backdating', () => {
    const v = {
      createdAt: new Date('2026-11-10T08:00:00.500Z'),
      expiresAt: new Date('2026-11-10T08:01:00Z'),
      now: new Date('2026-11-10T08:00:01Z'),
      paidAt: '2026-11-10T08:00:00Z',
      channel: 'WECHAT_NATIVE' as const,
    };
    expect(membershipPaymentIsTimely(v)).toBe(true);
    expect(membershipPaymentIsTimely({ ...v, paidAt: '2026-11-10T07:59:59Z' })).toBe(false);
    expect(membershipPaymentIsTimely({ ...v, channel: 'MANUAL' })).toBe(false);
    expect(membershipPaymentIsTimely({ ...v, paidAt: '2026-11-10T08:00:02Z' })).toBe(false);
  });
  test('a manual approval crossing authoritative expiry fails closed, while an on-time Native proof may arrive later', () => {
    const v = {
      createdAt: new Date('2026-11-10T08:00:00Z'),
      expiresAt: new Date('2026-11-10T08:01:00Z'),
      now: new Date('2026-11-10T08:01:00Z'),
      paidAt: '2026-11-10T08:00:59Z',
      channel: 'MANUAL' as const,
    };
    expect(membershipPaymentIsTimely(v)).toBe(false);
    expect(membershipPaymentIsTimely({ ...v, channel: 'WECHAT_NATIVE' })).toBe(true);
    expect(
      membershipPaymentIsTimely({
        ...v,
        channel: 'WECHAT_NATIVE',
        paidAt: '2026-11-10T08:01:01Z',
        now: new Date('2026-11-10T08:01:02Z'),
      }),
    ).toBe(false);
    expect(membershipPaymentIsTimely({ ...v, expiresAt: new Date(NaN) })).toBe(false);
  });

  test('the same organization uses one mutex for uppercase routes and canonical database UUIDs', () => {
    const id = randomUUID();
    expect(membershipLockKey(id.toUpperCase())).toBe(membershipLockKey(id));
    expect(membershipLockKey(id)).not.toBe(membershipLockKey(randomUUID()));
  });
  test.each([
    ['PRO', 30, 3, 16, 128],
    ['PRO', 365, 36, 16, 128],
    ['BUSINESS', 30, 10, 32, 512],
    ['BUSINESS', 365, 120, 32, 512],
  ] as const)(
    'derives fixed quota for %s/%i without accepting a caller quota',
    (tier, days, eventLimit, maxTeams, maxMatches) => {
      expect(membershipLimits(tier, days)).toEqual({ eventLimit, maxTeams, maxMatches });
    },
  );
  test('permits a real quoted synthetic 1-CNY acceptance plan without hardcoding a sale or grant', () => {
    expect(parseMembershipPlan({ ...input, amountFen: 100 })).toEqual({ ...input, amountFen: 100 });
  });
  test.each([
    { amountFen: 0 },
    { amountFen: 1.5 },
    { amountFen: 100_000_001 },
    { currency: 'USD' },
    { tier: 'ADMIN' },
    { durationDays: 31 },
    { durationDays: '365' },
    { eventLimit: 9999 },
    { maxTeams: 32 },
    { status: 'PAID' },
    { autoRenew: true },
    { orgId: randomUUID() },
  ])('rejects unquoted membership terms and privilege fields %j', (delta) => {
    expect(() => parseMembershipPlan({ ...input, ...delta })).toThrow();
  });
  test('checkout accepts only exact plan and stable read token, not client money or period status', () => {
    const body = {
      commandId: randomUUID(),
      planId: randomUUID(),
      expectedMembershipVersion: 'a'.repeat(64),
    };
    expect(parseMembershipOrder(body)).toEqual(body);
    for (const delta of [
      { expectedMembershipVersion: 'a' },
      { expectedMembershipVersion: 'A'.repeat(64) },
      { amountFen: 1 },
      { previousPeriodId: randomUUID() },
      { startsAt: '2026-11-10' },
      { role: 'ORG_OWNER' },
    ])
      expect(() => parseMembershipOrder({ ...body, ...delta })).toThrow();
  });
  test('adds member-only immutable quote terms while preserving old EVENT shape and hash', () => {
    const row = {
      id: randomUUID(),
      code: 'member',
      version: 1,
      name: '合成会员',
      amount_fen: 169900,
      max_teams: 16,
      max_matches: 128,
      valid_days: 365,
      target_kind: 'ORG_MEMBERSHIP',
      membership_tier: 'PRO',
      membership_events: 36,
    };
    const old = makeQuote(row);
    expect(Object.keys(old)).toEqual([
      'planId',
      'code',
      'version',
      'name',
      'currency',
      'amountFen',
      'maxTeams',
      'maxMatches',
      'validDays',
      'hash',
    ]);
    const previous = randomUUID();
    const quote = makeMembershipQuote(row, previous);
    const { hash, ...terms } = quote;
    expect(hash).toBe(digest(terms));
    expect(quote).toMatchObject({
      scope: 'ORG_MEMBERSHIP',
      tier: 'PRO',
      durationDays: 365,
      eventLimit: 36,
      previousPeriodId: previous,
    });
    expect(hash).not.toBe(old.hash);
    row.amount_fen = 1;
    expect(quote.amountFen).toBe(169900);
  });
  const now = new Date('2026-11-10T08:00:00Z');
  const state = {
    revokedAt: null,
    orderStatus: 'PAID',
    startsAt: now,
    endsAt: new Date(now.getTime() + 30 * 86400000),
    now,
    usedEvents: 0,
    eventLimit: 3,
  };
  test('uses exact half-open start/end and supplied DB clock, including exhausted future periods', () => {
    expect(membershipPeriodState(state)).toBe('ACTIVE');
    expect(membershipPeriodState({ ...state, now: new Date(now.getTime() - 1) })).toBe('SCHEDULED');
    expect(membershipPeriodState({ ...state, now: state.endsAt })).toBe('EXPIRED');
    expect(membershipPeriodState({ ...state, usedEvents: 3 })).toBe('EXHAUSTED');
    expect(membershipPeriodState({ ...state, usedEvents: 3, now: state.endsAt })).toBe('EXPIRED');
  });
  test('keeps revocation/refund separate from time and fails closed for unknown payment and invalid quota', () => {
    expect(membershipPeriodState({ ...state, revokedAt: now, orderStatus: 'REFUNDED' })).toBe(
      'REVOKED',
    );
    expect(
      membershipPeriodState({ ...state, orderStatus: 'REFUND_PENDING', now: state.endsAt }),
    ).toBe('REFUND_PENDING');
    for (const delta of [
      { orderStatus: 'REFUNDED' },
      { orderStatus: 'UNKNOWN' },
      { startsAt: state.endsAt },
      { usedEvents: 4 },
      { usedEvents: 0.5 },
      { eventLimit: 0 },
      { now: new Date(NaN) },
    ])
      expect(membershipPeriodState({ ...state, ...delta })).toBe('UNAVAILABLE');
  });
});
