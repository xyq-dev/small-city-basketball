import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { migrate } from '../src/database/migrate.js';
import { seedDev } from '../src/database/seed.js';
import { bootstrapOwner } from '../src/bootstrap-owner.js';
import { FirstRunSetupService } from '../src/first-run-setup-service.js';
import { assertRegistrationAllowed, issueInitializationLink } from '../src/first-run-setup.js';
import { hashToken, verifyPassword } from '../src/security.js';
import { testDatabaseUrl } from './support.js';

const origin = 'https://setup.example.test';
const input = () => ({
  email: `setup-${randomUUID()}@example.test`,
  password: 'Synthetic owner password 🏀 2026',
  displayName: '初始化合成用户',
  organizationName: '初始化合成机构',
});
const databaseUrl = testDatabaseUrl();
let sequence = 0;

describe('durable first owner initialization with real PostgreSQL', { concurrent: false }, () => {
  let admin: Pool;
  let pool: Pool;
  let name: string;
  let service: FirstRunSetupService;
  beforeAll(() => {
    admin = new Pool({ connectionString: databaseUrl });
  });
  beforeEach(async ({ task }) => {
    name = `scb_test_setup_${randomUUID().replaceAll('-', '')}_${++sequence}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(databaseUrl);
    url.pathname = `/${name}`;
    pool = new Pool({ connectionString: url.toString() });
    if (task.name.startsWith('migration closes legacy')) {
      const directory = new URL('../migrations/', import.meta.url);
      const names = (await readdir(directory))
        .filter((n) => /^\d{3}_.*\.sql$/.test(n) && Number(n.slice(0, 3)) < 49)
        .sort();
      await pool.query(
        'CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())',
      );
      for (const migration of names) {
        const sql = await readFile(new URL(migration, directory), 'utf8');
        await pool.query(sql);
        await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
          migration,
          createHash('sha256').update(sql).digest('hex'),
        ]);
      }
    } else await migrate(pool);
    service = new FirstRunSetupService(
      pool,
      { databaseUrl: url.toString(), appOrigin: origin },
      true,
    );
  });
  afterEach(async () => {
    if (pool) await pool.end();
    if (name) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const live = await admin.query('SELECT 1 FROM pg_stat_activity WHERE datname=$1', [name]);
        if (!live.rowCount) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await admin.query(`DROP DATABASE "${name}"`);
    }
  });
  afterAll(async () => {
    await admin.end();
  });
  async function issue() {
    const result = await issueInitializationLink(pool, { enabled: true, appOrigin: origin });
    const url = new URL(result.link);
    const token = new URLSearchParams(url.hash.slice(1)).get('token')!;
    expect(url.search).toBe('');
    expect(token.length).toBe(43);
    const row = (
      await pool.query(
        'SELECT token_hash,token_expires_at,clock_timestamp() AS now FROM first_run_setup',
      )
    ).rows[0]!;
    expect(row.token_hash === hashToken(token)).toBe(true);
    const remaining = row.token_expires_at.getTime() - row.now.getTime();
    expect(remaining > 895000 && remaining <= 900000).toBe(true);
    return token;
  }
  const submit = (data: ReturnType<typeof input>, token?: string) => ({
    ...data,
    confirmPassword: data.password,
    ...(token ? { token } : {}),
  });
  async function stateCounts() {
    return (
      await pool.query(`SELECT (SELECT count(*)::int FROM organizations) AS organizations,
      (SELECT count(*)::int FROM organization_memberships) AS memberships,
      (SELECT count(*)::int FROM users) AS users,
      (SELECT initialized_at IS NOT NULL FROM first_run_setup) AS initialized,
      (SELECT token_used_at IS NOT NULL FROM first_run_setup) AS consumed`)
    ).rows[0];
  }
  test('migration closes legacy instances permanently while preserving their existing owner', async () => {
    const userId = randomUUID();
    const orgId = randomUUID();
    await pool.query(
      "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'旧合成管理员','!SYNTHETIC_NON_LOGIN_HASH_WITHOUT_PASSWORD_PADDING_000000000000000000000000000000000000000000000000000000000000000!')",
      [userId, `legacy-${userId}@example.test`],
    );
    await pool.query("INSERT INTO organizations(id,name) VALUES($1,'旧合成机构')", [orgId]);
    await pool.query(
      "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
      [orgId, userId],
    );
    await migrate(pool);
    const owner = (
      await pool.query(
        'SELECT u.id,u.login_name,u.email_verified_at,m.role FROM users u JOIN organization_memberships m ON m.user_id=u.id WHERE u.id=$1',
        [userId],
      )
    ).rows[0];
    expect(owner).toEqual({
      id: userId,
      login_name: null,
      email_verified_at: null,
      role: 'ORG_OWNER',
    });
    expect((await stateCounts()).initialized).toBe(true);
    await expect(
      issueInitializationLink(pool, { enabled: true, appOrigin: origin }),
    ).rejects.toMatchObject({ code: 'SETUP_CLOSED' });
    await pool.query('DELETE FROM organization_memberships WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM organizations WHERE id=$1', [orgId]);
    await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    await expect(
      issueInitializationLink(pool, { enabled: true, appOrigin: origin }),
    ).rejects.toMatchObject({ code: 'SETUP_CLOSED' });
  });
  test('requires deployment opt-in and valid token, creates only an unverified OWNER, permanently consumes once', async () => {
    const data = input();
    const token = await issue();
    await expect(service.initialize(submit(data), 'missing')).rejects.toMatchObject({
      code: 'SETUP_TOKEN_REJECTED',
    });
    await expect(
      service.initialize(submit(data, randomBytes(32).toString('base64url')), 'wrong'),
    ).rejects.toMatchObject({ code: 'SETUP_TOKEN_REJECTED' });
    const disabled = new FirstRunSetupService(pool, { databaseUrl, appOrigin: origin }, false);
    await expect(disabled.initialize(submit(data, token), 'disabled')).rejects.toMatchObject({
      code: 'SETUP_DISABLED',
    });
    await expect(
      issueInitializationLink(pool, { enabled: false, appOrigin: origin }),
    ).rejects.toMatchObject({ code: 'SETUP_DISABLED' });
    expect(await stateCounts()).toEqual({
      organizations: 0,
      memberships: 0,
      users: 0,
      initialized: false,
      consumed: false,
    });
    await expect(service.initialize(submit(data, token), 'valid')).resolves.toEqual({
      status: 'initialized',
    });
    expect(await stateCounts()).toEqual({
      organizations: 1,
      memberships: 1,
      users: 1,
      initialized: true,
      consumed: true,
    });
    const user = (
      await pool.query('SELECT email,email_verified_at,login_name,password_hash FROM users')
    ).rows[0]!;
    expect(user.email).toBe(data.email);
    expect(user.login_name).toBeNull();
    expect(user.email_verified_at).toBeNull();
    expect(await verifyPassword(data.password, user.password_hash)).toBe(true);
    expect(
      (await pool.query('SELECT role FROM organization_memberships')).rows.map((r) => r.role),
    ).toEqual(['ORG_OWNER']);
    const audit = (
      await pool.query('SELECT metadata FROM audit_logs WHERE action=$1', ['BOOTSTRAP_OWNER'])
    ).rows;
    expect(audit).toEqual([{ metadata: {} }]);
    service = new FirstRunSetupService(pool, { databaseUrl, appOrigin: origin }, true);
    await expect(service.initialize(submit(input(), token), 'reuse')).rejects.toMatchObject({
      code: 'SETUP_TOKEN_REJECTED',
    });
    await expect(
      issueInitializationLink(pool, { enabled: true, appOrigin: origin }),
    ).rejects.toMatchObject({ code: 'SETUP_CLOSED' });
    await expect(bootstrapOwner(pool, input())).rejects.toMatchObject({ code: 'SETUP_CLOSED' });
    await expect(
      pool.query(
        'UPDATE first_run_setup SET initialized_at=NULL,token_hash=NULL,token_expires_at=NULL,token_used_at=NULL',
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('DELETE FROM first_run_setup')).rejects.toMatchObject({
      code: '23514',
    });
  });
  test('rotation revokes old links and persisted expiry survives service recreation', async () => {
    const old = await issue();
    const token = await issue();
    await expect(service.initialize(submit(input(), old), 'rotated')).rejects.toMatchObject({
      code: 'SETUP_TOKEN_REJECTED',
    });
    await pool.query(
      "UPDATE first_run_setup SET token_expires_at=clock_timestamp()-interval '1 second'",
    );
    service = new FirstRunSetupService(pool, { databaseUrl, appOrigin: origin }, true);
    await expect(service.initialize(submit(input(), token), 'expired')).rejects.toMatchObject({
      code: 'SETUP_TOKEN_REJECTED',
    });
    expect((await stateCounts()).initialized).toBe(false);
  });
  test('form errors and invalid-link throttling create no identities or consumed state', async () => {
    const token = await issue();
    const owner = input();
    await expect(
      service.initialize({ ...submit(owner, token), confirmPassword: 'mismatch' }, 'confirmation'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.initialize({ ...submit(owner, token), userId: randomUUID() }, 'extra-field'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    for (let attempt = 0; attempt < 10; attempt++)
      await expect(service.initialize({}, 'limited')).rejects.toMatchObject({
        code: 'SETUP_TOKEN_REJECTED',
      });
    await expect(service.initialize({}, 'limited')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(await stateCounts()).toEqual({
      organizations: 0,
      memberships: 0,
      users: 0,
      initialized: false,
      consumed: false,
    });
  });
  test('a link expiring while waiting for the mutex is rejected by the database clock', async () => {
    const token = await issue();
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT singleton FROM first_run_setup FOR UPDATE');
    const pending = service.initialize(submit(input(), token), 'expires-on-lock').then(
      () => 'success',
      (e: unknown) => (e as { code?: string }).code,
    );
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 500; attempt++) {
        const row =
          await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE 'SELECT initialized_at,token_hash,token_expires_at,token_used_at FROM first_run_setup%'`);
        if (row.rowCount) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await blocker.query(
        "UPDATE first_run_setup SET token_expires_at=clock_timestamp()-interval '1 second'",
      );
    } finally {
      await blocker.query('COMMIT');
      blocker.release();
    }
    expect(await pending).toBe('SETUP_TOKEN_REJECTED');
    expect((await stateCounts()).initialized).toBe(false);
    expect((await stateCounts()).consumed).toBe(false);
  });
  test('any real preexisting user, including disabled accounts, prevents both issuing and legacy CLI takeover', async () => {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO users(id,email,display_name,password_hash,status) VALUES($1,$2,'普通停用用户','!SYNTHETIC_NON_LOGIN_HASH_WITHOUT_PASSWORD_PADDING_000000000000000000000000000000000000000000000000000000000000000!','DISABLED')",
      [id, `disabled-${id}@example.test`],
    );
    await expect(
      issueInitializationLink(pool, { enabled: true, appOrigin: origin }),
    ).rejects.toMatchObject({ code: 'SETUP_CLOSED' });
    await expect(bootstrapOwner(pool, input())).rejects.toMatchObject({ code: 'SETUP_CLOSED' });
    expect((await stateCounts()).users).toBe(1);
  });
  test('distinguishes the exact existing non-login system actor from a real account', async () => {
    const id = randomUUID();
    const sentinel = `!SCB_DISABLED_COMMERCE_ACTOR!${randomBytes(64).toString('base64url')}`;
    await pool.query(
      "INSERT INTO users(id,email,display_name,password_hash,status) VALUES($1,$2,'商业账本系统主体',$3,'DISABLED')",
      [id, `commerce-system-${id}@system.invalid`, sentinel],
    );
    const token = await issue();
    await service.initialize(submit(input(), token), 'system-only');
    expect(await stateCounts()).toEqual({
      organizations: 1,
      memberships: 1,
      users: 2,
      initialized: true,
      consumed: true,
    });
  });
  test('audit failure rolls back every created row, consumption and closure, allowing retry with the same link', async () => {
    const token = await issue();
    await pool.query(`CREATE FUNCTION setup_test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$;
      CREATE TRIGGER setup_test_audit_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION setup_test_audit_fail()`);
    await expect(service.initialize(submit(input(), token), 'rollback')).rejects.toThrow();
    expect(await stateCounts()).toEqual({
      organizations: 0,
      memberships: 0,
      users: 0,
      initialized: false,
      consumed: false,
    });
    await pool.query(
      'DROP TRIGGER setup_test_audit_fail ON audit_logs; DROP FUNCTION setup_test_audit_fail()',
    );
    await service.initialize(submit(input(), token), 'retry');
    expect((await stateCounts()).initialized).toBe(true);
  });
  async function raceAtMutex(jobs: (() => Promise<unknown>)[]) {
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT singleton FROM first_run_setup FOR UPDATE');
    const results = Promise.allSettled(jobs.map((job) => job()));
    try {
      let bothWaiting = false;
      for (let attempt = 0; attempt < 500; attempt++) {
        const waiting = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE 'SELECT initialized_at,token_hash,token_expires_at,token_used_at FROM first_run_setup%'`);
        if (waiting.rows[0].n >= jobs.length) {
          bothWaiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(bothWaiting).toBe(true);
    } finally {
      await blocker.query('COMMIT');
      blocker.release();
    }
    return results;
  }
  test('development seed closes first-run setup through the same gate and then permits ordinary registration', async () => {
    await seedDev(pool, 'Synthetic development fixture password 2026');
    expect((await stateCounts()).initialized).toBe(true);
    await expect(
      issueInitializationLink(pool, { enabled: true, appOrigin: origin }),
    ).rejects.toMatchObject({ code: 'SETUP_CLOSED' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assertRegistrationAllowed(client);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
  test('two concurrent web submissions can initialize only once', async () => {
    const token = await issue();
    const results = await raceAtMutex([
      () => service.initialize(submit(input(), token), 'web-a'),
      () => service.initialize(submit(input(), token), 'web-b'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await stateCounts()).toEqual({
      organizations: 1,
      memberships: 1,
      users: 1,
      initialized: true,
      consumed: true,
    });
  });
  test('legacy CLI and web initialization share the same atomic close', async () => {
    const token = await issue();
    const results = await raceAtMutex([
      () => bootstrapOwner(pool, input()),
      () => service.initialize(submit(input(), token), 'web-race'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await stateCounts()).organizations).toBe(1);
    expect((await stateCounts()).initialized).toBe(true);
  });
  test('public registration must hold the same mutex and rejects an incomplete instance', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(assertRegistrationAllowed(client)).rejects.toMatchObject({
        code: 'SETUP_REQUIRED',
      });
      await client.query('ROLLBACK');
      await bootstrapOwner(pool, input());
      await client.query('BEGIN');
      await assertRegistrationAllowed(client);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});
