import type { Pool } from 'pg';
import type { RestoreOwnership } from '../db/common.mjs';
export function quarantineRestoredDatabase(input: {
  pool: Pool;
  ownership: RestoreOwnership;
}): Promise<{
  status: 'quarantined';
  systemUserId: string;
  counts: Record<string, number>;
}>;
