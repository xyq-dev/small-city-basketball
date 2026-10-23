import type {
  GroupKnockoutProjection,
  PublicGroupKnockoutData,
} from '@small-city-basketball/contracts';
import { Bracket, PublicBracket } from '../knockout/Bracket';
import { RuleSummary, StandingsTable } from '../viewing/StandingsTable';

export function GroupTables({ competition }: { competition: GroupKnockoutProjection }) {
  return (
    <>
      <div className="view-note">
        <p>
          {competition.groupCount}组组内单循环 · 每组前二晋级 ·
          平分加时。积分与已锁定细则仍同分时，晋级顺序由独立保存的抽签决定；不跨组比较第三名。
        </p>
      </div>
      {competition.groups.map((group) => (
        <div key={group.groupKey}>
          <StandingsTable data={group.standings} title={`${group.label} · 组内积分`} />
          <section className="panel view-panel" aria-label={`${group.label}晋级状态`}>
            {group.qualifiedEntryIds ? (
              <p>
                小组晋级顺序：
                {group.qualifiedEntryIds
                  .map(
                    (entryId) =>
                      group.participants.find((p) => p.entryId === entryId)?.teamName ??
                      '冻结参赛队',
                  )
                  .join(' → ')}
              </p>
            ) : (
              <p>
                {group.unresolvedTieEntryIds.length
                  ? '晋级顺序存在同分，须先独立保存抽签。'
                  : '等待全部组赛有效独立确认。'}
              </p>
            )}
            {group.draw && (
              <details>
                <summary>已保存的同分抽签记录</summary>
                <p>
                  {group.draw.orderedEntryIds
                    .map(
                      (id) =>
                        group.participants.find((p) => p.entryId === id)?.teamName ?? '冻结参赛队',
                    )
                    .join(' → ')}
                </p>
                <p>{group.draw.reason}</p>
                <p>
                  {new Date(group.draw.createdAt).toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                  })}{' '}
                  · 中国标准时间
                </p>
              </details>
            )}
          </section>
        </div>
      ))}
      {competition.bracket && (
        <Bracket
          bracket={competition.bracket}
          participants={competition.groups.flatMap((g) => g.participants)}
          hidePlacements
        />
      )}
      <GroupPlacements complete={competition.isComplete} rows={competition.placements} />
    </>
  );
}

function GroupPlacements({
  complete,
  rows,
}: {
  complete: boolean;
  rows: {
    entryId: string;
    teamName: string;
    groupKey: string;
    groupRank: number | null;
    stage: 'KNOCKOUT' | 'GROUP_ELIMINATED';
    rank: number | null;
    tied: boolean;
  }[];
}) {
  return (
    <section className="panel view-panel" aria-label="分组淘汰最终名次">
      <h2>最终名次与小组出局</h2>
      <p>淘汰阶段不设三四名赛，同轮淘汰者共享名次；小组出局仅列本组名次，不推算跨组总排名。</p>
      {complete ? (
        <ol className="ko-placements">
          {rows.map((row) => (
            <li key={row.entryId}>
              <strong>
                {row.stage === 'GROUP_ELIMINATED'
                  ? '小组出局'
                  : `${row.tied ? '并列' : ''}第${row.rank}名`}
              </strong>
              <span>
                {row.teamName} · {row.groupKey}组
                {row.groupRank === null ? '' : `第${row.groupRank}名`}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p>本届尚未全部有效独立确认，最终名次未产生。</p>
      )}
    </section>
  );
}

export function PublicGroupTables({ data }: { data: PublicGroupKnockoutData }) {
  return (
    <>
      <div className="view-note">
        <p>
          {data.groupCount}
          组组内单循环，每组前二晋级；组内赛及淘汰赛平分均进入加时。晋级顺序同分时须完成独立抽签，不跨组比较第三名。
        </p>
      </div>
      {data.groups.map((group) => (
        <div key={group.groupKey}>
          <StandingsTable
            title={`${group.label} · 组内积分`}
            data={{
              publicEventId: data.publicEventId,
              sourceHash: data.sourceHash,
              asOf: data.asOf,
              rules: data.rules,
              confirmedMatchCount: group.confirmedMatchCount,
              totalMatchCount: group.totalMatchCount,
              isComplete: group.isComplete,
              hasSharedRanks: group.rows.some((r) => r.tied),
              rows: group.rows,
            }}
          />
          <section className="panel view-panel" aria-label={`${group.label}公开晋级状态`}>
            {group.qualified.length ? (
              <p>小组晋级顺序：{group.qualified.map((t) => t.teamName).join(' → ')}</p>
            ) : (
              <p>
                {group.tieBreakRequired
                  ? '晋级顺序同分，等待独立抽签。'
                  : '等待全部组赛有效独立确认。'}
              </p>
            )}
            {group.tieDrawApplied && <p>已应用独立保存的同分抽签。</p>}
          </section>
        </div>
      ))}
      <section className="panel view-panel">
        <h2>已锁定的组内积分规则</h2>
        <RuleSummary rules={data.rules} />
        <p>以上积分细则仍同分且影响晋级顺序时，须完成独立保存的抽签。</p>
      </section>
      {data.bracket ? (
        <PublicBracket data={data.bracket} groupStage />
      ) : (
        <section className="panel view-panel">
          <h2>淘汰阶段尚未发布</h2>
          <p>全部组赛有效独立确认、晋级顺序确定后，由主办方显式发布固定交叉首轮。</p>
        </section>
      )}
      <GroupPlacements
        complete={data.isComplete}
        rows={data.placements.map((p) => ({
          ...p,
          entryId: p.team.teamKey,
          teamName: p.team.teamName,
        }))}
      />
    </>
  );
}
