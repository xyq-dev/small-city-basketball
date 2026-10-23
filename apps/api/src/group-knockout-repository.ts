import type { PoolClient } from 'pg';
import type {
  GroupTieDrawData,
  GroupQualificationProof,
  StandingsRulesetData,
} from '@small-city-basketball/contracts';
export async function groupEvidence(c: PoolClient, org: string, event: string) {
  const draws = (
    await c.query(
      'SELECT * FROM group_tiebreak_draws WHERE org_id=$1 AND event_id=$2 ORDER BY created_at,id',
      [org, event],
    )
  ).rows.map((r): GroupTieDrawData => ({
    id: r.id,
    groupKey: r.group_key,
    sourceHash: r.source_hash,
    seed: r.seed,
    tiedEntryIds: r.tied_entry_ids,
    orderedEntryIds: r.ordered_entry_ids,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
  }));
  const q = (
    await c.query(
      'SELECT * FROM group_qualification_publications WHERE org_id=$1 AND event_id=$2',
      [org, event],
    )
  ).rows[0];
  const qualification: GroupQualificationProof | null = q
    ? {
        id: q.id,
        sourceHash: q.source_hash,
        sources: q.sources,
        slots: q.slots,
        drawIds: q.draw_ids,
      }
    : null;
  const r = (
    await c.query(
      'SELECT r.* FROM events e JOIN standings_rulesets r ON r.org_id=e.org_id AND r.event_id=e.id AND r.id=e.locked_standings_ruleset_id WHERE e.org_id=$1 AND e.id=$2',
      [org, event],
    )
  ).rows[0];
  const rules: StandingsRulesetData | null = r
    ? {
        id: r.id,
        eventId: r.event_id,
        version: r.version,
        algorithmVersion: r.algorithm_version,
        winPoints: r.win_points,
        lossPoints: r.loss_points,
        drawPoints: r.draw_points,
        tiebreakers: r.tiebreakers,
        createdAt: r.created_at.toISOString(),
      }
    : null;
  return { draws, qualification, rules };
}
