import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { History, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type {
  CourtData,
  MatchReschedulePlan,
  MatchReschedulingData,
  RescheduleMatchInput,
  ScheduleConflict,
  ScheduledMatchData,
} from '@small-city-basketball/contracts';
import { ApiError } from '../api/client';
import { scheduleConflicts } from '../api/scheduling';
import type { SchedulingApi } from '../api/scheduling';
import { message } from '../registration/shared';
import { PolicySummary } from './PolicyForm';
import { conflictTitles } from './ScheduleEditor';
import { fixtureLabel, localInput, matchStatusLabels, offsetTime, timeLabel } from './shared';

function Plan({ title, plan }: { title: string; plan: MatchReschedulePlan }) {
  return (
    <div className="sc-reschedule-plan">
      <strong>{title}</strong>
      <dl>
        <div>
          <dt>场地</dt>
          <dd>{plan.courtName}</dd>
        </div>
        <div>
          <dt>开赛</dt>
          <dd>{timeLabel(plan.startsAt)}</dd>
        </div>
        <div>
          <dt>预计结束</dt>
          <dd>{timeLabel(plan.endsAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function Rescheduling({
  match,
  courts,
  api,
  onClose,
  onSaved,
  onLocate,
}: {
  match: ScheduledMatchData;
  courts: CourtData[];
  api: SchedulingApi;
  onClose: () => void;
  onSaved: () => void;
  onLocate: (fixtureKey: string) => void;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const operation = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const [workspace, setWorkspace] = useState<MatchReschedulingData>();
  const [busy, setBusy] = useState<'read' | 'submit'>();
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [courtId, setCourtId] = useState('');
  const [localStart, setLocalStart] = useState('');
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState<RescheduleMatchInput>();
  const [locked, setLocked] = useState(false);
  const [freshRead, setFreshRead] = useState(false);

  const request = useCallback(async <T,>(call: (signal: AbortSignal) => Promise<T>) => {
    const current = new AbortController();
    controller.current = current;
    const timeout = setTimeout(() => current.abort(), 8000);
    try {
      return await call(current.signal);
    } finally {
      clearTimeout(timeout);
      if (controller.current === current) controller.current = undefined;
    }
  }, []);

  const read = useCallback(
    async (review: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const sequence = ++operation.current;
      setBusy('read');
      setError('');
      setConfirmation(undefined);
      setConflicts([]);
      if (review) {
        setLocked(true);
        setFreshRead(false);
      }
      try {
        const current = await request((signal) => api.rescheduling(match.id, signal));
        if (current.event.id !== match.eventId)
          throw new ApiError(404, 'RESOURCE_NOT_FOUND', '这场比赛不属于当前赛事');
        if (!alive.current || operation.current !== sequence) return;
        setWorkspace(current);
        if (review) {
          setFreshRead(true);
        } else {
          setCourtId(current.match.courtId);
          setLocalStart(localInput(current.match.startsAt));
        }
      } catch (cause) {
        if (alive.current && operation.current === sequence)
          setError(`读取当前安排失败：${message(cause)}`);
      } finally {
        if (operation.current === sequence) {
          inFlight.current = false;
          if (alive.current) setBusy(undefined);
        }
      }
    },
    [api, match.id, match.eventId, request],
  );

  useEffect(() => {
    alive.current = true;
    void read(false);
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'start' });
    return () => {
      alive.current = false;
      operation.current++;
      inFlight.current = false;
      controller.current?.abort();
    };
  }, [read]);

  function change() {
    setConfirmation(undefined);
    setError('');
    setConflicts([]);
  }
  const allowedCourts = courts.filter(
    (court) =>
      court.status === 'ACTIVE' &&
      workspace?.policy.courtWindows.some((window) => window.courtId === court.id),
  );
  const chosenCourt = allowedCourts.find((court) => court.id === courtId);
  const canWrite = workspace?.capabilities.canReschedule === true;
  let proposed: MatchReschedulePlan | undefined;
  if (workspace && chosenCourt && localStart) {
    try {
      const startsAt = offsetTime(localStart);
      proposed = {
        courtId,
        courtName:
          courtId === workspace.match.courtId ? workspace.match.courtName : chosenCourt.name,
        startsAt,
        endsAt: new Date(
          Date.parse(startsAt) + workspace.policy.slotDurationMinutes * 60_000,
        ).toISOString(),
      };
    } catch {
      /* The form reports invalid input before confirmation. */
    }
  }
  function review(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !canWrite || locked || inFlight.current) return;
    setError('');
    setConflicts([]);
    if (!proposed) {
      setError('请选择可用窗口内的场地，并填写真实有效的开赛时间');
      return;
    }
    if (!reason.trim() || reason.trim().length > 500) {
      setError('请填写1–500字的改期原因');
      return;
    }
    if (
      courtId === workspace.match.courtId &&
      Date.parse(proposed.startsAt) === Date.parse(workspace.match.startsAt)
    ) {
      setError('场地和开赛时间没有变化，请先调整安排');
      return;
    }
    setConfirmation({
      type: 'RESCHEDULE',
      expectedEventVersion: workspace.event.version,
      expectedMatchVersion: workspace.match.version,
      courtId,
      startsAt: proposed.startsAt,
      reason: reason.trim(),
    });
  }
  async function submit() {
    if (!confirmation || !workspace || !canWrite || locked || inFlight.current) return;
    inFlight.current = true;
    const sequence = ++operation.current;
    setBusy('submit');
    setError('');
    try {
      const result = await request((signal) => api.reschedule(match.id, confirmation, signal));
      if (result.event.id !== match.eventId)
        throw new ApiError(200, 'INVALID_RESPONSE', '改期响应与当前赛事不一致');
      if (alive.current && operation.current === sequence) onSaved();
    } catch (cause) {
      if (!alive.current || operation.current !== sequence) return;
      setConfirmation(undefined);
      const code = cause instanceof ApiError ? cause.apiCode : '';
      const knownRejection = [
        'SCHEDULE_CONFLICT',
        'VALIDATION_ERROR',
        'RESCHEDULE_UNCHANGED',
      ].includes(code);
      const found =
        cause instanceof ApiError ? scheduleConflicts(cause.details?.conflicts) : undefined;
      setConflicts(found ?? []);
      if (!knownRejection) {
        setLocked(true);
        setFreshRead(false);
      }
      setError(
        code === 'VERSION_CONFLICT'
          ? `资料版本已变化：${message(cause)}。当前输入已保留，重新读取并核对后再操作。`
          : knownRejection
            ? message(cause)
            : `本次结果或操作资格尚未确认：${message(cause)}。请先读取最新安排核对，不要重复提交。`,
      );
    } finally {
      if (operation.current === sequence) {
        inFlight.current = false;
        if (alive.current) setBusy(undefined);
      }
    }
  }

  return (
    <section className="panel sc-panel sc-rescheduling" role="region" aria-labelledby={titleId}>
      <div className="section-heading">
        <div>
          <h2 id={titleId} ref={heading} tabIndex={-1}>
            单场改期与记录
          </h2>
          <p>
            {fixtureLabel(match)} · {match.home.teamName} VS {match.away.teamName}
          </p>
        </div>
        <button className="button button-secondary" disabled={Boolean(busy)} onClick={onClose}>
          <X size={16} />
          关闭改期记录
        </button>
      </div>
      {busy === 'read' && <p role="status">正在读取当前安排…</p>}
      {error && (
        <div className="registration-alert" role="alert">
          {error}
        </div>
      )}
      {workspace && (
        <>
          <div className="sc-reschedule-current">
            <span className="status-badge neutral">
              {matchStatusLabels[workspace.match.status]}
            </span>
            <Plan
              title={locked && !freshRead ? '上次读取的正式安排（待核对）' : '当前正式安排'}
              plan={workspace.match}
            />
          </div>
          {canWrite ? (
            <>
              <PolicySummary policy={workspace.policy} courts={courts} />
              <p className="sc-hint">
                时间统一为中国标准时间（UTC+8）。改期沿用上述窗口和休息规则；对阵、名单、比分和计时保持原事实，提交时服务端重新检查占用。
              </p>
              {locked && (
                <div className="sc-reschedule-recovery" role="status">
                  <strong>提交已锁定，输入仍保留</strong>
                  <p>
                    {freshRead
                      ? '已读取最新安排。请比较当前安排、历史与所填内容，确认仍需调整后继续编辑。'
                      : '请先重新读取当前安排，确认刚才的请求是否已生效或被其他人修改。'}
                  </p>
                  {freshRead && (
                    <button
                      className="button button-secondary"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setLocked(false);
                        setFreshRead(false);
                        setError('');
                      }}
                    >
                      已核对最新安排，继续编辑
                    </button>
                  )}
                </div>
              )}
              <form className="sc-reschedule-form" onSubmit={review}>
                <div className="sc-reschedule-fields">
                  <label>
                    改期场地
                    <select
                      value={courtId}
                      disabled={Boolean(busy)}
                      onChange={(event) => {
                        setCourtId(event.target.value);
                        change();
                      }}
                    >
                      {!chosenCourt && (
                        <option value={courtId}>
                          {workspace.match.courtId === courtId
                            ? `${workspace.match.courtName}（当前不可选）`
                            : '请选择场地'}
                        </option>
                      )}
                      {allowedCourts.map((court) => (
                        <option key={court.id} value={court.id}>
                          {court.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    改期开赛时间（UTC+8）
                    <input
                      type="datetime-local"
                      step="0.001"
                      value={localStart}
                      disabled={Boolean(busy)}
                      onChange={(event) => {
                        setLocalStart(event.target.value);
                        change();
                      }}
                    />
                  </label>
                </div>
                <p className="sc-hint">
                  预计结束：{proposed ? timeLabel(proposed.endsAt) : '填写有效时间后计算'}（占用
                  {workspace.policy.slotDurationMinutes}分钟）
                </p>
                <label>
                  改期原因
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={reason}
                    disabled={Boolean(busy)}
                    onChange={(event) => {
                      setReason(event.target.value);
                      change();
                    }}
                  />
                </label>
                <div className="sc-actions">
                  <button
                    className="button button-primary"
                    disabled={Boolean(busy) || locked || !allowedCourts.length}
                  >
                    核对改期
                  </button>
                </div>
              </form>
              {confirmation && proposed && (
                <section className="sc-confirm sc-reschedule-confirm" aria-label="确认单场改期">
                  <h3>确认本场正式安排</h3>
                  <div className="sc-reschedule-comparison">
                    <Plan title="原安排" plan={workspace.match} />
                    <Plan title="拟调整为" plan={proposed} />
                  </div>
                  <p>改期原因：{confirmation.reason}</p>
                  <p>确认后保存改期记录，并重新检查场地、球队及休息冲突；原发布快照继续保留。</p>
                  <div className="sc-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={Boolean(busy)}
                      onClick={() => setConfirmation(undefined)}
                    >
                      返回修改
                    </button>
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={Boolean(busy) || locked}
                      onClick={() => void submit()}
                    >
                      {busy === 'submit' ? '正在提交…' : '确认改期'}
                    </button>
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="sc-note">
              <ShieldCheck size={18} />
              <p>
                当前场次或身份不允许改期。已开赛及赛果处理中的比赛不可调整；实际权限由服务核验。
              </p>
            </div>
          )}
          {conflicts.length > 0 && (
            <div className="sc-reschedule-conflicts" role="region" aria-label="改期冲突">
              <h3>请先修正以下冲突</h3>
              <ul>
                {conflicts.map((conflict, index) => (
                  <li key={`${conflict.code}:${index}`}>
                    <strong>{conflictTitles[conflict.code]}</strong>
                    {conflict.external && <p>同机构的其他正式安排已占用此资源。</p>}
                    <div className="sc-conflict-links">
                      {conflict.fixtureKeys.map((key) => (
                        <button
                          key={key}
                          className="button button-secondary"
                          onClick={() => onLocate(key)}
                        >
                          {key === match.fixtureKey ? '定位本场' : '定位相关场次'}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <section className="sc-reschedule-history" aria-label="本场改期历史">
            <h3>
              <History size={18} />
              本场改期历史
            </h3>
            {workspace.history.length ? (
              <ol>
                {workspace.history.map((record) => (
                  <li key={record.id}>
                    <p>
                      <strong>{timeLabel(record.createdAt)}</strong> · 比赛版本
                      {record.fromMatchVersion} → {record.toMatchVersion}
                    </p>
                    <div className="sc-reschedule-comparison">
                      <Plan title="改期前" plan={record.from} />
                      <Plan title="改期后" plan={record.to} />
                    </div>
                    <p className="sc-reschedule-reason">原因：{record.reason}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="sc-hint">本场暂无改期记录。</p>
            )}
            {workspace.historyTruncated && (
              <p className="sc-hint">
                这里只显示最近{workspace.historyLimit}条改期记录，较早历史仍保留。
              </p>
            )}
          </section>
        </>
      )}
      <div className="sc-actions">
        <button
          className="button button-secondary"
          disabled={Boolean(busy)}
          onClick={() => void read(Boolean(workspace))}
        >
          <RefreshCw size={16} />
          重新读取当前安排
        </button>
      </div>
    </section>
  );
}
