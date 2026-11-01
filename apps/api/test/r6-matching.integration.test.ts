import { randomUUID } from 'node:crypto';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { MatchingService } from '../src/matching-service.js';
import type { MatchingSourceHooks } from '../src/matching-source-adapter.js';
import { REGION_CATALOG_VERSION } from '../src/region-catalog-data.js';
import { createHarness, closeHarness } from './p04-support.js';
import { grant } from './p03-support.js';
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
      await maintainPlatformOperator(h.api.pool, {
        email: h.owner.email,
        status: 'ACTIVE',
        reason: '合成撮合隔离测试审核员',
      });
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

    let trainingCourse: string | undefined, trainingCourt: string | undefined;
    type CalendarCase =
      | 'COACH'
      | 'CONFIRMED'
      | 'HOLDING'
      | 'EXPIRED_HOLD'
      | 'PAID_UNALLOCATED'
      | 'RELEASED'
      | 'BOUNDARY';
    /** Explicit SQL calendar fixture, preserving real FKs, exclusions and 048 triggers.
     * A reservation already includes its training session's 15-minute buffer. */
    async function trainingBusy(user: User, starts: number, ends: number, mode: CalendarCase) {
      if (!trainingCourse) {
        trainingCourse = randomUUID();
        trainingCourt = randomUUID();
        await h.api.pool.query(
          "INSERT INTO training_providers(org_id,name,evidence_reference,qualified_until,status,created_by,reviewed_by) VALUES($1,'合成撮合培训机构','仅隔离日历验收',$2,'APPROVED',$3,$4)",
          [h.otherOwner.orgId, at(800), h.otherOwner.id, h.owner.id],
        );
        await h.api.pool.query('INSERT INTO courts(id,org_id,name) VALUES($1,$2,$3)', [
          trainingCourt,
          h.otherOwner.orgId,
          '合成撮合日历场地',
        ]);
        await h.api.pool.query(
          "INSERT INTO training_courses(id,org_id,title,description,created_by) VALUES($1,$2,'合成成人培训','仅日历边界验收',$3)",
          [trainingCourse, h.otherOwner.orgId, h.otherOwner.id],
        );
      }
      const cohort = randomUUID(),
        session = randomUUID(),
        terms = randomUUID(),
        reservation = randomUUID();
      await h.api.pool.query(
        `INSERT INTO training_cohorts(id,org_id,course_id,court_id,title,address,capacity,total_fen,terms_id,terms_text,state,enrollment_deadline,created_by)
         VALUES($1,$2,$3,$4,'合成日历班期','合成培训场馆',10,1000,$5,'合成培训约定','ENROLLING',$6,$7)`,
        [
          cohort,
          h.otherOwner.orgId,
          trainingCourse,
          trainingCourt,
          terms,
          at(starts - 1),
          h.otherOwner.id,
        ],
      );
      await h.api.pool.query(
        'INSERT INTO training_sessions(id,org_id,cohort_id,starts_at,ends_at,buffer_minutes,price_weight) VALUES($1,$2,$3,$4,$5,15,1000)',
        [session, h.otherOwner.orgId, cohort, at(starts + 0.25), at(ends - 0.25)],
      );
      let enrollment: string | null = null;
      if (mode === 'COACH') {
        const coach = randomUUID();
        await h.api.pool.query(
          `INSERT INTO training_coaches(id,org_id,user_id,display_name,evidence_reference,qualified_until,consented,status,created_by,reviewed_by)
           VALUES($1,$2,$3,'合成教练','合成资质证明',$4,true,'APPROVED',$3,$5)
           ON CONFLICT(org_id,user_id) DO NOTHING`,
          [coach, h.otherOwner.orgId, user.id, at(800), h.owner.id],
        );
        await h.api.pool.query(
          'INSERT INTO training_session_coaches(session_id,org_id,coach_id) SELECT $1,$2,id FROM training_coaches WHERE org_id=$2 AND user_id=$3',
          [session, h.otherOwner.orgId, user.id],
        );
      } else {
        enrollment = randomUUID();
        const state =
          mode === 'EXPIRED_HOLD' || mode === 'HOLDING'
            ? 'HOLDING'
            : mode === 'PAID_UNALLOCATED'
              ? mode
              : 'CONFIRMED';
        await h.api.pool.query(
          `INSERT INTO training_enrollments(id,org_id,cohort_id,applicant_user_id,payer_user_id,learner_user_id,adult_confirmed,terms_id,terms_snapshot,total_fen,state,hold_expires_at)
           VALUES($1,$2,$3,$4,$4,$4,true,$5,'{}'::jsonb,1000,$6,clock_timestamp()+CASE WHEN $7 THEN interval '10 minutes' ELSE interval '-1 minute' END)`,
          [
            enrollment,
            h.otherOwner.orgId,
            cohort,
            user.id,
            terms,
            state,
            mode === 'HOLDING' || mode === 'EXPIRED_HOLD',
          ],
        );
        await h.api.pool.query(
          'INSERT INTO training_lesson_entitlements(id,org_id,enrollment_id,original_session_id,current_session_id,net_fen) VALUES($1,$2,$3,$4,$4,1000)',
          [randomUUID(), h.otherOwner.orgId, enrollment, session],
        );
      }
      await h.api.pool.query(
        'INSERT INTO training_resource_reservations(id,org_id,session_id,resource_key,starts_at,ends_at,enrollment_id,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          reservation,
          h.otherOwner.orgId,
          session,
          `user:${user.id}`,
          at(starts),
          at(ends),
          enrollment,
          mode !== 'RELEASED',
        ],
      );
      if (mode === 'EXPIRED_HOLD')
        await h.api.pool.query(
          "UPDATE training_enrollments SET hold_expires_at=clock_timestamp()-interval '1 minute',version=version+1 WHERE id=$1",
          [enrollment],
        );
      expect(
        (
          await h.api.pool.query('SELECT active FROM training_resource_reservations WHERE id=$1', [
            reservation,
          ])
        ).rows[0]!.active,
      ).toBe(mode !== 'RELEASED');
      return reservation;
    }
    async function calendarSource(kind: 'ADULT_PLAYER' | 'STAFF_SERVICE', start: number) {
      if (kind === 'ADULT_PLAYER') {
        await opt(h.leader, firstProfile);
        return { id: firstProfile, user: h.leader };
      }
      const listing = randomUUID();
      await h.api.pool.query(
        "INSERT INTO local_listings(id,org_id,provider_user_id,created_by,kind,title,description,address,region_catalog_version,region_id,coverage_region_ids,qualification_note,terms,provider_confirmed,status,published,qualified_until,reviewed_by,reviewed_at) VALUES($1,$2,$3,$3,'REFEREE','合成培训日历裁判','隔离测试服务资料','公开服务场馆',$4,$5,ARRAY[$5::uuid],'合成有效资质','合成服务约定',true,'APPROVED',true,$6,$7,clock_timestamp())",
        [
          listing,
          h.otherOwner.orgId,
          h.otherOwner.id,
          REGION_CATALOG_VERSION,
          regionId,
          at(750),
          h.owner.id,
        ],
      );
      await h.api.pool.query(
        'INSERT INTO local_slots(id,org_id,listing_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), h.otherOwner.orgId, listing, at(start), at(start + 2)],
      );
      await opt(h.otherOwner, listing, true, kind);
      return { id: listing, user: h.otherOwner };
    }
    async function calendarNeed(kind: 'ADULT_PLAYER' | 'STAFF_SERVICE', start: number) {
      return need({
        kind,
        ...(kind === 'STAFF_SERVICE' ? { teamId: undefined, role: 'REFEREE' } : {}),
        windows: [{ reportAt: at(start), startAt: at(start), endAt: at(start + 2) }],
        expiresAt: at(start - 1),
      });
    }
    async function matchingFacts(id: string) {
      const [slots, intents, assignments, outbox] = await Promise.all([
        h.api.pool.query('SELECT * FROM matching_demand_slots WHERE need_id=$1 ORDER BY id', [id]),
        h.api.pool.query('SELECT * FROM matching_intents WHERE need_id=$1 ORDER BY id', [id]),
        h.api.pool.query('SELECT * FROM matching_slot_assignments WHERE need_id=$1 ORDER BY id', [
          id,
        ]),
        h.api.pool.query('SELECT * FROM matching_outbox WHERE need_id=$1 ORDER BY id', [id]),
      ]);
      return {
        slots: slots.rows,
        intents: intents.rows,
        assignments: assignments.rows,
        outbox: outbox.rows,
      };
    }
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
    test('staff qualification, exact slot and unknown quote remain distinct from confirmed price', async () => {
      const listing = randomUUID(),
        slot = randomUUID();
      await h.api.pool.query(
        "INSERT INTO local_listings(id,org_id,provider_user_id,created_by,kind,title,description,address,region_catalog_version,region_id,coverage_region_ids,qualification_note,terms,provider_confirmed,status,published,qualified_until,reviewed_by,reviewed_at) VALUES($1,$2,$3,$3,'REFEREE','合成裁判','隔离测试服务资料','公开服务场馆',$4,$5,ARRAY[$5::uuid],'合成有效资质','合成服务约定',true,'APPROVED',true,$6,$7,clock_timestamp())",
        [
          listing,
          h.otherOwner.orgId,
          h.otherOwner.id,
          REGION_CATALOG_VERSION,
          regionId,
          at(500),
          h.owner.id,
        ],
      );
      await h.api.pool.query(
        'INSERT INTO local_slots(id,org_id,listing_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)',
        [slot, h.otherOwner.orgId, listing, at(200), at(202)],
      );
      await opt(h.otherOwner, listing, true, 'STAFF_SERVICE');
      const n = await need({
        kind: 'STAFF_SERVICE',
        teamId: undefined,
        role: 'REFEREE',
        windows: [{ reportAt: at(200), startAt: at(200), endAt: at(202) }],
        expiresAt: at(199),
      });
      let view = await run(n.id);
      expect(view.candidates.find((c) => c.sourceId === listing)).toMatchObject({
        sourceSlotId: slot,
        totalFen: null,
        needsQuote: true,
      });
      await h.api.pool.query(
        "INSERT INTO trade_terms(id,org_id,kind,source_id,amount_fen,terms,merchant_key,status,created_by,reviewed_by,reviewed_at) VALUES($1,$2,'LOCAL_BOOKING',$3,1000,'合成服务收费约定','synthetic-only','ACTIVE',$4,$5,clock_timestamp())",
        [randomUUID(), h.otherOwner.orgId, listing, h.otherOwner.id, h.owner.id],
      );
      view = await run(n.id);
      expect(view.candidates.find((c) => c.sourceId === listing)).toMatchObject({
        totalFen: 1000,
        needsQuote: false,
      });
      await h.api.pool.query(
        'UPDATE local_listings SET published=false,version=version+1 WHERE id=$1',
        [listing],
      );
      expect((await service.detail(h.owner.cookie, n.id)).candidates).toEqual([]);
    });
    test('team matching requires the original X12 team grant even for organization owners and rechecks revocation', async () => {
      const ownTeam = h.teams[1]!,
        awayTeam = h.otherTeams[1]!;
      const teamNeed = {
        kind: 'TEAM_MATCHUP',
        teamId: ownTeam.id,
        role: 'TEAM',
        unitBudgetFen: 0,
        totalBudgetFen: 0,
        windows: [{ reportAt: at(4), startAt: at(4), endAt: at(6) }],
        expiresAt: at(3),
      };
      expect(
        (await service.workspace(h.otherOwner.cookie)).sources.some((x) => x.id === awayTeam.id),
      ).toBe(false);
      await expect(opt(h.otherOwner, awayTeam.id, true, 'TEAM_MATCHUP')).rejects.toMatchObject({
        status: 404,
      });
      await expect(need(teamNeed)).rejects.toMatchObject({ status: 404 });
      await grant(h.api, h.owner, ownTeam, h.owner);
      await grant(h.api, h.otherOwner, awayTeam, h.otherOwner);
      expect(
        (await service.workspace(h.otherOwner.cookie)).sources.some((x) => x.id === awayTeam.id),
      ).toBe(true);
      await opt(h.otherOwner, awayTeam.id, true, 'TEAM_MATCHUP');
      const created = await need(teamNeed),
        view = await run(created.id);
      const intent = await send(view, awayTeam.id);
      await grant(h.api, h.otherOwner, awayTeam, h.otherOwner, 'DISABLED');
      await expect(accept(intent.resourceId, h.otherOwner)).rejects.toMatchObject({
        code: 'MATCHING_CANDIDATE_STALE',
      });
      expect((await run(created.id)).candidates.some((x) => x.sourceId === awayTeam.id)).toBe(
        false,
      );
      await grant(h.api, h.owner, ownTeam, h.owner, 'DISABLED');
      await expect(
        service.run(h.owner.cookie, created.id, {
          commandId: randomUUID(),
          expectedVersion: view.version,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });
    test('team matching uses the authorized opposing team and free-price evidence', async () => {
      const team = h.otherTeams[0]!;
      await grant(h.api, h.owner, h.teams[0]!, h.owner);
      await grant(h.api, h.otherOwner, team, h.otherOwner);
      await opt(h.otherOwner, team.id, true, 'TEAM_MATCHUP');
      const n = await need({
        kind: 'TEAM_MATCHUP',
        role: 'TEAM',
        unitBudgetFen: 0,
        totalBudgetFen: 0,
        windows: [{ reportAt: at(4), startAt: at(4), endAt: at(6) }],
        expiresAt: at(3),
      });
      const view = await run(n.id),
        candidate = view.candidates.find((c) => c.sourceId === team.id);
      expect(candidate).toMatchObject({
        totalFen: 0,
        needsQuote: false,
        sourceOrgId: h.otherOwner.orgId,
        settingsVersion: null,
      });
      expect(candidate?.score.dimensions.budget).toBeNull();
      const i = await send(view, team.id);
      await accept(i.resourceId, h.otherOwner);
      expect((await service.detail(h.owner.cookie, n.id)).intents[0]?.status).toBe(
        'MUTUAL_INTEREST',
      );
    });
    test.each(['ADULT_PLAYER', 'STAFF_SERVICE'] as const)(
      '%s filters active training coaches and learners, retaining expired/released and exact-boundary supply',
      async (kind) => {
        const cases: CalendarCase[] = [
          'COACH',
          'CONFIRMED',
          'HOLDING',
          'PAID_UNALLOCATED',
          'EXPIRED_HOLD',
          'RELEASED',
          'BOUNDARY',
        ];
        for (const [index, mode] of cases.entries()) {
          const start = (kind === 'ADULT_PLAYER' ? 300 : 400) + index * 8;
          const source = await calendarSource(kind, start);
          // The 15-minute training buffer starts inside the matching tail buffer
          // (or exactly at its exclusive end); service intervals themselves do not overlap.
          const busyStart = start + (mode === 'BOUNDARY' ? 2.5 : 2.25);
          const reservation = await trainingBusy(source.user, busyStart, busyStart + 1, mode);
          const n = await run((await calendarNeed(kind, start)).id);
          expect(
            n.candidates.some((candidate) => candidate.sourceId === source.id),
            mode,
          ).toBe(['EXPIRED_HOLD', 'RELEASED', 'BOUNDARY'].includes(mode));
          // Discovery is read-only: expired HOLDING is ignored, not rewritten by this query.
          const saved = (
            await h.api.pool.query(
              'SELECT active FROM training_resource_reservations WHERE id=$1',
              [reservation],
            )
          ).rows[0]!;
          expect(saved.active).toBe(mode !== 'RELEASED');
        }
      },
    );
    test.each(['ADULT_PLAYER', 'STAFF_SERVICE'] as const)(
      '%s revalidates new training conflicts before SEND and ACCEPT without consuming seats or receipts',
      async (kind) => {
        const start = kind === 'ADULT_PLAYER' ? 560 : 600;
        const source = await calendarSource(kind, start),
          n = await run((await calendarNeed(kind, start)).id);
        const candidate = n.candidates.find((x) => x.sourceId === source.id)!;
        expect(candidate).toBeDefined();
        const reservation = await trainingBusy(source.user, start + 0.5, start + 1.5, 'COACH');
        const before = await matchingFacts(n.id),
          sendCommand = {
            commandId: randomUUID(),
            expectedVersion: n.version,
            slotId: n.slots[0]!.id,
            candidateId: candidate.id,
          };
        await expect(service.sendIntent(h.owner.cookie, n.id, sendCommand)).rejects.toMatchObject({
          code: 'MATCHING_CANDIDATE_STALE',
        });
        expect(await matchingFacts(n.id)).toEqual(before);
        expect((await service.receipt(h.owner.cookie, sendCommand.commandId)).found).toBe(false);
        await h.api.pool.query(
          'UPDATE training_resource_reservations SET active=false WHERE id=$1',
          [reservation],
        );
        const intent = await service.sendIntent(h.owner.cookie, n.id, sendCommand);
        const later = await trainingBusy(source.user, start + 0.5, start + 1.5, 'CONFIRMED');
        const sent = await matchingFacts(n.id),
          acceptCommand = { commandId: randomUUID(), expectedVersion: 1, type: 'ACCEPT' };
        await expect(
          service.intentCommand(source.user.cookie, intent.resourceId, acceptCommand),
        ).rejects.toMatchObject({ code: 'MATCHING_CANDIDATE_STALE' });
        expect(await matchingFacts(n.id)).toEqual(sent);
        expect((await service.receipt(source.user.cookie, acceptCommand.commandId)).found).toBe(
          false,
        );
        await h.api.pool.query(
          'UPDATE training_resource_reservations SET active=false WHERE id=$1',
          [later],
        );
        await service.intentCommand(source.user.cookie, intent.resourceId, acceptCommand);
        expect((await service.detail(h.owner.cookie, n.id)).intents[0]?.status).toBe(
          'MUTUAL_INTEREST',
        );
      },
    );
    test('team matching also excludes a representative with a training commitment', async () => {
      const team = h.otherTeams[0]!;
      await grant(h.api, h.owner, h.teams[0]!, h.owner);
      await grant(h.api, h.otherOwner, team, h.otherOwner);
      await opt(h.otherOwner, team.id, true, 'TEAM_MATCHUP');
      const n = await need({
        kind: 'TEAM_MATCHUP',
        role: 'TEAM',
        unitBudgetFen: 0,
        totalBudgetFen: 0,
        windows: [{ reportAt: at(12), startAt: at(12), endAt: at(14) }],
        expiresAt: at(11),
      });
      expect((await run(n.id)).candidates.some((candidate) => candidate.sourceId === team.id)).toBe(
        true,
      );
      const reservation = await trainingBusy(h.otherOwner, 12.5, 13.5, 'CONFIRMED');
      expect((await run(n.id)).candidates.some((candidate) => candidate.sourceId === team.id)).toBe(
        false,
      );
      await h.api.pool.query('UPDATE training_resource_reservations SET active=false WHERE id=$1', [
        reservation,
      ]);
      expect((await run(n.id)).candidates.some((candidate) => candidate.sourceId === team.id)).toBe(
        true,
      );
    });
  },
);
