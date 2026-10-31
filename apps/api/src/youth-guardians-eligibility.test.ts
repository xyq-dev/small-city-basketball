import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  readYouthDataProcessingConsent,
  readYouthEligibility,
} from './youth-guardians-eligibility.js';
import { YOUTH_DATA_TERMS_VERSION, YOUTH_TERMS_VERSION } from './youth-guardians-domain.js';

const input = {
  orgId: 'org',
  eventId: 'event',
  entryId: 'entry',
  memberId: 'member',
  rosterRevisionId: 'roster',
  rulesetId: 'rules',
  policyDate: '2026-11-10',
};
const qualification = {
  ready: true,
  subjectUserId: 'child',
  materialId: 'material',
  materialRevisionId: 'revision',
  qualificationId: 'qualification',
  birthDate: '2013-11-11',
};
function fixture() {
  const policy = {
    enabled: true,
    version: 1,
    guardian_age_threshold: 18,
    terms_version: YOUTH_TERMS_VERSION,
  };
  const data = {
    id: 'data',
    version: 2,
    guardian_user_id: 'adult',
    subject_status: 'ACTIVE',
    guardian_status: 'ACTIVE',
    policy_version: 1,
    data_terms_version: YOUTH_DATA_TERMS_VERSION,
    guardian_confirmed_at: 'now',
  };
  const request = {
    id: 'request',
    version: 3,
    subject_user_id: 'child',
    guardian_user_id: 'adult',
    subject_status: 'ACTIVE',
    guardian_status: 'ACTIVE',
    preconsent_id: 'data',
    preconsent_version: 2,
    material_id: 'material',
    material_revision_id: 'revision',
    qualification_id: 'qualification',
    roster_revision_id: 'roster',
    ruleset_id: 'rules',
    policy_version: 1,
    terms_version: YOUTH_TERMS_VERSION,
    status: 'APPROVED',
    subject_confirmed_at: 'now',
    guardian_confirmed_at: 'now',
    guardian_identity_checked: true,
    relationship_checked: true,
    guardian_adult_checked: true,
    reviewed_payload_version: 1,
    guardian_payload_version: 1,
    guardian_payload_ciphertext: 'encrypted',
    proof_purged_at: null,
    subject_purposes: ['PARTICIPATION'],
    guardian_purposes: ['PARTICIPATION'],
  };
  const independent = { ok: true };
  const processingDate = { youth_processing_date: '2026-10-31' };
  const c = {
    query: async (sql: string) => ({
      rows: sql.includes('AS youth_processing_date')
        ? [processingDate]
        : sql.includes('NOT EXISTS(SELECT 1 FROM team_access_grants')
          ? [independent]
          : sql.includes('youth_event_policies')
            ? [policy]
            : sql.includes('youth_guardian_preconsents')
              ? [data]
              : sql.includes('youth_guardian_requests')
                ? [request]
                : [],
    }),
  } as unknown as PoolClient;
  return { policy, data, request, c, independent, processingDate };
}
describe('E08 current consent gate', () => {
  it('keeps legacy policy optional but cannot disable forced youth data consent', async () => {
    const f = fixture();
    f.policy.enabled = false;
    expect((await readYouthDataProcessingConsent(f.c, { ...input, userId: 'child' })).ready).toBe(
      true,
    );
    expect(
      await readYouthDataProcessingConsent(f.c, { ...input, userId: 'child', forceRequired: true }),
    ).toMatchObject({ required: true, ready: false, blockers: ['YOUTH_POLICY_REQUIRED'] });
  });
  it('only admits an independently reviewed current grant and never expands participation purpose', async () => {
    const f = fixture();
    expect((await readYouthEligibility(f.c, input, async () => qualification)).ready).toBe(true);
    for (const purpose of ['PUBLICITY', 'PUBLIC_ARCHIVE', 'LIVE_RECORDING'] as const)
      expect(
        (await readYouthEligibility(f.c, { ...input, purpose }, async () => qualification))
          .blockers,
      ).toEqual(['GUARDIAN_PURPOSE_CONSENT_REQUIRED']);
    f.request.subject_purposes.push('LIVE_RECORDING');
    expect(
      (
        await readYouthEligibility(
          f.c,
          { ...input, purpose: 'LIVE_RECORDING' },
          async () => qualification,
        )
      ).ready,
    ).toBe(false);
    f.request.guardian_purposes.push('LIVE_RECORDING');
    expect(
      (
        await readYouthEligibility(
          f.c,
          { ...input, purpose: 'LIVE_RECORDING' },
          async () => qualification,
        )
      ).ready,
    ).toBe(true);
  });
  it.each([
    'preconsent_version',
    'material_revision_id',
    'qualification_id',
    'roster_revision_id',
    'ruleset_id',
    'policy_version',
    'terms_version',
  ] as const)('blocks a changed source: %s', async (field) => {
    const f = fixture();
    (f.request as Record<string, unknown>)[field] = 'changed';
    expect((await readYouthEligibility(f.c, input, async () => qualification)).blockers).toEqual([
      'GUARDIAN_SOURCE_CHANGED',
    ]);
  });
  it('requires current active parties, proof and independent review after resubmission', async () => {
    for (const patch of [
      { guardian_status: 'CLOSED' },
      { status: 'WITHDRAWN' },
      { reviewed_payload_version: 0 },
      { relationship_checked: false },
      { proof_purged_at: 'now' },
    ]) {
      const f = fixture();
      Object.assign(f.request, patch);
      expect((await readYouthEligibility(f.c, input, async () => qualification)).ready).toBe(false);
    }
  });
  it('invalidates approval if the guardian reviewer later joins the associated team', async () => {
    const f = fixture();
    f.independent.ok = false;
    expect((await readYouthEligibility(f.c, input, async () => qualification)).blockers).toEqual([
      'GUARDIAN_INDEPENDENT_REVIEW_REQUIRED',
    ]);
  });
  it('uses trusted event-date age, not a client declaration, and adults do not need guardian grants', async () => {
    const f = fixture();
    f.data.guardian_status = 'CLOSED';
    expect(
      (
        await readYouthEligibility(f.c, input, async () => ({
          ...qualification,
          birthDate: '2008-11-10',
        }))
      ).ready,
    ).toBe(true);
    expect(
      (await readYouthEligibility(f.c, input, async () => ({ ...qualification, ready: false })))
        .ready,
    ).toBe(false);
    expect((await readYouthEligibility(f.c, input)).ready).toBe(false);
  });
});

it('uses today for public processing even when the verified event-date age is already adult', async () => {
  const f = fixture(),
    q = { ...qualification, birthDate: '2008-11-01' };
  expect(await readYouthEligibility(f.c, input, async () => q)).toMatchObject({
    required: false,
    ready: true,
  });
  expect(
    await readYouthEligibility(f.c, { ...input, purpose: 'PUBLIC_ARCHIVE' }, async () => q),
  ).toMatchObject({ required: true, ready: false });
  f.request.subject_purposes.push('PUBLIC_ARCHIVE');
  f.request.guardian_purposes.push('PUBLIC_ARCHIVE');
  expect(
    await readYouthEligibility(f.c, { ...input, purpose: 'PUBLIC_ARCHIVE' }, async () => q),
  ).toMatchObject({ required: true, ready: true });
  f.request.status = 'WITHDRAWN';
  expect(
    (await readYouthEligibility(f.c, { ...input, purpose: 'PUBLIC_ARCHIVE' }, async () => q)).ready,
  ).toBe(false);
  expect((await readYouthEligibility(f.c, input, async () => q)).ready).toBe(true);
  f.processingDate.youth_processing_date = '2026-11-01';
  expect(
    await readYouthEligibility(f.c, { ...input, purpose: 'PUBLIC_ARCHIVE' }, async () => q),
  ).toMatchObject({ required: false, ready: true });
});
