import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  Globe,
  MapPin,
  RefreshCw,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import type {
  PublicMatchSnapshotData,
  PublicScheduleMatchData,
} from '@small-city-basketball/contracts';
import { ApiError } from '../api/client';
import { createPublicViewingApi } from '../api/viewing';
import type { PublicViewingApi } from '../api/viewing';
import { clockLabel, clockRemaining } from '../scoring/clock';
import { RuleSummary, StandingsTable } from './StandingsTable';
import { usePublicResource } from './usePublicResource';
import { MatchExportTools, ScheduleExportTools } from './PublicExports';
import { PublicBracket } from '../knockout/Bracket';
import './viewing.css';
const PublicApiContext = createContext<PublicViewingApi | null>(null);
const usePublicApi = () => useContext(PublicApiContext)!;
const closedEvent = (status: string) => status === 'COMPLETED' || status === 'ARCHIVED';
const statusLabels: Record<string, string> = {
  SCHEDULED: '尚未准备',
  READY: '已准备 · 尚未开赛',
  LIVE: '比赛进行中',
  PENDING_CONFIRMATION: '待确认赛果',
  FINAL: '正式赛果',
  POSTPONED: '已延期',
  CANCELLED: '已取消',
};
const resultLabels = {
  UNCONFIRMED: '赛果未确认',
  CONFIRMED: '赛果已确认',
  REQUIRES_RECONFIRMATION: '待重新确认赛果',
};
const moment = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
function WatchLogo() {
  return (
    <svg viewBox="0 0 44 44" aria-hidden="true">
      <rect x="1" y="1" width="42" height="42" rx="12" fill="#132c49" />
      <path d="M9 27V18h6v-5h7v8h6v-5h7v11" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="22" cy="29" r="8" fill="#ff6b2d" />
      <path
        d="M14 29h16M22 21v16M17 23c6 4 6 8 0 12M27 23c-6 4-6 8 0 12"
        fill="none"
        stroke="#132c49"
        strokeWidth="1"
      />
    </svg>
  );
}
function WatchHeader({ publicEventId }: { publicEventId?: string }) {
  return (
    <header className="watch-header">
      <Link
        className="watch-brand"
        to={publicEventId ? `/watch/${encodeURIComponent(publicEventId)}` : '/watch'}
      >
        <WatchLogo />
        <span>
          <strong>小城市篮球</strong>
          <small>小城市，也有大主场。</small>
        </span>
      </Link>
      <a href="/">
        机构工作台 <ArrowRight size={15} />
      </a>
    </header>
  );
}
function WatchFooter() {
  return (
    <footer className="watch-footer">
      <span>小城市篮球 · 每一场热爱，都值得被看见。</span>
      <span>主办方公开的有限资料 · 未接入OBS或视频服务</span>
    </footer>
  );
}
export function PublicViewingApp({ fetcher }: { fetcher?: typeof fetch }) {
  const api = useMemo(() => createPublicViewingApi({ fetcher }), [fetcher]);
  return (
    <PublicApiContext.Provider value={api}>
      <BrowserRouter>
        <Routes>
          <Route path="/watch/:publicEventId" element={<PublicEventPage />} />
          <Route
            path="/watch/:publicEventId/matches/:publicMatchId"
            element={<PublicMatchPage />}
          />
          <Route
            path="*"
            element={
              <div className="watch-shell">
                <WatchHeader />
                <main className="watch-main">
                  <Unavailable />
                </main>
                <WatchFooter />
              </div>
            }
          />
        </Routes>
      </BrowserRouter>
    </PublicApiContext.Provider>
  );
}
function Unavailable() {
  return (
    <section className="panel view-empty">
      <ShieldCheck size={34} />
      <h1>观赛链接不可用</h1>
      <p>链接可能已撤销或尚未公开。请向主办方获取当前观赛链接。</p>
    </section>
  );
}
function PublicReadState({
  resource,
}: {
  resource: { loading: boolean; notFound: boolean; error: string; reload: () => Promise<void> };
}) {
  if (resource.notFound) return <Unavailable />;
  return (
    <section className="panel view-empty" role={resource.loading ? 'status' : 'alert'}>
      <Globe size={31} />
      <h1>{resource.loading ? '正在读取观赛资料' : '暂时无法读取观赛资料'}</h1>
      <p>
        {resource.loading
          ? '正在连接主办方公开的赛事资料…'
          : resource.error || '请检查连接后重新读取，不会替换为示例比分。'}
      </p>
      {!resource.loading && (
        <button className="button button-secondary" onClick={() => void resource.reload()}>
          重新读取公开资料
        </button>
      )}
    </section>
  );
}
function Freshness({
  resource,
}: {
  resource: { stale: boolean; online: boolean; lastSuccess?: Date; reload: () => Promise<void> };
}) {
  return (
    <>
      {(!resource.online || resource.stale) && (
        <div className="view-note warning" role="status">
          <WifiOff size={20} />
          <p>
            {!resource.online
              ? '已离线，正显示最后一次读取的资料。'
              : '资料已陈旧，正在等待重新读取。'}
            运行时钟为旧锚点估算，请以恢复连接后的资料为准。
          </p>
        </div>
      )}
      <div className="watch-freshness">
        <span>
          {resource.lastSuccess
            ? `上次成功读取 ${moment(resource.lastSuccess.toISOString())} · 中国标准时间`
            : '尚未成功读取'}{' '}
          · 定期更新，非推送
        </span>
        <button className="button button-secondary" onClick={() => void resource.reload()}>
          <RefreshCw size={15} />
          刷新公开资料
        </button>
      </div>
    </>
  );
}
function PublicEventPage() {
  const { publicEventId = '' } = useParams();
  return <PublicEventContent key={publicEventId} publicEventId={publicEventId} />;
}
function PublicEventContent({ publicEventId }: { publicEventId: string }) {
  const api = usePublicApi();
  const read = useCallback(
    async (signal: AbortSignal) => {
      const event = await api.event(publicEventId, signal);
      if (signal.aborted) throw new DOMException('读取已取消', 'AbortError');
      if (event.publicEventId !== publicEventId)
        throw new ApiError(404, 'PUBLIC_NOT_FOUND', '观赛链接不可用');
      const [schedule, standings, bracket] = await Promise.all([
        api.schedule(publicEventId, undefined, signal),
        event.format === 'SINGLE_ELIMINATION'
          ? Promise.resolve(null)
          : api.standings(publicEventId, signal),
        event.format === 'SINGLE_ELIMINATION'
          ? api.knockout(publicEventId, signal)
          : Promise.resolve(null),
      ]);
      if (
        (standings && standings.publicEventId !== publicEventId) ||
        (bracket && bracket.publicEventId !== publicEventId)
      )
        throw new ApiError(404, 'PUBLIC_NOT_FOUND', '观赛链接不可用');
      return { event, schedule, standings, bracket };
    },
    [api, publicEventId],
  );
  const resource = usePublicResource(read);
  const [tab, setTab] = useState<'schedule' | 'standings'>('schedule'),
    [filter, setFilter] = useState('ALL');
  const data = resource.data;
  useEffect(() => {
    document.title = data ? `${data.event.name} · 小城市篮球观赛` : '公开观赛 · 小城市篮球';
  }, [data]);
  const matches = data?.schedule.filter((match) => filter === 'ALL' || match.status === filter);
  return (
    <div className="watch-shell">
      <WatchHeader publicEventId={publicEventId} />
      <main className="watch-main">
        {!data ? (
          <PublicReadState resource={resource} />
        ) : (
          <>
            <section className="watch-hero">
              <span className="view-eyebrow">SMALL CITY. BIG HOME COURT.</span>
              <h1>{data.event.name}</h1>
              <div className="watch-hero-meta">
                <span>
                  <CalendarDays size={16} />
                  {data.event.startDate} — {data.event.endDate}
                </span>
                <span>
                  <MapPin size={16} />
                  {data.event.venueName || '举办地点未声明'}
                </span>
              </div>
              <div className="watch-hero-foot">
                <span className="watch-live">
                  {closedEvent(data.event.status)
                    ? '历史观赛 · 主办方已显式授权 · 只读正式赛果'
                    : '主办方已启用公开观赛 · 仅展示允许公开的资料'}
                </span>
                <span>
                  <strong>
                    {data.event.confirmedMatchCount} / {data.event.totalMatchCount}
                  </strong>{' '}
                  场已确认 ·{' '}
                  {data.event.isComplete
                    ? '全部场次已确认'
                    : data.bracket
                      ? '晋级进行中'
                      : '排名暂列'}
                </span>
              </div>
            </section>
            <Freshness resource={resource} />
            <ScheduleExportTools
              data={data}
              disabled={!resource.online || resource.stale || resource.loading}
              readLatest={read}
              onUnavailable={resource.invalidate}
            />
            <div className="watch-tabs" role="tablist" aria-label="赛事观赛内容">
              <button
                id="watch-schedule-tab"
                role="tab"
                aria-selected={tab === 'schedule'}
                aria-controls="watch-schedule-panel"
                onClick={() => setTab('schedule')}
              >
                比赛赛程
              </button>
              <button
                id="watch-standings-tab"
                role="tab"
                aria-selected={tab === 'standings'}
                aria-controls="watch-standings-panel"
                onClick={() => setTab('standings')}
              >
                {data.bracket ? '晋级与名次' : '赛事排名'}
              </button>
            </div>
            {tab === 'schedule' ? (
              <section
                id="watch-schedule-panel"
                role="tabpanel"
                aria-labelledby="watch-schedule-tab"
              >
                <div className="watch-filter">
                  <h2>正式比赛赛程</h2>
                  <label className="view-field">
                    筛选比赛状态
                    <select
                      aria-label="筛选比赛状态"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                    >
                      <option value="ALL">全部状态</option>
                      {Object.entries(statusLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="watch-match-grid">
                  {matches?.map((match) => (
                    <PublicMatchCard
                      key={match.publicMatchId}
                      match={match}
                      publicEventId={publicEventId}
                    />
                  ))}
                </div>
                {!matches?.length && (
                  <section className="panel view-empty">
                    <h3>暂无符合筛选的比赛</h3>
                    <p>切换比赛状态查看完整赛程。</p>
                  </section>
                )}
              </section>
            ) : (
              <div id="watch-standings-panel" role="tabpanel" aria-labelledby="watch-standings-tab">
                {data.bracket ? (
                  <PublicBracket data={data.bracket} />
                ) : (
                  data.standings && (
                    <>
                      <StandingsTable data={data.standings} />
                      <section className="panel view-panel">
                        <h2>已发布排名规则</h2>
                        <RuleSummary rules={data.standings.rules} />
                      </section>
                    </>
                  )
                )}
              </div>
            )}
            <div className="view-note">
              <ShieldCheck size={19} />
              <p>
                仅当前有效确认赛果进入排名；重开会暂时撤出。未完成或共享名次不代表已产生唯一冠军。球员专业统计未采集。
              </p>
            </div>
          </>
        )}
      </main>
      <WatchFooter />
    </div>
  );
}
function PublicMatchCard({
  match,
  publicEventId,
}: {
  match: PublicScheduleMatchData;
  publicEventId: string;
}) {
  return (
    <article className="watch-match-card">
      <div className="watch-card-meta">
        <span>
          第{match.roundNo}轮 · 第{match.positionNo}场
        </span>
        <span
          className={`status-badge ${match.status === 'LIVE' ? 'blue' : match.resultStatus === 'CONFIRMED' ? 'green' : 'neutral'}`}
        >
          {statusLabels[match.status]}
        </span>
      </div>
      <div className="watch-matchup">
        <h3>{match.home.teamName}</h3>
        {match.score ? (
          <strong>
            {match.score.home} : {match.score.away}
          </strong>
        ) : (
          <span>VS</span>
        )}
        <h3>{match.away.teamName}</h3>
      </div>
      <div className="view-muted">
        {match.courtName} · {moment(match.startsAt)}
      </div>
      <div className="watch-match-bottom">
        <span>{resultLabels[match.resultStatus]}</span>
        <Link
          to={`/watch/${encodeURIComponent(publicEventId)}/matches/${encodeURIComponent(match.publicMatchId)}`}
        >
          查看比赛详情 <ArrowRight size={15} />
        </Link>
      </div>
    </article>
  );
}
function PublicMatchPage() {
  const { publicEventId = '', publicMatchId = '' } = useParams();
  return (
    <PublicMatchContent
      key={`${publicEventId}:${publicMatchId}`}
      publicEventId={publicEventId}
      publicMatchId={publicMatchId}
    />
  );
}
function PublicMatchContent({
  publicEventId,
  publicMatchId,
}: {
  publicEventId: string;
  publicMatchId: string;
}) {
  const api = usePublicApi();
  const read = useCallback(
    async (signal: AbortSignal) => {
      const data = await api.match(publicEventId, publicMatchId, signal);
      if (data.publicEventId !== publicEventId || data.publicMatchId !== publicMatchId)
        throw new ApiError(404, 'PUBLIC_NOT_FOUND', '观赛链接不可用');
      return data;
    },
    [api, publicEventId, publicMatchId],
  );
  const resource = usePublicResource(read);
  const data = resource.data;
  useEffect(() => {
    document.title = data
      ? `${data.home.teamName} vs ${data.away.teamName} · 小城市篮球`
      : '公开比赛 · 小城市篮球';
  }, [data]);
  return (
    <div className="watch-shell">
      <WatchHeader publicEventId={publicEventId} />
      <main className="watch-main">
        {!data ? (
          <PublicReadState resource={resource} />
        ) : (
          <>
            <Link className="watch-back" to={`/watch/${encodeURIComponent(publicEventId)}`}>
              <ChevronLeft size={16} />
              返回赛事观赛页
            </Link>
            <div className="watch-filter">
              <div>
                <div className="view-eyebrow">{data.eventName}</div>
                <h1>
                  {data.home.teamName} vs {data.away.teamName}
                </h1>
                <p className="view-muted">
                  第{data.roundNo}轮 · {data.courtName} · {moment(data.startsAt)}（中国标准时间）
                </p>
              </div>
              <span
                className={`status-badge ${data.resultStatus === 'CONFIRMED' ? 'green' : 'neutral'}`}
              >
                {resultLabels[data.resultStatus]}
              </span>
            </div>
            <Freshness resource={resource} />
            <PublicScoreboard data={data} receivedAt={resource.receivedAt} />
            <MatchExportTools
              data={data}
              disabled={!resource.online || resource.stale || resource.loading}
              readLatest={read}
              onUnavailable={resource.invalidate}
            />
            {data.periods && (
              <section className="panel view-panel">
                <h2>按节球队统计</h2>
                <div className="watch-periods">
                  {data.periods.map((period) => (
                    <div key={period.period}>
                      <strong>第{period.period}节</strong>
                      <span>
                        得分 {period.home.score} : {period.away.score}
                      </span>
                      <span>
                        犯规 {period.home.fouls} : {period.away.fouls}
                      </span>
                      <span>
                        暂停 {period.home.timeouts} : {period.away.timeouts}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="view-muted">
                  犯规和暂停仅累计，不推定罚球或剩余配额。球员篮板、助攻等：未统计。
                </p>
              </section>
            )}
            {data.rules && (
              <section className="panel view-panel">
                <h2>本场已绑定规则</h2>
                <p className="view-muted">
                  常规 {data.rules.regulationPeriods} 节 × {data.rules.periodDurationSeconds} 秒 ·
                  允许 {data.rules.allowedScoreValues.join(' / ')} 分 ·{' '}
                  {data.rules.tiePolicy === 'ALLOW_DRAW'
                    ? '允许平局'
                    : `平局加时，每节${data.rules.overtimeDurationSeconds}秒`}{' '}
                  · 规则版本 {data.rules.version}
                </p>
              </section>
            )}
            <div className="view-note">
              <ShieldCheck size={19} />
              <p>
                公开页面只读，不提供记分控制或人员资料。
                {data.resultStatus === 'REQUIRES_RECONFIRMATION'
                  ? '本场已重开，原确认不再计入当前排名。'
                  : '结束计分与赛果确认分开，只有有效确认才计入排名。'}
                球员专业统计：未统计。
              </p>
            </div>
          </>
        )}
      </main>
      <WatchFooter />
    </div>
  );
}
export function PublicScoreboard({
  data,
  receivedAt,
}: {
  data: PublicMatchSnapshotData;
  receivedAt: number;
}) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, performance.now() - receivedAt));
  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, performance.now() - receivedAt));
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [receivedAt]);
  const clock = data.clock;
  return (
    <>
      <section className="watch-board" aria-label="公开比赛比分">
        <div className="watch-team">
          <span>主队 · HOME</span>
          <h2>{data.home.teamName}</h2>
          <strong aria-label="主队比分">{data.score?.home ?? '—'}</strong>
          {data.totals && (
            <div className="watch-totals">
              <span>全场犯规 {data.totals.home.fouls}</span>
              <span>全场暂停 {data.totals.home.timeouts}</span>
            </div>
          )}
        </div>
        <div className="watch-clock">
          <span>{statusLabels[data.status]}</span>
          <strong aria-label="比赛剩余时间">
            {clock ? clockLabel(clockRemaining(clock, data.serverTime, elapsed)) : '—'}
          </strong>
          <span>
            {clock
              ? `${data.rules && clock.period > data.rules.regulationPeriods ? '加时' : '第'}${data.rules && clock.period > data.rules.regulationPeriods ? clock.period - data.rules.regulationPeriods : clock.period}节 · ${clock.running ? '时钟运行中' : '时钟已暂停'}`
              : '比分／时钟尚未初始化'}
          </span>
        </div>
        <div className="watch-team">
          <span>客队 · AWAY</span>
          <h2>{data.away.teamName}</h2>
          <strong aria-label="客队比分">{data.score?.away ?? '—'}</strong>
          {data.totals && (
            <div className="watch-totals">
              <span>全场犯规 {data.totals.away.fouls}</span>
              <span>全场暂停 {data.totals.away.timeouts}</span>
            </div>
          )}
        </div>
      </section>
      {!clock && (
        <div className="view-note">
          本场尚未准备，尚未采集比分或时钟；不会用0冒充已统计数据。球员专业统计未统计。
        </div>
      )}
    </>
  );
}
