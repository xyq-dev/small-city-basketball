import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { TradeService } from './trade-service.js';
import type { TradeSourceSnapshot } from './trade-source-adapter.js';
import { parseTradeSource } from './trade-domain.js';

const id = '00000000-0000-4000-8000-000000000001';
const snapshot: TradeSourceSnapshot = {
  orgId: id,
  payerId: id,
  beneficiaryId: id,
  beneficiaryName: '合成主体',
  title: '合成课次',
  version: 1,
  totalFen: 100,
  platformFeeFen: 0,
  termsId: null,
  consentId: id,
  terms: '合成已签署合同',
  merchantKey: 'synthetic',
  payable: true,
  fulfilled: false,
  disputed: false,
  valid: true,
  expiresAt: null,
  identity: { contractId: id, learnerId: id, totalFen: 100 },
};
function fixture(change: Partial<TradeSourceSnapshot> = {}, orgStatus = 'ACTIVE') {
  const read = vi.fn(async () => ({ ...snapshot, ...change }));
  const service = new TradeService(
    {} as Pool,
    { databaseUrl: 'postgres://invalid/scb_test_unit', appOrigin: 'http://localhost:3000' },
    {},
    {
      TRAINING_ENROLLMENT: {
        reference: async () => ({ orgId: id, payerId: id, beneficiaryId: id }),
        read,
        settlementMode: 'SINGLE',
        requiresProfitSharing: false,
        assertRefundAllocation: async () => {},
      },
    },
  );
  const query = vi.fn(async (sql: string) => ({
    rows: sql === 'SELECT status FROM organizations WHERE id=$1' ? [{ status: orgStatus }] : [],
    rowCount: 0,
  }));
  const internal = service as unknown as {
    source(c: PoolClient, kind: string, id: string): Promise<TradeSourceSnapshot>;
  };
  return {
    read,
    query,
    source: () => internal.source({ query } as unknown as PoolClient, 'TRAINING_ENROLLMENT', id),
  };
}
describe('new domain sources preserve source authority and contract boundaries', () => {
  it('locks the referenced calendar before reading a mutable domain source', async () => {
    const f = fixture();
    expect(await f.source()).toMatchObject({ termsId: null, consentId: id, totalFen: 100 });
    expect(f.query.mock.calls.map((x) => x[0])).toContain('SELECT x12_calendar_lock()');
    expect(f.query.mock.invocationCallOrder[2]).toBeLessThan(f.read.mock.invocationCallOrder[0]!);
  });
  it.each([
    { orgId: '00000000-0000-4000-8000-000000000002' },
    { payerId: null },
    { beneficiaryId: '00000000-0000-4000-8000-000000000002' },
    { termsId: id },
    { consentId: undefined },
    { totalFen: 0 },
    { totalFen: 1.1 },
    { platformFeeFen: 101 },
  ])('rejects an inconsistent party, foreign contract or amount (%j)', async (change) => {
    await expect(fixture(change).source()).rejects.toMatchObject({ code: 'TRADE_SOURCE_INVALID' });
  });
  it('retains the frozen contract but disables payment when the organization is inactive', async () => {
    expect(await fixture({}, 'SUSPENDED').source()).toMatchObject({
      payable: false,
      valid: false,
      identity: snapshot.identity,
    });
  });
  it('accepts exact new source kinds while refusing a client-supplied price', () => {
    for (const kind of ['TRAINING_ENROLLMENT', 'SPONSOR_ORDER']) {
      expect(parseTradeSource({ kind, sourceId: id, expectedSourceVersion: 1 }).kind).toBe(kind);
      expect(() =>
        parseTradeSource({ kind, sourceId: id, expectedSourceVersion: 1, totalFen: 1 }),
      ).toThrow();
    }
  });
});
