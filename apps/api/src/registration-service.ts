import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  EntryCommandType,
  EntryData,
  EntryRosterPlayer,
  EntryStatus,
  EntrySummary,
  EventRegistrationData,
  EventRulesetData,
  FrozenEntryData,
  InvitationData,
  IssuedInvitationData,
  OrgRole,
  RegistrationCounts,
  RegistrationFreezeData,
  SessionData,
  StaffRole,
  TeamContext,
  TeamData,
  TeamGrantData,
  TeamRegistrationEventData,
} from '@small-city-basketball/contracts';
import { ApiError, forbidden, notFound } from './errors.js';
import { ApplicationService, EVENT_SELECT, isAdministrator } from './service.js';
import type { Actor, EventRow } from './service.js';
import { hashPassword, hashToken, newSessionToken } from './security.js';
import {
  calendarDate,
  emailInput,
  invalid,
  objectInput,
  passwordInput,
  resourceId,
  text,
} from './validation.js';
import {
  assertJerseyNumbers,
  entryCommandInput,
  expectedVersion,
  pageInput,
  registrationCommandInput,
  rosterInput,
  rulesInput,
  teamInput,
  teamMembersInput,
} from './registration-validation.js';
import type { PageInput } from './registration-validation.js';

interface Context extends Actor {
  orgId: string;
  organizationName: string;
  role: OrgRole | null;
}
interface TeamRow {
  id: string;
  org_id: string;
  name: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  cursor_created_at: string;
}
interface RegistrationEvent extends EventRow {
  cursor_created_at: string;
  current_ruleset_id: string | null;
  locked_ruleset_id: string | null;
}
interface EntryRow {
  id: string;
  org_id: string;
  event_id: string;
  team_id: string;
  team_name: string;
  status: EntryStatus;
  version: number;
  ruleset_id: string;
  roster_revision_id: string | null;
  last_submitted_by: string | null;
  latest_review_reason: string | null;
  created_at: Date;
  updated_at: Date;
  cursor_created_at: string;
}
interface InvitationRow {
  id: string;
  org_id: string;
  team_id: string;
  target_user_id: string;
  issuer_user_id: string;
  purpose: 'TEAM_MANAGER';
  token_hash: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  cursor_created_at: string;
}
interface EventAccess {
  row: RegistrationEvent;
  staffRole: StaffRole | null;
  canRead: boolean;
  canManage: boolean;
  canReview: boolean;
  frozen: boolean;
}
interface EntryAccess {
  ctx: Context;
  event: EventAccess;
  team: TeamRow;
  leader: boolean;
  entry: EntryRow;
}
const cursorTime = (alias: string) =>
  `to_char(${alias}.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`;
const versionCheck = (actual: number, expected: number) => {
  if (actual !== expected)
    throw new ApiError(409, 'VERSION_CONFLICT', '资料已更新，请重新读取后再保存', {
      currentVersion: actual,
    });
};
function stateError(message: string): never {
  throw new ApiError(422, 'INVALID_REGISTRATION_STATE', message);
}
const assertNotFrozen = (frozen: boolean) => {
  if (frozen) throw new ApiError(422, 'REGISTRATION_FROZEN', '报名名单已冻结，无法继续操作');
};

/** P03 adds a separate team-grant context. P02 membership-only guards remain unchanged. */
export class RegistrationService extends ApplicationService {
  async registerParticipant(
    body: unknown,
    ip: string,
  ): Promise<{ data: SessionData; token: string }> {
    if (!this.participantRegistrationEnabled)
      throw new ApiError(403, 'REGISTRATION_DISABLED', '当前环境未开放自主注册');
    await this.rateLimit(`register:${hashToken(ip)}`, 20, 3600);
    const input = objectInput(body, ['email', 'password', 'displayName']);
    const email = emailInput(input.email);
    const password = passwordInput(input.password);
    const displayName = text(input.displayName, 'displayName', 1, 80);
    const passwordHash = await hashPassword(password);
    try {
      return await this.transaction(async (client) => {
        const userId = randomUUID();
        const result = await client.query(
          'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4) RETURNING id,email,display_name,password_hash,status',
          [userId, email, displayName, passwordHash],
        );
        const session = await this.createSession(client, userId);
        await this.audit(client, userId, null, 'AUTH_PARTICIPANT_REGISTER', 'user', userId);
        return { data: await this.sessionData(client, result.rows[0]), token: session.token };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ApiError(422, 'REGISTRATION_FAILED', '无法完成注册，请检查资料或尝试登录');
      throw error;
    }
  }

  private async context(
    client: PoolClient,
    cookie: string | undefined,
    org: string,
  ): Promise<Context> {
    const actor = await this.lockActor(client, cookie);
    const orgId = resourceId(org);
    const found = await client.query<{ name: string }>(
      "SELECT name FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
      [orgId],
    );
    if (!found.rows[0]) throw notFound();
    const membership = await client.query<{ role: OrgRole; status: string }>(
      'SELECT role,status FROM organization_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE',
      [orgId, actor.user.id],
    );
    return {
      ...actor,
      orgId,
      organizationName: found.rows[0].name,
      role: membership.rows[0]?.status === 'ACTIVE' ? membership.rows[0].role : null,
    };
  }
  private admin(ctx: Context) {
    return ctx.role !== null && isAdministrator(ctx.role);
  }
  private async team(
    client: PoolClient,
    ctx: Context,
    id: string,
    writing: boolean,
  ): Promise<TeamRow> {
    const found = await client.query<TeamRow>(
      `SELECT t.*,${cursorTime('t')} FROM teams t WHERE org_id=$1 AND id=$2 FOR ${writing ? 'UPDATE' : 'SHARE'}`,
      [ctx.orgId, resourceId(id)],
    );
    if (!found.rows[0]) throw notFound();
    return found.rows[0];
  }
  private async leader(client: PoolClient, ctx: Context, teamId: string) {
    const found = await client.query(
      "SELECT user_id FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
      [ctx.orgId, teamId, ctx.user.id],
    );
    return Boolean(found.rowCount);
  }
  private async teamDto(client: PoolClient, ctx: Context, row: TeamRow): Promise<TeamData> {
    const canInvite = this.admin(ctx);
    const canManage = canInvite || (await this.leader(client, ctx, row.id));
    if (!canManage) throw notFound();
    const members = await client.query<{ id: string; name: string }>(
      "SELECT id,name FROM team_members WHERE org_id=$1 AND team_id=$2 AND status='ACTIVE' ORDER BY created_at,id",
      [ctx.orgId, row.id],
    );
    const grants = canInvite
      ? (
          await client.query<TeamGrantData>(
            'SELECT user_id AS "userId",role,status FROM team_access_grants WHERE org_id=$1 AND team_id=$2 ORDER BY created_at,user_id',
            [ctx.orgId, row.id],
          )
        ).rows
      : [];
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      version: row.version,
      members: members.rows,
      grants,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      capabilities: { canManage, canInvite },
    };
  }
  private pageCursor(
    query: PageInput,
    scope: unknown[],
  ): { createdAt: string | null; id: string | null } {
    if (!query.cursor) return { createdAt: null, id: null };
    try {
      const parsed = objectInput(
        JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        ['scope', 'id', 'createdAt'],
      );
      if (
        parsed.scope !== hashToken(JSON.stringify(scope)) ||
        typeof parsed.id !== 'string' ||
        typeof parsed.createdAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(parsed.createdAt)
      )
        invalid('无效或不匹配的分页游标');
      calendarDate(parsed.createdAt.slice(0, 10), 'cursor');
      const [hour, minute, second] = parsed.createdAt.slice(11, 19).split(':').map(Number);
      if (hour! > 23 || minute! > 59 || second! > 59) invalid('无效分页游标');
      return { id: resourceId(parsed.id), createdAt: parsed.createdAt };
    } catch {
      return invalid('无效或不匹配的分页游标');
    }
  }
  private nextCursor(
    rows: { id: string; cursor_created_at: string }[],
    query: PageInput,
    scope: unknown[],
  ) {
    const last = rows[query.limit - 1];
    return rows.length > query.limit && last
      ? Buffer.from(
          JSON.stringify({
            scope: hashToken(JSON.stringify(scope)),
            id: last.id,
            createdAt: last.cursor_created_at,
          }),
        ).toString('base64url')
      : null;
  }

  async listTeams(cookie: string | undefined, org: string, rawQuery: unknown) {
    const query = pageInput(rawQuery, ['q']);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const canCreateTeam = this.admin(ctx);
      if (
        !canCreateTeam &&
        !(
          await client.query(
            "SELECT 1 FROM team_access_grants WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' LIMIT 1",
            [ctx.orgId, ctx.user.id],
          )
        ).rowCount
      )
        throw notFound();
      const scope = ['teams', ctx.orgId, ctx.user.id, query.q ?? ''];
      const cursor = this.pageCursor(query, scope);
      const rows = await client.query<TeamRow>(
        `SELECT t.*,${cursorTime('t')} FROM teams t WHERE t.org_id=$1
        AND ($3::boolean OR EXISTS(SELECT 1 FROM team_access_grants g WHERE g.org_id=t.org_id AND g.team_id=t.id AND g.user_id=$2 AND g.status='ACTIVE'))
        AND ($4::text='' OR position(lower($4) in lower(t.name))>0)
        AND ($5::timestamptz IS NULL OR (t.created_at,t.id)<($5::timestamptz,$6::uuid)) ORDER BY t.created_at DESC,t.id DESC LIMIT $7`,
        [
          ctx.orgId,
          ctx.user.id,
          canCreateTeam,
          query.q ?? '',
          cursor.createdAt,
          cursor.id,
          query.limit + 1,
        ],
      );
      const data: TeamData[] = [];
      for (const row of rows.rows.slice(0, query.limit))
        data.push(await this.teamDto(client, ctx, await this.team(client, ctx, row.id, false)));
      return {
        data,
        nextCursor: this.nextCursor(rows.rows, query, scope),
        capabilities: { canCreateTeam },
      };
    });
  }
  async createTeam(cookie: string | undefined, org: string, body: unknown): Promise<TeamData> {
    const input = teamInput(body);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      if (!this.admin(ctx)) throw forbidden();
      await this.ensureFreshSession(client, ctx);
      const id = randomUUID();
      await client.query('INSERT INTO teams(id,org_id,name) VALUES($1,$2,$3)', [
        id,
        ctx.orgId,
        input.name,
      ]);
      await this.audit(client, ctx.user.id, ctx.orgId, 'TEAM_CREATED', 'team', id);
      return this.teamDto(client, ctx, await this.team(client, ctx, id, false));
    });
  }
  async getTeam(cookie: string | undefined, org: string, id: string): Promise<TeamData> {
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      return this.teamDto(client, ctx, await this.team(client, ctx, id, false));
    });
  }
  async updateTeam(
    cookie: string | undefined,
    org: string,
    id: string,
    body: unknown,
  ): Promise<TeamData> {
    const input = teamInput(body, true);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const row = await this.team(client, ctx, id, true);
      if (!this.admin(ctx) && !(await this.leader(client, ctx, row.id))) throw notFound();
      versionCheck(row.version, input.expectedVersion!);
      await this.ensureFreshSession(client, ctx);
      await client.query(
        'UPDATE teams SET name=$3,version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
        [ctx.orgId, row.id, input.name],
      );
      await this.audit(client, ctx.user.id, ctx.orgId, 'TEAM_UPDATED', 'team', row.id);
      return this.teamDto(client, ctx, await this.team(client, ctx, row.id, false));
    });
  }
  async updateTeamMembers(
    cookie: string | undefined,
    org: string,
    id: string,
    body: unknown,
  ): Promise<TeamData> {
    const input = teamMembersInput(body);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const row = await this.team(client, ctx, id, true);
      if (!this.admin(ctx) && !(await this.leader(client, ctx, row.id))) throw notFound();
      versionCheck(row.version, input.expectedVersion);
      const existing = await client.query<{ id: string; name: string; status: string }>(
        'SELECT id,name,status FROM team_members WHERE org_id=$1 AND team_id=$2 FOR UPDATE',
        [ctx.orgId, row.id],
      );
      const current = new Map(existing.rows.map((member) => [member.id, member]));
      if (input.members.some((member) => member.id && !current.has(member.id)))
        invalid('成员不属于本队', { members: '请使用本队成员' });
      await this.ensureFreshSession(client, ctx);
      // C19: archive only the members actually removed from the list. Retained rows keep their
      // identity and ACTIVE status throughout, so nothing keyed to them (account bindings,
      // claims) is ended by a save that merely keeps or renames them.
      const kept = new Set(input.members.flatMap((member) => (member.id ? [member.id] : [])));
      const removed = existing.rows
        .filter((member) => member.status === 'ACTIVE' && !kept.has(member.id))
        .map((member) => member.id);
      let endedBindings = 0;
      if (removed.length) {
        await client.query(
          "UPDATE team_members SET status='ARCHIVED',updated_at=clock_timestamp() WHERE org_id=$1 AND team_id=$2 AND id=ANY($3::uuid[]) AND status='ACTIVE'",
          [ctx.orgId, row.id, removed],
        );
        // A removed member's account binding ends with it; pending claims on it are withdrawn.
        endedBindings =
          (
            await client.query(
              "UPDATE team_member_bindings SET status='ENDED',ended_reason='MEMBER_REMOVED',ended_by=$4,ended_at=clock_timestamp() WHERE org_id=$1 AND team_id=$2 AND member_id=ANY($3::uuid[]) AND status='ACTIVE'",
              [ctx.orgId, row.id, removed, ctx.user.id],
            )
          ).rowCount ?? 0;
        await client.query(
          "UPDATE team_member_claims SET status='REVOKED',decided_at=clock_timestamp() WHERE org_id=$1 AND team_id=$2 AND member_id=ANY($3::uuid[]) AND status='PENDING'",
          [ctx.orgId, row.id, removed],
        );
      }
      for (const member of input.members) {
        const found = member.id ? current.get(member.id) : undefined;
        if (found) {
          if (found.status !== 'ACTIVE' || found.name !== member.name)
            await client.query(
              "UPDATE team_members SET name=$4,status='ACTIVE',updated_at=clock_timestamp() WHERE org_id=$1 AND team_id=$2 AND id=$3",
              [ctx.orgId, row.id, found.id, member.name],
            );
        } else
          await client.query(
            'INSERT INTO team_members(id,org_id,team_id,name) VALUES($1,$2,$3,$4)',
            [randomUUID(), ctx.orgId, row.id, member.name],
          );
      }
      await client.query(
        'UPDATE teams SET version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
        [ctx.orgId, row.id],
      );
      await this.audit(client, ctx.user.id, ctx.orgId, 'TEAM_MEMBERS_UPDATED', 'team', row.id, {
        count: input.members.length,
        removed: removed.length,
        endedBindings,
      });
      return this.teamDto(client, ctx, await this.team(client, ctx, row.id, false));
    });
  }

  private invitationDto(row: InvitationRow): InvitationData {
    return {
      id: row.id,
      orgId: row.org_id,
      teamId: row.team_id,
      targetUserId: row.target_user_id,
      issuerUserId: row.issuer_user_id,
      purpose: row.purpose,
      expiresAt: row.expires_at.toISOString(),
      acceptedAt: row.accepted_at?.toISOString() ?? null,
      revokedAt: row.revoked_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      capabilities: {
        canRevoke: !row.accepted_at && !row.revoked_at && row.expires_at.getTime() > Date.now(),
      },
    };
  }
  async listInvitations(
    cookie: string | undefined,
    org: string,
    teamId: string,
    rawQuery: unknown,
  ) {
    const query = pageInput(rawQuery);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      if (!this.admin(ctx)) throw forbidden();
      const team = await this.team(client, ctx, teamId, false);
      const scope = ['invitations', ctx.orgId, ctx.user.id, team.id];
      const cursor = this.pageCursor(query, scope);
      const rows = await client.query<InvitationRow>(
        `SELECT i.*,${cursorTime('i')} FROM team_invitations i WHERE org_id=$1 AND team_id=$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5`,
        [ctx.orgId, team.id, cursor.createdAt, cursor.id, query.limit + 1],
      );
      return {
        data: rows.rows.slice(0, query.limit).map((row) => this.invitationDto(row)),
        nextCursor: this.nextCursor(rows.rows, query, scope),
      };
    });
  }
  async createInvitation(
    cookie: string | undefined,
    org: string,
    teamId: string,
    body: unknown,
  ): Promise<IssuedInvitationData> {
    const input = objectInput(body, ['targetUserId', 'expiresInHours']);
    const targetUserId = resourceId(
      typeof input.targetUserId === 'string' ? input.targetUserId : '',
    );
    if (
      !Number.isInteger(input.expiresInHours) ||
      Number(input.expiresInHours) < 1 ||
      Number(input.expiresInHours) > 168
    )
      invalid('邀请有效期需为1–168小时', { expiresInHours: '请输入1–168整数小时' });
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      if (!this.admin(ctx)) throw forbidden();
      const target = await client.query(
        "SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE",
        [targetUserId],
      );
      if (!target.rowCount) throw notFound();
      const team = await this.team(client, ctx, teamId, true);
      await this.ensureFreshSession(client, ctx);
      const token = newSessionToken();
      const id = randomUUID();
      const rows = await client.query<InvitationRow>(
        `INSERT INTO team_invitations(id,org_id,team_id,target_user_id,issuer_user_id,token_hash,created_at,expires_at)
        SELECT $1,$2,$3,$4,$5,$6,issued,issued+($7::int*interval '1 hour') FROM (SELECT clock_timestamp() AS issued) t RETURNING *`,
        [id, ctx.orgId, team.id, targetUserId, ctx.user.id, hashToken(token), input.expiresInHours],
      );
      await this.audit(client, ctx.user.id, ctx.orgId, 'TEAM_INVITATION_CREATED', 'team', team.id, {
        invitationId: id,
        targetUserId,
      });
      return { invitation: this.invitationDto(rows.rows[0]!), token };
    });
  }
  async revokeInvitation(
    cookie: string | undefined,
    org: string,
    teamId: string,
    invitationId: string,
    body: unknown,
  ): Promise<InvitationData> {
    objectInput(body ?? {}, []);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      if (!this.admin(ctx)) throw forbidden();
      const team = await this.team(client, ctx, teamId, true);
      const found = await client.query<InvitationRow>(
        'SELECT * FROM team_invitations WHERE org_id=$1 AND team_id=$2 AND id=$3 FOR UPDATE',
        [ctx.orgId, team.id, resourceId(invitationId)],
      );
      const invitation = found.rows[0];
      if (!invitation) throw notFound();
      if (invitation.accepted_at)
        throw new ApiError(409, 'INVITATION_CONSUMED', '邀请已被接受，请通过领队授权管理访问');
      await this.ensureFreshSession(client, ctx);
      if (!invitation.revoked_at) {
        const updated = await client.query<InvitationRow>(
          'UPDATE team_invitations SET revoked_at=clock_timestamp() WHERE id=$1 RETURNING *',
          [invitation.id],
        );
        await this.audit(
          client,
          ctx.user.id,
          ctx.orgId,
          'TEAM_INVITATION_REVOKED',
          'team',
          team.id,
          { invitationId: invitation.id },
        );
        return this.invitationDto(updated.rows[0]!);
      }
      return this.invitationDto(invitation);
    });
  }
  async putTeamGrant(
    cookie: string | undefined,
    org: string,
    teamId: string,
    userId: string,
    body: unknown,
  ): Promise<TeamGrantData> {
    const input = objectInput(body, ['status']);
    if (input.status !== 'ACTIVE' && input.status !== 'DISABLED') invalid('无效授权状态');
    const targetUserId = resourceId(userId);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      if (!this.admin(ctx)) throw forbidden();
      if (
        !(
          await client.query("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE", [
            targetUserId,
          ])
        ).rowCount
      )
        throw notFound();
      const team = await this.team(client, ctx, teamId, true);
      await this.ensureFreshSession(client, ctx);
      await client.query(
        `INSERT INTO team_access_grants(org_id,team_id,user_id,status) VALUES($1,$2,$3,$4)
        ON CONFLICT(org_id,team_id,user_id) DO UPDATE SET status=EXCLUDED.status,updated_at=clock_timestamp()`,
        [ctx.orgId, team.id, targetUserId, input.status],
      );
      await this.audit(client, ctx.user.id, ctx.orgId, 'TEAM_GRANT_CHANGED', 'team', team.id, {
        userId: targetUserId,
        status: input.status,
      });
      return {
        userId: targetUserId,
        role: 'TEAM_MANAGER',
        status: input.status as 'ACTIVE' | 'DISABLED',
      };
    });
  }
  async acceptInvitation(
    cookie: string | undefined,
    id: string,
    body: unknown,
  ): Promise<TeamContext> {
    const input = objectInput(body, ['token']);
    if (typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.token))
      throw new ApiError(422, 'INVITATION_INVALID', '邀请无效或已过期');
    const invitationId = resourceId(id);
    return this.transaction(async (client) => {
      const actor = await this.lockActor(client, cookie);
      const lookup = await client.query<InvitationRow>(
        'SELECT * FROM team_invitations WHERE id=$1 AND target_user_id=$2',
        [invitationId, actor.user.id],
      );
      const metadata = lookup.rows[0];
      if (!metadata) throw notFound();
      const org = await client.query<{ name: string }>(
        "SELECT name FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
        [metadata.org_id],
      );
      if (!org.rows[0]) throw notFound();
      const issuer = await client.query<{ role: OrgRole; status: string; user_status: string }>(
        `SELECT m.role,m.status,u.status AS user_status FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 FOR SHARE OF m,u`,
        [metadata.org_id, metadata.issuer_user_id],
      );
      const qualified =
        issuer.rows[0] &&
        issuer.rows[0].status === 'ACTIVE' &&
        issuer.rows[0].user_status === 'ACTIVE' &&
        isAdministrator(issuer.rows[0].role);
      if (!qualified) throw new ApiError(422, 'INVITATION_INVALID', '邀请无效或已过期');
      const ctx: Context = {
        ...actor,
        orgId: metadata.org_id,
        organizationName: org.rows[0].name,
        role: null,
      };
      const team = await this.team(client, ctx, metadata.team_id, true);
      const found = await client.query<InvitationRow & { available: boolean }>(
        'SELECT *,expires_at>clock_timestamp() AS available FROM team_invitations WHERE id=$1 AND org_id=$2 AND team_id=$3 AND target_user_id=$4 FOR UPDATE',
        [invitationId, ctx.orgId, team.id, actor.user.id],
      );
      const invitation = found.rows[0];
      if (!invitation) throw notFound();
      const received = Buffer.from(hashToken(input.token as string), 'hex');
      const stored = Buffer.from(invitation.token_hash, 'hex');
      if (
        invitation.revoked_at ||
        !invitation.available ||
        invitation.purpose !== 'TEAM_MANAGER' ||
        received.length !== stored.length ||
        !timingSafeEqual(received, stored)
      )
        throw new ApiError(422, 'INVITATION_INVALID', '邀请无效或已过期');
      if (invitation.accepted_at) {
        if (!(await this.leader(client, ctx, team.id)))
          throw new ApiError(409, 'INVITATION_CONSUMED', '邀请已经被接受，原授权当前无效');
        await this.ensureFreshSession(client, actor);
        return {
          orgId: ctx.orgId,
          organizationName: ctx.organizationName,
          teamId: team.id,
          teamName: team.name,
        };
      }
      await this.ensureFreshSession(client, actor);
      await client.query('UPDATE team_invitations SET accepted_at=clock_timestamp() WHERE id=$1', [
        invitationId,
      ]);
      await client.query(
        `INSERT INTO team_access_grants(org_id,team_id,user_id) VALUES($1,$2,$3)
        ON CONFLICT(org_id,team_id,user_id) DO UPDATE SET status='ACTIVE',updated_at=clock_timestamp()`,
        [ctx.orgId, team.id, actor.user.id],
      );
      await this.audit(
        client,
        actor.user.id,
        ctx.orgId,
        'TEAM_INVITATION_ACCEPTED',
        'team',
        team.id,
        { invitationId },
      );
      return {
        orgId: ctx.orgId,
        organizationName: ctx.organizationName,
        teamId: team.id,
        teamName: team.name,
      };
    });
  }

  private async event(
    client: PoolClient,
    ctx: Context,
    id: string,
    writing: boolean,
  ): Promise<EventAccess> {
    const rows = await client.query<RegistrationEvent>(
      `SELECT ${EVENT_SELECT} FROM events e WHERE org_id=$1 AND id=$2 FOR ${writing ? 'UPDATE' : 'SHARE'} OF e`,
      [ctx.orgId, resourceId(id)],
    );
    const row = rows.rows[0];
    if (!row) throw notFound();
    const staff = ctx.role
      ? await client.query<{ role: StaffRole }>(
          "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
          [ctx.orgId, row.id, ctx.user.id],
        )
      : { rows: [] };
    const staffRole = staff.rows[0]?.role ?? null;
    const admin = this.admin(ctx);
    const frozen = Boolean(
      (
        await client.query('SELECT id FROM registration_freezes WHERE org_id=$1 AND event_id=$2', [
          ctx.orgId,
          row.id,
        ])
      ).rowCount,
    );
    return {
      row,
      staffRole,
      canRead: admin || staffRole !== null,
      canManage: admin || staffRole === 'EVENT_MANAGER',
      canReview: admin || staffRole === 'EVENT_MANAGER' || staffRole === 'REVIEWER',
      frozen,
    };
  }
  private async rules(
    client: PoolClient,
    orgId: string,
    eventId: string,
    id: string | null,
  ): Promise<EventRulesetData | null> {
    if (!id) return null;
    const rows = await client.query<{
      id: string;
      eventId: string;
      version: number;
      minPlayers: number;
      maxPlayers: number;
      zeroAndDoubleZeroDistinct: boolean;
      requireIdentity: boolean;
      requireInsurance: boolean;
      created_at: Date;
    }>(
      `SELECT id,event_id AS "eventId",version,min_players AS "minPlayers",max_players AS "maxPlayers",zero_and_double_zero_distinct AS "zeroAndDoubleZeroDistinct",require_identity AS "requireIdentity",require_insurance AS "requireInsurance",created_at FROM event_rulesets WHERE org_id=$1 AND event_id=$2 AND id=$3`,
      [orgId, eventId, id],
    );
    const row = rows.rows[0];
    if (!row) throw notFound();
    const { created_at, ...data } = row;
    return { ...data, createdAt: created_at.toISOString() };
  }
  private publicEvent(event: EventAccess) {
    const row = event.row;
    return {
      id: row.id,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      timezone: row.timezone,
      venueName: row.venue_name,
      format: row.format,
      status: row.status,
      version: row.version,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      permissions: { canEditDraft: event.canManage && row.status === 'DRAFT' && !event.frozen },
    };
  }
  private async counts(
    client: PoolClient,
    orgId: string,
    eventId: string,
  ): Promise<RegistrationCounts> {
    const counts: RegistrationCounts = {
      DRAFT: 0,
      SUBMITTED: 0,
      APPROVED: 0,
      CHANGES_REQUESTED: 0,
      REJECTED: 0,
      WITHDRAWN: 0,
    };
    const rows = await client.query<{ status: EntryStatus; count: number }>(
      'SELECT status,count(*)::int AS count FROM entries WHERE org_id=$1 AND event_id=$2 GROUP BY status',
      [orgId, eventId],
    );
    for (const row of rows.rows) counts[row.status] = row.count;
    return counts;
  }
  private async registrationDto(
    client: PoolClient,
    event: EventAccess,
  ): Promise<EventRegistrationData> {
    const row = event.row;
    const rules = await this.rules(
      client,
      row.org_id,
      row.id,
      row.locked_ruleset_id ?? row.current_ruleset_id,
    );
    const counts = await this.counts(client, row.org_id, row.id);
    const freezeRow = await client.query<{
      id: string;
      event_id: string;
      ruleset_id: string;
      ruleset_version: number;
      event_version: number;
      snapshot: Pick<RegistrationFreezeData, 'entries' | 'excludedCounts'>;
      created_at: Date;
    }>('SELECT * FROM registration_freezes WHERE org_id=$1 AND event_id=$2', [row.org_id, row.id]);
    const frozen = freezeRow.rows[0];
    const freeze = frozen
      ? {
          id: frozen.id,
          eventId: frozen.event_id,
          rulesetId: frozen.ruleset_id,
          rulesetVersion: frozen.ruleset_version,
          eventVersion: frozen.event_version,
          ...frozen.snapshot,
          createdAt: frozen.created_at.toISOString(),
        }
      : null;
    const canManage = event.canManage && !event.frozen;
    return {
      event: this.publicEvent(event),
      rules,
      freeze,
      counts,
      capabilities: {
        canManageRules: canManage && row.status === 'DRAFT',
        canOpen:
          canManage &&
          row.status === 'DRAFT' &&
          Boolean(rules && !rules.requireIdentity && !rules.requireInsurance),
        canClose: canManage && row.status === 'REGISTRATION_OPEN',
        canFreeze:
          canManage &&
          row.status === 'REGISTRATION_CLOSED' &&
          counts.APPROVED >= 2 &&
          !counts.SUBMITTED &&
          !counts.CHANGES_REQUESTED,
      },
    };
  }
  async getRegistration(
    cookie: string | undefined,
    org: string,
    id: string,
  ): Promise<EventRegistrationData> {
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const event = await this.event(client, ctx, id, false);
      if (!event.canRead) throw notFound();
      return this.registrationDto(client, event);
    });
  }
  async updateRules(
    cookie: string | undefined,
    org: string,
    id: string,
    body: unknown,
  ): Promise<EventRegistrationData> {
    const input = rulesInput(body);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const event = await this.event(client, ctx, id, true);
      if (!event.canRead) throw notFound();
      if (!event.canManage) throw forbidden();
      assertNotFrozen(event.frozen);
      versionCheck(event.row.version, input.expectedVersion);
      if (event.row.status !== 'DRAFT' || event.row.locked_ruleset_id)
        stateError('仅草稿赛事可以保存报名规则');
      await this.ensureFreshSession(client, ctx);
      const next = await client.query<{ version: number }>(
        'SELECT COALESCE(max(version),0)+1 AS version FROM event_rulesets WHERE org_id=$1 AND event_id=$2',
        [ctx.orgId, event.row.id],
      );
      const ruleId = randomUUID();
      await client.query(
        `INSERT INTO event_rulesets(id,org_id,event_id,version,min_players,max_players,zero_and_double_zero_distinct,require_identity,require_insurance,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          ruleId,
          ctx.orgId,
          event.row.id,
          next.rows[0]!.version,
          input.minPlayers,
          input.maxPlayers,
          input.zeroAndDoubleZeroDistinct,
          input.requireIdentity,
          input.requireInsurance,
          ctx.user.id,
        ],
      );
      await client.query(
        'UPDATE events SET current_ruleset_id=$3,version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
        [ctx.orgId, event.row.id, ruleId],
      );
      await this.audit(
        client,
        ctx.user.id,
        ctx.orgId,
        'REGISTRATION_RULES_UPDATED',
        'event',
        event.row.id,
        { rulesetId: ruleId },
      );
      return this.registrationDto(client, await this.event(client, ctx, event.row.id, false));
    });
  }

  async commandRegistration(
    cookie: string | undefined,
    org: string,
    id: string,
    body: unknown,
  ): Promise<EventRegistrationData> {
    const input = registrationCommandInput(body);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const event = await this.event(client, ctx, id, true);
      if (!event.canRead) throw notFound();
      if (!event.canManage) throw forbidden();
      assertNotFrozen(event.frozen);
      versionCheck(event.row.version, input.expectedVersion);
      const rules = await this.rules(
        client,
        ctx.orgId,
        event.row.id,
        event.row.locked_ruleset_id ?? event.row.current_ruleset_id,
      );
      if (!rules) stateError('请先保存完整报名规则');
      await this.ensureFreshSession(client, ctx);
      if (input.type === 'OPEN_REGISTRATION') {
        if (event.row.status !== 'DRAFT') stateError('仅草稿赛事可以开放报名');
        if (rules.requireIdentity || rules.requireInsurance)
          stateError('身份与保险验证尚未接入，当前要求会阻止开放报名');
        await client.query(
          "UPDATE events SET status='REGISTRATION_OPEN',locked_ruleset_id=current_ruleset_id,version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2",
          [ctx.orgId, event.row.id],
        );
      } else if (input.type === 'CLOSE_REGISTRATION') {
        if (event.row.status !== 'REGISTRATION_OPEN') stateError('仅开放报名的赛事可以关闭报名');
        await client.query(
          "UPDATE events SET status='REGISTRATION_CLOSED',version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2",
          [ctx.orgId, event.row.id],
        );
      } else {
        if (event.row.status !== 'REGISTRATION_CLOSED') stateError('请先关闭报名后再冻结名单');
        const counts = await this.counts(client, ctx.orgId, event.row.id);
        if (counts.APPROVED < 2 || counts.SUBMITTED || counts.CHANGES_REQUESTED)
          stateError('冻结需至少两队获批，且没有待审或待修改报名');
        const approved = await client.query<EntryRow>(
          "SELECT * FROM entries WHERE org_id=$1 AND event_id=$2 AND status='APPROVED' ORDER BY created_at,id",
          [ctx.orgId, event.row.id],
        );
        const entries: FrozenEntryData[] = [];
        for (const entry of approved.rows) {
          if (!entry.roster_revision_id || entry.ruleset_id !== rules.id)
            stateError('获批报名缺少对应规则或名单快照');
          const players = await this.players(client, ctx.orgId, entry.id, entry.roster_revision_id);
          if (players.length < rules.minPlayers || players.length > rules.maxPlayers)
            stateError('获批名单人数不满足锁定规则');
          assertJerseyNumbers(players, rules.zeroAndDoubleZeroDistinct);
          entries.push({
            entryId: entry.id,
            teamId: entry.team_id,
            teamName: entry.team_name,
            rosterRevisionId: entry.roster_revision_id,
            players,
          });
        }
        const snapshot = {
          entries,
          excludedCounts: {
            DRAFT: counts.DRAFT,
            REJECTED: counts.REJECTED,
            WITHDRAWN: counts.WITHDRAWN,
          },
        };
        await client.query(
          `INSERT INTO registration_freezes(id,org_id,event_id,ruleset_id,ruleset_version,event_version,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
          [
            randomUUID(),
            ctx.orgId,
            event.row.id,
            rules.id,
            rules.version,
            event.row.version + 1,
            JSON.stringify(snapshot),
            ctx.user.id,
          ],
        );
        await client.query(
          'UPDATE events SET version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
          [ctx.orgId, event.row.id],
        );
      }
      await this.audit(client, ctx.user.id, ctx.orgId, input.type, 'event', event.row.id, {
        rulesetId: rules.id,
      });
      return this.registrationDto(client, await this.event(client, ctx, event.row.id, false));
    });
  }

  private summary(row: EntryRow): EntrySummary {
    return {
      id: row.id,
      eventId: row.event_id,
      teamId: row.team_id,
      teamName: row.team_name,
      status: row.status,
      version: row.version,
      rosterRevisionId: row.roster_revision_id,
      lastSubmittedBy: row.last_submitted_by,
      latestReviewReason: row.latest_review_reason,
    };
  }
  async teamRegistrationEvents(
    cookie: string | undefined,
    org: string,
    teamId: string,
    rawQuery: unknown,
  ) {
    const query = pageInput(rawQuery);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      // Team FOR SHARE is sufficient for this read. Every grant change holds FOR UPDATE.
      const team = await this.team(client, ctx, teamId, false);
      if (!(await this.leader(client, ctx, team.id))) throw notFound();
      const scope = ['registration-events', ctx.orgId, ctx.user.id, team.id];
      const cursor = this.pageCursor(query, scope);
      const rows = await client.query<RegistrationEvent>(
        `SELECT ${EVENT_SELECT} FROM events e WHERE org_id=$1
        AND (status='REGISTRATION_OPEN' OR EXISTS(SELECT 1 FROM entries n WHERE n.org_id=e.org_id AND n.event_id=e.id AND n.team_id=$2))
        AND ($3::timestamptz IS NULL OR (e.created_at,e.id)<($3::timestamptz,$4::uuid)) ORDER BY e.created_at DESC,e.id DESC LIMIT $5`,
        [ctx.orgId, team.id, cursor.createdAt, cursor.id, query.limit + 1],
      );
      const data: TeamRegistrationEventData[] = [];
      for (const row of rows.rows.slice(0, query.limit)) {
        const entry = await client.query<EntryRow>(
          'SELECT * FROM entries WHERE org_id=$1 AND event_id=$2 AND team_id=$3',
          [ctx.orgId, row.id, team.id],
        );
        const frozen = Boolean(
          (
            await client.query(
              'SELECT 1 FROM registration_freezes WHERE org_id=$1 AND event_id=$2',
              [ctx.orgId, row.id],
            )
          ).rowCount,
        );
        const event: EventAccess = {
          row,
          staffRole: null,
          canRead: false,
          canManage: false,
          canReview: false,
          frozen,
        };
        data.push({
          event: this.publicEvent(event),
          rules: await this.rules(
            client,
            ctx.orgId,
            row.id,
            row.locked_ruleset_id ?? row.current_ruleset_id,
          ),
          entry: entry.rows[0] ? this.summary(entry.rows[0]) : null,
          capabilities: {
            canCreateEntry: row.status === 'REGISTRATION_OPEN' && !frozen && !entry.rowCount,
          },
        });
      }
      return { data, nextCursor: this.nextCursor(rows.rows, query, scope) };
    });
  }
  private async players(
    client: PoolClient,
    orgId: string,
    entryId: string,
    revisionId: string | null,
  ): Promise<EntryRosterPlayer[]> {
    if (!revisionId) return [];
    return (
      await client.query<EntryRosterPlayer>(
        'SELECT member_id AS "memberId",name,jersey_no AS "jerseyNo" FROM entry_roster_players WHERE org_id=$1 AND entry_id=$2 AND revision_id=$3 ORDER BY CASE WHEN jersey_no=\'00\' THEN 0 ELSE jersey_no::int END,jersey_no,member_id',
        [orgId, entryId, revisionId],
      )
    ).rows;
  }
  private editable(event: EventAccess, entry: EntryRow, leader: boolean) {
    return (
      leader &&
      !event.frozen &&
      ((event.row.status === 'REGISTRATION_OPEN' &&
        ['DRAFT', 'CHANGES_REQUESTED'].includes(entry.status)) ||
        (event.row.status === 'REGISTRATION_CLOSED' && entry.status === 'CHANGES_REQUESTED'))
    );
  }
  private async entryDto(client: PoolClient, access: EntryAccess): Promise<EntryData> {
    const { ctx, event, leader, entry } = access;
    const rules = await this.rules(client, ctx.orgId, event.row.id, entry.ruleset_id);
    if (!rules) throw notFound();
    const players = await this.players(client, ctx.orgId, entry.id, entry.roster_revision_id);
    const historyRows = await client.query<{
      id: string;
      actorId: string;
      type: EntryCommandType;
      reason: string | null;
      rosterRevisionId: string | null;
      created_at: Date;
    }>(
      'SELECT id,actor_id AS "actorId",command AS type,reason,roster_revision_id AS "rosterRevisionId",created_at FROM entry_review_history WHERE org_id=$1 AND entry_id=$2 ORDER BY created_at,id',
      [ctx.orgId, entry.id],
    );
    const canEditRoster = this.editable(event, entry, leader);
    // The team lock makes the negative leader check stable against grant activation.
    const independent = !leader && entry.last_submitted_by !== ctx.user.id;
    const canReview =
      !event.frozen &&
      event.canReview &&
      independent &&
      ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(event.row.status);
    const canApprove = canReview && entry.status === 'SUBMITTED';
    const canRequestChanges = canReview && ['SUBMITTED', 'APPROVED'].includes(entry.status);
    const canReject = canReview && ['SUBMITTED', 'CHANGES_REQUESTED'].includes(entry.status);
    return {
      ...this.summary(entry),
      orgId: ctx.orgId,
      rules,
      players,
      history: historyRows.rows.map(({ created_at, ...row }) => ({
        ...row,
        createdAt: created_at.toISOString(),
      })),
      createdAt: entry.created_at.toISOString(),
      updatedAt: entry.updated_at.toISOString(),
      capabilities: {
        canEditRoster,
        canSubmit:
          canEditRoster &&
          Boolean(entry.roster_revision_id) &&
          players.length >= rules.minPlayers &&
          players.length <= rules.maxPlayers &&
          !rules.requireIdentity &&
          !rules.requireInsurance,
        canWithdraw:
          leader &&
          !event.frozen &&
          ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(event.row.status) &&
          ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED'].includes(entry.status),
        canReview: canApprove || canRequestChanges || canReject,
        canApprove,
        canRequestChanges,
        canReject,
      },
    };
  }
  private async entryAccess(
    client: PoolClient,
    ctx: Context,
    id: string,
    writing: boolean,
  ): Promise<EntryAccess> {
    // Read only routing metadata first; authorize after taking all locks in the fixed order.
    const metadata = await client.query<{ event_id: string; team_id: string }>(
      'SELECT event_id,team_id FROM entries WHERE org_id=$1 AND id=$2',
      [ctx.orgId, resourceId(id)],
    );
    const routing = metadata.rows[0];
    if (!routing) throw notFound();
    const event = await this.event(client, ctx, routing.event_id, writing);
    const team = await this.team(client, ctx, routing.team_id, writing);
    const leader = await this.leader(client, ctx, team.id);
    if (!event.canRead && !leader) throw notFound();
    const found = await client.query<EntryRow>(
      `SELECT n.*,${cursorTime('n')} FROM entries n WHERE org_id=$1 AND event_id=$2 AND team_id=$3 AND id=$4 FOR ${writing ? 'UPDATE' : 'SHARE'}`,
      [ctx.orgId, event.row.id, team.id, id],
    );
    if (!found.rows[0]) throw notFound();
    return { ctx, event, team, leader, entry: found.rows[0] };
  }
  async getEntry(cookie: string | undefined, org: string, id: string): Promise<EntryData> {
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      return this.entryDto(client, await this.entryAccess(client, ctx, id, false));
    });
  }
  async listEntries(cookie: string | undefined, org: string, eventId: string, rawQuery: unknown) {
    const query = pageInput(rawQuery, ['teamId', 'status']);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const event = await this.event(client, ctx, eventId, false);
      if (!event.canRead) {
        const grant = await client.query(
          "SELECT 1 FROM team_access_grants WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' LIMIT 1",
          [ctx.orgId, ctx.user.id],
        );
        if (!grant.rowCount) throw notFound();
        // A leader may discover an open event, or one their own team already entered.
        if (
          event.row.status !== 'REGISTRATION_OPEN' &&
          !(
            await client.query(
              "SELECT 1 FROM entries n JOIN team_access_grants g ON g.org_id=n.org_id AND g.team_id=n.team_id AND g.user_id=$3 AND g.status='ACTIVE' WHERE n.org_id=$1 AND n.event_id=$2 LIMIT 1",
              [ctx.orgId, event.row.id, ctx.user.id],
            )
          ).rowCount
        )
          throw notFound();
      }
      if (query.teamId) {
        const team = await this.team(client, ctx, query.teamId, false);
        if (!event.canRead && !(await this.leader(client, ctx, team.id))) throw notFound();
      }
      const scope = [
        'entries',
        ctx.orgId,
        ctx.user.id,
        event.row.id,
        query.teamId ?? null,
        query.status ?? null,
      ];
      const cursor = this.pageCursor(query, scope);
      const rows = await client.query<EntryRow>(
        `SELECT n.*,${cursorTime('n')} FROM entries n WHERE org_id=$1 AND event_id=$2
        AND ($4::boolean OR EXISTS(SELECT 1 FROM team_access_grants g WHERE g.org_id=n.org_id AND g.team_id=n.team_id AND g.user_id=$3 AND g.status='ACTIVE'))
        AND ($5::uuid IS NULL OR team_id=$5) AND ($6::text IS NULL OR status=$6)
        AND ($7::timestamptz IS NULL OR (n.created_at,n.id)<($7::timestamptz,$8::uuid)) ORDER BY n.created_at DESC,n.id DESC LIMIT $9`,
        [
          ctx.orgId,
          event.row.id,
          ctx.user.id,
          event.canRead,
          query.teamId ?? null,
          query.status ?? null,
          cursor.createdAt,
          cursor.id,
          query.limit + 1,
        ],
      );
      const data: EntrySummary[] = [];
      // Lock teams in UUID order, not page order, to avoid two readers deadlocking with each other.
      for (const teamId of [
        ...new Set(rows.rows.slice(0, query.limit).map((row) => row.team_id)),
      ].sort())
        await this.team(client, ctx, teamId, false);
      for (const row of rows.rows.slice(0, query.limit)) {
        const leader = await this.leader(client, ctx, row.team_id);
        if (!event.canRead && !leader) throw notFound();
        data.push(this.summary(row));
      }
      return { data, nextCursor: this.nextCursor(rows.rows, query, scope) };
    });
  }
  async createEntry(
    cookie: string | undefined,
    org: string,
    eventId: string,
    body: unknown,
  ): Promise<EntryData> {
    const input = objectInput(body, ['teamId']);
    const teamId = resourceId(typeof input.teamId === 'string' ? input.teamId : '');
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const event = await this.event(client, ctx, eventId, true);
      const team = await this.team(client, ctx, teamId, true);
      const leader = await this.leader(client, ctx, team.id);
      if (!leader) {
        if (event.canRead) throw forbidden();
        throw notFound();
      }
      const existing = await client.query(
        'SELECT id FROM entries WHERE org_id=$1 AND event_id=$2 AND team_id=$3',
        [ctx.orgId, event.row.id, team.id],
      );
      if (!event.canRead && event.row.status !== 'REGISTRATION_OPEN' && !existing.rowCount)
        throw notFound();
      assertNotFrozen(event.frozen);
      if (existing.rowCount)
        throw new ApiError(409, 'ENTRY_ALREADY_EXISTS', '本队已报名该赛事，不能重复创建');
      if (event.row.status !== 'REGISTRATION_OPEN' || !event.row.locked_ruleset_id)
        stateError('赛事当前未开放新报名');
      await this.ensureFreshSession(client, ctx);
      const id = randomUUID();
      await client.query(
        'INSERT INTO entries(id,org_id,event_id,team_id,team_name,ruleset_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id, ctx.orgId, event.row.id, team.id, team.name, event.row.locked_ruleset_id, ctx.user.id],
      );
      await this.audit(client, ctx.user.id, ctx.orgId, 'ENTRY_CREATED', 'entry', id, {
        eventId: event.row.id,
        teamId: team.id,
      });
      return this.entryDto(client, await this.entryAccess(client, ctx, id, true));
    });
  }
  async updateRoster(
    cookie: string | undefined,
    org: string,
    id: string,
    body: unknown,
  ): Promise<EntryData> {
    const input = rosterInput(body);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const access = await this.entryAccess(client, ctx, id, true);
      const { event, team, leader, entry } = access;
      if (!leader) throw forbidden();
      assertNotFrozen(event.frozen);
      versionCheck(entry.version, input.expectedVersion);
      if (!this.editable(event, entry, leader))
        stateError('当前状态不允许编辑名单；获批报名须先由独立审核者退回');
      const rules = await this.rules(client, ctx.orgId, event.row.id, entry.ruleset_id);
      if (!rules) stateError('报名缺少锁定规则');
      assertJerseyNumbers(input.players, rules.zeroAndDoubleZeroDistinct);
      const members = await client.query<{ id: string; name: string }>(
        "SELECT id,name FROM team_members WHERE org_id=$1 AND team_id=$2 AND status='ACTIVE'",
        [ctx.orgId, team.id],
      );
      const names = new Map(members.rows.map((member) => [member.id, member.name]));
      if (input.players.some((player) => !names.has(player.memberId)))
        invalid('名单含其他球队或已归档成员', { players: '请选择本队当前有效成员' });
      await this.ensureFreshSession(client, ctx);
      const revisionId = randomUUID();
      const version = (
        await client.query<{ version: number }>(
          'SELECT COALESCE(max(version),0)+1 AS version FROM entry_roster_revisions WHERE org_id=$1 AND entry_id=$2',
          [ctx.orgId, entry.id],
        )
      ).rows[0]!.version;
      await client.query(
        'INSERT INTO entry_roster_revisions(id,org_id,event_id,team_id,entry_id,version,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [revisionId, ctx.orgId, event.row.id, team.id, entry.id, version, ctx.user.id],
      );
      for (const player of input.players)
        await client.query(
          'INSERT INTO entry_roster_players(org_id,revision_id,entry_id,team_id,member_id,name,jersey_no) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            ctx.orgId,
            revisionId,
            entry.id,
            team.id,
            player.memberId,
            names.get(player.memberId),
            player.jerseyNo,
          ],
        );
      // Keep CHANGES_REQUESTED even after CLOSE; only SUBMIT changes that state.
      await client.query(
        'UPDATE entries SET roster_revision_id=$3,version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
        [ctx.orgId, entry.id, revisionId],
      );
      await this.audit(client, ctx.user.id, ctx.orgId, 'ENTRY_ROSTER_UPDATED', 'entry', entry.id, {
        rosterRevisionId: revisionId,
        count: input.players.length,
      });
      return this.entryDto(client, await this.entryAccess(client, ctx, entry.id, true));
    });
  }
  async commandEntry(
    cookie: string | undefined,
    org: string,
    id: string,
    body: unknown,
  ): Promise<EntryData> {
    const input = entryCommandInput(body);
    return this.transaction(async (client) => {
      const ctx = await this.context(client, cookie, org);
      const access = await this.entryAccess(client, ctx, id, true);
      const { event, leader, entry } = access;
      assertNotFrozen(event.frozen);
      versionCheck(entry.version, input.expectedVersion);
      if (!['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(event.row.status))
        stateError('赛事当前不允许报名操作');
      let next: EntryStatus;
      if (input.type === 'SUBMIT') {
        if (!leader) throw forbidden();
        if (!this.editable(event, entry, leader)) stateError('当前状态不允许提交报名');
        const dto = await this.entryDto(client, access);
        if (!dto.capabilities.canSubmit) stateError('名单人数或要求不符合锁定规则，请检查后提交');
        assertJerseyNumbers(dto.players, dto.rules.zeroAndDoubleZeroDistinct);
        next = 'SUBMITTED';
      } else if (input.type === 'WITHDRAW') {
        if (!leader) throw forbidden();
        if (!['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED'].includes(entry.status))
          stateError('当前报名不能撤回');
        next = 'WITHDRAWN';
      } else {
        if (!event.canReview || leader || entry.last_submitted_by === ctx.user.id)
          throw forbidden();
        if (input.type === 'APPROVE') {
          if (entry.status !== 'SUBMITTED') stateError('仅待审报名可以批准');
          next = 'APPROVED';
        } else if (input.type === 'REQUEST_CHANGES') {
          if (!['SUBMITTED', 'APPROVED'].includes(entry.status)) stateError('当前报名不能退回修改');
          next = 'CHANGES_REQUESTED';
        } else {
          if (!['SUBMITTED', 'CHANGES_REQUESTED'].includes(entry.status))
            stateError('当前报名不能拒绝');
          next = 'REJECTED';
        }
      }
      await this.ensureFreshSession(client, ctx);
      await client.query(
        `UPDATE entries SET status=$3,version=version+1,last_submitted_by=CASE WHEN $4::boolean THEN $5::uuid ELSE last_submitted_by END,
        latest_review_reason=CASE WHEN $6::boolean THEN $7::text ELSE latest_review_reason END,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2`,
        [
          ctx.orgId,
          entry.id,
          next,
          input.type === 'SUBMIT',
          ctx.user.id,
          ['APPROVE', 'REQUEST_CHANGES', 'REJECT'].includes(input.type),
          input.reason ?? null,
        ],
      );
      await client.query(
        'INSERT INTO entry_review_history(id,org_id,event_id,entry_id,actor_id,command,reason,roster_revision_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          randomUUID(),
          ctx.orgId,
          event.row.id,
          entry.id,
          ctx.user.id,
          input.type,
          input.reason ?? null,
          entry.roster_revision_id,
        ],
      );
      await this.audit(client, ctx.user.id, ctx.orgId, `ENTRY_${input.type}`, 'entry', entry.id, {
        rosterRevisionId: entry.roster_revision_id,
        fromVersion: entry.version,
        toVersion: entry.version + 1,
      });
      return this.entryDto(client, await this.entryAccess(client, ctx, entry.id, true));
    });
  }
}
