import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  IssuedTeamJoinCodeData,
  IssuedTeamRequestLinkData,
  MemberBindingEndedReason,
  MemberBindingSource,
  MemberBindingStatus,
  MembershipData,
  MembershipTeamData,
  MyMemberClaimData,
  OrgRole,
  OrgTeamRequestData,
  ResolvedTeamRequestLinkData,
  TeamJoinCodeData,
  TeamMemberBindingData,
  TeamMemberBindingsData,
  TeamMemberClaimData,
  TeamMemberClaimStatus,
  TeamRequestData,
  TeamRequestLinkData,
  TeamRequestStatus,
} from '@small-city-basketball/contracts';
import { ApiError, forbidden, notFound } from './errors.js';
import { ApplicationService, isAdministrator } from './service.js';
import type { Actor } from './service.js';
import { hashToken } from './security.js';
import { objectInput, resourceId } from './validation.js';
import {
  claimInput,
  claimStatus,
  emptyInput,
  joinCodeInput,
  joinCodeInvalid,
  joinCodeStatus,
  joinInput,
  linkInput,
  linkInvalid,
  linkStatus,
  newJoinCode,
  newLinkToken,
  reasonInput,
  resolveInput,
  reviewInput,
  revokeLinkInput,
  statusFilter,
  submitInput,
  withdrawInput,
} from './team-membership-domain.js';

interface OrgContext extends Actor {
  orgId: string;
  orgName: string;
  role: OrgRole | null;
  admin: boolean;
}
interface TeamRow {
  id: string;
  org_id: string;
  name: string;
}
interface LinkRow {
  id: string;
  org_id: string;
  token_hash: string;
  created_by: string;
  reason: string;
  max_uses: number;
  use_count: number;
  expires_at: Date;
  revoked_at: Date | null;
  revoke_reason: string | null;
  created_at: Date;
}
interface RequestRow {
  id: string;
  org_id: string;
  link_id: string;
  requester_id: string;
  client_request_id: string;
  team_name: string;
  note: string | null;
  status: TeamRequestStatus;
  version: number;
  review_reason: string | null;
  reviewed_at: Date | null;
  withdrawn_at: Date | null;
  team_id: string | null;
  created_at: Date;
  updated_at: Date;
  org_name: string;
  requester_display_name?: string;
}
interface JoinCodeRow {
  id: string;
  org_id: string;
  team_id: string;
  issued_by: string;
  max_uses: number;
  use_count: number;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  issuer_display_name?: string;
  issuer_qualified?: boolean;
}
interface BindingRow {
  id: string;
  org_id: string;
  team_id: string;
  member_id: string;
  user_id: string;
  source: MemberBindingSource;
  status: MemberBindingStatus;
  ended_reason: MemberBindingEndedReason | null;
  created_at: Date;
  ended_at: Date | null;
}
interface ClaimRow {
  id: string;
  org_id: string;
  team_id: string;
  member_id: string;
  target_user_id: string;
  issued_by: string;
  status: TeamMemberClaimStatus;
  expires_at: Date;
  decided_at: Date | null;
  created_at: Date;
}
type MembershipRow = BindingRow & { org_name: string; team_name: string; member_name: string };
type TeamClaimRow = ClaimRow & { member_name: string; target_display_name: string };

const FAILURES_PER_MINUTE = 10;
const MAX_PENDING_REQUESTS_PER_ORG = 3;
const MAX_SUBMISSIONS_PER_LINK = 3;
const MAX_TEAM_MEMBERS = 60;
const iso = (value: Date | null) => value?.toISOString() ?? null;
const conflict = (code: string, message: string) => new ApiError(409, code, message);
function versionCheck(actual: number, expected: number) {
  if (actual !== expected)
    throw new ApiError(409, 'VERSION_CONFLICT', '记录已更新，请重新读取后再操作', {
      currentVersion: actual,
    });
}
const MEMBERSHIP_SELECT = `b.id,b.org_id,b.team_id,b.member_id,b.user_id,b.source,b.status,b.ended_reason,
  b.created_at,b.ended_at,o.name AS org_name,t.name AS team_name,m.name AS member_name`;
const MEMBERSHIP_FROM = `team_member_bindings b JOIN organizations o ON o.id=b.org_id
  JOIN teams t ON t.org_id=b.org_id AND t.id=b.team_id
  JOIN team_members m ON m.org_id=b.org_id AND m.team_id=b.team_id AND m.id=b.member_id`;
// The issuer must still manage the team through a grant or admin membership that has not been
// (re)written since the code or claim was issued (`since`): disabling and later restoring the
// right never revives what was issued before.
const ISSUER_QUALIFIED = (
  org: string,
  team: string,
  user: string,
  since: string,
) => `(${user}.status='ACTIVE' AND (
  EXISTS(SELECT 1 FROM organization_memberships m WHERE m.org_id=${org} AND m.user_id=${user}.id
    AND m.status='ACTIVE' AND m.role IN ('ORG_OWNER','ORG_ADMIN') AND m.updated_at<=${since})
  OR EXISTS(SELECT 1 FROM team_access_grants g WHERE g.org_id=${org} AND g.team_id=${team}
    AND g.user_id=${user}.id AND g.status='ACTIVE' AND g.updated_at<=${since})))`;

/**
 * C19 §3: organization-approved team requests, join codes, player account bindings and
 * historical member claims. Player bindings are kept apart from team_access_grants: nothing
 * here grants management or adds a session team context except an approved team request,
 * which grants the applicant TEAM_MANAGER of exactly the one team it created.
 */
export class TeamMembershipService extends ApplicationService {
  // ---------- shared guards ----------
  private async org(client: PoolClient, actor: Actor, id: string): Promise<OrgContext> {
    const orgId = resourceId(id);
    const found = await client.query<{ name: string }>(
      "SELECT name FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
      [orgId],
    );
    if (!found.rows[0]) throw notFound();
    const membership = await client.query<{ role: OrgRole; status: string }>(
      'SELECT role,status FROM organization_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE',
      [orgId, actor.user.id],
    );
    const role = membership.rows[0]?.status === 'ACTIVE' ? membership.rows[0].role : null;
    return {
      ...actor,
      orgId,
      orgName: found.rows[0].name,
      role,
      admin: role !== null && isAdministrator(role),
    };
  }
  /** Organization OWNER/ADMIN only: non-members see 404, other members 403. */
  private async orgAdmin(client: PoolClient, cookie: string | undefined, org: string) {
    const ctx = await this.org(client, await this.lockActor(client, cookie), org);
    if (ctx.role === null) throw notFound();
    if (!ctx.admin) throw forbidden();
    return ctx;
  }
  /** Team manager: OWNER/ADMIN of the organization or an ACTIVE TEAM_MANAGER grant. */
  private async managedTeam(
    client: PoolClient,
    cookie: string | undefined,
    org: string,
    id: string,
    writing: boolean,
  ): Promise<{ ctx: OrgContext; team: TeamRow }> {
    const ctx = await this.org(client, await this.lockActor(client, cookie), org);
    const found = await client.query<TeamRow>(
      `SELECT id,org_id,name FROM teams WHERE org_id=$1 AND id=$2 FOR ${writing ? 'UPDATE' : 'SHARE'}`,
      [ctx.orgId, resourceId(id)],
    );
    const team = found.rows[0];
    if (!team) throw notFound();
    if (!ctx.admin) {
      const grant = await client.query(
        "SELECT 1 FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
        [ctx.orgId, team.id, ctx.user.id],
      );
      if (!grant.rowCount) throw notFound();
    }
    return { ctx, team };
  }
  /** A join code or claim stays usable only while its issuer can still manage the team. */
  private async issuerQualified(
    client: PoolClient,
    orgId: string,
    teamId: string,
    userId: string,
    issuedAt: Date,
  ) {
    const found = await client.query<{ qualified: boolean }>(
      `SELECT ${ISSUER_QUALIFIED('$1', '$2', 'u', '$4::timestamptz')} AS qualified FROM users u WHERE u.id=$3`,
      [orgId, teamId, userId, issuedAt],
    );
    return found.rows[0]?.qualified === true;
  }
  /** True when `issuedAt` is not after this account's latest ended binding in the team. */
  private async predatesEnd(
    client: PoolClient,
    orgId: string,
    teamId: string,
    userId: string,
    issuedAt: Date,
  ) {
    const ended = await client.query<{ predates: boolean | null }>(
      `SELECT $4::timestamptz <= max(ended_at) AS predates FROM team_member_bindings
       WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ENDED'`,
      [orgId, teamId, userId, issuedAt],
    );
    return ended.rows[0]?.predates === true;
  }
  private async now(client: PoolClient): Promise<Date> {
    return (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
  }
  /**
   * Failure limiter on the shared auth_rate_limits table, per account and per trusted client
   * IP (Express `trust proxy` hops as configured): at most 10 failures a minute. Every attempt
   * atomically reserves a slot before any work, so parallel bursts cannot overrun the limit;
   * the slot is refunded unless the attempt ends in a counted failure.
   */
  private async limitedFailures<T>(
    cookie: string | undefined,
    ip: string,
    scope: string,
    counted: string[],
    work: () => Promise<T>,
  ): Promise<T> {
    const actor = await this.transaction((client) => this.lockActor(client, cookie));
    const keys = [`${scope}-account:${actor.user.id}`, `${scope}-ip:${hashToken(ip)}`];
    // rateLimit() increments atomically first and throws once the window exceeds the maximum.
    for (const key of keys) await this.rateLimit(key, FAILURES_PER_MINUTE, 60);
    let failed = false;
    try {
      return await work();
    } catch (error) {
      failed = error instanceof ApiError && counted.includes(error.code);
      throw error;
    } finally {
      if (!failed) {
        // attempts is CHECKed > 0: a last reserved slot is released by removing the row.
        await this.pool.query(
          "UPDATE auth_rate_limits SET attempts=attempts-1 WHERE key=ANY($1::text[]) AND attempts>1 AND window_start > clock_timestamp()-interval '60 seconds'",
          [keys],
        );
        await this.pool.query(
          "DELETE FROM auth_rate_limits WHERE key=ANY($1::text[]) AND attempts=1 AND window_start > clock_timestamp()-interval '60 seconds'",
          [keys],
        );
      }
    }
  }
  private async teamVersionBump(client: PoolClient, orgId: string, teamId: string) {
    // Long-term member list edits use the team version for CAS; every roster change made
    // here bumps it so a stale member save cannot silently archive a just-joined player.
    await client.query(
      'UPDATE teams SET version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
      [orgId, teamId],
    );
  }

  // ---------- §3.1 share links ----------
  private linkDto(row: LinkRow, now: Date): TeamRequestLinkData {
    return {
      id: row.id,
      orgId: row.org_id,
      status: linkStatus(row, now),
      reason: row.reason,
      maxUses: row.max_uses,
      useCount: row.use_count,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      revokedAt: iso(row.revoked_at),
      revokeReason: row.revoke_reason,
    };
  }
  async createRequestLink(
    cookie: string | undefined,
    org: string,
    body: unknown,
  ): Promise<IssuedTeamRequestLinkData> {
    const input = linkInput(body);
    return this.transaction(async (client) => {
      const ctx = await this.orgAdmin(client, cookie, org);
      await this.ensureFreshSession(client, ctx);
      const token = newLinkToken();
      const id = randomUUID();
      const row = await client.query<LinkRow>(
        `INSERT INTO team_request_links(id,org_id,token_hash,created_by,reason,max_uses,created_at,expires_at)
         SELECT $1,$2,$3,$4,$5,$6,issued,issued+($7::int*interval '1 hour') FROM (SELECT clock_timestamp() AS issued) t
         RETURNING *`,
        [
          id,
          ctx.orgId,
          hashToken(token),
          ctx.user.id,
          input.reason,
          input.maxUses,
          input.expiresInHours,
        ],
      );
      await this.audit(
        client,
        ctx.user.id,
        ctx.orgId,
        'TEAM_REQUEST_LINK_CREATED',
        'team_request_link',
        id,
        { maxUses: input.maxUses, expiresInHours: input.expiresInHours },
      );
      return { link: this.linkDto(row.rows[0]!, await this.now(client)), token };
    });
  }
  async listRequestLinks(cookie: string | undefined, org: string): Promise<TeamRequestLinkData[]> {
    return this.transaction(async (client) => {
      const ctx = await this.orgAdmin(client, cookie, org);
      const rows = await client.query<LinkRow>(
        'SELECT * FROM team_request_links WHERE org_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50',
        [ctx.orgId],
      );
      const now = await this.now(client);
      return rows.rows.map((row) => this.linkDto(row, now));
    });
  }
  async revokeRequestLink(
    cookie: string | undefined,
    org: string,
    linkId: string,
    body: unknown,
  ): Promise<TeamRequestLinkData> {
    const input = revokeLinkInput(body);
    return this.transaction(async (client) => {
      const ctx = await this.orgAdmin(client, cookie, org);
      const found = await client.query<LinkRow>(
        'SELECT * FROM team_request_links WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [ctx.orgId, resourceId(linkId)],
      );
      const link = found.rows[0];
      if (!link) throw notFound();
      if (link.revoked_at) return this.linkDto(link, await this.now(client));
      await this.ensureFreshSession(client, ctx);
      const updated = await client.query<LinkRow>(
        'UPDATE team_request_links SET revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason=$3 WHERE id=$1 RETURNING *',
        [link.id, ctx.user.id, input.reason],
      );
      await this.audit(
        client,
        ctx.user.id,
        ctx.orgId,
        'TEAM_REQUEST_LINK_REVOKED',
        'team_request_link',
        link.id,
      );
      return this.linkDto(updated.rows[0]!, await this.now(client));
    });
  }
  /** A usable link by token hash; its organization must be ACTIVE. */
  private async usableLink(client: PoolClient, token: string, lock: boolean) {
    const lookup = await client.query<LinkRow>(
      'SELECT * FROM team_request_links WHERE token_hash=$1',
      [hashToken(token)],
    );
    const candidate = lookup.rows[0];
    if (!candidate) throw linkInvalid();
    const org = await client.query<{ name: string }>(
      "SELECT name FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
      [candidate.org_id],
    );
    if (!org.rows[0]) throw linkInvalid();
    const link = lock
      ? (
          await client.query<LinkRow>('SELECT * FROM team_request_links WHERE id=$1 FOR UPDATE', [
            candidate.id,
          ])
        ).rows[0]!
      : candidate;
    if (linkStatus(link, await this.now(client)) !== 'ACTIVE') throw linkInvalid();
    return { link, orgName: org.rows[0].name };
  }
  async resolveRequestLink(
    cookie: string | undefined,
    ip: string,
    body: unknown,
  ): Promise<ResolvedTeamRequestLinkData> {
    return this.limitedFailures(cookie, ip, 'team-link', ['TEAM_REQUEST_LINK_INVALID'], () =>
      this.transaction(async (client) => {
        await this.lockActor(client, cookie);
        const input = resolveInput(body);
        const { link, orgName } = await this.usableLink(client, input.token, false);
        return { linkId: link.id, orgName, expiresAt: link.expires_at.toISOString() };
      }),
    );
  }

  // ---------- §3.1 team requests ----------
  private requestDto(row: RequestRow): TeamRequestData {
    return {
      id: row.id,
      clientRequestId: row.client_request_id,
      orgId: row.org_id,
      orgName: row.org_name,
      teamName: row.team_name,
      note: row.note,
      status: row.status,
      version: row.version,
      reviewReason: row.review_reason,
      reviewedAt: iso(row.reviewed_at),
      withdrawnAt: iso(row.withdrawn_at),
      teamId: row.team_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      capabilities: { canWithdraw: row.status === 'PENDING' },
    };
  }
  private orgRequestDto(row: RequestRow, viewerId: string): OrgTeamRequestData {
    const own = row.requester_id === viewerId;
    const dto = this.requestDto(row);
    return {
      id: dto.id,
      orgId: dto.orgId,
      orgName: dto.orgName,
      teamName: dto.teamName,
      note: dto.note,
      status: dto.status,
      version: dto.version,
      reviewReason: dto.reviewReason,
      reviewedAt: dto.reviewedAt,
      withdrawnAt: dto.withdrawnAt,
      teamId: dto.teamId,
      createdAt: dto.createdAt,
      updatedAt: dto.updatedAt,
      requesterDisplayName: row.requester_display_name ?? '',
      capabilities: { canReview: row.status === 'PENDING' && !own, isOwnRequest: own },
    };
  }
  private async readRequest(client: PoolClient, where: string, params: unknown[], lock = '') {
    const found = await client.query<RequestRow>(
      `SELECT r.*,o.name AS org_name,u.display_name AS requester_display_name FROM team_requests r
       JOIN organizations o ON o.id=r.org_id JOIN users u ON u.id=r.requester_id WHERE ${where} ${lock}`,
      params,
    );
    return found.rows[0];
  }
  async submitTeamRequest(
    cookie: string | undefined,
    ip: string,
    body: unknown,
  ): Promise<{ data: TeamRequestData; created: boolean }> {
    const input = submitInput(body);
    const replay = (client: PoolClient, actor: Actor) =>
      this.readRequest(client, 'r.requester_id=$1 AND r.client_request_id=$2', [
        actor.user.id,
        input.clientRequestId,
      ]);
    // A replay compares the stored request with what this attempt would have written; it
    // never consumes the link again and does not need the link to still be usable.
    const same = async (client: PoolClient, row: RequestRow) => {
      const link = await client.query<{ id: string }>(
        'SELECT id FROM team_request_links WHERE token_hash=$1',
        [hashToken(input.token)],
      );
      if (
        link.rows[0]?.id !== row.link_id ||
        row.team_name !== input.teamName ||
        row.note !== input.note
      )
        throw conflict('IDEMPOTENCY_CONFLICT', '同一请求编号已用于不同的申请内容');
      return { data: this.requestDto(row), created: false };
    };
    const attempt = () =>
      this.transaction(async (client) => {
        const actor = await this.lockActor(client, cookie);
        const existing = await replay(client, actor);
        if (existing) return same(client, existing);
        const { link } = await this.usableLink(client, input.token, true);
        // Serialize one requester's submissions to one organization (across links) before
        // counting, so concurrent submissions cannot exceed the pending cap.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `scb-team-request:${link.org_id}:${actor.user.id}`,
        ]);
        // One holder cannot exhaust a shared link: one live submission per link, and at most
        // MAX_SUBMISSIONS_PER_LINK in total including withdrawn ones.
        const mine = await client.query<{ total: number; live: number }>(
          "SELECT count(*)::int AS total,(count(*) FILTER (WHERE status<>'WITHDRAWN'))::int AS live FROM team_requests WHERE link_id=$1 AND requester_id=$2",
          [link.id, actor.user.id],
        );
        if (mine.rows[0]!.live > 0)
          throw conflict(
            'TEAM_REQUEST_LINK_ALREADY_USED',
            '你已通过该入口提交过申请；如需修改请先撤回原申请',
          );
        if (mine.rows[0]!.total >= MAX_SUBMISSIONS_PER_LINK)
          throw conflict(
            'TEAM_REQUEST_LINK_SUBMISSION_LIMIT',
            '你通过该入口提交的次数已达上限，请向机构索取新的入口',
          );
        const pending = await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM team_requests WHERE org_id=$1 AND requester_id=$2 AND status='PENDING'",
          [link.org_id, actor.user.id],
        );
        if (pending.rows[0]!.count >= MAX_PENDING_REQUESTS_PER_ORG)
          throw new ApiError(
            422,
            'TOO_MANY_PENDING_REQUESTS',
            '你在该机构已有3份待审核申请，请等待审核或撤回后再提交',
          );
        await this.ensureFreshSession(client, actor);
        const used = await client.query(
          'UPDATE team_request_links SET use_count=use_count+1 WHERE id=$1 AND use_count<max_uses AND revoked_at IS NULL AND expires_at>clock_timestamp()',
          [link.id],
        );
        if (!used.rowCount) throw linkInvalid();
        const id = randomUUID();
        await client.query(
          `INSERT INTO team_requests(id,org_id,link_id,requester_id,client_request_id,team_name,note)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            id,
            link.org_id,
            link.id,
            actor.user.id,
            input.clientRequestId,
            input.teamName,
            input.note,
          ],
        );
        await this.audit(
          client,
          actor.user.id,
          link.org_id,
          'TEAM_REQUEST_SUBMITTED',
          'team_request',
          id,
          { linkId: link.id },
        );
        return { data: this.requestDto((await replay(client, actor))!), created: true };
      });
    return this.limitedFailures(
      cookie,
      ip,
      'team-link',
      ['TEAM_REQUEST_LINK_INVALID'],
      async () => {
        try {
          return await attempt();
        } catch (error) {
          // A concurrent duplicate committed first; this transaction is gone, so read afresh.
          if ((error as { code?: string }).code === '23505')
            return this.transaction(async (client) => {
              const actor = await this.lockActor(client, cookie);
              const existing = await replay(client, actor);
              if (!existing) throw error;
              return same(client, existing);
            });
          throw error;
        }
      },
    );
  }
  async myTeamRequests(cookie: string | undefined): Promise<TeamRequestData[]> {
    return this.transaction(async (client) => {
      const actor = await this.lockActor(client, cookie);
      const rows = await client.query<RequestRow>(
        `SELECT r.*,o.name AS org_name FROM team_requests r JOIN organizations o ON o.id=r.org_id
         WHERE r.requester_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 50`,
        [actor.user.id],
      );
      return rows.rows.map((row) => this.requestDto(row));
    });
  }
  async withdrawTeamRequest(
    cookie: string | undefined,
    requestId: string,
    body: unknown,
  ): Promise<TeamRequestData> {
    const input = withdrawInput(body);
    const id = resourceId(requestId);
    return this.transaction(async (client) => {
      const actor = await this.lockActor(client, cookie);
      const row = await this.readRequest(
        client,
        'r.id=$1 AND r.requester_id=$2',
        [id, actor.user.id],
        'FOR UPDATE OF r',
      );
      if (!row) throw notFound();
      versionCheck(row.version, input.expectedVersion);
      if (row.status !== 'PENDING') throw conflict('TEAM_REQUEST_CLOSED', '申请已处理，不能撤回');
      await this.ensureFreshSession(client, actor);
      await client.query(
        "UPDATE team_requests SET status='WITHDRAWN',withdrawn_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [row.id],
      );
      await this.audit(
        client,
        actor.user.id,
        row.org_id,
        'TEAM_REQUEST_WITHDRAWN',
        'team_request',
        row.id,
      );
      return this.requestDto((await this.readRequest(client, 'r.id=$1', [row.id]))!);
    });
  }
  async orgTeamRequests(
    cookie: string | undefined,
    org: string,
    query: unknown,
  ): Promise<OrgTeamRequestData[]> {
    const status = statusFilter(query);
    return this.transaction(async (client) => {
      const ctx = await this.orgAdmin(client, cookie, org);
      const rows = await client.query<RequestRow>(
        `SELECT r.*,o.name AS org_name,u.display_name AS requester_display_name FROM team_requests r
         JOIN organizations o ON o.id=r.org_id JOIN users u ON u.id=r.requester_id
         WHERE r.org_id=$1 AND ($2::text IS NULL OR r.status=$2)
         ORDER BY r.created_at DESC,r.id DESC LIMIT 100`,
        [ctx.orgId, status],
      );
      return rows.rows.map((row) => this.orgRequestDto(row, ctx.user.id));
    });
  }
  async reviewTeamRequest(
    cookie: string | undefined,
    org: string,
    requestId: string,
    body: unknown,
  ): Promise<OrgTeamRequestData> {
    const input = reviewInput(body);
    const id = resourceId(requestId);
    return this.transaction(async (client) => {
      const ctx = await this.orgAdmin(client, cookie, org);
      const row = await this.readRequest(
        client,
        'r.org_id=$1 AND r.id=$2',
        [ctx.orgId, id],
        'FOR UPDATE OF r',
      );
      if (!row) throw notFound();
      if (row.requester_id === ctx.user.id)
        throw new ApiError(403, 'REVIEWER_IS_REQUESTER', '不能审核自己提交的建队申请');
      versionCheck(row.version, input.expectedVersion);
      if (row.status !== 'PENDING') throw conflict('TEAM_REQUEST_CLOSED', '申请已处理');
      await this.ensureFreshSession(client, ctx);
      if (input.decision === 'REJECT') {
        await client.query(
          `UPDATE team_requests SET status='REJECTED',reviewer_id=$2,review_reason=$3,reviewed_at=clock_timestamp(),
           version=version+1,updated_at=clock_timestamp() WHERE id=$1`,
          [row.id, ctx.user.id, input.reason],
        );
        await this.audit(
          client,
          ctx.user.id,
          ctx.orgId,
          'TEAM_REQUEST_REJECTED',
          'team_request',
          row.id,
        );
      } else {
        const requester = await client.query(
          "SELECT 1 FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE",
          [row.requester_id],
        );
        if (!requester.rowCount)
          throw new ApiError(422, 'REQUESTER_INACTIVE', '申请人账号当前不可用，不能批准');
        // One transaction: the team, the applicant's TEAM_MANAGER grant, the result and audit.
        // No organization membership or event staff role is created.
        const teamId = randomUUID();
        await client.query('INSERT INTO teams(id,org_id,name) VALUES($1,$2,$3)', [
          teamId,
          ctx.orgId,
          row.team_name,
        ]);
        await client.query(
          "INSERT INTO team_access_grants(org_id,team_id,user_id,role,status) VALUES($1,$2,$3,'TEAM_MANAGER','ACTIVE')",
          [ctx.orgId, teamId, row.requester_id],
        );
        await client.query(
          `UPDATE team_requests SET status='APPROVED',team_id=$2,reviewer_id=$3,review_reason=$4,reviewed_at=clock_timestamp(),
           version=version+1,updated_at=clock_timestamp() WHERE id=$1`,
          [row.id, teamId, ctx.user.id, input.reason],
        );
        await this.audit(client, ctx.user.id, ctx.orgId, 'TEAM_CREATED', 'team', teamId, {
          teamRequestId: row.id,
        });
        await this.audit(
          client,
          ctx.user.id,
          ctx.orgId,
          'TEAM_REQUEST_APPROVED',
          'team_request',
          row.id,
          { teamId, grantedUserId: row.requester_id },
        );
      }
      return this.orgRequestDto(
        (await this.readRequest(client, 'r.id=$1', [row.id]))!,
        ctx.user.id,
      );
    });
  }

  // ---------- §3.2 join codes ----------
  private async joinCodes(client: PoolClient, orgId: string, teamId: string, id?: string) {
    const rows = await client.query<JoinCodeRow>(
      `SELECT c.*,u.display_name AS issuer_display_name,
        ${ISSUER_QUALIFIED('c.org_id', 'c.team_id', 'u', 'c.created_at')} AS issuer_qualified
       FROM team_join_codes c JOIN users u ON u.id=c.issued_by
       WHERE c.org_id=$1 AND c.team_id=$2 AND ($3::uuid IS NULL OR c.id=$3)
       ORDER BY c.created_at DESC,c.id DESC LIMIT 50`,
      [orgId, teamId, id ?? null],
    );
    const now = await this.now(client);
    return rows.rows.map((row): TeamJoinCodeData => ({
      id: row.id,
      teamId: row.team_id,
      status: joinCodeStatus(row, now, row.issuer_qualified === true),
      maxUses: row.max_uses,
      useCount: row.use_count,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      revokedAt: iso(row.revoked_at),
      issuedByDisplayName: row.issuer_display_name ?? '',
    }));
  }
  async createJoinCode(
    cookie: string | undefined,
    org: string,
    teamId: string,
    body: unknown,
  ): Promise<IssuedTeamJoinCodeData> {
    const input = joinCodeInput(body);
    return this.transaction(async (client) => {
      const { ctx, team } = await this.managedTeam(client, cookie, org, teamId, true);
      await this.ensureFreshSession(client, ctx);
      const code = newJoinCode();
      const id = randomUUID();
      await client.query(
        `INSERT INTO team_join_codes(id,org_id,team_id,code_hash,issued_by,max_uses,created_at,expires_at)
         SELECT $1,$2,$3,$4,$5,$6,issued,issued+($7::int*interval '1 hour') FROM (SELECT clock_timestamp() AS issued) t`,
        [id, ctx.orgId, team.id, hashToken(code), ctx.user.id, input.maxUses, input.expiresInHours],
      );
      await this.audit(client, ctx.user.id, ctx.orgId, 'TEAM_JOIN_CODE_CREATED', 'team', team.id, {
        joinCodeId: id,
        maxUses: input.maxUses,
        expiresInHours: input.expiresInHours,
      });
      return { joinCode: (await this.joinCodes(client, ctx.orgId, team.id, id))[0]!, code };
    });
  }
  async listJoinCodes(
    cookie: string | undefined,
    org: string,
    teamId: string,
  ): Promise<TeamJoinCodeData[]> {
    return this.transaction(async (client) => {
      const { ctx, team } = await this.managedTeam(client, cookie, org, teamId, false);
      return this.joinCodes(client, ctx.orgId, team.id);
    });
  }
  async revokeJoinCode(
    cookie: string | undefined,
    org: string,
    teamId: string,
    codeId: string,
    body: unknown,
  ): Promise<TeamJoinCodeData> {
    emptyInput(body);
    return this.transaction(async (client) => {
      const { ctx, team } = await this.managedTeam(client, cookie, org, teamId, true);
      const found = await client.query<JoinCodeRow>(
        'SELECT * FROM team_join_codes WHERE org_id=$1 AND team_id=$2 AND id=$3 FOR UPDATE',
        [ctx.orgId, team.id, resourceId(codeId)],
      );
      const code = found.rows[0];
      if (!code) throw notFound();
      if (!code.revoked_at) {
        await this.ensureFreshSession(client, ctx);
        await client.query(
          'UPDATE team_join_codes SET revoked_at=clock_timestamp(),revoked_by=$2 WHERE id=$1',
          [code.id, ctx.user.id],
        );
        await this.audit(
          client,
          ctx.user.id,
          ctx.orgId,
          'TEAM_JOIN_CODE_REVOKED',
          'team',
          team.id,
          { joinCodeId: code.id },
        );
      }
      return (await this.joinCodes(client, ctx.orgId, team.id, code.id))[0]!;
    });
  }

  // ---------- §3.2 joining and own memberships ----------
  private membershipDto(row: MembershipRow): MembershipData {
    return {
      bindingId: row.id,
      orgId: row.org_id,
      organizationName: row.org_name,
      teamId: row.team_id,
      teamName: row.team_name,
      memberId: row.member_id,
      memberName: row.member_name,
      source: row.source,
      status: row.status,
      endedReason: row.ended_reason,
      createdAt: row.created_at.toISOString(),
      endedAt: iso(row.ended_at),
    };
  }
  private async membership(client: PoolClient, bindingId: string) {
    const found = await client.query<MembershipRow>(
      `SELECT ${MEMBERSHIP_SELECT} FROM ${MEMBERSHIP_FROM} WHERE b.id=$1`,
      [bindingId],
    );
    return this.membershipDto(found.rows[0]!);
  }
  private async activeBinding(client: PoolClient, orgId: string, teamId: string, userId: string) {
    return (
      await client.query<{ id: string }>(
        "SELECT id FROM team_member_bindings WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE'",
        [orgId, teamId, userId],
      )
    ).rows[0];
  }
  /** Lock order for every binding writer: organization, then the team row, then module rows. */
  private async lockTeamOf(client: PoolClient, orgId: string, teamId: string) {
    const org = await client.query(
      "SELECT 1 FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
      [orgId],
    );
    if (!org.rowCount) return false;
    const team = await client.query('SELECT 1 FROM teams WHERE org_id=$1 AND id=$2 FOR UPDATE', [
      orgId,
      teamId,
    ]);
    return Boolean(team.rowCount);
  }
  async joinTeam(
    cookie: string | undefined,
    ip: string,
    body: unknown,
  ): Promise<{ data: MembershipData; created: boolean }> {
    return this.limitedFailures(
      cookie,
      ip,
      'team-join',
      ['JOIN_CODE_INVALID', 'JOIN_CODE_PREDATES_REMOVAL'],
      async () => {
        const input = joinInput(body);
        return this.transaction(async (client) => {
          const actor = await this.lockActor(client, cookie);
          const lookup = await client.query<JoinCodeRow>(
            'SELECT * FROM team_join_codes WHERE code_hash=$1',
            [hashToken(input.code)],
          );
          const candidate = lookup.rows[0];
          if (!candidate || !(await this.lockTeamOf(client, candidate.org_id, candidate.team_id)))
            throw joinCodeInvalid();
          const code = (
            await client.query<JoinCodeRow>(
              'SELECT * FROM team_join_codes WHERE id=$1 FOR UPDATE',
              [candidate.id],
            )
          ).rows[0]!;
          const { org_id: orgId, team_id: teamId } = code;
          // A repeated join returns the original binding and never consumes another use.
          const existing = await this.activeBinding(client, orgId, teamId, actor.user.id);
          if (existing) {
            await this.ensureFreshSession(client, actor);
            return { data: await this.membership(client, existing.id), created: false };
          }
          if (
            linkStatus(code, await this.now(client)) !== 'ACTIVE' ||
            !(await this.issuerQualified(client, orgId, teamId, code.issued_by, code.created_at))
          )
            throw joinCodeInvalid();
          // Leaving or removal invalidates every code issued before it for this account.
          if (await this.predatesEnd(client, orgId, teamId, actor.user.id, code.created_at))
            throw new ApiError(
              422,
              'JOIN_CODE_PREDATES_REMOVAL',
              '该加入码签发于你上次离队之前，请向领队索取新的加入码',
            );
          const size = await client.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM team_members WHERE org_id=$1 AND team_id=$2 AND status='ACTIVE'",
            [orgId, teamId],
          );
          if (size.rows[0]!.count >= MAX_TEAM_MEMBERS)
            throw new ApiError(422, 'TEAM_FULL', '球队长期成员已满60人');
          await this.ensureFreshSession(client, actor);
          const used = await client.query(
            'UPDATE team_join_codes SET use_count=use_count+1 WHERE id=$1 AND use_count<max_uses AND revoked_at IS NULL AND expires_at>clock_timestamp()',
            [code.id],
          );
          if (!used.rowCount) throw joinCodeInvalid();
          // Normal joining always creates a new member; it never matches an old one by name.
          const memberId = randomUUID();
          const bindingId = randomUUID();
          await client.query(
            'INSERT INTO team_members(id,org_id,team_id,name) VALUES($1,$2,$3,$4)',
            [memberId, orgId, teamId, input.displayName],
          );
          await client.query(
            `INSERT INTO team_member_bindings(id,org_id,team_id,member_id,user_id,source,join_code_id)
             VALUES($1,$2,$3,$4,$5,'JOIN_CODE',$6)`,
            [bindingId, orgId, teamId, memberId, actor.user.id, code.id],
          );
          await this.teamVersionBump(client, orgId, teamId);
          await this.audit(client, actor.user.id, orgId, 'TEAM_MEMBER_JOINED', 'team', teamId, {
            bindingId,
            memberId,
            joinCodeId: code.id,
          });
          return { data: await this.membership(client, bindingId), created: true };
        });
      },
    );
  }
  async myMemberships(cookie: string | undefined): Promise<MembershipData[]> {
    return this.transaction(async (client) => {
      const actor = await this.lockActor(client, cookie);
      const rows = await client.query<MembershipRow>(
        `SELECT ${MEMBERSHIP_SELECT} FROM ${MEMBERSHIP_FROM}
         WHERE b.user_id=$1 AND o.status='ACTIVE'
         ORDER BY (b.status='ACTIVE') DESC,b.created_at DESC,b.id DESC LIMIT 100`,
        [actor.user.id],
      );
      return rows.rows.map((row) => this.membershipDto(row));
    });
  }
  async membershipTeam(cookie: string | undefined, bindingId: string): Promise<MembershipTeamData> {
    const id = resourceId(bindingId);
    return this.transaction(async (client) => {
      const actor = await this.lockActor(client, cookie);
      const found = await client.query<MembershipRow>(
        `SELECT ${MEMBERSHIP_SELECT} FROM ${MEMBERSHIP_FROM}
         WHERE b.id=$1 AND b.user_id=$2 AND b.status='ACTIVE' AND o.status='ACTIVE'`,
        [id, actor.user.id],
      );
      const row = found.rows[0];
      if (!row) throw notFound();
      const members = await client.query<{ id: string; name: string }>(
        "SELECT id,name FROM team_members WHERE org_id=$1 AND team_id=$2 AND status='ACTIVE' ORDER BY created_at,id",
        [row.org_id, row.team_id],
      );
      return {
        bindingId: row.id,
        organizationName: row.org_name,
        teamName: row.team_name,
        members: members.rows.map((m) => ({
          memberId: m.id,
          name: m.name,
          isSelf: m.id === row.member_id,
        })),
        myBinding: this.membershipDto(row),
      };
    });
  }
  /** End a binding and take its member off the long-term list, in one transaction. */
  private async endBinding(
    client: PoolClient,
    actor: Actor,
    binding: BindingRow,
    reason: 'LEFT' | 'REMOVED',
    note: string | null,
  ) {
    await this.ensureFreshSession(client, actor);
    await client.query(
      "UPDATE team_member_bindings SET status='ENDED',ended_reason=$2,ended_by=$3,end_note=$4,ended_at=clock_timestamp() WHERE id=$1",
      [binding.id, reason, actor.user.id, note],
    );
    await client.query(
      "UPDATE team_members SET status='ARCHIVED',updated_at=clock_timestamp() WHERE org_id=$1 AND team_id=$2 AND id=$3 AND status='ACTIVE'",
      [binding.org_id, binding.team_id, binding.member_id],
    );
    await client.query(
      // Pending claims on the member and every pending claim addressed to this account in
      // the team: a removed or departed player needs a new authorization to come back.
      `UPDATE team_member_claims SET status='REVOKED',decided_at=clock_timestamp()
       WHERE status='PENDING' AND (member_id=$1 OR (org_id=$2 AND team_id=$3 AND target_user_id=$4))`,
      [binding.member_id, binding.org_id, binding.team_id, binding.user_id],
    );
    await this.teamVersionBump(client, binding.org_id, binding.team_id);
    await this.audit(
      client,
      actor.user.id,
      binding.org_id,
      reason === 'LEFT' ? 'TEAM_MEMBER_LEFT' : 'TEAM_MEMBER_REMOVED',
      'team',
      binding.team_id,
      { bindingId: binding.id, memberId: binding.member_id },
    );
  }
  async leaveMembership(
    cookie: string | undefined,
    bindingId: string,
    body: unknown,
  ): Promise<MembershipData> {
    emptyInput(body);
    const id = resourceId(bindingId);
    return this.transaction(async (client) => {
      const actor = await this.lockActor(client, cookie);
      const lookup = await client.query<BindingRow>(
        'SELECT * FROM team_member_bindings WHERE id=$1 AND user_id=$2',
        [id, actor.user.id],
      );
      const candidate = lookup.rows[0];
      if (!candidate) throw notFound();
      await client.query('SELECT 1 FROM teams WHERE org_id=$1 AND id=$2 FOR UPDATE', [
        candidate.org_id,
        candidate.team_id,
      ]);
      const binding = (
        await client.query<BindingRow>(
          'SELECT * FROM team_member_bindings WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0]!;
      if (binding.status === 'ACTIVE') await this.endBinding(client, actor, binding, 'LEFT', null);
      return this.membership(client, binding.id);
    });
  }

  // ---------- §3.2 leader view: bindings and claims ----------
  private async teamClaims(client: PoolClient, orgId: string, teamId: string, id?: string) {
    const rows = await client.query<TeamClaimRow>(
      `SELECT c.*,m.name AS member_name,u.display_name AS target_display_name FROM team_member_claims c
       JOIN team_members m ON m.org_id=c.org_id AND m.team_id=c.team_id AND m.id=c.member_id
       JOIN users u ON u.id=c.target_user_id
       WHERE c.org_id=$1 AND c.team_id=$2 AND ($3::uuid IS NULL OR c.id=$3)
       ORDER BY c.created_at DESC,c.id DESC LIMIT 50`,
      [orgId, teamId, id ?? null],
    );
    const now = await this.now(client);
    return rows.rows.map((row): TeamMemberClaimData => ({
      claimId: row.id,
      memberId: row.member_id,
      memberName: row.member_name,
      targetDisplayName: row.target_display_name,
      status: claimStatus(row, now),
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      decidedAt: iso(row.decided_at),
    }));
  }
  async memberBindings(
    cookie: string | undefined,
    org: string,
    teamId: string,
  ): Promise<TeamMemberBindingsData> {
    return this.transaction(async (client) => {
      const { ctx, team } = await this.managedTeam(client, cookie, org, teamId, false);
      const bindings = await client.query<
        BindingRow & { member_name: string; account_display_name: string }
      >(
        `SELECT b.*,m.name AS member_name,u.display_name AS account_display_name FROM team_member_bindings b
         JOIN team_members m ON m.org_id=b.org_id AND m.team_id=b.team_id AND m.id=b.member_id
         JOIN users u ON u.id=b.user_id
         WHERE b.org_id=$1 AND b.team_id=$2
         ORDER BY (b.status='ACTIVE') DESC,b.created_at DESC,b.id DESC LIMIT 100`,
        [ctx.orgId, team.id],
      );
      const claimable = await client.query<{ id: string; name: string }>(
        `SELECT m.id,m.name FROM team_members m WHERE m.org_id=$1 AND m.team_id=$2 AND m.status='ACTIVE'
         AND NOT EXISTS(SELECT 1 FROM team_member_bindings b WHERE b.member_id=m.id AND b.status='ACTIVE')
         AND NOT EXISTS(SELECT 1 FROM team_member_claims c WHERE c.member_id=m.id AND c.status='PENDING' AND c.expires_at>clock_timestamp())
         ORDER BY m.created_at,m.id`,
        [ctx.orgId, team.id],
      );
      return {
        teamId: team.id,
        teamName: team.name,
        bindings: bindings.rows.map((row): TeamMemberBindingData => ({
          bindingId: row.id,
          memberId: row.member_id,
          memberName: row.member_name,
          accountDisplayName: row.account_display_name,
          source: row.source,
          status: row.status,
          endedReason: row.ended_reason,
          createdAt: row.created_at.toISOString(),
          endedAt: iso(row.ended_at),
        })),
        claims: await this.teamClaims(client, ctx.orgId, team.id),
        claimableMembers: claimable.rows.map((m) => ({ memberId: m.id, name: m.name })),
      };
    });
  }
  async removeBinding(
    cookie: string | undefined,
    org: string,
    teamId: string,
    bindingId: string,
    body: unknown,
  ): Promise<TeamMemberBindingsData> {
    const reason = reasonInput(objectInput(body, ['reason']).reason);
    await this.transaction(async (client) => {
      const { ctx, team } = await this.managedTeam(client, cookie, org, teamId, true);
      const found = await client.query<BindingRow>(
        'SELECT * FROM team_member_bindings WHERE org_id=$1 AND team_id=$2 AND id=$3 FOR UPDATE',
        [ctx.orgId, team.id, resourceId(bindingId)],
      );
      const binding = found.rows[0];
      if (!binding) throw notFound();
      if (binding.status === 'ACTIVE')
        await this.endBinding(client, ctx, binding, 'REMOVED', reason);
    });
    return this.memberBindings(cookie, org, teamId);
  }
  /** Claim preconditions on a locked team: the exact member, no takeover, no duplicate. */
  private async claimable(
    client: PoolClient,
    orgId: string,
    teamId: string,
    memberId: string,
    userId: string,
  ) {
    const member = await client.query<{ status: string }>(
      'SELECT status FROM team_members WHERE org_id=$1 AND team_id=$2 AND id=$3 FOR UPDATE',
      [orgId, teamId, memberId],
    );
    if (!member.rows[0]) throw notFound();
    if (member.rows[0].status !== 'ACTIVE')
      throw conflict('MEMBER_NOT_ACTIVE', '该成员已不在长期名单中');
    const history = await client.query<{ user_id: string; status: string }>(
      'SELECT user_id,status FROM team_member_bindings WHERE member_id=$1',
      [memberId],
    );
    if (history.rows.some((b) => b.status === 'ACTIVE'))
      throw conflict('MEMBER_ALREADY_BOUND', '该成员已绑定账号，不能覆盖');
    if (history.rows.some((b) => b.user_id !== userId))
      throw conflict(
        'MEMBER_BOUND_TO_OTHER_ACCOUNT',
        '该成员曾绑定其他账号，不能转交给另一个账号；新球员请使用加入码加入',
      );
    if (await this.activeBinding(client, orgId, teamId, userId))
      throw conflict('ACCOUNT_ALREADY_BOUND', '该账号已是本队成员');
  }
  async createClaim(
    cookie: string | undefined,
    org: string,
    teamId: string,
    memberId: string,
    body: unknown,
  ): Promise<TeamMemberClaimData> {
    const input = claimInput(body);
    const member = resourceId(memberId);
    return this.transaction(async (client) => {
      const { ctx, team } = await this.managedTeam(client, cookie, org, teamId, true);
      const target = await client.query(
        "SELECT 1 FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE",
        [input.targetUserId],
      );
      if (!target.rowCount) throw notFound();
      await this.claimable(client, ctx.orgId, team.id, member, input.targetUserId);
      await client.query(
        "UPDATE team_member_claims SET status='EXPIRED',decided_at=expires_at WHERE member_id=$1 AND status='PENDING' AND expires_at<=clock_timestamp()",
        [member],
      );
      const pending = await client.query(
        "SELECT 1 FROM team_member_claims WHERE member_id=$1 AND status='PENDING'",
        [member],
      );
      if (pending.rowCount) throw conflict('CLAIM_PENDING', '该成员已有待接受的认领，请先撤销');
      await this.ensureFreshSession(client, ctx);
      const id = randomUUID();
      await client.query(
        `INSERT INTO team_member_claims(id,org_id,team_id,member_id,target_user_id,issued_by,created_at,expires_at)
         SELECT $1,$2,$3,$4,$5,$6,issued,issued+interval '168 hours' FROM (SELECT clock_timestamp() AS issued) t`,
        [id, ctx.orgId, team.id, member, input.targetUserId, ctx.user.id],
      );
      await this.audit(
        client,
        ctx.user.id,
        ctx.orgId,
        'TEAM_MEMBER_CLAIM_CREATED',
        'team',
        team.id,
        { claimId: id, memberId: member, targetUserId: input.targetUserId },
      );
      return (await this.teamClaims(client, ctx.orgId, team.id, id))[0]!;
    });
  }
  async revokeClaim(
    cookie: string | undefined,
    org: string,
    teamId: string,
    claimId: string,
    body: unknown,
  ): Promise<TeamMemberClaimData> {
    emptyInput(body);
    return this.transaction(async (client) => {
      const { ctx, team } = await this.managedTeam(client, cookie, org, teamId, true);
      const found = await client.query<ClaimRow>(
        'SELECT * FROM team_member_claims WHERE org_id=$1 AND team_id=$2 AND id=$3 FOR UPDATE',
        [ctx.orgId, team.id, resourceId(claimId)],
      );
      const claim = found.rows[0];
      if (!claim) throw notFound();
      const status = claimStatus(claim, await this.now(client));
      if (status === 'PENDING') {
        await this.ensureFreshSession(client, ctx);
        await client.query(
          "UPDATE team_member_claims SET status='REVOKED',decided_at=clock_timestamp() WHERE id=$1",
          [claim.id],
        );
        await this.audit(
          client,
          ctx.user.id,
          ctx.orgId,
          'TEAM_MEMBER_CLAIM_REVOKED',
          'team',
          team.id,
          { claimId: claim.id },
        );
      } else if (status !== 'REVOKED') throw conflict('CLAIM_CLOSED', '认领已处理或已过期');
      return (await this.teamClaims(client, ctx.orgId, team.id, claim.id))[0]!;
    });
  }

  // ---------- §3.2 target account: claims ----------
  private async myClaimRows(client: PoolClient, userId: string, id?: string) {
    const rows = await client.query<
      ClaimRow & { org_name: string; team_name: string; member_name: string }
    >(
      `SELECT c.*,o.name AS org_name,t.name AS team_name,m.name AS member_name FROM team_member_claims c
       JOIN organizations o ON o.id=c.org_id JOIN teams t ON t.org_id=c.org_id AND t.id=c.team_id
       JOIN team_members m ON m.org_id=c.org_id AND m.team_id=c.team_id AND m.id=c.member_id
       WHERE c.target_user_id=$1 AND o.status='ACTIVE' AND ($2::uuid IS NULL OR c.id=$2)
       ORDER BY c.created_at DESC,c.id DESC LIMIT 50`,
      [userId, id ?? null],
    );
    const now = await this.now(client);
    return rows.rows.map((row): MyMemberClaimData => ({
      claimId: row.id,
      organizationName: row.org_name,
      teamName: row.team_name,
      memberName: row.member_name,
      status: claimStatus(row, now),
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      decidedAt: iso(row.decided_at),
    }));
  }
  async myClaims(cookie: string | undefined): Promise<MyMemberClaimData[]> {
    return this.transaction(async (client) => {
      const actor = await this.lockActor(client, cookie);
      return this.myClaimRows(client, actor.user.id);
    });
  }
  async decideClaim(
    cookie: string | undefined,
    claimId: string,
    decision: 'accept' | 'decline',
    body: unknown,
  ): Promise<{ claim: MyMemberClaimData; membership: MembershipData | null }> {
    emptyInput(body);
    const id = resourceId(claimId);
    return this.transaction(async (client) => {
      const actor = await this.lockActor(client, cookie);
      const lookup = await client.query<ClaimRow>(
        'SELECT * FROM team_member_claims WHERE id=$1 AND target_user_id=$2',
        [id, actor.user.id],
      );
      const candidate = lookup.rows[0];
      if (!candidate || !(await this.lockTeamOf(client, candidate.org_id, candidate.team_id)))
        throw notFound();
      const claim = (
        await client.query<ClaimRow>('SELECT * FROM team_member_claims WHERE id=$1 FOR UPDATE', [
          id,
        ])
      ).rows[0]!;
      const status = claimStatus(claim, await this.now(client));
      const result = async (bindingId: string | null) => ({
        claim: (await this.myClaimRows(client, actor.user.id, claim.id))[0]!,
        membership: bindingId ? await this.membership(client, bindingId) : null,
      });
      // A replay of the same decision returns the recorded outcome.
      if (decision === 'decline' && status === 'DECLINED') return result(null);
      if (decision === 'accept' && status === 'ACCEPTED') {
        const binding = await client.query<{ id: string }>(
          'SELECT id FROM team_member_bindings WHERE claim_id=$1',
          [claim.id],
        );
        return result(binding.rows[0]?.id ?? null);
      }
      if (status !== 'PENDING') throw conflict('CLAIM_CLOSED', '认领已撤销、已过期或已处理');
      if (decision === 'decline') {
        await this.ensureFreshSession(client, actor);
        await client.query(
          "UPDATE team_member_claims SET status='DECLINED',decided_at=clock_timestamp() WHERE id=$1",
          [claim.id],
        );
        await this.audit(
          client,
          actor.user.id,
          claim.org_id,
          'TEAM_MEMBER_CLAIM_DECLINED',
          'team',
          claim.team_id,
          { claimId: claim.id },
        );
        return result(null);
      }
      // Leaving or removal invalidates every claim issued before it for this account.
      if (
        await this.predatesEnd(client, claim.org_id, claim.team_id, actor.user.id, claim.created_at)
      )
        throw new ApiError(
          422,
          'CLAIM_PREDATES_REMOVAL',
          '该认领发起于你上次离队之前，请联系领队重新发起',
        );
      if (
        !(await this.issuerQualified(
          client,
          claim.org_id,
          claim.team_id,
          claim.issued_by,
          claim.created_at,
        ))
      )
        throw new ApiError(
          422,
          'CLAIM_INVALID',
          '发起认领的管理者已失去本队管理权限，请联系球队重新发起',
        );
      await this.claimable(client, claim.org_id, claim.team_id, claim.member_id, actor.user.id);
      await this.ensureFreshSession(client, actor);
      const bindingId = randomUUID();
      await client.query(
        `INSERT INTO team_member_bindings(id,org_id,team_id,member_id,user_id,source,claim_id)
         VALUES($1,$2,$3,$4,$5,'CLAIM',$6)`,
        [bindingId, claim.org_id, claim.team_id, claim.member_id, actor.user.id, claim.id],
      );
      await client.query(
        "UPDATE team_member_claims SET status='ACCEPTED',decided_at=clock_timestamp() WHERE id=$1",
        [claim.id],
      );
      await this.audit(
        client,
        actor.user.id,
        claim.org_id,
        'TEAM_MEMBER_CLAIM_ACCEPTED',
        'team',
        claim.team_id,
        { claimId: claim.id, bindingId, memberId: claim.member_id },
      );
      return result(bindingId);
    });
  }
}
