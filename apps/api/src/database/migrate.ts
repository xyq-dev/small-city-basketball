import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { Pool as PgPool } from 'pg';
import { isDirectExecution, loadRootEnv } from '../env.js';
import { readDatabaseUrl } from '../runtime-config.js';

export async function migrate(pool: Pool): Promise<string[]> {
  const directory = fileURLToPath(new URL('../../migrations/', import.meta.url));
  const files = (await readdir(directory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [7240202601]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'), applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    const applied: string[] = [];
    for (const name of files) {
      const sql = await readFile(`${directory}/${name}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name=$1',
        [name],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`Migration checksum mismatch: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
        name,
        checksum,
      ]);
      applied.push(name);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Retain original error. */
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function runMigrationCli(): Promise<void> {
  if (process.argv.length > 2) throw new Error('Migration does not accept connection arguments');
  loadRootEnv();
  const pool = new PgPool({ connectionString: readDatabaseUrl(), connectionTimeoutMillis: 5000 });
  try {
    const applied = await migrate(pool);
    console.log(
      applied.length
        ? `Applied migrations: ${applied.join(', ')}`
        : 'Migration checksums verified; no new migrations.',
    );
  } finally {
    await pool.end();
  }
}
if (isDirectExecution(import.meta.url)) {
  try {
    await runMigrationCli();
  } catch {
    console.error('Database migration failed');
    process.exitCode = 1;
  }
}
