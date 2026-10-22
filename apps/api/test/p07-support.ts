import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { migrate } from '../src/database/migrate.js';
import { applyRuntimePrivileges } from '../../../ops/db/privileges.mjs';

export interface RestoreOwnership {
  version: 1;
  databaseName: string;
  databaseOid: number;
  nonce: string;
}

async function secret(name: string): Promise<string> {
  const inline = process.env[name];
  const file = process.env[`${name}_FILE`];
  if ((inline !== undefined) === (file !== undefined))
    throw new Error(
      'P07 tests require exactly one explicit value or secret file for each database role',
    );
  try {
    const value = (inline ?? (await readFile(file!, 'utf8'))).trim();
    if (!value) throw new Error();
    return value;
  } catch {
    throw new Error('P07 database test credentials are unavailable');
  }
}

export async function p07DatabaseUrls() {
  try {
    const admin = new URL(await secret('TEST_P07_ADMIN_DATABASE_URL'));
    const migrator = new URL(await secret('TEST_P07_MIGRATOR_DATABASE_URL'));
    const runtime = new URL(await secret('TEST_P07_RUNTIME_DATABASE_URL'));
    const backup = new URL(await secret('TEST_P07_BACKUP_DATABASE_URL'));
    if (
      !['postgres:', 'postgresql:'].includes(admin.protocol) ||
      !['postgres:', 'postgresql:'].includes(migrator.protocol) ||
      decodeURIComponent(admin.username) !== 'scb_admin' ||
      decodeURIComponent(migrator.username) !== 'scb_migrator' ||
      !/^\/scb_test_production_[a-zA-Z0-9_]+$/.test(admin.pathname) ||
      admin.hostname !== migrator.hostname ||
      (admin.port || '5432') !== (migrator.port || '5432') ||
      admin.pathname !== migrator.pathname ||
      !admin.password ||
      !migrator.password
    )
      throw new Error();
    for (const [url, role] of [
      [runtime, 'scb_runtime'],
      [backup, 'scb_backup'],
    ] as const) {
      if (
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        decodeURIComponent(url.username) !== role ||
        !url.password ||
        url.hostname !== admin.hostname ||
        (url.port || '5432') !== (admin.port || '5432') ||
        url.pathname !== admin.pathname
      )
        throw new Error();
    }
    return { admin, migrator, runtime, backup };
  } catch {
    throw new Error(
      'P07 tests require explicit provisioned roles on an isolated production-check control database',
    );
  }
}

/** Always creates its own target; never adopts or deletes an existing database. */
export async function createOwnedRestoreDatabase() {
  const urls = await p07DatabaseUrls();
  const adminPool = new Pool({
    connectionString: urls.admin.toString(),
    connectionTimeoutMillis: 5000,
  });
  const databaseName = `scb_restore_${randomUUID().replaceAll('-', '')}`;
  const nonce = randomUUID();
  let created = false;
  let pool: Pool | undefined;
  let ownership: RestoreOwnership | undefined;
  const matches = async () => {
    if (!ownership) return false;
    const record = (
      await adminPool.query<{ oid: number; comment: string }>(
        "SELECT oid::int AS oid,shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname=$1",
        [databaseName],
      )
    ).rows[0];
    return record?.oid === ownership.databaseOid && record.comment === `scb_restore_owner:${nonce}`;
  };
  const close = async () => {
    try {
      if (pool) {
        await pool.end();
        pool = undefined;
      }
      if (created && (await matches())) {
        // pg-pool removes idle clients and can resolve end() before their
        // sockets finish closing. FORCE here would terminate those backends
        // and surface a late 57P01 on the ending client. Observe server-side
        // disconnection instead, and refuse cleanup if an unknown writer stays.
        const deadline = Date.now() + 5000;
        while (true) {
          const connected = (
            await adminPool.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM pg_stat_activity
               WHERE datname=$1 AND backend_type='client backend'`,
              [databaseName],
            )
          ).rows[0]!.n;
          if (connected === 0) break;
          if (Date.now() >= deadline)
            throw new Error('Refused P07 cleanup because restore target connections remain');
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        // Recheck ownership after draining; ordinary DROP also fails safely if
        // any new connection races this check. Never terminate another client.
        if (!(await matches()))
          throw new Error('Refused P07 cleanup because restore target ownership changed');
        await adminPool.query(`DROP DATABASE "${databaseName}"`);
        created = false;
      } else if (created)
        throw new Error('Refused P07 cleanup because restore target ownership changed');
    } finally {
      await adminPool.end();
    }
  };
  try {
    const role = (await adminPool.query<{ name: string }>('SELECT current_user AS name')).rows[0]
      ?.name;
    if (role !== 'scb_admin') throw new Error('P07 admin role preflight failed');
    await adminPool.query(
      `CREATE DATABASE "${databaseName}" OWNER scb_migrator TEMPLATE template0`,
    );
    created = true;
    const oid = (
      await adminPool.query<{ oid: number }>(
        'SELECT oid::int AS oid FROM pg_database WHERE datname=$1',
        [databaseName],
      )
    ).rows[0]!.oid;
    await adminPool.query(`COMMENT ON DATABASE "${databaseName}" IS 'scb_restore_owner:${nonce}'`);
    ownership = { version: 1, databaseName, databaseOid: oid, nonce };
    await adminPool.query(
      `REVOKE ALL PRIVILEGES ON DATABASE "${databaseName}" FROM PUBLIC,scb_runtime,scb_backup`,
    );
    await adminPool.query(
      `GRANT CONNECT ON DATABASE "${databaseName}" TO scb_runtime,scb_backup,scb_migrator`,
    );
    const target = new URL(urls.migrator);
    target.pathname = `/${databaseName}`;
    pool = new Pool({ connectionString: target.toString(), connectionTimeoutMillis: 5000 });
    const owner = (await pool.query<{ name: string }>('SELECT current_user AS name')).rows[0]?.name;
    if (owner !== 'scb_migrator') throw new Error('P07 migrator role preflight failed');
    await pool.query('REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC,scb_runtime,scb_backup');
    await pool.query('GRANT USAGE ON SCHEMA public TO scb_runtime,scb_backup,scb_migrator');
    await migrate(pool);
    await applyRuntimePrivileges(pool);
    return { pool, databaseUrl: target.toString(), ownership, adminPool, close };
  } catch {
    await close();
    throw new Error('P07 isolated restore fixture setup failed');
  }
}
