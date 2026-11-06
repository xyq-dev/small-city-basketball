import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type {
  MatchMediaData,
  MediaFileData,
  MediaFileReceiptData,
  UploadSessionData,
} from '@small-city-basketball/contracts';
import { createApi } from '../src/app.js';
import type { CosObjectStore } from '../src/cos-storage.js';
import { MediaObjectStorage } from '../src/media-object-storage.js';
import { ORIGIN, call, data, error, eventually } from './support.js';
import { APPLICATION_NAME, blockedPid } from './p04-support.js';
import { closeHarness, createScoringHarness, published } from './p05-support.js';
import type { Harness } from './p05-support.js';
import { confirmMatch, enable, publicSchedulePath, savePublishRules } from './p05b-support.js';
import type { PublicScheduleMatchData } from '@small-city-basketball/contracts';
import { syntheticPng } from './media-fixtures.js';

function latch() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}
async function within<T>(pending: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 10000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// This suite needs an isolated native PostgreSQL scb_test_* database. COS is a controlled
// byte-preserving transport double, so passing it does not assert a real cloud deployment.
describe('COS media HTTP and transaction integration', { concurrent: false }, () => {
  const objects = new Map<string, Buffer>();
  const putBytes = async (key: string, bytes: Buffer) => {
    objects.set(key, Buffer.from(bytes));
  };
  const put = vi.fn(putBytes);
  const get = vi.fn(async ({ key }: { key: string }) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error('synthetic object missing');
    return Buffer.from(bytes);
  });
  const removeBytes = async ({ key }: { key: string }) => {
    objects.delete(key);
  };
  const remove = vi.fn(removeBytes);
  const store: CosObjectStore = {
    bucket: 'scb-test-12345',
    region: 'ap-guangzhou',
    prefix: 'scb-media/v1',
    put,
    get,
    delete: remove,
  };
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  let h: Harness, matchId: string, legacy: MediaFileData, publicPath: string;
  const base = () => `/v1/orgs/${h.owner.orgId}/matches/${matchId}`;
  const uploadBody = () => ({
    purpose: 'MATCH_IMAGE',
    fileName: 'synthetic.png',
    contentType: 'image/png',
    base64: syntheticPng.toString('base64'),
  });
  const requestBody = () => ({
    clientRequestId: randomUUID(),
    purpose: 'MATCH_IMAGE',
    fileName: 'synthetic.png',
    contentType: 'image/png',
    byteLength: syntheticPng.length,
    contentSha256: hash(syntheticPng),
    contentBase64: syntheticPng.toString('base64'),
  });
  const post = (path: string, body: object) =>
    call(h.api, 'post', path, { cookie: h.owner.cookie, body });
  const read = (file: MediaFileData) =>
    call(h.api, 'get', `${base()}/media-files/${file.id}/content`, { cookie: h.owner.cookie });
  const storage = () => h.api.app.get<MediaObjectStorage>('SCB_MEDIA_OBJECT_STORAGE');
  const locationFor = async (file: MediaFileData) => {
    const result = await h.api.pool.query<{ object_key: string }>(
      'SELECT object_key FROM media_cos_objects WHERE org_id=$1 AND id=$2',
      [h.owner.orgId, file.id],
    );
    expect(result.rowCount).toBe(1);
    return result.rows[0]!.object_key;
  };
  // Make only this harness's newly registered objects eligible for orphan cleanup without
  // relaxing production immutability/grace checks. Random names avoid other suites' DDL.
  async function withAgedRegistrations<T>(work: () => Promise<T>): Promise<T> {
    const identifier = `a_cos_age_${randomUUID().replaceAll('-', '')}`;
    await h.api.pool.query(`CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.org_id::text=TG_ARGV[0] THEN NEW.created_at=clock_timestamp()-interval '25 hours'; END IF;
      RETURN NEW; END; $$`);
    try {
      await h.api.pool.query(
        `CREATE TRIGGER ${identifier} BEFORE INSERT ON media_cos_objects FOR EACH ROW EXECUTE FUNCTION ${identifier}('${h.owner.orgId}')`,
      );
      return await work();
    } finally {
      await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON media_cos_objects`);
      await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
    }
  }

  beforeAll(async () => {
    h = await createScoringHarness(2);
    const fixture = await published(h, h.teams.slice(0, 2));
    matchId = fixture.matches[0]!.id;
    const eventId = fixture.event.event.id;
    legacy = data<MediaFileData>(await post(`${base()}/media-files`, uploadBody()), 201);
    await savePublishRules(h, eventId);
    await confirmMatch(h, fixture);
    const grant = await enable(h, eventId);
    const schedule = data<PublicScheduleMatchData[]>(
      await call(h.api, 'get', publicSchedulePath(grant.publication!.publicEventId)),
    );
    publicPath = `/v1/public/events/${grant.publication!.publicEventId}/matches/${schedule[0]!.publicMatchId}/media`;
    await h.api.app.close();
    await h.api.pool.end();
    h.api = await createApi({
      databaseUrl: h.databaseUrl,
      appOrigin: ORIGIN,
      backgroundWorkersEnabled: false,
      media: { objectStore: store },
    });
  }, 120000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  }, 30000);

  test('reads existing DB content and stores a new canonical-UUID route upload without payload', async () => {
    expect(Buffer.from((await read(legacy)).body)).toEqual(syntheticPng);
    const file = data<MediaFileData>(
      await post(
        base().replace(h.owner.orgId, h.owner.orgId.toUpperCase()) + '/media-files',
        uploadBody(),
      ),
      201,
    );
    const row = (
      await h.api.pool.query('SELECT payload,cos_object_id FROM media_files WHERE id=$1', [file.id])
    ).rows[0];
    expect(row).toEqual({ payload: null, cos_object_id: file.id });
    const content = await read(file);
    expect(content.status).toBe(200);
    expect(Buffer.from(content.body)).toEqual(syntheticPng);
    const calls = get.mock.calls.length;
    error(
      await call(h.api, 'get', `${base()}/media-files/${file.id}/content`, {
        cookie: h.otherOwner.cookie,
      }),
      404,
    );
    expect(get.mock.calls.length).toBe(calls);
    expect(JSON.stringify(file)).not.toMatch(/bucket|object_key|secret|cos_object_id/);
  });

  test('replays idempotent upload without another cloud PUT and completes existing chunk protocol', async () => {
    const body = requestBody();
    const file = data<MediaFileData>(await post(`${base()}/media-file-requests`, body), 201);
    const writes = put.mock.calls.length;
    expect(data<MediaFileData>(await post(`${base()}/media-file-requests`, body)).id).toBe(file.id);
    expect(put.mock.calls.length).toBe(writes);
    const { contentBase64: _bytes, ...meta } = requestBody();
    const session = data<UploadSessionData>(
      await post(`${base()}/media-upload-sessions`, meta),
      201,
    );
    await call(h.api, 'put', `${base()}/media-upload-sessions/${session.id}/chunks/0`, {
      cookie: h.owner.cookie,
      body: {
        byteLength: syntheticPng.length,
        sha256: hash(syntheticPng),
        contentBase64: syntheticPng.toString('base64'),
      },
    });
    const completed = data<MediaFileReceiptData>(
      await post(`${base()}/media-upload-sessions/${session.id}/complete`, {}),
    );
    expect(completed.state).toBe('FILE');
    if (completed.state !== 'FILE') throw new Error('Missing file receipt');
    expect(Buffer.from((await read(completed.file)).body)).toEqual(syntheticPng);
    const payload = (
      await h.api.pool.query('SELECT payload,cos_object_id FROM media_files WHERE id=$1', [
        completed.file.id,
      ])
    ).rows[0];
    expect(payload).toEqual({ payload: null, cos_object_id: completed.file.id });
  });

  test('serializes simultaneous requests for the same upload ID into one file and one COS object', async () => {
    const entered = latch(),
      release = latch();
    const body = requestBody();
    put.mockImplementationOnce(async (key, bytes) => {
      await putBytes(key, bytes);
      entered.release();
      await release.ready;
    });
    const first = post(`${base()}/media-file-requests`, body);
    let second: ReturnType<typeof post> | undefined;
    void first.catch(() => {});
    try {
      await within(entered.ready, 'First concurrent upload never reached COS');
      const uploading = await eventually(
        async () =>
          (
            await h.api.pool.query<{ pid: number }>(
              `SELECT pid FROM pg_stat_activity WHERE datname=current_database()
           AND application_name=$1 AND state='idle in transaction'
           AND query LIKE 'SELECT id FROM media_cos_objects WHERE org_id=%'`,
              [APPLICATION_NAME],
            )
          ).rows,
        (rows) => rows.length === 1,
        'Cannot identify the upload transaction waiting for its COS response',
      );
      second = post(`${base()}/media-file-requests`, body);
      void second.catch(() => {});
      await blockedPid(
        h.api.pool,
        uploading[0]!.pid,
        'Duplicate upload did not overlap the first upload',
      );
      release.release();
      const responses = await Promise.all([first, second]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
      const files = responses.map((response) => data<MediaFileData>(response, response.status));
      expect(files[0]!.id).toBe(files[1]!.id);
      const fileId = files[0]!.id;
      const key = await locationFor(files[0]!);
      expect(put.mock.calls.filter(([storedKey]) => storedKey === key)).toHaveLength(1);
      expect([...objects.keys()].filter((storedKey) => storedKey.includes(`/${fileId}/`))).toEqual([
        key,
      ]);
      expect(objects.get(key)).toEqual(syntheticPng);
      const counts = (
        await h.api.pool.query(
          `SELECT (SELECT count(*)::int FROM media_files WHERE org_id=$1 AND id=$2) AS files,
          (SELECT count(*)::int FROM media_cos_objects WHERE org_id=$1 AND id=$2) AS objects,
          (SELECT count(*)::int FROM media_request_receipts WHERE org_id=$1 AND match_id=$3
            AND client_request_id=$4 AND result_file_id=$2) AS receipts`,
          [h.owner.orgId, fileId, matchId, body.clientRequestId],
        )
      ).rows[0];
      expect(counts).toEqual({ files: 1, objects: 1, receipts: 1 });
    } finally {
      release.release();
      await Promise.allSettled(second ? [first, second] : [first]);
      put.mockReset().mockImplementation(putBytes);
    }
  });

  test('skips an aged orphan candidate while its upload still holds the object lock', async () => {
    await withAgedRegistrations(async () => {
      const entered = latch(),
        release = latch();
      let key = '';
      put.mockImplementationOnce(async (storedKey, bytes) => {
        key = storedKey;
        await putBytes(storedKey, bytes);
        entered.release();
        await release.ready;
      });
      const pending = post(`${base()}/media-file-requests`, requestBody());
      let cleaning: ReturnType<MediaObjectStorage['cleanup']> | undefined;
      void pending.catch(() => {});
      try {
        await within(entered.ready, 'In-flight upload never reached its COS barrier');
        const staged = (
          await h.api.pool.query(
            `SELECT o.id,o.created_at<clock_timestamp()-interval '24 hours' AS expired,
            EXISTS(SELECT 1 FROM media_files f WHERE f.org_id=o.org_id AND f.cos_object_id=o.id) AS linked
           FROM media_cos_objects o WHERE o.org_id=$1 AND o.object_key=$2`,
            [h.owner.orgId, key],
          )
        ).rows[0];
        expect(staged).toMatchObject({ expired: true, linked: false });
        cleaning = storage().cleanup(100);
        await within(
          cleaning,
          'Cleaner blocked on an in-flight upload instead of skipping its lock',
        );
        expect(remove.mock.calls.filter(([location]) => location.key === key)).toHaveLength(0);
        expect(objects.get(key)).toEqual(syntheticPng);
        release.release();
        const file = data<MediaFileData>(await pending, 201);
        expect(file.id).toBe(staged.id);
        expect(Buffer.from((await read(file)).body)).toEqual(syntheticPng);
        await storage().cleanup(100);
        expect(remove.mock.calls.filter(([location]) => location.key === key)).toHaveLength(0);
        expect(
          (
            await h.api.pool.query(
              'SELECT deleted_at FROM media_cos_objects WHERE org_id=$1 AND id=$2',
              [h.owner.orgId, file.id],
            )
          ).rows[0],
        ).toEqual({ deleted_at: null });
      } finally {
        release.release();
        await Promise.allSettled(cleaning ? [pending, cleaning] : [pending]);
        put.mockReset().mockImplementation(putBytes);
      }
    });
  });

  test('overlapping cleaners skip the locked object and perform physical deletion exactly once', async () => {
    const file = data<MediaFileData>(await post(`${base()}/media-files`, uploadBody()), 201);
    const key = await locationFor(file);
    const revoked = data<MediaFileData>(
      await post(`${base()}/media-files/${file.id}/commands`, {
        type: 'REVOKE',
        expectedVersion: file.version,
        reason: '合成并发删除撤销',
      }),
    );
    data<MediaFileData>(
      await post(`${base()}/media-files/${file.id}/commands`, {
        type: 'PURGE',
        expectedVersion: revoked.version,
        reason: '合成并发删除清除',
      }),
    );
    const entered = latch(),
      release = latch();
    remove.mockImplementation(async (location) => {
      if (location.key === key) {
        entered.release();
        await release.ready;
      }
      await removeBytes(location);
    });
    const first = storage().cleanup(100);
    let second: ReturnType<MediaObjectStorage['cleanup']> | undefined;
    void first.catch(() => {});
    try {
      await within(entered.ready, 'First cleaner never reached the target COS delete');
      second = storage().cleanup(100);
      void second.catch(() => {});
      await within(second, 'Second cleaner waited on a locked object instead of SKIP LOCKED');
      expect(remove.mock.calls.filter(([location]) => location.key === key)).toHaveLength(1);
      expect(objects.has(key)).toBe(true);
      expect(
        (
          await h.api.pool.query(
            'SELECT deleted_at FROM media_cos_objects WHERE org_id=$1 AND id=$2',
            [h.owner.orgId, file.id],
          )
        ).rows[0],
      ).toEqual({ deleted_at: null });
      release.release();
      await Promise.all([first, second]);
      expect(remove.mock.calls.filter(([location]) => location.key === key)).toHaveLength(1);
      expect(objects.has(key)).toBe(false);
      expect(
        (
          await h.api.pool.query(
            'SELECT deleted_at FROM media_cos_objects WHERE org_id=$1 AND id=$2',
            [h.owner.orgId, file.id],
          )
        ).rows[0].deleted_at,
      ).toBeInstanceOf(Date);
    } finally {
      release.release();
      await Promise.allSettled(second ? [first, second] : [first]);
      remove.mockReset().mockImplementation(removeBytes);
    }
  });

  test('retains and later reclaims cloud bytes when the file and receipt roll back after PUT', async () => {
    const body = requestBody();
    const identifier = `cos_fail_audit_${randomUUID().replaceAll('-', '')}`;
    await h.api.pool.query(`CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.org_id::text=TG_ARGV[0] AND NEW.action='media.file.uploaded'
        AND NEW.metadata->>'clientRequestId'=TG_ARGV[1] THEN RAISE EXCEPTION 'synthetic COS audit rollback'; END IF;
      RETURN NEW; END; $$`);
    try {
      await h.api.pool.query(
        `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}('${h.owner.orgId}','${body.clientRequestId}')`,
      );
      await withAgedRegistrations(async () => {
        const calls = put.mock.calls.length;
        const response = await post(`${base()}/media-file-requests`, body);
        error(response, 500);
        expect(response.body.error.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(response.body)).not.toContain('synthetic COS audit rollback');
        expect(put.mock.calls.length).toBe(calls + 1);
        const key = put.mock.calls[calls]![0];
        expect(objects.get(key)).toEqual(syntheticPng);
        const orphan = (
          await h.api.pool.query<{ id: string; deleted_at: Date | null }>(
            'SELECT id,deleted_at FROM media_cos_objects WHERE org_id=$1 AND object_key=$2',
            [h.owner.orgId, key],
          )
        ).rows[0]!;
        expect(orphan).toMatchObject({ id: expect.any(String), deleted_at: null });
        expect(
          (
            await h.api.pool.query(
              `SELECT (SELECT count(*)::int FROM media_files WHERE org_id=$1 AND id=$2) AS files,
            (SELECT count(*)::int FROM media_request_receipts WHERE org_id=$1 AND match_id=$3
              AND client_request_id=$4) AS receipts`,
              [h.owner.orgId, orphan.id, matchId, body.clientRequestId],
            )
          ).rows[0],
        ).toEqual({ files: 0, receipts: 0 });
        await storage().cleanup(100);
        expect(remove.mock.calls.filter(([location]) => location.key === key)).toHaveLength(1);
        expect(objects.has(key)).toBe(false);
        expect(
          (
            await h.api.pool.query(
              'SELECT deleted_at FROM media_cos_objects WHERE org_id=$1 AND id=$2',
              [h.owner.orgId, orphan.id],
            )
          ).rows[0].deleted_at,
        ).toBeInstanceOf(Date);
      });
    } finally {
      await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
      await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
    }
  });

  test('keeps drafts private, publishes bytes with Range, and revokes access before retryable physical deletion', async () => {
    const file = data<MediaFileData>(await post(`${base()}/media-files`, uploadBody()), 201);
    let media = data<MatchMediaData>(
      await post(`${base()}/media`, {
        kind: 'IMAGE',
        title: '合成COS测试',
        fileId: file.id,
        rightsDeclaration: '本测试图片为合成且具有发布授权',
      }),
      201,
    );
    const list = await call(h.api, 'get', publicPath);
    expect(JSON.stringify(list.body)).not.toContain(media.id);
    media = data<MatchMediaData>(
      await post(`${base()}/media/${media.id}/commands`, {
        type: 'PUBLISH',
        expectedVersion: media.version,
      }),
    );
    const published = (await call(h.api, 'get', publicPath)).body.data.media.find(
      (m: { title: string }) => m.title === '合成COS测试',
    );
    expect(published).toBeDefined();
    const contentPath = `${publicPath}/${published.publicMediaId}/content`;
    const range = await call(h.api, 'get', contentPath, { headers: { Range: 'bytes=0-7' } });
    expect(range.status).toBe(206);
    expect(Buffer.from(range.body)).toEqual(syntheticPng.subarray(0, 8));
    const revoked = data<MediaFileData>(
      await post(`${base()}/media-files/${file.id}/commands`, {
        type: 'REVOKE',
        expectedVersion: file.version,
        reason: '合成文件撤销测试',
      }),
    );
    error(await call(h.api, 'get', contentPath), 404);
    await post(`${base()}/media-files/${file.id}/commands`, {
      type: 'PURGE',
      expectedVersion: revoked.version,
      reason: '合成文件清理测试',
    });
    remove.mockRejectedValueOnce(new Error('temporary synthetic delete failure'));
    expect((await storage().cleanup()).failed).toBe(1);
    expect((await storage().cleanup()).deleted).toBe(1);
    const row = (
      await h.api.pool.query('SELECT deleted_at FROM media_cos_objects WHERE id=$1', [file.id])
    ).rows[0];
    expect(row.deleted_at).toBeInstanceOf(Date);
  });

  test('keeps a durable orphan receipt when cloud PUT fails, without an active file or quota effect', async () => {
    const calls = put.mock.calls.length;
    put.mockRejectedValueOnce(new Error('synthetic private cloud details'));
    const failed = await post(`${base()}/media-file-requests`, requestBody());
    error(failed, 503);
    expect(JSON.stringify(failed.body)).not.toContain('synthetic private cloud details');
    expect(put.mock.calls.length).toBe(calls + 1);
    const key = put.mock.calls[calls]![0];
    const orphan = await h.api.pool.query(
      `SELECT o.id FROM media_cos_objects o LEFT JOIN media_files f ON f.org_id=o.org_id AND f.cos_object_id=o.id
       WHERE o.org_id=$1 AND o.object_key=$2 AND f.id IS NULL AND o.deleted_at IS NULL`,
      [h.owner.orgId, key],
    );
    expect(orphan.rowCount).toBe(1);
    const deletes = remove.mock.calls.filter(([location]) => location.key === key).length;
    await storage().cleanup();
    expect(remove.mock.calls.filter(([location]) => location.key === key)).toHaveLength(deletes);
  });
});
