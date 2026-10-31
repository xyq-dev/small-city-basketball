import type {
  PublicStandingsData,
  StandingsData,
  StandingsRules,
} from '@small-city-basketball/contracts';
export const tiebreakerLabels = {
  SCORE_DIFFERENCE: '净胜分',
  POINTS_FOR: '总得分',
  WINS: '胜场数',
};
export function RuleSummary({ rules }: { rules: StandingsRules }) {
  return (
    <div className="view-rule-summary">
      <span>
        胜 <strong>{rules.winPoints}</strong> 分
      </span>
      <span>
        负 <strong>{rules.lossPoints}</strong> 分
      </span>
      <span>
        平 <strong>{rules.drawPoints}</strong> 分
      </span>
      <p>
        积分优先，其后
        {rules.tiebreakers.length
          ? rules.tiebreakers.map((key) => tiebreakerLabels[key]).join(' → ')
          : '不设置额外判定'}
        ；仍相同则共享名次。
      </p>
    </div>
  );
}
export function StandingsTable({
  data,
  preview = false,
  title = '赛事排名',
}: {
  data: PublicStandingsData | StandingsData;
  preview?: boolean;
  title?: string;
}) {
  const adjudicated = data.adjudicatedMatchCount ?? 0;
  const cancelled = data.cancelledMatchCount ?? 0;
  const resolved = data.resolvedMatchCount ?? data.confirmedMatchCount;
  const administrative = adjudicated > 0 || cancelled > 0;
  const counted = data.confirmedMatchCount + adjudicated;
  return (
    <section className="panel view-panel" aria-label={title}>
      <div className="view-section-title">
        <div>
          <span className="view-eyebrow">THE TABLE, WITH EVERY RESULT</span>
          <h2>{preview ? '草稿规则预览' : title}</h2>
        </div>
        <span className={`status-badge ${preview ? 'amber' : data.isComplete ? 'green' : 'blue'}`}>
          {preview
            ? '未正式发布'
            : data.isComplete
              ? administrative
                ? '全部场次已处理'
                : '全部场次已确认'
              : '未完成 · 暂列排名'}
        </span>
      </div>
      <p className="view-muted">
        {administrative ? (
          <>
            已处理 {resolved} / {data.totalMatchCount} 场：{data.confirmedMatchCount}场有效确认、
            {adjudicated}场弃权裁定、{cancelled}场取消（不计入积分表）。
          </>
        ) : (
          <>
            已计入 {data.confirmedMatchCount} / {data.totalMatchCount} 场有效确认赛果。
          </>
        )}
        {data.hasSharedRanks
          ? '包含共享名次，采用1、1、3的竞赛排名。'
          : '排名不自动等于冠军或晋级。'}
      </p>
      {counted === 0 && (
        <div className="view-note">
          <div>
            <strong>{cancelled > 0 ? '尚无计入积分的赛果' : '尚无已确认赛果'}</strong>
            <p>
              {cancelled > 0
                ? '取消场次不产生胜负或积分，排名及晋级按赛事规则处理。'
                : '所有球队尚无名次，不把未赛球队列为并列冠军。'}
            </p>
          </div>
        </div>
      )}
      <div className="view-table-scroll">
        <table className="view-table">
          <thead>
            <tr>
              <th scope="col">名次</th>
              <th scope="col">球队</th>
              <th scope="col">赛</th>
              <th scope="col">胜</th>
              <th scope="col">平</th>
              <th scope="col">负</th>
              <th scope="col">得分</th>
              <th scope="col">失分</th>
              <th scope="col">净胜</th>
              <th scope="col">积分</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={'teamKey' in row ? row.teamKey : row.entryId}>
                <td>
                  <strong className="view-rank">{row.rank ?? '—'}</strong>
                  {row.tied && row.rank !== null && <small>并列</small>}
                </td>
                <th scope="row">
                  {row.teamName}
                  {row.played === 0 && <small>未赛</small>}
                </th>
                <td>{row.played}</td>
                <td>{row.wins}</td>
                <td>{row.draws}</td>
                <td>{row.losses}</td>
                <td>{row.pointsFor}</td>
                <td>{row.pointsAgainst}</td>
                <td>
                  {row.scoreDifference > 0 ? '+' : ''}
                  {row.scoreDifference}
                </td>
                <td className="view-league-points">{row.leaguePoints}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="view-mobile-rows">
        {data.rows.map((row) => (
          <article key={'teamKey' in row ? row.teamKey : row.entryId}>
            <div className="view-mobile-team">
              <span className="view-rank">{row.rank ?? '—'}</span>
              <div>
                <strong>{row.teamName}</strong>
                <small>
                  {row.played === 0
                    ? '未赛'
                    : row.tied && row.rank !== null
                      ? '共享名次'
                      : '已计入有效赛果'}
                </small>
              </div>
              <span>
                <strong>{row.leaguePoints}</strong> 积分
              </span>
            </div>
            <div className="view-mobile-metrics">
              <span>
                赛／胜／平／负
                <strong>
                  {row.played} / {row.wins} / {row.draws} / {row.losses}
                </strong>
              </span>
              <span>
                得分／失分
                <strong>
                  {row.pointsFor} / {row.pointsAgainst}
                </strong>
              </span>
              <span>
                净胜分
                <strong>
                  {row.scoreDifference > 0 ? '+' : ''}
                  {row.scoreDifference}
                </strong>
              </span>
            </div>
          </article>
        ))}
      </div>
      <p className="view-caption">
        截至{' '}
        {new Date(data.asOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}{' '}
        · 中国标准时间。
        {administrative
          ? '计入当前有效确认和依规则裁定的弃权胜负积分；弃权不产生记录得失分，取消场次排除。'
          : '只计当前有效确认；重开赛果后整场暂不计入。'}
      </p>
    </section>
  );
}
