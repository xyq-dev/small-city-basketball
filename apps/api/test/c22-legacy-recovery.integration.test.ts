import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { expect, test } from 'vitest';
import { migrate } from '../src/database/migrate.js';
import { bootstrapOwner } from '../src/bootstrap-owner.js';
import { applyRuntimePrivileges } from '../../../ops/db/privileges.mjs';
import { restoreDatabase } from '../../../ops/recovery/restore.mjs';
import { assertRuntimeReadiness } from '../src/readiness.js';
import { PASSWORD, testDatabaseUrl } from './support.js';

// Frozen original C20 tools, not a weakened current restore implementation. The
// fixture contains public source and checksums only; no backup or account data.
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/c22-legacy-package.json', import.meta.url), 'utf8'),
) as {
  sourceCommit: string;
  files: Record<string, { sha256: string; content: string }>;
  migrations: Record<string, string>;
};
const sha = (data: string) => createHash('sha256').update(data).digest('hex');

test('C20 archive is restored with its frozen package, quarantined, then upgraded without dropping data', async () => {
  const base = new URL(testDatabaseUrl());
  // This drill provisions temporary fixed-name service roles only inside the
  // explicitly isolated loopback CI cluster. Never adopt a provisioned service.
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(base.hostname);
  base.search = '';
  const control = new Pool({ connectionString: base.href });
  const suffix = randomUUID().replaceAll('-', '');
  const rolePassword = randomUUID();
  const createdRoles: string[] = [];
  const owned = new Map<string, { oid: number; comment: string }>();
  const pools: Pool[] = [];
  const directory = await mkdtemp(join(process.env.SCB_PG_WORK_DIRECTORY || tmpdir(), 'scb-c22-'));
  let changedMigrator = false;
  let primaryError: unknown;
  const urlFor = (role: string, database: string) => {
    const url = new URL(base);
    url.username = role;
    url.password = rolePassword;
    url.pathname = '/' + database;
    return url.href;
  };
  const facts = async (name: string) =>
    (
      await control.query<{ oid: number; comment: string }>(
        "SELECT oid::int AS oid,shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname=$1",
        [name],
      )
    ).rows[0];
  try {
    expect(fixture.sourceCommit).toBe('406568891a8eb95219b962cbdcb7fa422b257f46');
    const legacyRoot = join(directory, 'legacy');
    for (const [name, file] of Object.entries(fixture.files)) {
      expect(sha(file.content), name).toBe(file.sha256);
      const target = join(legacyRoot, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    await writeFile(join(legacyRoot, 'package.json'), '{"type":"module"}\n');
    await symlink(
      fileURLToPath(new URL('../../../node_modules', import.meta.url)),
      join(legacyRoot, 'node_modules'),
      'dir',
    );
    const legacySql: [string, string][] = [];
    for (const [name, checksum] of Object.entries(fixture.migrations)) {
      const sql = await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
      expect(sha(sql), name).toBe(checksum);
      const path = join(legacyRoot, 'apps/api/migrations', name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, sql);
      legacySql.push([name, sql]);
    }
    expect(legacySql).toHaveLength(22);
    const legacy = async (name: string) => import(pathToFileURL(join(legacyRoot, name)).href);
    const oldPrivileges = await legacy('ops/db/privileges.mjs');
    const oldBackup = await legacy('ops/recovery/backup.mjs');
    const oldRestore = await legacy('ops/recovery/restore.mjs');
    const oldQuarantine = await legacy('ops/recovery/quarantine.mjs');

    const role = (await control.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user'))
      .rows[0];
    expect(role.rolsuper).toBe(true);
    const oldMigrator = (
      await control.query(
        "SELECT rolcanlogin,rolpassword,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_authid WHERE rolname='scb_migrator'",
      )
    ).rows[0];
    expect(oldMigrator).toBeDefined();
    expect(oldMigrator.rolpassword).toBeNull();
    expect(
      Object.entries(oldMigrator)
        .filter(([k]) => k !== 'rolpassword')
        .every(([, v]) => v === false),
    ).toBe(true);
    for (const [name, options] of [
      ['scb_admin', 'CREATEDB CREATEROLE'],
      ['scb_runtime', 'NOCREATEDB NOCREATEROLE'],
      ['scb_backup', 'NOCREATEDB NOCREATEROLE'],
    ]) {
      expect(
        (await control.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name])).rowCount,
      ).toBe(0);
      await control.query(
        `CREATE ROLE ${name} LOGIN NOSUPERUSER NOREPLICATION NOBYPASSRLS ${options} PASSWORD '${rolePassword}'`,
      );
      createdRoles.push(name!);
    }
    await control.query(`ALTER ROLE scb_migrator LOGIN PASSWORD '${rolePassword}'`);
    changedMigrator = true;
    await control.query('GRANT scb_migrator TO scb_admin WITH ADMIN OPTION');
    const source = 'scb_restore_c22_source_' + suffix;
    const restored = 'scb_restore_c22_target_' + suffix;
    await control.query(`CREATE DATABASE "${source}" OWNER scb_migrator TEMPLATE template0`);
    await control.query(`COMMENT ON DATABASE "${source}" IS 'scb_restore_owner:${suffix}'`);
    owned.set(source, (await facts(source))!);
    const sourcePool = new Pool({ connectionString: urlFor('scb_migrator', source) });
    pools.push(sourcePool);
    await sourcePool.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await sourcePool.query('GRANT USAGE ON SCHEMA public TO scb_runtime,scb_backup,scb_migrator');
    const client = await sourcePool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
      );
      for (const [name, sql] of legacySql) {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
          name,
          sha(sql),
        ]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await oldPrivileges.applyRuntimePrivileges(sourcePool);
    const owner = await bootstrapOwner(sourcePool, {
      email: `c22-legacy-${suffix}@example.test`,
      password: PASSWORD,
      displayName: '合成旧包负责人',
      organizationName: '合成旧包恢复机构',
    });
    const archivePath = join(directory, 'legacy.dump');
    expect(
      await oldBackup.backupDatabase({ databaseUrl: urlFor('scb_backup', source), archivePath }),
    ).toMatchObject({ tables: 78 });
    const receiptPath = join(directory, 'restore-receipt.json');
    const restoreOptions = {
      adminUrl: urlFor('scb_admin', source),
      migratorUrl: urlFor('scb_migrator', source),
      archivePath,
      databaseName: restored,
      receiptPath,
    };
    // The new package must reject the older archive before creating a target.
    await expect(restoreDatabase(restoreOptions)).rejects.toThrow('Database restore failed');
    expect(await facts(restored)).toBeUndefined();
    expect(await oldRestore.restoreDatabase(restoreOptions)).toMatchObject({ tables: 78 });
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const restoredFacts = (await facts(restored))!;
    expect(restoredFacts.oid).toBe(receipt.databaseOid);
    expect(restoredFacts.comment).toBe('scb_restore_owner:' + receipt.nonce);
    owned.set(restored, restoredFacts);
    const target = new Pool({ connectionString: urlFor('scb_migrator', restored) });
    pools.push(target);
    expect(
      (await target.query('SELECT name FROM organizations WHERE id=$1', [owner.organizationId]))
        .rows[0].name,
    ).toBe('合成旧包恢复机构');
    await oldQuarantine.quarantineRestoredDatabase({ pool: target, ownership: receipt });
    expect(
      (await target.query('SELECT status FROM organizations WHERE id=$1', [owner.organizationId]))
        .rows[0].status,
    ).toBe('DISABLED');
    const retained = (
      await target.query('SELECT to_jsonb(o) AS value FROM organizations o ORDER BY id')
    ).rows;
    expect(await migrate(target)).toEqual(['023_c21_region_directory.sql']);
    await applyRuntimePrivileges(target);
    expect(
      (await target.query('SELECT to_jsonb(o) AS value FROM organizations o ORDER BY id')).rows,
    ).toEqual(retained);
    expect(
      (await target.query('SELECT count(*)::int AS n FROM region_catalog_nodes')).rows[0].n,
    ).toBe(3212);
    expect(
      (
        await target.query(
          "SELECT count(*)::int AS n FROM event_directory_listings WHERE status='ACTIVE'",
        )
      ).rows[0].n,
    ).toBe(0);
    const runtime = new Pool({ connectionString: urlFor('scb_runtime', restored) });
    pools.push(runtime);
    await expect(assertRuntimeReadiness(runtime)).resolves.toBeUndefined();
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    const clean = async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    for (const pool of pools.reverse()) await clean(() => pool.end());
    for (const [name, ownership] of [...owned].reverse()) {
      await clean(async () => {
        // pool.end may finish before the server observes socket closure. Wait
        // only for our owned targets; never forcibly terminate other sessions.
        const deadline = Date.now() + 5000;
        while (
          Number(
            (
              await control.query('SELECT count(*) AS n FROM pg_stat_activity WHERE datname=$1', [
                name,
              ])
            ).rows[0].n,
          )
        ) {
          if (Date.now() >= deadline) throw new Error('Owned C22 target still has connections');
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(await facts(name)).toEqual(ownership);
        await control.query(`DROP DATABASE "${name}"`);
      });
    }
    if (changedMigrator) {
      await clean(() => control.query('REVOKE scb_migrator FROM scb_admin'));
      await clean(() => control.query('ALTER ROLE scb_migrator NOLOGIN PASSWORD NULL'));
    }
    for (const name of createdRoles.reverse())
      await clean(() => control.query(`DROP ROLE ${name}`));
    await clean(() => control.end());
    await clean(() => rm(directory, { recursive: true, force: true }));
    if (cleanupErrors.length && primaryError === undefined)
      throw new AggregateError(cleanupErrors, 'C22 owned fixture cleanup failed');
  }
}, 180000);
