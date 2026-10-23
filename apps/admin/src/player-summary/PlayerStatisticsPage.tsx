import { useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import type {
  EventPlayerStatisticsData,
  EventPlayerStatisticsRow,
} from '@small-city-basketball/contracts';
import { createPlayerStatisticsApi } from '../api/player-statistics';
import type { RegistrationWorkspace } from '../registration/shared';
import { PageHeading, ResourceState, useResource } from '../registration/shared';

export function EventPlayerStatisticsPage({ context }: { context: RegistrationWorkspace }) {
  const { eventId = '' } = useParams();
  if (!context.organizationId?.trim() || context.teamContext)
    return (
      <section className="panel view-empty">
        <ShieldCheck size={30} />
        <h1>请切换到机构工作台</h1>
        <p>球队授权不包含本届球员私有数据权限，请联系机构负责人确认赛事授权。</p>
        <Link className="button button-secondary" to="/my-team">
          返回我的球队
        </Link>
      </section>
    );
  return (
    <PlayerStatistics
      key={`${context.organizationId}:${eventId}`}
      context={context}
      organizationId={context.organizationId}
      eventId={eventId}
    />
  );
}
function PlayerStatistics({
  context,
  organizationId,
  eventId,
}: {
  context: RegistrationWorkspace;
  organizationId: string;
  eventId: string;
}) {
  const api = useMemo(
    () => createPlayerStatisticsApi(context.client, organizationId),
    [context.client, organizationId],
  );
  const read = useCallback(() => api.event(eventId), [api, eventId]);
  const resource = useResource(read);
  return (
    <div className="view-page">
      <Link className="back-link" to={`/events/${encodeURIComponent(eventId)}`}>
        <ChevronLeft size={16} />
        返回赛事详情
      </Link>
      <PageHeading
        eyebrow="CONFIRMED SAMPLES. PRIVATE PLAYER DATA."
        title="本届球员基础数据"
        description="只汇总当前有效独立确认的逐人得分与犯规；比赛重开后整场退出，重新确认后再计入。"
      >
        <button
          className="button button-secondary"
          disabled={resource.loading}
          onClick={resource.reload}
        >
          <RefreshCw size={16} />
          刷新球员数据
        </button>
      </PageHeading>
      <div className="view-note">
        <ShieldCheck size={20} />
        <p>
          机构内只读资料。未公开给观众或
          OBS；姓名与号码取自本届固定报名名单，不跨球队或名单版本合并。
        </p>
      </div>
      {resource.loading || resource.error || !resource.data ? (
        <ResourceState {...resource} />
      ) : (
        <Statistics data={resource.data} />
      )}
    </div>
  );
}
function Statistics({ data }: { data: EventPlayerStatisticsData }) {
  const summary = data.summary;
  if (!summary)
    return (
      <section className="panel view-empty">
        <Users size={30} />
        <h2>尚无正式赛程</h2>
        <p>{data.event.name} 正式发布赛程后，可在这里查看已确认的球员基础数据。</p>
      </section>
    );
  return (
    <>
      <section className="panel view-panel" aria-label="采集范围与完整性">
        {data.event.format === 'GROUP_KNOCKOUT' && (
          <p>
            按组内赛与淘汰赛各自的真实比赛累计，同队在小组赛和决赛重逢仍为两场；这里只统计有效独立确认的逐人样本。
          </p>
        )}
        <div className="view-section-title">
          <div>
            <span className="view-eyebrow">COLLECTION COVERAGE</span>
            <h2>{data.event.name}</h2>
          </div>
          <span className={`status-badge ${summary.coverageComplete ? 'green' : 'amber'}`}>
            {summary.coverageComplete ? '采集覆盖完整' : '采集覆盖不完整'}
          </span>
        </div>
        <div className="view-rule-summary">
          <span>
            正式比赛 <strong>{summary.totalMatchCount}</strong> 场
          </span>
          <span>
            逐人基础数据已计入 <strong>{summary.includedMatchCount}</strong> 场
          </span>
          <span>
            仅球队总数已确认 <strong>{summary.teamOnlyConfirmedMatchCount}</strong> 场
          </span>
          <span>
            待有效确认 <strong>{summary.pendingMatchCount}</strong> 场
          </span>
        </div>
        <p className="view-muted">
          仅球队总数的比赛没有逐人采集，不补造球员数据。当前为
          {summary.coverageComplete ? '全部比赛逐人基础汇总' : '部分比赛逐人基础汇总'}
          ，得分榜不代表完整赛事表现。
        </p>
        <p className="view-muted">
          数据归属：
          <strong>
            {summary.includedMatchCount === 0
              ? '尚无逐人确认样本，归属完整性未计算'
              : summary.attributionComplete
                ? '已计入样本均完整归属'
                : '含未归属得分或犯规'}
          </strong>
          。采集覆盖与个人归属是两项独立检查。
        </p>
      </section>
      <section className="panel view-panel" aria-label="球员得分与犯规榜">
        <div className="view-section-title">
          <div>
            <span className="view-eyebrow">BASIC PLAYER TOTALS</span>
            <h2>球员得分与犯规</h2>
          </div>
          <span className="status-badge neutral">私有 · 有效确认样本</span>
        </div>
        <p className="view-muted">
          按累计得分排名，同分采用 1、1、3
          共同名次，不用犯规破同分。“采集名单场次”仅表示固定名单被采集的场次，不能视作实际出场。
        </p>
        {!summary.rows.length ? (
          <div className="view-note">
            <Users size={24} />
            <div>
              <h3>尚无可计入的球员数据</h3>
              <p>
                需要比赛启用逐人基础采集并完成独立确认；未确认、重开或仅球队总数的比赛不会生成球员排行。
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="view-table-scroll">
              <table className="view-table">
                <thead>
                  <tr>
                    <th scope="col">名次</th>
                    <th scope="col">球员</th>
                    <th scope="col">球队</th>
                    <th scope="col">号码</th>
                    <th scope="col">得分</th>
                    <th scope="col">犯规</th>
                    <th scope="col">采集名单场次</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((row) => (
                    <tr key={rowKey(row)}>
                      <td>
                        <strong className="view-rank">{row.rank}</strong>
                        {row.tied && <small>并列</small>}
                      </td>
                      <th scope="row">{row.name}</th>
                      <td>{row.teamName}</td>
                      <td>{row.jerseyNo}</td>
                      <td>{row.score}</td>
                      <td>{row.fouls}</td>
                      <td>{row.rosterSampleMatchCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="view-mobile-rows">
              {summary.rows.map((row) => (
                <article key={rowKey(row)}>
                  <div className="view-mobile-team">
                    <span className="view-rank">{row.rank}</span>
                    <div>
                      <strong>
                        {row.name} · {row.jerseyNo}号
                      </strong>
                      <small>
                        {row.teamName}
                        {row.tied ? ' · 共同名次' : ''}
                      </small>
                    </div>
                    <span>
                      <strong>{row.score}</strong> 得分
                    </span>
                  </div>
                  <div className="view-mobile-metrics">
                    <span>
                      犯规<strong>{row.fouls}</strong>
                    </span>
                    <span>
                      采集名单场次<strong>{row.rosterSampleMatchCount}</strong>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        <p className="view-caption">篮板、助攻、抢断、盖帽、投篮命中率、出场时间与场均：未统计。</p>
      </section>
      <section className="panel view-panel" aria-label="球队归属核对">
        <h2>球队归属核对</h2>
        <p className="view-muted">
          以下仅累计已计入的逐人确认样本，不代表完整球队总数；未采集比赛不计入，零值也不代表该队整届实际为零。未归属部分保留在样本球队总数，不分摊到任何球员。
        </p>
        {summary.includedMatchCount === 0 ? (
          <p>尚无已确认逐人样本，球队归属未计算。</p>
        ) : (
          <div className="view-event-grid">
            {summary.teams.map((team) => (
              <article key={team.entryId}>
                <h3>{team.teamName}</h3>
                <div className="view-rule-summary">
                  <span>
                    已归属得分 <strong>{team.attributedScore}</strong>
                  </span>
                  <span>
                    未归属得分 <strong>{team.unassignedScore}</strong>
                  </span>
                  <span>
                    已归属犯规 <strong>{team.attributedFouls}</strong>
                  </span>
                  <span>
                    未归属犯规 <strong>{team.unassignedFouls}</strong>
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="panel view-panel" aria-label="数据来源">
        <h2>数据来源</h2>
        <p className="view-caption">
          截至{' '}
          {new Date(summary.asOf).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            hour12: false,
          })}{' '}
          · 中国标准时间。刷新读取最新有效确认；本页不作独立采集或比赛状态存储。
        </p>
        <details>
          <summary>查看来源标识</summary>
          <p className="view-caption">{summary.algorithmVersion}</p>
          <code style={{ overflowWrap: 'anywhere' }}>{summary.sourceHash}</code>
        </details>
      </section>
    </>
  );
}
const rowKey = (row: EventPlayerStatisticsRow) =>
  JSON.stringify([row.entryId, row.rosterRevisionId, row.memberId]);
