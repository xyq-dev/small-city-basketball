import { Pool } from 'pg';
import {
  isMain,
  parseDatabaseUrl,
  quoteIdentifier,
  readSecretEnv,
  runAsCli,
  sameServer,
} from './common.mjs';

const literal = (value) => `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;

export async function provisionDatabase({ adminUrl, migratorUrl, runtimeUrl, backupUrl }) {
  const admin = parseDatabaseUrl(adminUrl, 'scb_admin');
  const roles = [
    parseDatabaseUrl(migratorUrl, 'scb_migrator'),
    parseDatabaseUrl(runtimeUrl, 'scb_runtime'),
    parseDatabaseUrl(backupUrl, 'scb_backup'),
  ];
  roles.forEach((url) => sameServer(admin, url));
  const pool = new Pool({ connectionString: admin.toString(), connectionTimeoutMillis: 5000 });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [7240202607]);
    const actor = (await client.query('SELECT current_user AS name,session_user AS session'))
      .rows[0];
    if (actor.name !== 'scb_admin' || actor.session !== 'scb_admin')
      throw new Error('Initialization role is required');
    const database = decodeURIComponent(admin.pathname.slice(1));
    for (const url of roles) {
      const name = decodeURIComponent(url.username);
      const exists = await client.query('SELECT oid FROM pg_roles WHERE rolname=$1', [name]);
      if (!exists.rowCount) await client.query(`CREATE ROLE ${quoteIdentifier(name)} LOGIN`);
      const membership = await client.query(
        'SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1) OR roleid=(SELECT oid FROM pg_roles WHERE rolname=$1) LIMIT 1',
        [name],
      );
      if (membership.rowCount) throw new Error('Unexpected database role membership');
      await client.query(
        `ALTER ROLE ${quoteIdentifier(name)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${literal(decodeURIComponent(url.password))}`,
      );
    }
    const owner = (
      await client.query(
        'SELECT r.rolname AS name FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=current_database()',
      )
    ).rows[0];
    if (['scb_runtime', 'scb_backup'].includes(owner.name))
      throw new Error('Unexpected database owner');
    await client.query(
      `REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(database)} FROM PUBLIC,scb_runtime,scb_backup,scb_migrator`,
    );
    await client.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(database)} TO scb_runtime,scb_backup,scb_migrator`,
    );
    await client.query(`GRANT CREATE ON DATABASE ${quoteIdentifier(database)} TO scb_migrator`);
    await client.query(
      'REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC,scb_runtime,scb_backup,scb_migrator',
    );
    await client.query('GRANT USAGE ON SCHEMA public TO scb_runtime,scb_backup,scb_migrator');
    await client.query('GRANT CREATE ON SCHEMA public TO scb_migrator');
    await client.query('COMMIT');
    return { status: 'provisioned' };
  } catch {
    await client?.query('ROLLBACK').catch(() => {});
    throw new Error('Database provisioning failed');
  } finally {
    client?.release();
    await pool.end();
  }
}

if (isMain(import.meta.url))
  await runAsCli('provision', async () =>
    provisionDatabase({
      adminUrl: await readSecretEnv('DATABASE_URL'),
      migratorUrl: await readSecretEnv('DATABASE_MIGRATOR_URL'),
      runtimeUrl: await readSecretEnv('DATABASE_RUNTIME_URL'),
      backupUrl: await readSecretEnv('DATABASE_BACKUP_URL'),
    }),
  );
