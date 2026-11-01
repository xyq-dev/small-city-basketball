import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  DispatchCapabilities,
  DispatchOfferData,
  DispatchQuote,
  DispatchRequestData,
} from '../../../packages/contracts/dispatch.js';
import type { LocalPoint, LocalRegion } from '../../../packages/contracts/local-services.js';
import { ApplicationService, isAdministrator } from './service.js';
import type { Actor, ApiOptions } from './service.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { invalid, resourceId } from './validation.js';
import { localHash, localCommandId } from './local-services-domain.js';
import { assertCurrentRegionVersion } from './region-catalog-domain.js';
import {
  DISPATCH_BATCH_SIZE,
  DISPATCH_HOLD_MINUTES,
  DISPATCH_MAX_BATCHES,
  dispatchFail,
  parseDispatchCommand,
  parseDispatchPreference,
  parseDispatchQuote,
  parseDispatchRequest,
} from './dispatch-domain.js';

type Row = Record<string, any>;
const iso = (v: Date | string) => new Date(v).toISOString();
const pendingOffers = ['PENDING', 'TRAVEL_REVIEW', 'READY'];
const sourceEnded = ['DECLINED', 'CANCELLED', 'EXPIRED', 'COMPLETED'];
export interface DispatchSourceInput {
  commandId: string;
  listingId: string;
  slotId: string;
  serviceRegion: LocalRegion;
  serviceAddress: string;
  servicePoint: LocalPoint | null;
  acceptedTerms: true;
  acceptedTermsId: string;
  chargeConsent: boolean;
  verifiedDispatchQuote: { offerId: string; quoteHash: string };
}
export interface DispatchOptions {
  enabled?: boolean;
  autoDispatch?: boolean;
  /** Must create the real X12 source in this transaction and validate persisted quote/merchant. */
  createLocalBooking?: (
    c: PoolClient,
    actor: Actor,
    input: DispatchSourceInput,
  ) => Promise<{ resourceId: string; version: number }>;
}

/** Cross-city invitation/quote state. Financial facts remain in the canonical trade service. */
export class DispatchService extends ApplicationService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private workerRunning = false;
  private workerClosed = false;
  constructor(
    pool: Pool,
    options: ApiOptions,
    readonly dispatchOptions: DispatchOptions = {},
  ) {
    super(pool, options);
    if (
      dispatchOptions.enabled &&
      dispatchOptions.autoDispatch &&
      options.backgroundWorkersEnabled !== false
    ) {
      this.timer = setInterval(() => {
        void this.dispatchDue().catch(() => undefined);
      }, 10000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    this.close();
  }
  close() {
    this.workerClosed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  capabilities(): DispatchCapabilities {
    return {
      enabled: this.dispatchOptions.enabled === true,
      conversionEnabled:
        this.dispatchOptions.enabled === true && !!this.dispatchOptions.createLocalBooking,
      maxBatches: DISPATCH_MAX_BATCHES,
      batchSize: DISPATCH_BATCH_SIZE,
      holdMinutes: DISPATCH_HOLD_MINUTES,
      externalNotifications: false,
    };
  }
  private async enabled(c: PoolClient) {
    if (!this.dispatchOptions.enabled) dispatchFail('DISPATCH_DISABLED', '跨城派单尚未开放', 503);
    if (
      (
        await c.query(
          "SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore' LIMIT 1",
        )
      ).rowCount
    )
      dispatchFail('RESTORE_QUARANTINE', '恢复核验中，派单外发与转单暂停', 503);
  }
  private async manager(c: PoolClient, actor: Actor, org: string) {
    const ctx = await this.lockOrganization(c, actor, org);
    if (!isAdministrator(ctx.role)) throw forbidden();
  }
  private async mutex(c: PoolClient, orgIds: string[]) {
    const ids = [...new Set(orgIds)].sort();
    for (const id of ids)
      await c.query('INSERT INTO org_schedule_mutex(org_id) VALUES($1) ON CONFLICT DO NOTHING', [
        id,
      ]);
    await c.query(
      'SELECT org_id FROM org_schedule_mutex WHERE org_id=ANY($1::uuid[]) ORDER BY org_id FOR UPDATE',
      [ids],
    );
    await c.query('SELECT x12_calendar_lock()');
    await c.query('SELECT x12_release_expired()');
    // Releasing stale dispatch reservations is safe for all source writers under this same mutex.
    await c.query(
      "UPDATE local_resource_reservations r SET active=false FROM dispatch_holds h WHERE r.dispatch_offer_id=h.offer_id AND r.active AND h.state='ACTIVE' AND h.expires_at<=clock_timestamp()",
    );
  }
  private async operation(
    c: PoolClient,
    actor: Actor,
    commandId: string,
    payload: unknown,
    work: () => Promise<Row>,
  ) {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('r6-dispatch:'||$1,0))", [
      actor.user.id + ':' + commandId,
    ]);
    const hash = localHash(payload),
      old = (
        await c.query(
          'SELECT request_hash,result FROM dispatch_command_receipts WHERE actor_id=$1 AND command_id=$2',
          [actor.user.id, commandId],
        )
      ).rows[0];
    if (old) {
      if (old.request_hash !== hash) dispatchFail('COMMAND_ID_REUSED', '操作编号已用于其他内容');
      await this.ensureFreshSession(c, actor);
      return old.result;
    }
    const result = await work();
    await c.query(
      'INSERT INTO dispatch_command_receipts(actor_id,command_id,request_hash,result) VALUES($1,$2,$3,$4)',
      [actor.user.id, commandId, hash, result],
    );
    await this.ensureFreshSession(c, actor);
    return result;
  }
  private async event(
    c: PoolClient,
    request: string | null,
    offer: string | null,
    actor: string | null,
    action: string,
    version: number,
    reason: string,
  ) {
    await c.query(
      'INSERT INTO dispatch_events(id,request_id,offer_id,actor_id,action,version,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(), request, offer, actor, action, version, reason],
    );
  }
  private async req(c: PoolClient, id: string, lock = false): Promise<Row> {
    const row = (
      await c.query(
        `SELECT r.*,w.hold_expires_at AS winner_expires_at,clock_timestamp() AS db_now FROM dispatch_requests r LEFT JOIN dispatch_offers w ON w.id=r.winner_offer_id WHERE r.id=$1 ${lock ? 'FOR UPDATE OF r' : ''}`,
        [resourceId(id)],
      )
    ).rows[0];
    if (!row) throw notFound();
    return row;
  }
  private async offer(c: PoolClient, id: string, lock = false): Promise<Row> {
    const row = (
      await c.query(
        `SELECT o.*,l.org_id AS listing_org_id,l.title AS listing_title FROM dispatch_offers o JOIN local_listings l ON l.id=o.listing_id WHERE o.id=$1 ${lock ? 'FOR UPDATE OF o' : ''}`,
        [resourceId(id)],
      )
    ).rows[0];
    if (!row) throw notFound();
    return row;
  }
  private version(row: Row, n: number) {
    if (row.version !== n) dispatchFail('VERSION_CONFLICT', '资料已变化，请重新读取并确认');
  }
  private async owner(c: PoolClient, actor: Actor, r: Row) {
    if (r.owner_user_id !== actor.user.id) throw notFound();
    await this.manager(c, actor, r.org_id);
  }
  private async provider(c: PoolClient, actor: Actor, o: Row) {
    if (o.provider_user_id !== actor.user.id) throw notFound();
    if (
      !(
        await c.query("SELECT 1 FROM organizations WHERE id=$1 AND status='ACTIVE'", [
          o.listing_org_id,
        ])
      ).rowCount
    )
      throw notFound();
  }
  private async reviewer(c: PoolClient, actor: Actor, o: Row, r: Row) {
    if ([o.provider_user_id, r.owner_user_id].includes(actor.user.id)) throw forbidden();
    await this.manager(c, actor, o.listing_org_id);
  }
  private async region(c: PoolClient, region: LocalRegion) {
    assertCurrentRegionVersion(region.catalogVersion);
    if (
      !(
        await c.query(
          'SELECT 1 FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=$2',
          [region.catalogVersion, region.regionId],
        )
      ).rowCount
    )
      invalid('服务地区不在当前目录');
  }
  private async covered(c: PoolClient, version: string, id: string, allowed: string[]) {
    return !!(
      await c.query(
        `WITH RECURSIVE a AS (SELECT region_id,parent_region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=$2 UNION ALL SELECT n.region_id,n.parent_region_id FROM region_catalog_nodes n JOIN a ON n.region_id=a.parent_region_id WHERE n.catalog_version=$1) SELECT 1 FROM a WHERE region_id=ANY($3::uuid[])`,
        [version, id, allowed],
      )
    ).rowCount;
  }
  private async supply(c: PoolClient, o: Row, r: Row, checkQuote = false) {
    assertCurrentRegionVersion(r.region_catalog_version);
    const l = (
      await c.query(
        `SELECT l.*,u.status AS user_status,g.status AS org_status FROM local_listings l JOIN users u ON u.id=l.provider_user_id JOIN organizations g ON g.id=l.org_id WHERE l.id=$1 FOR SHARE OF l,u,g`,
        [o.listing_id],
      )
    ).rows[0];
    if (
      !l ||
      l.status !== 'APPROVED' ||
      !l.published ||
      !l.provider_confirmed ||
      l.user_status !== 'ACTIVE' ||
      l.org_status !== 'ACTIVE' ||
      l.kind !== r.kind ||
      l.provider_user_id !== o.provider_user_id ||
      l.version !== o.listing_version ||
      !l.qualified_until ||
      new Date(l.qualified_until) < new Date(r.ends_at)
    )
      dispatchFail('DISPATCH_SUPPLY_CHANGED', '人员资质、公开状态或供给版本已变化');
    const p = (
      await c.query('SELECT * FROM dispatch_preferences WHERE provider_user_id=$1 FOR SHARE', [
        o.provider_user_id,
      ])
    ).rows[0];
    if (
      !p?.enabled ||
      !(await this.covered(c, r.region_catalog_version, r.service_region_id, p.region_ids)) ||
      !(await this.covered(
        c,
        r.region_catalog_version,
        r.service_region_id,
        l.coverage_region_ids,
      )) ||
      !(await this.covered(c, r.region_catalog_version, l.region_id, r.invite_region_ids))
    )
      dispatchFail('DISPATCH_SCOPE_CHANGED', '跨城许可或已审核覆盖范围不再满足');
    if (checkQuote) {
      const q = o.quote as DispatchQuote;
      const slot = (
        await c.query('SELECT * FROM local_slots WHERE id=$1 AND listing_id=$2 FOR SHARE', [
          q.slotId,
          l.id,
        ])
      ).rows[0];
      if (
        !slot ||
        slot.status !== 'OPEN' ||
        iso(slot.starts_at) !== iso(r.starts_at) ||
        iso(slot.ends_at) !== iso(r.ends_at)
      )
        dispatchFail('DISPATCH_SLOT_CHANGED', '所选时隙已变化或不覆盖明确服务时段');
      if (new Date(q.protectedStartsAt) <= new Date(r.db_now))
        dispatchFail('DISPATCH_TRAVEL_TOO_LATE', '出发准备时间已到，不能继续自动确认');
      await this.price(c, l, q);
    }
    return l;
  }
  private async price(c: PoolClient, l: Row, q: DispatchQuote) {
    const term = (
      await c.query(
        "SELECT * FROM trade_terms WHERE org_id=$1 AND kind='LOCAL_BOOKING' AND source_id=$2 AND status='ACTIVE' FOR SHARE",
        [l.org_id, l.id],
      )
    ).rows[0];
    if (q.platformMinor !== 0)
      dispatchFail('DISPATCH_FEE_POLICY', '当前同城合同无额外平台费政策，不能自行增加平台费用');
    if (q.totalMinor === 0) {
      if (term) dispatchFail('DISPATCH_FEE_CHANGED', '该服务有已审核收费条款，不能按免费处理');
      return { baseTermsId: null, baseTermsVersion: null, merchantKey: null };
    }
    if (!term || q.serviceMinor !== term.amount_fen)
      dispatchFail('DISPATCH_FEE_CHANGED', '服务费必须等于当前独立审核的收费条款');
    if (
      q.baseTermsId !== undefined &&
      (q.baseTermsId !== term.id ||
        q.baseTermsVersion !== term.version ||
        q.merchantKey !== term.merchant_key)
    )
      dispatchFail('DISPATCH_FEE_CHANGED', '报价所绑定的收费条款或商户已变化');
    return {
      baseTermsId: term.id as string,
      baseTermsVersion: term.version as number,
      merchantKey: term.merchant_key as string,
    };
  }
  private requestDto(r: Row, actor: string): DispatchRequestData {
    const status =
      !r.source_booking_id &&
      !['CANCELLED', 'EXPIRED'].includes(r.status) &&
      new Date(r.expires_at) <= new Date(r.db_now ?? Date.now())
        ? 'EXPIRED'
        : r.status;
    return {
      id: r.id,
      orgId: r.org_id,
      kind: r.kind,
      status,
      version: r.version,
      serviceRegion: { catalogVersion: r.region_catalog_version, regionId: r.service_region_id },
      serviceAddress: r.service_address,
      servicePoint: r.service_point,
      startsAt: iso(r.starts_at),
      endsAt: iso(r.ends_at),
      expiresAt: iso(r.expires_at),
      budget: r.budget,
      inviteRegionIds: r.invite_region_ids,
      batchCount: r.batch_count,
      maxBatches: r.max_batches,
      batchSize: r.batch_size,
      sourceBookingId: r.source_booking_id,
      winnerOfferId: r.winner_offer_id,
      reason: r.reason,
      canManage:
        actor === r.owner_user_id &&
        !r.source_booking_id &&
        !['CANCELLED', 'EXPIRED'].includes(status),
      canConfirm:
        actor === r.owner_user_id &&
        status === 'REVIEWING' &&
        (!r.winner_expires_at ||
          new Date(r.winner_expires_at) > new Date(r.db_now ?? Date.now())) &&
        !!this.dispatchOptions.createLocalBooking,
    };
  }
  private async offerDto(c: PoolClient, o: Row, r: Row, actor: Actor): Promise<DispatchOfferData> {
    const now = new Date(r.db_now ?? Date.now());
    const expired =
      !['CONVERTED', 'WITHDRAWN', 'DECLINED', 'SUPERSEDED'].includes(o.status) &&
      new Date(o.hold_expires_at ?? o.expires_at) <= now;
    const status = expired ? 'EXPIRED' : o.status;
    let supplyValid = true;
    if (actor.user.id !== r.owner_user_id && status !== 'CONVERTED') {
      try {
        await this.supply(c, o, r);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        supplyValid = false;
      }
    }
    const locationVisible =
      actor.user.id === r.owner_user_id ||
      status === 'CONVERTED' ||
      (supplyValid &&
        !expired &&
        ['INVITING', 'REVIEWING'].includes(r.status) &&
        pendingOffers.concat('ACCEPTED_HELD').includes(status));
    const request = this.requestDto(r, actor.user.id);
    if (!locationVisible) {
      request.serviceAddress = '邀请已结束，具体服务地点已收回';
      request.servicePoint = null;
    }
    const quote =
      !locationVisible && o.quote
        ? {
            ...o.quote,
            travelMethod: '行程已收回',
            travelEvidence: '邀请已结束，具体行程凭据已收回',
            terms: '邀请已结束，完整条款由授权方保留',
          }
        : o.quote;
    let canReviewTravel = false;
    if (supplyValid && status === 'TRAVEL_REVIEW' && r.status === 'INVITING')
      try {
        await this.reviewer(c, actor, o, r);
        canReviewTravel = true;
      } catch (e) {
        if (!(e instanceof ApiError) || ![403, 404].includes(e.status)) throw e;
      }
    return {
      id: o.id,
      requestId: o.request_id,
      listingId: o.listing_id,
      listingTitle: o.listing_title,
      status,
      version: o.version,
      expiresAt: iso(o.expires_at),
      quote,
      locationVisible,
      quoteHash: o.quote_hash,
      travelVerified: !!o.travel_verified_by,
      holdExpiresAt: o.hold_expires_at ? iso(o.hold_expires_at) : null,
      sourceBookingId: o.source_booking_id,
      canQuote:
        supplyValid &&
        o.provider_user_id === actor.user.id &&
        status === 'PENDING' &&
        r.status === 'INVITING',
      canReviewTravel,
      canAccept:
        supplyValid &&
        o.provider_user_id === actor.user.id &&
        status === 'READY' &&
        r.status === 'INVITING',
      canWithdraw:
        o.provider_user_id === actor.user.id &&
        ['INVITING', 'REVIEWING'].includes(r.status) &&
        ['PENDING', 'TRAVEL_REVIEW', 'READY', 'ACCEPTED_HELD'].includes(status),
      request,
    };
  }
  async workspace(cookie?: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const requests = (
        await c.query(
          "SELECT r.*,clock_timestamp() AS db_now FROM dispatch_requests r JOIN organization_memberships m ON m.org_id=r.org_id AND m.user_id=$1 AND m.status='ACTIVE' AND m.role IN ('ORG_OWNER','ORG_ADMIN') WHERE r.owner_user_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 101",
          [a.user.id],
        )
      ).rows;
      const offers = (
        await c.query(
          `SELECT o.*,l.org_id AS listing_org_id,l.title AS listing_title FROM dispatch_offers o JOIN local_listings l ON l.id=o.listing_id WHERE o.provider_user_id=$1 OR (o.status='TRAVEL_REVIEW' AND EXISTS(SELECT 1 FROM organization_memberships m WHERE m.org_id=l.org_id AND m.user_id=$1 AND m.status='ACTIVE' AND m.role IN ('ORG_OWNER','ORG_ADMIN'))) ORDER BY o.created_at DESC,o.id DESC LIMIT 101`,
          [a.user.id],
        )
      ).rows;
      const pref = (
        await c.query(
          'SELECT enabled,region_ids,version,daily_limit FROM dispatch_preferences WHERE provider_user_id=$1',
          [a.user.id],
        )
      ).rows[0];
      const mapped = [];
      for (const o of offers.slice(0, 100))
        mapped.push(await this.offerDto(c, o, await this.req(c, o.request_id), a));
      return {
        capabilities: this.capabilities(),
        requests: requests.slice(0, 100).map((r) => this.requestDto(r, a.user.id)),
        offers: mapped,
        truncated: requests.length > 100 || offers.length > 100,
        preference: pref
          ? {
              enabled: pref.enabled,
              regionIds: pref.region_ids,
              version: pref.version,
              dailyLimit: pref.daily_limit,
            }
          : null,
      };
    });
  }
  async receipt(cookie: string | undefined, id: string) {
    localCommandId(id);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const r = (
        await c.query(
          'SELECT result FROM dispatch_command_receipts WHERE actor_id=$1 AND command_id=$2',
          [a.user.id, id],
        )
      ).rows[0];
      if (!r) throw notFound();
      return r.result;
    });
  }
  async detail(cookie: string | undefined, id: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        r = await this.req(c, id);
      await this.owner(c, a, r);
      const offers = (
        await c.query(
          'SELECT o.*,l.org_id AS listing_org_id,l.title AS listing_title FROM dispatch_offers o JOIN local_listings l ON l.id=o.listing_id WHERE o.request_id=$1 ORDER BY o.created_at,o.id',
          [r.id],
        )
      ).rows;
      const mapped = [];
      for (const o of offers) mapped.push(await this.offerDto(c, o, r, a));
      return { request: this.requestDto(r, a.user.id), offers: mapped };
    });
  }
  async offerDetail(cookie: string | undefined, id: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        o = await this.offer(c, id),
        r = await this.req(c, o.request_id);
      if (a.user.id === r.owner_user_id) await this.owner(c, a, r);
      else if (a.user.id === o.provider_user_id) await this.provider(c, a, o);
      else await this.reviewer(c, a, o, r);
      await this.event(
        c,
        r.id,
        o.id,
        a.user.id,
        'VIEW_ROUTE',
        o.version,
        '查看获授权的服务地点与行程',
      );
      return this.offerDto(c, o, r, a);
    });
  }
  async preference(cookie: string | undefined, raw: unknown) {
    const i = parseDispatchPreference(raw);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.enabled(c);
      const listings = (
        await c.query("SELECT * FROM local_listings WHERE provider_user_id=$1 AND kind<>'COURT'", [
          a.user.id,
        ])
      ).rows;
      if (!listings.length) dispatchFail('DISPATCH_NO_SUPPLY', '请先建立并审核人员服务');
      await this.mutex(
        c,
        listings.map((l) => l.org_id),
      );
      return this.operation(c, a, i.commandId, { preference: i }, async () => {
        const old = (
          await c.query('SELECT * FROM dispatch_preferences WHERE provider_user_id=$1 FOR UPDATE', [
            a.user.id,
          ])
        ).rows[0];
        if ((old?.version ?? 0) !== i.expectedVersion)
          dispatchFail('VERSION_CONFLICT', '接单偏好已变化');
        for (const id of i.regionIds) {
          let allowed = false;
          for (const l of listings)
            if (
              l.status === 'APPROVED' &&
              l.published &&
              l.provider_confirmed &&
              (await this.covered(c, l.region_catalog_version, id, l.coverage_region_ids))
            ) {
              allowed = true;
              break;
            }
          if (!allowed && i.enabled)
            dispatchFail('DISPATCH_OUTSIDE_COVERAGE', '跨城偏好不能扩大已审核覆盖地区');
        }
        await c.query(
          'INSERT INTO dispatch_preferences(provider_user_id,enabled,region_ids,daily_limit) VALUES($1,$2,$3,$4) ON CONFLICT(provider_user_id) DO UPDATE SET enabled=EXCLUDED.enabled,region_ids=EXCLUDED.region_ids,daily_limit=EXCLUDED.daily_limit,version=dispatch_preferences.version+1,updated_at=clock_timestamp()',
          [a.user.id, i.enabled, i.regionIds, i.dailyLimit],
        );
        await this.event(
          c,
          null,
          null,
          a.user.id,
          'PREFERENCE',
          i.expectedVersion + 1,
          '本人明确更新跨城许可',
        );
        return {
          resourceType: 'DISPATCH_PREFERENCE',
          resourceId: a.user.id,
          version: i.expectedVersion + 1,
        };
      });
    });
  }
  async create(cookie: string | undefined, raw: unknown) {
    const i = parseDispatchRequest(raw);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.manager(c, a, i.orgId);
      await this.enabled(c);
      await this.mutex(c, [i.orgId]);
      return this.operation(c, a, i.commandId, { create: i }, async () => {
        await this.region(c, i.serviceRegion);
        for (const id of i.inviteRegionIds)
          await this.region(c, { catalogVersion: i.serviceRegion.catalogVersion, regionId: id });
        const now = (await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
        if (new Date(i.expiresAt) <= now) invalid('邀请截止必须为未来时间');
        const id = randomUUID();
        await c.query(
          'INSERT INTO dispatch_requests(id,org_id,owner_user_id,kind,region_catalog_version,service_region_id,service_address,service_point,starts_at,ends_at,expires_at,budget,invite_region_ids,allow_cross_city) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)',
          [
            id,
            i.orgId,
            a.user.id,
            i.kind,
            i.serviceRegion.catalogVersion,
            i.serviceRegion.regionId,
            i.serviceAddress,
            i.servicePoint,
            i.startsAt,
            i.endsAt,
            i.expiresAt,
            i.budget,
            i.inviteRegionIds,
          ],
        );
        await this.event(
          c,
          id,
          null,
          a.user.id,
          'CREATE',
          1,
          '本人确认真实服务地点、跨城范围及费用上限',
        );
        return { resourceType: 'DISPATCH_REQUEST', resourceId: id, version: 1 };
      });
    });
  }
  private async release(c: PoolClient, o: Row, status: string, reason: string) {
    await c.query(
      'UPDATE local_resource_reservations SET active=false WHERE dispatch_offer_id=$1 AND active',
      [o.id],
    );
    await c.query(
      "UPDATE dispatch_holds SET state='RELEASED' WHERE offer_id=$1 AND state='ACTIVE'",
      [o.id],
    );
    await c.query(
      'UPDATE dispatch_offers SET status=$2,reason=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
      [o.id, status, reason],
    );
  }
  private async expire(c: PoolClient, r: Row) {
    if (r.source_booking_id) return r;
    if (['CANCELLED', 'EXPIRED'].includes(r.status)) return r;
    const now = (await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const ended = new Date(r.expires_at) <= now;
    if (r.winner_offer_id) {
      const o = await this.offer(c, r.winner_offer_id, true);
      if (ended || (o.hold_expires_at && new Date(o.hold_expires_at) <= now)) {
        await this.release(c, o, 'EXPIRED', '报价确认期限已过');
        await c.query(
          'UPDATE dispatch_requests SET status=$2,winner_offer_id=NULL,next_batch_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1',
          [r.id, ended ? 'EXPIRED' : 'INVITING'],
        );
      }
    } else if (ended)
      await c.query(
        "UPDATE dispatch_requests SET status='EXPIRED',next_batch_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [r.id],
      );
    await c.query(
      "UPDATE dispatch_offers SET status='EXPIRED',reason='邀请已过期',version=version+1,updated_at=clock_timestamp() WHERE request_id=$1 AND status=ANY($2::text[]) AND (expires_at<=clock_timestamp() OR $3)",
      [r.id, pendingOffers, ended],
    );
    return this.req(c, r.id, true);
  }
  private async nextBatch(c: PoolClient, r: Row) {
    assertCurrentRegionVersion(r.region_catalog_version);
    if (
      !['DRAFT', 'INVITING', 'PAUSED'].includes(r.status) ||
      r.winner_offer_id ||
      r.source_booking_id
    )
      dispatchFail('DISPATCH_STATE_CONFLICT', '当前任务不能继续发出邀请');
    if (new Date(r.expires_at) <= new Date(r.db_now))
      dispatchFail('DISPATCH_EXPIRED', '需求已过期');
    if (
      (
        await c.query(
          'SELECT 1 FROM dispatch_offers WHERE request_id=$1 AND status=ANY($2::text[]) AND expires_at>clock_timestamp()',
          [r.id, pendingOffers],
        )
      ).rowCount
    )
      dispatchFail('DISPATCH_BATCH_PENDING', '当前批次仍在邀请或审核中');
    if (r.batch_count >= r.max_batches) {
      await c.query(
        "UPDATE dispatch_requests SET status='NEEDS_MANUAL',next_batch_at=NULL,reason='已达到邀请批次上限',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [r.id],
      );
      return;
    }
    // Apply both regional permissions before the bounded result. A scan limit must not
    // hide later eligible people and falsely claim that real supply does not exist.
    const selected = (
      await c.query(
        `WITH RECURSIVE target AS (
      SELECT region_id,parent_region_id FROM region_catalog_nodes WHERE catalog_version=$4 AND region_id=$7
      UNION ALL SELECT n.region_id,n.parent_region_id FROM region_catalog_nodes n JOIN target t ON t.parent_region_id=n.region_id WHERE n.catalog_version=$4
    ), origins AS (
      SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$4 AND region_id=ANY($8::uuid[])
      UNION SELECT n.region_id FROM region_catalog_nodes n JOIN origins o ON n.parent_region_id=o.region_id WHERE n.catalog_version=$4
    )
    SELECT DISTINCT ON(l.provider_user_id) l.* FROM local_listings l
    JOIN dispatch_preferences p ON p.provider_user_id=l.provider_user_id
    JOIN users u ON u.id=l.provider_user_id JOIN organizations g ON g.id=l.org_id
    WHERE l.kind=$1 AND l.status='APPROVED' AND l.published AND l.provider_confirmed
      AND l.qualified_until>=$2 AND p.enabled AND u.status='ACTIVE' AND g.status='ACTIVE'
      AND l.provider_user_id<>$3 AND l.region_catalog_version=$4
      AND l.region_id IN (SELECT region_id FROM origins)
      AND EXISTS(SELECT 1 FROM target WHERE region_id=ANY(l.coverage_region_ids))
      AND EXISTS(SELECT 1 FROM target WHERE region_id=ANY(p.region_ids))
      AND NOT EXISTS(SELECT 1 FROM dispatch_offers old WHERE old.request_id=$5 AND old.provider_user_id=l.provider_user_id)
      AND EXISTS(SELECT 1 FROM local_slots s WHERE s.listing_id=l.id AND s.status='OPEN' AND s.starts_at=$6 AND s.ends_at=$2)
      AND NOT EXISTS(SELECT 1 FROM local_resource_reservations busy WHERE busy.active AND busy.resource_key='user:'||l.provider_user_id::text AND tstzrange(busy.starts_at,busy.ends_at,'[)') && tstzrange($6::timestamptz,$2::timestamptz+interval '30 minutes','[)'))
      AND NOT EXISTS(SELECT 1 FROM booking_appearances old WHERE old.player_user_id=l.provider_user_id AND old.status IN ('REQUESTED','ACCEPTED','ARRIVED','COMPLETED','DISPUTED') AND NOT(old.status='REQUESTED' AND old.expires_at<=clock_timestamp()) AND c06_booking_window(old.report_at,old.end_at) && tstzrange($6::timestamptz,$2::timestamptz+interval '30 minutes','[)'))
      AND NOT EXISTS(SELECT 1 FROM trade_terms fee WHERE fee.org_id=l.org_id AND fee.kind='LOCAL_BOOKING' AND fee.source_id=l.id AND fee.status='ACTIVE' AND (fee.amount_fen>$9 OR fee.amount_fen>$10))
      AND (SELECT count(*) FROM dispatch_offers daily WHERE daily.provider_user_id=l.provider_user_id AND daily.created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')<p.daily_limit
    ORDER BY l.provider_user_id,l.id LIMIT $11`,
        [
          r.kind,
          r.ends_at,
          r.owner_user_id,
          r.region_catalog_version,
          r.id,
          r.starts_at,
          r.service_region_id,
          r.invite_region_ids,
          r.budget.serviceMinor,
          r.budget.totalMinor,
          r.batch_size,
        ],
      )
    ).rows;
    if (!selected.length) {
      await c.query(
        "UPDATE dispatch_requests SET status='NEEDS_MANUAL',reason='暂无符合许可与时段的真实供给',next_batch_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [r.id],
      );
      return;
    }
    const batch = randomUUID(),
      expiry = (
        await c.query(
          "SELECT LEAST(clock_timestamp()+interval '15 minutes',$1::timestamptz) AS until",
          [r.expires_at],
        )
      ).rows[0].until;
    await c.query(
      'INSERT INTO dispatch_batches(id,request_id,batch_no,expires_at) VALUES($1,$2,$3,$4)',
      [batch, r.id, r.batch_count + 1, expiry],
    );
    for (const l of selected) {
      const id = randomUUID();
      await c.query(
        'INSERT INTO dispatch_offers(id,request_id,batch_id,provider_user_id,listing_id,listing_version,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id, r.id, batch, l.provider_user_id, l.id, l.version, expiry],
      );
      await this.event(
        c,
        r.id,
        id,
        null,
        'INVITED',
        1,
        '在双方许可范围内发送站内服务邀请，无外部通知',
      );
    }
    await c.query(
      "UPDATE dispatch_requests SET status='INVITING',batch_count=batch_count+1,next_batch_at=$2,reason=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
      [r.id, expiry],
    );
  }
  async requestCommand(cookie: string | undefined, id: string, raw: unknown) {
    const i = parseDispatchCommand(raw, 'REQUEST');
    resourceId(id);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        ref = await this.req(c, id);
      await this.owner(c, a, ref);
      await this.enabled(c);
      const winner = ref.winner_offer_id ? await this.offer(c, ref.winner_offer_id) : null;
      await this.mutex(c, [ref.org_id, ...(winner ? [winner.listing_org_id] : [])]);
      return this.operation(c, a, i.commandId, { requestId: id, ...i }, async () => {
        let r = await this.req(c, id, true);
        this.version(r, i.expectedVersion);
        if (r.winner_offer_id !== ref.winner_offer_id)
          dispatchFail('VERSION_CONFLICT', '接单人已变化，请重新读取');
        r = await this.expire(c, r);
        if (r.version !== i.expectedVersion)
          dispatchFail('DISPATCH_EXPIRED', '邀请或报价已过期，请重新读取');
        if (r.source_booking_id)
          dispatchFail(
            'DISPATCH_SOURCE_EXISTS',
            '已进入真实预约，请通过原订单处理履约、改期或退款',
          );
        if (i.type === 'START' || i.type === 'RESUME') {
          if (i.type === 'RESUME' && r.status !== 'PAUSED')
            dispatchFail('DISPATCH_STATE_CONFLICT', '该任务未暂停');
          await this.nextBatch(c, r);
        } else if (i.type === 'PAUSE') {
          if (!['DRAFT', 'INVITING'].includes(r.status))
            dispatchFail('DISPATCH_STATE_CONFLICT', '仅邀请阶段可暂停');
          await c.query(
            "UPDATE dispatch_offers SET status='SUPERSEDED',reason='客户暂停邀请',version=version+1,updated_at=clock_timestamp() WHERE request_id=$1 AND status=ANY($2::text[])",
            [id, pendingOffers],
          );
          await c.query(
            "UPDATE dispatch_requests SET status='PAUSED',next_batch_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
            [id],
          );
        } else if (i.type === 'CANCEL') {
          if (['CANCELLED', 'EXPIRED'].includes(r.status))
            dispatchFail('DISPATCH_STATE_CONFLICT', '需求已终结');
          if (r.winner_offer_id)
            await this.release(
              c,
              await this.offer(c, r.winner_offer_id, true),
              'WITHDRAWN',
              i.reason,
            );
          await c.query(
            "UPDATE dispatch_offers SET status='SUPERSEDED',reason=$2,version=version+1,updated_at=clock_timestamp() WHERE request_id=$1 AND status=ANY($3::text[])",
            [id, i.reason, pendingOffers],
          );
          await c.query(
            "UPDATE dispatch_requests SET status='CANCELLED',winner_offer_id=NULL,next_batch_at=NULL,reason=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
            [id, i.reason],
          );
        } else {
          if (r.status !== 'REVIEWING' || !r.winner_offer_id)
            dispatchFail('DISPATCH_STATE_CONFLICT', '没有待确认的有效报价');
          const o = await this.offer(c, r.winner_offer_id, true);
          if (i.type === 'REJECT_QUOTE') {
            await this.release(c, o, 'WITHDRAWN', i.reason);
            await c.query(
              "UPDATE dispatch_requests SET status='INVITING',winner_offer_id=NULL,next_batch_at=clock_timestamp(),reason=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
              [id, i.reason],
            );
          } else {
            if (
              o.status !== 'ACCEPTED_HELD' ||
              o.quote_hash !== i.quoteHash ||
              i.acceptedTermsId !== o.quote_hash ||
              !i.chargeConsent
            )
              dispatchFail('DISPATCH_QUOTE_CHANGED', '请明确核对并同意当前完整报价和条款');
            await this.supply(c, o, r, true);
            const createLocalBooking = this.dispatchOptions.createLocalBooking;
            if (!createLocalBooking)
              dispatchFail(
                'DISPATCH_CONVERSION_DISABLED',
                '当前暂不能创建预约，请稍后刷新并重新核对报价',
                503,
              );
            await c.query(
              'UPDATE local_resource_reservations SET active=false WHERE dispatch_offer_id=$1 AND active',
              [o.id],
            );
            const q = o.quote as DispatchQuote;
            const source = await createLocalBooking!(c, a, {
              commandId: i.commandId,
              listingId: o.listing_id,
              slotId: q.slotId,
              serviceRegion: {
                catalogVersion: r.region_catalog_version,
                regionId: r.service_region_id,
              },
              serviceAddress: r.service_address,
              servicePoint: r.service_point,
              acceptedTerms: true,
              acceptedTermsId: o.quote_hash,
              chargeConsent: true,
              verifiedDispatchQuote: { offerId: o.id, quoteHash: o.quote_hash },
            });
            // Canonical source hook retains the full travel interval in its reservation, not only service time.
            const protectedRow = (
              await c.query(
                'SELECT 1 FROM local_resource_reservations WHERE booking_id=$1 AND active AND resource_key=$2 AND starts_at<=$3::timestamptz AND ends_at>=$4::timestamptz',
                [
                  source.resourceId,
                  'user:' + o.provider_user_id,
                  q.protectedStartsAt,
                  q.protectedEndsAt,
                ],
              )
            ).rowCount;
            if (!protectedRow)
              dispatchFail(
                'DISPATCH_SOURCE_PROTECTION_MISSING',
                '源订单未完整保留差旅档期，已回滚转单',
                503,
              );
            await c.query(
              "UPDATE dispatch_holds SET state='CONVERTED',source_booking_id=$2 WHERE offer_id=$1 AND state='ACTIVE'",
              [o.id, source.resourceId],
            );
            await c.query(
              "UPDATE dispatch_offers SET status='CONVERTED',source_booking_id=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
              [o.id, source.resourceId],
            );
            await c.query(
              "UPDATE dispatch_requests SET status='SOURCE_REQUESTED',source_booking_id=$2,next_batch_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
              [id, source.resourceId],
            );
          }
        }
        const result = await this.req(c, id);
        await this.event(c, id, r.winner_offer_id, a.user.id, i.type, result.version, i.reason);
        return {
          resourceType: 'DISPATCH_REQUEST',
          resourceId: id,
          version: result.version,
          sourceBookingId: result.source_booking_id,
        };
      });
    });
  }
  async offerCommand(cookie: string | undefined, id: string, raw: unknown) {
    const i = parseDispatchCommand(raw, 'OFFER');
    resourceId(id);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        ref = await this.offer(c, id),
        request = await this.req(c, ref.request_id);
      if (i.type === 'VERIFY_TRAVEL') await this.reviewer(c, a, ref, request);
      else await this.provider(c, a, ref);
      await this.enabled(c);
      await this.mutex(c, [request.org_id, ref.listing_org_id]);
      return this.operation(c, a, i.commandId, { offerId: id, ...i }, async () => {
        let r = await this.req(c, request.id, true);
        r = await this.expire(c, r);
        const o = await this.offer(c, id, true);
        this.version(o, i.expectedVersion);
        if (
          new Date(o.expires_at) <= new Date(r.db_now) ||
          !['INVITING', 'REVIEWING'].includes(r.status)
        )
          dispatchFail('DISPATCH_EXPIRED', '邀请已失效或已停止');
        if (i.type === 'SUBMIT_QUOTE') {
          if (o.status !== 'PENDING' || r.status !== 'INVITING')
            dispatchFail('DISPATCH_STATE_CONFLICT', '仅有效新邀请可提交一次报价');
          const l = await this.supply(c, o, r),
            parsed = parseDispatchQuote(i.quote, {
              startsAt: iso(r.starts_at),
              endsAt: iso(r.ends_at),
              budget: r.budget,
            });
          const base = await this.price(c, l, parsed);
          const { hash: _hash, ...values } = parsed;
          const q = { ...values, ...base };
          const hash = localHash(q);
          const quote = { ...q, hash };
          await c.query(
            "UPDATE dispatch_offers SET status='TRAVEL_REVIEW',quote=$2,quote_hash=$3,reason=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
            [id, quote, hash, i.reason],
          );
        } else if (i.type === 'VERIFY_TRAVEL') {
          if (o.status !== 'TRAVEL_REVIEW' || o.quote_hash !== i.quoteHash)
            dispatchFail('DISPATCH_QUOTE_CHANGED', '报价已变化或不待审核');
          await this.supply(c, o, r, true);
          await c.query(
            "UPDATE dispatch_offers SET status='READY',travel_verified_by=$2,travel_verified_at=clock_timestamp(),reason=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
            [id, a.user.id, i.reason],
          );
        } else if (i.type === 'ACCEPT') {
          if (
            o.status !== 'READY' ||
            r.status !== 'INVITING' ||
            r.winner_offer_id ||
            o.quote_hash !== i.quoteHash
          )
            dispatchFail('DISPATCH_WINNER_EXISTS', '报价未就绪、已变化或已有人员进入客户确认');
          await this.supply(c, o, r, true);
          const q = o.quote as DispatchQuote;
          const until = (
            await c.query(
              "SELECT LEAST(clock_timestamp()+interval '10 minutes',$1::timestamptz,$2::timestamptz,$3::timestamptz) AS until",
              [r.expires_at, o.expires_at, q.protectedStartsAt],
            )
          ).rows[0].until;
          try {
            await c.query(
              'INSERT INTO local_resource_reservations(id,resource_key,dispatch_offer_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)',
              [
                randomUUID(),
                'user:' + o.provider_user_id,
                id,
                q.protectedStartsAt,
                q.protectedEndsAt,
              ],
            );
          } catch (e) {
            if ((e as { code?: string }).code === '23P01')
              dispatchFail('DISPATCH_TIME_CONFLICT', '服务或差旅与既有安排冲突');
            throw e;
          }
          await c.query(
            "INSERT INTO dispatch_holds(id,request_id,offer_id,provider_user_id,starts_at,ends_at,expires_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE')",
            [
              randomUUID(),
              r.id,
              id,
              o.provider_user_id,
              q.protectedStartsAt,
              q.protectedEndsAt,
              until,
            ],
          );
          await c.query(
            "UPDATE dispatch_offers SET status='ACCEPTED_HELD',hold_expires_at=$2,reason=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
            [id, until, i.reason],
          );
          await c.query(
            "UPDATE dispatch_offers SET status='SUPERSEDED',reason='已有人员进入客户确认',version=version+1,updated_at=clock_timestamp() WHERE request_id=$1 AND id<>$2 AND status=ANY($3::text[])",
            [r.id, id, pendingOffers],
          );
          await c.query(
            "UPDATE dispatch_requests SET status='REVIEWING',winner_offer_id=$2,next_batch_at=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
            [r.id, id, until],
          );
        } else if (i.type === 'DECLINE' || i.type === 'WITHDRAW') {
          if (![...pendingOffers, 'ACCEPTED_HELD'].includes(o.status))
            dispatchFail('DISPATCH_STATE_CONFLICT', '该邀请已结束');
          await this.release(c, o, i.type === 'DECLINE' ? 'DECLINED' : 'WITHDRAWN', i.reason);
          if (r.winner_offer_id === id)
            await c.query(
              "UPDATE dispatch_requests SET status='INVITING',winner_offer_id=NULL,next_batch_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1",
              [r.id],
            );
        }
        const updated = await this.offer(c, id);
        await this.event(c, r.id, id, a.user.id, i.type, updated.version, i.reason);
        return {
          resourceType: 'DISPATCH_OFFER',
          resourceId: id,
          requestId: r.id,
          version: updated.version,
        };
      });
    });
  }
  /** Separate bounded queues: at most 20 invitation deadlines and 20 source checks per tick. */
  async dispatchDue() {
    if (this.workerClosed || this.workerRunning || !this.dispatchOptions.enabled) return 0;
    this.workerRunning = true;
    try {
      const refs = (
        await this.pool.query(
          `WITH invitation_candidates AS (
            SELECT r.id,LEAST(r.expires_at,CASE WHEN r.status='INVITING'
              THEN COALESCE(r.next_batch_at,r.created_at) ELSE o.hold_expires_at END) AS due_at
            FROM dispatch_requests r LEFT JOIN dispatch_offers o ON o.id=r.winner_offer_id
            WHERE r.source_booking_id IS NULL AND r.status IN ('INVITING','REVIEWING')
          ), invitation_due AS (
            SELECT id,due_at FROM invitation_candidates WHERE due_at<=clock_timestamp()
            ORDER BY due_at,id LIMIT 20
          ), source_due AS (
            SELECT id,COALESCE(next_source_check_at,created_at) AS due_at
            FROM dispatch_requests WHERE source_booking_id IS NOT NULL
              AND status IN ('SOURCE_REQUESTED','SOURCE_CONFIRMED')
              AND COALESCE(next_source_check_at,created_at)<=clock_timestamp()
            ORDER BY COALESCE(next_source_check_at,created_at),id LIMIT 20
          ) SELECT id,false AS source_check,due_at FROM invitation_due
            UNION ALL SELECT id,true AS source_check,due_at FROM source_due
            ORDER BY source_check,due_at,id`,
        )
      ).rows;
      let count = 0;
      for (const ref of refs) {
        if (this.workerClosed) break;
        try {
          await this.transaction(async (c) => {
            if (this.workerClosed) return;
            await this.enabled(c);
            if (this.workerClosed) return;
            const first = await this.req(c, ref.id);
            if (this.workerClosed) return;
            await this.mutex(c, [first.org_id]);
            if (this.workerClosed) return;
            let r = await this.req(c, ref.id, true);
            if (this.workerClosed) return;
            if (r.source_booking_id) {
              // Another process may already have checked a selected row while this
              // worker waited for the calendar lock. Recheck its persisted deadline.
              if (
                !['SOURCE_REQUESTED', 'SOURCE_CONFIRMED'].includes(r.status) ||
                (r.next_source_check_at && new Date(r.next_source_check_at) > new Date(r.db_now))
              )
                return;
              const b = (
                await c.query('SELECT status FROM local_bookings WHERE id=$1', [
                  r.source_booking_id,
                ])
              ).rows[0];
              if (this.workerClosed) return;
              const state =
                b && sourceEnded.includes(b.status)
                  ? 'SOURCE_ENDED'
                  : b && ['CONFIRMED', 'ARRIVED', 'DELIVERED', 'DISPUTED'].includes(b.status)
                    ? 'SOURCE_CONFIRMED'
                    : 'SOURCE_REQUESTED';
              await c.query(
                "UPDATE dispatch_requests SET status=$2,next_source_check_at=CASE WHEN $2='SOURCE_ENDED' THEN NULL ELSE clock_timestamp()+interval '60 seconds' END,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
                [r.id, state],
              );
              return;
            }
            if (!['INVITING', 'REVIEWING'].includes(r.status)) return;
            const valid = (
              await c.query(
                "SELECT 1 FROM users u JOIN organization_memberships m ON m.user_id=u.id JOIN organizations g ON g.id=m.org_id WHERE u.id=$1 AND u.status='ACTIVE' AND m.org_id=$2 AND m.status='ACTIVE' AND m.role IN ('ORG_OWNER','ORG_ADMIN') AND g.status='ACTIVE'",
                [r.owner_user_id, r.org_id],
              )
            ).rowCount;
            if (this.workerClosed) return;
            if (!valid) {
              if (r.winner_offer_id)
                await this.release(
                  c,
                  await this.offer(c, r.winner_offer_id, true),
                  'SUPERSEDED',
                  '需求方权限已失效',
                );
              await c.query(
                "UPDATE dispatch_requests SET status='PAUSED',winner_offer_id=NULL,next_batch_at=NULL,reason='需求方权限需重新核验',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
                [r.id],
              );
              return;
            }
            r = await this.expire(c, r);
            if (
              !this.workerClosed &&
              r.status === 'INVITING' &&
              (!r.next_batch_at || new Date(r.next_batch_at) <= new Date(r.db_now))
            )
              await this.nextBatch(c, r);
            count++;
          });
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
        }
      }
      return count;
    } finally {
      this.workerRunning = false;
    }
  }
}
