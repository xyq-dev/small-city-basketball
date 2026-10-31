import { describe, expect, test } from 'vitest';
import { actorShareLockQuery } from '../test/fixtures/actor-share-lock.js';
describe('deterministic quarantine actor lock observation', () => {
  test('observes both historical and timestamp-barrier actor locks after their SQL completed', () => {
    expect(actorShareLockQuery('SELECT id,email FROM users WHERE id=$1 FOR SHARE')).toBe(true);
    expect(
      actorShareLockQuery(
        "SELECT u.id,u.email,u.password_hash FROM users u WHERE u.id=$1 AND $2::timestamptz>COALESCE((to_jsonb(u)->>'credential_reset_at')::timestamptz,'-infinity'::timestamptz) FOR SHARE",
      ),
    ).toBe(true);
    expect(actorShareLockQuery('SELECT u.id\nFROM users u\nWHERE u.id=$1 FOR SHARE OF u')).toBe(
      true,
    );
  });
  test('never pauses an unlocked read, different identity parameter, update or a later organization lock', () => {
    for (const sql of [
      'SELECT id FROM users WHERE id=$1',
      'SELECT id FROM users WHERE id=$2 FOR SHARE',
      'UPDATE users SET id=id RETURNING id',
      'SELECT id FROM organizations WHERE id=$1 FOR SHARE',
    ])
      expect(actorShareLockQuery(sql)).toBe(false);
  });
});
