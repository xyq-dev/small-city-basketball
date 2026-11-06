import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { ApiError } from './errors.js';
import type { CosObjectLocation, CosObjectStore } from './cos-storage.js';

type ObjectRow = {
  id: string;
  org_id: string;
  bucket: string;
  region: string;
  object_key: string;
};
const unavailable = () =>
  new ApiError(503, 'MEDIA_STORAGE_UNAVAILABLE', '媒体存储暂不可用，请稍后重试');

/** COS operations never own authorization: callers must first lock and authorize the file scope. */
export class MediaObjectStorage {
  private readonly registrationPool?: Pool;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<unknown>;

  /** Shared by API startup and packaged recovery checks; quarantined data never loads keys. */
  static forRuntime(
    pool: Pool,
    databaseUrl: string,
    quarantined: boolean,
    resolveStore: () => CosObjectStore | undefined,
  ): MediaObjectStorage {
    return new MediaObjectStorage(pool, databaseUrl, quarantined ? undefined : resolveStore());
  }

  constructor(
    private readonly pool: Pool,
    databaseUrl: string,
    readonly store?: CosObjectStore,
  ) {
    // Staging registrations must survive the caller's rollback. A separate small pool also
    // prevents all business connections waiting on a spare connection from their own pool.
    if (store) {
      this.registrationPool = new Pool({
        connectionString: databaseUrl,
        max: 2,
        connectionTimeoutMillis: 5000,
      });
      this.registrationPool.on('error', () => console.error('Media staging connection error'));
    }
  }

  async save(
    client: PoolClient,
    orgId: string,
    fileId: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ payload: Buffer | null; cosObjectId: string | null }> {
    if (!this.store) return { payload: body, cosObjectId: null };
    // Callers already hold the organization lock, so concurrent uploads cannot race this
    // bound. Failed cloud writes must not bypass the existing permanent-file identity cap.
    const capacity = await client.query<{ total: number; pending: number }>(
      `SELECT count(*)::int AS total,count(*) FILTER(WHERE o.deleted_at IS NULL AND NOT EXISTS(
         SELECT 1 FROM media_files f WHERE f.org_id=o.org_id AND f.cos_object_id=o.id))::int AS pending
       FROM media_cos_objects o WHERE o.org_id=$1`,
      [orgId],
    );
    if (capacity.rows[0]!.total >= 8192 || capacity.rows[0]!.pending >= 32)
      throw new ApiError(
        409,
        'MEDIA_STORAGE_LIMIT',
        '云存储待清理或历史登记数量已达上限，请联系管理员处理',
      );
    const key = `${this.store.prefix}/${orgId}/${fileId}/${randomUUID()}`;
    try {
      await this.registrationPool!.query(
        'INSERT INTO media_cos_objects(id,org_id,bucket,region,object_key) VALUES($1,$2,$3,$4,$5)',
        [fileId, orgId, this.store.bucket, this.store.region, key],
      );
      // A cleaner takes the same lock and therefore cannot delete an in-flight upload,
      // including uploads whose business transaction has already passed the grace period.
      const locked = await client.query(
        'SELECT id FROM media_cos_objects WHERE org_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',
        [orgId, fileId],
      );
      if (locked.rowCount !== 1) throw unavailable();
      await this.store.put(key, body, contentType);
      return { payload: null, cosObjectId: fileId };
    } catch {
      // A timed-out PUT may still have reached COS. Keep the durable registration for
      // cleanup instead of guessing success or deleting another request's object.
      throw unavailable();
    }
  }

  async read(
    client: PoolClient,
    file: {
      org_id: string;
      cos_object_id?: string | null;
      payload: unknown;
      byte_length: number;
      sha256: string;
    },
  ): Promise<Buffer> {
    if (!file.cos_object_id) {
      if (!Buffer.isBuffer(file.payload)) throw unavailable();
      return file.payload;
    }
    if (!this.store) throw unavailable();
    try {
      const result = await client.query<ObjectRow>(
        'SELECT id,org_id,bucket,region,object_key FROM media_cos_objects WHERE org_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE',
        [file.org_id, file.cos_object_id],
      );
      const object = result.rows[0];
      if (!object) throw unavailable();
      const body = await this.store.get(this.location(object));
      if (
        body.length !== file.byte_length ||
        createHash('sha256').update(body).digest('hex') !== file.sha256
      )
        throw unavailable();
      return body;
    } catch {
      throw unavailable();
    }
  }

  private location(row: ObjectRow): CosObjectLocation {
    return { bucket: row.bucket, region: row.region, key: row.object_key };
  }

  /** Bounded, retryable deletion: authorization is already revoked by the committed purge. */
  async cleanup(limit = 20): Promise<{ deleted: number; failed: number }> {
    if (!this.store) return { deleted: 0, failed: 0 };
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Invalid cleanup limit');
    let deleted = 0,
      failed = 0;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const candidates = await client.query<ObjectRow>(
        `SELECT o.id,o.org_id,o.bucket,o.region,o.object_key FROM media_cos_objects o
         WHERE o.deleted_at IS NULL AND (
           EXISTS(SELECT 1 FROM media_files f WHERE f.org_id=o.org_id AND f.cos_object_id=o.id AND f.purged_at IS NOT NULL)
           OR (o.created_at < clock_timestamp()-interval '24 hours' AND NOT EXISTS(
             SELECT 1 FROM media_files f WHERE f.org_id=o.org_id AND f.cos_object_id=o.id)))
         ORDER BY o.created_at,o.id LIMIT $1 FOR UPDATE OF o SKIP LOCKED`,
        [limit],
      );
      for (const row of candidates.rows) {
        // Recheck after obtaining the registry lock: a concurrent commit may have linked
        // a file since the candidate snapshot. Database failures abort the whole batch;
        // only cloud failures below are handled as retryable per-object failures.
        const retained = await client.query(
          'SELECT 1 FROM media_files WHERE org_id=$1 AND cos_object_id=$2 AND purged_at IS NULL',
          [row.org_id, row.id],
        );
        if (retained.rowCount) continue;
        try {
          await this.store.delete(this.location(row));
        } catch {
          failed++;
          continue;
        }
        await client.query(
          'UPDATE media_cos_objects SET deleted_at=clock_timestamp() WHERE id=$1',
          [row.id],
        );
        deleted++;
      }
      await client.query('COMMIT');
      return { deleted, failed };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  startWorker(enabled: boolean) {
    if (!enabled || !this.store || this.timer) return;
    const run = () => {
      if (this.running) return;
      this.running = this.cleanup()
        .then(({ failed }) => {
          if (failed) console.error('Media object cleanup will retry');
        })
        .catch(() => console.error('Media object cleanup failed'))
        .finally(() => {
          this.running = undefined;
        });
    };
    this.timer = setInterval(run, 60000);
    this.timer.unref();
    run();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
    await this.registrationPool?.end();
  }
}
