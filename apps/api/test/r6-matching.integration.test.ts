import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { MatchingService } from '../src/matching-service.js';
import type { MatchingSourceHooks } from '../src/matching-source-adapter.js';
import { REGION_CATALOG_VERSION } from '../src/region-catalog-data.js';
import { createHarness, closeHarness } from './p04-support.js';
import type { Harness } from './p04-support.js';
import { ORIGIN } from './support.js';
import type { User } from './support.js';
import type { MatchingNeedData } from '../../../packages/contracts/matching.js';

describe(
  'R6MATCH real PostgreSQL consent, seats and transactional recovery',
  { concurrent: false },
  () => {
    let h: Harness,
      service: MatchingService,
      regionId: string,
      otherRegionId: string,
      base: number,
      firstProfile: string,
      secondProfile: string;
    let serial = 0,
      failAmount = false,
      sourceEnded = false,
      retainedCost = 0;
    const at = (hours: number) => new Date(base + hours * 3600000).toISOString();
    // Isolated source adapter writes a real C06 order in the caller's transaction.
    // Production adapters must additionally be covered by root's existing-source tests.
    const hooks: MatchingSourceHooks = {
      async prepare(c, a, input) {
        await c.query('SELECT x12_calendar_lock()');
        return {
          async execute() {
            const id = randomUUID();
            const settings = (await c.query('SELECT * FROM booking_settings WHERE id')).rows[0];
            await c.query(
              "INSERT INTO booking_orders(id,org_id,team_id,event_name,team_name,buyer_user_id,scope,fee_bps,settings_version) VALUES($1,$2,$3,'R6MATCH同事务夹具','合成球队',$4,'SINGLE',$5,$6)",
              [
                id,
                input.need.orgId,
                input.need.teamId,
                a.user.id,
                settings.fee_bps,
                settings.version,
              ],
            );
            return {
              sourceKind: 'PLAYER_ORDER',
              sourceId: id,
              totalFen: input.candidate.totalFen! + (failAmount ? 1 : 0),
            };
          },
        };
      },
      async inspectEnded(c, _a, source) {
        await c.query('SELECT id FROM booking_orders WHERE id=$1 FOR UPDATE', [source.sourceId]);
        return {
          ended: sourceEnded,
          completed: false,
          unresolvedMoney: false,
          retainedCostFen: retainedCost,
        };
      },
    };
    beforeAll(async () => {
      h = await createHarness(2);
      base =
        (await h.api.pool.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime() +
        72 * 3600000;
      const regions = await h.api.pool.query(
        "SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND level='COUNTY' ORDER BY source_code LIMIT 2",
        [REGION_CATALOG_VERSION],
      );
      regionId = regions.rows[0].region_id;
      otherRegionId = regions.rows[1].region_id;
      service = new MatchingService(
        h.api.pool,
        { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
        { enabled: true, sourceHooks: hooks },
      );
      firstProfile = await profile(h.leader);
      secondProfile = await profile(h.otherOwner);
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    });
    async function profile(u: User) {
      const id = randomUUID();
      await h.api.pool.query(
        "INSERT INTO booking_profiles(id,user_id,display_name,position,height_cm,city,bio,price_fen,availability,status,reviewed_by,reviewed_at) VALUES($1,$2,'合成撮合球员','PG',180,'合成城市','隔离数据库',1000,$3::jsonb,'APPROVED',$4,clock_timestamp())",
        [id, u.id, JSON.stringify([{ startAt: at(0), endAt: at(700) }]), h.owner.id],
      );
      return id;
    }
    async function opt(
      u: User,
      id: string,
      enabled = true,
      kind = 'ADULT_PLAYER',
      region = regionId,
    ) {
      const old = (
        await h.api.pool.query(
          'SELECT version FROM matching_supply_preferences WHERE source_kind=$1 AND source_id=$2',
          [kind, id],
        )
      ).rows[0];
      return service.setPreference(u.cookie, {
        commandId: randomUUID(),
        kind,
        sourceId: id,
        expectedVersion: old?.version ?? 0,
        regionId: region,
        catalogVersion: REGION_CATALOG_VERSION,
        allowedRegionIds: [regionId, otherRegionId],
        discoveryEnabled: enabled,
        contactEnabled: enabled,
        adultConfirmed: true,
        availability: [{ reportAt: at(0), startAt: at(0), endAt: at(20) }],
      });
    }
    async function need(patch: Record<string, unknown> = {}) {
      const start = ++serial * 8;
      const body = {
        commandId: randomUUID(),
        kind: 'ADULT_PLAYER',
        orgId: h.owner.orgId,
        teamId: h.teams[0]!.id,
        title: '成人合成球队补位',
        address: '公开比赛场馆',
        regionId,
        catalogVersion: REGION_CATALOG_VERSION,
        allowedRegionIds: [regionId, otherRegionId],
        role: 'PG',
        quantity: 1,
        windows: [{ reportAt: at(start), startAt: at(start + 0.25), endAt: at(start + 2) }],
        unitBudgetFen: 2000,
        totalBudgetFen: 2000,
        maxTravelMinutes: 120,
        expiresAt: at(start - 1),
        adultConfirmed: true,
        ...patch,
      };
      const result = await service.create(h.owner.cookie, body);
      return { id: result.resourceId, body };
    }
    async function run(id: string) {
      const current = await service.detail(h.owner.cookie, id);
      await service.run(h.owner.cookie, id, {
        commandId: randomUUID(),
        expectedVersion: current.version,
      });
      return service.detail(h.owner.cookie, id);
    }
    async function send(n: MatchingNeedData, profileId = firstProfile, seat = 0) {
      const candidate = n.candidates.find((x) => x.sourceId === profileId)!;
      expect(candidate).toBeDefined();
      return service.sendIntent(h.owner.cookie, n.id, {
        commandId: randomUUID(),
        expectedVersion: n.version,
        slotId: n.slots[seat]!.id,
        candidateId: candidate.id,
      });
    }
    async function accept(id: string, user = h.leader) {
      return service.intentCommand(user.cookie, id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'ACCEPT',
      });
    }
    const convert = (id: string) =>
      service.intentCommand(h.owner.cookie, id, {
        commandId: randomUUID(),
        expectedVersion: 2,
        type: 'CONVERT',
        sourceInput: { fixture: true },
      });
    test('existing public profiles have no implicit discovery or contact authorization', async () => {
      const n = await need();
      expect((await run(n.id)).candidates).toEqual([]);
      await expect(opt(h.owner, firstProfile)).rejects.toMatchObject({ status: 404 });
      await opt(h.leader, firstProfile);
      expect((await run(n.id)).candidates.some((x) => x.sourceId === firstProfile)).toBe(true);
    });
    test('commands are durable and concurrent retries cannot create duplicate needs', async () => {
      const n = await need();
      const [a, b] = await Promise.all([
        service.create(h.owner.cookie, n.body),
        service.create(h.owner.cookie, n.body),
      ]);
      expect(a).toEqual(b);
      expect(a.resourceId).toBe(n.id);
      expect((await service.receipt(h.owner.cookie, n.body.commandId)).found).toBe(true);
      await expect(
        service.create(h.owner.cookie, { ...n.body, title: '其他需求' }),
      ).rejects.toMatchObject({ code: 'MATCHING_COMMAND_CONFLICT' });
      await expect(service.detail(h.otherOwner.cookie, n.id)).rejects.toMatchObject({
        status: 404,
      });
    });
    test('revoking consent hides candidates and prevents recipient acceptance', async () => {
      await opt(h.leader, firstProfile);
      const n = await run((await need()).id),
        i = await send(n);
      await opt(h.leader, firstProfile, false);
      expect(
        (await service.detail(h.owner.cookie, n.id)).candidates.some(
          (x) => x.sourceId === firstProfile,
        ),
      ).toBe(false);
      await expect(accept(i.resourceId)).rejects.toMatchObject({
        code: 'MATCHING_CANDIDATE_STALE',
      });
      await opt(h.leader, firstProfile);
    });
    test('an expired intent cannot be accepted and remains visible as expired', async () => {
      const n = await run((await need()).id),
        i = await send(n);
      await h.api.pool.query(
        "UPDATE matching_intents SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [i.resourceId],
      );
      await expect(accept(i.resourceId)).rejects.toMatchObject({ code: 'MATCHING_INTENT_EXPIRED' });
      expect((await service.detail(h.leader.cookie, n.id)).intents[0]?.status).toBe('EXPIRED');
    });
    test('same-slot races produce exactly one source order and one immutable assignment', async () => {
      await opt(h.otherOwner, secondProfile);
      const n = await run((await need()).id),
        a = await send(n),
        b = await send(n, secondProfile);
      await accept(a.resourceId);
      await accept(b.resourceId, h.otherOwner);
      const results = await Promise.allSettled([convert(a.resourceId), convert(b.resourceId)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const assignments = await h.api.pool.query(
        'SELECT * FROM matching_slot_assignments WHERE need_id=$1',
        [n.id],
      );
      expect(assignments.rowCount).toBe(1);
      expect(
        (
          await h.api.pool.query('SELECT id FROM booking_orders WHERE id=$1', [
            assignments.rows[0].source_id,
          ])
        ).rowCount,
      ).toBe(1);
      expect((await service.detail(h.owner.cookie, n.id)).slots[0]?.status).toBe('CONVERTED');
    });
    test('one source person cannot take two seats in the same group', async () => {
      const n = await run((await need({ quantity: 2, totalBudgetFen: 4000 })).id),
        a = await send(n),
        b = await send(n, firstProfile, 1);
      await accept(a.resourceId);
      await accept(b.resourceId);
      await convert(a.resourceId);
      await expect(convert(b.resourceId)).rejects.toMatchObject({
        code: 'MATCHING_DUPLICATE_PERSON',
      });
      expect(
        (
          await h.api.pool.query('SELECT id FROM matching_slot_assignments WHERE need_id=$1', [
            n.id,
          ])
        ).rowCount,
      ).toBe(1);
    });
    test('source result mismatch rolls back source creation, assignment and command receipt', async () => {
      const n = await run((await need()).id),
        i = await send(n);
      await accept(i.resourceId);
      const before = (
        await h.api.pool.query(
          "SELECT count(*)::integer AS n FROM booking_orders WHERE buyer_user_id=$1 AND event_name='R6MATCH同事务夹具'",
          [h.owner.id],
        )
      ).rows[0].n;
      failAmount = true;
      try {
        await expect(convert(i.resourceId)).rejects.toMatchObject({
          code: 'MATCHING_SOURCE_CHANGED',
        });
      } finally {
        failAmount = false;
      }
      expect(
        (
          await h.api.pool.query(
            "SELECT count(*)::integer AS n FROM booking_orders WHERE buyer_user_id=$1 AND event_name='R6MATCH同事务夹具'",
            [h.owner.id],
          )
        ).rows[0].n,
      ).toBe(before);
      expect((await service.detail(h.owner.cookie, n.id)).intents[0]?.status).toBe(
        'MUTUAL_INTEREST',
      );
    });
    test('explicit recovery retains costs, increments generation and does not exceed original total budget', async () => {
      const n = await run((await need()).id),
        i = await send(n);
      await accept(i.resourceId);
      await convert(i.resourceId);
      const reopen = {
        commandId: randomUUID(),
        type: 'REOPEN_SLOT',
        expectedVersion: 1,
        slotId: n.slots[0]!.id,
      };
      await expect(service.needCommand(h.owner.cookie, n.id, reopen)).rejects.toMatchObject({
        code: 'MATCHING_SOURCE_NOT_ENDED',
      });
      sourceEnded = true;
      retainedCost = 1000;
      try {
        await service.needCommand(h.owner.cookie, n.id, reopen);
        const fresh = await run(n.id);
        expect(fresh.slots[0]?.generation).toBe(2);
        const next = await send(fresh, secondProfile);
        await accept(next.resourceId, h.otherOwner);
        await expect(convert(next.resourceId)).rejects.toMatchObject({
          code: 'MATCHING_BUDGET_EXCEEDED',
        });
      } finally {
        sourceEnded = false;
        retainedCost = 0;
      }
    });
    test('cross-region interest remains possible but cannot silently create a local reservation', async () => {
      await opt(h.leader, firstProfile, true, 'ADULT_PLAYER', otherRegionId);
      try {
        const n = await run((await need()).id),
          i = await send(n);
        expect(n.candidates.find((x) => x.sourceId === firstProfile)?.crossCity).toBe(true);
        await accept(i.resourceId);
        await expect(convert(i.resourceId)).rejects.toMatchObject({
          code: 'MATCHING_TRAVEL_REVIEW_REQUIRED',
        });
      } finally {
        await opt(h.leader, firstProfile);
      }
    });
    test('pause invalidates pending consent and resume requires a fresh run', async () => {
      const n = await run((await need()).id),
        i = await send(n);
      await service.needCommand(h.owner.cookie, n.id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'PAUSE',
      });
      await expect(accept(i.resourceId)).rejects.toMatchObject({
        code: 'MATCHING_VERSION_CONFLICT',
      });
      await service.needCommand(h.owner.cookie, n.id, {
        commandId: randomUUID(),
        expectedVersion: 2,
        type: 'RESUME',
      });
      expect((await service.detail(h.owner.cookie, n.id)).latestRunId).toBeNull();
    });
  },
);
