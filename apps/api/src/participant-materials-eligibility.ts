import type { PoolClient } from 'pg';
import { ApiError } from './errors.js';
import {
  participantEligibility,
  decryptParticipantPayload,
  participantKey,
  participantIdentityNumber,
} from './participant-materials-domain.js';
import { readParticipantMaterialGuards } from './participant-materials-guards.js';
import type { ParticipantMaterialGuards } from './participant-materials-guards.js';

export interface EntryParticipantEligibilityInput {
  orgId: string;
  eventId: string;
  entryId: string;
  rosterRevisionId: string | null;
  rulesetId: string;
  startDate: string;
  endDate: string;
  requireParticipantMaterials: boolean;
  requireInsurance: boolean;
  keyId: string | null;
  participantDataKey?: string;
}
export interface EntryParticipantEligibility {
  ready: boolean;
  blockers: { memberId: string; code: string; message: string }[];
  snapshots: {
    memberId: string;
    materialId: string;
    revisionId: string;
    materialVersion: number;
    onlineInsuranceOrderId?: string;
    guardianSnapshot?: unknown;
  }[];
}
/** Call only under the existing event lock: material writes take that same event UPDATE lock. */
export async function readEntryParticipantEligibility(
  client: PoolClient,
  input: EntryParticipantEligibilityInput,
  guards: ParticipantMaterialGuards = {},
): Promise<EntryParticipantEligibility> {
  const result: EntryParticipantEligibility = { ready: true, blockers: [], snapshots: [] };
  if (!input.requireParticipantMaterials) return result;
  const players = await client.query(
    `SELECT p.member_id,p.jersey_no,m.id AS material_id,m.version,m.status,m.binding_id,m.user_id,
      m.reservation_active,m.reviewed_start_date::text,m.reviewed_end_date::text,m.key_id AS material_key_id,
      r.id AS revision_id,r.ruleset_id,r.roster_revision_id,r.jersey_no AS saved_jersey_no,
      r.key_id,r.terms_version,r.has_identity,r.has_real_name,r.has_signature,r.portrait_bytes,r.insurance_bytes,
      r.insurance_start_date::text,r.insurance_end_date::text,r.purged_at,r.payload_ciphertext,
      EXISTS(SELECT 1 FROM team_member_bindings b JOIN users u ON u.id=b.user_id AND u.status='ACTIVE'
        JOIN team_members tm ON tm.org_id=b.org_id AND tm.team_id=b.team_id AND tm.id=b.member_id AND tm.status='ACTIVE'
        WHERE b.id=m.binding_id AND b.org_id=p.org_id AND b.team_id=p.team_id AND b.member_id=p.member_id
          AND b.user_id=m.user_id AND b.status='ACTIVE') AS binding_active
    FROM entry_roster_players p
    LEFT JOIN participant_materials m ON m.org_id=p.org_id AND m.entry_id=p.entry_id AND m.member_id=p.member_id
    LEFT JOIN participant_material_revisions r ON r.id=m.current_revision_id AND r.material_id=m.id
    WHERE p.org_id=$1 AND p.entry_id=$2 AND p.revision_id=$3 ORDER BY p.member_id`,
    [input.orgId, input.entryId, input.rosterRevisionId],
  );
  if (!players.rows.length) {
    result.ready = false;
    result.blockers.push({ memberId: '', code: 'ROSTER_REQUIRED', message: '请先保存本届名单' });
    return result;
  }
  for (const row of players.rows) {
    let identityNumber: string | null = null;
    if (
      input.participantDataKey &&
      row.payload_ciphertext &&
      row.key_id === input.keyId &&
      row.material_key_id === input.keyId
    ) {
      const p = decryptParticipantPayload(
        row.payload_ciphertext,
        participantKey(input.participantDataKey),
        {
          orgId: input.orgId,
          eventId: input.eventId,
          entryId: input.entryId,
          memberId: row.member_id,
          userId: row.user_id,
          revisionId: row.revision_id,
        },
      );
      if (p.identityNumber)
        identityNumber = participantIdentityNumber(p.identityNumber, input.startDate);
    }
    const guard = await readParticipantMaterialGuards(
      client,
      guards,
      {
        orgId: input.orgId,
        eventId: input.eventId,
        entryId: input.entryId,
        memberId: row.member_id,
        rosterRevisionId: input.rosterRevisionId!,
        rulesetId: input.rulesetId,
        policyDate: input.startDate,
        startDate: input.startDate,
        endDate: input.endDate,
        userId: row.user_id,
        identityNumber,
      },
      input.requireInsurance,
    );
    const assessment = participantEligibility({
      required: true,
      requireInsurance: input.requireInsurance,
      onlineInsuranceReady: guard.onlineInsuranceReady,
      keyAvailable: Boolean(
        input.keyId &&
        (!row.material_id || (row.key_id === input.keyId && row.material_key_id === input.keyId)),
      ),
      bindingActive: Boolean(row.binding_active && row.reservation_active),
      rulesetId: input.rulesetId,
      rosterRevisionId: input.rosterRevisionId!,
      jerseyNo: row.jersey_no,
      eventStartDate: input.startDate,
      eventEndDate: input.endDate,
      material: row.revision_id
        ? {
            status: row.status,
            rulesetId: row.ruleset_id,
            rosterRevisionId: row.roster_revision_id,
            jerseyNo: row.saved_jersey_no,
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
      assessment.blockers.push({
        code: 'YOUTH_DATA_PROCESSING_CONSENT_REQUIRED',
        message: '当前资料处理监护同意尚未完成',
      });
    if (!guard.participationReady)
      assessment.blockers.push({
        code: 'YOUTH_PARTICIPATION_BLOCKED',
        message: '当前参赛监护确认尚未完成',
      });
    if (!assessment.eligible || assessment.blockers.length) {
      result.ready = false;
      result.blockers.push(...assessment.blockers.map((b) => ({ memberId: row.member_id, ...b })));
    } else {
      result.snapshots.push({
        memberId: row.member_id,
        materialId: row.material_id,
        revisionId: row.revision_id,
        materialVersion: row.version,
        ...(guard.onlineInsuranceOrderId
          ? { onlineInsuranceOrderId: guard.onlineInsuranceOrderId }
          : {}),
        ...(guard.guardianSnapshot ? { guardianSnapshot: guard.guardianSnapshot } : {}),
      });
    }
  }
  return result;
}

/** No silent key rotation: old ciphertext and keyed deduplication must stay readable. */
export async function assertParticipantKeyConsistency(
  client: PoolClient,
  keyId: string | null,
  lockForWrite = false,
): Promise<void> {
  if (!keyId)
    throw new ApiError(503, 'PARTICIPANT_MATERIALS_UNAVAILABLE', '本人资料安全存储尚未配置');
  // A fixed application namespace serializes first writes using different keys across organizations.
  if (lockForWrite) await client.query('SELECT pg_advisory_xact_lock(1127428915,23)');
  const mismatched = await client.query(
    `SELECT 1 FROM participant_material_revisions WHERE payload_ciphertext IS NOT NULL AND key_id<>$1 LIMIT 1`,
    [keyId],
  );
  if (mismatched.rowCount)
    throw new ApiError(
      503,
      'PARTICIPANT_MATERIALS_KEY_MISMATCH',
      '本人资料安全存储配置与已有资料不一致',
    );
}
