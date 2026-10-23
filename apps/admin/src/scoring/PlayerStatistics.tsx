import type {
  EntryRosterPlayer,
  MatchPlayerStatistics,
  ScoringSide,
} from '@small-city-basketball/contracts';

export function PlayerSelector({
  label,
  players,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  players: EntryRosterPlayer[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="score-field score-player-selector">
      {label}
      <select
        aria-label={label}
        value={players.some((player) => player.memberId === value) ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">未归属球员</option>
        {players.map((player) => (
          <option key={player.memberId} value={player.memberId}>
            {player.jerseyNo}号 · {player.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PlayerStatisticsPanel({
  statistics,
  homeName,
  awayName,
  title = '个人基础统计',
  official = false,
  needsConfirmation = false,
}: {
  statistics: MatchPlayerStatistics | null;
  homeName: string;
  awayName: string;
  title?: string;
  official?: boolean;
  needsConfirmation?: boolean;
}) {
  return (
    <section className="panel score-panel score-player-statistics" aria-label={title}>
      <div className="score-toolbar">
        <h2>{title}</h2>
        {statistics && (
          <span className="score-state-chip">
            {official ? '已独立确认' : needsConfirmation ? '等待重新确认' : '实时记录 · 尚未确认'}
          </span>
        )}
      </div>
      {statistics ? (
        <>
          <p>本场使用固定报名名单记录球员得分和犯规。个人与未归属记录共同组成球队总数。</p>
          <div className="score-player-grid">
            {(['HOME', 'AWAY'] as ScoringSide[]).map((side) => {
              const team = side === 'HOME' ? statistics.home : statistics.away;
              const name = side === 'HOME' ? homeName : awayName;
              const assigned = team.players.reduce((sum, player) => sum + player.score, 0);
              return (
                <article key={side} className="score-player-team">
                  <h3>
                    {side === 'HOME' ? '主队' : '客队'} · {name}
                  </h3>
                  <p className="score-player-coverage">
                    已归属得分 {assigned} / {assigned + team.unassigned.score}
                    {' · '}未归属 {team.unassigned.score} 分
                  </p>
                  <div className="score-player-table-wrap">
                    <table className="score-player-table" aria-label={`${name}球员基础统计`}>
                      <thead>
                        <tr>
                          <th scope="col">球员</th>
                          <th scope="col">得分</th>
                          <th scope="col">犯规</th>
                        </tr>
                      </thead>
                      <tbody>
                        {team.players.map((player) => (
                          <tr key={player.memberId}>
                            <th scope="row">
                              <span>{player.jerseyNo}号</span> {player.name}
                            </th>
                            <td>{player.score}</td>
                            <td>{player.fouls}</td>
                          </tr>
                        ))}
                        <tr className="score-player-unassigned">
                          <th scope="row">未归属球员</th>
                          <td>{team.unassigned.score}</td>
                          <td>{team.unassigned.fouls}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <p>本场采用球队记分；个人得分及犯规：未统计。</p>
      )}
      <p>篮板、助攻、抢断、盖帽、失误、投篮命中率及上场时间：未统计。</p>
    </section>
  );
}
