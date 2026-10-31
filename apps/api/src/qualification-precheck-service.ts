import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ApiOptions } from './service.js';
import { ApplicationService, isAdministrator } from './service.js';
import { forbidden, notFound } from './errors.js';
import { objectInput, resourceId, text } from './validation.js';
import {
  decryptParticipantPayload,
  PARTICIPANT_TERMS_VERSION,
  participantIdentityNumber,
  participantKey,
  participantKeyId,
} from './participant-materials-domain.js';
import { insuranceFail, insuranceHash, insuranceId } from './insurance-domain.js';

type Row = Record<string, any>;
export interface QualificationInput {
  orgId: string;
  eventId: string;
  entryId: string;
  memberId: string;
  rosterRevisionId: string;
  rulesetId: string;
  policyDate: string;
}
export interface YouthQualification {
  ready: boolean;
  subjectUserId: string | null;
  materialId: string | null;
  materialRevisionId: string | null;
  qualificationId: string | null;
  birthDate: string | null;
}
export interface QualificationOptions {
  dataConsentGuard?: (
    c: PoolClient,
    input: { orgId: string; eventId: string; userId: string; forceRequired: boolean },
  ) => Promise<{ ready: boolean }>;
}
export function qualificationBirthDate(identity: string): string {
  return `${identity.slice(6, 10)}-${identity.slice(10, 12)}-${identity.slice(12, 14)}`;
}
export function qualificationUnder14(birthDate: string, policyDate: string): boolean {
  return (
    Number(policyDate.slice(0, 4)) -
      Number(birthDate.slice(0, 4)) -
      (policyDate.slice(5) < birthDate.slice(5) ? 1 : 0) <
    14
  );
}
export async function qualificationDataConsentReady(
  c: PoolClient,
  options: QualificationOptions,
  input: { orgId: string; eventId: string; userId: string; birthDate: string; policyDate: string },
): Promise<boolean> {
  const required = qualificationUnder14(input.birthDate, input.policyDate);
  return options.dataConsentGuard
    ? (
        await options.dataConsentGuard(c, {
          orgId: input.orgId,
          eventId: input.eventId,
          userId: input.userId,
          forceRequired: required,
        })
      ).ready === true
    : !required;
}
export const QUALIFICATION_SUBJECT_SQL = `SELECT e.id AS entry_id,e.team_id,e.event_id,e.ruleset_id,e.roster_revision_id,e.status AS entry_status,
 ev.start_date::text,ev.end_date::text,ev.status AS event_status,m.id AS material_id,m.current_revision_id AS material_revision_id,
 m.version AS material_version,m.user_id,m.binding_id,m.key_id AS material_key_id,m.status AS material_status,m.reservation_active,
 r.key_id,r.payload_ciphertext,r.ruleset_id AS material_ruleset_id,r.roster_revision_id AS material_roster_revision_id,
 r.portrait_sha256,r.portrait_bytes,r.has_real_name,r.has_identity,r.has_signature,r.terms_version,r.purged_at,
 r.jersey_no AS material_jersey_no,p.jersey_no,b.id AS current_binding_id
 FROM entries e JOIN events ev ON ev.org_id=e.org_id AND ev.id=e.event_id
 JOIN organizations org ON org.id=e.org_id AND org.status='ACTIVE'
 JOIN entry_roster_players p ON p.org_id=e.org_id AND p.entry_id=e.id AND p.revision_id=e.roster_revision_id AND p.member_id=$3
 JOIN participant_materials m ON m.org_id=e.org_id AND m.entry_id=e.id AND m.member_id=p.member_id
 JOIN participant_material_revisions r ON r.id=m.current_revision_id AND r.material_id=m.id
 JOIN team_member_bindings b ON b.org_id=e.org_id AND b.team_id=e.team_id AND b.member_id=p.member_id AND b.user_id=m.user_id AND b.status='ACTIVE'
 JOIN team_members tm ON tm.org_id=b.org_id AND tm.id=b.member_id AND tm.team_id=b.team_id AND tm.status='ACTIVE'
 JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
 WHERE e.org_id=$1 AND e.id=$2`;
export function qualificationMaterialCurrent(row: Row, keyId: string): boolean {
  return Boolean(
    row &&
    row.reservation_active &&
    ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(row.material_status) &&
    !['WITHDRAWN', 'REJECTED'].includes(row.entry_status) &&
    row.key_id === keyId &&
    row.material_key_id === keyId &&
    row.material_ruleset_id === row.ruleset_id &&
    row.material_roster_revision_id === row.roster_revision_id &&
    row.material_jersey_no === row.jersey_no &&
    row.binding_id === row.current_binding_id &&
    !row.purged_at &&
    row.payload_ciphertext &&
    row.has_real_name &&
    row.has_identity &&
    row.has_signature &&
    row.terms_version === PARTICIPANT_TERMS_VERSION &&
    row.portrait_bytes > 0 &&
    row.portrait_sha256,
  );
}
/** Existing event lock required. No DOB or identity is returned by any HTTP DTO. */
export function createYouthQualificationReader(
  participantDataKey: string,
  options: QualificationOptions = {},
) {
  const key = participantKey(participantDataKey),
    keyId = participantKeyId(key);
  return async (c: PoolClient, input: QualificationInput): Promise<YouthQualification> => {
    const empty: YouthQualification = {
      ready: false,
      subjectUserId: null,
      materialId: null,
      materialRevisionId: null,
      qualificationId: null,
      birthDate: null,
    };
    const route = (
      await c.query('SELECT team_id FROM entries WHERE org_id=$1 AND id=$2', [
        input.orgId,
        input.entryId,
      ])
    ).rows[0];
    if (!route) return empty;
    if (
      !(
        await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
          input.orgId,
          route.team_id,
        ])
      ).rowCount
    )
      return empty;
    const row = (
      await c.query(QUALIFICATION_SUBJECT_SQL, [input.orgId, input.entryId, input.memberId])
    ).rows[0];
    if (!row || row.event_id !== input.eventId || !qualificationMaterialCurrent(row, keyId))
      return empty;
    const base = {
      ...empty,
      subjectUserId: row.user_id,
      materialId: row.material_id,
      materialRevisionId: row.material_revision_id,
    };
    if (
      row.ruleset_id !== input.rulesetId ||
      row.roster_revision_id !== input.rosterRevisionId ||
      row.start_date !== input.policyDate
    )
      return base;
    const request = (
      await c.query(
        'SELECT *,event_start_date::text,event_end_date::text FROM participant_qualification_requests WHERE org_id=$1 AND entry_id=$2 AND member_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1',
        [input.orgId, input.entryId, input.memberId],
      )
    ).rows[0];
    if (
      !request ||
      request.user_id !== row.user_id ||
      request.material_revision_id !== row.material_revision_id ||
      request.ruleset_id !== row.ruleset_id ||
      request.roster_revision_id !== row.roster_revision_id ||
      request.portrait_sha256 !== row.portrait_sha256 ||
      request.accepted_terms_version !== 'qualification-precheck-v1' ||
      String(request.event_start_date) !== row.start_date ||
      String(request.event_end_date) !== row.end_date
    )
      return base;
    const q = (
      await c.query(
        'SELECT * FROM participant_qualification_prechecks WHERE org_id=$1 AND entry_id=$2 AND member_id=$3 ORDER BY version DESC LIMIT 1',
        [input.orgId, input.entryId, input.memberId],
      )
    ).rows[0];
    if (
      !q ||
      q.status !== 'APPROVED' ||
      q.request_id !== request.id ||
      q.user_id !== row.user_id ||
      q.material_id !== row.material_id ||
      q.material_revision_id !== row.material_revision_id ||
      q.ruleset_id !== row.ruleset_id ||
      q.roster_revision_id !== row.roster_revision_id ||
      q.portrait_sha256 !== row.portrait_sha256 ||
      String(
        q.event_start_date instanceof Date
          ? q.event_start_date.toISOString().slice(0, 10)
          : q.event_start_date,
      ) !== row.start_date ||
      String(
        q.event_end_date instanceof Date
          ? q.event_end_date.toISOString().slice(0, 10)
          : q.event_end_date,
      ) !== row.end_date
    )
      return base;
    // A reviewer later becoming the subject/leader invalidates the independent proof.
    const independent = (
      await c.query(
        `SELECT NOT EXISTS(SELECT 1 FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE') AND NOT EXISTS(SELECT 1 FROM team_member_bindings WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE') AS ok`,
        [input.orgId, row.team_id, q.reviewed_by],
      )
    ).rows[0]?.ok;
    if (!independent) return base;
    const payload = decryptParticipantPayload(row.payload_ciphertext, key, {
      orgId: input.orgId,
      eventId: row.event_id,
      entryId: input.entryId,
      memberId: input.memberId,
      userId: row.user_id,
      revisionId: row.material_revision_id,
    });
    if (
      !payload.acceptedTerms ||
      payload.termsVersion !== PARTICIPANT_TERMS_VERSION ||
      !payload.realName ||
      !payload.portrait
    )
      return base;
    const identity = participantIdentityNumber(payload.identityNumber, row.start_date);
    const birth = qualificationBirthDate(identity);
    if (
      !(await qualificationDataConsentReady(c, options, {
        orgId: input.orgId,
        eventId: row.event_id,
        userId: row.user_id,
        birthDate: birth,
        policyDate: row.start_date,
      }))
    )
      return base;
    return {
      ...base,
      ready: true,
      qualificationId: q.id,
      birthDate: `${identity.slice(6, 10)}-${identity.slice(10, 12)}-${identity.slice(12, 14)}`,
    };
  };
}
export class QualificationPrecheckService extends ApplicationService {
  constructor(
    pool: Pool,
    options: ApiOptions,
    private readonly qualification: QualificationOptions = {},
  ) {
    super(pool, options);
  }
  private async access(
    c: PoolClient,
    cookie: string | undefined,
    org: string,
    entry: string,
    writing = false,
  ) {
    const actor = await this.lockActor(c, cookie),
      orgId = resourceId(org),
      entryId = resourceId(entry);
    const organization = (
      await c.query("SELECT id FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE", [
        orgId,
      ])
    ).rows[0];
    if (!organization) throw notFound();
    const route = (
      await c.query(
        'SELECT event_id,team_id,last_submitted_by FROM entries WHERE org_id=$1 AND id=$2',
        [orgId, entryId],
      )
    ).rows[0];
    if (!route) throw notFound();
    const event = (
      await c.query(
        `SELECT *,start_date::text,end_date::text FROM events WHERE org_id=$1 AND id=$2 FOR ${writing ? 'UPDATE' : 'SHARE'}`,
        [orgId, route.event_id],
      )
    ).rows[0];
    if (
      !(
        await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
          orgId,
          route.team_id,
        ])
      ).rowCount
    )
      throw notFound();
    const role = (
      await c.query(
        "SELECT role FROM organization_memberships WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE",
        [orgId, actor.user.id],
      )
    ).rows[0]?.role;
    const staff = (
      await c.query(
        "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
        [orgId, event.id, actor.user.id],
      )
    ).rows[0]?.role;
    const associated = (
      await c.query(
        "SELECT 1 FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE' UNION ALL SELECT 1 FROM team_member_bindings WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE'",
        [orgId, route.team_id, actor.user.id],
      )
    ).rowCount;
    const reviewer = Boolean(
      role &&
      (isAdministrator(role) || ['EVENT_MANAGER', 'REVIEWER'].includes(staff)) &&
      !associated &&
      route.last_submitted_by !== actor.user.id,
    );
    return { actor, orgId, entryId, event, teamId: route.team_id, reviewer };
  }
  async workspace(cookie: string | undefined, org: string, entry: string) {
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry);
      const rows = (
        await c.query(
          `SELECT m.member_id,m.user_id,m.version AS material_version,m.current_revision_id AS material_revision_id,m.status,
        r.portrait_bytes>0 AS has_portrait,r.has_identity,r.has_real_name,r.has_signature,
        q.id AS qualification_id,q.status AS qualification_status,q.material_revision_id AS qualified_revision_id,q.reason,qr.id AS request_id,qr.material_revision_id AS requested_revision_id,
        (qr.material_revision_id=m.current_revision_id AND qr.ruleset_id=e.ruleset_id AND qr.roster_revision_id=e.roster_revision_id AND qr.portrait_sha256=r.portrait_sha256 AND qr.event_start_date=ev.start_date AND qr.event_end_date=ev.end_date) AS request_current,
        (q.request_id=qr.id AND q.material_revision_id=m.current_revision_id AND q.ruleset_id=e.ruleset_id AND q.roster_revision_id=e.roster_revision_id AND q.portrait_sha256=r.portrait_sha256 AND q.event_start_date=ev.start_date AND q.event_end_date=ev.end_date) AS qualification_current
        FROM participant_materials m JOIN participant_material_revisions r ON r.id=m.current_revision_id JOIN entries e ON e.org_id=m.org_id AND e.id=m.entry_id JOIN events ev ON ev.org_id=m.org_id AND ev.id=m.event_id
        LEFT JOIN LATERAL(SELECT * FROM participant_qualification_prechecks q WHERE q.org_id=m.org_id AND q.entry_id=m.entry_id AND q.member_id=m.member_id ORDER BY q.version DESC LIMIT 1)q ON true
        LEFT JOIN LATERAL(SELECT * FROM participant_qualification_requests qr WHERE qr.org_id=m.org_id AND qr.entry_id=m.entry_id AND qr.member_id=m.member_id ORDER BY qr.created_at DESC,qr.id DESC LIMIT 1)qr ON true WHERE m.org_id=$1 AND m.entry_id=$2 AND ($3::boolean OR m.user_id=$4) ORDER BY m.member_id`,
          [a.orgId, a.entryId, a.reviewer, a.actor.user.id],
        )
      ).rows;
      if (!a.reviewer && !rows.length) throw notFound();
      await this.ensureFreshSession(c, a.actor);
      return {
        entryId: a.entryId,
        canReview: a.reviewer,
        participants: rows.map((r) => ({
          memberId: r.member_id,
          canRequest: r.user_id === a.actor.user.id,
          materialVersion: r.material_version,
          requestId: r.request_id ?? null,
          requestCurrent: r.request_current === true,
          materialRevisionId: r.material_revision_id,
          hasPortrait: r.has_portrait,
          hasIdentity: r.has_identity,
          hasRealName: r.has_real_name,
          hasSignature: r.has_signature,
          qualification: r.qualification_id
            ? {
                id: r.qualification_id,
                status: r.qualification_status,
                current: r.qualification_current === true,
                reason: r.reason,
              }
            : null,
        })),
        notice: '资格预审不要求先买保险，不等于最终报名通过；身份、照片、签署由独立人员人工核对。',
      };
    });
  }
  async request(cookie: string | undefined, org: string, entry: string, raw: unknown) {
    const b = objectInput(raw, [
      'clientRequestId',
      'memberId',
      'expectedMaterialVersion',
      'acceptedTermsVersion',
    ]);
    const client = insuranceId(b.clientRequestId),
      member = insuranceId(b.memberId);
    if (
      b.acceptedTermsVersion !== 'qualification-precheck-v1' ||
      !Number.isInteger(b.expectedMaterialVersion)
    )
      insuranceFail(
        'QUALIFICATION_CONSENT_REQUIRED',
        '请明确同意将当前身份、照片及签署资料提交独立资格预审',
      );
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry, true);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `qualification:${a.actor.user.id}:${client}`,
      ]);
      if (
        !['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(a.event.status) ||
        (
          await c.query('SELECT 1 FROM registration_freezes WHERE org_id=$1 AND event_id=$2', [
            a.orgId,
            a.event.id,
          ])
        ).rowCount
      )
        insuranceFail('REGISTRATION_FROZEN', '当前不能申请资格预审', 409);
      const row = (await c.query(QUALIFICATION_SUBJECT_SQL, [a.orgId, a.entryId, member])).rows[0];
      if (!row || row.user_id !== a.actor.user.id) throw notFound();
      const hash = insuranceHash({ entry: a.entryId, ...b }),
        old = (
          await c.query(
            'SELECT * FROM participant_qualification_receipts WHERE user_id=$1 AND client_request_id=$2',
            [a.actor.user.id, client],
          )
        ).rows[0];
      if (old) {
        if (old.request_hash !== hash || old.action !== 'REQUEST')
          insuranceFail('IDEMPOTENCY_CONFLICT', '原请求编号内容不同', 409);
        await this.ensureFreshSession(c, a.actor);
        return { requestId: old.request_id };
      }
      if (row.material_version !== b.expectedMaterialVersion)
        insuranceFail('VERSION_CONFLICT', '本人资料已改变，请重读', 409);
      const key = participantKey(this.options.participantDataKey);
      if (!qualificationMaterialCurrent(row, participantKeyId(key)))
        insuranceFail('QUALIFICATION_MATERIAL_REQUIRED', '请先保存当前身份、照片及签署资料');
      const p = decryptParticipantPayload(row.payload_ciphertext, key, {
        orgId: a.orgId,
        eventId: a.event.id,
        entryId: a.entryId,
        memberId: member,
        userId: row.user_id,
        revisionId: row.material_revision_id,
      });
      const birth = qualificationBirthDate(
        participantIdentityNumber(p.identityNumber, row.start_date),
      );
      if (
        !(await qualificationDataConsentReady(c, this.qualification, {
          orgId: a.orgId,
          eventId: a.event.id,
          userId: row.user_id,
          birthDate: birth,
          policyDate: row.start_date,
        }))
      )
        insuranceFail('YOUTH_DATA_CONSENT_REQUIRED', '当前资料须先取得有效监护人数据处理同意', 409);
      const id = randomUUID();
      await c.query(
        'INSERT INTO participant_qualification_requests(id,org_id,event_id,entry_id,member_id,user_id,material_id,material_revision_id,ruleset_id,roster_revision_id,portrait_sha256,event_start_date,event_end_date,accepted_terms_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [
          id,
          a.orgId,
          a.event.id,
          a.entryId,
          member,
          row.user_id,
          row.material_id,
          row.material_revision_id,
          row.ruleset_id,
          row.roster_revision_id,
          row.portrait_sha256,
          row.start_date,
          row.end_date,
          b.acceptedTermsVersion,
        ],
      );
      await c.query(
        "INSERT INTO participant_qualification_receipts(user_id,client_request_id,org_id,entry_id,request_hash,request_id,action) VALUES($1,$2,$3,$4,$5,$6,'REQUEST')",
        [a.actor.user.id, client, a.orgId, a.entryId, hash, id],
      );
      await this.audit(
        c,
        a.actor.user.id,
        a.orgId,
        'QUALIFICATION_PRECHECK_REQUESTED',
        'participant',
        row.material_id,
        {},
      );
      await this.ensureFreshSession(c, a.actor);
      return { requestId: id };
    });
  }
  async requestReceipt(cookie: string | undefined, org: string, entry: string, id: string) {
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry);
      const r = (
        await c.query(
          'SELECT * FROM participant_qualification_receipts WHERE user_id=$1 AND client_request_id=$2 AND org_id=$3 AND entry_id=$4',
          [a.actor.user.id, resourceId(id), a.orgId, a.entryId],
        )
      ).rows[0];
      if (r?.action === 'REVIEW' && !a.reviewer) throw forbidden();
      await this.ensureFreshSession(c, a.actor);
      return r
        ? {
            found: true,
            result:
              r.action === 'REQUEST'
                ? { requestId: r.request_id }
                : { qualificationId: r.qualification_id },
          }
        : { found: false };
    });
  }
  async review(cookie: string | undefined, org: string, entry: string, raw: unknown) {
    const b = objectInput(raw, [
      'clientRequestId',
      'memberId',
      'expectedMaterialVersion',
      'requestId',
      'decision',
      'reason',
      'identityReviewed',
      'portraitReviewed',
      'signatureReviewed',
    ]);
    const client = insuranceId(b.clientRequestId),
      member = insuranceId(b.memberId),
      requestId = insuranceId(b.requestId),
      reason = text(b.reason, 'reason', 4, 500);
    if (
      !['APPROVED', 'REJECTED'].includes(String(b.decision)) ||
      !Number.isInteger(b.expectedMaterialVersion)
    )
      insuranceFail('INVALID_QUALIFICATION_REVIEW', '请核对审核决定');
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, entry, true);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `qualification:${a.actor.user.id}:${client}`,
      ]);
      if (!a.reviewer) throw forbidden();
      if (
        !['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(a.event.status) ||
        (
          await c.query('SELECT 1 FROM registration_freezes WHERE org_id=$1 AND event_id=$2', [
            a.orgId,
            a.event.id,
          ])
        ).rowCount
      )
        insuranceFail('REGISTRATION_FROZEN', '当前不能更改资格预审', 409);
      const row = (await c.query(QUALIFICATION_SUBJECT_SQL, [a.orgId, a.entryId, member])).rows[0];
      if (!row) throw notFound();
      if (
        row.user_id === a.actor.user.id ||
        (
          await c.query(
            `SELECT 1 FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE' UNION ALL SELECT 1 FROM team_member_bindings WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE'`,
            [a.orgId, a.teamId, a.actor.user.id],
          )
        ).rowCount
      )
        throw forbidden();
      const hash = insuranceHash({ entry: a.entryId, ...b });
      const receipt = (
        await c.query(
          'SELECT * FROM participant_qualification_receipts WHERE user_id=$1 AND client_request_id=$2',
          [a.actor.user.id, client],
        )
      ).rows[0];
      if (receipt) {
        if (receipt.request_hash !== hash)
          insuranceFail('IDEMPOTENCY_CONFLICT', '原请求编号内容不同', 409);
        await this.ensureFreshSession(c, a.actor);
        return { qualificationId: receipt.qualification_id };
      }
      const submitted = (
        await c.query(
          'SELECT *,event_start_date::text,event_end_date::text FROM participant_qualification_requests WHERE org_id=$1 AND entry_id=$2 AND member_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1',
          [a.orgId, a.entryId, member],
        )
      ).rows[0];
      if (
        !submitted ||
        submitted.id !== requestId ||
        submitted.user_id !== row.user_id ||
        submitted.material_revision_id !== row.material_revision_id ||
        submitted.ruleset_id !== row.ruleset_id ||
        submitted.roster_revision_id !== row.roster_revision_id ||
        submitted.portrait_sha256 !== row.portrait_sha256 ||
        submitted.event_start_date !== row.start_date ||
        submitted.event_end_date !== row.end_date
      )
        insuranceFail(
          'QUALIFICATION_REQUEST_REQUIRED',
          '本人须先明确提交当前版本的独立资格预审',
          409,
        );
      if (row.material_version !== b.expectedMaterialVersion)
        insuranceFail('VERSION_CONFLICT', '本人资料已改变，请重读', 409);
      const key = participantKey(this.options.participantDataKey);
      if (!qualificationMaterialCurrent(row, participantKeyId(key)))
        insuranceFail('QUALIFICATION_MATERIAL_REQUIRED', '请先提交当前身份、照片及签署资料');
      const privatePayload = decryptParticipantPayload(row.payload_ciphertext, key, {
        orgId: a.orgId,
        eventId: a.event.id,
        entryId: a.entryId,
        memberId: member,
        userId: row.user_id,
        revisionId: row.material_revision_id,
      });
      const birth = qualificationBirthDate(
        participantIdentityNumber(privatePayload.identityNumber, row.start_date),
      );
      if (
        !(await qualificationDataConsentReady(c, this.qualification, {
          orgId: a.orgId,
          eventId: a.event.id,
          userId: row.user_id,
          birthDate: birth,
          policyDate: row.start_date,
        }))
      )
        insuranceFail('YOUTH_DATA_CONSENT_REQUIRED', '当前资料须先取得有效监护人数据处理同意', 409);
      if (
        b.decision === 'APPROVED' &&
        (b.identityReviewed !== true || b.portraitReviewed !== true || b.signatureReviewed !== true)
      )
        insuranceFail('QUALIFICATION_REVIEW_REQUIRED', '请分别核对身份、照片及签署');
      const version = Number(
        (
          await c.query(
            'SELECT COALESCE(max(version),0)+1 AS n FROM participant_qualification_prechecks WHERE org_id=$1 AND entry_id=$2 AND member_id=$3',
            [a.orgId, a.entryId, member],
          )
        ).rows[0].n,
      );
      const id = randomUUID();
      await c.query(
        `INSERT INTO participant_qualification_prechecks(id,org_id,event_id,entry_id,member_id,user_id,material_id,material_revision_id,material_version,ruleset_id,roster_revision_id,portrait_sha256,event_start_date,event_end_date,version,status,reviewed_by,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          id,
          a.orgId,
          a.event.id,
          a.entryId,
          member,
          row.user_id,
          row.material_id,
          row.material_revision_id,
          row.material_version,
          row.ruleset_id,
          row.roster_revision_id,
          row.portrait_sha256,
          row.start_date,
          row.end_date,
          version,
          b.decision,
          a.actor.user.id,
          reason,
          requestId,
        ],
      );
      await c.query(
        'INSERT INTO participant_qualification_receipts(user_id,client_request_id,org_id,entry_id,request_hash,qualification_id) VALUES($1,$2,$3,$4,$5,$6)',
        [a.actor.user.id, client, a.orgId, a.entryId, hash, id],
      );
      await this.audit(
        c,
        a.actor.user.id,
        a.orgId,
        'QUALIFICATION_PRECHECK_REVIEWED',
        'participant',
        row.material_id,
        { decision: b.decision },
      );
      await this.ensureFreshSession(c, a.actor);
      return { qualificationId: id };
    });
  }
}
