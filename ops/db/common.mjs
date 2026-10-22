import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const restoreName = (name) =>
  typeof name === 'string' && /^scb_restore_[a-z0-9_]+$/.test(name) && name.length <= 63;
export const quoteIdentifier = (name) => {
  if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(name))
    throw new Error('Invalid database identifier');
  return `"${name}"`;
};
export const isMain = (url) =>
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(url);

export async function readSecretEnv(name, env = process.env) {
  const inline = env[name],
    file = env[`${name}_FILE`];
  if ((inline !== undefined) === (file !== undefined))
    throw new Error('Exactly one secret source is required');
  try {
    const value = (inline ?? (await readFile(file, 'utf8'))).trim();
    if (!value) throw new Error();
    return value;
  } catch {
    throw new Error('Secret configuration is unavailable');
  }
}

export function parseDatabaseUrl(value, expectedUser) {
  try {
    const url = new URL(value);
    const user = decodeURIComponent(url.username),
      password = decodeURIComponent(url.password),
      database = decodeURIComponent(url.pathname.slice(1));
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !user ||
      !password ||
      /[\r\n\0]/.test(password) ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(database) ||
      (expectedUser && user !== expectedUser) ||
      url.hash
    )
      throw new Error();
    for (const [key, option] of url.searchParams)
      if (
        key !== 'sslmode' ||
        !['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(option)
      )
        throw new Error();
    return url;
  } catch {
    throw new Error('Database configuration is invalid');
  }
}

export function sameServer(left, right, sameDatabase = true) {
  if (
    left.hostname !== right.hostname ||
    (left.port || '5432') !== (right.port || '5432') ||
    (sameDatabase && left.pathname !== right.pathname) ||
    left.search !== right.search
  )
    throw new Error('Database role endpoints do not match');
}

export function targetUrl(url, databaseName) {
  if (!restoreName(databaseName)) throw new Error('An isolated restore database name is required');
  const target = new URL(url);
  target.pathname = `/${databaseName}`;
  return target;
}

export async function assertPrivatePath(path, existing = true) {
  if (!isAbsolute(path) || resolve(path) !== path || !basename(path) || /[\r\n\0]/.test(path))
    throw new Error('A private absolute file path is required');
  const parent = dirname(path),
    directory = await lstat(parent);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o777) !== 0o700 ||
    (process.getuid && directory.uid !== process.getuid()) ||
    (await realpath(parent)) !== parent
  )
    throw new Error('Private directory permissions are required');
  try {
    const file = await lstat(path);
    if (
      !existing ||
      !file.isFile() ||
      file.isSymbolicLink() ||
      (file.mode & 0o777) !== 0o600 ||
      (process.getuid && file.uid !== process.getuid()) ||
      file.nlink !== 1
    )
      throw new Error('Private file permissions or exclusive destination are required');
  } catch (error) {
    if (!(error?.code === 'ENOENT' && !existing)) throw error;
  }
}

export async function openPrivateOutput(path) {
  await assertPrivatePath(path, false);
  return open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
}

export async function readPrivateJson(path) {
  await assertPrivatePath(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return JSON.parse(await handle.readFile('utf8'));
  } finally {
    await handle.close();
  }
}

export async function writePrivateJson(path, value) {
  const handle = await openPrivateOutput(path);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function hashPrivateFile(path) {
  await assertPrivatePath(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const hash = createHash('sha256');
    for await (const block of handle.createReadStream({ autoClose: false })) hash.update(block);
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/** libpq receives a private passfile; neither URL nor password enters argv or child output. */
export async function runPgTool(program, args, url, outputFd) {
  if (!['pg_dump', 'pg_restore'].includes(program)) throw new Error('Unsupported database utility');
  const directory = await mkdtemp(join(tmpdir(), 'scb-pg-'));
  const passfile = join(directory, 'passfile');
  const escape = (value) => value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1'),
    port = url.port || '5432';
  const database = decodeURIComponent(url.pathname.slice(1)),
    user = decodeURIComponent(url.username),
    password = decodeURIComponent(url.password);
  try {
    const handle = await open(passfile, 'wx', 0o600);
    try {
      await handle.writeFile([host, port, database, user, password].map(escape).join(':') + '\n');
    } finally {
      await handle.close();
    }
    const env = {
      PATH: process.env.PATH,
      LANG: 'C.UTF-8',
      PGHOST: host,
      PGPORT: port,
      PGDATABASE: database,
      PGUSER: user,
      PGPASSFILE: passfile,
      PGAPPNAME: 'scb_database_job',
      PGSSLMODE: url.searchParams.get('sslmode') || 'prefer',
    };
    return await new Promise((resolvePromise, reject) => {
      let output = '',
        failed = false;
      const child = spawn(program, args, {
        env,
        stdio: ['ignore', outputFd === undefined ? 'pipe' : outputFd, 'ignore'],
      });
      child.stdout?.on('data', (data) => {
        if (output.length < 2_000_000) output += data.toString();
        else {
          failed = true;
          child.kill();
        }
      });
      child.once('error', () => reject(new Error('Database utility could not start')));
      child.once('close', (code) =>
        code === 0 && !failed
          ? resolvePromise(output)
          : reject(new Error('Database utility failed')),
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function assertOwnedRestoreTarget(pool, ownership) {
  if (
    !ownership ||
    ownership.version !== 1 ||
    !restoreName(ownership.databaseName) ||
    !Number.isInteger(ownership.databaseOid) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ownership.nonce)
  )
    throw new Error('Valid restore target ownership is required');
  const row = (
    await pool.query(
      "SELECT current_database() AS name,d.oid::int AS oid,obj_description(d.oid,'pg_database') AS comment FROM pg_database d WHERE d.datname=current_database()",
    )
  ).rows[0];
  if (
    row?.name !== ownership.databaseName ||
    row.oid !== ownership.databaseOid ||
    row.comment !== `scb_restore_owner:${ownership.nonce}`
  )
    throw new Error('Restore target ownership verification failed');
}

export async function loadRestoreTarget(env = process.env) {
  const admin = parseDatabaseUrl(await readSecretEnv('DATABASE_URL', env), 'scb_admin');
  const migrator = parseDatabaseUrl(
    await readSecretEnv('DATABASE_MIGRATOR_URL', env),
    'scb_migrator',
  );
  sameServer(admin, migrator);
  const ownership = await readPrivateJson(env.RESTORE_RECEIPT_PATH || '');
  if (!restoreName(ownership.databaseName))
    throw new Error('Valid restore target ownership is required');
  const control = new Pool({ connectionString: admin.toString(), connectionTimeoutMillis: 5000 });
  let pool;
  try {
    const record = (
      await control.query(
        "SELECT oid::int AS oid,obj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname=$1",
        [ownership.databaseName],
      )
    ).rows[0];
    if (
      record?.oid !== ownership.databaseOid ||
      record.comment !== `scb_restore_owner:${ownership.nonce}`
    )
      throw new Error('Restore target ownership verification failed');
    pool = new Pool({
      connectionString: targetUrl(migrator, ownership.databaseName).toString(),
      connectionTimeoutMillis: 5000,
    });
    await assertOwnedRestoreTarget(pool, ownership);
    return {
      pool,
      ownership,
      close: async () => {
        await pool.end();
      },
    };
  } catch {
    if (pool) await pool.end();
    throw new Error('Restore target ownership verification failed');
  } finally {
    await control.end();
  }
}

export async function runAsCli(operation, action) {
  if (process.argv.length > 2) {
    process.stderr.write(`${operation} failed\n`);
    process.exitCode = 1;
    return;
  }
  try {
    const result = await action();
    process.stdout.write(`${JSON.stringify(result ?? { status: 'complete' })}\n`);
  } catch {
    process.stderr.write(`${operation} failed\n`);
    process.exitCode = 1;
  }
}
