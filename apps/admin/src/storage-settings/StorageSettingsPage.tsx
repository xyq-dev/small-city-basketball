import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type {
  StorageCommandResult,
  StorageDestination,
  StorageSaveInput,
  StorageSettingsSnapshot,
  StorageTestCheckKey,
} from '@small-city-basketball/contracts';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Database,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { ApiError, type ApiClient } from '../api/client';
import { createStorageSettingsApi, type StorageSettingsApi } from './api';
import './storage-settings.css';

export interface StorageSettingsPageProps {
  client: ApiClient;
  userId: string;
  platformOperator: boolean;
  identityKey?: string;
}

let identitySequence = 0;
export function StorageSettingsPage({
  client,
  userId,
  platformOperator,
  identityKey,
}: StorageSettingsPageProps) {
  const api = useMemo(() => createStorageSettingsApi(client), [client]);
  const identity = useMemo(
    () => ++identitySequence,
    [client, userId, platformOperator, identityKey],
  );
  if (!platformOperator) return <Denied />;
  return <StorageDesk key={identity} api={api} />;
}

function Denied() {
  return (
    <section className="storage-settings ss-denied panel">
      <span className="ss-denied-icon">
        <ShieldCheck size={30} />
      </span>
      <h1>当前身份不能管理对象存储</h1>
      <p>
        对象存储是平台级配置，仅平台运维人员可以查看和修改。机构负责人和机构管理员不具有此权限。
      </p>
    </section>
  );
}

const regions = [
  ['ap-guangzhou', '广州 · ap-guangzhou'],
  ['ap-shanghai', '上海 · ap-shanghai'],
  ['ap-beijing', '北京 · ap-beijing'],
  ['ap-chengdu', '成都 · ap-chengdu'],
  ['ap-hongkong', '香港 · ap-hongkong'],
] as const;
const checks: { key: StorageTestCheckKey; label: string }[] = [
  { key: 'DESTINATION', label: '存储桶与地域' },
  { key: 'VERSIONING', label: '版本控制从未启用' },
  { key: 'ROUND_TRIP', label: '写入、回读及内容校验' },
  { key: 'DELETE', label: '删除本次检测文件' },
];
type Pending = {
  commandId: string;
  kind: StorageCommandResult['kind'];
  configVersion: number | null;
};
type Fields = StorageDestination & { secretId: string; secretKey: string };
const blank = (): Fields => ({
  bucket: '',
  region: 'ap-guangzhou',
  prefix: 'scb-media/v1',
  secretId: '',
  secretKey: '',
});
function errorText(error: unknown) {
  return error instanceof Error ? error.message : '操作未完成，请重新读取状态';
}
function uncertain(error: unknown) {
  return (
    !(error instanceof ApiError) ||
    error.status === 0 ||
    error.status >= 500 ||
    error.apiCode === 'INVALID_RESPONSE'
  );
}
function validTest(snapshot: StorageSettingsSnapshot, time: number) {
  const test = snapshot.test;
  return (
    !!test &&
    !!snapshot.draft &&
    test.status === 'PASSED' &&
    test.configVersion === snapshot.draft.version &&
    !test.cleanupPending &&
    !!test.expiresAt &&
    Number.isFinite(Date.parse(test.expiresAt)) &&
    Date.parse(test.expiresAt) > time &&
    checks.every(({ key }) =>
      test.checks.some((check) => check.key === key && check.status === 'PASSED'),
    )
  );
}
function applied(snapshot: StorageSettingsSnapshot, version: number) {
  return (
    snapshot.active.provider === 'COS' &&
    snapshot.active.source === 'ADMIN' &&
    snapshot.active.version === version &&
    snapshot.active.applied
  );
}

function StorageDesk({ api }: { api: StorageSettingsApi }) {
  const [snapshot, setSnapshot] = useState<StorageSettingsSnapshot | null>(null);
  const [fields, setFields] = useState<Fields>(blank);
  const [rotate, setRotate] = useState(false);
  const [privateConfirmed, setPrivateConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [modal, setModal] = useState<'test' | 'activate' | null>(null);
  const [now, setNow] = useState(Date.now());
  const alive = useRef(false);
  const lock = useRef(false);
  const reads = useRef(0);

  function denyIfForbidden(cause: unknown) {
    if (!(cause instanceof ApiError) || cause.status !== 403) return false;
    setRevoked(true);
    setModal(null);
    setFields((previous) => ({ ...previous, secretId: '', secretKey: '' }));
    setRotate(false);
    setPrivateConfirmed(false);
    setSnapshot(null);
    setPending(null);
    setError('');
    setNotice('');
    reads.current += 1;
    return true;
  }

  function receive(next: StorageSettingsSnapshot, replaceForm: boolean) {
    setSnapshot(next);
    setNow(Date.now());
    if (replaceForm) {
      const destination = next.draft ?? next.active.destination;
      setFields(
        destination
          ? {
              bucket: destination.bucket,
              region: destination.region,
              prefix: destination.prefix,
              secretId: '',
              secretKey: '',
            }
          : blank(),
      );
      setRotate(false);
      setPrivateConfirmed(false);
      setFieldErrors({});
    } else if (next.quarantined || next.draft?.version !== snapshot?.draft?.version) {
      setPrivateConfirmed(false);
    }
  }
  async function refresh(replaceForm = true, signal?: AbortSignal) {
    const read = ++reads.current;
    const next = await api.read(signal);
    if (!alive.current || read !== reads.current) return null;
    receive(next, replaceForm);
    return next;
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void refresh(true, controller.signal)
      .catch((cause) => {
        if (alive.current && !denyIfForbidden(cause)) setError(errorText(cause));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      reads.current += 1;
      controller.abort();
    };
  }, [api]);
  useEffect(() => {
    const expiry = snapshot?.test?.expiresAt;
    if (!expiry) return;
    const remaining = Date.parse(expiry) - Date.now();
    if (remaining <= 0 || !Number.isFinite(remaining)) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(remaining + 20, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [snapshot?.test?.expiresAt]);

  const draft = snapshot?.draft;
  const dirty =
    !draft ||
    fields.bucket !== draft.bucket ||
    fields.region !== draft.region ||
    fields.prefix !== draft.prefix ||
    rotate ||
    !!fields.secretId ||
    !!fields.secretKey;
  const locationLocked = !!snapshot && (snapshot.destinationLocked || snapshot.cleanupPending);
  const recoveryDestination =
    snapshot?.destinationLocked &&
    draft &&
    snapshot.active.provider === 'COS' &&
    snapshot.active.destination &&
    (draft.bucket !== snapshot.active.destination.bucket ||
      draft.region !== snapshot.active.destination.region ||
      draft.prefix !== snapshot.active.destination.prefix)
      ? snapshot.active.destination
      : null;
  const unavailable =
    !snapshot || !snapshot.canManage || snapshot.quarantined || !snapshot.keyConfigured;
  const blocked = unavailable || busy || !!pending || needsRefresh;
  const testPassed = !!snapshot && validTest(snapshot, now) && !dirty;
  const canTest = !blocked && !!draft && !dirty && !recoveryDestination;
  const canActivate =
    !blocked &&
    !!snapshot &&
    testPassed &&
    privateConfirmed &&
    !snapshot.cleanupPending &&
    !recoveryDestination;
  const currentApplied = !!snapshot && !!draft && applied(snapshot, draft.version);
  function change(key: keyof Fields, value: string) {
    setFields((previous) => ({ ...previous, [key]: value }));
    setPrivateConfirmed(false);
    setNotice('');
    setFieldErrors((previous) => ({ ...previous, [key]: undefined }));
  }
  function restoreDestination() {
    if (blocked || !recoveryDestination) return;
    setFields((previous) => ({ ...previous, ...recoveryDestination }));
    setSnapshot((previous) => (previous ? { ...previous, test: null } : previous));
    setPrivateConfirmed(false);
    setFieldErrors({});
    setError('');
    setModal(null);
    setNotice('已填回当前实际存储位置，尚未保存。请核对访问密钥，保存草稿后重新检测。');
  }

  async function resolve(result: StorageCommandResult, operation: Pending) {
    if (result.commandId !== operation.commandId || result.kind !== operation.kind)
      throw new ApiError(200, 'INVALID_RESPONSE', '操作回执不匹配，请查询原操作结果');
    if (
      operation.kind === 'ACTIVATE' &&
      (result.status === 'SUCCEEDED' || result.configVersion !== null) &&
      result.configVersion !== operation.configVersion
    )
      throw new ApiError(200, 'INVALID_RESPONSE', '启用版本回执不匹配，请查询原操作结果');
    if (result.status === 'RUNNING') {
      setNotice('操作正在处理，请查询操作结果。当前存储方式以服务状态为准。');
      await refresh(false);
      return;
    }
    if (result.status === 'FAILED') {
      await refresh(false);
      if (!alive.current) return;
      setPending(null);
      setPrivateConfirmed(false);
      setError(result.error?.message || '操作未完成，请检查配置后重试');
      return;
    }
    const next = await refresh(operation.kind === 'SAVE');
    if (!next || !alive.current) return;
    if (operation.kind === 'ACTIVATE') {
      const target = operation.configVersion;
      if (
        target !== null &&
        next.active.provider === 'COS' &&
        next.active.source === 'ADMIN' &&
        next.active.applied &&
        next.active.version !== null &&
        next.active.version > target
      ) {
        setPending(null);
        setNeedsRefresh(true);
        setPrivateConfirmed(false);
        setNotice(
          `本次启用版本 v${target} 已被后续配置 v${next.active.version} 取代。请重新读取状态并核对当前配置。`,
        );
        return;
      }
      if (target === null || !applied(next, target)) {
        setNotice('启用申请已记录，等待服务确认实际使用此版本。请查询操作结果。');
        return;
      }
      setNotice(`服务已确认：COS 配置 v${target} 已生效。`);
    } else if (operation.kind === 'SAVE') {
      setNotice(
        `草稿 v${result.configVersion ?? next.draft?.version ?? ''} 已保存，当前存储方式未改变。`,
      );
    } else {
      setPrivateConfirmed(false);
      setNotice(
        next.test?.status === 'PASSED'
          ? '连接检测通过，尚未启用。请人工确认私有访问策略。'
          : '检测已完成，请查看检测结果。',
      );
    }
    setPending(null);
  }

  async function run(operation: Pending, submit: () => Promise<StorageCommandResult>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setPending(operation);
    try {
      const result = await submit();
      if (!alive.current) return;
      await resolve(result, operation);
    } catch (cause) {
      if (!alive.current) return;
      if (denyIfForbidden(cause)) return;
      if (uncertain(cause)) {
        setError('提交结果暂时无法确认。请查询原操作结果，不要重复提交。');
      } else {
        setPending(null);
        if (cause instanceof ApiError && cause.status === 409) setNeedsRefresh(true);
        setError(
          cause instanceof ApiError && cause.status === 409
            ? '配置已被其他操作更新。请重新读取状态并核对后再提交。'
            : errorText(cause),
        );
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function query() {
    if (lock.current || !pending) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api.operation(pending.commandId);
      if (!alive.current) return;
      await resolve(result, pending);
    } catch (cause) {
      if (alive.current && !denyIfForbidden(cause))
        setError(
          cause instanceof ApiError && cause.status === 404
            ? '暂时未查到此操作，不能据此判断未执行。请稍后继续查询，勿重复提交。'
            : '暂时无法确认操作结果，请稍后继续查询。',
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (blocked || !snapshot || !dirty) return;
    const normalized = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value.trim()]),
    ) as Fields;
    const errors: Partial<Record<keyof Fields, string>> = {};
    if (
      normalized.bucket.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?-[1-9][0-9]{4,19}$/.test(normalized.bucket)
    )
      errors.bucket = '名称主体须≤50字符，完整桶名≤63；APPID数字后缀首位不能为0。';
    if (
      normalized.region.length > 40 ||
      !/^[a-z]{2}-[a-z]+(?:-[a-z0-9]+)*$/.test(normalized.region)
    )
      errors.region = '地域代码须≤40字符，请与存储桶的实际地域核对。';
    if (
      !normalized.prefix ||
      normalized.prefix.length > 128 ||
      !normalized.prefix
        .split('/')
        .every((part) => part.length <= 63 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part))
    )
      errors.prefix =
        '前缀总长须为1–128字符，每段1–63字符；仅允许小写字母、数字及连字符，用 / 分隔。';
    const credentials = !draft?.credentialsConfigured || rotate;
    if (credentials) {
      for (const key of ['secretId', 'secretKey'] as const) {
        if (!normalized[key] || normalized[key].length > 16_384 || /\s/.test(normalized[key]))
          errors[key] =
            `请填写完整 ${key === 'secretId' ? 'SecretId' : 'SecretKey'}，不得包含内部空格或换行；更换时须成对填写。`;
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError('请修正标记字段后再保存。');
      return;
    }
    const commandId = crypto.randomUUID();
    const input: StorageSaveInput = {
      commandId,
      expectedVersion: snapshot.version,
      bucket: normalized.bucket,
      region: normalized.region,
      prefix: normalized.prefix,
      ...(credentials ? { secretId: normalized.secretId, secretKey: normalized.secretKey } : {}),
    };
    setFields((previous) => ({ ...previous, secretId: '', secretKey: '' }));
    setPrivateConfirmed(false);
    void run({ commandId, kind: 'SAVE', configVersion: null }, () => api.save(input));
  }
  function test() {
    setModal(null);
    if (!canTest || !draft) return;
    const commandId = crypto.randomUUID();
    setPrivateConfirmed(false);
    void run({ commandId, kind: 'TEST', configVersion: draft.version }, () =>
      api.test({ commandId, configVersion: draft.version, confirmCloudTest: true }),
    );
  }
  function activate() {
    setModal(null);
    if (!canActivate || !snapshot || !draft || !snapshot.test || !validTest(snapshot, Date.now()))
      return;
    const commandId = crypto.randomUUID();
    void run({ commandId, kind: 'ACTIVATE', configVersion: draft.version }, () =>
      api.activate({
        commandId,
        expectedVersion: snapshot.version,
        configVersion: draft.version,
        testId: snapshot.test!.id,
        privatePolicyConfirmed: true,
      }),
    );
  }
  async function reload() {
    if (lock.current || pending) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setFields((previous) => ({ ...previous, secretId: '', secretKey: '' }));
    try {
      if (await refresh(true)) setNeedsRefresh(false);
    } catch (cause) {
      if (alive.current && !denyIfForbidden(cause)) setError(errorText(cause));
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  }

  if (revoked || (!loading && snapshot && !snapshot.canManage)) return <Denied />;
  return (
    <div className="storage-settings">
      <header className="ss-heading">
        <div>
          <p className="ss-eyebrow">SYSTEM SETTINGS</p>
          <h1>对象存储</h1>
          <p>连接腾讯云 COS，统一存放报名文件、比赛图片和小视频。</p>
        </div>
        <span className="ss-scope">
          <ShieldCheck size={16} />
          平台级配置
        </span>
      </header>
      {error && (
        <div className="ss-message ss-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="ss-message" role="status">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
        </div>
      )}
      {pending && (
        <div className="ss-pending">
          <span>
            操作编号：<code>{pending.commandId}</code>
          </span>
          <button className="button button-secondary" disabled={busy} onClick={() => void query()}>
            <RefreshCw size={16} />
            查询操作结果
          </button>
        </div>
      )}
      {loading ? (
        <section className="panel ss-state" role="status">
          <LoaderCircle className="ss-spinner" size={23} />
          正在读取对象存储配置…
        </section>
      ) : !snapshot ? (
        <section className="panel ss-state">
          <p>暂时无法读取配置。</p>
          <button className="button button-secondary" disabled={busy} onClick={() => void reload()}>
            重新读取状态
          </button>
        </section>
      ) : (
        <>
          {snapshot.quarantined && (
            <div className="ss-warning">
              <strong>备份恢复隔离中</strong>
              <p>服务已禁止加载对象存储密钥及执行云端操作。请由平台运维完成恢复核验后再继续。</p>
            </div>
          )}
          {!snapshot.keyConfigured && (
            <div className="ss-warning">
              <strong>服务尚未配置密钥保护</strong>
              <p>请由平台运维配置服务端配置加密密钥，再保存 COS 信息。</p>
            </div>
          )}
          <section className="ss-overview" aria-label="实际存储状态">
            <div>
              <p className="ss-label">当前实际存储</p>
              <div className="ss-storage-value">
                {snapshot.active.provider === 'COS' ? <Cloud /> : <Database />}
                {snapshot.active.provider === 'COS' ? '腾讯云 COS' : '数据库存储'}
                <span className="ss-badge">
                  {snapshot.active.applied ? '服务已确认' : '服务未确认'}
                </span>
              </div>
              <p>
                {snapshot.active.source === 'ENVIRONMENT' && snapshot.active.provider === 'COS'
                  ? '沿用服务环境配置'
                  : snapshot.active.version !== null
                    ? `实际配置 v${snapshot.active.version}`
                    : '继续使用现有存储方式'}
              </p>
            </div>
            <div className="ss-fact">
              <p className="ss-label">后台配置状态</p>
              <strong>
                {draft
                  ? `草稿 v${draft.version}${dirty ? ' · 有未保存修改' : currentApplied ? ' · 已生效' : ' · 尚未生效'}`
                  : '尚未填写'}
              </strong>
              <p>保存草稿不会切换存储方式</p>
            </div>
            <div className="ss-fact">
              <p className="ss-label">原有文件</p>
              <strong>按原存储位置继续读取</strong>
              <p>不迁移、不覆盖现有业务文件</p>
            </div>
          </section>
          <ol className="ss-steps" aria-label="配置步骤">
            {['填写配置', '检测连接', '确认启用'].map((label, index) => (
              <li
                key={label}
                className={
                  (index === 0 && draft && !dirty) ||
                  (index === 1 && testPassed) ||
                  (index === 2 && currentApplied)
                    ? 'ss-done'
                    : ''
                }
              >
                <span>{index + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <div className="ss-columns">
            <form className="ss-card" onSubmit={save} noValidate autoComplete="off">
              <div className="ss-card-head">
                <h2>
                  <Settings2 size={19} />
                  存储配置
                </h2>
                <button
                  type="button"
                  className="ss-text-button"
                  disabled={busy || !!pending}
                  onClick={() => void reload()}
                >
                  <RefreshCw size={13} />
                  重新读取状态
                </button>
              </div>
              <div className="ss-card-body">
                <div className="ss-provider">
                  <span>
                    <Cloud size={24} />
                  </span>
                  <div>
                    <strong>腾讯云 COS</strong>
                    <p>私有对象存储 · 由应用校验文件访问权限</p>
                  </div>
                  <CheckCircle2 size={19} />
                </div>
                <fieldset disabled={blocked}>
                  <div className="ss-field-grid">
                    <Field
                      name="bucket"
                      label="存储桶名称"
                      error={fieldErrors.bucket}
                      hint="填写完整桶名，包含 APPID 后缀。"
                    >
                      <input
                        id="ss-bucket"
                        value={fields.bucket}
                        onChange={(e) => change('bucket', e.target.value)}
                        readOnly={locationLocked}
                        maxLength={63}
                        placeholder="例如 scb-media-1250000000"
                        aria-invalid={!!fieldErrors.bucket}
                        aria-describedby="ss-bucket-help"
                        spellCheck={false}
                      />
                    </Field>
                    <Field
                      name="region"
                      label="所属地域"
                      error={fieldErrors.region}
                      hint="必须与存储桶所在地域一致。"
                    >
                      <select
                        id="ss-region"
                        value={
                          regions.some(([value]) => value === fields.region)
                            ? fields.region
                            : 'custom'
                        }
                        disabled={locationLocked}
                        onChange={(e) =>
                          change('region', e.target.value === 'custom' ? '' : e.target.value)
                        }
                        aria-invalid={!!fieldErrors.region}
                        aria-describedby="ss-region-help"
                      >
                        {regions.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                        <option value="custom">其他地域（输入代码）</option>
                      </select>
                      {!regions.some(([value]) => value === fields.region) && (
                        <input
                          aria-label="地域代码"
                          value={fields.region}
                          onChange={(e) => change('region', e.target.value)}
                          readOnly={locationLocked}
                          maxLength={40}
                          placeholder="例如 ap-singapore"
                          aria-invalid={!!fieldErrors.region}
                          spellCheck={false}
                        />
                      )}
                    </Field>
                  </div>
                  <div className="ss-row-title">
                    <h3>访问密钥</h3>
                    {draft?.credentialsConfigured && (
                      <label className="ss-check">
                        <input
                          type="checkbox"
                          checked={rotate}
                          onChange={(e) => {
                            setRotate(e.target.checked);
                            setFields((previous) => ({ ...previous, secretId: '', secretKey: '' }));
                            setPrivateConfirmed(false);
                          }}
                        />
                        更换密钥
                      </label>
                    )}
                  </div>
                  {draft?.credentialsConfigured && (
                    <div className="ss-credentials">
                      <ShieldCheck size={18} />
                      <span>访问密钥已设置</span>
                      <small>不回显原密钥</small>
                    </div>
                  )}
                  {(!draft?.credentialsConfigured || rotate) && (
                    <div className="ss-field-grid">
                      <Field name="secretId" label="SecretId" error={fieldErrors.secretId}>
                        <input
                          id="ss-secretId"
                          type="password"
                          autoComplete="new-password"
                          value={fields.secretId}
                          onChange={(e) => change('secretId', e.target.value)}
                          maxLength={16384}
                          aria-invalid={!!fieldErrors.secretId}
                          aria-describedby="ss-secretId-help"
                          spellCheck={false}
                        />
                      </Field>
                      <Field name="secretKey" label="SecretKey" error={fieldErrors.secretKey}>
                        <input
                          id="ss-secretKey"
                          type="password"
                          autoComplete="new-password"
                          value={fields.secretKey}
                          onChange={(e) => change('secretKey', e.target.value)}
                          maxLength={16384}
                          aria-invalid={!!fieldErrors.secretKey}
                          aria-describedby="ss-secretKey-help"
                          spellCheck={false}
                        />
                      </Field>
                    </div>
                  )}
                  <p className="ss-security-note">
                    <LockKeyhole size={15} />
                    密钥仅用于服务端访问 COS；保存时加密保护。输入内容在提交后清空。
                  </p>
                  <details className="ss-advanced" open={!!fieldErrors.prefix || undefined}>
                    <summary>
                      <ChevronDown size={16} />
                      高级设置
                    </summary>
                    <Field
                      name="prefix"
                      label="对象路径前缀"
                      error={fieldErrors.prefix}
                      hint="统一存放在此前缀内，不支持自定义 Endpoint 或访问域名。"
                    >
                      <input
                        id="ss-prefix"
                        value={fields.prefix}
                        onChange={(e) => change('prefix', e.target.value)}
                        readOnly={locationLocked}
                        maxLength={128}
                        aria-invalid={!!fieldErrors.prefix}
                        aria-describedby="ss-prefix-help"
                        spellCheck={false}
                      />
                    </Field>
                  </details>
                </fieldset>
                {locationLocked && (
                  <p className="ss-edit-lock">
                    <LockKeyhole size={14} />
                    {snapshot.cleanupPending
                      ? '存在待清理的检测文件：存储桶、地域和路径已锁定。重新检测将先清理已登记的检测文件。'
                      : '已有文件绑定此位置：存储桶、地域和路径已锁定；可在原位置更换访问密钥。'}
                  </p>
                )}
                {recoveryDestination && (
                  <div className="ss-recovery">
                    <p>
                      <strong>草稿与已绑定位置不同</strong>已有文件绑定当前实际存储位置：
                      {recoveryDestination.bucket} · {recoveryDestination.region} ·{' '}
                      {recoveryDestination.prefix}。
                    </p>
                    <p>
                      请先恢复地址，再保存草稿。你可以保留已保存的密钥，或勾选“更换密钥”填写与此位置匹配的密钥；不会迁移文件。
                    </p>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={blocked}
                      onClick={restoreDestination}
                    >
                      <RefreshCw size={16} />
                      恢复为当前实际存储位置
                    </button>
                  </div>
                )}
              </div>
              <div className="ss-form-footer">
                <span>
                  <Save size={15} />
                  仅保存配置，不立即启用
                </span>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={blocked || !dirty}
                >
                  <Save size={16} />
                  保存草稿
                </button>
              </div>
            </form>
            <aside className="ss-side">
              <section className="ss-card">
                <div className="ss-card-head">
                  <h2>
                    <ShieldCheck size={19} />
                    连接检测
                  </h2>
                  <span
                    className={`ss-badge ${testPassed ? 'ss-green' : snapshot.test?.status === 'FAILED' ? 'ss-red' : ''}`}
                  >
                    {dirty
                      ? '先保存草稿'
                      : testPassed
                        ? '检测通过'
                        : snapshot.test?.status === 'RUNNING'
                          ? '检测中'
                          : snapshot.test?.status === 'FAILED'
                            ? '检测失败'
                            : '待检测'}
                  </span>
                </div>
                <div className="ss-card-body">
                  <p className="ss-description">
                    检测已保存的配置，写入极小测试文件，回读校验后删除。
                  </p>
                  <ul className="ss-check-list">
                    {checks.map(({ key, label }) => {
                      const status =
                        !dirty && snapshot.test?.configVersion === draft?.version
                          ? snapshot.test?.checks.find((item) => item.key === key)?.status
                          : undefined;
                      return (
                        <li key={key}>
                          <span
                            className={`ss-check-icon ${status === 'PASSED' ? 'ss-ok' : status === 'FAILED' ? 'ss-fail' : ''}`}
                          >
                            {status === 'PASSED' ? (
                              <Check size={12} />
                            ) : status === 'FAILED' ? (
                              <X size={12} />
                            ) : (
                              '·'
                            )}
                          </span>
                          <span>{label}</span>
                          <small>
                            {status === 'PASSED' ? '通过' : status === 'FAILED' ? '失败' : '待检测'}
                          </small>
                        </li>
                      );
                    })}
                    <li>
                      <span className="ss-check-icon">
                        <LockKeyhole size={11} />
                      </span>
                      <span>私有访问策略</span>
                      <small>需人工确认</small>
                    </li>
                  </ul>
                  {snapshot.test?.message && <p className="ss-issue">{snapshot.test.message}</p>}
                  {snapshot.test?.status === 'PASSED' && !testPassed && !dirty && (
                    <p className="ss-issue">检测结果已过期或不适用于当前草稿，请重新检测。</p>
                  )}
                  <button
                    className="button button-secondary ss-block"
                    disabled={!canTest}
                    onClick={() => setModal('test')}
                  >
                    <RefreshCw size={16} />
                    {snapshot.cleanupPending ? '清理并重新检测' : '检测连接'}
                  </button>
                  <p className="ss-fee-note">会产生少量 COS 请求费用；不会读取或修改业务文件。</p>
                  <label className="ss-private-confirm">
                    <input
                      type="checkbox"
                      checked={privateConfirmed}
                      disabled={blocked || !testPassed}
                      onChange={(e) => setPrivateConfirmed(e.target.checked)}
                    />
                    <span>我已在腾讯云控制台确认：此桶为私有读写，且已禁止公有访问。</span>
                  </label>
                </div>
              </section>
              <section className="ss-card">
                <div className="ss-card-head">
                  <h2>
                    <Server size={19} />
                    启用存储
                  </h2>
                </div>
                <div className="ss-card-body">
                  <p className="ss-activate-state">
                    {pending?.kind === 'ACTIVATE'
                      ? '等待服务确认'
                      : currentApplied
                        ? '当前草稿已生效'
                        : '完成检测后，确认启用'}
                  </p>
                  <p className="ss-description">
                    启用后，新上传文件保存至 COS。原数据库文件继续正常读取。
                  </p>
                  <button
                    className="button button-primary ss-block"
                    disabled={!canActivate || currentApplied}
                    onClick={() => setModal('activate')}
                  >
                    <Cloud size={17} />
                    确认启用 COS
                  </button>
                  {!currentApplied && (
                    <p className="ss-fee-note">
                      保存、检测与实际启用分别执行。以服务确认状态为准。
                    </p>
                  )}
                </div>
              </section>
            </aside>
          </div>
          <p className="ss-limits">
            <KeyRound size={15} />
            单文件上限 8 MiB<span>·</span>机构配额 128 MiB<span>·</span>
            原有文件权限与机构隔离规则继续生效
          </p>
        </>
      )}
      {modal && snapshot?.draft && (
        <Confirmation
          title={modal === 'test' ? '检测 COS 连接' : '确认启用 COS'}
          onClose={() => setModal(null)}
          onConfirm={modal === 'test' ? test : activate}
          confirmLabel={modal === 'test' ? '开始检测' : '确认启用'}
          disabled={modal === 'test' ? !canTest : !canActivate}
        >
          <p>
            {modal === 'test'
              ? snapshot.cleanupPending
                ? '本次先重试清理上次登记的检测文件，再执行写入、回读校验与删除。只操作已登记的检测对象。'
                : '将向检测专用路径写入一个极小文件，回读并校验内容，然后删除。会产生少量 COS 请求费用。'
              : '确认将新上传文件存入以下位置。原数据库文件继续按原方式读取，不会自动迁移。'}
          </p>
          <dl className="ss-target">
            <dt>存储桶</dt>
            <dd>{snapshot.draft.bucket}</dd>
            <dt>地域</dt>
            <dd>{snapshot.draft.region}</dd>
            <dt>路径前缀</dt>
            <dd>{snapshot.draft.prefix}</dd>
            <dt>配置版本</dt>
            <dd>v{snapshot.draft.version}</dd>
          </dl>
          {modal === 'activate' && <p>启用申请提交后，将重新读取服务状态，确认实际使用此版本。</p>}
        </Confirmation>
      )}
    </div>
  );
}

function Field({
  name,
  label,
  error,
  hint,
  children,
}: {
  name: keyof Fields;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="ss-field">
      <label className="ss-required" htmlFor={`ss-${name}`}>
        {label}
      </label>
      {children}
      <div id={`ss-${name}-help`}>
        {error ? (
          <p className="ss-field-error">{error}</p>
        ) : hint ? (
          <p className="ss-hint">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

function Confirmation({
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel,
  disabled,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  disabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="ss-dialog"
      aria-labelledby="ss-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="ss-dialog-head">
        <h2 id="ss-dialog-title">{title}</h2>
        <button type="button" className="ss-close" aria-label="关闭确认框" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      <div className="ss-dialog-body">{children}</div>
      <div className="ss-dialog-footer">
        <button className="button button-secondary" onClick={onClose}>
          取消
        </button>
        <button className="button button-primary" disabled={disabled} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
