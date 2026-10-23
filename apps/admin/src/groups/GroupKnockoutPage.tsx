import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  CourtData,
  DrawGroupTieInput,
  EventGroupKnockoutData,
  PublishGroupQualificationInput,
  PublishKnockoutRoundInput,
} from '@small-city-basketball/contracts';
import { RefreshCw } from 'lucide-react';
import { ApiError } from '../api/client';
import { createGroupKnockoutApi } from '../api/group-knockout';
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
import { GroupTables } from './GroupTables';

type Command = DrawGroupTieInput | PublishGroupQualificationInput | PublishKnockoutRoundInput;
type Allocation = { courtId: string; localStart: string };
export function EventGroupKnockoutPage({ context }: { context: RegistrationWorkspace }) {
  const { eventId = '' } = useParams();
  return organizationContext(context) ? (
    <GroupPage key={`${context.organizationId}:${eventId}`} context={context} eventId={eventId} />
  ) : (
    <SchedulingAccessRequired />
  );
}
function GroupPage({
  context,
  eventId,
}: {
  context: RegistrationWorkspace & { organizationId: string };
  eventId: string;
}) {
  const api = useMemo(
    () => createGroupKnockoutApi(context.client, context.organizationId),
    [context.client, context.organizationId],
  );
  const scheduling = useMemo(
    () => createSchedulingApi(context.client, context.organizationId),
    [context.client, context.organizationId],
  );
  const [data, setData] = useState<EventGroupKnockoutData>();
  const [courts, setCourts] = useState<CourtData[]>([]);
  const [loading, setLoading] = useState(true),
    [readError, setReadError] = useState('');
  const [allocations, setAllocations] = useState<Record<string, Allocation>>({});
  const [reason, setReason] = useState(''),
    [tieReasons, setTieReasons] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState(''),
    [needsRefresh, setNeedsRefresh] = useState(false);
  const [decision, setDecision] = useState<Command | null>(null);
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
      setAllocations((previous) =>
        Object.fromEntries(
          (next.competition?.nextRound?.fixtures ?? []).map((f) => [
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
  function checkedReason(value: string) {
    const v = value.trim();
    if (Array.from(v).length < 4 || Array.from(v).length > 500)
      throw new Error('请填写4–500字的操作原因');
    return v;
  }
  const competition = data?.competition,
    next = competition?.nextRound;
  const disabled = action.busy || loading || Boolean(readError) || needsRefresh;
  const qualification = competition?.qualification.status === 'READY';
  const canPublish = qualification
    ? data?.capabilities.canPublishQualification
    : data?.capabilities.canPublishNextRound;
  const names = new Map(
    competition?.groups.flatMap((g) =>
      g.participants.map((p) => [p.entryId, p.teamName] as const),
    ) ?? [],
  );
  function review(event: FormEvent) {
    event.preventDefault();
    if (disabled || !data || !competition || !next || !canPublish) return;
    try {
      const values = next.fixtures.map((f) => {
        const a = allocations[f.fixtureKey];
        if (!a?.courtId || !a.localStart)
          throw new Error(`${fixtureLabel(f)}需同时填写场地和开始时间`);
        if (!courts.some((c) => c.id === a.courtId && c.status === 'ACTIVE'))
          throw new Error(`${fixtureLabel(f)}请选择当前可用场地`);
        return { fixtureKey: f.fixtureKey, courtId: a.courtId, startsAt: offsetTime(a.localStart) };
      });
      const common = {
        expectedEventVersion: data.event.version,
        expectedSourceHash: qualification ? competition.qualification.sourceHash : next.sourceHash,
        reason: checkedReason(reason),
        allocations: values,
      };
      setDecision(
        qualification
          ? { type: 'PUBLISH_QUALIFICATION', ...common }
          : { type: 'PUBLISH_ROUND', roundNo: next.roundNo, ...common },
      );
      setValidation('');
    } catch (cause) {
      setValidation(message(cause));
    }
  }
  function reviewDraw(groupKey: string) {
    if (disabled || !data?.capabilities.canDrawTies || !competition) return;
    const group = competition.groups.find((g) => g.groupKey === groupKey);
    if (!group?.unresolvedTieEntryIds.length || group.draw) return;
    try {
      setDecision({
        type: 'DRAW_GROUP_TIE',
        expectedEventVersion: data.event.version,
        expectedSourceHash: group.standings.sourceHash,
        groupKey,
        reason: checkedReason(tieReasons[groupKey] ?? ''),
      });
      setValidation('');
    } catch (cause) {
      setValidation(message(cause));
    }
  }
  async function submit() {
    if (!decision || disabled) return;
    const pinned = decision;
    await action.run(
      async () => {
        try {
          const result = await api.command(eventId, pinned);
          if (!alive.current) return;
          ++generation.current;
          setData(result);
          setDecision(null);
          setReadError('');
          setLoading(false);
          if (pinned.type !== 'DRAW_GROUP_TIE') {
            setReason('');
            setAllocations({});
          }
        } catch (cause) {
          if (alive.current && cause instanceof ApiError && cause.status === 409)
            setNeedsRefresh(true);
          throw cause;
        }
      },
      pinned.type === 'DRAW_GROUP_TIE'
        ? '同分抽签已独立保存；后续发布失败不会重新抽取'
        : '晋级赛程已正式发布，旧实时观赛链接已撤销，请重新显式启用',
    );
  }
  return (
    <div className="view-page">
      <Link className="back-link" to={`/events/${encodeURIComponent(eventId)}/scheduling`}>
        返回赛事排赛
      </Link>
      <PageHeading
        eyebrow="GROUP RESULTS. FIXED CROSSOVER."
        title={data?.event.name ?? '分组与淘汰晋级'}
        description="从原组赛独立确认确定每组前二，以固定交叉签位衔接淘汰赛；不建立第二套赛果。"
      >
        <button
          className="button button-secondary"
          disabled={action.busy || loading}
          onClick={reload}
        >
          <RefreshCw size={16} />
          重新读取分组资料
        </button>
      </PageHeading>
      <ActionNotice action={action} onReload={reload} />
      {readError && data && <p role="alert">{readError} 上次资料保留，请重新读取后再操作。</p>}
      {!data ? (
        <ResourceState loading={loading} error={readError} reload={reload} />
      ) : !competition ? (
        <section className="panel view-empty">
          <h2>尚无分组对阵</h2>
          <p>先冻结参赛名单并生成分组循环对阵。</p>
          <Link to={`/events/${encodeURIComponent(eventId)}/scheduling`}>进入排赛工作台</Link>
        </section>
      ) : (
        <>
          <section className="panel view-panel">
            <h2>晋级进度</h2>
            <p>
              {competition.confirmedMatchCount} / {competition.totalMatchCount}场有效独立确认 ·{' '}
              {competition.publishedMatchCount}场已发布
            </p>
            <p>
              资格首轮及每个后轮均须显式发布。已被晋级采用的组赛和淘汰赛赛果不得重开；场地与休息间隔在服务端重新检查。
            </p>
            <Link to={`/events/${encodeURIComponent(eventId)}/standings`}>
              配置组内积分规则与公开观赛授权
            </Link>
          </section>
          <GroupTables competition={competition} />
          {competition.qualification.status === 'TIE_BREAK_REQUIRED' && (
            <section className="panel view-panel" aria-label="独立同分抽签">
              <h2>独立保存同分抽签</h2>
              <p>
                全部组赛已有效确认，但前二顺序或晋级截线仍同分。抽签只保存一次，不与后续场地发布事务混合重抽。
              </p>
              {competition.groups
                .filter((g) => g.unresolvedTieEntryIds.length && !g.draw)
                .map((g) => (
                  <div key={g.groupKey}>
                    <h3>{g.label}</h3>
                    <p>同分球队：{g.unresolvedTieEntryIds.map((id) => names.get(id)).join('、')}</p>
                    <label className="score-field">
                      {g.label}抽签原因
                      <textarea
                        aria-label={`${g.label}抽签原因`}
                        value={tieReasons[g.groupKey] ?? ''}
                        maxLength={500}
                        disabled={disabled || !data.capabilities.canDrawTies}
                        onChange={(e) =>
                          setTieReasons((previous) => ({
                            ...previous,
                            [g.groupKey]: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <button
                      className="button button-secondary"
                      disabled={disabled || !data.capabilities.canDrawTies}
                      onClick={() => reviewDraw(g.groupKey)}
                    >
                      核对并保存{g.label}抽签
                    </button>
                  </div>
                ))}
            </section>
          )}
          {next && canPublish ? (
            <section className="panel view-panel" aria-label="分组晋级发布安排">
              <h2>{qualification ? '固定交叉淘汰首轮' : `淘汰阶段第${next.roundNo}轮`}</h2>
              <p>
                {qualification
                  ? '固定交叉为A1–B2、C1–D2…与B1–A2、D1–C2…分居两个半区，同组队仅可在决赛重逢。'
                  : '上一轮来源已有效独立确认。'}
                时间使用中国标准时间（UTC+8）。
              </p>
              <form className="score-form" onSubmit={review} noValidate>
                {next.fixtures.map((f) => {
                  const a = allocations[f.fixtureKey] ?? { courtId: '', localStart: '' };
                  const label = fixtureLabel(f);
                  return (
                    <div className="ko-allocation" key={f.fixtureKey}>
                      <h3>
                        {label} · {names.get(f.homeEntryId)} VS {names.get(f.awayEntryId)}
                      </h3>
                      <div className="score-fields">
                        <label className="score-field">
                          {label}场地
                          <select
                            aria-label={`${label}场地`}
                            value={a.courtId}
                            disabled={disabled}
                            onChange={(e) =>
                              setAllocations((previous) => ({
                                ...previous,
                                [f.fixtureKey]: { ...a, courtId: e.target.value },
                              }))
                            }
                          >
                            <option value="">请选择场地</option>
                            {courts.map((c) => (
                              <option key={c.id} value={c.id} disabled={c.status !== 'ACTIVE'}>
                                {c.name}
                                {c.status !== 'ACTIVE' ? '（已停用）' : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="score-field">
                          {label}开始时间
                          <input
                            aria-label={`${label}开始时间`}
                            type="datetime-local"
                            step="0.001"
                            value={a.localStart}
                            disabled={disabled}
                            onChange={(e) =>
                              setAllocations((previous) => ({
                                ...previous,
                                [f.fixtureKey]: { ...a, localStart: e.target.value },
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
                    maxLength={500}
                    value={reason}
                    disabled={disabled}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <p>
                  发布会永久撤销现有实时观赛链接，之后须显式创建新链接；独立OBS授权继续按原规则管理。
                </p>
                <button className="button button-primary" disabled={disabled} type="submit">
                  {qualification ? '核对并发布淘汰首轮' : '核对并发布下一轮'}
                </button>
              </form>
            </section>
          ) : (
            !competition.isComplete && (
              <section className="panel view-panel">
                <h2>
                  {competition.qualification.status === 'WAITING'
                    ? '等待全部组赛有效独立确认'
                    : next
                      ? '当前身份没有晋级发布权限'
                      : competition.qualification.status === 'TIE_BREAK_REQUIRED'
                        ? '等待独立同分抽签'
                        : '等待淘汰赛来源确认'}
                </h2>
                <p>不使用未确认比分或客户端估算结果提前晋级。</p>
              </section>
            )
          )}
        </>
      )}
      {validation && <p role="alert">{validation}</p>}
      {decision && (
        <Modal
          title={decision.type === 'DRAW_GROUP_TIE' ? '保存独立同分抽签' : '正式发布晋级赛程'}
          busy={action.busy}
          onClose={() => setDecision(null)}
        >
          <p>本次核对赛事版本 v{decision.expectedEventVersion}。</p>
          {decision.type === 'DRAW_GROUP_TIE' ? (
            <p>将对{decision.groupKey}组保存一次可审计抽签，不能因之后安排冲突重复抽取。</p>
          ) : (
            <>
              <p>即将正式发布{decision.allocations.length}场比赛，锁定来源并撤销旧实时观赛链接。</p>
              <ul aria-label="本次分组晋级安排">
                {decision.allocations.map((a) => {
                  const f = next?.fixtures.find((f) => f.fixtureKey === a.fixtureKey);
                  return (
                    <li key={a.fixtureKey}>
                      {f && (
                        <strong>
                          {names.get(f.homeEntryId)} VS {names.get(f.awayEntryId)}
                        </strong>
                      )}
                      <p>
                        {courts.find((c) => c.id === a.courtId)?.name} · {timeLabel(a.startsAt)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <p>操作原因：{decision.reason}</p>
          {action.error && <p role="alert">{action.error} 请关闭后重新读取，核对保留的安排。</p>}
          <div className="view-actions">
            <button
              className="button button-primary"
              disabled={disabled}
              onClick={() => void submit()}
            >
              {decision.type === 'DRAW_GROUP_TIE' ? '确认保存抽签' : '确认正式发布'}
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
