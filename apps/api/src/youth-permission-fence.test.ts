import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { fenceYouthSubject } from './youth-permission-fence.js';

describe('first global youth declaration fence', () => {
  it('acquires NOWAIT authority before touching the physical user tuple without changing business fields', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'subject' }], rowCount: 1 });
    await fenceYouthSubject({ query } as unknown as PoolClient, 'subject');
    expect(query.mock.calls).toEqual([
      ['SELECT id FROM users WHERE id=$1 FOR UPDATE NOWAIT', ['subject']],
      ['UPDATE users SET updated_at=updated_at WHERE id=$1', ['subject']],
    ]);
  });
  it('reports an occupied authority lock as a definite retryable conflict and never changes a tuple', async () => {
    const query = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('lock unavailable'), { code: '55P03' }));
    await expect(
      fenceYouthSubject({ query } as unknown as PoolClient, 'subject'),
    ).rejects.toMatchObject({
      status: 409,
      code: 'YOUTH_AUTHORITY_BUSY',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('preserves serialization failure so snapshot readers/writers may use the existing transaction retry', async () => {
    const error = Object.assign(new Error('serialization failure'), { code: '40001' });
    const query = vi.fn().mockRejectedValue(error);
    await expect(fenceYouthSubject({ query } as unknown as PoolClient, 'subject')).rejects.toBe(
      error,
    );
  });
});
