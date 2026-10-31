import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CalendarDays,
  CheckCheck,
  ChevronLeft,
  History,
  LockKeyhole,
  MapPin,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type {
  CourtData,
  SchedulePolicy,
  ScheduledMatchData,
  GroupKnockoutConfig,
} from '@small-city-basketball/contracts';
import type { EventRepository } from '../domain/types';
import { EVENT_FORMAT_LABELS, EVENT_STATUS_LABELS } from '../domain/types';
import { ApiError } from '../api/client';
import { createSchedulingApi } from '../api/scheduling';
import { createRegistrationApi } from '../api/registration';
import { createGroupKnockoutApi } from '../api/group-knockout';
import type { SchedulingApi } from '../api/scheduling';
import {
  ActionNotice,
  PageHeading,
  ResourceState,
  useAction,
  useResource,
} from '../registration/shared';
import type { RegistrationWorkspace } from '../registration/shared';
import { PolicyForm, PolicySummary } from './PolicyForm';
import { ScheduleEditor } from './ScheduleEditor';
import { Rescheduling } from './Rescheduling';
import {
  fixtureLabel,
  matchStatusLabels,
  organizationContext,
  SchedulingAccessRequired,
  timeLabel,
} from './shared';

export function SchedulingIndexPage({
  context,
  repository,
}: {
  context: RegistrationWorkspace;
  repository: EventRepository;
}) {
  return organizationContext(context) ? (
    <SchedulingIndex repository={repository} />
  ) : (
    <SchedulingAccessRequired />
  );
}
function SchedulingIndex({ repository }: { repository: EventRepository }) {
  const read = useCallback(() => repository.list(), [repository]);
  const resource = useResource(read);
  return (
    <div className="sc-page">
      <PageHeading
        eyebrow="MAKE ROOM FOR EVERY MATCH"
        title="抽签排赛"
        description="从冻结名单生成循环赛对阵或淘汰赛首轮，安排共享场地与时间，检查通过后正式发布。"
      >
        <Link className="button button-secondary" to="/courts">
          <MapPin size={17} />
          管理机构场地
        </Link>
      </PageHeading>
      <div className="sc-process">
        <span>01 冻结参赛名单</span>
        <span>02 生成完整对阵</span>
        <span>03 手工安排与检查</span>
        <span>04 一次正式发布</span>
      </div>
      {resource.loading || resource.error || !resource.data ? (
        <ResourceState {...resource} />
      ) : resource.data.length === 0 ? (
        <section className="panel sc-empty">
          <CalendarDays size={31} />
          <h2>暂无可见赛事</h2>
          <p>创建赛事并完成报名名单冻结后，即可在这里安排比赛。</p>
          <Link className="button button-secondary" to="/events">
            前往赛事管理
          </Link>
        </section>
      ) : (
        <div className="sc-event-grid">
          {resource.data.map((event) => (
            <Link
              className="panel sc-event-card"
              key={event.id}
              to={`/events/${event.id}/scheduling`}
            >
              <span className="status-badge neutral">{EVENT_STATUS_LABELS[event.status]}</span>
              <h2>{event.name}</h2>
              <p>
                {event.startDate} — {event.endDate}
              </p>
              <div>
                <span>{EVENT_FORMAT_LABELS[event.format]}</span>
                <strong>
                  {event.status === 'SCHEDULED' ? '查看正式赛程' : '进入排赛工作台'} →
                </strong>
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="sc-hint">
        支持2–32队单循环与单淘汰，以及2/4/8组组内循环接淘汰。淘汰阶段须逐轮独立确认并显式发布。
      </p>
    </div>
  );
}
export function EventSchedulingPage({ context }: { context: RegistrationWorkspace }) {
  const { eventId = '', revisionId = '' } = useParams();
  return organizationContext(context) ? (
    <EventSchedulingContent
      key={`${context.organizationId}:${eventId}:${revisionId}`}
      context={context}
      eventId={eventId}
      revisionId={revisionId}
    />
  ) : (
    <SchedulingAccessRequired />
  );
}
function EventSchedulingContent({
  context,
  eventId,
  revisionId,
}: {
  context: RegistrationWorkspace & { organizationId: string };
  eventId: string;
  revisionId: string;
}) {
  const api = useMemo(
    () => createSchedulingApi(context.client, context.organizationId),
    [context.client, context.organizationId],
  );
  const read = useCallback(async () => {
    const [initial, courts] = await Promise.all([api.scheduling(eventId), api.courts()]);
    let overview = initial;
    const selectedId = revisionId || overview.currentRevision?.id;
    const revision = selectedId ? await api.revision(selectedId) : null;
    if (revision && revision.eventId !== eventId)
      throw new ApiError(404, 'RESOURCE_NOT_FOUND', '这份历史排赛不属于当前赛事');
    if (revision && revision.eventVersion !== overview.event.version)
      overview = await api.scheduling(eventId);
    if (
      revision &&
      (revision.eventVersion !== overview.event.version ||
        (!revisionId && overview.currentRevision?.id !== revision.id))
    )
      throw new ApiError(409, 'VERSION_CONFLICT', '赛事资料刚刚发生变化，请重新读取以取得一致版本');
    const matches =
      !revisionId && overview.publication && overview.capabilities.canReadMatches
        ? await api.matches(eventId)
        : [];
    const registration =
      overview.event.format === 'GROUP_KNOCKOUT' && overview.freeze && !revision
        ? await createRegistrationApi(context.client, context.organizationId).registration(eventId)
        : null;
    if (registration && registration.freeze?.id !== overview.freeze?.id)
      throw new ApiError(409, 'VERSION_CONFLICT', '冻结名单已变化，请重新读取');
    const groupDraw =
      overview.event.format === 'GROUP_KNOCKOUT' && revision && !revisionId && !overview.publication
        ? await createGroupKnockoutApi(context.client, context.organizationId).event(eventId)
        : null;
    if (groupDraw && groupDraw.event.version !== overview.event.version)
      throw new ApiError(409, 'VERSION_CONFLICT', '分组资料已变化，请重新读取');
    return {
      overview,
      revision,
      courts: courts.data,
      matches,
      groupParticipants: revision?.participants ?? registration?.freeze?.entries ?? [],
      draftGroups: groupDraw?.draftGroups ?? [],
    };
  }, [api, eventId, revisionId, context.client, context.organizationId]);
  const resource = useResource(read);
  const action = useAction();
  const [formOpen, setFormOpen] = useState<boolean | undefined>();
  const [reschedulingOpen, setReschedulingOpen] = useState(false);
  async function generate(
    policy: SchedulePolicy,
    reason?: string,
    groupConfig?: GroupKnockoutConfig,
  ) {
    const current = resource.data;
    if (!current?.overview.freeze) return;
    await action.run(
      async () => {
        await api.createRevision(eventId, {
          expectedEventVersion: current.overview.event.version,
          freezeId: current.overview.freeze!.id,
          algorithmVersion:
            current.overview.event.format === 'GROUP_KNOCKOUT'
              ? 'GK_BALANCED_V1'
              : current.overview.event.format === 'SINGLE_ELIMINATION'
                ? 'SE_SEEDED_V1'
                : 'RR_CIRCLE_V1',
          policy,
          ...(groupConfig ? { groupConfig } : {}),
          ...(reason ? { redrawReason: reason } : {}),
        });
        if (action.isActive()) {
          setFormOpen(false);
          resource.reload();
        }
      },
      reason
        ? '新对阵已生成，上一版只读保留'
        : current.overview.event.format === 'GROUP_KNOCKOUT'
          ? '分组与组内循环对阵已生成并保存'
          : current.overview.event.format === 'SINGLE_ELIMINATION'
            ? '淘汰赛签位与首轮对阵已生成并保存'
            : '单循环对阵已生成并保存',
    );
  }
  const data = resource.data;
  const overview = data?.overview;
  const revision = data?.revision;
  const historical = Boolean(revisionId);
  const published = Boolean(overview?.publication);
  const mayGenerate = revision
    ? overview?.capabilities.canRedraw
    : overview?.capabilities.canGenerate;
  const showForm =
    !historical &&
    !published &&
    overview?.support.supported &&
    Boolean(overview.freeze) &&
    mayGenerate &&
    (formOpen ?? !revision);
  return (
    <div className="sc-page">
      <Link className="back-link" to={historical ? `/events/${eventId}/scheduling` : '/scheduling'}>
        <ChevronLeft size={16} />
        {historical ? '返回当前排赛' : '返回抽签排赛'}
      </Link>
      <PageHeading
        eyebrow={
          published
            ? 'THE OFFICIAL GAME PLAN'
            : historical
              ? 'PREVIOUS GAME PLAN'
              : 'ONE SEASON. EVERY MATCH.'
        }
        title={overview?.event.name ?? '赛事排赛'}
        description={
          historical
            ? '查看当时保存的对阵与时间安排，历史版本不可修改。'
            : overview?.event.format === 'GROUP_KNOCKOUT'
              ? '从冻结名单均衡分组，安排组内循环；全部独立确认后每组前二接固定交叉淘汰赛。'
              : overview?.event.format === 'SINGLE_ELIMINATION'
                ? '从冻结名单生成固定淘汰赛签位，先安排首轮实际比赛，再逐轮确认和发布。'
                : '从已冻结参赛名单安排完整单循环，正式发布前逐项检查。'
        }
      >
        <button
          className="button button-secondary"
          disabled={action.busy || reschedulingOpen}
          onClick={resource.reload}
        >
          <RefreshCw size={16} />
          重新读取资料
        </button>
      </PageHeading>
      <ActionNotice action={action} onReload={resource.reload} />
      {resource.loading || resource.error || !data || !overview ? (
        <ResourceState {...resource} />
      ) : (
        <>
          <section className="sc-event-overview">
            <div>
              <span className="status-badge blue">
                {EVENT_STATUS_LABELS[overview.event.status]}
              </span>
              <strong>
                {overview.freeze?.entryCount ?? 0}
                <small>支冻结球队</small>
              </strong>
              <span>
                {overview.event.startDate} — {overview.event.endDate}
              </span>
            </div>
            <p>
              {EVENT_FORMAT_LABELS[overview.event.format]} · 中国标准时间（UTC+8）
              {overview.freeze ? ` · 报名规则版本 ${overview.freeze.rulesetVersion}` : ''}
            </p>
          </section>
          {!overview.support.supported ? (
            <section className="panel sc-empty">
              <ShieldCheck size={30} />
              <h2>
                {!overview.freeze &&
                [
                  'ROUND_ROBIN',
                  'DOUBLE_ROUND_ROBIN',
                  'SINGLE_ELIMINATION',
                  'GROUP_KNOCKOUT',
                ].includes(overview.event.format)
                  ? '请先冻结参赛名单'
                  : '当前赛事暂不支持排赛'}
              </h2>
              <p>{overview.support.reason || '请核对赛制、冻结名单及每组至少2队的分组要求。'}</p>
              {!overview.freeze &&
                [
                  'ROUND_ROBIN',
                  'DOUBLE_ROUND_ROBIN',
                  'SINGLE_ELIMINATION',
                  'GROUP_KNOCKOUT',
                ].includes(overview.event.format) && (
                  <Link className="button button-secondary" to={`/events/${eventId}/registration`}>
                    前往报名审核
                  </Link>
                )}
            </section>
          ) : !overview.freeze ? (
            <section className="panel sc-empty">
              <LockKeyhole size={30} />
              <h2>请先冻结参赛名单</h2>
              <p>排赛只使用已经冻结的获批球队和名单，不能从长期成员资料直接生成。</p>
              <Link className="button button-secondary" to={`/events/${eventId}/registration`}>
                前往报名审核
              </Link>
            </section>
          ) : null}
          {overview.event.format === 'SINGLE_ELIMINATION' && (
            <section className="panel sc-panel">
              <h2>固定签位 · 逐轮确认晋级</h2>
              <p>
                首轮轮空不生成比赛。下一轮须待来源比赛全部有效独立确认，再核对并正式发布；不设三四名赛。
              </p>
              {published && (
                <Link className="button button-primary" to={`/events/${eventId}/knockout`}>
                  查看签位与发布下一轮
                </Link>
              )}
            </section>
          )}
          {overview.event.format === 'GROUP_KNOCKOUT' && (
            <section className="panel sc-panel">
              <h2>组内循环 · 前二固定交叉晋级</h2>
              <p>
                同分影响前二顺序或晋级截线时须独立保存抽签；全部组赛有效独立确认后显式发布淘汰首轮。同组球队只可在决赛重逢。
              </p>
              <Link className="button button-secondary" to={`/events/${eventId}/standings`}>
                设置组内积分规则
              </Link>
              {published && (
                <Link className="button button-primary" to={`/events/${eventId}/groups`}>
                  查看分组与发布晋级
                </Link>
              )}
            </section>
          )}
          {historical && revision && (
            <div className="sc-history-banner">
              <History size={20} />
              <div>
                <strong>
                  {revision.status === 'SUPERSEDED'
                    ? '历史工作稿 · 已由新版本替代'
                    : revision.status === 'PUBLISHED'
                      ? '正式发布版本 · 只读'
                      : '排赛记录 · 只读'}
                </strong>
                <p>
                  保存于{timeLabel(revision.createdAt)}
                  {revision.redrawReason ? ` · 重新生成原因：${revision.redrawReason}` : ''}
                </p>
              </div>
            </div>
          )}
          {!historical &&
            !published &&
            overview.support.supported &&
            overview.freeze &&
            data.courts.length === 0 && (
              <div className="sc-note">
                <MapPin size={20} />
                <p>
                  还没有共享场地。请先<Link to="/courts">管理机构场地</Link>，再设置时间窗口。
                </p>
              </div>
            )}
          {showForm && revision && (
            <div className="sc-note">
              <History size={18} />
              <p>正在准备新一版对阵。旧稿暂不提供检查和发布；取消后需重新检查原安排。</p>
            </div>
          )}
          {showForm && (
            <PolicyForm
              key={revision?.id ?? 'new'}
              courts={data.courts}
              initial={revision?.policy}
              knockout={overview.event.format === 'SINGLE_ELIMINATION'}
              {...(overview.event.format === 'GROUP_KNOCKOUT'
                ? {
                    groupOptions: {
                      participants: data.groupParticipants,
                      ...(revision?.groupConfig ? { initial: revision.groupConfig } : {}),
                    },
                  }
                : {})}
              redraw={Boolean(revision)}
              busy={action.busy}
              onSave={generate}
              onCancel={() => {
                setFormOpen(false);
                action.clear();
              }}
            />
          )}
          {!historical &&
            !published &&
            !showForm &&
            (overview.capabilities.canGenerate || overview.capabilities.canRedraw) && (
              <div className="sc-actions sc-generation-actions">
                <button
                  className="button button-secondary"
                  disabled={action.busy}
                  onClick={() => {
                    setFormOpen(true);
                    action.clear();
                  }}
                >
                  {revision ? '重新生成对阵' : '设置排赛规则'}
                </button>
                {revision && <p>重新生成会保留旧工作稿，但不会继承旧稿的场地和时间安排。</p>}
              </div>
            )}
          {!published &&
            !historical &&
            !overview.capabilities.canGenerate &&
            !overview.capabilities.canRedraw &&
            overview.freeze &&
            overview.support.supported && (
              <p className="sc-hint">
                当前身份没有生成或重新生成此赛事对阵的权限，赛事状态与实际工作人员授权由服务核验。
              </p>
            )}
          {!historical &&
          published &&
          overview.publication &&
          revision?.id === overview.publication.revisionId ? (
            <>
              <section className="sc-publication-banner">
                <CheckCheck size={28} />
                <div>
                  <h2>正式赛程</h2>
                  <p>
                    已于{timeLabel(overview.publication.publishedAt)}正式发布 ·{' '}
                    {overview.publication.matchCount}
                    场比赛。原发布快照保留；当前正式安排的改期通过独立记录追踪。
                  </p>
                </div>
              </section>
              <Link
                className="sc-original-plan-link"
                to={`/events/${eventId}/scheduling/history/${overview.publication.revisionId}`}
              >
                查看原始发布快照
              </Link>
              <PolicySummary policy={revision.policy} courts={data.courts} />
              <PublishedMatches
                matches={data.matches}
                canRead={overview.capabilities.canReadMatches}
                courts={data.courts}
                api={api}
                onActiveChange={setReschedulingOpen}
                onSaved={() =>
                  void action.run(async () => resource.reload(), '正式安排已更新，改期记录已保存')
                }
              />
            </>
          ) : revision && !showForm ? (
            <>
              {data.draftGroups.length > 0 && (
                <section className="panel sc-panel" aria-label="发布前分组核对">
                  <h2>已保存的固定分组</h2>
                  <p>
                    以下来自服务端保存的抽签种子和冻结名单；重新读取不会重新抽取。先核对组内名单，再安排和发布。
                  </p>
                  <div className="sc-event-grid">
                    {data.draftGroups.map((group) => (
                      <section key={group.groupKey}>
                        <h3>{group.label}</h3>
                        <ul>
                          {group.participants.map((p) => (
                            <li key={p.entryId}>{p.teamName}</li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </section>
              )}
              <ScheduleEditor
                key={`${revision.id}:${revision.version}:${revision.eventVersion}`}
                revision={revision}
                courts={data.courts}
                api={api}
                action={action}
                onReload={resource.reload}
                published={published}
                historical={historical}
                eventDates={overview.event}
              />
            </>
          ) : null}
          {revision?.previousRevisionId && (
            <div className="sc-history-link">
              <History size={18} />
              <div>
                <strong>对阵历史已保留</strong>
                <p>历史工作稿保留当时对阵、安排和重新生成原因。</p>
              </div>
              <Link
                className="button button-secondary"
                to={`/events/${eventId}/scheduling/history/${revision.previousRevisionId}`}
              >
                查看上一版
              </Link>
            </div>
          )}
          <div className="sc-note">
            <ShieldCheck size={18} />
            <p>
              计划占用检查不保证实际比赛准时结束。记分和赛果在独立工作台处理，公开观赛与比分包装使用同一比赛事实；实际直播导播另行验收。
            </p>
          </div>
        </>
      )}
    </div>
  );
}
function PublishedMatches({
  matches,
  canRead,
  courts,
  api,
  onSaved,
  onActiveChange,
}: {
  matches: ScheduledMatchData[];
  canRead: boolean;
  courts: CourtData[];
  api: SchedulingApi;
  onSaved: () => void;
  onActiveChange: (active: boolean) => void;
}) {
  const [round, setRound] = useState('all');
  const [selectedId, setSelectedId] = useState<string>();
  const cards = useRef<Record<string, HTMLElement | null>>({});
  const selected = matches.find((match) => match.id === selectedId);
  const rounds = [...new Set(matches.map((match) => match.roundNo))];
  function locate(key: string) {
    const match = matches.find((match) => match.fixtureKey === key);
    if (!match) return;
    setRound(String(match.roundNo));
    window.requestAnimationFrame(() => {
      cards.current[key]?.scrollIntoView?.({ block: 'center' });
      cards.current[key]?.focus({ preventScroll: true });
    });
  }
  return (
    <>
      <section className="panel sc-panel">
        <div className="section-heading">
          <div>
            <h2>正式比赛安排</h2>
            <p>这里显示当前正式安排；原始发布快照与每次改期记录分别保留。</p>
          </div>
          {matches.length > 0 && (
            <label className="sc-round-select">
              查看正式轮次
              <select value={round} onChange={(event) => setRound(event.target.value)}>
                <option value="all">全部轮次</option>
                {rounds.map((value) => (
                  <option key={value} value={String(value)}>
                    第{value}轮
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {!canRead ? (
          <p className="sc-hint">当前身份没有正式比赛读取权限。</p>
        ) : matches.length === 0 ? (
          <p className="sc-hint">当前没有读取到正式比赛，请重新读取资料。</p>
        ) : (
          <div className="sc-published-list">
            {matches
              .filter((match) => round === 'all' || String(match.roundNo) === round)
              .map((match) => (
                <article
                  key={match.id}
                  tabIndex={-1}
                  ref={(node) => {
                    cards.current[match.fixtureKey] = node;
                  }}
                >
                  <span className="sc-match-round">
                    第{match.roundNo}轮 · 第{match.positionNo}场
                  </span>
                  <span className="status-badge neutral">{matchStatusLabels[match.status]}</span>
                  <div className="sc-matchup">
                    <strong>{match.home.teamName}</strong>
                    <span>VS</span>
                    <strong>{match.away.teamName}</strong>
                  </div>
                  <div className="sc-match-venue">
                    <MapPin size={16} />
                    <strong>{match.courtName}</strong>
                    <span>
                      {timeLabel(match.startsAt)} — {timeLabel(match.endsAt)}
                    </span>
                  </div>
                  <div className="sc-published-actions">
                    <Link to={`/matches/${match.id}/scoring`}>记分与赛果 →</Link>
                    <button
                      className="button button-secondary"
                      aria-label={`${fixtureLabel(match)} 改期与记录`}
                      disabled={Boolean(selectedId) && selectedId !== match.id}
                      onClick={() => {
                        setSelectedId(match.id);
                        onActiveChange(true);
                      }}
                    >
                      改期与记录
                    </button>
                  </div>
                </article>
              ))}
          </div>
        )}
      </section>
      {selected && (
        <Rescheduling
          key={selected.id}
          match={selected}
          courts={courts}
          api={api}
          onSaved={() => {
            setSelectedId(undefined);
            onActiveChange(false);
            onSaved();
          }}
          onLocate={locate}
          onClose={() => {
            setSelectedId(undefined);
            onActiveChange(false);
            cards.current[selected.fixtureKey]?.querySelector<HTMLButtonElement>('button')?.focus();
          }}
        />
      )}
    </>
  );
}
