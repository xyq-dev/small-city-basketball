import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { OrgRole } from '@small-city-basketball/contracts';
import { ApiError, forbidden, notFound } from './errors.js';
import { ApplicationService, isAdministrator } from './service.js';
import type { Actor, ApiOptions } from './service.js';
import { objectInput, resourceId } from './validation.js';
import {
  PARTICIPANT_TERMS_VERSION,
  decryptParticipantPayload,
  encryptParticipantPayload,
  maskParticipantIdentity,
  mergeParticipantDraft,
  parseParticipantDraft,
  parseParticipantReview,
  parseParticipantVersion,
  participantEligibility,
  participantIdentityDigest,
  participantKey,
  participantKeyId,
  participantRequestFingerprint,
} from './participant-materials-domain.js';
import type {
  ParticipantPrivatePayload,
  StoredParticipantFile,
} from './participant-materials-domain.js';
import { assertParticipantKeyConsistency } from './participant-materials-eligibility.js';
import { MEDIA_ORG_LIMIT_BYTES } from './media-domain.js';
import { fenceYouthSubject } from './youth-permission-fence.js';
import {
  readParticipantDataConsent,
  readParticipantMaterialGuards,
} from './participant-materials-guards.js';
import type { ParticipantMaterialGuards } from './participant-materials-guards.js';

type Row = Record<string, any>;
type Context = Actor & { orgId: string; role: OrgRole | null };
interface Access {
  ctx: Context;
  event: Row;
  team: Row;
  entry: Row;
  rules: Row;
  frozen: boolean;
  leader: boolean;
  reader: boolean;
  reviewer: boolean;
  key: Buffer;
  keyId: string;
}
const conflict = (code: string, message: string) => new ApiError(409, code, message);
const fileMeta = (file: StoredParticipantFile | null) =>
  file
    ? {
        fileName: file.fileName,
        contentType: file.contentType,
        byteLength: file.byteLength,
        sha256: file.sha256,
      }
    : null;
const maskPolicy = (value: string | null) => (value ? `****${value.slice(-4)}` : null);
const HEAD_SELECT = `m.*,r.id AS revision_id,r.client_request_id,r.request_fingerprint,r.ruleset_id,
  r.roster_revision_id,r.jersey_no,r.key_id AS revision_key_id,r.payload_ciphertext,
  r.has_identity,r.has_real_name,r.has_signature,r.terms_version,r.portrait_sha256,r.portrait_bytes,r.insurance_bytes,
  r.insurance_start_date::text,r.insurance_end_date::text,r.purged_at,
  m.reviewed_start_date::text,m.reviewed_end_date::text,
  p.name AS saved_member_name`;
const HEAD_FROM = `participant_materials m LEFT JOIN participant_material_revisions r ON r.id=m.current_revision_id AND r.material_id=m.id
  LEFT JOIN entry_roster_players p ON p.org_id=r.org_id AND p.revision_id=r.roster_revision_id AND p.member_id=r.member_id`;
const stateWritable = (a: Access) =>
  !a.frozen &&
  ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(a.event.status) &&
  !['WITHDRAWN', 'REJECTED'].includes(a.entry.status) &&
  Boolean(a.rules.require_participant_materials);

/** Private per-person material storage. ENTRY media/team-manager grants never authorize private reads. */
export class ParticipantMaterialsService extends ApplicationService {
  private readonly rawKey: string | undefined;
  constructor(
    pool: Pool,
    options: ApiOptions & { participantDataKey?: string },
    private readonly guards: ParticipantMaterialGuards = {},
  ) {
    super(pool, options);
    this.rawKey = options.participantDataKey;
  }
  private async context(
    c: PoolClient,
    cookie: string | undefined,
    org: string,
    writing: boolean,
    youthDeclarationEntry?: string,
  ): Promise<Context> {
    const actor = await this.lockActor(c, cookie);
    const orgId = resourceId(org);
    if (youthDeclarationEntry) {
      // A first material in any enabled youth context changes the global public gate,
      // including archives sourced from other events. Fence its already-shared user
      // tuple before event locks; existing declarations and receipt replays need none.
      const first = (
        await c.query(
          `SELECT 1 FROM entries en JOIN youth_event_policies p ON p.org_id=en.org_id AND p.event_id=en.event_id AND p.enabled
        WHERE en.org_id=$1 AND en.id=$2 AND NOT EXISTS(SELECT 1 FROM youth_guardian_preconsents g JOIN youth_event_policies gp ON gp.org_id=g.org_id AND gp.event_id=g.event_id AND gp.enabled WHERE g.subject_user_id=$3)
        AND NOT EXISTS(SELECT 1 FROM participant_materials m JOIN youth_event_policies mp ON mp.org_id=m.org_id AND mp.event_id=m.event_id AND mp.enabled WHERE m.user_id=$3)`,
          [orgId, resourceId(youthDeclarationEntry), actor.user.id],
        )
      ).rowCount;
      if (first) await fenceYouthSubject(c, actor.user.id);
    }
    const organization = await c.query(
      `SELECT id FROM organizations WHERE id=$1 AND status='ACTIVE' FOR ${writing ? 'UPDATE' : 'SHARE'}`,
      [orgId],
    );
    if (!organization.rowCount) throw notFound();
    const member = await c.query(
      'SELECT role,status FROM organization_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE',
      [orgId, actor.user.id],
    );
    return {
      ...actor,
      orgId,
      role: member.rows[0]?.status === 'ACTIVE' ? member.rows[0].role : null,
    };
  }
  private async access(
    c: PoolClient,
    cookie: string | undefined,
    org: string,
    entryId: string,
    writing = false,
    youthDeclaration = false,
  ): Promise<Access> {
    const ctx = await this.context(c, cookie, org, writing, youthDeclaration ? entryId : undefined);
    const route = (
      await c.query('SELECT event_id,team_id FROM entries WHERE org_id=$1 AND id=$2', [
        ctx.orgId,
        resourceId(entryId),
      ])
    ).rows[0];
    if (!route) throw notFound();
    const event = (
      await c.query(
        `SELECT e.*,e.start_date::text,e.end_date::text FROM events e WHERE org_id=$1 AND id=$2 FOR ${writing ? 'UPDATE' : 'SHARE'}`,
        [ctx.orgId, route.event_id],
      )
    ).rows[0];
    if (!event) throw notFound();
    const team = (
      await c.query(
        `SELECT * FROM teams WHERE org_id=$1 AND id=$2 FOR ${writing ? 'UPDATE' : 'SHARE'}`,
        [ctx.orgId, route.team_id],
      )
    ).rows[0];
    if (!team) throw notFound();
    const entry = (
      await c.query(
        `SELECT * FROM entries WHERE org_id=$1 AND id=$2 FOR ${writing ? 'UPDATE' : 'SHARE'}`,
        [ctx.orgId, entryId],
      )
    ).rows[0];
    if (!entry) throw notFound();
    const rules = (
      await c.query('SELECT * FROM event_rulesets WHERE org_id=$1 AND event_id=$2 AND id=$3', [
        ctx.orgId,
        event.id,
        entry.ruleset_id,
      ])
    ).rows[0];
    if (!rules) throw notFound();
    const staff = (
      await c.query(
        "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
        [ctx.orgId, event.id, ctx.user.id],
      )
    ).rows[0];
    const grants = await c.query(
      "SELECT 1 FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
      [ctx.orgId, team.id, ctx.user.id],
    );
    const associated = await c.query(
      "SELECT 1 FROM team_member_bindings WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE'",
      [ctx.orgId, team.id, ctx.user.id],
    );
    const leader = Boolean(grants.rowCount);
    const staffReviewer = Boolean(
      (ctx.role && isAdministrator(ctx.role)) ||
      (ctx.role !== null && ['EVENT_MANAGER', 'REVIEWER'].includes(staff?.role)),
    );
    const reviewer =
      staffReviewer && !leader && !associated.rowCount && entry.last_submitted_by !== ctx.user.id;
    const frozen = Boolean(
      (
        await c.query('SELECT 1 FROM registration_freezes WHERE org_id=$1 AND event_id=$2', [
          ctx.orgId,
          event.id,
        ])
      ).rowCount,
    );
    const key = participantKey(this.rawKey);
    const keyId = participantKeyId(key);
    await assertParticipantKeyConsistency(c, keyId, writing);
    return {
      ctx,
      event,
      team,
      entry,
      rules,
      frozen,
      leader,
      reader: staffReviewer || leader,
      reviewer,
      key,
      keyId,
    };
  }
  private async head(c: PoolClient, a: Access, memberId: string): Promise<Row | null> {
    const found = await c.query(
      `SELECT ${HEAD_SELECT} FROM ${HEAD_FROM} WHERE m.org_id=$1 AND m.entry_id=$2 AND m.member_id=$3`,
      [a.ctx.orgId, a.entry.id, resourceId(memberId)],
    );
    return found.rows[0] ?? null;
  }
  private async roster(c: PoolClient, a: Access) {
    return (
      await c.query(
        'SELECT member_id,name,jersey_no FROM entry_roster_players WHERE org_id=$1 AND entry_id=$2 AND revision_id=$3 ORDER BY member_id',
        [a.ctx.orgId, a.entry.id, a.entry.roster_revision_id],
      )
    ).rows;
  }
  private async binding(c: PoolClient, a: Access, memberId: string): Promise<Row | null> {
    const found = await c.query(
      `SELECT b.* FROM team_member_bindings b
      JOIN team_members m ON m.org_id=b.org_id AND m.team_id=b.team_id AND m.id=b.member_id AND m.status='ACTIVE'
      JOIN users u ON u.id=b.user_id AND u.status='ACTIVE'
      WHERE b.org_id=$1 AND b.team_id=$2 AND b.member_id=$3 AND b.status='ACTIVE' FOR SHARE OF b,m`,
      [a.ctx.orgId, a.team.id, memberId],
    );
    return found.rows[0] ?? null;
  }
  private async mine(c: PoolClient, a: Access, requireCurrent = false) {
    const players = await this.roster(c, a);
    for (const player of players) {
      const binding = await this.binding(c, a, player.member_id);
      if (binding?.user_id === a.ctx.user.id) {
        const head = await this.head(c, a, player.member_id);
        if (head && head.user_id !== a.ctx.user.id)
          throw conflict(
            'PARTICIPANT_BINDING_CHANGED',
            '该成员已有其他账号的报名资料，请联系主办方核对',
          );
        return {
          memberId: player.member_id,
          memberName: player.name,
          jerseyNo: player.jersey_no,
          binding,
          head,
          current: true,
        };
      }
    }
    if (!requireCurrent) {
      const row = (
        await c.query(
          `SELECT ${HEAD_SELECT} FROM ${HEAD_FROM} WHERE m.org_id=$1 AND m.entry_id=$2 AND m.user_id=$3`,
          [a.ctx.orgId, a.entry.id, a.ctx.user.id],
        )
      ).rows[0];
      if (row)
        return {
          memberId: row.member_id,
          memberName: row.saved_member_name,
          jerseyNo: row.jersey_no,
          binding: null,
          head: row,
          current: false,
        };
    }
    throw notFound();
  }
  private payload(a: Access, row: Row): ParticipantPrivatePayload {
    if (!row.payload_ciphertext)
      throw new ApiError(410, 'PARTICIPANT_MATERIALS_PURGED', '私有资料已按保留规则清除');
    return decryptParticipantPayload(row.payload_ciphertext, a.key, {
      orgId: a.ctx.orgId,
      eventId: a.event.id,
      entryId: a.entry.id,
      memberId: row.member_id,
      userId: row.user_id,
      revisionId: row.revision_id,
    });
  }
  private async assessment(
    c: PoolClient,
    a: Access,
    row: Row | null,
    binding: Row | null,
    jerseyNo: string,
    requireApproval = true,
  ) {
    const guard = await readParticipantMaterialGuards(
      c,
      this.guards,
      {
        orgId: a.ctx.orgId,
        eventId: a.event.id,
        entryId: a.entry.id,
        memberId: row?.member_id ?? binding?.member_id,
        userId: row?.user_id ?? binding?.user_id,
        identityNumber:
          row?.payload_ciphertext && !row.purged_at ? this.payload(a, row).identityNumber : null,
        rosterRevisionId: a.entry.roster_revision_id,
        rulesetId: a.entry.ruleset_id,
        policyDate: a.event.start_date,
        startDate: a.event.start_date,
        endDate: a.event.end_date,
      },
      a.rules.require_insurance,
    );
    const assessed = participantEligibility({
      required: true,
      requireInsurance: a.rules.require_insurance,
      onlineInsuranceReady: guard.onlineInsuranceReady,
      keyAvailable: !row || (row.key_id === a.keyId && row.revision_key_id === a.keyId),
      bindingActive: Boolean(
        binding &&
        row &&
        binding.id === row.binding_id &&
        binding.user_id === row.user_id &&
        row.reservation_active,
      ),
      rulesetId: a.entry.ruleset_id,
      rosterRevisionId: a.entry.roster_revision_id,
      jerseyNo,
      eventStartDate: a.event.start_date,
      eventEndDate: a.event.end_date,
      requireApproval,
      material: row?.revision_id
        ? {
            status: row.status,
            rulesetId: row.ruleset_id,
            rosterRevisionId: row.roster_revision_id,
            jerseyNo: row.jersey_no,
            termsVersion: row.has_signature ? row.terms_version : null,
            hasIdentity: row.has_identity,
            hasRealName: row.has_real_name,
            hasPortrait: row.portrait_bytes > 0,
            hasInsurance: row.insurance_bytes > 0,
            insuranceStartDate: row.insurance_start_date,
            insuranceEndDate: row.insurance_end_date,
            reviewedStartDate: row.reviewed_start_date,
            reviewedEndDate: row.reviewed_end_date,
            purged: Boolean(row.purged_at),
          }
        : null,
    });
    if (!guard.dataConsent.ready)
      assessed.blockers.push({
        code: 'YOUTH_DATA_PROCESSING_CONSENT_REQUIRED',
        message: '当前资料处理监护同意尚未完成',
      });
    if (!guard.participationReady)
      assessed.blockers.push({
        code: 'YOUTH_PARTICIPATION_BLOCKED',
        message: '当前参赛监护确认尚未完成',
      });
    return {
      ...assessed,
      eligible: assessed.blockers.length === 0,
      dataConsent: guard.dataConsent,
      onlineInsuranceReady: guard.onlineInsuranceReady,
      onlineInsuranceOrderId: guard.onlineInsuranceOrderId,
    };
  }
  private async dataConsent(
    c: PoolClient,
    a: Access,
    userId: string,
    identityNumber: string | null,
    memberId?: string,
  ) {
    return readParticipantDataConsent(c, this.guards, {
      orgId: a.ctx.orgId,
      eventId: a.event.id,
      userId,
      entryId: a.entry.id,
      memberId,
      identityNumber,
      policyDate: a.event.start_date,
    });
  }
  private async requireDataConsent(
    c: PoolClient,
    a: Access,
    userId: string,
    identityNumber: string | null,
    memberId?: string,
  ) {
    const result = await this.dataConsent(c, a, userId, identityNumber, memberId);
    if (!result.ready)
      throw conflict(
        'YOUTH_DATA_PROCESSING_CONSENT_REQUIRED',
        '请先完成当前监护人数据处理同意，再填写或查看私有资料',
      );
    return result;
  }
  private async dto(
    c: PoolClient,
    a: Access,
    row: Row | null,
    player: Row,
    privateAllowed: boolean,
  ) {
    const binding = await this.binding(c, a, player.member_id);
    const assessed = await this.assessment(c, a, row, binding, player.jersey_no);
    privateAllowed = privateAllowed && assessed.dataConsent.ready;
    if (!row)
      return {
        id: null,
        memberId: player.member_id,
        memberName: player.name,
        status: 'MISSING',
        storedStatus: null,
        version: 0,
        revisionId: null,
        clientRequestId: null,
        realName: null,
        identityMasked: null,
        portrait: null,
        insurance: null,
        acceptedTerms: false,
        publicityConsent: false,
        reviewReason: null,
        reviewedAt: null,
        blockers: assessed.blockers,
        capabilities: { canReview: false, canReadPrivate: false },
      };
    const payload = privateAllowed && row.payload_ciphertext ? this.payload(a, row) : null;
    const stale = assessed.blockers.some((b) =>
      ['MATERIALS_OUTDATED', 'REVIEW_OUTDATED', 'BINDING_REQUIRED', 'MATERIALS_EXPIRED'].includes(
        b.code,
      ),
    );
    return {
      id: row.id,
      memberId: row.member_id,
      memberName: player.name ?? row.saved_member_name ?? '',
      status: stale ? 'STALE' : row.status,
      storedStatus: row.status,
      version: row.version,
      revisionId: row.revision_id,
      clientRequestId: row.client_request_id,
      realName: payload?.realName ?? null,
      identityMasked: payload ? maskParticipantIdentity(payload.identityNumber) : null,
      portrait: payload ? fileMeta(payload.portrait) : null,
      insurance: payload?.insurance
        ? {
            insurer: payload.insurance.insurer,
            policyNumberMasked: maskPolicy(payload.insurance.policyNumber),
            startDate: payload.insurance.startDate,
            endDate: payload.insurance.endDate,
            document: fileMeta(payload.insurance.document),
          }
        : null,
      onlineInsurance: assessed.onlineInsuranceReady
        ? { ready: true, orderId: assessed.onlineInsuranceOrderId }
        : null,
      acceptedTerms: Boolean(
        row.has_signature &&
        row.terms_version === PARTICIPANT_TERMS_VERSION &&
        row.ruleset_id === a.entry.ruleset_id &&
        row.roster_revision_id === a.entry.roster_revision_id &&
        row.jersey_no === player.jersey_no,
      ),
      publicityConsent: row.publicity_consent,
      reviewReason: row.review_reason,
      reviewedAt: row.reviewed_at?.toISOString() ?? null,
      blockers: assessed.blockers,
      capabilities: {
        canReview: a.reviewer && stateWritable(a) && row.status === 'SUBMITTED',
        canReadPrivate: privateAllowed && !row.purged_at,
      },
    };
  }
  private async mineDto(
    c: PoolClient,
    a: Access,
    mine: Awaited<ReturnType<ParticipantMaterialsService['mine']>>,
  ) {
    const consent = await this.dataConsent(
      c,
      a,
      mine.head?.user_id ?? a.ctx.user.id,
      mine.head?.payload_ciphertext && !mine.head.purged_at
        ? this.payload(a, mine.head).identityNumber
        : null,
      mine.binding?.member_id ?? mine.head?.member_id,
    );
    const canSubmit = Boolean(
      mine.head &&
      ['DRAFT', 'CHANGES_REQUESTED'].includes(mine.head.status) &&
      (await this.assessment(c, a, mine.head, mine.binding, mine.jerseyNo, false)).eligible,
    );
    const material = mine.head
      ? await this.dto(
          c,
          a,
          mine.head,
          { member_id: mine.memberId, name: mine.memberName, jersey_no: mine.jerseyNo },
          true,
        )
      : null;
    return {
      entryId: a.entry.id,
      eventId: a.event.id,
      memberId: mine.memberId,
      eventName: a.event.name,
      teamName: a.team.name,
      startDate: a.event.start_date,
      endDate: a.event.end_date,
      rules: {
        requireInsurance: a.rules.require_insurance,
        termsVersion: PARTICIPANT_TERMS_VERSION,
      },
      enabled: Boolean(a.rules.require_participant_materials),
      frozen: a.frozen,
      dataProcessingConsent: consent,
      material,
      capabilities: {
        canSave: mine.current && stateWritable(a) && consent.ready,
        canSubmit: mine.current && stateWritable(a) && canSubmit,
        canWithdrawPublicity: Boolean(mine.head?.publicity_consent),
      },
    };
  }
  private writable(a: Access) {
    if (a.frozen) throw conflict('REGISTRATION_FROZEN', '报名名单已冻结，不能替换或审核本人资料');
    if (!stateWritable(a))
      throw conflict('PARTICIPANT_MATERIALS_CLOSED', '当前报名状态不允许修改本人资料');
  }
  private checkVersion(row: Row | null, expected: number) {
    if ((row?.version ?? 0) !== expected)
      throw new ApiError(409, 'VERSION_CONFLICT', '本人资料已更新，请重新读取后操作', {
        currentVersion: row?.version ?? 0,
      });
  }
  async getMine(cookie: string | undefined, org: string, entry: string) {
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry);
      const mine = await this.mine(c, a);
      await this.ensureFreshSession(c, a.ctx);
      return this.mineDto(c, a, mine);
    });
  }
  async list(cookie: string | undefined, org: string, entry: string) {
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry);
      if (!a.reader) throw notFound();
      const members = [];
      for (const p of await this.roster(c, a))
        members.push(await this.dto(c, a, await this.head(c, a, p.member_id), p, a.reviewer));
      await this.ensureFreshSession(c, a.ctx);
      return {
        entryId: a.entry.id,
        eventName: a.event.name,
        teamName: a.team.name,
        enabled: Boolean(a.rules.require_participant_materials),
        frozen: a.frozen,
        members,
      };
    });
  }
  async getMember(cookie: string | undefined, org: string, entry: string, member: string) {
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry);
      const row = await this.head(c, a, member);
      if (!row || (!a.reviewer && row.user_id !== a.ctx.user.id)) throw notFound();
      const p = (await this.roster(c, a)).find((v) => v.member_id === member) ?? {
        member_id: member,
        name: row.saved_member_name,
        jersey_no: row.jersey_no,
      };
      await this.ensureFreshSession(c, a.ctx);
      return this.dto(c, a, row, p, true);
    });
  }
  async privateDetails(cookie: string | undefined, org: string, entry: string, member: string) {
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry);
      const row = await this.head(c, a, member);
      if (!row || (!a.reviewer && row.user_id !== a.ctx.user.id)) throw notFound();
      await this.ensureFreshSession(c, a.ctx);
      const payload = this.payload(a, row);
      await this.requireDataConsent(c, a, row.user_id, payload.identityNumber, row.member_id);
      await this.audit(
        c,
        a.ctx.user.id,
        a.ctx.orgId,
        'PARTICIPANT_PRIVATE_READ',
        'participant_material',
        row.id,
        { revisionId: row.revision_id },
      );
      return {
        realName: payload.realName,
        identityNumber: payload.identityNumber,
        insurance: payload.insurance
          ? {
              insurer: payload.insurance.insurer,
              policyNumber: payload.insurance.policyNumber,
              startDate: payload.insurance.startDate,
              endDate: payload.insurance.endDate,
            }
          : null,
      };
    });
  }
  async file(cookie: string | undefined, org: string, entry: string, member: string, kind: string) {
    if (!['portrait', 'insurance'].includes(kind)) throw notFound();
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry);
      const row = await this.head(c, a, member);
      if (!row || (!a.reviewer && row.user_id !== a.ctx.user.id)) throw notFound();
      const payload = this.payload(a, row);
      await this.requireDataConsent(c, a, row.user_id, payload.identityNumber, row.member_id);
      const file = kind === 'portrait' ? payload.portrait : payload.insurance?.document;
      if (!file) throw notFound();
      await this.ensureFreshSession(c, a.ctx);
      await this.audit(
        c,
        a.ctx.user.id,
        a.ctx.orgId,
        'PARTICIPANT_FILE_READ',
        'participant_material',
        row.id,
        { revisionId: row.revision_id, kind },
      );
      return {
        body: Buffer.from(file.base64, 'base64'),
        contentType: file.contentType,
        fileName: file.fileName,
        attachment: file.contentType === 'application/pdf',
      };
    });
  }
  private async releaseInvalidReservations(c: PoolClient, a: Access) {
    await c.query(
      `UPDATE participant_materials m SET reservation_active=false,updated_at=clock_timestamp()
      WHERE m.org_id=$1 AND m.event_id=$2 AND m.reservation_active AND (
        EXISTS(SELECT 1 FROM entries e WHERE e.id=m.entry_id AND e.status IN ('WITHDRAWN','REJECTED'))
        OR NOT EXISTS(SELECT 1 FROM entries e JOIN entry_roster_players p ON p.org_id=e.org_id AND p.entry_id=e.id AND p.revision_id=e.roster_revision_id
          WHERE e.id=m.entry_id AND p.member_id=m.member_id)
        OR NOT EXISTS(SELECT 1 FROM team_member_bindings b JOIN team_members tm ON tm.org_id=b.org_id AND tm.team_id=b.team_id AND tm.id=b.member_id AND tm.status='ACTIVE'
          JOIN users u ON u.id=b.user_id AND u.status='ACTIVE'
          WHERE b.id=m.binding_id AND b.org_id=m.org_id AND b.team_id=m.team_id AND b.member_id=m.member_id AND b.user_id=m.user_id AND b.status='ACTIVE'))`,
      [a.ctx.orgId, a.event.id],
    );
  }
  async save(cookie: string | undefined, org: string, entry: string, raw: unknown) {
    const input = parseParticipantDraft(raw);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry, true, true);
      let mine = await this.mine(c, a, true);
      const fingerprint = participantRequestFingerprint(input, a.key, [
        a.ctx.orgId,
        a.entry.id,
        a.ctx.user.id,
        'SAVE',
      ]);
      const receipt = (
        await c.query(
          'SELECT * FROM participant_material_revisions WHERE user_id=$1 AND client_request_id=$2',
          [a.ctx.user.id, input.clientRequestId],
        )
      ).rows[0];
      if (receipt) {
        if (
          receipt.org_id !== a.ctx.orgId ||
          receipt.entry_id !== a.entry.id ||
          receipt.member_id !== mine.memberId ||
          receipt.request_fingerprint !== fingerprint
        )
          throw conflict(
            'PARTICIPANT_REQUEST_CONFLICT',
            '该请求编号已用于不同的资料，请保留原记录并核对结果',
          );
        await this.ensureFreshSession(c, a.ctx);
        return {
          ...(await this.mineDto(c, a, mine)),
          receipt: {
            clientRequestId: input.clientRequestId,
            revisionId: receipt.id,
            isCurrent: mine.head?.revision_id === receipt.id,
            currentVersion: mine.head?.version ?? 0,
          },
        };
      }
      this.writable(a);
      this.checkVersion(mine.head, input.expectedVersion);
      if (mine.head && mine.head.binding_id !== mine.binding!.id)
        throw conflict('PARTICIPANT_BINDING_CHANGED', '本人账号绑定已变更，请联系主办方核对');
      const previous = mine.head ? this.payload(a, mine.head) : null;
      await this.requireDataConsent(
        c,
        a,
        a.ctx.user.id,
        input.identityNumber === undefined
          ? (previous?.identityNumber ?? null)
          : input.identityNumber,
        mine.binding!.member_id,
      );
      if (previous) previous.publicityConsent = mine.head!.publicity_consent;
      const payload = await mergeParticipantDraft(previous, input);
      if (
        mine.head &&
        (mine.head.ruleset_id !== a.entry.ruleset_id ||
          mine.head.roster_revision_id !== a.entry.roster_revision_id ||
          mine.head.jersey_no !== mine.jerseyNo) &&
        input.acceptedTerms !== true
      ) {
        payload.acceptedTerms = false;
        payload.termsVersion = null;
      }
      const id = mine.head?.id ?? randomUUID();
      const revisionId = randomUUID();
      const cipher = encryptParticipantPayload(payload, a.key, {
        orgId: a.ctx.orgId,
        eventId: a.event.id,
        entryId: a.entry.id,
        memberId: mine.memberId,
        userId: a.ctx.user.id,
        revisionId,
      });
      const bytes = Buffer.byteLength(cipher);
      if (bytes > 36 * 1024 * 1024)
        throw new ApiError(422, 'PARTICIPANT_STORAGE_LIMIT', '处理后的本人资料总大小超过上限');
      const usage = (
        await c.query(
          `SELECT COALESCE(sum(payload_byte_length) FILTER(WHERE payload_ciphertext IS NOT NULL),0)::bigint AS used,count(*)::int AS revisions,
        count(*) FILTER(WHERE material_id=$2)::int AS own FROM participant_material_revisions WHERE org_id=$1`,
          [a.ctx.orgId, id],
        )
      ).rows[0];
      const shared = (
        await c.query(
          `SELECT
        (SELECT COALESCE(sum(byte_length),0)::bigint FROM media_files WHERE org_id=$1 AND payload IS NOT NULL) AS used,
        (SELECT COALESCE(sum(byte_length),0)::bigint FROM media_upload_sessions WHERE org_id=$1 AND status='OPEN' AND expires_at>now()) AS reserved`,
          [a.ctx.orgId],
        )
      ).rows[0];
      if (
        Number(usage.used) + Number(shared.used) + Number(shared.reserved) + bytes >
          MEDIA_ORG_LIMIT_BYTES ||
        usage.revisions >= 8192 ||
        usage.own >= 128
      )
        throw new ApiError(
          422,
          'PARTICIPANT_STORAGE_LIMIT',
          '本人资料存储或版本数量已达上限，请联系主办方处理',
        );
      await this.releaseInvalidReservations(c, a);
      const digest = payload.identityNumber
        ? participantIdentityDigest(payload.identityNumber, a.key, a.ctx.orgId, a.event.id)
        : null;
      const duplicate = await c.query(
        `SELECT 1 FROM participant_materials WHERE org_id=$1 AND event_id=$2 AND reservation_active AND id<>$3 AND (user_id=$4 OR ($5::text IS NOT NULL AND identity_digest=$5)) LIMIT 1`,
        [a.ctx.orgId, a.event.id, id, a.ctx.user.id, digest],
      );
      if (duplicate.rowCount)
        throw conflict('PARTICIPANT_DUPLICATE', '当前账号或身份已用于本届另一份有效报名');
      await this.ensureFreshSession(c, a.ctx);
      if (!mine.head)
        await c.query(
          `INSERT INTO participant_materials(id,org_id,event_id,team_id,entry_id,member_id,user_id,binding_id,key_id,identity_digest,current_revision_id,publicity_consent)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            id,
            a.ctx.orgId,
            a.event.id,
            a.team.id,
            a.entry.id,
            mine.memberId,
            a.ctx.user.id,
            mine.binding!.id,
            a.keyId,
            digest,
            revisionId,
            payload.publicityConsent,
          ],
        );
      await c.query(
        `INSERT INTO participant_material_revisions(id,material_id,org_id,event_id,team_id,entry_id,member_id,user_id,client_request_id,request_fingerprint,ruleset_id,roster_revision_id,jersey_no,key_id,payload_ciphertext,payload_byte_length,has_identity,has_real_name,has_signature,terms_version,portrait_sha256,portrait_bytes,insurance_bytes,insurance_start_date,insurance_end_date)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
        [
          revisionId,
          id,
          a.ctx.orgId,
          a.event.id,
          a.team.id,
          a.entry.id,
          mine.memberId,
          a.ctx.user.id,
          input.clientRequestId,
          fingerprint,
          a.entry.ruleset_id,
          a.entry.roster_revision_id,
          mine.jerseyNo,
          a.keyId,
          cipher,
          bytes,
          Boolean(payload.identityNumber),
          Boolean(payload.realName),
          payload.acceptedTerms && payload.termsVersion !== null,
          payload.acceptedTerms ? payload.termsVersion : null,
          payload.portrait?.sha256 ?? null,
          payload.portrait?.byteLength ?? 0,
          payload.insurance?.document?.byteLength ?? 0,
          payload.insurance?.startDate ?? null,
          payload.insurance?.endDate ?? null,
        ],
      );
      if (mine.head)
        await c.query(
          `UPDATE participant_materials SET current_revision_id=$2,version=version+1,status='DRAFT',identity_digest=$3,publicity_consent=$4,reservation_active=true,
        reviewer_id=NULL,review_reason=NULL,reviewed_start_date=NULL,reviewed_end_date=NULL,reviewed_at=NULL,updated_at=clock_timestamp() WHERE id=$1`,
          [id, revisionId, digest, payload.publicityConsent],
        );
      await this.audit(
        c,
        a.ctx.user.id,
        a.ctx.orgId,
        'PARTICIPANT_MATERIALS_SAVED',
        'participant_material',
        id,
        { revisionId, clientRequestId: input.clientRequestId },
      );
      mine = await this.mine(c, a, true);
      return {
        ...(await this.mineDto(c, a, mine)),
        receipt: {
          clientRequestId: input.clientRequestId,
          revisionId,
          isCurrent: true,
          currentVersion: mine.head!.version,
        },
      };
    });
  }
  async receipt(cookie: string | undefined, org: string, entry: string, requestId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId))
      throw notFound();
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry);
      const mine = await this.mine(c, a);
      const receipt = (
        await c.query(
          'SELECT id,member_id FROM participant_material_revisions WHERE org_id=$1 AND entry_id=$2 AND user_id=$3 AND client_request_id=$4',
          [a.ctx.orgId, a.entry.id, a.ctx.user.id, requestId],
        )
      ).rows[0];
      if (!receipt || receipt.member_id !== mine.memberId)
        throw new ApiError(404, 'PARTICIPANT_RECEIPT_NOT_FOUND', '尚未查到该请求的已提交结果');
      await this.ensureFreshSession(c, a.ctx);
      return {
        clientRequestId: requestId,
        revisionId: receipt.id,
        isCurrent: mine.head?.revision_id === receipt.id,
        currentVersion: mine.head?.version ?? 0,
      };
    });
  }
  async submit(cookie: string | undefined, org: string, entry: string, raw: unknown) {
    const input = parseParticipantVersion(raw);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry, true);
      const mine = await this.mine(c, a, true);
      this.writable(a);
      this.checkVersion(mine.head, input.expectedVersion);
      if (!mine.head || !['DRAFT', 'CHANGES_REQUESTED'].includes(mine.head.status))
        throw conflict('PARTICIPANT_MATERIALS_STATE', '请先保存当前本人资料再提交');
      const eligibility = await this.assessment(
        c,
        a,
        mine.head,
        mine.binding,
        mine.jerseyNo,
        false,
      );
      const payload = this.payload(a, mine.head);
      if (
        !eligibility.eligible ||
        (a.rules.require_insurance &&
          !eligibility.onlineInsuranceReady &&
          (!payload.insurance?.insurer || !payload.insurance.policyNumber))
      )
        throw new ApiError(
          422,
          'PARTICIPANT_MATERIALS_INCOMPLETE',
          '本人资料尚未满足当前报名要求',
          { blockers: eligibility.blockers },
        );
      await this.ensureFreshSession(c, a.ctx);
      await c.query(
        `UPDATE participant_materials SET status='SUBMITTED',version=version+1,reviewer_id=NULL,review_reason=NULL,reviewed_start_date=NULL,reviewed_end_date=NULL,reviewed_at=NULL,updated_at=clock_timestamp() WHERE id=$1`,
        [mine.head.id],
      );
      await this.audit(
        c,
        a.ctx.user.id,
        a.ctx.orgId,
        'PARTICIPANT_MATERIALS_SUBMITTED',
        'participant_material',
        mine.head.id,
        { revisionId: mine.head.revision_id },
      );
      return this.mineDto(c, a, await this.mine(c, a, true));
    });
  }
  async review(
    cookie: string | undefined,
    org: string,
    entry: string,
    member: string,
    raw: unknown,
  ) {
    const input = parseParticipantReview(raw);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry, true);
      if (!a.reader) throw notFound();
      if (!a.reviewer) throw forbidden();
      const row = await this.head(c, a, member);
      const player = (await this.roster(c, a)).find((p) => p.member_id === member);
      if (!row || !player) throw notFound();
      this.writable(a);
      this.checkVersion(row, input.expectedVersion);
      if (row.user_id === a.ctx.user.id) throw forbidden();
      if (row.status !== 'SUBMITTED')
        throw conflict('PARTICIPANT_MATERIALS_STATE', '仅待审本人资料可以审核');
      const binding = await this.binding(c, a, member);
      if (input.decision === 'APPROVE') {
        const check = await this.assessment(c, a, row, binding, player.jersey_no, false);
        const payload = this.payload(a, row);
        if (
          !check.eligible ||
          (a.rules.require_insurance &&
            !check.onlineInsuranceReady &&
            (!payload.insurance?.insurer || !payload.insurance.policyNumber))
        )
          throw new ApiError(
            422,
            'PARTICIPANT_MATERIALS_INCOMPLETE',
            '资料版本或保障期间不符合当前要求',
            { blockers: check.blockers },
          );
        if (
          !input.identityChecked ||
          !input.portraitChecked ||
          (a.rules.require_insurance && !input.insuranceChecked)
        )
          throw new ApiError(
            422,
            'PARTICIPANT_REVIEW_CHECKS_REQUIRED',
            '请完成身份、本人照片及所需保障的人工核对',
          );
      }
      await this.ensureFreshSession(c, a.ctx);
      await c.query(
        `UPDATE participant_materials SET status=$2,version=version+1,reviewer_id=$3,review_reason=$4,reviewed_at=clock_timestamp(),
        reviewed_start_date=$5,reviewed_end_date=$6,updated_at=clock_timestamp() WHERE id=$1`,
        [
          row.id,
          input.decision === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED',
          a.ctx.user.id,
          input.reason,
          input.decision === 'APPROVE' ? a.event.start_date : null,
          input.decision === 'APPROVE' ? a.event.end_date : null,
        ],
      );
      await this.audit(
        c,
        a.ctx.user.id,
        a.ctx.orgId,
        'PARTICIPANT_MATERIALS_REVIEWED',
        'participant_material',
        row.id,
        { revisionId: row.revision_id, decision: input.decision },
      );
      return this.dto(c, a, await this.head(c, a, member), player, true);
    });
  }
  async withdrawPublicity(cookie: string | undefined, org: string, entry: string, raw: unknown) {
    const input = parseParticipantVersion(raw);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry, true);
      const mine = await this.mine(c, a);
      if (!mine.head || mine.head.user_id !== a.ctx.user.id) throw notFound();
      // A privacy withdrawal is a monotonic safety exception even after leaving, freezing or closure.
      if (mine.head.publicity_consent) {
        this.checkVersion(mine.head, input.expectedVersion);
        await this.ensureFreshSession(c, a.ctx);
        await c.query(
          'UPDATE participant_materials SET publicity_consent=false,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
          [mine.head.id],
        );
        await this.audit(
          c,
          a.ctx.user.id,
          a.ctx.orgId,
          'PARTICIPANT_PUBLICITY_WITHDRAWN',
          'participant_material',
          mine.head.id,
          { revisionId: mine.head.revision_id },
        );
      } else await this.ensureFreshSession(c, a.ctx);
      return this.mineDto(c, a, await this.mine(c, a));
    });
  }
  async myEntries(cookie: string | undefined) {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const key = participantKey(this.rawKey);
      await assertParticipantKeyConsistency(c, participantKeyId(key));
      const rows = await c.query(
        `SELECT DISTINCT org_id AS "orgId",entry_id AS "entryId",event_name AS "eventName",team_name AS "teamName",start_date::text AS "startDate",end_date::text AS "endDate",member_id AS "memberId",withdrawal_only AS "withdrawalOnly" FROM (
        SELECT e.org_id,n.id AS entry_id,e.name AS event_name,t.name AS team_name,e.start_date,e.end_date,b.member_id,false AS withdrawal_only
        FROM team_member_bindings b JOIN organizations o ON o.id=b.org_id AND o.status='ACTIVE'
        JOIN team_members tm ON tm.org_id=b.org_id AND tm.team_id=b.team_id AND tm.id=b.member_id AND tm.status='ACTIVE'
        JOIN teams t ON t.org_id=b.org_id AND t.id=b.team_id
        JOIN entries n ON n.org_id=b.org_id AND n.team_id=b.team_id
        JOIN event_rulesets rules ON rules.id=n.ruleset_id AND rules.require_participant_materials
        JOIN events e ON e.org_id=n.org_id AND e.id=n.event_id
        JOIN entry_roster_players p ON p.org_id=n.org_id AND p.entry_id=n.id AND p.revision_id=n.roster_revision_id AND p.member_id=b.member_id
        WHERE b.user_id=$1 AND b.status='ACTIVE'
        UNION ALL
        SELECT m.org_id,m.entry_id,e.name,t.name,e.start_date,e.end_date,m.member_id,true
        FROM participant_materials m JOIN organizations o ON o.id=m.org_id AND o.status='ACTIVE'
        JOIN events e ON e.org_id=m.org_id AND e.id=m.event_id JOIN teams t ON t.org_id=m.org_id AND t.id=m.team_id
        WHERE m.user_id=$1 AND m.publicity_consent AND NOT EXISTS(
          SELECT 1 FROM team_member_bindings b JOIN entries n ON n.id=m.entry_id
          JOIN entry_roster_players p ON p.org_id=n.org_id AND p.entry_id=n.id AND p.revision_id=n.roster_revision_id AND p.member_id=m.member_id
          WHERE b.id=m.binding_id AND b.user_id=m.user_id AND b.status='ACTIVE')
      ) discover ORDER BY "startDate" DESC,"entryId" LIMIT 100`,
        [actor.user.id],
      );
      await this.ensureFreshSession(c, actor);
      return rows.rows;
    });
  }
}
