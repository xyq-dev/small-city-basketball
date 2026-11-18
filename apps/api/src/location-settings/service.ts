import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  LocationCommandResult,
  LocationSaveInput,
  LocationSettingsSnapshot,
  LocationSettingsTest,
  LocationTestCheck,
} from '@small-city-basketball/contracts';
import { ApplicationService } from '../service.js';
import type { Actor, ApiOptions } from '../service.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { invalid, objectInput, resourceId } from '../validation.js';
import {
  AmapLocationProvider,
  LOCATION_PROBE,
  TencentLocationProvider,
} from '../location-provider.js';
import type { LocationProvider } from '../location-provider.js';
import {
  decryptLocationSecrets,
  encryptLocationSecrets,
  locationCommandDigest,
  locationConfigKeyAvailable,
} from './crypto.js';
import type { LocationSecrets } from './crypto.js';
import { LOCATION_CONFIGURATION_LOCK } from './locking.js';

type Row = Record<string, any>;
type Kind = LocationCommandResult['kind'];
type Transport = typeof fetch;
export interface LocationSettingsOptions {
  transport?: Transport;
}
const checks = (): LocationTestCheck[] =>
  (['CREDENTIALS', 'REVERSE', 'PLACE_SEARCH'] as const).map((key) => ({
    key,
    status: 'NOT_RUN',
    message: null,
  }));
function fail(code: string, message: string, status = 409): never {
  throw new ApiError(status, code, message);
}
function uuid(value: unknown): string {
  if (typeof value !== 'string') invalid('请提供有效操作编号');
  return resourceId(value);
}
function integer(value: unknown, minimum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > 2147483646)
    invalid('请提供有效配置版本');
  return value as number;
}
function secretValue(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > 256 ||
    /[\s\u0000-\u001f]/.test(value) ||
    /^[*•●]+$/.test(value)
  )
    invalid(`${label}需要填写完整值，不能使用掩码`);
  return value;
}
function action(value: unknown): 'KEEP' | 'REPLACE' | 'CLEAR' {
  if (value !== 'KEEP' && value !== 'REPLACE' && value !== 'CLEAR')
    invalid('请明确选择保留、更换或清除密钥');
  return value;
}
function parseSave(raw: unknown): LocationSaveInput {
  const value = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'provider',
    'signatureEnabled',
    'webKeyAction',
    'webKey',
    'privateKeyAction',
    'privateKey',
  ]);
  if (value.provider !== 'AMAP' && value.provider !== 'TENCENT') invalid('请选择高德或腾讯');
  if (typeof value.signatureEnabled !== 'boolean') invalid('请明确数字签名开关');
  return {
    commandId: uuid(value.commandId),
    expectedVersion: integer(value.expectedVersion, 0),
    provider: value.provider,
    signatureEnabled: value.provider === 'AMAP' && value.signatureEnabled,
    webKeyAction: action(value.webKeyAction),
    ...(value.webKeyAction === 'REPLACE'
      ? { webKey: secretValue(value.webKey, 'Web 服务 Key') }
      : {}),
    privateKeyAction: action(value.privateKeyAction),
    ...(value.privateKeyAction === 'REPLACE'
      ? { privateKey: secretValue(value.privateKey, '签名私钥') }
      : {}),
  };
}
function parseTest(raw: unknown) {
  const value = objectInput(raw, ['commandId', 'configVersion', 'confirmCloudTest']);
  if (value.confirmCloudTest !== true) invalid('请确认检测将访问地图官方接口');
  return {
    commandId: uuid(value.commandId),
    configVersion: integer(value.configVersion, 1),
    confirmCloudTest: true as const,
  };
}
function parseActivation(raw: unknown) {
  const value = objectInput(raw, ['commandId', 'expectedVersion', 'configVersion', 'testId']);
  return {
    commandId: uuid(value.commandId),
    expectedVersion: integer(value.expectedVersion, 0),
    configVersion: integer(value.configVersion, 1),
    testId: uuid(value.testId),
  };
}
function parseDisable(raw: unknown) {
  const value = objectInput(raw, ['commandId', 'expectedVersion']);
  return { commandId: uuid(value.commandId), expectedVersion: integer(value.expectedVersion, 0) };
}

export class LocationSettingsService extends ApplicationService {
  private readonly transport: Transport;
  constructor(pool: Pool, options: ApiOptions, settings: LocationSettingsOptions = {}) {
    super(pool, options);
    this.transport = settings.transport ?? fetch;
  }
  private async context(client: PoolClient, cookie?: string): Promise<Actor> {
    const actor = await this.lockActor(client, cookie);
    if (
      !(
        await client.query(
          "SELECT user_id FROM platform_operators WHERE user_id=$1 AND status='ACTIVE' FOR SHARE",
          [actor.user.id],
        )
      ).rowCount
    )
      throw forbidden();
    return actor;
  }
  private async exclusive(client: PoolClient) {
    if (
      !(
        await client.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
          LOCATION_CONFIGURATION_LOCK,
        ])
      ).rows[0]?.locked
    )
      fail('LOCATION_OPERATION_BUSY', '定位配置正在处理其他操作，请稍后查询或重试');
  }
  private async state(client: PoolClient): Promise<Row> {
    const row = (await client.query('SELECT * FROM location_config_state WHERE singleton=true'))
      .rows[0];
    if (!row) fail('LOCATION_CONFIG_UNAVAILABLE', '定位配置不可用', 503);
    return row;
  }
  private async revision(client: PoolClient, id: string | null): Promise<Row | null> {
    if (!id) return null;
    const row = (await client.query('SELECT * FROM location_config_revisions WHERE id=$1', [id]))
      .rows[0];
    if (!row) fail('LOCATION_CONFIG_UNAVAILABLE', '定位配置不可用', 503);
    return row;
  }
  private receipt(row: Row): LocationCommandResult {
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
    client: PoolClient,
    actor: Actor,
    command: string,
    kind: Kind,
    request: unknown,
    version: number,
  ) {
    const hash = locationCommandDigest([kind, request]);
    const old = (
      await client.query(
        'SELECT * FROM location_config_operations WHERE actor_id=$1 AND command_id=$2',
        [actor.user.id, command],
      )
    ).rows[0];
    if (old) {
      if (old.request_hash !== hash || old.kind !== kind)
        fail('IDEMPOTENCY_CONFLICT', '同一操作编号已用于其他定位配置请求');
      return { row: old, replay: true };
    }
    const inserted = await client.query(
      `INSERT INTO location_config_operations(id,actor_id,command_id,request_hash,kind,status,config_version)
       VALUES($1,$2,$3,$4,$5,'PENDING',$6) RETURNING *`,
      [randomUUID(), actor.user.id, command, hash, kind, version],
    );
    return { row: inserted.rows[0], replay: false };
  }
  private async finish(
    client: PoolClient,
    row: Row,
    error: LocationCommandResult['error'] = null,
    test?: LocationSettingsTest,
  ): Promise<LocationCommandResult> {
    const result: LocationCommandResult = {
      commandId: row.command_id,
      kind: row.kind,
      status: error ? 'FAILED' : 'SUCCEEDED',
      configVersion: row.config_version || null,
      testId: row.kind === 'TEST' ? row.id : null,
      error,
    };
    const updated = await client.query(
      `UPDATE location_config_operations SET status=$2,result=$3::jsonb,test_result=COALESCE($4::jsonb,test_result),completed_at=clock_timestamp()
       WHERE id=$1 AND status='PENDING' RETURNING id`,
      [
        row.id,
        error ? 'FAILED' : 'SUCCEEDED',
        JSON.stringify(result),
        test ? JSON.stringify(test) : null,
      ],
    );
    if (updated.rowCount !== 1)
      fail('LOCATION_OPERATION_UNAVAILABLE', '操作结果尚未确认，请查询原操作编号', 503);
    return result;
  }
  private secretsFor(input: LocationSaveInput, previous: Row | null): LocationSecrets {
    const sameProvider = previous?.provider === input.provider;
    const stored = previous ? decryptLocationSecrets(this.identity(previous)) : null;
    let webKey = '';
    if (input.webKeyAction === 'CLEAR') invalid('清除 Web 服务 Key 后不能保存空草稿，请改为更换');
    if (input.webKeyAction === 'REPLACE') webKey = input.webKey!;
    else if (sameProvider && stored) webKey = stored.webKey;
    else invalid('更换服务商或首次保存需要填写 Web 服务 Key');
    let privateKey: string | null = null;
    if (input.signatureEnabled) {
      if (input.privateKeyAction === 'CLEAR') invalid('开启数字签名时不能清除私钥');
      if (input.privateKeyAction === 'REPLACE') privateKey = input.privateKey!;
      else if (sameProvider && stored?.privateKey) privateKey = stored.privateKey;
      else invalid('开启数字签名需要填写或保留签名私钥');
    }
    return { webKey, privateKey };
  }
  private identity(row: Row) {
    return {
      id: row.id,
      version: row.version,
      provider: row.provider,
      signatureEnabled: row.signature_enabled,
      credentials_ciphertext: row.credentials_ciphertext,
      credentials_nonce: row.credentials_nonce,
      credentials_tag: row.credentials_tag,
    };
  }
  private providerFor(row: Row): LocationProvider {
    const secrets = decryptLocationSecrets(this.identity(row));
    if (row.provider === 'AMAP')
      return new AmapLocationProvider(
        secrets.webKey,
        row.signature_enabled ? (secrets.privateKey ?? undefined) : undefined,
        this.transport,
      );
    return new TencentLocationProvider(secrets.webKey, this.transport);
  }
  async snapshot(cookie?: string): Promise<LocationSettingsSnapshot> {
    return this.transaction(async (client) => {
      await this.context(client, cookie);
      const state = await this.state(client);
      const draft = await this.revision(client, state.draft_revision_id);
      const active = await this.revision(client, state.active_revision_id);
      const latest = draft
        ? (
            await client.query(
              "SELECT test_result FROM location_config_operations WHERE kind='TEST' AND config_version=$1 ORDER BY created_at DESC,id LIMIT 1",
              [draft.version],
            )
          ).rows[0]
        : null;
      const envConfigured =
        process.env.SCB_TENCENT_MAP_KEY !== undefined ||
        process.env.SCB_TENCENT_MAP_KEY_FILE !== undefined;
      const mode = state.external_mode as LocationSettingsSnapshot['active']['status'];
      return {
        canManage: true,
        keyConfigured: locationConfigKeyAvailable(),
        version: state.version,
        draft: draft
          ? {
              version: draft.version,
              provider: draft.provider,
              signatureEnabled: draft.signature_enabled,
              webKeyConfigured: true,
              privateKeyConfigured: draft.signature_enabled,
            }
          : null,
        active: {
          provider:
            mode === 'ACTIVE' && active
              ? active.provider
              : mode === 'DISABLED'
                ? 'NONE'
                : envConfigured
                  ? 'TENCENT'
                  : 'NONE',
          source: mode === 'ACTIVE' ? 'ADMIN' : mode === 'DISABLED' ? 'DISABLED' : 'ENVIRONMENT',
          version: mode === 'ACTIVE' ? (active?.version ?? null) : null,
          applied: mode === 'ACTIVE' && !!active,
          status: mode,
        },
        test: latest?.test_result ?? null,
      };
    });
  }
  async operation(cookie: string | undefined, commandId: string): Promise<LocationCommandResult> {
    return this.transaction(async (client) => {
      const actor = await this.context(client, cookie);
      const row = (
        await client.query(
          'SELECT * FROM location_config_operations WHERE actor_id=$1 AND command_id=$2',
          [actor.user.id, resourceId(commandId)],
        )
      ).rows[0];
      if (!row) throw notFound();
      if (row.status !== 'PENDING') return this.receipt(row);
      if (
        !(
          await client.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
            LOCATION_CONFIGURATION_LOCK,
          ])
        ).rows[0]?.locked
      )
        return this.receipt(row);
      const current = (
        await client.query('SELECT * FROM location_config_operations WHERE id=$1', [row.id])
      ).rows[0];
      if (!current || current.status !== 'PENDING') return this.receipt(current ?? row);
      const interrupted: LocationSettingsTest = current.test_result ?? {
        id: current.id,
        configVersion: current.config_version,
        status: 'FAILED',
        checks: checks(),
        completedAt: new Date().toISOString(),
        message: '上次检测已中断，请重新检测。这不是云端连通结论。',
      };
      interrupted.status = 'FAILED';
      interrupted.completedAt = new Date().toISOString();
      interrupted.message = '上次检测已中断，请重新检测。这不是云端连通结论。';
      return this.finish(
        client,
        current,
        { code: 'LOCATION_TEST_INTERRUPTED', message: interrupted.message },
        interrupted,
      );
    });
  }
  async saveDraft(cookie: string | undefined, raw: unknown): Promise<LocationCommandResult> {
    const input = parseSave(raw);
    return this.transaction(async (client) => {
      const actor = await this.context(client, cookie);
      if (!locationConfigKeyAvailable())
        fail('LOCATION_CONFIG_KEY_UNAVAILABLE', '地图配置密钥不可用，请联系部署维护人员', 503);
      await this.exclusive(client);
      const command = await this.begin(
        client,
        actor,
        input.commandId,
        'SAVE',
        input,
        input.expectedVersion + 1,
      );
      if (command.replay) return this.receipt(command.row);
      const state = await this.state(client);
      if (state.version !== input.expectedVersion)
        fail('VERSION_CONFLICT', '配置已更新，请刷新后核对');
      const previous = await this.revision(client, state.draft_revision_id);
      const secrets = this.secretsFor(input, previous);
      const revision = {
        id: randomUUID(),
        version: state.version + 1,
        provider: input.provider,
        signatureEnabled: input.signatureEnabled,
      };
      const encrypted = encryptLocationSecrets(revision, secrets);
      await client.query(
        `INSERT INTO location_config_revisions(id,version,provider,signature_enabled,credentials_ciphertext,credentials_nonce,credentials_tag,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          revision.id,
          revision.version,
          revision.provider,
          revision.signatureEnabled,
          encrypted.credentials_ciphertext,
          encrypted.credentials_nonce,
          encrypted.credentials_tag,
          actor.user.id,
        ],
      );
      await client.query(
        `UPDATE location_config_state SET version=version+1,draft_revision_id=$2 WHERE singleton=true AND version=$1`,
        [state.version, revision.id],
      );
      await this.audit(
        client,
        actor.user.id,
        null,
        'LOCATION_DRAFT_SAVED',
        'location_configuration',
        revision.id,
        {
          version: revision.version,
          provider: revision.provider,
          signatureEnabled: revision.signatureEnabled,
          webKeyAction: input.webKeyAction,
          privateKeyAction: input.privateKeyAction,
        },
      );
      return this.finish(client, { ...command.row, config_version: revision.version });
    });
  }
  async testConnection(cookie: string | undefined, raw: unknown): Promise<LocationCommandResult> {
    const input = parseTest(raw);
    const opened = await this.transaction(async (client) => {
      const actor = await this.context(client, cookie);
      await this.exclusive(client);
      const existing = (
        await client.query(
          'SELECT * FROM location_config_operations WHERE actor_id=$1 AND command_id=$2',
          [actor.user.id, input.commandId],
        )
      ).rows[0];
      if (existing) {
        if (
          existing.kind !== 'TEST' ||
          existing.request_hash !== locationCommandDigest(['TEST', input])
        )
          fail('IDEMPOTENCY_CONFLICT', '同一操作编号已用于其他定位配置请求');
        return { replay: this.receipt(existing) };
      }
      const state = await this.state(client);
      const draft = await this.revision(client, state.draft_revision_id);
      if (!draft || draft.version !== input.configVersion)
        fail('VERSION_CONFLICT', '请保存并检测当前草稿');
      const limited = (
        await client.query(
          "SELECT created_at>clock_timestamp()-interval '30 seconds' AS limited FROM location_config_operations WHERE kind='TEST' ORDER BY created_at DESC LIMIT 1",
        )
      ).rows[0];
      if (limited?.limited) fail('RATE_LIMITED', '配置检测间隔至少30秒', 429);
      const operation = (
        await this.begin(client, actor, input.commandId, 'TEST', input, draft.version)
      ).row;
      return { draft, operation };
    });
    if ('replay' in opened) return opened.replay!;
    const report: LocationSettingsTest = {
      id: opened.operation.id,
      configVersion: opened.draft.version,
      status: 'FAILED',
      checks: checks(),
      completedAt: null,
      message: null,
    };
    const mark = (
      key: LocationTestCheck['key'],
      status: LocationTestCheck['status'],
      message: string,
    ) => {
      const check = report.checks.find((item) => item.key === key)!;
      check.status = status;
      check.message = message;
    };
    let error: LocationCommandResult['error'] = null;
    try {
      const provider = this.providerFor(opened.draft);
      if (!provider.enabled) {
        mark('CREDENTIALS', 'FAILED', '草稿没有可用的 Web 服务 Key');
        throw new ApiError(422, 'LOCATION_KEY_INVALID', '草稿没有可用的 Web 服务 Key');
      }
      mark('CREDENTIALS', 'PASSED', '密钥已配置。未查询剩余额度，也未核验微信后台权限。');
      await provider.reverse(LOCATION_PROBE);
      mark('REVERSE', 'PASSED', `逆地理使用公开参考点：${LOCATION_PROBE.label}`);
      const places = await provider.search(
        LOCATION_PROBE.keyword,
        LOCATION_PROBE.sourceCode,
        LOCATION_PROBE,
      );
      mark(
        'PLACE_SEARCH',
        'PASSED',
        places.length
          ? '地点搜索返回了参考结果，不会自动成为可预约场地'
          : '官方接口成功，没有匹配地点。这不是已开通。',
      );
      report.status = 'PASSED';
      report.message = '检测请求已返回。通过检测不会切换当前服务商，也不代表剩余额度。';
    } catch (cause) {
      const api = cause instanceof ApiError ? cause : null;
      error = {
        code: api?.code ?? 'LOCATION_PROVIDER_UNAVAILABLE',
        message: api?.message ?? '地图检测失败，请稍后重试或手动选城',
      };
      for (const check of report.checks) {
        if (check.status === 'NOT_RUN') {
          check.status = 'FAILED';
          check.message = error.message;
        }
      }
      report.message = error.message;
    }
    report.completedAt = new Date().toISOString();
    return this.transaction(async (client) => {
      const actor = await this.context(client, cookie);
      await this.exclusive(client);
      const row = (
        await client.query('SELECT * FROM location_config_operations WHERE id=$1', [
          opened.operation.id,
        ])
      ).rows[0];
      if (!row || row.status !== 'PENDING') return this.receipt(row);
      await this.audit(
        client,
        actor.user.id,
        null,
        'LOCATION_TESTED',
        'location_configuration',
        row.id,
        {
          version: report.configVersion,
          status: report.status,
        },
      );
      return this.finish(client, row, error, report);
    });
  }
  async activate(cookie: string | undefined, raw: unknown): Promise<LocationCommandResult> {
    const input = parseActivation(raw);
    return this.transaction(async (client) => {
      const actor = await this.context(client, cookie);
      await this.exclusive(client);
      const command = await this.begin(
        client,
        actor,
        input.commandId,
        'ACTIVATE',
        input,
        input.expectedVersion + 1,
      );
      if (command.replay) return this.receipt(command.row);
      const state = await this.state(client);
      if (state.version !== input.expectedVersion)
        fail('VERSION_CONFLICT', '配置已更新，请刷新后核对');
      const draft = await this.revision(client, state.draft_revision_id);
      if (!draft || draft.version !== input.configVersion)
        fail('VERSION_CONFLICT', '只能启用当前已保存的草稿');
      const test = (
        await client.query(
          "SELECT * FROM location_config_operations WHERE id=$1 AND kind='TEST' AND status='SUCCEEDED' AND config_version=$2",
          [input.testId, draft.version],
        )
      ).rows[0];
      if (!test || test.test_result?.status !== 'PASSED')
        fail('LOCATION_TEST_REQUIRED', '请先对这一版草稿完成检测，再启用');
      await client.query(
        `UPDATE location_config_state
         SET version=version+1,external_mode='ACTIVE',active_revision_id=draft_revision_id,
             activated_at=clock_timestamp(),activated_by=$2,disabled_at=NULL,disabled_by=NULL
         WHERE singleton=true AND version=$1`,
        [state.version, actor.user.id],
      );
      await this.audit(
        client,
        actor.user.id,
        null,
        'LOCATION_ACTIVATED',
        'location_configuration',
        draft.id,
        {
          version: draft.version,
          provider: draft.provider,
          testId: input.testId,
        },
      );
      return this.finish(client, { ...command.row, config_version: draft.version });
    });
  }
  async disable(cookie: string | undefined, raw: unknown): Promise<LocationCommandResult> {
    const input = parseDisable(raw);
    return this.transaction(async (client) => {
      const actor = await this.context(client, cookie);
      await this.exclusive(client);
      const command = await this.begin(
        client,
        actor,
        input.commandId,
        'DISABLE',
        input,
        input.expectedVersion + 1,
      );
      if (command.replay) return this.receipt(command.row);
      const state = await this.state(client);
      if (state.version !== input.expectedVersion)
        fail('VERSION_CONFLICT', '配置已更新，请刷新后核对');
      if (state.external_mode === 'DISABLED')
        fail('LOCATION_ALREADY_DISABLED', '外部地图服务已经停用');
      await client.query(
        `UPDATE location_config_state
         SET version=version+1,external_mode='DISABLED',disabled_at=clock_timestamp(),disabled_by=$2
         WHERE singleton=true AND version=$1`,
        [state.version, actor.user.id],
      );
      await this.audit(
        client,
        actor.user.id,
        null,
        'LOCATION_DISABLED',
        'location_configuration',
        state.singleton
          ? (state.draft_revision_id ?? state.active_revision_id ?? actor.user.id)
          : actor.user.id,
        {
          version: state.version + 1,
        },
      );
      return this.finish(client, { ...command.row, config_version: state.version + 1 });
    });
  }
}
