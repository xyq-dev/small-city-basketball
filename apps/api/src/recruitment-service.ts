import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError, forbidden, notFound } from './errors.js';
import { ApplicationService, EVENT_SELECT, isAdministrator } from './service.js';
import type { Actor, EventRow } from './service.js';
import type { OrgRole } from '@small-city-basketball/contracts';
import { objectInput, resourceId } from './validation.js';
import {
  eventInvitationDecisionInput,
  eventInvitationInput,
  importCommitInput,
  importPreviewInput,
  normalizedName,
  publicRecruitmentId,
  publishRecruitmentInput,
  recruitmentApplicationInput,
  recruitmentReviewInput,
  requestFingerprint,
  requestId,
  revokeRecruitmentInput,
} from './recruitment-domain.js';
import type { ImportIssue, ImportRow } from './recruitment-domain.js';

type Row = Record<string, any>;
interface Access extends Actor {
  orgId: string;
  orgName: string;
  role: OrgRole | null;
  event: EventRow & { locked_ruleset_id: string | null; current_ruleset_id: string | null };
  manager: boolean;
  admin: boolean;
  visible: boolean;
  now: Date;
}
const iso = (value: Date | string) => new Date(value).toISOString();
function fail(code: string, message: string, status = 409): never {
  throw new ApiError(status, code, message);
}
const checkVersion = (actual: number, expected: number) => {
  if (actual !== expected)
    throw new ApiError(409, 'VERSION_CONFLICT', '记录已变化，请重新读取后操作', {
      currentVersion: actual,
    });
};
const TEAM_NAME_SQL = "lower(regexp_replace(normalize(name,NFKC),'\\s+',' ','g'))";

/** X05: separate recruitment visibility, explicit team drafts and recipient-bound invitations. */
export class RecruitmentService extends ApplicationService {
  private async access(
    c: PoolClient,
    cookie: string | undefined,
    org: string,
    event: string,
    write = false,
  ): Promise<Access> {
    const actor = await this.lockActor(c, cookie),
      orgId = resourceId(org);
    const organization = (
      await c.query<Row>(
        "SELECT name FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
        [orgId],
      )
    ).rows[0];
    if (!organization) throw notFound();
    const member = (
      await c.query<Row>(
        'SELECT role,status FROM organization_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE',
        [orgId, actor.user.id],
      )
    ).rows[0];
    const role = member?.status === 'ACTIVE' ? (member.role as OrgRole) : null;
    const row = (
      await c.query<Access['event']>(
        `SELECT ${EVENT_SELECT} FROM events e WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'} OF e`,
        [orgId, resourceId(event)],
      )
    ).rows[0];
    if (!row) throw notFound();
    const staff = role
      ? (
          await c.query<Row>(
            "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
            [orgId, row.id, actor.user.id],
          )
        ).rows[0]
      : null;
    const admin = role !== null && isAdministrator(role);
    const now = (await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
    await this.ensureFreshSession(c, actor);
    return {
      ...actor,
      orgId,
      orgName: organization.name,
      role,
      event: row,
      admin,
      visible: admin || !!staff,
      manager: admin || staff?.role === 'EVENT_MANAGER',
      now,
    };
  }
  private requireManager(a: Access, adminOnly = false) {
    if (!(adminOnly ? a.admin : a.manager)) {
      if (!a.visible) throw notFound();
      throw forbidden();
    }
  }
  private async open(c: PoolClient, a: Access) {
    if (a.event.status !== 'REGISTRATION_OPEN' || !a.event.locked_ruleset_id)
      fail('REGISTRATION_NOT_OPEN', '赛事未开放新报名，不能创建队伍报名', 422);
    if (
      (
        await c.query('SELECT id FROM registration_freezes WHERE org_id=$1 AND event_id=$2', [
          a.orgId,
          a.event.id,
        ])
      ).rowCount
    )
      fail('REGISTRATION_FROZEN', '名单已冻结，不能增加报名', 422);
  }
  private async touch(c: PoolClient, a: Access) {
    const row = (
      await c.query<Row>(
        'UPDATE events SET version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2 RETURNING version',
        [a.orgId, a.event.id],
      )
    ).rows[0]!;
    a.event.version = row.version;
  }
  private async once<I extends { clientRequestId: string }>(
    c: PoolClient,
    a: Access,
    operation: string,
    input: I,
    work: () => Promise<Row>,
  ): Promise<Row> {
    const fingerprint = requestFingerprint(input);
    const row = (
      await c.query<Row>(
        'SELECT * FROM recruitment_request_receipts WHERE actor_id=$1 AND client_request_id=$2 FOR SHARE',
        [a.user.id, input.clientRequestId],
      )
    ).rows[0];
    if (row) {
      if (
        row.org_id !== a.orgId ||
        row.event_id !== a.event.id ||
        row.operation !== operation ||
        row.request_hash !== fingerprint
      )
        fail('REQUEST_ID_CONFLICT', '原请求编号已用于不同操作或内容');
      return row.result;
    }
    const result = await work();
    await this.ensureFreshSession(c, a);
    const inserted = await c.query(
      'INSERT INTO recruitment_request_receipts(actor_id,client_request_id,org_id,event_id,operation,request_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING RETURNING client_request_id',
      [
        a.user.id,
        input.clientRequestId,
        a.orgId,
        a.event.id,
        operation,
        fingerprint,
        JSON.stringify(result),
      ],
    );
    if (!inserted.rowCount) fail('REQUEST_ID_CONFLICT', '请求编号正在被其他操作使用，请查询原回执');
    return result;
  }
  private publicationDto(r: Row | undefined) {
    return r
      ? {
          id: r.id,
          publicId: r.public_id,
          title: r.title,
          description: r.description,
          closesAt: iso(r.closes_at),
          maxApplications: r.max_applications,
          status: r.status,
          version: r.version,
          createdAt: iso(r.created_at),
          revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
        }
      : null;
  }
  private applicationDto(r: Row) {
    return {
      id: r.id,
      publicationId: r.publication_id,
      eventId: r.event_id,
      orgId: r.org_id,
      applicantId: r.applicant_id,
      teamId: r.team_id,
      teamName: r.team_name,
      note: r.note,
      status: r.status,
      version: r.version,
      entryId: r.entry_id,
      reviewReason: r.review_reason,
      createdAt: iso(r.created_at),
      decidedAt: r.decided_at ? iso(r.decided_at) : null,
    };
  }
  private invitationDto(r: Row) {
    return {
      id: r.id,
      orgId: r.org_id,
      eventId: r.event_id,
      teamId: r.team_id,
      targetUserId: r.target_user_id,
      status: r.status,
      version: r.version,
      entryId: r.entry_id,
      expiresAt: iso(r.expires_at),
      createdAt: iso(r.created_at),
      decidedAt: r.decided_at ? iso(r.decided_at) : null,
      ...(r.team_name ? { teamName: r.team_name } : {}),
      ...(r.event_name ? { eventName: r.event_name } : {}),
    };
  }
  private async activePublication(c: PoolClient, a: Access, id?: string, lock = false) {
    const row = (
      await c.query<Row>(
        `SELECT * FROM recruitment_publications WHERE org_id=$1 AND event_id=$2 AND status='ACTIVE' ${id ? 'AND public_id=$3' : ''} FOR ${lock ? 'UPDATE' : 'SHARE'}`,
        id ? [a.orgId, a.event.id, id] : [a.orgId, a.event.id],
      )
    ).rows[0];
    if (
      !row ||
      new Date(row.closes_at) <= a.now ||
      row.ruleset_id !== a.event.locked_ruleset_id ||
      a.event.status !== 'REGISTRATION_OPEN'
    )
      throw notFound();
    return row;
  }
  async workspace(cookie: string | undefined, org: string, event: string) {
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, event);
      this.requireManager(a);
      const publication = (
        await c.query<Row>(
          'SELECT * FROM recruitment_publications WHERE org_id=$1 AND event_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
          [a.orgId, a.event.id],
        )
      ).rows[0];
      return {
        event: {
          id: a.event.id,
          name: a.event.name,
          version: a.event.version,
          status: a.event.status,
        },
        publication: this.publicationDto(publication),
        capabilities: {
          canPublish:
            a.event.status === 'REGISTRATION_OPEN' &&
            !!a.event.locked_ruleset_id &&
            publication?.status !== 'ACTIVE',
          canRevoke: publication?.status === 'ACTIVE',
          canImport: a.admin && a.event.status === 'REGISTRATION_OPEN',
          canInvite: a.event.status === 'REGISTRATION_OPEN',
        },
      };
    });
  }
  async publish(cookie: string | undefined, org: string, event: string, raw: unknown) {
    const input = publishRecruitmentInput(raw);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, event, true);
      this.requireManager(a);
      return this.once(c, a, 'PUBLISH', input, async () => {
        await this.open(c, a);
        checkVersion(a.event.version, input.expectedEventVersion);
        if (
          Date.parse(input.closesAt) <= a.now.getTime() ||
          Date.parse(input.closesAt) > a.now.getTime() + 180 * 86400000
        )
          fail('INVALID_RECRUITMENT_DEADLINE', '招募截止须在未来180天内', 422);
        if (
          (
            await c.query(
              "SELECT id FROM recruitment_publications WHERE org_id=$1 AND event_id=$2 AND status='ACTIVE'",
              [a.orgId, a.event.id],
            )
          ).rowCount
        )
          fail('RECRUITMENT_ALREADY_PUBLISHED', '请先撤销当前招募，再生成新链接');
        const id = randomUUID();
        const row = (
          await c.query<Row>(
            'INSERT INTO recruitment_publications(id,org_id,event_id,ruleset_id,public_id,title,description,max_applications,closes_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
            [
              id,
              a.orgId,
              a.event.id,
              a.event.locked_ruleset_id,
              randomBytes(32).toString('base64url'),
              input.title,
              input.description,
              input.maxApplications,
              input.closesAt,
              a.user.id,
            ],
          )
        ).rows[0]!;
        await this.touch(c, a);
        await this.audit(c, a.user.id, a.orgId, 'recruitment.published', 'recruitment', id, {
          eventId: a.event.id,
        });
        return { publication: this.publicationDto(row), eventVersion: a.event.version };
      });
    });
  }
  async revoke(cookie: string | undefined, org: string, event: string, raw: unknown) {
    const input = revokeRecruitmentInput(raw);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, event, true);
      this.requireManager(a);
      return this.once(c, a, 'REVOKE', input, async () => {
        const row = (
          await c.query<Row>(
            "SELECT * FROM recruitment_publications WHERE org_id=$1 AND event_id=$2 AND status='ACTIVE' FOR UPDATE",
            [a.orgId, a.event.id],
          )
        ).rows[0];
        if (!row) throw notFound();
        checkVersion(row.version, input.expectedVersion);
        const updated = (
          await c.query<Row>(
            "UPDATE recruitment_publications SET status='REVOKED',version=version+1,revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason=$3 WHERE id=$1 RETURNING *",
            [row.id, a.user.id, input.reason],
          )
        ).rows[0]!;
        await this.touch(c, a);
        await this.audit(c, a.user.id, a.orgId, 'recruitment.revoked', 'recruitment', row.id);
        return { publication: this.publicationDto(updated), eventVersion: a.event.version };
      });
    });
  }
  async publicView(rawId: string, ip: string) {
    const id = publicRecruitmentId(rawId);
    await this.rateLimit(`x05:recruitment:read:${requestFingerprint(ip)}`, 120, 60);
    return this.transaction(async (c) => {
      const ref = (
        await c.query<Row>(
          'SELECT org_id,event_id FROM recruitment_publications WHERE public_id=$1',
          [id],
        )
      ).rows[0];
      if (!ref) throw notFound();
      if (
        !(
          await c.query("SELECT id FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE", [
            ref.org_id,
          ])
        ).rowCount
      )
        throw notFound();
      const event = (
        await c.query<Row>(
          `SELECT ${EVENT_SELECT} FROM events e WHERE org_id=$1 AND id=$2 FOR SHARE OF e`,
          [ref.org_id, ref.event_id],
        )
      ).rows[0];
      if (!event || event.status !== 'REGISTRATION_OPEN') throw notFound();
      const pub = (
        await c.query<Row>(
          "SELECT * FROM recruitment_publications WHERE public_id=$1 AND status='ACTIVE' AND closes_at>clock_timestamp() FOR SHARE",
          [id],
        )
      ).rows[0];
      if (!pub || pub.ruleset_id !== event.locked_ruleset_id) throw notFound();
      const rule = (
        await c.query<Row>(
          'SELECT min_players,max_players,require_identity,require_insurance,require_participant_materials FROM event_rulesets WHERE org_id=$1 AND event_id=$2 AND id=$3',
          [ref.org_id, event.id, pub.ruleset_id],
        )
      ).rows[0];
      if (!rule) throw notFound();
      return {
        publicId: id,
        title: pub.title,
        description: pub.description,
        closesAt: iso(pub.closes_at),
        event: {
          name: event.name,
          startDate: event.start_date,
          endDate: event.end_date,
          venueName: event.venue_name,
        },
        requirements: {
          minPlayers: rule.min_players,
          maxPlayers: rule.max_players,
          requireIdentity: rule.require_identity,
          requireInsurance: rule.require_insurance,
          requireParticipantMaterials: rule.require_participant_materials,
        },
        notice: '申请获准只创建队伍报名草稿，不代表名单、保险或参赛资格已经通过',
      };
    });
  }
  async apply(cookie: string | undefined, rawId: string, raw: unknown, ip: string) {
    const id = publicRecruitmentId(rawId),
      input = recruitmentApplicationInput(raw);
    await this.rateLimit(`x05:recruitment:apply:${requestFingerprint(ip)}`, 20, 60);
    return this.transaction(async (c) => {
      const ref = (
        await c.query<Row>(
          'SELECT org_id,event_id FROM recruitment_publications WHERE public_id=$1',
          [id],
        )
      ).rows[0];
      if (!ref) throw notFound();
      const a = await this.access(c, cookie, ref.org_id, ref.event_id, true);
      const pub = await this.activePublication(c, a, id, true);
      return this.once(c, a, 'APPLY', { ...input, publicId: id }, async () => {
        await this.open(c, a);
        const counts = (
          await c.query<Row>(
            'SELECT count(*)::int AS total,count(*) FILTER(WHERE applicant_id=$2)::int AS mine FROM recruitment_applications WHERE publication_id=$1',
            [pub.id, a.user.id],
          )
        ).rows[0]!;
        if (counts.total >= pub.max_applications || counts.mine >= 3)
          fail(
            'RECRUITMENT_CAPACITY_REACHED',
            '当前招募申请容量已满或本人已达到本链接申请上限',
            422,
          );
        if (
          (
            await c.query(
              "SELECT id FROM recruitment_applications WHERE publication_id=$1 AND applicant_id=$2 AND status IN ('PENDING','APPROVED')",
              [pub.id, a.user.id],
            )
          ).rowCount
        )
          fail('RECRUITMENT_ALREADY_APPLIED', '本人已有待审或通过申请，请读取原申请');
        if (input.teamId) {
          const team = await this.team(c, a, input.teamId);
          await this.teamLeader(c, a, team.id, a.user.id);
          if (normalizedName(team.name) !== normalizedName(input.teamName))
            fail('TEAM_NAME_CHANGED', '队名与所选队伍不符，请重新核对', 422);
          await this.noEntry(c, a, team.id);
        }
        const application = (
          await c.query<Row>(
            'INSERT INTO recruitment_applications(id,org_id,event_id,publication_id,applicant_id,team_id,team_name,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
            [
              randomUUID(),
              a.orgId,
              a.event.id,
              pub.id,
              a.user.id,
              input.teamId,
              input.teamName,
              input.note,
            ],
          )
        ).rows[0]!;
        await this.audit(
          c,
          a.user.id,
          a.orgId,
          'recruitment.applied',
          'recruitment-application',
          application.id,
          { eventId: a.event.id },
        );
        return { application: this.applicationDto(application) };
      });
    });
  }
  private page(raw: unknown) {
    const q = objectInput(raw ?? {}, ['before', 'limit']);
    const limit = q.limit === undefined ? 30 : Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      fail('INVALID_PAGE', '分页大小须为1–100', 400);
    let before: { at: string; id: string } | null = null;
    if (q.before !== undefined) {
      try {
        const v = JSON.parse(Buffer.from(String(q.before), 'base64url').toString('utf8'));
        if (typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))) throw new Error();
        before = { at: v.at, id: resourceId(v.id) };
      } catch {
        fail('INVALID_PAGE', '分页游标无效', 400);
      }
    }
    return { limit, before };
  }
  private pageResult(rows: Row[], limit: number, dto: (r: Row) => unknown) {
    const more = rows.length > limit,
      selected = rows.slice(0, limit),
      last = selected.at(-1);
    return {
      items: selected.map(dto),
      nextCursor:
        more && last
          ? Buffer.from(JSON.stringify({ at: iso(last.created_at), id: last.id })).toString(
              'base64url',
            )
          : null,
    };
  }
  async listApplications(cookie: string | undefined, org: string, event: string, raw: unknown) {
    const q = this.page(raw);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, event);
      this.requireManager(a);
      const rows = (
        await c.query<Row>(
          'SELECT * FROM recruitment_applications WHERE org_id=$1 AND event_id=$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5',
          [a.orgId, a.event.id, q.before?.at ?? null, q.before?.id ?? null, q.limit + 1],
        )
      ).rows;
      return this.pageResult(rows, q.limit, (r) => this.applicationDto(r));
    });
  }
  async myApplications(cookie: string | undefined, raw: unknown) {
    const q = this.page(raw);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const rows = (
        await c.query<Row>(
          "SELECT r.* FROM recruitment_applications r JOIN organizations o ON o.id=r.org_id AND o.status='ACTIVE' WHERE applicant_id=$1 AND ($2::timestamptz IS NULL OR (r.created_at,r.id)<($2::timestamptz,$3::uuid)) ORDER BY r.created_at DESC,r.id DESC LIMIT $4",
          [a.user.id, q.before?.at ?? null, q.before?.id ?? null, q.limit + 1],
        )
      ).rows;
      await this.ensureFreshSession(c, a);
      return this.pageResult(rows, q.limit, (r) => this.applicationDto(r));
    });
  }
  private async team(c: PoolClient, a: Access, id: string) {
    const row = (
      await c.query<Row>('SELECT * FROM teams WHERE org_id=$1 AND id=$2 FOR UPDATE', [a.orgId, id])
    ).rows[0];
    if (!row) throw notFound();
    return row;
  }
  private async teamLeader(c: PoolClient, a: Access, team: string, user: string) {
    if (
      !(
        await c.query(
          "SELECT user_id FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
          [a.orgId, team, user],
        )
      ).rowCount
    )
      throw forbidden();
  }
  private async noEntry(c: PoolClient, a: Access, team: string) {
    if (
      (
        await c.query('SELECT id FROM entries WHERE org_id=$1 AND event_id=$2 AND team_id=$3', [
          a.orgId,
          a.event.id,
          team,
        ])
      ).rowCount
    )
      fail('ENTRY_ALREADY_EXISTS', '本队已有本届报名，不能重复创建');
  }
  private async grantEmptyTeam(c: PoolClient, a: Access, team: string, user: string) {
    const rows = (
      await c.query<Row>(
        'SELECT user_id,status FROM team_access_grants WHERE org_id=$1 AND team_id=$2 ORDER BY user_id FOR UPDATE',
        [a.orgId, team],
      )
    ).rows;
    if (rows.some((r) => r.user_id === user && r.status === 'ACTIVE')) return;
    if (rows.some((r) => r.status === 'ACTIVE') || rows.some((r) => r.user_id === user))
      fail(
        'TEAM_LEADER_CONFIRMATION_REQUIRED',
        '本队已有领队或该授权曾被撤销，请走原队伍权限流程；邀请不能接管',
      );
    await c.query(
      "INSERT INTO team_access_grants(org_id,team_id,user_id,role,status) VALUES($1,$2,$3,'TEAM_MANAGER','ACTIVE')",
      [a.orgId, team, user],
    );
  }
  private async newTeam(c: PoolClient, a: Access, name: string) {
    if (
      (
        await c.query(`SELECT id FROM teams WHERE org_id=$1 AND ${TEAM_NAME_SQL}=$2 LIMIT 1`, [
          a.orgId,
          normalizedName(name),
        ])
      ).rowCount
    )
      fail(
        'TEAM_NAME_NEEDS_EXPLICIT_ID',
        '存在同名队伍，请明确选择原队伍或另用队名，不自动合并',
        422,
      );
    const row = (
      await c.query<Row>('INSERT INTO teams(id,org_id,name) VALUES($1,$2,$3) RETURNING *', [
        randomUUID(),
        a.orgId,
        name,
      ])
    ).rows[0]!;
    await this.audit(c, a.user.id, a.orgId, 'recruitment.team_created', 'team', row.id);
    return row;
  }
  private async draftEntry(c: PoolClient, a: Access, team: Row, createdBy: string) {
    await this.noEntry(c, a, team.id);
    const count = (
      await c.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM entries WHERE org_id=$1 AND event_id=$2 AND status NOT IN ('WITHDRAWN','REJECTED')",
        [a.orgId, a.event.id],
      )
    ).rows[0]!.count;
    if (count >= 32)
      fail('EVENT_TEAM_CAPACITY_REACHED', '本届有效报名已达到32队，请先处理现有报名', 422);
    const row = (
      await c.query<Row>(
        'INSERT INTO entries(id,org_id,event_id,team_id,team_name,ruleset_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,status',
        [
          randomUUID(),
          a.orgId,
          a.event.id,
          team.id,
          team.name,
          a.event.locked_ruleset_id,
          createdBy,
        ],
      )
    ).rows[0]!;
    await this.audit(c, a.user.id, a.orgId, 'recruitment.entry_draft_created', 'entry', row.id, {
      teamId: team.id,
      eventId: a.event.id,
    });
    return row;
  }
  async review(
    cookie: string | undefined,
    org: string,
    event: string,
    applicationId: string,
    raw: unknown,
  ) {
    const input = recruitmentReviewInput(raw),
      id = resourceId(applicationId);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, event, true);
      const row = (
        await c.query<Row>(
          'SELECT * FROM recruitment_applications WHERE org_id=$1 AND event_id=$2 AND id=$3 FOR UPDATE',
          [a.orgId, a.event.id, id],
        )
      ).rows[0];
      if (!row) throw notFound();
      if (input.type === 'WITHDRAW') {
        if (row.applicant_id !== a.user.id) throw notFound();
      } else {
        this.requireManager(a);
        if (row.applicant_id === a.user.id)
          fail('INDEPENDENT_REVIEW_REQUIRED', '本人不能审核自己的招募申请', 403);
      }
      return this.once(c, a, 'REVIEW', { ...input, applicationId: id }, async () => {
        checkVersion(row.version, input.expectedVersion);
        if (row.status !== 'PENDING')
          fail('APPLICATION_ALREADY_DECIDED', '申请已有处理结论，请读取原结果');
        let team = row.team_id ? await this.team(c, a, row.team_id) : null,
          entry: Row | null = null;
        if (input.type === 'APPROVE') {
          await this.open(c, a);
          const pub = (
            await c.query<Row>(
              "SELECT * FROM recruitment_publications WHERE id=$1 AND status='ACTIVE' AND closes_at>clock_timestamp() FOR SHARE",
              [row.publication_id],
            )
          ).rows[0];
          if (!pub || pub.ruleset_id !== a.event.locked_ruleset_id)
            fail('RECRUITMENT_NOT_ACTIVE', '原招募已失效，不能继续批准', 422);
          if (
            !(
              await c.query("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE", [
                row.applicant_id,
              ])
            ).rowCount
          )
            fail('APPLICANT_UNAVAILABLE', '申请账号不可用', 422);
          if (team) await this.teamLeader(c, a, team.id, row.applicant_id);
          else {
            team = await this.newTeam(c, a, row.team_name);
            await this.grantEmptyTeam(c, a, team.id, row.applicant_id);
          }
          entry = await this.draftEntry(c, a, team, row.applicant_id);
        }
        const status =
          input.type === 'APPROVE'
            ? 'APPROVED'
            : input.type === 'REJECT'
              ? 'REJECTED'
              : 'WITHDRAWN';
        const updated = (
          await c.query<Row>(
            'UPDATE recruitment_applications SET team_id=$2,status=$3,version=version+1,reviewed_by=$4,review_reason=$5,decided_at=clock_timestamp(),entry_id=$6 WHERE id=$1 RETURNING *',
            [
              id,
              team?.id ?? row.team_id,
              status,
              input.type === 'WITHDRAW' ? null : a.user.id,
              input.reason,
              entry?.id ?? null,
            ],
          )
        ).rows[0]!;
        if (entry) await this.touch(c, a);
        await this.audit(
          c,
          a.user.id,
          a.orgId,
          `recruitment.application.${status.toLowerCase()}`,
          'recruitment-application',
          id,
        );
        return { application: this.applicationDto(updated), eventVersion: a.event.version };
      });
    });
  }
  private async validateRows(
    c: PoolClient,
    a: Access,
    rows: ImportRow[],
    issues: ImportIssue[] = [],
  ) {
    const errors = [...issues];
    for (let n = 0; n < rows.length; n++) {
      const row = rows[n]!;
      if (!row.teamName) continue;
      const add = (field: string, code: string, message: string) =>
        errors.push({ row: n + 1, field, code, message });
      if (row.teamId) {
        const team = (
          await c.query<Row>('SELECT id,name FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
            a.orgId,
            row.teamId,
          ])
        ).rows[0];
        if (!team) add('teamId', 'TEAM_NOT_FOUND', '队伍编号不属于本机构');
        else if (normalizedName(team.name) !== normalizedName(row.teamName))
          add('teamName', 'TEAM_NAME_MISMATCH', '队名与明确选择的原队伍不符');
        if (
          (
            await c.query('SELECT id FROM entries WHERE org_id=$1 AND event_id=$2 AND team_id=$3', [
              a.orgId,
              a.event.id,
              row.teamId,
            ])
          ).rowCount
        )
          add('teamId', 'ENTRY_ALREADY_EXISTS', '本队已存在本届报名');
      } else if (
        (
          await c.query(`SELECT id FROM teams WHERE org_id=$1 AND ${TEAM_NAME_SQL}=$2 LIMIT 1`, [
            a.orgId,
            normalizedName(row.teamName),
          ])
        ).rowCount
      )
        add('teamName', 'EXISTING_NAME_REQUIRES_ID', '存在同名队伍，请明确选择编号；不自动合并');
      if (row.leaderUserId) {
        if (
          !(
            await c.query("SELECT id FROM users WHERE id=$1 AND status='ACTIVE'", [
              row.leaderUserId,
            ])
          ).rowCount
        )
          add('leaderUserId', 'LEADER_UNAVAILABLE', '领队账号不存在或不可用');
        if (
          row.teamId &&
          (
            await c.query(
              "SELECT user_id FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND (status='ACTIVE' OR user_id=$3) AND NOT(user_id=$3 AND status='ACTIVE') AND NOT EXISTS(SELECT 1 FROM team_access_grants current_leader WHERE current_leader.org_id=$1 AND current_leader.team_id=$2 AND current_leader.user_id=$3 AND current_leader.status='ACTIVE') LIMIT 1",
              [a.orgId, row.teamId, row.leaderUserId],
            )
          ).rowCount
        )
          add(
            'leaderUserId',
            'LEADER_CONFLICT',
            '已有其他领队或本人旧授权已撤销，不能通过导入接管',
          );
      }
    }
    return errors;
  }
  async previewImport(cookie: string | undefined, org: string, event: string, raw: unknown) {
    const input = importPreviewInput(raw);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, event, true);
      this.requireManager(a, true);
      return this.once(c, a, 'IMPORT_PREVIEW', input, async () => {
        checkVersion(a.event.version, input.expectedEventVersion);
        if (!['DRAFT', 'REGISTRATION_OPEN'].includes(a.event.status))
          fail('IMPORT_NOT_ALLOWED', '当前阶段不能预览新增参赛队', 422);
        const issues = await this.validateRows(c, a, input.rows, input.issues),
          id = randomUUID();
        const hash = requestFingerprint({
          eventVersion: a.event.version,
          rows: input.rows,
          issues,
        });
        const row = (
          await c.query<Row>(
            "INSERT INTO event_team_import_previews(id,org_id,event_id,actor_id,event_version,preview_hash,rows,issues,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,clock_timestamp()+interval '30 minutes') RETURNING *",
            [
              id,
              a.orgId,
              a.event.id,
              a.user.id,
              a.event.version,
              hash,
              JSON.stringify(input.rows),
              JSON.stringify(issues),
            ],
          )
        ).rows[0]!;
        return {
          preview: {
            id,
            eventVersion: a.event.version,
            previewHash: hash,
            rows: input.rows,
            issues,
            expiresAt: iso(row.expires_at),
            canCommit: issues.length === 0 && a.event.status === 'REGISTRATION_OPEN',
            blocker: a.event.status === 'DRAFT' ? 'REGISTRATION_NOT_OPEN' : null,
          },
        };
      });
    });
  }
  async commitImport(cookie: string | undefined, org: string, event: string, raw: unknown) {
    const input = importCommitInput(raw);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, event, true);
      this.requireManager(a, true);
      return this.once(c, a, 'IMPORT_COMMIT', input, async () => {
        await this.open(c, a);
        checkVersion(a.event.version, input.expectedEventVersion);
        const preview = (
          await c.query<Row>(
            'SELECT * FROM event_team_import_previews WHERE org_id=$1 AND event_id=$2 AND actor_id=$3 AND id=$4 FOR SHARE',
            [a.orgId, a.event.id, a.user.id, input.previewId],
          )
        ).rows[0];
        if (!preview || iso(preview.expires_at) <= a.now.toISOString())
          fail('IMPORT_PREVIEW_EXPIRED', '请重新预览本批资料', 422);
        if (preview.preview_hash !== input.previewHash || preview.event_version !== a.event.version)
          fail('IMPORT_PREVIEW_STALE', '预览来源已变化，请重新预览');
        const rows = preview.rows as ImportRow[],
          issues = await this.validateRows(c, a, rows, preview.issues);
        if (issues.length)
          throw new ApiError(422, 'IMPORT_ROWS_INVALID', '本批存在错误，未创建任何队伍或报名', {
            issues,
          });
        // Team locks in UUID order match existing roster/grant writers. New rows are fresh IDs.
        for (const id of [...new Set(rows.flatMap((r) => (r.teamId ? [r.teamId] : [])))].sort())
          await this.team(c, a, id);
        const entries: Row[] = [];
        for (const row of rows) {
          const team = row.teamId
            ? await this.team(c, a, row.teamId)
            : await this.newTeam(c, a, row.teamName);
          const entry = await this.draftEntry(c, a, team, a.user.id);
          let invitation: Row | null = null;
          if (row.leaderUserId) {
            const result = await this.issue(
              c,
              a,
              team.id,
              row.leaderUserId,
              new Date(a.now.getTime() + 7 * 86400000).toISOString(),
            );
            invitation = result;
          }
          entries.push({
            teamId: team.id,
            teamName: team.name,
            entryId: entry.id,
            status: entry.status,
            invitation: invitation ? this.invitationDto(invitation) : null,
          });
        }
        await this.touch(c, a);
        await this.audit(c, a.user.id, a.orgId, 'recruitment.teams_imported', 'event', a.event.id, {
          previewId: preview.id,
          count: entries.length,
        });
        return { entries, eventVersion: a.event.version };
      });
    });
  }
  private async issue(c: PoolClient, a: Access, team: string, target: string, expires: string) {
    if (
      Date.parse(expires) <= a.now.getTime() ||
      Date.parse(expires) > a.now.getTime() + 7 * 86400000
    )
      fail('INVALID_INVITATION_EXPIRY', '邀请须在未来7天内有效', 422);
    if (
      !(await c.query("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE", [target]))
        .rowCount
    )
      fail('INVITEE_UNAVAILABLE', '接收账号不可用', 422);
    if (
      (
        await c.query(
          "SELECT id FROM event_invitations WHERE org_id=$1 AND event_id=$2 AND team_id=$3 AND target_user_id=$4 AND status='PENDING'",
          [a.orgId, a.event.id, team, target],
        )
      ).rowCount
    )
      fail('INVITATION_ALREADY_EXISTS', '已有待处理的本届邀请，请读取原邀请');
    return (
      await c.query<Row>(
        'INSERT INTO event_invitations(id,org_id,event_id,team_id,target_user_id,issued_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [randomUUID(), a.orgId, a.event.id, team, target, a.user.id, expires],
      )
    ).rows[0]!;
  }
  async invite(cookie: string | undefined, org: string, event: string, raw: unknown) {
    const input = eventInvitationInput(raw);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, event, true);
      this.requireManager(a);
      return this.once(c, a, 'INVITE', input, async () => {
        await this.open(c, a);
        checkVersion(a.event.version, input.expectedEventVersion);
        await this.team(c, a, input.teamId);
        const invitation = await this.issue(
          c,
          a,
          input.teamId,
          input.targetUserId,
          input.expiresAt,
        );
        await this.audit(
          c,
          a.user.id,
          a.orgId,
          'recruitment.invitation_issued',
          'event-invitation',
          invitation.id,
        );
        return { invitation: this.invitationDto(invitation) };
      });
    });
  }
  async invitations(cookie: string | undefined, org: string, event: string, raw: unknown) {
    const q = this.page(raw);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, event);
      this.requireManager(a);
      const rows = (
        await c.query<Row>(
          'SELECT i.*,t.name AS team_name FROM event_invitations i JOIN teams t ON t.org_id=i.org_id AND t.id=i.team_id WHERE i.org_id=$1 AND i.event_id=$2 AND ($3::timestamptz IS NULL OR(i.created_at,i.id)<($3::timestamptz,$4::uuid)) ORDER BY i.created_at DESC,i.id DESC LIMIT $5',
          [a.orgId, a.event.id, q.before?.at ?? null, q.before?.id ?? null, q.limit + 1],
        )
      ).rows;
      return this.pageResult(rows, q.limit, (r) => this.invitationDto(r));
    });
  }
  async myInvitations(cookie: string | undefined, raw: unknown) {
    const q = this.page(raw);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const rows = (
        await c.query<Row>(
          "SELECT i.*,t.name AS team_name,e.name AS event_name FROM event_invitations i JOIN organizations o ON o.id=i.org_id AND o.status='ACTIVE' JOIN teams t ON t.org_id=i.org_id AND t.id=i.team_id JOIN events e ON e.org_id=i.org_id AND e.id=i.event_id WHERE i.target_user_id=$1 AND ($2::timestamptz IS NULL OR(i.created_at,i.id)<($2::timestamptz,$3::uuid)) ORDER BY i.created_at DESC,i.id DESC LIMIT $4",
          [a.user.id, q.before?.at ?? null, q.before?.id ?? null, q.limit + 1],
        )
      ).rows;
      await this.ensureFreshSession(c, a);
      return this.pageResult(rows, q.limit, (r) => this.invitationDto(r));
    });
  }
  async invitationDecision(cookie: string | undefined, invitationId: string, raw: unknown) {
    const input = eventInvitationDecisionInput(raw),
      id = resourceId(invitationId);
    return this.transaction(async (c) => {
      const ref = (
        await c.query<Row>('SELECT org_id,event_id FROM event_invitations WHERE id=$1', [id])
      ).rows[0];
      if (!ref) throw notFound();
      const a = await this.access(c, cookie, ref.org_id, ref.event_id, true);
      const row = (
        await c.query<Row>(
          'SELECT * FROM event_invitations WHERE org_id=$1 AND event_id=$2 AND id=$3 FOR UPDATE',
          [a.orgId, a.event.id, id],
        )
      ).rows[0]!;
      if (input.type === 'REVOKE') this.requireManager(a);
      else if (row.target_user_id !== a.user.id) throw notFound();
      return this.once(c, a, 'INVITATION_DECIDE', { ...input, invitationId: id }, async () => {
        checkVersion(row.version, input.expectedVersion);
        if (row.status !== 'PENDING')
          fail('INVITATION_ALREADY_DECIDED', '邀请已处理，请读取原结果');
        let entryId: string | null = null;
        if (input.type === 'ACCEPT') {
          await this.open(c, a);
          if (new Date(row.expires_at) <= a.now) fail('INVITATION_EXPIRED', '邀请已到期', 422);
          const issuer = (
            await c.query<Row>(
              "SELECT u.id FROM users u JOIN organization_memberships m ON m.user_id=u.id AND m.org_id=$2 AND m.status='ACTIVE' AND m.updated_at<=$3 WHERE u.id=$1 AND u.status='ACTIVE' AND (m.role IN ('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff s WHERE s.org_id=m.org_id AND s.event_id=$4 AND s.user_id=u.id AND s.status='ACTIVE' AND s.role='EVENT_MANAGER' AND s.updated_at<=$3)) FOR SHARE OF u,m",
              [row.issued_by, a.orgId, row.created_at, a.event.id],
            )
          ).rows[0];
          if (!issuer)
            fail('INVITATION_ISSUER_UNAVAILABLE', '原邀请者权限已失效，请重新取得邀请', 422);
          const team = await this.team(c, a, row.team_id);
          await this.grantEmptyTeam(c, a, team.id, a.user.id);
          const existing = (
            await c.query<Row>(
              'SELECT id,status,created_by FROM entries WHERE org_id=$1 AND event_id=$2 AND team_id=$3 FOR UPDATE',
              [a.orgId, a.event.id, team.id],
            )
          ).rows[0];
          if (existing) {
            if (existing.status !== 'DRAFT')
              fail('ENTRY_ALREADY_EXISTS', '本届已有非草稿报名，请走现有名单流程');
            entryId = existing.id;
          } else entryId = (await this.draftEntry(c, a, team, a.user.id)).id;
          await this.touch(c, a);
        }
        const status =
          input.type === 'ACCEPT' ? 'ACCEPTED' : input.type === 'DECLINE' ? 'DECLINED' : 'REVOKED';
        const updated = (
          await c.query<Row>(
            'UPDATE event_invitations SET status=$2,version=version+1,decided_at=clock_timestamp(),entry_id=$3 WHERE id=$1 RETURNING *',
            [id, status, entryId],
          )
        ).rows[0]!;
        await this.audit(
          c,
          a.user.id,
          a.orgId,
          `recruitment.invitation.${status.toLowerCase()}`,
          'event-invitation',
          id,
        );
        return { invitation: this.invitationDto(updated), eventVersion: a.event.version };
      });
    });
  }
  async receipt(cookie: string | undefined, rawId: string) {
    const id = requestId(rawId);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const row = (
        await c.query<Row>(
          'SELECT * FROM recruitment_request_receipts WHERE actor_id=$1 AND client_request_id=$2',
          [actor.user.id, id],
        )
      ).rows[0];
      if (!row) throw notFound();
      const a = await this.access(c, cookie, row.org_id, row.event_id);
      const own =
        row.operation === 'APPLY' ||
        row.operation === 'INVITATION_DECIDE' ||
        (row.operation === 'REVIEW' && row.result?.application?.applicantId === a.user.id);
      if (!own) this.requireManager(a, row.operation.startsWith('IMPORT_'));
      return { clientRequestId: id, operation: row.operation, result: row.result };
    });
  }
}
