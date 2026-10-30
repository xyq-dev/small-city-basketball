import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  assertOwnedRestoreTarget,
  assertPrivatePath,
  hashPrivateFile,
  isMain,
  parseDatabaseUrl,
  quoteIdentifier,
  readPrivateJson,
  readSecretEnv,
  restoreName,
  runAsCli,
  runPgTool,
  sameServer,
  targetUrl,
  writePrivateJson,
} from '../db/common.mjs';
import { applyRuntimePrivileges } from '../db/privileges.mjs';
import { fingerprintDatabase } from './fingerprint.mjs';

/** Creates a new database only. On failure it leaves it isolated; never drops/adopts any target. */
export async function restoreDatabase({
  adminUrl,
  migratorUrl,
  archivePath,
  databaseName,
  receiptPath,
}) {
  let adminPool, targetPool;
  try {
    const admin = parseDatabaseUrl(adminUrl, 'scb_admin'),
      migrator = parseDatabaseUrl(migratorUrl, 'scb_migrator');
    sameServer(admin, migrator);
    if (!restoreName(databaseName) || decodeURIComponent(admin.pathname.slice(1)) === databaseName)
      throw new Error();
    await assertPrivatePath(archivePath);
    await assertPrivatePath(receiptPath, false);
    const archive = await readPrivateJson(`${archivePath}.manifest.json`);
    const archiveSha256 = await hashPrivateFile(archivePath);
    if (
      archive?.version !== 1 ||
      archive.format !== 'SCB_FULL_CUSTOM_PG18' ||
      archive.archiveSha256 !== archiveSha256 ||
      archive.fingerprint?.version !== 1 ||
      Object.keys(archive.fingerprint.tables ?? {}).length !== 81
    )
      throw new Error();
    if (
      !/^pg_restore \(PostgreSQL\) 18\./.test(
        await runPgTool('pg_restore', ['--version'], migrator),
      )
    )
      throw new Error();
    const contents = await runPgTool('pg_restore', ['--list', archivePath], migrator);
    if (!/Format: CUSTOM/.test(contents) || !/Dumped by pg_dump version: 18\./.test(contents))
      throw new Error();
    adminPool = new Pool({ connectionString: admin.toString(), connectionTimeoutMillis: 5000 });
    const role = (await adminPool.query('SELECT current_user AS current,session_user AS session'))
      .rows[0];
    if (role.current !== 'scb_admin' || role.session !== 'scb_admin') throw new Error();
    // CREATE DATABASE itself is the atomic non-overwrite test, including races.
    await adminPool.query(
      `CREATE DATABASE ${quoteIdentifier(databaseName)} OWNER scb_migrator TEMPLATE template0`,
    );
    const nonce = randomUUID(),
      name = quoteIdentifier(databaseName);
    await adminPool.query(`COMMENT ON DATABASE ${name} IS 'scb_restore_owner:${nonce}'`);
    const oid = (
      await adminPool.query('SELECT oid::int AS oid FROM pg_database WHERE datname=$1', [
        databaseName,
      ])
    ).rows[0].oid;
    const ownership = { version: 1, databaseName, databaseOid: oid, nonce };
    await adminPool.query(
      `REVOKE ALL PRIVILEGES ON DATABASE ${name} FROM PUBLIC,scb_runtime,scb_backup`,
    );
    await adminPool.query(
      `GRANT CONNECT ON DATABASE ${name} TO scb_runtime,scb_backup,scb_migrator`,
    );
    const target = targetUrl(migrator, databaseName);
    targetPool = new Pool({ connectionString: target.toString(), connectionTimeoutMillis: 5000 });
    await assertOwnedRestoreTarget(targetPool, ownership);
    // Built-in public schema exists in template0; full pg_dump omits its CREATE.
    await targetPool.query(
      'REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC,scb_runtime,scb_backup',
    );
    await targetPool.query('GRANT USAGE ON SCHEMA public TO scb_runtime,scb_backup,scb_migrator');
    await runPgTool(
      'pg_restore',
      [
        '--dbname',
        databaseName,
        '--single-transaction',
        '--exit-on-error',
        '--no-owner',
        '--no-acl',
        '--no-password',
        archivePath,
      ],
      target,
    );
    await applyRuntimePrivileges(targetPool);
    const fingerprint = await fingerprintDatabase(targetPool);
    if (JSON.stringify(fingerprint) !== JSON.stringify(archive.fingerprint)) throw new Error();
    await assertOwnedRestoreTarget(targetPool, ownership);
    await writePrivateJson(receiptPath, { ...ownership, archiveSha256, fingerprint });
    return { status: 'restored', databaseName, tables: 81 };
  } catch {
    throw new Error('Database restore failed');
  } finally {
    await targetPool?.end();
    await adminPool?.end();
  }
}
if (isMain(import.meta.url))
  await runAsCli('restore', async () =>
    restoreDatabase({
      adminUrl: await readSecretEnv('DATABASE_URL'),
      migratorUrl: await readSecretEnv('DATABASE_MIGRATOR_URL'),
      archivePath: process.env.ARCHIVE_PATH,
      databaseName: process.env.RESTORE_DATABASE_NAME,
      receiptPath: process.env.RESTORE_RECEIPT_PATH,
    }),
  );
