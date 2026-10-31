import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { TradeService } from './trade-service.js';
import { tradeHash } from './trade-domain.js';
const options = {
  databaseUrl: 'postgres://unused@127.0.0.1/unused',
  appOrigin: 'http://127.0.0.1:5173',
};
const org = '00000000-0000-4000-8000-000000000001';
function fixture(status = 'UNKNOWN', valid = true) {
  const merchant = {
    key: 'synthetic-merchant',
    merchantId: 'synthetic-mch',
    appId: 'synthetic-app',
    displayName: '合成收款方',
    payments: { enabled: true },
    receivers: {},
  };
  const service = new TradeService({} as Pool, options, {
    merchants: { [org]: merchant as any },
  }) as any;
  const identity = { id: 'source', totalFen: 1000 };
  const order = {
    id: 'order',
    order_id: 'order',
    attempt_id: 'attempt',
    org_id: org,
    kind: 'LOCAL_BOOKING',
    source_id: 'source',
    terms_id: null,
    merchant_key: merchant.key,
    merchant_id: merchant.merchantId,
    merchant_app_id: merchant.appId,
    source_hash: tradeHash(identity),
  };
  const attempt = {
    id: 'attempt',
    status,
    total_fen: 1000,
    provider_transaction_id: status === 'PAID' ? 'provider-transaction' : null,
  };
  const writes: string[] = [];
  const client = {
    query: vi.fn(async (sql: string): Promise<any> => {
      if (sql.startsWith('SELECT p.id AS attempt_id')) return { rows: [order] };
      if (sql.startsWith('SELECT * FROM trade_orders')) return { rows: [order] };
      if (sql.startsWith('SELECT * FROM trade_payment_attempts')) return { rows: [attempt] };
      if (sql.startsWith('SELECT id FROM trade_payment_attempts')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('UPDATE')) writes.push(sql);
      return { rows: [], rowCount: 0 };
    }),
  };
  service.transaction = vi.fn(async (work: any) => work(client));
  service.source = vi.fn(async () => ({ valid, disputed: false, identity }));
  service.bump = vi.fn();
  return { service, merchant, client, writes };
}
const paid = {
  outTradeNo: 'E4stable',
  transactionId: 'provider-transaction',
  state: 'SUCCESS',
  totalFen: 1000,
  currency: 'CNY',
  successTime: '2026-10-30T00:00:00Z',
};
describe('trade source and verified payment boundaries', () => {
  it('keeps actual payment even after source expiry, without reviving source inventory', async () => {
    const f = fixture('UNKNOWN', false);
    await f.service.applyPayment(org, f.merchant, paid);
    expect(f.writes.some((x) => x.includes("status='PAID'"))).toBe(true);
    expect(f.writes.some((x) => x.includes("status='SOURCE_CONFLICT'"))).toBe(true);
    expect(f.writes.every((x) => x.startsWith('UPDATE trade_'))).toBe(true);
  });
  it('never regresses PAID from delayed NOTPAY or CLOSED', async () => {
    const f = fixture('PAID');
    await f.service.applyPayment(org, f.merchant, {
      ...paid,
      state: 'NOTPAY',
      transactionId: null,
      successTime: null,
    });
    await f.service.applyPayment(org, f.merchant, {
      ...paid,
      state: 'CLOSED',
      transactionId: null,
      successTime: null,
    });
    expect(f.writes).toEqual([]);
  });
  it('rejects a provider total mismatch before any ledger write', async () => {
    const f = fixture();
    await expect(
      f.service.applyPayment(org, f.merchant, { ...paid, totalFen: 1 }),
    ).rejects.toMatchObject({ code: 'TRADE_PAYMENT_AMOUNT' });
    expect(f.writes).toEqual([]);
  });
  it('rejects a replacement merchant configuration for an old invoice', async () => {
    const f = fixture();
    await expect(
      f.service.applyPayment(org, { ...f.merchant, merchantId: 'new-mch' }, paid),
    ).rejects.toMatchObject({ code: 'TRADE_PAYMENT_IDENTITY' });
    expect(f.writes).toEqual([]);
  });
  it('does not touch fee tables or change legacy free sources with funds execution disabled', async () => {
    const service = new TradeService({} as Pool, options);
    const query = vi.fn();
    expect(
      await service.captureSourceCharge({ query } as any, {} as any, {
        kind: 'LOCAL_BOOKING',
        sourceId: org,
        chargeConsent: false,
      }),
    ).toBeNull();
    await service.assertSourceFinancialGate({ query } as any, 'LOCAL_BOOKING', org);
    expect(query).not.toHaveBeenCalled();
  });
  it('requires globally unambiguous merchant identity for callback and reconciliation scope', () => {
    const f = fixture();
    expect(
      () =>
        new TradeService({} as Pool, options, {
          merchants: { [org]: f.merchant as any, other: f.merchant as any },
        }),
    ).toThrow('exactly one organization');
  });
  it('applies a new signed event and inserts receipt in the same transaction, rejects event-id mutation', async () => {
    const f = fixture();
    const event = { id: 'synthetic-event', kind: 'PAYMENT', payment: paid };
    (f.merchant.payments as any).verifyNotification = () => event;
    f.service.applyPayment = vi.fn(async (...args: any[]) => {
      expect(args[3]).toBe(f.client);
    });
    await f.service.notification(f.merchant.key, Buffer.from('{}'), {});
    expect(f.service.transaction).toHaveBeenCalledTimes(1);
    expect(f.service.applyPayment).toHaveBeenCalledTimes(1);
    expect(
      f.client.query.mock.calls.some(([sql]: any[]) =>
        sql.startsWith('INSERT INTO trade_provider_events'),
      ),
    ).toBe(true);
    f.client.query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith('SELECT event_hash') ? [{ event_hash: 'different' }] : [],
      rowCount: 0,
    }));
    await expect(
      f.service.notification(f.merchant.key, Buffer.from('{}'), {}),
    ).rejects.toMatchObject({ code: 'TRADE_NOTIFICATION_CONFLICT' });
    expect(f.service.applyPayment).toHaveBeenCalledTimes(1);
  });
});
