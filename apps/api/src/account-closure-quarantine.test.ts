import { describe, expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
vi.mock('../../../ops/db/common.mjs', async (original) => ({
  ...(await original<typeof import('../../../ops/db/common.mjs')>()),
  assertOwnedRestoreTarget: vi.fn().mockResolvedValue(undefined),
  isMain: () => false,
}));
import { quarantineRestoredDatabase } from '../../../ops/recovery/quarantine.mjs';
const ownership = {
  version: 1 as const,
  databaseName: 'scb_restore_e07_synthetic',
  databaseOid: 1,
  nonce: '11111111-1111-4111-8111-111111111111',
};
function fixture(failMarker = false) {
  const statements: { sql: string; values?: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    statements.push({ sql, values });
    if (sql.includes('clock_timestamp()::text AS now'))
      return { rows: [{ now: '2028-06-01T00:00:00Z' }], rowCount: 1 };
    if (failMarker && sql.includes("'RESTORE_QUARANTINE','restore'"))
      throw new Error('private error');
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  return {
    statements,
    release,
    pool: { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool,
  };
}
describe('E07 expanded quarantine preserves uncertain external outcomes', () => {
  test('locks new workers before writes, fences dispatch and preserves physical stop and financial claims', async () => {
    const f = fixture();
    await quarantineRestoredDatabase({ ...f, ownership });
    const sql = f.statements.map((x) => x.sql);
    const lock = sql.find((x) => x.startsWith('LOCK TABLE'))!;
    for (const table of [
      'broadcast_sessions',
      'stream_jobs',
      'insurance_operations',
      'trade_payment_attempts',
      'notification_delivery_attempts',
      'account_closure_requests',
      'youth_guardian_requests',
    ])
      expect(lock).toContain('"' + table + '"');
    const relay = sql.find((x) => x.startsWith('UPDATE live_relays'))!;
    expect(relay).not.toMatch(/slot_held\s*=\s*false/);
    expect(sql.find((x) => x.startsWith('UPDATE broadcast_sessions'))).not.toMatch(
      /source_stopped\s*=\s*true/,
    );
    expect(sql.find((x) => x.startsWith('UPDATE insurance_operations'))).toContain(
      "next_attempt_at='infinity'",
    );
    for (const table of [
      'trade_payment_attempts',
      'trade_refunds',
      'trade_settlements',
      'trade_settlement_returns',
    ]) {
      const update = sql.find((x) => x.startsWith('UPDATE ' + table + ' '))!;
      expect(update).toContain('UNKNOWN');
      expect(update).not.toMatch(/(?:amount_fen|total_fen|return_amount_fen)\s*=/);
      expect(update).not.toMatch(/status\s*=\s*'(?:SUCCEEDED|FAILED|PAID|RETURNED)'/);
    }
    const insurance = sql.find((x) => x.startsWith('UPDATE insurance_orders'))!;
    expect(insurance).toContain('authorization_valid=false');
    expect(insurance).not.toMatch(/(?:payment_status|policy_status|refunded_fen)\s*=/);
    const notification = sql.find((x) => x.startsWith('UPDATE notification_deliveries'))!;
    expect(notification).toContain("WHEN state='SENDING' THEN 'UNKNOWN'");
    expect(notification).not.toContain("'ACCEPTED'");
    expect(sql.find((x) => x.startsWith('UPDATE account_closure_requests'))).toContain(
      "status='EXPIRED_AUTH'",
    );
    expect(
      sql.some((x) =>
        /DELETE FROM (?:insurance|trade|broadcast|stream_jobs|account_closure|youth|notification)/.test(
          x,
        ),
      ),
    ).toBe(false);
    expect(sql.some((x) => x.includes("'RESTORE_QUARANTINE','restore'"))).toBe(true);
    expect(sql.at(-1)).toBe('COMMIT');
  });
  test('a marker write failure rolls all prior state and fences back with a fixed error', async () => {
    const f = fixture(true);
    await expect(quarantineRestoredDatabase({ ...f, ownership })).rejects.toThrow(
      /^Restore quarantine failed$/,
    );
    expect(f.statements.at(-1)?.sql).toBe('ROLLBACK');
    expect(f.statements.some((x) => x.sql === 'COMMIT')).toBe(false);
    expect(f.release).toHaveBeenCalledOnce();
  });
});
