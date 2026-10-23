import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Archive,
  CheckCircle2,
  ChevronLeft,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import type { EventLifecycleCommandInput } from '@small-city-basketball/contracts';
import { createLifecycleApi } from '../api/lifecycle';
import { EVENT_STATUS_LABELS } from '../domain/types';
import type { RegistrationWorkspace } from '../registration/shared';
import {
  ActionNotice,
  PageHeading,
  ResourceState,
  useAction,
  useResource,
} from '../registration/shared';
import { Modal } from '../scoring/Dialogs';

type Command = EventLifecycleCommandInput['type'];
const blockerLabels: Record<string, string> = {
  SCHEDULE_REQUIRED: '尚未发布正式赛程。',
  STANDINGS_RULES_REQUIRED: '排名规则尚未正式发布并锁定。',
  UNCONFIRMED_MATCHES: '仍有比赛缺少当前有效的独立赛果确认。',
  RESULT_SOURCE_INVALID: '赛果或球员统计来源不一致，请核对确认记录。',
};
const blockerLabel = (value: string) =>
  blockerLabels[value] ??
  (/^[A-Z_]+$/.test(value) ? '当前完赛条件尚不满足，请重新读取并核对赛事资料。' : value);
const labels: Record<Command, string> = {
  COMPLETE: '确认整届完赛',
  ARCHIVE: '归档赛事',
  REOPEN: '重开赛事',
};
const explanations: Record<Command, string> = {
  COMPLETE:
    '完赛后停止本届记分、更正、赛果重开和新计分租约；现有公开观赛链接将永久撤销。历史观赛须另行显式授权，OBS授权仍独立管理。',
  ARCHIVE:
    '归档保留本届正式赛程、赛果和名单历史，继续禁止业务写入；已显式启用的历史观赛授权可保留。',
  REOPEN:
    '本届将恢复进行中，当前公开及历史观赛链接永久撤销。单场已确认赛果不会自动重开；如需更正，仍须单独重开赛果并由独立人员重新确认。',
};
export function EventLifecyclePage({ context }: { context: RegistrationWorkspace }) {
  const { eventId = '' } = useParams();
  if (!context.organizationId?.trim() || context.teamContext)
    return (
      <section className="panel view-empty">
        <ShieldCheck size={30} />
        <h1>请切换到机构工作台</h1>
        <p>球队授权不包含整届生命周期管理权限。</p>
        <Link className="button button-secondary" to="/my-team">
          返回我的球队
        </Link>
      </section>
    );
  return (
    <LifecyclePage
      key={`${context.organizationId}:${eventId}`}
      context={context}
      organizationId={context.organizationId}
      eventId={eventId}
    />
  );
}
function LifecyclePage({
  context,
  organizationId,
  eventId,
}: {
  context: RegistrationWorkspace;
  organizationId: string;
  eventId: string;
}) {
  const api = useMemo(
    () => createLifecycleApi(context.client, organizationId),
    [context.client, organizationId],
  );
  const read = useCallback(() => api.event(eventId), [api, eventId]);
  const resource = useResource(read);
  const action = useAction();
  const [decision, setDecision] = useState<{ type: Command; version: number } | null>(null);
  const [reason, setReason] = useState('');
  const [validation, setValidation] = useState('');
  const data = resource.data;
  function refresh() {
    if (action.busy) return;
    setDecision(null);
    setValidation('');
    action.clear();
    resource.reload();
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!decision || action.conflict || action.busy) return;
    const trimmed = reason.trim();
    const length = Array.from(trimmed).length;
    if (length < 4 || length > 500) {
      setValidation('请填写4–500字的操作原因');
      return;
    }
    setValidation('');
    await action.run(async () => {
      await api.command(eventId, {
        type: decision.type,
        expectedEventVersion: decision.version,
        reason: trimmed,
      });
      if (!action.isActive()) return;
      setDecision(null);
      setReason('');
      resource.reload();
    }, `${labels[decision.type]}已完成`);
  }
  const closed = data?.event.status === 'COMPLETED' || data?.event.status === 'ARCHIVED';
  return (
    <div className="view-page">
      <Link className="back-link" to={`/events/${encodeURIComponent(eventId)}`}>
        <ChevronLeft size={16} />
        返回赛事详情
      </Link>
      <PageHeading
        eyebrow="CONFIRMED RESULTS. COMPLETE SEASON."
        title={data?.event.name ?? '赛事完赛与归档'}
        description="整届完赛由主办方明确确认；单场赛果、计时和排名继续使用原有权威记录。"
      >
        <button
          className="button button-secondary"
          disabled={resource.loading || action.busy}
          onClick={refresh}
        >
          <RefreshCw size={16} />
          刷新完赛资料
        </button>
      </PageHeading>
      <ActionNotice action={action} onReload={refresh} />
      {!data ? (
        <ResourceState {...resource} />
      ) : (
        <>
          <section className="panel view-panel">
            <div className="view-actions">
              <span className="status-badge neutral">{EVENT_STATUS_LABELS[data.event.status]}</span>
              <span className="registration-version">资料 v{data.event.version}</span>
            </div>
            <h2>整届完赛核对</h2>
            <p>
              {data.completion.confirmedMatchCount} / {data.completion.totalMatchCount}{' '}
              场当前有效确认
            </p>
            {data.completion.ready ? (
              <p>正式赛程与确认赛果已满足完赛门槛。</p>
            ) : (
              <p>当前尚未满足完赛门槛。</p>
            )}
            {data.completion.blockers.length > 0 && (
              <ul aria-label="完赛阻塞项">
                {data.completion.blockers.map((blocker, index) => (
                  <li key={`${index}:${blocker}`}>{blockerLabel(blocker)}</li>
                ))}
              </ul>
            )}
            <div className="view-actions">
              <Link
                className="button button-secondary"
                to={`/events/${encodeURIComponent(eventId)}/scoring`}
              >
                查看正式比赛
              </Link>
              <Link
                className="button button-secondary"
                to={`/events/${encodeURIComponent(eventId)}/standings`}
              >
                查看排名与观赛授权
              </Link>
            </div>
          </section>
          <section className="panel view-panel">
            <h2>生命周期操作</h2>
            <p className="view-muted">
              操作需要赛事管理权限和审计原因；每次提交都会核验当前赛事版本与最新赛果。
            </p>
            {closed && (
              <p>本届已闭赛，比分、更正、赛果重开及新租约暂停。需要更正时先明确重开本届。</p>
            )}
            <div className="view-actions">
              {data.capabilities.canComplete && (
                <button
                  className="button button-primary"
                  disabled={!data.completion.ready || action.busy || action.conflict}
                  onClick={() => setDecision({ type: 'COMPLETE', version: data.event.version })}
                >
                  <CheckCircle2 size={17} />
                  确认整届完赛
                </button>
              )}
              {data.capabilities.canArchive && (
                <button
                  className="button button-primary"
                  disabled={action.busy || action.conflict}
                  onClick={() => setDecision({ type: 'ARCHIVE', version: data.event.version })}
                >
                  <Archive size={17} />
                  归档赛事
                </button>
              )}
              {data.capabilities.canReopen && (
                <button
                  className="button button-secondary"
                  disabled={action.busy || action.conflict}
                  onClick={() => setDecision({ type: 'REOPEN', version: data.event.version })}
                >
                  <RotateCcw size={17} />
                  重开赛事
                </button>
              )}
            </div>
            {!Object.values(data.capabilities).some(Boolean) && (
              <p className="view-muted">当前身份或赛事状态不提供生命周期操作。</p>
            )}
          </section>
          <div className="view-note">
            <ShieldCheck size={20} />
            <p>
              完赛不会自动公开历史。完赛或重开后旧公开链接永久失效，历史观赛需要在排名与观赛页单独授权；OBS入口仍独立管理。
            </p>
          </div>
        </>
      )}
      {decision && (
        <Modal title={labels[decision.type]} busy={action.busy} onClose={() => setDecision(null)}>
          <p>{explanations[decision.type]}</p>
          <p>本次核对赛事版本 v{decision.version}。</p>
          <form className="score-form" onSubmit={(event) => void confirm(event)} noValidate>
            <label className="score-field">
              操作原因
              <textarea
                aria-label="操作原因"
                value={reason}
                maxLength={1000}
                disabled={action.busy}
                onChange={(event) => {
                  setReason(event.target.value);
                  setValidation('');
                }}
              />
            </label>
            {validation && <p role="alert">{validation}</p>}
            {action.error && (
              <div className="view-note error" role="alert">
                {action.error}
                {action.conflict
                  ? ' 原因已保留；请关闭并重新读取最新资料，核对后再确认。'
                  : ' 本次未完成，请核对后重试。'}
              </div>
            )}
            <div className="view-actions">
              <button
                type="submit"
                className="button button-primary"
                disabled={action.busy || action.conflict}
              >
                确认{labels[decision.type].replace(/^确认/, '')}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={action.busy}
                onClick={() => setDecision(null)}
              >
                取消
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
