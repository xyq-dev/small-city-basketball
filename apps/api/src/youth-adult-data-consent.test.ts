import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  createYouthAdultAgeReader,
  readAdultSelfDataConsent,
  YOUTH_ADULT_DATA_TERMS,
} from './youth-adult-data-consent.js';
import { readYouthDataProcessingConsent } from './youth-guardians-eligibility.js';
import {
  encryptParticipantPayload,
  participantKeyId,
  PARTICIPANT_TERMS_VERSION,
} from './participant-materials-domain.js';

const id = () => randomUUID();
const input = { orgId: id(), eventId: id(), entryId: id(), memberId: id(), userId: id() },
  team = id(),
  binding = id(),
  material = id(),
  oldRevision = id(),
  revision = id(),
  evidenceId = id();
const key = Buffer.alloc(32, 13),
  keyId = participantKeyId(key);
function identity(birth: string) {
  const first = '990000' + birth.replaceAll('-', '') + '001',
    weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  return first + '10X98765432'[[...first].reduce((n, d, i) => n + Number(d) * weights[i]!, 0) % 11];
}
function source() {
  const payload = {
    realName: '合成成年本人',
    identityNumber: identity('2000-01-01'),
    portrait: {
      fileName: 'portrait.jpg',
      contentType: 'image/jpeg' as const,
      base64: 'YWJj',
      byteLength: 3,
      sha256: 'a'.repeat(64),
    },
    insurance: null,
    acceptedTerms: true,
    termsVersion: PARTICIPANT_TERMS_VERSION,
    publicityConsent: false,
  };
  const seal = (p: typeof payload, r: string) =>
    encryptParticipantPayload(p, key, {
      orgId: input.orgId,
      eventId: input.eventId,
      entryId: input.entryId,
      memberId: input.memberId,
      userId: input.userId,
      revisionId: r,
    });
  const head: any = {
    team_id: team,
    event_id: input.eventId,
    user_id: input.userId,
    material_id: material,
    material_revision_id: revision,
    material_version: 4,
    binding_id: binding,
    current_binding_id: binding,
    reservation_active: true,
    material_status: 'DRAFT',
    entry_status: 'DRAFT',
    key_id: keyId,
    material_key_id: keyId,
    material_ruleset_id: 'rules',
    ruleset_id: 'rules',
    material_roster_revision_id: 'roster',
    roster_revision_id: 'roster',
    material_jersey_no: '1',
    jersey_no: '1',
    purged_at: null,
    payload_ciphertext: seal(payload, revision),
    has_real_name: true,
    has_identity: true,
    has_signature: true,
    terms_version: PARTICIPANT_TERMS_VERSION,
    portrait_bytes: 3,
    portrait_sha256: 'a'.repeat(64),
  };
  const evidence: any = {
    id: evidenceId,
    reviewed_by: id(),
    material_revision_id: oldRevision,
    payload_ciphertext: seal(payload, oldRevision),
    key_id: keyId,
    purged_at: null,
    has_identity: true,
    has_real_name: true,
    has_signature: true,
    terms_version: PARTICIPANT_TERMS_VERSION,
    portrait_sha256: 'a'.repeat(64),
  };
  const state = { head, evidence, independent: true };
  const c = {
    query: async (sql: string) => {
      if (sql.startsWith('SELECT team_id')) return { rows: [{ team_id: team }] };
      if (sql.includes('FOR SHARE')) return { rows: [{ id: team }], rowCount: 1 };
      if (sql.includes('AS material_status')) return { rows: [head] };
      if (sql.includes('AS adult_processing_date'))
        return { rows: [{ adult_processing_date: '2026-10-31' }] };
      if (sql.includes('FROM participant_qualification_prechecks q')) return { rows: [evidence] };
      if (sql.includes(' AS independent')) return { rows: [{ independent: state.independent }] };
      throw new Error('Unexpected age evidence query');
    },
  } as unknown as PoolClient;
  return { c, state, payload, seal };
}
describe('E08 age-only renewal authority', () => {
  it('permits same verified identity with a new complete portrait revision without turning the old precheck into eligibility', async () => {
    const f = source(),
      reader = createYouthAdultAgeReader(key.toString('base64'));
    expect(await reader(f.c, input)).toMatchObject({
      ageVerifiedAdult: true,
      materialRevisionId: revision,
      evidenceQualificationId: evidenceId,
      materialVersion: 4,
    });
    f.state.head.payload_ciphertext = f.seal(
      { ...f.payload, portrait: { ...f.payload.portrait, sha256: 'b'.repeat(64) } },
      revision,
    );
    f.state.head.portrait_sha256 = 'b'.repeat(64);
    expect((await reader(f.c, input)).ageVerifiedAdult).toBe(true);
    expect(await reader(f.c, { ...input, userId: id() })).toMatchObject({
      ageVerifiedAdult: false,
    });
  });
  it.each(['identity', 'name', 'purged', 'binding', 'independent', 'incomplete'] as const)(
    'fails closed when the old age evidence cannot prove the same current person: %s',
    async (change) => {
      const f = source();
      if (change === 'identity')
        f.state.head.payload_ciphertext = f.seal(
          { ...f.payload, identityNumber: identity('1999-01-01') },
          revision,
        );
      if (change === 'name')
        f.state.head.payload_ciphertext = f.seal(
          { ...f.payload, realName: '另一位合成本人' },
          revision,
        );
      if (change === 'purged') f.state.evidence.purged_at = 'now';
      if (change === 'binding') f.state.head.current_binding_id = id();
      if (change === 'independent') f.state.independent = false;
      if (change === 'incomplete') f.state.head.has_signature = false;
      expect(
        (await createYouthAdultAgeReader(key.toString('base64'))(f.c, input)).ageVerifiedAdult,
      ).toBe(false);
    },
  );
  it('unscoped adult evidence never authorizes another material and a new current precheck does not replace the pinned age evidence', async () => {
    const fact = {
      id: id(),
      decision: 'CONSENT',
      policy_version: 1,
      terms_version: YOUTH_ADULT_DATA_TERMS,
      entry_id: input.entryId,
      member_id: input.memberId,
      binding_id: binding,
      material_id: material,
      material_revision_id: revision,
      age_evidence_qualification_id: evidenceId,
    };
    const c = { query: async () => ({ rows: [fact] }) } as unknown as PoolClient;
    const reader = async (_c: PoolClient, i: any) => ({
      ageVerifiedAdult: true,
      teamId: team,
      bindingId: binding,
      materialId: material,
      materialRevisionId: revision,
      materialVersion: 9,
      evidenceQualificationId: i.evidenceQualificationId,
    });
    expect(
      await readAdultSelfDataConsent(
        c,
        { orgId: input.orgId, eventId: input.eventId, userId: input.userId },
        1,
        reader,
      ),
    ).toBeNull();
    expect(await readAdultSelfDataConsent(c, input, 1, reader)).toEqual(fact);
    fact.decision = 'WITHDRAW';
    expect(await readAdultSelfDataConsent(c, input, 1, reader)).toBeNull();
  });
  it('enabled event policy does not force an undeclared adult into guardian processing consent', async () => {
    let declared = false;
    const c = {
      query: async (sql: string) =>
        sql.includes('youth_event_policies')
          ? { rows: [{ enabled: true, version: 1 }] }
          : sql.startsWith('SELECT 1 FROM youth_guardian_preconsents')
            ? { rows: declared ? [{}] : [], rowCount: declared ? 1 : 0 }
            : { rows: [] },
    } as unknown as PoolClient;
    expect(await readYouthDataProcessingConsent(c, input)).toMatchObject({
      required: false,
      ready: true,
    });
    expect(
      await readYouthDataProcessingConsent(c, { ...input, forceRequired: true }),
    ).toMatchObject({ required: true, ready: false });
    declared = true;
    expect(await readYouthDataProcessingConsent(c, input)).toMatchObject({
      required: true,
      ready: false,
    });
  });
});

it('an adult withdrawal cannot fall back to a formerly active guardian grant', async () => {
  const c = {
    query: async (sql: string) => {
      if (sql.includes('youth_event_policies')) return { rows: [{ enabled: true, version: 1 }] };
      if (sql.startsWith('SELECT 1 FROM youth_guardian_preconsents'))
        return { rows: [{}], rowCount: 1 };
      if (sql.startsWith('SELECT DISTINCT ON(entry_id,member_id)'))
        return { rows: [{ decision: 'WITHDRAW' }] };
      if (sql.startsWith('SELECT 1 FROM youth_adult_data_consents'))
        return { rows: [{}], rowCount: 1 };
      if (sql.startsWith('SELECT decision FROM youth_adult_data_consents'))
        return { rows: [{ decision: 'WITHDRAW' }] };
      if (sql.includes('SELECT p.*')) throw new Error('withdrawal must not fall back to guardian');
      return { rows: [] };
    },
  } as unknown as PoolClient;
  const adultReader = async () => ({
    ageVerifiedAdult: true,
    teamId: team,
    bindingId: binding,
    materialId: material,
    materialRevisionId: revision,
    materialVersion: 4,
    evidenceQualificationId: evidenceId,
  });
  expect(await readYouthDataProcessingConsent(c, input, adultReader)).toMatchObject({
    ready: false,
    blockers: ['YOUTH_ADULT_DATA_CONSENT_RENEWAL_REQUIRED'],
  });
  expect(
    await readYouthDataProcessingConsent(
      c,
      { orgId: input.orgId, eventId: input.eventId, userId: input.userId },
      adultReader,
    ),
  ).toMatchObject({ ready: false, blockers: ['YOUTH_ADULT_DATA_SCOPE_REQUIRED'] });
});
