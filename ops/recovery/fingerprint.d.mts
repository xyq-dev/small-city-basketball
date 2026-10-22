import type { Pool } from 'pg';
export interface DatabaseFingerprint {
  version: 1;
  schemaSha256: string;
  migrations: { name: string; checksum: string }[];
  tables: Record<string, { rows: number; sha256: string }>;
}
export function fingerprintDatabase(pool: Pool): Promise<DatabaseFingerprint>;
