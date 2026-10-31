import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor, ApiOptions, DbUser } from './service.js';
import { StandingsService } from './standings-service.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { objectInput } from './validation.js';
import {
  caseNextState,
  govCheckVersion,
  govCommand,
  govFail,
  govHash,
  govId,
  govKey,
  govQuery,
  govText,
  govVersion,
  govVisibility,
  parseCaseCommand,
  parseCaseCreate,
  parseGovernanceAttachment,
  parseMessage,
} from './governance-domain.js';
import {
  assertCityOperation,
  governanceActiveOrg,
  governanceFinish,
  governanceOperator,
  governanceReceipt,
  governanceRegion,
} from './city-operations-service.js';
import type { GovernanceRegion } from '../../../packages/contracts/governance.js';

type Row = Record<string, any>;
export interface VerifiedGovernanceBooking {
  orgId: string;
  region: GovernanceRegion | null;
  bookingId: string;
  buyerUserId: string;
  providerUserId: string;
}
export interface GovernanceOptions {
  bookingVerifier?: (
    client: PoolClient,
    bookingId: string,
    actorUserId: string,
    requireCompleted: boolean,
  ) => Promise<VerifiedGovernanceBooking & { completed: boolean }>;
  /** Must verify a currently COMPLETED local order and both parties on the server. */
  completedBookingVerifier?: (
    client: PoolClient,
    bookingId: string,
    actorUserId: string,
  ) => Promise<VerifiedGovernanceBooking>;
}
type CaseContext = {
  actor: Actor;
  row: Row;
  requester: boolean;
  handler: boolean;
  operator: boolean;
};
const iso = (v: Date | string) => new Date(v).toISOString();
const maybeRegion = (r: Row): GovernanceRegion | null =>
  r.region_id ? { catalogVersion: r.region_catalog_version, regionId: r.region_id } : null;

export class GovernanceService extends StandingsService {
  readonly governanceOptions: GovernanceOptions;
  constructor(pool: Pool, options: ApiOptions, governanceOptions: GovernanceOptions = {}) {
    super(pool, options);
    this.governanceOptions = governanceOptions;
  }

  protected async govThrottle(
    cookie: string | undefined,
    kind: string,
    commandId: string,
    maximum = 60,
  ) {
    const pre = await this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const old = await c.query(
        'SELECT 1 FROM governance_operations WHERE actor_id=$1 AND command_id=$2',
        [actor.user.id, commandId],
      );
      return { userId: actor.user.id, replay: Boolean(old.rowCount) };
    });
    if (!pre.replay) await this.rateLimit(`governance-${kind}:${pre.userId}`, maximum, 3600);
  }
  protected async govContext(c: PoolClient, cookie: string | undefined, orgId: string) {
    const actor = await this.lockActor(c, cookie);
    await governanceActiveOrg(c, orgId);
    return { actor, operator: await governanceOperator(c, actor.user.id) };
  }
  protected async govAdmin(c: PoolClient, actor: Actor, orgId: string) {
    const org = await this.lockOrganization(c, actor, orgId);
    if (!['ORG_OWNER', 'ORG_ADMIN'].includes(org.role)) throw forbidden();
    return org;
  }
  private async authorizedOperation(
    c: PoolClient,
    cookie: string | undefined,
    actor: Actor,
    result: Row,
  ) {
    if (result._cancelled === true) return { commandId: result.commandId, cancelled: true };
    const scope = result._receiptScope;
    if (!scope || typeof scope.kind !== 'string' || typeof scope.resourceId !== 'string')
      throw notFound();
    const id = govId(scope.resourceId);
    if (scope.kind === 'CASE') await this.caseContext(c, cookie, id);
    else if (scope.kind === 'CITY') {
      if (!(await governanceOperator(c, actor.user.id))) throw forbidden();
      const row = (await c.query<Row>('SELECT org_id FROM city_operation_grants WHERE id=$1', [id]))
        .rows[0];
      if (!row) throw notFound();
      await governanceActiveOrg(c, row.org_id);
    } else if (scope.kind === 'REVIEW') {
      const row = (
        await c.query<Row>('SELECT org_id,author_id FROM governance_reviews WHERE id=$1', [id])
      ).rows[0];
      if (!row) throw notFound();
      await governanceActiveOrg(c, row.org_id);
      if (row.author_id !== actor.user.id && !(await governanceOperator(c, actor.user.id)))
        throw notFound();
    } else if (scope.kind === 'SPONSOR') {
      const row = (
        await c.query<Row>(
          'SELECT org_id,region_catalog_version,region_id FROM sponsorship_campaigns WHERE id=$1',
          [id],
        )
      ).rows[0];
      if (!row) throw notFound();
      await governanceActiveOrg(c, row.org_id);
      try {
        await this.govAdmin(c, actor, row.org_id);
      } catch (error) {
        if (!(error instanceof ApiError) || ![403, 404].includes(error.status)) throw error;
        await assertCityOperation(c, actor, {
          orgId: row.org_id,
          region: maybeRegion(row)!,
          action: 'SPONSOR_REVIEW',
        });
      }
    } else if (scope.kind === 'LEDGER') {
      const row = (
        await c.query<Row>('SELECT org_id FROM public_ledger_accounts WHERE id=$1', [id])
      ).rows[0];
      if (!row) throw notFound();
      await this.govAdmin(c, actor, row.org_id);
    } else throw notFound();
    const { _receiptScope: _, ...publicResult } = result;
    return publicResult;
  }
  async operationReceipt(cookie: string | undefined, id: string) {
    const commandId = govCommand(id);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        row = (
          await c.query<Row>(
            'SELECT result FROM governance_operations WHERE actor_id=$1 AND command_id=$2',
            [actor.user.id, commandId],
          )
        ).rows[0];
      if (!row) throw notFound();
      return this.authorizedOperation(c, cookie, actor, row.result);
    });
  }
  /** An explicit cancellation tombstone prevents a delayed, previously unknown request applying. */
  async cancelOperation(cookie: string | undefined, id: string, raw: unknown) {
    const commandId = govCommand(id),
      o = objectInput(raw, ['reason']);
    govText(o.reason, 'reason', 4, 500);
    const outcome = await this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `scb-governance:${actor.user.id}:${commandId}`,
      ]);
      const row = (
        await c.query<Row>(
          'SELECT result FROM governance_operations WHERE actor_id=$1 AND command_id=$2',
          [actor.user.id, commandId],
        )
      ).rows[0];
      if (row) return { alreadyCompleted: true as const };
      const result = { commandId, cancelled: true, _cancelled: true };
      await c.query(
        'INSERT INTO governance_operations(actor_id,command_id,request_hash,result) VALUES($1,$2,$3,$4::jsonb)',
        [
          actor.user.id,
          commandId,
          govHash({ operation: 'EXPLICIT_CANCELLATION', commandId }),
          JSON.stringify(result),
        ],
      );
      await this.audit(
        c,
        actor.user.id,
        null,
        'governance.unknown_cancelled',
        'governance_operation',
        commandId,
      );
      return { alreadyCompleted: false as const, commandId, cancelled: true };
    });
    return outcome.alreadyCompleted
      ? this.operationReceipt(cookie, commandId)
      : { commandId, cancelled: true };
  }
  /** A verifier for real service participation; caller-supplied status or party IDs are never used. */
  async verifiedBooking(
    c: PoolClient,
    kind: 'PLAYER_BOOKING' | 'LOCAL_BOOKING',
    id: string,
    actorUserId: string,
    completed = true,
  ): Promise<VerifiedGovernanceBooking> {
    if (kind === 'LOCAL_BOOKING') {
      if (
        !this.governanceOptions.bookingVerifier &&
        (!completed || !this.governanceOptions.completedBookingVerifier)
      )
        govFail('LOCAL_BOOKING_VERIFIER_UNAVAILABLE', '本地订单参与核验尚未接线', 503);
      const result = this.governanceOptions.bookingVerifier
        ? await this.governanceOptions.bookingVerifier(c, govId(id), actorUserId, completed)
        : await this.governanceOptions.completedBookingVerifier!(c, govId(id), actorUserId);
      if (
        result.bookingId !== id ||
        ![result.buyerUserId, result.providerUserId].includes(actorUserId) ||
        result.buyerUserId === result.providerUserId
      )
        throw notFound();
      await governanceActiveOrg(c, result.orgId);
      if (result.region) await governanceRegion(c, result.region);
      return result;
    }
    const row = (
      await c.query<Row>(
        `SELECT a.id,a.status,a.player_user_id,o.org_id,o.buyer_user_id
      FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id
      JOIN organizations org ON org.id=o.org_id AND org.status='ACTIVE'
      JOIN users buyer ON buyer.id=o.buyer_user_id AND buyer.status='ACTIVE'
      JOIN users provider ON provider.id=a.player_user_id AND provider.status='ACTIVE'
      WHERE a.id=$1 AND (o.buyer_user_id=$2 OR a.player_user_id=$2) FOR SHARE OF a,o,org,buyer,provider`,
        [govId(id), actorUserId],
      )
    ).rows[0];
    if (
      !row ||
      (completed && row.status !== 'COMPLETED') ||
      row.buyer_user_id === row.player_user_id
    )
      throw notFound();
    return {
      bookingId: row.id,
      orgId: row.org_id,
      region: null,
      buyerUserId: row.buyer_user_id,
      providerUserId: row.player_user_id,
    };
  }
  private async source(
    c: PoolClient,
    actor: Actor,
    orgId: string,
    source: { kind: string; id: string } | null,
  ) {
    if (!source) return;
    if (source.kind === 'PUBLIC_EVENT') {
      const { pub } = await this.publicAccess(c, source.id);
      if (pub.org_id !== orgId) throw notFound();
      return;
    }
    const verified = await this.verifiedBooking(
      c,
      source.kind as 'PLAYER_BOOKING' | 'LOCAL_BOOKING',
      source.id,
      actor.user.id,
      source.kind === 'LOCAL_BOOKING',
    );
    if (verified.orgId !== orgId) throw notFound();
  }
  private async caseContext(
    c: PoolClient,
    cookie: string | undefined,
    id: string,
    write = false,
  ): Promise<CaseContext> {
    const actor = await this.lockActor(c, cookie);
    const ref = (await c.query<Row>('SELECT org_id FROM governance_cases WHERE id=$1', [govId(id)]))
      .rows[0];
    if (!ref) throw notFound();
    await governanceActiveOrg(c, ref.org_id);
    const row = (
      await c.query<Row>(
        `SELECT * FROM governance_cases WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`,
        [id],
      )
    ).rows[0]!;
    const requester = row.requester_id === actor.user.id,
      operator = await governanceOperator(c, actor.user.id);
    let handler = operator && !requester;
    if (
      !requester &&
      !handler &&
      row.assigned_to === actor.user.id &&
      row.assignment_grant_id &&
      row.region_id
    ) {
      try {
        const access = await assertCityOperation(c, actor, {
          orgId: row.org_id,
          region: maybeRegion(row)!,
          action: 'CASE_MANAGE',
          grantId: row.assignment_grant_id,
        });
        handler = access.grantId === row.assignment_grant_id || access.platformOperator;
      } catch (error) {
        if (!(error instanceof ApiError) || ![403, 404].includes(error.status)) throw error;
      }
    }
    if (!requester && !handler) throw notFound();
    return { actor, row, requester, handler, operator };
  }
  private caseDto(ctx: CaseContext) {
    const r = ctx.row;
    return {
      id: r.id,
      orgId: r.org_id,
      kind: r.kind,
      title: r.title,
      status: r.status,
      version: r.version,
      requesterId: r.requester_id,
      region: maybeRegion(r),
      source: r.source_kind ? { kind: r.source_kind, id: r.source_id } : null,
      parentCaseId: r.parent_case_id,
      assignedTo: r.assigned_to,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      capabilities: {
        canReply: r.status !== 'CLOSED',
        canAssign: ctx.operator && !ctx.requester && ['OPEN', 'ASSIGNED'].includes(r.status),
        canResolve: ctx.handler && !ctx.requester && r.status === 'ASSIGNED',
        canClose:
          r.status !== 'CLOSED' && (ctx.requester || (ctx.handler && r.status === 'RESOLVED')),
        canReopen: ctx.requester && ['RESOLVED', 'CLOSED'].includes(r.status),
      },
    };
  }
  async cases(cookie: string | undefined, raw: unknown, platform = false) {
    const q = govQuery(raw, ['assigned']);
    if (q.input.assigned !== undefined && q.input.assigned !== 'true')
      govFail('VALIDATION_ERROR', 'assigned只接受true', 422);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        operator = await governanceOperator(c, actor.user.id);
      if (platform && !operator) throw forbidden();
      const refs = (
        await c.query<Row>(
          `SELECT g.id FROM governance_cases g JOIN organizations o ON o.id=g.org_id AND o.status='ACTIVE'
        WHERE ($1::boolean OR ${q.input.assigned ? 'g.assigned_to' : 'g.requester_id'}=$2) AND ($3::uuid IS NULL OR g.id<$3)
        ORDER BY g.id DESC LIMIT $4`,
          [platform, actor.user.id, q.before, q.limit + 1],
        )
      ).rows;
      const items: unknown[] = [];
      for (const ref of refs.slice(0, q.limit)) {
        try {
          items.push(this.caseDto(await this.caseContext(c, cookie, ref.id)));
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }
      return {
        items,
        nextCursor: refs.length > q.limit ? (refs[q.limit - 1]?.id ?? null) : null,
        canTriage: operator,
      };
    });
  }
  async getCase(cookie: string | undefined, id: string) {
    return this.transaction(async (c) => {
      const ctx = await this.caseContext(c, cookie, id),
        internal = ctx.handler && !ctx.requester;
      const messages = (
        await c.query<Row>(
          `SELECT id,author_id,body,visibility,created_at FROM governance_case_messages WHERE case_id=$1 AND ($2::boolean OR visibility='REQUESTER') ORDER BY created_at DESC,id DESC LIMIT 101`,
          [id, internal],
        )
      ).rows;
      const attachments = (
        await c.query<Row>(
          `SELECT id,file_name,content_type,byte_length,visibility,created_at FROM governance_case_attachments WHERE case_id=$1 AND ($2::boolean OR visibility='REQUESTER') ORDER BY created_at,id LIMIT 17`,
          [id, internal],
        )
      ).rows;
      return {
        ...this.caseDto(ctx),
        messagesBefore: messages.length > 100 ? messages[99]!.id : null,
        messages: messages
          .slice(0, 100)
          .reverse()
          .map((r) => ({
            id: r.id,
            authorId: r.author_id,
            body: r.body,
            visibility: r.visibility,
            createdAt: iso(r.created_at),
          })),
        attachments: attachments.map((r) => ({
          id: r.id,
          fileName: r.file_name,
          contentType: r.content_type,
          byteLength: r.byte_length,
          visibility: r.visibility,
          createdAt: iso(r.created_at),
        })),
      };
    });
  }
  async caseMessages(cookie: string | undefined, id: string, raw: unknown) {
    const q = govQuery(raw);
    return this.transaction(async (c) => {
      const ctx = await this.caseContext(c, cookie, id),
        internal = ctx.handler && !ctx.requester;
      let before: Row | undefined;
      if (q.before) {
        before = (
          await c.query<Row>(
            "SELECT id,created_at FROM governance_case_messages WHERE case_id=$1 AND id=$2 AND ($3::boolean OR visibility='REQUESTER')",
            [id, q.before, internal],
          )
        ).rows[0];
        if (!before) throw notFound();
      }
      const rows = (
        await c.query<Row>(
          `SELECT id,author_id,body,visibility,created_at FROM governance_case_messages WHERE case_id=$1 AND ($2::boolean OR visibility='REQUESTER') AND ($3::uuid IS NULL OR (created_at,id)<($4::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5`,
          [id, internal, q.before, before?.created_at ?? null, q.limit + 1],
        )
      ).rows;
      return {
        items: rows
          .slice(0, q.limit)
          .reverse()
          .map((r) => ({
            id: r.id,
            authorId: r.author_id,
            body: r.body,
            visibility: r.visibility,
            createdAt: iso(r.created_at),
          })),
        nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
      };
    });
  }
  async caseAssignees(cookie: string | undefined, id: string) {
    return this.transaction(async (c) => {
      const ctx = await this.caseContext(c, cookie, id);
      if (!ctx.operator || ctx.requester) throw forbidden();
      const candidates = (
        await c.query<Row>(
          `SELECT DISTINCT u.id,u.display_name FROM users u WHERE u.status='ACTIVE' AND u.id<>$1 AND
        (EXISTS(SELECT 1 FROM platform_operators p WHERE p.user_id=u.id AND p.status='ACTIVE') OR EXISTS(SELECT 1 FROM city_operation_grants g WHERE g.user_id=u.id AND g.org_id=$2 AND g.action='CASE_MANAGE' AND g.status='ACTIVE' AND g.expires_at>clock_timestamp())) ORDER BY u.display_name,u.id LIMIT 101`,
          [ctx.row.requester_id, ctx.row.org_id],
        )
      ).rows;
      const items: unknown[] = [];
      for (const user of candidates.slice(0, 100)) {
        if (await governanceOperator(c, user.id)) {
          items.push({ userId: user.id, displayName: user.display_name, grantId: null });
          continue;
        }
        if (!ctx.row.region_id) continue;
        try {
          const auth = await assertCityOperation(
            c,
            {
              sessionId: '',
              user: {
                id: user.id,
                email: '',
                display_name: user.display_name,
                password_hash: '',
                status: 'ACTIVE',
              },
            },
            { orgId: ctx.row.org_id, region: maybeRegion(ctx.row)!, action: 'CASE_MANAGE' },
          );
          items.push({ userId: user.id, displayName: user.display_name, grantId: auth.grantId });
        } catch (error) {
          if (!(error instanceof ApiError) || ![403, 404].includes(error.status)) throw error;
        }
      }
      return { items, truncated: candidates.length > 100 };
    });
  }
  async createCase(cookie: string | undefined, raw: unknown) {
    const input = parseCaseCreate(raw);
    await this.govThrottle(cookie, 'case-create', input.commandId, 30);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      let orgId = input.orgId;
      let parent: Row | undefined;
      if (input.parentCaseId) {
        parent = (
          await c.query<Row>(
            'SELECT * FROM governance_cases WHERE id=$1 AND requester_id=$2 FOR SHARE',
            [input.parentCaseId, actor.user.id],
          )
        ).rows[0];
        if (!parent) throw notFound();
        if (orgId && orgId !== parent.org_id) throw notFound();
        orgId = parent.org_id;
      }
      if (input.source) {
        const sourceOrg =
          input.source.kind === 'PUBLIC_EVENT'
            ? (await this.publicAccess(c, input.source.id)).pub.org_id
            : (
                await this.verifiedBooking(
                  c,
                  input.source.kind,
                  input.source.id,
                  actor.user.id,
                  false,
                )
              ).orgId;
        if (orgId && orgId !== sourceOrg) throw notFound();
        orgId = sourceOrg;
      }
      if (!orgId) throw notFound();
      await governanceActiveOrg(c, orgId);
      if (input.region) await governanceRegion(c, input.region);
      const request = { operation: 'CASE_CREATE', ...input },
        old = await governanceReceipt(c, actor, input.commandId, request);
      if (old) return old;
      if (parent && !['RESOLVED', 'CLOSED'].includes(parent.status))
        govFail('CASE_APPEAL_NOT_READY', '仅可申诉本人的已处理工单');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `scb-case-quota:${actor.user.id}`,
      ]);
      const count = Number(
        (
          await c.query<{ count: string }>(
            "SELECT count(*) FROM governance_cases WHERE requester_id=$1 AND status IN ('OPEN','ASSIGNED')",
            [actor.user.id],
          )
        ).rows[0]!.count,
      );
      if (count >= 32) govFail('TOO_MANY_OPEN_CASES', '待处理工单过多，请先处理原工单');
      const id = randomUUID();
      await c.query(
        `INSERT INTO governance_cases(id,org_id,requester_id,kind,title,region_catalog_version,region_id,source_kind,source_id,parent_case_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          orgId,
          actor.user.id,
          input.kind,
          input.title,
          input.region?.catalogVersion ?? null,
          input.region?.regionId ?? null,
          input.source?.kind ?? null,
          input.source?.id ?? null,
          input.parentCaseId,
        ],
      );
      await c.query(
        "INSERT INTO governance_case_messages(id,case_id,author_id,body,visibility) VALUES($1,$2,$3,$4,'REQUESTER')",
        [randomUUID(), id, actor.user.id, input.body],
      );
      await this.audit(c, actor.user.id, orgId, 'governance.case_created', 'governance_case', id, {
        kind: input.kind,
      });
      const result = { id, version: 1, status: 'OPEN' };
      await governanceFinish(c, actor, input.commandId, request, result);
      return result;
    });
  }
  async reply(cookie: string | undefined, id: string, raw: unknown) {
    const input = parseMessage(raw);
    await this.govThrottle(cookie, 'case-reply', input.commandId);
    return this.transaction(async (c) => {
      const ctx = await this.caseContext(c, cookie, id, true);
      if (input.visibility === 'INTERNAL' && !ctx.handler) throw forbidden();
      const request = { operation: 'CASE_REPLY', caseId: id, ...input },
        old = await governanceReceipt(c, ctx.actor, input.commandId, request);
      if (old) return old;
      govCheckVersion(ctx.row.version, input.expectedVersion);
      if (ctx.row.status === 'CLOSED') govFail('CASE_CLOSED', '请先重新打开工单');
      const messageId = randomUUID();
      await c.query(
        'INSERT INTO governance_case_messages(id,case_id,author_id,body,visibility) VALUES($1,$2,$3,$4,$5)',
        [messageId, id, ctx.actor.user.id, input.body, input.visibility],
      );
      await c.query(
        'UPDATE governance_cases SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
        [id],
      );
      await this.audit(
        c,
        ctx.actor.user.id,
        ctx.row.org_id,
        'governance.case_replied',
        'governance_case',
        id,
        { visibility: input.visibility },
      );
      const result = { id, version: ctx.row.version + 1, messageId };
      await governanceFinish(c, ctx.actor, input.commandId, request, result);
      return result;
    });
  }
  async caseCommand(cookie: string | undefined, id: string, raw: unknown) {
    const input = parseCaseCommand(raw);
    await this.govThrottle(cookie, 'case-command', input.commandId);
    return this.transaction(async (c) => {
      const ctx = await this.caseContext(c, cookie, id, true);
      const request = { operation: 'CASE_COMMAND', caseId: id, ...input },
        old = await governanceReceipt(c, ctx.actor, input.commandId, request);
      if (old) return old;
      govCheckVersion(ctx.row.version, input.expectedVersion);
      const status = caseNextState(ctx.row.status, input.type, ctx);
      let grantId: string | null = null;
      if (input.type === 'ASSIGN') {
        if (input.assigneeId === ctx.row.requester_id) throw forbidden();
        const user = (
          await c.query<DbUser>(
            "SELECT id,email,display_name,password_hash,status FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE",
            [input.assigneeId],
          )
        ).rows[0];
        if (!user) throw notFound();
        if (!(await governanceOperator(c, user.id))) {
          if (!ctx.row.region_id || !input.grantId) throw forbidden();
          const auth = await assertCityOperation(
            c,
            { user, sessionId: '' },
            {
              orgId: ctx.row.org_id,
              region: maybeRegion(ctx.row)!,
              action: 'CASE_MANAGE',
              grantId: input.grantId,
            },
          );
          grantId = auth.grantId;
        }
      }
      if (input.type === 'ASSIGN')
        await c.query(
          'UPDATE governance_cases SET status=$2,version=version+1,assigned_to=$3,assignment_grant_id=$4,assigned_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1',
          [id, status, input.assigneeId, grantId],
        );
      else if (input.type === 'REOPEN')
        await c.query(
          'UPDATE governance_cases SET status=$2,version=version+1,assigned_to=NULL,assignment_grant_id=NULL,assigned_at=NULL,updated_at=clock_timestamp() WHERE id=$1',
          [id, status],
        );
      else
        await c.query(
          'UPDATE governance_cases SET status=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
          [id, status],
        );
      await c.query(
        'INSERT INTO governance_case_messages(id,case_id,author_id,body,visibility) VALUES($1,$2,$3,$4,$5)',
        [
          randomUUID(),
          id,
          ctx.actor.user.id,
          input.reason,
          input.type === 'ASSIGN' ? 'INTERNAL' : 'REQUESTER',
        ],
      );
      await this.audit(
        c,
        ctx.actor.user.id,
        ctx.row.org_id,
        `governance.case_${input.type.toLowerCase()}`,
        'governance_case',
        id,
      );
      const result = { id, version: ctx.row.version + 1, status };
      await governanceFinish(c, ctx.actor, input.commandId, request, result);
      return result;
    });
  }
  async attachment(cookie: string | undefined, id: string, commandId: string, raw: unknown) {
    const cid = govCommand(commandId),
      caseId = govId(id),
      request = { operation: 'CASE_ATTACHMENT', caseId, commandId: cid, body: raw };
    await this.govThrottle(cookie, 'case-attachment', cid, 30);
    const replay = await this.transaction(async (c) => {
      const ctx = await this.caseContext(c, cookie, caseId);
      const o = objectInput(raw, [
        'expectedVersion',
        'fileName',
        'contentType',
        'base64',
        'visibility',
      ]);
      if (govVisibility(o.visibility) === 'INTERNAL' && !ctx.handler) throw forbidden();
      return governanceReceipt(c, ctx.actor, cid, request);
    });
    if (replay) return replay;
    const file = await parseGovernanceAttachment(raw);
    return this.transaction(async (c) => {
      const ctx = await this.caseContext(c, cookie, caseId, true);
      if (file.visibility === 'INTERNAL' && !ctx.handler) throw forbidden();
      const old = await governanceReceipt(c, ctx.actor, cid, request);
      if (old) return old;
      govCheckVersion(ctx.row.version, file.expectedVersion);
      if (ctx.row.status === 'CLOSED') govFail('CASE_CLOSED', '请先重新打开工单');
      const quota = (
        await c.query<{ count: string; bytes: string }>(
          'SELECT count(*) AS count,coalesce(sum(byte_length),0) AS bytes FROM governance_case_attachments WHERE case_id=$1',
          [caseId],
        )
      ).rows[0]!;
      if (Number(quota.count) >= 16 || Number(quota.bytes) + file.byteLength > 16 * 1024 * 1024)
        govFail('CASE_ATTACHMENT_QUOTA', '每工单最多16份附件且合计16MiB');
      const attachmentId = randomUUID();
      await c.query(
        `INSERT INTO governance_case_attachments(id,case_id,uploaded_by,command_id,file_name,content_type,byte_length,content,content_hash,visibility)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          attachmentId,
          caseId,
          ctx.actor.user.id,
          cid,
          file.fileName,
          file.contentType,
          file.byteLength,
          file.bytes,
          file.contentHash,
          file.visibility,
        ],
      );
      await c.query(
        'UPDATE governance_cases SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
        [caseId],
      );
      await this.audit(
        c,
        ctx.actor.user.id,
        ctx.row.org_id,
        'governance.attachment_added',
        'governance_case',
        caseId,
        { attachmentId, contentType: file.contentType, byteLength: file.byteLength },
      );
      const result = {
        id: caseId,
        attachmentId,
        version: ctx.row.version + 1,
        fileName: file.fileName,
        contentType: file.contentType,
        byteLength: file.byteLength,
      };
      await governanceFinish(c, ctx.actor, cid, request, result);
      return result;
    });
  }
  async attachmentReceipt(cookie: string | undefined, id: string, commandId: string) {
    return this.transaction(async (c) => {
      const ctx = await this.caseContext(c, cookie, id);
      const row = (
        await c.query<Row>(
          'SELECT id,file_name,content_type,byte_length,visibility FROM governance_case_attachments WHERE case_id=$1 AND uploaded_by=$2 AND command_id=$3',
          [id, ctx.actor.user.id, govCommand(commandId)],
        )
      ).rows[0];
      if (!row || (row.visibility === 'INTERNAL' && !ctx.handler)) throw notFound();
      return {
        id,
        attachmentId: row.id,
        fileName: row.file_name,
        contentType: row.content_type,
        byteLength: row.byte_length,
        currentVersion: ctx.row.version,
      };
    });
  }
  async attachmentContent(cookie: string | undefined, id: string, fileId: string) {
    return this.transaction(async (c) => {
      const ctx = await this.caseContext(c, cookie, id);
      const row = (
        await c.query<Row>('SELECT * FROM governance_case_attachments WHERE case_id=$1 AND id=$2', [
          id,
          govId(fileId),
        ])
      ).rows[0];
      if (!row || (row.visibility === 'INTERNAL' && !ctx.handler)) throw notFound();
      await this.audit(
        c,
        ctx.actor.user.id,
        ctx.row.org_id,
        'governance.attachment_read',
        'governance_case',
        id,
        { attachmentId: row.id },
      );
      return {
        fileName: row.file_name,
        contentType: row.content_type,
        bytes: row.content as Buffer,
      };
    });
  }
  private reviewDto(r: Row) {
    return {
      id: r.id,
      orgId: r.org_id,
      sourceKind: r.source_kind,
      sourceId: r.source_id,
      score: r.score,
      body: r.body,
      status: r.status,
      version: r.version,
      publicKey: r.public_key,
      createdAt: iso(r.created_at),
    };
  }
  async myReviews(cookie: string | undefined, raw: unknown, platform = false) {
    const q = govQuery(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      if (platform && !(await governanceOperator(c, actor.user.id))) throw forbidden();
      const rows = (
        await c.query<Row>(
          `SELECT r.* FROM governance_reviews r JOIN organizations o ON o.id=r.org_id AND o.status='ACTIVE' WHERE ($1::boolean OR r.author_id=$2) AND ($3::uuid IS NULL OR r.id<$3) ORDER BY r.id DESC LIMIT $4`,
          [platform, actor.user.id, q.before, q.limit + 1],
        )
      ).rows;
      return {
        items: rows.slice(0, q.limit).map((r) => this.reviewDto(r)),
        nextCursor: rows.length > q.limit ? (rows[q.limit - 1]?.id ?? null) : null,
      };
    });
  }
  async createReview(cookie: string | undefined, raw: unknown) {
    const o = objectInput(raw, [
      'commandId',
      'sourceKind',
      'sourceId',
      'score',
      'body',
      'publicConsent',
    ]);
    if (
      !['PLAYER_BOOKING', 'LOCAL_BOOKING'].includes(String(o.sourceKind)) ||
      !Number.isInteger(o.score) ||
      Number(o.score) < 1 ||
      Number(o.score) > 5 ||
      o.publicConsent !== true
    )
      govFail('VALIDATION_ERROR', '评价须为1—5分、真实完成订单并明确同意公开', 422);
    const input = {
      commandId: govCommand(o.commandId),
      sourceKind: o.sourceKind as 'PLAYER_BOOKING' | 'LOCAL_BOOKING',
      sourceId: govId(o.sourceId),
      score: Number(o.score),
      body: govText(o.body, 'body', 1, 1000),
      publicConsent: true,
    };
    await this.govThrottle(cookie, 'review-create', input.commandId, 20);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        source = await this.verifiedBooking(c, input.sourceKind, input.sourceId, actor.user.id);
      const target =
        actor.user.id === source.buyerUserId ? source.providerUserId : source.buyerUserId;
      const request = { operation: 'REVIEW_CREATE', ...input },
        old = await governanceReceipt(c, actor, input.commandId, request);
      if (old) return old;
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `scb-review:${input.sourceKind}:${input.sourceId}:${actor.user.id}`,
      ]);
      if (
        (
          await c.query(
            'SELECT 1 FROM governance_reviews WHERE source_kind=$1 AND source_id=$2 AND author_id=$3',
            [input.sourceKind, input.sourceId, actor.user.id],
          )
        ).rowCount
      )
        govFail('REVIEW_ALREADY_EXISTS', '该履约来源已经评价，不得刷分');
      const row = (
        await c.query<Row>(
          `INSERT INTO governance_reviews(id,org_id,public_key,source_kind,source_id,author_id,target_user_id,score,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            randomUUID(),
            source.orgId,
            randomBytes(32).toString('base64url'),
            input.sourceKind,
            input.sourceId,
            actor.user.id,
            target,
            input.score,
            input.body,
          ],
        )
      ).rows[0]!;
      await this.audit(
        c,
        actor.user.id,
        source.orgId,
        'governance.review_created',
        'service_review',
        row.id,
      );
      const result = this.reviewDto(row);
      await governanceFinish(c, actor, input.commandId, request, result);
      return result;
    });
  }
  async reviewCommand(cookie: string | undefined, id: string, raw: unknown) {
    const o = objectInput(raw, ['commandId', 'expectedVersion', 'type', 'reason']);
    if (!['PUBLISH', 'REJECT', 'WITHDRAW'].includes(String(o.type)))
      govFail('VALIDATION_ERROR', '评价操作无效', 422);
    const input = {
      commandId: govCommand(o.commandId),
      expectedVersion: govVersion(o.expectedVersion),
      type: String(o.type),
      reason: govText(o.reason, 'reason', 4, 500),
    };
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        ref = (await c.query<Row>('SELECT org_id FROM governance_reviews WHERE id=$1', [govId(id)]))
          .rows[0];
      if (!ref) throw notFound();
      await governanceActiveOrg(c, ref.org_id);
      const r = (
          await c.query<Row>('SELECT * FROM governance_reviews WHERE id=$1 FOR UPDATE', [id])
        ).rows[0]!,
        owner = r.author_id === actor.user.id,
        operator = await governanceOperator(c, actor.user.id);
      if (
        input.type === 'WITHDRAW'
          ? !owner
          : !operator || [r.author_id, r.target_user_id].includes(actor.user.id)
      )
        throw forbidden();
      const request = { operation: 'REVIEW_COMMAND', id, ...input },
        old = await governanceReceipt(c, actor, input.commandId, request);
      if (old) return old;
      govCheckVersion(r.version, input.expectedVersion);
      if (r.status === 'WITHDRAWN' || (input.type !== 'WITHDRAW' && r.status !== 'PENDING_REVIEW'))
        govFail('REVIEW_TRANSITION_REFUSED', '评价已处理或撤回');
      if (input.type === 'PUBLISH')
        await this.verifiedBooking(c, r.source_kind, r.source_id, r.author_id);
      const status =
        input.type === 'PUBLISH' ? 'PUBLISHED' : input.type === 'REJECT' ? 'REJECTED' : 'WITHDRAWN';
      const updated = (
        await c.query<Row>(
          `UPDATE governance_reviews SET status=$2,version=version+1,reviewed_by=CASE WHEN $2='WITHDRAWN' THEN reviewed_by ELSE $3 END,review_reason=$4,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
          [id, status, actor.user.id, input.reason],
        )
      ).rows[0]!;
      await this.audit(
        c,
        actor.user.id,
        r.org_id,
        'governance.review_' + status.toLowerCase(),
        'service_review',
        id,
      );
      const result = this.reviewDto(updated);
      await governanceFinish(c, actor, input.commandId, request, result);
      return result;
    });
  }
  async publicReview(key: string) {
    const publicKey = govKey(key);
    return this.transaction(async (c) => {
      const r = (
        await c.query<Row>(
          `SELECT r.* FROM governance_reviews r JOIN organizations o ON o.id=r.org_id AND o.status='ACTIVE' WHERE r.public_key=$1 AND r.status='PUBLISHED'`,
          [publicKey],
        )
      ).rows[0];
      if (!r) throw notFound();
      try {
        await this.verifiedBooking(c, r.source_kind, r.source_id, r.author_id);
      } catch (error) {
        if (error instanceof ApiError) throw notFound();
        throw error;
      }
      return {
        publicKey,
        score: r.score,
        body: r.body,
        authorLabel: '已完成服务的参与者',
        createdAt: iso(r.created_at),
        notice: '基于服务端核验的完成记录；不代表已付款，不公开账号或订单编号。',
      };
    });
  }
}
