import { randomUUID } from 'node:crypto';
import { test, expect } from 'vitest';
import { buildLedgerSnapshot } from './public-ledger-domain.js';
const account = {
  title: '合成球队线下账目',
  description: '经授权的线下记账，仅用于合成测试',
  orgId: randomUUID(),
  bankAccount: 'secret bank',
};
const entry = (extra: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  occurred_on: '2028-02-29',
  label: '合成场地支出',
  kind: 'EXPENSE',
  amount_fen: -5000,
  reverses_entry_id: null,
  status: 'APPROVED',
  created_by: randomUUID(),
  private_receipt: 'secret receipt',
  ...extra,
});
test('approved public snapshot exposes only whitelisted facts and exact reversal sequence, not private IDs or attachments', () => {
  const first = entry();
  const corrected = entry({
    kind: 'REVERSAL',
    amount_fen: 5000,
    reverses_entry_id: first.id,
    label: '冲销原支出',
  });
  const income = entry({ kind: 'INCOME', amount_fen: 10000 });
  const snapshot = buildLedgerSnapshot(account, [first, corrected, income], '2028-03-01T00:00:00Z');
  expect(snapshot.approvedNetFen).toBe(10000);
  expect(snapshot.entries[1]!.reversesSeq).toBe(1);
  expect(JSON.stringify(snapshot)).not.toContain('secret');
  expect(JSON.stringify(snapshot)).not.toContain(first.id);
  expect(JSON.stringify(snapshot)).not.toContain(account.orgId);
  expect(snapshot.notice).toContain('不是支付余额');
});
test('unreviewed, duplicated or dangling correction rows cannot be published as approved facts', () => {
  const first = entry();
  expect(() =>
    buildLedgerSnapshot(account, [{ ...first, status: 'PENDING_REVIEW' }], '2028-03-01Z'),
  ).toThrow();
  expect(() => buildLedgerSnapshot(account, [first, first], '2028-03-01Z')).toThrow();
  expect(() =>
    buildLedgerSnapshot(
      account,
      [entry({ kind: 'REVERSAL', amount_fen: 5000, reverses_entry_id: randomUUID() })],
      '2028-03-01Z',
    ),
  ).toThrow();
  expect(() =>
    buildLedgerSnapshot(
      account,
      [first, entry({ kind: 'REVERSAL', amount_fen: 4999, reverses_entry_id: first.id })],
      '2028-03-01Z',
    ),
  ).toThrow();
  expect(() =>
    buildLedgerSnapshot(
      account,
      [
        first,
        entry({ kind: 'REVERSAL', amount_fen: 5000, reverses_entry_id: first.id }),
        entry({ kind: 'REVERSAL', amount_fen: 5000, reverses_entry_id: first.id }),
      ],
      '2028-03-01Z',
    ),
  ).toThrow();
});
