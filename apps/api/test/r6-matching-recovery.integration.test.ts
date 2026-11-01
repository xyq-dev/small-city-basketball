import { randomUUID } from 'node:crypto';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import type { PoolClient } from 'pg';
import { beforeAll, afterAll, describe, test, expect } from 'vitest';
import { LocalServicesService } from '../src/local-services-service.js';
import { PlayerBookingService } from '../src/player-booking/service.js';
import { createMatchingLocalSourceHooks } from '../src/matching-local-source.js';
import { inspectMatchingPlayerEnded } from '../src/matching-player-recovery.js';
import type { Actor } from '../src/service.js';
import { REGION_CATALOG_VERSION } from '../src/region-catalog-data.js';
import { createHarness, closeHarness, court } from './p04-support.js';
import type { Harness } from './p04-support.js';
import { grant } from './p03-support.js';
import { ORIGIN } from './support.js';
class SourceInspector extends LocalServicesService {
  run<T>(cookie: string, work: (c: PoolClient, a: Actor) => Promise<T>) {
    return this.transaction(async (c) => work(c, await this.lockActor(c, cookie)));
  }
}
describe(
  'R6 source recovery uses database expiry and preserves unresolved financial facts',
  { concurrent: false },
  () => {
    let h: Harness,
      local: SourceInspector,
      player: PlayerBookingService,
      regionId: string,
      profileId: string,
      base: number;
    let serial = 0;
    const at = (hours: number) => new Date(base + hours * 3600000).toISOString();
    beforeAll(async () => {
      h = await createHarness(1);
      await maintainPlatformOperator(h.api.pool, {
        email: h.owner.email,
        status: 'ACTIVE',
        reason: '合成撮合隔离测试审核员',
      });
      base =
        (await h.api.pool.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime() +
        10 * 86400000;
      local = new SourceInspector(h.api.pool, { databaseUrl: h.databaseUrl, appOrigin: ORIGIN });
      player = new PlayerBookingService(h.api.pool, {
        databaseUrl: h.databaseUrl,
        appOrigin: ORIGIN,
      });
      regionId = (
        await h.api.pool.query(
          "SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND level='COUNTY' ORDER BY source_code LIMIT 1",
          [REGION_CATALOG_VERSION],
        )
      ).rows[0].region_id;
      await grant(h.api, h.owner, h.teams[0]!, h.owner);
      await grant(h.api, h.otherOwner, h.otherTeams[0]!, h.otherOwner);
      profileId = randomUUID();
      await h.api.pool.query(
        "INSERT INTO booking_profiles(id,user_id,display_name,position,height_cm,city,bio,price_fen,availability,status,reviewed_by,reviewed_at) VALUES($1,$2,'恢复合成控卫','PG',180,'合成城市','仅隔离恢复测试',1000,$3::jsonb,'APPROVED',$4,clock_timestamp())",
        [profileId, h.leader.id, JSON.stringify([{ startAt: at(0), endAt: at(1000) }]), h.owner.id],
      );
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    });
    async function booking(kind = 'SCORER') {
      const listingId = randomUUID(),
        slotId = randomUUID(),
        start = ++serial * 6,
        actualCourt = kind === 'COURT' ? await court(h.api, h.owner, 'R6恢复实际球场') : null;
      await h.api.pool.query(
        "INSERT INTO local_listings(id,org_id,provider_user_id,created_by,kind,court_id,title,description,address,region_catalog_version,region_id,coverage_region_ids,qualification_note,terms,provider_confirmed,status,published,qualified_until,reviewed_by,reviewed_at) VALUES($1,$2,$3,$3,$4,$5,'恢复合成服务','隔离来源恢复测试','合成实际场馆',$6,$7,ARRAY[$7::uuid],'合成独立核验资质','合成服务与取消约定',true,'APPROVED',true,clock_timestamp()+interval '1 year',$8,clock_timestamp())",
        [
          listingId,
          h.owner.orgId,
          h.owner.id,
          kind,
          actualCourt?.id ?? null,
          REGION_CATALOG_VERSION,
          regionId,
          h.otherOwner.id,
        ],
      );
      await h.api.pool.query(
        'INSERT INTO local_slots(id,org_id,listing_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)',
        [slotId, h.owner.orgId, listingId, at(start), at(start + 2)],
      );
      const result = await local.book(h.otherOwner.cookie, {
        commandId: randomUUID(),
        listingId,
        slotId,
        serviceRegion: { catalogVersion: REGION_CATALOG_VERSION, regionId },
        ...(kind === 'COURT' ? {} : { serviceAddress: '合成实际场馆' }),
        acceptedTerms: true,
      });
      if (kind === 'COURT')
        await local.bookingCommand(h.otherOwner.cookie, result.resourceId, {
          commandId: randomUUID(),
          expectedVersion: 1,
          type: 'CONFIRM',
          reason: '确认恢复测试实际场馆',
        });
      return {
        id: result.resourceId,
        startsAt: at(start),
        endsAt: at(start + 2),
        courtId: actualCourt?.id,
      };
    }
    async function playerOrder(count = 1) {
      const start = ++serial * 6,
        settings = (await h.api.pool.query('SELECT * FROM booking_settings WHERE id')).rows[0];
      return player.createOrder(h.otherOwner.cookie, {
        commandId: randomUUID(),
        orgId: h.otherOwner.orgId,
        teamId: h.otherTeams[0]!.id,
        eventName: 'R6恢复测试',
        scope: count === 1 ? 'SINGLE' : 'MULTI',
        eligibilityConfirmed: true,
        reviewedSettingsVersion: settings.version,
        reviewedProfileVersions: { [profileId]: 1 },
        appearances: Array.from({ length: count }, (_, i) => ({
          profileId,
          label: '确定场次' + i,
          conditional: false,
          reportAt: at(start + i * 3),
          startAt: at(start + i * 3 + 0.25),
          endAt: at(start + i * 3 + 2),
          venue: '合成实际场馆',
        })),
      });
    }
    async function unknownPayment(
      kind: 'LOCAL_BOOKING' | 'PLAYER_APPEARANCE',
      sourceId: string,
      orgId: string,
      beneficiary: string,
    ) {
      const id = randomUUID();
      await h.api.pool.query(
        "INSERT INTO trade_orders(id,org_id,kind,source_id,source_version,source_snapshot,source_hash,payer_user_id,beneficiary_user_id,merchant_key,merchant_id,merchant_app_id,merchant_name,total_fen,quote) VALUES($1,$2,$3,$4,1,'{}',$5,$6,$7,'synthetic-recovery','synthetic-merchant','synthetic-app','合成收款方',1100,'{}')",
        [id, orgId, kind, sourceId, '0'.repeat(64), h.otherOwner.id, beneficiary],
      );
      const attempt = randomUUID();
      await h.api.pool.query(
        "INSERT INTO trade_payment_attempts(id,order_id,out_trade_no,channel,status,total_fen,currency,fence,expires_at) VALUES($1,$2,$3,'NATIVE','UNKNOWN',1100,'CNY',$4,clock_timestamp()+interval '1 hour')",
        [attempt, id, randomUUID().replaceAll('-', ''), randomUUID()],
      );
      return { id, attempt };
    }
    test('an expired staff request is ended without rewriting its original source status', async () => {
      const b = await booking();
      await h.api.pool.query(
        "UPDATE local_bookings SET hold_expires_at=clock_timestamp()-interval '1 second',version=version+1 WHERE id=$1",
        [b.id],
      );
      const result = await local.run(h.otherOwner.cookie, (c, a) =>
        createMatchingLocalSourceHooks(local).inspectEnded!(c, a, {
          sourceKind: 'LOCAL_BOOKING',
          sourceId: b.id,
        }),
      );
      expect(result).toEqual({
        ended: true,
        completed: false,
        unresolvedMoney: false,
        retainedCostFen: 0,
      });
      expect(
        (await h.api.pool.query('SELECT status FROM local_bookings WHERE id=$1', [b.id])).rows[0]
          .status,
      ).toBe('REQUESTED');
      expect(
        (
          await h.api.pool.query(
            'SELECT id FROM local_resource_reservations WHERE booking_id=$1 AND active',
            [b.id],
          )
        ).rowCount,
      ).toBe(0);
    });
    test('expiry cannot release the matching budget while a staff payment is unknown', async () => {
      const b = await booking();
      await h.api.pool.query(
        "UPDATE local_bookings SET hold_expires_at=clock_timestamp()-interval '1 second',version=version+1 WHERE id=$1",
        [b.id],
      );
      const money = await unknownPayment('LOCAL_BOOKING', b.id, h.owner.orgId, h.owner.id);
      const result = await local.run(h.otherOwner.cookie, (c, a) =>
        createMatchingLocalSourceHooks(local).inspectEnded!(c, a, {
          sourceKind: 'LOCAL_BOOKING',
          sourceId: b.id,
        }),
      );
      expect(result).toMatchObject({ ended: true, completed: false, unresolvedMoney: true });
      expect(
        (
          await h.api.pool.query('SELECT status FROM trade_payment_attempts WHERE id=$1', [
            money.attempt,
          ])
        ).rows[0].status,
      ).toBe('UNKNOWN');
    });
    test('expired OPEN team invitations release their stale hold and become recoverable without altering immutable expiry', async () => {
      const b = await booking('COURT'),
        id = randomUUID();
      // Explicit expired source fixture: X12 intentionally never rewrites an OPEN expiry timestamp.
      await h.api.pool.query(
        "INSERT INTO local_matchups(id,home_org_id,home_team_id,away_org_id,away_team_id,court_booking_id,created_by,home_confirmed_by,starts_at,ends_at,expires_at,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,clock_timestamp()-interval '1 second',$10::jsonb)",
        [
          id,
          h.otherOwner.orgId,
          h.otherTeams[0]!.id,
          h.owner.orgId,
          h.teams[0]!.id,
          b.id,
          h.otherOwner.id,
          b.startsAt,
          b.endsAt,
          JSON.stringify({
            homeTeamName: '合成主队',
            awayTeamName: '合成客队',
            courtId: b.courtId,
            courtOrgId: h.owner.orgId,
            address: '合成实际场馆',
            terms: '合成真实场地约定',
          }),
        ],
      );
      await h.api.pool.query(
        'INSERT INTO local_resource_reservations(id,resource_key,matchup_id,starts_at,ends_at,active) VALUES($1,$2,$3,$4,$5,true)',
        [randomUUID(), 'team:' + h.otherTeams[0]!.id, id, b.startsAt, b.endsAt],
      );
      const result = await local.run(h.otherOwner.cookie, (c, a) =>
        createMatchingLocalSourceHooks(local).inspectEnded!(c, a, {
          sourceKind: 'TEAM_MATCHUP',
          sourceId: id,
        }),
      );
      expect(result).toEqual({
        ended: true,
        completed: false,
        unresolvedMoney: false,
        retainedCostFen: 0,
      });
      expect(
        (await h.api.pool.query('SELECT status FROM local_matchups WHERE id=$1', [id])).rows[0]
          .status,
      ).toBe('OPEN');
      expect(
        (
          await h.api.pool.query(
            'SELECT id FROM local_resource_reservations WHERE matchup_id=$1 AND active',
            [id],
          )
        ).rowCount,
      ).toBe(0);
    });
    test('C06 logical expiry is recognized even when no other workspace has materialized EXPIRED', async () => {
      const order = await playerOrder();
      await h.api.pool.query(
        "UPDATE booking_appearances SET expires_at=clock_timestamp()-interval '1 second',updated_at=clock_timestamp()-interval '2 minutes',version=version+1 WHERE order_id=$1",
        [order.id],
      );
      const result = await local.run(h.otherOwner.cookie, (c, a) =>
        inspectMatchingPlayerEnded(c, a, order.id),
      );
      expect(result).toEqual({
        ended: true,
        completed: false,
        unresolvedMoney: false,
        retainedCostFen: 0,
      });
    });
    test('a multi-appearance order cannot reopen while any future appearance is still active', async () => {
      const order = await playerOrder(2);
      await h.api.pool.query(
        "UPDATE booking_appearances SET expires_at=clock_timestamp()-interval '1 second',updated_at=clock_timestamp()-interval '2 minutes',version=version+1 WHERE id=$1",
        [order.appearances[0]!.id],
      );
      const result = await local.run(h.otherOwner.cookie, (c, a) =>
        inspectMatchingPlayerEnded(c, a, order.id),
      );
      expect(result.ended).toBe(false);
    });
    test('C06 expiry preserves UNKNOWN financial work and never pretends the budget is refundable', async () => {
      const order = await playerOrder();
      await h.api.pool.query(
        "UPDATE booking_appearances SET expires_at=clock_timestamp()-interval '1 second',updated_at=clock_timestamp()-interval '2 minutes',version=version+1 WHERE order_id=$1",
        [order.id],
      );
      const money = await unknownPayment(
        'PLAYER_APPEARANCE',
        order.appearances[0]!.id,
        h.otherOwner.orgId,
        h.leader.id,
      );
      const inspect = () =>
        local.run(h.otherOwner.cookie, (c, a) => inspectMatchingPlayerEnded(c, a, order.id));
      expect(await inspect()).toMatchObject({
        ended: true,
        completed: false,
        unresolvedMoney: true,
      });
      await h.api.pool.query("UPDATE trade_payment_attempts SET status='FAILED' WHERE id=$1", [
        money.attempt,
      ]);
      expect(await inspect()).toMatchObject({
        ended: true,
        unresolvedMoney: false,
        retainedCostFen: 0,
      });
    });
  },
);
