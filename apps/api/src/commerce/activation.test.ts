import { describe, expect, test, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { activateEventCommerce } from './activation.js';
const input = {
  orgId: 'org',
  eventId: 'event',
  actorId: 'actor',
  participantCount: 4,
  expectedMatchCount: 6,
  mode: 'ENFORCED' as const,
};
describe('event activation uses the caller transaction, with grandfather/continuation semantics', () => {
  test('an already activated event never rechecks expiry or quota during later rounds', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ event_id: 'event' }] });
    await activateEventCommerce({ query } as unknown as PoolClient, input);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).not.toMatch(/BEGIN|COMMIT|valid_until/);
  });
  test('missing or insufficient entitlement blocks initial activation without writing', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(
      activateEventCommerce({ query } as unknown as PoolClient, input),
    ).rejects.toMatchObject({ status: 402, code: 'EVENT_ENTITLEMENT_REQUIRED' });
    expect(query).toHaveBeenCalledTimes(2);
    const small = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'ent', max_teams: 2, max_matches: 1 }] });
    await expect(
      activateEventCommerce({ query: small } as unknown as PoolClient, input),
    ).rejects.toMatchObject({ status: 422, code: 'EVENT_ENTITLEMENT_LIMIT' });
    expect(small).toHaveBeenCalledTimes(2);
  });
  test('OFF records explicit unmetered activation and audit without second transaction', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await activateEventCommerce({ query } as unknown as PoolClient, { ...input, mode: 'OFF' });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1]?.[1]).toContain('UNMETERED');
    expect(query.mock.calls.map((x) => x[0]).join(' ')).not.toMatch(/BEGIN|COMMIT/);
  });
});
