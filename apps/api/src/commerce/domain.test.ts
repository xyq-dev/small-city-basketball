import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  checkPayment,
  decimalFen,
  digest,
  makeQuote,
  parseBuyerCommand,
  parseManualBill,
  parsePlan,
  parsePlatformCommand,
  reference,
} from './domain.js';
const id = randomUUID();
const plan = {
  commandId: randomUUID(),
  code: 'event-basic',
  name: '合成按届软件',
  currency: 'CNY',
  amountFen: 9900,
  maxTeams: 32,
  maxMatches: 496,
  validDays: 365,
  reason: '合成套餐版本发布',
};
describe('commercial quotes and strict fixed-point commands', () => {
  test('requires bounded integer CNY amounts and rejects caller supplied entitlement or status', () => {
    expect(parsePlan(plan)).toEqual(plan);
    for (const override of [
      { amountFen: 0 },
      { amountFen: 1.5 },
      { amountFen: 100_000_001 },
      { currency: 'USD' },
      { maxTeams: 33 },
      { maxMatches: 0 },
      { validDays: 0 },
      { operator: true },
      { status: 'PAID' },
    ])
      expect(() => parsePlan({ ...plan, ...override })).toThrow();
  });
  test('rebuilds immutable quotes independently of later catalog mutation', () => {
    const row = {
      id,
      code: 'event-basic',
      version: 1,
      name: '合成',
      amount_fen: 100,
      max_teams: 2,
      max_matches: 1,
      valid_days: 3,
    };
    const quote = makeQuote(row);
    row.amount_fen = 10000;
    expect(quote.amountFen).toBe(100);
    const { hash, ...terms } = quote;
    expect(hash).toBe(digest(terms));
  });
  test('requires exact commands, CAS and explicit refund/cancel reason', () => {
    expect(
      parseBuyerCommand({ commandId: id, type: 'CREATE_NATIVE', expectedOrderVersion: 2 }),
    ).toMatchObject({ type: 'CREATE_NATIVE' });
    for (const body of [
      { commandId: id, type: 'REQUEST_REFUND', expectedOrderVersion: 2 },
      { commandId: id, type: 'CANCEL', expectedOrderVersion: 0, reason: '合成取消原因' },
      { commandId: id, type: 'GRANT', expectedOrderVersion: 2 },
      {
        commandId: id,
        type: 'CONFIRM_PAYMENT',
        expectedOrderVersion: 2,
        reason: '合成核验',
        amountFen: 1,
      },
    ])
      expect(() =>
        body.type === 'CONFIRM_PAYMENT' ? parsePlatformCommand(body) : parseBuyerCommand(body),
      ).toThrow();
  });
  test('matches original total/currency/trade identity and paid time; never accepts payer discount as quoted total', () => {
    const o = {
      out_trade_no: 'a'.repeat(32),
      amount_fen: 10000,
      expires_at: '2026-10-24T12:00:00Z',
    };
    const proof = {
      outTradeNo: o.out_trade_no,
      totalFen: 10000,
      currency: 'CNY',
      transactionId: 'wx-transaction',
      state: 'SUCCESS',
      successTime: '2026-10-24T11:00:00Z',
    };
    expect(() => checkPayment(o, proof)).not.toThrow();
    for (const delta of [
      { totalFen: 9000 },
      { currency: 'USD' },
      { outTradeNo: 'b'.repeat(32) },
      { transactionId: null },
      { successTime: '2026-10-24T13:00:00Z' },
    ])
      expect(() => checkPayment(o, { ...proof, ...delta })).toThrow();
  });
  test('parses decimal yuan exactly and never rounds malformed or excessive precision', () => {
    expect(decimalFen('0.01')).toBe(1);
    expect(decimalFen('123.45')).toBe(12345);
    for (const v of ['-1', 'NaN', '1e3', '1.001', ' 1', '01.00', '1000000.01'])
      expect(() => decimalFen(v)).toThrow();
  });
  test('accepts only single-line CSV-representable immutable transaction references', () => {
    expect(reference('bank-payment-123')).toBe('bank-payment-123');
    for (const value of [
      'bank,payment',
      'bank\npayment',
      'bank\rpayment',
      'bank\tpayment',
      'bank\u007fpayment',
    ])
      expect(() => reference(value)).toThrow();
  });
  test('supports separate same-day payment/refund rows, empty bills and rejects duplicates and oversize UTF8', () => {
    const head = 'order_id,transaction_reference,amount,currency,status';
    expect(parseManualBill(head)).toEqual([]);
    const a = `${id},bank-payment,1.00,CNY,PAID`;
    const b = `${id},bank-refund,1.00,CNY,REFUNDED`;
    expect(parseManualBill(`${head}\n${a}\n${b}`)).toHaveLength(2);
    expect(() => parseManualBill(`${head}\n${a}\n${a}`)).toThrow();
    expect(() => parseManualBill('中'.repeat(22000))).toThrow();
  });
});
