import type { Pool, PoolClient } from 'pg';
export function exactTableRows(
  client: Pool | PoolClient,
  table: string,
): Promise<{ value: string }[]>;
