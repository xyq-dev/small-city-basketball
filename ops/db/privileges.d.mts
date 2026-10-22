import type { Pool, PoolClient } from 'pg';
export interface PrivilegeManifest {
  version: 1;
  schema: 'public';
  runtimeRole: 'scb_runtime';
  backupRole: 'scb_backup';
  tables: Record<
    string,
    { privileges: ('SELECT' | 'INSERT' | 'DELETE')[]; updateColumns: string[] }
  >;
}
export function loadManifest(): Promise<PrivilegeManifest>;
export function assertManifestSchema(
  client: Pick<Pool | PoolClient, 'query'>,
  manifest: PrivilegeManifest,
): Promise<void>;
export function applyRuntimePrivileges(pool: Pool): Promise<{ status: 'granted'; tables: number }>;
