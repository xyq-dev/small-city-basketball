import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ApplicationService } from './service.js';
import type { ApiOptions } from './service.js';
import { ApiError, notFound } from './errors.js';
import { hashToken } from './security.js';
import { objectInput, resourceId } from './validation.js';
import type { WechatExchange } from './wechat-provider.js';
import type {
  NotificationKind,
  NotificationMessage,
} from '../../../packages/contracts/notifications.js';
import {
  NOTIFICATION_KINDS,
  notificationConfirmInput,
  notificationHash,
  notificationIdInput,
  notificationKey,
  notificationKind,
  notificationTemplate,
  notificationTemplateData,
  openNotificationTarget,
  sealNotificationTarget,
} from './notification-domain.js';
import type { NotificationTemplate } from './notification-domain.js';
import type {
  WechatNotificationProvider,
  WechatNotificationResult,
} from './notification-provider.js';
import {
  captureEventMatchNotifications,
  captureNotification,
  notificationRecipientAllowed,
  notificationRecipientPage,
  resolveNotificationSource,
} from './notification-source.js';
import type { NotificationSourceInput, ResolvedNotificationSource } from './notification-source.js';
type Row = Record<string, any>;
export interface NotificationOptions {
  appId?: string;
  encryptionKey?: string;
  exchange?: WechatExchange;
  provider?: WechatNotificationProvider;
  templates?: Partial<Record<NotificationKind, NotificationTemplate>>;
  startingLeadMinutes?: number;
  autoDispatch?: boolean;
}
const disabled = () =>
  new ApiError(503, 'NOTIFICATIONS_DISABLED', '微信订阅提醒尚未配置，站内消息仍可查看');
const ownId = (value: unknown) => resourceId(typeof value === 'string' ? value : '');
const iso = (value: Date | string) => new Date(value).toISOString();
export class NotificationService extends ApplicationService {
  private readonly key?: Buffer;
  private readonly configurationHash: string;
  readonly leadMinutes: number;
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;
  constructor(
    pool: Pool,
    options: ApiOptions,
    readonly notifications: NotificationOptions = {},
  ) {
    super(pool, options);
    this.leadMinutes = notifications.startingLeadMinutes ?? 15;
    if (!Number.isInteger(this.leadMinutes) || this.leadMinutes < 1 || this.leadMinutes > 120)
      throw new Error('Invalid notification lead time');
    if (notifications.encryptionKey !== undefined)
      this.key = notificationKey(notifications.encryptionKey);
    const partial =
      !!this.key ||
      !!notifications.provider ||
      !!notifications.exchange ||
      !!notifications.appId ||
      !!notifications.templates;
    if (
      partial &&
      (!this.key ||
        !notifications.provider ||
        !notifications.exchange ||
        !/^wx[a-fA-F0-9]{16}$/.test(notifications.appId ?? '') ||
        !notifications.templates ||
        !Object.keys(notifications.templates).length)
    )
      throw new Error('Incomplete notification configuration');
    const templates = Object.entries(notifications.templates ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    for (const [kind, template] of templates) {
      notificationKind(kind);
      notificationTemplate(template!);
    }
    if (new Set(templates.map(([, v]) => v!.id)).size !== templates.length)
      throw new Error('Notification kinds require distinct configured templates');
    this.configurationHash = notificationHash({
      appId: notifications.appId ?? null,
      templates,
      keyId: this.key ? notificationHash(this.key.toString('base64')) : null,
    });
  }
  private template(kind: NotificationKind) {
    const template = this.notifications.templates?.[kind];
    if (!template || !this.key || !this.notifications.provider || !this.notifications.exchange)
      throw disabled();
    return template;
  }
  capabilities() {
    return {
      wechatEnabled: !!this.key,
      acceptanceIsDelivery: false as const,
      startingLeadMinutes: this.leadMinutes,
      kinds: NOTIFICATION_KINDS.map((kind) => ({
        kind,
        templateId: this.notifications.templates?.[kind]?.id ?? null,
      })),
    };
  }
  async assertConfiguration() {
    if (!this.key) return;
    const keyId = notificationHash(this.key.toString('base64'));
    await this.pool.query(
      'INSERT INTO notification_configuration(singleton,key_id) VALUES(true,$1) ON CONFLICT DO NOTHING',
      [keyId],
    );
    const row = (
      await this.pool.query('SELECT key_id FROM notification_configuration WHERE singleton=true')
    ).rows[0];
    if (row?.key_id !== keyId)
      throw new Error('Notification key does not match stored configuration');
  }
  startWorker() {
    if (!this.timer && this.notifications.autoDispatch !== false) {
      this.timer = setInterval(() => {
        void this.drain().catch(() => {
          /* private state only, no credentials */
        });
      }, 5000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async settingsLock(c: PoolClient, userId: string) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'notification-settings:' + userId,
    ]);
  }
  private async identity(c: PoolClient, userId: string) {
    return (
      (
        await c.query<Row>(
          "SELECT * FROM wechat_identities WHERE user_id=$1 AND app_id=$2 AND status='ACTIVE' FOR SHARE",
          [userId, this.notifications.appId ?? ''],
        )
      ).rows[0] ?? null
    );
  }
  private aad(g: Row) {
    return [g.id, g.user_id, this.notifications.appId, g.identity_id, g.identity_version].join(':');
  }
  private grantDto(g: Row) {
    return { id: g.id, kind: g.kind, state: g.status, createdAt: iso(g.created_at) };
  }
  private intentDto(r: Row) {
    return {
      id: r.id,
      kind: r.kind,
      templateId: r.template_id,
      expiresAt: iso(r.expires_at),
      state: ['PENDING', 'CLAIMED'].includes(r.status) && r.valid === false ? 'EXPIRED' : r.status,
      subscriptionId: r.grant_id ?? null,
    };
  }
  async createIntent(cookie: string | undefined, raw: unknown) {
    const p = notificationIdInput(raw),
      template = this.template(p.kind);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.settingsLock(c, a.user.id);
      const old = (
        await c.query<Row>(
          'SELECT * FROM notification_subscription_intents WHERE user_id=$1 AND client_request_id=$2',
          [a.user.id, p.clientRequestId],
        )
      ).rows[0];
      if (old) {
        if (old.kind !== p.kind)
          throw new ApiError(409, 'NOTIFICATION_REQUEST_CONFLICT', '原订阅编号内容不同');
        await this.ensureFreshSession(c, a);
        return this.intentDto(old);
      }
      const identity = await this.identity(c, a.user.id);
      if (!identity)
        throw new ApiError(409, 'NOTIFICATION_IDENTITY_REQUIRED', '请先绑定当前小程序微信身份');
      const count = Number(
        (
          await c.query(
            "SELECT count(*)::int AS n FROM notification_subscription_intents WHERE user_id=$1 AND created_at>clock_timestamp()-interval '10 minutes'",
            [a.user.id],
          )
        ).rows[0].n,
      );
      if (count >= 10) throw new ApiError(429, 'NOTIFICATION_RATE_LIMIT', '请稍后再申请订阅');
      const r = (
        await c.query<Row>(
          `INSERT INTO notification_subscription_intents(id,user_id,client_request_id,kind,template_id,configuration_hash,identity_id,identity_version,created_at,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,statement_timestamp(),statement_timestamp()+interval '5 minutes') RETURNING *`,
          [
            randomUUID(),
            a.user.id,
            p.clientRequestId,
            p.kind,
            template.id,
            this.configurationHash,
            identity.id,
            identity.version,
          ],
        )
      ).rows[0]!;
      await this.ensureFreshSession(c, a);
      return this.intentDto(r);
    });
  }
  async intent(cookie: string | undefined, id: string) {
    resourceId(id);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const row = (
        await c.query<Row>(
          'SELECT *,expires_at>clock_timestamp() AS valid FROM notification_subscription_intents WHERE user_id=$1 AND id=$2',
          [a.user.id, id],
        )
      ).rows[0];
      if (!row) throw notFound();
      await this.ensureFreshSession(c, a);
      return this.intentDto(row);
    });
  }
  async confirm(cookie: string | undefined, raw: unknown) {
    const p = notificationConfirmInput(raw);
    const claimed = await this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.settingsLock(c, a.user.id);
      const identity = await this.identity(c, a.user.id);
      const r = (
        await c.query<Row>(
          'SELECT *,expires_at>clock_timestamp() AS valid FROM notification_subscription_intents WHERE user_id=$1 AND id=$2 FOR UPDATE',
          [a.user.id, p.intentId],
        )
      ).rows[0];
      if (!r) throw notFound();
      this.template(r.kind);
      if (
        r.confirm_request_id === p.clientRequestId &&
        ['ACCEPTED', 'REJECTED'].includes(r.status)
      ) {
        if (
          (r.status === 'ACCEPTED') !== (p.result === 'accept') ||
          (p.code && r.code_hash !== hashToken(p.code))
        )
          throw new ApiError(409, 'NOTIFICATION_REQUEST_CONFLICT', '原订阅确认内容不同');
        await this.ensureFreshSession(c, a);
        return { replay: this.intentDto(r) };
      }
      if (
        !r.valid ||
        r.status !== 'PENDING' ||
        r.configuration_hash !== this.configurationHash ||
        !identity ||
        identity.id !== r.identity_id ||
        identity.version !== r.identity_version
      )
        throw new ApiError(
          409,
          'NOTIFICATION_INTENT_UNAVAILABLE',
          '订阅意图已失效，请重新发起本次订阅',
        );
      await c.query(
        `UPDATE notification_subscription_intents SET status=$2,confirm_request_id=$3,code_hash=$4,
        finished_at=CASE WHEN $2='REJECTED' THEN clock_timestamp() ELSE NULL END WHERE id=$1`,
        [
          r.id,
          p.result === 'accept' ? 'CLAIMED' : 'REJECTED',
          p.clientRequestId,
          p.code ? hashToken(p.code) : null,
        ],
      );
      await this.ensureFreshSession(c, a);
      return { userId: a.user.id, intent: r, identity, rejected: p.result !== 'accept' };
    });
    if ('replay' in claimed) return claimed.replay;
    if (claimed.rejected) return this.intent(cookie, p.intentId);
    try {
      const result = await this.notifications.exchange!.exchange(p.code!);
      if (
        result.appId !== this.notifications.appId ||
        hashToken(`${result.appId}\n${result.openid}`) !== claimed.identity.openid_hash
      )
        throw new ApiError(403, 'NOTIFICATION_IDENTITY_MISMATCH', '微信身份不属于当前绑定账号');
      return await this.transaction(async (c) => {
        const a = await this.lockActor(c, cookie);
        await this.settingsLock(c, a.user.id);
        const identity = await this.identity(c, a.user.id);
        const intent = (
          await c.query<Row>(
            'SELECT *,expires_at>clock_timestamp() AS valid FROM notification_subscription_intents WHERE id=$1 AND user_id=$2 FOR UPDATE',
            [p.intentId, a.user.id],
          )
        ).rows[0];
        if (
          a.user.id !== claimed.userId ||
          !identity ||
          identity.id !== claimed.identity.id ||
          identity.version !== claimed.identity.version ||
          !intent?.valid ||
          intent.status !== 'CLAIMED' ||
          intent.confirm_request_id !== p.clientRequestId ||
          intent.configuration_hash !== this.configurationHash
        )
          throw new ApiError(409, 'NOTIFICATION_INTENT_UNAVAILABLE', '订阅确认已失效，请重新操作');
        const n = Number(
          (
            await c.query(
              "SELECT count(*)::int AS n FROM notification_subscription_grants WHERE user_id=$1 AND status IN('AVAILABLE','RESERVED')",
              [a.user.id],
            )
          ).rows[0].n,
        );
        if (n >= 20)
          throw new ApiError(409, 'NOTIFICATION_GRANT_LIMIT', '已有未使用订阅，请先处理或撤销');
        const id = randomUUID(),
          g = {
            id,
            user_id: a.user.id,
            identity_id: identity.id,
            identity_version: identity.version,
          };
        await c.query(
          `INSERT INTO notification_subscription_grants(id,user_id,intent_id,kind,template_id,configuration_hash,identity_id,identity_version,target_cipher)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            a.user.id,
            intent.id,
            intent.kind,
            intent.template_id,
            this.configurationHash,
            identity.id,
            identity.version,
            sealNotificationTarget(this.key!, this.aad(g), result.openid),
          ],
        );
        await c.query(
          "UPDATE notification_subscription_intents SET status='ACCEPTED',grant_id=$2,finished_at=clock_timestamp() WHERE id=$1",
          [intent.id, id],
        );
        await c.query(
          `UPDATE notification_deliveries d SET next_attempt_at=clock_timestamp()
          FROM notification_messages m JOIN notification_source_events s ON s.id=m.source_id
          WHERE d.message_id=m.id AND m.user_id=$1 AND s.kind=$2 AND d.state='WAITING_PERMISSION'`,
          [a.user.id, intent.kind],
        );
        await this.ensureFreshSession(c, a);
        return this.intentDto({ ...intent, status: 'ACCEPTED', grant_id: id });
      });
    } catch (error) {
      await this.pool.query(
        "UPDATE notification_subscription_intents SET status='FAILED',finished_at=clock_timestamp() WHERE id=$1 AND status='CLAIMED' AND confirm_request_id=$2",
        [p.intentId, p.clientRequestId],
      );
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        'NOTIFICATION_CONFIRM_UNAVAILABLE',
        '微信订阅确认未完成，请核对原请求或重新申请',
      );
    }
  }
  async settings(cookie: string | undefined) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const grants = await c.query<Row>(
        'SELECT id,kind,status,created_at FROM notification_subscription_grants WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50',
        [a.user.id],
      );
      await this.ensureFreshSession(c, a);
      return { ...this.capabilities(), subscriptions: grants.rows.map((g) => this.grantDto(g)) };
    });
  }
  async revoke(cookie: string | undefined, raw: unknown) {
    const b = objectInput(raw, ['kind', 'clientRequestId']),
      kind = notificationKind(b.kind);
    const commandId = ownId(b.clientRequestId),
      requestHash = notificationHash(['REVOKE', kind]);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.settingsLock(c, a.user.id);
      const old = await this.commandReplay(c, a.user.id, commandId, 'REVOKE', requestHash);
      if (old) {
        await this.ensureFreshSession(c, a);
        return old;
      }
      await revokeNotificationGrants(c, a.user.id, kind);
      await this.commandReceipt(c, a.user.id, commandId, 'REVOKE', requestHash, { revoked: true });
      await this.ensureFreshSession(c, a);
      return { revoked: true };
    });
  }
  private async current(
    c: PoolClient,
    r: Row,
    userId: string,
  ): Promise<ResolvedNotificationSource | null> {
    const source = await resolveNotificationSource(
      c,
      { kind: r.kind, orgId: r.org_id, eventId: r.event_id, resourceId: r.resource_id },
      this.leadMinutes,
    );
    if (
      !source ||
      source.fingerprint !== r.source_fingerprint ||
      !(await notificationRecipientAllowed(c, source, userId))
    )
      return null;
    return source;
  }
  private async message(c: PoolClient, userId: string, id: string, lock = false) {
    const row = (
      await c.query<Row>(
        `SELECT m.*,s.kind,s.org_id,s.event_id,s.resource_id,s.source_fingerprint,s.due_at,s.expires_at,
        d.id AS delivery_id,d.state AS delivery_state,d.grant_id,d.updated_at AS delivery_updated_at
       FROM notification_messages m JOIN notification_source_events s ON s.id=m.source_id
       JOIN notification_deliveries d ON d.message_id=m.id
       WHERE m.user_id=$1 AND m.id=$2 AND s.due_at<=clock_timestamp() AND s.expires_at>clock_timestamp()
       ${lock ? 'FOR UPDATE OF m,d' : ''}`,
        [userId, id],
      )
    ).rows[0];
    if (!row) return null;
    const source = await this.current(c, row, userId);
    return source ? { row, source } : null;
  }
  private dto(r: Row, s: ResolvedNotificationSource, canRetry = false): NotificationMessage {
    return {
      id: r.id,
      kind: s.kind,
      title: s.title,
      detail: s.detail,
      eventName: s.eventName,
      time: s.time,
      location: s.location,
      createdAt: iso(r.created_at),
      readAt: r.read_at ? iso(r.read_at) : null,
      delivery: r.delivery_state,
      canRetry,
    };
  }
  async list(cookie: string | undefined, raw: unknown) {
    const b = objectInput(raw ?? {}, ['cursor']);
    let cursor: { at: string; id: string } | null = null;
    if (b.cursor !== undefined) {
      try {
        if (typeof b.cursor !== 'string' || b.cursor.length > 1024) throw Error();
        const p = JSON.parse(Buffer.from(b.cursor, 'base64url').toString('utf8'));
        if (
          !Array.isArray(p) ||
          p.length !== 2 ||
          typeof p[0] !== 'string' ||
          isNaN(Date.parse(p[0]))
        )
          throw Error();
        cursor = { at: p[0], id: ownId(p[1]) };
      } catch {
        throw new ApiError(422, 'INVALID_NOTIFICATION_CURSOR', '请重新读取消息');
      }
    }
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const rows = await c.query<Row>(
        `SELECT m.id,m.created_at FROM notification_messages m JOIN notification_source_events s ON s.id=m.source_id
        WHERE m.user_id=$1 AND s.due_at<=clock_timestamp() AND s.expires_at>clock_timestamp()
        ${cursor ? 'AND (m.created_at,m.id)<($2::timestamptz,$3::uuid)' : ''}
        ORDER BY m.created_at DESC,m.id DESC LIMIT 21`,
        cursor ? [a.user.id, cursor.at, cursor.id] : [a.user.id],
      );
      const result: NotificationMessage[] = [];
      for (const row of rows.rows.slice(0, 20)) {
        const v = await this.message(c, a.user.id, row.id);
        if (v)
          result.push(
            this.dto(v.row, v.source, ['FAILED', 'UNKNOWN'].includes(v.row.delivery_state)),
          );
      }
      const last = rows.rows.slice(0, 20).at(-1);
      await this.ensureFreshSession(c, a);
      return {
        items: result,
        nextCursor:
          rows.rows.length > 20 && last
            ? Buffer.from(JSON.stringify([iso(last.created_at), last.id])).toString('base64url')
            : null,
      };
    });
  }
  async read(cookie: string | undefined, id: string, raw: unknown) {
    resourceId(id);
    const b = objectInput(raw, ['clientRequestId']);
    ownId(b.clientRequestId);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const current = await this.message(c, a.user.id, id);
      if (!current) throw notFound();
      await c.query(
        'UPDATE notification_messages SET read_at=clock_timestamp() WHERE id=$1 AND user_id=$2 AND read_at IS NULL',
        [id, a.user.id],
      );
      await this.ensureFreshSession(c, a);
      return { read: true };
    });
  }
  async retry(cookie: string | undefined, id: string, raw: unknown) {
    resourceId(id);
    const b = objectInput(raw, ['clientRequestId', 'acknowledgePossibleDuplicate']);
    const commandId = ownId(b.clientRequestId),
      requestHash = notificationHash(['RETRY', id, true]);
    if (b.acknowledgePossibleDuplicate !== true)
      throw new ApiError(
        422,
        'NOTIFICATION_RETRY_CONFIRMATION',
        '重新发起可能重复的提醒需明确确认',
      );
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.settingsLock(c, a.user.id);
      const current = await this.message(c, a.user.id, id);
      if (!current) throw notFound();
      const old = await this.commandReplay(c, a.user.id, commandId, 'RETRY', requestHash);
      if (old) {
        await this.ensureFreshSession(c, a);
        return old;
      }
      const d = (
        await c.query<Row>('SELECT * FROM notification_deliveries WHERE id=$1 FOR UPDATE', [
          current.row.delivery_id,
        ])
      ).rows[0]!;
      if (!['FAILED', 'UNKNOWN'].includes(d.state))
        throw new ApiError(409, 'NOTIFICATION_NOT_RETRYABLE', '当前消息无需重试');
      const grant = (
        await c.query<Row>(
          `SELECT id FROM notification_subscription_grants WHERE user_id=$1 AND kind=$2 AND status='AVAILABLE'
        AND configuration_hash=$3 AND created_at>$4 ORDER BY created_at,id LIMIT 1 FOR UPDATE`,
          [a.user.id, current.source.kind, this.configurationHash, d.updated_at],
        )
      ).rows[0];
      if (!grant)
        throw new ApiError(
          409,
          'NOTIFICATION_NEW_PERMISSION_REQUIRED',
          '请先重新订阅一次，再明确发起新的提醒',
        );
      await c.query("UPDATE notification_subscription_grants SET status='RESERVED' WHERE id=$1", [
        grant.id,
      ]);
      await c.query(
        "UPDATE notification_deliveries SET state='PENDING',grant_id=$2,attempt=0,last_reason=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",
        [d.id, grant.id],
      );
      await this.commandReceipt(c, a.user.id, commandId, 'RETRY', requestHash, { pending: true });
      await this.ensureFreshSession(c, a);
      return { pending: true };
    });
  }
  private async commandReplay(
    c: PoolClient,
    userId: string,
    id: string,
    action: string,
    hash: string,
  ) {
    const r = (
      await c.query<Row>(
        'SELECT * FROM notification_commands WHERE user_id=$1 AND client_request_id=$2',
        [userId, id],
      )
    ).rows[0];
    if (!r) return null;
    if (r.action !== action || r.request_hash !== hash)
      throw new ApiError(409, 'NOTIFICATION_REQUEST_CONFLICT', '原通知操作编号内容不同');
    return r.response;
  }
  private async commandReceipt(
    c: PoolClient,
    userId: string,
    id: string,
    action: string,
    hash: string,
    response: unknown,
  ) {
    await c.query(
      'INSERT INTO notification_commands(user_id,client_request_id,action,request_hash,response) VALUES($1,$2,$3,$4,$5)',
      [userId, id, action, hash, response],
    );
  }
  private async cancelDelivery(c: PoolClient, id: string) {
    const d = (
      await c.query<Row>('SELECT * FROM notification_deliveries WHERE id=$1 FOR UPDATE', [id])
    ).rows[0];
    if (!d || !['WAITING_PERMISSION', 'PENDING'].includes(d.state)) return;
    if (d.grant_id) {
      await c.query(
        "UPDATE notification_subscription_grants SET status='REVOKED',target_cipher=NULL,revoked_at=clock_timestamp() WHERE id=$1 AND status='RESERVED'",
        [d.grant_id],
      );
      await c.query(
        "UPDATE notification_delivery_attempts SET state='CANCELLED',finished_at=clock_timestamp() WHERE grant_id=$1 AND state='SENDING'",
        [d.grant_id],
      );
    }
    await c.query(
      "UPDATE notification_deliveries SET state='CANCELLED',last_reason='SOURCE_UNAVAILABLE',updated_at=clock_timestamp() WHERE id=$1",
      [id],
    );
  }
  /** Transaction hooks owned by root call these with business IDs, never user-authored text. */
  capture(c: PoolClient, input: NotificationSourceInput) {
    return captureNotification(c, input, this.leadMinutes);
  }
  captureEventMatches(c: PoolClient, orgId: string, eventId: string) {
    return captureEventMatchNotifications(c, orgId, eventId, this.leadMinutes);
  }
  async fanout() {
    const sources = await this.pool
      .query<Row>(`SELECT s.* FROM notification_source_events s JOIN notification_fanout_state f ON f.source_id=s.id
      WHERE f.done=false AND s.due_at<=clock_timestamp() ORDER BY s.due_at,s.id LIMIT 10`);
    for (const raw of sources.rows)
      await this.transaction(async (c) => {
        const source = await resolveNotificationSource(
          c,
          { kind: raw.kind, orgId: raw.org_id, eventId: raw.event_id, resourceId: raw.resource_id },
          this.leadMinutes,
        );
        const f = (
          await c.query<Row>(
            'SELECT * FROM notification_fanout_state WHERE source_id=$1 FOR UPDATE',
            [raw.id],
          )
        ).rows[0];
        if (!f || f.done) return;
        const time = (
          await c.query<{ live: boolean }>(
            'SELECT expires_at>clock_timestamp() AS live FROM notification_source_events WHERE id=$1',
            [raw.id],
          )
        ).rows[0];
        const valid = source && source.fingerprint === raw.source_fingerprint && time?.live;
        if (!valid) {
          await c.query(
            'UPDATE notification_fanout_state SET done=true,updated_at=clock_timestamp() WHERE source_id=$1',
            [raw.id],
          );
          return;
        }
        const users = await notificationRecipientPage(c, source, f.cursor_user_id ?? undefined);
        // No source text is persisted; inbox reads and the send boundary re-resolve access.
        for (const userId of users) {
          const id = randomUUID();
          const inserted = await c.query(
            "INSERT INTO notification_messages(id,user_id,source_id) SELECT $1,id,$3 FROM users WHERE id=$2 AND status='ACTIVE' ON CONFLICT DO NOTHING RETURNING id",
            [id, userId, raw.id],
          );
          if (inserted.rowCount)
            await c.query('INSERT INTO notification_deliveries(id,message_id) VALUES($1,$2)', [
              randomUUID(),
              id,
            ]);
        }
        await c.query(
          'UPDATE notification_fanout_state SET cursor_user_id=COALESCE($2,cursor_user_id),done=$3,updated_at=clock_timestamp() WHERE source_id=$1',
          [raw.id, users.at(-1) ?? null, users.length < 100],
        );
      });
  }
  private async claim(id: string) {
    const candidate = (
      await this.pool.query<Row>(
        `SELECT d.message_id,m.user_id FROM notification_deliveries d JOIN notification_messages m ON m.id=d.message_id WHERE d.id=$1`,
        [id],
      )
    ).rows[0];
    if (!candidate) return null;
    return this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
        'scb-account-maintenance:' + candidate.user_id,
      ]);
      const user = (
        await c.query<Row>("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE", [
          candidate.user_id,
        ])
      ).rows[0];
      if (!user) return null;
      await this.settingsLock(c, user.id);
      const current = await this.message(c, user.id, candidate.message_id);
      if (!current) {
        await this.cancelDelivery(c, id);
        return null;
      }
      const d = (
        await c.query<Row>(
          'SELECT *,next_attempt_at<=clock_timestamp() AS due FROM notification_deliveries WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0]!;
      if (!['WAITING_PERMISSION', 'PENDING'].includes(d.state) || !d.due) return null;
      let grant = d.grant_id
        ? (
            await c.query<Row>(
              'SELECT * FROM notification_subscription_grants WHERE id=$1 FOR UPDATE',
              [d.grant_id],
            )
          ).rows[0]
        : null;
      if (!grant)
        grant = (
          await c.query<Row>(
            `SELECT * FROM notification_subscription_grants WHERE user_id=$1 AND kind=$2 AND status='AVAILABLE'
        AND configuration_hash=$3 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [user.id, current.source.kind, this.configurationHash],
          )
        ).rows[0];
      if (!grant) {
        await c.query(
          "UPDATE notification_deliveries SET next_attempt_at=clock_timestamp()+interval '30 seconds' WHERE id=$1",
          [id],
        );
        return null;
      }
      const identity = await this.identity(c, user.id);
      if (
        !identity ||
        identity.id !== grant.identity_id ||
        identity.version !== grant.identity_version ||
        grant.configuration_hash !== this.configurationHash ||
        !['AVAILABLE', 'RESERVED'].includes(grant.status)
      ) {
        if (grant.status !== 'REVOKED')
          await c.query(
            "UPDATE notification_subscription_grants SET status='REVOKED',target_cipher=NULL,revoked_at=clock_timestamp() WHERE id=$1",
            [grant.id],
          );
        await c.query(
          "UPDATE notification_delivery_attempts SET state='CANCELLED',finished_at=clock_timestamp() WHERE grant_id=$1 AND state='SENDING'",
          [grant.id],
        );
        await c.query(
          "UPDATE notification_deliveries SET state='CANCELLED',last_reason='IDENTITY_UNAVAILABLE',updated_at=clock_timestamp() WHERE id=$1",
          [id],
        );
        return null;
      }
      if (grant.status === 'AVAILABLE')
        await c.query("UPDATE notification_subscription_grants SET status='RESERVED' WHERE id=$1", [
          grant.id,
        ]);
      const lease = randomUUID();
      await c.query(
        `UPDATE notification_deliveries SET state='SENDING',grant_id=$2,attempt=attempt+1,lease_id=$3,
        lease_until=clock_timestamp()+interval '45 seconds',updated_at=clock_timestamp() WHERE id=$1`,
        [id, grant.id, lease],
      );
      await c.query(
        "INSERT INTO notification_delivery_attempts(id,delivery_id,grant_id,lease_id,state) VALUES($1,$2,$3,$4,'SENDING') ON CONFLICT(grant_id) DO NOTHING",
        [randomUUID(), id, grant.id, lease],
      );
      return { id, userId: user.id, messageId: candidate.message_id, lease };
    });
  }
  private async finishGrant(c: PoolClient, id: string) {
    await c.query(
      "UPDATE notification_subscription_grants SET status='CONSUMED',target_cipher=NULL,used_at=clock_timestamp() WHERE id=$1 AND status='RESERVED'",
      [id],
    );
  }
  private async deliver(claim: { id: string; userId: string; messageId: string; lease: string }) {
    return this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
        'scb-account-maintenance:' + claim.userId,
      ]);
      const user = (
        await c.query<Row>("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE", [
          claim.userId,
        ])
      ).rows[0];
      await this.settingsLock(c, claim.userId);
      const current = user ? await this.message(c, user.id, claim.messageId) : null;
      const d = (
        await c.query<Row>(
          'SELECT *,lease_until>clock_timestamp() AS live FROM notification_deliveries WHERE id=$1 FOR UPDATE',
          [claim.id],
        )
      ).rows[0]!;
      if (d.state !== 'SENDING' || d.lease_id !== claim.lease || !d.live) return;
      const identity = user ? await this.identity(c, user.id) : null;
      const grant = (
        await c.query<Row>(
          'SELECT * FROM notification_subscription_grants WHERE id=$1 FOR UPDATE',
          [d.grant_id],
        )
      ).rows[0];
      const valid =
        current &&
        identity &&
        grant?.status === 'RESERVED' &&
        identity.id === grant.identity_id &&
        identity.version === grant.identity_version &&
        grant.configuration_hash === this.configurationHash;
      if (!valid) {
        if (grant?.status === 'RESERVED') await this.finishGrant(c, grant.id);
        if (grant)
          await c.query(
            "UPDATE notification_delivery_attempts SET state='CANCELLED',finished_at=clock_timestamp() WHERE grant_id=$1 AND state='SENDING'",
            [grant.id],
          );
        await c.query(
          "UPDATE notification_deliveries SET state='CANCELLED',lease_id=NULL,lease_until=NULL,last_reason='SOURCE_UNAVAILABLE',updated_at=clock_timestamp() WHERE id=$1",
          [d.id],
        );
        return;
      }
      // The claim's SENDING and attempt record are committed before this external boundary.
      const tail = (
        await c.query<{ live: boolean }>(
          `SELECT d.lease_until>clock_timestamp() AND s.expires_at>clock_timestamp() AS live
        FROM notification_deliveries d JOIN notification_messages m ON m.id=d.message_id
        JOIN notification_source_events s ON s.id=m.source_id WHERE d.id=$1`,
          [d.id],
        )
      ).rows[0];
      if (!tail?.live) return;
      let result: WechatNotificationResult;
      try {
        result = await this.notifications.provider!.send({
          openid: openNotificationTarget(this.key!, this.aad(grant), grant.target_cipher),
          templateId: grant.template_id,
          data: notificationTemplateData(this.template(current.source.kind), {
            title: current.source.title,
            event: current.source.eventName,
            detail: current.source.detail,
            time: new Date(current.source.time)
              .toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
              .replaceAll('/', '-'),
          }),
        });
      } catch {
        result = { state: 'UNKNOWN' };
      }
      if (result.state === 'RETRYABLE' && d.attempt < 5) {
        // Only an explicit token preparation/rejection proves no message acceptance.
        await c.query(
          "UPDATE notification_deliveries SET state='PENDING',lease_id=NULL,lease_until=NULL,last_reason=$2,next_attempt_at=clock_timestamp()+make_interval(secs=>$3),updated_at=clock_timestamp() WHERE id=$1",
          [d.id, result.reason, Math.min(300, 5 * 2 ** d.attempt)],
        );
        return;
      }
      const state =
        result.state === 'ACCEPTED'
          ? 'ACCEPTED'
          : result.state === 'UNKNOWN'
            ? 'UNKNOWN'
            : 'FAILED';
      await this.finishGrant(c, grant.id);
      await c.query(
        `UPDATE notification_deliveries SET state=$2,lease_id=NULL,lease_until=NULL,last_reason=$3,
        accepted_at=CASE WHEN $2='ACCEPTED' THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp() WHERE id=$1`,
        [
          d.id,
          state,
          result.state === 'REJECTED' || result.state === 'RETRYABLE' ? result.reason : null,
        ],
      );
      await c.query(
        "UPDATE notification_delivery_attempts SET state=$2,finished_at=clock_timestamp() WHERE grant_id=$1 AND state='SENDING'",
        [grant.id, state],
      );
    });
  }
  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      await this.fanout();
      await this.recoverExpiredLeases();
      if (!this.key || !this.notifications.provider) return;
      const rows = await this.pool.query<{ id: string }>(
        "SELECT id FROM notification_deliveries WHERE state IN('WAITING_PERMISSION','PENDING') AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at,id LIMIT 20",
      );
      for (const row of rows.rows) {
        const claim = await this.claim(row.id);
        if (claim) await this.deliver(claim);
      }
    } finally {
      this.draining = false;
    }
  }
  async recoverExpiredLeases() {
    const rows = await this.pool.query<Row>(
      "SELECT id FROM notification_deliveries WHERE state='SENDING' AND lease_until<=clock_timestamp() ORDER BY lease_until,id LIMIT 20",
    );
    for (const row of rows.rows)
      await this.transaction(async (c) => {
        const owner = (
          await c.query<{ user_id: string }>(
            'SELECT m.user_id FROM notification_deliveries d JOIN notification_messages m ON m.id=d.message_id WHERE d.id=$1',
            [row.id],
          )
        ).rows[0];
        if (!owner) return;
        await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
          'scb-account-maintenance:' + owner.user_id,
        ]);
        await c.query('SELECT id FROM users WHERE id=$1 FOR SHARE', [owner.user_id]);
        await this.settingsLock(c, owner.user_id);
        const d = (
          await c.query<Row>(
            "SELECT * FROM notification_deliveries WHERE id=$1 AND state='SENDING' AND lease_until<=clock_timestamp() FOR UPDATE",
            [row.id],
          )
        ).rows[0];
        if (!d) return;
        await this.finishGrant(c, d.grant_id);
        await c.query(
          "UPDATE notification_deliveries SET state='UNKNOWN',lease_id=NULL,lease_until=NULL,last_reason='LEASE_EXPIRED',updated_at=clock_timestamp() WHERE id=$1",
          [d.id],
        );
        await c.query(
          "UPDATE notification_delivery_attempts SET state='UNKNOWN',finished_at=clock_timestamp() WHERE grant_id=$1 AND state='SENDING'",
          [d.grant_id],
        );
      });
  }
}
/** Root invokes on account closure; no external call, all pending capability is erased atomically. */
export async function revokeNotificationGrants(
  c: PoolClient,
  userId: string,
  kind?: NotificationKind,
) {
  resourceId(userId);
  if (kind) notificationKind(kind);
  const intents = await c.query<Row>(
    `SELECT id,confirm_request_id FROM notification_subscription_intents
    WHERE user_id=$1 AND status IN('PENDING','CLAIMED') ${kind ? 'AND kind=$2' : ''} FOR UPDATE`,
    kind ? [userId, kind] : [userId],
  );
  for (const intent of intents.rows)
    await c.query(
      "UPDATE notification_subscription_intents SET status='FAILED',confirm_request_id=$2,finished_at=clock_timestamp() WHERE id=$1",
      [intent.id, intent.confirm_request_id ?? randomUUID()],
    );
  await c.query(
    `UPDATE notification_subscription_grants SET status='REVOKED',target_cipher=NULL,revoked_at=clock_timestamp()
    WHERE user_id=$1 AND status<>'REVOKED' ${kind ? 'AND kind=$2' : ''}`,
    kind ? [userId, kind] : [userId],
  );
  await c.query(
    `UPDATE notification_delivery_attempts a SET state=CASE WHEN d.state='SENDING' THEN 'UNKNOWN' ELSE 'CANCELLED' END,finished_at=clock_timestamp()
    FROM notification_subscription_grants g,notification_deliveries d WHERE a.grant_id=g.id AND d.id=a.delivery_id
    AND g.user_id=$1 AND a.state='SENDING' ${kind ? 'AND g.kind=$2' : ''}`,
    kind ? [userId, kind] : [userId],
  );
  await c.query(
    `UPDATE notification_deliveries d SET state=CASE WHEN d.state='SENDING' THEN 'UNKNOWN' ELSE 'CANCELLED' END,lease_id=NULL,lease_until=NULL,last_reason='IDENTITY_UNAVAILABLE',updated_at=clock_timestamp()
    FROM notification_messages m JOIN notification_source_events s ON s.id=m.source_id
    WHERE d.message_id=m.id AND m.user_id=$1 AND d.state IN('WAITING_PERMISSION','PENDING','SENDING') ${kind ? 'AND s.kind=$2' : ''}`,
    kind ? [userId, kind] : [userId],
  );
}
