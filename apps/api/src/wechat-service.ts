import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { SessionData } from '@small-city-basketball/contracts';
import type {
  WechatBindingData,
  WechatCapabilitiesData,
  WechatChallengeData,
} from '../../../packages/contracts/wechat.js';
import { ApplicationService } from './service.js';
import type { Actor, ApiOptions, DbUser } from './service.js';
import { ApiError, unauthenticated } from './errors.js';
import { revokeNotificationGrants } from './notification-service.js';
import { hashToken, newSessionToken, readSessionToken, verifyPassword } from './security.js';
import { invalid, objectInput, passwordInput, resourceId } from './validation.js';
import {
  OfficialWechatExchange,
  readWechatConfiguration,
  validateWechatConfiguration,
} from './wechat-provider.js';
import type { WechatConfiguration, WechatExchange } from './wechat-provider.js';

export interface WechatServiceOptions {
  configuration: WechatConfiguration;
  exchange?: WechatExchange;
}
type Row = Record<string, any>;
const rejected = () =>
  new ApiError(401, 'WECHAT_CHALLENGE_REJECTED', '微信认证请求已失效，请重新发起');
const consent = (value: unknown) => {
  if (value !== true) invalid('请明确同意本次微信身份操作');
};
export class WechatService extends ApplicationService {
  readonly configuration: WechatConfiguration;
  readonly exchange: WechatExchange;
  constructor(
    pool: Pool,
    options: ApiOptions,
    provider: WechatServiceOptions = { configuration: readWechatConfiguration() },
  ) {
    super(pool, options);
    this.configuration = validateWechatConfiguration(provider.configuration);
    this.exchange = provider.exchange ?? new OfficialWechatExchange(this.configuration);
  }
  capabilities(): WechatCapabilitiesData {
    return {
      enabled: this.configuration.enabled,
      canLogin: this.configuration.enabled,
      canBind: this.configuration.enabled,
      canRegister: false,
    };
  }
  private enabled() {
    if (!this.configuration.enabled)
      throw new ApiError(503, 'WECHAT_DISABLED', '微信登录尚未配置启用');
  }
  private async candidate(cookie: string | undefined, password?: string) {
    const token = readSessionToken(cookie);
    if (!token) throw unauthenticated();
    const user = (
      await this.pool.query<DbUser & { session_id: string }>(
        "SELECT u.*,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND u.status='ACTIVE'",
        [hashToken(token)],
      )
    ).rows[0];
    if (!user) throw unauthenticated();
    if (password !== undefined) {
      await this.rateLimit(`wechat-password:${hashToken(user.id)}`, 10, 900);
      if (!(await verifyPassword(password, user.password_hash)))
        throw new ApiError(401, 'INVALID_CREDENTIALS', '账号或密码不正确');
    }
    return user;
  }
  private async accountLock(c: PoolClient, userId: string) {
    await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
      `scb-account-maintenance:${userId}`,
    ]);
  }
  private async current(
    c: PoolClient,
    cookie: string | undefined,
    candidate: DbUser & { session_id: string },
    exclusive = false,
  ): Promise<Actor> {
    if (exclusive)
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `scb-account-maintenance:${candidate.id}`,
      ]);
    else await this.accountLock(c, candidate.id);
    const actor = await this.lockActor(c, cookie);
    if (
      actor.user.id !== candidate.id ||
      actor.sessionId !== candidate.session_id ||
      actor.user.password_hash !== candidate.password_hash
    )
      throw unauthenticated();
    await this.ensureFreshSession(c, actor);
    return actor;
  }
  private async view(c: PoolClient, actor: Actor): Promise<WechatBindingData> {
    const identity = this.configuration.appId
      ? (
          await c.query<Row>(
            "SELECT version,updated_at FROM wechat_identities WHERE user_id=$1 AND app_id=$2 AND status='ACTIVE'",
            [actor.user.id, this.configuration.appId],
          )
        ).rows[0]
      : null;
    return {
      enabled: this.configuration.enabled,
      connected: !!identity,
      version: identity?.version ?? null,
      linkedAt: identity?.updated_at.toISOString() ?? null,
    };
  }
  async binding(cookie?: string): Promise<WechatBindingData> {
    return this.transaction(async (c) => this.view(c, await this.lockActor(c, cookie)));
  }
  async challenge(
    cookie: string | undefined,
    raw: unknown,
    ip: string,
  ): Promise<WechatChallengeData> {
    this.enabled();
    const body = objectInput(raw, ['purpose', 'consent', 'password']);
    consent(body.consent);
    if (body.purpose !== 'LOGIN' && body.purpose !== 'BIND') invalid('认证用途无效');
    if (body.purpose === 'LOGIN' && body.password !== undefined) invalid('微信登录不接收应用密码');
    await this.rateLimit(`wechat-challenge:${hashToken(ip)}`, 30, 900);
    const candidate =
      body.purpose === 'BIND' ? await this.candidate(cookie, passwordInput(body.password)) : null;
    await this.pool.query(
      `WITH expired AS (SELECT id FROM wechat_auth_attempts WHERE expires_at<clock_timestamp()-interval '10 minutes' ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED) DELETE FROM wechat_auth_attempts a USING expired WHERE a.id=expired.id`,
    );
    return this.transaction(async (c) => {
      const actor = candidate ? await this.current(c, cookie, candidate) : null;
      const state = newSessionToken();
      const id = randomUUID();
      const row = (
        await c.query<Row>(
          `INSERT INTO wechat_auth_attempts(id,app_id,state_hash,purpose,user_id,session_id,credential_fingerprint,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,statement_timestamp()+interval '5 minutes') RETURNING expires_at`,
          [
            id,
            this.configuration.appId,
            hashToken(state),
            body.purpose,
            actor?.user.id ?? null,
            actor?.sessionId ?? null,
            actor ? hashToken(actor.user.password_hash) : null,
          ],
        )
      ).rows[0]!;
      if (actor)
        await this.audit(
          c,
          actor.user.id,
          null,
          'AUTH_WECHAT_BIND_REQUESTED',
          'user',
          actor.user.id,
        );
      return {
        challengeId: id,
        state,
        purpose: body.purpose as 'LOGIN' | 'BIND',
        expiresAt: row.expires_at.toISOString(),
      };
    });
  }
  private async claim(
    cookie: string | undefined,
    raw: unknown,
    purpose: 'LOGIN' | 'BIND',
    ip: string,
  ) {
    this.enabled();
    const body = objectInput(raw, ['challengeId', 'state', 'code', 'consent']);
    consent(body.consent);
    const id = resourceId(typeof body.challengeId === 'string' ? body.challengeId : '');
    if (
      typeof body.state !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.state) ||
      typeof body.code !== 'string' ||
      !/^[A-Za-z0-9_-]{1,512}$/.test(body.code)
    )
      invalid('微信认证请求格式无效');
    await this.rateLimit(`wechat-exchange:${hashToken(ip)}`, 60, 900);
    const candidate = purpose === 'BIND' ? await this.candidate(cookie) : null;
    try {
      const attempt = await this.transaction(async (c) => {
        const actor = candidate ? await this.current(c, cookie, candidate) : null;
        const row = (
          await c.query<Row>(
            "SELECT * FROM wechat_auth_attempts WHERE id=$1 AND app_id=$2 AND state_hash=$3 AND purpose=$4 AND status='PENDING' AND expires_at>clock_timestamp() FOR UPDATE",
            [id, this.configuration.appId, hashToken(body.state as string), purpose],
          )
        ).rows[0];
        if (
          !row ||
          (purpose === 'BIND' &&
            (row.user_id !== actor?.user.id ||
              row.session_id !== actor?.sessionId ||
              row.credential_fingerprint !== hashToken(actor!.user.password_hash)))
        )
          throw rejected();
        await c.query(
          "UPDATE wechat_auth_attempts SET status='CLAIMED',code_hash=$2,claimed_at=clock_timestamp() WHERE id=$1",
          [id, hashToken(`${this.configuration.appId}\n${body.code}`)],
        );
        return row;
      });
      return { attempt, code: body.code as string, candidate };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw rejected();
      throw error;
    }
  }
  private async fail(id: string) {
    try {
      await this.pool.query(
        "UPDATE wechat_auth_attempts SET status='FAILED',finished_at=clock_timestamp() WHERE id=$1 AND status='CLAIMED'",
        [id],
      );
    } catch {
      /* no credential or provider errors are logged */
    }
  }
  private async exchanged(claim: Awaited<ReturnType<WechatService['claim']>>) {
    let result: Awaited<ReturnType<WechatExchange['exchange']>>;
    try {
      result = await this.exchange.exchange(claim.code);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'WECHAT_CODE_REJECTED') throw error;
      throw new ApiError(503, 'WECHAT_UNAVAILABLE', '微信认证暂时不可用，请重新发起');
    }
    if (
      !result ||
      result.appId !== this.configuration.appId ||
      typeof result.openid !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(result.openid)
    )
      throw new ApiError(503, 'WECHAT_UNAVAILABLE', '微信认证暂时不可用');
    return hashToken(`${this.configuration.appId}\n${result.openid}`);
  }
  async bind(cookie: string | undefined, raw: unknown, ip: string): Promise<WechatBindingData> {
    const claim = await this.claim(cookie, raw, 'BIND', ip);
    try {
      const openidHash = await this.exchanged(claim);
      return await this.transaction(async (c) => {
        const actor = await this.current(c, cookie, claim.candidate!);
        const attempt = (
          await c.query<Row>(
            "SELECT * FROM wechat_auth_attempts WHERE id=$1 AND status='CLAIMED' AND expires_at>clock_timestamp() FOR UPDATE",
            [claim.attempt.id],
          )
        ).rows[0];
        if (!attempt || attempt.credential_fingerprint !== hashToken(actor.user.password_hash))
          throw rejected();
        const old = (
          await c.query<Row>(
            'SELECT * FROM wechat_identities WHERE app_id=$1 AND openid_hash=$2 FOR UPDATE',
            [this.configuration.appId, openidHash],
          )
        ).rows[0];
        if (old && old.user_id !== actor.user.id)
          throw new ApiError(409, 'WECHAT_BINDING_CONFLICT', '此微信身份不能绑定到当前账号');
        if (old?.status === 'ACTIVE')
          throw new ApiError(409, 'WECHAT_ALREADY_BOUND', '当前微信身份已绑定');
        const active = await c.query(
          "SELECT id FROM wechat_identities WHERE app_id=$1 AND user_id=$2 AND status='ACTIVE'",
          [this.configuration.appId, actor.user.id],
        );
        if (active.rowCount)
          throw new ApiError(409, 'WECHAT_ALREADY_BOUND', '请先解除现有微信绑定');
        if (old)
          await c.query(
            "UPDATE wechat_identities SET status='ACTIVE',version=version+1,updated_at=clock_timestamp(),revoked_at=NULL WHERE id=$1",
            [old.id],
          );
        else
          await c.query(
            'INSERT INTO wechat_identities(id,user_id,app_id,openid_hash) VALUES($1,$2,$3,$4)',
            [randomUUID(), actor.user.id, this.configuration.appId, openidHash],
          );
        await c.query(
          "UPDATE wechat_auth_attempts SET status='COMPLETE',finished_at=clock_timestamp() WHERE id=$1",
          [attempt.id],
        );
        await this.audit(c, actor.user.id, null, 'AUTH_WECHAT_BOUND', 'user', actor.user.id);
        return this.view(c, actor);
      });
    } catch (error) {
      await this.fail(claim.attempt.id);
      if ((error as { code?: string }).code === '23505')
        throw new ApiError(409, 'WECHAT_BINDING_CONFLICT', '微信绑定发生冲突，请重新读取');
      throw error;
    }
  }
  async wechatLogin(raw: unknown, ip: string): Promise<{ data: SessionData; token: string }> {
    const claim = await this.claim(undefined, raw, 'LOGIN', ip);
    try {
      const openidHash = await this.exchanged(claim);
      const identity = (
        await this.pool.query<Row>(
          "SELECT id,user_id FROM wechat_identities WHERE app_id=$1 AND openid_hash=$2 AND status='ACTIVE'",
          [this.configuration.appId, openidHash],
        )
      ).rows[0];
      if (!identity)
        throw new ApiError(401, 'WECHAT_BINDING_REQUIRED', '请先使用已有账号登录并明确绑定微信');
      return await this.transaction(async (c) => {
        await this.accountLock(c, identity.user_id);
        const user = (
          await c.query<DbUser>("SELECT * FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE", [
            identity.user_id,
          ])
        ).rows[0];
        const current = await c.query(
          "SELECT id FROM wechat_identities WHERE id=$1 AND user_id=$2 AND app_id=$3 AND openid_hash=$4 AND status='ACTIVE' FOR SHARE",
          [identity.id, identity.user_id, this.configuration.appId, openidHash],
        );
        const attempt = await c.query(
          "SELECT id FROM wechat_auth_attempts WHERE id=$1 AND status='CLAIMED' AND expires_at>clock_timestamp() FOR UPDATE",
          [claim.attempt.id],
        );
        if (!user || !current.rowCount || !attempt.rowCount) throw rejected();
        const session = await this.createSession(c, user.id);
        await c.query(
          "UPDATE wechat_auth_attempts SET status='COMPLETE',finished_at=clock_timestamp() WHERE id=$1",
          [claim.attempt.id],
        );
        await this.audit(c, user.id, null, 'AUTH_WECHAT_LOGIN', 'session', session.id);
        return { data: await this.sessionData(c, user), token: session.token };
      });
    } catch (error) {
      await this.fail(claim.attempt.id);
      throw error;
    }
  }
  async unbind(cookie: string | undefined, raw: unknown, ip: string) {
    const body = objectInput(raw, ['password', 'expectedVersion', 'consent']);
    consent(body.consent);
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1)
      invalid('绑定版本无效');
    if (!this.configuration.appId)
      throw new ApiError(503, 'WECHAT_DISABLED', '微信登录尚未配置启用');
    await this.rateLimit(`wechat-unbind:${hashToken(ip)}`, 10, 900);
    const candidate = await this.candidate(cookie, passwordInput(body.password));
    return this.transaction(async (c) => {
      const actor = await this.current(c, cookie, candidate, true);
      const identity = (
        await c.query<Row>(
          "SELECT id,version FROM wechat_identities WHERE app_id=$1 AND user_id=$2 AND status='ACTIVE' FOR UPDATE",
          [this.configuration.appId, actor.user.id],
        )
      ).rows[0];
      if (!identity) throw new ApiError(409, 'WECHAT_NOT_BOUND', '当前账号没有有效微信绑定');
      if (identity.version !== body.expectedVersion)
        throw new ApiError(409, 'VERSION_CONFLICT', '微信绑定已更新，请重新读取后操作');
      await c.query(
        "UPDATE wechat_identities SET status='REVOKED',version=version+1,updated_at=clock_timestamp(),revoked_at=clock_timestamp() WHERE id=$1",
        [identity.id],
      );
      await revokeNotificationGrants(c, actor.user.id);
      await c.query(
        'UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL',
        [actor.user.id],
      );
      await this.audit(c, actor.user.id, null, 'AUTH_WECHAT_UNBOUND', 'user', actor.user.id);
      return null;
    });
  }
}
