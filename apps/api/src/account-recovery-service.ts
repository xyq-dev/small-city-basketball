import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ApplicationService } from './service.js';
import type { ApiOptions, DbUser } from './service.js';
import { ApiError } from './errors.js';
import { hashPassword } from './security.js';
import { objectInput } from './validation.js';
import {
  accountTokenHash,
  deliveryKey,
  openMail,
  parseRecoveryConsume,
  parseRecoveryRequest,
  recoveryFingerprint,
  recoveryId,
  recoveryToken,
  sealMail,
} from './account-recovery-domain.js';
import type { AccountAction } from './account-recovery-domain.js';
import type { AccountMail, AccountMailProvider } from './account-mail-provider.js';

export interface AccountRecoveryOptions {
  provider?: AccountMailProvider;
  encryptionKey?: string;
  autoDispatch?: boolean;
}
type TokenRow = {
  id: string;
  user_id: string;
  purpose: AccountAction;
  email_snapshot: string;
  credential_fingerprint: string;
  expires_at: Date;
  used_at: Date | null;
  used_by: string | null;
  used_request_hash: string | null;
  revoked_at: Date | null;
  valid: boolean;
};
const invalidCode = () =>
  new ApiError(422, 'ACCOUNT_CODE_INVALID', '操作码无效或已失效，请重新申请');
export class AccountRecoveryService extends ApplicationService {
  private readonly key?: Buffer;
  private timer?: ReturnType<typeof setInterval>;
  private dispatching = false;
  constructor(
    pool: Pool,
    options: ApiOptions,
    private readonly recovery: AccountRecoveryOptions = {},
  ) {
    super(pool, options);
    if (recovery.encryptionKey !== undefined) this.key = deliveryKey(recovery.encryptionKey);
    if (!!recovery.provider != !!this.key)
      throw new Error('Complete account mail configuration is required');
  }
  capabilities() {
    return {
      canVerifyEmail: !!this.key,
      canResetPassword: !!this.key,
      delivery: 'PROVIDER_ACCEPTANCE_IS_NOT_DELIVERY',
    };
  }
  async assertConfiguration() {
    if (!this.key) return;
    const id = accountTokenHash(this.key.toString('base64'));
    await this.pool.query(
      'INSERT INTO account_mail_configuration(singleton,key_id) VALUES(true,$1) ON CONFLICT DO NOTHING',
      [id],
    );
    const current = await this.pool.query(
      'SELECT key_id FROM account_mail_configuration WHERE singleton=true',
    );
    if (current.rows[0]?.key_id !== id)
      throw new Error('Account mail key does not match stored configuration');
  }
  startWorker() {
    if (this.key && this.recovery.autoDispatch !== false && !this.timer) {
      this.timer = setInterval(() => {
        void this.drain().catch(() => {
          /* generic operational status, no secret logging */
        });
      }, 5000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private requireEnabled() {
    if (!this.key || !this.recovery.provider)
      throw new ApiError(503, 'ACCOUNT_MAIL_DISABLED', '账号邮件通道尚未配置');
    return this.key;
  }
  async me(cookie?: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const r = await c.query('SELECT email_verified_at FROM users WHERE id=$1', [a.user.id]);
      return {
        email: a.user.email,
        emailVerified: !!r.rows[0]?.email_verified_at,
        ...this.capabilities(),
      };
    });
  }
  async requestReset(raw: unknown, peer: string) {
    const p = parseRecoveryRequest(raw);
    return this.issue('RESET_PASSWORD', p.clientRequestId, p.email, peer);
  }
  async requestVerification(cookie: string | undefined, raw: unknown, peer: string) {
    const b = objectInput(raw, ['clientRequestId']);
    const id = recoveryId(b.clientRequestId);
    const email = await this.transaction(async (c) => (await this.lockActor(c, cookie)).user.email);
    return this.issue('VERIFY_EMAIL', id, email, peer, cookie);
  }
  private async issue(
    purpose: AccountAction,
    id: string,
    email: string,
    peer: string,
    cookie?: string,
  ) {
    const key = this.requireEnabled();
    await this.rateLimit(`account-mail-ip:${accountTokenHash(peer)}`, 30, 3600);
    await this.rateLimit(`account-mail-address:${recoveryFingerprint(key, email)}`, 6, 3600);
    const fingerprint = recoveryFingerprint(key, { purpose, email });
    return this.transaction(async (c) => {
      if (purpose === 'VERIFY_EMAIL') {
        const actor = await this.lockActor(c, cookie);
        if (actor.user.email !== email) throw invalidCode();
      }
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `account-request:${id}`,
      ]);
      const previous = await c.query(
        'SELECT request_hash FROM account_action_requests WHERE id=$1',
        [id],
      );
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash !== fingerprint)
          throw new ApiError(409, 'ACCOUNT_REQUEST_CONFLICT', '原操作编号内容不同');
        return { accepted: true };
      }
      const user = (
        await c.query<DbUser>(
          'SELECT id,email,display_name,password_hash,status FROM users WHERE lower(email)=$1 FOR SHARE',
          [email],
        )
      ).rows[0];
      await c.query(
        'INSERT INTO account_action_requests(id,purpose,request_hash) VALUES($1,$2,$3)',
        [id, purpose, fingerprint],
      );
      if (user?.status === 'ACTIVE') {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `account-token:${user.id}`,
        ]);
        await c.query(
          'UPDATE account_action_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL AND revoked_at IS NULL',
          [user.id, purpose],
        );
        const token = randomBytes(32).toString('base64url'),
          tokenId = randomUUID(),
          jobId = randomUUID();
        await c.query(
          "INSERT INTO account_action_tokens(id,user_id,purpose,token_hash,email_snapshot,credential_fingerprint,expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+($7::int*interval '1 second'))",
          [
            tokenId,
            user.id,
            purpose,
            accountTokenHash(token),
            email,
            accountTokenHash(user.password_hash),
            purpose === 'RESET_PASSWORD' ? 900 : 86400,
          ],
        );
        const mail: AccountMail = {
          to: email,
          subject: purpose === 'RESET_PASSWORD' ? '小城市篮球：重置密码' : '小城市篮球：验证邮箱',
          text: `请在小城市篮球的“我的→账号安全”输入以下操作码：\n${token}\n${purpose === 'RESET_PASSWORD' ? '操作码15分钟内有效。' : '操作码24小时内有效。'}仅供本人使用；若不是你申请，请忽略本邮件。新申请会使同用途旧码失效。`,
        };
        await c.query('INSERT INTO account_mail_jobs(id,token_id,envelope) VALUES($1,$2,$3)', [
          jobId,
          tokenId,
          sealMail(key, jobId, mail),
        ]);
        await this.audit(c, user.id, null, 'ACCOUNT_CODE_REQUESTED', 'account', user.id, {
          purpose,
        });
      }
      // No account-existence, mailbox or provider state in the anonymous response.
      return { accepted: true };
    });
  }
  async receipt(raw: unknown, peer: string) {
    const b = objectInput(raw, ['clientRequestId', 'token']);
    const id = recoveryId(b.clientRequestId),
      token = recoveryToken(b.token);
    await this.rateLimit(`account-consume:${accountTokenHash(peer)}`, 60, 3600);
    return this.transaction(async (c) => {
      const r = await c.query('SELECT used_by FROM account_action_tokens WHERE token_hash=$1', [
        accountTokenHash(token),
      ]);
      return { completed: r.rows[0]?.used_by === id };
    });
  }
  async consume(raw: unknown, peer: string) {
    const key = this.requireEnabled(),
      p = parseRecoveryConsume(raw);
    await this.rateLimit(`account-consume:${accountTokenHash(peer)}`, 60, 3600);
    const fingerprint = recoveryFingerprint(key, {
      token: p.token,
      newPassword: p.newPassword ?? null,
    });
    // Bounded scrypt outside the database transaction. Verification does not hash a password.
    const candidate = (
      await this.pool.query<TokenRow>('SELECT * FROM account_action_tokens WHERE token_hash=$1', [
        accountTokenHash(p.token),
      ])
    ).rows[0];
    if (!candidate) throw invalidCode();
    if ((candidate.purpose === 'RESET_PASSWORD') !== (p.newPassword !== undefined))
      throw invalidCode();
    const newHash = p.newPassword === undefined ? null : await hashPassword(p.newPassword);
    return this.transaction(async (c) => {
      // Session invalidation is a user timestamp barrier, not session-row UPDATE:
      // lockActor holds session->user SHARE; avoiding inverse row locks prevents deadlock.
      const user = (
        await c.query<DbUser>(
          'SELECT id,email,display_name,password_hash,status FROM users WHERE id=$1 FOR UPDATE',
          [candidate.user_id],
        )
      ).rows[0];
      const t = (
        await c.query<TokenRow>(
          'SELECT *,expires_at>clock_timestamp() AS valid FROM account_action_tokens WHERE id=$1 FOR UPDATE',
          [candidate.id],
        )
      ).rows[0];
      if (!user || user.status !== 'ACTIVE' || !t || t.email_snapshot !== user.email)
        throw invalidCode();
      if (t.used_at) {
        if (t.used_by === p.clientRequestId && t.used_request_hash === fingerprint)
          return { completed: true, purpose: t.purpose };
        throw invalidCode();
      }
      if (
        !t.valid ||
        t.revoked_at ||
        t.credential_fingerprint !== accountTokenHash(user.password_hash)
      )
        throw invalidCode();
      if (newHash)
        await c.query(
          'UPDATE users SET password_hash=$2,credential_reset_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1',
          [user.id, newHash],
        );
      else
        await c.query(
          'UPDATE users SET email_verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1',
          [user.id],
        );
      await c.query(
        'UPDATE account_action_tokens SET used_at=clock_timestamp(),used_by=$2,used_request_hash=$3 WHERE id=$1',
        [t.id, p.clientRequestId, fingerprint],
      );
      if (newHash)
        await c.query(
          'UPDATE account_action_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1 AND id<>$2 AND used_at IS NULL AND revoked_at IS NULL',
          [user.id, t.id],
        );
      await this.audit(
        c,
        user.id,
        null,
        t.purpose === 'RESET_PASSWORD' ? 'ACCOUNT_PASSWORD_RESET' : 'ACCOUNT_EMAIL_VERIFIED',
        'account',
        user.id,
        {},
      );
      return { completed: true, purpose: t.purpose };
    });
  }
  async drain() {
    if (!this.key || !this.recovery.provider || this.dispatching) return;
    this.dispatching = true;
    try {
      await this.pool.query(
        "UPDATE account_mail_jobs SET status='UNKNOWN',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE status='SENDING' AND lease_until<=clock_timestamp()",
      );
      await this.pool.query(
        "UPDATE account_mail_jobs j SET status='EXPIRED',envelope=NULL,lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() FROM account_action_tokens t WHERE t.id=j.token_id AND j.status IN ('PENDING','UNKNOWN','FAILED') AND (t.expires_at<=clock_timestamp() OR t.used_at IS NOT NULL OR t.revoked_at IS NOT NULL)",
      );
      for (let count = 0; count < 5; count++) {
        const job = await this.transaction(async (c) => {
          const r = await c.query<{ id: string; envelope: Buffer }>(
            "SELECT j.id,j.envelope FROM account_mail_jobs j JOIN account_action_tokens t ON t.id=j.token_id JOIN users u ON u.id=t.user_id WHERE j.status='PENDING' AND t.expires_at>clock_timestamp() AND t.used_at IS NULL AND t.revoked_at IS NULL AND u.status='ACTIVE' ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED",
          );
          const row = r.rows[0];
          if (!row) return null;
          const lease = randomUUID();
          await c.query(
            "UPDATE account_mail_jobs SET status='SENDING',lease_id=$2,lease_until=clock_timestamp()+interval '30 seconds',attempt_count=attempt_count+1 WHERE id=$1",
            [row.id, lease],
          );
          return { ...row, lease };
        });
        if (!job) break;
        let result: Awaited<ReturnType<AccountMailProvider['send']>>;
        try {
          const mail = openMail(this.key, job.id, job.envelope) as AccountMail;
          result = await this.recovery.provider.send(job.id, mail);
        } catch {
          result = { state: 'FAILED' };
        }
        await this.pool.query(
          "UPDATE account_mail_jobs SET status=$3,provider_id=$4,lease_id=NULL,lease_until=NULL,envelope=CASE WHEN $3 IN ('ACCEPTED','FAILED') THEN NULL ELSE envelope END,updated_at=clock_timestamp() WHERE id=$1 AND status='SENDING' AND lease_id=$2",
          [job.id, job.lease, result.state, result.providerId ?? null],
        );
        // UNKNOWN is never automatically resent. A new user request revokes its old token.
      }
    } finally {
      this.dispatching = false;
    }
  }
}
