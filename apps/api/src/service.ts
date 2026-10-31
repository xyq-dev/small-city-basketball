import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  AuthCapabilitiesData,
  CommerceMode,
  EventData,
  OrgRole,
  SessionData,
  StaffRole,
} from '@small-city-basketball/contracts';
import { resolveApiOptions } from './runtime-config.js';
import type { WechatPayConfig } from './commerce/wechatpay.js';
import type { ResolvedApiOptions } from './runtime-config.js';
import { ApiError, forbidden, notFound, unauthenticated } from './errors.js';
import {
  hashPassword,
  hashToken,
  newSessionToken,
  readSessionToken,
  verifyPassword,
} from './security.js';
import {
  calendarDate,
  emailInput,
  eventInput,
  eventQuery,
  invalid,
  loginIdentifierInput,
  membershipInput,
  objectInput,
  passwordInput,
  resourceId,
  text,
} from './validation.js';
import type { EventQuery } from './validation.js';

export interface ApiOptions {
  databaseUrl: string;
  appOrigin: string;
  sessionTtlSeconds?: number;
  secureCookies?: boolean;
  /** Legacy explicit fallback for both registration switches. */
  registrationEnabled?: boolean;
  organizationRegistrationEnabled?: boolean;
  participantRegistrationEnabled?: boolean;
  /** Dedicated canonical base64 AES-256 key; absent keeps new material workflows closed. */
  participantDataKey?: string;
  notificationStartingLeadMinutes?: number;
  trustProxyHops?: 0 | 1;
  commerceMode?: CommerceMode;
  wechatPay?: WechatPayConfig;
}

export interface DbUser {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  status: string;
}
export interface Actor {
  sessionId: string;
  user: DbUser;
}
export interface OrgActor extends Actor {
  orgId: string;
  role: OrgRole;
}
export interface EventRow {
  id: string;
  org_id: string;
  name: string;
  start_date: string;
  end_date: string;
  timezone: string;
  venue_name: string | null;
  format: EventData['format'];
  status: EventData['status'];
  version: number;
  created_at: Date;
  updated_at: Date;
  cursor_created_at?: string;
  staff_role?: StaffRole | null;
}

export const EVENT_SELECT = `e.*, e.start_date::text AS start_date, e.end_date::text AS end_date,
  to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at`;
export const isAdministrator = (role: OrgRole) => role === 'ORG_OWNER' || role === 'ORG_ADMIN';

export class ApplicationService {
  readonly sessionTtlSeconds: number;
  readonly secureCookies: boolean;
  readonly organizationRegistrationEnabled: boolean;
  readonly participantRegistrationEnabled: boolean;
  readonly options: ResolvedApiOptions;

  constructor(
    readonly pool: Pool,
    options: ApiOptions,
  ) {
    this.options = resolveApiOptions(options);
    this.sessionTtlSeconds = this.options.sessionTtlSeconds;
    this.secureCookies = this.options.secureCookies;
    this.organizationRegistrationEnabled = this.options.organizationRegistrationEnabled;
    this.participantRegistrationEnabled = this.options.participantRegistrationEnabled;
  }

  authCapabilities(): AuthCapabilitiesData {
    return {
      canRegisterOrganization: this.organizationRegistrationEnabled,
      canRegisterParticipant: this.participantRegistrationEnabled,
    };
  }

  protected async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* Preserve the original failure. */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  protected async audit(
    client: PoolClient,
    actorId: string,
    orgId: string | null,
    action: string,
    type: string,
    id: string,
    metadata: Record<string, unknown> = {},
  ) {
    await client.query(
      'INSERT INTO audit_logs(id,org_id,actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [randomUUID(), orgId, actorId, action, type, id, JSON.stringify(metadata)],
    );
  }

  protected async rateLimit(key: string, maximum: number, windowSeconds: number) {
    // All current windows are at most one hour. Retain that full horizon so
    // cleanup cannot reset a still-active registration/IP/account limit.
    // Commit cleanup before the counter update so concurrent requests never
    // carry locks on each other's expired keys into their own upserts.
    await this.pool.query(`
      WITH expired AS (
        SELECT key FROM auth_rate_limits
        WHERE window_start <= statement_timestamp()-interval '1 hour'
        LIMIT 100 FOR UPDATE SKIP LOCKED
      )
      DELETE FROM auth_rate_limits limits USING expired
      WHERE limits.key=expired.key
        AND limits.window_start <= statement_timestamp()-interval '1 hour'
    `);
    const result = await this.pool.query<{ attempts: number }>(
      `
      INSERT INTO auth_rate_limits(key,window_start,attempts) VALUES($1,clock_timestamp(),1)
      ON CONFLICT(key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_start <= clock_timestamp()-($2::int*interval '1 second') THEN 1 ELSE auth_rate_limits.attempts+1 END,
        window_start = CASE WHEN auth_rate_limits.window_start <= clock_timestamp()-($2::int*interval '1 second') THEN clock_timestamp() ELSE auth_rate_limits.window_start END
      RETURNING attempts`,
      [key, windowSeconds],
    );
    if (result.rows[0]!.attempts > maximum)
      throw new ApiError(429, 'RATE_LIMITED', '尝试次数过多，请稍后重试', {
        retryAfter: windowSeconds,
      });
  }

  protected async createSession(
    client: PoolClient,
    userId: string,
  ): Promise<{ token: string; id: string }> {
    const token = newSessionToken();
    const id = randomUUID();
    await client.query(
      "INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+($4::int*interval '1 second'))",
      [id, userId, hashToken(token), this.sessionTtlSeconds],
    );
    return { token, id };
  }

  protected async lockActor(client: PoolClient, cookie?: string): Promise<Actor> {
    const token = readSessionToken(cookie);
    if (!token) throw unauthenticated();
    const session = await client.query<{ id: string; user_id: string; issued_at: string }>(
      'SELECT id,user_id,created_at::text AS issued_at FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',
      [hashToken(token)],
    );
    const row = session.rows[0];
    if (!row) throw unauthenticated();
    const user = await client.query<DbUser>(
      "SELECT u.id,u.email,u.display_name,u.password_hash,u.status FROM users u WHERE u.id=$1 AND $2::timestamptz>COALESCE((to_jsonb(u)->>'credential_reset_at')::timestamptz,'-infinity'::timestamptz) FOR SHARE",
      [row.user_id, row.issued_at],
    );
    if (!user.rows[0] || user.rows[0].status !== 'ACTIVE') throw unauthenticated();
    return { sessionId: row.id, user: user.rows[0] };
  }

  protected async ensureFreshSession(client: PoolClient, actor: Actor) {
    const result = await client.query(
      'SELECT id FROM sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',
      [actor.sessionId],
    );
    if (!result.rowCount) throw unauthenticated();
  }

  protected async lockOrganization(
    client: PoolClient,
    actor: Actor,
    id: string,
  ): Promise<OrgActor> {
    const orgId = resourceId(id);
    const organization = await client.query(
      'SELECT id FROM organizations WHERE id=$1 AND status=$2 FOR SHARE',
      [orgId, 'ACTIVE'],
    );
    if (!organization.rowCount) throw notFound();
    const membership = await client.query<{ role: OrgRole; status: string }>(
      'SELECT role,status FROM organization_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE',
      [orgId, actor.user.id],
    );
    if (membership.rows[0]?.status !== 'ACTIVE') throw notFound();
    return { ...actor, orgId, role: membership.rows[0].role };
  }

  protected async sessionData(client: PoolClient, user: DbUser): Promise<SessionData> {
    const memberships = await client.query<{ id: string; name: string; role: OrgRole }>(
      `
      SELECT o.id,o.name,m.role FROM organizations o JOIN organization_memberships m ON m.org_id=o.id
      WHERE m.user_id=$1 AND m.status='ACTIVE' AND o.status='ACTIVE' ORDER BY o.created_at,o.id`,
      [user.id],
    );
    const teamContexts = await client.query<SessionData['teamContexts'][number]>(
      `
      SELECT o.id AS "orgId",o.name AS "organizationName",t.id AS "teamId",t.name AS "teamName"
      FROM team_access_grants g JOIN teams t ON t.org_id=g.org_id AND t.id=g.team_id
      JOIN organizations o ON o.id=g.org_id
      WHERE g.user_id=$1 AND g.status='ACTIVE' AND o.status='ACTIVE'
      ORDER BY o.created_at,o.id,t.created_at,t.id`,
      [user.id],
    );
    const operator = await client.query(
      "SELECT 1 FROM platform_operators WHERE user_id=$1 AND status='ACTIVE'",
      [user.id],
    );
    return {
      ...(operator.rowCount ? { platformOperator: true } : {}),
      user: { id: user.id, email: user.email, displayName: user.display_name },
      organizations: memberships.rows,
      teamContexts: teamContexts.rows,
    };
  }

  async register(body: unknown, ip: string): Promise<{ data: SessionData; token: string }> {
    if (!this.organizationRegistrationEnabled)
      throw new ApiError(403, 'REGISTRATION_DISABLED', '当前环境未开放自主注册');
    await this.rateLimit(`register:${hashToken(ip)}`, 20, 3600);
    const input = objectInput(body, ['email', 'password', 'displayName', 'organizationName']);
    const email = emailInput(input.email);
    const password = passwordInput(input.password);
    const displayName = text(input.displayName, 'displayName', 1, 80);
    const organizationName = text(input.organizationName, 'organizationName', 1, 80);
    const passwordHash = await hashPassword(password);
    try {
      return await this.transaction(async (client) => {
        const userId = randomUUID();
        const orgId = randomUUID();
        const result = await client.query<DbUser>(
          'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4) RETURNING id,email,display_name,password_hash,status',
          [userId, email, displayName, passwordHash],
        );
        await client.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
          orgId,
          organizationName,
        ]);
        await client.query(
          "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
          [orgId, userId],
        );
        const session = await this.createSession(client, userId);
        await this.audit(client, userId, orgId, 'AUTH_REGISTER', 'user', userId);
        return { data: await this.sessionData(client, result.rows[0]!), token: session.token };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ApiError(422, 'REGISTRATION_FAILED', '无法完成注册，请检查资料或尝试登录');
      throw error;
    }
  }

  async login(body: unknown, ip: string): Promise<{ data: SessionData; token: string }> {
    const input = objectInput(body, ['email', 'password']);
    const identifier = loginIdentifierInput(input.email);
    const password = passwordInput(input.password);
    await this.rateLimit(`login-ip:${hashToken(ip)}`, 100, 900);
    const lookup = await this.pool.query<DbUser & { login_name: string | null }>(
      identifier.includes('@')
        ? 'SELECT id,email,login_name,display_name,password_hash,status FROM users WHERE email=$1'
        : 'SELECT id,email,login_name,display_name,password_hash,status FROM users WHERE login_name=$1',
      [identifier],
    );
    const candidate = lookup.rows[0];
    // Both identifiers share the pre-existing email/IP budget. Alternating a
    // user's email and alias must not double the available password attempts.
    const accountKey = `login-account:${hashToken(`${candidate?.email ?? identifier}\n${ip}`)}`;
    await this.rateLimit(accountKey, 10, 900);
    const matches = await verifyPassword(password, candidate?.password_hash);
    const invalidCredentials = () => new ApiError(401, 'INVALID_CREDENTIALS', '账号或密码不正确');
    if (!candidate || !matches || candidate.status !== 'ACTIVE') throw invalidCredentials();
    return this.transaction(async (client) => {
      // Offline credential maintenance takes this key exclusively before
      // enumerating sessions. A preceding login must finish first, and a later
      // login cannot create a session that escapes that complete enumeration.
      await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
        `scb-account-maintenance:${candidate.id}`,
      ]);
      const current = await client.query<DbUser & { login_name: string | null }>(
        'SELECT id,email,login_name,display_name,password_hash,status FROM users WHERE id=$1 FOR SHARE',
        [candidate.id],
      );
      const user = current.rows[0];
      if (
        !user ||
        user.status !== 'ACTIVE' ||
        user.password_hash !== candidate.password_hash ||
        (user.email !== identifier && user.login_name !== identifier)
      )
        throw invalidCredentials();
      const session = await this.createSession(client, user.id);
      await client.query('DELETE FROM auth_rate_limits WHERE key=$1', [accountKey]);
      await this.audit(client, user.id, null, 'AUTH_LOGIN', 'session', session.id);
      return { data: await this.sessionData(client, user), token: session.token };
    });
  }

  async session(cookie?: string): Promise<SessionData> {
    return this.transaction(async (client) => {
      const actor = await this.lockActor(client, cookie);
      return this.sessionData(client, actor.user);
    });
  }

  async logout(cookie?: string) {
    const token = readSessionToken(cookie);
    if (!token) return;
    await this.transaction(async (client) => {
      const result = await client.query<{ id: string; user_id: string }>(
        'UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING id,user_id',
        [hashToken(token)],
      );
      const session = result.rows[0];
      if (session)
        await this.audit(client, session.user_id, null, 'AUTH_LOGOUT', 'session', session.id);
    });
  }

  protected async lockEvent(
    client: PoolClient,
    actor: OrgActor,
    id: string,
    writing = false,
  ): Promise<{ row: EventRow; canEditDraft: boolean }> {
    const eventId = resourceId(id);
    const found = await client.query<EventRow>(
      `SELECT ${EVENT_SELECT} FROM events e WHERE e.org_id=$1 AND e.id=$2 FOR ${writing ? 'UPDATE' : 'SHARE'} OF e`,
      [actor.orgId, eventId],
    );
    const row = found.rows[0];
    if (!row) throw notFound();
    let manager = isAdministrator(actor.role);
    if (!manager) {
      const staff = await client.query<{ role: StaffRole }>(
        "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
        [actor.orgId, row.id, actor.user.id],
      );
      if (!staff.rows[0]) throw notFound();
      manager = staff.rows[0].role === 'EVENT_MANAGER';
    }
    return { row, canEditDraft: manager && row.status === 'DRAFT' };
  }

  private eventData(row: EventRow, canEditDraft: boolean): EventData {
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
      permissions: { canEditDraft },
    };
  }

  private parseCursor(
    query: EventQuery,
    orgId: string,
    userId: string,
  ): { id: string; createdAt: string } | null {
    if (!query.cursor) return null;
    try {
      const parsed = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as unknown;
      const value = objectInput(parsed, ['scope', 'id', 'createdAt']);
      const expected = hashToken(JSON.stringify([orgId, userId, query.q, query.status]));
      if (
        value.scope !== expected ||
        typeof value.id !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(value.id)
      )
        invalid('分页游标不匹配当前机构或筛选');
      if (
        typeof value.createdAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.createdAt)
      )
        invalid('无效的分页游标');
      calendarDate(value.createdAt.slice(0, 10), 'cursor');
      const parts = value.createdAt.slice(11, 19).split(':').map(Number);
      if (parts[0]! > 23 || parts[1]! > 59 || parts[2]! > 59) invalid('无效的分页游标');
      // PostgreSQL must receive the original microsecond precision, not a JS Date round trip.
      return { id: resourceId(value.id), createdAt: value.createdAt };
    } catch {
      return invalid('无效或不匹配的分页游标');
    }
  }

  async listEvents(
    cookie: string | undefined,
    organizationId: string,
    rawQuery: unknown,
  ): Promise<{ data: EventData[]; nextCursor: string | null }> {
    const query = eventQuery(rawQuery);
    return this.transaction(async (client) => {
      const actor = await this.lockOrganization(
        client,
        await this.lockActor(client, cookie),
        organizationId,
      );
      const cursor = this.parseCursor(query, actor.orgId, actor.user.id);
      const rows = await client.query<EventRow>(
        `
        SELECT ${EVENT_SELECT},s.role AS staff_role FROM events e
        LEFT JOIN event_staff s ON s.org_id=e.org_id AND s.event_id=e.id AND s.user_id=$2 AND s.status='ACTIVE'
        WHERE e.org_id=$1 AND ($3::boolean OR s.user_id IS NOT NULL)
          AND ($4::text='' OR position(lower($4) in lower(e.name))>0)
          AND ($5::text IS NULL OR e.status=$5)
          AND ($6::timestamptz IS NULL OR (e.created_at,e.id)<($6::timestamptz,$7::uuid))
        ORDER BY e.created_at DESC,e.id DESC LIMIT $8`,
        [
          actor.orgId,
          actor.user.id,
          isAdministrator(actor.role),
          query.q,
          query.status,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          query.limit + 1,
        ],
      );
      const page = rows.rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor =
        rows.rows.length > query.limit && last
          ? Buffer.from(
              JSON.stringify({
                scope: hashToken(
                  JSON.stringify([actor.orgId, actor.user.id, query.q, query.status]),
                ),
                id: last.id,
                createdAt: last.cursor_created_at,
              }),
            ).toString('base64url')
          : null;
      return {
        data: page.map((row) =>
          this.eventData(
            row,
            row.status === 'DRAFT' &&
              (isAdministrator(actor.role) || row.staff_role === 'EVENT_MANAGER'),
          ),
        ),
        nextCursor,
      };
    });
  }

  async getEvent(
    cookie: string | undefined,
    organizationId: string,
    eventId: string,
  ): Promise<EventData> {
    return this.transaction(async (client) => {
      const actor = await this.lockOrganization(
        client,
        await this.lockActor(client, cookie),
        organizationId,
      );
      const event = await this.lockEvent(client, actor, eventId);
      return this.eventData(event.row, event.canEditDraft);
    });
  }

  async createEvent(
    cookie: string | undefined,
    organizationId: string,
    body: unknown,
  ): Promise<EventData> {
    const { input } = eventInput(body);
    return this.transaction(async (client) => {
      const actor = await this.lockOrganization(
        client,
        await this.lockActor(client, cookie),
        organizationId,
      );
      if (!isAdministrator(actor.role)) throw forbidden();
      await this.ensureFreshSession(client, actor);
      const id = randomUUID();
      await client.query(
        `INSERT INTO events(id,org_id,name,start_date,end_date,timezone,venue_name,format,created_by)
        VALUES($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9)`,
        [
          id,
          actor.orgId,
          input.name,
          input.startDate,
          input.endDate,
          input.timezone,
          input.venueName,
          input.format,
          actor.user.id,
        ],
      );
      await this.audit(client, actor.user.id, actor.orgId, 'EVENT_CREATED', 'event', id, {
        version: 1,
        format: input.format,
      });
      const event = await this.lockEvent(client, actor, id);
      return this.eventData(event.row, true);
    });
  }

  async updateEvent(
    cookie: string | undefined,
    organizationId: string,
    eventId: string,
    body: unknown,
  ): Promise<EventData> {
    const { input, expectedVersion } = eventInput(body, true);
    return this.transaction(async (client) => {
      const actor = await this.lockOrganization(
        client,
        await this.lockActor(client, cookie),
        organizationId,
      );
      const event = await this.lockEvent(client, actor, eventId, true);
      if (event.row.status !== 'DRAFT')
        throw new ApiError(422, 'INVALID_EVENT_STATE', '当前仅允许编辑草稿赛事');
      if (!event.canEditDraft) throw forbidden();
      if (event.row.version !== expectedVersion)
        throw new ApiError(409, 'VERSION_CONFLICT', '赛事已更新，请重新读取后再保存', {
          currentVersion: event.row.version,
        });
      await this.ensureFreshSession(client, actor);
      await client.query(
        `UPDATE events SET name=$3,start_date=$4::date,end_date=$5::date,timezone=$6,venue_name=$7,format=$8,
        version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2`,
        [
          actor.orgId,
          event.row.id,
          input.name,
          input.startDate,
          input.endDate,
          input.timezone,
          input.venueName,
          input.format,
        ],
      );
      await this.audit(client, actor.user.id, actor.orgId, 'EVENT_UPDATED', 'event', event.row.id, {
        fromVersion: expectedVersion,
        toVersion: expectedVersion! + 1,
      });
      const updated = await this.lockEvent(client, actor, event.row.id);
      return this.eventData(updated.row, updated.canEditDraft);
    });
  }

  async listMembers(cookie: string | undefined, organizationId: string) {
    return this.transaction(async (client) => {
      const actor = await this.lockOrganization(
        client,
        await this.lockActor(client, cookie),
        organizationId,
      );
      if (actor.role !== 'ORG_OWNER') throw forbidden();
      const members = await client.query(
        `SELECT m.user_id AS "userId",u.email,u.display_name AS "displayName",m.role,m.status
        FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 ORDER BY m.created_at,m.user_id`,
        [actor.orgId],
      );
      return members.rows;
    });
  }

  async putMember(cookie: string | undefined, organizationId: string, id: string, body: unknown) {
    const targetUserId = resourceId(id);
    const input = membershipInput(body);
    return this.transaction(async (client) => {
      const actor = await this.lockOrganization(
        client,
        await this.lockActor(client, cookie),
        organizationId,
      );
      if (actor.role !== 'ORG_OWNER' || targetUserId === actor.user.id) throw forbidden();
      const targetUser = await client.query<{ id: string; status: string }>(
        'SELECT id,status FROM users WHERE id=$1 FOR SHARE',
        [targetUserId],
      );
      if (!targetUser.rows[0] || targetUser.rows[0].status !== 'ACTIVE') throw notFound();
      const target = await client.query<{ role: OrgRole }>(
        'SELECT role FROM organization_memberships WHERE org_id=$1 AND user_id=$2 FOR UPDATE',
        [actor.orgId, targetUserId],
      );
      if (target.rows[0]?.role === 'ORG_OWNER') throw forbidden();
      await this.ensureFreshSession(client, actor);
      await client.query(
        `INSERT INTO organization_memberships(org_id,user_id,role,status) VALUES($1,$2,$3,$4)
        ON CONFLICT(org_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,updated_at=clock_timestamp()`,
        [actor.orgId, targetUserId, input.role, input.status],
      );
      await this.audit(
        client,
        actor.user.id,
        actor.orgId,
        'MEMBERSHIP_CHANGED',
        'user',
        targetUserId,
        { role: input.role, status: input.status },
      );
      return { userId: targetUserId, role: input.role, status: input.status };
    });
  }

  protected async assertStaffMutable(client: PoolClient, eventId: string) {
    const r = await client.query(
      'SELECT 1 FROM match_exception_heads WHERE event_id=$1 AND active_request_id IS NOT NULL LIMIT 1',
      [eventId],
    );
    if (r.rowCount)
      throw new ApiError(
        409,
        'MATCH_ADJUDICATED',
        '赛事含有效比赛裁定，请先按独立流程撤销裁定后调整工作人员',
      );
  }

  async putStaff(
    cookie: string | undefined,
    organizationId: string,
    id: string,
    userId: string,
    body: unknown,
  ) {
    const targetId = resourceId(userId);
    const eventId = resourceId(id);
    const input = membershipInput(body, true);
    return this.transaction(async (client) => {
      const actor = await this.lockOrganization(
        client,
        await this.lockActor(client, cookie),
        organizationId,
      );
      if (!isAdministrator(actor.role)) throw forbidden();
      const target = await client.query<{ status: string }>(
        'SELECT status FROM organization_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE',
        [actor.orgId, targetId],
      );
      if (target.rows[0]?.status !== 'ACTIVE') throw notFound();
      const event = await this.lockEvent(client, actor, eventId);
      await this.assertStaffMutable(client, event.row.id);
      await this.ensureFreshSession(client, actor);
      await client.query(
        `INSERT INTO event_staff(org_id,event_id,user_id,role,status) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(org_id,event_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,updated_at=clock_timestamp()`,
        [actor.orgId, event.row.id, targetId, input.role, input.status],
      );
      await this.audit(
        client,
        actor.user.id,
        actor.orgId,
        'EVENT_STAFF_CHANGED',
        'event',
        event.row.id,
        { userId: targetId, role: input.role, status: input.status },
      );
      return { eventId: event.row.id, userId: targetId, role: input.role, status: input.status };
    });
  }
}
