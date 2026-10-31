import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  CommerceCommandResult,
  CommerceOrderData,
  CommercePlanData,
  CommerceWorkspaceData,
  CommerceQuote,
  CommerceReconciliationData,
} from '@small-city-basketball/contracts';
import { ApplicationService, isAdministrator } from '../service.js';
import type { Actor, ApiOptions, OrgActor } from '../service.js';
import { forbidden, notFound } from '../errors.js';
import { calendarDate, objectInput, resourceId } from '../validation.js';
import { expectedVersion } from '../registration-validation.js';
import {
  commandId,
  digest,
  fail,
  makeQuote,
  parseBuyerCommand,
  parseManualBill,
  parsePlan,
  parsePlatformCommand,
  reason,
  reference,
} from './domain.js';
import { WechatPayClient, reconcileWechatPayBill } from './wechatpay.js';
import type {
  WechatPayOrder,
  WechatPayRefund,
  WechatPayNotification,
  WechatPayBillRow,
} from './wechatpay.js';
import { checkPayment } from './domain.js';
import { createCommerceSystemActor } from './system-actor.js';
type Row = Record<string, any>;
interface Context {
  actor: Actor;
  org: OrgActor | null;
  operator: boolean;
}
const iso = (v: Date | string) => new Date(v).toISOString();
const version = (actual: number, expected: number) => {
  if (actual !== expected) fail('VERSION_CONFLICT', '商业资料已更新，请刷新后核对再操作');
};
export class CommerceService extends ApplicationService {
  readonly payments: WechatPayClient;
  readonly mode: 'OFF' | 'ENFORCED';
  constructor(pool: Pool, options: ApiOptions, payments?: WechatPayClient) {
    super(pool, options);
    this.mode = options.commerceMode ?? 'OFF';
    this.payments = payments ?? new WechatPayClient(options.wechatPay ?? { enabled: false });
  }
  private async context(
    c: PoolClient,
    cookie: string | undefined,
    orgId?: string,
    platform = false,
  ): Promise<Context> {
    const actor = await this.lockActor(c, cookie);
    const operator = !!(
      await c.query("SELECT user_id FROM platform_operators WHERE user_id=$1 AND status='ACTIVE'", [
        actor.user.id,
      ])
    ).rowCount;
    if (platform && !operator) throw forbidden();
    const org = orgId ? await this.lockOrganization(c, actor, orgId) : null;
    if (org && !isAdministrator(org.role)) throw forbidden();
    return { actor, org, operator };
  }
  private async order(c: PoolClient, id: string, ctx: Context | null, write = true): Promise<Row> {
    const ref = (
      await c.query<Row>('SELECT org_id,event_id FROM billing_orders WHERE id=$1', [resourceId(id)])
    ).rows[0];
    if (!ref || (ctx?.org && ref.org_id !== ctx.org.orgId)) throw notFound();
    if (
      !(
        await c.query(
          `SELECT id FROM organizations WHERE id=$1 AND status='ACTIVE' FOR ${ctx && !ctx.org ? 'UPDATE' : 'SHARE'}`,
          [ref.org_id],
        )
      ).rowCount
    )
      throw notFound();
    if (
      !(
        await c.query(
          `SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`,
          [ref.org_id, ref.event_id],
        )
      ).rowCount
    )
      throw notFound();
    const o = (
      await c.query<Row>(
        `SELECT o.*,e.name AS event_name FROM billing_orders o JOIN events e ON e.org_id=o.org_id AND e.id=o.event_id WHERE o.id=$1 FOR ${write ? 'UPDATE' : 'SHARE'} OF o`,
        [id],
      )
    ).rows[0];
    if (!o) throw notFound();
    return o;
  }
  private async independent(
    c: PoolClient,
    ctx: Context,
    o: Row,
    other: string | null,
  ): Promise<boolean> {
    if (!ctx.operator || other === ctx.actor.user.id || o.created_by === ctx.actor.user.id)
      return false;
    return !(
      await c.query(
        "SELECT user_id FROM organization_memberships WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE",
        [o.org_id, ctx.actor.user.id],
      )
    ).rowCount;
  }
  private async begin(
    c: PoolClient,
    actor: Actor,
    command: string,
    request: unknown,
  ): Promise<Row | null> {
    const hash = digest(request);
    // Serialize one actor's idempotency key before effects, including network dispatch claims.
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `scb-commerce:${actor.user.id}:${command}`,
    ]);
    const previous = (
      await c.query<Row>(
        'SELECT request_hash,result FROM billing_operations WHERE actor_id=$1 AND command_id=$2',
        [actor.user.id, command],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_hash !== hash)
        fail('IDEMPOTENCY_CONFLICT', '同一操作编号已用于不同商业资料');
      if (previous.result === null)
        fail(
          'COMMERCE_OPERATION_PENDING',
          '该操作结果待核对，请查询原订单，不要重复发起支付或退款',
        );
      return previous.result;
    }
    await c.query(
      'INSERT INTO billing_operations(actor_id,command_id,request_hash) VALUES($1,$2,$3)',
      [actor.user.id, command, hash],
    );
    return null;
  }
  private async finish(c: PoolClient, actor: Actor, command: string, result: unknown) {
    await c.query(
      'UPDATE billing_operations SET result=$3::jsonb WHERE actor_id=$1 AND command_id=$2',
      [actor.user.id, command, JSON.stringify(result)],
    );
  }
  private planDto(p: Row): CommercePlanData {
    return {
      id: p.id,
      code: p.code,
      version: p.version,
      name: p.name,
      currency: 'CNY',
      amountFen: p.amount_fen,
      maxTeams: p.max_teams,
      maxMatches: p.max_matches,
      validDays: p.valid_days,
      available: p.available,
      catalogVersion: p.catalog_version,
      createdAt: iso(p.created_at),
    };
  }
  private async latest(c: PoolClient, o: Row) {
    const review =
      (
        await c.query<Row>(
          'SELECT * FROM billing_payment_reviews WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
          [o.id],
        )
      ).rows[0] ?? null;
    const refund =
      (await c.query<Row>('SELECT * FROM billing_refunds WHERE order_id=$1', [o.id])).rows[0] ??
      null;
    const activated = !!(
      await c.query('SELECT event_id FROM event_commercial_activations WHERE event_id=$1', [
        o.event_id,
      ])
    ).rowCount;
    return { review, refund, activated };
  }
  private async orderDto(c: PoolClient, o: Row, ctx: Context): Promise<CommerceOrderData> {
    const { review: r, refund: f, activated } = await this.latest(c, o);
    const buyer = ctx.org?.role === 'ORG_OWNER' && ctx.org.orgId === o.org_id;
    const independent = await this.independent(c, ctx, o, r?.submitted_by ?? null);
    const refundIndependent = await this.independent(c, ctx, o, f?.submitted_by ?? null);
    const pending = o.status === 'PENDING_PAYMENT' && new Date(o.expires_at).getTime() > Date.now();
    return {
      id: o.id,
      orgId: o.org_id,
      eventId: o.event_id,
      eventName: o.event_name,
      quote: o.quote as CommerceQuote,
      status: o.status,
      version: o.version,
      channel: o.channel,
      createdByUserId: o.created_by,
      createdAt: iso(o.created_at),
      expiresAt: iso(o.expires_at),
      paidAt: o.paid_at ? iso(o.paid_at) : null,
      paymentReview: r
        ? {
            id: r.id,
            status: r.status,
            submittedByUserId: r.submitted_by,
            reviewedByUserId: r.reviewed_by,
            externalReference: r.external_reference,
            reason: r.reason,
            createdAt: iso(r.created_at),
            reviewedAt: r.reviewed_at ? iso(r.reviewed_at) : null,
          }
        : null,
      refund: f
        ? {
            id: f.id,
            status: f.status,
            amountFen: f.amount_fen,
            requestedByUserId: f.requested_by,
            submittedByUserId: f.submitted_by,
            reviewedByUserId: f.reviewed_by,
            externalReference: f.external_reference,
            reason: f.reason,
            createdAt: iso(f.created_at),
            completedAt: f.completed_at ? iso(f.completed_at) : null,
            acceptedAt: f.accepted_at ? iso(f.accepted_at) : null,
          }
        : null,
      activated,
      capabilities: {
        canCancel:
          !!buyer && o.status === 'PENDING_PAYMENT' && !o.channel && r?.status !== 'PENDING_REVIEW',
        canRequestRefund: !!buyer && o.status === 'PAID' && !activated && !f,
        canCreateNative:
          !!buyer &&
          pending &&
          !activated &&
          r?.status !== 'PENDING_REVIEW' &&
          o.channel !== 'MANUAL' &&
          this.mode === 'ENFORCED' &&
          this.payments.enabled,
        canQueryPayment: !!buyer && o.channel === 'WECHAT_NATIVE' && this.payments.enabled,
        canSubmitPayment: ctx.operator && pending && !o.channel && r?.status !== 'PENDING_REVIEW',
        canConfirmPayment: independent && pending && r?.status === 'PENDING_REVIEW',
        canRejectPayment: independent && r?.status === 'PENDING_REVIEW',
        canSubmitRefund:
          ctx.operator &&
          !activated &&
          ['PAID', 'REFUND_PENDING'].includes(o.status) &&
          (!f || f.status === 'REQUESTED'),
        canConfirmRefund: refundIndependent && !activated && f?.status === 'PENDING_REVIEW',
        canRejectRefund: refundIndependent && !activated && f?.status === 'PENDING_REVIEW',
      },
    };
  }
  async capabilities(cookie: string | undefined) {
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie);
      await this.ensureFreshSession(c, ctx.actor);
      return {
        platformOperator: ctx.operator,
        mode: this.mode,
        realPaymentEnabled: this.mode === 'ENFORCED' && this.payments.enabled,
      };
    });
  }
  async workspace(
    cookie: string | undefined,
    orgId?: string,
    platform = false,
  ): Promise<CommerceWorkspaceData> {
    return this.transaction(async (c) => {
      if (!orgId && !platform) throw forbidden();
      const ctx = await this.context(c, cookie, orgId, platform);
      const plans = (
        await c.query<Row>(
          'SELECT * FROM billing_plan_versions WHERE ($1::boolean OR available) ORDER BY code,version DESC LIMIT 100',
          [platform],
        )
      ).rows.map((p) => this.planDto(p));
      const orders = (
        await c.query<Row>(
          'SELECT o.*,e.name AS event_name FROM billing_orders o JOIN events e ON e.org_id=o.org_id AND e.id=o.event_id WHERE ($1::uuid IS NULL OR o.org_id=$1) ORDER BY o.created_at DESC,o.id DESC LIMIT 100',
          [ctx.org?.orgId ?? null],
        )
      ).rows;
      const entitlements = (
        await c.query<Row>(
          'SELECT n.*,e.name AS event_name,EXISTS(SELECT 1 FROM event_commercial_activations a WHERE a.entitlement_id=n.id) AS activated FROM event_entitlements n JOIN events e ON e.org_id=n.org_id AND e.id=n.event_id WHERE ($1::uuid IS NULL OR n.org_id=$1) ORDER BY n.created_at DESC LIMIT 100',
          [ctx.org?.orgId ?? null],
        )
      ).rows;
      const activations = (
        await c.query<Row>(
          'SELECT * FROM event_commercial_activations WHERE ($1::uuid IS NULL OR org_id=$1) ORDER BY activated_at DESC LIMIT 100',
          [ctx.org?.orgId ?? null],
        )
      ).rows;
      const events = ctx.org
        ? (
            await c.query<Row>(
              'SELECT id,name,version,status FROM events WHERE org_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
              [ctx.org.orgId],
            )
          ).rows
        : [];
      const rec = platform
        ? (
            await c.query<Row>(
              'SELECT * FROM billing_reconciliations ORDER BY created_at DESC,id DESC LIMIT 20',
            )
          ).rows
        : [];
      await this.ensureFreshSession(c, ctx.actor);
      return {
        mode: this.mode,
        orgId: ctx.org?.orgId ?? null,
        platformOperator: ctx.operator,
        realPaymentEnabled: this.mode === 'ENFORCED' && this.payments.enabled,
        canPurchase: this.mode === 'ENFORCED' && ctx.org?.role === 'ORG_OWNER',
        plans,
        orders: await Promise.all(orders.map((o) => this.orderDto(c, o, ctx))),
        entitlements: entitlements.map((n) => ({
          id: n.id,
          eventId: n.event_id,
          eventName: n.event_name,
          orderId: n.order_id,
          validUntil: iso(n.valid_until),
          revokedAt: n.revoked_at ? iso(n.revoked_at) : null,
          maxTeams: n.max_teams,
          maxMatches: n.max_matches,
          activated: n.activated,
        })),
        activations: activations.map((a) => ({
          eventId: a.event_id,
          source: a.source,
          entitlementId: a.entitlement_id,
          activatedAt: iso(a.activated_at),
        })),
        events: events.map((e) => ({
          id: e.id,
          name: e.name,
          version: e.version,
          status: e.status,
        })),
        reconciliations: rec.map((r) => this.reconciliationDto(r)),
      };
    });
  }
  async createPlan(cookie: string | undefined, raw: unknown) {
    const input = parsePlan(raw);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, undefined, true);
      const previous = await this.begin(c, ctx.actor, input.commandId, {
        action: 'CREATE_PLAN',
        ...input,
      });
      if (previous) return previous;
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `scb-plan:${input.code}`,
      ]);
      const plan = (
        await c.query<Row>(
          `INSERT INTO billing_plan_versions(id,code,version,name,currency,amount_fen,max_teams,max_matches,valid_days,created_by) SELECT $1,$2,COALESCE(MAX(version),0)+1,$3,$4,$5,$6,$7,$8,$9 FROM billing_plan_versions WHERE code=$2 RETURNING *`,
          [
            randomUUID(),
            input.code,
            input.name,
            input.currency,
            input.amountFen,
            input.maxTeams,
            input.maxMatches,
            input.validDays,
            ctx.actor.user.id,
          ],
        )
      ).rows[0]!;
      await this.audit(
        c,
        ctx.actor.user.id,
        null,
        'commerce.plan.created',
        'billing_plan',
        plan.id,
        { code: plan.code, version: plan.version, reason: input.reason },
      );
      const result = { plan: this.planDto(plan) };
      await this.ensureFreshSession(c, ctx.actor);
      await this.finish(c, ctx.actor, input.commandId, result);
      return result;
    });
  }
  async planCommand(cookie: string | undefined, id: string, raw: unknown) {
    const input = objectInput(raw, [
      'commandId',
      'type',
      'expectedCatalogVersion',
      'available',
      'reason',
    ]);
    if (input.type !== 'SET_AVAILABILITY' || typeof input.available !== 'boolean')
      fail('VALIDATION_ERROR', '套餐操作无效', 422);
    const command = commandId(input.commandId),
      why = reason(input.reason),
      expected = expectedVersion(input.expectedCatalogVersion);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, undefined, true);
      const previous = await this.begin(c, ctx.actor, command, { action: 'PLAN', id, ...input });
      if (previous) return previous;
      const p = (
        await c.query<Row>('SELECT * FROM billing_plan_versions WHERE id=$1 FOR UPDATE', [
          resourceId(id),
        ])
      ).rows[0];
      if (!p) throw notFound();
      version(p.catalog_version, expected);
      const updated = (
        await c.query<Row>(
          'UPDATE billing_plan_versions SET available=$2,catalog_version=catalog_version+1 WHERE id=$1 RETURNING *',
          [id, input.available],
        )
      ).rows[0]!;
      await this.audit(
        c,
        ctx.actor.user.id,
        null,
        'commerce.plan.availability',
        'billing_plan',
        id,
        { available: input.available, reason: why },
      );
      const result = { plan: this.planDto(updated) };
      await this.ensureFreshSession(c, ctx.actor);
      await this.finish(c, ctx.actor, command, result);
      return result;
    });
  }
  async createOrder(cookie: string | undefined, orgId: string, raw: unknown) {
    const v = objectInput(raw, ['commandId', 'eventId', 'planId', 'expectedEventVersion']);
    const input = {
      commandId: commandId(v.commandId),
      eventId: resourceId(typeof v.eventId === 'string' ? v.eventId : ''),
      planId: resourceId(typeof v.planId === 'string' ? v.planId : ''),
      expectedEventVersion: expectedVersion(v.expectedEventVersion),
    };
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, orgId);
      if (ctx.org?.role !== 'ORG_OWNER') throw forbidden();
      if (this.mode !== 'ENFORCED') fail('COMMERCE_DISABLED', '当前未启用收费权益限制', 409);
      const previous = await this.begin(c, ctx.actor, input.commandId, {
        action: 'CREATE_ORDER',
        orgId,
        ...input,
      });
      if (previous) return previous;
      const event = (
        await c.query<Row>('SELECT * FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE', [
          ctx.org.orgId,
          input.eventId,
        ])
      ).rows[0];
      if (!event) throw notFound();
      version(event.version, input.expectedEventVersion);
      if (['CANCELLED', 'COMPLETED', 'ARCHIVED'].includes(event.status))
        fail('INVALID_EVENT_STATE', '已取消或闭赛赛事不能新建软件订单');
      if (
        (
          await c.query('SELECT event_id FROM event_commercial_activations WHERE event_id=$1', [
            event.id,
          ])
        ).rowCount
      )
        fail('EVENT_ALREADY_ACTIVATED', '该届软件服务已激活，无需重复购买');
      const old = (
        await c.query<Row>(
          "SELECT * FROM billing_orders WHERE org_id=$1 AND event_id=$2 AND status IN ('PENDING_PAYMENT','PAID','REFUND_PENDING') FOR UPDATE",
          [orgId, event.id],
        )
      ).rows[0];
      if (old) {
        if (
          old.status === 'PENDING_PAYMENT' &&
          !old.channel &&
          new Date(old.expires_at).getTime() <= Date.now()
        )
          await c.query(
            "UPDATE billing_orders SET status='EXPIRED',version=version+1 WHERE id=$1",
            [old.id],
          );
        else fail('EVENT_ORDER_EXISTS', '该届已有待付款、已付款或退款中订单，请先核对原订单');
      }
      const p = (
        await c.query<Row>(
          'SELECT * FROM billing_plan_versions WHERE id=$1 AND available FOR SHARE',
          [input.planId],
        )
      ).rows[0];
      if (!p) throw notFound();
      const id = randomUUID(),
        quote = makeQuote(p);
      const order = (
        await c.query<Row>(
          "INSERT INTO billing_orders(id,org_id,event_id,plan_id,quote,amount_fen,currency,out_trade_no,created_by,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,'CNY',$7,$8,clock_timestamp()+interval '24 hours') RETURNING *",
          [
            id,
            orgId,
            event.id,
            p.id,
            JSON.stringify(quote),
            p.amount_fen,
            id.replaceAll('-', ''),
            ctx.actor.user.id,
          ],
        )
      ).rows[0]!;
      order.event_name = event.name;
      await this.audit(c, ctx.actor.user.id, orgId, 'commerce.order.created', 'billing_order', id, {
        eventId: event.id,
        quoteHash: quote.hash,
      });
      const result = { order: await this.orderDto(c, order, ctx), nativePayment: null };
      await this.ensureFreshSession(c, ctx.actor);
      await this.finish(c, ctx.actor, input.commandId, result);
      return result;
    });
  }
  private async systemAudit(c: PoolClient, o: Row, action: string, metadata: unknown) {
    const actorId = await createCommerceSystemActor(c, 'LEDGER');
    await c.query(
      "INSERT INTO audit_logs(id,org_id,actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,'billing_order',$5,$6::jsonb)",
      [randomUUID(), o.org_id, actorId, action, o.id, JSON.stringify(metadata)],
    );
  }
  private async bump(c: PoolClient, o: Row, status: string) {
    const r = (
      await c.query<Row>(
        'UPDATE billing_orders SET status=$2,version=version+1 WHERE id=$1 RETURNING *',
        [o.id, status],
      )
    ).rows[0]!;
    return { ...r, event_name: o.event_name };
  }
  private async settle(
    c: PoolClient,
    o: Row,
    channel: 'MANUAL' | 'WECHAT_NATIVE',
    paidAt: string,
    transactionId: string | null,
  ): Promise<Row> {
    if (o.paid_at) {
      if (
        o.channel !== channel ||
        (channel === 'WECHAT_NATIVE' && o.provider_transaction_id !== transactionId)
      )
        fail('PAYMENT_PROOF_MISMATCH', '原订单已有不同支付证明');
      return o;
    }
    if (!['PENDING_PAYMENT', 'EXPIRED'].includes(o.status))
      fail('INVALID_ORDER_STATE', '订单当前不能确认付款');
    if (o.channel && o.channel !== channel)
      fail('PAYMENT_CHANNEL_CONFLICT', '原订单已经进入另一支付渠道，请先核对原交易');
    const updated = (
      await c.query<Row>(
        "UPDATE billing_orders SET status='PAID',channel=$2,paid_at=$3,provider_transaction_id=$4,version=version+1 WHERE id=$1 RETURNING *",
        [o.id, channel, paidAt, transactionId],
      )
    ).rows[0]!;
    await c.query(
      "INSERT INTO event_entitlements(id,org_id,event_id,order_id,max_teams,max_matches,valid_until) VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz+($8::integer*interval '1 day'))",
      [
        randomUUID(),
        o.org_id,
        o.event_id,
        o.id,
        o.quote.maxTeams,
        o.quote.maxMatches,
        paidAt,
        o.quote.validDays,
      ],
    );
    await this.systemAudit(c, o, 'commerce.order.paid', {
      channel,
      amountFen: o.amount_fen,
      quoteHash: o.quote.hash,
    });
    return { ...updated, event_name: o.event_name };
  }
  private async notificationRecord(
    c: PoolClient,
    id: string,
    kind: 'PAYMENT' | 'REFUND',
    o: Row,
    proof: unknown,
  ) {
    const hash = digest(proof);
    const old = (
      await c.query<Row>('SELECT * FROM payment_notifications WHERE notification_id=$1', [id])
    ).rows[0];
    if (old) {
      if (old.order_id !== o.id || old.kind !== kind || old.proof_hash !== hash)
        fail('PAYMENT_NOTIFICATION_CONFLICT', '重复通知业务内容不一致');
      return;
    }
    await c.query(
      'INSERT INTO payment_notifications(notification_id,kind,order_id,proof_hash) VALUES($1,$2,$3,$4)',
      [id, kind, o.id, hash],
    );
  }
  private async applyPayment(c: PoolClient, o: Row, p: WechatPayOrder, id: string): Promise<Row> {
    checkPayment(o, p);
    if (o.paid_at && p.successTime && iso(o.paid_at) !== iso(p.successTime))
      fail('PAYMENT_PROOF_MISMATCH', '支付时间与原有效证明不一致');
    if (p.state !== 'SUCCESS') return o;
    if (o.channel !== 'WECHAT_NATIVE') fail('PAYMENT_CHANNEL_CONFLICT', '订单未通过微信渠道发起');
    await this.notificationRecord(c, id, 'PAYMENT', o, p);
    return this.settle(c, o, 'WECHAT_NATIVE', p.successTime!, p.transactionId);
  }
  private async requestRefund(c: PoolClient, o: Row, ctx: Context, why: string): Promise<Row> {
    if (o.status !== 'PAID') fail('INVALID_ORDER_STATE', '仅已付款且未退款订单可申请全额退款');
    const { refund, activated } = await this.latest(c, o);
    if (activated) fail('EVENT_ALREADY_ACTIVATED', '已激活赛事不自动退款，请联系平台处理履约争议');
    if (refund) fail('REFUND_ALREADY_EXISTS', '原订单已有退款记录，请核对原退款');
    const id = randomUUID();
    await c.query(
      "INSERT INTO billing_refunds(id,order_id,amount_fen,currency,out_refund_no,requested_by,reason) VALUES($1,$2,$3,'CNY',$4,$5,$6)",
      [id, o.id, o.amount_fen, id.replaceAll('-', ''), ctx.actor.user.id, why],
    );
    await this.audit(
      c,
      ctx.actor.user.id,
      o.org_id,
      'commerce.refund.requested',
      'billing_order',
      o.id,
      { refundId: id, reason: why },
    );
    return this.bump(c, o, 'REFUND_PENDING');
  }
  private async result(
    c: PoolClient,
    o: Row,
    ctx: Context,
    nativePayment: CommerceCommandResult['nativePayment'] = null,
    notice?: string,
  ): Promise<CommerceCommandResult> {
    return { order: await this.orderDto(c, o, ctx), nativePayment, ...(notice ? { notice } : {}) };
  }
  async buyerCommand(
    cookie: string | undefined,
    orgId: string,
    id: string,
    raw: unknown,
  ): Promise<CommerceCommandResult> {
    const input = parseBuyerCommand(raw);
    const prepared = await this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, orgId);
      if (ctx.org?.role !== 'ORG_OWNER') throw forbidden();
      const previous = await this.begin(c, ctx.actor, input.commandId, {
        action: 'BUYER_ORDER',
        orgId,
        id,
        ...input,
      });
      if (previous) return { result: previous as unknown as CommerceCommandResult };
      let o = await this.order(c, id, ctx);
      version(o.version, input.expectedOrderVersion);
      const state = await this.latest(c, o);
      if (input.type === 'CANCEL') {
        if (
          o.status !== 'PENDING_PAYMENT' ||
          o.channel ||
          state.review?.status === 'PENDING_REVIEW'
        )
          fail('INVALID_ORDER_STATE', '该订单已发起支付或正在核验，请先核对原交易');
        o = await this.bump(c, o, 'CANCELLED');
        await this.audit(
          c,
          ctx.actor.user.id,
          orgId,
          'commerce.order.cancelled',
          'billing_order',
          id,
          { reason: input.reason },
        );
      } else if (input.type === 'REQUEST_REFUND') {
        if (state.activated) {
          await this.audit(
            c,
            ctx.actor.user.id,
            orgId,
            'commerce.refund.dispute_recorded',
            'billing_order',
            id,
            { reason: input.reason },
          );
          const result = await this.result(
            c,
            o,
            ctx,
            null,
            '履约争议已记录；该届服务已激活，不自动退款或中断比赛，请联系平台。',
          );
          await this.finish(c, ctx.actor, input.commandId, result);
          return { result };
        }
        o = await this.requestRefund(c, o, ctx, input.reason!);
      } else {
        if (!this.payments.enabled)
          fail('PAYMENT_PROVIDER_DISABLED', '微信支付未配置，当前不能发起或查询真实支付', 503);
        if (input.type === 'CREATE_NATIVE') {
          if (
            this.mode !== 'ENFORCED' ||
            o.status !== 'PENDING_PAYMENT' ||
            state.activated ||
            state.review?.status === 'PENDING_REVIEW' ||
            o.channel === 'MANUAL' ||
            new Date(o.expires_at).getTime() <= Date.now()
          )
            fail('INVALID_ORDER_STATE', '订单当前不能发起微信支付');
          if (o.native_code_url) {
            const result = await this.result(c, o, ctx, { codeUrl: o.native_code_url });
            await this.finish(c, ctx.actor, input.commandId, result);
            return { result };
          }
          o = {
            ...(
              await c.query<Row>(
                "UPDATE billing_orders SET channel='WECHAT_NATIVE',provider_started_at=COALESCE(provider_started_at,clock_timestamp()),version=version+1 WHERE id=$1 RETURNING *",
                [id],
              )
            ).rows[0]!,
            event_name: o.event_name,
          };
        } else if (o.channel !== 'WECHAT_NATIVE')
          fail('INVALID_ORDER_STATE', '该订单没有微信交易可查询');
        await this.audit(
          c,
          ctx.actor.user.id,
          orgId,
          `commerce.payment.${input.type.toLowerCase()}`,
          'billing_order',
          id,
          {},
        );
        await this.ensureFreshSession(c, ctx.actor);
        return { network: input.type, o, ctx };
      }
      const result = await this.result(c, o, ctx);
      await this.ensureFreshSession(c, ctx.actor);
      await this.finish(c, ctx.actor, input.commandId, result);
      return { result };
    });
    if (prepared.result) return prepared.result;
    const { o, ctx, network } = prepared;
    if (!o || !ctx || !network) fail('COMMERCE_OPERATION_PENDING', '订单操作待核对');
    // Gateway calls run after the dispatch claim is committed and without database locks.
    const native =
      network === 'CREATE_NATIVE'
        ? await this.payments.native({
            outTradeNo: o.out_trade_no,
            description: `小城市篮球·${o.quote.name}`,
            totalFen: o.amount_fen,
            currency: 'CNY',
            expiresAt: iso(o.expires_at),
          })
        : null;
    const payment =
      network === 'QUERY_PAYMENT' ? await this.payments.queryOrder(o.out_trade_no) : null;
    await this.transaction(async (c) => {
      let current = await this.order(c, id, null);
      if (native) {
        if (current.native_code_url && current.native_code_url !== native.codeUrl)
          fail('PAYMENT_PROOF_MISMATCH', '原支付链接已变化，请核对原订单');
        current = {
          ...(
            await c.query<Row>(
              'UPDATE billing_orders SET native_code_url=$2,version=version+1 WHERE id=$1 RETURNING *',
              [id, native.codeUrl],
            )
          ).rows[0]!,
          event_name: current.event_name,
        };
      }
      if (payment) {
        current = await this.applyPayment(
          c,
          current,
          payment,
          `query-payment:${payment.transactionId ?? current.out_trade_no}`,
        );
        if (['CLOSED', 'REVOKED', 'PAYERROR'].includes(payment.state) && !current.paid_at)
          current = await this.bump(c, current, 'EXPIRED');
      }
      await this.finish(c, ctx.actor, input.commandId, await this.result(c, current, ctx, native));
    });
    return this.transaction(async (c) => {
      const fresh = await this.context(c, cookie, orgId);
      const current = await this.order(c, id, fresh, false);
      await this.ensureFreshSession(c, fresh.actor);
      return this.result(c, current, fresh, native);
    });
  }
  async platformCommand(
    cookie: string | undefined,
    id: string,
    raw: unknown,
  ): Promise<CommerceCommandResult> {
    const input = parsePlatformCommand(raw);
    const prepared = await this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, undefined, true);
      const previous = await this.begin(c, ctx.actor, input.commandId, {
        action: 'PLATFORM_ORDER',
        id,
        ...input,
      });
      if (previous) return { result: previous as unknown as CommerceCommandResult };
      let o = await this.order(c, id, ctx);
      version(o.version, input.expectedOrderVersion);
      let { review, refund, activated } = await this.latest(c, o);
      if (input.type === 'SUBMIT_PAYMENT') {
        if (
          o.status !== 'PENDING_PAYMENT' ||
          o.channel ||
          review?.status === 'PENDING_REVIEW' ||
          new Date(o.expires_at).getTime() <= Date.now()
        )
          fail('INVALID_ORDER_STATE', '原订单不能再次提交人工收款核验');
        await c.query(
          'INSERT INTO billing_payment_reviews(id,order_id,submitted_by,external_reference,reason) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), o.id, ctx.actor.user.id, reference(input.externalReference), input.reason],
        );
        o = await this.bump(c, o, o.status);
      } else if (['CONFIRM_PAYMENT', 'REJECT_PAYMENT'].includes(input.type)) {
        if (
          !review ||
          review.status !== 'PENDING_REVIEW' ||
          !(await this.independent(c, ctx, o, review.submitted_by))
        )
          throw forbidden();
        // A replacement quote may have expired this original order while its
        // manual receipt is still under review. Independent rejection must be
        // able to resolve that claim without reopening or settling the order.
        if (
          o.channel ||
          (o.status !== 'PENDING_PAYMENT' &&
            !(input.type === 'REJECT_PAYMENT' && o.status === 'EXPIRED'))
        )
          fail('INVALID_ORDER_STATE', '原订单不能人工确认付款');
        if (input.type === 'CONFIRM_PAYMENT' && new Date(o.expires_at).getTime() <= Date.now())
          fail('ORDER_EXPIRED', '原订单报价已过期，请核对收款及重新报价');
        await c.query(
          'UPDATE billing_payment_reviews SET status=$2,reviewed_by=$3,review_reason=$4,reviewed_at=clock_timestamp() WHERE id=$1',
          [
            review.id,
            input.type === 'CONFIRM_PAYMENT' ? 'CONFIRMED' : 'REJECTED',
            ctx.actor.user.id,
            input.reason,
          ],
        );
        if (input.type === 'CONFIRM_PAYMENT') {
          const now = (
            await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')
          ).rows[0]!.now.toISOString();
          o = await this.settle(c, o, 'MANUAL', now, null);
        } else o = await this.bump(c, o, o.status);
      } else if (input.type === 'SUBMIT_REFUND') {
        if (activated) {
          await this.audit(
            c,
            ctx.actor.user.id,
            o.org_id,
            'commerce.refund.dispute_recorded',
            'billing_order',
            id,
            { reason: input.reason },
          );
          const result = await this.result(
            c,
            o,
            ctx,
            null,
            '履约争议已记录；已激活赛事不自动退款或中断比赛。',
          );
          await this.finish(c, ctx.actor, input.commandId, result);
          return { result };
        }
        if (!refund) {
          o = await this.requestRefund(c, o, ctx, input.reason);
          refund = (await this.latest(c, o)).refund;
        }
        if (!refund || refund.status !== 'REQUESTED')
          fail('INVALID_REFUND_STATE', '原退款当前不能提交复核');
        await c.query(
          "UPDATE billing_refunds SET status='PENDING_REVIEW',submitted_by=$2,external_reference=$3,review_reason=$4 WHERE id=$1",
          [
            refund.id,
            ctx.actor.user.id,
            o.channel === 'MANUAL' ? reference(input.externalReference) : null,
            input.reason,
          ],
        );
        o = await this.bump(c, o, 'REFUND_PENDING');
      } else if (['CONFIRM_REFUND', 'REJECT_REFUND'].includes(input.type)) {
        if (
          !refund ||
          refund.status !== 'PENDING_REVIEW' ||
          !(await this.independent(c, ctx, o, refund.submitted_by))
        )
          throw forbidden();
        if (activated) fail('EVENT_ALREADY_ACTIVATED', '已激活赛事不自动退款');
        if (input.type === 'REJECT_REFUND') {
          await c.query(
            "UPDATE billing_refunds SET status='REJECTED',reviewed_by=$2,review_reason=$3,completed_at=clock_timestamp() WHERE id=$1",
            [refund.id, ctx.actor.user.id, input.reason],
          );
          o = await this.bump(c, o, 'PAID');
        } else if (o.channel === 'MANUAL') {
          await c.query(
            "UPDATE billing_refunds SET status='SUCCEEDED',reviewed_by=$2,review_reason=$3,completed_at=clock_timestamp(),accepted_at=clock_timestamp() WHERE id=$1",
            [refund.id, ctx.actor.user.id, input.reason],
          );
          o = await this.refundSettled(c, o, input.reason);
        } else {
          if (!this.payments.enabled)
            fail('PAYMENT_PROVIDER_DISABLED', '微信退款未配置，不会发出真实资金请求', 503);
          await c.query(
            "UPDATE billing_refunds SET status='PROCESSING',reviewed_by=$2,review_reason=$3 WHERE id=$1",
            [refund.id, ctx.actor.user.id, input.reason],
          );
          o = await this.bump(c, o, 'REFUND_PENDING');
          await this.audit(
            c,
            ctx.actor.user.id,
            o.org_id,
            'commerce.refund.approved',
            'billing_order',
            id,
            { refundId: refund.id, reason: input.reason },
          );
          await this.ensureFreshSession(c, ctx.actor);
          return { network: 'REFUND' as const, o, ctx, refund };
        }
      } else if (input.type === 'QUERY_REFUND') {
        if (
          !refund ||
          !(
            ['PROCESSING', 'UNKNOWN', 'FAILED'].includes(refund.status) ||
            (refund.status === 'SUCCEEDED' && !refund.accepted_at)
          ) ||
          o.channel !== 'WECHAT_NATIVE'
        )
          fail('INVALID_REFUND_STATE', '没有待查询的微信退款');
        if (!this.payments.enabled) fail('PAYMENT_PROVIDER_DISABLED', '微信退款未配置', 503);
        await this.ensureFreshSession(c, ctx.actor);
        return { network: 'QUERY_REFUND' as const, o, ctx, refund };
      }
      await this.audit(
        c,
        ctx.actor.user.id,
        o.org_id,
        `commerce.${input.type.toLowerCase()}`,
        'billing_order',
        id,
        { reason: input.reason },
      );
      const result = await this.result(c, o, ctx);
      await this.ensureFreshSession(c, ctx.actor);
      await this.finish(c, ctx.actor, input.commandId, result);
      return { result };
    });
    if (prepared.result) return prepared.result;
    const { o, ctx, network, refund } = prepared;
    if (!o || !ctx || !network || !refund) fail('COMMERCE_OPERATION_PENDING', '退款操作待核对');
    let proof: WechatPayRefund;
    try {
      if (network === 'REFUND') {
        const payment = await this.payments.queryOrder(o.out_trade_no);
        checkPayment(o, payment);
        if (payment.state !== 'SUCCESS' || payment.transactionId !== o.provider_transaction_id)
          fail('REFUND_SOURCE_INVALID', '原微信交易状态已变化，未发起新的资金退回，请核对原交易');
      }
      proof =
        network === 'REFUND'
          ? await this.payments.refund({
              outTradeNo: o.out_trade_no,
              outRefundNo: refund.out_refund_no,
              totalFen: o.amount_fen,
              refundFen: refund.amount_fen,
              currency: 'CNY',
              reason: '赛事软件服务未激活，全额退款',
            })
          : await this.payments.queryRefund(refund.out_refund_no);
    } catch (error) {
      await this.transaction(async (c) => {
        await this.order(c, id, null);
        await c.query(
          "UPDATE billing_refunds SET status='UNKNOWN' WHERE id=$1 AND status='PROCESSING'",
          [refund.id],
        );
      });
      throw error;
    }
    await this.transaction(async (c) => {
      const current = await this.order(c, id, null);
      const updated = await this.applyRefund(
        c,
        current,
        proof,
        `query-refund:${proof.refundId}:${proof.state}`,
      );
      await this.finish(c, ctx.actor, input.commandId, await this.result(c, updated, ctx));
    });
    return this.transaction(async (c) => {
      const fresh = await this.context(c, cookie, undefined, true);
      const current = await this.order(c, id, fresh, false);
      await this.ensureFreshSession(c, fresh.actor);
      return this.result(c, current, fresh);
    });
  }
  private async refundSettled(c: PoolClient, o: Row, why: string): Promise<Row> {
    if (o.status === 'REFUNDED') return o;
    await c.query(
      'UPDATE event_entitlements SET revoked_at=clock_timestamp(),revoke_reason=$2 WHERE order_id=$1 AND revoked_at IS NULL',
      [o.id, why],
    );
    const updated = await this.bump(c, o, 'REFUNDED');
    await this.systemAudit(c, o, 'commerce.order.refunded', {
      amountFen: o.amount_fen,
      reason: why,
    });
    return updated;
  }
  private async applyRefund(c: PoolClient, o: Row, p: WechatPayRefund, id: string): Promise<Row> {
    const f = (
      await c.query<Row>('SELECT * FROM billing_refunds WHERE order_id=$1 FOR UPDATE', [o.id])
    ).rows[0];
    if (
      !f ||
      !f.reviewed_by ||
      !f.submitted_by ||
      f.reviewed_by === f.submitted_by ||
      p.outTradeNo !== o.out_trade_no ||
      p.outRefundNo !== f.out_refund_no ||
      p.transactionId !== o.provider_transaction_id ||
      p.totalFen !== o.amount_fen ||
      p.refundFen !== f.amount_fen ||
      p.currency !== 'CNY'
    )
      fail('REFUND_PROOF_MISMATCH', '退款证明与原支付及批准金额不一致');
    if (f.provider_refund_id && f.provider_refund_id !== p.refundId)
      fail('REFUND_PROOF_MISMATCH', '退款平台编号与原有效证明不一致');
    if (f.status === 'REJECTED') fail('INVALID_REFUND_STATE', '原退款未获批准');
    await this.notificationRecord(c, id, 'REFUND', o, p);
    const acceptedAt = p.createdTime;
    if (acceptedAt && f.accepted_at && iso(f.accepted_at) !== iso(acceptedAt))
      fail('REFUND_PROOF_MISMATCH', '退款受理时间与原证明不一致');
    if (acceptedAt && !f.accepted_at)
      await c.query('UPDATE billing_refunds SET accepted_at=$2 WHERE id=$1', [f.id, acceptedAt]);
    if (f.status === 'SUCCEEDED') return o;
    const status =
      p.state === 'SUCCESS' ? 'SUCCEEDED' : p.state === 'PROCESSING' ? 'PROCESSING' : 'FAILED';
    await c.query(
      'UPDATE billing_refunds SET status=$2,provider_refund_id=$3,completed_at=$4 WHERE id=$1',
      [f.id, status, p.refundId, p.state === 'SUCCESS' ? p.successTime : null],
    );
    if (status === 'SUCCEEDED') return this.refundSettled(c, o, '微信支付全额退款已验签确认');
    return o;
  }
  async notification(
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    if (!rawBody || rawBody.length > 102400)
      fail('PAYMENT_RAW_BODY_REQUIRED', '支付通知原始报文无效', 400);
    const notification: WechatPayNotification = this.payments.verifyNotification(rawBody, headers);
    await this.transaction(async (c) => {
      const trade =
        notification.kind === 'PAYMENT'
          ? notification.payment.outTradeNo
          : notification.refund.outTradeNo;
      const ref = (
        await c.query<{ id: string }>('SELECT id FROM billing_orders WHERE out_trade_no=$1', [
          trade,
        ])
      ).rows[0];
      if (!ref) throw notFound();
      const o = await this.order(c, ref.id, null);
      if (notification.kind === 'PAYMENT')
        await this.applyPayment(c, o, notification.payment, notification.id);
      else await this.applyRefund(c, o, notification.refund, notification.id);
    });
  }
  private reconciliationDto(r: Row): CommerceReconciliationData {
    return {
      id: r.id,
      billDate:
        typeof r.bill_date === 'string' ? r.bill_date : r.bill_date.toISOString().slice(0, 10),
      source: r.source,
      hash: r.body_hash,
      matchedCount: r.matched_count,
      issues: r.issues,
      createdAt: iso(r.created_at),
    };
  }
  async reconcile(
    cookie: string | undefined,
    raw: unknown,
  ): Promise<{ reconciliation: CommerceReconciliationData }> {
    const v = objectInput(raw, ['commandId', 'billDate', 'source', 'csv', 'reason']);
    const command = commandId(v.commandId),
      date = calendarDate(v.billDate, 'billDate'),
      why = reason(v.reason);
    if (!['MANUAL', 'WECHAT_NATIVE'].includes(v.source as string))
      fail('VALIDATION_ERROR', '对账来源无效', 422);
    const manual = v.source === 'MANUAL' ? parseManualBill(v.csv) : null;
    if (v.source === 'WECHAT_NATIVE' && v.csv !== undefined)
      fail('VALIDATION_ERROR', '微信对账不能传入替代账单', 422);
    const claim = await this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, undefined, true);
      const previous = await this.begin(c, ctx.actor, command, { action: 'RECONCILE', ...v });
      await this.ensureFreshSession(c, ctx.actor);
      return { ctx, previous };
    });
    if (claim.previous) return claim.previous as { reconciliation: CommerceReconciliationData };
    const bill = v.source === 'WECHAT_NATIVE' ? await this.payments.downloadBill(date) : null;
    return this.transaction(async (c) => {
      // Re-check live operator authorization after remote download; no implicit financial repair.
      const ctx = await this.context(c, cookie, undefined, true);
      const rows = (
        await c.query<Row>(
          `SELECT o.id,o.out_trade_no,o.provider_transaction_id,o.amount_fen,o.channel,o.status,
        to_char(o.paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS paid_day,
        r.external_reference AS payment_reference,f.out_refund_no,f.provider_refund_id,f.amount_fen AS refund_amount,f.status AS refund_status,f.external_reference AS refund_reference,
        to_char(f.completed_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS refund_day,
        to_char(f.accepted_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS accepted_day
        FROM billing_orders o LEFT JOIN billing_payment_reviews r ON r.order_id=o.id AND r.status='CONFIRMED'
        LEFT JOIN billing_refunds f ON f.order_id=o.id
        WHERE to_char(o.paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')=$1 OR to_char(f.completed_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')=$1 OR to_char(f.accepted_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')=$1
        ORDER BY o.id LIMIT 1001`,
          [date],
        )
      ).rows;
      if (rows.length > 1000) fail('RECONCILIATION_TOO_LARGE', '该日账单数量超过当前核验上限', 422);
      const issues: CommerceReconciliationData['issues'] = [];
      let matched = 0;
      if (manual) {
        const expected: import('./domain.js').ManualBillRow[] = [];
        for (const o of rows.filter((o) => o.channel === 'MANUAL')) {
          if (o.paid_day === date && o.payment_reference)
            expected.push({
              orderId: o.id,
              transactionReference: o.payment_reference,
              amountFen: o.amount_fen,
              currency: 'CNY',
              status: 'PAID',
            });
          if (o.refund_day === date && o.refund_status === 'SUCCEEDED' && o.refund_reference)
            expected.push({
              orderId: o.id,
              transactionReference: o.refund_reference,
              amountFen: o.refund_amount,
              currency: 'CNY',
              status: 'REFUNDED',
            });
        }
        const key = (r: import('./domain.js').ManualBillRow) => `${r.orderId}|${r.status}`;
        const actual = new Map(manual.map((r) => [key(r), r]));
        const local = new Map(expected.map((r) => [key(r), r]));
        for (const [id, r] of actual) {
          const e = local.get(id);
          if (e && e.amountFen === r.amountFen && e.transactionReference === r.transactionReference)
            matched++;
          else
            issues.push({
              orderId: e?.orderId ?? null,
              code: e ? 'BILL_MISMATCH' : 'PROVIDER_ONLY',
              description: '指定账单日的线下交易身份、金额、状态或日期不一致',
            });
        }
        for (const [id, r] of local)
          if (!actual.has(id))
            issues.push({
              orderId: r.orderId,
              code: 'LOCAL_ONLY',
              description: '本地该日已核验交易未出现在提交账单中',
            });
      }
      if (bill) {
        const expected: WechatPayBillRow[] = [];
        for (const o of rows.filter((o) => o.channel === 'WECHAT_NATIVE')) {
          const common = {
            outTradeNo: o.out_trade_no,
            transactionId: o.provider_transaction_id,
            totalFen: o.amount_fen,
          };
          if (o.paid_day === date)
            expected.push({
              ...common,
              tradeState: 'SUCCESS',
              outRefundNo: null,
              refundId: null,
              refundFen: null,
              refundState: null,
            });
          if (o.accepted_day === date && o.provider_refund_id)
            expected.push({
              ...common,
              tradeState: 'REFUND',
              totalFen: null,
              outRefundNo: o.out_refund_no,
              refundId: o.provider_refund_id,
              refundFen: o.refund_amount,
              refundState: null,
            });
        }
        const compared = reconcileWechatPayBill(bill.rows, expected);
        matched = compared.matchedCount;
        issues.push(
          ...compared.issues.map((issue) => ({
            orderId: rows.find((o) => o.out_trade_no === issue.outTradeNo)?.id ?? null,
            code: issue.code,
            description: '指定账单日的微信交易/退款身份、原金额、退款金额或状态不一致',
          })),
        );
      }
      if (issues.length > 1000) fail('RECONCILIATION_TOO_LARGE', '对账差异过多，请分批核验', 422);
      const record = (
        await c.query<Row>(
          'INSERT INTO billing_reconciliations(id,bill_date,source,body_hash,matched_count,issues,created_by,reason) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *,bill_date::text AS bill_date',
          [
            randomUUID(),
            date,
            v.source,
            bill?.bodyHash ??
              createHash('sha256')
                .update(v.csv as string, 'utf8')
                .digest('hex'),
            matched,
            JSON.stringify(issues),
            ctx.actor.user.id,
            why,
          ],
        )
      ).rows[0]!;
      await this.audit(
        c,
        ctx.actor.user.id,
        null,
        'commerce.reconciliation.recorded',
        'billing_reconciliation',
        record.id,
        { reason: why, matchedCount: matched, issueCount: issues.length },
      );
      const result = { reconciliation: this.reconciliationDto(record) };
      await this.ensureFreshSession(c, ctx.actor);
      await this.finish(c, ctx.actor, command, result);
      return result;
    });
  }
}
