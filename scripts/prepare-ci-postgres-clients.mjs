import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, chmod, mkdir, mkdtemp, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const IMAGE = 'postgres:18.6-alpine3.24';
const PG_ENV = [
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PGPASSFILE',
  'PGSSLMODE',
  'PGAPPNAME',
];
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

// Only the owned archive directory is mounted. The database is the job's loopback service;
// these clients never need the repository, Docker socket, runner home or all of RUNNER_TEMP.
export function pgClientScript(tool, workDirectory, uid, gid) {
  assert.ok(['pg_dump', 'pg_restore'].includes(tool), 'Unsupported PostgreSQL client');
  assert.ok(
    path.isAbsolute(workDirectory) &&
      path.resolve(workDirectory) === workDirectory &&
      !/[,:\r\n\0]/.test(workDirectory),
    'Invalid archive directory',
  );
  assert.ok(Number.isSafeInteger(uid) && uid > 0, 'A non-root runner is required');
  assert.ok(Number.isSafeInteger(gid) && gid >= 0, 'Invalid runner group');
  const args = [
    'run',
    '--rm',
    '--network',
    'host',
    '--user',
    `${uid}:${gid}`,
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--mount',
    `type=bind,src=${workDirectory},dst=${workDirectory}`,
    '--workdir',
    workDirectory,
    ...PG_ENV.flatMap((name) => ['--env', name]),
    '--entrypoint',
    tool,
    IMAGE,
  ];
  return `#!/bin/sh\nset -eu\nexec docker ${args.map(quote).join(' ')} "$@"\n`;
}

export function isolatedDatabaseUrl(value) {
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Invalid test database');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Loopback is required');
  assert.match(decodeURIComponent(url.pathname), /^\/scb_test_[a-z0-9_]+$/);
  assert.ok(
    url.username && url.password && !url.hash && !url.search,
    'Invalid test database credentials or options',
  );
  return url;
}

export async function prepareCiPostgresClients(env = process.env) {
  assert.equal(env.CI, 'true', 'Isolated CI runner is required');
  assert.ok(env.RUNNER_TEMP && env.GITHUB_ENV && env.GITHUB_PATH, 'Runner files are required');
  const runnerTemporary = await realpath(env.RUNNER_TEMP);
  assert.ok((await stat(runnerTemporary)).isDirectory(), 'Runner temporary directory is required');
  const databaseUrl = isolatedDatabaseUrl(env.TEST_DATABASE_URL);
  const directory = await mkdtemp(path.join(runnerTemporary, 'scb-pg-clients-'));
  await chmod(directory, 0o700);
  const bin = path.join(directory, 'bin');
  const work = path.join(directory, 'work');
  await mkdir(bin, { mode: 0o700 });
  await mkdir(work, { mode: 0o700 });
  for (const tool of ['pg_dump', 'pg_restore']) {
    const file = path.join(bin, tool);
    await writeFile(file, pgClientScript(tool, work, process.getuid(), process.getgid()), {
      mode: 0o700,
      flag: 'wx',
    });
    const result = spawnSync(file, ['--version'], { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, 'PostgreSQL client could not start');
    assert.match(result.stdout, /\(PostgreSQL\) 18\.6\b/, 'Unexpected PostgreSQL client version');
  }
  const pool = new pg.Pool({ connectionString: databaseUrl.href, connectionTimeoutMillis: 5000 });
  try {
    const version = (await pool.query("SELECT current_setting('server_version_num')::int n"))
      .rows[0].n;
    assert.ok(version >= 180000 && version < 190000, 'PostgreSQL 18 test service is required');
    // The role is created only in this job's disposable service. The upgrade test grants
    // its newly owned restored database's table access; it does not need a superuser role.
    const existing = await pool.query(
      "SELECT rolsuper,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='scb_migrator'",
    );
    if (!existing.rowCount)
      await pool.query(
        'CREATE ROLE scb_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      );
    else assert.ok(Object.values(existing.rows[0]).every((value) => value === false));
    const access = (await pool.query("SELECT pg_has_role(current_user,'scb_migrator','MEMBER') ok"))
      .rows[0].ok;
    assert.equal(access, true, 'Test owner must be able to assume the offline restore role');
  } finally {
    await pool.end();
  }
  await appendFile(
    env.GITHUB_ENV,
    `SCB_PG_BIN=${bin}\nSCB_PG_WORK_DIRECTORY=${work}\nSCB_REQUIRE_ARCHIVE_RESTORE=1\n`,
  );
  await appendFile(env.GITHUB_PATH, `${bin}\n`);
  console.log('PostgreSQL 18.6 archive clients and isolated offline restore role are ready.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await prepareCiPostgresClients();
  } catch {
    // Do not emit connection URLs, libpq errors or inherited process credentials.
    console.error('Isolated PostgreSQL archive client setup failed.');
    process.exitCode = 1;
  }
}
