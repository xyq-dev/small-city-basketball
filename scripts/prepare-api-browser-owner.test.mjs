import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { browserFixtureDatabaseUrl, prepareApiBrowserOwner } from './prepare-api-browser-owner.mjs';

const environment = { DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_browser_fixture' };
const script = fileURLToPath(new URL('./prepare-api-browser-owner.mjs', import.meta.url));

test('accepts only explicit isolated PostgreSQL targets and does not load a URL file', () => {
  assert.equal(
    new URL(browserFixtureDatabaseUrl(environment)).pathname,
    '/scb_test_browser_fixture',
  );
  for (const candidate of [
    {},
    { DATABASE_URL_FILE: '/private/database-url' },
    { DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb' },
    { DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_bad-name' },
    { DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_%2Fescape' },
    { DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_%FF' },
    { DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_' + 'a'.repeat(60) },
    { DATABASE_URL: 'https://fixture@127.0.0.1/scb_test_browser' },
    { DATABASE_URL: 'postgresql://fixture@127.0.0.1/scb_test_browser#secret' },
    { ...environment, NODE_ENV: 'production' },
  ]) {
    assert.throws(() => browserFixtureDatabaseUrl(candidate), /isolated non-production/);
  }
});

test('rejects an unsafe environment before any database connection or initialization', async () => {
  let connected = false;
  await assert.rejects(
    prepareApiBrowserOwner(
      { ...environment, NODE_ENV: 'production' },
      {
        createPool() {
          connected = true;
          throw new Error();
        },
      },
    ),
    /isolated non-production/,
  );
  assert.equal(connected, false);
});

test('uses real bootstrap semantics with random memory-only credentials and closes its pool', async () => {
  let initialized = 0;
  let ended = false;
  const identities = [];
  const pool = {
    async query(sql) {
      assert.equal(sql, 'SELECT initialized_at FROM first_run_setup WHERE singleton=true');
      return { rows: [{ initialized_at: null }] };
    },
    async end() {
      ended = true;
    },
  };
  const dependencies = {
    createPool(options) {
      assert.equal(new URL(options.connectionString).pathname, '/scb_test_browser_fixture');
      return pool;
    },
    async bootstrapOwner(current, input) {
      assert.equal(current, pool);
      assert.equal(
        Object.keys(input).sort().join(','),
        'displayName,email,organizationName,password',
      );
      assert.equal(/^[A-Za-z0-9_-]{64}$/.test(input.password), true);
      assert.equal(/^browser-bootstrap-[a-f0-9]{32}@example.test$/.test(input.email), true);
      assert.equal(input.displayName, '隔离浏览器初始化负责人');
      initialized += 1;
      identities.push(input);
    },
  };
  await prepareApiBrowserOwner(environment, dependencies);
  await prepareApiBrowserOwner(environment, dependencies);
  assert.equal(initialized, 2);
  assert.equal(ended, true);
  assert.equal(identities[0].password === identities[1].password, false);
  assert.equal(identities[0].email === identities[1].email, false);
});

test('an already completed instance is left untouched without initializing again', async () => {
  let ended = false;
  const pool = {
    async query() {
      return { rows: [{ initialized_at: new Date() }] };
    },
    async end() {
      ended = true;
    },
  };
  await prepareApiBrowserOwner(environment, {
    createPool: () => pool,
    bootstrapOwner: async () => {
      assert.fail('Existing initialization must not reopen');
    },
  });
  assert.equal(ended, true);
});

test('a concurrently completed fixture is accepted only after rereading durable completion', async () => {
  let reads = 0;
  const pool = {
    async query() {
      return { rows: [{ initialized_at: reads++ ? new Date() : null }] };
    },
    async end() {},
  };
  await prepareApiBrowserOwner(environment, {
    createPool: () => pool,
    bootstrapOwner: async () => {
      throw Object.assign(new Error(), { code: 'SETUP_CLOSED' });
    },
  });
  assert.equal(reads, 2);
});

test('closed but uninitialized instances, absent setup state, and transaction failures fail closed', async () => {
  for (const mode of ['closed', 'missing', 'failed']) {
    let ended = false;
    const pool = {
      async query() {
        return { rows: mode === 'missing' ? [] : [{ initialized_at: null }] };
      },
      async end() {
        ended = true;
      },
    };
    await assert.rejects(
      prepareApiBrowserOwner(environment, {
        createPool: () => pool,
        bootstrapOwner: async () => {
          throw Object.assign(new Error(), { code: mode === 'closed' ? 'SETUP_CLOSED' : 'FAILED' });
        },
      }),
    );
    assert.equal(ended, true);
  }
});

test('CLI rejection is fixed copy, omits supplied secrets and does not accept connection arguments', () => {
  for (const args of [[], ['private-cli-canary']]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://private-url-canary:private-password-canary@localhost/scb',
        NODE_ENV: 'test',
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr.trim(),
      'API browser owner preparation failed; verify the isolated database and migrations.',
    );
    assert.equal(result.stderr.includes('private-'), false);
  }
});
