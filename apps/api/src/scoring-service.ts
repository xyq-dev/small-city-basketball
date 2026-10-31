import {
  administrativeResult,
  exceptionResultSelect,
  exceptionResultJoins,
} from './match-exception-domain.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { MATCH_STATUSES } from '@small-city-basketball/contracts';
import type {
  EventData,
  MatchStatus,
  ScheduledMatchData,
  ScoringRulesetData,
  ScoringWorkbenchData,
  ScoringEventData,
  ScoringClock,
  ScoreSnapshot,
  ScoringCommandInput,
  ScoringCommandResponse,
  ScoringCommandReceipt,
  ResultConfirmationData,
  ScoringControl,
  ScorekeeperLeaseData,
  ScoringMatchSummary,
  MatchPlayerRoster,
} from '@small-city-basketball/contracts';
import { ApplicationService, EVENT_SELECT, isAdministrator } from './service.js';
import type { Actor, EventRow, OrgActor } from './service.js';
import {
  projectProfessionalStatistics,
  professionalStatisticsDto,
  technicalCollectionEnabled,
} from './professional-statistics.js';
import { ApiError, forbidden, notFound, unauthenticated } from './errors.js';
import { calendarDate, invalid, objectInput, resourceId } from './validation.js';
import { expectedVersion, pageInput } from './registration-validation.js';
import {
  ACTUAL_SCORING_COMMANDS,
  commandHash,
  parseScoringCommand,
  parseScoringRules,
  planCommand,
  replayStats,
} from './scoring-domain.js';
import {
  playerStatisticsDto,
  projectPlayerStatistics,
  recordedCollectionMode,
  scoringCollectionMode,
} from './player-statistics.js';
import { offlineIntentHash, parseOfflineScoringIntent } from './scoring-offline.js';
import { activeEvent, assertActiveEvent } from './event-lifecycle-domain.js';

type Row = Record<string, any>;
interface Access {
  ctx: OrgActor;
  event: EventRow & {
    current_scoring_ruleset_id: string | null;
    locked_scoring_ruleset_id: string | null;
  };
  manager: boolean;
  eventReader: boolean;
  match: Row;
  staff: Row | null;
}
const conflict = (code: string, message: string): never => {
  throw new ApiError(409, code, message);
};
const checkVersion = (actual: number, expected: number) => {
  if (actual !== expected)
    throw new ApiError(409, 'VERSION_CONFLICT', '比赛或赛事已更新，请重新读取后操作', {
      currentVersion: actual,
    });
};
function inputUuid(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    invalid('无效控制实例编号', { [field]: '请提供有效UUID' });
  return value.toLowerCase();
}
const CONFIGURABLE_EVENTS = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SCHEDULED',
  'RUNNING',
];
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
export class ScoringService extends ApplicationService {
  private readonly transactionActors = new WeakMap<PoolClient, Actor>();
  protected override async lockActor(c: PoolClient, cookie: string | undefined): Promise<Actor> {
    const actor = await super.lockActor(c, cookie);
    this.transactionActors.set(c, actor);
    return actor;
  }
  protected override async transaction<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
    return super.transaction(async (c) => {
      this.transactionActors.delete(c);
      try {
        const result = await work(c);
        const actor = this.transactionActors.get(c);
        if (actor) await this.ensureFreshSession(c, actor);
        return result;
      } finally {
        this.transactionActors.delete(c);
      }
    });
  }

  private async context(c: PoolClient, cookie: string | undefined, org: string) {
    return this.lockOrganization(c, await this.lockActor(c, cookie), org);
  }
  private async event(c: PoolClient, ctx: OrgActor, id: string, write = false) {
    const result = await c.query<Access['event']>(
      `SELECT ${EVENT_SELECT} FROM events e WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'} OF e`,
      [ctx.orgId, resourceId(id)],
    );
    const event = result.rows[0];
    if (!event) throw notFound();
    const staff = await c.query<Row>(
      "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
      [ctx.orgId, event.id, ctx.user.id],
    );
    return {
      event,
      manager: isAdministrator(ctx.role) || staff.rows[0]?.role === 'EVENT_MANAGER',
      eventReader: isAdministrator(ctx.role) || !!staff.rows[0],
    };
  }
  private async access(
    c: PoolClient,
    ctx: OrgActor,
    id: string,
    write = false,
    eventWrite = false,
  ): Promise<Access> {
    const ref = await c.query<{ event_id: string }>(
      'SELECT event_id FROM published_matches WHERE org_id=$1 AND id=$2',
      [ctx.orgId, resourceId(id)],
    );
    if (!ref.rows[0]) throw notFound();
    const ev = await this.event(c, ctx, ref.rows[0].event_id, eventWrite);
    const result = await c.query<Row>(
      `SELECT * FROM published_matches WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`,
      [ctx.orgId, id],
    );
    const match = result.rows[0];
    if (!match) throw notFound();
    if (write) await this.assertNotAdjudicated(c, ctx.orgId, id);
    const own = await c.query<Row>(
      'SELECT * FROM match_staff WHERE org_id=$1 AND match_id=$2 AND user_id=$3 FOR SHARE',
      [ctx.orgId, id, ctx.user.id],
    );
    const staff = own.rows[0]?.status === 'ACTIVE' ? own.rows[0] : null;
    if (!ev.eventReader && !staff) throw notFound();
    return { ctx, ...ev, match, staff };
  }
  private async assertNotAdjudicated(c: PoolClient, org: string, id: string) {
    const head = await c.query(
      'SELECT 1 FROM match_exception_heads WHERE org_id=$1 AND match_id=$2 AND active_request_id IS NOT NULL',
      [org, id],
    );
    if (head.rowCount) conflict('MATCH_ADJUDICATED', '本场存在生效中的弃权或取消裁定，不能记分');
  }
  private async adjudication(
    c: PoolClient,
    a: Access,
  ): Promise<{ kind: 'FORFEIT' | 'CANCELLED' } | null> {
    const proof = (
      await c.query<Row>(
        `SELECT ${exceptionResultSelect},to_jsonb(s) AS state FROM published_matches m LEFT JOIN scoring_states s ON s.org_id=m.org_id AND s.match_id=m.id ${exceptionResultJoins} WHERE m.org_id=$1 AND m.id=$2`,
        [a.ctx.orgId, a.match.id],
      )
    ).rows[0];
    if (!proof) throw notFound();
    const result = administrativeResult({ ...a.match, ...proof });
    return result ? { kind: result.kind } : null;
  }
  private async now(c: PoolClient, ctx: OrgActor): Promise<string> {
    const result = await c.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    const now = result.rows[0]!.now.toISOString();
    const active = await c.query(
      'SELECT id FROM sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>$2::timestamptz',
      [ctx.sessionId, now],
    );
    if (!active.rowCount) throw unauthenticated();
    return now;
  }
  private matchDto(r: Row): ScheduledMatchData {
    return {
      id: r.id,
      eventId: r.event_id,
      publicationId: r.publication_id,
      fixtureKey: r.fixture_key,
      roundNo: r.round_no,
      positionNo: r.position_no,
      home: {
        entryId: r.home_entry_id,
        teamId: r.home_team_id,
        teamName: r.home_team_name,
        rosterRevisionId: r.home_roster_revision_id,
      },
      away: {
        entryId: r.away_entry_id,
        teamId: r.away_team_id,
        teamName: r.away_team_name,
        rosterRevisionId: r.away_roster_revision_id,
      },
      courtId: r.court_id,
      courtName: r.court_name,
      startsAt: iso(r.starts_at),
      endsAt: iso(r.ends_at),
      status: r.status,
      version: r.version,
    };
  }
  private eventDto(a: Pick<Access, 'event' | 'manager'>): EventData {
    const r = a.event;
    return {
      id: r.id,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      timezone: r.timezone,
      venueName: r.venue_name,
      format: r.format,
      status: r.status,
      version: r.version,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      permissions: { canEditDraft: a.manager && r.status === 'DRAFT' },
    };
  }
  private async rules(
    c: PoolClient,
    org: string,
    id: string | null,
  ): Promise<ScoringRulesetData | null> {
    if (!id) return null;
    const result = await c.query<Row>('SELECT * FROM scoring_rulesets WHERE org_id=$1 AND id=$2', [
      org,
      id,
    ]);
    const r = result.rows[0];
    if (!r) throw notFound();
    return {
      id: r.id,
      eventId: r.event_id,
      version: r.version,
      regulationPeriods: r.regulation_periods,
      periodDurationSeconds: r.period_duration_seconds,
      allowedScoreValues: r.allowed_score_values,
      tiePolicy: r.tie_policy,
      overtimeDurationSeconds: r.overtime_duration_seconds,
      createdAt: iso(r.created_at),
    };
  }
  private async playerRoster(c: PoolClient, a: Access): Promise<MatchPlayerRoster> {
    const result = await c.query<Row>(
      `SELECT entry_id,revision_id,member_id,name,jersey_no FROM entry_roster_players WHERE org_id=$1 AND ((entry_id=$2 AND revision_id=$3) OR (entry_id=$4 AND revision_id=$5)) ORDER BY CASE WHEN jersey_no='00' THEN 0 ELSE jersey_no::int END,jersey_no,member_id`,
      [
        a.ctx.orgId,
        a.match.home_entry_id,
        a.match.home_roster_revision_id,
        a.match.away_entry_id,
        a.match.away_roster_revision_id,
      ],
    );
    const side = (entryId: string, revisionId: string) =>
      result.rows
        .filter((row) => row.entry_id === entryId && row.revision_id === revisionId)
        .map((row) => ({ memberId: row.member_id, name: row.name, jerseyNo: row.jersey_no }));
    const roster = {
      home: side(a.match.home_entry_id, a.match.home_roster_revision_id),
      away: side(a.match.away_entry_id, a.match.away_roster_revision_id),
    };
    if (!roster.home.length || !roster.away.length)
      conflict('MATCH_ROSTER_INVALID', '本场冻结名单不可用');
    return roster;
  }
  private async state(c: PoolClient, a: Access): Promise<Row | null> {
    return (
      (
        await c.query<Row>('SELECT * FROM scoring_states WHERE org_id=$1 AND match_id=$2', [
          a.ctx.orgId,
          a.match.id,
        ])
      ).rows[0] ?? null
    );
  }
  private clock(r: Row): ScoringClock {
    return {
      period: r.period,
      remainingMs: r.remaining_ms,
      running: r.clock_running,
      anchorServerTime: iso(r.anchor_server_time),
      clockVersion: r.clock_version,
    };
  }
  private confirmation(r: Row): ResultConfirmationData {
    const mode = scoringCollectionMode(r.collection_mode);
    const playerStatistics = playerStatisticsDto(r.player_stats);
    if ((mode === 'TEAM_ONLY') !== (playerStatistics === null))
      conflict('PROJECTION_MISMATCH', '确认赛果的球员统计模式不一致');
    if (playerStatistics) {
      for (const [side, score, fouls] of [
        [playerStatistics.home, r.home_score, r.home_fouls],
        [playerStatistics.away, r.away_score, r.away_fouls],
      ] as const) {
        if (
          side.players.reduce((sum, row) => sum + row.score, side.unassigned.score) !== score ||
          side.players.reduce((sum, row) => sum + row.fouls, side.unassigned.fouls) !== fouls
        )
          conflict('PROJECTION_MISMATCH', '确认赛果的球队与球员统计不一致');
      }
    }
    return {
      id: r.id,
      matchId: r.match_id,
      confirmingUserId: r.confirming_user_id,
      rulesetId: r.ruleset_id,
      rulesetVersion: r.ruleset_version,
      sourceMatchVersion: r.source_match_version,
      lastEventSeq: r.last_event_seq,
      home: { score: r.home_score, fouls: r.home_fouls, timeouts: r.home_timeouts },
      away: { score: r.away_score, fouls: r.away_fouls, timeouts: r.away_timeouts },
      periods: r.period_stats,
      playerStatistics,
      ...(r.technical_collection
        ? { professionalStatistics: professionalStatisticsDto(r.professional_stats) }
        : {}),
      confirmedAt: iso(r.confirmed_at),
    };
  }
  private async snapshot(
    c: PoolClient,
    a: Access,
    now: string,
    st?: Row | null,
  ): Promise<ScoreSnapshot | null> {
    const s = st === undefined ? await this.state(c, a) : st;
    if (!s) return null;
    const rules = await this.rules(c, a.ctx.orgId, s.ruleset_id);
    if (!rules) throw notFound();
    const mode = scoringCollectionMode(s.collection_mode);
    const history = await this.events(c, a);
    const roster = mode === 'PLAYER_BASIC' ? await this.playerRoster(c, a) : { home: [], away: [] };
    const playerStatistics = projectPlayerStatistics(
      mode,
      replayStats(history, rules, s.period),
      roster,
    );
    if (
      recordedCollectionMode(history) !== mode ||
      !isDeepStrictEqual(s.player_stats, playerStatistics)
    )
      conflict('PROJECTION_MISMATCH', '记分流水与球员统计投影不一致');
    const professionalStored = projectProfessionalStatistics(history, rules, roster);
    if (
      !!s.technical_collection !== technicalCollectionEnabled(history) ||
      !isDeepStrictEqual(s.professional_stats ?? null, professionalStored)
    )
      conflict('PROJECTION_MISMATCH', '专业统计流水与当前投影不一致');
    const professionalStatistics = s.technical_collection
      ? projectProfessionalStatistics(history, rules, roster, now)
      : null;
    let latestConfirmation: ResultConfirmationData | null = null;
    if (s.latest_confirmation_id) {
      const r = await c.query<Row>(
        'SELECT * FROM result_confirmations WHERE org_id=$1 AND match_id=$2 AND id=$3',
        [a.ctx.orgId, a.match.id, s.latest_confirmation_id],
      );
      if (r.rows[0]) {
        latestConfirmation = this.confirmation(r.rows[0]);
        if (
          a.match.status === 'FINAL' &&
          !s.requires_reconfirmation &&
          (!isDeepStrictEqual(latestConfirmation.playerStatistics, playerStatistics) ||
            !isDeepStrictEqual(
              latestConfirmation.professionalStatistics ?? null,
              professionalStored,
            ))
        )
          conflict('PROJECTION_MISMATCH', '当前有效确认与球员统计投影不一致');
      }
    }
    const m = this.matchDto(a.match);
    const adjudication = await this.adjudication(c, a);
    return {
      ...(adjudication ? { adjudication } : {}),
      matchId: m.id,
      eventId: m.eventId,
      eventName: a.event.name,
      status: m.status,
      version: m.version,
      home: m.home,
      away: m.away,
      totals: {
        home: { score: s.home_score, fouls: s.home_fouls, timeouts: s.home_timeouts },
        away: { score: s.away_score, fouls: s.away_fouls, timeouts: s.away_timeouts },
      },
      periods: s.period_stats,
      rules,
      clock: this.clock(s),
      lastEventSeq: s.last_event_seq,
      latestConfirmation,
      requiresReconfirmation: s.requires_reconfirmation,
      playerStatistics,
      ...(s.technical_collection ? { professionalStatistics } : {}),
      collected: {
        teamScore: true,
        teamFouls: true,
        teamTimeouts: true,
        playerStatistics: mode === 'PLAYER_BASIC',
      },
      serverTime: now,
    };
  }
  private async lease(c: PoolClient, a: Access, write = false): Promise<Row | null> {
    if (write)
      await c.query(
        'INSERT INTO scoring_leases(org_id,event_id,match_id) VALUES($1,$2,$3) ON CONFLICT(org_id,match_id) DO NOTHING',
        [a.ctx.orgId, a.event.id, a.match.id],
      );
    return (
      (
        await c.query<Row>(
          `SELECT * FROM scoring_leases WHERE org_id=$1 AND match_id=$2${write ? ' FOR UPDATE' : ''}`,
          [a.ctx.orgId, a.match.id],
        )
      ).rows[0] ?? null
    );
  }
  private async confirmAllowed(
    c: PoolClient,
    a: Access,
    l: Row | null,
    now: string,
    lockTeams: boolean,
  ): Promise<boolean> {
    if (!(a.manager || a.staff?.role === 'RESULT_REVIEWER')) return false;
    if (lockTeams)
      await c.query(
        'SELECT id FROM teams WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
        [a.ctx.orgId, [a.match.home_team_id, a.match.away_team_id]],
      );
    if (l?.holder_user_id === a.ctx.user.id && l.expires_at && iso(l.expires_at) > now)
      return false;
    const history = await c.query(
      'SELECT 1 FROM scoring_commands WHERE org_id=$1 AND match_id=$2 AND actor_id=$3 AND command_type=ANY($4::text[]) LIMIT 1',
      [a.ctx.orgId, a.match.id, a.ctx.user.id, ACTUAL_SCORING_COMMANDS],
    );
    if (history.rowCount) return false;
    const grant = await c.query(
      "SELECT 1 FROM team_access_grants WHERE org_id=$1 AND team_id=ANY($2::uuid[]) AND user_id=$3 AND status='ACTIVE' LIMIT 1",
      [a.ctx.orgId, [a.match.home_team_id, a.match.away_team_id], a.ctx.user.id],
    );
    return !grant.rowCount;
  }
  private async resultConsumed(c: PoolClient, a: Access): Promise<boolean> {
    if (!['SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'].includes(a.event.format)) return false;
    return !!(
      await c.query(
        "SELECT 1 FROM knockout_round_publications WHERE org_id=$1 AND event_id=$2 AND sources @> jsonb_build_array(jsonb_build_object('matchId',$3::text)) UNION ALL SELECT 1 FROM group_qualification_publications WHERE org_id=$1 AND event_id=$2 AND sources @> jsonb_build_array(jsonb_build_object('matchId',$3::text)) LIMIT 1",
        [a.ctx.orgId, a.event.id, a.match.id],
      )
    ).rowCount;
  }
  private async workbench(c: PoolClient, a: Access, now: string): Promise<ScoringWorkbenchData> {
    const staff = await c.query<Row>(
      'SELECT s.user_id,u.display_name,s.role,s.status FROM match_staff s JOIN users u ON u.id=s.user_id WHERE s.org_id=$1 AND s.match_id=$2 ORDER BY s.created_at,s.user_id',
      [a.ctx.orgId, a.match.id],
    );
    const l = await this.lease(c, a);
    const held = !!(l?.expires_at && iso(l.expires_at) > now);
    const scorer = a.staff?.role === 'SCORER';
    const adjudication = await this.adjudication(c, a);
    const writable = activeEvent(a.event.status) && !adjudication;
    return {
      match: { ...this.matchDto(a.match), ...(adjudication ? { adjudication } : {}) },
      event: {
        id: a.event.id,
        name: a.event.name,
        status: a.event.status,
        version: a.event.version,
      },
      rules: await this.rules(
        c,
        a.ctx.orgId,
        a.event.locked_scoring_ruleset_id ?? a.event.current_scoring_ruleset_id,
      ),
      rulesLocked: !!a.event.locked_scoring_ruleset_id,
      snapshot: await this.snapshot(c, a, now),
      playerRoster: await this.playerRoster(c, a),
      staff: staff.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        role: r.role,
        status: r.status,
      })),
      lease: {
        held,
        expiresAt: held ? iso(l!.expires_at) : null,
        holderUserId: held ? l!.holder_user_id : null,
      },
      capabilities: {
        canManageStaff: a.manager && !adjudication,
        canPrepare: writable && a.manager && a.match.status === 'SCHEDULED',
        canAcquireControl:
          writable &&
          !!scorer &&
          ['READY', 'LIVE', 'PENDING_CONFIRMATION'].includes(a.match.status),
        canRecord: writable && !!scorer && a.match.status === 'LIVE',
        canCorrect:
          writable && !!scorer && ['LIVE', 'PENDING_CONFIRMATION'].includes(a.match.status),
        canConfirm:
          writable &&
          a.match.status === 'PENDING_CONFIRMATION' &&
          (await this.confirmAllowed(c, a, l, now, false)),
        canReopen:
          writable && a.manager && a.match.status === 'FINAL' && !(await this.resultConsumed(c, a)),
      },
    };
  }
  async getEventScoring(cookie: string | undefined, org: string, id: string) {
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.event(c, ctx, id);
      if (!a.eventReader) throw notFound();
      await this.now(c, ctx);
      return {
        event: this.eventDto(a),
        rules: await this.rules(
          c,
          ctx.orgId,
          a.event.locked_scoring_ruleset_id ?? a.event.current_scoring_ruleset_id,
        ),
        locked: !!a.event.locked_scoring_ruleset_id,
        capabilities: {
          canManageRules:
            CONFIGURABLE_EVENTS.includes(a.event.status) &&
            a.manager &&
            !a.event.locked_scoring_ruleset_id,
        },
      };
    });
  }
  async updateScoringRules(cookie: string | undefined, org: string, id: string, raw: unknown) {
    const input = objectInput(raw, [
      'expectedEventVersion',
      'regulationPeriods',
      'periodDurationSeconds',
      'allowedScoreValues',
      'tiePolicy',
      'overtimeDurationSeconds',
    ]);
    const version = expectedVersion(input.expectedEventVersion);
    const { expectedEventVersion: _, ...rest } = input;
    const rules = parseScoringRules(rest);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.event(c, ctx, id, true);
      if (!a.eventReader) throw notFound();
      if (!a.manager) throw forbidden();
      await this.now(c, ctx);
      checkVersion(a.event.version, version);
      if (a.event.locked_scoring_ruleset_id) conflict('SCORING_RULES_LOCKED', '赛事记分规则已锁定');
      if (!CONFIGURABLE_EVENTS.includes(a.event.status))
        conflict('INVALID_EVENT_STATE', '赛事当前不可配置记分规则');
      if (
        ['SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'].includes(a.event.format) &&
        rules.tiePolicy !== 'OVERTIME'
      )
        throw new ApiError(422, 'RULE_CONFLICT', '单淘汰与分组接淘汰赛事必须设置平分加时规则');
      const count = await c.query<{ version: number }>(
        'SELECT COALESCE(MAX(version),0)::int+1 AS version FROM scoring_rulesets WHERE org_id=$1 AND event_id=$2',
        [ctx.orgId, id],
      );
      const ruleId = randomUUID();
      await c.query(
        'INSERT INTO scoring_rulesets(id,org_id,event_id,version,regulation_periods,period_duration_seconds,allowed_score_values,tie_policy,overtime_duration_seconds,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          ruleId,
          ctx.orgId,
          id,
          count.rows[0]!.version,
          rules.regulationPeriods,
          rules.periodDurationSeconds,
          rules.allowedScoreValues,
          rules.tiePolicy,
          rules.overtimeDurationSeconds,
          ctx.user.id,
        ],
      );
      await c.query(
        'UPDATE events SET current_scoring_ruleset_id=$3,version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
        [ctx.orgId, id, ruleId],
      );
      a.event.current_scoring_ruleset_id = ruleId;
      a.event.version++;
      a.event.updated_at = new Date();
      await this.audit(c, ctx.user.id, ctx.orgId, 'scoring.rules.updated', 'event', id, {
        rulesetId: ruleId,
      });
      return {
        event: this.eventDto(a),
        rules: await this.rules(c, ctx.orgId, ruleId),
        locked: false,
        capabilities: { canManageRules: true },
      };
    });
  }
  async getWorkbench(cookie: string | undefined, org: string, id: string) {
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.access(c, ctx, id);
      const now = await this.now(c, ctx);
      return this.workbench(c, a, now);
    });
  }
  async getSnapshot(cookie: string | undefined, org: string, id: string) {
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.access(c, ctx, id);
      const result = await this.snapshot(c, a, await this.now(c, ctx));
      if (!result) conflict('MATCH_NOT_PREPARED', '比赛尚未准备');
      return result;
    });
  }
  async updateMatchStaff(
    cookie: string | undefined,
    org: string,
    id: string,
    userId: string,
    raw: unknown,
  ) {
    const input = objectInput(raw, ['expectedMatchVersion', 'role', 'status']);
    const version = expectedVersion(input.expectedMatchVersion);
    if (
      !['SCORER', 'RESULT_REVIEWER'].includes(String(input.role)) ||
      !['ACTIVE', 'DISABLED'].includes(String(input.status))
    )
      invalid('无效比赛工作人员角色或状态');
    userId = resourceId(userId);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      // Lock the target membership before the match; membership revocation cannot pass assignment.
      const target = await c.query<Row>(
        'SELECT m.status,u.status AS user_status FROM users u JOIN organization_memberships m ON m.user_id=u.id WHERE m.org_id=$1 AND m.user_id=$2 FOR SHARE OF u,m',
        [ctx.orgId, userId],
      );
      if (
        !target.rows[0] ||
        (input.status === 'ACTIVE' &&
          (target.rows[0].status !== 'ACTIVE' || target.rows[0].user_status !== 'ACTIVE'))
      )
        throw notFound();
      const a = await this.access(c, ctx, id, true);
      if (!a.manager) throw forbidden();
      checkVersion(a.match.version, version);
      const assignments = await c.query<{ user_id: string }>(
        'SELECT user_id FROM match_staff WHERE org_id=$1 AND match_id=$2 ORDER BY user_id FOR UPDATE',
        [ctx.orgId, id],
      );
      if (input.status === 'DISABLED' && !assignments.rows.some((row) => row.user_id === userId))
        throw notFound();
      const l = await this.lease(c, a, true);
      const now = await this.now(c, ctx);
      if (input.status === 'DISABLED') {
        await c.query(
          "UPDATE match_staff SET role=$4,status='DISABLED',updated_at=$5 WHERE org_id=$1 AND match_id=$2 AND user_id=$3",
          [ctx.orgId, id, userId, input.role, now],
        );
      } else
        await c.query(
          'INSERT INTO match_staff(org_id,event_id,match_id,user_id,role,status) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,match_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,updated_at=clock_timestamp()',
          [ctx.orgId, a.event.id, id, userId, input.role, input.status],
        );
      if (l?.holder_user_id === userId && (input.status !== 'ACTIVE' || input.role !== 'SCORER'))
        await c.query('UPDATE scoring_leases SET expires_at=$3 WHERE org_id=$1 AND match_id=$2', [
          ctx.orgId,
          id,
          now,
        ]);
      await c.query('UPDATE published_matches SET version=version+1 WHERE org_id=$1 AND id=$2', [
        ctx.orgId,
        id,
      ]);
      await c.query(
        'UPDATE scoring_states SET source_version=source_version+1,updated_at=$3 WHERE org_id=$1 AND match_id=$2',
        [ctx.orgId, id, now],
      );
      a.match.version++;
      if (userId === ctx.user.id)
        a.staff = input.status === 'ACTIVE' ? { role: input.role, status: input.status } : null;
      await this.audit(c, ctx.user.id, ctx.orgId, 'scoring.staff.updated', 'match', id, {
        userId,
        role: input.role,
        status: input.status,
      });
      return this.workbench(c, a, now);
    });
  }
  private parseControl(raw: unknown): ScoringControl {
    const v = objectInput(raw, ['leaseId', 'fencingToken', 'clientInstanceId']);
    if (typeof v.leaseId !== 'string' || typeof v.clientInstanceId !== 'string')
      invalid('无效主写控制凭据');
    const leaseId = inputUuid(v.leaseId, 'leaseId');
    const clientInstanceId = inputUuid(v.clientInstanceId, 'clientInstanceId');
    if (
      typeof v.fencingToken !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(v.fencingToken) ||
      BigInt(v.fencingToken) > 9223372036854775807n
    )
      invalid('无效主写代次');
    return { leaseId, clientInstanceId, fencingToken: v.fencingToken };
  }
  private scorer(a: Access) {
    if (a.staff?.role !== 'SCORER') throw forbidden();
  }
  private assertLease(l: Row | null, a: Access, control: ScoringControl, now: string) {
    if (
      !l ||
      !l.expires_at ||
      iso(l.expires_at) <= now ||
      l.holder_user_id !== a.ctx.user.id ||
      l.holder_session_id !== a.ctx.sessionId ||
      l.lease_id !== control.leaseId ||
      l.client_instance_id !== control.clientInstanceId ||
      String(l.fencing_token) !== control.fencingToken
    )
      conflict('LEASE_CONFLICT', '主写控制已失效，请重新取得控制并核对状态');
  }
  private leaseDto(l: Row, now: string): ScorekeeperLeaseData {
    return {
      leaseId: l.lease_id,
      clientInstanceId: l.client_instance_id,
      fencingToken: String(l.fencing_token),
      expiresAt: iso(l.expires_at),
      serverTime: now,
    };
  }
  async acquireLease(cookie: string | undefined, org: string, id: string, raw: unknown) {
    const input = objectInput(raw, ['clientInstanceId']);
    if (typeof input.clientInstanceId !== 'string') invalid('请提供本页实例编号');
    const tab = inputUuid(input.clientInstanceId, 'clientInstanceId');
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.access(c, ctx, id, true);
      this.scorer(a);
      const l = await this.lease(c, a, true);
      const now = await this.now(c, ctx);
      assertActiveEvent(a.event.status);
      if (!['READY', 'LIVE', 'PENDING_CONFIRMATION'].includes(a.match.status))
        conflict('INVALID_MATCH_STATE', '本场当前不能取得主写控制');
      if (l?.expires_at && iso(l.expires_at) > now) {
        if (
          l.holder_user_id === ctx.user.id &&
          l.holder_session_id === ctx.sessionId &&
          l.client_instance_id === tab
        )
          return this.leaseDto(l, now);
        conflict('LEASE_CONFLICT', '其他记分页正在控制本场比赛');
      }
      const r = await c.query<Row>(
        "UPDATE scoring_leases SET lease_id=$3,holder_user_id=$4,holder_session_id=$5,client_instance_id=$6,fencing_token=fencing_token+1,expires_at=$7::timestamptz+interval '30 seconds' WHERE org_id=$1 AND match_id=$2 RETURNING *",
        [ctx.orgId, id, randomUUID(), ctx.user.id, ctx.sessionId, tab, now],
      );
      await this.audit(c, ctx.user.id, ctx.orgId, 'scoring.lease.acquired', 'match', id);
      return this.leaseDto(r.rows[0]!, now);
    });
  }
  async renewLease(cookie: string | undefined, org: string, id: string, raw: unknown) {
    return this.changeLease(cookie, org, id, raw, false);
  }
  async releaseLease(cookie: string | undefined, org: string, id: string, raw: unknown) {
    await this.changeLease(cookie, org, id, raw, true);
    return null;
  }
  private async changeLease(
    cookie: string | undefined,
    org: string,
    id: string,
    raw: unknown,
    release: boolean,
  ) {
    const input = objectInput(raw, ['control']);
    const control = this.parseControl(input.control);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.access(c, ctx, id, true);
      this.scorer(a);
      const l = await this.lease(c, a, true);
      const now = await this.now(c, ctx);
      if (!release) assertActiveEvent(a.event.status);
      this.assertLease(l, a, control, now);
      const r = await c.query<Row>(
        `UPDATE scoring_leases SET expires_at=$3::timestamptz${release ? '' : "+interval '30 seconds'"} WHERE org_id=$1 AND match_id=$2 RETURNING *`,
        [ctx.orgId, id, now],
      );
      if (release)
        await this.audit(c, ctx.user.id, ctx.orgId, 'scoring.lease.released', 'match', id);
      return this.leaseDto(r.rows[0]!, now);
    });
  }
  private eventDtoRow(r: Row): ScoringEventData {
    return {
      id: r.id,
      seq: r.seq,
      type: r.type,
      payload: r.payload,
      actorId: r.actor_id,
      commandId: r.command_id,
      capturedAt: iso(r.captured_at),
      serverTime: iso(r.server_time),
      targetEventId: r.target_event_id,
    };
  }
  private receipt(r: Row): ScoringCommandReceipt {
    return {
      commandId: r.command_id,
      matchId: r.match_id,
      type: r.command_type,
      appliedVersion: r.applied_version,
      firstEventSeq: r.first_event_seq,
      lastEventSeq: r.last_event_seq,
      acceptedAt: iso(r.accepted_at),
    };
  }
  private async events(c: PoolClient, a: Access): Promise<ScoringEventData[]> {
    return (
      await c.query<Row>(
        'SELECT * FROM scoring_events WHERE org_id=$1 AND match_id=$2 ORDER BY seq',
        [a.ctx.orgId, a.match.id],
      )
    ).rows.map((r) => this.eventDtoRow(r));
  }
  private async commandPermission(
    c: PoolClient,
    a: Access,
    command: ScoringCommandInput,
    l: Row | null,
    now: string,
  ) {
    if (command.type === 'PREPARE_MATCH' || command.type === 'REOPEN_RESULT') {
      if (!a.manager) throw forbidden();
    } else if (command.type === 'CONFIRM_RESULT') {
      if (!(await this.confirmAllowed(c, a, l, now, false))) throw forbidden();
    } else this.scorer(a);
  }
  async executeCommand(
    cookie: string | undefined,
    org: string,
    id: string,
    raw: unknown,
  ): Promise<ScoringCommandResponse> {
    const command = parseScoringCommand(raw);
    return this.transaction((c) => this.executeCommandInTransaction(c, cookie, org, id, command));
  }
  private async executeCommandInTransaction(
    c: PoolClient,
    cookie: string | undefined,
    org: string,
    id: string,
    command: ScoringCommandInput,
  ): Promise<ScoringCommandResponse> {
    const hash = commandHash(command);
    const ctx = await this.context(c, cookie, org);
    const a = await this.access(
      c,
      ctx,
      id,
      true,
      command.type === 'PREPARE_MATCH' || command.type === 'START_MATCH',
    );
    const l = await this.lease(c, a, true);
    // A confirmation holds both Team locks before checking current leader grants.
    if (command.type === 'CONFIRM_RESULT')
      await c.query(
        'SELECT id FROM teams WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
        [ctx.orgId, [a.match.home_team_id, a.match.away_team_id]],
      );
    const activeScorers =
      command.type === 'PREPARE_MATCH'
        ? await c.query(
            "SELECT s.user_id FROM match_staff s JOIN organization_memberships m ON m.org_id=s.org_id AND m.user_id=s.user_id JOIN users u ON u.id=s.user_id WHERE s.org_id=$1 AND s.match_id=$2 AND s.role='SCORER' AND s.status='ACTIVE' AND m.status='ACTIVE' AND u.status='ACTIVE' ORDER BY s.user_id FOR SHARE OF s,m,u",
            [ctx.orgId, id],
          )
        : null;
    const now = await this.now(c, ctx);
    await this.commandPermission(c, a, command, l, now);
    // Closed events reject even an otherwise valid idempotent command replay.
    // Dedicated receipt/snapshot reads remain available for private history.
    assertActiveEvent(a.event.status);
    // Event SHARE serializes this check with next-round publication's UPDATE lock.
    // A consumed result cannot be reopened, including an old idempotent replay.
    if (command.type === 'REOPEN_RESULT' && (await this.resultConsumed(c, a)))
      conflict('KNOCKOUT_RESULT_CONSUMED', '该赛果已用于正式发布下轮，不能重开或更换晋级球队');
    const previous = await c.query<Row>(
      'SELECT * FROM scoring_commands WHERE org_id=$1 AND actor_id=$2 AND match_id=$3 AND command_id=$4',
      [ctx.orgId, ctx.user.id, id, command.commandId],
    );
    if (previous.rows[0]) {
      if (previous.rows[0].request_hash !== hash)
        conflict('IDEMPOTENCY_CONFLICT', '同一命令编号已用于不同内容');
      const snap = await this.snapshot(c, a, now);
      if (!snap) conflict('MATCH_NOT_PREPARED', '比赛尚未准备');
      return { receipt: this.receipt(previous.rows[0]), snapshot: snap! };
    }
    checkVersion(a.match.version, command.expectedVersion);
    if (command.control) this.assertLease(l, a, command.control, now);
    let st = await this.state(c, a);
    let ruleId =
      st?.ruleset_id ?? a.event.locked_scoring_ruleset_id ?? a.event.current_scoring_ruleset_id;
    if (command.type === 'PREPARE_MATCH') {
      checkVersion(a.event.version, command.payload.expectedEventVersion);
      if (a.event.status !== 'SCHEDULED' && a.event.status !== 'RUNNING')
        conflict('INVALID_EVENT_STATE', '赛事当前不能准备比赛');
      if (!ruleId) throw new ApiError(422, 'SCORING_RULES_REQUIRED', '请先明确配置赛事记分规则');
      if (!activeScorers?.rowCount) conflict('SCORER_REQUIRED', '请先分配至少一名有效记分员');
    }
    if (command.type === 'START_MATCH') {
      checkVersion(a.event.version, command.payload.expectedEventVersion);
      if (!['SCHEDULED', 'RUNNING'].includes(a.event.status))
        conflict('INVALID_EVENT_STATE', '赛事当前不能开赛');
    }
    if (!ruleId) conflict('MATCH_NOT_PREPARED', '比赛尚未准备');
    const rules = await this.rules(c, ctx.orgId, ruleId);
    if (!rules) throw notFound();
    if (
      ['SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'].includes(a.event.format) &&
      rules.tiePolicy !== 'OVERTIME'
    )
      throw new ApiError(422, 'RULE_CONFLICT', '单淘汰与分组接淘汰赛事必须设置平分加时规则');
    const history = await this.events(c, a);
    const projection = replayStats(history, rules, st?.period ?? 1);
    const mode = st
      ? scoringCollectionMode(st.collection_mode)
      : command.type === 'PREPARE_MATCH'
        ? (command.payload.collectionMode ?? 'TEAM_ONLY')
        : 'TEAM_ONLY';
    const roster = mode === 'PLAYER_BASIC' ? await this.playerRoster(c, a) : { home: [], away: [] };
    const previousPlayerStatistics = projectPlayerStatistics(mode, projection, roster);
    if (
      st &&
      (recordedCollectionMode(history) !== mode ||
        !isDeepStrictEqual(st.player_stats, previousPlayerStatistics))
    )
      conflict('PROJECTION_MISMATCH', '记分流水与球员统计投影不一致');
    if (
      st &&
      (history.length !== st.last_event_seq ||
        st.ruleset_id !== a.event.locked_scoring_ruleset_id ||
        st.source_version !== a.match.version ||
        !isDeepStrictEqual(st.period_stats, projection.periods) ||
        st.home_score !== projection.home.score ||
        st.away_score !== projection.away.score ||
        st.home_fouls !== projection.home.fouls ||
        st.away_fouls !== projection.away.fouls ||
        st.home_timeouts !== projection.home.timeouts ||
        st.away_timeouts !== projection.away.timeouts)
    )
      conflict('PROJECTION_MISMATCH', '记分流水与当前投影不一致，请联系赛事管理员');
    const previousProfessional = projectProfessionalStatistics(history, rules, roster);
    if (
      st &&
      (!!st.technical_collection !== technicalCollectionEnabled(history) ||
        !isDeepStrictEqual(st.professional_stats ?? null, previousProfessional))
    )
      conflict('PROJECTION_MISMATCH', '专业统计流水与当前投影不一致');
    const plan = planCommand({
      status: a.match.status,
      clock: st ? this.clock(st) : null,
      rules,
      events: history,
      command,
      now,
      roster,
    });
    const newVersion = a.match.version + 1;
    let seq = st?.last_event_seq ?? 0;
    const first = plan.events.length ? seq + 1 : null;
    for (const e of plan.events) {
      const event: ScoringEventData = {
        id: randomUUID(),
        seq: ++seq,
        type: e.type,
        payload: e.payload,
        actorId: ctx.user.id,
        commandId: command.commandId,
        capturedAt: command.capturedAt,
        serverTime: now,
        targetEventId: e.targetEventId ?? null,
      };
      await c.query(
        'INSERT INTO scoring_events(id,org_id,event_id,match_id,seq,type,payload,actor_id,command_id,captured_at,server_time,target_event_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)',
        [
          event.id,
          ctx.orgId,
          a.event.id,
          id,
          event.seq,
          event.type,
          JSON.stringify(event.payload),
          ctx.user.id,
          command.commandId,
          command.capturedAt,
          now,
          event.targetEventId,
        ],
      );
      history.push(event);
    }
    const totals = replayStats(history, rules, plan.clock.period);
    const playerStatistics = projectPlayerStatistics(mode, totals, roster);
    const professionalStatistics = projectProfessionalStatistics(history, rules, roster);
    const technicalCollection = technicalCollectionEnabled(history);
    let confirmationId = st?.latest_confirmation_id ?? null;
    let requires = !!st?.requires_reconfirmation || plan.isReopen;
    if (plan.isConfirmation) {
      confirmationId = randomUUID();
      await c.query(
        'INSERT INTO result_confirmations(id,org_id,event_id,match_id,confirming_user_id,ruleset_id,ruleset_version,source_match_version,last_event_seq,home_score,away_score,home_fouls,away_fouls,home_timeouts,away_timeouts,period_stats,confirmed_at,collection_mode,player_stats,technical_collection,professional_stats) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19::jsonb,$20,$21::jsonb)',
        [
          confirmationId,
          ctx.orgId,
          a.event.id,
          id,
          ctx.user.id,
          ruleId,
          rules.version,
          a.match.version,
          st?.last_event_seq ?? 0,
          totals.home.score,
          totals.away.score,
          totals.home.fouls,
          totals.away.fouls,
          totals.home.timeouts,
          totals.away.timeouts,
          JSON.stringify(totals.periods),
          now,
          mode,
          playerStatistics === null ? null : JSON.stringify(playerStatistics),
          technicalCollection,
          professionalStatistics === null ? null : JSON.stringify(professionalStatistics),
        ],
      );
      requires = false;
    }
    if (command.type === 'PREPARE_MATCH') {
      await c.query(
        'UPDATE events SET locked_scoring_ruleset_id=$3,version=version+1,updated_at=$4 WHERE org_id=$1 AND id=$2',
        [ctx.orgId, a.event.id, ruleId, now],
      );
      a.event.locked_scoring_ruleset_id = ruleId;
      a.event.version++;
    }
    if (command.type === 'START_MATCH' && a.event.status === 'SCHEDULED') {
      await c.query(
        "UPDATE events SET status='RUNNING',version=version+1,updated_at=$3 WHERE org_id=$1 AND id=$2",
        [ctx.orgId, a.event.id, now],
      );
      a.event.status = 'RUNNING';
      a.event.version++;
    }
    await c.query('UPDATE published_matches SET status=$3,version=$4 WHERE org_id=$1 AND id=$2', [
      ctx.orgId,
      id,
      plan.status,
      newVersion,
    ]);
    a.match.status = plan.status;
    a.match.version = newVersion;
    await c.query(
      'INSERT INTO scoring_states(org_id,event_id,match_id,ruleset_id,source_version,last_event_seq,home_score,away_score,home_fouls,away_fouls,home_timeouts,away_timeouts,period_stats,period,remaining_ms,clock_running,anchor_server_time,clock_version,latest_confirmation_id,requires_reconfirmation,updated_at,collection_mode,player_stats,technical_collection,professional_stats) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25::jsonb) ON CONFLICT(org_id,match_id) DO UPDATE SET source_version=EXCLUDED.source_version,last_event_seq=EXCLUDED.last_event_seq,home_score=EXCLUDED.home_score,away_score=EXCLUDED.away_score,home_fouls=EXCLUDED.home_fouls,away_fouls=EXCLUDED.away_fouls,home_timeouts=EXCLUDED.home_timeouts,away_timeouts=EXCLUDED.away_timeouts,period_stats=EXCLUDED.period_stats,period=EXCLUDED.period,remaining_ms=EXCLUDED.remaining_ms,clock_running=EXCLUDED.clock_running,anchor_server_time=EXCLUDED.anchor_server_time,clock_version=EXCLUDED.clock_version,latest_confirmation_id=EXCLUDED.latest_confirmation_id,requires_reconfirmation=EXCLUDED.requires_reconfirmation,updated_at=EXCLUDED.updated_at,player_stats=EXCLUDED.player_stats,professional_stats=EXCLUDED.professional_stats',
      [
        ctx.orgId,
        a.event.id,
        id,
        ruleId,
        newVersion,
        seq,
        totals.home.score,
        totals.away.score,
        totals.home.fouls,
        totals.away.fouls,
        totals.home.timeouts,
        totals.away.timeouts,
        JSON.stringify(totals.periods),
        plan.clock.period,
        plan.clock.remainingMs,
        plan.clock.running,
        plan.clock.anchorServerTime,
        plan.clock.clockVersion,
        confirmationId,
        requires,
        now,
        mode,
        playerStatistics === null ? null : JSON.stringify(playerStatistics),
        technicalCollection,
        professionalStatistics === null ? null : JSON.stringify(professionalStatistics),
      ],
    );
    const receiptRow = await c.query<Row>(
      'INSERT INTO scoring_commands(org_id,event_id,match_id,actor_id,command_id,request_hash,command_type,applied_version,first_event_seq,last_event_seq,accepted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [
        ctx.orgId,
        a.event.id,
        id,
        ctx.user.id,
        command.commandId,
        hash,
        command.type,
        newVersion,
        first,
        plan.events.length ? seq : null,
        now,
      ],
    );
    await this.audit(c, ctx.user.id, ctx.orgId, 'scoring.command.accepted', 'match', id, {
      commandId: command.commandId,
      type: command.type,
      version: newVersion,
    });
    const snapshot = await this.snapshot(c, a, now);
    if (!snapshot) throw notFound();
    return { receipt: this.receipt(receiptRow.rows[0]!), snapshot: snapshot! };
  }

  async submitOfflineIntent(cookie: string | undefined, org: string, id: string, raw: unknown) {
    const input = objectInput(raw, ['intent', 'control', 'confirmImport']);
    if (input.confirmImport !== true) invalid('请明确确认按原顺序导入离线草稿');
    const intent = parseOfflineScoringIntent(input.intent);
    const hash = offlineIntentHash(intent);
    const control = this.parseControl(input.control);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.access(c, ctx, id, true);
      this.scorer(a);
      assertActiveEvent(a.event.status);
      const now = await this.now(c, ctx);
      this.assertLease(await this.lease(c, a, true), a, control, now);
      const prior = await c.query<Row>(
        'SELECT i.*,s.* FROM scoring_offline_intents i JOIN scoring_commands s ON s.org_id=i.org_id AND s.actor_id=i.actor_id AND s.match_id=i.match_id AND s.command_id=i.command_id WHERE i.org_id=$1 AND i.actor_id=$2 AND i.match_id=$3 AND i.intent_id=$4',
        [ctx.orgId, ctx.user.id, id, intent.intentId],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].intent_hash !== hash)
          conflict('IDEMPOTENCY_CONFLICT', '同一离线编号已用于不同内容');
        const snapshot = await this.snapshot(c, a, now);
        if (!snapshot) conflict('MATCH_NOT_PREPARED', '比赛尚未准备');
        return { intentId: intent.intentId, receipt: this.receipt(prior.rows[0]), snapshot };
      }
      const position = await c.query<Row>(
        'SELECT * FROM scoring_offline_intents WHERE org_id=$1 AND actor_id=$2 AND match_id=$3 AND queue_id=$4 AND ordinal=$5',
        [ctx.orgId, ctx.user.id, id, intent.queueId, intent.ordinal],
      );
      if (position.rowCount)
        conflict('OFFLINE_ORDER_CONFLICT', '此离线顺序已用于另一条原操作，请逐条核对');
      if (intent.ordinal > 1) {
        const previous = await c.query<Row>(
          'SELECT i.*,s.applied_version FROM scoring_offline_intents i JOIN scoring_commands s ON s.org_id=i.org_id AND s.actor_id=i.actor_id AND s.match_id=i.match_id AND s.command_id=i.command_id WHERE i.org_id=$1 AND i.actor_id=$2 AND i.match_id=$3 AND i.intent_id=$4 AND i.queue_id=$5 AND i.ordinal=$6',
          [ctx.orgId, ctx.user.id, id, intent.previousIntentId, intent.queueId, intent.ordinal - 1],
        );
        if (
          !previous.rows[0] ||
          previous.rows[0].applied_version !== intent.command.expectedVersion
        )
          conflict('OFFLINE_ORDER_CONFLICT', '前一条离线操作尚未接受或原版本链不一致');
      }
      const normal = await c.query(
        'SELECT 1 FROM scoring_commands WHERE org_id=$1 AND actor_id=$2 AND match_id=$3 AND command_id=$4',
        [ctx.orgId, ctx.user.id, id, intent.intentId],
      );
      if (normal.rowCount)
        conflict('OFFLINE_ID_CONFLICT', '原编号已用于在线命令，请核对原回执，不能另作导入');
      const result = await this.executeCommandInTransaction(c, cookie, org, id, {
        ...intent.command,
        control,
      } as ScoringCommandInput);
      await c.query(
        'INSERT INTO scoring_offline_intents(org_id,event_id,match_id,actor_id,intent_id,queue_id,ordinal,previous_intent_id,intent_hash,command_id,accepted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$5,$10)',
        [
          ctx.orgId,
          a.event.id,
          id,
          ctx.user.id,
          intent.intentId,
          intent.queueId,
          intent.ordinal,
          intent.previousIntentId,
          hash,
          result.receipt.acceptedAt,
        ],
      );
      return { intentId: intent.intentId, ...result };
    });
  }
  async getOfflineIntent(cookie: string | undefined, org: string, id: string, intentId: string) {
    resourceId(intentId);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.access(c, ctx, id);
      this.scorer(a);
      const row = await c.query<Row>(
        'SELECT s.* FROM scoring_offline_intents i JOIN scoring_commands s ON s.org_id=i.org_id AND s.actor_id=i.actor_id AND s.match_id=i.match_id AND s.command_id=i.command_id WHERE i.org_id=$1 AND i.actor_id=$2 AND i.match_id=$3 AND i.intent_id=$4',
        [ctx.orgId, ctx.user.id, id, intentId],
      );
      if (!row.rows[0])
        throw new ApiError(404, 'OFFLINE_INTENT_NOT_FOUND', '未找到本账号的原离线回执');
      const snapshot = await this.snapshot(c, a, await this.now(c, ctx));
      if (!snapshot) conflict('MATCH_NOT_PREPARED', '比赛尚未准备');
      return { intentId, receipt: this.receipt(row.rows[0]), snapshot };
    });
  }
  async getCommand(cookie: string | undefined, org: string, id: string, commandId: string) {
    resourceId(commandId);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.access(c, ctx, id);
      const result = await c.query<Row>(
        'SELECT * FROM scoring_commands WHERE org_id=$1 AND actor_id=$2 AND match_id=$3 AND command_id=$4',
        [ctx.orgId, ctx.user.id, id, commandId],
      );
      if (!result.rows[0]) throw new ApiError(404, 'COMMAND_NOT_FOUND', '未找到该身份的命令回执');
      const command = { type: result.rows[0].command_type } as ScoringCommandInput;
      if (command.type === 'CONFIRM_RESULT')
        await c.query(
          'SELECT id FROM teams WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
          [ctx.orgId, [a.match.home_team_id, a.match.away_team_id]],
        );
      const now = await this.now(c, ctx);
      await this.commandPermission(c, a, command, await this.lease(c, a), now);
      const snapshot = await this.snapshot(c, a, now);
      if (!snapshot) conflict('MATCH_NOT_PREPARED', '比赛尚未准备');
      return { receipt: this.receipt(result.rows[0]), snapshot: snapshot! };
    });
  }
  private cursor(raw: string | undefined, scope: string): Row | null {
    if (!raw) return null;
    try {
      const v = objectInput(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')), [
        'scope',
        'key',
        'id',
      ]);
      if (v.scope !== scope || typeof v.key !== 'string' || typeof v.id !== 'string')
        invalid('无效分页游标');
      resourceId(v.id);
      return v;
    } catch {
      return invalid('无效或不匹配的分页游标');
    }
  }
  private next(scope: string, key: string, id: string) {
    return Buffer.from(JSON.stringify({ scope, key, id })).toString('base64url');
  }
  async listScoringEvents(cookie: string | undefined, org: string, id: string, raw: unknown) {
    return this.listHistory(cookie, org, id, raw, false);
  }
  async listResultConfirmations(cookie: string | undefined, org: string, id: string, raw: unknown) {
    return this.listHistory(cookie, org, id, raw, true);
  }
  private async listHistory(
    cookie: string | undefined,
    org: string,
    id: string,
    raw: unknown,
    confirmation: boolean,
  ) {
    const q = pageInput(raw);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.access(c, ctx, id);
      const now = await this.now(c, ctx);
      void now;
      const scope = `${confirmation ? 'confirmations' : 'scoring-events'}:${ctx.orgId}:${ctx.user.id}:${id}`;
      const cur = this.cursor(q.cursor, scope);
      if (cur && (!/^[1-9]\d{0,9}$/.test(cur.key) || Number(cur.key) > 2147483647))
        invalid('无效分页游标');
      const field = confirmation ? 'source_match_version' : 'seq';
      const table = confirmation ? 'result_confirmations' : 'scoring_events';
      const result = await c.query<Row>(
        `SELECT * FROM ${table} WHERE org_id=$1 AND match_id=$2 AND ($3::int IS NULL OR (${field},id)>($3::int,$4::uuid)) ORDER BY ${field},id LIMIT $5`,
        [ctx.orgId, a.match.id, cur ? Number(cur.key) : null, cur?.id ?? null, q.limit + 1],
      );
      const rows = result.rows.slice(0, q.limit);
      const last = rows.at(-1);
      return {
        data: rows.map((r) => (confirmation ? this.confirmation(r) : this.eventDtoRow(r))),
        nextCursor:
          result.rows.length > q.limit && last
            ? this.next(scope, String(last[field]), last.id)
            : null,
      };
    });
  }
  async listScoringMatches(cookie: string | undefined, org: string, raw: unknown) {
    const input = objectInput(raw, ['limit', 'cursor', 'eventId', 'status']);
    const q = pageInput({
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    let eventId: string | null = null;
    let status: MatchStatus | null = null;
    if (input.eventId !== undefined)
      eventId = resourceId(typeof input.eventId === 'string' ? input.eventId : '');
    if (input.status !== undefined) {
      if (!(MATCH_STATUSES as readonly unknown[]).includes(input.status)) invalid('无效比赛状态');
      status = input.status as MatchStatus;
    }
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const scope = `scoring-matches:${ctx.orgId}:${ctx.user.id}:${eventId ?? ''}:${status ?? ''}`;
      const cur = this.cursor(q.cursor, scope);
      if (
        cur &&
        (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cur.key) ||
          !Number.isFinite(Date.parse(cur.key)))
      )
        invalid('无效分页游标');
      if (cur) {
        calendarDate(cur.key.slice(0, 10), 'cursor');
        const time = cur.key.slice(11, 19).split(':').map(Number);
        if (time[0] > 23 || time[1] > 59 || time[2] > 59) invalid('无效分页游标');
      }
      const result = await c.query<Row>(
        `SELECT m.*,e.name AS event_name,s.home_score,s.away_score,to_char(m.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM published_matches m JOIN events e ON e.org_id=m.org_id AND e.id=m.event_id LEFT JOIN scoring_states s ON s.org_id=m.org_id AND s.match_id=m.id WHERE m.org_id=$1 AND ($2::uuid IS NULL OR m.event_id=$2) AND ($3::text IS NULL OR m.status=$3) AND ($4::boolean OR EXISTS(SELECT 1 FROM event_staff es WHERE es.org_id=m.org_id AND es.event_id=m.event_id AND es.user_id=$5 AND es.status='ACTIVE') OR EXISTS(SELECT 1 FROM match_staff ms WHERE ms.org_id=m.org_id AND ms.match_id=m.id AND ms.user_id=$5 AND ms.status='ACTIVE')) AND ($6::timestamptz IS NULL OR (m.starts_at,m.id)>($6::timestamptz,$7::uuid)) ORDER BY m.starts_at,m.id LIMIT $8`,
        [
          ctx.orgId,
          eventId,
          status,
          isAdministrator(ctx.role),
          ctx.user.id,
          cur?.key ?? null,
          cur?.id ?? null,
          q.limit + 1,
        ],
      );
      await this.now(c, ctx);
      const rows = result.rows.slice(0, q.limit);
      const last = rows.at(-1);
      return {
        data: rows.map((r): ScoringMatchSummary => ({
          matchId: r.id,
          eventId: r.event_id,
          eventName: r.event_name,
          homeTeamName: r.home_team_name,
          awayTeamName: r.away_team_name,
          courtName: r.court_name,
          startsAt: iso(r.starts_at),
          status: r.status,
          version: r.version,
          score: r.home_score === null ? null : { home: r.home_score, away: r.away_score },
        })),
        nextCursor:
          result.rows.length > q.limit && last ? this.next(scope, last.cursor_time, last.id) : null,
      };
    });
  }
}
