import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { DispatchService } from '../src/dispatch-service.js';
import type { DispatchOptions } from '../src/dispatch-service.js';
import { createDispatchSourceHook } from '../src/dispatch-source-adapter.js';
import { LocalServicesService } from '../src/local-services-service.js';
import { TradeService } from '../src/trade-service.js';
import type { TradePayments } from '../src/trade-provider.js';
import { REGION_CATALOG_VERSION } from '../src/region-catalog-data.js';
import { ORIGIN, call, data, membersPath } from './support.js';
import { closeHarness, createHarness } from './p04-support.js';
import type { Harness } from './p04-support.js';

const money = {
  serviceMinor: 1000,
  travelMinor: 100,
  lodgingMinor: 200,
  platformMinor: 0,
  totalMinor: 1300,
};
// Real source, trade and dispatch services; any provider I/O fails this isolated test.
const providerCall = vi.fn(() => {
  throw new Error('Unexpected external payment dispatch');
});
const payments: TradePayments = {
  enabled: true,
  native: providerCall,
  queryOrder: providerCall,
  refund: providerCall,
  queryRefund: providerCall,
  verifyNotification: providerCall,
  downloadBill: providerCall,
};
describe(
  'paid dispatch canonical orders and real PostgreSQL rollback',
  { concurrent: false },
  () => {
    let h: Harness,
      source: LocalServicesService,
      chargedSource: LocalServicesService,
      trade: TradeService,
      dispatch: DispatchService,
      chargedDispatch: DispatchService,
      regionId: string,
      base: number;
    const services: DispatchService[] = [];
    let serial = 0;
    const at = (hours: number) => new Date(base + hours * 3600000).toISOString();
    const command = () => randomUUID();
    const region = () => ({ catalogVersion: REGION_CATALOG_VERSION, regionId });
    const options = () => ({
      databaseUrl: h.databaseUrl,
      appOrigin: ORIGIN,
      backgroundWorkersEnabled: false,
    });
    function service(hook: NonNullable<DispatchOptions['createLocalBooking']>) {
      const d = new DispatchService(h.api.pool, options(), {
        enabled: true,
        createLocalBooking: hook,
      });
      services.push(d);
      return d;
    }
    beforeAll(async () => {
      h = await createHarness(1);
      source = new LocalServicesService(h.api.pool, options());
      trade = new TradeService(h.api.pool, options(), {
        encryptionKey: Buffer.alloc(32, 7),
        merchants: {
          [h.owner.orgId]: {
            key: 'synthetic-dispatch-' + h.owner.orgId,
            merchantId: '1900000101',
            appId: 'wx1234567890abcdef',
            displayName: '合成隔离商户',
            payments,
            receivers: {},
          },
        },
      });
      chargedSource = new LocalServicesService(h.api.pool, options(), undefined, undefined, trade);
      dispatch = service(createDispatchSourceHook(source));
      chargedDispatch = service(createDispatchSourceHook(chargedSource));
      base =
        (await h.api.pool.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime() +
        72 * 3600000;
      regionId = (
        await h.api.pool.query(
          "SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND level='COUNTY' ORDER BY source_code LIMIT 1",
          [REGION_CATALOG_VERSION],
        )
      ).rows[0].region_id;
      data(
        await call(h.api, 'put', `${membersPath(h.owner.orgId)}/${h.leader.id}`, {
          cookie: h.owner.cookie,
          body: { role: 'ORG_ADMIN', status: 'ACTIVE' },
        }),
      );
    }, 90000);
    afterAll(async () => {
      for (const d of services) d.close();
      if (h) await closeHarness(h);
    });
    async function fixture(options: { hours?: number; expiresAt?: string } = {}) {
      const hours = options.hours ?? ++serial * 24;
      const listing = await source.createListing(h.owner.cookie, h.owner.orgId, {
        commandId: command(),
        kind: 'REFEREE',
        title: '隔离跨城裁判' + command().slice(0, 8),
        description: '仅隔离测试的真实供给审核流程',
        address: '实际公开经营地点',
        region: region(),
        coverageRegionIds: [regionId],
        point: null,
        providerUserId: h.owner.id,
        courtId: null,
        qualificationNote: '合成资质核验记录及有效期',
        terms: '服务费及交通住宿分项冻结，取消或改期须双方重新核验',
      });
      await source.listingCommand(h.owner.cookie, listing.resourceId, {
        commandId: command(),
        type: 'SUBMIT',
        expectedVersion: 1,
        reason: '提交独立资质核验',
      });
      await source.listingCommand(h.leader.cookie, listing.resourceId, {
        commandId: command(),
        type: 'APPROVE',
        expectedVersion: 2,
        reason: '独立核对真实人员资质和服务范围',
        qualifiedUntil: at(hours + 1000),
        qualificationChecked: true,
        scopeChecked: true,
      });
      await source.listingCommand(h.owner.cookie, listing.resourceId, {
        commandId: command(),
        type: 'PUBLISH',
        expectedVersion: 3,
        reason: '发布真实合成供给',
      });
      const slot = await source.createSlot(h.owner.cookie, listing.resourceId, {
        commandId: command(),
        expectedVersion: 4,
        startsAt: at(hours),
        endsAt: at(hours + 1),
      });
      const fee = await trade.createTerms(h.owner.cookie, h.owner.orgId, {
        clientRequestId: command(),
        kind: 'LOCAL_BOOKING',
        sourceId: listing.resourceId,
        amountFen: money.serviceMinor,
        terms: '合成服务收费条款，取消退款按原合同处理',
      });
      await trade.reviewTerms(h.leader.cookie, h.owner.orgId, fee.termsId, {
        clientRequestId: command(),
        expectedVersion: 1,
        decision: 'APPROVE',
        reason: '独立核对实际服务价格及收款主体',
      });
      const p = (await dispatch.workspace(h.owner.cookie)).preference;
      await dispatch.preference(h.owner.cookie, {
        commandId: command(),
        expectedVersion: p?.version ?? 0,
        enabled: true,
        regionIds: [regionId],
        dailyLimit: 9,
      });
      const createBody = {
        commandId: command(),
        orgId: h.otherOwner.orgId,
        kind: 'REFEREE',
        serviceRegion: region(),
        serviceAddress: '合成体育馆东门实际报到地点',
        servicePoint: null,
        startsAt: at(hours),
        endsAt: at(hours + 1),
        expiresAt: options.expiresAt ?? at(hours - 6),
        budget: money,
        inviteRegionIds: [regionId],
        allowCrossCity: true,
        people: 1,
      };
      const created = await dispatch.create(h.otherOwner.cookie, createBody);
      await dispatch.requestCommand(h.otherOwner.cookie, created.resourceId, {
        commandId: command(),
        expectedVersion: 1,
        type: 'START',
        reason: '本人授权开始有限邀请',
      });
      const detail = await dispatch.detail(h.otherOwner.cookie, created.resourceId);
      expect(detail.offers).toHaveLength(1);
      const offer = detail.offers[0]!;
      return {
        id: created.resourceId as string,
        listingId: listing.resourceId,
        slotId: slot.slotId as string,
        hours,
        offer,
        createBody,
      };
    }
    async function quoted(f: Awaited<ReturnType<typeof fixture>>) {
      const quote = {
        slotId: f.slotId,
        ...money,
        departureAt: at(f.hours - 3),
        arrivalAt: at(f.hours - 1),
        returnAt: at(f.hours + 4),
        travelMethod: '已核验隔离测试班车往返',
        travelEvidence: '核对授权班次时刻与市内接驳安排，有完整审核依据',
        terms: '服务费一千分，交通一百分，住宿二百分，总计一千三百分',
      };
      await dispatch.offerCommand(h.owner.cookie, f.offer.id, {
        commandId: command(),
        expectedVersion: 1,
        type: 'SUBMIT_QUOTE',
        reason: '本人核对完整服务与旅行报价',
        quote,
      });
      const o = await dispatch.offerDetail(h.owner.cookie, f.offer.id);
      return { ...f, quote, quoted: o };
    }
    async function ready(f: Awaited<ReturnType<typeof quoted>>) {
      await dispatch.offerCommand(h.leader.cookie, f.offer.id, {
        commandId: command(),
        expectedVersion: 2,
        type: 'VERIFY_TRAVEL',
        quoteHash: f.quoted.quoteHash,
        evidenceChecked: true,
        reason: '独立核验真实路线、报到及返程凭据',
      });
      return f;
    }
    async function held(f: Awaited<ReturnType<typeof ready>>) {
      const body = {
        commandId: command(),
        expectedVersion: 3,
        type: 'ACCEPT',
        quoteHash: f.quoted.quoteHash,
        reason: '本人确认可用档期及完整旅行保护',
      };
      await dispatch.offerCommand(h.owner.cookie, f.offer.id, body);
      return { ...f, acceptBody: body };
    }

    type Held = Awaited<ReturnType<typeof held>>;
    async function confirmBody(f: Held) {
      const current = await dispatch.detail(h.otherOwner.cookie, f.id);
      return {
        commandId: command(),
        expectedVersion: current.request.version,
        type: 'CONFIRM_QUOTE',
        quoteHash: f.quoted.quoteHash,
        acceptedTermsId: f.quoted.quoteHash,
        chargeConsent: true,
        reason: '本人逐项核对完整服务差旅报价并同意收费',
      };
    }
    async function durableState(f: Held) {
      const read = async (sql: string, ids: string[]) => (await h.api.pool.query(sql, ids)).rows;
      return {
        request: await read('SELECT * FROM dispatch_requests WHERE id=$1', [f.id]),
        offer: await read('SELECT * FROM dispatch_offers WHERE id=$1', [f.offer.id]),
        hold: await read('SELECT * FROM dispatch_holds WHERE offer_id=$1', [f.offer.id]),
        reservation: await read(
          'SELECT * FROM local_resource_reservations WHERE dispatch_offer_id=$1 ORDER BY id',
          [f.offer.id],
        ),
        events: await read('SELECT * FROM dispatch_events WHERE request_id=$1 ORDER BY id', [f.id]),
        // Buyer has not written any local source in this fixture yet. Exact prior evidence must survive failure.
        localHistory: await read(
          'SELECT * FROM local_service_history WHERE actor_id=$1 ORDER BY id',
          [h.otherOwner.id],
        ),
      };
    }
    async function assertRolledBack(
      f: Held,
      body: Awaited<ReturnType<typeof confirmBody>>,
      before: Awaited<ReturnType<typeof durableState>>,
    ) {
      expect(await durableState(f)).toEqual(before);
      expect(before.request[0]).toMatchObject({ status: 'REVIEWING', source_booking_id: null });
      expect(before.offer[0]).toMatchObject({ status: 'ACCEPTED_HELD', source_booking_id: null });
      expect(before.hold[0]).toMatchObject({ state: 'ACTIVE', source_booking_id: null });
      expect(before.reservation).toHaveLength(1);
      expect(before.reservation[0]).toMatchObject({ active: true });
      expect(
        (await h.api.pool.query('SELECT id FROM local_bookings WHERE listing_id=$1', [f.listingId]))
          .rows,
      ).toEqual([]);
      for (const table of ['local_command_receipts', 'dispatch_command_receipts']) {
        expect(
          (
            await h.api.pool.query(
              `SELECT command_id FROM ${table} WHERE actor_id=$1 AND command_id=$2`,
              [h.otherOwner.id, body.commandId],
            )
          ).rows,
        ).toEqual([]);
      }
      expect(providerCall).not.toHaveBeenCalled();
    }
    test('missing charge integration rolls back the source and hold transfer; the same command retries with one real full-quote order', async () => {
      const f = await held(await ready(await quoted(await fixture())));
      const body = await confirmBody(f),
        before = await durableState(f);
      await expect(dispatch.requestCommand(h.otherOwner.cookie, f.id, body)).rejects.toMatchObject({
        code: 'DISPATCH_TRADE_UNAVAILABLE',
        status: 503,
      });
      await assertRolledBack(f, body, before);
      const result = await chargedDispatch.requestCommand(h.otherOwner.cookie, f.id, body);
      const sourceId = result.sourceBookingId as string;
      expect(sourceId).toBeTruthy();
      const order = (
        await h.api.pool.query(
          "SELECT * FROM trade_orders WHERE kind='LOCAL_BOOKING' AND source_id=$1",
          [sourceId],
        )
      ).rows;
      expect(order).toHaveLength(1);
      expect(order[0]).toMatchObject({
        total_fen: 1300,
        merchant_key: 'synthetic-dispatch-' + h.owner.orgId,
        payer_user_id: h.otherOwner.id,
        beneficiary_user_id: h.owner.id,
        status: 'OPEN',
      });
      const booking = (
        await h.api.pool.query('SELECT * FROM local_bookings WHERE id=$1', [sourceId])
      ).rows[0];
      expect(booking).toMatchObject({
        status: 'REQUESTED',
        listing_id: f.listingId,
        buyer_user_id: h.otherOwner.id,
      });
      expect(booking.snapshot.dispatchQuote).toMatchObject({
        totalMinor: 1300,
        serviceMinor: 1000,
        quoteHash: f.quoted.quoteHash,
        offerId: f.offer.id,
      });
      const reservation = (
        await h.api.pool.query(
          'SELECT * FROM local_resource_reservations WHERE booking_id=$1 AND active',
          [sourceId],
        )
      ).rows;
      expect(reservation).toHaveLength(1);
      expect(reservation[0].starts_at.toISOString()).toBe(
        booking.snapshot.dispatchQuote.protectedStartsAt,
      );
      expect(reservation[0].ends_at.toISOString()).toBe(
        booking.snapshot.dispatchQuote.protectedEndsAt,
      );
      expect(
        (
          await h.api.pool.query('SELECT id FROM trade_payment_attempts WHERE order_id=$1', [
            order[0].id,
          ])
        ).rows,
      ).toEqual([]);
      expect(await chargedDispatch.requestCommand(h.otherOwner.cookie, f.id, body)).toEqual(result);
      expect(
        (await h.api.pool.query('SELECT id FROM local_bookings WHERE listing_id=$1', [f.listingId]))
          .rowCount,
      ).toBe(1);
      expect(
        (
          await h.api.pool.query(
            "SELECT id FROM trade_orders WHERE kind='LOCAL_BOOKING' AND source_id=$1",
            [sourceId],
          )
        ).rowCount,
      ).toBe(1);
      expect(providerCall).not.toHaveBeenCalled();
    });
    test('an error after actual source and trade creation rolls both back with their receipts and calendar transfer', async () => {
      const f = await held(await ready(await quoted(await fixture())));
      const body = await confirmBody(f),
        before = await durableState(f);
      const hook = createDispatchSourceHook(chargedSource);
      let attemptedSourceId: string | undefined, attemptedOrderId: string | undefined;
      const failure = new Error('Isolated failure after real canonical charge capture');
      const failing = service(async (c, actor, input) => {
        const result = await hook(c, actor, input);
        attemptedSourceId = result.resourceId;
        const order = (
          await c.query(
            "SELECT id,total_fen FROM trade_orders WHERE kind='LOCAL_BOOKING' AND source_id=$1",
            [result.resourceId],
          )
        ).rows[0];
        expect(order).toMatchObject({ total_fen: 1300 });
        attemptedOrderId = order.id;
        expect(
          (
            await c.query(
              'SELECT command_id FROM local_command_receipts WHERE actor_id=$1 AND command_id=$2',
              [actor.user.id, input.commandId],
            )
          ).rowCount,
        ).toBe(1);
        throw failure;
      });
      await expect(failing.requestCommand(h.otherOwner.cookie, f.id, body)).rejects.toBe(failure);
      expect(attemptedSourceId).toBeTruthy();
      expect(attemptedOrderId).toBeTruthy();
      await assertRolledBack(f, body, before);
      expect(
        (await h.api.pool.query('SELECT id FROM trade_orders WHERE id=$1', [attemptedOrderId]))
          .rows,
      ).toEqual([]);
      expect(
        (
          await h.api.pool.query('SELECT id FROM local_resource_reservations WHERE booking_id=$1', [
            attemptedSourceId,
          ])
        ).rows,
      ).toEqual([]);
      expect(
        (
          await h.api.pool.query('SELECT id FROM local_service_history WHERE resource_id=$1', [
            attemptedSourceId,
          ])
        ).rows,
      ).toEqual([]);
      const retry = await chargedDispatch.requestCommand(h.otherOwner.cookie, f.id, body);
      expect(retry.sourceBookingId).toBeTruthy();
      expect(retry.sourceBookingId).not.toBe(attemptedSourceId);
      expect(providerCall).not.toHaveBeenCalled();
    });
  },
);
