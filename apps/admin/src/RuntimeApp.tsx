import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { OrgRole, SessionData } from '@small-city-basketball/contracts';
import { ArrowRight, LoaderCircle, LogOut, ShieldCheck, Trophy } from 'lucide-react';
import App from './App';
import { ApiError, createApiClient, createAuthApi } from './api/client';
import type { ApiClient, AuthApi } from './api/client';
import { createHttpEventRepository } from './api/events';
import './runtime.css';

const roles: Record<OrgRole, string> = {
  ORG_OWNER: '机构负责人',
  ORG_ADMIN: '机构管理员',
  EVENT_MANAGER: '赛事管理员',
  REVIEWER: '审核员',
  SCORER: '记录员',
  STREAMER: '直播员',
};
function message(error: unknown) {
  return error instanceof Error ? error.message : '操作未完成，请重试';
}

function AuthForm({
  auth,
  onSession,
}: {
  auth: AuthApi;
  onSession: (session: SessionData) => void;
}) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const errors: Record<string, string> = {};
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errors.email = '请填写有效邮箱';
    if (!password) errors.password = '请输入密码';
    if (register && (Array.from(password).length < 12 || Array.from(password).length > 128))
      errors.password = '密码需为12–128个字符';
    if (register && !displayName.trim()) errors.displayName = '请输入称呼';
    if (register && !organizationName.trim()) errors.organizationName = '请输入机构名称';
    setFieldErrors(errors);
    setError('');
    const first = Object.keys(errors)[0];
    if (first) {
      document.getElementById(`auth-${first}`)?.focus();
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const session = register
        ? await auth.register({
            email: email.trim(),
            password,
            displayName: displayName.trim(),
            organizationName: organizationName.trim(),
          })
        : await auth.login(email.trim(), password);
      if (mounted.current) {
        setPassword('');
        onSession(session);
      }
    } catch (cause) {
      if (!mounted.current) return;
      setError(message(cause));
      if (
        cause instanceof ApiError &&
        cause.details?.fieldErrors &&
        typeof cause.details.fieldErrors === 'object'
      ) {
        const next: Record<string, string> = {};
        for (const [key, value] of Object.entries(cause.details.fieldErrors))
          if (
            ['email', 'password', 'displayName', 'organizationName'].includes(key) &&
            typeof value === 'string'
          )
            next[key] = value;
        setFieldErrors(next);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const field = (name: string) => ({
    id: `auth-${name}`,
    'aria-invalid': Boolean(fieldErrors[name]),
    'aria-describedby': fieldErrors[name] ? `auth-error-${name}` : undefined,
  });
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
            小城市，
            <br />
            也有大主场。
          </h1>
          <p>
            从创建一届赛事开始，
            <br />
            把热爱一步步办成好比赛。
          </p>
        </div>
        <span className="runtime-auth-foot">机构赛事工作台 · 业务服务</span>
      </section>
      <main className="runtime-auth-main">
        <section className="runtime-auth-card">
          <span className="runtime-connection">
            <span />
            机构工作台 · 资料持久保存
          </span>
          <h2>{register ? '创建机构账号' : '欢迎回到你的主场'}</h2>
          <p>
            {register ? '为你的机构建立账号和独立赛事工作台。' : '使用邮箱与密码登录机构工作台。'}
          </p>
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            noValidate
          >
            <label htmlFor="auth-email">邮箱</label>
            <input
              {...field('email')}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
            {fieldErrors.email && (
              <span id="auth-error-email" className="runtime-field-error">
                {fieldErrors.email}
              </span>
            )}
            <label htmlFor="auth-password">密码</label>
            <input
              {...field('password')}
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            {fieldErrors.password && (
              <span id="auth-error-password" className="runtime-field-error">
                {fieldErrors.password}
              </span>
            )}
            {register && (
              <>
                <span className="runtime-input-hint">密码长度为12–128个字符，请妥善保管。</span>
                <label htmlFor="auth-displayName">称呼</label>
                <input
                  {...field('displayName')}
                  autoComplete="nickname"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  disabled={busy}
                />
                {fieldErrors.displayName && (
                  <span id="auth-error-displayName" className="runtime-field-error">
                    {fieldErrors.displayName}
                  </span>
                )}
                <label htmlFor="auth-organizationName">机构名称</label>
                <input
                  {...field('organizationName')}
                  autoComplete="organization"
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                  disabled={busy}
                />
                {fieldErrors.organizationName && (
                  <span id="auth-error-organizationName" className="runtime-field-error">
                    {fieldErrors.organizationName}
                  </span>
                )}
              </>
            )}
            {error && (
              <div className="runtime-error" role="alert">
                {error}
              </div>
            )}
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{' '}
              {busy ? '正在处理…' : register ? '创建账号并进入' : '登录工作台'}
            </button>
          </form>
          <button
            className="runtime-auth-toggle"
            type="button"
            disabled={busy}
            onClick={() => {
              setRegister((previous) => !previous);
              setPassword('');
              setError('');
              setFieldErrors({});
            }}
          >
            {register ? '已有账号？返回登录' : '首次使用？创建机构账号'}
          </button>
          <div className="runtime-auth-note">
            <ShieldCheck size={16} />
            <span>登录后可管理已获授权的机构与赛事。直播、保险购买及支付尚未接入。</span>
          </div>
        </section>
      </main>
    </div>
  );
}

export function ApiRuntime({ client: providedClient }: { client?: ApiClient }) {
  const sessionEpoch = useRef(0);
  const [session, setSession] = useState<SessionData | null>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [phase, setPhase] = useState<'checking' | 'ready' | 'signedOut' | 'error'>('checking');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const unauthenticated = useCallback(() => {
    sessionEpoch.current += 1;
    setSession(null);
    setOrganizationId('');
    setPhase('signedOut');
  }, []);
  const client = useMemo(
    () => providedClient ?? createApiClient(),
    [providedClient, unauthenticated],
  );
  const auth = useMemo(() => createAuthApi(client), [client]);
  const accept = useCallback((next: SessionData) => {
    sessionEpoch.current += 1;
    setSession(next);
    setOrganizationId(next.organizations[0]?.id ?? '');
    setError('');
    setPhase('ready');
  }, []);
  useEffect(() => {
    let active = true;
    setPhase('checking');
    setError('');
    void auth
      .session()
      .then((next) => {
        if (active) accept(next);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) {
          unauthenticated();
          return;
        }
        setError(message(cause));
        setPhase('error');
      });
    return () => {
      active = false;
    };
  }, [auth, accept, unauthenticated, retry]);
  const organization = session?.organizations.find((org) => org.id === organizationId);
  const repository = useMemo(
    () =>
      createHttpEventRepository(
        {
          async request<T>(path: string, init?: RequestInit) {
            const epoch = sessionEpoch.current;
            try {
              return await client.request<T>(path, init);
            } catch (cause) {
              if (
                cause instanceof ApiError &&
                cause.status === 401 &&
                epoch === sessionEpoch.current
              )
                unauthenticated();
              throw cause;
            }
          },
        },
        organizationId,
      ),
    [client, organizationId, unauthenticated],
  );
  async function logout() {
    if (signingOut) return;
    setSigningOut(true);
    setError('');
    try {
      await auth.logout();
      unauthenticated();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) unauthenticated();
      else setError(message(cause));
    } finally {
      setSigningOut(false);
    }
  }
  if (phase === 'checking')
    return (
      <main className="runtime-state" role="status">
        <LoaderCircle className="spin" size={25} />
        <h1>正在连接你的工作台</h1>
        <p>正在核验登录状态…</p>
      </main>
    );
  if (phase === 'error')
    return (
      <main className="runtime-state">
        <ShieldCheck size={30} />
        <h1>暂时无法连接工作台</h1>
        <p role="alert">{error}</p>
        <button className="button button-primary" onClick={() => setRetry((n) => n + 1)}>
          重新连接
        </button>
        <p className="runtime-input-hint">请恢复连接后重试，当前未载入赛事数据。</p>
      </main>
    );
  if (phase === 'signedOut' || !session) return <AuthForm auth={auth} onSession={accept} />;
  if (!organization)
    return (
      <main className="runtime-state">
        <ShieldCheck size={30} />
        <h1>暂无可访问的机构</h1>
        <p>账号已登录，但当前没有有效机构授权。请联系机构负责人核验权限。</p>
        <button
          className="button button-secondary"
          disabled={signingOut}
          onClick={() => {
            void logout();
          }}
        >
          退出登录
        </button>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  const switcher = (
    <div className="runtime-org">
      <span className="org-avatar">{Array.from(organization.name)[0]}</span>
      <label>
        <span className="sr-only">切换机构</span>
        <select
          aria-label="切换机构"
          value={organization.id}
          onChange={(event) => {
            setOrganizationId(event.target.value);
            setError('');
          }}
        >
          {session.organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        <small>{roles[organization.role]}</small>
      </label>
    </div>
  );
  return (
    <>
      <App
        key={`${session.user.id}:${organization.id}`}
        repository={repository}
        workspace={{
          mode: 'api',
          organizationName: organization.name,
          userDisplayName: session.user.displayName,
          role: organization.role,
          organizationSwitcher: switcher,
          headerActions: (
            <button
              className="button button-secondary button-small runtime-logout"
              onClick={() => {
                void logout();
              }}
              disabled={signingOut}
            >
              <LogOut size={15} />
              {signingOut ? '正在退出…' : '退出'}
            </button>
          ),
        }}
      />
      {error && (
        <div className="runtime-global-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

export default function RuntimeApp({
  mode = import.meta.env.VITE_DATA_MODE ?? 'mock',
  client,
}: {
  mode?: string;
  client?: ApiClient;
}) {
  if (mode === 'mock') return <App />;
  if (mode === 'api') return <ApiRuntime client={client} />;
  return (
    <main className="runtime-state">
      <h1>数据模式配置无效</h1>
      <p role="alert">请使用 VITE_DATA_MODE=api 或 mock。未连接任何数据服务。</p>
    </main>
  );
}
