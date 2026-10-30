import { Pool } from 'pg';
import {
  assertPrivatePath,
  hashPrivateFile,
  isMain,
  openPrivateOutput,
  parseDatabaseUrl,
  readSecretEnv,
  runAsCli,
  runPgTool,
  writePrivateJson,
} from '../db/common.mjs';
import { fingerprintDatabase } from './fingerprint.mjs';

/** Source writers must already be stopped for the entire baseline/dump/baseline interval. */
export async function backupDatabase({ databaseUrl, archivePath }) {
  let pool, output;
  try {
    const url = parseDatabaseUrl(databaseUrl, 'scb_backup');
    await assertPrivatePath(archivePath, false);
    await assertPrivatePath(`${archivePath}.manifest.json`, false);
    pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
    const role = (await pool.query('SELECT current_user AS current,session_user AS session'))
      .rows[0];
    if (role.current !== 'scb_backup' || role.session !== 'scb_backup') throw new Error();
    if (!/^pg_dump \(PostgreSQL\) 18\./.test(await runPgTool('pg_dump', ['--version'], url)))
      throw new Error();
    const fingerprint = await fingerprintDatabase(pool);
    output = await openPrivateOutput(archivePath);
    await runPgTool(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-acl', '--no-password'],
      url,
      output.fd,
    );
    await output.sync();
    await output.close();
    output = undefined;
    const after = await fingerprintDatabase(pool);
    if (JSON.stringify(fingerprint) !== JSON.stringify(after)) throw new Error();
    const archiveSha256 = await hashPrivateFile(archivePath);
    await writePrivateJson(`${archivePath}.manifest.json`, {
      version: 1,
      format: 'SCB_FULL_CUSTOM_PG18',
      archiveSha256,
      fingerprint,
    });
    return { status: 'backed_up', archiveSha256, tables: 83 };
  } catch {
    throw new Error('Database backup failed');
  } finally {
    await output?.close();
    await pool?.end();
  }
}
if (isMain(import.meta.url))
  await runAsCli('backup', async () =>
    backupDatabase({
      databaseUrl: await readSecretEnv('DATABASE_URL'),
      archivePath: process.env.ARCHIVE_PATH,
    }),
  );
