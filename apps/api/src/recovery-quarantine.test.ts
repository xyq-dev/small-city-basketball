import { describe, expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
vi.mock('../../../ops/db/common.mjs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ops/db/common.mjs')>()),
  assertOwnedRestoreTarget: vi.fn().mockResolvedValue(undefined),
  isMain: () => false,
}));
import { quarantineRestoredDatabase } from '../../../ops/recovery/quarantine.mjs';
const ownership = {
  version: 1 as const,
  databaseName: 'scb_restore_synthetic',
  databaseOid: 1,
  nonce: '11111111-1111-4111-8111-111111111111',
};
function fixture(failure: 'lock' | 'audit' | 'terminal' | null = null) {
  const sqls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    sqls.push(sql);
    if (sql.startsWith('LOCK TABLE') && failure === 'lock')
      throw new Error('synthetic private detail');
    if (sql.startsWith('INSERT INTO audit_logs') && failure === 'audit')
      throw new Error('synthetic private detail');
    if (sql.includes('clock_timestamp()::text AS now'))
      return { rows: [{ now: '2028-06-01T00:00:00Z' }], rowCount: 1 };
    if (sql.startsWith('UPDATE organizations'))
      return { rows: [{ id: ownership.nonce }], rowCount: 1 };
    if (sql.startsWith('UPDATE events SET version'))
      return { rows: [{ id: ownership.nonce, org_id: ownership.nonce, version: 2 }], rowCount: 1 };
    if (sql.startsWith('SELECT 1 FROM local_bookings'))
      return { rows: failure === 'terminal' ? [{}] : [], rowCount: failure === 'terminal' ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn(),
    pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  return { pool, sqls, release };
}
describe('offline restore quarantine command contract', () => {
  test('locks the complete reviewed schema before changing any credential and closes every new public purpose', async () => {
    const f = fixture(),
      result = await quarantineRestoredDatabase({ ...f, ownership });
    expect(result.status).toBe('quarantined');
    expect(f.release).toHaveBeenCalledOnce();
    const lock = f.sqls.find((sql) => sql.startsWith('LOCK TABLE'))!;
    for (const table of [
      'account_action_tokens',
      'account_mail_jobs',
      'recruitment_publications',
      'poster_exports',
      'public_archive_publications',
      'city_operation_grants',
      'governance_case_attachments',
      'local_bookings',
      'match_exception_receipts',
    ])
      expect(lock).toContain('"' + table + '"');
    expect(lock).toContain('IN EXCLUSIVE MODE NOWAIT');
    const updates = f.sqls.filter((sql) => sql.startsWith('UPDATE ')).join('\n');
    for (const table of [
      'account_action_tokens',
      'account_mail_jobs',
      'recruitment_publications',
      'event_invitations',
      'poster_exports',
      'public_archive_publications',
      'public_archive_profiles',
      'public_archive_sources',
      'city_operation_grants',
      'sponsorship_publications',
      'sponsorship_campaigns',
      'public_ledger_publications',
      'public_ledger_accounts',
      'governance_reviews',
      'local_listings',
      'local_slots',
      'local_bookings',
      'local_matchups',
      'local_resource_reservations',
    ])
      expect(updates).toContain('UPDATE ' + table + ' ');
    expect(updates).toContain('envelope=NULL');
    expect(updates).toContain('checkin_hash=NULL,checkin_expires_at=NULL');
    for (const table of [
      'recruitment_request_receipts',
      'scoring_offline_intents',
      'public_archive_operations',
      'governance_case_attachments',
      'match_exception_heads',
      'match_exception_requests',
      'event_template_versions',
    ])
      expect(updates).not.toContain('UPDATE ' + table + ' ');
    expect(f.sqls.at(-1)).toBe('COMMIT');
  });
  test.each(['lock', 'audit', 'terminal'] as const)(
    '%s failure rolls back and returns a fixed redacted error',
    async (failure) => {
      const f = fixture(failure);
      await expect(quarantineRestoredDatabase({ ...f, ownership })).rejects.toThrow(
        /^Restore quarantine failed$/,
      );
      expect(f.sqls.at(-1)).toBe('ROLLBACK');
      expect(f.sqls).not.toContain('COMMIT');
      expect(f.release).toHaveBeenCalledOnce();
      if (failure === 'lock')
        expect(f.sqls.some((sql) => sql.startsWith('INSERT INTO users'))).toBe(false);
    },
  );
});
