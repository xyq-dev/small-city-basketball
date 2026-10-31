import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  LocalServicesService,
  verifiedGovernanceBooking,
  verifiedCompletedBooking,
} from '../src/local-services-service.js';
import { PlayerBookingService } from '../src/player-booking/service.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { forbidden } from '../src/errors.js';
import { TencentLocationProvider } from '../src/location-provider.js';
import { REGION_CATALOG_VERSION } from '../src/region-catalog-data.js';
import { ORIGIN, call, data, membersPath } from './support.js';
import { grant } from './p03-support.js';
import {
  allocate,
  closeHarness,
  court,
  createHarness,
  frozen,
  fullAllocations,
  publish,
  revision,
  validate,
} from './p04-support.js';
import type { Harness } from './p04-support.js';

describe(
  'X12 real PostgreSQL local supply, reservations and bilateral matchups',
  { concurrent: false },
  () => {
    let h: Harness,
      service: LocalServicesService,
      regionId: string,
      base: number,
      profileId: string;
    let serial = 0;
    const at = (hours: number) => new Date(base + hours * 3600000).toISOString();
    const command = () => randomUUID();
    const region = () => ({ catalogVersion: REGION_CATALOG_VERSION, regionId });
    const assertCode = async (p: Promise<unknown>, code: string) =>
      expect(p).rejects.toMatchObject({ code });
    beforeAll(async () => {
      h = await createHarness(2);
      service = new LocalServicesService(h.api.pool, {
        databaseUrl: h.databaseUrl,
        appOrigin: ORIGIN,
      });
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
        await call(h.api, 'put', `${membersPath(h.owner.orgId)}/${h.otherOwner.id}`, {
          cookie: h.owner.cookie,
          body: { role: 'ORG_ADMIN', status: 'ACTIVE' },
        }),
      );
      await grant(h.api, h.otherOwner, h.otherTeams[0]!, h.otherOwner);
      profileId = randomUUID();
      await h.api.pool.query(
        "INSERT INTO booking_profiles(id,user_id,display_name,position,height_cm,city,bio,price_fen,availability) VALUES($1,$2,'合成跨日历人员','PG',180,'合成城市','仅隔离触发器夹具',10000,'[]')",
        [profileId, h.owner.id],
      );
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    });
    async function supply(kind = 'COURT', hours = ++serial * 4) {
      const actualCourt = kind === 'COURT' ? await court(h.api, h.owner, 'X12实际球场') : null;
      const created = await service.createListing(h.owner.cookie, h.owner.orgId, {
        commandId: command(),
        kind,
        title: `合成供给${serial}-${randomUUID().slice(0, 5)}`,
        description: '真实审核流程的隔离合成数据',
        address: '公开经营地点，非住宅',
        region: region(),
        coverageRegionIds: [regionId],
        point: { latitude: 22.9, longitude: 110.8, coordinateSystem: 'GCJ02' },
        providerUserId: h.owner.id,
        courtId: actualCourt?.id ?? null,
        qualificationNote: '合成资质证明仅用于隔离测试',
        terms: '预约无线上扣费；天气关闭可取消；人工履约确认',
      });
      await service.listingCommand(h.owner.cookie, created.resourceId, {
        commandId: command(),
        type: 'SUBMIT',
        expectedVersion: 1,
        reason: '提交真实独立审核',
      });
      await service.listingCommand(h.otherOwner.cookie, created.resourceId, {
        commandId: command(),
        type: 'APPROVE',
        expectedVersion: 2,
        reason: '独立核对主体、必要资质及覆盖范围',
        qualifiedUntil: at(300 * 24),
        qualificationChecked: true,
        scopeChecked: true,
      });
      await service.listingCommand(h.owner.cookie, created.resourceId, {
        commandId: command(),
        type: 'PUBLISH',
        expectedVersion: 3,
        reason: '发布已审核实际供给',
      });
      const slot = await service.createSlot(h.owner.cookie, created.resourceId, {
        commandId: command(),
        expectedVersion: 4,
        startsAt: at(hours),
        endsAt: at(hours + 1),
      });
      return {
        id: created.resourceId as string,
        slotId: slot.slotId as string,
        courtId: actualCourt?.id,
        start: at(hours),
        end: at(hours + 1),
        kind,
      };
    }
    const bookBody = (s: { id: string; slotId: string; kind: string }, commandId = command()) => ({
      commandId,
      listingId: s.id,
      slotId: s.slotId,
      serviceRegion: region(),
      acceptedTerms: true,
      ...(s.kind === 'COURT' ? {} : { serviceAddress: '双方确认的实际比赛场馆地址' }),
    });
    async function oldAppearance(start: string, end: string, expired = false) {
      const settings = (
        await h.api.pool.query('SELECT fee_bps,version FROM booking_settings WHERE id')
      ).rows[0];
      const orderId = randomUUID(),
        id = randomUUID(),
        fee = Math.round((10000 * settings.fee_bps) / 10000);
      await h.api.pool.query(
        "INSERT INTO booking_orders(id,org_id,team_id,event_name,team_name,buyer_user_id,scope,fee_bps,settings_version) VALUES($1,$2,$3,'合成跨日历核验',$4,$5,'SINGLE',$6,$7)",
        [
          orderId,
          h.owner.orgId,
          h.teams[0]!.id,
          h.teams[0]!.name,
          h.leader.id,
          settings.fee_bps,
          settings.version,
        ],
      );
      await h.api.pool.query(
        "INSERT INTO booking_appearances(id,order_id,profile_id,player_user_id,label,status,report_at,start_at,end_at,venue,service_fen,platform_fee_fen,total_fen,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,'合成旧预约','REQUESTED',$5,$5,$6,'合成场馆',10000,$7,$8,CASE WHEN $9 THEN statement_timestamp()-interval '1 minute' ELSE statement_timestamp()+interval '10 minutes' END,CASE WHEN $9 THEN statement_timestamp()-interval '2 minutes' ELSE statement_timestamp() END,CASE WHEN $9 THEN statement_timestamp()-interval '2 minutes' ELSE statement_timestamp() END)",
        [id, orderId, profileId, h.owner.id, start, end, fee, 10000 + fee, expired],
      );
      return id;
    }
    test('public reads contain only approved listing fields and no qualifications or internal actor ids', async () => {
      const s = await supply();
      const page = await service.publicList(
        { regionId, catalogVersion: REGION_CATALOG_VERSION },
        'x12-public-fields',
      );
      const item = page.items.find((v) => v.id === s.id)!;
      expect(item).toBeDefined();
      for (const key of [
        'qualificationNote',
        'providerUserId',
        'created_by',
        'orgId',
        'reviewed_by',
      ])
        expect(item).not.toHaveProperty(key);
      expect(item.distanceMeters).toBeNull();
      expect(page.locationCapability.enabled).toBe(false);
      expect((await service.publicDetail(s.id, 'x12-public-slots')).slots[0]).toMatchObject({
        id: s.slotId,
        available: true,
      });
    });
    test('independent review forbids applicant/provider; medical labels alone cannot pass', async () => {
      const created = await service.createListing(h.owner.cookie, h.owner.orgId, {
        commandId: command(),
        kind: 'MEDIC',
        title: '合成医务人员',
        description: '未取得资质即不发布',
        address: '公开机构地址',
        region: region(),
        coverageRegionIds: [regionId],
        providerUserId: h.owner.id,
        qualificationNote: '待独立审核实际证明',
        terms: '必须先核对资格与服务边界',
      });
      await service.listingCommand(h.owner.cookie, created.resourceId, {
        commandId: command(),
        type: 'SUBMIT',
        expectedVersion: 1,
        reason: '提交独立核验资质',
      });
      await expect(
        service.listingCommand(h.owner.cookie, created.resourceId, {
          commandId: command(),
          type: 'APPROVE',
          expectedVersion: 2,
          reason: '不能审核自己的供给',
          qualifiedUntil: at(10),
          qualificationChecked: true,
          scopeChecked: true,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.listingCommand(h.otherOwner.cookie, created.resourceId, {
          commandId: command(),
          type: 'APPROVE',
          expectedVersion: 2,
          reason: '未核资质不得认证',
          qualifiedUntil: at(10),
          qualificationChecked: false,
          scopeChecked: true,
        }),
      ).rejects.toMatchObject({ status: 422 });
      await assertCode(
        service.publicDetail(created.resourceId, 'x12-medic'),
        'LOCAL_SUPPLY_UNAVAILABLE',
      );
    });
    test('supply options reveal only current names and IDs to own managers; delegated callback preserves independent institutional review', async () => {
      const s = await supply();
      const options = await service.supplyOptions(h.owner.cookie, h.owner.orgId);
      expect(options.providers.some((p) => p.id === h.owner.id)).toBe(true);
      expect(options.courts.some((p) => p.id === s.courtId)).toBe(true);
      expect(options.providers.every((p) => Object.keys(p).sort().join(',') === 'id,name')).toBe(
        true,
      );
      await expect(service.supplyOptions(h.leader.cookie, h.owner.orgId)).rejects.toMatchObject({
        status: 404,
      });
      const delegated = new LocalServicesService(
        h.api.pool,
        { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
        undefined,
        async () => {
          throw forbidden();
        },
      );
      expect(
        (await delegated.privateListing(h.otherOwner.cookie, s.id)).capabilities.canReview,
      ).toBe(true);
      expect((await delegated.privateListing(h.owner.cookie, s.id)).capabilities.canReview).toBe(
        false,
      );
    });
    test('governance completion facts accept only actual active booking parties', async () => {
      const s = await supply('REFEREE');
      const b = await service.book(h.leader.cookie, bookBody(s));
      const c = await h.api.pool.connect();
      try {
        const fact = await verifiedGovernanceBooking(c, b.resourceId, h.leader.id, false);
        expect(fact).toMatchObject({
          bookingId: b.resourceId,
          buyerUserId: h.leader.id,
          providerUserId: h.owner.id,
          completed: false,
        });
        await expect(verifiedCompletedBooking(c, b.resourceId, h.leader.id)).rejects.toMatchObject({
          status: 404,
        });
        await expect(
          verifiedGovernanceBooking(c, b.resourceId, h.otherOwner.id, false),
        ).rejects.toMatchObject({ status: 404 });
        await c.query('BEGIN');
        await c.query("UPDATE users SET status='DISABLED' WHERE id=$1", [h.leader.id]);
        await expect(
          verifiedGovernanceBooking(c, b.resourceId, h.owner.id, false),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
    });
    test('reverse geocoder maps only verified official source codes to current catalog metadata', async () => {
      const node = (
        await h.api.pool.query(
          'SELECT source_code,level,name FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=$2',
          [REGION_CATALOG_VERSION, regionId],
        )
      ).rows[0];
      const p = { latitude: 22.9, longitude: 110.8, coordinateSystem: 'GCJ02' as const };
      const adapter = {
        enabled: true,
        search: async () => [],
        reverse: async () => [
          {
            title: '合成定位建议',
            address: '合成地址',
            point: p,
            sourceCode: node.source_code,
            source: 'TENCENT' as const,
            kind: 'REVERSE' as const,
          },
          {
            title: '未知地区',
            address: '未知地址',
            point: p,
            sourceCode: '000000',
            source: 'TENCENT' as const,
            kind: 'REVERSE' as const,
          },
        ],
      };
      const mapped = new LocalServicesService(
        h.api.pool,
        { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
        adapter,
      );
      const result = await mapped.location({ type: 'REVERSE', point: p }, 'synthetic-x12-reverse');
      expect(result.inventoryVerified).toBe(false);
      expect(result.candidates[0]).toMatchObject({
        region: region(),
        regionLabel: node.name,
        regionLevel: node.level,
      });
      expect(result.candidates[1]).not.toHaveProperty('region');
    });
    test('already expired legacy requests do not gain occupancy by an unrelated write', async () => {
      const s = await supply('REFEREE');
      const b = await service.book(h.leader.cookie, bookBody(s));
      const old = await oldAppearance(s.start, s.end, true);
      await expect(
        h.api.pool.query(
          "UPDATE booking_appearances SET expires_at=statement_timestamp()+interval '10 minutes',updated_at=statement_timestamp(),version=version+1 WHERE id=$1",
          [old],
        ),
      ).rejects.toMatchObject({ code: '23P01' });
      expect((await service.bookingDetail(h.leader.cookie, b.resourceId)).status).toBe('REQUESTED');
    });
    test('court arrival requires one-time buyer checkin, rotates safely and never stores or replays plaintext', async () => {
      const near =
        ((await h.api.pool.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime() +
          10 * 60000 -
          base) /
        3600000;
      const s = await supply('COURT', near),
        b = await service.book(h.leader.cookie, bookBody(s));
      await service.bookingCommand(h.leader.cookie, b.resourceId, {
        commandId: command(),
        expectedVersion: 1,
        type: 'CONFIRM',
        reason: '确认现场球场预约',
      });
      await assertCode(
        service.bookingCommand(h.owner.cookie, b.resourceId, {
          commandId: command(),
          expectedVersion: 2,
          type: 'ARRIVE',
          reason: '不能用经营方自行声明代替核销',
        }),
        'LOCAL_CHECKIN_REQUIRED',
      );
      const issue = { commandId: command(), expectedVersion: 2 },
        first = await service.issueCheckin(h.leader.cookie, b.resourceId, issue);
      expect(first.checkin?.code).toMatch(/^[0-9a-f]{32}$/);
      expect((await service.issueCheckin(h.leader.cookie, b.resourceId, issue)).checkin).toBeNull();
      const stored = (
        await h.api.pool.query(
          'SELECT checkin_hash,checkin_expires_at FROM local_bookings WHERE id=$1',
          [b.resourceId],
        )
      ).rows[0];
      expect(stored.checkin_hash).not.toBe(first.checkin!.code);
      expect(
        JSON.stringify(
          (
            await h.api.pool.query(
              'SELECT result FROM local_command_receipts WHERE actor_id=$1 AND command_id=$2',
              [h.leader.id, issue.commandId],
            )
          ).rows,
        ),
      ).not.toContain(first.checkin!.code);
      const second = await service.issueCheckin(h.leader.cookie, b.resourceId, {
        commandId: command(),
        expectedVersion: 3,
      });
      expect(second.checkin!.code).not.toBe(first.checkin!.code);
      await assertCode(
        service.bookingCommand(h.owner.cookie, b.resourceId, {
          commandId: command(),
          expectedVersion: 4,
          type: 'REDEEM_CHECKIN',
          checkinCode: first.checkin!.code,
          reason: '旧码不应仍可核销',
        }),
        'LOCAL_CHECKIN_INVALID',
      );
      await assertCode(
        service.bookingCommand(h.leader.cookie, b.resourceId, {
          commandId: command(),
          expectedVersion: 4,
          type: 'REDEEM_CHECKIN',
          checkinCode: second.checkin!.code,
          reason: '需求方不能冒充实际经营方核销',
        }),
        'LOCAL_CHECKIN_INVALID',
      );
      await service.bookingCommand(h.owner.cookie, b.resourceId, {
        commandId: command(),
        expectedVersion: 4,
        type: 'REDEEM_CHECKIN',
        checkinCode: second.checkin!.code,
        reason: '双方现场出示并核销当前一次性码',
      });
      expect((await service.bookingDetail(h.leader.cookie, b.resourceId)).status).toBe('ARRIVED');
      expect(
        (
          await h.api.pool.query(
            'SELECT checkin_hash,checkin_expires_at FROM local_bookings WHERE id=$1',
            [b.resourceId],
          )
        ).rows[0],
      ).toEqual({ checkin_hash: null, checkin_expires_at: null });
      await assertCode(
        service.bookingCommand(h.owner.cookie, b.resourceId, {
          commandId: command(),
          expectedVersion: 5,
          type: 'REDEEM_CHECKIN',
          checkinCode: second.checkin!.code,
          reason: '核销后同一码不能再次使用',
        }),
        'LOCAL_CHECKIN_INVALID',
      );
    });
    test('checkin issuance obeys DB time and cancellation invalidates issued credentials', async () => {
      const s = await supply(),
        b = await service.book(h.leader.cookie, bookBody(s));
      await service.bookingCommand(h.leader.cookie, b.resourceId, {
        commandId: command(),
        expectedVersion: 1,
        type: 'CONFIRM',
        reason: '确认远期实际场地',
      });
      await assertCode(
        service.issueCheckin(h.leader.cookie, b.resourceId, {
          commandId: command(),
          expectedVersion: 2,
        }),
        'LOCAL_CHECKIN_WINDOW',
      );
      const near =
        ((await h.api.pool.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime() +
          10 * 60000 -
          base) /
        3600000;
      const current = await supply('COURT', near),
        booked = await service.book(h.leader.cookie, bookBody(current));
      await service.bookingCommand(h.leader.cookie, booked.resourceId, {
        commandId: command(),
        expectedVersion: 1,
        type: 'CONFIRM',
        reason: '确认现场实际场地',
      });
      const issued = await service.issueCheckin(h.leader.cookie, booked.resourceId, {
        commandId: command(),
        expectedVersion: 2,
      });
      await h.api.pool.query(
        "UPDATE local_bookings SET checkin_expires_at=clock_timestamp()-interval '1 second',version=version+1 WHERE id=$1",
        [booked.resourceId],
      );
      await assertCode(
        service.bookingCommand(h.owner.cookie, booked.resourceId, {
          commandId: command(),
          expectedVersion: 4,
          type: 'REDEEM_CHECKIN',
          checkinCode: issued.checkin!.code,
          reason: '过期码不可由设备时钟延长',
        }),
        'LOCAL_CHECKIN_INVALID',
      );
      await service.bookingCommand(h.leader.cookie, booked.resourceId, {
        commandId: command(),
        expectedVersion: 4,
        type: 'CANCEL',
        reason: '取消现场需求并作废任何核销码',
      });
      expect(
        (
          await h.api.pool.query(
            'SELECT checkin_hash,checkin_expires_at FROM local_bookings WHERE id=$1',
            [booked.resourceId],
          )
        ).rows[0],
      ).toEqual({ checkin_hash: null, checkin_expires_at: null });
    });
    test('legacy C06 create and activation persist only known cross-calendar rejection after rolling back effects', async () => {
      const legacy = new PlayerBookingService(h.api.pool, {
        databaseUrl: h.databaseUrl,
        appOrigin: ORIGIN,
      });
      await maintainPlatformOperator(h.api.pool, {
        email: h.otherOwner.email,
        status: 'ACTIVE',
        reason: '仅隔离测试独立球员资料审核',
      });
      const version = (
        await h.api.pool.query('SELECT version FROM booking_profiles WHERE id=$1', [profileId])
      ).rows[0].version;
      const pending = await legacy.putProfile(h.owner.cookie, {
        commandId: command(),
        expectedVersion: version,
        displayName: '合成跨业务实际球员',
        position: 'PG',
        heightCm: 180,
        city: '合成市',
        bio: '隔离档期冲突回执验证',
        priceFen: 10000,
        travelFen: 0,
        accommodationFen: 0,
        availability: [{ startAt: at(-100), endAt: at(620) }],
        adultConfirmed: true,
      });
      const profile = await legacy.reviewProfile(h.otherOwner.cookie, profileId, {
        commandId: command(),
        expectedVersion: pending.version,
        status: 'APPROVED',
        reason: '独立核对合成测试资料',
      });
      const settings = (await h.api.pool.query('SELECT version FROM booking_settings WHERE id'))
        .rows[0].version;
      const s = await supply('REFEREE'),
        local = await service.book(h.leader.cookie, bookBody(s));
      const appearance = {
        profileId,
        label: '合成冲突场次',
        conditional: false,
        reportAt: s.start,
        startAt: s.start,
        endAt: s.end,
        venue: '双方确认实际服务场地',
      };
      const draft = {
        commandId: command(),
        orgId: h.owner.orgId,
        teamId: h.teams[0]!.id,
        eventName: '合成独立约赛',
        scope: 'MULTI',
        eligibilityConfirmed: true,
        reviewedSettingsVersion: settings,
        reviewedProfileVersions: { [profileId]: profile.version },
        appearances: [
          {
            ...appearance,
            label: '应被整体回滚的首项',
            reportAt: at(500),
            startAt: at(500),
            endAt: at(501),
          },
          appearance,
        ],
      };
      const count = Number(
        (await h.api.pool.query('SELECT count(*) AS n FROM booking_orders')).rows[0].n,
      );
      await expect(legacy.createOrder(h.leader.cookie, draft)).rejects.toMatchObject({
        status: 409,
        code: 'BOOKING_TIME_CONFLICT',
        details: { bookingCreateOutcome: 'REJECTED', commandId: draft.commandId },
      });
      expect(
        Number((await h.api.pool.query('SELECT count(*) AS n FROM booking_orders')).rows[0].n),
      ).toBe(count);
      expect(
        (
          await h.api.pool.query(
            'SELECT result FROM booking_operations WHERE actor_id=$1 AND command_id=$2',
            [h.leader.id, draft.commandId],
          )
        ).rows[0].result.outcome,
      ).toBe('REJECTED');
      const conditional = await legacy.createOrder(h.leader.cookie, {
        ...draft,
        commandId: command(),
        scope: 'TIME_BLOCK',
        appearances: [
          {
            profileId,
            label: '合成待触发项目',
            conditional: true,
            conditionText: '双方另行确认实际时间',
            venue: '待双方核定实际场馆',
          },
        ],
      });
      const activation = {
        commandId: command(),
        type: 'ACTIVATE',
        appearanceId: conditional.appearances[0]!.id,
        expectedVersion: 1,
        reportAt: s.start,
        startAt: s.start,
        endAt: s.end,
        venue: '双方确认实际服务场地',
        reason: '合成待触发转为确定档期',
      };
      await expect(
        legacy.command(h.leader.cookie, conditional.id, activation),
      ).rejects.toMatchObject({
        status: 409,
        code: 'BOOKING_TIME_CONFLICT',
        details: { bookingCommandOutcome: 'REJECTED', commandId: activation.commandId },
      });
      expect((await legacy.getOrder(h.leader.cookie, conditional.id)).appearances[0]).toMatchObject(
        { status: 'CONDITIONAL', version: 1 },
      );
      await service.bookingCommand(h.leader.cookie, local.resourceId, {
        commandId: command(),
        expectedVersion: 1,
        type: 'CANCEL',
        reason: '释放同城需求不复活原已拒绝命令',
      });
      await expect(legacy.createOrder(h.leader.cookie, draft)).rejects.toMatchObject({
        code: 'BOOKING_TIME_CONFLICT',
        details: { bookingCreateOutcome: 'REJECTED' },
      });
      await expect(
        legacy.command(h.leader.cookie, conditional.id, activation),
      ).rejects.toMatchObject({
        code: 'BOOKING_TIME_CONFLICT',
        details: { bookingCommandOutcome: 'REJECTED' },
      });
      await grant(h.api, h.owner, h.teams[0]!, h.leader, 'DISABLED');
      try {
        await expect(legacy.createOrder(h.leader.cookie, draft)).rejects.toMatchObject({
          status: 404,
        });
        await expect(
          legacy.command(h.leader.cookie, conditional.id, activation),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        await grant(h.api, h.owner, h.teams[0]!, h.leader, 'ACTIVE');
      }
      expect(
        (
          await legacy.command(h.leader.cookie, conditional.id, {
            ...activation,
            commandId: command(),
          })
        ).appearances[0]!.status,
      ).toBe('REQUESTED');
    });
    test('cross-organization matchup creation racing court cancellation never leaves occupied teams or a live matchup', async () => {
      for (let i = 0; i < 4; i++) {
        const s = await supply(),
          b = await service.book(h.leader.cookie, bookBody(s));
        await service.bookingCommand(h.leader.cookie, b.resourceId, {
          commandId: command(),
          expectedVersion: 1,
          type: 'CONFIRM',
          reason: '确认跨机构约赛实际场地',
        });
        const [created, cancelled] = await Promise.allSettled([
          service.createMatchup(h.leader.cookie, {
            commandId: command(),
            homeOrgId: h.owner.orgId,
            homeTeamId: h.teams[0]!.id,
            awayOrgId: h.otherOwner.orgId,
            awayTeamId: h.otherTeams[0]!.id,
            courtBookingId: b.resourceId,
            terms: '双方确认现场时间与场地，核对跨组织取消竞态',
          }),
          service.bookingCommand(h.leader.cookie, b.resourceId, {
            commandId: command(),
            expectedVersion: 2,
            type: 'CANCEL',
            reason: '并发取消场地不得留下球队占用或有效约赛',
          }),
        ]);
        expect(cancelled.status).toBe('fulfilled');
        if (created.status === 'rejected')
          expect(created.reason).toMatchObject({ code: 'LOCAL_COURT_BOOKING_REQUIRED' });
        const matches = (
          await h.api.pool.query('SELECT id,status FROM local_matchups WHERE court_booking_id=$1', [
            b.resourceId,
          ])
        ).rows;
        expect(matches.every((m) => m.status === 'CANCELLED')).toBe(true);
        expect(
          (
            await h.api.pool.query(
              'SELECT id FROM local_resource_reservations WHERE active AND (booking_id=$1 OR matchup_id=ANY($2::uuid[]))',
              [b.resourceId, matches.map((m) => m.id)],
            )
          ).rowCount,
        ).toBe(0);
        expect((await service.bookingDetail(h.leader.cookie, b.resourceId)).status).toBe(
          'CANCELLED',
        );
      }
    }, 120000);
    test('disabled physical courts stay manageable but disappear from public supply and cannot accept new local bookings', async () => {
      const s = await supply(),
        privateView = await service.privateListing(h.owner.cookie, s.id);
      const actual = (
        await h.api.pool.query('SELECT name,version FROM courts WHERE id=$1', [s.courtId])
      ).rows[0];
      data(
        await call(h.api, 'patch', `/v1/orgs/${h.owner.orgId}/courts/${s.courtId}`, {
          cookie: h.owner.cookie,
          body: { expectedVersion: actual.version, name: actual.name, status: 'DISABLED' },
        }),
      );
      expect((await service.privateListing(h.owner.cookie, s.id)).listing.id).toBe(s.id);
      expect(
        (
          await service.publicList(
            { q: privateView.listing.title, regionId, catalogVersion: REGION_CATALOG_VERSION },
            'synthetic-disabled-court',
          )
        ).items,
      ).toHaveLength(0);
      await expect(service.publicDetail(s.id, 'synthetic-disabled-court')).rejects.toMatchObject({
        status: 404,
      });
      await assertCode(service.book(h.leader.cookie, bookBody(s)), 'LOCAL_SUPPLY_UNAVAILABLE');
    });
    test('legacy scheduling refuses active local holds, avoids them in previews and ignores only DB-expired holds', async () => {
      const s = await supply(),
        local = await service.book(h.leader.cookie, bookBody(s));
      const actual = (
        await h.api.pool.query('SELECT name,version FROM courts WHERE id=$1', [s.courtId])
      ).rows[0];
      const disable = () =>
        call(h.api, 'patch', `/v1/orgs/${h.owner.orgId}/courts/${s.courtId}`, {
          cookie: h.owner.cookie,
          body: { expectedVersion: actual.version, name: actual.name, status: 'DISABLED' },
        });
      const blocked = await disable();
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('COURT_HAS_RESERVATIONS');
      const f = await frozen(h, h.owner, h.teams, {
        startDate: new Date(Date.parse(s.start) - 86400000).toISOString().slice(0, 10),
        endDate: new Date(Date.parse(s.end) + 86400000).toISOString().slice(0, 10),
      });
      const physical = { id: s.courtId! } as Awaited<ReturnType<typeof court>>;
      let draft = await revision(h.api, h.owner, f, [physical], {
        courtWindows: [
          {
            courtId: physical.id,
            startsAt: s.start,
            endsAt: new Date(Date.parse(s.end) + 3 * 3600000).toISOString(),
          },
        ],
      });
      draft = await allocate(h.api, h.owner, draft, fullAllocations(draft, physical, s.start));
      const busy = await validate(h.api, h.owner, draft);
      expect(busy.valid).toBe(false);
      expect(busy.conflicts.some((c) => c.code === 'COURT_OVERLAP' && c.external)).toBe(true);
      expect(JSON.stringify(busy)).not.toContain(local.resourceId);
      const preview = data<{
        status: string;
        score: { assignedCount: number };
        allocations: Array<{ startsAt: string }>;
      }>(
        await call(
          h.api,
          'post',
          `/v1/orgs/${h.owner.orgId}/schedule-revisions/${draft.id}/optimization-preview`,
          {
            cookie: h.owner.cookie,
            body: {
              expectedEventVersion: draft.eventVersion,
              expectedRevisionVersion: draft.version,
              preserveAssigned: false,
            },
          },
        ),
      );
      expect(preview.status).toBe('COMPLETE');
      expect(preview.score.assignedCount).toBe(draft.fixtures.length);
      expect(preview.allocations.every((a) => Date.parse(a.startsAt) >= Date.parse(s.end))).toBe(
        true,
      );
      await h.api.pool.query(
        "UPDATE local_bookings SET hold_expires_at=clock_timestamp()-interval '1 second',version=version+1 WHERE id=$1",
        [local.resourceId],
      );
      expect((await validate(h.api, h.owner, draft)).valid).toBe(true);
      expect((await disable()).status).toBe(200);
      await assertCode(service.book(h.leader.cookie, bookBody(s)), 'LOCAL_SUPPLY_UNAVAILABLE');
    }, 120000);
    test('scoped review rechecks the pinned grant after calendar waits and rolls back expired or replaced authority', async () => {
      for (const mode of ['EXPIRE', 'REPLACE']) {
        const draft = await service.createListing(h.owner.cookie, h.owner.orgId, {
          commandId: command(),
          kind: 'REFEREE',
          title: '合成城市委派复核',
          description: '仅验证授权回调在锁等待后的DB时钟复核',
          address: '公开服务地址',
          region: region(),
          coverageRegionIds: [regionId],
          providerUserId: h.owner.id,
          qualificationNote: '待独立核验服务主体与必要资格',
          terms: '按实际服务范围和到场约定履约',
        });
        await service.listingCommand(h.owner.cookie, draft.resourceId, {
          commandId: command(),
          expectedVersion: 1,
          type: 'SUBMIT',
          reason: '等待独立城市范围复核',
        });
        const grantId = command(),
          replacement = command(),
          scopeCalls: Array<{ grantId?: string | null }> = [];
        let first!: () => void, expiresAt: Date | undefined;
        const ready = new Promise<void>((resolve) => {
          first = resolve;
        });
        const scoped = new LocalServicesService(
          h.api.pool,
          { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
          undefined,
          async (c, _actor, input) => {
            scopeCalls.push(input);
            if (!expiresAt) {
              expiresAt = (
                await c.query("SELECT clock_timestamp()+interval '200 milliseconds' AS expiry")
              ).rows[0].expiry;
              first();
              return { grantId, platformOperator: false };
            }
            expect(input.grantId).toBe(grantId);
            if (
              mode === 'EXPIRE' &&
              !(await c.query('SELECT clock_timestamp()<$1::timestamptz AS valid', [expiresAt]))
                .rows[0].valid
            )
              throw forbidden();
            return { grantId: mode === 'REPLACE' ? replacement : grantId, platformOperator: false };
          },
        );
        const locker = await h.api.pool.connect();
        await locker.query('BEGIN');
        await locker.query('SELECT x12_calendar_lock()');
        const commandId = command();
        const outcome = scoped
          .listingCommand(h.leader.cookie, draft.resourceId, {
            commandId,
            expectedVersion: 2,
            type: 'APPROVE',
            reason: '在等待calendar锁后必须仍有原授权',
            qualifiedUntil: at(1000),
            qualificationChecked: true,
            scopeChecked: true,
          })
          .then(
            (value) => ({ ok: true as const, value }),
            (error) => ({ ok: false as const, error }),
          );
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            ready,
            outcome.then(() => {
              throw new Error('Review must wait for the held calendar lock');
            }),
            new Promise<void>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error('Review never reached initial authority')),
                3000,
              );
            }),
          ]);
          await locker.query('SELECT pg_sleep(0.35)');
        } finally {
          if (timer) clearTimeout(timer);
          await locker.query('ROLLBACK');
          locker.release();
        }
        const result = await outcome;
        if (result.ok) throw new Error('Expired or replaced authority must not commit');
        expect(result.error).toMatchObject({ status: 403 });
        expect(scopeCalls).toHaveLength(2);
        expect(
          (
            await h.api.pool.query('SELECT status,version FROM local_listings WHERE id=$1', [
              draft.resourceId,
            ])
          ).rows[0],
        ).toEqual({ status: 'PENDING', version: 2 });
        expect(
          (
            await h.api.pool.query(
              'SELECT 1 FROM local_command_receipts WHERE actor_id=$1 AND command_id=$2',
              [h.leader.id, commandId],
            )
          ).rowCount,
        ).toBe(0);
      }
    }, 15000);
    test('same command and content returns one original receipt; changed content is rejected', async () => {
      const s = await supply();
      const body = bookBody(s);
      const first = await service.book(h.leader.cookie, body),
        replay = await service.book(h.leader.cookie, body);
      expect(replay).toEqual(first);
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::int AS n FROM local_bookings WHERE listing_id=$1',
            [s.id],
          )
        ).rows[0].n,
      ).toBe(1);
      await assertCode(
        service.book(h.leader.cookie, { ...body, acceptedTerms: true, slotId: randomUUID() }),
        'COMMAND_ID_REUSED',
      );
      await expect(service.receipt(h.otherOwner.cookie, body.commandId)).rejects.toMatchObject({
        status: 404,
      });
    });
    test('two buyers racing a court slot cannot oversell and neither sees the other private order', async () => {
      const s = await supply();
      const results = await Promise.allSettled([
        service.book(h.leader.cookie, bookBody(s)),
        service.book(h.otherOwner.cookie, bookBody(s)),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failure.reason).toMatchObject({ code: 'LOCAL_TIME_CONFLICT' });
      const winner = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
        Record<string, any>
      >;
      await expect(
        service.bookingDetail(h.owner.cookie, winner.value.resourceId),
      ).resolves.toMatchObject({ canActAs: 'PROVIDER', paymentStatus: 'NOT_ENABLED' });
      const losingCookie =
        results[0]!.status === 'fulfilled' ? h.otherOwner.cookie : h.leader.cookie;
      // Independent organization admins may view org orders, while unrelated accounts may not.
      if (losingCookie === h.leader.cookie)
        await expect(
          service.bookingDetail(losingCookie, winner.value.resourceId),
        ).rejects.toMatchObject({ status: 404 });
    });
    test('DB-clock expired hold releases capacity without deleting history or reviving on replay', async () => {
      const s = await supply(),
        body = bookBody(s),
        held = await service.book(h.leader.cookie, body);
      await h.api.pool.query(
        "UPDATE local_bookings SET hold_expires_at=clock_timestamp()-interval '1 second',version=version+1 WHERE id=$1",
        [held.resourceId],
      );
      expect(await service.bookingDetail(h.leader.cookie, held.resourceId)).toMatchObject({
        status: 'EXPIRED',
      });
      const fresh = await service.book(h.otherOwner.cookie, bookBody(s));
      expect(fresh.resourceId).not.toBe(held.resourceId);
      expect(await service.book(h.leader.cookie, body)).toEqual(held);
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::int AS n FROM local_bookings WHERE listing_id=$1',
            [s.id],
          )
        ).rows[0].n,
      ).toBe(2);
    });
    test('one actual person cannot evade conflicts with a second listing or the old player calendar', async () => {
      const hours = ++serial * 4;
      const s1 = await supply('REFEREE', hours),
        s2 = await supply('RECORDER', hours);
      await service.book(h.leader.cookie, bookBody(s1));
      await assertCode(service.book(h.otherOwner.cookie, bookBody(s2)), 'LOCAL_TIME_CONFLICT');
      await expect(oldAppearance(s1.start, s1.end)).rejects.toMatchObject({ code: '23P01' });
      const hours2 = ++serial * 4;
      const s3 = await supply('PHOTOGRAPHER', hours2);
      await oldAppearance(s3.start, s3.end);
      await assertCode(service.book(h.leader.cookie, bookBody(s3)), 'LOCAL_TIME_CONFLICT');
    });
    test('role and time guards keep receipt replay from performing provider/buyer actions', async () => {
      const s = await supply('SCORER'),
        booking = await service.book(h.leader.cookie, bookBody(s));
      await assertCode(
        service.bookingCommand(h.leader.cookie, booking.resourceId, {
          commandId: command(),
          type: 'ACCEPT',
          expectedVersion: 1,
          reason: '买方不可假装服务方',
        }),
        'LOCAL_STATE_CONFLICT',
      );
      await service.bookingCommand(h.owner.cookie, booking.resourceId, {
        commandId: command(),
        type: 'ACCEPT',
        expectedVersion: 1,
        reason: '服务人员确认真实档期',
      });
      await assertCode(
        service.bookingCommand(h.owner.cookie, booking.resourceId, {
          commandId: command(),
          type: 'ARRIVE',
          expectedVersion: 2,
          reason: '未来时段不能伪到场',
        }),
        'LOCAL_STATE_CONFLICT',
      );
      expect(await service.bookingDetail(h.leader.cookie, booking.resourceId)).toMatchObject({
        status: 'CONFIRMED',
        paymentStatus: 'NOT_ENABLED',
      });
    });
    test('failed replacement slot keeps original reservation; accepted change is atomic', async () => {
      const s = await supply(),
        b = await service.book(h.leader.cookie, bookBody(s));
      await service.bookingCommand(h.leader.cookie, b.resourceId, {
        commandId: command(),
        type: 'CONFIRM',
        expectedVersion: 1,
        reason: '确认实际球场时段',
      });
      const newSlot = await service.createSlot(h.owner.cookie, s.id, {
        commandId: command(),
        expectedVersion: 4,
        startsAt: at(++serial * 4),
        endsAt: at(serial * 4 + 1),
      });
      const taken = await service.book(h.otherOwner.cookie, {
        ...bookBody(s),
        slotId: newSlot.slotId,
      });
      await service.bookingCommand(h.leader.cookie, b.resourceId, {
        commandId: command(),
        type: 'PROPOSE_CHANGE',
        expectedVersion: 2,
        newSlotId: newSlot.slotId,
        reason: '双方核对改到新时段',
      });
      await assertCode(
        service.bookingCommand(h.owner.cookie, b.resourceId, {
          commandId: command(),
          type: 'ACCEPT_CHANGE',
          expectedVersion: 3,
          reason: '新时段被占须保持旧场地',
        }),
        'LOCAL_TIME_CONFLICT',
      );
      expect(await service.bookingDetail(h.leader.cookie, b.resourceId)).toMatchObject({
        slotId: s.slotId,
        version: 3,
      });
      await service.bookingCommand(h.otherOwner.cookie, taken.resourceId, {
        commandId: command(),
        type: 'CANCEL',
        expectedVersion: 1,
        reason: '解除合成占用以核验原子改期',
      });
      await service.bookingCommand(h.owner.cookie, b.resourceId, {
        commandId: command(),
        type: 'ACCEPT_CHANGE',
        expectedVersion: 3,
        reason: '另一方确认新时段',
      });
      expect(await service.bookingDetail(h.leader.cookie, b.resourceId)).toMatchObject({
        slotId: newSlot.slotId,
        version: 4,
      });
    });
    test('weather closure cancels only affected future bookings and blocks new use', async () => {
      const s = await supply(),
        b = await service.book(h.leader.cookie, bookBody(s));
      await service.bookingCommand(h.leader.cookie, b.resourceId, {
        commandId: command(),
        type: 'CONFIRM',
        expectedVersion: 1,
        reason: '确认真实场地预约',
      });
      await service.closeSlot(h.owner.cookie, s.id, s.slotId, {
        commandId: command(),
        expectedVersion: 1,
        reason: '暴雨停场，按规则取消本时隙',
      });
      expect(await service.bookingDetail(h.leader.cookie, b.resourceId)).toMatchObject({
        status: 'CANCELLED',
      });
      await assertCode(service.book(h.otherOwner.cookie, bookBody(s)), 'LOCAL_SLOT_UNAVAILABLE');
    });
    test('two distinct team managers confirm a matchup and court cancellation invalidates it', async () => {
      const s = await supply(),
        booking = await service.book(h.leader.cookie, bookBody(s));
      await service.bookingCommand(h.leader.cookie, booking.resourceId, {
        commandId: command(),
        type: 'CONFIRM',
        expectedVersion: 1,
        reason: '确认约赛实际场地',
      });
      const m = await service.createMatchup(h.leader.cookie, {
        commandId: command(),
        homeOrgId: h.owner.orgId,
        homeTeamId: h.teams[0]!.id,
        awayOrgId: h.otherOwner.orgId,
        awayTeamId: h.otherTeams[0]!.id,
        courtBookingId: booking.resourceId,
        terms: '双方确认时间、场地与人数，无正式赛事统计',
      });
      await expect(
        service.matchupCommand(h.leader.cookie, m.resourceId, {
          commandId: command(),
          expectedVersion: 1,
          type: 'CONFIRM',
          reason: '同人不可代表双方确认',
        }),
      ).rejects.toMatchObject({ status: 403 });
      await service.matchupCommand(h.otherOwner.cookie, m.resourceId, {
        commandId: command(),
        expectedVersion: 1,
        type: 'CONFIRM',
        reason: '对方队长确认实际约赛',
      });
      expect(
        (await service.matchups(h.leader.cookie)).items.find((v) => v.id === m.resourceId),
      ).toMatchObject({ status: 'CONFIRMED', homeConfirmed: true, awayConfirmed: true });
      await service.bookingCommand(h.leader.cookie, booking.resourceId, {
        commandId: command(),
        expectedVersion: 2,
        type: 'CANCEL',
        reason: '场地安排取消，双方约赛应同步失效',
      });
      expect(
        (await service.matchups(h.otherOwner.cookie)).items.find((v) => v.id === m.resourceId),
      ).toMatchObject({ status: 'CANCELLED' });
    });
    test('old published court reservations and local holds are checked in both directions', async () => {
      const startDate = at(0).slice(0, 10),
        endDate = at(24 * 5).slice(0, 10);
      const current = await frozen(h, h.owner, h.teams, { startDate, endDate });
      const physical = await court(h.api, h.owner, 'X12发布冲突场');
      let plan = await revision(h.api, h.owner, current, [physical]);
      const start = `${startDate}T15:00:00+08:00`;
      plan = await allocate(h.api, h.owner, plan, fullAllocations(plan, physical, start));
      const result = await publish(h.api, h.owner, plan);
      expect(result.status).toBe(200);
      const created = await service.createListing(h.owner.cookie, h.owner.orgId, {
        commandId: command(),
        kind: 'COURT',
        title: '真实发布冲突场地',
        description: '已有正式赛事占用',
        address: '公开经营地址',
        region: region(),
        coverageRegionIds: [regionId],
        providerUserId: h.owner.id,
        courtId: physical.id,
        qualificationNote: '独立审核经营授权',
        terms: '不得绕过正式赛事占用',
      });
      await service.listingCommand(h.owner.cookie, created.resourceId, {
        commandId: command(),
        type: 'SUBMIT',
        expectedVersion: 1,
        reason: '独立提交经营资质',
      });
      await service.listingCommand(h.otherOwner.cookie, created.resourceId, {
        commandId: command(),
        type: 'APPROVE',
        expectedVersion: 2,
        reason: '核对实际场地和资质',
        qualifiedUntil: at(1000),
        qualificationChecked: true,
        scopeChecked: true,
      });
      await service.listingCommand(h.owner.cookie, created.resourceId, {
        commandId: command(),
        type: 'PUBLISH',
        expectedVersion: 3,
        reason: '上架已审核的经营资源',
      });
      const slot = await service.createSlot(h.owner.cookie, created.resourceId, {
        commandId: command(),
        expectedVersion: 4,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(Date.parse(start) + 3600000).toISOString(),
      });
      await assertCode(
        service.book(
          h.leader.cookie,
          bookBody({ id: created.resourceId, slotId: slot.slotId, kind: 'COURT' }),
        ),
        'LOCAL_TIME_CONFLICT',
      );
      const localFirst = await supply();
      await service.book(h.leader.cookie, bookBody(localFirst));
      const current2 = await frozen(h, h.owner, h.teams, {
        startDate: new Date(Date.parse(localFirst.start) - 86400000).toISOString().slice(0, 10),
        endDate: new Date(Date.parse(localFirst.end) + 86400000).toISOString().slice(0, 10),
      });
      const physical2 = { id: localFirst.courtId! } as Awaited<ReturnType<typeof court>>;
      let plan2 = await revision(h.api, h.owner, current2, [physical2]);
      plan2 = await allocate(
        h.api,
        h.owner,
        plan2,
        fullAllocations(plan2, physical2, localFirst.start),
      );
      expect((await publish(h.api, h.owner, plan2)).status).toBe(409);
    }, 60000);
    test('bounded cross-calendar race stress rejects conflicts without deadlock or oversell', async () => {
      for (let n = 0; n < 6; n++) {
        const hours = ++serial * 4,
          s = await supply('REFEREE', hours);
        const r = await Promise.allSettled([
          service.book(h.leader.cookie, bookBody(s)),
          oldAppearance(s.start, s.end),
        ]);
        expect(r.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
        const failures = r.filter((v) => v.status === 'rejected') as PromiseRejectedResult[];
        expect(failures[0]!.reason.code).not.toBe('40P01');
        expect(['23P01', 'LOCAL_TIME_CONFLICT']).toContain(failures[0]!.reason.code);
      }
    }, 60000);
    test('an audit failure rolls back booking, ledger and permanent receipt together', async () => {
      const s = await supply(),
        body = bookBody(s),
        name = `x12_test_fail_${randomUUID().replaceAll('-', '')}`;
      await h.api.pool.query(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id='${h.leader.id}'::uuid AND NEW.action='HOLD_COURT' THEN RAISE EXCEPTION 'synthetic X12 audit failure'; END IF; RETURN NEW; END; $$`,
      );
      await h.api.pool.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON local_service_history FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      try {
        await expect(service.book(h.leader.cookie, body)).rejects.toThrow(
          'synthetic X12 audit failure',
        );
        expect(
          (
            await h.api.pool.query(
              'SELECT count(*)::int AS n FROM local_bookings WHERE listing_id=$1',
              [s.id],
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          (
            await h.api.pool.query(
              'SELECT count(*)::int AS n FROM local_command_receipts WHERE actor_id=$1 AND command_id=$2',
              [h.leader.id, body.commandId],
            )
          ).rows[0].n,
        ).toBe(0);
      } finally {
        await h.api.pool.query(`DROP TRIGGER ${name} ON local_service_history`);
        await h.api.pool.query(`DROP FUNCTION ${name}()`);
      }
      expect(await service.book(h.leader.cookie, body)).toHaveProperty('resourceId');
    });
    test('public transport exposes real disabled capability and never accepts coordinates in query URLs', async () => {
      const response = await call(h.api, 'post', '/v1/public/local-location', {
        body: {
          type: 'REVERSE',
          point: { latitude: 22.9, longitude: 110.8, coordinateSystem: 'GCJ02' },
        },
      });
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('LOCATION_PROVIDER_DISABLED');
      const unsafe = await call(h.api, 'get', '/v1/public/local-listings?point=22.9,110.8');
      expect(unsafe.status).toBe(422);
    });
  },
);
