import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const failure =
  'API browser owner preparation requires an isolated non-production scb_test_* database';

/** No .env loading or database-URL-file fallback is allowed in this test fixture. */
export function browserFixtureDatabaseUrl(environment = process.env) {
  try {
    const value = environment.DATABASE_URL;
    if (environment.NODE_ENV === 'production' || typeof value !== 'string' || !value)
      throw new Error();
    const url = new URL(value);
    const name = decodeURIComponent(url.pathname.slice(1));
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !/^scb_test_[A-Za-z0-9_]+$/.test(name) ||
      name.length > 63 ||
      !url.hostname ||
      url.hash
    )
      throw new Error();
    return url.toString();
  } catch {
    throw new Error(failure);
  }
}

/** Initialize only the private browser-project database through the real
 * maintenance operation. This creates no sample events or reusable credentials.
 */
export async function prepareApiBrowserOwner(environment = process.env, dependencies = {}) {
  const connectionString = browserFixtureDatabaseUrl(environment);
  const pool = dependencies.createPool
    ? dependencies.createPool({ connectionString, connectionTimeoutMillis: 5000, max: 1 })
    : new pg.Pool({ connectionString, connectionTimeoutMillis: 5000, max: 1 });
  const initialized = async () => {
    const state = await pool.query(
      'SELECT initialized_at FROM first_run_setup WHERE singleton=true',
    );
    if (state.rows.length !== 1 || !Object.hasOwn(state.rows[0], 'initialized_at'))
      throw new Error('Browser fixture setup state is unavailable');
    return state.rows[0].initialized_at !== null;
  };
  try {
    if (await initialized()) return;
    const bootstrapOwner =
      dependencies.bootstrapOwner ??
      (await import('../apps/api/src/bootstrap-owner.ts')).bootstrapOwner;
    try {
      await bootstrapOwner(pool, {
        email: `browser-bootstrap-${randomBytes(16).toString('hex')}@example.test`,
        password: randomBytes(48).toString('base64url'),
        displayName: '隔离浏览器初始化负责人',
        organizationName: '隔离浏览器初始化机构',
      });
    } catch (error) {
      // A competing fixture may have completed under the same durable mutex.
      // Never swallow a closed-but-uninitialized instance with real accounts.
      if (error?.code !== 'SETUP_CLOSED' || !(await initialized())) throw error;
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.argv.length !== 2) throw new Error();
    await prepareApiBrowserOwner();
  } catch {
    // Driver errors and bound credentials must never reach CI output.
    console.error(
      'API browser owner preparation failed; verify the isolated database and migrations.',
    );
    process.exitCode = 1;
  }
}
