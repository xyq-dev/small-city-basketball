import { Pool } from 'pg';
import { migrate } from '../apps/api/src/database/migrate.ts';

// Only the CI-owned test database may run this diagnostic migration entry point.
const value = process.env.TEST_DATABASE_URL;
let url;
try {
  url = new URL(value || '');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(decodeURIComponent(url.pathname.slice(1)))
  )
    throw Error();
} catch {
  throw new Error('Migration preflight requires an isolated scb_test_* database');
}
const pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
try {
  await migrate(pool);
  console.log('Complete migration chain applied and checksums verified');
} catch (error) {
  // DDL diagnostics only; never print the connection URL or bound data.
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
