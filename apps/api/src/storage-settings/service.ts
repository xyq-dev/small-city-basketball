import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  StorageActivationInput,
  StorageCommandResult,
  StorageDestination,
  StorageSaveInput,
  StorageSettingsSnapshot,
  StorageSettingsTest,
  StorageTestCheck,
  StorageTestInput,
} from '@small-city-basketball/contracts';
import { ApplicationService } from '../service.js';
import type { Actor, ApiOptions } from '../service.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { invalid, objectInput, resourceId } from '../validation.js';
import { validCosDestination } from '../cos-storage.js';
import type { CosObjectStore } from '../cos-storage.js';
import { readCosObjectStore } from '../cos-runtime.js';
import {
  decryptStorageCredentials,
  encryptStorageCredentials,
  storageCommandDigest,
  storageConfigKeyAvailable,
} from './crypto.js';
import {
  createStorageSettingsResolver,
  makeStorageStore,
  storeForStorageRevision,
} from './runtime.js';
import type { StorageRevisionRow, StorageStoreFactory } from './runtime.js';
import { STORAGE_CONFIGURATION_LOCK } from './locking.js';

type Row = Record<string, any>;
type Kind = StorageCommandResult['kind'];
export interface StorageSettingsOptions {
  storeFactory?: StorageStoreFactory;
  fallbackStore?: () => CosObjectStore | undefined;
}
function fail(code: string, message: string, status = 409): never {
  throw new ApiError(status, code, message);
}
const unavailable = () => ({
  code: 'STORAGE_TEST_FAILED',
  message: '连接检测未通过，请检查桶、地域及专用子账号权限后重试',
});
const destination = (r: Row): StorageDestination => ({
  bucket: r.bucket,
  region: r.region,
  prefix: r.prefix,
});
const sameDestination = (a: Row, b: Row) =>
  a.bucket === b.bucket && a.region === b.region && a.prefix === b.prefix;
const blankChecks = (): StorageTestCheck[] =>
  (['DESTINATION', 'VERSIONING', 'ROUND_TRIP', 'DELETE'] as const).map((key) => ({
    key,
    status: 'NOT_RUN',
  }));
const iso = (v: Date | string): string => new Date(v).toISOString();
function uuid(v: unknown): string {
  if (typeof v !== 'string') invalid('请提供有效操作编号');
  return resourceId(v);
}
function integer(v: unknown, minimum: number): number {
  if (!Number.isInteger(v) || Number(v) < minimum || Number(v) > 2147483646)
    invalid('请提供有效配置版本');
  return v as number;
}
function parseSave(raw: unknown): StorageSaveInput {
  const v = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'bucket',
    'region',
    'prefix',
    'secretId',
    'secretKey',
  ]);
  if (!validCosDestination(v.bucket as string, v.region as string, v.prefix as string))
    invalid('请检查存储桶、地域及路径前缀');
  const empty = (x: unknown) => x === undefined || x === '';
  const keep = empty(v.secretId) && empty(v.secretKey);
  if (
    !keep &&
    ![v.secretId, v.secretKey].every(
      (x) =>
        typeof x === 'string' &&
        x.length > 0 &&
        x.length <= 16384 &&
        !/\s/.test(x) &&
        !/^[*•●]+$/.test(x),
    )
  )
    invalid('访问凭据需要成对填写，且不能使用掩码');
  return {
    commandId: uuid(v.commandId),
    expectedVersion: integer(v.expectedVersion, 0),
    bucket: v.bucket as string,
    region: v.region as string,
    prefix: v.prefix as string,
    ...(!keep ? { secretId: v.secretId as string, secretKey: v.secretKey as string } : {}),
  };
}
function parseTest(raw: unknown): StorageTestInput {
  const v = objectInput(raw, ['commandId', 'configVersion', 'confirmCloudTest']);
  if (v.confirmCloudTest !== true) invalid('请确认检测将访问云服务并可能产生少量请求费用');
  return {
    commandId: uuid(v.commandId),
    configVersion: integer(v.configVersion, 1),
    confirmCloudTest: true,
  };
}
function parseActivation(raw: unknown): StorageActivationInput {
  const v = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'configVersion',
    'testId',
    'privatePolicyConfirmed',
  ]);
  if (v.privatePolicyConfirmed !== true) invalid('请先在腾讯云控制台确认私有读写及禁止公有访问');
  return {
    commandId: uuid(v.commandId),
    expectedVersion: integer(v.expectedVersion, 0),
    configVersion: integer(v.configVersion, 1),
    testId: uuid(v.testId),
    privatePolicyConfirmed: true,
  };
}

/** Global platform configuration. Secrets never enter a DTO, audit payload, or command receipt. */
export class StorageSettingsService extends ApplicationService {
  private readonly factory: StorageStoreFactory;
  private readonly fallback: () => CosObjectStore | undefined;
  constructor(pool: Pool, options: ApiOptions, settings: StorageSettingsOptions = {}) {
    super(pool, options);
    this.factory = settings.storeFactory ?? makeStorageStore;
    this.fallback = settings.fallbackStore ?? readCosObjectStore;
  }
  private async context(c: PoolClient, cookie?: string): Promise<Actor> {
    const actor = await this.lockActor(c, cookie);
    if (
      !(
        await c.query(
          "SELECT user_id FROM platform_operators WHERE user_id=$1 AND status='ACTIVE' FOR SHARE",
          [actor.user.id],
        )
      ).rowCount
    )
      throw forbidden();
    return actor;
  }
  private async quarantined(c: PoolClient): Promise<boolean> {
    const r = await c.query(
      "SELECT EXISTS(SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore') AS blocked",
    );
    return r.rows[0]?.blocked !== false;
  }
  private async allowed(c: PoolClient) {
    if (await this.quarantined(c))
      fail('STORAGE_QUARANTINED', '恢复隔离期间禁止对象存储配置、检测和启用', 503);
  }
  private async exclusive(c: PoolClient) {
    if (
      !(
        await c.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
          STORAGE_CONFIGURATION_LOCK,
        ])
      ).rows[0]?.locked
    )
      fail('STORAGE_OPERATION_BUSY', '对象存储正在处理其他操作，请稍后查询或重试');
  }
  private async state(c: PoolClient): Promise<Row> {
    const s = (await c.query('SELECT * FROM storage_config_state WHERE singleton=true')).rows[0];
    if (!s) fail('STORAGE_CONFIG_UNAVAILABLE', '对象存储配置不可用', 503);
    return s;
  }
  private async revision(c: PoolClient, id: string | null): Promise<StorageRevisionRow | null> {
    if (!id) return null;
    const r = (
      await c.query<StorageRevisionRow>('SELECT * FROM storage_config_revisions WHERE id=$1', [id])
    ).rows[0];
    if (!r) fail('STORAGE_CONFIG_UNAVAILABLE', '对象存储配置不可用', 503);
    return r;
  }
  private async assertDestination(c: PoolClient, requested: StorageDestination) {
    const r = await c.query(
      `SELECT EXISTS(SELECT 1 FROM media_cos_objects WHERE deleted_at IS NULL
      AND (bucket<>$1 OR region<>$2 OR left(object_key,length(object_key)-111)<>$3)) OR
      EXISTS(SELECT 1 FROM storage_config_probes WHERE deleted_at IS NULL AND (bucket<>$1 OR region<>$2 OR prefix<>$3)) AS blocked`,
      [requested.bucket, requested.region, requested.prefix],
    );
    if (r.rows[0]?.blocked !== false)
      fail('STORAGE_DESTINATION_LOCKED', '存在云文件或待清理检测对象，仅可在原位置轮换凭据');
  }
  private receipt(row: Row): StorageCommandResult {
    return (
      row.result ?? {
        commandId: row.command_id,
        kind: row.kind,
        status: 'RUNNING',
        configVersion: row.config_version || null,
        testId: row.kind === 'TEST' ? row.id : null,
        error: null,
      }
    );
  }
  private async begin(
    c: PoolClient,
    actor: Actor,
    command: string,
    kind: Kind,
    request: unknown,
    version: number,
  ): Promise<{ row: Row; replay: boolean }> {
    const hash = storageCommandDigest([kind, request]);
    const old = (
      await c.query('SELECT * FROM storage_config_operations WHERE actor_id=$1 AND command_id=$2', [
        actor.user.id,
        command,
      ])
    ).rows[0];
    if (old) {
      if (old.request_hash !== hash || old.kind !== kind)
        fail('IDEMPOTENCY_CONFLICT', '同一操作编号已用于其他对象存储请求');
      return { row: old, replay: true };
    }
    const r = await c.query(
      `INSERT INTO storage_config_operations(id,actor_id,command_id,request_hash,kind,status,config_version)
      VALUES($1,$2,$3,$4,$5,'PENDING',$6) RETURNING *`,
      [randomUUID(), actor.user.id, command, hash, kind, version],
    );
    return { row: r.rows[0], replay: false };
  }
  private async finish(
    c: PoolClient,
    row: Row,
    error: StorageCommandResult['error'] = null,
    test?: StorageSettingsTest,
  ): Promise<StorageCommandResult> {
    const result: StorageCommandResult = {
      commandId: row.command_id,
      kind: row.kind,
      status: error ? 'FAILED' : 'SUCCEEDED',
      configVersion: row.config_version || null,
      testId: row.kind === 'TEST' ? row.id : null,
      error,
    };
    const updated = await c.query(
      "UPDATE storage_config_operations SET status=$2,result=$3::jsonb,test_result=COALESCE($4::jsonb,test_result),completed_at=clock_timestamp() WHERE id=$1 AND status='PENDING' RETURNING id",
      [
        row.id,
        error ? 'FAILED' : 'SUCCEEDED',
        JSON.stringify(result),
        test ? JSON.stringify(test) : null,
      ],
    );
    if (updated.rowCount !== 1)
      fail('STORAGE_OPERATION_UNAVAILABLE', '操作结果尚未确认，请查询原操作编号', 503);
    return result;
  }
  async snapshot(cookie?: string): Promise<StorageSettingsSnapshot> {
    return this.transaction(async (c) => {
      await this.context(c, cookie);
      const quarantined = await this.quarantined(c);
      const stable =
        (
          await c.query('SELECT pg_try_advisory_xact_lock_shared($1) AS locked', [
            STORAGE_CONFIGURATION_LOCK,
          ])
        ).rows[0]?.locked === true;
      const s = await this.state(c);
      const draft = await this.revision(c, s.draft_revision_id),
        active = await this.revision(c, s.active_revision_id);
      const pending = (
        await c.query(
          'SELECT EXISTS(SELECT 1 FROM storage_config_probes WHERE deleted_at IS NULL) AS pending, EXISTS(SELECT 1 FROM media_cos_objects WHERE deleted_at IS NULL) AS files',
        )
      ).rows[0];
      const latest = (
        await c.query(
          "SELECT test_result FROM storage_config_operations WHERE kind='TEST' AND config_version=$1 ORDER BY created_at DESC,id LIMIT 1",
          [draft?.version ?? 0],
        )
      ).rows[0];
      let actual: CosObjectStore | undefined,
        applied = false;
      if (!quarantined && stable) {
        try {
          actual = await createStorageSettingsResolver(this.pool, this.fallback, this.factory)(c);
          applied = true;
        } catch {
          /* Fail closed; report unapplied rather than claim success. */
        }
      }
      return {
        canManage: true,
        quarantined,
        keyConfigured: !quarantined && storageConfigKeyAvailable(),
        version: s.version,
        draft: draft
          ? { ...destination(draft), version: draft.version, credentialsConfigured: true }
          : null,
        active: {
          provider: active
            ? 'COS'
            : actual
              ? 'COS'
              : process.env.SCB_MEDIA_STORAGE === 'COS'
                ? 'COS'
                : 'DATABASE',
          source: active ? 'ADMIN' : 'ENVIRONMENT',
          version: active?.version ?? null,
          destination: active ? destination(active) : actual ? destination(actual) : null,
          applied,
        },
        test: latest?.test_result ?? null,
        destinationLocked: !!(pending.files || pending.pending),
        cleanupPending: !!pending.pending,
      };
    });
  }
  async operation(cookie: string | undefined, commandId: string): Promise<StorageCommandResult> {
    return this.transaction(async (c) => {
      const actor = await this.context(c, cookie);
      let r = (
        await c.query(
          'SELECT * FROM storage_config_operations WHERE actor_id=$1 AND command_id=$2',
          [actor.user.id, resourceId(commandId)],
        )
      ).rows[0];
      if (!r) throw notFound();
      if (
        r.kind === 'TEST' &&
        r.status === 'PENDING' &&
        (
          await c.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
            STORAGE_CONFIGURATION_LOCK,
          ])
        ).rows[0]?.locked === true
      ) {
        r = (await c.query('SELECT * FROM storage_config_operations WHERE id=$1', [r.id])).rows[0];
        if (!r) throw notFound();
        if (r.status !== 'PENDING') return this.receipt(r);
        const pending =
          (
            await c.query(
              'SELECT EXISTS(SELECT 1 FROM storage_config_probes WHERE deleted_at IS NULL) AS pending',
            )
          ).rows[0]?.pending !== false;
        const interrupted: StorageSettingsTest = r.test_result ?? {
          id: r.id,
          configVersion: r.config_version,
          status: 'RUNNING',
          checks: blankChecks(),
          cleanupPending: pending,
          completedAt: null,
          expiresAt: null,
          message: null,
        };
        interrupted.status = 'FAILED';
        interrupted.cleanupPending = pending;
        interrupted.completedAt = new Date().toISOString();
        interrupted.expiresAt = null;
        interrupted.message = '上次检测已中断，请保留当前地址并重新检测';
        await this.audit(
          c,
          actor.user.id,
          null,
          'STORAGE_TEST_INTERRUPTED',
          'storage_configuration',
          r.id,
          { version: r.config_version, testId: r.id },
        );
        return this.finish(
          c,
          r,
          { code: 'STORAGE_TEST_INTERRUPTED', message: interrupted.message },
          interrupted,
        );
      }
      return this.receipt(r);
    });
  }
  async saveDraft(cookie: string | undefined, raw: unknown): Promise<StorageCommandResult> {
    const input = parseSave(raw);
    return this.transaction(async (c) => {
      const actor = await this.context(c, cookie);
      await this.allowed(c);
      await this.exclusive(c);
      const command = await this.begin(
        c,
        actor,
        input.commandId,
        'SAVE',
        input,
        input.expectedVersion + 1,
      );
      if (command.replay) return this.receipt(command.row);
      const s = await this.state(c);
      if (s.version !== input.expectedVersion) fail('VERSION_CONFLICT', '配置已更新，请刷新后核对');
      await this.assertDestination(c, input);
      const previous = await this.revision(c, s.draft_revision_id);
      const credentials =
        input.secretId && input.secretKey
          ? { secretId: input.secretId, secretKey: input.secretKey }
          : previous
            ? decryptStorageCredentials(previous)
            : null;
      if (!credentials) invalid('首次保存需填写完整访问凭据');
      const revision = {
          id: randomUUID(),
          version: s.version + 1,
          mode: 'COS',
          ...destination(input),
        },
        encrypted = encryptStorageCredentials(revision, credentials);
      await c.query(
        `INSERT INTO storage_config_revisions(id,version,mode,bucket,region,prefix,credentials_ciphertext,credentials_nonce,credentials_tag,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          revision.id,
          revision.version,
          revision.mode,
          revision.bucket,
          revision.region,
          revision.prefix,
          encrypted.credentials_ciphertext,
          encrypted.credentials_nonce,
          encrypted.credentials_tag,
          actor.user.id,
        ],
      );
      await c.query(
        'UPDATE storage_config_state SET version=$1,draft_revision_id=$2 WHERE singleton=true',
        [revision.version, revision.id],
      );
      await this.audit(
        c,
        actor.user.id,
        null,
        'STORAGE_CONFIG_SAVED',
        'storage_configuration',
        revision.id,
        { version: revision.version },
      );
      return this.finish(c, command.row);
    });
  }
  async activate(cookie: string | undefined, raw: unknown): Promise<StorageCommandResult> {
    const input = parseActivation(raw);
    return this.transaction(async (c) => {
      const actor = await this.context(c, cookie);
      await this.allowed(c);
      await this.exclusive(c);
      const command = await this.begin(
        c,
        actor,
        input.commandId,
        'ACTIVATE',
        input,
        input.configVersion,
      );
      if (command.replay) return this.receipt(command.row);
      const s = await this.state(c),
        r = await this.revision(c, s.draft_revision_id);
      if (!r || s.version !== input.expectedVersion || r.version !== input.configVersion)
        fail('VERSION_CONFLICT', '配置已更新，请重新检测当前草稿');
      await this.assertDestination(c, destination(r));
      if (
        (await c.query('SELECT 1 FROM storage_config_probes WHERE deleted_at IS NULL LIMIT 1'))
          .rowCount
      )
        fail('STORAGE_CLEANUP_PENDING', '检测对象仍待清理，暂不可启用');
      const test = (
        await c.query(
          `SELECT * FROM storage_config_operations WHERE id=$1 AND kind='TEST' AND status='SUCCEEDED' AND config_version=$2
        AND completed_at>clock_timestamp()-interval '10 minutes'`,
          [input.testId, r.version],
        )
      ).rows[0];
      if (!test || test.test_result?.status !== 'PASSED')
        fail('STORAGE_TEST_REQUIRED', '请先完成当前配置的连接检测，检测结果有效10分钟');
      storeForStorageRevision(r, this.factory); // Verify decryptability/constructor with the same runtime loader.
      await c.query(
        'UPDATE storage_config_state SET version=version+1,active_revision_id=$1,activated_at=clock_timestamp(),activated_by=$2 WHERE singleton=true',
        [r.id, actor.user.id],
      );
      await this.audit(
        c,
        actor.user.id,
        null,
        'STORAGE_CONFIG_ACTIVATED',
        'storage_configuration',
        r.id,
        { version: r.version, testId: input.testId, privatePolicyConfirmed: true },
      );
      return this.finish(c, command.row);
    });
  }
  private async testTransaction<T>(c: PoolClient, work: () => Promise<T>): Promise<T> {
    await c.query('BEGIN');
    try {
      const v = await work();
      await c.query('COMMIT');
      return v;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  }
  private async cloudAllowed(c: PoolClient, cookie: string | undefined) {
    await this.testTransaction(c, async () => {
      await this.context(c, cookie);
      await this.allowed(c);
    });
  }
  private async persistTest(c: PoolClient, row: Row, test: StorageSettingsTest) {
    await c.query(
      "UPDATE storage_config_operations SET test_result=$2::jsonb WHERE id=$1 AND status='PENDING'",
      [row.id, JSON.stringify(test)],
    );
  }
  private async cleanupPrior(
    c: PoolClient,
    store: CosObjectStore,
    cookie: string | undefined,
    currentOperation: string,
  ) {
    const pending = await c.query(
      `SELECT *,created_at<=clock_timestamp()-interval '24 hours' AS grace_elapsed FROM storage_config_probes WHERE deleted_at IS NULL ORDER BY created_at,id LIMIT 21`,
    );
    if (pending.rows.length > 20)
      fail('STORAGE_CLEANUP_PENDING', '检测对象待维护清理，暂不可继续检测');
    for (const p of pending.rows) {
      if (!sameDestination(p, store))
        fail('STORAGE_DESTINATION_LOCKED', '旧检测对象需在原地址清理');
      if (!p.put_confirmed_at && !p.grace_elapsed)
        fail('STORAGE_CLEANUP_PENDING', '上次写入结果未知，检测登记保留24小时后再确认清理');
      await this.cloudAllowed(c, cookie);
      try {
        await store.delete({ bucket: p.bucket, region: p.region, key: p.object_key });
        await c.query('UPDATE storage_config_probes SET deleted_at=clock_timestamp() WHERE id=$1', [
          p.id,
        ]);
      } catch {
        await c.query(
          'UPDATE storage_config_probes SET cleanup_attempted_at=clock_timestamp() WHERE id=$1',
          [p.id],
        );
        fail('STORAGE_CLEANUP_PENDING', '旧检测对象删除失败，请核对删除权限后重试');
      }
    }
    // No running operation can own the lock now. Retain honest interrupted-test receipts.
    const old = await c.query(
      "SELECT * FROM storage_config_operations WHERE kind='TEST' AND status='PENDING' AND id<>$1",
      [currentOperation],
    );
    for (const op of old.rows) {
      const test = op.test_result as StorageSettingsTest | null;
      if (test) {
        test.status = 'FAILED';
        test.completedAt = new Date().toISOString();
        test.expiresAt = null;
        test.cleanupPending = false;
        test.message = '上次检测被中断，请重新检测';
      }
      await this.finish(
        c,
        op,
        { code: 'STORAGE_TEST_INTERRUPTED', message: '上次检测被中断，请重新检测' },
        test ?? undefined,
      );
    }
  }
  async testConnection(cookie: string | undefined, raw: unknown): Promise<StorageCommandResult> {
    const input = parseTest(raw),
      c = await this.pool.connect();
    let locked = false,
      releaseError = false,
      row: Row | undefined,
      test: StorageSettingsTest | undefined,
      probe: Row | undefined,
      store: CosObjectStore | undefined;
    try {
      const initial = await this.testTransaction(c, async () => {
        const actor = await this.context(c, cookie);
        await this.allowed(c);
        const old = (
          await c.query(
            'SELECT * FROM storage_config_operations WHERE actor_id=$1 AND command_id=$2',
            [actor.user.id, input.commandId],
          )
        ).rows[0];
        if (old) {
          if (old.kind !== 'TEST' || old.request_hash !== storageCommandDigest(['TEST', input]))
            fail('IDEMPOTENCY_CONFLICT', '同一操作编号已用于其他对象存储请求');
          return { replay: this.receipt(old) };
        }
        if (
          !(
            await c.query('SELECT pg_try_advisory_lock($1) AS locked', [STORAGE_CONFIGURATION_LOCK])
          ).rows[0]?.locked
        )
          fail('STORAGE_OPERATION_BUSY', '对象存储正在处理其他操作，请稍后查询');
        locked = true;
        const s = await this.state(c),
          r = await this.revision(c, s.draft_revision_id);
        if (!r || r.version !== input.configVersion)
          fail('VERSION_CONFLICT', '请保存并检测当前草稿');
        await this.assertDestination(c, destination(r));
        const last = (
          await c.query(
            "SELECT created_at>clock_timestamp()-interval '30 seconds' AS limited FROM storage_config_operations WHERE kind='TEST' ORDER BY created_at DESC LIMIT 1",
          )
        ).rows[0];
        if (last?.limited) fail('RATE_LIMITED', '连接检测间隔至少30秒', 429);
        const operation = (await this.begin(c, actor, input.commandId, 'TEST', input, r.version))
          .row;
        return { revision: r, actor, operation };
      });
      if ('replay' in initial) return initial.replay!;
      const revision = initial.revision!,
        actor = initial.actor!;
      row = initial.operation!;
      test = {
        id: row.id,
        configVersion: revision.version,
        status: 'RUNNING',
        checks: blankChecks(),
        cleanupPending: false,
        completedAt: null,
        expiresAt: null,
        message: null,
      };
      await this.persistTest(c, row, test);
      store = storeForStorageRevision(revision, (options) =>
        this.factory({ ...options, timeoutMs: 5000 }),
      )!;
      test.checks[0]!.status = 'PASSED';
      await this.persistTest(c, row, test);
      // The command receipt and probe cleanup are durable before the first new PUT.
      await this.cleanupPrior(c, store, cookie, row.id);
      const verifier = (store as CosObjectStore & { verifyConfiguration?: () => Promise<void> })
        .verifyConfiguration;
      if (!verifier) throw new Error('Missing bucket verification');
      await this.cloudAllowed(c, cookie);
      await verifier.call(store);
      test.checks[1]!.status = 'PASSED';
      await this.persistTest(c, row, test);
      const bytes = randomBytes(128),
        probeId = randomUUID(),
        key = `${store.prefix}/${randomUUID()}/${randomUUID()}/${probeId}`;
      probe = await this.testTransaction(c, async () => {
        await this.context(c, cookie);
        await this.allowed(c);
        return (
          await c.query(
            `INSERT INTO storage_config_probes(id,operation_id,revision_id,bucket,region,prefix,object_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [probeId, row!.id, revision.id, store!.bucket, store!.region, store!.prefix, key],
          )
        ).rows[0];
      });
      test.cleanupPending = true;
      await this.persistTest(c, row, test);
      await this.cloudAllowed(c, cookie);
      await store.put(key, bytes, 'image/png');
      await c.query(
        'UPDATE storage_config_probes SET put_confirmed_at=clock_timestamp() WHERE id=$1',
        [probeId],
      );
      probe!.put_confirmed_at = true;
      await this.cloudAllowed(c, cookie);
      const got = await store.get({ bucket: store.bucket, region: store.region, key });
      if (
        !Buffer.isBuffer(got) ||
        got.length !== bytes.length ||
        !createHash('sha256')
          .update(got)
          .digest()
          .equals(createHash('sha256').update(bytes).digest())
      )
        throw new Error('Round-trip mismatch');
      test.checks[2]!.status = 'PASSED';
      await this.persistTest(c, row, test);
      await this.cloudAllowed(c, cookie);
      await store.delete({ bucket: store.bucket, region: store.region, key });
      await c.query('UPDATE storage_config_probes SET deleted_at=clock_timestamp() WHERE id=$1', [
        probeId,
      ]);
      probe = undefined;
      test.cleanupPending = false;
      test.checks[3]!.status = 'PASSED';
      await this.cloudAllowed(c, cookie);
      test.status = 'PASSED';
      test.completedAt = new Date().toISOString();
      test.expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      return await this.testTransaction(c, async () => {
        await this.context(c, cookie);
        await this.allowed(c);
        await this.audit(
          c,
          actor.user.id,
          null,
          'STORAGE_CONFIG_TESTED',
          'storage_configuration',
          revision.id,
          { version: revision.version, testId: row!.id, status: 'PASSED' },
        );
        return this.finish(c, row!, null, test);
      });
    } catch (e) {
      if (!row || !test) throw e;
      const next = test.checks.find((check) => check.status === 'NOT_RUN');
      if (next) next.status = 'FAILED';
      // Only an acknowledged PUT may be immediately cleaned. An unknown PUT remains registered
      // for the full grace period, so a late cloud completion cannot become an untracked orphan.
      if (probe?.put_confirmed_at && store) {
        try {
          await this.cloudAllowed(c, cookie);
          await store.delete({ bucket: probe.bucket, region: probe.region, key: probe.object_key });
          await c.query(
            'UPDATE storage_config_probes SET deleted_at=clock_timestamp() WHERE id=$1',
            [probe.id],
          );
          probe = undefined;
          test.checks[3]!.status = 'PASSED';
        } catch {
          await c.query(
            'UPDATE storage_config_probes SET cleanup_attempted_at=clock_timestamp() WHERE id=$1',
            [probe!.id],
          );
          test.checks[3]!.status = 'FAILED';
        }
      }
      test.cleanupPending =
        (
          await c.query(
            'SELECT EXISTS(SELECT 1 FROM storage_config_probes WHERE deleted_at IS NULL) AS pending',
          )
        ).rows[0]?.pending !== false;
      test.status = 'FAILED';
      test.completedAt = new Date().toISOString();
      test.expiresAt = null;
      const error =
        e instanceof ApiError &&
        [
          'STORAGE_QUARANTINED',
          'FORBIDDEN',
          'UNAUTHENTICATED',
          'STORAGE_CLEANUP_PENDING',
          'STORAGE_DESTINATION_LOCKED',
          'STORAGE_CONFIG_KEY_UNAVAILABLE',
        ].includes(e.code)
          ? { code: e.code, message: e.message }
          : unavailable();
      test.message = test.cleanupPending
        ? '检测未完成，检测对象仍待清理；请保留原地址后重试'
        : error.message;
      return await this.testTransaction(c, async () => {
        await this.audit(
          c,
          row!.actor_id,
          null,
          'STORAGE_CONFIG_TESTED',
          'storage_configuration',
          row!.id,
          { version: row!.config_version, testId: row!.id, status: 'FAILED', code: error.code },
        );
        return this.finish(c, row!, error, test);
      });
    } finally {
      if (locked) {
        try {
          await c.query('SELECT pg_advisory_unlock($1)', [STORAGE_CONFIGURATION_LOCK]);
        } catch {
          releaseError = true;
        }
      }
      c.release(releaseError);
    }
  }
}
