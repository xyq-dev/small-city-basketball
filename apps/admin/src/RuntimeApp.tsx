import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FormEvent } from 'react';
import type { OrgRole } from '@small-city-basketball/contracts';
import {
  ArrowRight,
  Check,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  Trophy,
  UserRound,
  X,
} from 'lucide-react';
import App from './App';
import { ApiError, createApiClient, createAuthApi } from './api/client';
import type { ApiClient, AuthApi, AuthSession } from './api/client';
import { createHttpEventRepository } from './api/events';
import './runtime.css';
import { isBookingPath } from './booking/routes';
import { OverlayEntry } from './overlay/Entry';
import { useRegistrationCapabilities } from './auth/useRegistrationCapabilities';

const BookingStandaloneApp = lazy(() =>
  import('./booking/BookingPages').then((m) => ({ default: m.BookingStandaloneApp })),
);
const WechatAccountPage = lazy(() =>
  import('./wechat/WechatAccountPage').then((m) => ({ default: m.WechatAccountPage })),
);
const PlatformCommercePage = lazy(() =>
  import('./commerce/CommercePages').then((m) => ({ default: m.PlatformCommercePage })),
);
const PublicViewingApp = lazy(() =>
  import('./viewing/PublicPages').then((viewing) => ({ default: viewing.PublicViewingApp })),
);

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
  client,
  onSession,
  pendingInvitation,
}: {
  auth: AuthApi;
  client: ApiClient;
  onSession: (session: AuthSession) => void;
  pendingInvitation?: boolean;
}) {
  const [intent, setIntent] = useState<'login' | 'organization' | 'participant'>('login');
  const registration = useRegistrationCapabilities(client);
  const capabilities = registration.capabilities;
  const register = intent !== 'login';
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
  useEffect(() => {
    if (
      (intent === 'organization' && !capabilities?.canRegisterOrganization) ||
      (intent === 'participant' && !capabilities?.canRegisterParticipant)
    ) {
      setIntent('login');
      setPassword('');
      setError('');
      setFieldErrors({});
    }
  }, [intent, capabilities]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    if (
      (intent === 'organization' && !capabilities?.canRegisterOrganization) ||
      (intent === 'participant' && !capabilities?.canRegisterParticipant)
    ) {
      setError('当前注册入口未开放，请返回登录或重新读取注册状态。');
      return;
    }
    const errors: Record<string, string> = {};
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const loginNameValid = /^[a-z][a-z0-9_]{2,31}$/i.test(email.trim());
    if (
      !email.trim() ||
      email.trim().length > 254 ||
      (!emailValid && (register || !loginNameValid))
    )
      errors.email = register ? '请填写有效邮箱' : '请输入有效邮箱或用户名';
    if (!password) errors.password = '请输入密码';
    if (register && (Array.from(password).length < 12 || Array.from(password).length > 128))
      errors.password = '密码需为12–128个字符';
    if (register && !displayName.trim()) errors.displayName = '请输入称呼';
    if (intent === 'organization' && !organizationName.trim())
      errors.organizationName = '请输入机构名称';
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
      const session =
        intent === 'organization'
          ? await auth.register({
              email: email.trim(),
              password,
              displayName: displayName.trim(),
              organizationName: organizationName.trim(),
            })
          : intent === 'participant'
            ? await auth.registerParticipant({
                email: email.trim(),
                password,
                displayName: displayName.trim(),
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
          <h2>
            {intent === 'organization'
              ? '创建机构账号'
              : intent === 'participant'
                ? '创建领队账号'
                : '欢迎回到你的主场'}
          </h2>
          <p>
            {intent === 'organization'
              ? '为你的机构建立账号和独立赛事工作台。'
              : intent === 'participant'
                ? '创建个人账号，接受机构邀请后管理球队报名。'
                : '使用邮箱与密码登录机构或球队工作台。'}
          </p>
          {pendingInvitation && (
            <p className="runtime-invitation-hint">
              已读取球队邀请。请登录邀请所绑定的个人账号。
              {capabilities?.canRegisterParticipant
                ? '新用户可先创建个人账号，将个人 ID 提供给机构签发邀请。'
                : registration.phase === 'ready'
                  ? '本站当前未开放个人注册，请联系赛事主办方。'
                  : '个人注册是否开放，需等待站点配置核验。'}
            </p>
          )}
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            noValidate
          >
            <label htmlFor="auth-email">{register ? '邮箱' : '邮箱或用户名'}</label>
            <input
              {...field('email')}
              type={register ? 'email' : 'text'}
              autoComplete={register ? 'email' : 'username'}
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
                {intent === 'organization' && (
                  <>
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
          {register ? (
            <button
              className="runtime-auth-toggle"
              type="button"
              disabled={busy}
              onClick={() => {
                setIntent('login');
                setPassword('');
                setError('');
                setFieldErrors({});
              }}
            >
              已有账号？返回登录
            </button>
          ) : (
            <>
              {capabilities?.canRegisterOrganization && (
                <button
                  className="runtime-auth-toggle"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setIntent('organization');
                    setPassword('');
                    setError('');
                    setFieldErrors({});
                  }}
                >
                  首次使用？创建机构账号
                </button>
              )}
              {capabilities?.canRegisterParticipant && (
                <button
                  className="runtime-auth-toggle runtime-participant-toggle"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setIntent('participant');
                    setPassword('');
                    setError('');
                    setFieldErrors({});
                  }}
                >
                  球队领队？创建个人账号
                </button>
              )}
            </>
          )}
          {registration.phase === 'loading' && (
            <p className="runtime-input-hint" role="status">
              正在读取注册开放状态…
            </p>
          )}
          {registration.phase === 'error' && (
            <div className="runtime-error" role="alert">
              <p>暂时无法读取注册开放状态；已有账号仍可登录。</p>
              <button
                className="button button-secondary"
                type="button"
                disabled={busy}
                onClick={registration.reload}
              >
                重新读取注册状态
              </button>
            </div>
          )}
          {registration.phase === 'ready' &&
            !capabilities?.canRegisterOrganization &&
            !capabilities?.canRegisterParticipant && (
              <p className="runtime-input-hint">本站暂未开放自助注册。已有账号可继续登录。</p>
            )}
          <div className="runtime-auth-note">
            <ShieldCheck size={16} />
            <span>个人账号仅通过绑定本人 ID 的邀请获取球队权限。本站尚无邮件投递或邮箱验证。</span>
          </div>
        </section>
      </main>
    </div>
  );
}

interface PendingInvitation {
  id: string;
  token: string;
}

function IdentityPanel({
  session,
  client,
  initialInvitation,
  onClose,
  onRefresh,
  onConsumed,
}: {
  session: AuthSession;
  client: ApiClient;
  initialInvitation: PendingInvitation | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onConsumed: () => void;
}) {
  const [invitationId, setInvitationId] = useState(initialInvitation?.id ?? '');
  const [token, setToken] = useState(initialInvitation?.token ?? '');
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const lock = useRef(false);
  useEffect(() => {
    closeButton.current?.focus();
    return () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, []);
  async function refresh() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await onRefresh();
      setNotice('授权已刷新，可切换到“我的球队”。');
    } catch (cause) {
      setError(message(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function acceptInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    if (!invitationId.trim() || !token.trim()) {
      setError('请填写邀请 ID 和邀请令牌。');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await client.request(`/v1/invitations/${encodeURIComponent(invitationId.trim())}/accept`, {
        method: 'POST',
        body: JSON.stringify({ token: token.trim() }),
      });
      setToken('');
      setAccepted(true);
      onConsumed();
      setNotice('邀请已接受。');
      await onRefresh();
      setNotice('邀请已接受，球队授权已刷新。请选择“我的球队”开始报名。');
    } catch (cause) {
      setError(message(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="runtime-profile-layer">
      <section
        className="runtime-profile-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="runtime-profile-title"
        ref={panel}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault();
            onClose();
          }
          if (event.key !== 'Tab') return;
          const focusable = panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
          );
          if (!focusable?.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="runtime-profile-heading">
          <div>
            <span className="runtime-kicker">YOUR TEAM IDENTITY</span>
            <h2 id="runtime-profile-title">个人账号与球队邀请</h2>
          </div>
          <button
            className="runtime-close"
            aria-label="关闭个人账号"
            ref={closeButton}
            disabled={busy}
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        <div className="runtime-personal-id">
          <span>
            {session.user.displayName} · {session.user.email}
          </span>
          <label htmlFor="runtime-user-id">我的个人 ID</label>
          <input
            id="runtime-user-id"
            value={session.user.id}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <p>将此 ID 提供给机构负责人。邀请仅能由被明确指定的账号接受，邮箱不会自动认领权限。</p>
        </div>
        <div className="runtime-account-actions">
          <a className="button button-secondary" href="/players">
            找球员 / 预约比赛
          </a>
          <a className="button button-secondary" href="/player-center">
            我的球员中心
          </a>
          <a className="button button-secondary" href="/account/wechat">
            微信账户
          </a>
          {session.platformOperator === true && (
            <a className="button button-secondary" href="/platform/commerce">
              平台计费运营
            </a>
          )}
        </div>
        <h3>接受球队管理邀请</h3>
        <p className="runtime-profile-copy">
          由机构创建邀请后，将邀请 ID 与一次性令牌交给你。请核对当前登录账号。
        </p>
        {accepted ? (
          <div className="runtime-invitation-success" role="status">
            <Check size={20} />
            <span>{notice}</span>
          </div>
        ) : (
          <form
            className="runtime-invitation-form"
            onSubmit={(event) => {
              void acceptInvitation(event);
            }}
          >
            <label htmlFor="runtime-invitation-id">邀请 ID</label>
            <input
              id="runtime-invitation-id"
              value={invitationId}
              onChange={(event) => setInvitationId(event.target.value)}
              disabled={busy}
              autoComplete="off"
            />
            <label htmlFor="runtime-invitation-token">邀请令牌</label>
            <input
              id="runtime-invitation-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="runtime-input-hint">
              令牌仅保留在当前页面内存。分享链接中的令牌已从地址栏移除，不会发送邮件。
            </p>
            <button className="button button-primary" disabled={busy} type="submit">
              {busy ? '正在接受…' : '接受球队邀请'}
            </button>
          </form>
        )}
        {error && (
          <div className="runtime-error" role="alert">
            {accepted ? '邀请已接受，刷新授权失败：' : ''}
            {error}
          </div>
        )}
        {!accepted && notice && (
          <p role="status" className="runtime-input-hint">
            {notice}
          </p>
        )}
        <button
          className="button button-secondary runtime-refresh-session"
          disabled={busy}
          onClick={() => {
            void refresh();
          }}
        >
          {busy ? '正在处理…' : '刷新球队授权'}
        </button>
      </section>
    </div>
  );
}

export function ApiRuntime({ client: providedClient }: { client?: ApiClient }) {
  const sessionEpoch = useRef(0);
  const [accountView, setAccountView] = useState<'wechat' | 'platform' | 'booking' | null>(() =>
    isBookingPath(window.location.pathname)
      ? 'booking'
      : window.location.pathname === '/account/wechat'
        ? 'wechat'
        : window.location.pathname === '/platform/commerce'
          ? 'platform'
          : null,
  );
  useEffect(() => {
    const sync = () =>
      setAccountView(
        isBookingPath(window.location.pathname)
          ? 'booking'
          : window.location.pathname === '/account/wechat'
            ? 'wechat'
            : window.location.pathname === '/platform/commerce'
              ? 'platform'
              : null,
      );
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [organizationId, setOrganizationId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [contextMode, setContextMode] = useState<'organization' | 'team'>('organization');
  const [identityOpen, setIdentityOpen] = useState(false);
  const [pendingInvitation, setPendingInvitation] = useState<PendingInvitation | null>(null);
  const [invitationRevision, setInvitationRevision] = useState(0);
  const [phase, setPhase] = useState<'checking' | 'ready' | 'signedOut' | 'error'>('checking');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  useLayoutEffect(() => {
    function consumeFragment() {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = fragment.get('token');
      const id =
        fragment.get('invitation') ?? fragment.get('invitationId') ?? fragment.get('invite');
      if (token === null && id === null) return;
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}`,
      );
      setPendingInvitation({ id: id ?? '', token: token ?? '' });
      setInvitationRevision((revision) => revision + 1);
      setIdentityOpen(true);
    }
    consumeFragment();
    window.addEventListener('hashchange', consumeFragment);
    return () => window.removeEventListener('hashchange', consumeFragment);
  }, []);
  const unauthenticated = useCallback(() => {
    sessionEpoch.current += 1;
    setSession(null);
    setOrganizationId('');
    setTeamId('');
    setContextMode('organization');
    setPhase('signedOut');
  }, []);
  const client = useMemo(() => providedClient ?? createApiClient(), [providedClient]);
  const auth = useMemo(() => createAuthApi(client), [client]);
  const accept = useCallback((next: AuthSession) => {
    sessionEpoch.current += 1;
    setSession(next);
    setOrganizationId((current) =>
      next.organizations.some((org) => org.id === current)
        ? current
        : (next.organizations[0]?.id ?? ''),
    );
    setTeamId((current) =>
      next.teamContexts?.some((team) => team.teamId === current)
        ? current
        : (next.teamContexts?.[0]?.teamId ?? ''),
    );
    if (!next.organizations.length) setContextMode('team');
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
  const guardedClient = useMemo<ApiClient>(
    () => ({
      async request<T>(path: string, init?: RequestInit) {
        const epoch = sessionEpoch.current;
        try {
          return await client.request<T>(path, init);
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 401 && epoch === sessionEpoch.current)
            unauthenticated();
          throw cause;
        }
      },
    }),
    [client, unauthenticated],
  );
  const refreshSession = useCallback(async () => {
    const epoch = sessionEpoch.current;
    try {
      const next = await auth.session();
      if (epoch === sessionEpoch.current) accept(next);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401 && epoch === sessionEpoch.current)
        unauthenticated();
      throw cause;
    }
  }, [auth, accept, unauthenticated]);
  const organization = session?.organizations.find((org) => org.id === organizationId);
  const team = session?.teamContexts?.find((context) => context.teamId === teamId);
  const repository = useMemo(
    () =>
      createHttpEventRepository(
        guardedClient,
        contextMode === 'organization' ? organizationId : (team?.orgId ?? ''),
      ),
    [guardedClient, contextMode, organizationId, team?.orgId],
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
  if (phase === 'signedOut' || !session)
    return (
      <AuthForm
        auth={auth}
        client={client}
        onSession={accept}
        pendingInvitation={Boolean(pendingInvitation)}
      />
    );
  const workspaceType = (
    <label className="runtime-context-label">
      <span>工作空间</span>
      <select
        aria-label="工作空间"
        value={contextMode}
        onChange={(event) => {
          const nextMode = event.target.value;
          if (nextMode !== 'organization' && nextMode !== 'team') return;
          window.history.replaceState(
            window.history.state,
            '',
            nextMode === 'organization' ? '/' : '/my-team',
          );
          setContextMode(nextMode);
          setError('');
        }}
      >
        <option value="organization" disabled={!session.organizations.length}>
          机构工作台
        </option>
        <option value="team">我的球队</option>
      </select>
    </label>
  );
  const logoutButton = (
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
  );
  const headerActions = (
    <>
      <button
        className="button button-secondary button-small runtime-identity"
        aria-label="个人 ID / 邀请"
        title="个人 ID / 邀请"
        onClick={() => setIdentityOpen(true)}
      >
        <UserRound size={15} />
        <span>个人 ID / 邀请</span>
      </button>
      {logoutButton}
    </>
  );
  const switcher = (
    <div className="runtime-context-switcher">
      {workspaceType}
      {contextMode === 'organization' && organization ? (
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
      ) : team ? (
        <div className="runtime-org">
          <span className="org-avatar">{Array.from(team.teamName)[0]}</span>
          <label>
            <span className="sr-only">切换球队</span>
            <select
              aria-label="切换球队"
              value={team.teamId}
              onChange={(event) => {
                window.history.replaceState(window.history.state, '', '/my-team');
                setTeamId(event.target.value);
                setError('');
              }}
            >
              {session.teamContexts?.map((context) => (
                <option key={context.teamId} value={context.teamId}>
                  {context.teamName} · {context.organizationName}
                </option>
              ))}
            </select>
            <small>球队领队 · 授权由机构管理</small>
          </label>
        </div>
      ) : null}
    </div>
  );
  const hasContext = contextMode === 'organization' ? Boolean(organization) : Boolean(team);
  return (
    <>
      {accountView ? (
        <main
          className={accountView === 'booking' ? 'bk-runtime-wrapper' : 'runtime-account-tools'}
        >
          <div className="runtime-account-actions">
            <button
              className="button button-secondary"
              onClick={() => {
                window.history.replaceState(
                  window.history.state,
                  '',
                  contextMode === 'team' ? '/my-team' : '/',
                );
                setAccountView(null);
              }}
            >
              返回工作台
            </button>
            {logoutButton}
          </div>
          <Suspense fallback={<p role="status">正在读取账户工作台…</p>}>
            {accountView === 'booking' ? (
              <BookingStandaloneApp client={guardedClient} />
            ) : accountView === 'wechat' ? (
              <WechatAccountPage client={guardedClient} onSignedOut={unauthenticated} />
            ) : session.platformOperator === true ? (
              <PlatformCommercePage client={guardedClient} userId={session.user.id} />
            ) : (
              <p role="alert">当前账号没有平台运营权限。</p>
            )}
          </Suspense>
        </main>
      ) : hasContext ? (
        <App
          key={`${session.user.id}:${contextMode}:${contextMode === 'organization' ? organizationId : teamId}`}
          repository={repository}
          workspace={{
            mode: 'api',
            organizationName:
              contextMode === 'organization'
                ? (organization?.name ?? '')
                : (team?.organizationName ?? '我的球队'),
            userDisplayName: session.user.displayName,
            role: contextMode === 'organization' ? organization?.role : undefined,
            organizationSwitcher: switcher,
            headerActions,
            registration: {
              client: guardedClient,
              organizationId: contextMode === 'organization' ? organizationId : undefined,
              teamContext: contextMode === 'team' ? team : undefined,
              userId: session.user.id,
              onSessionRefresh: refreshSession,
            },
          }}
        />
      ) : (
        <main className="runtime-state runtime-account-home">
          <Trophy size={34} />
          <h1>{contextMode === 'team' ? '你的球队主场，从邀请开始' : '暂无可访问的机构'}</h1>
          <p>
            你好，{session.user.displayName}。当前没有有效{contextMode === 'team' ? '球队' : '机构'}
            授权。接受明确绑定个人 ID 的球队邀请后，即可查看赛事并报名。
          </p>
          <div className="runtime-no-context-switcher">{workspaceType}</div>
          <label htmlFor="runtime-home-user-id">我的个人 ID</label>
          <input
            id="runtime-home-user-id"
            className="runtime-home-user-id"
            value={session.user.id}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="runtime-account-actions">
            <a className="button button-primary" href="/players">
              找球员 / 预约比赛
            </a>
            <a className="button button-secondary" href="/player-center">
              申请成为预约球员
            </a>
            {headerActions}
            <button
              className="button button-secondary"
              onClick={() => {
                void refreshSession().catch((cause: unknown) => setError(message(cause)));
              }}
            >
              刷新授权
            </button>
          </div>
        </main>
      )}
      {identityOpen && (
        <IdentityPanel
          key={invitationRevision}
          session={session}
          client={guardedClient}
          initialInvitation={pendingInvitation}
          onClose={() => setIdentityOpen(false)}
          onRefresh={refreshSession}
          onConsumed={() =>
            setPendingInvitation((current) => (current === pendingInvitation ? null : current))
          }
        />
      )}
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
  publicFetcher,
  overlayFetcher,
}: {
  mode?: string;
  client?: ApiClient;
  publicFetcher?: typeof fetch;
  overlayFetcher?: typeof fetch;
}) {
  if (window.location.pathname === '/overlay' || window.location.pathname.startsWith('/overlay/'))
    return <OverlayEntry key={window.location.pathname} fetcher={overlayFetcher} />;
  if (window.location.pathname === '/watch' || window.location.pathname.startsWith('/watch/'))
    return (
      <Suspense
        fallback={
          <main className="runtime-state" role="status">
            正在读取公开观赛页面…
          </main>
        }
      >
        <PublicViewingApp fetcher={publicFetcher} />
      </Suspense>
    );
  if (mode === 'mock') return <App />;
  if (mode === 'api') return <ApiRuntime client={client} />;
  return (
    <main className="runtime-state">
      <h1>数据模式配置无效</h1>
      <p role="alert">请使用 VITE_DATA_MODE=api 或 mock。未连接任何数据服务。</p>
    </main>
  );
}
