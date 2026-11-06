import { useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ShieldCheck, Trophy } from 'lucide-react';
import { ApiError, createApiClient } from '../api/client';
import type { ApiClient } from '../api/client';
import { PasswordField, validNewPassword } from './PasswordField';
import { createAccountSecurityApi } from './security-api';

export function SetupPage({ client: providedClient }: { client?: ApiClient }) {
  const [client] = useState(() => providedClient ?? createApiClient());
  const [token, setToken] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const read = useRef(false);
  const locked = useRef(false);

  useLayoutEffect(() => {
    // Only this page consumes setup fragments. StrictMode's effect replay must
    // retain the already-consumed token in memory instead of reading it again.
    if (read.current) return;
    read.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const values = fragment.getAll('token');
    window.history.replaceState(window.history.state, '', '/setup');
    setToken(values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]!) ? values[0]! : null);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || !token || complete) return;
    const next: Record<string, string> = {};
    if (!organizationName.trim() || Array.from(organizationName.trim()).length > 80)
      next.organizationName = '机构名称需为1–80个字符';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254)
      next.email = '请填写有效管理员邮箱';
    if (!displayName.trim() || Array.from(displayName.trim()).length > 80)
      next.displayName = '显示名称需为1–80个字符';
    if (!validNewPassword(password)) next.password = '密码需为12–128个字符';
    if (!confirmPassword || password !== confirmPassword)
      next.confirmPassword = '两次输入的密码不一致';
    setErrors(next);
    setError('');
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(`setup-${first}`)?.focus();
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      await createAccountSecurityApi(client).initialize({
        token,
        organizationName: organizationName.trim(),
        email: email.trim(),
        displayName: displayName.trim(),
        password,
        confirmPassword,
      });
      setToken(null);
      setPassword('');
      setConfirmPassword('');
      setComplete(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 429
          ? '操作过于频繁，请稍后重试。'
          : cause instanceof ApiError && [403, 409, 410].includes(cause.status)
            ? '初始化未完成：链接已失效、入口未开启或实例已初始化。请联系部署人员核对。'
            : '初始化未完成，请检查表单或稍后重试。',
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  const field = (name: string) => ({
    id: `setup-${name}`,
    name,
    required: true,
    disabled: busy,
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] ? `setup-${name}-error` : undefined,
  });
  const fieldError = (name: string) =>
    errors[name] ? (
      <span id={`setup-${name}-error`} className="runtime-field-error">
        {errors[name]}
      </span>
    ) : null;

  return (
    <div className="runtime-auth-shell">
      <section className="runtime-auth-intro">
        <span className="runtime-auth-brand">
          <Trophy size={28} />
          小城市篮球
        </span>
        <div>
          <span className="runtime-kicker">YOUR NEXT HOME COURT</span>
          <h1>
            建立你的
            <br />
            赛事主场。
          </h1>
          <p>由你设置首位机构负责人的账号和密码。</p>
        </div>
        <span className="runtime-auth-foot">机构赛事工作台 · 首次初始化</span>
      </section>
      <main className="runtime-auth-main">
        <section className="runtime-auth-card" aria-labelledby="setup-title">
          <h2 id="setup-title">{complete ? '初始化完成' : '首次设置机构负责人'}</h2>
          {complete ? (
            <>
              <p role="status">机构和负责人账号已创建，请使用刚设置的邮箱和密码登录。</p>
              <a href="/" className="button button-primary">
                前往登录
              </a>
            </>
          ) : !token ? (
            <>
              <p role="alert">
                请通过部署人员提供的有效初始化链接打开此页面。链接仅可使用一次，有效期15分钟。
              </p>
              <a href="/" className="button button-secondary">
                返回登录
              </a>
            </>
          ) : (
            <>
              <p>填写机构资料并自行设置密码。初始化链接仅可使用一次。</p>
              <form onSubmit={(event) => void submit(event)} noValidate>
                <label htmlFor="setup-organizationName">机构名称</label>
                <input
                  {...field('organizationName')}
                  autoComplete="organization"
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                />
                {fieldError('organizationName')}
                <label htmlFor="setup-email">管理员邮箱</label>
                <input
                  {...field('email')}
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                {fieldError('email')}
                <label htmlFor="setup-displayName">显示名称</label>
                <input
                  {...field('displayName')}
                  autoComplete="nickname"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
                {fieldError('displayName')}
                <PasswordField
                  id="setup-password"
                  label="密码"
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                  disabled={busy}
                  error={errors.password}
                />
                <PasswordField
                  id="setup-confirmPassword"
                  label="确认密码"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  autoComplete="new-password"
                  disabled={busy}
                  error={errors.confirmPassword}
                />
                <span className="runtime-input-hint">
                  密码长度为12–128个字符，请使用密码管理器妥善保管。
                </span>
                {error && (
                  <div className="runtime-error" role="alert">
                    {error}
                  </div>
                )}
                <button className="button button-primary" type="submit" disabled={busy}>
                  {busy ? '正在初始化…' : '完成首次设置'}
                </button>
              </form>
              <div className="runtime-auth-note">
                <ShieldCheck size={16} />
                <span>邮箱用于登录，填写邮箱不代表已验证。密码无需交给部署人员。</span>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
