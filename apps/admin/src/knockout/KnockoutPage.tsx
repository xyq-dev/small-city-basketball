import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  CourtData,
  EventKnockoutData,
  PublishKnockoutRoundInput,
} from '@small-city-basketball/contracts';
import { ApiError } from '../api/client';
import { createKnockoutApi } from '../api/knockout';
import { createSchedulingApi } from '../api/scheduling';
import type { RegistrationWorkspace } from '../registration/shared';
import {
  ActionNotice,
  message,
  PageHeading,
  ResourceState,
  useAction,
} from '../registration/shared';
import {
  fixtureLabel,
  offsetTime,
  organizationContext,
  SchedulingAccessRequired,
  timeLabel,
} from '../scheduling/shared';
import { Modal } from '../scoring/Dialogs';
import { Bracket } from './Bracket';
import './knockout.css';

type Allocation = { courtId: string; localStart: string };
export function EventKnockoutPage({ context }: { context: RegistrationWorkspace }) {
  const { eventId = '' } = useParams();
  return organizationContext(context) ? (
    <KnockoutPage
      key={`${context.organizationId}:${eventId}`}
      context={context}
      eventId={eventId}
    />
  ) : (
    <SchedulingAccessRequired />
  );
}
function KnockoutPage({
  context,
  eventId,
}: {
  context: RegistrationWorkspace & { organizationId: string };
  eventId: string;
}) {
  const api = useMemo(
    () => createKnockoutApi(context.client, context.organizationId),
    [context.client, context.organizationId],
  );
  const scheduling = useMemo(
    () => createSchedulingApi(context.client, context.organizationId),
    [context.client, context.organizationId],
  );
  const [data, setData] = useState<EventKnockoutData>();
  const [courts, setCourts] = useState<CourtData[]>([]);
  const [loading, setLoading] = useState(true),
    [readError, setReadError] = useState('');
  const [allocations, setAllocations] = useState<Record<string, Allocation>>({});
  const [reason, setReason] = useState(''),
    [validation, setValidation] = useState('');
  const [decision, setDecision] = useState<PublishKnockoutRoundInput | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const action = useAction();
  const alive = useRef(true),
    generation = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    setLoading(true);
    setReadError('');
    setDecision(null);
    try {
      const [next, courtResult] = await Promise.all([api.event(eventId), scheduling.courts()]);
      if (!alive.current || ticket !== generation.current) return;
      setData(next);
      setCourts(courtResult.data);
      const fixtures = next.bracket?.nextRound?.fixtures ?? [];
      setAllocations((previous) =>
        Object.fromEntries(
          fixtures.map((f) => [
            f.fixtureKey,
            previous[f.fixtureKey] ?? { courtId: '', localStart: '' },
          ]),
        ),
      );
      setNeedsRefresh(false);
    } catch (cause) {
      if (alive.current && ticket === generation.current) setReadError(message(cause));
    } finally {
      if (alive.current && ticket === generation.current) setLoading(false);
    }
  }, [api, scheduling, eventId]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      ++generation.current;
    };
  }, [refresh]);
  function reload() {
    if (action.busy) return;
    action.clear();
    setValidation('');
    void refresh();
  }
  function review(event: FormEvent) {
    event.preventDefault();
    if (
      action.busy ||
      needsRefresh ||
      loading ||
      readError ||
      !data?.capabilities.canPublishNextRound ||
      !data.bracket?.nextRound
    )
      return;
    const current = data.bracket.nextRound;
    try {
      const trimmed = reason.trim();
      if (Array.from(trimmed).length < 4 || Array.from(trimmed).length > 500)
        throw new Error('请填写4–500字的晋级发布原因');
      const values = current.fixtures.map((f) => {
        const entry = allocations[f.fixtureKey];
        if (!entry?.courtId || !entry.localStart)
          throw new Error(`${fixtureLabel(f)}需同时填写场地和开始时间`);
        if (!courts.some((c) => c.id === entry.courtId && c.status === 'ACTIVE'))
          throw new Error(`${fixtureLabel(f)}请选择当前可用场地`);
        return {
          fixtureKey: f.fixtureKey,
          courtId: entry.courtId,
          startsAt: offsetTime(entry.localStart),
        };
      });
      setValidation('');
      setDecision({
        type: 'PUBLISH_ROUND',
        expectedEventVersion: data.event.version,
        expectedSourceHash: current.sourceHash,
        roundNo: current.roundNo,
        reason: trimmed,
        allocations: values,
      });
    } catch (cause) {
      setValidation(message(cause));
    }
  }
  async function publish() {
    if (!decision || action.busy || needsRefresh) return;
    const pinned = decision;
    await action.run(async () => {
      try {
        const result = await api.publish(eventId, pinned);
        if (!alive.current) return;
        ++generation.current;
        setData(result);
        setLoading(false);
        setReadError('');
        setDecision(null);
        setReason('');
        setAllocations({});
      } catch (cause) {
        if (alive.current && cause instanceof ApiError && cause.status === 409)
          setNeedsRefresh(true);
        throw cause;
      }
    }, '下一轮已正式发布；旧实时观赛授权已撤销，请重新显式启用公开观赛');
  }
  const next = data?.bracket?.nextRound;
  const names = new Map(data?.participants.map((p) => [p.entryId, p.teamName]) ?? []);
  const disabled = action.busy || loading || Boolean(readError) || needsRefresh;
  return (
    <div className="view-page">
      <Link className="back-link" to={`/events/${encodeURIComponent(eventId)}/scheduling`}>
        <ChevronLeft size={16} />
        返回赛事排赛
      </Link>
      <PageHeading
        eyebrow="CONFIRMED WINNERS. CONTROLLED ADVANCEMENT."
        title={data?.event.name ?? '淘汰赛晋级'}
        description="从固定签位和当前有效独立确认赛果推进下一轮，正式发布前核对场地与休息安排。"
      >
        <button
          className="button button-secondary"
          disabled={action.busy || loading}
          onClick={reload}
        >
          <RefreshCw size={16} />
          刷新晋级资料
        </button>
      </PageHeading>
      <ActionNotice action={action} onReload={reload} />
      {readError && data && (
        <div role="alert" className="view-note error">
          {readError} 上次资料仍在，恢复后重新读取并核对。
        </div>
      )}
      {needsRefresh && (
        <div className="view-note warning" role="alert">
          赛果、来源或赛程已变化。本地安排和原因已保留；请关闭确认框并刷新晋级资料，核对后重新确认，不会自动重放发布。
        </div>
      )}
      {!data ? (
        <ResourceState loading={loading} error={readError} reload={reload} />
      ) : (
        <>
          <section className="panel view-panel">
            <h2>单淘汰赛规则</h2>
            <p>2–32队 · 平局进入加时 · 首轮轮空不生成比赛 · 不设三四名赛。</p>
            <p>
              仅当前有效独立确认决定晋级。下一轮一经正式发布，来源赛果不再允许重开；未发布下游前，更正仍需重开及独立重新确认。
            </p>
            <div className="view-actions">
              <Link
                className="button button-secondary"
                to={`/events/${encodeURIComponent(eventId)}/standings`}
              >
                管理公开观赛
              </Link>
              <Link
                className="button button-secondary"
                to={`/events/${encodeURIComponent(eventId)}/lifecycle`}
              >
                整届完赛与归档
              </Link>
            </div>
          </section>
          {!data.bracket ? (
            <section className="panel view-panel">
              <h2>尚未发布首轮比赛</h2>
              <p>请先从冻结参赛名单生成签位，核对并发布首轮实际比赛。</p>
              <Link
                className="button button-primary"
                to={`/events/${encodeURIComponent(eventId)}/scheduling`}
              >
                安排并发布首轮
              </Link>
            </section>
          ) : (
            <>
              <section className="panel view-panel ko-summary" aria-label="晋级进度">
                <span>
                  <strong>{data.bracket.participantCount}</strong>支参赛队
                </span>
                <span>
                  <strong>
                    {data.bracket.publishedMatchCount} / {data.bracket.totalMatchCount}
                  </strong>
                  场正式发布
                </span>
                <span>
                  <strong>{data.bracket.confirmedMatchCount}</strong>场有效独立确认
                </span>
              </section>
              <Bracket bracket={data.bracket} participants={data.participants} />
              {next && data.capabilities.canPublishNextRound ? (
                <section className="panel view-panel" aria-label="下一轮发布安排">
                  <h2>安排第{next.roundNo}轮</h2>
                  <p>
                    晋级来源已独立确认。填写本轮全部比赛的场地和时间；发布时服务端重新校验来源、休息间隔及共享场地冲突。时间为中国标准时间（UTC+8）。
                  </p>
                  <form className="score-form" onSubmit={review} noValidate>
                    {next.fixtures.map((fixture) => {
                      const entry = allocations[fixture.fixtureKey] ?? {
                        courtId: '',
                        localStart: '',
                      };
                      const label = fixtureLabel(fixture);
                      return (
                        <div className="ko-allocation" key={fixture.fixtureKey}>
                          <h3>
                            {label} · {names.get(fixture.homeEntryId)} VS{' '}
                            {names.get(fixture.awayEntryId)}
                          </h3>
                          <div className="score-fields">
                            <label className="score-field">
                              {label} 场地
                              <select
                                aria-label={`${label} 场地`}
                                disabled={action.busy}
                                value={entry.courtId}
                                onChange={(e) =>
                                  setAllocations((previous) => ({
                                    ...previous,
                                    [fixture.fixtureKey]: { ...entry, courtId: e.target.value },
                                  }))
                                }
                              >
                                <option value="">请选择场地</option>
                                {courts.map((court) => (
                                  <option
                                    key={court.id}
                                    value={court.id}
                                    disabled={court.status !== 'ACTIVE'}
                                  >
                                    {court.name}
                                    {court.status !== 'ACTIVE' ? '（已停用）' : ''}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="score-field">
                              {label} 开始时间
                              <input
                                aria-label={`${label} 开始时间`}
                                type="datetime-local"
                                step="0.001"
                                value={entry.localStart}
                                disabled={action.busy}
                                onChange={(e) =>
                                  setAllocations((previous) => ({
                                    ...previous,
                                    [fixture.fixtureKey]: { ...entry, localStart: e.target.value },
                                  }))
                                }
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                    <label className="score-field">
                      晋级发布原因
                      <textarea
                        aria-label="晋级发布原因"
                        value={reason}
                        maxLength={1000}
                        disabled={action.busy}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <div className="view-note warning">
                      <ShieldCheck size={18} />
                      <p>
                        发布会永久撤销现有实时观赛链接；请在发布后重新显式启用公开观赛。独立OBS授权继续按原期限与撤销规则管理。
                      </p>
                    </div>
                    {validation && <p role="alert">{validation}</p>}
                    <button className="button button-primary" disabled={disabled} type="submit">
                      核对并发布下一轮
                    </button>
                  </form>
                </section>
              ) : (
                !data.bracket.isComplete && (
                  <section className="panel view-panel">
                    <h2>{next ? '下一轮已具备发布来源' : '等待独立确认与晋级'}</h2>
                    <p>
                      {next
                        ? '当前身份没有发布下一轮的权限，请联系赛事负责人。'
                        : '上一轮全部真实比赛须有效独立确认后，才能安排并显式发布下一轮。轮空不需要虚构赛果。'}
                    </p>
                  </section>
                )
              )}
            </>
          )}
        </>
      )}
      {decision && (
        <Modal title="发布下一轮" busy={action.busy} onClose={() => setDecision(null)}>
          <p>
            即将正式发布第{decision.roundNo}轮共{decision.allocations.length}场比赛，核对版本 v
            {decision.expectedEventVersion}。本次将锁定来源晋级结果并撤销现有实时观赛链接。
          </p>
          <ul className="ko-confirmation-plans" aria-label="本次发布安排">
            {decision.allocations.map((allocation) => {
              const fixture = next?.fixtures.find((f) => f.fixtureKey === allocation.fixtureKey);
              return (
                <li key={allocation.fixtureKey}>
                  <strong>
                    {fixture
                      ? `${fixtureLabel(fixture)} · ${names.get(fixture.homeEntryId)} VS ${names.get(fixture.awayEntryId)}`
                      : allocation.fixtureKey}
                  </strong>
                  <p>
                    {courts.find((court) => court.id === allocation.courtId)?.name ?? '已选场地'} ·{' '}
                    {timeLabel(allocation.startsAt)} · 中国标准时间
                  </p>
                </li>
              );
            })}
          </ul>
          <p>发布原因：{decision.reason}</p>
          {action.error && (
            <p role="alert">{action.error} 请关闭后重新读取资料，核对保留的安排再操作。</p>
          )}
          <div className="view-actions">
            <button
              className="button button-primary"
              disabled={action.busy || needsRefresh}
              onClick={() => void publish()}
            >
              确认发布下一轮
            </button>
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() => setDecision(null)}
            >
              取消
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
