import type { PoolClient } from 'pg';
import { ApiError } from './errors.js';

/** Before event locks, protect a global known-youth change against already-started RR public snapshots.
 * The actor may hold its own SHARE lock. NOWAIT makes an upgrade definitive/retryable, never a lock-order wait.
 * Users have no version trigger; all user data and the business timestamp remain unchanged.
 */
export async function fenceYouthSubject(c: PoolClient, userId: string): Promise<void> {
  try {
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE NOWAIT', [userId]);
  } catch (error) {
    if (String((error as { code?: string })?.code) === '55P03') {
      throw new ApiError(409, 'YOUTH_AUTHORITY_BUSY', '当前授权正在核对，请稍后重新读取并重试');
    }
    throw error;
  }
  await c.query('UPDATE users SET updated_at=updated_at WHERE id=$1', [userId]);
}
