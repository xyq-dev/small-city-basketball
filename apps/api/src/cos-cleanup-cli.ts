import { Pool } from 'pg';
import { isDirectExecution, loadRootEnv } from './env.js';
import { readDatabaseUrl } from './runtime-config.js';
import { MediaObjectStorage } from './media-object-storage.js';
import { createStorageSettingsResolver } from './storage-settings/runtime.js';

/** Explicit bounded maintenance using the existing runtime identity; never applies DDL. */
export async function runCosCleanup(): Promise<{ deleted: number; failed: number }> {
  if (process.argv.length > 2) throw new Error('COS cleanup accepts no arguments');
  loadRootEnv();
  const databaseUrl = readDatabaseUrl();
  if (decodeURIComponent(new URL(databaseUrl).username) !== 'scb_runtime')
    throw new Error('COS cleanup requires the runtime identity');
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 });
  let storage: MediaObjectStorage | undefined;
  try {
    const quarantine = await pool.query(
      "SELECT EXISTS(SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore') AS quarantined",
    );
    if (quarantine.rows[0]?.quarantined !== false)
      throw new Error('COS cleanup is disabled in restore quarantine');
    const resolveStore = createStorageSettingsResolver(pool);
    storage = new MediaObjectStorage(pool, databaseUrl, undefined, async (client) => {
      const store = await resolveStore(client);
      if (!store) throw new Error('COS cleanup requires COS configuration');
      return store;
    });
    return await storage.cleanup();
  } finally {
    await storage?.onModuleDestroy();
    await pool.end();
  }
}

if (isDirectExecution(import.meta.url)) {
  try {
    const result = await runCosCleanup();
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } catch {
    console.error('COS cleanup failed');
    process.exitCode = 1;
  }
}
