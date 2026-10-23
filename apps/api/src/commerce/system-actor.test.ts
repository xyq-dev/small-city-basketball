import type { PoolClient } from 'pg';
import { describe, expect, test, vi } from 'vitest';
import { createCommerceSystemActor } from './system-actor.js';

describe('non-login commercial audit identities', () => {
  test('creates distinct disabled identities without credentials, roles, sessions or a nested transaction', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const client = { query } as unknown as PoolClient;
    const first = await createCommerceSystemActor(client, 'PLATFORM_MAINTENANCE');
    const second = await createCommerceSystemActor(client, 'LEDGER');
    expect(first).not.toBe(second);
    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql, values] of query.mock.calls) {
      expect(sql).toContain("'DISABLED'");
      expect(sql).toMatch(/^INSERT INTO users/);
      expect(values[1]).toBe(`commerce-system-${values[0]}@system.invalid`);
      expect(values[3]).not.toMatch(/^scrypt\$/);
      expect(values[3].length).toBeGreaterThanOrEqual(80);
      expect(values[3].length).toBeLessThanOrEqual(256);
    }
    expect(query.mock.calls.map((c) => c[1][0])).toEqual([first, second]);
  });
  test('does not fabricate a valid actor when insertion fails; the caller must roll back', async () => {
    const failure = Object.assign(new Error('synthetic database rejection'), { code: '23514' });
    const query = vi.fn().mockRejectedValue(failure);
    await expect(
      createCommerceSystemActor({ query } as unknown as PoolClient, 'LEDGER'),
    ).rejects.toBe(failure);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
