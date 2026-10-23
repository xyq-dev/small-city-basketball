import type { PoolClient } from 'pg';
import type { EventPlayerStatisticsData } from '@small-city-basketball/contracts';
import { ApplicationService, EVENT_SELECT, isAdministrator } from './service.js';
import type { EventRow } from './service.js';
import { notFound } from './errors.js';
import { resourceId } from './validation.js';
import { groupEvidence } from './group-knockout-repository.js';
import { calculateEventPlayerStatistics } from './event-player-statistics-domain.js';
import type { ResultRow } from './standings-domain.js';
import { resultSourceInvalid } from './standings-domain.js';

interface Snapshot {
  publication_id: string;
  publication_source: unknown;
  group_config: import('@small-city-basketball/contracts').GroupKnockoutConfig;
  seed: string;
  policy: import('@small-city-basketball/contracts').SchedulePolicy;
  round_publications: {
    roundNo: number;
    sources: import('@small-city-basketball/contracts').KnockoutSource[];
  }[];
  proof: ResultRow | null;
  as_of: Date;
}
const iso = (date: Date) => date.toISOString();

export class EventPlayerStatisticsService extends ApplicationService {
  /** Proof, original schedule participants and fixed roster share one PostgreSQL snapshot. */
  private async snapshot(c: PoolClient, org: string, event: string): Promise<Snapshot[]> {
    return (
      await c.query<Snapshot>(
        `SELECT p.id AS publication_id,r.source AS publication_source,r.seed,r.policy,r.group_config,COALESCE((SELECT jsonb_agg(jsonb_build_object('roundNo',k.round_no,'sources',k.sources) ORDER BY k.round_no) FROM knockout_round_publications k WHERE k.org_id=p.org_id AND k.event_id=p.event_id),'[]'::jsonb) AS round_publications,statement_timestamp() AS as_of,
        CASE WHEN m.id IS NULL THEN NULL ELSE to_jsonb(m) || jsonb_build_object(
          'state',to_jsonb(s),'confirmation',to_jsonb(cf),'last_event',to_jsonb(le),
          'last_command',to_jsonb(rc),'scoring_rules',to_jsonb(sr),
          'home_roster',(SELECT jsonb_agg(jsonb_build_object('memberId',rp.member_id,'name',rp.name,'jerseyNo',rp.jersey_no) ORDER BY rp.member_id)
            FROM entry_roster_players rp WHERE rp.org_id=m.org_id AND rp.entry_id=m.home_entry_id AND rp.revision_id=m.home_roster_revision_id),
          'away_roster',(SELECT jsonb_agg(jsonb_build_object('memberId',rp.member_id,'name',rp.name,'jerseyNo',rp.jersey_no) ORDER BY rp.member_id)
            FROM entry_roster_players rp WHERE rp.org_id=m.org_id AND rp.entry_id=m.away_entry_id AND rp.revision_id=m.away_roster_revision_id)
        ) END AS proof
        FROM schedule_publications p
        JOIN schedule_revisions r ON r.org_id=p.org_id AND r.event_id=p.event_id AND r.id=p.revision_id
        LEFT JOIN published_matches m ON m.org_id=p.org_id AND m.event_id=p.event_id AND m.publication_id=p.id
        LEFT JOIN scoring_states s ON s.org_id=m.org_id AND s.match_id=m.id
        LEFT JOIN result_confirmations cf ON cf.org_id=m.org_id AND cf.match_id=m.id AND cf.id=s.latest_confirmation_id
        LEFT JOIN scoring_events le ON le.org_id=m.org_id AND le.match_id=m.id AND le.seq=s.last_event_seq
        LEFT JOIN scoring_commands rc ON rc.org_id=m.org_id AND rc.match_id=m.id AND rc.actor_id=le.actor_id AND rc.command_id=le.command_id
        LEFT JOIN scoring_rulesets sr ON sr.org_id=m.org_id AND sr.event_id=m.event_id AND sr.id=s.ruleset_id
        WHERE p.org_id=$1 AND p.event_id=$2 ORDER BY m.id`,
        [org, event],
      )
    ).rows;
  }

  async getPlayerStatistics(
    cookie: string | undefined,
    orgId: string,
    eventId: string,
  ): Promise<EventPlayerStatisticsData> {
    return this.transaction(async (c) => {
      const actor = await this.lockOrganization(c, await this.lockActor(c, cookie), orgId);
      const event = (
        await c.query<EventRow>(
          `SELECT ${EVENT_SELECT} FROM events e WHERE e.org_id=$1 AND e.id=$2 FOR SHARE OF e`,
          [actor.orgId, resourceId(eventId)],
        )
      ).rows[0];
      if (!event) throw notFound();
      const staff = (
        await c.query<{ role: string }>(
          "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
          [actor.orgId, event.id, actor.user.id],
        )
      ).rows[0];
      // Match-only assignments cannot grant the rest of an event's private roster.
      if (!isAdministrator(actor.role) && !staff) throw notFound();
      const snapshot = await this.snapshot(c, actor.orgId, event.id);
      const first = snapshot[0];
      if (first && snapshot.some((r) => r.publication_id !== first.publication_id))
        resultSourceInvalid();
      const group =
        event.format === 'GROUP_KNOCKOUT' ? await groupEvidence(c, actor.orgId, event.id) : null;
      const summary = first
        ? calculateEventPlayerStatistics({
            publicationId: first.publication_id,
            source: first.publication_source,
            matches: snapshot.flatMap((r) => (r.proof ? [r.proof] : [])),
            asOf: iso(first.as_of),
            format: event.format,
            groupConfig: first.group_config,
            groupRules: group?.rules ?? undefined,
            groupDraws: group?.draws,
            groupQualification: group?.qualification,
            seed: first.seed,
            policy: first.policy,
            roundPublications: first.round_publications,
          })
        : null;
      await this.ensureFreshSession(c, actor);
      return {
        event: {
          id: event.id,
          name: event.name,
          startDate: event.start_date,
          endDate: event.end_date,
          timezone: event.timezone,
          venueName: event.venue_name,
          format: event.format,
          status: event.status,
          version: event.version,
          createdAt: iso(event.created_at),
          updatedAt: iso(event.updated_at),
          permissions: {
            canEditDraft:
              event.status === 'DRAFT' &&
              (isAdministrator(actor.role) || staff?.role === 'EVENT_MANAGER'),
          },
        },
        summary,
      };
    });
  }
}
