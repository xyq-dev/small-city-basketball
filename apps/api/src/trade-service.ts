import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  TradeSourceKind,
  TradeOrderData,
  TradeQuote,
  TradeCheckout,
} from '../../../packages/contracts/trade.js';
import type { Actor, ApiOptions } from './service.js';
import { ApplicationService, isAdministrator } from './service.js';
import { forbidden, notFound } from './errors.js';
import { objectInput, text, calendarDate } from './validation.js';
import {
  tradeFail,
  tradeId,
  tradeVersion,
  tradeFen,
  tradeReason,
  tradeHash,
  assertTradeVersion,
  tradeBalances,
  tradeSeal,
  tradeOpen,
} from './trade-domain.js';
import type { TradeRuntime, TradeMerchant } from './trade-provider.js';
import type {
  WechatPayOrder,
  WechatPayRefund,
  WechatPayNotification,
  WechatPayBillRow,
} from './commerce/wechatpay.js';
import { quote as playerQuote } from './player-booking/domain.js';
import { reconcileWechatPayBill } from './commerce/wechatpay.js';
type Row = Record<string, any>;
type Source = {
  orgId: string;
  payerId: string | null;
  beneficiaryId: string;
  beneficiaryName: string;
  title: string;
  version: number;
  totalFen: number;
  platformFeeFen: number;
  termsId: string | null;
  consentId?: string;
  terms: string;
  merchantKey: string | null;
  payable: boolean;
  fulfilled: boolean;
  disputed: boolean;
  valid: boolean;
  expiresAt: string | null;
  identity: Row;
};
const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());
const no = (prefix: string) => prefix + randomBytes(15).toString('hex');
export class TradeService extends ApplicationService {
  readonly runtime: TradeRuntime;
  constructor(pool: Pool, options: ApiOptions, runtime: TradeRuntime = {}) {
    super(pool, options);
    this.runtime = runtime;
    const keys = new Map<string, string>(),
      identities = new Map<string, string>();
    for (const [org, m] of [
      ...Object.entries(runtime.merchants ?? {}),
      ...Object.entries(runtime.historicalMerchants ?? {}).map(
        ([k, m]) => [k.split(':')[0]!, m] as [string, TradeMerchant],
      ),
    ]) {
      if (
        !m.key ||
        !m.merchantId ||
        !m.appId ||
        (keys.has(m.key) && keys.get(m.key) !== org) ||
        (identities.has(m.merchantId) && identities.get(m.merchantId) !== org)
      )
        throw Error('Trade merchant identity must map to exactly one organization');
      keys.set(m.key, org);
      identities.set(m.merchantId, org);
    }
    if (runtime.encryptionKey && runtime.encryptionKey.length !== 32)
      throw Error('Trade checkout encryption key invalid');
  }
  private async manager(c: PoolClient, a: Actor, org: string) {
    const membership = (
      await c.query<Row>(
        "SELECT role FROM organization_memberships WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE",
        [org, a.user.id],
      )
    ).rows[0];
    return !!membership && isAdministrator(membership.role);
  }
  private async operator(c: PoolClient, a: Actor) {
    return !!(
      await c.query(
        "SELECT p.user_id FROM platform_operators p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND p.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF u",
        [a.user.id],
      )
    ).rowCount;
  }
  private merchant(org: string, pin?: Row): TradeMerchant | undefined {
    const current = this.runtime.merchants?.[org];
    const m =
      pin && current?.key !== pin.merchant_key
        ? this.runtime.historicalMerchants?.[org + ':' + pin.merchant_key]
        : current;
    if (!m) return undefined;
    if (
      pin &&
      (m.key !== pin.merchant_key ||
        m.merchantId !== pin.merchant_id ||
        m.appId !== pin.merchant_app_id)
    )
      return undefined;
    return m;
  }
  private async calendar(c: PoolClient, org: string) {
    await c.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [org]);
    await c.query('INSERT INTO org_schedule_mutex(org_id) VALUES($1) ON CONFLICT DO NOTHING', [
      org,
    ]);
    await c.query('SELECT org_id FROM org_schedule_mutex WHERE org_id=$1 FOR UPDATE', [org]);
    await c.query('SELECT x12_calendar_lock()');
  }
  private async teamGrant(c: PoolClient, a: Actor, org: string, team: string) {
    return !!(
      await c.query(
        "SELECT user_id FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
        [org, team, a.user.id],
      )
    ).rowCount;
  }
  private async source(
    c: PoolClient,
    kind: TradeSourceKind,
    id: string,
    pinnedTerms?: string | null,
  ): Promise<Source> {
    let ref: Row | undefined;
    if (kind === 'LOCAL_BOOKING')
      ref = (await c.query<Row>('SELECT org_id FROM local_bookings WHERE id=$1', [id])).rows[0];
    else if (kind === 'PLAYER_APPEARANCE')
      ref = (
        await c.query<Row>(
          'SELECT o.org_id FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id WHERE a.id=$1',
          [id],
        )
      ).rows[0];
    else
      ref = (await c.query<Row>('SELECT org_id,event_id,team_id FROM entries WHERE id=$1', [id]))
        .rows[0];
    if (!ref) throw notFound();
    await this.calendar(c, ref.org_id);
    const org = (await c.query<Row>('SELECT status FROM organizations WHERE id=$1', [ref.org_id]))
      .rows[0];
    let row: Row,
      term: Row | undefined,
      totalFen = 0,
      platformFeeFen = 0,
      payer: string | null = null,
      beneficiary: string,
      title: string,
      fulfilled = false,
      payable = false,
      valid = false,
      disputed = false,
      expiresAt: string | null = null,
      identity: Row;
    if (kind === 'LOCAL_BOOKING') {
      row = (
        await c.query<Row>(
          'SELECT b.*,l.title,u.display_name AS beneficiary_name,clock_timestamp() AS db_now FROM local_bookings b JOIN local_listings l ON l.id=b.listing_id JOIN users u ON u.id=b.provider_user_id WHERE b.id=$1 FOR SHARE OF b',
          [id],
        )
      ).rows[0]!;
      payer = row.buyer_user_id;
      beneficiary = row.provider_user_id;
      title = row.snapshot.title;
      fulfilled = row.status === 'COMPLETED';
      disputed = row.status === 'DISPUTED' || !!row.change_request;
      const held = row.status === 'HELD' && new Date(row.hold_expires_at) > new Date(row.db_now);
      valid =
        held || ['CONFIRMED', 'ARRIVED', 'DELIVERED', 'COMPLETED', 'DISPUTED'].includes(row.status);
      payable =
        (held || ['CONFIRMED', 'ARRIVED', 'DELIVERED', 'COMPLETED'].includes(row.status)) &&
        !disputed;
      expiresAt = held ? iso(row.hold_expires_at) : null;
      term = (
        await c.query<Row>(
          "SELECT * FROM trade_terms WHERE org_id=$1 AND kind=$2 AND source_id=$3 AND (($4::uuid IS NULL AND status='ACTIVE') OR id=$4::uuid) FOR SHARE",
          [ref.org_id, kind, row.listing_id, pinnedTerms ?? null],
        )
      ).rows[0];
      identity = {
        orgId: ref.org_id,
        kind,
        id,
        payer,
        beneficiary,
        listingId: row.listing_id,
        slotId: row.slot_id,
        startsAt: iso(row.starts_at),
        endsAt: iso(row.ends_at),
        address: row.snapshot.address,
      };
    } else if (kind === 'PLAYER_APPEARANCE') {
      const pre = (
        await c.query<Row>(
          'SELECT o.id AS order_id,o.team_id,o.event_id FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id WHERE a.id=$1',
          [id],
        )
      ).rows[0]!;
      if (pre.event_id)
        await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
          ref.org_id,
          pre.event_id,
        ]);
      await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
        ref.org_id,
        pre.team_id,
      ]);
      await c.query('SELECT id FROM booking_orders WHERE id=$1 FOR SHARE', [pre.order_id]);
      row = (
        await c.query<Row>(
          'SELECT a.*,o.buyer_user_id,o.status AS order_status,o.settings_version,p.version AS profile_version,u.display_name AS beneficiary_name FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id JOIN booking_profiles p ON p.id=a.profile_id JOIN users u ON u.id=a.player_user_id WHERE a.id=$1 FOR SHARE OF a',
          [id],
        )
      ).rows[0]!;
      payer = row.buyer_user_id;
      beneficiary = row.player_user_id;
      title = row.label;
      totalFen = row.total_fen;
      platformFeeFen = row.platform_fee_fen;
      fulfilled = row.status === 'COMPLETED';
      disputed = row.status === 'DISPUTED' || !!row.change_request;
      valid =
        ['ACCEPTED', 'ARRIVED', 'COMPLETED', 'DISPUTED'].includes(row.status) &&
        row.order_status !== 'CANCELLED';
      payable = valid && !disputed;
      identity = {
        orgId: ref.org_id,
        kind,
        id,
        payer,
        beneficiary,
        orderId: row.order_id,
        reportAt: iso(row.report_at),
        startAt: iso(row.start_at),
        endAt: iso(row.end_at),
        venue: row.venue,
        totalFen,
        platformFeeFen,
        serviceFen: row.service_fen,
        travelFen: row.travel_fen,
        accommodationFen: row.accommodation_fen,
      };
    } else {
      const event = (
        await c.query<Row>(
          'SELECT id,name,status FROM events WHERE id=$1 AND org_id=$2 FOR SHARE',
          [ref.event_id, ref.org_id],
        )
      ).rows[0]!;
      await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
        ref.org_id,
        ref.team_id,
      ]);
      row = (
        await c.query<Row>(
          "SELECT e.*,u.user_id AS beneficiary_id,p.display_name AS beneficiary_name FROM entries e JOIN organization_memberships u ON u.org_id=e.org_id AND u.role='ORG_OWNER' AND u.status='ACTIVE' JOIN users p ON p.id=u.user_id WHERE e.id=$1 FOR SHARE OF e",
          [id],
        )
      ).rows[0]!;
      if (!row) throw notFound();
      beneficiary = row.beneficiary_id;
      title = event.name + (kind === 'ENTRY_DEPOSIT' ? ' 保证金' : ' 报名费');
      fulfilled = ['COMPLETED', 'ARCHIVED'].includes(event.status);
      valid = !['WITHDRAWN', 'REJECTED'].includes(row.status) && event.status !== 'CANCELLED';
      payable =
        valid &&
        !fulfilled &&
        ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'SCHEDULED', 'RUNNING'].includes(event.status);
      term = (
        await c.query<Row>(
          "SELECT * FROM trade_terms WHERE org_id=$1 AND kind=$2 AND source_id=$3 AND (($4::uuid IS NULL AND status='ACTIVE') OR id=$4::uuid) FOR SHARE",
          [ref.org_id, kind, ref.event_id, pinnedTerms ?? null],
        )
      ).rows[0];
      identity = {
        orgId: ref.org_id,
        kind,
        id,
        payer: null,
        beneficiary,
        eventId: ref.event_id,
        teamId: ref.team_id,
      };
    }
    if (kind !== 'PLAYER_APPEARANCE') {
      if (!term) tradeFail('TRADE_TERMS_UNAVAILABLE', '收款条款尚未独立发布', 422);
      totalFen = term!.amount_fen;
      if (term!.status !== 'ACTIVE') payable = false;
    }
    if (!Number.isSafeInteger(totalFen) || totalFen < 1)
      tradeFail('TRADE_SOURCE_INVALID', '来源报价无法核验');
    const m = this.merchant(ref.org_id);
    identity = { ...identity, totalFen, platformFeeFen, termsId: term?.id ?? null };
    return {
      orgId: ref.org_id,
      payerId: payer,
      beneficiaryId: beneficiary,
      beneficiaryName: row!.beneficiary_name,
      title,
      version: row!.version,
      totalFen,
      platformFeeFen,
      termsId: term?.id ?? null,
      ...(kind === 'PLAYER_APPEARANCE'
        ? {
            consentId: this.playerTermsId(
              row!.profile_id,
              row!.profile_version,
              row!.settings_version,
              {
                serviceFen: row!.service_fen,
                travelFen: row!.travel_fen,
                accommodationFen: row!.accommodation_fen,
                platformFeeFen: row!.platform_fee_fen,
                totalFen,
              },
            ),
          }
        : {}),
      terms: term?.terms ?? '按已确认服务报价与预约条款执行；支付与履约分别核验',
      merchantKey: term?.merchant_key ?? m?.key ?? null,
      payable: payable && org?.status === 'ACTIVE',
      valid: valid && org?.status === 'ACTIVE',
      fulfilled,
      disputed,
      expiresAt,
      identity,
    };
  }
  private async mayPay(c: PoolClient, a: Actor, s: Source) {
    if (s.payerId !== null) return s.payerId === a.user.id;
    return this.teamGrant(c, a, s.orgId, s.identity.teamId);
  }
  private quoteDto(kind: TradeSourceKind, id: string, s: Source): TradeQuote {
    const m = this.merchant(s.orgId);
    return {
      kind,
      sourceId: id,
      sourceVersion: s.version,
      title: s.title,
      totalFen: s.totalFen,
      currency: 'CNY',
      serviceFen: s.totalFen - s.platformFeeFen,
      platformFeeFen: s.platformFeeFen,
      merchantName: m?.displayName ?? '收款服务未开通',
      beneficiaryName: s.beneficiaryName,
      terms: s.terms,
      termsId: s.termsId,
      sourceHash: tradeHash(s.identity),
      payable: s.payable && !!m?.payments.enabled && m.key === s.merchantKey,
      fulfilled: s.fulfilled,
      disputed: s.disputed,
      expiresAt: s.expiresAt,
    };
  }
  private playerTermsId(
    profileId: string,
    profileVersion: number,
    settingsVersion: number,
    price: Row,
  ) {
    return tradeHash({
      v: 1,
      profileId,
      profileVersion,
      settingsVersion,
      serviceFen: price.serviceFen,
      travelFen: price.travelFen,
      accommodationFen: price.accommodationFen,
      platformFeeFen: price.platformFeeFen,
      totalFen: price.totalFen,
    });
  }
  /** Authenticated pre-create preview. The server supplies all prices and merchant identity. */
  async preview(cookie: string | undefined, raw: unknown) {
    const b = objectInput(raw, ['kind', 'sourceId', 'orgId', 'teamId', 'profileIds']);
    const kind = this.kind(b.kind);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      if (kind === 'PLAYER_APPEARANCE') {
        const org = tradeId(b.orgId),
          team = tradeId(b.teamId);
        await this.calendar(c, org);
        if (!(await this.teamGrant(c, a, org, team)) && !(await this.manager(c, a, org)))
          throw notFound();
        if (!Array.isArray(b.profileIds) || b.profileIds.length < 1 || b.profileIds.length > 3)
          tradeFail('INVALID_TRADE_SOURCE', '请选择1至3名球员', 422);
        const ids = [...new Set(b.profileIds.map(tradeId))].sort(),
          m = this.merchant(org);
        if (!m?.payments.enabled || !m.playerFeesEnabled) {
          await this.ensureFreshSession(c, a);
          return { enabled: false, quotes: [] };
        }
        const settings = (await c.query<Row>('SELECT * FROM booking_settings WHERE id FOR SHARE'))
          .rows[0]!;
        const quotes = [];
        for (const id of ids) {
          const p = (
            await c.query<Row>(
              "SELECT p.* FROM booking_profiles p JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND p.status='APPROVED' AND u.status='ACTIVE' FOR SHARE OF p,u",
              [id],
            )
          ).rows[0];
          if (!p || p.user_id === a.user.id) throw notFound();
          const price = playerQuote(
            p.price_fen,
            p.travel_fen,
            p.accommodation_fen,
            settings.fee_bps,
          );
          quotes.push({
            profileId: id,
            profileVersion: p.version,
            settingsVersion: settings.version,
            termsId: this.playerTermsId(id, p.version, settings.version, price),
            ...price,
          });
        }
        await this.ensureFreshSession(c, a);
        return {
          enabled: true,
          merchantName: m.displayName,
          terms: '按已确认服务报价与预约条款执行；接单后付款，支付与履约分别核验',
          quotes,
        };
      }
      const anchor = tradeId(b.sourceId);
      const ref = (
        await c.query<Row>(
          kind === 'LOCAL_BOOKING'
            ? 'SELECT org_id,provider_user_id,title,status FROM local_listings WHERE id=$1'
            : 'SELECT org_id,name AS title,status FROM events WHERE id=$1',
          [anchor],
        )
      ).rows[0];
      if (!ref) throw notFound();
      await this.calendar(c, ref.org_id);
      const m = this.merchant(ref.org_id);
      if (!m?.payments.enabled) {
        await this.ensureFreshSession(c, a);
        return { enabled: false };
      }
      const term = (
        await c.query<Row>(
          "SELECT * FROM trade_terms WHERE org_id=$1 AND kind=$2 AND source_id=$3 AND status='ACTIVE' FOR SHARE",
          [ref.org_id, kind, anchor],
        )
      ).rows[0];
      await this.ensureFreshSession(c, a);
      if (!term) return { enabled: false };
      return {
        enabled: true,
        termsId: term.id,
        totalFen: term.amount_fen,
        currency: 'CNY',
        merchantName: m.displayName,
        title: ref.title,
        terms: term.terms,
      };
    });
  }
  async quote(cookie: string | undefined, raw: unknown) {
    const b = objectInput(raw, ['kind', 'sourceId', 'expectedSourceVersion']);
    const kind = this.kind(b.kind),
      id = tradeId(b.sourceId);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        s = await this.source(c, kind, id);
      if (!(await this.mayPay(c, a, s)) && !(await this.manager(c, a, s.orgId))) throw notFound();
      if (b.expectedSourceVersion !== undefined)
        assertTradeVersion(s.version, tradeVersion(b.expectedSourceVersion));
      await this.ensureFreshSession(c, a);
      return this.quoteDto(kind, id, s);
    });
  }
  async sourceOrder(cookie: string | undefined, kindValue: unknown, sourceValue: unknown) {
    const kind = this.kind(kindValue),
      sourceId = tradeId(sourceValue);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const row = (
        await c.query<Row>('SELECT * FROM trade_orders WHERE kind=$1 AND source_id=$2', [
          kind,
          sourceId,
        ])
      ).rows[0];
      if (
        row &&
        row.payer_user_id !== a.user.id &&
        row.beneficiary_user_id !== a.user.id &&
        !(await this.manager(c, a, row.org_id)) &&
        !(await this.operator(c, a))
      )
        throw notFound();
      await this.ensureFreshSession(c, a);
      return { orderId: row?.id ?? null };
    });
  }
  private kind(v: unknown): TradeSourceKind {
    if (!['ENTRY_FEE', 'ENTRY_DEPOSIT', 'LOCAL_BOOKING', 'PLAYER_APPEARANCE'].includes(String(v)))
      tradeFail('INVALID_TRADE_SOURCE', '收费来源无效', 422);
    return v as TradeSourceKind;
  }
  private async operation(
    c: PoolClient,
    a: Actor,
    id: string,
    input: unknown,
    orderId: string | null,
    work: () => Promise<Row>,
  ) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'e04:' + a.user.id + ':' + id,
    ]);
    const hash = tradeHash(input),
      old = (
        await c.query<Row>('SELECT * FROM trade_operations WHERE actor_id=$1 AND command_id=$2', [
          a.user.id,
          id,
        ])
      ).rows[0];
    if (old) {
      if (old.request_hash !== hash) tradeFail('IDEMPOTENCY_CONFLICT', '原操作编号内容不同');
      await this.ensureFreshSession(c, a);
      return old.result;
    }
    const result = await work();
    await c.query(
      'INSERT INTO trade_operations(actor_id,command_id,request_hash,order_id,result) VALUES($1,$2,$3,$4,$5::jsonb)',
      [a.user.id, id, hash, orderId, JSON.stringify(result)],
    );
    await this.ensureFreshSession(c, a);
    return result;
  }
  async create(cookie: string | undefined, raw: unknown) {
    const b = objectInput(raw, [
      'clientRequestId',
      'kind',
      'sourceId',
      'expectedSourceVersion',
      'sourceHash',
    ]);
    const kind = this.kind(b.kind),
      sourceId = tradeId(b.sourceId),
      command = tradeId(b.clientRequestId),
      expected = tradeVersion(b.expectedSourceVersion);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        s = await this.source(c, kind, sourceId);
      if (!(await this.mayPay(c, a, s))) throw notFound();
      const m = this.merchant(s.orgId);
      if (!m?.payments.enabled || !this.runtime.encryptionKey || s.merchantKey !== m.key)
        tradeFail('TRADE_PROVIDER_DISABLED', '收款服务未配置，不会创建真实扣款', 503);
      return this.operation(c, a, command, { op: 'CREATE', ...b }, null, async () => {
        assertTradeVersion(s.version, expected);
        if (tradeHash(s.identity) !== b.sourceHash)
          tradeFail('TRADE_QUOTE_CHANGED', '报价来源已变化，请重新核对');
        if (!s.payable) tradeFail('TRADE_SOURCE_NOT_PAYABLE', '当前来源不能付款');
        const old = (
          await c.query<Row>('SELECT id FROM trade_orders WHERE kind=$1 AND source_id=$2', [
            kind,
            sourceId,
          ])
        ).rows[0];
        if (old) return { orderId: old.id };
        return tradeFail('TRADE_SOURCE_NOT_CHARGED', '本来源创建时未启用收费，不追溯收取费用', 422);
      });
    });
  }
  private async context(c: PoolClient, cookie: string | undefined, id: string) {
    const a = await this.lockActor(c, cookie),
      ref = (await c.query<Row>('SELECT * FROM trade_orders WHERE id=$1', [tradeId(id)])).rows[0];
    if (!ref) throw notFound();
    const s = await this.source(c, ref.kind, ref.source_id, ref.terms_id),
      manage = await this.manager(c, a, ref.org_id),
      operator = await this.operator(c, a);
    if (
      a.user.id !== ref.payer_user_id &&
      a.user.id !== ref.beneficiary_user_id &&
      !manage &&
      !operator
    )
      throw notFound();
    const order = (await c.query<Row>('SELECT * FROM trade_orders WHERE id=$1 FOR UPDATE', [id]))
      .rows[0]!;
    return { a, s, order, manage, operator };
  }
  private async money(c: PoolClient, order: Row) {
    const attempts = (
        await c.query<Row>(
          'SELECT * FROM trade_payment_attempts WHERE order_id=$1 ORDER BY created_at,id',
          [order.id],
        )
      ).rows,
      refunds = (
        await c.query<Row>('SELECT * FROM trade_refunds WHERE order_id=$1 ORDER BY created_at,id', [
          order.id,
        ])
      ).rows,
      deductions = (
        await c.query<Row>(
          'SELECT * FROM trade_deductions WHERE order_id=$1 ORDER BY created_at,id',
          [order.id],
        )
      ).rows,
      settlements = (
        await c.query<Row>(
          'SELECT * FROM trade_settlements WHERE order_id=$1 ORDER BY created_at,id',
          [order.id],
        )
      ).rows;
    const paid = attempts.filter((x) => x.status === 'PAID').reduce((n, x) => n + x.total_fen, 0);
    return {
      attempts,
      refunds,
      deductions,
      settlements,
      balances: tradeBalances(paid, refunds as any, deductions as any, settlements as any),
    };
  }
  async get(cookie: string | undefined, id: string): Promise<TradeOrderData> {
    return this.transaction(async (c) => {
      const { a, s, order: o, manage, operator } = await this.context(c, cookie, id),
        money = await this.money(c, o),
        m = this.merchant(o.org_id, o);
      const valid = s.valid && tradeHash(s.identity) === o.source_hash;
      const now = (await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
      await this.ensureFreshSession(c, a);
      return {
        id: o.id,
        orgId: o.org_id,
        kind: o.kind,
        sourceId: o.source_id,
        sourceVersion: o.source_version,
        status: o.status,
        version: o.version,
        title: o.quote.title,
        totalFen: o.total_fen,
        currency: 'CNY',
        merchantName: o.merchant_name,
        terms: o.quote.terms,
        ...money.balances,
        currentSource: { payable: s.payable, fulfilled: s.fulfilled, disputed: s.disputed, valid },
        attempts: money.attempts.map((x) => ({
          id: x.id,
          channel: x.channel,
          status: x.status,
          expiresAt: iso(x.expires_at)!,
          paidAt: iso(x.paid_at),
          checkout:
            a.user.id === o.payer_user_id &&
            x.checkout &&
            this.runtime.encryptionKey &&
            ['NOTPAY', 'UNKNOWN'].includes(x.status) &&
            new Date(x.expires_at) > now
              ? tradeOpen(this.runtime.encryptionKey, x.id, x.checkout)
              : null,
        })),
        refunds: money.refunds.map((x) => ({
          id: x.id,
          amountFen: x.amount_fen,
          status: x.status,
          reason: x.reason,
          proposedBy: x.proposed_by,
          reviewedBy: x.reviewed_by,
        })),
        deductions: money.deductions.map((x) => ({
          id: x.id,
          amountFen: x.amount_fen,
          status: x.status,
          reason: x.reason,
          evidenceReference: x.evidence_reference,
          proposedBy: x.proposed_by,
          reviewedBy: x.reviewed_by,
        })),
        settlements: money.settlements.map((x) => ({
          id: x.id,
          amountFen: x.amount_fen,
          status: x.status,
          returnedFen: x.return_amount_fen,
          proposedBy: x.proposed_by,
          reviewedBy: x.reviewed_by,
        })),
        capabilities: {
          canPay:
            a.user.id === o.payer_user_id &&
            valid &&
            s.payable &&
            money.balances.paidFen === 0 &&
            !!m?.payments.enabled,
          native: !!m?.payments.enabled,
          jsapi: !!m?.payments.enabled && !!m.payments.jsapi && !!this.runtime.resolvePayer,
          canRequestRefund: a.user.id === o.payer_user_id && money.balances.refundableFen > 0,
          canManage: manage || operator,
          settlementAvailable: !!m?.settlements?.enabled && m.settlements.returnSupported,
        },
      };
    });
  }
  async list(cookie: string | undefined, orgId?: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      if (orgId && !(await this.manager(c, a, tradeId(orgId))) && !(await this.operator(c, a)))
        throw notFound();
      const rows = (
        await c.query<Row>(
          `SELECT id,kind,source_id,status,version,total_fen,merchant_name,quote->>'title' AS title,created_at FROM trade_orders WHERE ${orgId ? 'org_id=$1' : '(payer_user_id=$1 OR beneficiary_user_id=$1)'} ORDER BY created_at DESC,id DESC LIMIT 100`,
          [orgId ?? a.user.id],
        )
      ).rows;
      await this.ensureFreshSession(c, a);
      return {
        orders: rows.map((x) => ({
          id: x.id,
          kind: x.kind,
          sourceId: x.source_id,
          status: x.status,
          version: x.version,
          totalFen: x.total_fen,
          merchantName: x.merchant_name,
          title: x.title,
          createdAt: iso(x.created_at),
        })),
        limit: 100,
      };
    });
  }
  async receipt(cookie: string | undefined, id: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'e04:' + a.user.id + ':' + tradeId(id),
      ]);
      const x = (
        await c.query<Row>(
          'SELECT result FROM trade_operations WHERE actor_id=$1 AND command_id=$2',
          [a.user.id, id],
        )
      ).rows[0];
      await this.ensureFreshSession(c, a);
      return { found: !!x, result: x?.result ?? null };
    });
  }
  private async bump(c: PoolClient, id: string) {
    await c.query(
      'UPDATE trade_orders SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
      [id],
    );
  }
  private async recordUnknown(attemptId: string, fence: string, notDispatched = false) {
    await this.transaction(async (c) => {
      const ref = (
        await c.query<Row>(
          'SELECT p.order_id,o.kind,o.source_id,o.terms_id FROM trade_payment_attempts p JOIN trade_orders o ON o.id=p.order_id WHERE p.id=$1',
          [attemptId],
        )
      ).rows[0];
      if (!ref) return;
      await this.source(c, ref.kind, ref.source_id, ref.terms_id);
      await c.query('SELECT id FROM trade_orders WHERE id=$1 FOR UPDATE', [ref.order_id]);
      const changed = await c.query(
        `UPDATE trade_payment_attempts SET status=$3,updated_at=clock_timestamp() WHERE id=$1 AND fence=$2 AND status='DISPATCHING'`,
        [attemptId, fence, notDispatched ? 'FAILED' : 'UNKNOWN'],
      );
      if (changed.rowCount) await this.bump(c, ref.order_id);
    });
  }
  async pay(cookie: string | undefined, id: string, raw: unknown) {
    const b = objectInput(raw, ['clientRequestId', 'expectedVersion', 'channel', 'code']),
      command = tradeId(b.clientRequestId),
      expected = tradeVersion(b.expectedVersion);
    if (!['NATIVE', 'JSAPI'].includes(String(b.channel)))
      tradeFail('INVALID_TRADE_INPUT', '请选择实际支付通道', 422);
    const channel = b.channel as 'NATIVE' | 'JSAPI';
    if (channel === 'NATIVE' && b.code !== undefined)
      tradeFail('INVALID_TRADE_INPUT', '扫码支付不接受登录码', 422);
    const code = channel === 'JSAPI' ? text(b.code, 'code', 1, 256) : undefined;
    let intent: { attempt: Row; merchant: TradeMerchant; actor: Actor; order: Row } | undefined;
    const result = await this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, id),
        { a, s, order: o } = ctx;
      if (a.user.id !== o.payer_user_id) throw forbidden();
      return this.operation(c, a, command, { op: 'PAY', id, expected, channel }, id, async () => {
        assertTradeVersion(o.version, expected);
        const m = this.merchant(o.org_id, o);
        if (!m?.payments.enabled || !this.runtime.encryptionKey)
          tradeFail('TRADE_PROVIDER_DISABLED', '收款服务未配置', 503);
        if (channel === 'JSAPI' && (!m.payments.jsapi || !this.runtime.resolvePayer))
          tradeFail('TRADE_JSAPI_DISABLED', '小程序支付身份服务未配置', 503);
        const money = await this.money(c, o);
        if (money.balances.paidFen > 0)
          tradeFail('TRADE_ALREADY_PAID', '原订单已经有实际付款，请核对原订单');
        if (money.attempts.some((x) => ['DISPATCHING', 'UNKNOWN', 'NOTPAY'].includes(x.status)))
          tradeFail('TRADE_PAYMENT_UNRESOLVED', '原支付结果尚未确认，请查询原编号');
        if (money.attempts.length >= 10)
          tradeFail('TRADE_ATTEMPT_LIMIT', '支付尝试已达上限，请联系主办方');
        if (!s.payable || !s.valid || s.disputed || tradeHash(s.identity) !== o.source_hash)
          tradeFail('TRADE_SOURCE_NOT_PAYABLE', '来源或条款已变化，请核对后再付款');
        const now = (await c.query<Row>('SELECT clock_timestamp() AS now')).rows[0]!.now,
          expiresAt = new Date(
            Math.min(
              new Date(now).getTime() + 15 * 60000,
              s.expiresAt ? new Date(s.expiresAt).getTime() : Infinity,
            ),
          );
        if (expiresAt.getTime() - new Date(now).getTime() < 30000)
          tradeFail('TRADE_SOURCE_EXPIRING', '原库存即将到期，请重新预约');
        const attempt = {
          id: randomUUID(),
          out_trade_no: no('E4'),
          fence: randomUUID(),
          expires_at: expiresAt.toISOString(),
          profit_sharing:
            !!m.settlements?.enabled &&
            m.settlements.returnSupported &&
            !!m.receivers[o.beneficiary_user_id],
        };
        await c.query(
          `INSERT INTO trade_payment_attempts(id,order_id,out_trade_no,channel,status,total_fen,fence,expires_at,profit_sharing) VALUES($1,$2,$3,$4,'DISPATCHING',$5,$6,$7,$8)`,
          [
            attempt.id,
            id,
            attempt.out_trade_no,
            channel,
            o.total_fen,
            attempt.fence,
            attempt.expires_at,
            attempt.profit_sharing,
          ],
        );
        await this.bump(c, id);
        intent = { attempt, merchant: m, actor: a, order: o };
        return { orderId: id, attemptId: attempt.id };
      });
    });
    if (!intent) return result;
    const i = intent;
    let dispatched = false;
    try {
      let openid: string | undefined;
      if (channel === 'JSAPI') {
        const payer = await this.runtime.resolvePayer!({
          actorId: i.actor.user.id,
          sessionId: i.actor.sessionId,
          merchantKey: i.merchant.key,
          code: code!,
        });
        if (
          payer.appId !== i.merchant.appId ||
          typeof payer.openid !== 'string' ||
          payer.openid.length < 16 ||
          payer.openid.length > 128
        )
          tradeFail('TRADE_PAYER_INVALID', '当前微信付款身份无法核验', 403);
        openid = payer.openid;
      }
      // Auth/config/source must still be current after the external login-code exchange.
      await this.transaction(async (c) => {
        const ctx = await this.context(c, cookie, id);
        if (
          ctx.a.sessionId !== i.actor.sessionId ||
          ctx.a.user.id !== i.actor.user.id ||
          !ctx.s.payable ||
          tradeHash(ctx.s.identity) !== ctx.order.source_hash ||
          this.merchant(ctx.order.org_id, ctx.order) !== i.merchant
        )
          tradeFail('TRADE_SOURCE_NOT_PAYABLE', '付款前资料已变化，请查询原订单');
        await this.ensureFreshSession(c, ctx.a);
      });
      const input = {
        outTradeNo: i.attempt.out_trade_no,
        description: i.order.quote.title,
        totalFen: i.order.total_fen,
        currency: 'CNY' as const,
        expiresAt: i.attempt.expires_at,
        ...(i.attempt.profit_sharing ? { profitSharing: true } : {}),
      };
      dispatched = true;
      const checkout: TradeCheckout =
        channel === 'JSAPI'
          ? { mode: 'JSAPI', ...(await i.merchant.payments.jsapi!({ ...input, openid: openid! })) }
          : { mode: 'NATIVE', ...(await i.merchant.payments.native(input)) };
      await this.transaction(async (c) => {
        const s = await this.source(c, i.order.kind, i.order.source_id, i.order.terms_id);
        await c.query('SELECT id FROM trade_orders WHERE id=$1 FOR UPDATE', [id]);
        await c.query(
          "UPDATE trade_payment_attempts SET status='NOTPAY',checkout=$3,updated_at=clock_timestamp() WHERE id=$1 AND fence=$2 AND status='DISPATCHING'",
          [
            i.attempt.id,
            i.attempt.fence,
            tradeSeal(this.runtime.encryptionKey!, i.attempt.id, checkout),
          ],
        );
        if (!s.valid || tradeHash(s.identity) !== i.order.source_hash)
          await c.query("UPDATE trade_orders SET status='SOURCE_CONFLICT' WHERE id=$1", [id]);
        await this.bump(c, id);
      });
    } catch (err) {
      await this.recordUnknown(i.attempt.id, i.attempt.fence, !dispatched);
      throw err;
    }
    return result;
  }
  private async applyPayment(
    org: string,
    merchant: TradeMerchant,
    p: WechatPayOrder,
    client?: PoolClient,
  ) {
    const work = async (c: PoolClient) => {
      const ref = (
        await c.query<Row>(
          'SELECT p.id AS attempt_id,p.order_id,o.* FROM trade_payment_attempts p JOIN trade_orders o ON o.id=p.order_id WHERE p.out_trade_no=$1',
          [p.outTradeNo],
        )
      ).rows[0];
      if (!ref || ref.org_id !== org || this.merchant(org, ref) !== merchant)
        tradeFail('TRADE_PAYMENT_IDENTITY', '付款商户与原订单不匹配', 422);
      const s = await this.source(c, ref.kind, ref.source_id, ref.terms_id);
      const order = (
        await c.query<Row>('SELECT * FROM trade_orders WHERE id=$1 FOR UPDATE', [ref.order_id])
      ).rows[0]!;
      const a = (
        await c.query<Row>('SELECT * FROM trade_payment_attempts WHERE id=$1 FOR UPDATE', [
          ref.attempt_id,
        ])
      ).rows[0]!;
      if (p.totalFen !== a.total_fen || p.currency !== 'CNY')
        tradeFail('TRADE_PAYMENT_AMOUNT', '付款金额或币种不匹配', 422);
      if (a.status === 'PAID') {
        if (p.transactionId && p.transactionId !== a.provider_transaction_id)
          tradeFail('TRADE_PAYMENT_IDENTITY', '同一支付编号出现不同渠道交易', 422);
        return;
      }
      if (['SUCCESS', 'REFUND'].includes(p.state)) {
        if (!p.transactionId || !p.successTime)
          tradeFail('TRADE_PAYMENT_IDENTITY', '付款凭据不完整', 422);
        await c.query(
          "UPDATE trade_payment_attempts SET status='PAID',provider_transaction_id=$2,paid_at=$3,checkout=NULL,updated_at=clock_timestamp() WHERE id=$1",
          [a.id, p.transactionId, p.successTime],
        );
        const already = (
          await c.query(
            "SELECT id FROM trade_payment_attempts WHERE order_id=$1 AND status='PAID' AND id<>$2",
            [order.id, a.id],
          )
        ).rowCount;
        if (already || !s.valid || s.disputed || tradeHash(s.identity) !== order.source_hash)
          await c.query("UPDATE trade_orders SET status='SOURCE_CONFLICT' WHERE id=$1", [order.id]);
      } else if (['CLOSED', 'REVOKED', 'PAYERROR'].includes(p.state))
        await c.query(
          'UPDATE trade_payment_attempts SET status=$2,checkout=NULL,updated_at=clock_timestamp() WHERE id=$1',
          [a.id, p.state === 'PAYERROR' ? 'FAILED' : 'CLOSED'],
        );
      else
        await c.query(
          "UPDATE trade_payment_attempts SET status='NOTPAY',updated_at=clock_timestamp() WHERE id=$1 AND status NOT IN('CLOSED','FAILED')",
          [a.id],
        );
      await this.bump(c, order.id);
    };
    if (client) await work(client);
    else await this.transaction(work);
  }
  async queryPayment(cookie: string | undefined, id: string, attemptId: string) {
    const x = await this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, id),
        m = this.merchant(ctx.order.org_id, ctx.order);
      if (!m?.payments.enabled)
        tradeFail('TRADE_PROVIDER_DISABLED', '原商户通道未配置，请保留原编号', 503);
      const p = (
        await c.query<Row>('SELECT * FROM trade_payment_attempts WHERE id=$1 AND order_id=$2', [
          tradeId(attemptId),
          id,
        ])
      ).rows[0];
      if (!p) throw notFound();
      await this.ensureFreshSession(c, ctx.a);
      return { p, m, org: ctx.order.org_id };
    });
    await this.applyPayment(x.org, x.m, await x.m.payments.queryOrder(x.p.out_trade_no));
    return this.get(cookie, id);
  }
  private async independent(
    c: PoolClient,
    ctx: { a: Actor; order: Row; manage: boolean; operator: boolean },
    proposer: string,
  ) {
    if (
      (!ctx.manage && !ctx.operator) ||
      [ctx.order.payer_user_id, ctx.order.beneficiary_user_id, proposer].includes(ctx.a.user.id)
    )
      throw forbidden();
  }
  async requestRefund(cookie: string | undefined, id: string, raw: unknown) {
    const b = objectInput(raw, ['clientRequestId', 'expectedVersion', 'amountFen', 'reason']),
      command = tradeId(b.clientRequestId),
      amount = tradeFen(b.amountFen),
      reason = tradeReason(b.reason);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, id),
        { a, order: o } = ctx;
      if (a.user.id !== o.payer_user_id && !ctx.manage && !ctx.operator) throw forbidden();
      return this.operation(c, a, command, { op: 'REFUND_REQUEST', id, ...b }, id, async () => {
        assertTradeVersion(o.version, tradeVersion(b.expectedVersion));
        const money = await this.money(c, o);
        if (amount > money.balances.refundableFen)
          tradeFail('TRADE_REFUND_LIMIT', '退款和未决扣减合计超过可退金额');
        const payment = money.attempts.find(
          (p) =>
            p.status === 'PAID' &&
            p.total_fen -
              money.refunds
                .filter((r) => r.payment_id === p.id && !['REJECTED', 'FAILED'].includes(r.status))
                .reduce((n, r) => n + r.amount_fen, 0) >=
              amount,
        );
        if (!payment)
          tradeFail('TRADE_REFUND_PAYMENT_LIMIT', '本次金额超出单笔原支付可退金额，请分别申请');
        const rid = randomUUID();
        await c.query(
          `INSERT INTO trade_refunds(id,order_id,payment_id,out_refund_no,amount_fen,reason,status,proposed_by) VALUES($1,$2,$3,$4,$5,$6,'PENDING_REVIEW',$7)`,
          [rid, id, payment!.id, 'E4R' + rid.replaceAll('-', ''), amount, reason, a.user.id],
        );
        await this.bump(c, id);
        return { orderId: id, refundId: rid };
      });
    });
  }
  async review(cookie: string | undefined, id: string, type: string, target: string, raw: unknown) {
    if (!['REFUND', 'DEDUCTION', 'SETTLEMENT'].includes(type))
      tradeFail('INVALID_TRADE_INPUT', '审核对象无效', 422);
    const b = objectInput(raw, ['clientRequestId', 'expectedVersion', 'decision', 'reason']),
      command = tradeId(b.clientRequestId),
      reason = tradeReason(b.reason);
    if (
      !['APPROVE', 'REJECT', 'REVERSE'].includes(String(b.decision)) ||
      (b.decision === 'REVERSE' && type !== 'DEDUCTION')
    )
      tradeFail('INVALID_TRADE_INPUT', '请选择有效审核动作', 422);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, id),
        { a, order: o } = ctx;
      const table =
        type === 'REFUND'
          ? 'trade_refunds'
          : type === 'DEDUCTION'
            ? 'trade_deductions'
            : 'trade_settlements';
      const row = (
        await c.query<Row>(`SELECT * FROM ${table} WHERE id=$1 AND order_id=$2 FOR UPDATE`, [
          tradeId(target),
          id,
        ])
      ).rows[0];
      if (!row) throw notFound();
      await this.independent(c, ctx, row.proposed_by);
      return this.operation(
        c,
        a,
        command,
        { op: 'REVIEW', id, type, target, ...b },
        id,
        async () => {
          assertTradeVersion(o.version, tradeVersion(b.expectedVersion));
          if (row.status !== (b.decision === 'REVERSE' ? 'APPROVED' : 'PENDING_REVIEW'))
            tradeFail('TRADE_REVIEW_STATE', '原申请已处理，请核对当前状态');
          if (type === 'SETTLEMENT' && b.decision === 'APPROVE')
            await this.settlementAllowed(c, ctx);
          await c.query(
            `UPDATE ${table} SET status=$2,reviewed_by=$3,review_reason=$4 ${type === 'DEDUCTION' ? '' : ',updated_at=clock_timestamp()'} WHERE id=$1`,
            [
              row.id,
              b.decision === 'APPROVE'
                ? 'APPROVED'
                : b.decision === 'REVERSE'
                  ? 'REVERSED'
                  : 'REJECTED',
              a.user.id,
              reason,
            ],
          );
          await this.bump(c, id);
          await this.audit(
            c,
            a.user.id,
            o.org_id,
            'TRADE_' + type + '_REVIEWED',
            'trade_order',
            id,
            { target, decision: b.decision },
          );
          return { orderId: id, resourceId: row.id };
        },
      );
    });
  }
  async proposeDeduction(cookie: string | undefined, id: string, raw: unknown) {
    const b = objectInput(raw, [
        'clientRequestId',
        'expectedVersion',
        'amountFen',
        'reason',
        'evidenceReference',
      ]),
      amount = tradeFen(b.amountFen),
      reason = tradeReason(b.reason),
      evidence = text(b.evidenceReference, 'evidenceReference', 4, 200);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, id),
        { a, order: o, s } = ctx;
      if (!ctx.manage && !ctx.operator) throw forbidden();
      if (o.kind !== 'ENTRY_DEPOSIT' || !s.fulfilled || s.disputed)
        tradeFail('TRADE_DEPOSIT_STATE', '保证金须赛后且无未决争议再按条款提出扣减');
      return this.operation(
        c,
        a,
        tradeId(b.clientRequestId),
        { op: 'DEDUCTION', id, ...b },
        id,
        async () => {
          assertTradeVersion(o.version, tradeVersion(b.expectedVersion));
          const m = await this.money(c, o);
          if (amount > m.balances.refundableFen)
            tradeFail('TRADE_DEDUCTION_LIMIT', '扣减和退款占用超过实际保证金');
          const rid = randomUUID();
          await c.query(
            `INSERT INTO trade_deductions(id,order_id,amount_fen,reason,evidence_reference,proposed_by) VALUES($1,$2,$3,$4,$5,$6)`,
            [rid, id, amount, reason, evidence, a.user.id],
          );
          await this.bump(c, id);
          return { orderId: id, deductionId: rid };
        },
      );
    });
  }
  private async refundIntent(cookie: string | undefined, id: string, rid: string, raw: unknown) {
    const b = objectInput(raw, ['clientRequestId', 'expectedVersion']);
    let intent: { order: Row; refund: Row; payment: Row; merchant: TradeMerchant } | undefined;
    const result = await this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, id),
        { a, order: o } = ctx;
      if (!ctx.manage && !ctx.operator) throw forbidden();
      const r = (
        await c.query<Row>('SELECT * FROM trade_refunds WHERE id=$1 AND order_id=$2 FOR UPDATE', [
          tradeId(rid),
          id,
        ])
      ).rows[0];
      if (!r) throw notFound();
      return this.operation(
        c,
        a,
        tradeId(b.clientRequestId),
        { op: 'DISPATCH_REFUND', id, rid, ...b },
        id,
        async () => {
          assertTradeVersion(o.version, tradeVersion(b.expectedVersion));
          if (r.status !== 'APPROVED')
            tradeFail('TRADE_REFUND_STATE', '只派发已独立批准的原退款；未知请查询原单');
          const money = await this.money(c, o);
          if (
            money.settlements.some(
              (s) =>
                s.payment_id === r.payment_id &&
                !['REJECTED', 'FAILED', 'RETURNED'].includes(s.status),
            )
          )
            tradeFail(
              'TRADE_SPLIT_RETURN_REQUIRED',
              '原支付存在未退回或未知分账，请先核对并完成原分账回退',
            );
          const m = this.merchant(o.org_id, o);
          if (!m?.payments.enabled)
            tradeFail('TRADE_PROVIDER_DISABLED', '原商户退款通道未配置', 503);
          const p = money.attempts.find((p) => p.id === r.payment_id && p.status === 'PAID');
          if (!p) tradeFail('TRADE_REFUND_SOURCE', '原付款凭据无法核验');
          const fence = randomUUID();
          await c.query(
            "UPDATE trade_refunds SET status='SENDING',fence=$2,updated_at=clock_timestamp() WHERE id=$1",
            [rid, fence],
          );
          await this.bump(c, id);
          intent = { order: o, refund: { ...r, fence }, payment: p!, merchant: m! };
          return { orderId: id, refundId: rid };
        },
      );
    });
    return { result, intent };
  }
  async dispatchRefund(cookie: string | undefined, id: string, rid: string, raw: unknown) {
    const { result, intent: i } = await this.refundIntent(cookie, id, rid, raw);
    if (!i) return result;
    try {
      const r = await i.merchant.payments.refund({
        outTradeNo: i.payment.out_trade_no,
        outRefundNo: i.refund.out_refund_no,
        totalFen: i.payment.total_fen,
        refundFen: i.refund.amount_fen,
        currency: 'CNY',
        reason: i.refund.reason.slice(0, 20),
      });
      await this.applyRefund(i.order.org_id, i.merchant, r);
    } catch (err) {
      await this.transaction(async (c) => {
        await this.source(c, i.order.kind, i.order.source_id, i.order.terms_id);
        await c.query('SELECT id FROM trade_orders WHERE id=$1 FOR UPDATE', [id]);
        await c.query(
          "UPDATE trade_refunds SET status='UNKNOWN',updated_at=clock_timestamp() WHERE id=$1 AND fence=$2 AND status='SENDING'",
          [rid, i.refund.fence],
        );
        await this.bump(c, id);
      });
      throw err;
    }
    return result;
  }
  private async applyRefund(
    org: string,
    merchant: TradeMerchant,
    r: WechatPayRefund,
    client?: PoolClient,
  ) {
    const work = async (c: PoolClient) => {
      const ref = (
        await c.query<Row>(
          'SELECT r.id AS refund_id,o.*,r.payment_id FROM trade_refunds r JOIN trade_orders o ON o.id=r.order_id WHERE r.out_refund_no=$1',
          [r.outRefundNo],
        )
      ).rows[0];
      if (!ref || ref.org_id !== org || this.merchant(org, ref) !== merchant)
        tradeFail('TRADE_REFUND_IDENTITY', '退款商户与原单不匹配', 422);
      await this.source(c, ref.kind, ref.source_id, ref.terms_id);
      await c.query('SELECT id FROM trade_orders WHERE id=$1 FOR UPDATE', [ref.id]);
      const local = (
          await c.query<Row>('SELECT * FROM trade_refunds WHERE id=$1 FOR UPDATE', [ref.refund_id])
        ).rows[0]!,
        pay = (
          await c.query<Row>('SELECT * FROM trade_payment_attempts WHERE id=$1', [local.payment_id])
        ).rows[0]!;
      if (
        r.outTradeNo !== pay.out_trade_no ||
        r.transactionId !== pay.provider_transaction_id ||
        r.totalFen !== pay.total_fen ||
        r.refundFen !== local.amount_fen ||
        r.currency !== 'CNY'
      )
        tradeFail('TRADE_REFUND_AMOUNT', '退款身份、金额或币种不匹配', 422);
      if (local.status === 'SUCCEEDED') {
        if (local.provider_refund_id !== r.refundId)
          tradeFail('TRADE_REFUND_IDENTITY', '退款渠道标识冲突', 422);
        return;
      }
      if (!['SENDING', 'UNKNOWN', 'PROCESSING'].includes(local.status))
        tradeFail('TRADE_REFUND_STATE', '退款未获当前执行授权');
      const status =
        r.state === 'SUCCESS' ? 'SUCCEEDED' : r.state === 'PROCESSING' ? 'PROCESSING' : 'FAILED';
      await c.query(
        'UPDATE trade_refunds SET status=$2,provider_refund_id=$3,success_at=$4,updated_at=clock_timestamp() WHERE id=$1',
        [local.id, status, r.refundId, r.state === 'SUCCESS' ? r.successTime : null],
      );
      await this.bump(c, ref.id);
    };
    if (client) await work(client);
    else await this.transaction(work);
  }
  async queryRefund(cookie: string | undefined, id: string, rid: string) {
    const x = await this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, id),
        m = this.merchant(ctx.order.org_id, ctx.order),
        r = (
          await c.query<Row>('SELECT * FROM trade_refunds WHERE id=$1 AND order_id=$2', [
            tradeId(rid),
            id,
          ])
        ).rows[0];
      if (!r) throw notFound();
      if (!m?.payments.enabled) tradeFail('TRADE_PROVIDER_DISABLED', '原退款商户通道未配置', 503);
      if (!['SENDING', 'UNKNOWN', 'PROCESSING', 'SUCCEEDED', 'FAILED'].includes(r.status))
        tradeFail('TRADE_REFUND_STATE', '退款尚未派发');
      await this.ensureFreshSession(c, ctx.a);
      return { m: m!, r, org: ctx.order.org_id };
    });
    await this.applyRefund(x.org, x.m, await x.m.payments.queryRefund(x.r.out_refund_no));
    return this.get(cookie, id);
  }
  private async settlementAllowed(c: PoolClient, ctx: { order: Row; s: Source }) {
    const { order: o, s } = ctx,
      money = await this.money(c, o);
    if (
      !s.fulfilled ||
      !s.valid ||
      s.disputed ||
      o.status === 'SOURCE_CONFLICT' ||
      tradeHash(s.identity) !== o.source_hash
    )
      tradeFail('TRADE_SETTLEMENT_SOURCE', '履约未完成、存在争议或来源冲突，不能分账');
    if (
      money.refunds.some((r) => !['SUCCEEDED', 'FAILED', 'REJECTED'].includes(r.status)) ||
      money.deductions.some((d) => d.status === 'PENDING_REVIEW')
    )
      tradeFail('TRADE_SETTLEMENT_UNRESOLVED', '先处理全部未决退款和扣减');
    const rec = (
      await c.query<Row>(
        "SELECT result FROM trade_reconciliations WHERE org_id=$1 AND merchant_key=$2 AND bill_date=($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::date ORDER BY created_at DESC LIMIT 1",
        [
          o.org_id,
          o.merchant_key,
          money.attempts.find((p) => p.status === 'PAID')?.paid_at ?? null,
        ],
      )
    ).rows[0];
    if (!rec || rec.result.issues?.length !== 0)
      tradeFail('TRADE_RECONCILIATION_REQUIRED', '原付款账单尚未核对一致');
    return money;
  }
  async proposeSettlement(cookie: string | undefined, id: string, raw: unknown) {
    const b = objectInput(raw, ['clientRequestId', 'expectedVersion']);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, id),
        { a, order: o } = ctx;
      if (!ctx.manage && !ctx.operator) throw forbidden();
      return this.operation(
        c,
        a,
        tradeId(b.clientRequestId),
        { op: 'SETTLEMENT', id, ...b },
        id,
        async () => {
          assertTradeVersion(o.version, tradeVersion(b.expectedVersion));
          const money = await this.settlementAllowed(c, ctx),
            m = this.merchant(o.org_id, o),
            receiver = m?.receivers[o.beneficiary_user_id];
          if (
            !m?.settlements?.enabled ||
            !m.settlements.returnSupported ||
            !receiver ||
            receiver.merchantId === m.merchantId
          )
            tradeFail('TRADE_SETTLEMENT_DISABLED', '分账及回退通道或受控接收方未配置', 503);
          if (money.settlements.some((s) => !['REJECTED', 'FAILED'].includes(s.status)))
            tradeFail('TRADE_SETTLEMENT_EXISTS', '原分账尚需核对，不创建第二单');
          const p = money.attempts.find((p) => p.status === 'PAID' && p.profit_sharing);
          if (!p) tradeFail('TRADE_SPLIT_NOT_RESERVED', '原支付未按分账产品预留，不能事后改成分账');
          const limit =
            o.kind === 'ENTRY_DEPOSIT'
              ? money.balances.deductionApprovedFen
              : money.balances.paidFen -
                money.balances.refundReservedFen -
                (o.quote.platformFeeFen ?? 0);
          if (limit <= 0 || limit > p.total_fen)
            tradeFail('TRADE_SETTLEMENT_AMOUNT', '当前没有可分账收入；未扣保证金不作为收入');
          const sid = randomUUID();
          await c.query(
            'INSERT INTO trade_settlements(id,order_id,payment_id,out_order_no,amount_fen,receiver_merchant_id,proposed_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [sid, id, p.id, 'E4S' + sid.replaceAll('-', ''), limit, receiver.merchantId, a.user.id],
          );
          await this.bump(c, id);
          return { orderId: id, settlementId: sid };
        },
      );
    });
  }
  async dispatchSettlement(cookie: string | undefined, id: string, sid: string, raw: unknown) {
    const b = objectInput(raw, ['clientRequestId', 'expectedVersion']);
    let intent: { o: Row; s: Row; p: Row; m: TradeMerchant } | undefined;
    const result = await this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, id),
        { a, order: o } = ctx;
      if (!ctx.manage && !ctx.operator) throw forbidden();
      const s = (
        await c.query<Row>(
          'SELECT * FROM trade_settlements WHERE id=$1 AND order_id=$2 FOR UPDATE',
          [tradeId(sid), id],
        )
      ).rows[0];
      if (!s) throw notFound();
      return this.operation(
        c,
        a,
        tradeId(b.clientRequestId),
        { op: 'DISPATCH_SETTLEMENT', id, sid, ...b },
        id,
        async () => {
          assertTradeVersion(o.version, tradeVersion(b.expectedVersion));
          if (s.status !== 'APPROVED')
            tradeFail('TRADE_SETTLEMENT_STATE', '原分账未批准或结果待确认，请查询原单');
          const money = await this.settlementAllowed(c, ctx),
            m = this.merchant(o.org_id, o),
            receiver = m?.receivers[o.beneficiary_user_id];
          if (
            !m?.settlements?.enabled ||
            !m.settlements.returnSupported ||
            receiver?.merchantId !== s.receiver_merchant_id
          )
            tradeFail('TRADE_SETTLEMENT_DISABLED', '原分账接收方或回退通道已变化', 503);
          const p = money.attempts.find(
            (p) => p.id === s.payment_id && p.status === 'PAID' && p.profit_sharing,
          );
          if (!p) tradeFail('TRADE_SETTLEMENT_SOURCE', '原支付未核实或未预留分账');
          const fence = randomUUID();
          await c.query(
            "UPDATE trade_settlements SET status='SENDING',fence=$2,updated_at=clock_timestamp() WHERE id=$1",
            [sid, fence],
          );
          await this.bump(c, id);
          intent = { o, s: { ...s, fence }, p: p!, m: m! };
          return { orderId: id, settlementId: sid };
        },
      );
    });
    if (!intent) return result;
    const i = intent;
    try {
      await this.applySplit(
        i.o.org_id,
        i.m,
        await i.m.settlements!.split({
          transactionId: i.p.provider_transaction_id,
          outOrderNo: i.s.out_order_no,
          receiverMerchantId: i.s.receiver_merchant_id,
          amountFen: i.s.amount_fen,
          description: '已完成篮球服务分账',
        }),
      );
    } catch (err) {
      await this.transaction(async (c) => {
        await this.source(c, i.o.kind, i.o.source_id, i.o.terms_id);
        await c.query('SELECT id FROM trade_orders WHERE id=$1 FOR UPDATE', [id]);
        await c.query(
          "UPDATE trade_settlements SET status='UNKNOWN',updated_at=clock_timestamp() WHERE id=$1 AND fence=$2 AND status='SENDING'",
          [sid, i.s.fence],
        );
        await this.bump(c, id);
      });
      throw err;
    }
    return result;
  }
  private async applySplit(
    org: string,
    m: TradeMerchant,
    r: import('./trade-provider.js').TradeSplitResult,
  ) {
    await this.transaction(async (c) => {
      const ref = (
        await c.query<Row>(
          'SELECT s.id AS settlement_id,o.* FROM trade_settlements s JOIN trade_orders o ON o.id=s.order_id WHERE s.out_order_no=$1',
          [r.outOrderNo],
        )
      ).rows[0];
      if (!ref || ref.org_id !== org || this.merchant(org, ref) !== m)
        tradeFail('TRADE_SPLIT_IDENTITY', '原分账商户无法核验', 422);
      const source = await this.source(c, ref.kind, ref.source_id, ref.terms_id);
      await c.query('SELECT id FROM trade_orders WHERE id=$1 FOR UPDATE', [ref.id]);
      const s = (
          await c.query<Row>('SELECT * FROM trade_settlements WHERE id=$1 FOR UPDATE', [
            ref.settlement_id,
          ])
        ).rows[0]!,
        p = (await c.query<Row>('SELECT * FROM trade_payment_attempts WHERE id=$1', [s.payment_id]))
          .rows[0]!;
      if (
        r.transactionId !== p.provider_transaction_id ||
        r.receiver.merchantId !== s.receiver_merchant_id ||
        r.receiver.amountFen !== s.amount_fen
      )
        tradeFail('TRADE_SPLIT_IDENTITY', '原分账交易、接收方或金额不匹配', 422);
      if (['SUCCEEDED', 'RETURNING', 'RETURN_UNKNOWN', 'RETURNED'].includes(s.status)) {
        if (s.provider_order_id !== r.orderId || s.provider_detail_id !== r.receiver.detailId)
          tradeFail('TRADE_SPLIT_IDENTITY', '原分账渠道凭据冲突', 422);
        return;
      }
      if (!['SENDING', 'UNKNOWN', 'PROCESSING'].includes(s.status))
        tradeFail('TRADE_SPLIT_STATE', '原分账未获执行授权');
      const status =
        r.state === 'FINISHED' && r.receiver.result === 'SUCCESS'
          ? 'SUCCEEDED'
          : r.state === 'FINISHED' && r.receiver.result === 'CLOSED'
            ? 'FAILED'
            : 'PROCESSING';
      if (status === 'SUCCEEDED' && !r.receiver.detailId)
        tradeFail('TRADE_SPLIT_IDENTITY', '分账到账凭据缺失', 422);
      await c.query(
        'UPDATE trade_settlements SET status=$2,provider_order_id=$3,provider_detail_id=$4,updated_at=clock_timestamp() WHERE id=$1',
        [s.id, status, r.orderId, r.receiver.detailId],
      );
      if (!source.valid || source.disputed || tradeHash(source.identity) !== ref.source_hash)
        await c.query("UPDATE trade_orders SET status='SOURCE_CONFLICT' WHERE id=$1", [ref.id]);
      await this.bump(c, ref.id);
    });
  }
  async querySettlement(cookie: string | undefined, id: string, sid: string) {
    const x = await this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, id),
        m = this.merchant(ctx.order.org_id, ctx.order),
        s = (
          await c.query<Row>('SELECT * FROM trade_settlements WHERE id=$1 AND order_id=$2', [
            tradeId(sid),
            id,
          ])
        ).rows[0];
      if (!s) throw notFound();
      if (!m?.settlements?.enabled)
        tradeFail('TRADE_SETTLEMENT_DISABLED', '原分账通道尚未配置', 503);
      if (
        ![
          'SENDING',
          'UNKNOWN',
          'PROCESSING',
          'SUCCEEDED',
          'FAILED',
          'RETURNING',
          'RETURN_UNKNOWN',
          'RETURNED',
        ].includes(s.status)
      )
        tradeFail('TRADE_SPLIT_STATE', '原分账尚未派发');
      const p = (
        await c.query<Row>('SELECT * FROM trade_payment_attempts WHERE id=$1', [s.payment_id])
      ).rows[0]!;
      await this.ensureFreshSession(c, ctx.a);
      return { m: m!, s, p, org: ctx.order.org_id };
    });
    await this.applySplit(
      x.org,
      x.m,
      await x.m.settlements!.query({
        transactionId: x.p.provider_transaction_id,
        outOrderNo: x.s.out_order_no,
        receiverMerchantId: x.s.receiver_merchant_id,
        amountFen: x.s.amount_fen,
      }),
    );
    return this.get(cookie, id);
  }
  async returnSettlement(cookie: string | undefined, id: string, sid: string, raw: unknown) {
    const b = objectInput(raw, ['clientRequestId', 'expectedVersion', 'reason']),
      reason = tradeReason(b.reason);
    let intent: { o: Row; s: Row; r: Row; m: TradeMerchant } | undefined;
    const result = await this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, id),
        { a, order: o } = ctx;
      if (!ctx.manage && !ctx.operator) throw forbidden();
      const s = (
        await c.query<Row>(
          'SELECT * FROM trade_settlements WHERE id=$1 AND order_id=$2 FOR UPDATE',
          [tradeId(sid), id],
        )
      ).rows[0];
      if (!s) throw notFound();
      return this.operation(
        c,
        a,
        tradeId(b.clientRequestId),
        { op: 'RETURN_SETTLEMENT', id, sid, ...b },
        id,
        async () => {
          assertTradeVersion(o.version, tradeVersion(b.expectedVersion));
          if (s.status !== 'SUCCEEDED')
            tradeFail('TRADE_RETURN_STATE', '原分账结果尚未确认或回退待查，请核对原编号');
          const m = this.merchant(o.org_id, o);
          if (!m?.settlements?.enabled || !m.settlements.returnSupported)
            tradeFail('TRADE_RETURN_DISABLED', '原分账回退通道未配置，保留退款申请待处理', 503);
          const refund = (
            await c.query(
              "SELECT id FROM trade_refunds WHERE order_id=$1 AND payment_id=$2 AND status='APPROVED'",
              [id, s.payment_id],
            )
          ).rows[0];
          if (!refund)
            tradeFail('TRADE_RETURN_REVIEW_REQUIRED', '须先独立批准原支付退款，再回退该支付分账');
          const rid = randomUUID(),
            r = {
              id: rid,
              out_return_no: 'E4B' + rid.replaceAll('-', ''),
              fence: randomUUID(),
              amount_fen: s.amount_fen - s.return_amount_fen,
            };
          if (r.amount_fen <= 0) tradeFail('TRADE_RETURN_AMOUNT', '原分账已完整回退');
          await c.query(
            `INSERT INTO trade_settlement_returns(id,settlement_id,out_return_no,amount_fen,status,fence,created_by) VALUES($1,$2,$3,$4,'SENDING',$5,$6)`,
            [r.id, sid, r.out_return_no, r.amount_fen, r.fence, a.user.id],
          );
          await c.query(
            "UPDATE trade_settlements SET status='RETURNING',return_no=$2,updated_at=clock_timestamp() WHERE id=$1",
            [sid, r.out_return_no],
          );
          await this.bump(c, id);
          intent = { o, s, r, m: m! };
          return { orderId: id, settlementId: sid, returnId: rid };
        },
      );
    });
    if (!intent) return result;
    const i = intent;
    try {
      await this.applyReturn(
        i.o.org_id,
        i.m,
        await i.m.settlements!.returnFunds({
          outOrderNo: i.s.out_order_no,
          outReturnNo: i.r.out_return_no,
          receiverMerchantId: i.s.receiver_merchant_id,
          amountFen: i.r.amount_fen,
          description: reason.slice(0, 20),
        }),
      );
    } catch (err) {
      await this.transaction(async (c) => {
        await this.source(c, i.o.kind, i.o.source_id, i.o.terms_id);
        await c.query('SELECT id FROM trade_orders WHERE id=$1 FOR UPDATE', [id]);
        await c.query(
          "UPDATE trade_settlement_returns SET status='UNKNOWN',updated_at=clock_timestamp() WHERE id=$1 AND fence=$2 AND status='SENDING'",
          [i.r.id, i.r.fence],
        );
        await c.query(
          "UPDATE trade_settlements SET status='RETURN_UNKNOWN',updated_at=clock_timestamp() WHERE id=$1 AND status='RETURNING'",
          [sid],
        );
        await this.bump(c, id);
      });
      throw err;
    }
    return result;
  }
  private async applyReturn(
    org: string,
    m: TradeMerchant,
    r: import('./trade-provider.js').TradeReturnResult,
  ) {
    await this.transaction(async (c) => {
      const ref = (
        await c.query<Row>(
          'SELECT s.id AS settlement_id,b.id AS return_id,o.* FROM trade_settlement_returns b JOIN trade_settlements s ON s.id=b.settlement_id JOIN trade_orders o ON o.id=s.order_id WHERE b.out_return_no=$1',
          [r.outReturnNo],
        )
      ).rows[0];
      if (!ref || ref.org_id !== org || this.merchant(org, ref) !== m)
        tradeFail('TRADE_RETURN_IDENTITY', '原分账回退商户无法核验', 422);
      await this.source(c, ref.kind, ref.source_id, ref.terms_id);
      await c.query('SELECT id FROM trade_orders WHERE id=$1 FOR UPDATE', [ref.id]);
      const s = (
          await c.query<Row>('SELECT * FROM trade_settlements WHERE id=$1 FOR UPDATE', [
            ref.settlement_id,
          ])
        ).rows[0]!,
        b = (
          await c.query<Row>('SELECT * FROM trade_settlement_returns WHERE id=$1 FOR UPDATE', [
            ref.return_id,
          ])
        ).rows[0]!;
      if (
        r.outOrderNo !== s.out_order_no ||
        r.merchantId !== s.receiver_merchant_id ||
        r.amountFen !== b.amount_fen
      )
        tradeFail('TRADE_RETURN_IDENTITY', '回退来源、接收方或金额不匹配', 422);
      if (b.status === 'SUCCEEDED') {
        if (b.provider_return_id !== r.returnId)
          tradeFail('TRADE_RETURN_IDENTITY', '回退凭据冲突', 422);
        return;
      }
      if (!['SENDING', 'UNKNOWN', 'PROCESSING'].includes(b.status))
        tradeFail('TRADE_RETURN_STATE', '原回退已终结');
      const status =
        r.state === 'SUCCESS' ? 'SUCCEEDED' : r.state === 'FAILED' ? 'FAILED' : 'PROCESSING';
      await c.query(
        'UPDATE trade_settlement_returns SET status=$2,provider_return_id=$3,updated_at=clock_timestamp() WHERE id=$1',
        [b.id, status, r.returnId],
      );
      if (status === 'SUCCEEDED')
        await c.query(
          "UPDATE trade_settlements SET return_amount_fen=return_amount_fen+$2,status='RETURNED',provider_return_id=$3,updated_at=clock_timestamp() WHERE id=$1",
          [s.id, b.amount_fen, r.returnId],
        );
      else
        await c.query(
          'UPDATE trade_settlements SET status=$2,updated_at=clock_timestamp() WHERE id=$1',
          [s.id, status === 'FAILED' ? 'SUCCEEDED' : 'RETURNING'],
        );
      await this.bump(c, ref.id);
    });
  }
  async queryReturn(cookie: string | undefined, id: string, sid: string) {
    const x = await this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, id),
        s = (
          await c.query<Row>('SELECT * FROM trade_settlements WHERE id=$1 AND order_id=$2', [
            tradeId(sid),
            id,
          ])
        ).rows[0];
      if (!s) throw notFound();
      const r = (
        await c.query<Row>(
          'SELECT * FROM trade_settlement_returns WHERE settlement_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
          [sid],
        )
      ).rows[0];
      if (!r) tradeFail('TRADE_RETURN_STATE', '尚无分账回退请求');
      const m = this.merchant(ctx.order.org_id, ctx.order);
      if (!m?.settlements?.enabled || !m.settlements.returnSupported)
        tradeFail('TRADE_RETURN_DISABLED', '原回退通道未配置', 503);
      await this.ensureFreshSession(c, ctx.a);
      return { m: m!, s, r: r!, org: ctx.order.org_id };
    });
    await this.applyReturn(
      x.org,
      x.m,
      await x.m.settlements!.queryReturn({
        outOrderNo: x.s.out_order_no,
        outReturnNo: x.r.out_return_no,
        receiverMerchantId: x.s.receiver_merchant_id,
        amountFen: x.r.amount_fen,
      }),
    );
    return this.get(cookie, id);
  }
  async terms(cookie: string | undefined, org: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      org = tradeId(org);
      if (!(await this.manager(c, a, org)) && !(await this.operator(c, a))) throw notFound();
      const rows = (
        await c.query<Row>(
          'SELECT id,kind,source_id,amount_fen,terms,status,version,created_by,reviewed_by,review_reason FROM trade_terms WHERE org_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
          [org],
        )
      ).rows;
      await this.ensureFreshSession(c, a);
      return { terms: rows, providerConfigured: !!this.merchant(org)?.payments.enabled };
    });
  }
  async createTerms(cookie: string | undefined, org: string, raw: unknown) {
    const b = objectInput(raw, ['clientRequestId', 'kind', 'sourceId', 'amountFen', 'terms']);
    const kind = this.kind(b.kind);
    if (kind === 'PLAYER_APPEARANCE')
      tradeFail('INVALID_TRADE_TERMS', '球员费用沿用原服务报价，不能另设覆盖', 422);
    const source = tradeId(b.sourceId),
      amount = tradeFen(b.amountFen),
      terms = text(b.terms, 'terms', 4, 2000);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      org = tradeId(org);
      if (!(await this.manager(c, a, org))) throw notFound();
      await this.calendar(c, org);
      const owned =
        kind === 'LOCAL_BOOKING'
          ? await c.query('SELECT id FROM local_listings WHERE org_id=$1 AND id=$2 FOR SHARE', [
              org,
              source,
            ])
          : await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
              org,
              source,
            ]);
      if (!owned.rowCount) throw notFound();
      const m = this.merchant(org);
      if (!m?.payments.enabled)
        tradeFail('TRADE_PROVIDER_DISABLED', '实际收款主体未配置，不能发布收费条款', 503);
      return this.operation(
        c,
        a,
        tradeId(b.clientRequestId),
        { op: 'CREATE_TERMS', org, ...b },
        null,
        async () => {
          const id = randomUUID();
          await c.query(
            'INSERT INTO trade_terms(id,org_id,kind,source_id,amount_fen,terms,merchant_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [id, org, kind, source, amount, terms, m!.key, a.user.id],
          );
          return { termsId: id };
        },
      );
    });
  }
  async reviewTerms(cookie: string | undefined, org: string, termId: string, raw: unknown) {
    const b = objectInput(raw, ['clientRequestId', 'expectedVersion', 'decision', 'reason']),
      reason = tradeReason(b.reason);
    if (!['APPROVE', 'REJECT', 'REVOKE'].includes(String(b.decision)))
      tradeFail('INVALID_TRADE_INPUT', '请选择有效审核动作', 422);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      org = tradeId(org);
      if (!(await this.manager(c, a, org)) && !(await this.operator(c, a))) throw notFound();
      await this.calendar(c, org);
      const t = (
        await c.query<Row>('SELECT * FROM trade_terms WHERE id=$1 AND org_id=$2 FOR UPDATE', [
          tradeId(termId),
          org,
        ])
      ).rows[0];
      if (!t) throw notFound();
      if (t.created_by === a.user.id) throw forbidden();
      if (t.kind === 'LOCAL_BOOKING') {
        const l = (
          await c.query<Row>('SELECT provider_user_id FROM local_listings WHERE id=$1', [
            t.source_id,
          ])
        ).rows[0];
        if (l?.provider_user_id === a.user.id) throw forbidden();
      }
      return this.operation(
        c,
        a,
        tradeId(b.clientRequestId),
        { op: 'REVIEW_TERMS', org, termId, ...b },
        null,
        async () => {
          assertTradeVersion(t.version, tradeVersion(b.expectedVersion));
          if (t.status !== (b.decision === 'REVOKE' ? 'ACTIVE' : 'PENDING'))
            tradeFail('TRADE_TERMS_STATE', '原条款状态已变化');
          if (b.decision === 'APPROVE')
            await c.query(
              "UPDATE trade_terms SET status='REVOKED',version=version+1 WHERE org_id=$1 AND kind=$2 AND source_id=$3 AND status='ACTIVE'",
              [org, t.kind, t.source_id],
            );
          await c.query(
            'UPDATE trade_terms SET status=$2,reviewed_by=$3,review_reason=$4,reviewed_at=clock_timestamp(),version=version+1 WHERE id=$1',
            [
              termId,
              b.decision === 'APPROVE'
                ? 'ACTIVE'
                : b.decision === 'REVOKE'
                  ? 'REVOKED'
                  : 'REJECTED',
              a.user.id,
              reason,
            ],
          );
          await this.audit(c, a.user.id, org, 'TRADE_TERMS_REVIEWED', 'trade_terms', termId, {
            decision: b.decision,
          });
          return { termsId: termId };
        },
      );
    });
  }
  async reconcile(cookie: string | undefined, org: string, raw: unknown) {
    const b = objectInput(raw, ['clientRequestId', 'date']),
      date = calendarDate(b.date, 'date'),
      command = tradeId(b.clientRequestId);
    const initial = await this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      org = tradeId(org);
      if (!(await this.manager(c, a, org)) && !(await this.operator(c, a))) throw notFound();
      const m = this.merchant(org);
      if (!m?.payments.enabled) tradeFail('TRADE_PROVIDER_DISABLED', '实际对账商户未配置', 503);
      await this.ensureFreshSession(c, a);
      return { m: m!, actor: a };
    });
    const bill = await initial.m.payments.downloadBill(date);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      if (
        a.sessionId !== initial.actor.sessionId ||
        a.user.id !== initial.actor.user.id ||
        (!(await this.manager(c, a, org)) && !(await this.operator(c, a)))
      )
        throw forbidden();
      if (this.merchant(org) !== initial.m)
        tradeFail('TRADE_PROVIDER_CHANGED', '对账商户配置已变化');
      return this.operation(c, a, command, { op: 'RECONCILE', org, ...b }, null, async () => {
        const payments = (
          await c.query<Row>(
            `SELECT p.*,o.merchant_key FROM trade_payment_attempts p JOIN trade_orders o ON o.id=p.order_id WHERE o.org_id=$1 AND o.merchant_key=$2 AND p.status='PAID' AND (p.paid_at AT TIME ZONE 'Asia/Shanghai')::date=$3::date`,
            [org, initial.m.key, date],
          )
        ).rows;
        const refunds = (
          await c.query<Row>(
            `SELECT r.*,p.out_trade_no,p.provider_transaction_id FROM trade_refunds r JOIN trade_payment_attempts p ON p.id=r.payment_id JOIN trade_orders o ON o.id=r.order_id WHERE o.org_id=$1 AND o.merchant_key=$2 AND r.status='SUCCEEDED' AND (r.success_at AT TIME ZONE 'Asia/Shanghai')::date=$3::date`,
            [org, initial.m.key, date],
          )
        ).rows;
        const expected: WechatPayBillRow[] = [
          ...payments.map((p) => ({
            outTradeNo: p.out_trade_no,
            transactionId: p.provider_transaction_id,
            totalFen: p.total_fen,
            tradeState: 'SUCCESS' as const,
            outRefundNo: null,
            refundId: null,
            refundFen: null,
            refundState: null,
          })),
          ...refunds.map((r) => ({
            outTradeNo: r.out_trade_no,
            transactionId: r.provider_transaction_id,
            totalFen: null,
            tradeState: 'REFUND' as const,
            outRefundNo: r.out_refund_no,
            refundId: r.provider_refund_id,
            refundFen: r.amount_fen,
            refundState: 'SUCCESS',
          })),
        ];
        const scoped = bill.rows.filter((r) => r.outTradeNo.startsWith('E4')),
          result = reconcileWechatPayBill(scoped, expected),
          id = randomUUID();
        await c.query(
          'INSERT INTO trade_reconciliations(id,org_id,merchant_key,bill_date,body_hash,result,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(merchant_key,bill_date,body_hash) DO NOTHING',
          [
            id,
            org,
            initial.m.key,
            date,
            bill.bodyHash,
            JSON.stringify({
              ...result,
              scope: 'E04_BUSINESS_ONLY',
              ignoredNonTradeRows: bill.rows.length - scoped.length,
            }),
            a.user.id,
          ],
        );
        return { reconciliation: result, date, scope: 'E04_BUSINESS_ONLY' };
      });
    });
  }
  async notification(
    merchantKey: string,
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const all = [
      ...Object.entries(this.runtime.merchants ?? {}),
      ...Object.entries(this.runtime.historicalMerchants ?? {}).map(
        ([k, m]) => [k.split(':')[0]!, m] as [string, TradeMerchant],
      ),
    ];
    const matches = all.filter(
      ([org, m], i) =>
        m.key === merchantKey && all.findIndex(([o, p]) => o === org && p === m) === i,
    );
    if (matches.length !== 1) tradeFail('TRADE_PROVIDER_DISABLED', '通知收款主体未配置', 503);
    const [org, m] = matches[0]!,
      event = m.payments.verifyNotification(raw, headers),
      hash = tradeHash(event);
    // An already received event is never a shortcut around verified provider identity.
    await this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'e04-event:' + merchantKey + ':' + event.id,
      ]);
      const old = (
        await c.query<Row>(
          'SELECT event_hash FROM trade_provider_events WHERE merchant_key=$1 AND event_id=$2',
          [merchantKey, event.id],
        )
      ).rows[0];
      if (old && old.event_hash !== hash)
        tradeFail('TRADE_NOTIFICATION_CONFLICT', '通知编号内容冲突', 422);
      if (old) return;
      if (event.kind === 'PAYMENT') await this.applyPayment(org, m, event.payment, c);
      else await this.applyRefund(org, m, event.refund, c);
      await c.query(
        'INSERT INTO trade_provider_events(merchant_key,event_id,event_hash,kind) VALUES($1,$2,$3,$4) ON CONFLICT(merchant_key,event_id) DO NOTHING',
        [merchantKey, event.id, hash, event.kind],
      );
    });
  }
  /** Called inside source creation, after canonical source rows exist and before COMMIT. */
  async captureSourceCharge(
    c: PoolClient,
    actor: Actor,
    input: {
      kind: TradeSourceKind;
      sourceId: string;
      acceptedTermsId?: string;
      chargeConsent: boolean;
    },
  ): Promise<string | null> {
    if (!Object.keys(this.runtime.merchants ?? {}).length) return null;
    const sourceId = tradeId(input.sourceId);
    const ref =
      input.kind === 'LOCAL_BOOKING'
        ? (
            await c.query<Row>(
              'SELECT org_id,listing_id AS anchor FROM local_bookings WHERE id=$1',
              [sourceId],
            )
          ).rows[0]
        : input.kind === 'PLAYER_APPEARANCE'
          ? (
              await c.query<Row>(
                'SELECT o.org_id FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id WHERE a.id=$1',
                [sourceId],
              )
            ).rows[0]
          : (
              await c.query<Row>('SELECT org_id,event_id AS anchor FROM entries WHERE id=$1', [
                sourceId,
              ])
            ).rows[0];
    if (!ref || !this.merchant(ref.org_id)?.payments.enabled) return null;
    if (input.kind === 'PLAYER_APPEARANCE' && !this.merchant(ref.org_id)?.playerFeesEnabled)
      return null;
    if (
      input.kind !== 'PLAYER_APPEARANCE' &&
      !(
        await c.query(
          "SELECT id FROM trade_terms WHERE org_id=$1 AND kind=$2 AND source_id=$3 AND status='ACTIVE'",
          [ref.org_id, input.kind, ref.anchor],
        )
      ).rowCount
    )
      return null;
    const source = await this.source(c, input.kind, sourceId);
    const m = this.merchant(source.orgId);
    if (!m?.payments.enabled) return null;
    if (
      !input.chargeConsent ||
      input.acceptedTermsId !==
        (input.kind === 'PLAYER_APPEARANCE' ? source.consentId : source.termsId)
    )
      tradeFail('TRADE_EXPLICIT_CONSENT_REQUIRED', '请明确核对当前收费条款和实际收款主体', 422);
    if (!(await this.mayPay(c, actor, source))) throw forbidden();
    const existing = (
      await c.query<Row>('SELECT id FROM trade_orders WHERE kind=$1 AND source_id=$2', [
        input.kind,
        input.sourceId,
      ])
    ).rows[0];
    if (existing) return existing.id;
    if (!this.runtime.encryptionKey || source.merchantKey !== m.key)
      tradeFail('TRADE_PROVIDER_DISABLED', '收费配置未就绪，不会降级伪造付款', 503);
    const id = randomUUID(),
      quote = this.quoteDto(input.kind, input.sourceId, source);
    await c.query(
      `INSERT INTO trade_orders(id,org_id,kind,source_id,source_version,source_snapshot,source_hash,payer_user_id,beneficiary_user_id,terms_id,merchant_key,merchant_id,merchant_app_id,merchant_name,total_fen,quote) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
      [
        id,
        source.orgId,
        input.kind,
        input.sourceId,
        source.version,
        JSON.stringify(source.identity),
        tradeHash(source.identity),
        actor.user.id,
        source.beneficiaryId,
        source.termsId,
        m.key,
        m.merchantId,
        m.appId,
        m.displayName,
        source.totalFen,
        JSON.stringify(quote),
      ],
    );
    return id;
  }
  /** Old free sources have no binding and remain free; a later fee publication cannot retrocharge them. */
  async assertSourceFinancialGate(
    c: PoolClient,
    kind: TradeSourceKind,
    sourceId: string,
  ): Promise<void> {
    if (!Object.keys(this.runtime.merchants ?? {}).length) return;
    const order = (
      await c.query<Row>('SELECT * FROM trade_orders WHERE kind=$1 AND source_id=$2 FOR SHARE', [
        kind,
        sourceId,
      ])
    ).rows[0];
    if (!order) return;
    const paid = (
      await c.query<Row>(
        "SELECT COALESCE(sum(total_fen),0)::bigint AS n FROM trade_payment_attempts WHERE order_id=$1 AND status='PAID'",
        [order.id],
      )
    ).rows[0];
    const refunded = (
      await c.query<Row>(
        "SELECT COALESCE(sum(amount_fen),0)::bigint AS n FROM trade_refunds WHERE order_id=$1 AND status NOT IN('REJECTED','FAILED')",
        [order.id],
      )
    ).rows[0];
    if (
      order.status === 'SOURCE_CONFLICT' ||
      Number(paid!.n) - Number(refunded!.n) < order.total_fen
    )
      tradeFail('TRADE_PAYMENT_REQUIRED', '本项收费尚未由服务端确认，或存在退款/资金冲突');
  }
}
