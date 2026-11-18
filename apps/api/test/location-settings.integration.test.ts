import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { LocationSettingsService } from '../src/location-settings/service.js';
import { resolveLocationProvider } from '../src/location-settings/runtime.js';
import { call, data, error, ORIGIN, testDatabaseUrl } from './support.js';

describe('platform location settings', { concurrent: false }, () => {
  const schema = `scb_loc_${randomUUID().replaceAll('-', '')}`;
  const key = 'synthetic-amap-key';
  let admin: Pool;
  let pool: Pool;
  let other: Pool;
  let service: LocationSettingsService;
  let cookie: string;
  let ownerCookie: string;
  let databaseUrl: string;
  let http: Awaited<ReturnType<typeof createApi>> | undefined;
  const hosts: string[] = [];
  const transport = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    hosts.push(url.origin);
    const body =
      url.origin === 'https://apis.map.qq.com'
        ? {
            status: 0,
            result: {
              address: '合成地址',
              address_component: { district: '高州市' },
              ad_info: { adcode: '440981' },
            },
          }
        : url.pathname.endsWith('/regeo')
          ? {
              status: '1',
              info: 'OK',
              regeocode: {
                formatted_address: '合成高州市地址',
                addressComponent: { city: '茂名市', district: '高州市', adcode: '440981' },
              },
            }
          : { status: '1', info: 'OK', count: '0', pois: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const save = (expectedVersion: number, commandId = randomUUID()) =>
    service.saveDraft(cookie, {
      commandId,
      expectedVersion,
      provider: 'AMAP',
      signatureEnabled: false,
      webKeyAction: 'REPLACE',
      webKey: key,
      privateKeyAction: 'CLEAR',
    });

  beforeAll(async () => {
    vi.stubEnv('SCB_LOCATION_CONFIG_KEY', 'b6'.repeat(32));
    vi.stubEnv('SCB_TENCENT_MAP_KEY', 'synthetic-tencent-key');
    const url = new URL(testDatabaseUrl());
    admin = new Pool({ connectionString: url.toString() });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    databaseUrl = url.toString();
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    other = new Pool({ connectionString: databaseUrl, max: 2 });
    await migrate(pool);
    const createUser = async (platform: boolean) => {
      const id = randomUUID();
      const token = randomBytes(32).toString('base64url');
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
      return `scb.sid=${token}`;
    };
    cookie = await createUser(true);
    ownerCookie = await createUser(false);
    const org = randomUUID();
    await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
      org,
      'synthetic institution',
    ]);
    await pool.query(
      "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,(SELECT user_id FROM sessions WHERE token_hash=$2),'ORG_OWNER')",
      [org, createHash('sha256').update(ownerCookie.slice('scb.sid='.length)).digest('hex')],
    );
    await pool.query(
      `CREATE FUNCTION test_age_location_command() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.created_at=clock_timestamp()-interval '31 seconds'; RETURN NEW; END; $$;
       CREATE TRIGGER test_age_location_command BEFORE INSERT ON location_config_operations FOR EACH ROW EXECUTE FUNCTION test_age_location_command()`,
    );
    service = new LocationSettingsService(pool, { databaseUrl, appOrigin: ORIGIN }, { transport });
  });
  afterAll(async () => {
    if (http) {
      await http.app.close();
      await http.pool.end();
    }
    await pool?.end();
    await other?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    vi.unstubAllEnvs();
  });

  test('platform permission, masked draft, and activation do not leak or switch early', async () => {
    await expect(service.snapshot(undefined)).rejects.toMatchObject({ status: 401 });
    await expect(service.snapshot(ownerCookie)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const before = await service.snapshot(cookie);
    expect(before.active).toMatchObject({
      source: 'ENVIRONMENT',
      applied: false,
      status: 'UNCONFIGURED',
    });
    const input = {
      commandId: randomUUID(),
      expectedVersion: before.version,
      provider: 'AMAP' as const,
      signatureEnabled: false,
      webKeyAction: 'REPLACE' as const,
      webKey: key,
      privateKeyAction: 'CLEAR' as const,
    };
    const saved = await service.saveDraft(cookie, input);
    expect(await service.saveDraft(cookie, input)).toEqual(saved);
    await expect(
      service.saveDraft(cookie, { ...input, webKey: 'other-synthetic-key' }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await expect(save(before.version)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const draft = await service.snapshot(cookie);
    expect(draft.active.applied).toBe(false);
    expect(draft.active.status).toBe('UNCONFIGURED');
    expect(JSON.stringify(draft)).not.toContain(key);
    const stored = await pool.query('SELECT credentials_ciphertext FROM location_config_revisions');
    expect(JSON.stringify(stored.rows)).not.toContain(key);
    hosts.length = 0;
    await resolveLocationProvider(other, transport).then((provider) =>
      provider.reverse({
        latitude: 21.9182,
        longitude: 110.8533,
        coordinateSystem: 'GCJ02',
      }),
    );
    expect(hosts).toEqual(['https://apis.map.qq.com']);
  });

  test('a passed test binds one version, and disable ignores the environment key', async () => {
    const current = await service.snapshot(cookie);
    await expect(
      service.activate(cookie, {
        commandId: randomUUID(),
        expectedVersion: current.version,
        configVersion: current.draft!.version,
        testId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'LOCATION_TEST_REQUIRED' });
    hosts.length = 0;
    const tested = await service.testConnection(cookie, {
      commandId: randomUUID(),
      configVersion: current.draft!.version,
      confirmCloudTest: true,
    });
    expect(tested.status).toBe('SUCCEEDED');
    expect(hosts.every((host) => host === 'https://restapi.amap.com')).toBe(true);
    const passed = await service.snapshot(cookie);
    expect(passed.active.applied).toBe(false);
    expect(passed.test?.status).toBe('PASSED');
    const activated = await service.activate(cookie, {
      commandId: randomUUID(),
      expectedVersion: passed.version,
      configVersion: passed.draft!.version,
      testId: passed.test!.id,
    });
    expect(activated.status).toBe('SUCCEEDED');
    hosts.length = 0;
    const point = { latitude: 21.9182, longitude: 110.8533, coordinateSystem: 'GCJ02' as const };
    const [first, second] = await Promise.all([
      resolveLocationProvider(pool, transport).then((provider) => provider.reverse(point)),
      resolveLocationProvider(other, transport).then((provider) => provider.reverse(point)),
    ]);
    expect(first[0]).toMatchObject({ source: 'AMAP', sourceCode: '440981', title: '高州市' });
    expect(second[0]?.sourceCode).toBe('440981');
    expect(new Set(hosts)).toEqual(new Set(['https://restapi.amap.com']));
    const live = await service.snapshot(cookie);
    await service.disable(cookie, { commandId: randomUUID(), expectedVersion: live.version });
    hosts.length = 0;
    const disabled = await resolveLocationProvider(other, transport);
    expect(disabled.enabled).toBe(false);
    await expect(disabled.reverse(point)).rejects.toMatchObject({
      code: 'LOCATION_PROVIDER_DISABLED',
    });
    expect(hosts).toEqual([]);
    const pendingId = randomUUID();
    await pool.query(
      `INSERT INTO location_config_operations(id,actor_id,command_id,request_hash,kind,status,config_version)
       VALUES($1,(SELECT user_id FROM sessions WHERE token_hash=$2),$3,$4,'TEST','PENDING',1)`,
      [
        randomUUID(),
        createHash('sha256').update(cookie.slice('scb.sid='.length)).digest('hex'),
        pendingId,
        'ab'.repeat(32),
      ],
    );
    const interrupted = await service.operation(cookie, pendingId);
    expect(interrupted.error?.code).toBe('LOCATION_TEST_INTERRUPTED');
    expect(interrupted.error?.message).toContain('不是云端连通结论');
  });

  test('HTTP allows only a platform operator and does not return the key', async () => {
    http = await createApi({
      databaseUrl,
      appOrigin: ORIGIN,
      backgroundWorkersEnabled: false,
      locationSettings: { transport },
    });
    error(await call(http, 'get', '/v1/platform/location'), 401);
    error(await call(http, 'get', '/v1/platform/location', { cookie: ownerCookie }), 403);
    const response = await call(http, 'get', '/v1/platform/location', { cookie });
    const body = data<{ active: { status: string } }>(response);
    expect(body.active.status).toBe('DISABLED');
    expect(JSON.stringify(response.body)).not.toContain(key);
    expect(JSON.stringify(response.body)).not.toContain('synthetic-tencent-key');
  });
});
