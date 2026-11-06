import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type {
  MediaFileData,
  StorageCommandResult,
  StorageSettingsSnapshot,
} from '@small-city-basketball/contracts';
import { createApi } from '../src/app.js';
import type { CosObjectLocation, TencentCosOptions } from '../src/cos-storage.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { createScoringHarness, closeHarness, published } from './p05-support.js';
import type { Harness } from './p05-support.js';
import { ORIGIN, call, data, error, testDatabaseUrl } from './support.js';
import { syntheticPng } from './media-fixtures.js';

// A separate real test database prevents this global active configuration from changing
// another suite's media backend. COS transport is synthetic and never reaches the network.
describe('admin storage HTTP routes and active media resolver', { concurrent: false }, () => {
  let admin: Pool;
  let h: Harness;
  let name: string;
  let matchId: string;
  let legacy: MediaFileData;
  let cloudFile: MediaFileData;
  const previousDatabase = process.env.TEST_DATABASE_URL;
  const previousKey = process.env.SCB_STORAGE_CONFIG_KEY;
  const previousKeyFile = process.env.SCB_STORAGE_CONFIG_KEY_FILE;
  const objects = new Map<string, Buffer>();
  const seenKeys: string[] = [];
  const put = vi.fn(async (key: string, bytes: Buffer) => {
    objects.set(key, Buffer.from(bytes));
  });
  const remove = vi.fn(async ({ key }: CosObjectLocation) => {
    objects.delete(key);
  });
  const factory = (options: TencentCosOptions) => {
    seenKeys.push(options.secretId);
    return {
      bucket: options.bucket,
      region: options.region,
      prefix: options.prefix,
      verifyConfiguration: async () => {},
      put,
      get: async ({ key }: CosObjectLocation) => {
        const bytes = objects.get(key);
        if (!bytes) throw new Error('Synthetic probe missing');
        return Buffer.from(bytes);
      },
      delete: remove,
    };
  };
  const mediaPath = () => `/v1/orgs/${h.owner.orgId}/matches/${matchId}/media-files`;
  const upload = () => ({
    purpose: 'MATCH_IMAGE',
    fileName: 'synthetic-cos02.png',
    contentType: 'image/png',
    base64: syntheticPng.toString('base64'),
  });
  const getSnapshot = () => call(h.api, 'get', '/v1/platform/storage', { cookie: h.owner.cookie });
  const snapshot = async () => data<StorageSettingsSnapshot>(await getSnapshot());
  const write = (suffix: string, body: object, cookie = h.owner.cookie) =>
    call(h.api, suffix === 'draft' ? 'put' : 'post', `/v1/platform/storage/${suffix}`, {
      cookie,
      body,
    });
  const read = (file: MediaFileData) =>
    call(h.api, 'get', `${mediaPath()}/${file.id}/content`, { cookie: h.owner.cookie });
  const destination = {
    bucket: 'scb-cos02-http-12345',
    region: 'ap-guangzhou',
    prefix: 'scb-media/v1',
  };
  const credentials = { secretId: 'SYNTHETIC_COS02_ID_A', secretKey: 'SYNTHETIC_COS02_KEY_A' };

  beforeAll(async () => {
    const initial = testDatabaseUrl();
    admin = new Pool({ connectionString: initial });
    name = `scb_test_cos02_http_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(initial);
    url.pathname = `/${name}`;
    process.env.TEST_DATABASE_URL = url.toString();
    process.env.SCB_STORAGE_CONFIG_KEY = randomBytes(32).toString('hex');
    delete process.env.SCB_STORAGE_CONFIG_KEY_FILE;
    h = await createScoringHarness(2);
    const fixture = await published(h, h.teams.slice(0, 2));
    matchId = fixture.matches[0]!.id;
    legacy = data<MediaFileData>(
      await call(h.api, 'post', mediaPath(), { cookie: h.owner.cookie, body: upload() }),
      201,
    );
    await h.api.app.close();
    await h.api.pool.end();
    h.api = await createApi({
      databaseUrl: h.databaseUrl,
      appOrigin: ORIGIN,
      backgroundWorkersEnabled: false,
      storageSettings: { storeFactory: factory },
    });
  }, 120000);

  afterAll(async () => {
    try {
      if (h) await closeHarness(h);
      if (admin && name) await admin.query(`DROP DATABASE "${name}"`);
    } finally {
      await admin?.end();
      if (previousDatabase === undefined) delete process.env.TEST_DATABASE_URL;
      else process.env.TEST_DATABASE_URL = previousDatabase;
      if (previousKey === undefined) delete process.env.SCB_STORAGE_CONFIG_KEY;
      else process.env.SCB_STORAGE_CONFIG_KEY = previousKey;
      if (previousKeyFile === undefined) delete process.env.SCB_STORAGE_CONFIG_KEY_FILE;
      else process.env.SCB_STORAGE_CONFIG_KEY_FILE = previousKeyFile;
    }
  }, 30000);

  test('real HTTP rejects guests, organization owners and untrusted write origins', async () => {
    error(await call(h.api, 'get', '/v1/platform/storage'), 401);
    error(await getSnapshot(), 403);
    await maintainPlatformOperator(h.api.pool, {
      email: h.owner.email,
      status: 'ACTIVE',
      reason: 'Synthetic COS02 HTTP platform fixture',
    });
    expect((await snapshot()).active.provider).toBe('DATABASE');
    error(
      await call(h.api, 'put', '/v1/platform/storage/draft', {
        cookie: h.owner.cookie,
        origin: 'https://untrusted.example.test',
        body: { commandId: randomUUID(), expectedVersion: 0, ...destination, ...credentials },
      }),
      403,
    );
    expect(put).not.toHaveBeenCalled();
  });

  test('saves, verifies and activates through registered HTTP routes without exposing credentials', async () => {
    const before = await snapshot();
    const commandId = randomUUID();
    const saved = data<StorageCommandResult>(
      await write('draft', {
        commandId,
        expectedVersion: before.version,
        ...destination,
        ...credentials,
      }),
    );
    expect(saved.status).toBe('SUCCEEDED');
    const receipt = data<StorageCommandResult>(
      await call(h.api, 'get', `/v1/platform/storage/operations/${commandId}`, {
        cookie: h.owner.cookie,
      }),
    );
    expect(receipt).toEqual(saved);
    const draft = await snapshot();
    expect(draft.active.provider).toBe('DATABASE');
    const tested = data<StorageCommandResult>(
      await write('tests', {
        commandId: randomUUID(),
        configVersion: draft.draft!.version,
        confirmCloudTest: true,
      }),
    );
    expect(tested.status).toBe('SUCCEEDED');
    const testedState = await snapshot();
    const activated = data<StorageCommandResult>(
      await write('activation', {
        commandId: randomUUID(),
        expectedVersion: testedState.version,
        configVersion: testedState.draft!.version,
        testId: tested.testId,
        privatePolicyConfirmed: true,
      }),
    );
    expect(activated.status).toBe('SUCCEEDED');
    const active = await snapshot();
    expect(active.active).toMatchObject({
      provider: 'COS',
      source: 'ADMIN',
      version: saved.configVersion,
      applied: true,
    });
    expect(active.test?.checks.every((check) => check.status === 'PASSED')).toBe(true);
    for (const response of [saved, receipt, draft, testedState, active]) {
      const text = JSON.stringify(response);
      expect(text).not.toContain(credentials.secretId);
      expect(text).not.toContain(credentials.secretKey);
      expect(text).not.toMatch(/ciphertext|credentials_nonce|credentials_tag|object_key/);
    }
  });

  test('new uploads use the selected store while old database files remain readable', async () => {
    const writes = put.mock.calls.length;
    cloudFile = data<MediaFileData>(
      await call(h.api, 'post', mediaPath(), { cookie: h.owner.cookie, body: upload() }),
      201,
    );
    expect(put.mock.calls.length).toBe(writes + 1);
    const row = (
      await h.api.pool.query('SELECT payload,cos_object_id FROM media_files WHERE id=$1', [
        cloudFile.id,
      ])
    ).rows[0];
    expect(row).toEqual({ payload: null, cos_object_id: cloudFile.id });
    expect(Buffer.from((await read(legacy)).body)).toEqual(syntheticPng);
    expect(Buffer.from((await read(cloudFile)).body)).toEqual(syntheticPng);
    const state = await snapshot();
    expect(state.destinationLocked).toBe(true);
    error(
      await write('draft', {
        commandId: randomUUID(),
        expectedVersion: state.version,
        ...destination,
        bucket: 'different-synthetic-12345',
        ...credentials,
      }),
      409,
    );
  });

  test('losing the independent key fails closed for COS but keeps existing DB files readable', async () => {
    const key = process.env.SCB_STORAGE_CONFIG_KEY;
    delete process.env.SCB_STORAGE_CONFIG_KEY;
    try {
      expect(Buffer.from((await read(legacy)).body)).toEqual(syntheticPng);
      error(await read(cloudFile), 503);
      expect((await snapshot()).active.applied).toBe(false);
      expect((await snapshot()).keyConfigured).toBe(false);
    } finally {
      process.env.SCB_STORAGE_CONFIG_KEY = key;
    }
    expect(Buffer.from((await read(cloudFile)).body)).toEqual(syntheticPng);
    expect(seenKeys).toContain(credentials.secretId);
  });
});
