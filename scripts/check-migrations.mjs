import { readdir, readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { loadManifest, assertMigrationManifestSurface } from '../ops/db/privileges.mjs';

// --static verifies the complete checked-in identities/ACL columns without opening a connection.
if (process.argv.slice(2).some((arg) => arg !== '--static') || process.argv.slice(2).length > 1)
  throw Error('Migration check accepts only --static');
const directory = new URL('../apps/api/migrations/', import.meta.url);
const names = (await readdir(directory))
  .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
  .sort();
if (
  !names.length ||
  names.some(
    (name, index) => name.slice(0, name.indexOf('_')) !== String(index + 1).padStart(3, '0'),
  )
)
  throw Error('Migration sequence is incomplete or ambiguous');
const surface = assertMigrationManifestSurface(
  await loadManifest(),
  await Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(new URL(name, directory), 'utf8') })),
  ),
);
if (process.argv.includes('--static')) {
  console.log(
    `Checked-in surface verified: ${names.length} migrations, ${surface.tables} tables, ${surface.functions} functions; no database connection`,
  );
} else {
  // Only the CI-owned test database may run this diagnostic migration entry point.
  let url;
  try {
    url = new URL(process.env.TEST_DATABASE_URL || '');
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !/^scb_test_[A-Za-z0-9_]+$/.test(decodeURIComponent(url.pathname.slice(1)))
    )
      throw Error();
  } catch {
    throw Error('Migration preflight requires an isolated scb_test_* database');
  }
  let migrate;
  try {
    ({ migrate } = await import('../apps/api/dist/database/migrate.js'));
  } catch {
    throw Error('Build the API before executing the isolated migration check');
  }
  const pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  try {
    await migrate(pool);
    console.log('Complete migration chain applied and checksums verified');
  } catch (error) {
    // DDL diagnostics only; never print connection details or bound data.
    console.error(
      JSON.stringify({
        code: typeof error.code === 'string' ? error.code : 'MIGRATION_FAILED',
        message: typeof error.message === 'string' ? error.message : 'Migration failed',
        position: error.position,
        where: error.where,
      }),
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
