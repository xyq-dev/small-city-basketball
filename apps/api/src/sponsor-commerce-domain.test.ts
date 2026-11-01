import { describe, expect, test } from 'vitest';
import {
  allocateSponsorPool,
  allocateSponsorRefund,
  sponsorHash,
  sponsorInt,
  sponsorShareInput,
} from './sponsor-commerce-domain.js';
import type { SponsorShare } from '../../../packages/contracts/sponsor-commerce.js';
const shares: SponsorShare[] = [7000, 1500, 1000, 500].map((basisPoints, i) => ({
  id: String(i),
  beneficiaryOrgId: String(i),
  merchantId: `m${i}`,
  displayName: `Synthetic ${i}`,
  basisPoints,
  retained: i === 0,
  authorizationVersion: 'test-v1',
}));
describe('sponsor monetary conservation', () => {
  test('published allocation and partial-refund examples', () => {
    const split = allocateSponsorPool(10003, shares);
    expect(split.map((x) => x.amountFen)).toEqual([7002, 1501, 1000, 500]);
    expect(allocateSponsorRefund(1001, split).map((x) => x.refundFen)).toEqual([701, 150, 100, 50]);
  });
  test('every cumulative refund prefix is monotonic and finishes at original allocations', () => {
    for (const amounts of [
      [1, 1, 1],
      [17, 11, 4],
      [21, 9, 3],
      [0, 3, 2],
    ]) {
      const rows = amounts.map((amountFen, i) => ({ id: String(i), amountFen }));
      let prior = amounts.map(() => 0);
      for (let n = 0; n <= amounts.reduce((a, b) => a + b, 0); n++) {
        const result = allocateSponsorRefund(n, rows).map((x) => x.refundFen);
        expect(result.reduce((a, b) => a + b, 0)).toBe(n);
        expect(result.every((v, i) => v >= prior[i]! && v <= amounts[i]!)).toBe(true);
        prior = result;
      }
      expect(prior).toEqual(amounts);
    }
  });
  test('large refund uses exact arithmetic and deterministic ties', () => {
    const rows = [
      { id: 'a', amountFen: 30_000_001 },
      { id: 'b', amountFen: 20_000_003 },
    ];
    const result = allocateSponsorRefund(40_000_000, rows);
    expect(result.reduce((n, x) => n + x.refundFen, 0)).toBe(40_000_000);
    expect(
      allocateSponsorRefund(1, [
        { id: 'b', amountFen: 1 },
        { id: 'a', amountFen: 1 },
      ]).map((x) => x.refundFen),
    ).toEqual([0, 1]);
  });
  test('rejects noninteger, negative, excessive or invalid shares', () => {
    for (const v of [-1, 1.2, NaN, Infinity, '100']) expect(() => sponsorInt(v)).toThrow();
    expect(() => allocateSponsorRefund(4, [{ id: 'a', amountFen: 3 }])).toThrow();
    expect(() => allocateSponsorPool(10, [shares[0]!])).toThrow();
    expect(() => sponsorShareInput([{ beneficiaryOrgId: 'bad', basisPoints: 10000 }])).toThrow();
  });
  test('hash binds deep content independent of key insertion order', () => {
    expect(sponsorHash({ b: 2, a: { d: 3, c: 4 } })).toBe(sponsorHash({ a: { c: 4, d: 3 }, b: 2 }));
    expect(sponsorHash({ amount: 1 })).not.toBe(sponsorHash({ amount: 2 }));
  });
});
