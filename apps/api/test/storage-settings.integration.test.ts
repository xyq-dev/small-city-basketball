import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { StorageSettingsTest } from '@small-city-basketball/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { migrate } from '../src/database/migrate.js';
import { StorageSettingsService } from '../src/storage-settings/service.js';
import { createStorageSettingsResolver } from '../src/storage-settings/runtime.js';
import { STORAGE_CONFIGURATION_LOCK } from '../src/storage-settings/locking.js';
import { testDatabaseUrl } from './support.js';
import type { CosObjectStore, TencentCosOptions } from '../src/cos-storage.js';

// This suite owns an isolated schema inside the explicit scb_test_* database. No real COS
// transport is instantiated. Global configuration from this suite cannot affect other fixtures.
describe('platform storage settings PostgreSQL lifecycle', { concurrent: false }, () => {
  let admin: Pool,
    pool: Pool,
    service: StorageSettingsService,
    cookie: string,
    otherCookie: string,
    actor: string,
    databaseUrl: string;
  const schema = `scb_cos02_${randomUUID().replaceAll('-', '')}`;
  let schemaCreated = false;
  const objects = new Map<string, Buffer>();
  let unknownPut = false,
    denyDelete = false,
    receivedOptions: TencentCosOptions[] = [];
  const put = vi.fn(async (key: string, bytes: Buffer) => {
    objects.set(key, Buffer.from(bytes));
    if (unknownPut) throw new Error('synthetic unknown PUT outcome');
  });
  const get = vi.fn(async ({ key }: { key: string }) => Buffer.from(objects.get(key)!));
  const remove = vi.fn(async ({ key }: { key: string }) => {
    if (denyDelete) throw new Error('synthetic denied delete');
    objects.delete(key);
  });
  const verify = vi.fn(async () => {});
  const factory = (o: TencentCosOptions): CosObjectStore => {
    receivedOptions.push(o);
    return {
      bucket: o.bucket,
      region: o.region,
      prefix: o.prefix,
      put,
      get,
      delete: remove,
      verifyConfiguration: verify,
    } as CosObjectStore;
  };
  const destination = { bucket: 'synthetic-12345', region: 'ap-guangzhou', prefix: 'scb-media/v1' };
  const save = (expectedVersion = 0, extra: object = {}) =>
    service.saveDraft(cookie, {
      commandId: randomUUID(),
      expectedVersion,
      ...destination,
      secretId: 'synthetic-id',
      secretKey: 'synthetic-key',
      ...extra,
    });
  const check = (version: number) =>
    service.testConnection(cookie, {
      commandId: randomUUID(),
      configVersion: version,
      confirmCloudTest: true,
    });
  beforeAll(async () => {
    vi.stubEnv('SCB_STORAGE_CONFIG_KEY', 'a5'.repeat(32));
    vi.stubEnv('SCB_STORAGE_CONFIG_KEY_FILE', undefined);
    const url = new URL(testDatabaseUrl());
    admin = new Pool({ connectionString: url.toString() });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    url.searchParams.set('options', `-c search_path=${schema}`);
    databaseUrl = url.toString();
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    await migrate(pool);
    const createUser = async (platform: boolean) => {
      const id = randomUUID(),
        token = randomBytes(32).toString('base64url');
      await pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [id, `${id}@example.test`, 'synthetic fixture', 'x'.repeat(100)],
      );
      await pool.query(
        "INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
        [randomUUID(), id, createHash('sha256').update(token).digest('hex')],
      );
      if (platform)
        await pool.query(
          "INSERT INTO platform_operators(user_id,status,maintenance_actor_id,reason) VALUES($1,'ACTIVE',$2,'Synthetic test only')",
          [id, randomUUID()],
        );
      return { id, cookie: `scb.sid=${token}` };
    };
    const owner = await createUser(true);
    actor = owner.id;
    cookie = owner.cookie;
    otherCookie = (await createUser(false)).cookie;
    const org = randomUUID();
    await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
      org,
      'synthetic institution',
    ]);
    await pool.query(
      "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
      [
        org,
        (
          await pool.query('SELECT user_id FROM sessions WHERE token_hash=$1', [
            createHash('sha256').update(otherCookie.slice(8)).digest('hex'),
          ])
        ).rows[0].user_id,
      ],
    );
    // Remove the real 30-second rate window only for this schema's synthetic fixtures.
    await pool.query(
      `CREATE FUNCTION test_age_storage_command() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.created_at=clock_timestamp()-interval '31 seconds';RETURN NEW;END;$$;CREATE TRIGGER test_age_storage_command BEFORE INSERT ON storage_config_operations FOR EACH ROW EXECUTE FUNCTION test_age_storage_command()`,
    );
    service = new StorageSettingsService(
      pool,
      { databaseUrl, appOrigin: 'http://localhost:5173' },
      { storeFactory: factory, fallbackStore: () => undefined },
    );
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE storage_config_probes,storage_config_operations,storage_config_state,storage_config_revisions',
    );
    await pool.query('INSERT INTO storage_config_state(singleton) VALUES(true)');
    // Only this suite's explicitly owned schema is cleared, including registry fixtures.
    await pool.query('TRUNCATE media_cos_objects CASCADE');
    objects.clear();
    unknownPut = false;
    denyDelete = false;
    receivedOptions = [];
    put.mockClear();
    get.mockClear();
    remove.mockClear();
    verify.mockClear();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (pool) await pool.end();
    if (admin) {
      if (schemaCreated) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });
  test('platform authority, encrypted draft, CAS, receipt replay, no activation from save', async () => {
    await expect(service.snapshot(otherCookie)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.saveDraft(otherCookie, {
        commandId: randomUUID(),
        expectedVersion: 0,
        ...destination,
        secretId: 'synthetic-id',
        secretKey: 'synthetic-key',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const input = {
      commandId: randomUUID(),
      expectedVersion: 0,
      ...destination,
      secretId: 'synthetic-id',
      secretKey: 'synthetic-key',
    };
    const result = await service.saveDraft(cookie, input);
    expect(await service.saveDraft(cookie, input)).toEqual(result);
    await expect(
      service.saveDraft(cookie, { ...input, secretKey: 'different' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(save(0)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const snapshot = await service.snapshot(cookie);
    expect(snapshot).toMatchObject({
      version: 1,
      draft: { version: 1, credentialsConfigured: true },
      active: { provider: 'DATABASE', source: 'ENVIRONMENT', version: null, applied: true },
    });
    expect(JSON.stringify(snapshot)).not.toContain('synthetic-key');
    const rows = await pool.query(
      'SELECT credentials_ciphertext,credentials_nonce,credentials_tag FROM storage_config_revisions',
    );
    expect(rows.rows[0].credentials_ciphertext.includes(Buffer.from('synthetic-key'))).toBe(false);
    expect(rows.rows[0].credentials_nonce.length).toBe(12);
    expect(await service.operation(cookie, input.commandId)).toEqual(result);
    await expect(service.operation(otherCookie, input.commandId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(put).not.toHaveBeenCalled();
  });
  test('saved revision test passes only actual roundtrip and delete, activate applies resolver', async () => {
    await save();
    const tested = await check(1);
    expect(tested).toMatchObject({ status: 'SUCCEEDED', configVersion: 1 });
    expect(verify).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(
      receivedOptions.some(
        (o) => (o as TencentCosOptions & { timeoutMs?: number }).timeoutMs === 5000,
      ),
    ).toBe(true);
    expect((await service.snapshot(cookie)).test).toMatchObject({
      status: 'PASSED',
      cleanupPending: false,
      configVersion: 1,
    });
    const activation = {
      commandId: randomUUID(),
      expectedVersion: 1,
      configVersion: 1,
      testId: tested.testId,
      privatePolicyConfirmed: true,
    };
    expect(await service.activate(cookie, activation)).toMatchObject({ status: 'SUCCEEDED' });
    expect(await service.activate(cookie, activation)).toMatchObject({ status: 'SUCCEEDED' });
    expect((await service.snapshot(cookie)).active).toMatchObject({
      source: 'ADMIN',
      provider: 'COS',
      version: 1,
      applied: true,
    });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock_shared($1)', [STORAGE_CONFIGURATION_LOCK]);
      expect(
        await createStorageSettingsResolver(
          pool,
          () => {
            throw new Error('must not fallback');
          },
          factory,
        )(c),
      ).toMatchObject(destination);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
  test('new saved credentials invalidate old test and empty pair retains saved credentials', async () => {
    await save();
    const tested = await check(1);
    await save(1, { secretId: '', secretKey: '' });
    await expect(
      service.activate(cookie, {
        commandId: randomUUID(),
        expectedVersion: 2,
        configVersion: 2,
        testId: tested.testId,
        privatePolicyConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_TEST_REQUIRED' });
    await expect(save(2, { secretId: '', secretKey: 'partial' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const tested2 = await check(2);
    expect(tested2.status).toBe('SUCCEEDED');
    expect(receivedOptions.at(-1)).toMatchObject({
      secretId: 'synthetic-id',
      secretKey: 'synthetic-key',
    });
  });
  test('unknown PUT is not deleted, blocks activation and destination change for 24 hours', async () => {
    await save();
    unknownPut = true;
    const result = await check(1);
    expect(result.status).toBe('FAILED');
    expect(remove).not.toHaveBeenCalled();
    expect(await service.snapshot(cookie)).toMatchObject({
      cleanupPending: true,
      destinationLocked: true,
      test: { status: 'FAILED', cleanupPending: true },
    });
    await expect(save(1, { bucket: 'other-12345' })).rejects.toMatchObject({
      code: 'STORAGE_DESTINATION_LOCKED',
    });
    unknownPut = false;
    const retried = await check(1);
    expect(retried).toMatchObject({ status: 'FAILED', error: { code: 'STORAGE_CLEANUP_PENDING' } });
    expect(put).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    await expect(
      service.activate(cookie, {
        commandId: randomUUID(),
        expectedVersion: 1,
        configVersion: 1,
        testId: result.testId,
        privatePolicyConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_CLEANUP_PENDING' });
    await expect(
      pool.query(
        'UPDATE storage_config_probes SET deleted_at=clock_timestamp() WHERE deleted_at IS NULL',
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
  test('confirmed PUT delete failure is durable, credential rotation cleans old object first', async () => {
    await save();
    denyDelete = true;
    expect((await check(1)).status).toBe('FAILED');
    const prior = (
      await pool.query(
        'SELECT id,put_confirmed_at,deleted_at,cleanup_attempted_at::text AS attempted FROM storage_config_probes',
      )
    ).rows[0];
    expect(prior).toMatchObject({
      put_confirmed_at: expect.any(Date),
      deleted_at: null,
      attempted: expect.any(String),
    });
    await save(1, { secretId: 'rotated-id', secretKey: 'rotated-key' });
    denyDelete = false;
    remove.mockClear();
    expect((await check(2)).status).toBe('SUCCEEDED');
    expect(remove).toHaveBeenCalledTimes(2);
    expect((await service.snapshot(cookie)).cleanupPending).toBe(false);
    expect(
      (
        await pool.query(
          'SELECT deleted_at,cleanup_attempted_at::text AS attempted FROM storage_config_probes WHERE id=$1',
          [prior.id],
        )
      ).rows[0],
    ).toMatchObject({ deleted_at: expect.any(Date), attempted: prior.attempted });
    expect(receivedOptions.at(-1)).toMatchObject({
      secretId: 'rotated-id',
      secretKey: 'rotated-key',
    });
    expect(
      (await pool.query('SELECT 1 FROM storage_config_probes WHERE deleted_at IS NULL')).rowCount,
    ).toBe(0);
  });
  test('pending B cleanup remains possible after active A gains its first business registration', async () => {
    await save();
    const testedA = await check(1);
    await service.activate(cookie, {
      commandId: randomUUID(),
      expectedVersion: 1,
      configVersion: 1,
      testId: testedA.testId,
      privatePolicyConfirmed: true,
    });
    const targetB = { ...destination, bucket: 'other-12345' };
    await save(2, targetB);
    denyDelete = true;
    const testedB = await check(3);
    expect(testedB.status).toBe('FAILED');
    const pendingB = (
      await pool.query(
        'SELECT bucket,region,object_key FROM storage_config_probes WHERE deleted_at IS NULL',
      )
    ).rows[0];
    expect(pendingB.bucket).toBe(targetB.bucket);
    denyDelete = false;
    const organizationId = randomUUID(),
      businessId = randomUUID(),
      businessKey = `${destination.prefix}/${organizationId}/${businessId}/${randomUUID()}`;
    // A real durable business registry row exercises the first-upload address lock.
    // This suite's owned schema is cleared in finally without relaxing the 050 guard.
    await pool.query(
      'INSERT INTO media_cos_objects(id,org_id,bucket,region,object_key) VALUES($1,$2,$3,$4,$5)',
      [businessId, organizationId, destination.bucket, destination.region, businessKey],
    );
    try {
      await expect(
        service.activate(cookie, {
          commandId: randomUUID(),
          expectedVersion: 3,
          configVersion: 3,
          testId: testedB.testId,
          privatePolicyConfirmed: true,
        }),
      ).rejects.toMatchObject({ code: 'STORAGE_DESTINATION_LOCKED' });
      await expect(save(3)).rejects.toMatchObject({ code: 'STORAGE_DESTINATION_LOCKED' });
      await expect(save(3, { ...targetB, bucket: 'third-12345' })).rejects.toMatchObject({
        code: 'STORAGE_DESTINATION_LOCKED',
      });
      expect(
        await save(3, { ...targetB, secretId: 'rotated-b-id', secretKey: 'rotated-b-key' }),
      ).toMatchObject({ status: 'SUCCEEDED', configVersion: 4 });
      const probeCount = (
        await pool.query('SELECT count(*)::int AS count FROM storage_config_probes')
      ).rows[0].count;
      put.mockClear();
      get.mockClear();
      remove.mockClear();
      verify.mockClear();
      const cleaned = await check(4);
      expect(cleaned).toMatchObject({
        status: 'FAILED',
        error: { code: 'STORAGE_DESTINATION_LOCKED' },
      });
      expect(remove).toHaveBeenCalledExactlyOnceWith({
        bucket: pendingB.bucket,
        region: pendingB.region,
        key: pendingB.object_key,
      });
      expect(put).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM storage_config_probes')).rows[0]
          .count,
      ).toBe(probeCount);
      expect(
        (await pool.query('SELECT deleted_at FROM media_cos_objects WHERE id=$1', [businessId]))
          .rows[0].deleted_at,
      ).toBeNull();
      expect(receivedOptions.at(-1)).toMatchObject({
        bucket: targetB.bucket,
        secretId: 'rotated-b-id',
        secretKey: 'rotated-b-key',
      });
      expect(await service.snapshot(cookie)).toMatchObject({
        cleanupPending: false,
        active: { source: 'ADMIN', version: 1, destination, applied: true },
        test: {
          status: 'FAILED',
          cleanupPending: false,
          checks: [
            { key: 'DESTINATION', status: 'FAILED' },
            { key: 'VERSIONING', status: 'NOT_RUN' },
            { key: 'ROUND_TRIP', status: 'NOT_RUN' },
            { key: 'DELETE', status: 'NOT_RUN' },
          ],
        },
      });
      await expect(
        service.activate(cookie, {
          commandId: randomUUID(),
          expectedVersion: 4,
          configVersion: 4,
          testId: cleaned.testId,
          privatePolicyConfirmed: true,
        }),
      ).rejects.toMatchObject({ code: 'STORAGE_DESTINATION_LOCKED' });
      await expect(save(4, targetB)).rejects.toMatchObject({ code: 'STORAGE_DESTINATION_LOCKED' });
      await expect(check(4)).rejects.toMatchObject({ code: 'STORAGE_DESTINATION_LOCKED' });
      expect(put).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledTimes(1);
      expect(await save(4)).toMatchObject({ status: 'SUCCEEDED', configVersion: 5 });
    } finally {
      await pool.query('TRUNCATE media_cos_objects CASCADE');
    }
  });
  test('active A business files do not bypass a pending B unknown PUT grace period', async () => {
    await save();
    const testedA = await check(1);
    await service.activate(cookie, {
      commandId: randomUUID(),
      expectedVersion: 1,
      configVersion: 1,
      testId: testedA.testId,
      privatePolicyConfirmed: true,
    });
    const targetB = { ...destination, bucket: 'other-12345' };
    await save(2, targetB);
    unknownPut = true;
    const testedB = await check(3);
    expect(testedB.status).toBe('FAILED');
    unknownPut = false;
    const organizationId = randomUUID(),
      businessId = randomUUID();
    await pool.query(
      'INSERT INTO media_cos_objects(id,org_id,bucket,region,object_key) VALUES($1,$2,$3,$4,$5)',
      [
        businessId,
        organizationId,
        destination.bucket,
        destination.region,
        `${destination.prefix}/${organizationId}/${businessId}/${randomUUID()}`,
      ],
    );
    try {
      expect(
        await save(3, { ...targetB, secretId: 'rotated-b-id', secretKey: 'rotated-b-key' }),
      ).toMatchObject({ status: 'SUCCEEDED', configVersion: 4 });
      put.mockClear();
      get.mockClear();
      remove.mockClear();
      verify.mockClear();
      expect(await check(4)).toMatchObject({
        status: 'FAILED',
        error: { code: 'STORAGE_CLEANUP_PENDING' },
      });
      expect(put).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
      expect(
        (
          await pool.query(
            "SELECT put_confirmed_at,deleted_at,created_at>clock_timestamp()-interval '24 hours' AS within_grace FROM storage_config_probes WHERE deleted_at IS NULL",
          )
        ).rows[0],
      ).toMatchObject({ put_confirmed_at: null, deleted_at: null, within_grace: true });
      expect(await service.snapshot(cookie)).toMatchObject({
        cleanupPending: true,
        active: { source: 'ADMIN', version: 1, destination, applied: true },
      });
      await expect(save(4)).rejects.toMatchObject({ code: 'STORAGE_DESTINATION_LOCKED' });
      await expect(
        service.activate(cookie, {
          commandId: randomUUID(),
          expectedVersion: 4,
          configVersion: 4,
          testId: testedB.testId,
          privatePolicyConfirmed: true,
        }),
      ).rejects.toMatchObject({ code: 'STORAGE_DESTINATION_LOCKED' });
    } finally {
      await pool.query('TRUNCATE media_cos_objects CASCADE');
    }
  });
  test('probe transitions preserve failed cleanup time and reject changing its history', async () => {
    await save();
    const operationId = randomUUID(),
      probeId = randomUUID(),
      revisionId = (await pool.query('SELECT id FROM storage_config_revisions')).rows[0].id;
    await pool.query(
      `INSERT INTO storage_config_operations(id,actor_id,command_id,request_hash,kind,status,config_version) VALUES($1,$2,$3,$4,'TEST','PENDING',1)`,
      [operationId, actor, randomUUID(), '0'.repeat(64)],
    );
    await pool.query(
      'INSERT INTO storage_config_probes(id,operation_id,revision_id,bucket,region,prefix,object_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        probeId,
        operationId,
        revisionId,
        destination.bucket,
        destination.region,
        destination.prefix,
        `${destination.prefix}/${randomUUID()}/${randomUUID()}/${probeId}`,
      ],
    );
    await pool.query(
      'UPDATE storage_config_probes SET cleanup_attempted_at=clock_timestamp() WHERE id=$1',
      [probeId],
    );
    const attempted = (
      await pool.query(
        'SELECT cleanup_attempted_at::text AS attempted FROM storage_config_probes WHERE id=$1',
        [probeId],
      )
    ).rows[0].attempted;
    // Each negative case runs while the row is still undeleted, so the cleanup-clock
    // guard itself must reject the mutation rather than the terminal-row guard.
    for (const statement of [
      'UPDATE storage_config_probes SET cleanup_attempted_at=NULL WHERE id=$1',
      "UPDATE storage_config_probes SET cleanup_attempted_at=cleanup_attempted_at-interval '1 microsecond' WHERE id=$1",
      "UPDATE storage_config_probes SET cleanup_attempted_at=clock_timestamp()+interval '1 day' WHERE id=$1",
    ])
      await expect(pool.query(statement, [probeId])).rejects.toMatchObject({
        code: '23514',
        message: 'Storage probe cleanup clock must advance',
      });
    await expect(
      pool.query('UPDATE storage_config_probes SET deleted_at=clock_timestamp() WHERE id=$1', [
        probeId,
      ]),
    ).rejects.toMatchObject({
      code: '23514',
      message: 'Unknown PUT outcomes retain a 24 hour cleanup grace period',
    });
    // A late acknowledgement changes only PUT confirmation and keeps the failed
    // cleanup receipt; it does not manufacture another failed cleanup attempt.
    await pool.query(
      'UPDATE storage_config_probes SET put_confirmed_at=clock_timestamp() WHERE id=$1',
      [probeId],
    );
    expect(
      (
        await pool.query(
          'SELECT put_confirmed_at,deleted_at,cleanup_attempted_at::text AS attempted FROM storage_config_probes WHERE id=$1',
          [probeId],
        )
      ).rows[0],
    ).toMatchObject({ put_confirmed_at: expect.any(Date), deleted_at: null, attempted });
    await expect(
      pool.query('UPDATE storage_config_probes SET put_confirmed_at=NULL WHERE id=$1', [probeId]),
    ).rejects.toMatchObject({ code: '23514', message: 'Probe PUT confirmation is immutable' });
    await expect(
      pool.query(
        'UPDATE storage_config_probes SET deleted_at=clock_timestamp(),cleanup_attempted_at=clock_timestamp() WHERE id=$1',
        [probeId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message: 'Successful probe deletion preserves the last failed attempt',
    });
    await pool.query('UPDATE storage_config_probes SET deleted_at=clock_timestamp() WHERE id=$1', [
      probeId,
    ]);
    expect(
      (
        await pool.query(
          'SELECT deleted_at,cleanup_attempted_at::text AS attempted FROM storage_config_probes WHERE id=$1',
          [probeId],
        )
      ).rows[0],
    ).toMatchObject({ deleted_at: expect.any(Date), attempted });
  });
  test('aged unknown PUT is cleaned before a replacement probe is written', async () => {
    await save();
    await pool.query(
      `CREATE FUNCTION test_age_storage_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.created_at=clock_timestamp()-interval '2 days';RETURN NEW;END;$$;CREATE TRIGGER test_age_storage_probe BEFORE INSERT ON storage_config_probes FOR EACH ROW EXECUTE FUNCTION test_age_storage_probe()`,
    );
    try {
      unknownPut = true;
      expect((await check(1)).status).toBe('FAILED');
      const prior = (
        await pool.query('SELECT object_key FROM storage_config_probes WHERE deleted_at IS NULL')
      ).rows[0].object_key;
      expect(remove).not.toHaveBeenCalled();
      unknownPut = false;
      expect((await check(1)).status).toBe('SUCCEEDED');
      expect(remove.mock.calls[0]![0]).toMatchObject({ key: prior });
      expect(remove.mock.invocationCallOrder[0]!).toBeLessThan(put.mock.invocationCallOrder[1]!);
      expect(
        (await pool.query('SELECT 1 FROM storage_config_probes WHERE deleted_at IS NULL')).rowCount,
      ).toBe(0);
    } finally {
      await pool.query(
        'DROP TRIGGER test_age_storage_probe ON storage_config_probes; DROP FUNCTION test_age_storage_probe()',
      );
    }
  });
  test('expired test cannot activate and historical rows cannot be rewritten', async () => {
    await save();
    const testId = randomUUID();
    const expired = {
      id: testId,
      configVersion: 1,
      status: 'PASSED',
      checks: ['DESTINATION', 'VERSIONING', 'ROUND_TRIP', 'DELETE'].map((key) => ({
        key,
        status: 'PASSED',
      })),
      cleanupPending: false,
      completedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      message: null,
    };
    await pool.query(
      `INSERT INTO storage_config_operations(id,actor_id,command_id,request_hash,kind,status,config_version,test_result,created_at,completed_at) VALUES($1,$2,$3,$4,'TEST','SUCCEEDED',1,$5::jsonb,clock_timestamp()-interval '12 minutes',clock_timestamp()-interval '11 minutes')`,
      [testId, actor, randomUUID(), '0'.repeat(64), JSON.stringify(expired)],
    );
    await expect(
      service.activate(cookie, {
        commandId: randomUUID(),
        expectedVersion: 1,
        configVersion: 1,
        testId,
        privatePolicyConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_TEST_REQUIRED' });
    await expect(
      pool.query("UPDATE storage_config_revisions SET bucket='changed-12345'"),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("UPDATE storage_config_operations SET result='{}'::jsonb WHERE id=$1", [testId]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  test('interrupted receipt closes only after exclusive lock proves execution stopped', async () => {
    await save();
    const id = randomUUID(),
      commandId = randomUUID(),
      probeId = randomUUID(),
      revision = (await pool.query('SELECT id FROM storage_config_revisions')).rows[0].id;
    await pool.query(
      `INSERT INTO storage_config_operations(id,actor_id,command_id,request_hash,kind,status,config_version) VALUES($1,$2,$3,$4,'TEST','PENDING',1)`,
      [id, actor, commandId, '0'.repeat(64)],
    );
    await pool.query(
      'INSERT INTO storage_config_probes(id,operation_id,revision_id,bucket,region,prefix,object_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        probeId,
        id,
        revision,
        destination.bucket,
        destination.region,
        destination.prefix,
        `${destination.prefix}/${randomUUID()}/${randomUUID()}/${probeId}`,
      ],
    );
    const running = await pool.connect();
    try {
      await running.query('SELECT pg_advisory_lock($1)', [STORAGE_CONFIGURATION_LOCK]);
      expect(await service.operation(cookie, commandId)).toMatchObject({ status: 'RUNNING' });
    } finally {
      await running.query('SELECT pg_advisory_unlock($1)', [STORAGE_CONFIGURATION_LOCK]);
      running.release();
    }
    expect(await service.operation(cookie, commandId)).toMatchObject({
      status: 'FAILED',
      error: { code: 'STORAGE_TEST_INTERRUPTED' },
    });
    expect(await service.snapshot(cookie)).toMatchObject({
      cleanupPending: true,
      test: { status: 'FAILED', cleanupPending: true },
    });
    expect(remove).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
  test('role revocation after durable probe registration prevents the PUT', async () => {
    await save();
    const internal = service as unknown as {
      persistTest(
        c: PoolClient,
        row: Record<string, unknown>,
        test: StorageSettingsTest,
      ): Promise<void>;
    };
    const persist = internal.persistTest.bind(service);
    let intercepted = false;
    const spy = vi.spyOn(internal, 'persistTest').mockImplementation(async (c, row, test) => {
      await persist(c, row, test);
      if (test.cleanupPending && !intercepted) {
        intercepted = true;
        await pool.query("UPDATE platform_operators SET status='DISABLED' WHERE user_id=$1", [
          actor,
        ]);
      }
    });
    try {
      expect(await check(1)).toMatchObject({ status: 'FAILED', error: { code: 'FORBIDDEN' } });
      expect(put).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(
        (await pool.query('SELECT 1 FROM storage_config_probes WHERE deleted_at IS NULL')).rowCount,
      ).toBe(1);
    } finally {
      spy.mockRestore();
      await pool.query("UPDATE platform_operators SET status='ACTIVE' WHERE user_id=$1", [actor]);
    }
  });
  test('configuration changes conflict with a pinned media operation', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock_shared($1)', [STORAGE_CONFIGURATION_LOCK]);
      await expect(save()).rejects.toMatchObject({ code: 'STORAGE_OPERATION_BUSY' });
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    expect((await save()).status).toBe('SUCCEEDED');
  });
  test('quarantine and unavailable encryption key never fall back or call cloud', async () => {
    await save();
    vi.stubEnv('SCB_STORAGE_CONFIG_KEY', 'invalid');
    expect((await service.snapshot(cookie)).keyConfigured).toBe(false);
    await expect(check(1)).rejects.toMatchObject({ code: 'STORAGE_CONFIG_KEY_UNAVAILABLE' });
    vi.stubEnv('SCB_STORAGE_CONFIG_KEY', 'a5'.repeat(32));
    const internal = service as unknown as {
      persistTest(
        c: PoolClient,
        row: Record<string, unknown>,
        test: StorageSettingsTest,
      ): Promise<void>;
    };
    const persist = internal.persistTest.bind(service);
    let intercepted = false;
    const spy = vi.spyOn(internal, 'persistTest').mockImplementation(async (c, row, test) => {
      await persist(c, row, test);
      if (test.cleanupPending && !intercepted) {
        intercepted = true;
        await pool.query(
          "INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id) VALUES($1,$2,'RESTORE_QUARANTINE','restore',$3)",
          [randomUUID(), actor, randomUUID()],
        );
      }
    });
    try {
      expect(await check(1)).toMatchObject({
        status: 'FAILED',
        error: { code: 'STORAGE_QUARANTINED' },
      });
    } finally {
      spy.mockRestore();
    }
    expect(
      (await pool.query('SELECT 1 FROM storage_config_probes WHERE deleted_at IS NULL')).rowCount,
    ).toBe(1);
    expect(await service.snapshot(cookie)).toMatchObject({
      quarantined: true,
      keyConfigured: false,
      active: { applied: false },
    });
    await expect(save(1)).rejects.toMatchObject({ code: 'STORAGE_QUARANTINED' });
    await expect(check(1)).rejects.toMatchObject({ code: 'STORAGE_QUARANTINED' });
    expect(put).not.toHaveBeenCalled();
  });
});
