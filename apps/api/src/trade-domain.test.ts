import { describe, it, expect } from 'vitest';
import {
  tradeSettlementCapacity,
  tradeBalances,
  tradeFen,
  parseTradeSource,
  tradeSeal,
  tradeOpen,
} from './trade-domain.js';
describe('trade money and unknown-result boundaries', () => {
  it('pending and unknown refunds plus pending deposit deductions reserve the same paid capacity', () => {
    expect(
      tradeBalances(
        1000,
        [
          { amount_fen: 300, status: 'UNKNOWN' },
          { amount_fen: 100, status: 'PROCESSING' },
        ],
        [{ amount_fen: 200, status: 'PENDING_REVIEW' }],
        [],
      ),
    ).toMatchObject({
      refundReservedFen: 400,
      deductionReservedFen: 200,
      refundableFen: 400,
      refundedFen: 0,
    });
    expect(() =>
      tradeBalances(
        1000,
        [{ amount_fen: 900, status: 'PENDING_REVIEW' }],
        [{ amount_fen: 200, status: 'APPROVED' }],
        [],
      ),
    ).toThrow();
  });
  it('only confirmed refunds and receiver success count as actual money movement', () => {
    const b = tradeBalances(
      1000,
      [
        { amount_fen: 200, status: 'SUCCEEDED' },
        { amount_fen: 100, status: 'FAILED' },
      ],
      [],
      [
        { amount_fen: 500, status: 'UNKNOWN' },
        { amount_fen: 100, status: 'SUCCEEDED', return_amount_fen: 20 },
      ],
    );
    expect(b).toMatchObject({
      refundedFen: 200,
      refundableFen: 800,
      settledFen: 80,
      settlementReservedFen: 580,
    });
  });
  it('rejects floats, unsafe/zero amounts, client price and arbitrary merchant inputs', () => {
    for (const x of [0, 1.1, -1, 100000001, NaN, Infinity, '20'])
      expect(() => tradeFen(x)).toThrow();
    expect(() =>
      parseTradeSource({
        kind: 'ENTRY_FEE',
        sourceId: '00000000-0000-4000-8000-000000000001',
        expectedSourceVersion: 1,
        amountFen: 1,
      }),
    ).toThrow();
  });
  it('checkout ciphertext binds the attempt, key and authenticated content', () => {
    const key = Buffer.alloc(32, 7),
      value = { mode: 'NATIVE' as const, codeUrl: 'weixin://wxpay/bizpayurl?p=synthetic' };
    const cipher = tradeSeal(key, 'first', value);
    expect(tradeOpen(key, 'first', cipher)).toEqual(value);
    expect(cipher.includes(Buffer.from(value.codeUrl))).toBe(false);
    expect(() => tradeOpen(key, 'second', cipher)).toThrow();
    expect(() => tradeOpen(Buffer.alloc(32, 8), 'first', cipher)).toThrow();
    cipher[20] = (cipher[20] ?? 0) ^ 1;
    expect(() => tradeOpen(key, 'first', cipher)).toThrow();
  });
});

it('recomputes settlement capacity after deductions/reversals/refunds and excludes only its own reserved proposal', () => {
  const proposal = { id: 'split', amount_fen: 100, status: 'APPROVED' };
  const balances = { paidFen: 1000, refundReservedFen: 0, deductionApprovedFen: 100 };
  expect(tradeSettlementCapacity('ENTRY_DEPOSIT', balances, 0, [proposal], 'split')).toBe(100);
  expect(
    tradeSettlementCapacity(
      'ENTRY_DEPOSIT',
      { ...balances, deductionApprovedFen: 0 },
      0,
      [proposal],
      'split',
    ),
  ).toBe(0);
  expect(
    tradeSettlementCapacity(
      'LOCAL_BOOKING',
      { ...balances, refundReservedFen: 950 },
      100,
      [proposal],
      'split',
    ),
  ).toBe(0);
  expect(tradeSettlementCapacity('LOCAL_BOOKING', balances, 100, [proposal])).toBe(800);
  expect(
    tradeBalances(1000, [], [{ amount_fen: 100, status: 'REVERSAL_PENDING' }], []),
  ).toMatchObject({ deductionReservedFen: 100, deductionApprovedFen: 0, refundableFen: 900 });
});
