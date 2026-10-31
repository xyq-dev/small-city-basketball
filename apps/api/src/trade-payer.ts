import type { Pool, PoolClient } from 'pg';
import { ApiError } from './errors.js';
import { hashToken } from './security.js';
import type { WechatConfiguration, WechatExchange } from './wechat-provider.js';
import type { TradeMerchant, TradeRuntime } from './trade-provider.js';

const rejected = () =>
  new ApiError(403, 'TRADE_PAYER_IDENTITY_CHANGED', '请使用当前账号绑定的微信重新确认付款');
type Binding = { id: string; version: number; openid_hash: string; credential: string };
/** A fresh wx.login code is exchanged only for the currently authenticated binding.
 * Raw openid remains ephemeral; callers must never persist or log the returned target.
 */
export function createTradePayerResolver(
  pool: Pool,
  configuration: WechatConfiguration,
  exchange: WechatExchange,
  merchants: Record<string, TradeMerchant>,
): NonNullable<TradeRuntime['resolvePayer']> {
  const read = async (c: PoolClient, actorId: string, sessionId: string, appId: string) => {
    await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
      `scb-account-maintenance:${actorId}`,
    ]);
    // Match lockActor's session -> user -> identity ordering. A reset or closure
    // invalidates a previously issued session even when its row remains retained.
    const session = (
      await c.query(
        `SELECT created_at FROM sessions WHERE id=$1 AND user_id=$2
         AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
        [sessionId, actorId],
      )
    ).rows[0];
    if (!session) throw rejected();
    const user = (
      await c.query(
        `SELECT password_hash,credential_reset_at::text AS reset FROM users
         WHERE id=$1 AND status='ACTIVE'
         AND $2::timestamptz>COALESCE(credential_reset_at,'-infinity'::timestamptz) FOR SHARE`,
        [actorId, session.created_at],
      )
    ).rows[0];
    if (!user) throw rejected();
    const identity = (
      await c.query<Binding>(
        `SELECT id,version,openid_hash FROM wechat_identities
         WHERE user_id=$1 AND app_id=$2 AND status='ACTIVE' FOR SHARE`,
        [actorId, appId],
      )
    ).rows[0];
    if (!identity) throw rejected();
    return { ...identity, credential: hashToken(user.password_hash + '\n' + (user.reset ?? '')) };
  };
  const snapshot = async (actorId: string, sessionId: string, appId: string) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const value = await read(c, actorId, sessionId, appId);
      await c.query('COMMIT');
      return value;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
  };
  return async ({ actorId, sessionId, merchantKey, code }) => {
    const merchant = Object.values(merchants).find((m) => m.key === merchantKey);
    if (
      !configuration.enabled ||
      !configuration.appId ||
      !merchant ||
      !merchant.payments.enabled ||
      merchant.appId !== configuration.appId ||
      typeof code !== 'string' ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(code)
    )
      throw rejected();
    const before = await snapshot(actorId, sessionId, merchant.appId);
    // Do not hold database locks or a pooled connection during provider I/O.
    const result = await exchange.exchange(code);
    if (
      result.appId !== merchant.appId ||
      typeof result.openid !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(result.openid) ||
      hashToken(`${result.appId}\n${result.openid}`) !== before.openid_hash
    )
      throw rejected();
    const after = await snapshot(actorId, sessionId, merchant.appId);
    if (
      after.id !== before.id ||
      after.version !== before.version ||
      after.openid_hash !== before.openid_hash ||
      after.credential !== before.credential
    )
      throw rejected();
    return {
      ...result,
      // The source may wait on calendar/order locks after code exchange. The
      // dispatcher must invoke this inside its last intent transaction, before
      // lockActor, to place current binding authorization at that commit.
      assertCurrent: async (c: PoolClient) => {
        const current = await read(c, actorId, sessionId, merchant.appId);
        if (
          current.id !== before.id ||
          current.version !== before.version ||
          current.openid_hash !== before.openid_hash ||
          current.credential !== before.credential
        )
          throw rejected();
      },
    };
  };
}
