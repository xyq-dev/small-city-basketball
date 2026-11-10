import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TrainingService } from '../src/training-service.js';
import { LocalServicesService } from '../src/local-services-service.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { REGION_CATALOG_VERSION } from '../src/region-catalog-data.js';
import { parseDispatchQuote } from '../src/dispatch-domain.js';
import type {
  ScheduledMatchData,
  ScheduleOptimizationPreview,
  ScheduleRevisionData,
} from '@small-city-basketball/contracts';
import { call, data, ORIGIN } from './support.js';
import type { User } from './support.js';
import {
  allocate,
  closeHarness,
  court,
  createHarness,
  frozen,
  fullAllocations,
  matchesPath,
  publish,
  revision,
  revisionPath,
  validate,
  versions,
} from './p04-support.js';
import type { Harness } from './p04-support.js';
import {
  currentFacts,
  originalFacts,
  reschedule,
  rescheduling,
  rows,
} from './p04-rescheduling-support.js';
/** Real migrated PostgreSQL + production services. Only legacy/expired history fixtures use explicit SQL. */
describe(
  'R6 shared calendar has one authoritative person/court owner across every source',
  { concurrent: false },
  () => {
    let h: Harness,
      training: TrainingService,
      local: LocalServicesService,
      regionId: string,
      coachId: string,
      courseId: string,
      base: number;
    const profiles = new Map<string, string>();
    let serial = 0;
    const command = (
      action: string,
      expectedVersion: number,
      extra: Record<string, unknown> = {},
    ) => ({ commandId: randomUUID(), action, expectedVersion, ...extra });
    const window = () => {
      const t = base + ++serial * 8 * 3600000;
      return { start: new Date(t).toISOString(), end: new Date(t + 3600000).toISOString() };
    };
    const region = () => ({ catalogVersion: REGION_CATALOG_VERSION, regionId });
    beforeAll(async () => {
      h = await createHarness(2);
      base =
        (await h.api.pool.query('SELECT clock_timestamp() AS n')).rows[0].n.getTime() +
        7 * 86400000;
      await h.api.pool.query(
        "UPDATE organization_memberships SET role='ORG_ADMIN' WHERE org_id=$1 AND user_id=$2",
        [h.owner.orgId, h.otherOwner.id],
      );
      await maintainPlatformOperator(h.api.pool, {
        email: h.otherOwner.email,
        status: 'ACTIVE',
        reason: '合成共享日历培训资质核验',
      });
      const opts = { databaseUrl: h.databaseUrl, appOrigin: ORIGIN };
      training = new TrainingService(h.api.pool, opts, { enabled: true });
      local = new LocalServicesService(h.api.pool, opts);
      regionId = (
        await h.api.pool.query(
          "SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND level='COUNTY' ORDER BY source_code LIMIT 1",
          [REGION_CATALOG_VERSION],
        )
      ).rows[0].region_id;
      await training.registerProvider(h.owner.cookie, h.owner.orgId, {
        commandId: randomUUID(),
        name: '共享日历合成培训机构',
        evidenceReference: 'synthetic-calendar-provider',
        qualifiedUntil: new Date(base + 300 * 86400000).toISOString(),
      });
      await training.providerCommand(
        h.otherOwner.cookie,
        h.owner.orgId,
        command('APPROVE', 1, { reason: '独立核验合成培训资格' }),
      );
      coachId = (
        await training.addCoach(h.owner.cookie, h.owner.orgId, {
          commandId: randomUUID(),
          userId: h.owner.id,
          displayName: '共享日历合成教练',
          evidenceReference: 'synthetic-calendar-coach',
          qualifiedUntil: new Date(base + 300 * 86400000).toISOString(),
        })
      ).coachId;
      await training.coachCommand(h.owner.cookie, coachId, command('CONSENT', 1));
      await training.coachCommand(
        h.otherOwner.cookie,
        coachId,
        command('APPROVE', 2, { reason: '独立核验教练和机构不同职责' }),
      );
      courseId = (
        await training.createCourse(h.owner.cookie, h.owner.orgId, {
          commandId: randomUUID(),
          title: '共享日历成人短课',
          description: '正式资格和排课事务用于跨来源冲突验收',
        })
      ).courseId;
      for (const actor of [h.owner, h.leader]) {
        const id = randomUUID();
        await h.api.pool.query(
          "INSERT INTO booking_profiles(id,user_id,display_name,position,height_cm,city,bio,price_fen,availability) VALUES($1,$2,'合成跨日历球员','PG',180,'合成城市','隔离历史日历夹具',10000,'[]')",
          [id, actor.id],
        );
        profiles.set(actor.id, id);
      }
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);
    async function trainingDraft(
      start: string,
      end: string,
      physical?: Awaited<ReturnType<typeof court>>,
    ) {
      const venue = physical ?? (await court(h.api, h.owner, '合成培训共享场地'));
      const created = await training.createCohort(h.owner.cookie, h.owner.orgId, {
        commandId: randomUUID(),
        courseId,
        courtId: venue.id,
        title: '合成共享排课 ' + serial,
        address: '隔离合成场地',
        capacity: 2,
        totalFen: 0,
        termsText: '实际排期与人员场地日历必须一致，未消费课次保留权益。',
        enrollmentDeadline: new Date(Date.parse(start) - 3600000).toISOString(),
        sessions: [
          { startsAt: start, endsAt: end, coachIds: [coachId], priceWeight: 1, bufferMinutes: 15 },
        ],
      });
      return { id: created.cohortId as string, court: venue, start, end };
    }
    const publishTraining = (x: { id: string }) =>
      training.cohortCommand(h.owner.cookie, x.id, command('PUBLISH', 1));
    async function supply(
      kind: 'COURT' | 'REFEREE',
      start: string,
      end: string,
      physical?: Awaited<ReturnType<typeof court>>,
      provider = h.owner,
    ) {
      const venue =
        kind === 'COURT' ? (physical ?? (await court(h.api, h.owner, '合成同城共享场地'))) : null;
      const created = await local.createListing(h.owner.cookie, h.owner.orgId, {
        commandId: randomUUID(),
        kind,
        title: '合成跨源日历供给 ' + randomUUID().slice(0, 8),
        description: '正式审核的隔离合成供给',
        address: '合成公开服务地点',
        region: region(),
        coverageRegionIds: [regionId],
        providerUserId: provider.id,
        courtId: venue?.id ?? null,
        qualificationNote: '合成资格证据只用于隔离验收',
        terms: '双方线下履约，无线上收费；所有人物场地必须独占',
      });
      let version = 1;
      if (provider.id !== h.owner.id) {
        await local.listingCommand(provider.cookie, created.resourceId, {
          commandId: randomUUID(),
          type: 'CONFIRM_PROVIDER',
          expectedVersion: version++,
          reason: '本人明确确认服务资格',
        });
      }
      await local.listingCommand(h.owner.cookie, created.resourceId, {
        commandId: randomUUID(),
        type: 'SUBMIT',
        expectedVersion: version++,
        reason: '提交跨源日历合成资格',
      });
      await local.listingCommand(h.otherOwner.cookie, created.resourceId, {
        commandId: randomUUID(),
        type: 'APPROVE',
        expectedVersion: version++,
        reason: '独立核验实际人物场地',
        qualifiedUntil: new Date(base + 300 * 86400000).toISOString(),
        qualificationChecked: true,
        scopeChecked: true,
      });
      await local.listingCommand(h.owner.cookie, created.resourceId, {
        commandId: randomUUID(),
        type: 'PUBLISH',
        expectedVersion: version++,
        reason: '发布已核验合成供给',
      });
      const slot = await local.createSlot(h.owner.cookie, created.resourceId, {
        commandId: randomUUID(),
        expectedVersion: version,
        startsAt: start,
        endsAt: end,
      });
      return {
        id: created.resourceId as string,
        slotId: slot.slotId as string,
        kind,
        court: venue,
        provider,
        start,
        end,
      };
    }
    const book = (s: Awaited<ReturnType<typeof supply>>) =>
      local.book((s.provider.id === h.leader.id ? h.owner : h.leader).cookie, {
        commandId: randomUUID(),
        listingId: s.id,
        slotId: s.slotId,
        serviceRegion: region(),
        acceptedTerms: true,
        ...(s.kind === 'COURT' ? {} : { serviceAddress: '合成实际服务地点' }),
      });
    async function player(start: string, end: string, actor: User = h.owner) {
      const settings = (
          await h.api.pool.query('SELECT fee_bps,version FROM booking_settings WHERE id')
        ).rows[0],
        orderId = randomUUID(),
        id = randomUUID(),
        fee = Math.round((10000 * settings.fee_bps) / 10000);
      await h.api.pool.query(
        "INSERT INTO booking_orders(id,org_id,team_id,event_name,team_name,buyer_user_id,scope,fee_bps,settings_version) VALUES($1,$2,$3,'合成共享日历预约',$4,$5,'SINGLE',$6,$7)",
        [
          orderId,
          h.owner.orgId,
          h.teams[0]!.id,
          h.teams[0]!.name,
          actor.id === h.owner.id ? h.leader.id : h.owner.id,
          settings.fee_bps,
          settings.version,
        ],
      );
      await h.api.pool.query(
        "INSERT INTO booking_appearances(id,order_id,profile_id,player_user_id,label,status,report_at,start_at,end_at,venue,service_fen,platform_fee_fen,total_fen,expires_at) VALUES($1,$2,$3,$4,'共享日历合成历史预约','REQUESTED',$5,$5,$6,'合成球场',10000,$7,$8,clock_timestamp()+interval '10 minutes')",
        [id, orderId, profiles.get(actor.id), actor.id, start, end, fee, 10000 + fee],
      );
      return { id };
    }
    async function calendarOwners(key: string, start: string, end: string) {
      return Number(
        (
          await h.api.pool.query(
            `SELECT (
  (SELECT count(*) FROM training_resource_reservations WHERE active AND resource_key=$1 AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)'))+
  (SELECT count(*) FROM local_resource_reservations WHERE active AND resource_key=$1 AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)'))+
  (SELECT count(*) FROM court_reservations WHERE 'court:'||court_id=$1 AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)'))+
  (SELECT count(*) FROM booking_appearances WHERE 'user:'||player_user_id=$1 AND status IN('REQUESTED','ACCEPTED','ARRIVED','COMPLETED','DISPUTED') AND NOT(status='REQUESTED' AND expires_at<=clock_timestamp()) AND c06_booking_window(report_at,end_at) && tstzrange($2::timestamptz,$3::timestamptz,'[)'))
 )::int AS n`,
            [key, start, end],
          )
        ).rows[0].n,
      );
    }
    async function soleWinner(tasks: Promise<unknown>[]) {
      const rs = await Promise.allSettled(tasks);
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = rs.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failure.reason?.code).not.toBe('40P01');
      return rs;
    }
    for (const kind of ['COURT', 'REFEREE'] as const) {
      it(`training and X12 ${kind} reject both insertion directions and serialize a real race`, async () => {
        for (const order of ['TRAINING_FIRST', 'LOCAL_FIRST', 'RACE']) {
          const w = window(),
            t = await trainingDraft(w.start, w.end),
            s = await supply(kind, w.start, w.end, kind === 'COURT' ? t.court : undefined);
          if (order === 'TRAINING_FIRST') {
            await publishTraining(t);
            await expect(book(s)).rejects.toMatchObject({ code: 'LOCAL_TIME_CONFLICT' });
          } else if (order === 'LOCAL_FIRST') {
            await book(s);
            await expect(publishTraining(t)).rejects.toMatchObject({
              code: 'TRAINING_SCHEDULE_CONFLICT',
            });
          } else await soleWinner([publishTraining(t), book(s)]);
          expect(
            await calendarOwners(
              kind === 'COURT' ? 'court:' + t.court.id : 'user:' + h.owner.id,
              w.start,
              w.end,
            ),
          ).toBe(1);
        }
      }, 60000);
    }
    it('training and legacy player calendars reject both directions and serialize concurrent reservations', async () => {
      for (const order of ['TRAINING_FIRST', 'PLAYER_FIRST', 'RACE']) {
        const w = window(),
          t = await trainingDraft(w.start, w.end);
        if (order === 'TRAINING_FIRST') {
          await publishTraining(t);
          await expect(player(w.start, w.end)).rejects.toMatchObject({ code: '23P01' });
        } else if (order === 'PLAYER_FIRST') {
          await player(w.start, w.end);
          await expect(publishTraining(t)).rejects.toMatchObject({
            code: 'TRAINING_SCHEDULE_CONFLICT',
          });
        } else await soleWinner([publishTraining(t), player(w.start, w.end)]);
        expect(await calendarOwners('user:' + h.owner.id, w.start, w.end)).toBe(1);
      }
    }, 60000);
    async function matchPlan(t: Awaited<ReturnType<typeof trainingDraft>>) {
      const current = await frozen(h, h.owner, h.teams, {
        startDate: new Date(Date.parse(t.start) - 86400000).toISOString().slice(0, 10),
        endDate: new Date(Date.parse(t.end) + 86400000).toISOString().slice(0, 10),
      });
      let plan = await revision(h.api, h.owner, current, [t.court]);
      plan = await allocate(h.api, h.owner, plan, fullAllocations(plan, t.court, t.start));
      return plan;
    }
    async function publishMatch(plan: Awaited<ReturnType<typeof matchPlan>>) {
      const r = await publish(h.api, h.owner, plan);
      if (r.status !== 200)
        throw Object.assign(Error('canonical match publication blocked'), {
          code: r.body.error?.code,
          status: r.status,
        });
      return r;
    }
    it('training and canonical published courts reject both directions and serialize publication races', async () => {
      for (const order of ['TRAINING_FIRST', 'MATCH_FIRST', 'RACE']) {
        const w = window(),
          t = await trainingDraft(w.start, w.end),
          plan = await matchPlan(t);
        if (order === 'TRAINING_FIRST') {
          await publishTraining(t);
          await expect(publishMatch(plan)).rejects.toMatchObject({ status: 409 });
        } else if (order === 'MATCH_FIRST') {
          await publishMatch(plan);
          await expect(publishTraining(t)).rejects.toMatchObject({
            code: 'TRAINING_SCHEDULE_CONFLICT',
          });
        } else await soleWinner([publishTraining(t), publishMatch(plan)]);
        expect(await calendarOwners('court:' + t.court.id, w.start, w.end)).toBe(1);
      }
    }, 90000);
    async function trainingSchedule(
      t: Awaited<ReturnType<typeof trainingDraft>>,
      startsAt = t.start,
      windowStart = t.start,
    ) {
      const f = await frozen(h, h.owner, h.teams, {
        startDate: new Date(Date.parse(windowStart) - 86400000).toISOString().slice(0, 10),
        endDate: new Date(Date.parse(t.end) + 86400000).toISOString().slice(0, 10),
      });
      let draft = await revision(h.api, h.owner, f, [t.court], {
        courtWindows: [
          {
            courtId: t.court.id,
            startsAt: windowStart,
            endsAt: new Date(Date.parse(t.end) + 3 * 3600000).toISOString(),
          },
        ],
      });
      draft = await allocate(h.api, h.owner, draft, fullAllocations(draft, t.court, startsAt));
      return draft;
    }
    async function trainingReservations(t: { id: string }) {
      return rows(
        h,
        'SELECT r.* FROM training_resource_reservations r JOIN training_sessions s ON s.id=r.session_id WHERE s.cohort_id=$1',
        [t.id],
      );
    }
    async function previewTrainingSchedule(draft: ScheduleRevisionData, preserveAssigned: boolean) {
      return call(h.api, 'post', `${revisionPath(h.owner.orgId, draft.id)}/optimization-preview`, {
        cookie: h.owner.cookie,
        body: { ...versions(draft), preserveAssigned },
      });
    }
    it('training occupancy is visible before publication and optimization stays read-only and private', async () => {
      const w = window(),
        t = await trainingDraft(w.start, w.end);
      await publishTraining(t);
      const draft = await trainingSchedule(t);
      const detail = await training.detail(t.id);
      const enrollmentId = (
        await training.enroll(h.leader.cookie, t.id, {
          commandId: randomUUID(),
          payerUserId: h.leader.id,
          learnerUserId: h.leader.id,
          adultConfirmed: true,
          acceptedTermsId: detail.termsId,
        })
      ).enrollmentId;
      // The existing expired-history fixture changes only the deadline. A read
      // must not run the canonical cleanup or release any learner reservation.
      await h.api.pool.query(
        "UPDATE training_enrollments SET hold_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [enrollmentId],
      );
      const enrollmentBefore = await rows(h, 'SELECT * FROM training_enrollments WHERE id=$1', [
        enrollmentId,
      ]);
      expect(
        (
          await h.api.pool.query(
            'SELECT active FROM training_resource_reservations WHERE enrollment_id=$1',
            [enrollmentId],
          )
        ).rows,
      ).toEqual([expect.objectContaining({ active: true })]);
      const trainingBefore = await trainingReservations(t);
      const before = await originalFacts(h, draft.eventId);
      const eventBefore = await rows(h, 'SELECT * FROM events WHERE id=$1', [draft.eventId]);
      const occupied = (
        await h.api.pool.query<{ starts_at: Date; ends_at: Date }>(
          'SELECT r.starts_at,r.ends_at FROM training_resource_reservations r JOIN training_sessions s ON s.id=r.session_id WHERE s.cohort_id=$1 AND r.resource_key=$2 AND r.active',
          [t.id, 'court:' + t.court.id],
        )
      ).rows[0]!;
      const validation = await validate(h.api, h.owner, draft);
      expect(validation.valid).toBe(false);
      expect(validation.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'COURT_OVERLAP',
            external: true,
            resourceId: t.court.id,
            fixtureKeys: [draft.fixtures[0]!.fixtureKey],
          }),
        ]),
      );
      const preserved = await previewTrainingSchedule(draft, true);
      expect(preserved.status).toBe(422);
      expect(preserved.body.error.code).toBe('SCHEDULE_FIXED_ALLOCATION_CONFLICT');
      const preview = data<ScheduleOptimizationPreview>(
        await previewTrainingSchedule(draft, false),
      );
      expect(preview.status).toBe('COMPLETE');
      expect(preview.allocations).toHaveLength(draft.fixtures.length);
      for (const allocation of preview.allocations) {
        expect(allocation.courtId).toBe(t.court.id);
        expect(Date.parse(allocation.startsAt!)).toBeGreaterThanOrEqual(occupied.ends_at.getTime());
      }
      for (const response of [validation, preview])
        for (const privateId of [t.id, coachId, courseId, enrollmentId, h.owner.id, h.leader.id])
          expect(JSON.stringify(response)).not.toContain(privateId);
      expect(await originalFacts(h, draft.eventId)).toEqual(before);
      expect(await rows(h, 'SELECT * FROM events WHERE id=$1', [draft.eventId])).toEqual(
        eventBefore,
      );
      expect(await trainingReservations(t)).toEqual(trainingBefore);
      expect(
        await rows(h, 'SELECT * FROM training_enrollments WHERE id=$1', [enrollmentId]),
      ).toEqual(enrollmentBefore);
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::int AS n FROM court_reservations WHERE match_id IN(SELECT id FROM published_matches WHERE event_id=$1)',
            [draft.eventId],
          )
        ).rows[0].n,
      ).toBe(0);
    }, 60000);
    it('suspended training still blocks a draft; canonical cancellation releases only inactive history', async () => {
      const w = window(),
        t = await trainingDraft(w.start, w.end);
      await publishTraining(t);
      const draft = await trainingSchedule(t);
      let detail = await training.detail(t.id);
      await training.cohortCommand(
        h.owner.cookie,
        t.id,
        command('SUSPEND', detail.version, { reason: '合成暂停保留原课次与场地' }),
      );
      expect((await validate(h.api, h.owner, draft)).valid).toBe(false);
      expect((await previewTrainingSchedule(draft, true)).status).toBe(422);
      detail = await training.detail(t.id);
      await training.cohortCommand(
        h.owner.cookie,
        t.id,
        command('CANCEL', detail.version, { reason: '合成取消课次并释放其预约' }),
      );
      const history = await trainingReservations(t);
      expect(history.length).toBeGreaterThan(0);
      expect(history.every((r) => (r as { active: boolean }).active === false)).toBe(true);
      expect((await validate(h.api, h.owner, draft)).valid).toBe(true);
      expect(
        data<ScheduleOptimizationPreview>(await previewTrainingSchedule(draft, true)),
      ).toMatchObject({
        status: 'COMPLETE',
        preservedCount: draft.fixtures.length,
      });
      expect(await trainingReservations(t)).toEqual(history);
    }, 60000);
    it('training calendar validation includes persisted buffers and keeps interval ends exclusive', async () => {
      const w = window(),
        t = await trainingDraft(w.start, w.end);
      await publishTraining(t);
      const occupied = (
        await h.api.pool.query<{ starts_at: Date; ends_at: Date }>(
          'SELECT r.starts_at,r.ends_at FROM training_resource_reservations r JOIN training_sessions s ON s.id=r.session_id WHERE s.cohort_id=$1 AND r.resource_key=$2 AND r.active',
          [t.id, 'court:' + t.court.id],
        )
      ).rows[0]!;
      expect(occupied.starts_at.getTime()).toBe(Date.parse(w.start) - 15 * 60000);
      expect(occupied.ends_at.getTime()).toBe(Date.parse(w.end) + 15 * 60000);
      const beforeTraining = new Date(Date.parse(w.start) - 2 * 3600000).toISOString();
      let draft = await trainingSchedule(t, beforeTraining, beforeTraining);
      for (const [start, valid] of [
        [new Date(Date.parse(w.start) - 3600000).toISOString(), false],
        [new Date(Date.parse(w.end) + 60000).toISOString(), false],
        [new Date(occupied.starts_at.getTime() - 3600000).toISOString(), true],
        [occupied.ends_at.toISOString(), true],
      ] as const) {
        draft = await allocate(h.api, h.owner, draft, fullAllocations(draft, t.court, start));
        const result = await validate(h.api, h.owner, draft);
        expect(result.valid, start).toBe(valid);
        if (!valid)
          expect(result.conflicts).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ code: 'COURT_OVERLAP', external: true }),
            ]),
          );
      }
    }, 60000);
    it('formal rescheduling reports a locatable training conflict before any canonical fact changes', async () => {
      const w = window(),
        t = await trainingDraft(w.start, w.end);
      const originalStart = new Date(Date.parse(w.start) - 2 * 3600000).toISOString();
      const draft = await trainingSchedule(t, originalStart, originalStart);
      data(await publish(h.api, h.owner, draft));
      await publishTraining(t);
      const matches = data<ScheduledMatchData[]>(
        await call(h.api, 'get', matchesPath(h.owner.orgId, draft.eventId), {
          cookie: h.owner.cookie,
        }),
      );
      const current = await rescheduling(h, matches[0]!.id);
      const before = await currentFacts(h, draft.eventId, current.match.id);
      const trainingBefore = await trainingReservations(t);
      const rejected = await reschedule(h, current, {
        courtId: t.court.id,
        startsAt: w.start,
      });
      expect(rejected.status).toBe(409);
      expect(rejected.body.error.code).toBe('SCHEDULE_CONFLICT');
      expect(rejected.body.error.details.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'COURT_OVERLAP',
            external: true,
            resourceId: t.court.id,
            fixtureKeys: [current.match.fixtureKey],
          }),
        ]),
      );
      expect(await currentFacts(h, draft.eventId, current.match.id)).toEqual(before);
      expect(await trainingReservations(t)).toEqual(trainingBefore);
    }, 60000);
    it('a legacy player insert releases an expired learner hold without reviving or rewriting its history', async () => {
      const w = window(),
        t = await trainingDraft(w.start, w.end);
      await publishTraining(t);
      const detail = await training.detail(t.id);
      const n = (
        await training.enroll(h.leader.cookie, t.id, {
          commandId: randomUUID(),
          payerUserId: h.leader.id,
          learnerUserId: h.leader.id,
          adultConfirmed: true,
          acceptedTermsId: detail.termsId,
        })
      ).enrollmentId;
      const original = (
        await h.api.pool.query(
          'SELECT * FROM training_resource_reservations WHERE enrollment_id=$1',
          [n],
        )
      ).rows[0];
      expect(original.active).toBe(true);
      await h.api.pool.query(
        "UPDATE training_enrollments SET hold_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [n],
      );
      await player(w.start, w.end, h.leader);
      expect(
        (
          await h.api.pool.query('SELECT active FROM training_resource_reservations WHERE id=$1', [
            original.id,
          ])
        ).rows[0].active,
      ).toBe(false);
      await expect(
        h.api.pool.query('UPDATE training_resource_reservations SET active=true WHERE id=$1', [
          original.id,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      expect(await calendarOwners('user:' + h.leader.id, w.start, w.end)).toBe(1);
    });
    async function dispatchFixture(s: Awaited<ReturnType<typeof supply>>, expired: boolean) {
      const zero = {
          serviceMinor: 0,
          travelMinor: 0,
          lodgingMinor: 0,
          platformMinor: 0,
          totalMinor: 0,
        },
        start = Date.parse(s.start);
      const q = parseDispatchQuote(
        {
          slotId: s.slotId,
          ...zero,
          departureAt: new Date(start - 48 * 3600000).toISOString(),
          arrivalAt: new Date(start - 3600000).toISOString(),
          returnAt: new Date(start + 49 * 3600000).toISOString(),
          travelMethod: '合成往返班车',
          travelEvidence: '隔离测试完整路线时刻与报到证据',
          terms: '公益服务与差旅全部零费用并经独立审核',
        },
        { startsAt: s.start, endsAt: s.end, budget: zero },
      );
      const requestId = randomUUID(),
        batchId = randomUUID(),
        offerId = randomUUID(),
        holdId = randomUUID(),
        reservationId = randomUUID(),
        c = await h.api.pool.connect();
      try {
        await c.query('BEGIN');
        const now = (await c.query('SELECT clock_timestamp() AS n')).rows[0].n.getTime(),
          expires = new Date(now + 86400000).toISOString(),
          holdExpires = new Date(now + (expired ? -1 : 5) * 60000).toISOString();
        // Explicit canonical history fixture: expired deadlines are immutable and cannot be fabricated by an UPDATE.
        await c.query(
          "INSERT INTO dispatch_requests(id,org_id,owner_user_id,kind,region_catalog_version,service_region_id,service_address,starts_at,ends_at,expires_at,budget,invite_region_ids,allow_cross_city,status,batch_count) VALUES($1,$2,$3,'REFEREE',$4,$5,'隔离合成服务场馆',$6,$7,$8,$9,$10,true,'REVIEWING',1)",
          [
            requestId,
            h.owner.orgId,
            h.leader.id,
            REGION_CATALOG_VERSION,
            regionId,
            s.start,
            s.end,
            expires,
            zero,
            [regionId],
          ],
        );
        await c.query(
          'INSERT INTO dispatch_batches(id,request_id,batch_no,expires_at) VALUES($1,$2,1,$3)',
          [batchId, requestId, expires],
        );
        const listing = (await c.query('SELECT version FROM local_listings WHERE id=$1', [s.id]))
          .rows[0];
        await c.query(
          "INSERT INTO dispatch_offers(id,request_id,batch_id,provider_user_id,listing_id,listing_version,status,expires_at,quote,quote_hash,travel_verified_by,travel_verified_at,hold_expires_at) VALUES($1,$2,$3,$4,$5,$6,'ACCEPTED_HELD',$7,$8,$9,$10,clock_timestamp(),$11)",
          [
            offerId,
            requestId,
            batchId,
            s.provider.id,
            s.id,
            listing.version,
            expires,
            q,
            q.hash,
            h.otherOwner.id,
            holdExpires,
          ],
        );
        await c.query(
          "INSERT INTO dispatch_holds(id,request_id,offer_id,provider_user_id,starts_at,ends_at,expires_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE')",
          [
            holdId,
            requestId,
            offerId,
            s.provider.id,
            q.protectedStartsAt,
            q.protectedEndsAt,
            holdExpires,
          ],
        );
        await c.query(
          'UPDATE dispatch_requests SET winner_offer_id=$2,version=version+1 WHERE id=$1',
          [requestId, offerId],
        );
        await c.query(
          'INSERT INTO local_resource_reservations(id,resource_key,dispatch_offer_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)',
          [reservationId, 'user:' + s.provider.id, offerId, q.protectedStartsAt, q.protectedEndsAt],
        );
        await c.query('COMMIT');
        return { requestId, offerId, holdId, reservationId, q };
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    }
    it('a verified long-distance travel window blocks training even outside the actual service window in both directions and concurrent writes', async () => {
      for (const order of ['TRAVEL_FIRST', 'TRAINING_FIRST', 'RACE']) {
        serial += 20;
        const w = window(),
          s = await supply('REFEREE', w.start, w.end),
          travelStart = new Date(Date.parse(w.start) - 24 * 3600000).toISOString(),
          travelEnd = new Date(Date.parse(w.start) - 23 * 3600000).toISOString(),
          t = await trainingDraft(travelStart, travelEnd);
        expect(Date.parse(t.end)).toBeLessThan(Date.parse(s.start));
        if (order === 'TRAVEL_FIRST') {
          const offer = await dispatchFixture(s, false);
          expect(Date.parse(offer.q.protectedEndsAt) - Date.parse(offer.q.protectedStartsAt)).toBe(
            97 * 3600000,
          );
          await expect(publishTraining(t)).rejects.toMatchObject({
            code: 'TRAINING_SCHEDULE_CONFLICT',
          });
          await expect(player(t.start, t.end)).rejects.toMatchObject({ code: '23P01' });
        } else if (order === 'TRAINING_FIRST') {
          await publishTraining(t);
          await expect(dispatchFixture(s, false)).rejects.toMatchObject({ code: '23P01' });
        } else await soleWinner([publishTraining(t), dispatchFixture(s, false)]);
        expect(await calendarOwners('user:' + h.owner.id, t.start, t.end)).toBe(1);
      }
    }, 60000);
    it('a new training reservation releases an expired dispatch hold while retaining its immutable original quote', async () => {
      serial += 20;
      const w = window(),
        s = await supply('REFEREE', w.start, w.end),
        t = await trainingDraft(
          new Date(Date.parse(w.start) - 24 * 3600000).toISOString(),
          new Date(Date.parse(w.start) - 23 * 3600000).toISOString(),
        );
      // Prepare first: every production training write already releases expired calendar holds.
      // Insert immutable expired history last, so PUBLISH is the first subsequent training write.
      const old = await dispatchFixture(s, true);
      expect(
        (
          await h.api.pool.query('SELECT active FROM local_resource_reservations WHERE id=$1', [
            old.reservationId,
          ])
        ).rows[0].active,
      ).toBe(true);
      await publishTraining(t);
      expect(
        (
          await h.api.pool.query('SELECT active FROM local_resource_reservations WHERE id=$1', [
            old.reservationId,
          ])
        ).rows[0].active,
      ).toBe(false);
      expect(
        (
          await h.api.pool.query('SELECT quote_hash,status FROM dispatch_offers WHERE id=$1', [
            old.offerId,
          ])
        ).rows[0],
      ).toMatchObject({ quote_hash: old.q.hash, status: 'ACCEPTED_HELD' });
      await expect(
        h.api.pool.query('UPDATE local_resource_reservations SET active=true WHERE id=$1', [
          old.reservationId,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      expect(await calendarOwners('user:' + h.owner.id, t.start, t.end)).toBe(1);
    });
  },
);
