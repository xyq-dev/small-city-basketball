import { exceptionResultJoins } from './match-exception-domain.js';
import { randomUUID } from 'node:crypto';
import { seasonPage, seasonCursor } from './season-pagination.js';
import type { PoolClient } from 'pg';
import type {
  EventSeasonGrantsData,
  MySeasonDataGrantsData,
  MySeasonStatisticsData,
  OrgRole,
  SeasonData,
  SeasonDataGrantData,
  SeasonDetailData,
  SeasonGrantStatus,
  SeasonStatisticsData,
  SeasonStatisticsSummary,
} from '@small-city-basketball/contracts';
import { ApplicationService, isAdministrator } from './service.js';
import type { Actor, DbUser, OrgActor } from './service.js';
import { ApiError, forbidden, notFound, unauthenticated } from './errors.js';
import { hashToken, readSessionToken } from './security.js';
import { objectInput, resourceId } from './validation.js';
import { groupEvidence } from './group-knockout-repository.js';
import { calculateEventPlayerStatistics } from './event-player-statistics-domain.js';
import type { ResultRow } from './standings-domain.js';
import {
  DISCLOSURE,
  MAX_SEASON_EVENTS,
  aggregateSeason,
  createSeasonInput,
  eventWithinSeason,
  grantCommandInput,
  grantTransition,
  ineffectiveReasons,
  nominateInput,
  requestHash,
  seasonCommandInput,
  seasonCommandTarget,
  seasonFail,
  teamsByEntry,
  updateSeasonInput,
  upstreamValid,
  versionConflict,
  withdrawInput,
} from './season-domain.js';
import type { EffectiveGrant, GrantConditions, SeasonEventInput } from './season-domain.js';

type Row = Record<string, any>;
const iso = (value: Date | string | null | undefined) =>
  value == null ? null : new Date(value).toISOString();

const SEASON_SELECT = `s.*, s.start_date::text AS start_date, s.end_date::text AS end_date`;
/** Current nominating power of the grant's nominator (OWNER/ADMIN or that event's EVENT_MANAGER). */
const NOMINATOR_POWER = `(nu.status='ACTIVE' AND EXISTS(SELECT 1 FROM organization_memberships pm WHERE pm.org_id=g.org_id AND pm.user_id=g.nominated_by AND pm.status='ACTIVE' AND (pm.role IN ('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff ps WHERE ps.org_id=g.org_id AND ps.event_id=g.event_id AND ps.user_id=g.nominated_by AND ps.status='ACTIVE' AND ps.role='EVENT_MANAGER'))))`;
/** Every condition is evaluated in the reading statement itself; nothing is cached. */
const GRANT_SELECT = `
SELECT g.*, o.name AS org_name, (o.status='ACTIVE') AS organization_active,
  e.name AS event_name, t.name AS team_name, tm.name AS member_name,
  tu.display_name AS target_display_name, (tu.status='ACTIVE') AS target_active,
  nu.display_name AS nominator_display_name,
  EXISTS(SELECT 1 FROM team_member_bindings b WHERE b.id=g.binding_id AND b.org_id=g.org_id AND b.team_id=g.team_id AND b.member_id=g.member_id AND b.user_id=g.target_user_id AND b.status='ACTIVE') AS binding_active,
  ${NOMINATOR_POWER} AS nominator_authorized,
  EXISTS(SELECT 1 FROM registration_freezes f WHERE f.org_id=g.org_id AND f.event_id=g.event_id AND f.snapshot->'entries' @> jsonb_build_array(jsonb_build_object('teamId',g.team_id::text,'players',jsonb_build_array(jsonb_build_object('memberId',g.member_id::text))))) AS source_frozen,
  s.id AS season_id, s.name AS season_name, s.status AS season_status
FROM season_data_grants g
JOIN organizations o ON o.id=g.org_id
JOIN events e ON e.org_id=g.org_id AND e.id=g.event_id
JOIN teams t ON t.org_id=g.org_id AND t.id=g.team_id
JOIN team_members tm ON tm.org_id=g.org_id AND tm.team_id=g.team_id AND tm.id=g.member_id
JOIN users tu ON tu.id=g.target_user_id
JOIN users nu ON nu.id=g.nominated_by
LEFT JOIN season_events se ON se.org_id=g.org_id AND se.event_id=g.event_id AND se.status='ACTIVE'
LEFT JOIN seasons s ON s.org_id=se.org_id AND s.id=se.season_id`;

/** The private per-event proof, identical to EventPlayerStatisticsService's snapshot query. */
const EVENT_PROOF = `SELECT p.id AS publication_id,r.source AS publication_source,r.seed,r.policy,r.group_config,COALESCE((SELECT jsonb_agg(jsonb_build_object('roundNo',k.round_no,'sources',k.sources) ORDER BY k.round_no) FROM knockout_round_publications k WHERE k.org_id=p.org_id AND k.event_id=p.event_id),'[]'::jsonb) AS round_publications,
  CASE WHEN m.id IS NULL THEN NULL ELSE to_jsonb(m) || jsonb_build_object(
    'state',to_jsonb(s),'confirmation',to_jsonb(cf),'last_event',to_jsonb(le),
    'last_command',to_jsonb(rc),'scoring_rules',to_jsonb(sr),
    'exception_checked',true,'exception_head',to_jsonb(xh),'exception_request',to_jsonb(xr),'exception_rules',to_jsonb(xrules),
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
  ${exceptionResultJoins}
  WHERE p.org_id=$1 AND p.event_id=$2 ORDER BY m.id`;

function conditions(row: Row): GrantConditions {
  return {
    status: row.status,
    bindingActive: row.binding_active === true,
    nominatorAuthorized: row.nominator_authorized === true,
    sourceFrozen: row.source_frozen === true,
    targetActive: row.target_active === true,
    organizationActive: row.organization_active === true,
    invalidationReason: row.invalidation_reason ?? null,
  };
}
const effective = (row: Row) => ineffectiveReasons(conditions(row)).length === 0;

/**
 * C19 §5: organization-level private seasons and the independent PRIVATE_SEASON data grant.
 * Writes run in the inherited READ COMMITTED transaction with the usual lock order and same-
 * transaction audit; every read runs in one REPEATABLE READ READ ONLY snapshot so the returned
 * sourceHash and figures describe exactly one database state.
 */
export class SeasonService extends ApplicationService {
  // ---------- shared reading helpers ----------

  /** One consistent snapshot for a whole read; plain reads only (no row locks). */
  private async snapshotRead<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await work(c);
      await c.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await c.query('ROLLBACK');
      } catch {
        /* Preserve the original failure. */
      }
      throw error;
    } finally {
      c.release();
    }
  }
  private async readActor(c: PoolClient, cookie?: string): Promise<Actor> {
    const token = readSessionToken(cookie);
    if (!token) throw unauthenticated();
    const row = (
      await c.query<Row>(
        'SELECT s.id AS session_id,u.id,u.email,u.display_name,u.password_hash,u.status FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()',
        [hashToken(token)],
      )
    ).rows[0];
    if (!row || row.status !== 'ACTIVE') throw unauthenticated();
    const user: DbUser = {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      password_hash: row.password_hash,
      status: row.status,
    };
    return { sessionId: row.session_id, user };
  }
  private async readOrganization(c: PoolClient, actor: Actor, orgId: string): Promise<OrgActor> {
    const id = resourceId(orgId);
    const row = (
      await c.query<{ role: OrgRole }>(
        "SELECT m.role FROM organizations o JOIN organization_memberships m ON m.org_id=o.id AND m.user_id=$2 AND m.status='ACTIVE' WHERE o.id=$1 AND o.status='ACTIVE'",
        [id, actor.user.id],
      )
    ).rows[0];
    if (!row) throw notFound();
    return { ...actor, orgId: id, role: row.role };
  }
  /** Seasons are organization-level: only OWNER/ADMIN; other members 403, outsiders 404. */
  private requireAdministrator(actor: OrgActor) {
    if (!isAdministrator(actor.role)) throw forbidden();
  }
  private async seasonEvents(c: PoolClient, orgId: string, seasonId: string) {
    return (
      await c.query<Row>(
        `SELECT se.event_id,se.attached_at,e.name,e.start_date::text AS start_date,e.end_date::text AS end_date,e.status,e.format
        FROM season_events se JOIN events e ON e.org_id=se.org_id AND e.id=se.event_id
        WHERE se.org_id=$1 AND se.season_id=$2 AND se.status='ACTIVE' ORDER BY e.start_date,e.id`,
        [orgId, seasonId],
      )
    ).rows;
  }
  private seasonDto(row: Row, events: Row[]): SeasonData {
    const open = row.status !== 'CLOSED';
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status,
      version: row.version,
      activatedAt: iso(row.activated_at),
      closedAt: iso(row.closed_at),
      createdAt: iso(row.created_at)!,
      updatedAt: iso(row.updated_at)!,
      events: events.map((e) => ({
        eventId: e.event_id,
        name: e.name,
        startDate: e.start_date,
        endDate: e.end_date,
        status: e.status,
        attachedAt: iso(e.attached_at)!,
      })),
      capabilities: {
        canEdit: open,
        canActivate: row.status === 'DRAFT',
        canClose: row.status === 'ACTIVE',
      },
    };
  }
  private async seasonRow(c: PoolClient, orgId: string, seasonId: string, lock = '') {
    const row = (
      await c.query<Row>(
        `SELECT ${SEASON_SELECT} FROM seasons s WHERE s.org_id=$1 AND s.id=$2 ${lock}`,
        [orgId, resourceId(seasonId)],
      )
    ).rows[0];
    if (!row) throw notFound();
    return row;
  }
  private async seasonDetail(
    c: PoolClient,
    orgId: string,
    seasonId: string,
    page = seasonPage({}, 'DATE'),
  ): Promise<SeasonDetailData> {
    const row = await this.seasonRow(c, orgId, seasonId);
    const events = await this.seasonEvents(c, orgId, row.id);
    const candidates =
      row.status === 'CLOSED'
        ? []
        : (
            await c.query<Row>(
              `SELECT e.id,e.name,e.start_date::text AS start_date,e.end_date::text AS end_date,e.status FROM events e
              WHERE e.org_id=$1 AND e.start_date>=$2::date AND e.end_date<=$3::date
                AND NOT EXISTS(SELECT 1 FROM season_events se WHERE se.event_id=e.id AND se.status='ACTIVE')
                AND ($4::date IS NULL OR (e.start_date,e.id)>($4::date,$5::uuid))
              ORDER BY e.start_date,e.id LIMIT $6`,
              [
                orgId,
                row.start_date,
                row.end_date,
                page.cursor?.at ?? null,
                page.cursor?.id ?? null,
                page.limit + 1,
              ],
            )
          ).rows;
    return {
      ...this.seasonDto(row, events),
      candidateNextCursor:
        candidates.length > page.limit
          ? seasonCursor(candidates[page.limit - 1]!.start_date, candidates[page.limit - 1]!.id)
          : null,
      candidates: candidates.slice(0, page.limit).map((e) => ({
        eventId: e.id,
        name: e.name,
        startDate: e.start_date,
        endDate: e.end_date,
        status: e.status,
      })),
    };
  }

  // ---------- grant reading ----------

  private grantDto(row: Row, viewer: { userId: string; manages: boolean }): SeasonDataGrantData {
    const c = conditions(row);
    const reasons = ineffectiveReasons(c);
    const own = row.target_user_id === viewer.userId;
    const showSeason = Boolean(
      row.season_id && (viewer.manages || (row.season_status && row.season_status !== 'DRAFT')),
    );
    return {
      id: row.id,
      purpose: 'PRIVATE_SEASON',
      orgId: row.org_id,
      orgName: row.org_name,
      eventId: row.event_id,
      eventName: row.event_name,
      teamId: row.team_id,
      teamName: row.team_name,
      memberId: row.member_id,
      memberName: row.member_name,
      targetUserId: row.target_user_id,
      targetDisplayName: row.target_display_name,
      nominatedByDisplayName: row.nominator_display_name,
      status: row.status,
      version: row.version,
      nominateReason: row.nominate_reason,
      withdrawReason: row.withdraw_reason ?? null,
      createdAt: iso(row.created_at)!,
      consentedAt: iso(row.consented_at),
      declinedAt: iso(row.declined_at),
      revokedAt: iso(row.revoked_at),
      withdrawnAt: iso(row.withdrawn_at),
      invalidatedAt: iso(row.invalidated_at),
      invalidationReason: row.invalidation_reason ?? null,
      effective: reasons.length === 0,
      ineffectiveReasons: reasons,
      season: showSeason
        ? { id: row.season_id, name: row.season_name, status: row.season_status }
        : null,
      capabilities: {
        canConsent: own && row.status === 'PENDING' && upstreamValid(c),
        canDecline: own && row.status === 'PENDING',
        canRevoke: own && row.status === 'ACTIVE',
        canWithdraw: viewer.manages && (row.status === 'PENDING' || row.status === 'ACTIVE'),
      },
    };
  }
  private async grantRow(c: PoolClient, grantId: string) {
    return (await c.query<Row>(`${GRANT_SELECT} WHERE g.id=$1`, [grantId])).rows[0];
  }
  /** OWNER/ADMIN of the organization or an ACTIVE EVENT_MANAGER of this event, right now. */
  private async nominatingPower(c: PoolClient, actor: OrgActor, eventId: string, lock = '') {
    if (isAdministrator(actor.role)) return true;
    return Boolean(
      (
        await c.query(
          `SELECT 1 FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' AND role='EVENT_MANAGER' ${lock}`,
          [actor.orgId, eventId, actor.user.id],
        )
      ).rowCount,
    );
  }

  // ---------- seasons ----------

  async listSeasons(
    cookie: string | undefined,
    orgId: string,
    raw: unknown = {},
  ): Promise<{ seasons: SeasonData[]; nextCursor: string | null }> {
    const { limit, cursor } = seasonPage(raw, 'DATE');
    return this.snapshotRead(async (c) => {
      const actor = await this.readOrganization(c, await this.readActor(c, cookie), orgId);
      this.requireAdministrator(actor);
      const rows = (
        await c.query<Row>(
          `SELECT ${SEASON_SELECT} FROM seasons s WHERE s.org_id=$1
          AND ($2::date IS NULL OR (s.start_date,s.id)<($2::date,$3::uuid))
          ORDER BY s.start_date DESC,s.id DESC LIMIT $4`,
          [actor.orgId, cursor?.at ?? null, cursor?.id ?? null, limit + 1],
        )
      ).rows;
      const page = rows.slice(0, limit);
      const result: SeasonData[] = [];
      for (const row of page)
        result.push(this.seasonDto(row, await this.seasonEvents(c, actor.orgId, row.id)));
      const last = page.at(-1);
      return {
        seasons: result,
        nextCursor: rows.length > limit && last ? seasonCursor(last.start_date, last.id) : null,
      };
    });
  }
  async getSeason(
    cookie: string | undefined,
    orgId: string,
    seasonId: string,
    raw: unknown = {},
  ): Promise<SeasonDetailData> {
    const query = objectInput(raw ?? {}, ['candidateLimit', 'candidateCursor']);
    const page = seasonPage(
      {
        ...(query.candidateLimit === undefined ? {} : { limit: query.candidateLimit }),
        ...(query.candidateCursor === undefined ? {} : { cursor: query.candidateCursor }),
      },
      'DATE',
    );
    return this.snapshotRead(async (c) => {
      const actor = await this.readOrganization(c, await this.readActor(c, cookie), orgId);
      this.requireAdministrator(actor);
      return this.seasonDetail(c, actor.orgId, seasonId, page);
    });
  }
  async createSeason(
    cookie: string | undefined,
    orgId: string,
    raw: unknown,
  ): Promise<{ season: SeasonDetailData; created: boolean }> {
    const input = createSeasonInput(raw);
    const hash = requestHash(['v1', 'SEASON_CREATE', input]);
    return this.transaction(async (c) => {
      const actor = await this.lockOrganization(c, await this.lockActor(c, cookie), orgId);
      this.requireAdministrator(actor);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `scb-season-create:${actor.orgId}:${actor.user.id}:${input.clientRequestId}`,
      ]);
      const previous = (
        await c.query<Row>(
          'SELECT id,request_hash FROM seasons WHERE org_id=$1 AND created_by=$2 AND client_request_id=$3',
          [actor.orgId, actor.user.id, input.clientRequestId],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== hash)
          seasonFail(409, 'IDEMPOTENCY_CONFLICT', '请求编号已用于不同的赛季内容');
        await this.ensureFreshSession(c, actor);
        return { season: await this.seasonDetail(c, actor.orgId, previous.id), created: false };
      }
      const id = randomUUID();
      await c.query(
        'INSERT INTO seasons(id,org_id,name,start_date,end_date,created_by,client_request_id,request_hash) VALUES($1,$2,$3,$4::date,$5::date,$6,$7,$8)',
        [
          id,
          actor.orgId,
          input.name,
          input.startDate,
          input.endDate,
          actor.user.id,
          input.clientRequestId,
          hash,
        ],
      );
      await this.audit(c, actor.user.id, actor.orgId, 'SEASON_CREATED', 'season', id, {
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate,
        clientRequestId: input.clientRequestId,
      });
      await this.ensureFreshSession(c, actor);
      return { season: await this.seasonDetail(c, actor.orgId, id), created: true };
    });
  }
  async updateSeason(
    cookie: string | undefined,
    orgId: string,
    seasonId: string,
    raw: unknown,
  ): Promise<SeasonDetailData> {
    objectInput(raw, ['expectedVersion', 'name', 'startDate', 'endDate']);
    return this.transaction(async (c) => {
      const actor = await this.lockOrganization(c, await this.lockActor(c, cookie), orgId);
      this.requireAdministrator(actor);
      const current = await this.seasonRow(c, actor.orgId, seasonId);
      // Lock order: events before this module's rows. CAS below detects a concurrent attach.
      const attached = (
        await c.query<Row>(
          `SELECT e.id,e.start_date::text AS start_date,e.end_date::text AS end_date FROM season_events se
          JOIN events e ON e.org_id=se.org_id AND e.id=se.event_id
          WHERE se.org_id=$1 AND se.season_id=$2 AND se.status='ACTIVE' ORDER BY e.id FOR SHARE OF e`,
          [actor.orgId, current.id],
        )
      ).rows;
      const season = await this.seasonRow(c, actor.orgId, current.id, 'FOR UPDATE');
      const input = updateSeasonInput(raw, {
        name: season.name,
        startDate: season.start_date,
        endDate: season.end_date,
      });
      if (season.status === 'CLOSED')
        seasonFail(409, 'SEASON_CLOSED', '赛季已关闭，配置和赛事归属已锁定');
      if (season.version !== input.expectedVersion) versionConflict(season.version);
      if (
        attached.some(
          (e) => !eventWithinSeason({ startDate: e.start_date, endDate: e.end_date }, input),
        )
      )
        seasonFail(422, 'SEASON_RANGE_EXCLUDES_EVENT', '新的赛季日期必须覆盖所有已归入赛事的日期');
      await c.query(
        'UPDATE seasons SET name=$3,start_date=$4::date,end_date=$5::date,version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
        [actor.orgId, season.id, input.name, input.startDate, input.endDate],
      );
      await this.audit(c, actor.user.id, actor.orgId, 'SEASON_UPDATED', 'season', season.id, {
        fromVersion: season.version,
        toVersion: season.version + 1,
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate,
      });
      await this.ensureFreshSession(c, actor);
      return this.seasonDetail(c, actor.orgId, season.id);
    });
  }
  async seasonCommand(
    cookie: string | undefined,
    orgId: string,
    seasonId: string,
    raw: unknown,
  ): Promise<SeasonDetailData> {
    const input = seasonCommandInput(raw);
    try {
      return await this.transaction(async (c) => {
        const actor = await this.lockOrganization(c, await this.lockActor(c, cookie), orgId);
        this.requireAdministrator(actor);
        let event: Row | undefined;
        if (input.eventId) {
          event = (
            await c.query<Row>(
              'SELECT e.id,e.name,e.start_date::text AS start_date,e.end_date::text AS end_date FROM events e WHERE e.org_id=$1 AND e.id=$2 FOR SHARE',
              [actor.orgId, input.eventId],
            )
          ).rows[0];
          if (!event) throw notFound();
        }
        const season = await this.seasonRow(c, actor.orgId, seasonId, 'FOR UPDATE');
        const target = seasonCommandTarget(season.status, input.type);
        if (season.version !== input.expectedVersion) versionConflict(season.version);
        const metadata: Record<string, unknown> = {
          fromVersion: season.version,
          toVersion: season.version + 1,
          previousStatus: season.status,
          nextStatus: target,
        };
        if (input.type === 'ATTACH_EVENT') {
          const attachment = (
            await c.query<Row>(
              "SELECT season_id FROM season_events WHERE event_id=$1 AND status='ACTIVE'",
              [event!.id],
            )
          ).rows[0];
          if (attachment)
            seasonFail(
              409,
              'EVENT_ALREADY_IN_SEASON',
              attachment.season_id === season.id ? '该赛事已归入本赛季' : '该赛事已归入其他赛季',
            );
          if (
            !eventWithinSeason(
              { startDate: event!.start_date, endDate: event!.end_date },
              { startDate: season.start_date, endDate: season.end_date },
            )
          )
            seasonFail(422, 'EVENT_OUTSIDE_SEASON', '赛事日期必须落在赛季日期范围内');
          const count = (
            await c.query<{ n: number }>(
              "SELECT count(*)::int AS n FROM season_events WHERE org_id=$1 AND season_id=$2 AND status='ACTIVE'",
              [actor.orgId, season.id],
            )
          ).rows[0]!.n;
          if (count >= MAX_SEASON_EVENTS)
            seasonFail(
              422,
              'SEASON_EVENT_LIMIT',
              `首版每个赛季最多归入 ${MAX_SEASON_EVENTS} 届赛事`,
            );
          await c.query(
            'INSERT INTO season_events(id,org_id,season_id,event_id,attached_by) VALUES($1,$2,$3,$4,$5)',
            [randomUUID(), actor.orgId, season.id, event!.id, actor.user.id],
          );
          metadata.eventId = event!.id;
        } else if (input.type === 'DETACH_EVENT') {
          const detached = await c.query(
            "UPDATE season_events SET status='DETACHED',detached_by=$4,detached_at=clock_timestamp() WHERE org_id=$1 AND season_id=$2 AND event_id=$3 AND status='ACTIVE'",
            [actor.orgId, season.id, event!.id, actor.user.id],
          );
          if (!detached.rowCount) seasonFail(409, 'EVENT_NOT_IN_SEASON', '该赛事当前不在本赛季');
          metadata.eventId = event!.id;
        }
        await c.query(
          `UPDATE seasons SET status=$3,version=version+1,updated_at=clock_timestamp(),
            activated_at=CASE WHEN $3='ACTIVE' AND activated_at IS NULL THEN clock_timestamp() ELSE activated_at END,
            closed_at=CASE WHEN $3='CLOSED' THEN clock_timestamp() ELSE closed_at END
          WHERE org_id=$1 AND id=$2`,
          [actor.orgId, season.id, target],
        );
        await this.audit(
          c,
          actor.user.id,
          actor.orgId,
          `SEASON_${input.type}`,
          'season',
          season.id,
          metadata,
        );
        await this.ensureFreshSession(c, actor);
        return this.seasonDetail(c, actor.orgId, season.id);
      });
    } catch (error) {
      // Two seasons racing for one event: the partial unique index is the final arbiter.
      if ((error as { code?: string }).code === '23505')
        seasonFail(409, 'EVENT_ALREADY_IN_SEASON', '该赛事已归入其他赛季');
      throw error;
    }
  }

  // ---------- statistics ----------

  private async eventInput(
    c: PoolClient,
    orgId: string,
    event: Row,
    season: Row,
    asOf: string,
  ): Promise<SeasonEventInput> {
    const base = { eventId: event.event_id as string, name: event.name as string };
    if (
      !eventWithinSeason(
        { startDate: event.start_date, endDate: event.end_date },
        { startDate: season.start_date, endDate: season.end_date },
      )
    )
      return { ...base, state: 'OUT_OF_RANGE' };
    const snapshot = (await c.query<Row>(EVENT_PROOF, [orgId, event.event_id])).rows;
    const first = snapshot[0];
    if (!first) return { ...base, state: 'NO_SCHEDULE' };
    try {
      if (snapshot.some((r) => r.publication_id !== first.publication_id))
        throw new ApiError(409, 'RESULT_SOURCE_INVALID', 'inconsistent publication');
      const group =
        event.format === 'GROUP_KNOCKOUT' ? await groupEvidence(c, orgId, event.event_id) : null;
      // The existing per-event verification and calculation; no second score fact is built.
      const summary = calculateEventPlayerStatistics({
        publicationId: first.publication_id,
        source: first.publication_source,
        matches: snapshot.flatMap((r) => (r.proof ? [r.proof as ResultRow] : [])),
        asOf,
        format: event.format,
        groupConfig: first.group_config,
        groupRules: group?.rules ?? undefined,
        groupDraws: group?.draws,
        groupQualification: group?.qualification,
        seed: first.seed,
        policy: first.policy,
        roundPublications: first.round_publications,
      });
      return {
        ...base,
        state: 'INCLUDED',
        summary,
        teamByEntry: teamsByEntry(first.publication_source),
      };
    } catch (error) {
      // An unverifiable source excludes that whole event; it never falls back to older data.
      if (
        error instanceof ApiError &&
        ['RESULT_SOURCE_INVALID', 'PLAYER_STATISTICS_INVALID'].includes(error.code)
      )
        return { ...base, state: 'INVALID' };
      throw error;
    }
  }
  private async summary(
    c: PoolClient,
    orgId: string,
    season: Row,
    events: Row[],
    targetUserId?: string,
  ): Promise<SeasonStatisticsSummary> {
    const asOf = iso(
      (await c.query<{ now: Date }>('SELECT statement_timestamp() AS now')).rows[0]!.now,
    )!;
    const grantRows = (
      await c.query<Row>(
        `${GRANT_SELECT} WHERE g.org_id=$1 AND s.id=$2 AND g.status='ACTIVE' AND ($3::uuid IS NULL OR g.target_user_id=$3) ORDER BY g.id`,
        [orgId, season.id, targetUserId ?? null],
      )
    ).rows;
    const grants: EffectiveGrant[] = grantRows.filter(effective).map((g) => ({
      grantId: g.id,
      version: g.version,
      bindingId: g.binding_id,
      eventId: g.event_id,
      teamId: g.team_id,
      memberId: g.member_id,
      userId: g.target_user_id,
      displayName: g.target_display_name,
    }));
    // Proofs are recomputed on every read: the first version caches no aggregate.
    const inputs: SeasonEventInput[] = [];
    for (const event of events) inputs.push(await this.eventInput(c, orgId, event, season, asOf));
    return aggregateSeason({
      seasonId: season.id,
      seasonVersion: season.version,
      asOf,
      events: inputs,
      grants,
    });
  }
  async seasonStatistics(
    cookie: string | undefined,
    orgId: string,
    seasonId: string,
  ): Promise<SeasonStatisticsData> {
    return this.snapshotRead(async (c) => {
      const actor = await this.readOrganization(c, await this.readActor(c, cookie), orgId);
      // An EVENT_MANAGER of one event never reads organization-wide season data.
      this.requireAdministrator(actor);
      const season = await this.seasonRow(c, actor.orgId, seasonId);
      const events = await this.seasonEvents(c, actor.orgId, season.id);
      return {
        season: this.seasonDto(season, events),
        summary: await this.summary(c, actor.orgId, season, events),
      };
    });
  }
  async mySeasonStatistics(
    cookie: string | undefined,
    raw: unknown,
  ): Promise<MySeasonStatisticsData> {
    const query = objectInput(raw ?? {}, ['orgId', 'seasonId']);
    if (typeof query.orgId !== 'string' || typeof query.seasonId !== 'string') throw notFound();
    const orgId = resourceId(query.orgId);
    const seasonId = resourceId(query.seasonId);
    return this.snapshotRead(async (c) => {
      const actor = await this.readActor(c, cookie);
      const season = (
        await c.query<Row>(
          `SELECT ${SEASON_SELECT},o.name AS org_name FROM seasons s JOIN organizations o ON o.id=s.org_id AND o.status='ACTIVE'
          WHERE s.org_id=$1 AND s.id=$2 AND s.status IN ('ACTIVE','CLOSED')`,
          [orgId, seasonId],
        )
      ).rows[0];
      if (!season) throw notFound();
      // Only events in which this account has ever been nominated are disclosed to it.
      const mine = new Set(
        (
          await c.query<{ event_id: string }>(
            'SELECT DISTINCT event_id FROM season_data_grants WHERE org_id=$1 AND target_user_id=$2',
            [orgId, actor.user.id],
          )
        ).rows.map((r) => r.event_id),
      );
      const own = (await this.seasonEvents(c, orgId, season.id)).filter((e) =>
        mine.has(e.event_id),
      );
      if (!own.length) throw notFound();
      const summary = await this.summary(c, orgId, season, own, actor.user.id);
      return {
        season: {
          id: season.id,
          orgId: season.org_id,
          orgName: season.org_name,
          name: season.name,
          startDate: season.start_date,
          endDate: season.end_date,
          status: season.status,
        },
        summary: { ...summary, rows: summary.rows.filter((r) => r.userId === actor.user.id) },
      };
    });
  }

  // ---------- PRIVATE_SEASON grants ----------

  async eventGrants(
    cookie: string | undefined,
    orgId: string,
    eventId: string,
    raw: unknown = {},
  ): Promise<EventSeasonGrantsData> {
    const { limit, cursor } = seasonPage(raw);
    return this.snapshotRead(async (c) => {
      const actor = await this.readOrganization(c, await this.readActor(c, cookie), orgId);
      const event = (
        await c.query<Row>(
          'SELECT e.id,e.org_id,e.name,e.start_date::text AS start_date,e.end_date::text AS end_date,e.status FROM events e WHERE e.org_id=$1 AND e.id=$2',
          [actor.orgId, resourceId(eventId)],
        )
      ).rows[0];
      if (!event) throw notFound();
      if (!(await this.nominatingPower(c, actor, event.id))) throw forbidden();
      const season = (
        await c.query<Row>(
          "SELECT s.id,s.name,s.status FROM season_events se JOIN seasons s ON s.org_id=se.org_id AND s.id=se.season_id WHERE se.org_id=$1 AND se.event_id=$2 AND se.status='ACTIVE'",
          [actor.orgId, event.id],
        )
      ).rows[0];
      const freeze = (
        await c.query<Row>(
          'SELECT snapshot FROM registration_freezes WHERE org_id=$1 AND event_id=$2',
          [actor.orgId, event.id],
        )
      ).rows[0];
      const entries: Row[] = Array.isArray(freeze?.snapshot?.entries)
        ? freeze!.snapshot.entries
        : [];
      const memberIds = entries.flatMap((e) =>
        Array.isArray(e.players) ? e.players.map((p: Row) => p.memberId) : [],
      );
      const bindings = new Map(
        (
          await c.query<Row>(
            "SELECT b.id,b.member_id,b.user_id,u.display_name FROM team_member_bindings b JOIN users u ON u.id=b.user_id WHERE b.org_id=$1 AND b.member_id=ANY($2::uuid[]) AND b.status='ACTIVE'",
            [actor.orgId, memberIds],
          )
        ).rows.map((b) => [b.member_id, b]),
      );
      const grants = (
        await c.query<Row>(
          `${GRANT_SELECT.replace('SELECT g.*,', 'SELECT g.*, g.created_at::text AS cursor_created_at,')}
            WHERE g.org_id=$1 AND g.event_id=$2 AND ($3::timestamptz IS NULL OR (g.created_at,g.id)<($3::timestamptz,$4::uuid))
            ORDER BY g.created_at DESC,g.id DESC LIMIT $5`,
          [actor.orgId, event.id, cursor?.at ?? null, cursor?.id ?? null, limit + 1],
        )
      ).rows;
      return {
        event: {
          id: event.id,
          orgId: event.org_id,
          name: event.name,
          startDate: event.start_date,
          endDate: event.end_date,
          status: event.status,
        },
        season: season ? { id: season.id, name: season.name, status: season.status } : null,
        frozen: Boolean(freeze),
        sources: entries.map((entry) => ({
          teamId: entry.teamId,
          teamName: entry.teamName,
          members: (Array.isArray(entry.players) ? entry.players : []).map((p: Row) => {
            const b = bindings.get(p.memberId);
            return {
              memberId: p.memberId,
              name: p.name,
              jerseyNo: p.jerseyNo,
              binding: b
                ? { bindingId: b.id, userId: b.user_id, displayName: b.display_name }
                : null,
            };
          }),
        })),
        grants: grants
          .slice(0, limit)
          .map((g) => this.grantDto(g, { userId: actor.user.id, manages: true })),
        nextCursor:
          grants.length > limit
            ? seasonCursor(grants[limit - 1]!.cursor_created_at, grants[limit - 1]!.id)
            : null,
        disclosure: DISCLOSURE,
      };
    });
  }
  async nominate(
    cookie: string | undefined,
    orgId: string,
    eventId: string,
    raw: unknown,
  ): Promise<{ grant: SeasonDataGrantData; created: boolean }> {
    const input = nominateInput(raw);
    try {
      return await this.transaction(async (c) => {
        const actor = await this.lockOrganization(c, await this.lockActor(c, cookie), orgId);
        const event = (
          await c.query<Row>('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
            actor.orgId,
            resourceId(eventId),
          ])
        ).rows[0];
        if (!event) throw notFound();
        // Permission is decided before any receipt is consulted, so a 403 never leaks it.
        if (!(await this.nominatingPower(c, actor, event.id, 'FOR SHARE'))) throw forbidden();
        const hash = requestHash(['v1', 'SEASON_GRANT_NOMINATE', event.id, input]);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `scb-season-grant:${actor.orgId}:${actor.user.id}:${input.clientRequestId}`,
        ]);
        const previous = (
          await c.query<Row>(
            'SELECT id,request_hash FROM season_data_grants WHERE org_id=$1 AND nominated_by=$2 AND client_request_id=$3',
            [actor.orgId, actor.user.id, input.clientRequestId],
          )
        ).rows[0];
        if (previous) {
          if (previous.request_hash !== hash)
            seasonFail(409, 'IDEMPOTENCY_CONFLICT', '请求编号已用于不同的提名内容');
          await this.ensureFreshSession(c, actor);
          return {
            grant: this.grantDto((await this.grantRow(c, previous.id))!, {
              userId: actor.user.id,
              manages: true,
            }),
            created: false,
          };
        }
        // The frozen registration roster of this event must contain this exact member.
        const frozen = (
          await c.query(
            `SELECT 1 FROM registration_freezes f WHERE f.org_id=$1 AND f.event_id=$2 AND f.snapshot->'entries' @> jsonb_build_array(jsonb_build_object('teamId',$3::text,'players',jsonb_build_array(jsonb_build_object('memberId',$4::text))))`,
            [actor.orgId, event.id, input.teamId, input.memberId],
          )
        ).rowCount;
        if (!frozen)
          seasonFail(
            422,
            'SEASON_GRANT_SOURCE_INVALID',
            '该成员不在这一届赛事这支球队的冻结名单中',
          );
        await c.query(
          'SELECT 1 FROM team_members WHERE org_id=$1 AND team_id=$2 AND id=$3 FOR SHARE',
          [actor.orgId, input.teamId, input.memberId],
        );
        const binding = (
          await c.query<Row>(
            "SELECT b.id FROM team_member_bindings b JOIN users u ON u.id=b.user_id AND u.status='ACTIVE' WHERE b.org_id=$1 AND b.team_id=$2 AND b.member_id=$3 AND b.user_id=$4 AND b.status='ACTIVE' FOR SHARE OF b,u",
            [actor.orgId, input.teamId, input.memberId, input.targetUserId],
          )
        ).rows[0];
        if (!binding)
          seasonFail(
            409,
            'SEASON_GRANT_BINDING_REQUIRED',
            '目标账号当前没有绑定这名长期成员，不能提名',
          );
        const grantId = randomUUID();
        await c.query(
          'INSERT INTO season_data_grants(id,org_id,event_id,team_id,member_id,target_user_id,binding_id,nominated_by,nominate_reason,client_request_id,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            grantId,
            actor.orgId,
            event.id,
            input.teamId,
            input.memberId,
            input.targetUserId,
            binding!.id,
            actor.user.id,
            input.reason,
            input.clientRequestId,
            hash,
          ],
        );
        await this.audit(
          c,
          actor.user.id,
          actor.orgId,
          'SEASON_GRANT_NOMINATED',
          'season_data_grant',
          grantId,
          {
            purpose: 'PRIVATE_SEASON',
            eventId: event.id,
            teamId: input.teamId,
            memberId: input.memberId,
            targetUserId: input.targetUserId,
            bindingId: binding!.id,
            clientRequestId: input.clientRequestId,
            reason: input.reason,
          },
        );
        await this.ensureFreshSession(c, actor);
        return {
          grant: this.grantDto((await this.grantRow(c, grantId))!, {
            userId: actor.user.id,
            manages: true,
          }),
          created: true,
        };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        seasonFail(
          409,
          'SEASON_GRANT_EXISTS',
          '该成员在这届赛事已有待确认或有效的私有赛季授权，请先核对或撤回原授权',
        );
      throw error;
    }
  }
  async withdraw(
    cookie: string | undefined,
    orgId: string,
    grantId: string,
    raw: unknown,
  ): Promise<SeasonDataGrantData> {
    const input = withdrawInput(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockOrganization(c, await this.lockActor(c, cookie), orgId);
      const ref = (
        await c.query<Row>('SELECT event_id FROM season_data_grants WHERE org_id=$1 AND id=$2', [
          actor.orgId,
          resourceId(grantId),
        ])
      ).rows[0];
      if (!ref) throw notFound();
      await c.query('SELECT 1 FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
        actor.orgId,
        ref.event_id,
      ]);
      if (!(await this.nominatingPower(c, actor, ref.event_id, 'FOR SHARE'))) throw forbidden();
      const grant = (
        await c.query<Row>('SELECT * FROM season_data_grants WHERE id=$1 FOR UPDATE', [
          resourceId(grantId),
        ])
      ).rows[0]!;
      if (grant.version !== input.expectedVersion) versionConflict(grant.version);
      const next = grantTransition(grant.status, 'WITHDRAW');
      await c.query(
        "UPDATE season_data_grants SET status='WITHDRAWN',withdrawn_by=$2,withdrawn_at=clock_timestamp(),withdraw_reason=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [grant.id, actor.user.id, input.reason],
      );
      await this.audit(
        c,
        actor.user.id,
        actor.orgId,
        'SEASON_GRANT_WITHDRAWN',
        'season_data_grant',
        grant.id,
        {
          previousStatus: grant.status,
          nextStatus: next,
          previousVersion: grant.version,
          reason: input.reason,
        },
      );
      await this.ensureFreshSession(c, actor);
      return this.grantDto((await this.grantRow(c, grant.id))!, {
        userId: actor.user.id,
        manages: true,
      });
    });
  }
  async myGrants(cookie: string | undefined, raw: unknown = {}): Promise<MySeasonDataGrantsData> {
    const { limit, cursor } = seasonPage(raw);
    return this.snapshotRead(async (c) => {
      const actor = await this.readActor(c, cookie);
      const rows = (
        await c.query<Row>(
          `${GRANT_SELECT.replace('SELECT g.*,', 'SELECT g.*, g.created_at::text AS cursor_created_at,')} WHERE g.target_user_id=$1
            AND ($2::timestamptz IS NULL OR (g.created_at,g.id)<($2::timestamptz,$3::uuid))
            ORDER BY g.created_at DESC,g.id DESC LIMIT $4`,
          [actor.user.id, cursor?.at ?? null, cursor?.id ?? null, limit + 1],
        )
      ).rows;
      const page = rows.slice(0, limit);
      const more = rows.length > limit;
      const last = page.at(-1);
      return {
        grants: page.map((g) => this.grantDto(g, { userId: actor.user.id, manages: false })),
        truncated: more,
        nextCursor: more && last ? seasonCursor(last.cursor_created_at, last.id) : null,
        disclosure: DISCLOSURE,
      };
    });
  }
  async myGrantCommand(
    cookie: string | undefined,
    grantId: string,
    raw: unknown,
  ): Promise<SeasonDataGrantData> {
    const input = grantCommandInput(raw);
    const id = resourceId(grantId);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const ref = (
        await c.query<Row>(
          'SELECT org_id,event_id,target_user_id,binding_id FROM season_data_grants WHERE id=$1',
          [id],
        )
      ).rows[0];
      // Only the nominated account may answer; everyone else cannot see the grant at all.
      if (!ref || ref.target_user_id !== actor.user.id) throw notFound();
      await c.query('SELECT 1 FROM organizations WHERE id=$1 FOR SHARE', [ref.org_id]);
      await c.query('SELECT 1 FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
        ref.org_id,
        ref.event_id,
      ]);
      // Binding loss takes the binding row before invalidating its grants. Keep that order
      // here as well so consenting and leaving cannot wait on one another's row locks.
      await c.query('SELECT 1 FROM team_member_bindings WHERE id=$1 FOR SHARE', [ref.binding_id]);
      const grant = (
        await c.query<Row>('SELECT * FROM season_data_grants WHERE id=$1 FOR UPDATE', [id])
      ).rows[0]!;
      if (grant.version !== input.expectedVersion) versionConflict(grant.version);
      const next = grantTransition(grant.status as SeasonGrantStatus, input.type);
      if (input.type === 'CONSENT') {
        if (!upstreamValid(conditions((await this.grantRow(c, grant.id))!)))
          seasonFail(
            409,
            'SEASON_GRANT_SOURCE_UNAVAILABLE',
            '成员绑定、提名人权限或冻结名单来源当前已失效，不能同意；请联系主办方重新核对',
          );
        await c.query(
          "UPDATE season_data_grants SET status='ACTIVE',consented_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [grant.id],
        );
      } else if (input.type === 'DECLINE')
        await c.query(
          "UPDATE season_data_grants SET status='DECLINED',declined_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [grant.id],
        );
      else
        await c.query(
          "UPDATE season_data_grants SET status='REVOKED',revoked_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [grant.id],
        );
      const action =
        input.type === 'CONSENT' ? 'CONSENTED' : input.type === 'DECLINE' ? 'DECLINED' : 'REVOKED';
      await this.audit(
        c,
        actor.user.id,
        grant.org_id,
        `SEASON_GRANT_${action}`,
        'season_data_grant',
        grant.id,
        {
          purpose: 'PRIVATE_SEASON',
          previousStatus: grant.status,
          nextStatus: next,
          previousVersion: grant.version,
          explicitConsent: input.type === 'CONSENT',
        },
      );
      await this.ensureFreshSession(c, actor);
      return this.grantDto((await this.grantRow(c, grant.id))!, {
        userId: actor.user.id,
        manages: false,
      });
    });
  }
}
