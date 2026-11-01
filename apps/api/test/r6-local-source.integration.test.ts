/** Real PostgreSQL: canonical source reuse must share the caller's rollback and calendar. */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { beforeAll, afterAll, describe, test, expect, vi } from 'vitest';
import { TradeService } from '../src/trade-service.js';
import type { TradePayments } from '../src/trade-provider.js';
import { LocalServicesService } from '../src/local-services-service.js';
import { createMatchingLocalSourceHooks } from '../src/matching-local-source.js';
import type { MatchingConversionInput } from '../src/matching-source-adapter.js';
import type { Actor } from '../src/service.js';
import { REGION_CATALOG_VERSION } from '../src/region-catalog-data.js';
import { createHarness, closeHarness, court } from './p04-support.js';
import type { Harness } from './p04-support.js';
import { grant } from './p03-support.js';
import { ORIGIN } from './support.js';
class SourceHarness extends LocalServicesService {
  run<T>(cookie: string, work: (c: PoolClient, a: Actor) => Promise<T>) {
    return this.transaction(async (c) => work(c, await this.lockActor(c, cookie)));
  }
}
describe('R6 same-transaction local source bridges', { concurrent: false }, () => {
  let h: Harness, local: SourceHarness, regionId: string, payments: TradePayments;
  let serial = 0;
  beforeAll(async () => {
    h = await createHarness(1);
    payments = {
      enabled: true,
      native: vi.fn(),
      queryOrder: vi.fn(),
      refund: vi.fn(),
      queryRefund: vi.fn(),
      verifyNotification: vi.fn(),
      downloadBill: vi.fn(),
    };
    const options = { databaseUrl: h.databaseUrl, appOrigin: ORIGIN };
    const trade = new TradeService(h.api.pool, options, {
      encryptionKey: Buffer.alloc(32, 3),
      merchants: {
        [h.owner.orgId]: {
          key: 'synthetic-only',
          merchantId: '1900000151',
          appId: 'wx1234567890abcdef',
          displayName: '合成匹配商户',
          payments,
          receivers: {},
        },
      },
    });
    local = new SourceHarness(h.api.pool, options, undefined, undefined, trade);
    regionId = (
      await h.api.pool.query(
        "SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND level='COUNTY' ORDER BY source_code LIMIT 1",
        [REGION_CATALOG_VERSION],
      )
    ).rows[0].region_id;
    await grant(h.api, h.owner, h.teams[0]!, h.owner);
    await grant(h.api, h.otherOwner, h.otherTeams[0]!, h.otherOwner);
  }, 90000);
  afterAll(async () => {
    if (h) {
      expect(payments.native).not.toHaveBeenCalled();
      expect(payments.queryOrder).not.toHaveBeenCalled();
      expect(payments.refund).not.toHaveBeenCalled();
      await closeHarness(h);
    }
  });
  async function supply(kind = 'SCORER') {
    const id = randomUUID(),
      slotId = randomUUID(),
      termId = randomUUID(),
      actualCourt = kind === 'COURT' ? await court(h.api, h.owner, 'R6实际球场') : null;
    const startsAt = new Date(Date.now() + 10 * 86400000 + serial++ * 3 * 3600000).toISOString(),
      endsAt = new Date(Date.parse(startsAt) + 3600000).toISOString();
    await h.api.pool.query(
      `INSERT INTO local_listings(id,org_id,provider_user_id,created_by,kind,court_id,title,description,address,region_catalog_version,region_id,coverage_region_ids,qualification_note,terms,provider_confirmed,status,published,qualified_until,reviewed_by,reviewed_at)
      VALUES($1,$2,$3,$3,$4,$5,'合成事务供给','仅用于隔离源事务集成测试','合成公开场地',$6,$7,ARRAY[$7]::uuid[],'合成独立核验资料','确认实际地点和取消约定',true,'APPROVED',true,clock_timestamp()+interval '1 year',$8,clock_timestamp())`,
      [
        id,
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
      [slotId, h.owner.orgId, id, startsAt, endsAt],
    );
    if (kind !== 'COURT')
      await h.api.pool.query(
        "INSERT INTO trade_terms(id,org_id,kind,source_id,amount_fen,terms,merchant_key,status,created_by,reviewed_by,reviewed_at) VALUES($1,$2,'LOCAL_BOOKING',$3,1000,'合成经独立核验收费条款','synthetic-only','ACTIVE',$4,$5,clock_timestamp())",
        [termId, h.owner.orgId, id, h.owner.id, h.otherOwner.id],
      );
    return { id, slotId, termId, startsAt, endsAt, kind };
  }
  function conversion(s: Awaited<ReturnType<typeof supply>>): MatchingConversionInput {
    return {
      commandId: randomUUID(),
      kind: 'STAFF_SERVICE',
      need: {
        id: randomUUID(),
        orgId: h.otherOwner.orgId,
        teamId: h.otherTeams[0]!.id,
        regionId,
        catalogVersion: REGION_CATALOG_VERSION,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        address: '合成明确服务地址',
        windows: [{ reportAt: s.startsAt, startAt: s.startsAt, endAt: s.endsAt }],
      },
      candidate: {
        sourceId: s.id,
        sourceOrgId: h.owner.orgId,
        userId: h.owner.id,
        sourceVersion: 1,
        sourceSlotId: s.slotId,
        totalFen: 1000,
      },
      sourceInput: { acceptedTerms: true, acceptedTermsId: s.termId, chargeConsent: true },
    };
  }
  test('source creation, reservation and receipt all roll back with the caller and can be retried', async () => {
    const s = await supply(),
      x = conversion(s),
      hooks = createMatchingLocalSourceHooks(local);
    let rolledBackId = '';
    await expect(
      local.run(h.otherOwner.cookie, async (c, a) => {
        const prepared = await hooks.prepare(c, a, x);
        expect(
          (await c.query('SELECT 1 FROM local_bookings WHERE listing_id=$1', [s.id])).rowCount,
        ).toBe(0);
        rolledBackId = (await prepared.execute()).sourceId;
        throw new Error('synthetic matching assignment rejected');
      }),
    ).rejects.toThrow('synthetic matching assignment rejected');
    expect(
      (await h.api.pool.query('SELECT 1 FROM local_bookings WHERE id=$1', [rolledBackId])).rowCount,
    ).toBe(0);
    expect(
      (
        await h.api.pool.query(
          'SELECT 1 FROM local_command_receipts WHERE actor_id=$1 AND command_id=$2',
          [h.otherOwner.id, x.commandId],
        )
      ).rowCount,
    ).toBe(0);
    const result = await local.run(h.otherOwner.cookie, async (c, a) =>
      (await hooks.prepare(c, a, x)).execute(),
    );
    expect(result).toMatchObject({ sourceKind: 'LOCAL_BOOKING', totalFen: 1000 });
    const booking = (
      await h.api.pool.query('SELECT * FROM local_bookings WHERE id=$1', [result.sourceId])
    ).rows[0];
    expect(booking.snapshot).toMatchObject({ address: x.need.address, listingVersion: 1 });
    expect(
      (
        await h.api.pool.query(
          "SELECT org_id,payer_user_id,beneficiary_user_id,total_fen,terms_id FROM trade_orders WHERE kind='LOCAL_BOOKING' AND source_id=$1",
          [result.sourceId],
        )
      ).rows[0],
    ).toMatchObject({
      org_id: h.owner.orgId,
      payer_user_id: h.otherOwner.id,
      beneficiary_user_id: h.owner.id,
      total_fen: 1000,
      terms_id: s.termId,
    });
    expect(
      (
        await h.api.pool.query(
          'SELECT 1 FROM local_resource_reservations WHERE booking_id=$1 AND active',
          [result.sourceId],
        )
      ).rowCount,
    ).toBe(1);
  });
  test('two conversions to one actual staff slot produce one canonical reservation', async () => {
    const s = await supply(),
      x = conversion(s),
      hooks = createMatchingLocalSourceHooks(local);
    const results = await Promise.allSettled(
      [x, { ...x, commandId: randomUUID() }].map((value) =>
        local.run(h.otherOwner.cookie, async (c, a) =>
          (await hooks.prepare(c, a, value)).execute(),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await h.api.pool.query('SELECT 1 FROM local_bookings WHERE listing_id=$1', [s.id])).rowCount,
    ).toBe(1);
  });
  test('old public booking receipt still replays after the slot closes', async () => {
    const s = await supply(),
      body = {
        commandId: randomUUID(),
        listingId: s.id,
        slotId: s.slotId,
        serviceRegion: { catalogVersion: REGION_CATALOG_VERSION, regionId },
        serviceAddress: '原约定实际地址',
        acceptedTerms: true,
        acceptedTermsId: s.termId,
        chargeConsent: true,
      };
    const first = await local.book(h.otherOwner.cookie, body);
    await h.api.pool.query("UPDATE local_slots SET status='CLOSED',version=version+1 WHERE id=$1", [
      s.slotId,
    ]);
    await expect(local.book(h.otherOwner.cookie, body)).resolves.toEqual(first);
  });
  test('team conversion creates the real matchup only for an exact confirmed court booking', async () => {
    const s = await supply('COURT'),
      book = await local.book(h.otherOwner.cookie, {
        commandId: randomUUID(),
        listingId: s.id,
        slotId: s.slotId,
        serviceRegion: { catalogVersion: REGION_CATALOG_VERSION, regionId },
        acceptedTerms: true,
      });
    await local.bookingCommand(h.otherOwner.cookie, book.resourceId, {
      commandId: randomUUID(),
      expectedVersion: 1,
      type: 'CONFIRM',
      reason: '明确确认实际球场和时间',
    });
    const version = (
      await h.api.pool.query('SELECT version FROM teams WHERE id=$1', [h.teams[0]!.id])
    ).rows[0].version;
    const x: MatchingConversionInput = {
      ...conversion(s),
      kind: 'TEAM_MATCHUP',
      need: { ...conversion(s).need, address: '合成公开场地' },
      candidate: {
        sourceId: h.teams[0]!.id,
        sourceOrgId: h.owner.orgId,
        userId: h.owner.id,
        sourceVersion: version,
        sourceSlotId: null,
        totalFen: 0,
      },
      sourceInput: { courtBookingId: book.resourceId, terms: '双方确认比赛时间、场地及取消安排' },
    };
    const hooks = createMatchingLocalSourceHooks(local);
    await expect(
      local.run(h.otherOwner.cookie, async (c, a) =>
        (
          await hooks.prepare(c, a, {
            ...x,
            need: { ...x.need, endsAt: new Date(Date.parse(s.endsAt) + 60000).toISOString() },
          })
        ).execute(),
      ),
    ).rejects.toMatchObject({ code: 'MATCHING_SOURCE_WINDOW' });
    const anotherRegion = (
      await h.api.pool.query(
        "SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND level='COUNTY' AND region_id<>$2 ORDER BY source_code LIMIT 1",
        [REGION_CATALOG_VERSION, regionId],
      )
    ).rows[0].region_id;
    for (const change of [
      { regionId: anotherRegion },
      { catalogVersion: 'another-catalog' },
      { address: '双方未确认的另一球场地址' },
    ])
      await expect(
        local.run(h.otherOwner.cookie, async (c, a) =>
          (await hooks.prepare(c, a, { ...x, need: { ...x.need, ...change } })).execute(),
        ),
      ).rejects.toMatchObject({ code: 'MATCHING_SOURCE_LOCATION' });
    const result = await local.run(h.otherOwner.cookie, async (c, a) =>
      (await hooks.prepare(c, a, x)).execute(),
    );
    expect(result).toMatchObject({ sourceKind: 'TEAM_MATCHUP', totalFen: 0 });
    expect(
      (await h.api.pool.query('SELECT * FROM local_matchups WHERE id=$1', [result.sourceId]))
        .rows[0],
    ).toMatchObject({
      home_team_id: h.otherTeams[0]!.id,
      away_team_id: h.teams[0]!.id,
      court_booking_id: book.resourceId,
      status: 'OPEN',
    });
    await local.matchupCommand(h.otherOwner.cookie, result.sourceId, {
      commandId: randomUUID(),
      expectedVersion: 1,
      type: 'CANCEL',
      reason: '合成取消约赛用于回执边界核验',
    });
    await expect(
      local.run(h.otherOwner.cookie, async (c, a) => (await hooks.prepare(c, a, x)).execute()),
    ).rejects.toMatchObject({ code: 'MATCHING_SOURCE_ALREADY_CREATED' });
  });
  test('paid matching cannot fall back to an unbound legacy booking when commerce is disabled', async () => {
    const s = await supply(),
      x = conversion(s),
      unpaid = new SourceHarness(h.api.pool, { databaseUrl: h.databaseUrl, appOrigin: ORIGIN });
    await expect(
      unpaid.run(h.otherOwner.cookie, async (c, a) =>
        (await createMatchingLocalSourceHooks(unpaid).prepare(c, a, x)).execute(),
      ),
    ).rejects.toMatchObject({ code: 'MATCHING_TRADE_REQUIRED', status: 503 });
    expect(
      (await h.api.pool.query('SELECT id FROM local_bookings WHERE listing_id=$1', [s.id]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await h.api.pool.query(
          'SELECT command_id FROM local_command_receipts WHERE actor_id=$1 AND command_id=$2',
          [h.otherOwner.id, x.commandId],
        )
      ).rowCount,
    ).toBe(0);
  });
  test('a former source receipt cannot be rebound to a fresh matching conversion', async () => {
    const s = await supply(),
      x = conversion(s),
      input = {
        commandId: x.commandId,
        listingId: s.id,
        slotId: s.slotId,
        serviceRegion: { catalogVersion: REGION_CATALOG_VERSION, regionId },
        serviceAddress: x.need.address,
        acceptedTerms: true,
        acceptedTermsId: s.termId,
        chargeConsent: true,
      };
    const prior = await local.book(h.otherOwner.cookie, input);
    await local.bookingCommand(h.otherOwner.cookie, prior.resourceId, {
      commandId: randomUUID(),
      expectedVersion: 1,
      type: 'CANCEL',
      reason: '合成取消原请求用于回执边界核验',
    });
    await expect(
      local.run(h.otherOwner.cookie, async (c, a) =>
        (await createMatchingLocalSourceHooks(local).prepare(c, a, x)).execute(),
      ),
    ).rejects.toMatchObject({ code: 'MATCHING_SOURCE_ALREADY_CREATED' });
    expect(
      (await h.api.pool.query('SELECT id FROM local_bookings WHERE listing_id=$1', [s.id]))
        .rowCount,
    ).toBe(1);
  });
});
