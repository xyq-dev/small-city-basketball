import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ClipboardCheck, RefreshCw, ShieldCheck, Trophy } from 'lucide-react';
import type { ScoringMatchSummary } from '@small-city-basketball/contracts';
import { createScoringApi } from '../api/scoring';
import type { RegistrationWorkspace } from '../registration/shared';
import {
  ActionNotice,
  PageHeading,
  ResourceState,
  useAction,
  useResource,
} from '../registration/shared';
import {
  scoringOrganization,
  ScoringAccessRequired,
  localMoment,
  matchStatusLabels,
} from './shared';
import { RulesForm } from './Management';
import { MatchWorkbench } from './Workbench';
import { MediaPanel } from '../media/MediaPanels';
export function ScoringIndexPage({ context }: { context: RegistrationWorkspace }) {
  return scoringOrganization(context) ? (
    <ScoringIndex key={context.organizationId} context={context} />
  ) : (
    <ScoringAccessRequired />
  );
}
function ScoringIndex({
  context,
}: {
  context: RegistrationWorkspace & { organizationId: string };
}) {
  const api = useMemo(
    () => createScoringApi(context.client, context.organizationId),
    [context.client, context.organizationId],
  );
  const read = useCallback(() => api.matches(), [api]);
  const resource = useResource(read);
  const [filter, setFilter] = useState('ALL');
  const matches = resource.data?.filter((match) => filter === 'ALL' || match.status === filter);
  return (
    <div className="score-page">
      <PageHeading
        eyebrow="EVERY POINT HAS A RECORD"
        title="记分与赛果"
        description="只展示当前身份有权查看的场次。先明确规则和人员，再由持有控制权的记分员在线记录。"
      >
        <button className="button button-secondary" onClick={resource.reload}>
          <RefreshCw size={16} />
          刷新比赛列表
        </button>
      </PageHeading>
      <div className="score-note">
        <ShieldCheck size={19} />
        <p>服务端确认后才更新比分。当前为私有在线工作台，未接入公开观赛、正式榜单或OBS。</p>
      </div>
      <div className="score-toolbar">
        <span className="score-muted">
          {resource.data ? `共 ${resource.data.length} 场可见比赛` : '正在读取比赛'}
        </span>
        <label className="score-field">
          筛选比赛状态
          <select
            aria-label="筛选比赛状态"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="ALL">全部状态</option>
            {Object.entries(matchStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {resource.loading || resource.error || !resource.data ? (
        <ResourceState {...resource} />
      ) : !matches?.length ? (
        <section className="panel score-empty">
          <Trophy size={30} />
          <h2>暂无符合条件的比赛</h2>
          <p>
            正式发布赛程后，管理员分配本场人员即可开展记分。仅场次授权的工作人员只会看到自己的比赛。
          </p>
        </section>
      ) : (
        <div className="score-match-list">
          {matches.map((match) => (
            <MatchCard key={match.matchId} match={match} />
          ))}
        </div>
      )}
    </div>
  );
}
function MatchCard({ match }: { match: ScoringMatchSummary }) {
  return (
    <article className="panel score-match-card">
      <span
        className={`status-badge ${match.status === 'LIVE' ? 'blue' : match.status === 'FINAL' ? 'green' : 'neutral'}`}
      >
        {match.adjudication
          ? match.adjudication.kind === 'FORFEIT'
            ? '弃权裁定'
            : '本场取消'
          : (matchStatusLabels[match.status] ?? match.status)}
      </span>
      <p>{match.eventName}</p>
      <h2>
        {match.homeTeamName} <span className="score-muted">VS</span> {match.awayTeamName}
      </h2>
      <p>
        {match.courtName} · {localMoment(match.startsAt)}
      </p>
      {match.score && !match.adjudication && (
        <strong>
          {match.score.home} : {match.score.away}
        </strong>
      )}
      <footer>
        <Link className="button button-primary" to={`/matches/${match.matchId}/scoring`}>
          进入记分工作台
        </Link>
      </footer>
    </article>
  );
}
export function EventScoringPage({ context }: { context: RegistrationWorkspace }) {
  const { eventId = '' } = useParams();
  return scoringOrganization(context) ? (
    <EventScoring
      key={`${context.organizationId}:${eventId}`}
      context={context}
      eventId={eventId}
    />
  ) : (
    <ScoringAccessRequired />
  );
}
function EventScoring({
  context,
  eventId,
}: {
  context: RegistrationWorkspace & { organizationId: string };
  eventId: string;
}) {
  const api = useMemo(
    () => createScoringApi(context.client, context.organizationId),
    [context.client, context.organizationId],
  );
  const read = useCallback(
    async () => ({ overview: await api.event(eventId), matches: await api.matches({ eventId }) }),
    [api, eventId],
  );
  const resource = useResource(read);
  const action = useAction();
  return (
    <div className="score-page">
      <Link className="back-link" to="/scoring">
        <ChevronLeft size={16} />
        返回记分与赛果
      </Link>
      <PageHeading
        eyebrow="THE RULES BEFORE THE FIRST TIP"
        title={resource.data?.overview.event.name ?? '赛事记分规则'}
        description="本届比赛使用显式版本化规则。首场准备后规则锁定，不用场地占用时间推算节长。"
      >
        <button
          className="button button-secondary"
          disabled={action.busy}
          onClick={resource.reload}
        >
          <RefreshCw size={16} />
          重新读取规则
        </button>
      </PageHeading>
      <ActionNotice action={action} onReload={resource.reload} />
      {resource.loading || resource.error || !resource.data ? (
        <ResourceState {...resource} />
      ) : (
        <>
          <RulesForm
            key={`${resource.data.overview.rules?.id ?? 'new'}:${resource.data.overview.event.version}`}
            data={resource.data.overview}
            busy={action.busy}
            onSave={async (input) => {
              await action.run(async () => {
                await api.rules(eventId, input);
                if (action.isActive()) resource.reload();
              }, '记分规则已保存');
            }}
          />
          <section className="panel score-panel">
            <h2>
              <ClipboardCheck size={20} /> 本届比赛
            </h2>
            <p>请进入单场工作台分配人员并准备比赛。</p>
            <div className="score-match-list">
              {resource.data.matches.map((match) => (
                <MatchCard key={match.matchId} match={match} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
export function ScoringWorkbenchPage({ context }: { context: RegistrationWorkspace }) {
  const { matchId = '' } = useParams();
  return scoringOrganization(context) ? (
    <>
      <MatchWorkbench
        key={`${context.organizationId}:${matchId}`}
        context={context}
        matchId={matchId}
      />
      <MediaPanel context={context} matchId={matchId} />
    </>
  ) : (
    <ScoringAccessRequired />
  );
}
