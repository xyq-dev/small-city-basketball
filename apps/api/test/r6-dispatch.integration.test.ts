import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { PoolClient } from 'pg';
import { DispatchService } from '../src/dispatch-service.js';
import type { DispatchSourceInput } from '../src/dispatch-service.js';
import type { Actor } from '../src/service.js';
import { LocalServicesService } from '../src/local-services-service.js';
import { REGION_CATALOG_VERSION } from '../src/region-catalog-data.js';
import { ORIGIN, call, data, membersPath } from './support.js';
import { closeHarness, createHarness } from './p04-support.js';
import type { Harness } from './p04-support.js';

// This is a real source adapter, never a hand-written local_bookings fixture. The method is
// implemented in the shared R6 integration slice. A missing adapter fails, never skips.
type SourceWithDispatch = LocalServicesService & {
  createDispatchBookingInTransaction(
    c: PoolClient,
    actor: Actor,
    input: DispatchSourceInput,
  ): Promise<{ resourceId: string; version: number }>;
};
const zero = { serviceMinor: 0, travelMinor: 0, lodgingMinor: 0, platformMinor: 0, totalMinor: 0 };
describe(
  'R6 dispatch real PostgreSQL evidence, invitations, calendar and source transaction',
  { concurrent: false },
  () => {
    let h: Harness,
      source: LocalServicesService,
      dispatch: DispatchService,
      regionId: string,
      base: number;
    let serial = 0;
    const at = (hours: number) => new Date(base + hours * 3600000).toISOString();
    const command = () => randomUUID();
    const region = () => ({ catalogVersion: REGION_CATALOG_VERSION, regionId });
    beforeAll(async () => {
      h = await createHarness(2);
      source = new LocalServicesService(h.api.pool, {
        databaseUrl: h.databaseUrl,
        appOrigin: ORIGIN,
        backgroundWorkersEnabled: false,
      });
      dispatch = new DispatchService(
        h.api.pool,
        { databaseUrl: h.databaseUrl, appOrigin: ORIGIN, backgroundWorkersEnabled: false },
        {
          enabled: true,
          createLocalBooking: (c, a, i) =>
            (source as SourceWithDispatch).createDispatchBookingInTransaction(c, a, i),
        },
      );
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
      dispatch?.close();
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
        terms: '公益服务零费用，取消与改期须重新核验双方安排',
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
        budget: zero,
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
        ...zero,
        departureAt: at(f.hours - 3),
        arrivalAt: at(f.hours - 1),
        returnAt: at(f.hours + 4),
        travelMethod: '已核验公益班车往返',
        travelEvidence: '核对授权班次时刻与市内接驳安排，有完整审核依据',
        terms: '本次公益服务及交通住宿全部零费用，履约取消改期通过原预约办理',
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
    test('default is closed; real actor cannot bypass disabled dispatch', async () => {
      const disabled = new DispatchService(h.api.pool, {
        databaseUrl: h.databaseUrl,
        appOrigin: ORIGIN,
      });
      expect(disabled.capabilities()).toMatchObject({
        enabled: false,
        conversionEnabled: false,
        externalNotifications: false,
      });
      await expect(
        disabled.preference(h.owner.cookie, {
          commandId: command(),
          expectedVersion: 0,
          enabled: true,
          regionIds: [regionId],
          dailyLimit: 3,
        }),
      ).rejects.toMatchObject({ code: 'DISPATCH_DISABLED' });
    });
    test('both-sided scope, explicit acceptance, quote review segregation and evidence are durable', async () => {
      const f = await quoted(await fixture());
      expect(
        (
          await h.api.pool.query(
            'SELECT 1 FROM local_resource_reservations WHERE dispatch_offer_id=$1',
            [f.offer.id],
          )
        ).rowCount,
      ).toBe(0);
      for (const cookie of [h.owner.cookie, h.otherOwner.cookie])
        await expect(
          dispatch.offerCommand(cookie, f.offer.id, {
            commandId: command(),
            expectedVersion: 2,
            type: 'VERIFY_TRAVEL',
            quoteHash: f.quoted.quoteHash,
            evidenceChecked: true,
            reason: '不能由报价人或需求人自行审核',
          }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        dispatch.offerCommand(h.owner.cookie, f.offer.id, {
          commandId: command(),
          expectedVersion: 2,
          type: 'ACCEPT',
          quoteHash: f.quoted.quoteHash,
          reason: '审核前不可自动接单',
        }),
      ).rejects.toMatchObject({ code: 'DISPATCH_WINNER_EXISTS' });
      await ready(f);
      const detail = await dispatch.offerDetail(h.owner.cookie, f.offer.id);
      expect(detail).toMatchObject({ status: 'READY', travelVerified: true, canAccept: true });
      const evidence = (
        await h.api.pool.query(
          'SELECT travel_verified_by,quote_hash FROM dispatch_offers WHERE id=$1',
          [f.offer.id],
        )
      ).rows[0];
      expect(evidence.travel_verified_by).toBe(h.leader.id);
      expect(evidence.quote_hash).toBe(f.quoted.quoteHash);
      await expect(
        h.api.pool.query(
          "UPDATE dispatch_offers SET quote=jsonb_set(quote,'{totalMinor}','1'),version=version+1 WHERE id=$1",
          [f.offer.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
    test('parallel same-command acceptance has one durable winner/hold and original replay result', async () => {
      const f = await ready(await quoted(await fixture()));
      const body = {
        commandId: command(),
        expectedVersion: 3,
        type: 'ACCEPT',
        quoteHash: f.quoted.quoteHash,
        reason: '本人明确同意完整跨城安排',
      };
      const results = await Promise.all([
        dispatch.offerCommand(h.owner.cookie, f.offer.id, body),
        dispatch.offerCommand(h.owner.cookie, f.offer.id, body),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(
        (
          await h.api.pool.query(
            "SELECT 1 FROM dispatch_holds WHERE request_id=$1 AND state='ACTIVE'",
            [f.id],
          )
        ).rowCount,
      ).toBe(1);
      const reservation = (
        await h.api.pool.query(
          'SELECT starts_at,ends_at FROM local_resource_reservations WHERE dispatch_offer_id=$1 AND active',
          [f.offer.id],
        )
      ).rows[0];
      expect(reservation.starts_at.toISOString()).toBe(at(f.hours - 3));
      expect(reservation.ends_at.toISOString()).toBe(at(f.hours + 4));
      await expect(
        dispatch.offerCommand(h.owner.cookie, f.offer.id, {
          ...body,
          reason: '相同编号不同内容拒绝',
        }),
      ).rejects.toMatchObject({ code: 'COMMAND_ID_REUSED' });
      await expect(dispatch.receipt(h.otherOwner.cookie, body.commandId)).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
      });
      const restarted = new DispatchService(
        h.api.pool,
        { databaseUrl: h.databaseUrl, appOrigin: ORIGIN, backgroundWorkersEnabled: false },
        { enabled: true },
      );
      expect(await restarted.receipt(h.owner.cookie, body.commandId)).toEqual(results[0]);
    });
    test('canonical local reservation conflicts with full dispatch travel protection', async () => {
      const f = await held(await ready(await quoted(await fixture())));
      await expect(
        source.book(h.otherOwner.cookie, {
          commandId: command(),
          listingId: f.listingId,
          slotId: f.slotId,
          serviceRegion: region(),
          serviceAddress: '既有派单的真实服务场馆',
          acceptedTerms: true,
        }),
      ).rejects.toMatchObject({ status: 409 });
      const req = (await dispatch.detail(h.otherOwner.cookie, f.id)).request;
      await dispatch.requestCommand(h.otherOwner.cookie, f.id, {
        commandId: command(),
        expectedVersion: req.version,
        type: 'CANCEL',
        reason: '客户取消未转单的明确需求',
      });
      expect(
        (
          await h.api.pool.query(
            'SELECT 1 FROM local_resource_reservations WHERE dispatch_offer_id=$1 AND active',
            [f.offer.id],
          )
        ).rowCount,
      ).toBe(0);
      const ended = await dispatch.offerDetail(h.owner.cookie, f.offer.id);
      expect(ended.locationVisible).toBe(false);
      expect(ended.request.serviceAddress).not.toContain('体育馆');
      await expect(
        dispatch.offerCommand(h.owner.cookie, f.offer.id, {
          ...f.acceptBody,
          commandId: command(),
        }),
      ).rejects.toMatchObject({ code: 'DISPATCH_EXPIRED' });
    });
    test('disabled source conversion preserves hold, quote and receipt absence atomically', async () => {
      const f = await held(await ready(await quoted(await fixture())));
      const noSource = new DispatchService(
        h.api.pool,
        { databaseUrl: h.databaseUrl, appOrigin: ORIGIN, backgroundWorkersEnabled: false },
        { enabled: true },
      );
      const r = (await noSource.detail(h.otherOwner.cookie, f.id)).request;
      const body = {
        commandId: command(),
        expectedVersion: r.version,
        type: 'CONFIRM_QUOTE',
        quoteHash: f.quoted.quoteHash,
        acceptedTermsId: f.quoted.quoteHash,
        chargeConsent: true,
        reason: '客户明确确认完整零费用报价',
      };
      await expect(noSource.requestCommand(h.otherOwner.cookie, f.id, body)).rejects.toMatchObject({
        code: 'DISPATCH_CONVERSION_DISABLED',
      });
      expect(
        (
          await h.api.pool.query(
            'SELECT 1 FROM local_resource_reservations WHERE dispatch_offer_id=$1 AND active',
            [f.offer.id],
          )
        ).rowCount,
      ).toBe(1);
      await expect(noSource.receipt(h.otherOwner.cookie, body.commandId)).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
      });
    });
    test('real source conversion retains immutable quote and full trip reservation; replay cannot create second booking', async () => {
      const f = await held(await ready(await quoted(await fixture())));
      const r = (await dispatch.detail(h.otherOwner.cookie, f.id)).request;
      const body = {
        commandId: command(),
        expectedVersion: r.version,
        type: 'CONFIRM_QUOTE',
        quoteHash: f.quoted.quoteHash,
        acceptedTermsId: f.quoted.quoteHash,
        chargeConsent: true,
        reason: '客户核对完整报价后授权转真实预约',
      };
      const [a, b] = await Promise.all([
        dispatch.requestCommand(h.otherOwner.cookie, f.id, body),
        dispatch.requestCommand(h.otherOwner.cookie, f.id, body),
      ]);
      expect(a).toEqual(b);
      expect(a.sourceBookingId).toBeTruthy();
      const booking = (
        await h.api.pool.query('SELECT * FROM local_bookings WHERE id=$1', [a.sourceBookingId])
      ).rows[0];
      expect(booking.status).toBe('REQUESTED');
      expect(booking.snapshot.dispatchQuote.quoteHash).toBe(f.quoted.quoteHash);
      const reservation = (
        await h.api.pool.query(
          'SELECT starts_at,ends_at FROM local_resource_reservations WHERE booking_id=$1 AND active',
          [a.sourceBookingId],
        )
      ).rows[0];
      expect(reservation.starts_at.toISOString()).toBe(at(f.hours - 3));
      expect(reservation.ends_at.toISOString()).toBe(at(f.hours + 4));
      expect(
        (
          await h.api.pool.query(
            'SELECT 1 FROM local_resource_reservations WHERE dispatch_offer_id=$1 AND active',
            [f.offer.id],
          )
        ).rowCount,
      ).toBe(0);
      expect((await dispatch.detail(h.otherOwner.cookie, f.id)).request.status).toBe(
        'SOURCE_REQUESTED',
      );
      await expect(
        dispatch.requestCommand(h.otherOwner.cookie, f.id, {
          commandId: command(),
          expectedVersion: a.version,
          type: 'CANCEL',
          reason: '真实订单必须在源服务取消',
        }),
      ).rejects.toMatchObject({ code: 'DISPATCH_SOURCE_EXISTS' });
    });
    test('current supply revocation blocks acceptance; no route/hold auto-approval', async () => {
      const f = await ready(await quoted(await fixture()));
      const listing = (await source.privateListing(h.owner.cookie, f.listingId)).listing;
      await source.listingCommand(h.owner.cookie, f.listingId, {
        commandId: command(),
        expectedVersion: listing.version,
        type: 'UNPUBLISH',
        reason: '停止当前公开服务供给',
      });
      await expect(
        dispatch.offerCommand(h.owner.cookie, f.offer.id, {
          commandId: command(),
          expectedVersion: 3,
          type: 'ACCEPT',
          quoteHash: f.quoted.quoteHash,
          reason: '已撤销供给不能自动占位',
        }),
      ).rejects.toMatchObject({ code: 'DISPATCH_SUPPLY_CHANGED' });
      expect(
        (
          await h.api.pool.query(
            'SELECT 1 FROM local_resource_reservations WHERE dispatch_offer_id=$1 AND active',
            [f.offer.id],
          )
        ).rowCount,
      ).toBe(0);
    });
    test('no eligible next candidate becomes an explicit manual queue without repeated or unbounded invitations', async () => {
      const f = await fixture();
      await dispatch.offerCommand(h.owner.cookie, f.offer.id, {
        commandId: command(),
        expectedVersion: 1,
        type: 'DECLINE',
        reason: '本人无法承担该实际安排',
      });
      const r = (await dispatch.detail(h.otherOwner.cookie, f.id)).request;
      await dispatch.requestCommand(h.otherOwner.cookie, f.id, {
        commandId: command(),
        expectedVersion: r.version,
        type: 'PAUSE',
        reason: '先暂停并重新核验邀请',
      });
      const paused = (await dispatch.detail(h.otherOwner.cookie, f.id)).request;
      await dispatch.requestCommand(h.otherOwner.cookie, f.id, {
        commandId: command(),
        expectedVersion: paused.version,
        type: 'RESUME',
        reason: '继续在明确授权范围寻找人员',
      });
      const current = await dispatch.detail(h.otherOwner.cookie, f.id);
      expect(current.request.status).toBe('NEEDS_MANUAL');
      expect(current.offers).toHaveLength(1);
      expect(current.request.batchCount).toBeLessThanOrEqual(3);
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::integer AS n FROM dispatch_batches WHERE request_id=$1',
            [f.id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    test('database deadlines release winner and revoke exact route without inviting after request expiry', async () => {
      const deadline = Date.now() + 6000;
      const f = await held(
        await ready(await quoted(await fixture({ expiresAt: new Date(deadline).toISOString() }))),
      );
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now()) + 100));
      await dispatch.dispatchDue();
      const current = await dispatch.detail(h.otherOwner.cookie, f.id);
      expect(current.request.status).toBe('EXPIRED');
      expect(current.offers[0]!.status).toBe('EXPIRED');
      expect(
        (
          await h.api.pool.query(
            "SELECT 1 FROM dispatch_holds WHERE request_id=$1 AND state='ACTIVE'",
            [f.id],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await h.api.pool.query(
            'SELECT 1 FROM local_resource_reservations WHERE dispatch_offer_id=$1 AND active',
            [f.offer.id],
          )
        ).rowCount,
      ).toBe(0);
      expect((await dispatch.offerDetail(h.owner.cookie, f.offer.id)).locationVisible).toBe(false);
    }, 15000);
  },
);
