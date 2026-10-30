import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { readEntryParticipantEligibility } from './participant-materials-eligibility.js';

describe('C23 entry-level participant readiness', () => {
  it('does not mistake an unfilled member for a broken configured encryption service', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ member_id: 'member', jersey_no: '8', material_id: null, revision_id: null }],
      }),
    };
    const input = {
      orgId: 'org',
      eventId: 'event',
      entryId: 'entry',
      rosterRevisionId: 'roster',
      rulesetId: 'rules',
      startDate: '2028-01-01',
      endDate: '2028-01-02',
      requireParticipantMaterials: true,
      requireInsurance: true,
      keyId: 'configured-key',
    };
    const ready = await readEntryParticipantEligibility(client as unknown as PoolClient, input);
    expect(ready.ready).toBe(false);
    expect(ready.blockers.map((b) => b.code)).toContain('MATERIALS_REQUIRED');
    expect(ready.blockers.map((b) => b.code)).not.toContain('PARTICIPANT_DATA_UNAVAILABLE');
    const unavailable = await readEntryParticipantEligibility(client as unknown as PoolClient, {
      ...input,
      keyId: null,
    });
    expect(unavailable.blockers.map((b) => b.code)).toContain('PARTICIPANT_DATA_UNAVAILABLE');
  });
});
