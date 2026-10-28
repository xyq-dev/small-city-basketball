import { Pool } from 'pg';
import { isMain, parseDatabaseUrl, readSecretEnv, runAsCli } from './common.mjs';

/** Explicit, bounded maintenance only: no timer, polling loop, database creation or migrations. */
export function mediaCleanupOptions(env = process.env) {
  const rawLimit = env.SCB_MEDIA_CLEANUP_LIMIT ?? '20';
  if (!/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 500)
    throw new Error('Cleanup limit must be an integer between 1 and 500');
  const orgId = env.SCB_MEDIA_CLEANUP_ORG_ID ?? null;
  if (
    orgId !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(orgId)
  )
    throw new Error('Cleanup organization must be a UUID');
  return { orgId, limit: Number(rawLimit) };
}

export async function cleanupMedia(env = process.env) {
  const { orgId, limit } = mediaCleanupOptions(env);
  // Use the existing least-privilege application identity, never a migrator/admin role.
  const url = parseDatabaseUrl(await readSecretEnv('DATABASE_URL', env), 'scb_app');
  const { expireMediaUploadSessions } =
    await import('../../apps/api/dist/media-request-service.js');
  const pool = new Pool({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
  try {
    return await expireMediaUploadSessions(pool, orgId, limit);
  } finally {
    await pool.end();
  }
}

if (isMain(import.meta.url)) await runAsCli('media-cleanup', cleanupMedia);
