import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import type { Actor, OrgActor } from './service.js';
import { MatchExceptionService } from './match-exception-service.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-10-31T00:00:00.000Z');
function fixture(state: Record<string, unknown> | null, kind: 'FORFEIT' | 'CANCELLED' = 'FORFEIT') {
  const actor: OrgActor = {
    sessionId: id(10),
    orgId: id(11),
    role: 'ORG_OWNER',
    user: {
      id: id(7),
      email: 'synthetic@example.test',
      display_name: '合成裁定人员',
      password_hash: 'unused',
      status: 'ACTIVE',
    },
  };
  const match = {
    id: id(1),
    event_id: id(2),
    fixture_key: 'R1-P1',
    version: 2,
    status: 'READY',
    home_entry_id: id(3),
    away_entry_id: id(4),
  };
  const rules = {
    id: id(5),
    event_id: id(2),
    version: 1,
    forfeit_win_points: 2,
    forfeit_loss_points: 0,
    cancellation_policy: 'EXCLUDE_FROM_TABLE',
  };
  const request = {
    id: id(6),
    match_id: match.id,
    event_id: match.event_id,
    status: 'APPROVED',
    operation: 'DECLARE',
    version: 2,
    proposed_by: id(7),
    reviewed_by: id(8),
    reviewed_at: now,
    created_at: now,
    source_match_version: 2,
    rules_id: rules.id,
    rules_version: 1,
    kind,
    forfeiting_side: kind === 'FORFEIT' ? 'HOME' : null,
    winner_entry_id: kind === 'FORFEIT' ? id(4) : null,
    loser_entry_id: kind === 'FORFEIT' ? id(3) : null,
  };
  let stateReads = 0;
  const client = {
    async query(sql: string, values: unknown[]) {
      if (sql.startsWith('SELECT event_id FROM published_matches'))
        return { rows: [{ event_id: match.event_id }] };
      if (sql.includes('FROM events e'))
        return { rows: [{ id: match.event_id, status: 'SCHEDULED', version: 5 }] };
      if (sql.startsWith('SELECT role FROM event_staff')) return { rows: [] };
      if (sql.startsWith('SELECT * FROM published_matches')) return { rows: [match] };
      if (sql.startsWith('SELECT * FROM match_exception_rules')) return { rows: [rules] };
      if (sql.startsWith('SELECT * FROM match_exception_heads'))
        return { rows: [{ version: 2, active_request_id: request.id }] };
      if (sql.startsWith('SELECT * FROM match_exception_requests')) return { rows: [request] };
      if (sql.startsWith('SELECT to_jsonb(s) AS state FROM scoring_states')) {
        expect(values).toEqual([actor.orgId, match.id]);
        stateReads++;
        return { rows: state === null ? [] : [{ state }] };
      }
      if (sql.startsWith('SELECT EXISTS(SELECT 1 FROM scoring_events'))
        return { rows: [{ started: false, consumed: false, state }] };
      throw new Error('Unexpected SQL: ' + sql);
    },
  } as unknown as PoolClient;
  class AuthorizedService extends MatchExceptionService {
    protected override async transaction<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
      return work(client);
    }
    protected override async lockActor(): Promise<Actor> {
      return actor;
    }
    protected override async lockOrganization(): Promise<OrgActor> {
      return actor;
    }
    protected override async ensureFreshSession() {}
  }
  return {
    read: () =>
      new AuthorizedService({} as Pool, {
        databaseUrl: 'postgres://unused@127.0.0.1/unused',
        appOrigin: 'http://127.0.0.1:5173',
      }).get('synthetic', actor.orgId, match.id),
    stateReads: () => stateReads,
  };
}
describe('prepared administrative workbench source', () => {
  it.each(['FORFEIT', 'CANCELLED'] as const)(
    '%s validates the actual prepared scoring state before returning an active decision',
    async (kind) => {
      const f = fixture(
        { source_version: 2, clock_running: false, latest_confirmation_id: null },
        kind,
      );
      const result = await f.read();
      expect(result.active).toMatchObject({ kind, status: 'APPROVED' });
      expect(result.capabilities.canRevoke).toBe(true);
      expect(f.stateReads()).toBe(1);
    },
  );
  it.each([
    null,
    { source_version: 1, clock_running: false, latest_confirmation_id: null },
    { source_version: 2, clock_running: true, latest_confirmation_id: null },
    { source_version: 2, clock_running: false, latest_confirmation_id: id(12) },
  ])('refuses a missing or incompatible persisted scoring state: %j', async (state) => {
    await expect(fixture(state).read()).rejects.toMatchObject({ code: 'RESULT_SOURCE_INVALID' });
  });
});
