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
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(
      activateEventCommerce({ query } as unknown as PoolClient, input),
    ).rejects.toMatchObject({ status: 402, code: 'EVENT_ENTITLEMENT_REQUIRED' });
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls.map((c) => c[0]).join(' ')).not.toMatch(
      /INSERT|UPDATE event_commercial/,
    );
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

describe('membership fallback shares the original publication transaction', () => {
  function client(delta: Record<string, unknown> = {}) {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'period', order_id: 'member-order' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'member-order' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'period',
            max_teams: 16,
            max_matches: 128,
            event_limit: 3,
            used_events: 2,
            usable: true,
            ...delta,
          },
        ],
      })
      .mockResolvedValue({ rowCount: 1, rows: [] });
    return query;
  }
  test('locks order then period and inserts only the canonical event activation once', async () => {
    const query = client();
    await activateEventCommerce({ query } as unknown as PoolClient, input);
    expect(query.mock.calls[5]?.[0]).toMatch(/billing_orders.*FOR UPDATE/);
    expect(query.mock.calls[6]?.[0]).toMatch(/FOR UPDATE OF p/);
    const insert = query.mock.calls.find((c) =>
      /INSERT INTO event_commercial_activations/.test(c[0]),
    );
    expect(insert?.[1]).toEqual(['event', 'org', 'MEMBERSHIP', null, 4, 6, 'actor', 'period']);
    expect(query.mock.calls.map((c) => c[0]).join(' ')).not.toMatch(
      /BEGIN|COMMIT|software_membership_allocations/,
    );
  });
  test.each([
    [{ usable: false }, 'MEMBERSHIP_UNAVAILABLE'],
    [{ used_events: 3 }, 'MEMBERSHIP_QUOTA_EXHAUSTED'],
    [{ max_teams: 2 }, 'MEMBERSHIP_EVENT_LIMIT'],
    [{ max_matches: 5 }, 'MEMBERSHIP_EVENT_LIMIT'],
  ])('rejects changed membership source or quota without consuming %j', async (delta, code) => {
    const query = client(delta as Record<string, unknown>);
    await expect(
      activateEventCommerce({ query } as unknown as PoolClient, input),
    ).rejects.toMatchObject({ code });
    expect(query.mock.calls.map((c) => c[0]).join(' ')).not.toMatch(/INSERT/);
  });
  test('an unresolved per-event purchase blocks fallback before a membership is touched', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'pending-event-order' }] });
    await expect(
      activateEventCommerce({ query } as unknown as PoolClient, input),
    ).rejects.toMatchObject({ code: 'EVENT_PURCHASE_REVIEW_REQUIRED' });
    expect(query).toHaveBeenCalledTimes(3);
  });
});
