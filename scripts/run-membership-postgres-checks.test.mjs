import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  membershipPostgresOptions,
  runMembershipPostgresChecks,
} from './run-membership-postgres-checks.mjs';

const script = fileURLToPath(new URL('./run-membership-postgres-checks.mjs', import.meta.url));
const environment = {
  TEST_DATABASE_URL: 'postgresql://fixture:synthetic@127.0.0.1:5432/scb_test_control',
  NODE_ENV: 'test',
};

test('only explicit loopback scb_test control URLs are accepted with the two fixed runner modes', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    for (const scheme of ['postgres', 'postgresql']) {
      const target = `${scheme}://fixture@${host}/scb_test_control`;
      const normal = membershipPostgresOptions({ TEST_DATABASE_URL: target });
      assert.equal(normal.databaseName, 'scb_test_control');
      assert.equal(normal.verifyCleanup, false);
      assert.equal(new URL(normal.connectionString).hostname, host);
      assert.equal(
        membershipPostgresOptions({ TEST_DATABASE_URL: target }, ['--verify-cleanup'])
          .verifyCleanup,
        true,
      );
    }
  }
});

const badTargets = [
  {},
  { DATABASE_URL: environment.TEST_DATABASE_URL },
  { TEST_DATABASE_URL_FILE: '/private/no-url-file-fallback' },
  { TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb' },
  { TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_' },
  { TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_bad-name' },
  { TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_' + 'a'.repeat(60) },
  { TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_%FF' },
  { TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_%2fescape' },
  { TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/%73cb_test_encoded' },
  { TEST_DATABASE_URL: 'postgresql://fixture@db.example.test/scb_test_control' },
  { TEST_DATABASE_URL: 'postgresql://fixture@0.0.0.0/scb_test_control' },
  { TEST_DATABASE_URL: 'postgresql://fixture@[::]/scb_test_control' },
  { TEST_DATABASE_URL: 'https://fixture@127.0.0.1/scb_test_control' },
  { TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_control?application_name=x' },
  { TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_control?' },
  { TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_control#x' },
  { TEST_DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_control#' },
  { ...environment, NODE_ENV: 'production' },
  { ...environment, NODE_ENV: 'PRODUCTION' },
];

test('unsafe or implicit database targets fail before constructing a pool', async () => {
  for (const candidate of badTargets) {
    let connected = false;
    await assert.rejects(
      runMembershipPostgresChecks(candidate, [], {
        createPool() {
          connected = true;
          throw new Error('must not connect');
        },
      }),
      /explicit loopback non-production scb_test_\*/,
    );
    assert.equal(connected, false);
  }
});

test('arguments cannot choose arbitrary tests, commands, URLs or a cleanup target before connection', async () => {
  for (const args of [
    ['--help'],
    ['--verify-cleanup', '--verify-cleanup'],
    ['--verify-cleanup=true'],
    ['--verify-cleanup', 'node'],
    ['--config', '/private/config'],
    ['--database', environment.TEST_DATABASE_URL],
    ['--', 'test/c05-commerce-payment.integration.test.ts'],
    ['test/member02-native.integration.test.ts'],
    ['-e', 'process.exit(0)'],
    null,
  ]) {
    let connected = false;
    await assert.rejects(
      runMembershipPostgresChecks(environment, args, {
        createPool() {
          connected = true;
          throw new Error('must not connect');
        },
      }),
      /accept only --verify-cleanup/,
    );
    assert.equal(connected, false);
  }
});

test('a supplied DATABASE_URL cannot override the explicitly selected test control database', () => {
  const options = membershipPostgresOptions({
    ...environment,
    DATABASE_URL: 'postgresql://private-canary@db.example.test/scb_production',
    DATABASE_URL_FILE: '/private/no-fallback',
  });
  assert.equal(new URL(options.connectionString).pathname, '/scb_test_control');
});

test('CLI invalid inputs return one fixed error without credentials, bindings or database access', () => {
  for (const args of [[], ['--verify-cleanup'], ['private-argument-canary']]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_DATABASE_URL:
          'postgresql://private-user-canary:private-password-canary@outside.example.test/scb_test_control',
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr.trim(),
      'Membership PostgreSQL isolation or cleanup failed; no control data may be changed.',
    );
    assert.equal(/private-|outside\.example/.test(result.stderr), false);
  }
});
