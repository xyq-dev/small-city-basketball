import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  cleanupParticipantMaterials,
  participantCleanupOptions,
  purgeParticipantMaterials,
} from '../../../ops/db/participant-material-cleanup.mjs';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const options = { orgId: id(1), actorId: id(2), limit: 1 };
function harness(
  mode:
    | 'normal'
    | 'wrong-role'
    | 'no-admin'
    | 'stale'
    | 'held'
    | 'audit-failure'
    | 'fence-failure' = 'normal',
) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.startsWith('SELECT current_user'))
      return {
        rows: [
          { name: mode === 'wrong-role' ? 'scb_migrator' : 'scb_runtime', session: 'scb_runtime' },
        ],
        rowCount: 1,
      };
    if (sql.startsWith('SELECT id FROM users') || sql.startsWith('SELECT id FROM organizations'))
      return { rows: [{ id: id(1) }], rowCount: 1 };
    if (sql.includes('FROM organization_memberships'))
      return {
        rows: mode === 'no-admin' ? [] : [{ user_id: id(2) }],
        rowCount: mode === 'no-admin' ? 0 : 1,
      };
    if (sql.includes('SELECT e.id FROM events e'))
      return { rows: [{ id: id(3) }, { id: id(4) }], rowCount: 2 };
    if (sql.startsWith('SELECT id FROM events'))
      return { rows: mode === 'stale' ? [] : [{ id: id(3) }], rowCount: mode === 'stale' ? 0 : 1 };
    if (sql.includes('SELECT r.id,r.material_id'))
      return {
        rows: [{ id: id(5), material_id: id(6), team_id: id(7), entry_id: id(8) }],
        rowCount: 1,
      };
    if (sql.includes('UPDATE participant_material_revisions'))
      return { rows: mode === 'held' ? [] : [{ id: id(5) }], rowCount: mode === 'held' ? 0 : 1 };
    if (sql.startsWith('UPDATE events SET updated_at=updated_at') && mode === 'fence-failure')
      throw Error('synthetic-event-fence-failure');
    if (sql.includes('INSERT INTO audit_logs') && mode === 'audit-failure')
      throw new Error('synthetic-private-marker');
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  return { pool, query, release };
}

describe('bounded private participant ciphertext maintenance', () => {
  it('requires one scoped organization/actor and a strict bounded integer', () => {
    expect(
      participantCleanupOptions({
        SCB_PARTICIPANT_CLEANUP_ORG_ID: id(1),
        SCB_PARTICIPANT_CLEANUP_ACTOR_ID: id(2),
      }),
    ).toEqual({ ...options, limit: 20 });
    for (const limit of ['0', '-1', '501', '1.5', '1e2', '', ' 1'])
      expect(() =>
        participantCleanupOptions({
          SCB_PARTICIPANT_CLEANUP_ORG_ID: id(1),
          SCB_PARTICIPANT_CLEANUP_ACTOR_ID: id(2),
          SCB_PARTICIPANT_CLEANUP_LIMIT: limit,
        }),
      ).toThrow();
    for (const env of [
      {},
      { SCB_PARTICIPANT_CLEANUP_ORG_ID: '*' },
      { SCB_PARTICIPANT_CLEANUP_ORG_ID: id(1) },
    ])
      expect(() => participantCleanupOptions(env)).toThrow();
  });

  it.each(['wrong-role', 'no-admin'] as const)(
    'performs no purge without the least-privilege identity and authorized actor: %s',
    async (mode) => {
      const h = harness(mode);
      await expect(purgeParticipantMaterials(h.pool, options)).rejects.toThrow(
        'Participant material cleanup failed',
      );
      expect(
        h.query.mock.calls.some(([sql]) => sql.includes('UPDATE participant_material_revisions')),
      ).toBe(false);
      expect(h.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
      expect(h.release).toHaveBeenCalledOnce();
    },
  );

  it('uses at most the requested revision count and audits only identifiers after the purge', async () => {
    const h = harness();
    expect(await purgeParticipantMaterials(h.pool, options)).toEqual({
      status: 'complete',
      purgedRevisions: 1,
      touchedEvents: 1,
    });
    const events = h.query.mock.calls.filter(([sql]) => sql.startsWith('SELECT id FROM events'));
    expect(events).toHaveLength(1);
    const audit = h.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_logs'))!;
    const metadata = JSON.parse(String(audit[1]?.[4]));
    expect(metadata).toEqual({
      revisionIds: [id(5)],
      count: 1,
      retention: 'TERMINAL_EVENT_END_PLUS_90_DAYS',
    });
    const fence = h.query.mock.calls.findIndex(([sql]) =>
      sql.startsWith('UPDATE events SET updated_at=updated_at'),
    );
    const purge = h.query.mock.calls.findIndex(([sql]) =>
      sql.includes('UPDATE participant_material_revisions'),
    );
    const audited = h.query.mock.calls.findIndex(([sql]) => sql.includes('INSERT INTO audit_logs'));
    expect(fence).toBeGreaterThan(purge);
    expect(audited).toBeGreaterThan(fence);
    expect(h.query.mock.calls[fence]?.[1]).toEqual([options.orgId, id(3)]);
    expect(h.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });

  it.each(['stale', 'held'] as const)(
    'does not report a purge after retention/hold rechecking excludes selected candidates: %s',
    async (mode) => {
      const h = harness(mode);
      expect(await purgeParticipantMaterials(h.pool, options)).toEqual({
        status: 'complete',
        purgedRevisions: 0,
        touchedEvents: 0,
      });
      expect(h.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_logs'))).toBe(
        false,
      );
      expect(
        h.query.mock.calls.some(([sql]) =>
          sql.startsWith('UPDATE events SET updated_at=updated_at'),
        ),
      ).toBe(false);
      expect(h.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    },
  );

  it('rolls back the purge when its shared public-read tuple fence cannot be written', async () => {
    const h = harness('fence-failure');
    await expect(purgeParticipantMaterials(h.pool, options)).rejects.toThrow(
      'Participant material cleanup failed',
    );
    expect(h.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_logs'))).toBe(false);
    expect(h.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(h.release).toHaveBeenCalledOnce();
  });
  it('rolls back a ciphertext purge when its audit cannot be committed and never reflects private diagnostics', async () => {
    const h = harness('audit-failure');
    try {
      await purgeParticipantMaterials(h.pool, options);
      throw new Error('expected failure');
    } catch (error) {
      expect(String(error)).toBe('Error: Participant material cleanup failed');
      expect((error as Error).cause).toBeUndefined();
    }
    expect(h.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(h.release).toHaveBeenCalledOnce();
  });

  it('refuses elevated database URLs before connecting', async () => {
    await expect(
      cleanupParticipantMaterials({
        DATABASE_URL: 'postgresql://scb_admin:synthetic-secret@127.0.0.1/scb_test',
        SCB_PARTICIPANT_CLEANUP_ORG_ID: id(1),
        SCB_PARTICIPANT_CLEANUP_ACTOR_ID: id(2),
      }),
    ).rejects.toThrow('Database configuration is invalid');
  });

  it('prints no sensitive arguments or credentials from CLI failures', () => {
    const cli = fileURLToPath(
      new URL('../../../ops/db/participant-material-cleanup.mjs', import.meta.url),
    );
    for (const args of [[], ['private-argument']]) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://scb_admin:synthetic-private-marker@127.0.0.1/scb_test',
          DATABASE_URL_FILE: undefined,
          SCB_PARTICIPANT_CLEANUP_ORG_ID: id(1),
          SCB_PARTICIPANT_CLEANUP_ACTOR_ID: id(2),
        },
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe('participant-material-cleanup failed');
    }
  });
});
