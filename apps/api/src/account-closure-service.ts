import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ApplicationService } from './service.js';
import type { Actor, ApiOptions, DbUser } from './service.js';
import { ApiError, unauthenticated } from './errors.js';
import { hashPassword, hashToken, readSessionToken, verifyPassword } from './security.js';
import {
  ACCOUNT_CLOSURE_DOMAINS,
  closureBlockers,
  closureCancelInput,
  closureFail,
  closureHash,
  closureId,
  closureRequestInput,
  closureSecurityFingerprint,
} from './account-closure-domain.js';
import type {
  AccountClosureData,
  AccountClosureWorkspace,
} from '../../../packages/contracts/account-closure.js';

type Row = Record<string, any>;
export interface AccountClosureHooks {
  /** Explicitly wired domains, not discovered by probing future schemas. */
  domains: readonly string[];
  /** Called with user UPDATE held. All additional legacy locks MUST be NOWAIT/try-lock. */
  lockAndInspect(client: PoolClient, userId: string): Promise<string[]>;
  /** Same transaction: new-domain grants, C23 publicity, retained source permissions. */
  revoke(client: PoolClient, userId: string, requestId: string): Promise<void>;
}
export interface AccountClosureOptions {
  enabled?: boolean;
  hooks?: AccountClosureHooks;
  autoDispatch?: boolean;
}
type Reauthenticated = { actor: Actor; tokenHash: string; passwordHash: string };
type Claim = { id: string; userId: string; leaseId: string; fence: string };
const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());
const active = (r: Row) => ['PENDING', 'BLOCKED'].includes(r.status);
const retryableLock = (error: unknown) =>
  ['55P03', '40P01', 'STREAMING_PRIVACY_BUSY'].includes(String((error as { code?: string }).code));

export class AccountClosureService extends ApplicationService {
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;
  constructor(
    pool: Pool,
    options: ApiOptions,
    private readonly closure: AccountClosureOptions = {},
  ) {
    super(pool, options);
  }
  capabilities() {
    const hooks = this.closure.hooks;
    return {
      enabled:
        this.closure.enabled === true &&
        !!hooks &&
        typeof hooks.lockAndInspect === 'function' &&
        typeof hooks.revoke === 'function' &&
        Array.isArray(hooks.domains) &&
        ACCOUNT_CLOSURE_DOMAINS.every((domain) => hooks.domains.includes(domain)),
      notice: 'HISTORY_RETAINED_AND_RESTORE_QUARANTINE_REQUIRED' as const,
    };
  }
  private requireEnabled(): AccountClosureHooks {
    if (!this.capabilities().enabled)
      closureFail('ACCOUNT_CLOSURE_DISABLED', '注销安全检查尚未完整配置，请联系管理员', 503);
    return this.closure.hooks!;
  }
  private dto(r: Row | undefined): AccountClosureData | null {
    return r
      ? {
          id: r.id,
          version: r.version,
          status: r.status,
          coolingOffDays: r.cooling_off_days,
          requestedAt: iso(r.requested_at)!,
          executeAfter: iso(r.execute_after)!,
          finishedAt: iso(r.finished_at),
          blockers: closureBlockers(r.blocked_reasons),
        }
      : null;
  }
  async workspace(cookie?: string): Promise<AccountClosureWorkspace> {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const r = (
        await c.query(
          'SELECT * FROM account_closure_requests WHERE user_id=$1 ORDER BY requested_at DESC,id DESC LIMIT 1',
          [actor.user.id],
        )
      ).rows[0];
      await this.ensureFreshSession(c, actor);
      return { ...this.capabilities(), request: this.dto(r) };
    });
  }
  /** Hash outside row locks; session -> user UPDATE is acquired directly, without SHARE upgrade. */
  private async reauthenticate(
    cookie: string | undefined,
    password: string,
  ): Promise<Reauthenticated> {
    const token = readSessionToken(cookie);
    if (!token) throw unauthenticated();
    const tokenHash = hashToken(token);
    const r = (
      await this.pool.query(
        `SELECT u.id,u.email,u.display_name,u.password_hash,u.status,s.id AS session_id
         FROM sessions s JOIN users u ON u.id=s.user_id
         WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
         AND u.status='ACTIVE' AND s.created_at>COALESCE(u.credential_reset_at,'-infinity'::timestamptz)`,
        [tokenHash],
      )
    ).rows[0];
    if (!r) throw unauthenticated();
    await this.rateLimit(`account-closure-password:${hashToken(r.id)}`, 10, 900);
    if (!(await verifyPassword(password, r.password_hash)))
      throw new ApiError(401, 'ACCOUNT_REAUTH_REQUIRED', '请重新核验当前密码');
    return {
      actor: { sessionId: r.session_id, user: r },
      tokenHash,
      passwordHash: r.password_hash,
    };
  }
  private async lockReauthenticated(c: PoolClient, candidate: Reauthenticated): Promise<Actor> {
    const session = (
      await c.query(
        `SELECT id,user_id,created_at::text AS issued_at FROM sessions
         WHERE id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
        [candidate.actor.sessionId, candidate.tokenHash],
      )
    ).rows[0];
    if (!session || session.user_id !== candidate.actor.user.id) throw unauthenticated();
    const user = (
      await c.query<DbUser>(
        `SELECT id,email,display_name,password_hash,status FROM users WHERE id=$1
         AND $2::timestamptz>COALESCE(credential_reset_at,'-infinity'::timestamptz) FOR UPDATE`,
        [session.user_id, session.issued_at],
      )
    ).rows[0];
    if (!user || user.status !== 'ACTIVE' || user.password_hash !== candidate.passwordHash)
      throw unauthenticated();
    return { sessionId: session.id, user };
  }
  private async fingerprint(c: PoolClient, userId: string) {
    const user = (
      await c.query(
        'SELECT password_hash,credential_reset_at::text AS credential_reset_at FROM users WHERE id=$1',
        [userId],
      )
    ).rows[0]!;
    const identities = (
      await c.query(
        'SELECT id,app_id,status,version FROM wechat_identities WHERE user_id=$1 ORDER BY id',
        [userId],
      )
    ).rows;
    return closureSecurityFingerprint(
      user,
      identities as Parameters<typeof closureSecurityFingerprint>[1],
    );
  }
  private async operation(c: PoolClient, actor: Actor, id: string, fingerprint: string) {
    const old = (
      await c.query(
        'SELECT request_id,request_hash FROM account_closure_operations WHERE actor_id=$1 AND command_id=$2',
        [actor.user.id, id],
      )
    ).rows[0];
    if (old && old.request_hash !== fingerprint)
      closureFail('IDEMPOTENCY_CONFLICT', '原操作编号已用于其他内容');
    return old?.request_id as string | undefined;
  }
  private async owned(c: PoolClient, actor: Actor, requestId: string) {
    const r = (
      await c.query(
        'SELECT * FROM account_closure_requests WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [requestId, actor.user.id],
      )
    ).rows[0];
    if (!r) throw new ApiError(404, 'NOT_FOUND', '资料不可见');
    return r;
  }
  async request(cookie: string | undefined, raw: unknown): Promise<AccountClosureData> {
    this.requireEnabled();
    const p = closureRequestInput(raw);
    const candidate = await this.reauthenticate(cookie, p.password);
    const fingerprint = closureHash({ operation: 'REQUEST', coolingOffDays: p.coolingOffDays });
    return this.transaction(async (c) => {
      const actor = await this.lockReauthenticated(c, candidate);
      const replay = await this.operation(c, actor, p.clientRequestId, fingerprint);
      if (replay) {
        const r = await this.owned(c, actor, replay);
        await this.ensureFreshSession(c, actor);
        return this.dto(r)!;
      }
      const currentSecurity = await this.fingerprint(c, actor.user.id);
      const previous = (
        await c.query(
          "SELECT * FROM account_closure_requests WHERE user_id=$1 AND status IN('PENDING','BLOCKED') FOR UPDATE",
          [actor.user.id],
        )
      ).rows[0];
      if (previous) closureFail('ACCOUNT_CLOSURE_PENDING', '已有注销申请，请先核对或取消');
      const id = randomUUID();
      const r = (
        await c.query(
          `INSERT INTO account_closure_requests(id,user_id,requested_session_id,cooling_off_days,auth_fingerprint,execute_after)
           VALUES($1,$2,$3,$4,$5,statement_timestamp()+($4::int*interval '24 hours')) RETURNING *`,
          [id, actor.user.id, actor.sessionId, p.coolingOffDays, currentSecurity],
        )
      ).rows[0];
      await c.query(
        `INSERT INTO account_closure_operations(actor_id,command_id,request_hash,request_id,operation)
         VALUES($1,$2,$3,$4,'REQUEST')`,
        [actor.user.id, p.clientRequestId, fingerprint, id],
      );
      await this.audit(c, actor.user.id, null, 'ACCOUNT_CLOSURE_REQUESTED', 'account_closure', id, {
        coolingOffDays: p.coolingOffDays,
      });
      await this.ensureFreshSession(c, actor);
      return this.dto(r)!;
    });
  }
  /** Safety cancellation remains available even if a runtime domain hook is temporarily disabled. */
  async cancel(cookie: string | undefined, raw: unknown): Promise<AccountClosureData> {
    const p = closureCancelInput(raw);
    const candidate = await this.reauthenticate(cookie, p.password);
    const fingerprint = closureHash({
      operation: 'CANCEL',
      requestId: p.requestId,
      expectedVersion: p.expectedVersion,
    });
    return this.transaction(async (c) => {
      const actor = await this.lockReauthenticated(c, candidate);
      const replay = await this.operation(c, actor, p.clientRequestId, fingerprint);
      if (replay) {
        const r = await this.owned(c, actor, replay);
        await this.ensureFreshSession(c, actor);
        return this.dto(r)!;
      }
      let r = await this.owned(c, actor, p.requestId);
      if (r.version !== p.expectedVersion)
        closureFail('VERSION_CONFLICT', '注销申请已更新，请重新读取');
      if (active(r)) {
        r = (
          await c.query(
            `UPDATE account_closure_requests SET status='CANCELLED',version=version+1,fence=fence+1,
             lease_id=NULL,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp()
             WHERE id=$1 RETURNING *`,
            [r.id],
          )
        ).rows[0];
      }
      await c.query(
        `INSERT INTO account_closure_operations(actor_id,command_id,request_hash,request_id,operation)
         VALUES($1,$2,$3,$4,'CANCEL')`,
        [actor.user.id, p.clientRequestId, fingerprint, r.id],
      );
      await this.audit(
        c,
        actor.user.id,
        null,
        'ACCOUNT_CLOSURE_CANCELLED',
        'account_closure',
        r.id,
      );
      await this.ensureFreshSession(c, actor);
      return this.dto(r)!;
    });
  }
  private async maintenance(c: PoolClient, userId: string) {
    const r = await c.query(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
      [`scb-account-maintenance:${userId}`],
    );
    if (!r.rows[0]?.acquired) {
      const error = new Error('Account maintenance busy') as Error & { code: string };
      error.code = '55P03';
      throw error;
    }
  }
  private async claim(id: string): Promise<Claim | { expired: true } | null> {
    const hint = (
      await this.pool.query('SELECT user_id FROM account_closure_requests WHERE id=$1', [id])
    ).rows[0];
    if (!hint) return null;
    return this.transaction(async (c) => {
      await c.query("SET LOCAL lock_timeout='250ms'");
      await this.maintenance(c, hint.user_id);
      const user = (
        await c.query('SELECT status FROM users WHERE id=$1 FOR UPDATE', [hint.user_id])
      ).rows[0];
      if (!user || user.status !== 'ACTIVE') return null;
      const r = (
        await c.query(
          `SELECT *,execute_after<=clock_timestamp() AS due,
           (lease_until IS NULL OR lease_until<=clock_timestamp()) AS claimable
           FROM account_closure_requests WHERE id=$1 AND user_id=$2 FOR UPDATE`,
          [id, hint.user_id],
        )
      ).rows[0];
      if (!r || !active(r) || !r.claimable) return null;
      if ((await this.fingerprint(c, hint.user_id)) !== r.auth_fingerprint) {
        await this.audit(
          c,
          hint.user_id,
          null,
          'ACCOUNT_CLOSURE_AUTH_EXPIRED',
          'account_closure',
          r.id,
        );
        await c.query(
          `UPDATE account_closure_requests SET status='EXPIRED_AUTH',version=version+1,fence=fence+1,
          lease_id=NULL,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,
          [r.id],
        );
        return { expired: true };
      }
      if (!r.due) {
        await c.query(
          'UPDATE account_closure_requests SET updated_at=clock_timestamp() WHERE id=$1',
          [r.id],
        );
        return null;
      }
      const leaseId = randomUUID();
      const claim = (
        await c.query(
          `UPDATE account_closure_requests SET lease_id=$2,lease_until=clock_timestamp()+interval '60 seconds',
           fence=fence+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING fence::text AS fence`,
          [id, leaseId],
        )
      ).rows[0];
      return { id, userId: hint.user_id, leaseId, fence: claim.fence };
    });
  }
  private async liveLease(c: PoolClient, claim: Claim) {
    const r = await c.query(
      `SELECT id FROM account_closure_requests WHERE id=$1 AND user_id=$2 AND lease_id=$3
       AND fence=$4::bigint AND lease_until>clock_timestamp() AND status IN('PENDING','BLOCKED')`,
      [claim.id, claim.userId, claim.leaseId, claim.fence],
    );
    if (!r.rowCount) closureFail('ACCOUNT_CLOSURE_FENCE_EXPIRED', '注销检查已失效，稍后重新核对');
  }
  /** Root hook already holds NOWAIT/try-lock scopes; these read only stable existing core facts. */
  private async coreBlockers(c: PoolClient, userId: string): Promise<string[]> {
    const r = (
      await c.query(
        `SELECT
         EXISTS(SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.org_id
           WHERE m.user_id=$1 AND m.role='ORG_OWNER' AND m.status='ACTIVE' AND o.status='ACTIVE'
           AND NOT EXISTS(SELECT 1 FROM organization_memberships other JOIN users u ON u.id=other.user_id
             WHERE other.org_id=m.org_id AND other.user_id<>$1 AND other.role='ORG_OWNER' AND other.status='ACTIVE' AND u.status='ACTIVE')) AS owner,
         EXISTS(SELECT 1 FROM billing_orders o WHERE o.created_by=$1 AND
           (o.status='REFUND_PENDING' OR (o.status='PENDING_PAYMENT' AND (o.expires_at>clock_timestamp() OR o.provider_started_at IS NOT NULL))
            OR (o.status='PAID' AND NOT EXISTS(SELECT 1 FROM event_commercial_activations a
              JOIN event_entitlements entitlement ON entitlement.org_id=a.org_id AND entitlement.event_id=a.event_id AND entitlement.id=a.entitlement_id
              WHERE a.org_id=o.org_id AND a.event_id=o.event_id AND a.source='PAID' AND entitlement.order_id=o.id))
            OR EXISTS(SELECT 1 FROM billing_refunds f WHERE f.order_id=o.id AND f.status IN('REQUESTED','PENDING_REVIEW','PROCESSING','UNKNOWN')))) AS money,
         EXISTS(SELECT 1 FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id
           WHERE (o.buyer_user_id=$1 OR a.player_user_id=$1) AND
           (a.status IN('ACCEPTED','ARRIVED','DISPUTED') OR (a.status='REQUESTED' AND a.expires_at>clock_timestamp()))) AS player,
         EXISTS(SELECT 1 FROM local_bookings b WHERE (b.buyer_user_id=$1 OR b.provider_user_id=$1) AND
           (b.status IN('CONFIRMED','ARRIVED','DELIVERED','DISPUTED') OR
            (b.status IN('HELD','REQUESTED') AND b.hold_expires_at>clock_timestamp()))) AS local,
         EXISTS(SELECT 1 FROM local_matchups m WHERE (m.created_by=$1 OR m.home_confirmed_by=$1 OR m.away_confirmed_by=$1)
           AND (m.status='CONFIRMED' OR (m.status='OPEN' AND m.expires_at>clock_timestamp()))) AS matchup,
         EXISTS(SELECT 1 FROM governance_cases g WHERE (g.requester_id=$1 OR g.assigned_to=$1)
           AND g.status IN('OPEN','ASSIGNED') AND (g.kind='APPEAL' OR g.source_kind IN('PLAYER_BOOKING','LOCAL_BOOKING'))) AS dispute`,
        [userId],
      )
    ).rows[0]!;
    return [
      ...(r.owner ? ['OWNER_TRANSFER_REQUIRED'] : []),
      ...(r.money ? ['SOFTWARE_MONEY_UNRESOLVED'] : []),
      ...(r.player ? ['PLAYER_SERVICE_UNRESOLVED'] : []),
      ...(r.local ? ['LOCAL_SERVICE_UNRESOLVED'] : []),
      ...(r.matchup ? ['TEAM_MATCHUP_UNRESOLVED'] : []),
      ...(r.dispute ? ['DISPUTE_UNRESOLVED'] : []),
    ];
  }
  private async revokeCore(c: PoolClient, userId: string) {
    await c.query(
      "UPDATE team_access_grants SET status='DISABLED',updated_at=clock_timestamp() WHERE user_id=$1 AND status='ACTIVE'",
      [userId],
    );
    await c.query(
      'UPDATE team_invitations SET revoked_at=clock_timestamp() WHERE (target_user_id=$1 OR issuer_user_id=$1) AND revoked_at IS NULL',
      [userId],
    );
    await c.query(
      "UPDATE team_member_bindings SET status='ENDED',ended_reason='LEFT',ended_by=$1,ended_at=clock_timestamp(),end_note='账号注销撤回关联' WHERE user_id=$1 AND status='ACTIVE'",
      [userId],
    );
    await c.query(
      "UPDATE event_follows SET status='CANCELLED',cancelled_at=clock_timestamp() WHERE user_id=$1 AND status='ACTIVE'",
      [userId],
    );
    await c.query(
      "UPDATE public_archive_publications SET status='REVOKED',revoked_at=clock_timestamp() WHERE status='ACTIVE' AND (consented_by=$1 OR profile_id IN(SELECT id FROM public_archive_profiles WHERE owner_user_id=$1))",
      [userId],
    );
    await c.query(
      "UPDATE public_archive_sources SET status='REVOKED',revoked_at=clock_timestamp(),revoke_reason='账号注销撤回授权',version=version+1 WHERE status<>'REVOKED' AND (target_user_id=$1 OR consented_by=$1 OR nominated_by=$1 OR profile_id IN(SELECT id FROM public_archive_profiles WHERE owner_user_id=$1))",
      [userId],
    );
    await c.query(
      "UPDATE public_archive_profiles SET status='REVOKED',public_key=NULL,version=version+1,updated_at=clock_timestamp() WHERE owner_user_id=$1 AND status<>'REVOKED'",
      [userId],
    );
    await c.query(
      "UPDATE booking_profiles SET status='DISABLED',version=version+1,updated_at=clock_timestamp() WHERE user_id=$1 AND status<>'DISABLED'",
      [userId],
    );
    await c.query(
      "UPDATE local_listings SET status='SUSPENDED',published=false,version=version+1,updated_at=clock_timestamp() WHERE provider_user_id=$1 AND status<>'SUSPENDED'",
      [userId],
    );
    await c.query(
      "UPDATE match_staff SET status='DISABLED',updated_at=clock_timestamp() WHERE user_id=$1 AND status='ACTIVE'",
      [userId],
    );
    await c.query(
      "UPDATE event_staff SET status='DISABLED',updated_at=clock_timestamp() WHERE user_id=$1 AND status='ACTIVE'",
      [userId],
    );
    await c.query(
      "UPDATE organization_memberships SET status='DISABLED',updated_at=clock_timestamp() WHERE user_id=$1 AND status='ACTIVE'",
      [userId],
    );
    await c.query(
      "UPDATE wechat_identities SET status='REVOKED',version=version+1,revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE user_id=$1 AND status='ACTIVE'",
      [userId],
    );
    await c.query(
      "UPDATE account_mail_jobs j SET status=CASE WHEN j.status='SENDING' THEN 'UNKNOWN' WHEN j.status IN('PENDING','FAILED') THEN 'EXPIRED' ELSE j.status END,envelope=NULL,lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() FROM account_action_tokens t WHERE t.id=j.token_id AND t.user_id=$1 AND (j.status IN('PENDING','SENDING','UNKNOWN','FAILED') OR j.envelope IS NOT NULL)",
      [userId],
    );
    await c.query(
      'UPDATE account_action_tokens SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL',
      [userId],
    );
  }
  /** All external cleanup has been observed by hooks before this purely DB finalization. */
  async processOne(
    requestId: string,
  ): Promise<'CLOSED' | 'BLOCKED' | 'EXPIRED_AUTH' | 'RETRY' | 'SKIPPED'> {
    const hooks = this.requireEnabled();
    let claim: Claim | null = null;
    try {
      const result = await this.claim(closureId(requestId));
      if (result && 'expired' in result) return 'EXPIRED_AUTH';
      claim = result;
      if (!claim) return 'SKIPPED';
      const discardedPassword = await hashPassword(randomBytes(48).toString('base64url'));
      return await this.transaction(async (c) => {
        await c.query("SET LOCAL lock_timeout='250ms'");
        await this.maintenance(c, claim!.userId);
        const user = (
          await c.query('SELECT id,status FROM users WHERE id=$1 FOR UPDATE', [claim!.userId])
        ).rows[0];
        const r = (
          await c.query('SELECT * FROM account_closure_requests WHERE id=$1 FOR UPDATE', [
            claim!.id,
          ])
        ).rows[0];
        if (!r || !active(r) || r.lease_id !== claim!.leaseId || String(r.fence) !== claim!.fence)
          return 'SKIPPED';
        await this.liveLease(c, claim!);
        if (
          !user ||
          user.status !== 'ACTIVE' ||
          (await this.fingerprint(c, claim!.userId)) !== r.auth_fingerprint
        ) {
          await this.audit(
            c,
            claim!.userId,
            null,
            'ACCOUNT_CLOSURE_AUTH_EXPIRED',
            'account_closure',
            r.id,
          );
          const changed = await c.query(
            `UPDATE account_closure_requests SET status='EXPIRED_AUTH',version=version+1,
             lease_id=NULL,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp()
             WHERE id=$1 AND lease_id=$2 AND fence=$3::bigint AND lease_until>clock_timestamp()`,
            [r.id, claim!.leaseId, claim!.fence],
          );
          if (!changed.rowCount) closureFail('ACCOUNT_CLOSURE_FENCE_EXPIRED', '注销检查已失效');
          return 'EXPIRED_AUTH';
        }
        const extra = closureBlockers(await hooks.lockAndInspect(c, user.id));
        const blockers = closureBlockers([...extra, ...(await this.coreBlockers(c, user.id))]);
        await this.liveLease(c, claim!);
        if (blockers.length) {
          await this.audit(c, user.id, null, 'ACCOUNT_CLOSURE_BLOCKED', 'account_closure', r.id, {
            blockers,
          });
          const changed = await c.query(
            `UPDATE account_closure_requests SET status='BLOCKED',version=version+1,blocked_reasons=$2::jsonb,
             lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
             WHERE id=$1 AND lease_id=$3 AND fence=$4::bigint AND lease_until>clock_timestamp()`,
            [r.id, JSON.stringify(blockers), claim!.leaseId, claim!.fence],
          );
          if (!changed.rowCount) closureFail('ACCOUNT_CLOSURE_FENCE_EXPIRED', '注销检查已失效');
          return 'BLOCKED';
        }
        await hooks.revoke(c, user.id, r.id);
        await this.revokeCore(c, user.id);
        await c.query(
          `UPDATE users SET status='DISABLED',email=$2,login_name=NULL,display_name='已注销用户',password_hash=$3,
           email_verified_at=NULL,credential_reset_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,
          [user.id, `${user.id}@closed.invalid`, discardedPassword],
        );
        await c.query(
          `INSERT INTO account_closure_tombstones(user_id,request_id,closed_at,history_policy,restore_policy)
           VALUES($1,$2,clock_timestamp(),'RETAIN_IMMUTABLE_AND_RESTRICT_ACCESS','QUARANTINE_OLD_BACKUP_AUTHORIZATIONS')`,
          [user.id, r.id],
        );
        await this.audit(c, user.id, null, 'ACCOUNT_CLOSED', 'account_closure', r.id);
        const changed = await c.query(
          `UPDATE account_closure_requests SET status='CLOSED',version=version+1,blocked_reasons='[]'::jsonb,
           lease_id=NULL,lease_until=NULL,finished_at=clock_timestamp(),updated_at=clock_timestamp()
           WHERE id=$1 AND lease_id=$2 AND fence=$3::bigint AND lease_until>clock_timestamp()`,
          [r.id, claim!.leaseId, claim!.fence],
        );
        if (!changed.rowCount) closureFail('ACCOUNT_CLOSURE_FENCE_EXPIRED', '注销检查已失效');
        return 'CLOSED';
      });
    } catch (error) {
      if (
        retryableLock(error) ||
        (error as { code?: string }).code === 'ACCOUNT_CLOSURE_FENCE_EXPIRED'
      ) {
        if (claim) {
          try {
            await this.transaction(async (c) => {
              await c.query("SET LOCAL lock_timeout='250ms'");
              await c.query(
                `UPDATE account_closure_requests SET lease_id=NULL,lease_until=NULL,fence=fence+1,updated_at=clock_timestamp()
                 WHERE id=$1 AND lease_id=$2 AND fence=$3::bigint AND status IN('PENDING','BLOCKED')`,
                [claim!.id, claim!.leaseId, claim!.fence],
              );
            });
          } catch (releaseError) {
            // A newer writer owns the row; the durable old lease will expire naturally.
            if (!retryableLock(releaseError)) throw releaseError;
          }
        }
        return 'RETRY';
      }
      throw error;
    }
  }
  async drain(limit = 5) {
    if (!this.capabilities().enabled || this.draining) return { attempted: 0, closed: 0 };
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
      throw new Error('Invalid closure batch');
    this.draining = true;
    let closed = 0;
    try {
      const rows = (
        await this.pool.query(
          `SELECT id FROM account_closure_requests WHERE status IN('PENDING','BLOCKED')
         AND (lease_until IS NULL OR lease_until<=clock_timestamp())
         ORDER BY (execute_after<=clock_timestamp()) DESC,updated_at,id LIMIT $1`,
          [limit],
        )
      ).rows;
      for (const row of rows) if ((await this.processOne(row.id)) === 'CLOSED') closed++;
      return { attempted: rows.length, closed };
    } finally {
      this.draining = false;
    }
  }
  startWorker() {
    if (this.capabilities().enabled && this.closure.autoDispatch !== false && !this.timer) {
      this.timer = setInterval(() => {
        void this.drain().catch(() => {});
      }, 5000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
