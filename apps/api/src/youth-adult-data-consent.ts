import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  QUALIFICATION_SUBJECT_SQL,
  qualificationMaterialCurrent,
} from './qualification-precheck-service.js';
import {
  decryptParticipantPayload,
  participantKey,
  participantKeyId,
  participantIdentityNumber,
  PARTICIPANT_TERMS_VERSION,
} from './participant-materials-domain.js';
import { ageOn } from './youth-guardians-domain.js';

export const YOUTH_ADULT_DATA_TERMS = 'youth-adult-data-processing-v1';
export interface AdultAgeInput {
  orgId: string;
  eventId: string;
  userId: string;
  entryId: string;
  memberId: string;
  evidenceQualificationId?: string;
}
export interface AdultAgeContext {
  ageVerifiedAdult: boolean;
  teamId: string | null;
  bindingId: string | null;
  materialId: string | null;
  materialRevisionId: string | null;
  materialVersion: number | null;
  evidenceQualificationId: string | null;
}
export type YouthAdultAgeReader = (c: PoolClient, input: AdultAgeInput) => Promise<AdultAgeContext>;
const unavailable: AdultAgeContext = {
  ageVerifiedAdult: false,
  teamId: null,
  bindingId: null,
  materialId: null,
  materialRevisionId: null,
  materialVersion: null,
  evidenceQualificationId: null,
};
const name = (v: string) => v.normalize('NFC').trim();
/** Age-only escape from a withdrawn processing grant. NEVER use as eligibility for participation, insurance or public purposes. */
export function createYouthAdultAgeReader(rawKey: string): YouthAdultAgeReader {
  const key = participantKey(rawKey),
    keyId = participantKeyId(key);
  return async (c, input) => {
    const route = (
      await c.query('SELECT team_id FROM entries WHERE org_id=$1 AND event_id=$2 AND id=$3', [
        input.orgId,
        input.eventId,
        input.entryId,
      ])
    ).rows[0];
    if (!route) return unavailable;
    await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
      input.orgId,
      route.team_id,
    ]);
    const r = (
      await c.query(QUALIFICATION_SUBJECT_SQL, [input.orgId, input.entryId, input.memberId])
    ).rows[0];
    // A returned-for-changes photo can still establish processing age from its complete identity.
    if (
      !r ||
      r.user_id !== input.userId ||
      r.event_id !== input.eventId ||
      !qualificationMaterialCurrent(
        {
          ...r,
          material_status: r.material_status === 'CHANGES_REQUESTED' ? 'DRAFT' : r.material_status,
        },
        keyId,
      )
    )
      return unavailable;
    const today = (
      await c.query(
        "SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS adult_processing_date",
      )
    ).rows[0]?.adult_processing_date;
    if (typeof today !== 'string') return unavailable;
    let current;
    try {
      current = decryptParticipantPayload(r.payload_ciphertext, key, {
        orgId: input.orgId,
        eventId: r.event_id,
        entryId: input.entryId,
        memberId: input.memberId,
        userId: input.userId,
        revisionId: r.material_revision_id,
      });
    } catch {
      return unavailable;
    }
    if (
      !current.realName ||
      !current.identityNumber ||
      !current.portrait ||
      current.portrait.sha256 !== r.portrait_sha256 ||
      !current.acceptedTerms ||
      current.termsVersion !== PARTICIPANT_TERMS_VERSION
    )
      return unavailable;
    const identity = participantIdentityNumber(current.identityNumber, today),
      birth = `${identity.slice(6, 10)}-${identity.slice(10, 12)}-${identity.slice(12, 14)}`;
    if (ageOn(birth, today) < 18) return unavailable;
    const candidates = (
      await c.query(
        `SELECT q.id,q.reviewed_by,q.material_revision_id,old.payload_ciphertext,old.key_id,old.purged_at,
   old.ruleset_id,old.roster_revision_id,old.portrait_sha256,old.has_identity,old.has_real_name,old.has_signature,old.terms_version
   FROM participant_qualification_prechecks q JOIN participant_qualification_requests qr ON qr.id=q.request_id
   JOIN participant_material_revisions old ON old.id=q.material_revision_id AND old.material_id=q.material_id AND old.user_id=q.user_id
   JOIN team_member_bindings b ON b.id=$5 AND b.user_id=q.user_id AND b.status='ACTIVE' AND b.created_at<=q.created_at
   WHERE q.org_id=$1 AND q.event_id=$2 AND q.entry_id=$3 AND q.member_id=$4 AND q.material_id=$6 AND q.user_id=$7 AND q.status='APPROVED'
    AND ($8::uuid IS NULL OR q.id=$8) AND q.reviewed_by<>q.user_id AND NOT EXISTS(SELECT 1 FROM youth_guardian_preconsents gp WHERE gp.org_id=q.org_id AND gp.event_id=q.event_id AND gp.subject_user_id=q.user_id AND gp.guardian_user_id=q.reviewed_by)
    AND qr.user_id=q.user_id AND qr.org_id=q.org_id AND qr.event_id=q.event_id AND qr.entry_id=q.entry_id AND qr.member_id=q.member_id
    AND qr.material_id=q.material_id AND qr.material_revision_id=q.material_revision_id AND qr.ruleset_id=q.ruleset_id AND qr.roster_revision_id=q.roster_revision_id AND qr.portrait_sha256=q.portrait_sha256
    AND qr.event_start_date=q.event_start_date AND qr.event_end_date=q.event_end_date AND qr.accepted_terms_version='qualification-precheck-v1'
    AND old.ruleset_id=q.ruleset_id AND old.roster_revision_id=q.roster_revision_id AND old.portrait_sha256=q.portrait_sha256
   ORDER BY q.version DESC LIMIT 51`,
        [
          input.orgId,
          input.eventId,
          input.entryId,
          input.memberId,
          r.binding_id,
          r.material_id,
          input.userId,
          input.evidenceQualificationId ?? null,
        ],
      )
    ).rows;
    if (candidates.length > 50) return unavailable;
    for (const evidence of candidates) {
      if (
        evidence.key_id !== keyId ||
        evidence.purged_at ||
        !evidence.payload_ciphertext ||
        !evidence.has_identity ||
        !evidence.has_real_name ||
        !evidence.has_signature ||
        evidence.terms_version !== PARTICIPANT_TERMS_VERSION
      )
        continue;
      if (
        !(
          await c.query(
            `SELECT NOT EXISTS(SELECT 1 FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE') AND NOT EXISTS(SELECT 1 FROM team_member_bindings WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE') AS independent`,
            [input.orgId, r.team_id, evidence.reviewed_by],
          )
        ).rows[0]?.independent
      )
        continue;
      try {
        const old = decryptParticipantPayload(evidence.payload_ciphertext, key, {
          orgId: input.orgId,
          eventId: r.event_id,
          entryId: input.entryId,
          memberId: input.memberId,
          userId: input.userId,
          revisionId: evidence.material_revision_id,
        });
        if (
          !old.realName ||
          !old.identityNumber ||
          !old.acceptedTerms ||
          old.termsVersion !== PARTICIPANT_TERMS_VERSION ||
          !old.portrait ||
          old.portrait.sha256 !== evidence.portrait_sha256 ||
          participantIdentityNumber(old.identityNumber, today) !== identity ||
          name(old.realName) !== name(current.realName)
        )
          continue;
        return {
          ageVerifiedAdult: true,
          teamId: r.team_id,
          bindingId: r.binding_id,
          materialId: r.material_id,
          materialRevisionId: r.material_revision_id,
          materialVersion: r.material_version,
          evidenceQualificationId: evidence.id,
        };
      } catch {
        continue;
      }
    }
    return unavailable;
  };
}
/** Caller holds event lock. Resolve the latest immutable decision before comparing current pins. */
export async function readAdultSelfDataConsent(
  c: PoolClient,
  input: { orgId: string; eventId: string; userId: string; entryId?: string; memberId?: string },
  policyVersion: number,
  reader?: YouthAdultAgeReader,
) {
  if (!reader || !input.entryId || !input.memberId) return null;
  const facts = (
    await c.query(
      `SELECT DISTINCT ON(entry_id,member_id) * FROM youth_adult_data_consents WHERE actor_id=$1 AND org_id=$2 AND event_id=$3 AND entry_id=$4 AND member_id=$5 ORDER BY entry_id,member_id,version DESC LIMIT 101`,
      [input.userId, input.orgId, input.eventId, input.entryId, input.memberId],
    )
  ).rows;
  if (facts.length > 100) return null;
  for (const fact of facts) {
    if (
      fact.decision !== 'CONSENT' ||
      fact.policy_version !== policyVersion ||
      fact.terms_version !== YOUTH_ADULT_DATA_TERMS
    )
      continue;
    const current = await reader(c, {
      ...input,
      entryId: fact.entry_id,
      memberId: fact.member_id,
      evidenceQualificationId: fact.age_evidence_qualification_id,
    });
    if (
      current.ageVerifiedAdult &&
      current.bindingId === fact.binding_id &&
      current.materialId === fact.material_id &&
      current.materialRevisionId === fact.material_revision_id &&
      current.evidenceQualificationId === fact.age_evidence_qualification_id
    )
      return fact;
  }
  return null;
}
/** Append a safety fence; it preserves old consent, identity evidence and ciphertext. No key required. */
export async function withdrawAdultDataForClosure(c: PoolClient, userId: string): Promise<number> {
  const facts = (
    await c.query(
      `SELECT DISTINCT ON(org_id,event_id,entry_id,member_id) * FROM youth_adult_data_consents WHERE actor_id=$1 ORDER BY org_id,event_id,entry_id,member_id,version DESC`,
      [userId],
    )
  ).rows;
  let n = 0;
  for (const f of facts) {
    if (f.decision !== 'CONSENT') continue;
    await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE NOWAIT', [
      f.org_id,
      f.event_id,
    ]);
    await appendAdultWithdrawal(c, f, userId, randomUUID(), 'ACCOUNT_CLOSURE');
    n++;
  }
  return n;
}
export async function appendAdultWithdrawal(
  c: PoolClient,
  f: Record<string, any>,
  performedBy: string,
  clientId: string,
  cause: 'SELF' | 'ACCOUNT_CLOSURE' = 'SELF',
) {
  return (
    await c.query(
      `INSERT INTO youth_adult_data_consents(id,actor_id,performed_by,client_request_id,org_id,event_id,team_id,entry_id,member_id,binding_id,material_id,material_revision_id,age_evidence_qualification_id,policy_version,terms_version,material_version,version,decision,cause)
 SELECT $2,actor_id,$3,$4,org_id,event_id,team_id,entry_id,member_id,binding_id,material_id,material_revision_id,age_evidence_qualification_id,policy_version,terms_version,material_version,version+1,'WITHDRAW',$5 FROM youth_adult_data_consents WHERE id=$1 RETURNING *`,
      [f.id, randomUUID(), performedBy, clientId, cause],
    )
  ).rows[0];
}

/** The isolated restore transaction must already block app activity; no key or private payload is read. */
export const QUARANTINE_ADULT_DATA_CONSENTS_SQL = `WITH latest AS MATERIALIZED (
 SELECT DISTINCT ON(actor_id,org_id,event_id,entry_id,member_id) * FROM youth_adult_data_consents
 ORDER BY actor_id,org_id,event_id,entry_id,member_id,version DESC
) INSERT INTO youth_adult_data_consents(id,actor_id,performed_by,client_request_id,org_id,event_id,team_id,entry_id,member_id,binding_id,material_id,material_revision_id,age_evidence_qualification_id,policy_version,terms_version,material_version,version,decision,cause)
 SELECT gen_random_uuid(),actor_id,$1::uuid,gen_random_uuid(),org_id,event_id,team_id,entry_id,member_id,binding_id,material_id,material_revision_id,age_evidence_qualification_id,policy_version,terms_version,material_version,version+1,'WITHDRAW','RESTORE_QUARANTINE' FROM latest WHERE decision='CONSENT' RETURNING id`;
export async function quarantineAdultDataConsents(c: PoolClient, systemActor: string) {
  return (await c.query(QUARANTINE_ADULT_DATA_CONSENTS_SQL, [systemActor])).rowCount ?? 0;
}
