import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  readParticipantDataConsent,
  readParticipantMaterialGuards,
} from './participant-materials-guards.js';
import { readEntryParticipantEligibility } from './participant-materials-eligibility.js';
import {
  participantEligibility,
  PARTICIPANT_TERMS_VERSION,
} from './participant-materials-domain.js';
const c = {} as PoolClient;
const base = {
  orgId: 'org',
  eventId: 'event',
  entryId: 'entry',
  memberId: 'member',
  rosterRevisionId: 'roster',
  rulesetId: 'rules',
  policyDate: '2026-11-01',
  startDate: '2026-11-01',
  endDate: '2026-11-02',
  userId: 'subject',
  identityNumber: '990000199001010000',
};
const material = {
  status: 'APPROVED' as const,
  rulesetId: 'rules',
  rosterRevisionId: 'roster',
  jerseyNo: '8',
  termsVersion: PARTICIPANT_TERMS_VERSION,
  hasRealName: true,
  hasIdentity: true,
  hasPortrait: true,
  hasInsurance: false,
  insuranceStartDate: null,
  insuranceEndDate: null,
  reviewedStartDate: base.startDate,
  reviewedEndDate: base.endDate,
};
const context = {
  required: true,
  requireInsurance: true,
  keyAvailable: true,
  bindingActive: true,
  rulesetId: 'rules',
  rosterRevisionId: 'roster',
  jerseyNo: '8',
  eventStartDate: base.startDate,
  eventEndDate: base.endDate,
  material,
};
describe('C23 trusted current insurance and guardian gates', () => {
  it('a verified online policy substitutes only insurance, never identity, portrait or final approval', () => {
    expect(participantEligibility(context).eligible).toBe(false);
    expect(participantEligibility({ ...context, onlineInsuranceReady: true }).eligible).toBe(true);
    for (const changed of [
      { hasIdentity: false },
      { hasPortrait: false },
      { status: 'DRAFT' as const },
    ])
      expect(
        participantEligibility({
          ...context,
          onlineInsuranceReady: true,
          material: { ...material, ...changed },
        }).eligible,
      ).toBe(false);
  });
  it('under14 data collection fails closed even without an enabled event adapter', async () => {
    const input = { ...base, identityNumber: '990000201501010000' };
    expect(await readParticipantDataConsent(c, {}, input)).toEqual({
      ready: false,
      required: true,
    });
    const guard = vi.fn().mockResolvedValue({ ready: false, required: true });
    expect((await readParticipantDataConsent(c, { dataConsentGuard: guard }, input)).ready).toBe(
      false,
    );
    expect(guard.mock.calls[0]?.[1].forceRequired).toBe(true);
  });
  it('policy-required consent can block adult processing too; no later guard runs before consent', async () => {
    const participation = vi.fn(),
      insurance = vi.fn();
    const r = await readParticipantMaterialGuards(
      c,
      {
        dataConsentGuard: async () => ({ ready: false, required: true }),
        participationGuard: participation,
        onlineInsuranceGuard: insurance,
      },
      base,
      true,
    );
    expect(r.dataConsent.ready).toBe(false);
    expect(participation).not.toHaveBeenCalled();
    expect(insurance).not.toHaveBeenCalled();
  });
  it('guardian revocation prevents fresh online policy use and no online read runs', async () => {
    const insurance = vi.fn();
    const r = await readParticipantMaterialGuards(
      c,
      { participationGuard: async () => ({ ready: false }), onlineInsuranceGuard: insurance },
      base,
      true,
    );
    expect(r.participationReady).toBe(false);
    expect(r.onlineInsuranceReady).toBe(false);
    expect(insurance).not.toHaveBeenCalled();
  });
  it('freeze records current server policy proof but blocks missing current guardian confirmation', async () => {
    const row = {
      member_id: 'member',
      jersey_no: '8',
      material_id: 'material',
      version: 3,
      status: 'APPROVED',
      binding_id: 'binding',
      user_id: 'subject',
      reservation_active: true,
      reviewed_start_date: base.startDate,
      reviewed_end_date: base.endDate,
      material_key_id: 'key',
      revision_id: 'revision',
      ruleset_id: 'rules',
      roster_revision_id: 'roster',
      saved_jersey_no: '8',
      key_id: 'key',
      terms_version: PARTICIPANT_TERMS_VERSION,
      has_identity: true,
      has_real_name: true,
      has_signature: true,
      portrait_bytes: 10,
      insurance_bytes: 0,
      insurance_start_date: null,
      insurance_end_date: null,
      purged_at: null,
      binding_active: true,
    };
    const client = { query: vi.fn().mockResolvedValue({ rows: [row] }) } as unknown as PoolClient;
    const input = {
      orgId: 'org',
      eventId: 'event',
      entryId: 'entry',
      rosterRevisionId: 'roster',
      rulesetId: 'rules',
      startDate: base.startDate,
      endDate: base.endDate,
      requireParticipantMaterials: true,
      requireInsurance: true,
      keyId: 'key',
    };
    const ready = await readEntryParticipantEligibility(client, input, {
      participationGuard: async () => ({
        ready: true,
        snapshot: { requestId: 'guardian-current' },
      }),
      onlineInsuranceGuard: async () => ({ ready: true, orderId: 'issued-current' }),
    });
    expect(ready.ready).toBe(true);
    expect(ready.snapshots[0]).toMatchObject({
      onlineInsuranceOrderId: 'issued-current',
      guardianSnapshot: { requestId: 'guardian-current' },
    });
    const revoked = await readEntryParticipantEligibility(client, input, {
      participationGuard: async () => ({ ready: false }),
      onlineInsuranceGuard: async () => ({ ready: true, orderId: 'issued-current' }),
    });
    expect(revoked.ready).toBe(false);
    expect(revoked.blockers.map((b) => b.code)).toContain('YOUTH_PARTICIPATION_BLOCKED');
    expect(revoked.snapshots).toEqual([]);
  });
});
