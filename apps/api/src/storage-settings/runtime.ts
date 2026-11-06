import type { Pool, PoolClient } from 'pg';
import { TencentCosObjectStore } from '../cos-storage.js';
import type { CosObjectStore, TencentCosOptions } from '../cos-storage.js';
import { readCosObjectStore } from '../cos-runtime.js';
import { ApiError } from '../errors.js';
import { decryptStorageCredentials } from './crypto.js';
import type { EncryptedCredentials, RevisionIdentity } from './crypto.js';

export type StorageRevisionRow = RevisionIdentity & EncryptedCredentials;
export type StorageStoreFactory = (options: TencentCosOptions) => CosObjectStore;
export const makeStorageStore: StorageStoreFactory = (options) =>
  new TencentCosObjectStore(options);
export function storeForStorageRevision(
  revision: StorageRevisionRow,
  factory: StorageStoreFactory = makeStorageStore,
): CosObjectStore | undefined {
  if (revision.mode !== 'COS' || !revision.bucket || !revision.region || !revision.prefix)
    throw new ApiError(503, 'MEDIA_STORAGE_UNAVAILABLE', '媒体云存储暂不可用，请稍后重试');
  return factory({
    bucket: revision.bucket,
    region: revision.region,
    prefix: revision.prefix,
    ...decryptStorageCredentials(revision),
  });
}
/** The caller holds the shared configuration transaction lock for the entire media operation. */
export function createStorageSettingsResolver(
  _pool: Pool,
  fallback: () => CosObjectStore | undefined = readCosObjectStore,
  factory: StorageStoreFactory = makeStorageStore,
) {
  return async (client: PoolClient): Promise<CosObjectStore | undefined> => {
    const restored = await client.query(
      "SELECT EXISTS(SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore') AS blocked",
    );
    if (restored.rows[0]?.blocked !== false)
      throw new ApiError(503, 'MEDIA_STORAGE_UNAVAILABLE', '恢复隔离期间对象存储不可用');
    const result = await client.query<StorageRevisionRow & { active_revision_id: string | null }>(
      'SELECT r.*,s.active_revision_id FROM storage_config_state s LEFT JOIN storage_config_revisions r ON r.id=s.active_revision_id WHERE s.singleton=true',
    );
    const row = result.rows[0];
    if (!row || (row.active_revision_id !== null && row.id !== row.active_revision_id))
      throw new ApiError(503, 'MEDIA_STORAGE_UNAVAILABLE', '媒体云存储暂不可用，请稍后重试');
    return row.active_revision_id === null ? fallback() : storeForStorageRevision(row, factory);
  };
}
