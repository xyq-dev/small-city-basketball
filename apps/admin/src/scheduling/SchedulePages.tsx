import { useCallback, useMemo, useState } from 'react';
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
import type { SchedulePolicy, ScheduledMatchData } from '@small-city-basketball/contracts';
import type { EventRepository } from '../domain/types';
import { EVENT_FORMAT_LABELS, EVENT_STATUS_LABELS } from '../domain/types';
import { ApiError } from '../api/client';
import { createSchedulingApi } from '../api/scheduling';
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
import { organizationContext, SchedulingAccessRequired, timeLabel } from './shared';

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
        description="从冻结名单生成单循环对阵，安排共享场地与时间，检查通过后正式发布。"
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
        当前支持2–32队单循环。分组淘汰和单淘汰暂不支持，不会自动更改赛事已有赛制。
      </p>
    </div>
  );
}
export function EventSchedulingPage({ context }: { context: RegistrationWorkspace }) {
  const { eventId = '', revisionId = '' } = useParams();
  return organizationContext(context) ? (
    <EventSchedulingContent
      key={`${eventId}:${revisionId}`}
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
      overview.publication && overview.capabilities.canReadMatches
        ? await api.matches(eventId)
        : [];
    return { overview, revision, courts: courts.data, matches };
  }, [api, eventId, revisionId]);
  const resource = useResource(read);
  const action = useAction();
  const [formOpen, setFormOpen] = useState<boolean | undefined>();
  async function generate(policy: SchedulePolicy, reason?: string) {
    const current = resource.data;
    if (!current?.overview.freeze) return;
    await action.run(
      async () => {
        await api.createRevision(eventId, {
          expectedEventVersion: current.overview.event.version,
          freezeId: current.overview.freeze!.id,
          algorithmVersion: 'RR_CIRCLE_V1',
          policy,
          ...(reason ? { redrawReason: reason } : {}),
        });
        if (action.isActive()) {
          setFormOpen(false);
          resource.reload();
        }
      },
      reason ? '新对阵已生成，上一版只读保留' : '单循环对阵已生成并保存',
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
            : '从已冻结参赛名单安排完整单循环，正式发布前逐项检查。'
        }
      >
        <button
          className="button button-secondary"
          disabled={action.busy}
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
                {!overview.freeze && overview.event.format === 'ROUND_ROBIN'
                  ? '请先冻结参赛名单'
                  : '当前赛事暂不支持排赛'}
              </h2>
              <p>{overview.support.reason || '当前仅支持2–32队单循环，请核对赛制与冻结名单。'}</p>
              {!overview.freeze && overview.event.format === 'ROUND_ROBIN' && (
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
          {published && overview.publication && revision?.id === overview.publication.revisionId ? (
            <>
              <section className="sc-publication-banner">
                <CheckCheck size={28} />
                <div>
                  <h2>正式赛程</h2>
                  <p>
                    已于{timeLabel(overview.publication.publishedAt)}正式发布 ·{' '}
                    {overview.publication.matchCount}
                    场比赛。此计划只读，当前不提供重新生成、重复发布或改期。
                  </p>
                </div>
              </section>
              <PolicySummary policy={revision.policy} courts={data.courts} />
              <PublishedMatches
                matches={data.matches}
                canRead={overview.capabilities.canReadMatches}
              />
            </>
          ) : revision && !showForm ? (
            <ScheduleEditor
              key={`${revision.id}:${revision.version}:${revision.eventVersion}`}
              revision={revision}
              courts={data.courts}
              api={api}
              action={action}
              onReload={resource.reload}
              published={published}
              historical={historical}
            />
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
              计划占用检查不保证实际比赛准时结束。当前未接入记分、赛果、公开观赛页面或直播导播。
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
}: {
  matches: ScheduledMatchData[];
  canRead: boolean;
}) {
  const [round, setRound] = useState('all');
  const rounds = [...new Set(matches.map((match) => match.roundNo))];
  return (
    <section className="panel sc-panel">
      <div className="section-heading">
        <div>
          <h2>正式比赛安排</h2>
          <p>球队名称、场地与开赛时间按发布时的版本保留。</p>
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
              <article key={match.id}>
                <span className="sc-match-round">
                  第{match.roundNo}轮 · 第{match.positionNo}场
                </span>
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
              </article>
            ))}
        </div>
      )}
    </section>
  );
}
