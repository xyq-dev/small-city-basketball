import type { Pool, PoolClient } from 'pg';
export interface PrivilegeManifest {
  version: 1;
  schema: 'public';
  runtimeRole: 'scb_runtime';
  backupRole: 'scb_backup';
  functions: Record<string, 'EXECUTE'[]>;
  tables: Record<
    string,
    { privileges: ('SELECT' | 'INSERT' | 'DELETE')[]; updateColumns: string[] }
  >;
}
export function loadManifest(): Promise<PrivilegeManifest>;
export function functionSql(signature: string): string;
export const APPLICATION_FUNCTIONS_SQL: string;
export function assertManifestSchema(
  client: Pick<Pool | PoolClient, 'query'>,
  manifest: PrivilegeManifest,
): Promise<void>;
export function applyRuntimePrivileges(pool: Pool): Promise<{ status: 'granted'; tables: number }>;
export function assertMigrationManifestSurface(
  manifest: PrivilegeManifest,
  sources: readonly { name: string; sql: string }[],
): { tables: number; functions: number };
