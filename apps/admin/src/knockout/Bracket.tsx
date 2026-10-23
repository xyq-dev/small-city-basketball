import { Link } from 'react-router-dom';
import type {
  KnockoutBracket,
  PublicKnockoutData,
  ScheduleParticipant,
} from '@small-city-basketball/contracts';
import { matchStatusLabels } from '../scheduling/shared';
import './knockout.css';
const label = (status: string) =>
  status === 'BYE'
    ? '本轮轮空'
    : status === 'WAITING'
      ? '等待晋级来源'
      : (matchStatusLabels[status as keyof typeof matchStatusLabels] ?? status);
export function Bracket({
  bracket,
  participants,
  hidePlacements = false,
}: {
  bracket: KnockoutBracket;
  participants: ScheduleParticipant[];
  hidePlacements?: boolean;
}) {
  const names = new Map(participants.map((p) => [p.entryId, p.teamName]));
  const name = (entryId: string | null, source: string | null) =>
    entryId ? (names.get(entryId) ?? '冻结参赛队') : source ? `${source} 胜者待定` : '空签位';
  return (
    <>
      <div className="ko-rounds" role="region" aria-label="淘汰赛签位">
        {bracket.rounds.map((round) => (
          <section className="panel ko-round" key={round.roundNo} aria-label={round.label}>
            <div className="section-heading">
              <h2>{round.label}</h2>
              <span className="status-badge neutral">
                {round.published ? '已正式发布' : '尚未发布'}
              </span>
            </div>
            <div className="ko-slots">
              {round.slots.map((slot) => (
                <article className="ko-slot" key={slot.fixtureKey}>
                  <div className="ko-slot-meta">
                    <strong>第{slot.positionNo}签位</strong>
                    <span
                      className={`status-badge ${slot.status === 'FINAL' || slot.status === 'BYE' ? 'green' : 'neutral'}`}
                    >
                      {label(slot.status)}
                    </span>
                  </div>
                  {slot.byeEntryId ? (
                    <p>
                      <strong>{names.get(slot.byeEntryId)}</strong> 轮空晋级 · 无比赛记录
                    </p>
                  ) : (
                    <div className="ko-pair">
                      <strong>{name(slot.homeEntryId, slot.homeSource)}</strong>
                      <span>VS</span>
                      <strong>{name(slot.awayEntryId, slot.awaySource)}</strong>
                    </div>
                  )}
                  {slot.winnerEntryId && !slot.byeEntryId && (
                    <p>
                      独立确认晋级：<strong>{names.get(slot.winnerEntryId)}</strong>
                    </p>
                  )}
                  {slot.matchId && (
                    <Link
                      className="button button-secondary"
                      to={`/matches/${encodeURIComponent(slot.matchId)}/scoring`}
                    >
                      查看计分与赛果
                    </Link>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      {!hidePlacements && (
        <section className="panel view-panel" aria-label="淘汰赛最终名次">
          <h2>最终名次</h2>
          <p>不设三四名赛；同轮淘汰者共享名次。所有正式赛果有效独立确认后才公布。</p>
          {bracket.isComplete ? (
            <ol className="ko-placements">
              {bracket.placements.map((row) => (
                <li key={row.entryId}>
                  <strong>
                    {row.tied ? '并列' : ''}第{row.rank}名
                  </strong>
                  <span>{row.teamName}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="view-muted">本届尚未全部确认，最终名次未产生。</p>
          )}
        </section>
      )}
    </>
  );
}
export function PublicBracket({
  data,
  groupStage = false,
}: {
  data: PublicKnockoutData;
  groupStage?: boolean;
}) {
  return (
    <>
      <div className="view-note">
        <p>
          {groupStage
            ? '淘汰阶段 · 小组前二固定交叉对阵 · 同组队决赛前不再相遇'
            : '单淘汰赛 · 首轮轮空无比赛'}{' '}
          · 平分进入加时 · 不设三四名赛。仅有效独立确认决定晋级。
        </p>
      </div>
      <div className="ko-rounds" role="region" aria-label="公开淘汰赛签位">
        {data.rounds.map((round) => (
          <section className="panel ko-round" key={round.roundNo} aria-label={round.label}>
            <div className="section-heading">
              <h2>{round.label}</h2>
              <span>{round.published ? '已发布' : '等待发布'}</span>
            </div>
            <div className="ko-slots">
              {round.slots.map((slot) => (
                <article key={slot.positionNo} className="ko-slot">
                  <div className="ko-slot-meta">
                    <strong>第{slot.positionNo}签位</strong>
                    <span>{label(slot.status)}</span>
                  </div>
                  {slot.bye ? (
                    <p>
                      <strong>{slot.bye.teamName}</strong> 轮空晋级
                    </p>
                  ) : (
                    <div className="ko-pair">
                      <strong>{slot.home?.teamName ?? '来源胜者待定'}</strong>
                      <span>VS</span>
                      <strong>{slot.away?.teamName ?? '来源胜者待定'}</strong>
                    </div>
                  )}
                  {slot.winner && !slot.bye && (
                    <p>
                      独立确认晋级：<strong>{slot.winner.teamName}</strong>
                    </p>
                  )}
                  {slot.publicMatchId && (
                    <Link
                      to={`/watch/${encodeURIComponent(data.publicEventId)}/matches/${encodeURIComponent(slot.publicMatchId)}`}
                    >
                      查看比赛详情 →
                    </Link>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      {!groupStage && (
        <section className="panel view-panel" aria-label="公开最终名次">
          <h2>最终名次</h2>
          {data.isComplete ? (
            <ol className="ko-placements">
              {data.placements.map((row) => (
                <li key={row.team.teamKey}>
                  <strong>
                    {row.tied ? '并列' : ''}第{row.rank}名
                  </strong>
                  <span>{row.team.teamName}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>本届尚未全部确认，最终名次未产生。</p>
          )}
        </section>
      )}
    </>
  );
}
