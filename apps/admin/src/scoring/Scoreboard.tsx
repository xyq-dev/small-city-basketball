import { useEffect, useState } from 'react';
import type { ScoreSnapshot } from '@small-city-basketball/contracts';
import { clockLabel, clockRemaining } from './clock';
import { localMoment, matchStatusLabels } from './shared';
export function Scoreboard({ snapshot }: { snapshot: ScoreSnapshot }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = performance.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(performance.now() - started), 100);
    return () => clearInterval(timer);
  }, [snapshot]);
  const remaining = clockRemaining(snapshot.clock, snapshot.serverTime, elapsed);
  return (
    <section className="score-board" aria-label="服务端权威比分">
      <div className="score-team">
        <span className="score-team-label">主队 · HOME</span>
        <h2>{snapshot.home.teamName}</h2>
        <strong className="score-total" aria-label="主队比分">
          {snapshot.totals.home.score}
        </strong>
        <div className="score-team-count">
          <span>全场犯规 {snapshot.totals.home.fouls}</span>
          <span>全场暂停 {snapshot.totals.home.timeouts}</span>
        </div>
      </div>
      <div className={`score-clock ${snapshot.clock.running ? 'is-running' : ''}`}>
        <span className="status-badge">
          {matchStatusLabels[snapshot.status] ?? snapshot.status}
        </span>
        <span>
          {snapshot.clock.period > snapshot.rules.regulationPeriods
            ? `加时第${snapshot.clock.period - snapshot.rules.regulationPeriods}节`
            : `第${snapshot.clock.period}节`}
        </span>
        <strong aria-label="比赛剩余时间">{clockLabel(remaining)}</strong>
        <span>{snapshot.clock.running ? '时钟运行中' : '时钟已暂停'}</span>
      </div>
      <div className="score-team">
        <span className="score-team-label">客队 · AWAY</span>
        <h2>{snapshot.away.teamName}</h2>
        <strong className="score-total" aria-label="客队比分">
          {snapshot.totals.away.score}
        </strong>
        <div className="score-team-count">
          <span>全场犯规 {snapshot.totals.away.fouls}</span>
          <span>全场暂停 {snapshot.totals.away.timeouts}</span>
        </div>
      </div>
      <footer className="score-board-foot">
        <span className="score-live-mark">权威快照 · 资料版本 {snapshot.version}</span>
        <span>服务时间 {localMoment(snapshot.serverTime)}</span>
      </footer>
    </section>
  );
}
