import type { PoolClient } from 'pg';
import type { QualificationInput } from './qualification-precheck-service.js';
import {
  qualificationBirthDate,
  qualificationUnder14,
  qualificationDataProcessingDate,
} from './qualification-precheck-service.js';

/** Inject trusted current-data readers only. No provider network call is permitted within material transactions. */
export interface ParticipantMaterialGuards {
  dataConsentGuard?: (
    c: PoolClient,
    input: {
      orgId: string;
      eventId: string;
      userId: string;
      forceRequired: boolean;
      entryId?: string;
      memberId?: string;
    },
  ) => Promise<{ ready: boolean; required?: boolean }>;
  participationGuard?: (
    c: PoolClient,
    input: QualificationInput,
  ) => Promise<{ ready: boolean; snapshot?: unknown }>;
  onlineInsuranceGuard?: (
    c: PoolClient,
    input: QualificationInput & { startDate: string; endDate: string },
  ) => Promise<{ ready: boolean; orderId?: string | null }>;
}
export async function readParticipantDataConsent(
  c: PoolClient,
  guards: ParticipantMaterialGuards,
  input: {
    orgId: string;
    eventId: string;
    userId: string;
    entryId?: string;
    memberId?: string;
    identityNumber: string | null;
    policyDate: string;
  },
) {
  const required = Boolean(
    input.identityNumber &&
    qualificationUnder14(
      qualificationBirthDate(input.identityNumber),
      await qualificationDataProcessingDate(c),
    ),
  );
  const result = guards.dataConsentGuard
    ? await guards.dataConsentGuard(c, {
        orgId: input.orgId,
        eventId: input.eventId,
        userId: input.userId,
        entryId: input.entryId,
        memberId: input.memberId,
        forceRequired: required,
      })
    : { ready: !required, required };
  return { ready: result.ready === true, required: required || result.required === true };
}
export async function readParticipantMaterialGuards(
  c: PoolClient,
  guards: ParticipantMaterialGuards,
  input: QualificationInput & {
    userId: string;
    identityNumber: string | null;
    startDate: string;
    endDate: string;
  },
  requireInsurance: boolean,
) {
  const dataConsent = await readParticipantDataConsent(c, guards, input);
  const participation =
    dataConsent.ready && guards.participationGuard
      ? await guards.participationGuard(c, input)
      : { ready: dataConsent.ready };
  const insurance =
    dataConsent.ready && participation.ready && requireInsurance && guards.onlineInsuranceGuard
      ? await guards.onlineInsuranceGuard(c, input)
      : { ready: false, orderId: null };
  return {
    dataConsent,
    participationReady: participation.ready === true,
    guardianSnapshot: 'snapshot' in participation ? participation.snapshot : null,
    onlineInsuranceReady: insurance.ready === true,
    onlineInsuranceOrderId: insurance.ready ? (insurance.orderId ?? null) : null,
  };
}
