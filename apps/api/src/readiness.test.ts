import type { Pool } from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { loadManifest, assertMigrationManifestSurface } from '../../../ops/db/privileges.mjs';
import { orderedMigrationNames } from './database/migration-plan.js';
import { describe, expect, it } from 'vitest';
import {
  assertRuntimeReadiness,
  migrationSetsMatch,
  participantKeyIdsMatch,
  privilegesMatch,
  functionPrivilegesMatch,
} from './readiness.js';
import type { PrivilegeManifest, TablePrivileges } from './readiness.js';

const manifest: PrivilegeManifest = {
  version: 1,
  schema: 'public',
  runtimeRole: 'scb_runtime',
  backupRole: 'scb_backup',
  functions: { 'x12_calendar_lock()': ['EXECUTE'], 'x17_staff_receipt_immutable()': [] },
  tables: {
    overlay_sessions: { privileges: ['SELECT', 'INSERT'], updateColumns: ['id'] },
    audit_logs: { privileges: ['INSERT'], updateColumns: [] },
  },
};
const tables: TablePrivileges[] = [
  {
    name: 'overlay_sessions',
    owner: false,
    select: true,
    insert: true,
    delete: false,
    update: false,
    dangerous: false,
    columns: [
      { name: 'id', select: true, insert: true, update: true, references: false },
      { name: 'token_hash', select: true, insert: true, update: false, references: false },
    ],
  },
  {
    name: 'audit_logs',
    owner: false,
    select: false,
    insert: true,
    delete: false,
    update: false,
    dangerous: false,
    columns: [{ name: 'id', select: false, insert: true, update: false, references: false }],
  },
];
describe('runtime readiness invariants', () => {
  it('requires the exact key for all retained participant ciphertext while allowing old databases without materials', () => {
    expect(participantKeyIdsMatch(null, [])).toBe(true);
    expect(participantKeyIdsMatch('current', [])).toBe(true);
    expect(participantKeyIdsMatch('current', [{ key_id: 'current' }])).toBe(true);
    expect(participantKeyIdsMatch(null, [{ key_id: 'current' }])).toBe(false);
    expect(participantKeyIdsMatch('current', [{ key_id: 'old' }])).toBe(false);
    expect(participantKeyIdsMatch('current', [{ key_id: 'current' }, { key_id: 'old' }])).toBe(
      false,
    );
  });
  it('requires the exact migration identity and checksum set, including no newer extra migration', () => {
    const expected = new Map([
      ['001.sql', 'a'],
      ['002.sql', 'b'],
    ]);
    expect(
      migrationSetsMatch(expected, [
        { name: '002.sql', checksum: 'b' },
        { name: '001.sql', checksum: 'a' },
      ]),
    ).toBe(true);
    for (const rows of [
      [{ name: '001.sql', checksum: 'a' }],
      [
        { name: '001.sql', checksum: 'a' },
        { name: '002.sql', checksum: 'wrong' },
      ],
      [
        { name: '001.sql', checksum: 'a' },
        { name: '002.sql', checksum: 'b' },
        { name: '003.sql', checksum: 'c' },
      ],
      [
        { name: '001.sql', checksum: 'a' },
        { name: '001.sql', checksum: 'a' },
      ],
    ])
      expect(migrationSetsMatch(expected, rows)).toBe(false);
  });
  it('allows the explicit immutable-table lock column without granting mutable contents or audit reads', () => {
    expect(privilegesMatch(manifest, tables)).toBe(true);
    for (const mutate of [
      (r: TablePrivileges[]) => (r[0]!.columns[1]!.update = true),
      (r: TablePrivileges[]) => (r[0]!.update = true),
      (r: TablePrivileges[]) => (r[0]!.delete = true),
      (r: TablePrivileges[]) => (r[0]!.owner = true),
      (r: TablePrivileges[]) => (r[0]!.dangerous = true),
      (r: TablePrivileges[]) => (r[1]!.select = true),
      (r: TablePrivileges[]) => (r[1]!.columns[0]!.select = true),
      (r: TablePrivileges[]) => (r[0]!.columns[0]!.update = false),
      (r: TablePrivileges[]) => (r[0]!.columns[0]!.references = true),
    ]) {
      const changed = structuredClone(tables);
      mutate(changed);
      expect(privilegesMatch(manifest, changed)).toBe(false);
    }
    expect(privilegesMatch(manifest, tables.slice(0, 1))).toBe(false);
    expect(privilegesMatch(manifest, [...tables, { ...tables[0]!, name: 'unreviewed' }])).toBe(
      false,
    );
  });
  it('grants only the two restore-marker audit columns without exposing audit metadata or whole-table reads', () => {
    const scoped = structuredClone(manifest),
      actual = structuredClone(tables);
    scoped.tables.audit_logs!.selectColumns = ['action', 'resource_type'];
    actual[1]!.columns.push(
      { name: 'action', select: true, insert: true, update: false, references: false },
      { name: 'resource_type', select: true, insert: true, update: false, references: false },
      { name: 'metadata', select: false, insert: true, update: false, references: false },
    );
    expect(privilegesMatch(scoped, actual)).toBe(true);
    for (const mutate of [
      (rows: TablePrivileges[]) => (rows[1]!.select = true),
      (rows: TablePrivileges[]) =>
        (rows[1]!.columns.find((c) => c.name === 'metadata')!.select = true),
      (rows: TablePrivileges[]) =>
        (rows[1]!.columns.find((c) => c.name === 'action')!.select = false),
      (rows: TablePrivileges[]) =>
        (rows[1]!.columns.find((c) => c.name === 'resource_type')!.select = false),
    ]) {
      const changed = structuredClone(actual);
      mutate(changed);
      expect(privilegesMatch(scoped, changed)).toBe(false);
    }
  });
  it('maps unavailable database diagnostics to a fixed public503 without a cause', async () => {
    const pool = {
      connect: async () => {
        throw new Error('postgresql://private-user:private-marker@host/db');
      },
    } as unknown as Pool;
    try {
      await assertRuntimeReadiness(pool);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toMatchObject({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: '服务尚未就绪',
      });
      expect(String(error)).not.toContain('private-marker');
      expect((error as Error).cause).toBeUndefined();
    }
  });
});

describe('explicit application function ACLs', () => {
  const rows = [
    {
      signature: 'x12_calendar_lock()',
      owner: 'scb_migrator',
      definer: false,
      runtimeExecute: true,
      backupExecute: false,
      publicExecute: false,
    },
    {
      signature: 'x17_staff_receipt_immutable()',
      owner: 'scb_migrator',
      definer: false,
      runtimeExecute: false,
      backupExecute: false,
      publicExecute: false,
    },
  ];
  it('admits only named runtime helpers and leaves extension functions outside this set', () => {
    expect(functionPrivilegesMatch(manifest, rows)).toBe(true);
  });
  it('rejects default PUBLIC, backup or direct trigger execution, definer escalation and missing/unknown functions', () => {
    for (const patch of [
      { publicExecute: true },
      { backupExecute: true },
      { definer: true },
      { owner: 'scb_runtime' },
      { runtimeExecute: false },
    ])
      expect(functionPrivilegesMatch(manifest, [{ ...rows[0]!, ...patch }, rows[1]!])).toBe(false);
    expect(
      functionPrivilegesMatch(manifest, [rows[0]!, { ...rows[1]!, runtimeExecute: true }]),
    ).toBe(false);
    expect(functionPrivilegesMatch(manifest, rows.slice(0, 1))).toBe(false);
    expect(
      functionPrivilegesMatch(manifest, [...rows, { ...rows[0]!, signature: 'unexpected()' }]),
    ).toBe(false);
  });
});

describe('complete expansion migration and least-privilege surface', () => {
  async function checkedIn() {
    const directory = new URL('../migrations/', import.meta.url),
      names = orderedMigrationNames(await readdir(directory));
    const sources = await Promise.all(
      names.map(async (name) => ({ name, sql: await readFile(new URL(name, directory), 'utf8') })),
    );
    return { manifest: await loadManifest(), sources, names };
  }
  it('matches every checked-in table, function signature and granted update column across the full contiguous sequence', async () => {
    const v = await checkedIn();
    expect(v.names).toHaveLength(41);
    expect(assertMigrationManifestSurface(v.manifest, v.sources)).toEqual({
      tables: Object.keys(v.manifest.tables).length,
      functions: Object.keys(v.manifest.functions).length,
    });
    for (const source of v.sources.filter((s) => Number(s.name.slice(0, 3)) >= 36))
      for (const m of source.sql.matchAll(/^CREATE TABLE ([a-z_]+)/gm))
        expect(v.manifest.tables[m[1]!]!.privileges).not.toContain('DELETE');
  });
  it('keeps expansion history append-only and trigger functions uncallable by the runtime, backup and PUBLIC roles', async () => {
    const { manifest } = await checkedIn();
    for (const table of [
      'stream_command_receipts',
      'stream_usage_ledger',
      'insurance_quotes',
      'insurance_policy_facts',
      'insurance_receipts',
      'insurance_provider_events',
      'participant_qualification_requests',
      'participant_qualification_prechecks',
      'participant_qualification_receipts',
      'trade_provider_events',
      'trade_operations',
      'trade_reconciliations',
      'notification_source_events',
      'notification_configuration',
      'notification_commands',
      'account_closure_operations',
      'account_closure_tombstones',
      'youth_guardian_history',
      'youth_guardian_commands',
      'youth_preconsent_history',
    ]) {
      expect(manifest.tables[table], table).toEqual({
        privileges: ['SELECT', 'INSERT'],
        updateColumns: [],
      });
    }
    expect(manifest.tables.notification_start_scan).toEqual({
      privileges: ['SELECT'],
      updateColumns: ['cursor_match_id', 'cursor_starts_at', 'updated_at'],
    });
    for (const [signature, privileges] of Object.entries(manifest.functions))
      if (/^e0[1-8]_/.test(signature)) expect(privileges, signature).toEqual([]);
    expect(
      Object.entries(manifest.tables)
        .filter(([, r]) => r.privileges.includes('DELETE'))
        .map(([name]) => name)
        .sort(),
    ).toEqual(['auth_rate_limits', 'wechat_auth_attempts']);
  });
  it('rejects a missing or extra expansion object, unknown UPDATE column and unreviewed function argument type before connecting', async () => {
    const v = await checkedIn();
    for (const mutate of [
      (m: PrivilegeManifest) => delete m.tables.live_media_jobs,
      (m: PrivilegeManifest) =>
        m.tables.live_media_jobs!.updateColumns.push('credential_ciphertext'),
      (m: PrivilegeManifest) =>
        (m.tables.unreviewed = { privileges: ['SELECT'], updateColumns: [] }),
      (m: PrivilegeManifest) => delete m.functions['e02_job_identity_guard()'],
      (m: PrivilegeManifest) => m.tables.audit_logs!.selectColumns!.push('not_a_column'),
    ]) {
      const changed = structuredClone(v.manifest);
      mutate(changed);
      expect(() => assertMigrationManifestSurface(changed, v.sources)).toThrow();
    }
    expect(() =>
      assertMigrationManifestSurface(v.manifest, [
        ...v.sources,
        {
          name: '042_bad.sql',
          sql: 'CREATE FUNCTION unreviewed(bigint) RETURNS void LANGUAGE SQL AS $$ SELECT 1 $$;',
        },
      ]),
    ).toThrow();
  });
});
