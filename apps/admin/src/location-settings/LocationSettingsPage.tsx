import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  LocationCommandResult,
  LocationProviderName,
  LocationSecretAction,
  LocationSettingsSnapshot,
} from '@small-city-basketball/contracts';
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  MapPin,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { ApiError, type ApiClient } from '../api/client';
import { createLocationSettingsApi } from './api';
import '../storage-settings/storage-settings.css';

export interface LocationSettingsPageProps {
  client: ApiClient;
  userId: string;
  platformOperator: boolean;
  identityKey?: string;
}
const providers: { id: LocationProviderName; title: string; detail: string }[] = [
  { id: 'AMAP', title: '高德', detail: '默认主用。Web 服务 Key，可选数字签名。' },
  { id: 'TENCENT', title: '腾讯', detail: '保留现有 Key 兼容，需手动切换后才会使用。' },
];
function errorText(cause: unknown) {
  return cause instanceof ApiError ? cause.message : '暂时无法完成操作，请稍后重试';
}
export function LocationSettingsPage({
  client,
  userId,
  platformOperator,
  identityKey,
}: LocationSettingsPageProps) {
  const api = useMemo(() => createLocationSettingsApi(client), [client]);
  const identity = useMemo(
    () => `${userId}:${platformOperator}:${identityKey ?? ''}`,
    [userId, platformOperator, identityKey],
  );
  if (!platformOperator) {
    return (
      <section className="storage-settings ss-denied panel">
        <ShieldCheck size={28} />
        <h1>当前身份无法管理定位与地图</h1>
        <p>仅有效平台管理员可以保存、检测、启用或停用。机构管理员不能代为配置。</p>
      </section>
    );
  }
  return <Desk key={identity} api={api} />;
}
function Desk({ api }: { api: ReturnType<typeof createLocationSettingsApi> }) {
  const alive = useRef(true);
  const [snapshot, setSnapshot] = useState<LocationSettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [provider, setProvider] = useState<LocationProviderName>('AMAP');
  const [signatureEnabled, setSignatureEnabled] = useState(false);
  const [webKeyAction, setWebKeyAction] = useState<LocationSecretAction>('REPLACE');
  const [webKey, setWebKey] = useState('');
  const [privateKeyAction, setPrivateKeyAction] = useState<LocationSecretAction>('KEEP');
  const [privateKey, setPrivateKey] = useState('');
  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, []);
  async function reload() {
    setBusy(true);
    setError('');
    try {
      const next = await api.read();
      if (!alive.current) return;
      setSnapshot(next);
      if (next.draft) {
        setProvider(next.draft.provider);
        setSignatureEnabled(next.draft.signatureEnabled);
        setWebKeyAction('KEEP');
        setPrivateKeyAction(next.draft.signatureEnabled ? 'KEEP' : 'CLEAR');
      }
      setWebKey('');
      setPrivateKey('');
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      if (alive.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  }
  async function run(work: () => Promise<LocationCommandResult>, done: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      if (!alive.current) return;
      if (result.status === 'FAILED') setError(result.error?.message || '操作没有完成');
      else setNotice(done);
      setWebKey('');
      setPrivateKey('');
      await reload();
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!snapshot) return;
    void run(
      () =>
        api.save({
          commandId: crypto.randomUUID(),
          expectedVersion: snapshot.version,
          provider,
          signatureEnabled: provider === 'AMAP' && signatureEnabled,
          webKeyAction,
          ...(webKeyAction === 'REPLACE' ? { webKey } : {}),
          privateKeyAction: provider === 'AMAP' && signatureEnabled ? privateKeyAction : 'CLEAR',
          ...(privateKeyAction === 'REPLACE' ? { privateKey } : {}),
        }),
      '草稿已保存。当前线上服务商没有切换。',
    );
  }
  const draft = snapshot?.draft;
  const testPassed =
    snapshot?.test?.status === 'PASSED' && snapshot.test.configVersion === draft?.version;
  const opened = snapshot?.active.status === 'ACTIVE' && snapshot.active.applied;
  const activeLabel =
    snapshot?.active.status === 'DISABLED'
      ? '已停用'
      : opened
        ? '已启用'
        : snapshot?.active.source === 'ENVIRONMENT'
          ? '沿用环境中的腾讯配置'
          : '尚未启用';
  return (
    <div className="storage-settings">
      <header className="ss-heading">
        <div>
          <p className="ss-eyebrow">SYSTEM SETTINGS</p>
          <h1>定位与地图</h1>
          <p>高德为默认主用选项，腾讯保留兼容。保存、检测和启用彼此独立，不做自动跨供应商重试。</p>
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
      {loading ? (
        <section className="panel ss-state" role="status">
          <LoaderCircle className="ss-spinner" size={23} />
          正在读取定位与地图配置…
        </section>
      ) : !snapshot ? (
        <section className="panel ss-state">
          <p>暂时无法读取配置。</p>
          <button className="button button-secondary" type="button" onClick={() => void reload()}>
            重新读取状态
          </button>
        </section>
      ) : !snapshot.canManage ? (
        <section className="storage-settings ss-denied panel">
          <ShieldCheck size={28} />
          <h1>当前身份无法管理定位与地图</h1>
          <p>平台权限已变化。机构管理员不能代为保存、检测或启用。</p>
        </section>
      ) : (
        <>
          {!snapshot.keyConfigured && (
            <div className="ss-warning">
              <strong>服务尚未配置密钥保护</strong>
              <p>请由平台运维配置地图配置加密密钥后，再保存 Key。</p>
            </div>
          )}
          <section className="ss-overview" aria-label="实际定位状态">
            <div>
              <p className="ss-label">当前实际服务商</p>
              <div className="ss-storage-value">
                <MapPin />
                {snapshot.active.provider === 'AMAP'
                  ? '高德'
                  : snapshot.active.provider === 'TENCENT'
                    ? '腾讯'
                    : '未使用外部地图'}
                <span className="ss-badge">{activeLabel}</span>
              </div>
              <p>
                {snapshot.active.version !== null
                  ? `配置版本 v${snapshot.active.version}`
                  : '没有已启用的后台版本'}
              </p>
            </div>
            <div className="ss-fact">
              <p className="ss-label">草稿</p>
              <strong>{draft ? `v${draft.version} · 尚未因保存而生效` : '尚未填写'}</strong>
              <p>
                {testPassed
                  ? '这一版检测已通过，仍需单独启用'
                  : snapshot.test?.status === 'FAILED'
                    ? '检测未通过，不能显示已开通'
                    : '未检测不能显示已开通'}
              </p>
            </div>
            <div className="ss-fact">
              <p className="ss-label">最近检测</p>
              <strong>
                {snapshot.test?.completedAt
                  ? new Date(snapshot.test.completedAt).toLocaleString()
                  : '还没有检测'}
              </strong>
              <p>{snapshot.test?.message ?? '检测需主动点击，隔离测试不代表云端连通。'}</p>
            </div>
          </section>
          <div className="ss-columns">
            <form className="ss-card" onSubmit={save} autoComplete="off">
              <div className="ss-card-head">
                <h2>
                  <MapPin size={19} />
                  草稿服务商
                </h2>
                <button
                  className="ss-text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void reload()}
                >
                  <RefreshCw size={13} />
                  重新读取状态
                </button>
              </div>
              <div className="ss-card-body">
                {providers.map((item) => (
                  <label className="ss-provider" key={item.id}>
                    <input
                      type="radio"
                      name="location-provider"
                      checked={provider === item.id}
                      onChange={() => setProvider(item.id)}
                    />
                    <span aria-hidden="true">{item.id === 'AMAP' ? '高' : '腾'}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                    </div>
                  </label>
                ))}
                <label className="ss-field">
                  <span>Web 服务 Key</span>
                  <select
                    value={webKeyAction}
                    onChange={(event) =>
                      setWebKeyAction(event.target.value as LocationSecretAction)
                    }
                  >
                    <option value="KEEP">保留已保存的值</option>
                    <option value="REPLACE">更换</option>
                    <option value="CLEAR">清除</option>
                  </select>
                  {webKeyAction === 'REPLACE' && (
                    <input
                      type="password"
                      name="location-web-key"
                      aria-label="Web 服务 Key 新值"
                      autoComplete="new-password"
                      value={webKey}
                      onChange={(event) => setWebKey(event.target.value)}
                    />
                  )}
                </label>
                {provider === 'AMAP' && (
                  <label className="ss-field">
                    <span>数字签名</span>
                    <input
                      type="checkbox"
                      checked={signatureEnabled}
                      onChange={(event) => setSignatureEnabled(event.target.checked)}
                    />
                    使用签名私钥
                    {signatureEnabled && (
                      <>
                        <select
                          value={privateKeyAction}
                          onChange={(event) =>
                            setPrivateKeyAction(event.target.value as LocationSecretAction)
                          }
                        >
                          <option value="KEEP">保留已保存的私钥</option>
                          <option value="REPLACE">更换私钥</option>
                          <option value="CLEAR">清除私钥</option>
                        </select>
                        {privateKeyAction === 'REPLACE' && (
                          <input
                            type="password"
                            name="location-private-key"
                            autoComplete="new-password"
                            value={privateKey}
                            onChange={(event) => setPrivateKey(event.target.value)}
                          />
                        )}
                      </>
                    )}
                  </label>
                )}
                {provider === 'TENCENT' && (
                  <p>
                    腾讯沿用原有 Web 服务
                    Key。切换为腾讯只在启用这一版草稿后生效，不会把两家结果拼在一起。
                  </p>
                )}
                <button className="button button-primary" type="submit" disabled={busy}>
                  保存草稿
                </button>
              </div>
            </form>
            <section className="ss-card">
              <div className="ss-card-head">
                <h2>检测与启用</h2>
              </div>
              <div className="ss-card-body">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy || !draft}
                  onClick={() =>
                    void run(
                      () =>
                        api.test({
                          commandId: crypto.randomUUID(),
                          configVersion: draft!.version,
                          confirmCloudTest: true,
                        }),
                      '检测已完成。结果只属于这一版草稿。',
                    )
                  }
                >
                  检测配置
                </button>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={busy || !testPassed || !snapshot.test}
                  onClick={() =>
                    void run(
                      () =>
                        api.activate({
                          commandId: crypto.randomUUID(),
                          expectedVersion: snapshot.version,
                          configVersion: draft!.version,
                          testId: snapshot.test!.id,
                        }),
                      '这一版配置已启用。之后每次请求只使用这一版。',
                    )
                  }
                >
                  启用配置
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy || snapshot.active.status === 'DISABLED'}
                  onClick={() =>
                    void run(
                      () =>
                        api.disable({
                          commandId: crypto.randomUUID(),
                          expectedVersion: snapshot.version,
                        }),
                      '外部地图已停用。环境变量不会把它重新打开。',
                    )
                  }
                >
                  停用外部服务
                </button>
                <h3>检测结果</h3>
                {snapshot.test ? (
                  <ul>
                    {snapshot.test.checks.map((check) => (
                      <li key={check.key}>
                        {check.key} · {check.status}
                        {check.message ? ` · ${check.message}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>还没有检测记录。</p>
                )}
                <h3>配置说明</h3>
                <ul>
                  <li>高德控制台需开通 Web 服务，并把服务器 IP 加入该 Key 的白名单。</li>
                  <li>
                    Key 权限、签名和额度以高德控制台为准。这里不显示剩余额度，也不探测微信后台权限。
                  </li>
                  <li>
                    检测使用公开参考点“高州市人民政府”，需要主动点击。没有真实 Key
                    时只能做隔离测试。
                  </li>
                  <li>地图地点只是选点参考，不会自动变成已审核、可预约的平台场地。</li>
                  <li>定位失败时，小程序仍可手动选城并浏览全国。</li>
                </ul>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
