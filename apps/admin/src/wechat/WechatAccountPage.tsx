import { useEffect, useMemo, useRef, useState } from 'react';
import type { WechatBindingData } from '../../../../packages/contracts/wechat.js';
import { createWechatApi } from '../api/wechat';
import type { ApiClient } from '../api/client';
import type { WechatApi } from '../api/wechat';
export function WechatAccountPage({
  onSignedOut,
  api: provided,
  client,
}: {
  onSignedOut?: () => void;
  api?: WechatApi;
  client?: ApiClient;
}) {
  const api = useMemo(() => provided ?? createWechatApi(client), [provided, client]);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [api],
  );
  const [binding, setBinding] = useState<WechatBindingData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setBusy(false);
    setPassword('');
    setConsent(false);
    setDone(false);
    setBinding(null);
    setError('');
    api
      .binding()
      .then((data) => {
        if (active) setBinding(data);
      })
      .catch(() => {
        if (active) setError('无法读取微信绑定，请刷新或重新登录。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, revision]);
  async function unlink() {
    if (!binding?.connected || !binding.version || !consent || busy) return;
    const seenGeneration = generation.current;
    setBusy(true);
    setError('');
    try {
      await api.unbind({ password, expectedVersion: binding.version, consent: true });
      if (seenGeneration !== generation.current) return;
      setDone(true);
      setBinding(null);
      setPassword('');
      onSignedOut?.();
    } catch {
      if (seenGeneration !== generation.current) return;
      setError('解绑未完成，请核对密码或显式刷新绑定状态后重试。');
      setPassword('');
    } finally {
      if (seenGeneration === generation.current) setBusy(false);
    }
  }
  return (
    <div className="view-page">
      <section className="panel" style={{ padding: 24, maxWidth: 720 }}>
        <p className="eyebrow">WECHAT ACCOUNT</p>
        <h1>微信账号绑定</h1>
        <p>微信只用于登录已有应用账号；机构和球队权限继续由原授权决定，不会按昵称合并账号。</p>
        {loading ? (
          <p role="status">正在读取微信绑定…</p>
        ) : done ? (
          <p role="status">已解除微信绑定并退出全部会话，请重新登录。</p>
        ) : (
          <>
            {error && <p role="alert">{error}</p>}
            {binding && !binding.enabled && (
              <p role="status">微信登录尚未配置启用。当前仍可使用应用账号和密码登录。</p>
            )}
            {binding?.connected ? (
              <>
                <p>
                  已绑定微信 ·{' '}
                  {binding.linkedAt ? new Date(binding.linkedAt).toLocaleString('zh-CN') : ''}
                </p>
                <p>
                  解绑会撤销该账号所有设备会话，包括当前会话。重新绑定需在小程序中重新验证密码并明确同意。
                </p>
                <label>
                  重新验证应用密码
                  <input
                    aria-label="重新验证应用密码"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label style={{ display: 'block', margin: '16px 0' }}>
                  <input
                    type="checkbox"
                    checked={consent}
                    disabled={busy}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  我确认解除绑定并退出所有设备
                </label>
                <button
                  className="button button-primary"
                  disabled={!password || !consent || busy}
                  onClick={() => void unlink()}
                >
                  {busy ? '正在解绑…' : '解绑并退出所有会话'}
                </button>
              </>
            ) : (
              binding && (
                <>
                  <h2>尚未绑定微信</h2>
                  <p>
                    请在主办方正式发布的小程序「账号」页先登录已有应用账号，再点击「绑定当前微信」。绑定会重新验证应用密码，并明确征得你的同意。
                  </p>
                  <p>
                    请在官方小程序完成微信绑定；这里可查看绑定状态和解除绑定。小程序上线前，继续使用账号密码登录。
                  </p>
                </>
              )
            )}
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => setRevision((v) => v + 1)}
              style={{ marginTop: 16 }}
            >
              刷新绑定状态
            </button>
          </>
        )}
      </section>
    </div>
  );
}
