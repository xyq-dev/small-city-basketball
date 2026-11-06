import { ApplicationService } from './service.js';
import type { DbUser } from './service.js';
import { ApiError, unauthenticated } from './errors.js';
import { hashPassword, hashToken, verifyPassword } from './security.js';
import { invalid, objectInput, passwordInput } from './validation.js';

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function parseChangePasswordInput(raw: unknown): ChangePasswordInput {
  const input = objectInput(raw, ['currentPassword', 'newPassword', 'confirmPassword']);
  const currentPassword = passwordInput(input.currentPassword);
  const newPassword = passwordInput(input.newPassword);
  const confirmPassword = passwordInput(input.confirmPassword);
  if (newPassword !== confirmPassword)
    invalid('两次输入的新密码不一致', { confirmPassword: '请再次输入相同的新密码' });
  return { currentPassword, newPassword, confirmPassword };
}

/** Changes only the identity proved by the live session; no target user is accepted. */
export class ChangePasswordService extends ApplicationService {
  async changePassword(cookie: string | undefined, raw: unknown, peer: string) {
    const input = parseChangePasswordInput(raw);
    await this.rateLimit(`password-change-ip:${hashToken(peer)}`, 30, 900);
    // Finish the read transaction before expensive scrypt. Holding SHARE locks and
    // upgrading them in competing password changes would otherwise deadlock.
    const candidate = await this.transaction((client) => this.lockActor(client, cookie));
    await this.rateLimit(`password-change-user:${candidate.user.id}`, 5, 900);
    if (!(await verifyPassword(input.currentPassword, candidate.user.password_hash)))
      throw new ApiError(422, 'CURRENT_PASSWORD_INVALID', '当前密码不正确');
    if (input.newPassword === input.currentPassword)
      throw new ApiError(422, 'PASSWORD_REUSE_NOT_ALLOWED', '新密码不能与当前密码相同');
    const newHash = await hashPassword(input.newPassword);
    return this.transaction(async (client) => {
      await client.query("SET LOCAL lock_timeout = '15s'");
      // Login shares this key; offline maintenance and this path hold it
      // exclusively before draining session -> user locks. No login can add an
      // old-password session between enumeration and the final revocation.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `scb-account-maintenance:${candidate.user.id}`,
      ]);
      await client.query(
        'SELECT id FROM sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY id FOR UPDATE',
        [candidate.user.id],
      );
      const current = (
        await client.query<DbUser>(
          'SELECT id,email,display_name,password_hash,status FROM users WHERE id=$1 FOR UPDATE',
          [candidate.user.id],
        )
      ).rows[0];
      // This repeats authorization at the mutation boundary, including the
      // credential barrier used by recovery. A session expiring during scrypt,
      // another reset, or account disablement must leave all state untouched.
      const session = await client.query(
        `SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id
         WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL
           AND s.expires_at>clock_timestamp()
           AND s.created_at>COALESCE(u.credential_reset_at,'-infinity'::timestamptz)`,
        [candidate.sessionId, candidate.user.id],
      );
      if (!current || current.status !== 'ACTIVE' || !session.rowCount) throw unauthenticated();
      if (current.password_hash !== candidate.user.password_hash)
        throw new ApiError(409, 'ACCOUNT_CHANGED', '账号凭据已变化，请重新登录');
      await client.query(
        'UPDATE users SET password_hash=$2,credential_reset_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1',
        [current.id, newHash],
      );
      const revoked = await client.query(
        'UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL',
        [current.id],
      );
      // Recovery locks user before token, matching this order. A concurrent
      // request either creates a token for the new credential or is revoked here.
      await client.query(
        'UPDATE account_action_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL',
        [current.id],
      );
      await this.audit(client, current.id, null, 'AUTH_PASSWORD_CHANGED', 'user', current.id, {
        sessionsRevoked: revoked.rowCount ?? 0,
      });
      return { completed: true };
    });
  }
}
