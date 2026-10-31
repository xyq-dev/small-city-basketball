import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createYouthQualificationReader,
  qualificationMaterialCurrent,
} from './qualification-precheck-service.js';
import {
  encryptParticipantPayload,
  participantKeyId,
  PARTICIPANT_TERMS_VERSION,
} from './participant-materials-domain.js';
const key = Buffer.alloc(32, 8),
  id = () => randomUUID();
function fixture(
  change: Record<string, unknown> = {},
  approvalChange: Record<string, unknown> = {},
  birth = '20100101',
  guardReady?: boolean,
) {
  const orgId = id(),
    eventId = id(),
    entryId = id(),
    memberId = id(),
    userId = id(),
    revisionId = id(),
    binding = id(),
    rules = id(),
    roster = id();
  const input = {
    orgId,
    eventId,
    entryId,
    memberId,
    rulesetId: rules,
    rosterRevisionId: roster,
    policyDate: '2026-11-01',
  };
  const first = `990000${birth}123`,
    weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const identity =
    first + '10X98765432'[[...first].reduce((s, n, i) => s + Number(n) * weights[i]!, 0) % 11];
  const row: Record<string, any> = {
    entry_id: entryId,
    event_id: eventId,
    team_id: id(),
    ruleset_id: rules,
    roster_revision_id: roster,
    entry_status: 'DRAFT',
    start_date: '2026-11-01',
    end_date: '2026-11-08',
    material_id: id(),
    material_revision_id: revisionId,
    material_version: 3,
    user_id: userId,
    binding_id: binding,
    current_binding_id: binding,
    key_id: participantKeyId(key),
    material_key_id: participantKeyId(key),
    material_status: 'SUBMITTED',
    reservation_active: true,
    material_ruleset_id: rules,
    material_roster_revision_id: roster,
    portrait_sha256: 'a'.repeat(64),
    portrait_bytes: 3,
    has_real_name: true,
    has_identity: true,
    has_signature: true,
    terms_version: PARTICIPANT_TERMS_VERSION,
    purged_at: null,
    material_jersey_no: '3',
    jersey_no: '3',
  };
  row.payload_ciphertext = encryptParticipantPayload(
    {
      realName: '合成少年',
      identityNumber: identity,
      portrait: {
        fileName: 'synthetic.jpg',
        contentType: 'image/jpeg',
        base64: 'YWJj',
        byteLength: 3,
        sha256: 'a'.repeat(64),
      },
      insurance: null,
      acceptedTerms: true,
      termsVersion: PARTICIPANT_TERMS_VERSION,
      publicityConsent: false,
    },
    key,
    { orgId, eventId, entryId, memberId, userId, revisionId },
  );
  const approval = {
    id: id(),
    status: 'APPROVED',
    user_id: userId,
    material_id: row.material_id,
    material_revision_id: revisionId,
    material_version: 3,
    ruleset_id: rules,
    roster_revision_id: roster,
    portrait_sha256: 'a'.repeat(64),
    event_start_date: '2026-11-01',
    event_end_date: '2026-11-08',
    reviewed_by: id(),
    ...approvalChange,
  };
  Object.assign(row, change);
  const client = {
    query: async (sql: string) => {
      if (sql.startsWith('SELECT team_id FROM entries'))
        return { rows: [{ team_id: row.team_id }] };
      if (sql.startsWith('SELECT id FROM teams'))
        return { rowCount: 1, rows: [{ id: row.team_id }] };
      if (sql.includes('FROM entries e JOIN events')) return { rows: [row] };
      if (sql.includes('FROM participant_qualification_prechecks')) {
        expect(sql).toContain('ORDER BY version DESC LIMIT 1');
        expect(sql).not.toContain("status='APPROVED'");
        return { rows: [approval] };
      }
      if (sql.includes('SELECT NOT EXISTS')) return { rows: [{ ok: true }] };
      throw Error(sql);
    },
  } as unknown as PoolClient;
  return {
    input,
    row,
    read: () =>
      createYouthQualificationReader(
        key.toString('base64'),
        guardReady === undefined ? {} : { dataConsentGuard: async () => ({ ready: guardReady }) },
      )(client, input),
  };
}
describe('insurance-independent qualification evidence', () => {
  it('returns internally derived DOB from independently approved current submitted material without any insurance', async () => {
    const f = fixture();
    expect(qualificationMaterialCurrent(f.row, participantKeyId(key))).toBe(true);
    const result = await f.read();
    expect(result).toMatchObject({
      ready: true,
      birthDate: '2010-01-01',
      materialRevisionId: f.row.material_revision_id,
    });
  });
  it.each([
    { material_status: 'DRAFT' },
    { material_status: 'CHANGES_REQUESTED' },
    { reservation_active: false },
    { portrait_bytes: 0 },
    { has_signature: false },
    { current_binding_id: randomUUID() },
    { start_date: '2026-11-02' },
  ])('rejects changed, incomplete, withdrawn or unbound evidence: %j', async (change) => {
    expect((await fixture(change).read()).ready).toBe(false);
  });
  it('a publicity-only or final-review head version change preserves the same qualification source', async () => {
    expect((await fixture({ material_version: 4, material_status: 'APPROVED' }).read()).ready).toBe(
      true,
    );
  });
  it('under-14 qualification fails closed without current data-processing guardian consent', async () => {
    expect((await fixture({}, {}, '20150101').read()).ready).toBe(false);
    expect((await fixture({}, {}, '20150101', false).read()).ready).toBe(false);
    expect((await fixture({}, {}, '20150101', true).read()).ready).toBe(true);
  });
  it('a latest rejection never revives an earlier approval', async () => {
    expect((await fixture({}, { status: 'REJECTED' }).read()).ready).toBe(false);
  });
  it('wrong material encryption key fails qualification closed without exposing identity', async () => {
    const f = fixture({ key_id: participantKeyId(Buffer.alloc(32, 9)) });
    const x = await f.read();
    expect(x).toEqual({
      ready: false,
      subjectUserId: null,
      materialId: null,
      materialRevisionId: null,
      qualificationId: null,
      birthDate: null,
    });
  });
});
