import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  CourtData,
  EventData,
  EventSchedulingData,
  MatchReschedulePlan,
  MatchRescheduleRecord,
  MatchReschedulingData,
  RegistrationFreezeData,
  ScheduleFixtureData,
  SchedulePublicationData,
  ScheduleRevisionData,
  ScheduleRevisionSummary,
  ScheduledMatchData,
  ScheduleValidationData,
  StaffRole,
  GroupKnockoutConfig,
} from '@small-city-basketball/contracts';
import { generateGroupPairings, parseGroupConfig } from './group-knockout-domain.js';
import { activateEventCommerce } from './commerce/activation.js';
import { generateKnockoutPairings } from './knockout-domain.js';
import { ApplicationService, EVENT_SELECT, isAdministrator } from './service.js';
import type { EventRow, OrgActor } from './service.js';
import type { ScheduleOptimizationPreview } from '../../../packages/contracts/scheduling-completion.js';
import { optimizeSchedule } from './schedule-optimization-domain.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { calendarDate, invalid, objectInput, resourceId, text } from './validation.js';
import { expectedVersion, pageInput } from './registration-validation.js';
import {
  canonicalFreeze,
  generatePairings,
  parseAllocationInput,
  parseSchedulePolicy,
  publicationHash,
  validateSchedule,
} from './scheduling-domain.js';
import {
  canRescheduleMatch,
  currentFixture,
  parseRescheduleCommand,
  reschedulePlan,
  targetConflicts,
} from './rescheduling-domain.js';

type MatchRow = Record<string, any>;

export interface EventAccess {
  row: EventRow & { current_schedule_revision_id: string | null };
  canManage: boolean;
}
export interface RevisionRow {
  id: string;
  org_id: string;
  event_id: string;
  freeze_id: string;
  algorithm_version: 'RR_CIRCLE_V1' | 'SE_SEEDED_V1' | 'GK_BALANCED_V1';
  group_config: GroupKnockoutConfig | null;
  seed: string;
  input_hash: string;
  pairing_hash: string;
  policy: ScheduleRevisionData['policy'];
  source: RegistrationFreezeData;
  rounds: ScheduleRevisionData['rounds'];
  ordered_entry_ids: string[];
  status: ScheduleRevisionSummary['status'];
  version: number;
  redraw_reason: string | null;
  previous_revision_id: string | null;
  created_at: Date;
}
interface CourtRow {
  id: string;
  org_id: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  version: number;
  created_at: Date;
  updated_at: Date;
  cursor_created_at: string;
}
const checkVersion = (actual: number, expected: number) => {
  if (actual !== expected)
    throw new ApiError(409, 'VERSION_CONFLICT', '资料已更新，请重新读取后再操作', {
      currentVersion: actual,
    });
};
function business(code: string, message: string, status = 422): never {
  throw new ApiError(status, code, message);
}
const cursorTime = (alias: string) =>
  `to_char(${alias}.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`;
export class SchedulingService extends ApplicationService {
  protected async context(client: PoolClient, cookie: string | undefined, org: string) {
    return this.lockOrganization(client, await this.lockActor(client, cookie), org);
  }
  protected async mutex(client: PoolClient, org: string) {
    await client.query(
      'INSERT INTO org_schedule_mutex(org_id) VALUES($1) ON CONFLICT(org_id) DO NOTHING',
      [org],
    );
    await client.query('SELECT org_id FROM org_schedule_mutex WHERE org_id=$1 FOR UPDATE', [org]);
  }
  protected async event(
    client: PoolClient,
    ctx: OrgActor,
    id: string,
    writing: boolean,
  ): Promise<EventAccess> {
    const rows = await client.query<EventAccess['row']>(
      `SELECT ${EVENT_SELECT} FROM events e WHERE org_id=$1 AND id=$2 FOR ${writing ? 'UPDATE' : 'SHARE'} OF e`,
      [ctx.orgId, resourceId(id)],
    );
    const row = rows.rows[0];
    if (!row) throw notFound();
    const staff = await client.query<{ role: StaffRole }>(
      "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
      [ctx.orgId, row.id, ctx.user.id],
    );
    if (!isAdministrator(ctx.role) && !staff.rows[0]) throw notFound();
    return { row, canManage: isAdministrator(ctx.role) || staff.rows[0]?.role === 'EVENT_MANAGER' };
  }
  protected dtoEvent(access: EventAccess): EventData {
    const r = access.row;
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
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      permissions: { canEditDraft: access.canManage && r.status === 'DRAFT' },
    };
  }
  private courtDto(row: CourtRow, ctx: OrgActor): CourtData {
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      status: row.status,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      capabilities: { canManage: isAdministrator(ctx.role) },
    };
  }
  private cursor(
    query: { cursor?: string },
    scope: string,
  ): { id: string | null; createdAt: string | null } {
    if (!query.cursor) return { id: null, createdAt: null };
    try {
      const value = objectInput(
        JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        ['scope', 'id', 'createdAt'],
      );
      if (
        value.scope !== scope ||
        typeof value.id !== 'string' ||
        typeof value.createdAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.createdAt) ||
        !Number.isFinite(Date.parse(value.createdAt))
      )
        invalid('无效分页游标');
      calendarDate(value.createdAt.slice(0, 10), 'cursor');
      const time = value.createdAt.slice(11, 19).split(':').map(Number);
      if (time[0]! > 23 || time[1]! > 59 || time[2]! > 59) invalid('无效分页游标');
      return { id: resourceId(value.id), createdAt: value.createdAt };
    } catch {
      return invalid('无效或不匹配的分页游标');
    }
  }
  private next(rows: { id: string; cursor_created_at: string }[], limit: number, scope: string) {
    const last = rows[limit - 1];
    return rows.length > limit && last
      ? Buffer.from(
          JSON.stringify({ scope, id: last.id, createdAt: last.cursor_created_at }),
        ).toString('base64url')
      : null;
  }
  async listCourts(cookie: string | undefined, org: string, raw: unknown) {
    const query = pageInput(raw);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const scope = `courts:${ctx.orgId}:${ctx.user.id}`;
      const cur = this.cursor(query, scope);
      const rows = await client.query<CourtRow>(
        `SELECT c.*,${cursorTime('c')} FROM courts c WHERE org_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4`,
        [ctx.orgId, cur.createdAt, cur.id, query.limit + 1],
      );
      return {
        data: rows.rows.slice(0, query.limit).map((r) => this.courtDto(r, ctx)),
        nextCursor: this.next(rows.rows, query.limit, scope),
        capabilities: { canCreateCourt: isAdministrator(ctx.role) },
      };
    });
  }
  async createCourt(cookie: string | undefined, org: string, body: unknown): Promise<CourtData> {
    const input = objectInput(body, ['name']);
    const name = text(input.name, 'name', 1, 80);
    try {
      return await this.transaction(async (client) => {
        const ctx = await this.context(client, cookie, org);
        if (!isAdministrator(ctx.role)) throw forbidden();
        await this.mutex(client, ctx.orgId);
        await this.ensureFreshSession(client, ctx);
        const row = await client.query<CourtRow>(
          'INSERT INTO courts(id,org_id,name) VALUES($1,$2,$3) RETURNING *',
          [randomUUID(), ctx.orgId, name],
        );
        await this.audit(client, ctx.user.id, ctx.orgId, 'COURT_CREATED', 'court', row.rows[0]!.id);
        return this.courtDto(row.rows[0]!, ctx);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        business('COURT_NAME_CONFLICT', '本机构已存在同名场地', 409);
      throw error;
    }
  }
  async updateCourt(
    cookie: string | undefined,
    org: string,
    id: string,
    body: unknown,
  ): Promise<CourtData> {
    const input = objectInput(body, ['expectedVersion', 'name', 'status']);
    const version = expectedVersion(input.expectedVersion);
    const name = text(input.name, 'name', 1, 80);
    if (input.status !== 'ACTIVE' && input.status !== 'DISABLED') invalid('无效场地状态');
    try {
      return await this.transaction(async (client) => {
        const ctx = await this.context(client, cookie, org);
        if (!isAdministrator(ctx.role)) throw forbidden();
        await this.mutex(client, ctx.orgId);
        const rows = await client.query<CourtRow>(
          'SELECT * FROM courts WHERE org_id=$1 AND id=$2 FOR UPDATE',
          [ctx.orgId, resourceId(id)],
        );
        const row = rows.rows[0];
        if (!row) throw notFound();
        checkVersion(row.version, version);
        if (
          input.status === 'DISABLED' &&
          (
            await client.query(
              'SELECT 1 FROM court_reservations WHERE org_id=$1 AND court_id=$2 AND ends_at>clock_timestamp() LIMIT 1',
              [ctx.orgId, row.id],
            )
          ).rowCount
        )
          business('COURT_HAS_RESERVATIONS', '该场地仍有未来或进行中的正式预约', 409);
        await this.ensureFreshSession(client, ctx);
        const changed = await client.query<CourtRow>(
          'UPDATE courts SET name=$3,status=$4,version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2 RETURNING *',
          [ctx.orgId, row.id, name, input.status],
        );
        await this.audit(client, ctx.user.id, ctx.orgId, 'COURT_UPDATED', 'court', row.id, {
          status: input.status,
        });
        return this.courtDto(changed.rows[0]!, ctx);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        business('COURT_NAME_CONFLICT', '本机构已存在同名场地', 409);
      throw error;
    }
  }
  protected async freeze(
    client: PoolClient,
    org: string,
    event: string,
  ): Promise<RegistrationFreezeData | null> {
    const rows = await client.query(
      'SELECT * FROM registration_freezes WHERE org_id=$1 AND event_id=$2',
      [org, event],
    );
    const r = rows.rows[0];
    return r
      ? {
          id: r.id,
          eventId: r.event_id,
          rulesetId: r.ruleset_id,
          rulesetVersion: r.ruleset_version,
          eventVersion: r.event_version,
          ...r.snapshot,
          createdAt: r.created_at.toISOString(),
        }
      : null;
  }
  protected summary(r: RevisionRow): ScheduleRevisionSummary {
    return {
      id: r.id,
      eventId: r.event_id,
      freezeId: r.freeze_id,
      algorithmVersion: r.algorithm_version,
      groupConfig: r.group_config ?? null,
      seed: r.seed,
      inputHash: r.input_hash,
      pairingHash: r.pairing_hash,
      status: r.status,
      version: r.version,
      redrawReason: r.redraw_reason,
      previousRevisionId: r.previous_revision_id,
      createdAt: r.created_at.toISOString(),
    };
  }
  protected async publication(
    client: PoolClient,
    org: string,
    event: string,
  ): Promise<SchedulePublicationData | null> {
    const result = await client.query(
      'SELECT p.*,(SELECT count(*)::int FROM published_matches m WHERE m.org_id=p.org_id AND m.publication_id=p.id) AS match_count FROM schedule_publications p WHERE org_id=$1 AND event_id=$2',
      [org, event],
    );
    const r = result.rows[0];
    return r
      ? {
          id: r.id,
          eventId: r.event_id,
          revisionId: r.revision_id,
          publicationHash: r.publication_hash,
          publishedAt: r.created_at.toISOString(),
          matchCount: r.match_count,
        }
      : null;
  }
  private support(event: EventAccess, freeze: RegistrationFreezeData | null) {
    if (!['ROUND_ROBIN', 'SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'].includes(event.row.format))
      return { supported: false, reason: '当前支持单循环与单淘汰赛' };
    if (event.row.format === 'GROUP_KNOCKOUT' && freeze && freeze.entries.length < 4)
      return { supported: false, reason: '分组接淘汰至少需要4支冻结球队' };
    if (!freeze) return { supported: false, reason: '请先冻结报名名单' };
    if (freeze.entries.length < 2 || freeze.entries.length > 32)
      return { supported: false, reason: '当前支持2–32支冻结球队' };
    return { supported: true, reason: null };
  }
  private async schedulingDto(
    client: PoolClient,
    ctx: OrgActor,
    event: EventAccess,
  ): Promise<EventSchedulingData> {
    const freeze = await this.freeze(client, ctx.orgId, event.row.id);
    const revision = event.row.current_schedule_revision_id
      ? (
          await client.query<RevisionRow>(
            'SELECT * FROM schedule_revisions WHERE org_id=$1 AND event_id=$2 AND id=$3',
            [ctx.orgId, event.row.id, event.row.current_schedule_revision_id],
          )
        ).rows[0]
      : null;
    const publication = await this.publication(client, ctx.orgId, event.row.id);
    const support = this.support(event, freeze);
    const can =
      event.canManage &&
      support.supported &&
      !publication &&
      event.row.status === 'REGISTRATION_CLOSED';
    return {
      event: this.dtoEvent(event),
      freeze: freeze
        ? {
            id: freeze.id,
            rulesetId: freeze.rulesetId,
            rulesetVersion: freeze.rulesetVersion,
            eventVersion: freeze.eventVersion,
            entryCount: freeze.entries.length,
          }
        : null,
      currentRevision: revision ? this.summary(revision) : null,
      publication,
      support,
      capabilities: {
        canGenerate: can && !revision,
        canRedraw: can && revision?.status === 'DRAFT',
        canReadMatches: true,
      },
    };
  }
  async getScheduling(
    cookie: string | undefined,
    org: string,
    id: string,
  ): Promise<EventSchedulingData> {
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      return this.schedulingDto(client, ctx, await this.event(client, ctx, id, false));
    });
  }
  private assertOpen(event: EventAccess, publication: SchedulePublicationData | null) {
    if (publication)
      business('SCHEDULE_ALREADY_PUBLISHED', '赛事已正式发布，不能再次编辑或发布', 409);
    if (event.row.status !== 'REGISTRATION_CLOSED')
      business('INVALID_SCHEDULING_STATE', '仅已关闭且冻结报名的赛事可以排赛');
  }
  protected async courts(client: PoolClient, org: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = await client.query<{ id: string; name: string; status: 'ACTIVE' | 'DISABLED' }>(
      'SELECT id,name,status FROM courts WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE',
      [org, [...new Set(ids)].sort()],
    );
    if (rows.rows.length !== new Set(ids).size) throw notFound();
    return rows.rows;
  }
  protected async fixtures(client: PoolClient, r: RevisionRow): Promise<ScheduleFixtureData[]> {
    return (
      await client.query<{
        fixture_key: string;
        round_no: number;
        position_no: number;
        home_entry_id: string;
        away_entry_id: string;
        court_id: string | null;
        starts_at: Date | null;
        ends_at: Date | null;
      }>(
        'SELECT * FROM schedule_fixtures WHERE org_id=$1 AND revision_id=$2 ORDER BY round_no,position_no',
        [r.org_id, r.id],
      )
    ).rows.map((f) => ({
      fixtureKey: f.fixture_key,
      roundNo: f.round_no,
      positionNo: f.position_no,
      homeEntryId: f.home_entry_id,
      awayEntryId: f.away_entry_id,
      courtId: f.court_id,
      startsAt: f.starts_at?.toISOString() ?? null,
      endsAt: f.ends_at?.toISOString() ?? null,
    }));
  }
  private async revisionDto(
    client: PoolClient,
    event: EventAccess,
    r: RevisionRow,
  ): Promise<ScheduleRevisionData> {
    const isCurrent = event.row.current_schedule_revision_id === r.id;
    const can =
      event.canManage &&
      isCurrent &&
      r.status === 'DRAFT' &&
      event.row.status === 'REGISTRATION_CLOSED';
    return {
      ...this.summary(r),
      eventVersion: event.row.version,
      isCurrent,
      policy: r.policy,
      source: r.source,
      participants: r.source.entries.map(({ entryId, teamId, teamName, rosterRevisionId }) => ({
        entryId,
        teamId,
        teamName,
        rosterRevisionId,
      })),
      rounds: r.rounds,
      fixtures: await this.fixtures(client, r),
      capabilities: { canEditAllocations: can, canValidate: can, canPublish: can },
    };
  }
  private async loadRevision(
    client: PoolClient,
    ctx: OrgActor,
    id: string,
    writing: boolean,
  ): Promise<{ event: EventAccess; revision: RevisionRow }> {
    const meta = await client.query<{ event_id: string }>(
      'SELECT event_id FROM schedule_revisions WHERE org_id=$1 AND id=$2',
      [ctx.orgId, resourceId(id)],
    );
    if (!meta.rows[0]) throw notFound();
    const event = await this.event(client, ctx, meta.rows[0].event_id, writing);
    const row = await client.query<RevisionRow>(
      `SELECT * FROM schedule_revisions WHERE org_id=$1 AND event_id=$2 AND id=$3 FOR ${writing ? 'UPDATE' : 'SHARE'}`,
      [ctx.orgId, event.row.id, id],
    );
    if (!row.rows[0]) throw notFound();
    return { event, revision: row.rows[0] };
  }
  async getRevision(
    cookie: string | undefined,
    org: string,
    id: string,
  ): Promise<ScheduleRevisionData> {
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const { event, revision } = await this.loadRevision(client, ctx, id, false);
      return this.revisionDto(client, event, revision);
    });
  }
  /** Server-only authoritative inputs; used by validated unpublished knockout rounds too. */
  protected async optimizeFixturePlan(
    client: PoolClient,
    ctx: OrgActor,
    event: EventAccess,
    revision: RevisionRow,
    fixtures: ScheduleFixtureData[],
    options: { preserveAssigned?: boolean } = {},
  ): Promise<ScheduleOptimizationPreview> {
    const policy = parseSchedulePolicy(revision.policy);
    const courts = await this.courts(
      client,
      ctx.orgId,
      policy.courtWindows.map((w) => w.courtId),
    );
    const starts = policy.courtWindows.map((w) => w.startsAt).sort();
    const ends = policy.courtWindows.map((w) => w.endsAt).sort();
    const padding = Math.max(
      policy.minRestMinutes * 60_000,
      (policy.minLocalDayGap + 1) * 86_400_000,
    );
    const reservations = await client.query<{
      kind: 'COURT' | 'TEAM';
      resource_id: string;
      starts_at: Date;
      ends_at: Date;
    }>(
      `SELECT 'COURT' AS kind,court_id AS resource_id,starts_at,ends_at FROM court_reservations
       WHERE org_id=$1 AND starts_at<$3::timestamptz+$4::double precision*interval '1 millisecond' AND ends_at>$2::timestamptz-$4::double precision*interval '1 millisecond'
       UNION ALL SELECT 'TEAM' AS kind,team_id AS resource_id,starts_at,ends_at FROM team_reservations
       WHERE org_id=$1 AND starts_at<$3::timestamptz+$4::double precision*interval '1 millisecond' AND ends_at>$2::timestamptz-$4::double precision*interval '1 millisecond'
       ORDER BY kind,resource_id,starts_at,ends_at LIMIT 10001`,
      [ctx.orgId, starts[0], ends.at(-1), padding],
    );
    if (reservations.rows.length > 10000)
      business('SCHEDULE_OPTIMIZATION_LIMIT', '当前资源占用超出有界优化范围，请缩小可用时段');
    const priorEnd =
      revision.status === 'PUBLISHED'
        ? (
            await client.query<{ latest: Date | null }>(
              'SELECT max(ends_at) AS latest FROM published_matches WHERE org_id=$1 AND event_id=$2',
              [ctx.orgId, event.row.id],
            )
          ).rows[0]?.latest?.toISOString()
        : undefined;
    const result = optimizeSchedule(
      {
        event: {
          id: event.row.id,
          startDate: event.row.start_date,
          endDate: event.row.end_date,
          timezone: event.row.timezone,
        },
        freeze: revision.source,
        policy,
        fixtures,
        courts,
        reservations: reservations.rows.map((r) => ({
          kind: r.kind,
          resourceId: r.resource_id,
          startsAt: r.starts_at.toISOString(),
          endsAt: r.ends_at.toISOString(),
        })),
      },
      { ...options, ...(priorEnd ? { earliestStart: priorEnd } : {}) },
    );
    await this.ensureFreshSession(client, ctx);
    return { ...result, eventVersion: event.row.version, revisionVersion: revision.version };
  }
  async previewOptimization(
    cookie: string | undefined,
    org: string,
    id: string,
    raw: unknown,
  ): Promise<ScheduleOptimizationPreview> {
    const input = objectInput(raw, [
      'expectedEventVersion',
      'expectedRevisionVersion',
      'preserveAssigned',
    ]);
    const eventVersion = expectedVersion(input.expectedEventVersion),
      revisionVersion = expectedVersion(input.expectedRevisionVersion);
    if (input.preserveAssigned !== undefined && typeof input.preserveAssigned !== 'boolean')
      invalid('请明确是否保留已有安排');
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const { event, revision } = await this.loadRevision(client, ctx, id, false);
      if (!event.canManage) throw forbidden();
      this.assertOpen(event, await this.publication(client, ctx.orgId, event.row.id));
      if (revision.status !== 'DRAFT' || event.row.current_schedule_revision_id !== revision.id)
        business('SCHEDULE_REVISION_NOT_CURRENT', '只能优化当前草稿', 409);
      checkVersion(event.row.version, eventVersion);
      checkVersion(revision.version, revisionVersion);
      await this.validation(client, ctx, event, revision); // strict source replay before searching
      return this.optimizeFixturePlan(
        client,
        ctx,
        event,
        revision,
        await this.fixtures(client, revision),
        { preserveAssigned: input.preserveAssigned as boolean | undefined },
      );
    });
  }
  async createRevision(
    cookie: string | undefined,
    org: string,
    eventId: string,
    body: unknown,
  ): Promise<ScheduleRevisionData> {
    const input = objectInput(body, [
      'expectedEventVersion',
      'freezeId',
      'algorithmVersion',
      'policy',
      'redrawReason',
      'groupConfig',
    ]);
    const version = expectedVersion(input.expectedEventVersion);
    const freezeId = resourceId(typeof input.freezeId === 'string' ? input.freezeId : '');
    if (
      !['RR_CIRCLE_V1', 'SE_SEEDED_V1', 'GK_BALANCED_V1'].includes(input.algorithmVersion as string)
    )
      business('UNSUPPORTED_SCHEDULE_ALGORITHM', '不支持的排赛算法');
    const policy = parseSchedulePolicy(input.policy);
    const reason =
      input.redrawReason === undefined ? null : text(input.redrawReason, 'redrawReason', 1, 500);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const event = await this.event(client, ctx, eventId, true);
      if (!event.canManage) throw forbidden();
      this.assertOpen(event, await this.publication(client, ctx.orgId, event.row.id));
      checkVersion(event.row.version, version);
      if (
        (event.row.format !== 'ROUND_ROBIN' || input.algorithmVersion !== 'RR_CIRCLE_V1') &&
        (event.row.format !== 'SINGLE_ELIMINATION' || input.algorithmVersion !== 'SE_SEEDED_V1') &&
        (event.row.format !== 'GROUP_KNOCKOUT' || input.algorithmVersion !== 'GK_BALANCED_V1')
      )
        business('UNSUPPORTED_EVENT_FORMAT', '赛制与排赛算法不匹配');
      const freeze = await this.freeze(client, ctx.orgId, event.row.id);
      if (!freeze || freeze.id !== freezeId)
        business('REGISTRATION_FREEZE_REQUIRED', '请使用当前赛事已冻结的报名来源');
      if (freeze.entries.length < 2 || freeze.entries.length > 32)
        business('UNSUPPORTED_TEAM_COUNT', '当前仅支持2–32支冻结球队');
      const groupConfig =
        event.row.format === 'GROUP_KNOCKOUT' ? parseGroupConfig(freeze, input.groupConfig) : null;
      if (event.row.format !== 'GROUP_KNOCKOUT' && input.groupConfig !== undefined)
        invalid('此赛制无需分组配置');
      const previous = event.row.current_schedule_revision_id;
      if (previous && !reason) invalid('重抽必须填写原因', { redrawReason: '请输入1–500个字符' });
      if (!previous && reason) invalid('首次生成无需重抽原因');
      if (previous) {
        const old = (
          await client.query<RevisionRow>(
            'SELECT * FROM schedule_revisions WHERE org_id=$1 AND id=$2 FOR UPDATE',
            [ctx.orgId, previous],
          )
        ).rows[0];
        if (old?.status !== 'DRAFT')
          business('SCHEDULE_REVISION_NOT_CURRENT', '当前稿不能重抽', 409);
      }
      await this.courts(
        client,
        ctx.orgId,
        policy.courtWindows.map((w) => w.courtId),
      );
      const seed = randomBytes(32).toString('hex');
      const generated =
        event.row.format === 'GROUP_KNOCKOUT'
          ? generateGroupPairings(freeze, policy, seed, groupConfig)
          : event.row.format === 'SINGLE_ELIMINATION'
            ? generateKnockoutPairings(freeze, policy, seed)
            : generatePairings(freeze, policy, seed);
      await this.ensureFreshSession(client, ctx);
      if (previous)
        await client.query(
          "UPDATE schedule_revisions SET status='SUPERSEDED',version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2",
          [ctx.orgId, previous],
        );
      const id = randomUUID();
      const r = await client.query<RevisionRow>(
        `INSERT INTO schedule_revisions(id,org_id,event_id,freeze_id,algorithm_version,seed,input_hash,pairing_hash,policy,source,rounds,ordered_entry_ids,redraw_reason,previous_revision_id,created_by,group_config) VALUES($1,$2,$3,$4,$15,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$16::jsonb) RETURNING *`,
        [
          id,
          ctx.orgId,
          event.row.id,
          freeze.id,
          seed,
          generated.inputHash,
          generated.pairingHash,
          JSON.stringify(policy),
          JSON.stringify(freeze),
          JSON.stringify(generated.rounds),
          JSON.stringify(generated.orderedEntryIds),
          reason,
          previous,
          ctx.user.id,
          input.algorithmVersion,
          groupConfig ? JSON.stringify(groupConfig) : null,
        ],
      );
      const entries = new Map(freeze.entries.map((e) => [e.entryId, e]));
      for (const f of generated.fixtures)
        await client.query(
          'INSERT INTO schedule_fixtures(org_id,event_id,revision_id,fixture_key,round_no,position_no,home_entry_id,away_entry_id,home_team_id,away_team_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            ctx.orgId,
            event.row.id,
            id,
            f.fixtureKey,
            f.roundNo,
            f.positionNo,
            f.homeEntryId,
            f.awayEntryId,
            entries.get(f.homeEntryId)!.teamId,
            entries.get(f.awayEntryId)!.teamId,
          ],
        );
      await client.query(
        'UPDATE events SET current_schedule_revision_id=$3,version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
        [ctx.orgId, event.row.id, id],
      );
      await this.audit(
        client,
        ctx.user.id,
        ctx.orgId,
        previous ? 'SCHEDULE_REDRAWN' : 'SCHEDULE_CREATED',
        'event',
        event.row.id,
        { revisionId: id, previousRevisionId: previous, reason },
      );
      return this.revisionDto(
        client,
        await this.event(client, ctx, event.row.id, false),
        r.rows[0]!,
      );
    });
  }
  private async writable(
    client: PoolClient,
    ctx: OrgActor,
    id: string,
    body: Record<string, unknown>,
    writing: boolean,
  ) {
    const loaded = await this.loadRevision(client, ctx, id, writing);
    if (!loaded.event.canManage) throw forbidden();
    this.assertOpen(loaded.event, await this.publication(client, ctx.orgId, loaded.event.row.id));
    if (
      loaded.event.row.current_schedule_revision_id !== loaded.revision.id ||
      loaded.revision.status !== 'DRAFT'
    )
      business('SCHEDULE_REVISION_NOT_CURRENT', '请使用当前草稿', 409);
    checkVersion(loaded.event.row.version, expectedVersion(body.expectedEventVersion));
    checkVersion(loaded.revision.version, expectedVersion(body.expectedRevisionVersion));
    return loaded;
  }
  async updateAllocations(
    cookie: string | undefined,
    org: string,
    id: string,
    body: unknown,
  ): Promise<ScheduleRevisionData> {
    const input = objectInput(body, [
      'expectedEventVersion',
      'expectedRevisionVersion',
      'allocations',
    ]);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const { event, revision } = await this.writable(client, ctx, id, input, true);
      const fixtures = await this.fixtures(client, revision);
      const allocations = parseAllocationInput(
        input.allocations,
        fixtures.map((f) => f.fixtureKey),
        revision.policy.slotDurationMinutes,
      );
      await this.courts(
        client,
        ctx.orgId,
        allocations.flatMap((a) => (a.courtId ? [a.courtId] : [])),
      );
      await this.ensureFreshSession(client, ctx);
      for (const a of allocations)
        await client.query(
          'UPDATE schedule_fixtures SET court_id=$4,starts_at=$5::timestamptz,ends_at=$6::timestamptz WHERE org_id=$1 AND revision_id=$2 AND fixture_key=$3',
          [ctx.orgId, revision.id, a.fixtureKey, a.courtId, a.startsAt, a.endsAt],
        );
      const updated = await client.query<RevisionRow>(
        'UPDATE schedule_revisions SET version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2 RETURNING *',
        [ctx.orgId, revision.id],
      );
      await client.query(
        'UPDATE events SET version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
        [ctx.orgId, event.row.id],
      );
      await this.audit(
        client,
        ctx.user.id,
        ctx.orgId,
        'SCHEDULE_ALLOCATIONS_UPDATED',
        'event',
        event.row.id,
        { revisionId: revision.id },
      );
      return this.revisionDto(
        client,
        await this.event(client, ctx, event.row.id, false),
        updated.rows[0]!,
      );
    });
  }
  private async validation(
    client: PoolClient,
    ctx: OrgActor,
    event: EventAccess,
    revision: RevisionRow,
  ): Promise<ScheduleValidationData> {
    const freeze = await this.freeze(client, ctx.orgId, event.row.id);
    if (!freeze || freeze.id !== revision.freeze_id)
      business('REGISTRATION_FREEZE_REQUIRED', '排赛来源与冻结名单不一致');
    const replay =
      revision.algorithm_version === 'GK_BALANCED_V1'
        ? generateGroupPairings(freeze!, revision.policy, revision.seed, revision.group_config)
        : revision.algorithm_version === 'SE_SEEDED_V1'
          ? generateKnockoutPairings(freeze!, revision.policy, revision.seed)
          : generatePairings(freeze!, revision.policy, revision.seed);
    const fixtures = await this.fixtures(client, revision);
    const identity = (f: ScheduleFixtureData) => [
      f.fixtureKey,
      f.roundNo,
      f.positionNo,
      f.homeEntryId,
      f.awayEntryId,
    ];
    if (
      replay.inputHash !== revision.input_hash ||
      replay.pairingHash !== revision.pairing_hash ||
      JSON.stringify(replay.orderedEntryIds) !== JSON.stringify(revision.ordered_entry_ids) ||
      JSON.stringify(
        replay.rounds.map((round) => [
          round.roundNo,
          round.byeEntryId,
          'byeEntryIds' in round ? round.byeEntryIds : [],
        ]),
      ) !==
        JSON.stringify(
          revision.rounds.map((round) => [
            round.roundNo,
            round.byeEntryId,
            round.byeEntryIds ?? [],
          ]),
        ) ||
      JSON.stringify(canonicalFreeze(freeze!)) !==
        JSON.stringify(canonicalFreeze(revision.source)) ||
      JSON.stringify(replay.fixtures.map(identity)) !== JSON.stringify(fixtures.map(identity))
    )
      business('SCHEDULE_SOURCE_MISMATCH', '对阵来源校验失败，请联系管理员');
    const courts = await this.courts(client, ctx.orgId, [
      ...revision.policy.courtWindows.map((w) => w.courtId),
      ...fixtures.flatMap((f) => (f.courtId ? [f.courtId] : [])),
    ]);
    const times = fixtures.flatMap((f) => (f.startsAt && f.endsAt ? [[f.startsAt, f.endsAt]] : []));
    let reservations: {
      kind: 'COURT' | 'TEAM';
      resourceId: string;
      startsAt: string;
      endsAt: string;
    }[] = [];
    if (times.length) {
      const min = times.map((t) => t[0]!).sort()[0]!;
      const max = times
        .map((t) => t[1]!)
        .sort()
        .at(-1)!;
      const booked = await client.query<{
        kind: 'COURT' | 'TEAM';
        resource_id: string;
        starts_at: Date;
        ends_at: Date;
      }>(
        `SELECT 'COURT' AS kind,court_id AS resource_id,starts_at,ends_at FROM court_reservations WHERE org_id=$1 AND starts_at<$3::timestamptz AND ends_at>$2::timestamptz UNION ALL SELECT 'TEAM' AS kind,team_id AS resource_id,starts_at,ends_at FROM team_reservations WHERE org_id=$1 AND starts_at<$3::timestamptz+$4::double precision*interval '1 millisecond' AND ends_at>$2::timestamptz-$4::double precision*interval '1 millisecond'`,
        [
          ctx.orgId,
          min,
          max,
          Math.max(
            revision.policy.minRestMinutes * 60000,
            (revision.policy.minLocalDayGap + 1) * 86400000,
          ),
        ],
      );
      reservations = booked.rows.map((r) => ({
        kind: r.kind,
        resourceId: r.resource_id,
        startsAt: r.starts_at.toISOString(),
        endsAt: r.ends_at.toISOString(),
      }));
    }
    const conflicts = validateSchedule({
      event: {
        id: event.row.id,
        startDate: event.row.start_date,
        endDate: event.row.end_date,
        timezone: event.row.timezone,
      },
      freeze: freeze!,
      policy: revision.policy,
      fixtures,
      courts,
      reservations,
    });
    return {
      revisionId: revision.id,
      expectedEventVersion: event.row.version,
      expectedRevisionVersion: revision.version,
      valid: conflicts.length === 0,
      checkedAt: new Date().toISOString(),
      conflicts,
    };
  }
  async validateRevision(
    cookie: string | undefined,
    org: string,
    id: string,
    body: unknown,
  ): Promise<ScheduleValidationData> {
    const input = objectInput(body, ['expectedEventVersion', 'expectedRevisionVersion']);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const { event, revision } = await this.writable(client, ctx, id, input, false);
      return this.validation(client, ctx, event, revision);
    });
  }
  async publishRevision(
    cookie: string | undefined,
    org: string,
    id: string,
    body: unknown,
  ): Promise<EventSchedulingData> {
    const input = objectInput(body, ['expectedEventVersion', 'expectedRevisionVersion']);
    try {
      return await this.transaction(async (client) => {
        const ctx = await this.context(client, cookie, org);
        await this.mutex(client, ctx.orgId);
        const { event, revision } = await this.writable(client, ctx, id, input, true);
        const validation = await this.validation(client, ctx, event, revision);
        if (!validation.valid)
          throw new ApiError(409, 'SCHEDULE_CONFLICT', '赛程存在冲突，修正后再发布', {
            conflicts: validation.conflicts,
          });
        if (
          event.row.format === 'GROUP_KNOCKOUT' &&
          !(
            await client.query(
              'SELECT 1 FROM events WHERE org_id=$1 AND id=$2 AND locked_standings_ruleset_id IS NOT NULL',
              [ctx.orgId, event.row.id],
            )
          ).rowCount
        )
          business('STANDINGS_RULES_REQUIRED', '请先发布分组积分规则');
        const fixtures = await this.fixtures(client, revision);
        const participantCount = revision.source.entries.length;
        const expectedMatchCount =
          event.row.format === 'GROUP_KNOCKOUT'
            ? fixtures.length + revision.group_config!.groupCount * 2 - 1
            : event.row.format === 'SINGLE_ELIMINATION'
              ? participantCount - 1
              : (participantCount * (participantCount - 1)) / 2;
        await activateEventCommerce(client, {
          orgId: ctx.orgId,
          eventId: event.row.id,
          participantCount,
          expectedMatchCount,
          mode: this.options.commerceMode,
          actorId: ctx.user.id,
        });
        const courts = await this.courts(
          client,
          ctx.orgId,
          fixtures.map((f) => f.courtId!),
        );
        const names = new Map(courts.map((c) => [c.id, c.name]));
        const entries = new Map(revision.source.entries.map((e) => [e.entryId, e]));
        const hash = publicationHash(
          {
            algorithmVersion: revision.algorithm_version,
            seed: revision.seed,
            inputHash: revision.input_hash,
            pairingHash: revision.pairing_hash,
          },
          fixtures,
        );
        await this.ensureFreshSession(client, ctx);
        const publicationId = randomUUID();
        await client.query(
          'INSERT INTO schedule_publications(id,org_id,event_id,revision_id,publication_hash,created_by) VALUES($1,$2,$3,$4,$5,$6)',
          [publicationId, ctx.orgId, event.row.id, revision.id, hash, ctx.user.id],
        );
        for (const f of fixtures) {
          const home = entries.get(f.homeEntryId)!;
          const away = entries.get(f.awayEntryId)!;
          const matchId = randomUUID();
          await client.query(
            `INSERT INTO published_matches(id,org_id,event_id,publication_id,revision_id,fixture_key,round_no,position_no,home_entry_id,away_entry_id,home_team_id,away_team_id,home_team_name,away_team_name,home_roster_revision_id,away_roster_revision_id,court_id,court_name,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::timestamptz,$20::timestamptz)`,
            [
              matchId,
              ctx.orgId,
              event.row.id,
              publicationId,
              revision.id,
              f.fixtureKey,
              f.roundNo,
              f.positionNo,
              home.entryId,
              away.entryId,
              home.teamId,
              away.teamId,
              home.teamName,
              away.teamName,
              home.rosterRevisionId,
              away.rosterRevisionId,
              f.courtId,
              names.get(f.courtId!),
              f.startsAt,
              f.endsAt,
            ],
          );
          await client.query(
            'INSERT INTO court_reservations(org_id,publication_id,match_id,court_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5::timestamptz,$6::timestamptz)',
            [ctx.orgId, publicationId, matchId, f.courtId, f.startsAt, f.endsAt],
          );
          for (const team of [home.teamId, away.teamId])
            await client.query(
              'INSERT INTO team_reservations(org_id,publication_id,match_id,team_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5::timestamptz,$6::timestamptz)',
              [ctx.orgId, publicationId, matchId, team, f.startsAt, f.endsAt],
            );
        }
        await client.query(
          "UPDATE schedule_revisions SET status='PUBLISHED',version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2",
          [ctx.orgId, revision.id],
        );
        await client.query(
          "UPDATE events SET status='SCHEDULED',version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2",
          [ctx.orgId, event.row.id],
        );
        await this.audit(
          client,
          ctx.user.id,
          ctx.orgId,
          'SCHEDULE_PUBLISHED',
          'event',
          event.row.id,
          { revisionId: revision.id, publicationId, publicationHash: hash },
        );
        return this.schedulingDto(client, ctx, await this.event(client, ctx, event.row.id, false));
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23P01')
        throw new ApiError(409, 'SCHEDULE_CONFLICT', '正式场地或球队占用发生冲突，请重新校验', {
          conflicts: [],
        });
      throw error;
    }
  }
  async listMatches(cookie: string | undefined, org: string, eventId: string, raw: unknown) {
    const query = pageInput(raw);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const event = await this.event(client, ctx, eventId, false);
      const scope = `matches:${ctx.orgId}:${ctx.user.id}:${event.row.id}:${event.row.version}`;
      const cur = this.cursor(query, scope);
      const result = await client.query(
        `SELECT m.*,to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM published_matches m WHERE org_id=$1 AND event_id=$2 AND ($3::timestamptz IS NULL OR (starts_at,id)>($3::timestamptz,$4::uuid)) ORDER BY starts_at,id LIMIT $5`,
        [ctx.orgId, event.row.id, cur.createdAt, cur.id, query.limit + 1],
      );
      const data: ScheduledMatchData[] = result.rows.slice(0, query.limit).map((r) => ({
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
        startsAt: r.starts_at.toISOString(),
        endsAt: r.ends_at.toISOString(),
        status: r.status,
        version: r.version,
      }));
      return { data, nextCursor: this.next(result.rows, query.limit, scope) };
    });
  }

  protected matchDto(r: MatchRow): ScheduledMatchData {
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
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
      status: r.status,
      version: r.version,
    };
  }

  private async reschedulingAccess(
    c: PoolClient,
    ctx: OrgActor,
    matchId: string,
    writing: boolean,
  ) {
    const reference = await c.query<{ event_id: string }>(
      'SELECT event_id FROM published_matches WHERE org_id=$1 AND id=$2',
      [ctx.orgId, resourceId(matchId)],
    );
    if (!reference.rows[0]) throw notFound();
    const event = await this.event(c, ctx, reference.rows[0].event_id, writing);
    const match = (
      await c.query<MatchRow>(
        `SELECT * FROM published_matches WHERE org_id=$1 AND event_id=$2 AND id=$3 FOR ${writing ? 'UPDATE' : 'SHARE'}`,
        [ctx.orgId, event.row.id, matchId],
      )
    ).rows[0];
    if (!match) throw notFound();
    const revision = (
      await c.query<RevisionRow>(
        "SELECT * FROM schedule_revisions WHERE org_id=$1 AND event_id=$2 AND id=$3 AND status='PUBLISHED' FOR SHARE",
        [ctx.orgId, event.row.id, match.revision_id],
      )
    ).rows[0];
    if (!revision || event.row.current_schedule_revision_id !== revision.id)
      business('SCHEDULE_SOURCE_MISMATCH', '正式赛程来源校验失败');
    return { event, match, revision: revision! };
  }

  private async reschedulingState(c: PoolClient, org: string, match: MatchRow, writing = false) {
    const started =
      (
        await c.query(
          "SELECT 1 FROM scoring_events WHERE org_id=$1 AND match_id=$2 AND type='START_MATCH' LIMIT 1",
          [org, match.id],
        )
      ).rowCount! > 0;
    const state = (
      await c.query<MatchRow>(
        `SELECT * FROM scoring_states WHERE org_id=$1 AND match_id=$2 FOR ${writing ? 'UPDATE' : 'SHARE'}`,
        [org, match.id],
      )
    ).rows[0];
    const sourceValid =
      match.status === 'SCHEDULED'
        ? !state
        : match.status === 'READY'
          ? !!state && state.source_version === match.version && state.clock_running === false
          : false;
    return { started, sourceValid };
  }

  private async reschedulingDto(
    c: PoolClient,
    ctx: OrgActor,
    access: Awaited<ReturnType<SchedulingService['reschedulingAccess']>>,
  ): Promise<MatchReschedulingData> {
    const { event, match, revision } = access;
    const rows = (
      await c.query<MatchRow>(
        'SELECT * FROM match_reschedules WHERE org_id=$1 AND event_id=$2 AND match_id=$3 ORDER BY to_match_version DESC LIMIT 21',
        [ctx.orgId, event.row.id, match.id],
      )
    ).rows;
    const plan = (r: MatchRow, prefix: 'old' | 'new'): MatchReschedulePlan => ({
      courtId: r[`${prefix}_court_id`],
      courtName: r[`${prefix}_court_name`],
      startsAt: r[`${prefix}_starts_at`].toISOString(),
      endsAt: r[`${prefix}_ends_at`].toISOString(),
    });
    const history: MatchRescheduleRecord[] = rows.slice(0, 20).map((r) => ({
      id: r.id,
      fromMatchVersion: r.from_match_version,
      toMatchVersion: r.to_match_version,
      from: plan(r, 'old'),
      to: plan(r, 'new'),
      reason: r.reason,
      createdAt: r.created_at.toISOString(),
    }));
    const state = await this.reschedulingState(c, ctx.orgId, match);
    return {
      event: this.dtoEvent(event),
      match: this.matchDto(match),
      policy: revision.policy,
      history,
      historyLimit: 20,
      historyTruncated: rows.length > 20,
      capabilities: {
        canReschedule:
          event.canManage &&
          state.sourceValid &&
          canRescheduleMatch(event.row.status, match.status, state.started),
      },
    };
  }

  async getRescheduling(cookie: string | undefined, org: string, matchId: string) {
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const access = await this.reschedulingAccess(c, ctx, matchId, false);
      await this.ensureFreshSession(c, ctx);
      return this.reschedulingDto(c, ctx, access);
    });
  }

  async rescheduleMatch(cookie: string | undefined, org: string, matchId: string, raw: unknown) {
    const command = parseRescheduleCommand(raw);
    try {
      return await this.transaction(async (c) => {
        const ctx = await this.context(c, cookie, org);
        await this.mutex(c, ctx.orgId);
        const access = await this.reschedulingAccess(c, ctx, matchId, true);
        const { event, match, revision } = access;
        if (!event.canManage) throw forbidden();
        checkVersion(event.row.version, command.expectedEventVersion);
        checkVersion(match.version, command.expectedMatchVersion);
        if (!['SCHEDULED', 'RUNNING'].includes(event.row.status))
          business('INVALID_EVENT_STATE', '赛事当前不能改期', 409);
        const state = await this.reschedulingState(c, ctx.orgId, match, true);
        if (!canRescheduleMatch(event.row.status, match.status, state.started))
          business('MATCH_CANNOT_RESCHEDULE', '仅尚未开始的正式比赛可以改期', 409);
        if (!state.sourceValid)
          business('RESCHEDULE_SOURCE_INVALID', '当前记分来源无法校验，请联系赛事管理员', 409);
        const current = this.matchDto(match);
        const courts = await this.courts(c, ctx.orgId, [
          command.courtId,
          ...revision.policy.courtWindows.map((window) => window.courtId),
        ]);
        const targetCourt = courts.find((court) => court.id === command.courtId)!;
        const next = reschedulePlan(current, command, revision.policy, targetCourt.name);
        if (
          ['SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'].includes(event.row.format) &&
          match.round_no > 1
        ) {
          const parents = (
            await c.query<{ ends_at: Date }>(
              `SELECT m.ends_at FROM knockout_round_publications p
              CROSS JOIN LATERAL jsonb_array_elements(p.sources) source(value)
              JOIN published_matches m ON m.org_id=p.org_id AND m.event_id=p.event_id AND m.id=(source.value->>'matchId')::uuid
              WHERE p.org_id=$1 AND p.event_id=$2 AND p.round_no=$3 AND source.value->>'winnerEntryId'=ANY($4::text[])
             UNION ALL SELECT m.ends_at FROM group_qualification_publications p
              CROSS JOIN LATERAL jsonb_array_elements(p.sources) source(value)
              JOIN published_matches m ON m.org_id=p.org_id AND m.event_id=p.event_id AND m.id=(source.value->>'matchId')::uuid
              WHERE p.org_id=$1 AND p.event_id=$2 AND p.round_no=$3 AND (m.home_entry_id::text=ANY($4::text[]) OR m.away_entry_id::text=ANY($4::text[]))`,
              [ctx.orgId, event.row.id, match.round_no, [match.home_entry_id, match.away_entry_id]],
            )
          ).rows;
          if (parents.some((parent) => Date.parse(next.startsAt) < parent.ends_at.getTime()))
            business('KNOCKOUT_DEPENDENCY_ORDER', '晋级比赛不能改到来源比赛结束之前', 409);
        }
        const frozen = await this.freeze(c, ctx.orgId, event.row.id);
        if (!frozen || frozen.id !== revision.freeze_id)
          business('SCHEDULE_SOURCE_MISMATCH', '正式赛程与冻结名单不一致');
        const currentMatches = (
          await c.query<MatchRow>(
            'SELECT * FROM published_matches WHERE org_id=$1 AND event_id=$2 ORDER BY round_no,position_no',
            [ctx.orgId, event.row.id],
          )
        ).rows.map((r) => currentFixture(this.matchDto(r)));
        const fixtures = currentMatches.map((fixture) =>
          fixture.fixtureKey === current.fixtureKey ? { ...fixture, ...next } : fixture,
        );
        const booked = (
          await c.query<{
            kind: 'COURT' | 'TEAM';
            resource_id: string;
            starts_at: Date;
            ends_at: Date;
          }>(
            `SELECT 'COURT' AS kind,court_id AS resource_id,starts_at,ends_at FROM court_reservations WHERE org_id=$1 AND publication_id<>$2 AND starts_at<$4::timestamptz AND ends_at>$3::timestamptz UNION ALL SELECT 'TEAM' AS kind,team_id AS resource_id,starts_at,ends_at FROM team_reservations WHERE org_id=$1 AND publication_id<>$2 AND starts_at<$4::timestamptz AND ends_at>$3::timestamptz`,
            [ctx.orgId, current.publicationId, next.startsAt, next.endsAt],
          )
        ).rows;
        const conflicts = targetConflicts(
          validateSchedule({
            event: {
              id: event.row.id,
              startDate: event.row.start_date,
              endDate: event.row.end_date,
              timezone: event.row.timezone,
            },
            freeze: frozen!,
            policy: revision.policy,
            fixtures,
            courts,
            reservations: booked.map((r) => ({
              kind: r.kind,
              resourceId: r.resource_id,
              startsAt: r.starts_at.toISOString(),
              endsAt: r.ends_at.toISOString(),
            })),
          }),
          current.fixtureKey,
        );
        if (conflicts.length)
          throw new ApiError(409, 'SCHEDULE_CONFLICT', '改期安排存在冲突，请调整后重试', {
            conflicts,
          });
        await this.ensureFreshSession(c, ctx);
        const id = randomUUID();
        await c.query(
          `INSERT INTO match_reschedules(id,org_id,event_id,match_id,created_by,from_event_version,to_event_version,from_match_version,to_match_version,old_court_id,old_court_name,old_starts_at,old_ends_at,new_court_id,new_court_name,new_starts_at,new_ends_at,reason) VALUES($1,$2,$3,$4,$5,$6,$6+1,$7,$7+1,$8,$9,$10::timestamptz,$11::timestamptz,$12,$13,$14::timestamptz,$15::timestamptz,$16)`,
          [
            id,
            ctx.orgId,
            event.row.id,
            match.id,
            ctx.user.id,
            event.row.version,
            match.version,
            current.courtId,
            current.courtName,
            current.startsAt,
            current.endsAt,
            next.courtId,
            next.courtName,
            next.startsAt,
            next.endsAt,
            command.reason,
          ],
        );
        access.match = (
          await c.query<MatchRow>(
            'UPDATE published_matches SET court_id=$3,court_name=$4,starts_at=$5::timestamptz,ends_at=$6::timestamptz,version=version+1 WHERE org_id=$1 AND id=$2 RETURNING *',
            [ctx.orgId, match.id, next.courtId, next.courtName, next.startsAt, next.endsAt],
          )
        ).rows[0]!;
        await c.query(
          'UPDATE court_reservations SET court_id=$3,starts_at=$4::timestamptz,ends_at=$5::timestamptz WHERE org_id=$1 AND match_id=$2',
          [ctx.orgId, match.id, next.courtId, next.startsAt, next.endsAt],
        );
        await c.query(
          'UPDATE team_reservations SET starts_at=$3::timestamptz,ends_at=$4::timestamptz WHERE org_id=$1 AND match_id=$2',
          [ctx.orgId, match.id, next.startsAt, next.endsAt],
        );
        await c.query(
          'UPDATE scoring_states SET source_version=source_version+1 WHERE org_id=$1 AND match_id=$2',
          [ctx.orgId, match.id],
        );
        event.row = (
          await c.query<EventAccess['row']>(
            `UPDATE events e SET version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2 RETURNING ${EVENT_SELECT}`,
            [ctx.orgId, event.row.id],
          )
        ).rows[0]!;
        await this.audit(c, ctx.user.id, ctx.orgId, 'MATCH_RESCHEDULED', 'match', match.id, {
          rescheduleId: id,
          fromEventVersion: command.expectedEventVersion,
          toEventVersion: event.row.version,
          fromMatchVersion: command.expectedMatchVersion,
          toMatchVersion: access.match.version,
          reason: command.reason,
        });
        return this.reschedulingDto(c, ctx, access);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23P01')
        throw new ApiError(409, 'SCHEDULE_CONFLICT', '正式场地或球队占用发生冲突，请重新读取', {
          conflicts: [],
        });
      throw error;
    }
  }
}
