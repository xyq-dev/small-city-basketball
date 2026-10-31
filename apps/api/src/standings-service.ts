import {
  administrativeResult,
  resolutionCounts,
  exceptionResultSelect,
  exceptionResultJoins,
} from './match-exception-domain.js';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { MATCH_STATUSES, STANDINGS_ALGORITHM_VERSION } from '@small-city-basketball/contracts';
import type {
  EventData,
  EventStandingsData,
  StandingsRulesetData,
  PublicViewingPublicationData,
  PublicStandingsData,
  PublicStandingsRules,
  PublicEventData,
  PublicScheduleMatchData,
  PublicMatchSnapshotData,
  ScoringTotals,
  PublicKnockoutData,
  PublicGroupKnockoutData,
  GroupKnockoutProjection,
} from '@small-city-basketball/contracts';
import { ApplicationService, EVENT_SELECT, isAdministrator } from './service.js';
import type { EventRow, OrgActor } from './service.js';
import { ApiError, forbidden, notFound, unauthenticated } from './errors.js';
import { calendarDate, invalid, objectInput, resourceId } from './validation.js';
import { expectedVersion, pageInput } from './registration-validation.js';
import {
  calculateStandings,
  parseStandingsRules,
  resultSourceInvalid,
} from './standings-domain.js';
import { calculateGroupKnockout } from './group-knockout-domain.js';
import { groupEvidence } from './group-knockout-repository.js';
import { calculateKnockout } from './knockout-domain.js';
import type { ResultRow, StandingParticipant } from './standings-domain.js';
import {
  activeEvent,
  closedEvent,
  completionReadiness,
  knockoutCompletionReadiness,
  publicViewingAllowed,
} from './event-lifecycle-domain.js';
type Row = Record<string, any>;
export interface StandingsAccess {
  ctx: OrgActor;
  event: EventRow & {
    current_standings_ruleset_id: string | null;
    locked_standings_ruleset_id: string | null;
  };
  manager: boolean;
}
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const conflict = (code: string, message: string): never => {
  throw new ApiError(409, code, message);
};
const version = (actual: number, expected: number) => {
  if (actual !== expected)
    throw new ApiError(409, 'VERSION_CONFLICT', '赛事已更新，请重新读取后操作', {
      currentVersion: actual,
    });
};
const publicId = (v: string) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(v)) throw notFound();
  return v;
};
export class StandingsService extends ApplicationService {
  protected async context(c: PoolClient, cookie: string | undefined, org: string) {
    return this.lockOrganization(c, await this.lockActor(c, cookie), org);
  }
  protected async event(
    c: PoolClient,
    ctx: OrgActor,
    id: string,
    write = false,
  ): Promise<StandingsAccess> {
    const r = await c.query<StandingsAccess['event']>(
      `SELECT ${EVENT_SELECT} FROM events e WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'} OF e`,
      [ctx.orgId, resourceId(id)],
    );
    const event = r.rows[0];
    if (!event) throw notFound();
    const staff = await c.query<Row>(
      "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
      [ctx.orgId, event.id, ctx.user.id],
    );
    if (!isAdministrator(ctx.role) && !staff.rows[0]) throw notFound();
    if (
      !['ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'].includes(
        event.format,
      )
    )
      throw new ApiError(
        422,
        'UNSUPPORTED_STANDINGS_FORMAT',
        '仅支持2至32队循环排名、单淘汰或分组接淘汰',
      );
    return {
      ctx,
      event,
      manager: isAdministrator(ctx.role) || staff.rows[0]?.role === 'EVENT_MANAGER',
    };
  }
  protected async now(c: PoolClient, ctx?: OrgActor) {
    const r = await c.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    const now = r.rows[0]!.now.toISOString();
    if (ctx) {
      const s = await c.query(
        'SELECT id FROM sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>$2::timestamptz',
        [ctx.sessionId, now],
      );
      if (!s.rowCount) throw unauthenticated();
    }
    return now;
  }
  protected eventDto(a: StandingsAccess): EventData {
    const e = a.event;
    return {
      id: e.id,
      name: e.name,
      startDate: e.start_date,
      endDate: e.end_date,
      timezone: e.timezone,
      venueName: e.venue_name,
      format: e.format,
      status: e.status,
      version: e.version,
      createdAt: iso(e.created_at),
      updatedAt: iso(e.updated_at),
      permissions: { canEditDraft: a.manager && e.status === 'DRAFT' },
    };
  }
  protected async rules(
    c: PoolClient,
    org: string,
    id: string | null,
  ): Promise<StandingsRulesetData | null> {
    if (!id) return null;
    const r = (
      await c.query<Row>('SELECT * FROM standings_rulesets WHERE org_id=$1 AND id=$2', [org, id])
    ).rows[0];
    if (!r) resultSourceInvalid();
    return {
      id: r.id,
      eventId: r.event_id,
      version: r.version,
      algorithmVersion: r.algorithm_version,
      winPoints: r.win_points,
      lossPoints: r.loss_points,
      drawPoints: r.draw_points,
      tiebreakers: r.tiebreakers,
      createdAt: iso(r.created_at),
    };
  }
  protected async plan(c: PoolClient, org: string, event: string): Promise<Row | null> {
    return (
      (
        await c.query<Row>(
          `SELECT p.*,r.source,r.seed,r.policy,r.algorithm_version,r.group_config,COALESCE((SELECT jsonb_agg(jsonb_build_object('roundNo',k.round_no,'sources',k.sources) ORDER BY k.round_no) FROM knockout_round_publications k WHERE k.org_id=p.org_id AND k.event_id=p.event_id),'[]'::jsonb) AS round_publications FROM schedule_publications p JOIN schedule_revisions r ON r.org_id=p.org_id AND r.event_id=p.event_id AND r.id=p.revision_id WHERE p.org_id=$1 AND p.event_id=$2`,
          [org, event],
        )
      ).rows[0] ?? null
    );
  }
  protected async publication(c: PoolClient, org: string, event: string): Promise<Row | null> {
    return (
      (
        await c.query<Row>(
          'SELECT * FROM public_event_publications WHERE org_id=$1 AND event_id=$2 ORDER BY (revoked_at IS NULL) DESC,created_at DESC,id DESC LIMIT 1',
          [org, event],
        )
      ).rows[0] ?? null
    );
  }
  private publicationDto(p: Row | null): PublicViewingPublicationData | null {
    return p
      ? {
          publicEventId: p.public_event_id,
          purpose: p.purpose,
          status: p.revoked_at ? 'REVOKED' : 'ACTIVE',
          createdAt: iso(p.created_at),
          revokedAt: p.revoked_at ? iso(p.revoked_at) : null,
        }
      : null;
  }
  // The entire mutable result proof is read in one statement snapshot. No per-match queries.
  protected async matches(
    c: PoolClient,
    org: string,
    event: string,
    publicPublicationId: string | null = null,
  ): Promise<ResultRow[]> {
    return (
      await c.query<ResultRow>(
        `SELECT m.*,${exceptionResultSelect},to_jsonb(s) AS state,to_jsonb(cf) AS confirmation,to_jsonb(le) AS last_event,to_jsonb(rc) AS last_command,to_jsonb(sr) AS scoring_rules,pl.public_match_id,to_char(m.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM published_matches m LEFT JOIN scoring_states s ON s.org_id=m.org_id AND s.match_id=m.id LEFT JOIN result_confirmations cf ON cf.org_id=m.org_id AND cf.match_id=m.id AND cf.id=s.latest_confirmation_id LEFT JOIN scoring_events le ON le.org_id=m.org_id AND le.match_id=m.id AND le.seq=s.last_event_seq LEFT JOIN scoring_commands rc ON rc.org_id=m.org_id AND rc.match_id=m.id AND rc.actor_id=le.actor_id AND rc.command_id=le.command_id LEFT JOIN scoring_rulesets sr ON sr.org_id=m.org_id AND sr.event_id=m.event_id AND sr.id=s.ruleset_id LEFT JOIN public_match_links pl ON pl.org_id=m.org_id AND pl.event_id=m.event_id AND pl.match_id=m.id AND pl.publication_id=$3 ${exceptionResultJoins} WHERE m.org_id=$1 AND m.event_id=$2 ORDER BY m.starts_at,m.id`,
        [org, event, publicPublicationId],
      )
    ).rows;
  }
  protected participants(plan: Row): StandingParticipant[] {
    if (!Array.isArray(plan.source?.entries)) resultSourceInvalid();
    return plan.source.entries.map((e: Row) => ({
      entryId: e.entryId,
      teamId: e.teamId,
      teamName: e.teamName,
    }));
  }
  private async view(
    c: PoolClient,
    a: StandingsAccess,
    now: string,
    skipStandings = false,
  ): Promise<EventStandingsData> {
    const knockout = a.event.format === 'SINGLE_ELIMINATION';
    const rules = knockout
      ? null
      : await this.rules(
          c,
          a.ctx.orgId,
          a.event.locked_standings_ruleset_id ?? a.event.current_standings_ruleset_id,
        );
    const plan = await this.plan(c, a.ctx.orgId, a.event.id);
    const pub = await this.publication(c, a.ctx.orgId, a.event.id);
    let standings = null;
    let historyReady = false;
    if (knockout && plan && !skipStandings) {
      const matches = await this.matches(c, a.ctx.orgId, a.event.id);
      const completion = knockoutCompletionReadiness({
        publicationId: plan.id,
        source: plan.source,
        seed: plan.seed,
        policy: plan.policy,
        roundPublications: plan.round_publications,
        matches,
        asOf: now,
      });
      if (completion.blockers.includes('RESULT_SOURCE_INVALID')) resultSourceInvalid();
      historyReady = closedEvent(a.event.status) && completion.ready;
    }
    if (a.event.format === 'GROUP_KNOCKOUT' && rules && plan && !skipStandings) {
      const competition = await this.groupCompetition(
        c,
        a.event,
        plan,
        await this.matches(c, a.ctx.orgId, a.event.id),
        now,
      );
      historyReady = closedEvent(a.event.status) && competition.isComplete;
    }
    if (
      ['ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN'].includes(a.event.format) &&
      rules &&
      plan &&
      !skipStandings
    ) {
      const matches = await this.matches(c, a.ctx.orgId, a.event.id);
      standings = calculateStandings({
        format:
          String(a.event.format) === 'DOUBLE_ROUND_ROBIN' ? 'DOUBLE_ROUND_ROBIN' : 'ROUND_ROBIN',
        participants: this.participants(plan),
        matches,
        rules,
        publicationId: plan.id,
        asOf: now,
        mode: a.event.locked_standings_ruleset_id ? 'PUBLISHED' : 'DRAFT_PREVIEW',
      });
      if (closedEvent(a.event.status) && a.event.locked_standings_ruleset_id)
        historyReady = completionReadiness({
          format:
            String(a.event.format) === 'DOUBLE_ROUND_ROBIN' ? 'DOUBLE_ROUND_ROBIN' : 'ROUND_ROBIN',
          participants: this.participants(plan),
          matches,
          rules,
          publicationId: plan.id,
          asOf: now,
        }).ready;
    }
    return {
      event: this.eventDto(a),
      rules,
      locked: !!a.event.locked_standings_ruleset_id,
      standings,
      publication: this.publicationDto(pub),
      capabilities: {
        canManageRules:
          !knockout &&
          a.manager &&
          !closedEvent(a.event.status) &&
          a.event.status !== 'CANCELLED' &&
          !a.event.locked_standings_ruleset_id,
        canPublishRules:
          !knockout &&
          a.manager &&
          !closedEvent(a.event.status) &&
          a.event.status !== 'CANCELLED' &&
          !!rules &&
          !a.event.locked_standings_ruleset_id,
        canEnablePublicViewing:
          a.manager &&
          (activeEvent(a.event.status) || historyReady) &&
          (knockout || !!a.event.locked_standings_ruleset_id) &&
          !!plan &&
          (!pub || !!pub.revoked_at),
        canDisablePublicViewing: a.manager && !!pub && !pub.revoked_at,
      },
    };
  }
  protected async touch(c: PoolClient, a: StandingsAccess, now: string) {
    await c.query('UPDATE events SET version=version+1,updated_at=$3 WHERE org_id=$1 AND id=$2', [
      a.ctx.orgId,
      a.event.id,
      now,
    ]);
    a.event.version++;
    a.event.updated_at = new Date(now);
  }
  async getStandings(cookie: string | undefined, org: string, id: string) {
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.event(c, ctx, id);
      return this.view(c, a, await this.now(c, ctx));
    });
  }
  async updateRules(cookie: string | undefined, org: string, id: string, raw: unknown) {
    const input = objectInput(raw, [
      'expectedEventVersion',
      'winPoints',
      'lossPoints',
      'drawPoints',
      'tiebreakers',
    ]);
    const expected = expectedVersion(input.expectedEventVersion);
    const { expectedEventVersion: _, ...rest } = input;
    const rules = parseStandingsRules(rest);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.event(c, ctx, id, true);
      if (!['ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'GROUP_KNOCKOUT'].includes(a.event.format))
        throw new ApiError(
          422,
          'UNSUPPORTED_STANDINGS_FORMAT',
          '淘汰赛按签位及确认胜者产生名次，不配置循环赛积分规则',
        );
      if (!a.manager) throw forbidden();
      const now = await this.now(c, ctx);
      version(a.event.version, expected);
      if (closedEvent(a.event.status) || a.event.status === 'CANCELLED')
        conflict('INVALID_EVENT_STATE', '赛事当前不能修改排名规则');
      if (a.event.locked_standings_ruleset_id)
        conflict('STANDINGS_RULES_LOCKED', '排名规则已正式发布并锁定');
      const v = (
        await c.query<{ version: number }>(
          'SELECT COALESCE(MAX(version),0)::int+1 AS version FROM standings_rulesets WHERE org_id=$1 AND event_id=$2',
          [ctx.orgId, id],
        )
      ).rows[0]!.version;
      const ruleId = randomUUID();
      await c.query(
        'INSERT INTO standings_rulesets(id,org_id,event_id,version,algorithm_version,win_points,loss_points,draw_points,tiebreakers,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          ruleId,
          ctx.orgId,
          id,
          v,
          STANDINGS_ALGORITHM_VERSION,
          rules.winPoints,
          rules.lossPoints,
          rules.drawPoints,
          rules.tiebreakers,
          ctx.user.id,
        ],
      );
      await c.query('UPDATE events SET current_standings_ruleset_id=$3 WHERE org_id=$1 AND id=$2', [
        ctx.orgId,
        id,
        ruleId,
      ]);
      a.event.current_standings_ruleset_id = ruleId;
      await this.touch(c, a, now);
      await this.audit(c, ctx.user.id, ctx.orgId, 'standings.rules.saved', 'event', id, {
        rulesetId: ruleId,
      });
      return this.view(c, a, now);
    });
  }
  async ruleCommand(cookie: string | undefined, org: string, id: string, raw: unknown) {
    const input = objectInput(raw, ['type', 'rulesetId', 'expectedEventVersion']);
    if (input.type !== 'PUBLISH_STANDINGS_RULES') invalid('不支持的排名规则操作');
    const expected = expectedVersion(input.expectedEventVersion);
    const ruleId = resourceId(typeof input.rulesetId === 'string' ? input.rulesetId : '');
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.event(c, ctx, id, true);
      if (!['ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'GROUP_KNOCKOUT'].includes(a.event.format))
        throw new ApiError(
          422,
          'UNSUPPORTED_STANDINGS_FORMAT',
          '淘汰赛按签位及确认胜者产生名次，不配置循环赛积分规则',
        );
      if (!a.manager) throw forbidden();
      const now = await this.now(c, ctx);
      version(a.event.version, expected);
      if (closedEvent(a.event.status) || a.event.status === 'CANCELLED')
        conflict('INVALID_EVENT_STATE', '赛事当前不能发布排名规则');
      if (a.event.locked_standings_ruleset_id)
        conflict('STANDINGS_RULES_LOCKED', '排名规则已正式发布并锁定');
      if (!a.event.current_standings_ruleset_id)
        throw new ApiError(422, 'STANDINGS_RULES_REQUIRED', '请先保存显式排名规则');
      const selected = await c.query(
        'SELECT id FROM standings_rulesets WHERE org_id=$1 AND event_id=$2 AND id=$3',
        [ctx.orgId, id, ruleId],
      );
      if (!selected.rowCount) throw notFound();
      if (a.event.current_standings_ruleset_id !== ruleId)
        conflict('STANDINGS_RULESET_NOT_CURRENT', '仅可发布当前草稿规则');
      const rules = await this.rules(c, ctx.orgId, ruleId);
      if (!rules || rules.eventId !== a.event.id) throw notFound();
      await c.query('UPDATE events SET locked_standings_ruleset_id=$3 WHERE org_id=$1 AND id=$2', [
        ctx.orgId,
        id,
        ruleId,
      ]);
      a.event.locked_standings_ruleset_id = ruleId;
      await this.touch(c, a, now);
      await this.audit(c, ctx.user.id, ctx.orgId, 'standings.rules.published', 'event', id, {
        rulesetId: ruleId,
      });
      return this.view(c, a, now);
    });
  }
  async publicViewingCommand(cookie: string | undefined, org: string, id: string, raw: unknown) {
    const input = objectInput(raw, ['type', 'expectedEventVersion']);
    if (!['ENABLE', 'ENABLE_HISTORY', 'DISABLE'].includes(input.type as string))
      invalid('不支持的公开观赛操作');
    const expected = expectedVersion(input.expectedEventVersion);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.event(c, ctx, id, true);
      if (!a.manager) throw forbidden();
      const pub = await this.publication(c, ctx.orgId, id);
      if (pub)
        await c.query('SELECT id FROM public_event_publications WHERE id=$1 FOR UPDATE', [pub.id]);
      const now = await this.now(c, ctx);
      version(a.event.version, expected);
      if (input.type === 'DISABLE') {
        if (!pub || pub.revoked_at) conflict('PUBLIC_VIEWING_NOT_ENABLED', '当前没有启用公开观赛');
        await c.query(
          'UPDATE public_event_publications SET revoked_at=$2,revoked_by=$3 WHERE id=$1',
          [pub!.id, now, ctx.user.id],
        );
        await this.touch(c, a, now);
        await this.audit(c, ctx.user.id, ctx.orgId, 'public_viewing.disabled', 'event', id);
        return this.view(c, a, now, true);
      }
      const purpose = input.type === 'ENABLE_HISTORY' ? 'HISTORY' : 'LIVE';
      if (pub && !pub.revoked_at)
        conflict('PUBLIC_VIEWING_ALREADY_ENABLED', '公开观赛已启用，请读取当前链接');
      const knockout = a.event.format === 'SINGLE_ELIMINATION';
      if (!knockout && !a.event.locked_standings_ruleset_id)
        throw new ApiError(422, 'STANDINGS_RULES_REQUIRED', '请先显式发布排名规则');
      const plan = await this.plan(c, ctx.orgId, id);
      if (!plan) throw new ApiError(422, 'SCHEDULE_REQUIRED', '请先正式发布赛程');
      // Preserve existing missing-source errors before checking the publication purpose.
      if (!publicViewingAllowed(a.event.status, purpose))
        conflict(
          'INVALID_EVENT_STATE',
          purpose === 'HISTORY' ? '仅已完赛或归档赛事可显式公开历史' : '仅活动赛事可启用实时观赛',
        );
      const rules = knockout
        ? null
        : await this.rules(c, ctx.orgId, a.event.locked_standings_ruleset_id);
      if (!knockout && !rules) resultSourceInvalid();
      const rows = await this.matches(c, ctx.orgId, id);
      if (knockout) {
        const completion = knockoutCompletionReadiness({
          publicationId: plan.id,
          source: plan.source,
          seed: plan.seed,
          policy: plan.policy,
          roundPublications: plan.round_publications,
          matches: rows,
          asOf: now,
        });
        if (completion.blockers.includes('RESULT_SOURCE_INVALID')) resultSourceInvalid();
        if (purpose === 'HISTORY' && !completion.ready)
          throw new ApiError(
            422,
            'EVENT_COMPLETION_BLOCKED',
            '历史观赛需要完整淘汰轮次及全部有效确认',
            { blockers: completion.blockers },
          );
      } else if (a.event.format === 'GROUP_KNOCKOUT') {
        const competition = await this.groupCompetition(c, a.event, plan, rows, now);
        if (purpose === 'HISTORY' && !competition.isComplete)
          throw new ApiError(
            422,
            'EVENT_COMPLETION_BLOCKED',
            '历史观赛需要完整分组及淘汰全部有效确认',
          );
      } else {
        const standings = calculateStandings({
          format:
            String(a.event.format) === 'DOUBLE_ROUND_ROBIN' ? 'DOUBLE_ROUND_ROBIN' : 'ROUND_ROBIN',
          participants: this.participants(plan),
          matches: rows,
          rules: rules!,
          publicationId: plan.id,
          asOf: now,
          mode: 'PUBLISHED',
        });
        if (purpose === 'HISTORY') {
          const completion = completionReadiness({
            format:
              String(a.event.format) === 'DOUBLE_ROUND_ROBIN'
                ? 'DOUBLE_ROUND_ROBIN'
                : 'ROUND_ROBIN',
            participants: this.participants(plan),
            matches: rows,
            rules,
            publicationId: plan.id,
            asOf: now,
          });
          if (!standings.isComplete || !completion.ready)
            throw new ApiError(
              422,
              'EVENT_COMPLETION_BLOCKED',
              '历史观赛需要所有比赛当前有效确认',
              { blockers: completion.blockers },
            );
        }
      }
      const teamKeys = Object.fromEntries(
        this.participants(plan).map((p) => [p.entryId, randomBytes(16).toString('base64url')]),
      );
      const publicationId = randomUUID();
      await c.query(
        'INSERT INTO public_event_publications(id,org_id,event_id,schedule_publication_id,ruleset_id,public_event_id,team_keys,created_by,created_at,purpose) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)',
        [
          publicationId,
          ctx.orgId,
          id,
          plan.id,
          rules?.id ?? null,
          randomBytes(32).toString('base64url'),
          JSON.stringify(teamKeys),
          ctx.user.id,
          now,
          purpose,
        ],
      );
      await c.query(
        'INSERT INTO public_match_links(org_id,event_id,publication_id,schedule_publication_id,match_id,public_match_id) SELECT $1,$2,$3,$4,t.match_id,t.public_id FROM unnest($5::uuid[],$6::text[]) AS t(match_id,public_id)',
        [
          ctx.orgId,
          id,
          publicationId,
          plan.id,
          rows.map((m) => m.id),
          rows.map(() => randomBytes(32).toString('base64url')),
        ],
      );
      await this.touch(c, a, now);
      await this.audit(c, ctx.user.id, ctx.orgId, 'public_viewing.enabled', 'event', id, {
        purpose,
      });
      return this.view(c, a, now);
    });
  }
  protected async publicAccess(c: PoolClient, id: string) {
    publicId(id);
    const ref = (
      await c.query<Row>(
        'SELECT org_id,event_id FROM public_event_publications WHERE public_event_id=$1',
        [id],
      )
    ).rows[0];
    if (!ref) throw notFound();
    const org = await c.query(
      "SELECT id FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
      [ref.org_id],
    );
    if (!org.rowCount) throw notFound();
    const event = (
      await c.query<StandingsAccess['event']>(
        `SELECT ${EVENT_SELECT} FROM events e WHERE org_id=$1 AND id=$2 FOR SHARE OF e`,
        [ref.org_id, ref.event_id],
      )
    ).rows[0];
    if (
      !event ||
      !['ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'].includes(
        event.format,
      )
    )
      throw notFound();
    const pub = (
      await c.query<Row>(
        'SELECT * FROM public_event_publications WHERE org_id=$1 AND event_id=$2 AND public_event_id=$3 AND revoked_at IS NULL FOR SHARE',
        [ref.org_id, ref.event_id, id],
      )
    ).rows[0];
    if (!pub || !publicViewingAllowed(event.status, pub.purpose)) throw notFound();
    return { event, pub };
  }
  private publicRules(r: StandingsRulesetData): PublicStandingsRules {
    return {
      version: r.version,
      algorithmVersion: r.algorithmVersion,
      winPoints: r.winPoints,
      lossPoints: r.lossPoints,
      drawPoints: r.drawPoints,
      tiebreakers: [...r.tiebreakers],
    };
  }
  protected async publicBundle(c: PoolClient, id: string, targetMatch?: string) {
    const a = await this.publicAccess(c, id);
    const now = await this.now(c);
    const knockout = a.event.format === 'SINGLE_ELIMINATION';
    const rules = knockout
      ? null
      : await this.rules(c, a.event.org_id, a.event.locked_standings_ruleset_id);
    const plan = await this.plan(c, a.event.org_id, a.event.id);
    if (
      !plan ||
      plan.id !== a.pub.schedule_publication_id ||
      (knockout ? a.pub.ruleset_id !== null : !rules || rules.id !== a.pub.ruleset_id)
    )
      throw notFound();
    const rows = await this.matches(c, a.event.org_id, a.event.id, a.pub.id);
    if (rows.some((r) => !r.public_match_id)) resultSourceInvalid();
    if (targetMatch && !rows.some((r) => r.public_match_id === targetMatch)) throw notFound();
    const groupCompetition =
      a.event.format === 'GROUP_KNOCKOUT'
        ? await this.groupCompetition(c, a.event, plan, rows, now)
        : null;
    const bracket =
      groupCompetition?.bracket ??
      (knockout
        ? calculateKnockout({
            publicationId: plan.id,
            source: plan.source,
            seed: plan.seed,
            policy: plan.policy,
            roundPublications: plan.round_publications,
            matches: rows,
            asOf: now,
          })
        : null);
    const standings =
      knockout || groupCompetition
        ? null
        : calculateStandings({
            format:
              String(a.event.format) === 'DOUBLE_ROUND_ROBIN'
                ? 'DOUBLE_ROUND_ROBIN'
                : 'ROUND_ROBIN',
            participants: this.participants(plan),
            matches: rows,
            rules: rules!,
            publicationId: plan.id,
            asOf: now,
            mode: 'PUBLISHED',
          });
    if (a.pub.purpose === 'HISTORY') {
      if (groupCompetition && !groupCompetition.isComplete) resultSourceInvalid();
      const completion = groupCompetition
        ? { ready: groupCompetition.isComplete }
        : knockout
          ? knockoutCompletionReadiness({
              publicationId: plan.id,
              source: plan.source,
              seed: plan.seed,
              policy: plan.policy,
              roundPublications: plan.round_publications,
              matches: rows,
              asOf: now,
            })
          : completionReadiness({
              format:
                String(a.event.format) === 'DOUBLE_ROUND_ROBIN'
                  ? 'DOUBLE_ROUND_ROBIN'
                  : 'ROUND_ROBIN',
              participants: this.participants(plan),
              matches: rows,
              rules,
              publicationId: plan.id,
              asOf: now,
            });
      if (!completion.ready) resultSourceInvalid();
    }
    return { ...a, now, rules, plan, rows, standings, bracket, groupCompetition };
  }
  private team(pub: Row, entry: string, name: string) {
    const key = pub.team_keys?.[entry];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(key)) resultSourceInvalid();
    return { teamKey: key, teamName: name };
  }
  private publicMatch(m: ResultRow, pub: Row): PublicScheduleMatchData {
    const admin = administrativeResult(m);
    return {
      ...(admin
        ? {
            adjudication: {
              kind: admin.kind,
              winner: admin.winnerEntryId
                ? this.team(
                    pub,
                    admin.winnerEntryId,
                    admin.winnerEntryId === m.home_entry_id ? m.home_team_name : m.away_team_name,
                  )
                : null,
            },
          }
        : {}),
      publicMatchId: m.public_match_id,
      roundNo: m.round_no,
      positionNo: m.position_no,
      home: this.team(pub, m.home_entry_id, m.home_team_name),
      away: this.team(pub, m.away_entry_id, m.away_team_name),
      courtName: m.court_name,
      startsAt: iso(m.starts_at),
      endsAt: iso(m.ends_at),
      status: m.status,
      version: m.version,
      score: !admin && m.state ? { home: m.state.home_score, away: m.state.away_score } : null,
      resultStatus:
        m.status === 'FINAL'
          ? 'CONFIRMED'
          : m.state?.requires_reconfirmation
            ? 'REQUIRES_RECONFIRMATION'
            : 'UNCONFIRMED',
    };
  }
  async getPublicEvent(id: string): Promise<PublicEventData> {
    return this.transaction(async (c) => {
      const b = await this.publicBundle(c, id);
      return {
        publicEventId: id,
        name: b.event.name,
        startDate: b.event.start_date,
        endDate: b.event.end_date,
        timezone: b.event.timezone,
        venueName: b.event.venue_name,
        status: b.event.status,
        // Keep the original strict ROUND_ROBIN public DTO backward compatible.
        ...(b.event.format !== 'ROUND_ROBIN' ? { format: b.event.format } : {}),
        rules: b.rules ? this.publicRules(b.rules) : null,
        ...resolutionCounts(b.groupCompetition ?? b.bracket ?? b.standings),
        confirmedMatchCount: (b.groupCompetition ?? b.bracket ?? b.standings)!.confirmedMatchCount,
        totalMatchCount: (b.groupCompetition ?? b.bracket ?? b.standings)!.totalMatchCount,
        isComplete: (b.groupCompetition ?? b.bracket ?? b.standings)!.isComplete,
        serverTime: b.now,
      };
    });
  }
  async getPublicStandings(id: string): Promise<PublicStandingsData> {
    return this.transaction(async (c) => {
      const b = await this.publicBundle(c, id);
      if (!b.rules || !b.standings)
        throw new ApiError(422, 'UNSUPPORTED_STANDINGS_FORMAT', '单淘汰赛请读取签位与最终名次');
      return {
        publicEventId: id,
        rules: this.publicRules(b.rules),
        sourceHash: b.standings.sourceHash,
        asOf: b.now,
        ...resolutionCounts(b.standings),
        confirmedMatchCount: b.standings.confirmedMatchCount,
        totalMatchCount: b.standings.totalMatchCount,
        isComplete: b.standings.isComplete,
        hasSharedRanks: b.standings.hasSharedRanks,
        rows: b.standings.rows.map((r) => ({
          teamKey: this.team(b.pub, r.entryId, r.teamName).teamKey,
          teamName: r.teamName,
          rank: r.rank,
          tied: r.tied,
          played: r.played,
          wins: r.wins,
          draws: r.draws,
          losses: r.losses,
          pointsFor: r.pointsFor,
          pointsAgainst: r.pointsAgainst,
          scoreDifference: r.scoreDifference,
          leaguePoints: r.leaguePoints,
        })),
      };
    });
  }
  async getPublicKnockout(id: string): Promise<PublicKnockoutData> {
    return this.transaction(async (c) => {
      const b = await this.publicBundle(c, id);
      if (!b.bracket)
        throw new ApiError(422, 'UNSUPPORTED_KNOCKOUT_FORMAT', '当前赛事不是单淘汰赛');
      return this.publicBracket(b, id);
    });
  }
  private publicBracket(
    b: Awaited<ReturnType<StandingsService['publicBundle']>>,
    id: string,
  ): PublicKnockoutData {
    if (!b.bracket) resultSourceInvalid();
    const participants = new Map(this.participants(b.plan).map((p) => [p.entryId, p]));
    const team = (entry: string | null) => {
      if (entry === null) return null;
      const p = participants.get(entry);
      if (!p) resultSourceInvalid();
      return this.team(b.pub, entry, p.teamName);
    };
    const matches = new Map(b.rows.map((m) => [m.id, m]));
    return {
      publicEventId: id,
      algorithmVersion: b.bracket.algorithmVersion,
      sourceHash: b.bracket.sourceHash,
      asOf: b.bracket.asOf,
      participantCount: b.bracket.participantCount,
      totalMatchCount: b.bracket.totalMatchCount,
      publishedMatchCount: b.bracket.publishedMatchCount,
      ...resolutionCounts(b.bracket),
      confirmedMatchCount: b.bracket.confirmedMatchCount,
      isComplete: b.bracket.isComplete,
      rounds: b.bracket.rounds.map((round) => ({
        roundNo: round.roundNo,
        label: round.label,
        published: round.published,
        slots: round.slots.map((slot) => {
          const match = slot.matchId === null ? null : matches.get(slot.matchId);
          if (slot.matchId !== null && !match?.public_match_id) resultSourceInvalid();
          return {
            ...(slot.adjudication ? { adjudication: slot.adjudication } : {}),
            ...(slot.kind ? { kind: slot.kind, sourceOutcome: slot.sourceOutcome } : {}),
            positionNo: slot.positionNo,
            home: team(slot.homeEntryId),
            away: team(slot.awayEntryId),
            bye: team(slot.byeEntryId),
            publicMatchId: match?.public_match_id ?? null,
            status: slot.status,
            winner: team(slot.winnerEntryId),
          };
        }),
      })),
      placements: b.bracket.placements.map((p) => ({
        team: this.team(b.pub, p.entryId, p.teamName),
        rank: p.rank,
        tied: p.tied,
      })),
    };
  }
  async getPublicGroups(id: string): Promise<PublicGroupKnockoutData> {
    return this.transaction(async (c) => {
      const b = await this.publicBundle(c, id),
        competition = b.groupCompetition;
      if (!competition || !b.rules)
        throw new ApiError(422, 'UNSUPPORTED_GROUP_FORMAT', '当前赛事不是分组接淘汰');
      return {
        publicEventId: id,
        algorithmVersion: 'GK_BALANCED_V1',
        sourceHash: competition.sourceHash,
        asOf: b.now,
        groupCount: competition.groupCount,
        totalMatchCount: competition.totalMatchCount,
        publishedMatchCount: competition.publishedMatchCount,
        ...resolutionCounts(competition),
        confirmedMatchCount: competition.confirmedMatchCount,
        isComplete: competition.isComplete,
        rules: this.publicRules(b.rules),
        qualificationStatus: competition.qualification.status,
        groups: competition.groups.map((g) => ({
          groupKey: g.groupKey,
          label: g.label,
          ...resolutionCounts(g.standings),
          confirmedMatchCount: g.standings.confirmedMatchCount,
          totalMatchCount: g.standings.totalMatchCount,
          isComplete: g.standings.isComplete,
          rows: g.standings.rows.map((r) => ({
            teamKey: this.team(b.pub, r.entryId, r.teamName).teamKey,
            teamName: r.teamName,
            rank: r.rank,
            tied: r.tied,
            played: r.played,
            wins: r.wins,
            draws: r.draws,
            losses: r.losses,
            pointsFor: r.pointsFor,
            pointsAgainst: r.pointsAgainst,
            scoreDifference: r.scoreDifference,
            leaguePoints: r.leaguePoints,
          })),
          qualified: (g.qualifiedEntryIds ?? []).map((entry) => {
            const p = g.participants.find((p) => p.entryId === entry)!;
            return this.team(b.pub, entry, p.teamName);
          }),
          tieBreakRequired: !!g.unresolvedTieEntryIds.length,
          tieDrawApplied: !!g.draw,
        })),
        bracket: b.bracket ? this.publicBracket(b, id) : null,
        placements: competition.placements.map((p) => ({
          team: this.team(b.pub, p.entryId, p.teamName),
          groupKey: p.groupKey,
          groupRank: p.groupRank,
          stage: p.stage,
          rank: p.rank,
          tied: p.tied,
        })),
      };
    });
  }
  protected async groupCompetition(
    c: PoolClient,
    event: StandingsAccess['event'],
    plan: Row,
    matches: ResultRow[],
    now: string,
  ): Promise<GroupKnockoutProjection> {
    const evidence = await groupEvidence(c, event.org_id, event.id);
    if (!evidence.rules) resultSourceInvalid();
    return calculateGroupKnockout({
      publicationId: plan.id,
      source: plan.source,
      seed: plan.seed,
      policy: plan.policy,
      config: plan.group_config,
      rules: evidence.rules!,
      matches,
      asOf: now,
      draws: evidence.draws,
      qualification: evidence.qualification,
      roundPublications: plan.round_publications,
    });
  }
  private cursor(
    raw: string | undefined,
    scope: string,
  ): { scope: string; time: string; publicMatchId: string } | null {
    if (!raw) return null;
    try {
      const v = objectInput(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')), [
        'scope',
        'time',
        'publicMatchId',
      ]);
      if (
        typeof v.scope !== 'string' ||
        !v.scope.startsWith(`${scope}:`) ||
        !/^(0|[1-9][0-9]*)$/.test(v.scope.slice(scope.length + 1)) ||
        typeof v.time !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v.time) ||
        typeof v.publicMatchId !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(v.publicMatchId)
      )
        invalid('无效公开分页游标');
      calendarDate(v.time.slice(0, 10), 'cursor');
      const t = v.time.slice(11, 19).split(':').map(Number);
      if (t[0]! > 23 || t[1]! > 59 || t[2]! > 59) invalid('无效公开分页游标');
      return { scope: v.scope, time: v.time, publicMatchId: v.publicMatchId };
    } catch {
      return invalid('无效或不匹配的公开分页游标');
    }
  }
  async getPublicSchedule(id: string, raw: unknown) {
    const input = objectInput(raw, ['limit', 'cursor', 'status']);
    const q = pageInput({
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    if (
      input.status !== undefined &&
      !(MATCH_STATUSES as readonly unknown[]).includes(input.status)
    )
      invalid('无效公开比赛状态');
    const status = input.status as string | undefined;
    const baseScope = `public-schedule:${publicId(id)}:${status ?? ''}`;
    const cursor = this.cursor(q.cursor, baseScope);
    return this.transaction(async (c) => {
      const b = await this.publicBundle(c, id);
      // The event SHARE lock in publicBundle keeps this revision and all match times stable.
      // Only a count is exposed in the cursor; no internal event or match identifiers leak.
      const revision = (
        await c.query<{ revision: string }>(
          'SELECT count(*)::text AS revision FROM match_reschedules WHERE org_id=$1 AND event_id=$2',
          [b.event.org_id, b.event.id],
        )
      ).rows[0]!.revision;
      const scope = `${baseScope}:${revision}`;
      if (cursor && cursor.scope !== scope) invalid('赛程已改期，请从首页重新读取');
      const rows = b.rows
        .filter(
          (r) =>
            (!status || r.status === status) &&
            (!cursor ||
              r.cursor_time > cursor.time ||
              (r.cursor_time === cursor.time && r.public_match_id > cursor.publicMatchId)),
        )
        .sort((a, z) =>
          a.cursor_time < z.cursor_time
            ? -1
            : a.cursor_time > z.cursor_time
              ? 1
              : a.public_match_id < z.public_match_id
                ? -1
                : a.public_match_id > z.public_match_id
                  ? 1
                  : 0,
        );
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return {
        data: page.map((r) => this.publicMatch(r, b.pub)),
        nextCursor:
          rows.length > q.limit && last
            ? Buffer.from(
                JSON.stringify({
                  scope,
                  time: last.cursor_time,
                  publicMatchId: last.public_match_id,
                }),
              ).toString('base64url')
            : null,
      };
    });
  }
  private totals(s: Row, side: 'home' | 'away'): ScoringTotals {
    return {
      score: s[`${side}_score`],
      fouls: s[`${side}_fouls`],
      timeouts: s[`${side}_timeouts`],
    };
  }
  async getPublicMatch(id: string, match: string): Promise<PublicMatchSnapshotData> {
    publicId(match);
    return this.transaction(async (c) => {
      const b = await this.publicBundle(c, id, match);
      const m = b.rows.find((r) => r.public_match_id === match);
      if (!m) throw notFound();
      const admin = administrativeResult(m);
      const s = admin ? null : m.state,
        r = m.scoring_rules;
      const base = this.publicMatch(m, b.pub);
      return {
        ...(base.adjudication ? { adjudication: base.adjudication } : {}),
        publicMatchId: base.publicMatchId,
        roundNo: base.roundNo,
        positionNo: base.positionNo,
        home: base.home,
        away: base.away,
        courtName: base.courtName,
        startsAt: base.startsAt,
        endsAt: base.endsAt,
        status: base.status,
        version: base.version,
        score: base.score,
        resultStatus: base.resultStatus,
        publicEventId: id,
        eventName: b.event.name,
        totals: s ? { home: this.totals(s, 'home'), away: this.totals(s, 'away') } : null,
        periods: s
          ? s.period_stats.map((p: Row) => ({
              period: p.period,
              home: { score: p.home.score, fouls: p.home.fouls, timeouts: p.home.timeouts },
              away: { score: p.away.score, fouls: p.away.fouls, timeouts: p.away.timeouts },
            }))
          : null,
        rules:
          s && r
            ? {
                version: r.version,
                regulationPeriods: r.regulation_periods,
                periodDurationSeconds: r.period_duration_seconds,
                allowedScoreValues: [...r.allowed_score_values],
                tiePolicy: r.tie_policy,
                overtimeDurationSeconds: r.overtime_duration_seconds,
              }
            : null,
        clock: s
          ? {
              period: s.period,
              remainingMs: s.remaining_ms,
              running: s.clock_running,
              anchorServerTime: iso(s.anchor_server_time),
              clockVersion: s.clock_version,
            }
          : null,
        collected: { teamScore: !!s, teamFouls: !!s, teamTimeouts: !!s, playerStatistics: false },
        serverTime: b.now,
      };
    });
  }
}
