import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  YouthEligibility,
  YouthEntryEligibility,
  YouthPurpose,
} from '../../../packages/contracts/youth-guardians.js';
import {
  ageOn,
  YOUTH_TERMS_VERSION,
  YOUTH_DATA_TERMS_VERSION,
  youthFail,
} from './youth-guardians-domain.js';

export interface YouthQualificationInput {
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
/** Inject E03's independently verified, no-insurance qualification reader. DOB stays server-only. */
export type YouthQualificationReader = (
  client: PoolClient,
  input: YouthQualificationInput,
) => Promise<YouthQualification>;
export type YouthEligibilityInput = YouthQualificationInput & { purpose?: YouthPurpose };

export interface YouthDataConsentInput {
  orgId: string;
  eventId: string;
  userId: string;
  forceRequired?: boolean;
}
export interface YouthDataConsent {
  required: boolean;
  ready: boolean;
  preconsentId: string | null;
  guardianUserId: string | null;
  version: number | null;
  blockers: string[];
}
/** Prior to child identity/portrait collection. Required youth/<14 collection cannot be exempted by event settings. */
export async function readYouthDataProcessingConsent(
  c: PoolClient,
  input: YouthDataConsentInput,
): Promise<YouthDataConsent> {
  const policy = (
    await c.query('SELECT * FROM youth_event_policies WHERE org_id=$1 AND event_id=$2', [
      input.orgId,
      input.eventId,
    ])
  ).rows[0];
  const empty = { preconsentId: null, guardianUserId: null, version: null };
  if (!policy?.enabled && !input.forceRequired)
    return { required: false, ready: true, ...empty, blockers: [] };
  if (!policy?.enabled)
    return { required: true, ready: false, ...empty, blockers: ['YOUTH_POLICY_REQUIRED'] };
  const r = (
    await c.query(
      `SELECT p.*,su.status AS subject_status,gu.status AS guardian_status FROM youth_guardian_preconsents p JOIN users su ON su.id=p.subject_user_id JOIN users gu ON gu.id=p.guardian_user_id WHERE p.org_id=$1 AND p.event_id=$2 AND p.subject_user_id=$3 AND p.status='CONSENTED' ORDER BY p.created_at DESC,p.id DESC LIMIT 1`,
      [input.orgId, input.eventId, input.userId],
    )
  ).rows[0];
  if (
    !r ||
    r.subject_status !== 'ACTIVE' ||
    r.guardian_status !== 'ACTIVE' ||
    r.policy_version !== policy.version ||
    r.data_terms_version !== YOUTH_DATA_TERMS_VERSION ||
    !r.guardian_confirmed_at
  )
    return {
      required: true,
      ready: false,
      ...empty,
      blockers: ['YOUTH_DATA_PROCESSING_CONSENT_REQUIRED'],
    };
  return {
    required: true,
    ready: true,
    preconsentId: r.id,
    guardianUserId: r.guardian_user_id,
    version: r.version,
    blockers: [],
  };
}

/** Caller holds the existing event lock. Never use a frozen historical consent as a current grant. */
export async function readYouthEligibility(
  c: PoolClient,
  input: YouthEligibilityInput,
  reader?: YouthQualificationReader,
): Promise<YouthEligibility> {
  const policy = (
    await c.query('SELECT * FROM youth_event_policies WHERE org_id=$1 AND event_id=$2', [
      input.orgId,
      input.eventId,
    ])
  ).rows[0];
  const bad = (...blockers: string[]): YouthEligibility => ({
    required: true,
    ready: false,
    blockers,
    snapshot: null,
  });
  if (!policy?.enabled) return { required: false, ready: true, blockers: [], snapshot: null };
  if (!reader) return bad('YOUTH_QUALIFICATION_UNAVAILABLE');
  const q = await reader(c, input);
  if (
    !q.ready ||
    !q.subjectUserId ||
    !q.birthDate ||
    !q.materialRevisionId ||
    !q.materialId ||
    !q.qualificationId
  )
    return bad('YOUTH_QUALIFICATION_REQUIRED');
  const age = ageOn(q.birthDate, input.policyDate);
  if (age >= policy.guardian_age_threshold)
    return { required: false, ready: true, blockers: [], snapshot: null };
  const dataConsent = await readYouthDataProcessingConsent(c, {
    orgId: input.orgId,
    eventId: input.eventId,
    userId: q.subjectUserId,
    forceRequired: true,
  });
  if (!dataConsent.ready) return bad(...dataConsent.blockers);
  const r = (
    await c.query(
      `SELECT r.*,su.status AS subject_status,gu.status AS guardian_status
    FROM youth_guardian_requests r JOIN users su ON su.id=r.subject_user_id JOIN users gu ON gu.id=r.guardian_user_id
    WHERE r.org_id=$1 AND r.event_id=$2 AND r.entry_id=$3 AND r.member_id=$4
      AND r.status IN('AWAITING_GUARDIAN','AWAITING_REVIEW','APPROVED') ORDER BY r.created_at DESC,r.id DESC LIMIT 1`,
      [input.orgId, input.eventId, input.entryId, input.memberId],
    )
  ).rows[0];
  if (!r) return bad('GUARDIAN_CONFIRMATION_REQUIRED');
  if (r.subject_status !== 'ACTIVE' || r.guardian_status !== 'ACTIVE')
    return bad('GUARDIAN_ACCOUNT_INACTIVE');
  if (
    r.preconsent_id !== dataConsent.preconsentId ||
    r.guardian_user_id !== dataConsent.guardianUserId ||
    r.subject_user_id !== q.subjectUserId ||
    r.material_id !== q.materialId ||
    r.material_revision_id !== q.materialRevisionId ||
    r.qualification_id !== q.qualificationId ||
    r.roster_revision_id !== input.rosterRevisionId ||
    r.ruleset_id !== input.rulesetId ||
    r.policy_version !== policy.version ||
    r.terms_version !== policy.terms_version ||
    r.terms_version !== YOUTH_TERMS_VERSION
  )
    return bad('GUARDIAN_SOURCE_CHANGED');
  if (
    r.status !== 'APPROVED' ||
    !r.subject_confirmed_at ||
    !r.guardian_confirmed_at ||
    !r.guardian_identity_checked ||
    !r.relationship_checked ||
    !r.guardian_adult_checked ||
    r.reviewed_payload_version !== r.guardian_payload_version ||
    !r.guardian_payload_ciphertext ||
    r.proof_purged_at
  )
    return bad('GUARDIAN_INDEPENDENT_REVIEW_REQUIRED');
  const purpose = input.purpose ?? 'PARTICIPATION';
  if (!r.subject_purposes.includes(purpose) || !r.guardian_purposes.includes(purpose))
    return bad('GUARDIAN_PURPOSE_CONSENT_REQUIRED');
  return {
    required: true,
    ready: true,
    blockers: [],
    snapshot: {
      memberId: input.memberId,
      requestId: r.id,
      requestVersion: r.version,
      policyVersion: policy.version,
      materialRevisionId: q.materialRevisionId,
      qualificationId: q.qualificationId,
      guardianPayloadVersion: r.guardian_payload_version,
      termsVersion: r.terms_version,
    },
  };
}
export async function readYouthEntryEligibility(
  c: PoolClient,
  input: Omit<YouthEligibilityInput, 'memberId'>,
  reader?: YouthQualificationReader,
): Promise<YouthEntryEligibility> {
  const members = (
    await c.query(
      'SELECT member_id FROM entry_roster_players WHERE org_id=$1 AND entry_id=$2 AND revision_id=$3 ORDER BY member_id',
      [input.orgId, input.entryId, input.rosterRevisionId],
    )
  ).rows;
  const out: YouthEntryEligibility = { ready: true, blockers: [], snapshots: [] };
  for (const member of members) {
    const a = await readYouthEligibility(c, { ...input, memberId: member.member_id }, reader);
    if (!a.ready) {
      out.ready = false;
      out.blockers.push(...a.blockers.map((code) => ({ memberId: member.member_id, code })));
    }
    if (a.snapshot) out.snapshots.push(a.snapshot);
  }
  return out;
}
export async function assertYouthEligibility(
  c: PoolClient,
  input: YouthEligibilityInput,
  reader?: YouthQualificationReader,
): Promise<YouthEligibility> {
  const result = await readYouthEligibility(c, input, reader);
  if (!result.ready) youthFail('YOUTH_PARTICIPATION_BLOCKED', '当前监护确认或资格预审尚未完成');
  return result;
}
/** Security revocation: caller serializes account closure; this never requires proof keys or open events. */
export async function revokeYouthForClosure(c: PoolClient, userId: string): Promise<number> {
  const events = (
    await c.query(
      `SELECT org_id,event_id FROM youth_guardian_requests WHERE (subject_user_id=$1 OR guardian_user_id=$1) AND status<>'WITHDRAWN' UNION SELECT org_id,event_id FROM youth_guardian_preconsents WHERE (subject_user_id=$1 OR guardian_user_id=$1) AND status<>'WITHDRAWN' ORDER BY org_id,event_id`,
      [userId],
    )
  ).rows;
  let count = 0;
  for (const e of events) {
    await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE', [
      e.org_id,
      e.event_id,
    ]);
    const requests = (
      await c.query(
        `UPDATE youth_guardian_requests SET status='WITHDRAWN',version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND event_id=$2 AND (subject_user_id=$3 OR guardian_user_id=$3) AND status<>'WITHDRAWN' RETURNING id,version`,
        [e.org_id, e.event_id, userId],
      )
    ).rows;
    for (const r of requests) {
      await c.query(
        "INSERT INTO youth_guardian_history(id,request_id,version,actor_id,action,facts) VALUES($1,$2,$3,$4,'ACCOUNT_CLOSURE',$5::jsonb)",
        [randomUUID(), r.id, r.version, userId, JSON.stringify({ status: 'WITHDRAWN' })],
      );
      count++;
    }
  }
  const pre = (
    await c.query(
      `UPDATE youth_guardian_preconsents SET status='WITHDRAWN',version=version+1,updated_at=clock_timestamp() WHERE (subject_user_id=$1 OR guardian_user_id=$1) AND status<>'WITHDRAWN' RETURNING id,version`,
      [userId],
    )
  ).rows;
  for (const r of pre) {
    await c.query(
      "INSERT INTO youth_preconsent_history(id,preconsent_id,version,actor_id,action) VALUES($1,$2,$3,$4,'ACCOUNT_CLOSURE')",
      [randomUUID(), r.id, r.version, userId],
    );
    count++;
  }
  return count;
}
