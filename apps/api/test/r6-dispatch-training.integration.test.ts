import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DispatchService } from '../src/dispatch-service.js';
import { LocalServicesService } from '../src/local-services-service.js';
import { TrainingService } from '../src/training-service.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { hashPassword } from '../src/security.js';
import { REGION_CATALOG_VERSION } from '../src/region-catalog-data.js';
import { closeHarness, court, createHarness } from './p04-support.js';
import type { Harness } from './p04-support.js';
import { login, ORIGIN, PASSWORD, RUN_ID } from './support.js';
import type { User } from './support.js';

const zero = { serviceMinor: 0, travelMinor: 0, lodgingMinor: 0, platformMinor: 0, totalMinor: 0 };
const cmd = (action: string, expectedVersion: number, extra: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  action,
  expectedVersion,
  ...extra,
});

describe('dispatch excludes adult training calendars before the bounded invitation limit', () => {
  let h: Harness, dispatch: DispatchService, local: LocalServicesService, training: TrainingService;
  let regionId: string, courseId: string, ownerCoach: string, base: number;
  const people: Array<User & { listingId: string; listingVersion: number; coachId: string }> = [];
  const at = (hours: number) => new Date(base + hours * 3600000).toISOString();
  const region = () => ({ catalogVersion: REGION_CATALOG_VERSION, regionId });
  beforeAll(async () => {
    h = await createHarness(1);
    const options = {
      databaseUrl: h.databaseUrl,
      appOrigin: ORIGIN,
      backgroundWorkersEnabled: false,
    };
    local = new LocalServicesService(h.api.pool, options);
    dispatch = new DispatchService(h.api.pool, options, { enabled: true });
    training = new TrainingService(h.api.pool, options, { enabled: true });
    base =
      (await h.api.pool.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime() +
      7 * 86400000;
    regionId = (
      await h.api.pool.query(
        "SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND level='COUNTY' ORDER BY source_code LIMIT 1",
        [REGION_CATALOG_VERSION],
      )
    ).rows[0].region_id;
    await h.api.pool.query(
      "UPDATE organization_memberships SET role='ORG_ADMIN' WHERE org_id=$1 AND user_id=$2",
      [h.owner.orgId, h.otherOwner.id],
    );
    await maintainPlatformOperator(h.api.pool, {
      email: h.otherOwner.email,
      status: 'ACTIVE',
      reason: '合成培训与跨城共享日历审核',
    });
    await training.registerProvider(h.owner.cookie, h.owner.orgId, {
      commandId: randomUUID(),
      name: '合成成人培训机构',
      evidenceReference: 'synthetic-dispatch-training-provider',
      qualifiedUntil: at(1000),
    });
    await training.providerCommand(
      h.otherOwner.cookie,
      h.owner.orgId,
      cmd('APPROVE', 1, { reason: '独立核验合成培训资质' }),
    );
    courseId = (
      await training.createCourse(h.owner.cookie, h.owner.orgId, {
        commandId: randomUUID(),
        title: '合成成人日历课程',
        description: '真实课次占位用于派单候选筛选验证',
      })
    ).courseId;
    async function coach(who: User) {
      const id = (
        await training.addCoach(h.owner.cookie, h.owner.orgId, {
          commandId: randomUUID(),
          userId: who.id,
          displayName: '合成成人教练',
          evidenceReference: 'synthetic-dispatch-training-coach',
          qualifiedUntil: at(1000),
        })
      ).coachId;
      await training.coachCommand(who.cookie, id, cmd('CONSENT', 1));
      await training.coachCommand(
        h.otherOwner.cookie,
        id,
        cmd('APPROVE', 2, { reason: '独立核验本人教练许可' }),
      );
      return id;
    }
    ownerCoach = await coach(h.owner);
    const passwordHash = await hashPassword(PASSWORD);
    for (const id of Array.from({ length: 12 }, () => randomUUID()).sort()) {
      const who: User = {
        id,
        orgId: '',
        email: `dispatch-training-${RUN_ID}-${id}@example.test`,
        cookie: '',
      };
      await h.api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [id, who.email, '合成成年服务方', passwordHash],
      );
      who.cookie = await login(h.api, who);
      const listing = await local.createListing(h.owner.cookie, h.owner.orgId, {
        commandId: randomUUID(),
        kind: 'REFEREE',
        title: '合成已审核裁判',
        description: '真实许可与培训档期筛选测试',
        address: '合成公开服务场所',
        region: region(),
        coverageRegionIds: [regionId],
        providerUserId: id,
        courtId: null,
        qualificationNote: '已独立核验合成人员资质',
        terms: '本次公益服务零费用，仍需独立核对实际档期及履约约定',
      });
      await local.listingCommand(who.cookie, listing.resourceId, {
        commandId: randomUUID(),
        type: 'CONFIRM_PROVIDER',
        expectedVersion: 1,
        reason: '本人确认实际供给资料',
      });
      await local.listingCommand(h.owner.cookie, listing.resourceId, {
        commandId: randomUUID(),
        type: 'SUBMIT',
        expectedVersion: 2,
        reason: '提交独立资质审核',
      });
      await local.listingCommand(h.otherOwner.cookie, listing.resourceId, {
        commandId: randomUUID(),
        type: 'APPROVE',
        expectedVersion: 3,
        reason: '独立核验人员供给资格',
        qualifiedUntil: at(1000),
        qualificationChecked: true,
        scopeChecked: true,
      });
      await local.listingCommand(h.owner.cookie, listing.resourceId, {
        commandId: randomUUID(),
        type: 'PUBLISH',
        expectedVersion: 4,
        reason: '发布已核验的真实供给',
      });
      await dispatch.preference(who.cookie, {
        commandId: randomUUID(),
        expectedVersion: 0,
        enabled: true,
        regionIds: [regionId],
        dailyLimit: 9,
      });
      people.push({
        ...who,
        listingId: listing.resourceId,
        listingVersion: 5,
        coachId: await coach(who),
      });
    }
  }, 90000);
  afterAll(async () => {
    dispatch?.close();
    if (h) await closeHarness(h);
  });

  async function cohort(hours: number, coachIds: string[]) {
    const venue = await court(h.api, h.owner, '合成独立培训场地');
    const r = await training.createCohort(h.owner.cookie, h.owner.orgId, {
      commandId: randomUUID(),
      courseId,
      courtId: venue.id,
      title: '合成成人固定班',
      address: '合成实际教学场地',
      capacity: 35,
      totalFen: 0,
      termsText: '成人本人参加，真实课次与教练学员档期必须保持一致。',
      enrollmentDeadline: at(hours - 1),
      sessions: [
        { startsAt: at(hours), endsAt: at(hours + 1), coachIds, priceWeight: 1, bufferMinutes: 15 },
      ],
    });
    await training.cohortCommand(h.owner.cookie, r.cohortId, cmd('PUBLISH', 1));
    return training.detail(r.cohortId);
  }
  async function enroll(c: Awaited<ReturnType<typeof cohort>>, who: User, confirm: boolean) {
    const n = await training.enroll(who.cookie, c.id, {
      commandId: randomUUID(),
      payerUserId: who.id,
      learnerUserId: who.id,
      adultConfirmed: true,
      acceptedTermsId: c.termsId,
      waitlist: false,
    });
    if (confirm) await training.enrollmentCommand(who.cookie, n.enrollmentId, cmd('CONFIRM', 1));
    return training.enrollmentDetail(who.cookie, n.enrollmentId);
  }

  test.each(['COACH', 'LEARNER'] as const)(
    '%s conflicts in the first nine positions do not hide later valid people',
    async (role) => {
      const hours = role === 'COACH' ? 24 : 48;
      for (const p of people)
        await local.createSlot(h.owner.cookie, p.listingId, {
          commandId: randomUUID(),
          expectedVersion: p.listingVersion,
          startsAt: at(hours),
          endsAt: at(hours + 1),
        });
      let first: Awaited<ReturnType<typeof cohort>>;
      if (role === 'COACH') {
        const groups = [];
        for (let index = 0; index < 9; index += 3)
          groups.push(
            await cohort(
              hours,
              people.slice(index, index + 3).map((p) => p.coachId),
            ),
          );
        first = groups[0]!;
        const released = await cohort(hours, [people[10]!.coachId]);
        await training.cohortCommand(
          h.owner.cookie,
          released.id,
          cmd('CANCEL', released.version, { reason: '取消未授课课次并永久释放教练档期' }),
        );
        // Stored training buffer begins exactly at the dispatch post-service boundary.
        await cohort(hours + 1.75, [people[11]!.coachId]);
      } else {
        first = await cohort(hours, [ownerCoach]);
        for (let index = 0; index < 9; index++) {
          const enrollment = await enroll(first, people[index]!, index < 6);
          if (index === 0)
            // An old hold timestamp does not expire a subsequently CONFIRMED enrollment.
            await h.api.pool.query(
              "UPDATE training_enrollments SET hold_expires_at=clock_timestamp()-interval '1 second',version=version+1 WHERE id=$1",
              [enrollment.id],
            );
        }
        const released = await enroll(first, people[10]!, true);
        const lesson = released.entitlements[0]!;
        await training.entitlementCommand(
          people[10]!.cookie,
          lesson.id,
          cmd('LEAVE', lesson.version, { reason: '本人请假保留权益并释放原课次档期' }),
        );
        await enroll(await cohort(hours + 1.75, [ownerCoach]), people[11]!, true);
      }
      const stale = await enroll(first, people[9]!, false);
      const request = await dispatch.create(h.otherOwner.cookie, {
        commandId: randomUUID(),
        orgId: h.otherOwner.orgId,
        kind: 'REFEREE',
        people: 1,
        serviceRegion: region(),
        serviceAddress: '实际合成比赛场馆报到地点',
        startsAt: at(hours),
        endsAt: at(hours + 1),
        expiresAt: at(hours - 6),
        budget: zero,
        inviteRegionIds: [regionId],
        allowCrossCity: true,
      });
      // Explicit expired-history fixture. START must release this stale HOLDING row,
      // while retaining live holds and confirmed learner/coach calendar obligations.
      await h.api.pool.query(
        "UPDATE training_enrollments SET hold_expires_at=clock_timestamp()-interval '1 second',version=version+1 WHERE id=$1",
        [stale.id],
      );
      expect(
        (
          await h.api.pool.query(
            'SELECT 1 FROM training_resource_reservations WHERE enrollment_id=$1 AND active',
            [stale.id],
          )
        ).rowCount,
      ).toBe(1);
      await dispatch.requestCommand(h.otherOwner.cookie, request.resourceId, {
        commandId: randomUUID(),
        expectedVersion: request.version,
        type: 'START',
        reason: '双方许可后按真实培训档期筛选候选',
      });
      const detail = await dispatch.detail(h.otherOwner.cookie, request.resourceId);
      expect(detail.request.status).toBe('INVITING');
      expect(detail.request.batchCount).toBe(1);
      expect(detail.offers.map((o) => o.listingId).sort()).toEqual(
        people
          .slice(9)
          .map((p) => p.listingId)
          .sort(),
      );
      expect(
        (
          await h.api.pool.query(
            'SELECT 1 FROM training_resource_reservations WHERE enrollment_id=$1 AND active',
            [stale.id],
          )
        ).rowCount,
      ).toBe(0);
      const busy = await h.api.pool.query(
        "SELECT DISTINCT resource_key FROM training_resource_reservations WHERE active AND resource_key=ANY($1::text[]) AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz+interval '30 minutes','[)')",
        [people.slice(0, 9).map((p) => 'user:' + p.id), at(hours), at(hours + 1)],
      );
      expect(busy.rows).toHaveLength(9);
      expect(
        (
          await h.api.pool.query(
            'SELECT 1 FROM dispatch_offers WHERE request_id=$1 AND provider_user_id=ANY($2::uuid[])',
            [request.resourceId, people.slice(0, 9).map((p) => p.id)],
          )
        ).rowCount,
      ).toBe(0);
    },
    60000,
  );
});
