import type { KnockoutOptimizationPreview } from '../../../packages/contracts/knockout-optimization.js';
import {
  administrativeResult,
  exceptionResultSelect,
  exceptionResultJoins,
} from './match-exception-domain.js';
import { randomUUID } from 'node:crypto';
import { captureEventMatchNotifications } from './notification-source.js';
import { notificationLeadMinutes } from './notification-runtime.js';
import type { PoolClient } from 'pg';
import type {
  EventKnockoutData,
  KnockoutBracket,
  KnockoutSource,
  ScheduleFixtureData,
} from '@small-city-basketball/contracts';
import { SchedulingService } from './scheduling-service.js';
import type { EventAccess, RevisionRow } from './scheduling-service.js';
import type { OrgActor } from './service.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { invalid, objectInput } from './validation.js';
import { expectedVersion } from './registration-validation.js';
import { calculateKnockout } from './knockout-domain.js';
import { parseAllocationInput, validateSchedule } from './scheduling-domain.js';
import type { ResultRow } from './standings-domain.js';

const fail = (code: string, message: string): never => {
  throw new ApiError(409, code, message);
};

/** Publishes only original match facts. Bracket state is always a read projection. */
export class KnockoutService extends SchedulingService {
  protected async resultRows(c: PoolClient, org: string, event: string): Promise<ResultRow[]> {
    return (
      await c.query<ResultRow>(
        `SELECT m.*,${exceptionResultSelect},to_jsonb(s) AS state,to_jsonb(cf) AS confirmation,to_jsonb(le) AS last_event,to_jsonb(rc) AS last_command,to_jsonb(sr) AS scoring_rules
       FROM published_matches m
       LEFT JOIN scoring_states s ON s.org_id=m.org_id AND s.match_id=m.id
       LEFT JOIN result_confirmations cf ON cf.org_id=m.org_id AND cf.match_id=m.id AND cf.id=s.latest_confirmation_id
       LEFT JOIN scoring_events le ON le.org_id=m.org_id AND le.match_id=m.id AND le.seq=s.last_event_seq
       LEFT JOIN scoring_commands rc ON rc.org_id=m.org_id AND rc.match_id=m.id AND rc.actor_id=le.actor_id AND rc.command_id=le.command_id
       LEFT JOIN scoring_rulesets sr ON sr.org_id=m.org_id AND sr.event_id=m.event_id AND sr.id=s.ruleset_id
       ${exceptionResultJoins} WHERE m.org_id=$1 AND m.event_id=$2 ORDER BY m.round_no,m.position_no`,
        [org, event],
      )
    ).rows;
  }
  protected async view(c: PoolClient, ctx: OrgActor, event: EventAccess) {
    if (event.row.format !== 'SINGLE_ELIMINATION')
      throw new ApiError(422, 'UNSUPPORTED_EVENT_FORMAT', '仅单淘汰赛事有淘汰签位');
    const publication = await this.publication(c, ctx.orgId, event.row.id);
    const revision = event.row.current_schedule_revision_id
      ? (
          await c.query<RevisionRow>(
            'SELECT * FROM schedule_revisions WHERE org_id=$1 AND event_id=$2 AND id=$3',
            [ctx.orgId, event.row.id, event.row.current_schedule_revision_id],
          )
        ).rows[0]
      : null;
    const matches = await this.resultRows(c, ctx.orgId, event.row.id);
    const now = (
      await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')
    ).rows[0]!.now.toISOString();
    let bracket: KnockoutBracket | null = null;
    if (publication) {
      if (
        !revision ||
        revision.status !== 'PUBLISHED' ||
        revision.algorithm_version !== 'SE_SEEDED_V1'
      )
        fail('RESULT_SOURCE_INVALID', '淘汰赛正式来源无法核验');
      const roundPublications = (
        await c.query<{ round_no: number; sources: KnockoutSource[] }>(
          'SELECT round_no,sources FROM knockout_round_publications WHERE org_id=$1 AND event_id=$2 ORDER BY round_no',
          [ctx.orgId, event.row.id],
        )
      ).rows.map((row) => ({ roundNo: row.round_no, sources: row.sources }));
      bracket = calculateKnockout({
        roundPublications,
        publicationId: publication.id,
        source: revision!.source,
        seed: revision!.seed,
        policy: revision!.policy,
        matches,
        asOf: now,
      });
    }
    const response: EventKnockoutData = {
      event: this.dtoEvent(event),
      publicationId: publication?.id ?? null,
      participants:
        revision?.source.entries.map(({ entryId, teamId, teamName, rosterRevisionId }) => ({
          entryId,
          teamId,
          teamName,
          rosterRevisionId,
        })) ?? [],
      bracket,
      capabilities: {
        canPublishNextRound:
          event.canManage &&
          ['SCHEDULED', 'RUNNING'].includes(event.row.status) &&
          !!bracket?.nextRound,
      },
    };
    return { response, revision, matches, publication, nextRound: bracket?.nextRound ?? null };
  }
  async getKnockout(
    cookie: string | undefined,
    org: string,
    id: string,
  ): Promise<EventKnockoutData> {
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const event = await this.event(c, ctx, id, false);
      const { response } = await this.view(c, ctx, event);
      await this.ensureFreshSession(c, ctx);
      return response;
    });
  }
  /** Read-only suggestion over genuine qualified entrants. Publish replays all source proofs. */
  async previewNextRoundOptimization(
    cookie: string | undefined,
    org: string,
    id: string,
    raw: unknown,
  ): Promise<KnockoutOptimizationPreview> {
    const input = objectInput(raw, ['expectedEventVersion', 'expectedSourceHash']);
    const expected = expectedVersion(input.expectedEventVersion);
    if (
      input.expectedSourceHash !== undefined &&
      (typeof input.expectedSourceHash !== 'string' ||
        !/^[0-9a-f]{64}$/.test(input.expectedSourceHash))
    )
      invalid('晋级来源摘要无效');
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org),
        event = await this.event(c, ctx, id, false);
      if (!event.canManage) throw forbidden();
      if (event.row.version !== expected) fail('VERSION_CONFLICT', '赛事已更新，请重新读取');
      if (!['SCHEDULED', 'RUNNING'].includes(event.row.status))
        fail('INVALID_EVENT_STATE', '当前赛事不可安排晋级轮次');
      const { revision, nextRound: next } = await this.view(c, ctx, event);
      if (!next) {
        await this.ensureFreshSession(c, ctx);
        return {
          status: 'WAITING_FOR_RESULTS',
          eventVersion: event.row.version,
          revisionVersion: revision?.version ?? null,
        };
      }
      if (!revision || revision.status !== 'PUBLISHED')
        fail('RESULT_SOURCE_INVALID', '正式排赛来源无法核验');
      if (next.sourceHash !== input.expectedSourceHash)
        fail('KNOCKOUT_SOURCE_CONFLICT', '晋级来源已更新，请重新读取签位');
      const optimization = await this.optimizeFixturePlan(c, ctx, event, revision!, next.fixtures, {
        preserveAssigned: false,
      });
      return {
        status: 'READY',
        eventVersion: event.row.version,
        revisionVersion: revision!.version,
        sourceHash: next.sourceHash,
        roundNo: next.roundNo,
        optimization,
      };
    });
  }
  protected async publishRound(
    cookie: string | undefined,
    org: string,
    id: string,
    raw: unknown,
    qualification = false,
  ): Promise<EventKnockoutData> {
    const input = objectInput(raw, [
      'type',
      'expectedEventVersion',
      'expectedSourceHash',
      'roundNo',
      'reason',
      'allocations',
    ]);
    if (input.type !== (qualification ? 'PUBLISH_QUALIFICATION' : 'PUBLISH_ROUND'))
      invalid('不支持的淘汰赛命令');
    const version = expectedVersion(input.expectedEventVersion);
    if (
      typeof input.expectedSourceHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(input.expectedSourceHash)
    )
      invalid('晋级来源摘要无效');
    if (
      !qualification &&
      (!Number.isInteger(input.roundNo) || Number(input.roundNo) < 2 || Number(input.roundNo) > 31)
    )
      invalid('淘汰轮次无效');
    if (typeof input.reason !== 'string' || input.reason.includes('\u0000'))
      invalid('请填写发布原因');
    const reason = (input.reason as string).trim();
    if (Array.from(reason).length < 4 || Array.from(reason).length > 500)
      invalid('发布原因须为4–500个字符');
    try {
      return await this.transaction(async (c) => {
        const ctx = await this.context(c, cookie, org);
        await this.mutex(c, ctx.orgId);
        const event = await this.event(c, ctx, id, true);
        if (!event.canManage) throw forbidden();
        if (event.row.version !== version)
          throw new ApiError(409, 'VERSION_CONFLICT', '赛事已更新，请重新读取后再操作', {
            currentVersion: event.row.version,
          });
        if (!['SCHEDULED', 'RUNNING'].includes(event.row.status))
          fail('INVALID_EVENT_STATE', '当前赛事不能发布晋级轮次');
        const { revision, matches, publication, nextRound: next } = await this.view(c, ctx, event);
        if (!next || !revision || !publication)
          fail('KNOCKOUT_ROUND_NOT_READY', '请先完成上一轮全部比赛的独立确认');
        if (
          (!qualification && next!.roundNo !== input.roundNo) ||
          next!.sourceHash !== input.expectedSourceHash
        )
          fail('KNOCKOUT_SOURCE_CONFLICT', '晋级来源已更新，请重新读取签位后再发布');
        const allocations = parseAllocationInput(
          input.allocations,
          next!.fixtures.map((f) => f.fixtureKey),
          revision!.policy.slotDurationMinutes,
        );
        if (allocations.some((a) => !a.courtId || !a.startsAt))
          invalid('本轮每场比赛均须分配场地和时间');
        const allocated = new Map(allocations.map((a) => [a.fixtureKey, a]));
        const fixtures = next!.fixtures.map((f) => ({ ...f, ...allocated.get(f.fixtureKey)! }));
        const allFixtures: ScheduleFixtureData[] = matches
          .map((m) => ({
            fixtureKey: m.fixture_key,
            roundNo: m.round_no,
            positionNo: m.position_no,
            homeEntryId: m.home_entry_id,
            awayEntryId: m.away_entry_id,
            courtId: m.court_id,
            startsAt: m.starts_at.toISOString(),
            endsAt: m.ends_at.toISOString(),
          }))
          .concat(fixtures);
        const parentMatches = next!.sources.map((source) =>
          matches.find((m) => m.id === source.matchId)!,
        );
        for (const f of fixtures)
          for (const entry of [f.homeEntryId, f.awayEntryId]) {
            if (
              parentMatches.some(
                (parent) =>
                  (parent.home_entry_id === entry || parent.away_entry_id === entry) &&
                  Date.parse(f.startsAt!) < parent.ends_at.getTime(),
              )
            )
              fail('KNOCKOUT_DEPENDENCY_ORDER', '晋级比赛不能早于所有来源比赛结束');
          }
        const courts = await this.courts(c, ctx.orgId, [
          ...revision!.policy.courtWindows.map((w) => w.courtId),
          ...allFixtures.map((f) => f.courtId!),
        ]);
        const booked = (
          await c.query<{
            kind: 'COURT' | 'TEAM';
            resource_id: string;
            starts_at: Date;
            ends_at: Date;
          }>(
            `SELECT 'COURT' AS kind,court_id AS resource_id,starts_at,ends_at FROM court_reservations WHERE org_id=$1 AND publication_id<>$2 AND starts_at<$4::timestamptz+$5::double precision*interval '1 millisecond' AND ends_at>$3::timestamptz-$5::double precision*interval '1 millisecond'
           UNION ALL SELECT 'TEAM' AS kind,team_id AS resource_id,starts_at,ends_at FROM team_reservations WHERE org_id=$1 AND publication_id<>$2 AND starts_at<$4::timestamptz+$5::double precision*interval '1 millisecond' AND ends_at>$3::timestamptz-$5::double precision*interval '1 millisecond'`,
            [
              ctx.orgId,
              publication!.id,
              ...[
                fixtures.map((f) => f.startsAt!).sort()[0],
                fixtures
                  .map((f) => f.endsAt!)
                  .sort()
                  .at(-1),
              ],
              Math.max(
                revision!.policy.minRestMinutes * 60000,
                (revision!.policy.minLocalDayGap + 1) * 86400000,
              ),
            ],
          )
        ).rows;
        const conflicts = validateSchedule({
          event: {
            id: event.row.id,
            startDate: event.row.start_date,
            endDate: event.row.end_date,
            timezone: event.row.timezone,
          },
          freeze: revision!.source,
          policy: revision!.policy,
          fixtures: allFixtures,
          courts,
          reservations: booked
            .map((r) => ({
              kind: r.kind,
              resourceId: r.resource_id,
              startsAt: r.starts_at.toISOString(),
              endsAt: r.ends_at.toISOString(),
            }))
            .concat(
              await this.localReservations(
                c,
                [
                  ...courts.map((court) => 'court:' + court.id),
                  ...revision!.source.entries.map((entry) => 'team:' + entry.teamId),
                ],
                fixtures.map((f) => f.startsAt!).sort()[0]!,
                fixtures
                  .map((f) => f.endsAt!)
                  .sort()
                  .at(-1)!,
                Math.max(
                  revision!.policy.minRestMinutes * 60000,
                  (revision!.policy.minLocalDayGap + 1) * 86400000,
                ),
              ),
            ),
        });
        // Past unrelated conflicts must not block a new round, but every new fixture is checked.
        const keys = new Set(fixtures.map((f) => f.fixtureKey));
        const relevant = conflicts.filter((conflict) =>
          conflict.fixtureKeys.some((key) => keys.has(key)),
        );
        if (relevant.length)
          throw new ApiError(409, 'SCHEDULE_CONFLICT', '晋级轮次安排存在冲突', {
            conflicts: relevant,
          });
        const names = new Map(courts.map((court) => [court.id, court.name]));
        const entries = new Map(revision!.source.entries.map((entry) => [entry.entryId, entry]));
        const proofFixtures = fixtures.map((f) => {
          const home = entries.get(f.homeEntryId),
            away = entries.get(f.awayEntryId);
          if (!home || !away) throw notFound();
          return {
            ...f,
            matchId: randomUUID(),
            homeTeamId: home.teamId,
            awayTeamId: away.teamId,
            homeTeamName: home.teamName,
            awayTeamName: away.teamName,
            homeRosterRevisionId: home.rosterRevisionId,
            awayRosterRevisionId: away.rosterRevisionId,
            courtName: names.get(f.courtId!),
          };
        });
        await this.ensureFreshSession(c, ctx);
        const proofId = randomUUID();
        await this.persistRoundProof(
          c,
          ctx,
          event,
          revision!,
          publication!.id,
          next!,
          proofFixtures,
          proofId,
          reason,
          qualification,
        );
        for (const f of proofFixtures) {
          await c.query(
            `INSERT INTO schedule_fixtures(org_id,event_id,revision_id,fixture_key,round_no,position_no,home_entry_id,away_entry_id,home_team_id,away_team_id,court_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              ctx.orgId,
              id,
              revision!.id,
              f.fixtureKey,
              f.roundNo,
              f.positionNo,
              f.homeEntryId,
              f.awayEntryId,
              f.homeTeamId,
              f.awayTeamId,
              f.courtId,
              f.startsAt,
              f.endsAt,
            ],
          );
          await c.query(
            `INSERT INTO published_matches(id,org_id,event_id,publication_id,revision_id,fixture_key,round_no,position_no,home_entry_id,away_entry_id,home_team_id,away_team_id,home_team_name,away_team_name,home_roster_revision_id,away_roster_revision_id,court_id,court_name,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
            [
              f.matchId,
              ctx.orgId,
              id,
              publication!.id,
              revision!.id,
              f.fixtureKey,
              f.roundNo,
              f.positionNo,
              f.homeEntryId,
              f.awayEntryId,
              f.homeTeamId,
              f.awayTeamId,
              f.homeTeamName,
              f.awayTeamName,
              f.homeRosterRevisionId,
              f.awayRosterRevisionId,
              f.courtId,
              f.courtName,
              f.startsAt,
              f.endsAt,
            ],
          );
          await c.query(
            'INSERT INTO court_reservations(org_id,publication_id,match_id,court_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)',
            [ctx.orgId, publication!.id, f.matchId, f.courtId, f.startsAt, f.endsAt],
          );
          for (const team of [f.homeTeamId, f.awayTeamId])
            await c.query(
              'INSERT INTO team_reservations(org_id,publication_id,match_id,team_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)',
              [ctx.orgId, publication!.id, f.matchId, team, f.startsAt, f.endsAt],
            );
        }
        await c.query(
          "UPDATE public_event_publications SET revoked_at=clock_timestamp(),revoked_by=$3 WHERE org_id=$1 AND event_id=$2 AND revoked_at IS NULL AND purpose='LIVE'",
          [ctx.orgId, id, ctx.user.id],
        );
        await c.query(
          'UPDATE events SET version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
          [ctx.orgId, id],
        );
        await this.audit(
          c,
          ctx.user.id,
          ctx.orgId,
          qualification ? 'GROUP_QUALIFICATION_PUBLISHED' : 'KNOCKOUT_ROUND_PUBLISHED',
          'event',
          id,
          {
            proofId,
            roundNo: next!.roundNo,
            sourceHash: next!.sourceHash,
            reason,
          },
        );
        const response = (await this.view(c, ctx, await this.event(c, ctx, id, false))).response;
        await captureEventMatchNotifications(
          c,
          ctx.orgId,
          id,
          notificationLeadMinutes(this.options),
        );
        await this.ensureFreshSession(c, ctx);
        return response;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23P01')
        throw new ApiError(409, 'SCHEDULE_CONFLICT', '场地或球队占用已变化，请重新读取', {
          conflicts: [],
        });
      throw error;
    }
  }
  async publishKnockoutRound(
    cookie: string | undefined,
    org: string,
    id: string,
    raw: unknown,
  ): Promise<EventKnockoutData> {
    return this.publishRound(cookie, org, id, raw, false);
  }
  protected async persistRoundProof(
    c: PoolClient,
    ctx: OrgActor,
    event: EventAccess,
    revision: RevisionRow,
    publicationId: string,
    next: NonNullable<KnockoutBracket['nextRound']>,
    fixtures: unknown[],
    proofId: string,
    reason: string,
    qualification: boolean,
  ) {
    if (qualification) fail('UNSUPPORTED_EVENT_FORMAT', '仅分组赛事可发布晋级资格');
    await c.query(
      `INSERT INTO knockout_round_publications(id,org_id,event_id,publication_id,revision_id,round_no,from_event_version,to_event_version,source_hash,sources,fixtures,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7+1,$8,$9::jsonb,$10::jsonb,$11,$12)`,
      [
        proofId,
        ctx.orgId,
        event.row.id,
        publicationId,
        revision.id,
        next.roundNo,
        event.row.version,
        next.sourceHash,
        JSON.stringify(next.sources),
        JSON.stringify(fixtures),
        reason,
        ctx.user.id,
      ],
    );
  }
}
