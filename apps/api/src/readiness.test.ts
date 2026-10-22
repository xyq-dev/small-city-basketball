import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { assertRuntimeReadiness, migrationSetsMatch, privilegesMatch } from './readiness.js';
import type { PrivilegeManifest, TablePrivileges } from './readiness.js';

const manifest: PrivilegeManifest = {
  version: 1,
  schema: 'public',
  runtimeRole: 'scb_runtime',
  backupRole: 'scb_backup',
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
