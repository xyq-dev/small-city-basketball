import { describe, expect, test, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { Actor } from './service.js';
import type { DispatchSourceInput } from './dispatch-service.js';
import { createDispatchSourceHook } from './dispatch-source-adapter.js';

const actor = { user: { id: 'buyer' } } as Actor;
const input = {
  verifiedDispatchQuote: { offerId: 'offer', quoteHash: 'frozen-hash' },
} as DispatchSourceInput;
const result = { resourceId: 'canonical-booking', version: 1 };
function harness(total = 1300, order: Record<string, unknown> | null = null) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [{ quote_hash: 'frozen-hash', quote: { totalMinor: total, merchantKey: 'merchant' } }],
    })
    .mockResolvedValueOnce({ rows: order ? [order] : [] });
  const c = { query } as unknown as PoolClient;
  const local = { createDispatchBookingInTransaction: vi.fn().mockResolvedValue(result) };
  return { query, c, local, hook: createDispatchSourceHook(local) };
}
const valid = { total_fen: 1300, merchant_key: 'merchant', payer_user_id: 'buyer' };

describe('paid dispatch canonical transaction boundary', () => {
  test('paid source requires a real order for that exact booking', async () => {
    const h = harness();
    await expect(h.hook(h.c, actor, input)).rejects.toMatchObject({
      code: 'DISPATCH_TRADE_UNAVAILABLE',
      status: 503,
    });
    expect(h.local.createDispatchBookingInTransaction).toHaveBeenCalledWith(h.c, actor, input);
    expect(h.query).toHaveBeenLastCalledWith(
      expect.stringContaining("kind='LOCAL_BOOKING' AND source_id=$1 FOR SHARE"),
      [result.resourceId],
    );
  });
  test('full amount, merchant and buyer preserve the canonical result', async () => {
    const h = harness(1300, valid);
    await expect(h.hook(h.c, actor, input)).resolves.toBe(result);
  });
  test.each([
    { ...valid, total_fen: 1000 },
    { ...valid, merchant_key: 'other-merchant' },
    { ...valid, payer_user_id: 'other-buyer' },
  ])('rejects a mismatching canonical financial fact: %j', async (order) => {
    const h = harness(1300, order);
    await expect(h.hook(h.c, actor, input)).rejects.toMatchObject({
      code: 'DISPATCH_TRADE_UNAVAILABLE',
    });
  });
  test('a free frozen quote does not require a trade order', async () => {
    const h = harness(0);
    await expect(h.hook(h.c, actor, input)).resolves.toBe(result);
    expect(h.query).toHaveBeenCalledTimes(1);
  });
  test.each([{ rows: [] }, { rows: [{ quote_hash: 'changed', quote: { totalMinor: 1300 } }] }])(
    'rejects missing or changed quote identity',
    async ({ rows }) => {
      const h = harness();
      h.query.mockReset().mockResolvedValue({ rows });
      await expect(h.hook(h.c, actor, input)).rejects.toMatchObject({
        code: 'DISPATCH_QUOTE_CHANGED',
      });
      expect(h.query).toHaveBeenCalledTimes(1);
    },
  );
  test('source failure propagates without a second query or fallback', async () => {
    const h = harness();
    const failure = new Error('source transaction failed');
    h.local.createDispatchBookingInTransaction.mockRejectedValue(failure);
    await expect(h.hook(h.c, actor, input)).rejects.toBe(failure);
    expect(h.query).not.toHaveBeenCalled();
  });
});
