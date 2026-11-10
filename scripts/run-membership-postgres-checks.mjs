import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const invalidTarget =
  'Membership PostgreSQL checks require an explicit loopback non-production scb_test_* control database';
const invalidArguments = 'Membership PostgreSQL checks accept only --verify-cleanup';
const failure =
  'Membership PostgreSQL isolation or cleanup failed; no control data may be changed.';
const apiDirectory = fileURLToPath(new URL('../apps/api/', import.meta.url));
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const memberTests = [
  'test/member02-membership.integration.test.ts',
  'test/member02-native.integration.test.ts',
];
const controlTables = [
  'billing_plan_versions',
  'billing_orders',
  'billing_payment_reviews',
  'billing_refunds',
  'event_entitlements',
  'event_commercial_activations',
  'billing_operations',
  'payment_notifications',
  'billing_reconciliations',
  'software_membership_periods',
  'first_run_setup',
];

/** Validate before constructing any pool. No URL-file, .env or DATABASE_URL fallback. */
export function membershipPostgresOptions(environment = process.env, args = []) {
  if (
    !Array.isArray(args) ||
    !(args.length === 0 || (args.length === 1 && args[0] === '--verify-cleanup'))
  )
    throw new Error(invalidArguments);
  try {
    const value = environment.TEST_DATABASE_URL;
    if (
      String(environment.NODE_ENV).toLowerCase() === 'production' ||
      typeof value !== 'string' ||
      !value ||
      /[?#]/.test(value)
    )
      throw new Error();
    const url = new URL(value);
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^scb_test_[A-Za-z0-9_]+$/.test(databaseName) ||
      databaseName.length > 63 ||
      url.pathname !== `/${databaseName}` ||
      url.search ||
      url.hash
    )
      throw new Error();
    return Object.freeze({
      connectionString: url.href,
      databaseName,
      verifyCleanup: args.length === 1,
    });
  } catch {
    throw new Error(invalidTarget);
  }
}

async function identity(pool, expectedName) {
  const row = (
    await pool.query(
      'SELECT current_database() AS name,oid::text AS oid FROM pg_database WHERE datname=current_database()',
    )
  ).rows[0];
  if (!row || row.name !== expectedName || !/^\d+$/.test(row.oid)) throw new Error(failure);
  return row.oid;
}

/** The control connection only reads canonical ledger/setup facts, including all organizations. */
async function controlFingerprint(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const records = [];
    for (const table of controlTables) {
      const present = (
        await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${table}`])
      ).rows[0]?.present;
      if (present !== true && present !== false) throw new Error(failure);
      if (!present) {
        records.push([table, 'ABSENT']);
        continue;
      }
      // Identifiers are only from the fixed allowlist. No row values or fingerprints are logged.
      const row = (
        await client.query(
          `SELECT count(*)::text AS count,
          md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY to_jsonb(t)::text COLLATE "C"),'')) AS digest
          FROM public."${table}" t`,
        )
      ).rows[0];
      records.push([table, row.count, row.digest]);
    }
    await client.query('COMMIT');
    return createHash('sha256').update(JSON.stringify(records)).digest('hex');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Test injection only supplies pools; the CLI cannot supply a command, test file or target override. */
export async function runMembershipPostgresChecks(
  environment = process.env,
  args = [],
  dependencies = {},
) {
  const options = membershipPostgresOptions(environment, args);
  const makePool = dependencies.createPool ?? ((input) => new pg.Pool(input));
  const control = makePool({
    connectionString: options.connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const ownedName = `scb_test_member02_${randomBytes(16).toString('hex')}`;
  let controlOid;
  let ownedOid;
  let fingerprint;
  let created = false;
  let child;
  let interrupted;
  let exitCode = 1;
  let runError;
  const interrupt = () => {
    interrupted = 'SIGINT';
    child?.kill('SIGINT');
  };
  const terminate = () => {
    interrupted = 'SIGTERM';
    child?.kill('SIGTERM');
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    controlOid = await identity(control, options.databaseName);
    fingerprint = await controlFingerprint(control);
    if (!/^scb_test_member02_[a-f0-9]{32}$/.test(ownedName) || ownedName === options.databaseName)
      throw new Error(failure);
    await control.query(`CREATE DATABASE "${ownedName}" TEMPLATE template0`);
    created = true;
    ownedOid = (
      await control.query('SELECT oid::text AS oid FROM pg_database WHERE datname=$1', [ownedName])
    ).rows[0]?.oid;
    if (!/^\d+$/.test(ownedOid)) throw new Error(failure);
    const target = new URL(options.connectionString);
    target.pathname = `/${ownedName}`;
    const probe = makePool({
      connectionString: target.href,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    try {
      if ((await identity(probe, ownedName)) !== ownedOid) throw new Error(failure);
    } finally {
      await probe.end();
    }
    console.log('[membership-pg] Dedicated database created and connected identity verified.');
    if (interrupted) exitCode = 128 + constants.signals[interrupted];
    else {
      const childEnvironment = {
        ...environment,
        NODE_ENV: 'test',
        TEST_DATABASE_URL: target.href,
        DATABASE_URL: target.href,
      };
      delete childEnvironment.DATABASE_URL_FILE;
      delete childEnvironment.TEST_DATABASE_URL_FILE;
      exitCode = await new Promise((resolveExit, reject) => {
        child = spawn(
          process.execPath,
          options.verifyCleanup
            ? ['--input-type=module', '-e', 'process.exit(23)']
            : [vitest, 'run', ...memberTests],
          { cwd: apiDirectory, env: childEnvironment, stdio: 'inherit' },
        );
        child.once('error', reject);
        child.once('close', (code, signal) =>
          resolveExit(
            interrupted
              ? 128 + constants.signals[interrupted]
              : code !== null
                ? code
                : signal && constants.signals[signal]
                  ? 128 + constants.signals[signal]
                  : 1,
          ),
        );
      });
      child = undefined;
      if (options.verifyCleanup && !interrupted && exitCode !== 23) throw new Error(failure);
    }
  } catch (error) {
    runError = error;
  } finally {
    try {
      if (created) {
        const current = (
          await control.query('SELECT oid::text AS oid FROM pg_database WHERE datname=$1', [
            ownedName,
          ])
        ).rows[0];
        if (!ownedOid || current?.oid !== ownedOid || ownedName === options.databaseName)
          throw new Error(failure);
        // No FORCE, termination of other sessions, adoption or deletion of an existing database.
        await control.query(`DROP DATABASE "${ownedName}"`);
        if (
          (await control.query('SELECT 1 FROM pg_database WHERE datname=$1', [ownedName])).rowCount
        )
          throw new Error(failure);
      }
      if (controlOid) {
        if ((await identity(control, options.databaseName)) !== controlOid)
          throw new Error(failure);
        if (fingerprint && (await controlFingerprint(control)) !== fingerprint)
          throw new Error(failure);
      }
      if (created)
        console.log(
          options.verifyCleanup && exitCode === 23
            ? '[membership-pg] Fixed child exit 23; owned cleanup and unchanged control billing/setup verified.'
            : '[membership-pg] Owned database removed; control billing/setup fingerprint unchanged.',
        );
    } catch (error) {
      runError = error;
    }
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    try {
      await control.end();
    } catch (error) {
      runError = error;
    }
  }
  if (runError) throw new Error(failure);
  return exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = await runMembershipPostgresChecks(process.env, process.argv.slice(2));
  } catch {
    // Never expose driver errors, connection strings, credentials or SQL bindings.
    console.error(failure);
    process.exitCode = 1;
  }
}
