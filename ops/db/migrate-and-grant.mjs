import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Pool } from 'pg';
import { isMain, parseDatabaseUrl, readSecretEnv, repositoryRoot, runAsCli } from './common.mjs';
import { applyRuntimePrivileges } from './privileges.mjs';

export async function migrateAndGrant() {
  const url = parseDatabaseUrl(await readSecretEnv('DATABASE_URL'), 'scb_migrator');
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(repositoryRoot, 'apps/api/dist/database/migrate.js')],
      { env: process.env, stdio: ['ignore', 'ignore', 'ignore'] },
    );
    child.once('error', () => reject(new Error('Compiled migration could not start')));
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error('Compiled migration failed')),
    );
  });
  const pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  try {
    return await applyRuntimePrivileges(pool);
  } finally {
    await pool.end();
  }
}
if (isMain(import.meta.url)) await runAsCli('migrate-and-grant', migrateAndGrant);
