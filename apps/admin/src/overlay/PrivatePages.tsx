import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Copy, Monitor, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  OverlayCommandInput,
  OverlayGrantData,
  OverlayWorkbenchData,
  ScheduledMatchData,
} from '@small-city-basketball/contracts';
import { ApiError } from '../api/client';
import { createOverlayManagementApi } from '../api/overlay';
import { createSchedulingApi } from '../api/scheduling';
import type { EventRepository } from '../domain/types';
import type { RegistrationWorkspace } from '../registration/shared';
import { PageHeading, ResourceState, message, useResource } from '../registration/shared';
import { localMoment, matchStatusLabels } from '../scoring/shared';
import { Modal } from '../scoring/Dialogs';
import { presentation } from './OverlaySource';
import { OverlayPreview } from './Renderer';
function organization(
  context: RegistrationWorkspace,
): context is RegistrationWorkspace & { organizationId: string } {
  return Boolean(context.organizationId?.trim() && !context.teamContext);
}
function AccessRequired() {
  return (
    <section className="panel view-empty">
      <ShieldCheck size={30} />
      <h1>请切换到机构工作台</h1>
      <p>球队身份不包含比分包装管理权限。</p>
      <Link to="/my-team" className="button button-secondary">
        返回我的球队
      </Link>
    </section>
  );
}
export function BroadcastIndexPage({
  context,
  repository,
}: {
  context: RegistrationWorkspace;
  repository: EventRepository;
}) {
  return organization(context) ? (
    <BroadcastIndex key={context.organizationId} context={context} repository={repository} />
  ) : (
    <AccessRequired />
  );
}
function BroadcastIndex({
  context,
  repository,
}: {
  context: RegistrationWorkspace & { organizationId: string };
  repository: EventRepository;
}) {
  const read = useCallback(() => repository.list(), [repository]);
  const events = useResource(read);
  const [eventId, setEventId] = useState('');
  const [matches, setMatches] = useState<ScheduledMatchData[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const api = useMemo(
    () => createSchedulingApi(context.client, context.organizationId),
    [context.client, context.organizationId],
  );
  useEffect(() => {
    let active = true;
    setMatches(null);
    setError('');
    if (!eventId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void api
      .matches(eventId)
      .then((value) => {
        if (active) setMatches(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, eventId, revision]);
  return (
    <div className="overlay-management">
      <PageHeading
        eyebrow="ONE MATCH. ONE CLEAN FRAME."
        title="直播与 OBS"
        description="为正式比赛签发有限期的只读比分包装。独立于公开观赛，记分不依赖包装在线。"
      />
      <div className="view-note">
        <Monitor size={22} />
        <p>
          浏览器源画布为1920×1080透明下三分之一。当前提供网页包装；原生 OBS
          客户端兼容性仍需现场验收。
        </p>
      </div>
      {events.loading || events.error || !events.data ? (
        <ResourceState {...events} />
      ) : (
        <section className="panel overlay-selection">
          <label htmlFor="overlay-event">赛事</label>
          <select
            id="overlay-event"
            aria-label="赛事"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          >
            <option value="">请选择赛事</option>
            {events.data.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
          {!events.data.length && <p>暂无有赛事权限的机构赛事。仅场次授权不包含包装管理。</p>}
        </section>
      )}
      {eventId &&
        (loading || error ? (
          <ResourceState loading={loading} error={error} reload={() => setRevision((n) => n + 1)} />
        ) : (
          matches && (
            <section className="overlay-match-grid">
              {matches.length ? (
                matches.map((match) => (
                  <Link
                    className="panel overlay-match-card"
                    key={match.id}
                    to={`/matches/${match.id}/overlay`}
                  >
                    <span className="status-badge neutral">{matchStatusLabels[match.status]}</span>
                    <h2>
                      {match.home.teamName} <span>vs</span> {match.away.teamName}
                    </h2>
                    <p>
                      第{match.roundNo}轮 · {match.courtName}
                    </p>
                    <p>{localMoment(match.startsAt)}</p>
                    <strong>管理比分包装 →</strong>
                  </Link>
                ))
              ) : (
                <div className="panel view-empty">
                  <h2>暂无正式比赛</h2>
                  <p>请先完成赛程发布，再为比赛配置包装链接。</p>
                </div>
              )}
            </section>
          )
        ))}
    </div>
  );
}
type Intent = 'ISSUE' | 'ROTATE' | 'REVOKE';
const verbs = { ISSUE: '签发', ROTATE: '轮换', REVOKE: '撤销' };
function GrantStatus({ grant }: { grant: OverlayGrantData }) {
  return (
    <span
      className={`status-badge ${grant.status === 'ACTIVE' ? 'green' : grant.status === 'EXPIRED' ? 'amber' : 'neutral'}`}
    >
      {grant.status === 'ACTIVE'
        ? '授权有效'
        : grant.status === 'EXPIRED'
          ? '授权已到期'
          : '已永久撤销'}
    </span>
  );
}
export function MatchOverlayPage({ context }: { context: RegistrationWorkspace }) {
  const { matchId = '' } = useParams();
  return organization(context) ? (
    <MatchOverlay
      key={`${context.organizationId}:${matchId}`}
      context={context}
      matchId={matchId}
    />
  ) : (
    <AccessRequired />
  );
}
function MatchOverlay({
  context,
  matchId,
}: {
  context: RegistrationWorkspace & { organizationId: string };
  matchId: string;
}) {
  const api = useMemo(
    () => createOverlayManagementApi(context.client, context.organizationId),
    [context.client, context.organizationId],
  );
  const [data, setData] = useState<OverlayWorkbenchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [credential, setCredential] = useState<{ overlayId: string; token: string } | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [dialog, setDialog] = useState<{ type: Intent; reviewed: OverlayWorkbenchData } | null>(
    null,
  );
  const [ttl, setTtl] = useState('');
  const [reason, setReason] = useState('');
  const [validation, setValidation] = useState('');
  const [now, setNow] = useState(performance.now());
  const received = useRef(performance.now());
  const generation = useRef(0);
  const active = useRef(false);
  const lock = useRef(false);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setDialog(null);
    try {
      const value = await api.workbench(matchId);
      if (active.current && request === generation.current) {
        received.current = performance.now();
        setData(value);
        setNeedsRefresh(false);
      }
    } catch (cause) {
      if (active.current && request === generation.current) {
        setError(message(cause));
        setNeedsRefresh(true);
      }
    } finally {
      if (active.current && request === generation.current) setLoading(false);
    }
  }, [api, matchId]);
  useEffect(() => {
    active.current = true;
    void load();
    const timer = setInterval(() => setNow(performance.now()), 200);
    return () => {
      active.current = false;
      generation.current += 1;
      clearInterval(timer);
    };
  }, [load]);
  function open(type: Intent) {
    if (!data || needsRefresh || busy) return;
    setDialog({ type, reviewed: data });
    setTtl('');
    setReason('');
    setValidation('');
    setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dialog || lock.current) return;
    const type = dialog.type;
    if (type !== 'REVOKE' && (!/^\d+$/.test(ttl) || Number(ttl) < 1 || Number(ttl) > 10080)) {
      setValidation('授权有效分钟需为1–10080的整数');
      return;
    }
    if (
      type !== 'ISSUE' &&
      (Array.from(reason.trim()).length < 1 || Array.from(reason.trim()).length > 200)
    ) {
      setValidation('请填写1–200个字符的理由');
      return;
    }
    const reviewed = dialog.reviewed;
    const grant = reviewed.currentGrant;
    let input: OverlayCommandInput;
    if (type === 'ISSUE')
      input = { type, expectedEventVersion: reviewed.event.version, expiresInMinutes: Number(ttl) };
    else {
      if (!grant) return;
      input =
        type === 'REVOKE'
          ? {
              type,
              expectedEventVersion: reviewed.event.version,
              overlayId: grant.overlayId,
              expectedGrantVersion: grant.version,
              reason: reason.trim(),
            }
          : {
              type,
              expectedEventVersion: reviewed.event.version,
              overlayId: grant.overlayId,
              expectedGrantVersion: grant.version,
              reason: reason.trim(),
              expiresInMinutes: Number(ttl),
            };
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setValidation('');
    setCredential(null);
    setCopyMessage('');
    const request = ++generation.current;
    try {
      const value = await api.command(matchId, input);
      if (!active.current || request !== generation.current) return;
      received.current = performance.now();
      setData(value);
      setCredential(value.credential);
      setDialog(null);
      setNeedsRefresh(false);
      setNotice(`包装链接已${verbs[type]}`);
    } catch (cause) {
      if (!active.current || request !== generation.current) return;
      setNeedsRefresh(true);
      setDialog(null);
      setError(
        cause instanceof ApiError && (cause.status === 0 || cause.apiCode === 'INVALID_RESPONSE')
          ? '未能确认操作结果。请先重新读取授权元数据；若已签发但链接丢失，请显式轮换，不要重复签发。'
          : message(cause),
      );
    } finally {
      lock.current = false;
      if (active.current && request === generation.current) setBusy(false);
    }
  }
  const sourceUrl = credential
    ? `${window.location.origin}/overlay/${encodeURIComponent(credential.overlayId)}#token=${credential.token}`
    : '';
  return (
    <div className="overlay-management">
      <Link className="back-link" to="/broadcast">
        <ChevronLeft size={16} />
        返回直播与 OBS
      </Link>
      <PageHeading
        eyebrow="READ ONLY, ON AIR"
        title={data?.event.name ?? '比分包装'}
        description="独立授权只读画面，不包含后台操作权限。"
      />
      {loading || (!data && error) ? (
        <ResourceState
          loading={loading}
          error={error}
          reload={() => {
            void load();
          }}
        />
      ) : (
        data && (
          <>
            <div className="overlay-toolbar">
              <span>透明画布 · 1920×1080</span>
              <button
                className="button button-secondary"
                disabled={busy || loading}
                onClick={() => {
                  void load();
                }}
              >
                <RefreshCw size={16} />
                重新读取授权元数据
              </button>
            </div>
            {error && (
              <div className="registration-alert" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <div className="success-notice" role="status">
                {notice}
              </div>
            )}
            {needsRefresh && (
              <div className="view-note">
                <ShieldCheck size={20} />
                <p>当前操作状态需核对。重新读取成功前暂停新的授权操作。</p>
              </div>
            )}
            <section className="panel overlay-preview-panel">
              <div className="overlay-section-heading">
                <h2>包装预览</h2>
                <span>有限只读画面 · 非视频信号</span>
              </div>
              <OverlayPreview
                data={presentation(data.preview, now - received.current)}
                message={data.previewError ? '赛果来源暂不可用，授权管理仍可使用' : '尚未准备'}
              />
              {data.previewError && (
                <p role="alert">赛果来源需重新核对，预览已清除。你仍可轮换或撤销已有授权。</p>
              )}
              <p className="overlay-muted">
                此预览取最近一次读取的权威资料。正式浏览器源每2秒读取；请在重要操作后重新读取预览。
              </p>
            </section>
            <section className="panel overlay-grant-panel">
              <div className="overlay-section-heading">
                <h2>当前只读授权</h2>
                {data.currentGrant ? (
                  <GrantStatus grant={data.currentGrant} />
                ) : (
                  <span className="status-badge neutral">尚未签发</span>
                )}
              </div>
              {data.currentGrant ? (
                <dl className="overlay-facts">
                  <div>
                    <dt>签发时间</dt>
                    <dd>{localMoment(data.currentGrant.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>固定到期时间</dt>
                    <dd>{localMoment(data.currentGrant.expiresAt)}</dd>
                  </div>
                </dl>
              ) : (
                <p>为这场比赛签发独立且有限期的浏览器源链接。</p>
              )}
              <div className="overlay-actions">
                {data.capabilities.canIssue && (
                  <button
                    className="button button-primary"
                    disabled={busy || needsRefresh}
                    onClick={() => open('ISSUE')}
                  >
                    签发包装链接
                  </button>
                )}
                {data.capabilities.canRotate && (
                  <button
                    className="button button-primary"
                    disabled={busy || needsRefresh}
                    onClick={() => open('ROTATE')}
                  >
                    轮换包装链接
                  </button>
                )}
                {data.capabilities.canRevoke && (
                  <button
                    className="button button-secondary"
                    disabled={busy || needsRefresh}
                    onClick={() => open('REVOKE')}
                  >
                    撤销包装链接
                  </button>
                )}
                {!Object.values(data.capabilities).some(Boolean) && (
                  <p>当前赛事授权仅可查看预览与授权状态，不能管理包装链接。</p>
                )}
              </div>
              <p className="overlay-muted">
                到期不会自动续期。签发者退出登录或个人权限变化不会自动撤销此链接；请由当前管理者主动轮换或撤销。
              </p>
            </section>
            {credential && (
              <section className="panel overlay-credential">
                <h2>请保存本次浏览器源链接</h2>
                <p>
                  完整地址只在本次成功操作后提供。离开页面后不能恢复；丢失时请显式轮换。不要公开分享。
                </p>
                <label htmlFor="overlay-source-url">浏览器源链接（已遮罩）</label>
                <input
                  id="overlay-source-url"
                  aria-label="浏览器源链接（已遮罩）"
                  type="password"
                  autoComplete="off"
                  value={sourceUrl}
                  readOnly
                />
                <button
                  className="button button-primary"
                  onClick={() => {
                    if (!navigator.clipboard?.writeText) {
                      setCopyMessage(
                        '当前浏览器不支持复制，请在受信任的浏览器中重试；不要重复签发。',
                      );
                      return;
                    }
                    void navigator.clipboard
                      .writeText(sourceUrl)
                      .then(() => {
                        if (active.current) setCopyMessage('浏览器源链接已复制');
                      })
                      .catch(() => {
                        if (active.current)
                          setCopyMessage('复制未完成，请重新点击复制；不要重复签发。');
                      });
                  }}
                >
                  <Copy size={16} />
                  复制浏览器源链接
                </button>
                <span role="status">{copyMessage}</span>
              </section>
            )}
            <section className="panel overlay-setup">
              <h2>加入浏览器源</h2>
              <ol>
                <li>复制本次签发的完整链接，保存到 OBS 浏览器源设置。</li>
                <li>明确设置宽1920、高1080，保留透明背景。</li>
                <li>在实际导播环境检查透明合成、刷新及隐藏后重新加载。</li>
              </ol>
              <p>
                原始地址可以在有效期内重新授权。页面会立即清除地址栏中的密钥；刷新后的无片段地址依赖只读
                Cookie，失效时请重新加载保存的原始源地址。
              </p>
            </section>
            <section className="panel overlay-history">
              <h2>已撤销授权记录</h2>
              {!data.history.length ? (
                <p>暂无已撤销授权。</p>
              ) : (
                <ul>
                  {data.history.map((grant) => (
                    <li key={grant.overlayId}>
                      <div>
                        <GrantStatus grant={grant} />
                        <strong>{localMoment(grant.createdAt)}</strong>
                      </div>
                      <p>
                        {grant.revocationReason === 'SUPERSEDED_AFTER_EXPIRY'
                          ? '到期后签发新授权，旧身份已关闭'
                          : grant.revocationReason}
                      </p>
                      <span>撤销于 {grant.revokedAt ? localMoment(grant.revokedAt) : '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {data.historyTruncated && (
                <p>仅显示最近{data.historyLimit}条已撤销记录，较早记录未在此列出。</p>
              )}
            </section>
          </>
        )
      )}
      {dialog && (
        <Modal title={`${verbs[dialog.type]}包装链接`} busy={busy} onClose={() => setDialog(null)}>
          <form
            className="overlay-command-form"
            onSubmit={(e) => {
              void submit(e);
            }}
            noValidate
          >
            <p>
              {dialog.type === 'ISSUE'
                ? '仅授予本场比分包装的读取权限。请明确本次期限。'
                : dialog.type === 'ROTATE'
                  ? '旧链接和已有只读会话将永久失效；新链接需要重新粘入浏览器源。'
                  : '旧链接和已有只读会话将永久失效，无法恢复。'}{' '}
              此操作不会改动记分或赛果。
            </p>
            {dialog.type !== 'REVOKE' && (
              <label>
                授权有效分钟
                <input
                  aria-label="授权有效分钟"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="10080"
                  value={ttl}
                  onChange={(e) => setTtl(e.target.value)}
                  disabled={busy}
                />
                <span>必填整数1–10080分钟，保存或刷新不会延长。</span>
              </label>
            )}
            {dialog.type !== 'ISSUE' && (
              <label>
                {verbs[dialog.type]}理由
                <textarea
                  aria-label={`${verbs[dialog.type]}理由`}
                  value={reason}
                  maxLength={400}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                />
                <span>必填，1–200个字符。</span>
              </label>
            )}
            {validation && <p role="alert">{validation}</p>}
            <div className="overlay-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                取消
              </button>
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? '正在处理…' : `确认${verbs[dialog.type]}`}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
