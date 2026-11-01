import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { ApiExceptionFilter } from '../src/errors.js';
import { TrainingController, SCB_TRAINING_SERVICE } from '../src/training-controller.js';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TradeService } from '../src/trade-service.js';
import type { TradePayments } from '../src/trade-provider.js';
import { remainingSixTradeSources, trainingTradeHooks } from '../src/remaining-six-trade.js';
import { readRemainingSixClosureBlockers } from '../src/remaining-six-privacy.js';
import { readTrainingGuardianAuthorization } from '../src/training-guardian.js';
import { migrate } from '../src/database/migrate.js';
import { ApplicationService } from '../src/service.js';
import { TrainingService } from '../src/training-service.js';
import { trainingCohortCompletionBlocker } from '../src/training-cohort-completion.js';
import { trainingTradeIdentity } from '../src/training-trade-source.js';
import { tradeHash } from '../src/trade-domain.js';
import { readTrainingTradeSource, trainingClosureBlockers } from '../src/training-trade-source.js';
import { testDatabaseUrl, PASSWORD, RUN_ID } from './support.js';
const pool = new Pool({ connectionString: testDatabaseUrl(), max: 8 });
const options = {
  databaseUrl: testDatabaseUrl(),
  appOrigin: 'http://localhost:5173',
  registrationEnabled: true,
};
const auth = new ApplicationService(pool, options),
  service = new TrainingService(pool, options, { enabled: true });
type User = { id: string; org: string; cookie: string };
let owner: User, reviewer: User, coach: User, learner: User, other: User, operator: User;
let courseId: string, coachId: string, courtId: string;
let trainingHttp: INestApplication;
@Module({})
class TrainingHttpModule {}
const cmd = (action: string, expectedVersion: number, extra: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  action,
  expectedVersion,
  ...extra,
});
async function user(name: string): Promise<User> {
  const x = await auth.register(
    {
      email: `r6train-${name}-${RUN_ID}@example.test`,
      password: PASSWORD,
      displayName: name,
      organizationName: `Training ${name}`,
    },
    `r6train-${RUN_ID}-${name}`,
  );
  return { id: x.data.user.id, org: x.data.organizations[0]!.id, cookie: `scb.sid=${x.token}` };
}
let sequence = 0;
async function cohort(
  capacity = 2,
  totalFen = 0,
  extra: Record<string, unknown> = {},
  creator = owner,
) {
  const starts = new Date(Date.now() + (++sequence + 2) * 86400000);
  const v = {
    commandId: randomUUID(),
    courseId,
    courtId,
    title: `固定短班 ${sequence}`,
    address: '合成测试球馆',
    capacity,
    totalFen,
    termsText: '成人本人报名。未消费课次按冻结净额退还。',
    enrollmentDeadline: new Date(starts.getTime() - 3600000).toISOString(),
    sessions: [
      {
        startsAt: starts.toISOString(),
        endsAt: new Date(starts.getTime() + 3600000).toISOString(),
        coachIds: [coachId],
        priceWeight: 1,
      },
    ],
    ...extra,
  };
  const created = await service.createCohort(creator.cookie, owner.org, v);
  await service.cohortCommand(creator.cookie, created.cohortId, cmd('PUBLISH', 1));
  return await service.detail(created.cohortId);
}
async function enroll(h: Awaited<ReturnType<typeof cohort>>, who = learner, waitlist = false) {
  const result = await service.enroll(who.cookie, h.id, {
    commandId: randomUUID(),
    payerUserId: who.id,
    learnerUserId: who.id,
    adultConfirmed: true,
    acceptedTermsId: h.termsId,
    waitlist,
  });
  return await service.enrollmentDetail(who.cookie, result.enrollmentId);
}
async function confirmed(h: Awaited<ReturnType<typeof cohort>>, who = learner) {
  const n = await enroll(h, who);
  await service.enrollmentCommand(who.cookie, n.id, cmd('CONFIRM', n.version));
  return await service.enrollmentDetail(who.cookie, n.id);
}

/** Real DB time, short future lessons: never update frozen schedules to fake history. */
async function shortCohort(
  extra: {
    creator?: User;
    delay?: number;
    totalFen?: number;
    futureLesson?: boolean;
    capacity?: number;
  } = {},
) {
  const now = (await pool.query('SELECT clock_timestamp() AS n')).rows[0].n.getTime();
  const start = now + (extra.delay ?? 4000);
  const sessions = [
    {
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 100).toISOString(),
      coachIds: [coachId],
      priceWeight: 1,
      bufferMinutes: 0,
    },
  ];
  if (extra.futureLesson)
    sessions.push({
      ...sessions[0]!,
      startsAt: new Date(start + 86400000).toISOString(),
      endsAt: new Date(start + 86400100).toISOString(),
    });
  return cohort(
    extra.capacity ?? 3,
    extra.totalFen ?? 0,
    { sessions, enrollmentDeadline: new Date(start - 500).toISOString() },
    extra.creator ?? owner,
  );
}
async function waitForSessionEnd(sessionId: string) {
  const limit = Date.now() + 55000;
  while (true) {
    if (
      (
        await pool.query(
          "SELECT ends_at+buffer_minutes*interval '1 minute'<=clock_timestamp() AS ended FROM training_sessions WHERE id=$1",
          [sessionId],
        )
      ).rows[0].ended
    )
      return;
    if (Date.now() > limit) throw Error('Real DB clock did not reach the short lesson deadline');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function deliver(sessionId: string) {
  await waitForSessionEnd(sessionId);
  const current = (
    await pool.query('SELECT version FROM training_sessions WHERE id=$1', [sessionId])
  ).rows[0];
  await service.sessionCommand(
    coach.cookie,
    sessionId,
    cmd('DELIVER', current.version, { reason: '合成短课真实时钟结束后的授课记录' }),
  );
}
async function consume(enrollmentId: string, entitlementId: string, who = learner) {
  let current = await service.enrollmentDetail(who.cookie, enrollmentId);
  let right = current.entitlements.find((e) => e.id === entitlementId)!;
  await service.entitlementCommand(coach.cookie, right.id, cmd('CHECKIN', right.version));
  current = await service.enrollmentDetail(who.cookie, enrollmentId);
  right = current.entitlements.find((e) => e.id === entitlementId)!;
  const proposed = await service.entitlementCommand(
    coach.cookie,
    right.id,
    cmd('PROPOSE_CONSUMPTION', right.version, { reason: '真实签到与授课记录对应课次' }),
  );
  await service.consumptionCommand(
    reviewer.cookie,
    proposed.consumptionId,
    cmd('REVIEW', 1, { reason: '独立核对授课和签到' }),
  );
  await service.consumptionCommand(who.cookie, proposed.consumptionId, cmd('ACKNOWLEDGE', 2));
  return proposed.consumptionId as string;
}
async function completionCapability(id: string, actor = owner) {
  return (await service.workspace(actor.cookie, owner.org)).cohorts.find((h) => h.id === id)!
    .capabilities;
}
async function creatorBlocker(id: string) {
  const c = await pool.connect();
  try {
    return (await readRemainingSixClosureBlockers(c, id)).some(
      (x) => x.code === 'TRAINING_SERVICE_UNRESOLVED',
    );
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  await migrate(pool);
  [owner, reviewer, coach, learner, other, operator] = await Promise.all([
    user('owner'),
    user('reviewer'),
    user('coach'),
    user('learner'),
    user('other'),
    user('operator'),
  ] as const);
  await pool.query(
    "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_ADMIN')",
    [owner.org, reviewer.id],
  );
  await pool.query(
    "INSERT INTO platform_operators(user_id,status,maintenance_actor_id,reason) VALUES($1,'ACTIVE',$2,'Synthetic training review')",
    [operator.id, randomUUID()],
  );
  courtId = randomUUID();
  await pool.query('INSERT INTO courts(id,org_id,name) VALUES($1,$2,$3)', [
    courtId,
    owner.org,
    '训练场',
  ]);
  await service.registerProvider(owner.cookie, owner.org, {
    commandId: randomUUID(),
    name: '合成培训机构',
    evidenceReference: 'synthetic-provider-reference',
    qualifiedUntil: '2099-12-01T00:00:00Z',
  });
  await service.providerCommand(
    operator.cookie,
    owner.org,
    cmd('APPROVE', 1, { reason: '独立审查合成资质' }),
  );
  coachId = (
    await service.addCoach(owner.cookie, owner.org, {
      commandId: randomUUID(),
      userId: coach.id,
      displayName: '测试教练',
      evidenceReference: 'synthetic-coach-reference',
      qualifiedUntil: '2099-12-01T00:00:00Z',
    })
  ).coachId;
  await service.coachCommand(coach.cookie, coachId, cmd('CONSENT', 1));
  await service.coachCommand(
    reviewer.cookie,
    coachId,
    cmd('APPROVE', 2, { reason: '独立审核教练资格' }),
  );
  courseId = (
    await service.createCourse(owner.cookie, owner.org, {
      commandId: randomUUID(),
      title: '成人基础训练',
      description: '固定短课；没有赛事代理数据',
    })
  ).courseId;
  trainingHttp = await NestFactory.create(
    {
      module: TrainingHttpModule,
      controllers: [TrainingController],
      providers: [{ provide: SCB_TRAINING_SERVICE, useValue: service }],
    },
    { logger: false },
  );
  trainingHttp.use((req: { requestId?: string }, _res: unknown, next: () => void) => {
    req.requestId = randomUUID();
    next();
  });
  trainingHttp.useGlobalFilters(new ApiExceptionFilter());
  await trainingHttp.init();
});
afterAll(async () => {
  if (trainingHttp) await trainingHttp.close();
  await pool.end();
});
describe('R6TRAIN real PostgreSQL service workflows', () => {
  it('locks the last seat atomically; FIFO waitlist cannot be overtaken', async () => {
    const h = await cohort(1);
    const results = await Promise.allSettled([enroll(h, learner), enroll(h, other)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const first = (
      results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
        Awaited<ReturnType<typeof enroll>>
      >
    ).value;
    const secondUser = first.learnerUserId === learner.id ? other : learner,
      firstUser = first.learnerUserId === learner.id ? learner : other;
    const waiting = await enroll(h, secondUser, true);
    expect(waiting.state).toBe('WAITLISTED');
    await service.enrollmentCommand(firstUser.cookie, first.id, cmd('CANCEL', first.version));
    await service.enrollmentCommand(secondUser.cookie, waiting.id, cmd('CLAIM', waiting.version));
    expect((await service.enrollmentDetail(secondUser.cookie, waiting.id)).state).toBe('HOLDING');
    expect(
      Number(
        (
          await pool.query(
            "SELECT count(*) AS n FROM training_enrollments WHERE cohort_id=$1 AND state='HOLDING'",
            [h.id],
          )
        ).rows[0].n,
      ),
    ).toBe(1);
  });
  it('free confirmation has no fabricated payment, source identity survives status changes', async () => {
    const h = await cohort();
    const n = await enroll(h);
    const c = await pool.connect();
    const before = await readTrainingTradeSource(c, n.id);
    c.release();
    await service.enrollmentCommand(learner.cookie, n.id, cmd('CONFIRM', n.version));
    const saved = await service.enrollmentDetail(learner.cookie, n.id);
    expect(saved.state).toBe('CONFIRMED');
    expect(saved.tradeOrderId).toBeNull();
    const d = await pool.connect();
    const after = await readTrainingTradeSource(d, n.id);
    expect(before.identity).toEqual(after.identity);
    expect(await trainingClosureBlockers(d, learner.id)).toBe(true);
    d.release();
    await expect(service.enrollmentDetail(other.cookie, n.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      pool.query('UPDATE training_enrollments SET total_fen=1 WHERE id=$1', [n.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('paid enrollment is unavailable until real trade binding is injected', async () => {
    const h = await cohort(1, 100);
    await expect(enroll(h)).rejects.toMatchObject({ code: 'PAID_TRAINING_UNAVAILABLE' });
    expect(
      (await pool.query('SELECT 1 FROM training_enrollments WHERE cohort_id=$1', [h.id])).rowCount,
    ).toBe(0);
  });
  it('rejects self review and prevents contract command reuse', async () => {
    await expect(
      service.coachCommand(owner.cookie, coachId, cmd('APPROVE', 3, { reason: '自审不可通过' })),
    ).rejects.toMatchObject({ status: 403 });
    const body = { commandId: randomUUID(), title: '幂等课程', description: '不重复创建课程' };
    const a = await service.createCourse(owner.cookie, owner.org, body),
      b = await service.createCourse(owner.cookie, owner.org, body);
    expect(a).toEqual(b);
    await expect(
      service.createCourse(owner.cookie, owner.org, { ...body, title: '不同内容' }),
    ).rejects.toMatchObject({ code: 'COMMAND_ID_REUSED' });
  });
  it('leave and makeup transfer one immutable entitlement, then refund requires independent approval', async () => {
    const h = await cohort(),
      target = await cohort(),
      n = await confirmed(h);
    const e = n.entitlements[0]!;
    await service.entitlementCommand(
      learner.cookie,
      e.id,
      cmd('LEAVE', e.version, { reason: '请假一次' }),
    );
    let current = await service.enrollmentDetail(learner.cookie, n.id);
    await service.entitlementCommand(
      learner.cookie,
      e.id,
      cmd('MAKEUP', current.entitlements[0]!.version, { sessionId: target.sessions[0]!.id }),
    );
    current = await service.enrollmentDetail(learner.cookie, n.id);
    expect(current.entitlements[0]!.originalSessionId).toBe(h.sessions[0]!.id);
    expect(current.entitlements[0]!.sessionId).toBe(target.sessions[0]!.id);
    const r = await service.requestRefund(owner.cookie, n.id, {
      commandId: randomUUID(),
      expectedVersion: current.version,
      entitlementIds: [e.id],
      reason: '申请退回未消费课次',
    });
    await expect(
      service.refundCommand(
        learner.cookie,
        r.allocationId,
        cmd('APPROVE', 1, { reason: '未授权学员不能执行退款复核' }),
      ),
    ).rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
    // The maker has the required organization role, so this reaches the independent-review gate.
    await expect(
      service.refundCommand(
        owner.cookie,
        r.allocationId,
        cmd('APPROVE', 1, { reason: '经办管理员也不得批准自己提出的退款' }),
      ),
    ).rejects.toMatchObject({ status: 403, code: 'INDEPENDENT_REVIEW_REQUIRED' });
    await service.refundCommand(
      reviewer.cookie,
      r.allocationId,
      cmd('APPROVE', 1, { reason: '独立确认免费课退课' }),
    );
    const end = await service.enrollmentDetail(learner.cookie, n.id);
    expect(end.state).toBe('CANCELLED');
    expect(end.refunds[0]).toMatchObject({
      status: 'COMPLETED_ZERO',
      proposed_by: owner.id,
      reviewed_by: reviewer.id,
    });
    expect(end.refunds[0]!.trade_refund_id).toBeNull();
  });
  it('ordinary learner chooses authorized makeup options through real HTTP and live capacity is rechecked', async () => {
    const original = await cohort(),
      valid = await cohort(1),
      stopped = await cohort(),
      full = await cohort(1);
    const anotherCourse = (
      await service.createCourse(owner.cookie, owner.org, {
        commandId: randomUUID(),
        title: '另一种训练课程',
        description: '不能挪用不同课程的课次权益',
      })
    ).courseId;
    const wrongCourse = await cohort(2, 0, { courseId: anotherCourse });
    await service.cohortCommand(
      owner.cookie,
      stopped.id,
      cmd('SUSPEND', stopped.version, { reason: '暂停班期不可继续安排补课' }),
    );
    await confirmed(full, other);
    const made = await service.enroll(learner.cookie, original.id, {
      commandId: randomUUID(),
      learnerUserId: learner.id,
      payerUserId: other.id,
      adultConfirmed: true,
      acceptedTermsId: original.termsId,
    });
    let n = await service.enrollmentDetail(learner.cookie, made.enrollmentId);
    await service.enrollmentCommand(learner.cookie, n.id, cmd('CONFIRM', n.version));
    n = await service.enrollmentDetail(learner.cookie, n.id);
    const right = n.entitlements[0]!;
    const path = '/v1/training/entitlements/' + right.id,
      server = trainingHttp.getHttpServer();
    let result = await request(server)
      .get(path + '/makeup-options')
      .set('Cookie', learner.cookie);
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('MAKEUP_NOT_DUE');
    result = await request(server)
      .post(path + '/commands')
      .set('Cookie', learner.cookie)
      .set('Origin', options.appOrigin)
      .send(cmd('LEAVE', right.version, { reason: '本人请假后改选合适时间' }));
    expect(result.status).toBe(200);
    for (const actor of [other, owner]) {
      const denied = await request(server)
        .get(path + '/makeup-options')
        .set('Cookie', actor.cookie);
      expect(denied.status).toBe(404);
      expect(denied.body.error.code).toBe('RESOURCE_NOT_FOUND');
      expect(denied.body.data).toBeUndefined();
    }
    const anonymous = await request(server).get(path + '/makeup-options');
    expect(anonymous.status).toBe(401);
    result = await request(server)
      .get(path + '/makeup-options')
      .set('Cookie', learner.cookie);
    expect(result.status).toBe(200);
    const choices = result.body.data;
    expect(choices.entitlementId).toBe(right.id);
    expect(choices.entitlementVersion).toBe(right.version + 1);
    const ids = choices.items.map((x: { sessionId: string }) => x.sessionId);
    expect(ids).toContain(valid.sessions[0]!.id);
    expect(ids).not.toContain(stopped.sessions[0]!.id);
    expect(ids).not.toContain(full.sessions[0]!.id);
    expect(ids).not.toContain(wrongCourse.sessions[0]!.id);
    const selected = choices.items.find(
      (x: { sessionId: string }) => x.sessionId === valid.sessions[0]!.id,
    );
    expect(selected).toMatchObject({
      cohortId: valid.id,
      cohortTitle: valid.title,
      address: valid.address,
      availableSeats: 1,
      coaches: [{ name: '测试教练' }],
    });
    expect(
      choices.items.every((x: { startsAt: string }) => Date.parse(x.startsAt) > Date.now()),
    ).toBe(true);
    expect(selected).not.toHaveProperty('learnerUserId');
    expect(selected).not.toHaveProperty('evidenceReference');
    result = await request(server)
      .post(path + '/commands')
      .set('Cookie', other.cookie)
      .set('Origin', options.appOrigin)
      .send(cmd('MAKEUP', choices.entitlementVersion, { sessionId: selected.sessionId }));
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe('FORBIDDEN');
    result = await request(server)
      .post(path + '/commands')
      .set('Cookie', learner.cookie)
      .set('Origin', options.appOrigin)
      .send(cmd('MAKEUP', choices.entitlementVersion, { sessionId: wrongCourse.sessions[0]!.id }));
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('MAKEUP_INELIGIBLE');
    // Another real enrollment takes the listed last seat before confirmation; stale lists grant no capacity.
    await confirmed(valid, other);
    result = await request(server)
      .post(path + '/commands')
      .set('Cookie', learner.cookie)
      .set('Origin', options.appOrigin)
      .send(cmd('MAKEUP', choices.entitlementVersion, { sessionId: selected.sessionId }));
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('MAKEUP_FULL');
    const next = await cohort(1);
    result = await request(server)
      .get(path + '/makeup-options')
      .set('Cookie', learner.cookie);
    expect(result.status).toBe(200);
    expect(
      result.body.data.items.some((x: { sessionId: string }) => x.sessionId === selected.sessionId),
    ).toBe(false);
    const replacement = result.body.data.items.find(
      (x: { sessionId: string }) => x.sessionId === next.sessions[0]!.id,
    );
    expect(replacement).toBeDefined();
    result = await request(server)
      .post(path + '/commands')
      .set('Cookie', learner.cookie)
      .set('Origin', options.appOrigin)
      .send(
        cmd('MAKEUP', result.body.data.entitlementVersion, { sessionId: replacement.sessionId }),
      );
    expect(result.status).toBe(200);
    const after = await service.enrollmentDetail(learner.cookie, n.id);
    expect(after.entitlements[0]).toMatchObject({
      id: right.id,
      sessionId: replacement.sessionId,
      originalSessionId: right.originalSessionId,
      netFen: right.netFen,
      state: 'AVAILABLE',
    });
    expect(after.totalFen).toBe(n.totalFen);
    expect(after.tradeOrderId).toBe(n.tradeOrderId);
    expect(after.refunds).toHaveLength(0);
    expect(after.consumptions).toHaveLength(0);
    const fresh = await request(server)
      .get(path + '/makeup-options')
      .set('Cookie', learner.cookie);
    expect(fresh.status).toBe(409);
    expect(fresh.body.error.code).toBe('MAKEUP_NOT_DUE');
  });
  it('cancelling a makeup cohort restores incoming rights without changing the original enrollment ledger', async () => {
    const original = await cohort(),
      target = await cohort(),
      replacement = await cohort();
    const n = await confirmed(original),
      right = n.entitlements[0]!;
    const frozen = (
      await pool.query(
        'SELECT cohort_id,total_fen,terms_id,terms_snapshot,trade_order_id FROM training_enrollments WHERE id=$1',
        [n.id],
      )
    ).rows[0];
    await service.entitlementCommand(
      learner.cookie,
      right.id,
      cmd('LEAVE', right.version, { reason: '改到另一班期补课' }),
    );
    let current = await service.enrollmentDetail(learner.cookie, n.id);
    await service.entitlementCommand(
      learner.cookie,
      right.id,
      cmd('MAKEUP', current.entitlements[0]!.version, { sessionId: target.sessions[0]!.id }),
    );
    current = await service.enrollmentDetail(learner.cookie, n.id);
    const inTarget = current.entitlements[0]!;
    expect(inTarget.state).toBe('AVAILABLE');
    await service.cohortCommand(
      owner.cookie,
      target.id,
      cmd('CANCEL', target.version, { reason: '机构取消补课班期，恢复原学员补课权益' }),
    );
    current = await service.enrollmentDetail(learner.cookie, n.id);
    expect(current.entitlements[0]).toMatchObject({
      id: right.id,
      state: 'MAKEUP_DUE',
      version: inTarget.version + 1,
      originalSessionId: right.originalSessionId,
      netFen: right.netFen,
    });
    expect(
      (
        await pool.query(
          'SELECT 1 FROM training_resource_reservations WHERE enrollment_id=$1 AND session_id=$2 AND active',
          [n.id, target.sessions[0]!.id],
        )
      ).rowCount,
    ).toBe(0);
    const choices = await service.makeupOptions(learner.cookie, right.id);
    expect(choices.items.some((x) => x.sessionId === target.sessions[0]!.id)).toBe(false);
    expect(choices.items.some((x) => x.sessionId === replacement.sessions[0]!.id)).toBe(true);
    await service.entitlementCommand(
      learner.cookie,
      right.id,
      cmd('MAKEUP', choices.entitlementVersion, { sessionId: replacement.sessions[0]!.id }),
    );
    current = await service.enrollmentDetail(learner.cookie, n.id);
    expect(current.entitlements[0]).toMatchObject({
      id: right.id,
      sessionId: replacement.sessions[0]!.id,
      state: 'AVAILABLE',
      originalSessionId: right.originalSessionId,
      netFen: right.netFen,
    });
    expect(
      (
        await pool.query(
          'SELECT cohort_id,total_fen,terms_id,terms_snapshot,trade_order_id FROM training_enrollments WHERE id=$1',
          [n.id],
        )
      ).rows[0],
    ).toEqual(frozen);
    expect(current.consumptions).toHaveLength(0);
    expect(current.refunds).toHaveLength(0);
  });
  it('attendance and teaching do not consume lessons; review and learner acknowledgment are separate', async () => {
    const h = await cohort(),
      n = await confirmed(h),
      e = n.entitlements[0]!;
    const sid = e.sessionId;
    await pool.query(
      "UPDATE training_sessions SET starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
      [sid],
    );
    await service.entitlementCommand(coach.cookie, e.id, cmd('CHECKIN', e.version));
    await service.sessionCommand(
      coach.cookie,
      sid,
      cmd('DELIVER', 1, { reason: '合成现场授课完成记录' }),
    );
    let current = await service.enrollmentDetail(learner.cookie, n.id);
    expect(current.entitlements[0]!.state).toBe('AVAILABLE');
    const proposed = await service.entitlementCommand(
      coach.cookie,
      e.id,
      cmd('PROPOSE_CONSUMPTION', current.entitlements[0]!.version, {
        reason: '依据签到与授课记录',
      }),
    );
    await expect(
      service.consumptionCommand(learner.cookie, proposed.consumptionId, cmd('ACKNOWLEDGE', 1)),
    ).rejects.toMatchObject({ code: 'INDEPENDENT_REVIEW_REQUIRED' });
    await service.consumptionCommand(
      reviewer.cookie,
      proposed.consumptionId,
      cmd('REVIEW', 1, { reason: '独立核对课次事实' }),
    );
    await service.consumptionCommand(learner.cookie, proposed.consumptionId, cmd('ACKNOWLEDGE', 2));
    current = await service.enrollmentDetail(learner.cookie, n.id);
    expect(current.entitlements[0]!.state).toBe('CONSUMED');
    expect(current.state).toBe('COMPLETED');
    await service.consumptionCommand(
      learner.cookie,
      proposed.consumptionId,
      cmd('DISPUTE', 3, { reason: '申请核查课次事实' }),
    );
    const c = await pool.connect();
    expect((await readTrainingTradeSource(c, n.id)).disputed).toBe(true);
    c.release();
    await service.consumptionCommand(
      operator.cookie,
      proposed.consumptionId,
      cmd('RESOLVE_ADJUST', 4, { reason: '独立裁决返还补课权益' }),
    );
    expect((await service.enrollmentDetail(learner.cookie, n.id)).entitlements[0]!.state).toBe(
      'MAKEUP_DUE',
    );
  });
  it('restore quarantine blocks mutations but keeps historical views readable', async () => {
    const h = await cohort(),
      n = await enroll(h);
    const audit = randomUUID();
    await pool.query(
      "INSERT INTO audit_logs(id,actor_id,org_id,action,resource_type,resource_id) VALUES($1,$2,$3,'RESTORE_QUARANTINE','restore',$4)",
      [audit, owner.id, owner.org, randomUUID()],
    );
    try {
      await expect(
        service.enrollmentCommand(learner.cookie, n.id, cmd('CONFIRM', n.version)),
      ).rejects.toMatchObject({ code: 'RESTORE_QUARANTINE' });
      expect((await service.enrollmentDetail(learner.cookie, n.id)).id).toBe(n.id);
    } finally {
      await pool.query('DELETE FROM audit_logs WHERE id=$1', [audit]);
    }
  });
  it('training guardian grants are bound to exact organization, cohort, purpose, policy and epoch', async () => {
    const h = await cohort(),
      otherH = await cohort(),
      id = randomUUID();
    await pool.query(
      "INSERT INTO training_guardian_grants(id,org_id,cohort_id,policy_version,learner_user_id,guardian_user_id,purpose,evidence_reference,reviewed_by,valid_until,state) VALUES($1,$2,$3,'synthetic-policy-v1',$4,$5,'PARTICIPATION','synthetic-evidence',$6,clock_timestamp()+interval '1 day','APPROVED')",
      [id, owner.org, h.id, learner.id, other.id, operator.id],
    );
    const c = await pool.connect(),
      input = {
        orgId: owner.org,
        cohortId: h.id,
        learnerId: learner.id,
        guardianId: other.id,
        purpose: 'PARTICIPATION' as const,
        policyVersion: 'synthetic-policy-v1',
        expectedEpoch: 1,
      };
    try {
      expect(await readTrainingGuardianAuthorization(c, input)).toBe(true);
      expect(await readTrainingGuardianAuthorization(c, { ...input, cohortId: otherH.id })).toBe(
        false,
      );
      expect(await readTrainingGuardianAuthorization(c, { ...input, purpose: 'PUBLICITY' })).toBe(
        false,
      );
      expect(await readTrainingGuardianAuthorization(c, { ...input, expectedEpoch: 2 })).toBe(
        false,
      );
      await c.query(
        "UPDATE training_guardian_grants SET state='REVOKED',epoch=epoch+1 WHERE id=$1",
        [id],
      );
      expect(await readTrainingGuardianAuthorization(c, input)).toBe(false);
    } finally {
      c.release();
    }
    expect(service.capabilities().youthEnrollmentEnabled).toBe(false);
  });
  it('real TradeService late payment cannot take a replacement seat, and unknown refunds retain the exact allocation', async () => {
    const payments: TradePayments = {
      enabled: true,
      native: vi.fn(async () => ({ codeUrl: 'weixin://wxpay/bizpayurl?pr=synthetic-r6-training' })),
      queryOrder: vi.fn(),
      refund: vi.fn(),
      queryRefund: vi.fn(),
      verifyNotification: vi.fn(),
      downloadBill: vi.fn(),
    };
    const trade = new TradeService(
      pool,
      options,
      {
        encryptionKey: Buffer.alloc(32, 6),
        merchants: {
          [owner.org]: {
            key: 'r6-training-' + owner.org,
            merchantId: '1900000199',
            appId: 'wx1234567890abcdef',
            displayName: '合成培训商户',
            payments,
            receivers: {},
          },
        },
      },
      remainingSixTradeSources({ trainingEnabled: true }),
    );
    const paid = new TrainingService(pool, options, {
        enabled: true,
        trade: trainingTradeHooks(trade),
      }),
      h = await cohort(1, 101);
    const create = async (who: User) => {
      const r = await paid.enroll(who.cookie, h.id, {
        commandId: randomUUID(),
        payerUserId: who.id,
        learnerUserId: who.id,
        adultConfirmed: true,
        acceptedTermsId: h.termsId,
        chargeConsent: true,
      });
      return paid.enrollmentDetail(who.cookie, r.enrollmentId);
    };
    const n = await create(learner),
      orderId = n.tradeOrderId!;
    expect(orderId).toMatch(/-/);
    const source = (await pool.query('SELECT * FROM trade_orders WHERE id=$1', [orderId])).rows[0];
    expect(source.kind).toBe('TRAINING_ENROLLMENT');
    expect(source.source_id).toBe(n.id);
    expect(source.terms_id).toBeNull();
    expect(source.total_fen).toBe(101);
    let order = await trade.get(learner.cookie, orderId);
    await trade.pay(learner.cookie, orderId, {
      clientRequestId: randomUUID(),
      expectedVersion: order.version,
      channel: 'NATIVE',
    });
    const attempt = (
      await pool.query('SELECT * FROM trade_payment_attempts WHERE order_id=$1', [orderId])
    ).rows[0];
    await expect(
      paid.enrollmentCommand(learner.cookie, n.id, cmd('CANCEL', n.version)),
    ).rejects.toMatchObject({ code: 'PAYMENT_MAY_BE_PENDING' });
    // Only the isolated fixture advances a real hold timestamp, never client-supplied payment truth.
    await pool.query(
      "UPDATE training_enrollments SET hold_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [n.id],
    );
    const replacement = await create(other);
    // A captured invoice without an attempt is not a payment: expiry frees the canonical hold.
    await pool.query(
      "UPDATE training_enrollments SET hold_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [replacement.id],
    );
    await paid.enrollmentCommand(other.cookie, replacement.id, cmd('REFRESH', replacement.version));
    expect((await paid.enrollmentDetail(other.cookie, replacement.id)).state).toBe('EXPIRED');
    const activeReplacement = await create(other);

    vi.mocked(payments.queryOrder).mockResolvedValue({
      outTradeNo: attempt.out_trade_no,
      transactionId: 'T' + attempt.id,
      state: 'SUCCESS',
      totalFen: 101,
      currency: 'CNY',
      successTime: new Date().toISOString(),
    });
    await trade.queryPayment(learner.cookie, orderId, attempt.id);
    await paid.enrollmentCommand(learner.cookie, n.id, cmd('REFRESH', n.version));
    let current = await paid.enrollmentDetail(learner.cookie, n.id);
    expect(current.state).toBe('PAID_UNALLOCATED');
    expect((await paid.enrollmentDetail(other.cookie, activeReplacement.id)).state).toBe('HOLDING');
    order = await trade.get(learner.cookie, orderId);
    expect(order.paidFen).toBe(101);
    await expect(
      trade.requestRefund(learner.cookie, orderId, {
        clientRequestId: randomUUID(),
        expectedVersion: order.version,
        amountFen: 101,
        reason: '绕过逐课限额必须拒绝',
      }),
    ).rejects.toMatchObject({ code: 'TRADE_SOURCE_REFUND_REQUIRED' });
    const allocation = await paid.requestRefund(learner.cookie, n.id, {
      commandId: randomUUID(),
      expectedVersion: current.version,
      entitlementIds: [current.entitlements[0]!.id],
      reason: '逾期实付未获名额原路退款',
    });
    await paid.refundCommand(
      reviewer.cookie,
      allocation.allocationId,
      cmd('APPROVE', 1, { reason: '独立核对原单与冻结课次净额' }),
    );
    current = await paid.enrollmentDetail(learner.cookie, n.id);
    const refundId = current.refunds[0]!.trade_refund_id as string;
    expect(
      (await pool.query('SELECT status FROM trade_refunds WHERE id=$1', [refundId])).rows[0].status,
    ).toBe('PENDING_REVIEW');
    expect(payments.refund).not.toHaveBeenCalled();
    order = await trade.get(operator.cookie, orderId);
    await trade.review(operator.cookie, orderId, 'REFUND', refundId, {
      clientRequestId: randomUUID(),
      expectedVersion: order.version,
      decision: 'APPROVE',
      reason: '独立复核统一交易退款',
    });
    vi.mocked(payments.refund).mockRejectedValue(Error('synthetic refund transport lost'));
    order = await trade.get(owner.cookie, orderId);
    const dispatch = { clientRequestId: randomUUID(), expectedVersion: order.version };
    await expect(trade.dispatchRefund(owner.cookie, orderId, refundId, dispatch)).rejects.toThrow(
      'synthetic',
    );
    await trade.dispatchRefund(owner.cookie, orderId, refundId, dispatch);
    expect(payments.refund).toHaveBeenCalledTimes(1);
    await paid.refundCommand(learner.cookie, allocation.allocationId, cmd('REFRESH', 2));
    current = await paid.enrollmentDetail(learner.cookie, n.id);
    expect(current.refunds[0]!.status).toBe('UNKNOWN');
    expect(current.entitlements[0]!.state).toBe('REFUND_PENDING');
    order = await trade.get(learner.cookie, orderId);
    expect(order.refundableFen).toBe(0);
    expect(order.refundedFen).toBe(0);
    const refund = (await pool.query('SELECT * FROM trade_refunds WHERE id=$1', [refundId]))
      .rows[0];
    vi.mocked(payments.queryRefund).mockResolvedValue({
      outTradeNo: attempt.out_trade_no,
      outRefundNo: refund.out_refund_no,
      transactionId: 'T' + attempt.id,
      refundId: 'R' + refund.id,
      state: 'SUCCESS',
      totalFen: 101,
      refundFen: 101,
      currency: 'CNY',
      createdTime: new Date().toISOString(),
      successTime: new Date().toISOString(),
    });
    await trade.queryRefund(learner.cookie, orderId, refundId);
    await paid.refundCommand(learner.cookie, allocation.allocationId, cmd('REFRESH', 3));
    current = await paid.enrollmentDetail(learner.cookie, n.id);
    expect(current.refunds[0]!.status).toBe('SUCCEEDED');
    expect(current.entitlements[0]!.state).toBe('REFUNDED');
    expect(current.state).toBe('CANCELLED');
    expect((await trade.get(learner.cookie, orderId)).refundedFen).toBe(101);
    const closedTrade = new TradeService(
      pool,
      options,
      trade.runtime,
      remainingSixTradeSources({ trainingEnabled: false }),
    );
    const historical = await closedTrade.get(learner.cookie, orderId);
    expect(historical.paidFen).toBe(101);
    expect(historical.refundedFen).toBe(101);
    expect(historical.currentSource.payable).toBe(false);
    const c = await pool.connect();
    try {
      expect(await closedTrade.sourceRefundStatus(c, refundId)).toBe('SUCCEEDED');
    } finally {
      c.release();
    }
    const paused = await cohort(1, 25);
    const hold = async () => {
      const x = await paid.enroll(learner.cookie, paused.id, {
        commandId: randomUUID(),
        payerUserId: learner.id,
        learnerUserId: learner.id,
        adultConfirmed: true,
        acceptedTermsId: paused.termsId,
        chargeConsent: true,
      });
      return paid.enrollmentDetail(learner.cookie, x.enrollmentId);
    };
    const unused = await hold();
    await paid.enrollmentCommand(learner.cookie, unused.id, cmd('CANCEL', unused.version));
    expect((await paid.enrollmentDetail(learner.cookie, unused.id)).state).toBe('CANCELLED');
    const abandoned = await hold();
    await service.cohortCommand(
      owner.cookie,
      paused.id,
      cmd('SUSPEND', paused.version, { reason: '合成供给资格变化暂停招生' }),
    );
    await pool.query(
      "UPDATE training_enrollments SET hold_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [abandoned.id],
    );
    await paid.enrollmentCommand(learner.cookie, abandoned.id, cmd('REFRESH', abandoned.version));
    expect((await paid.enrollmentDetail(learner.cookie, abandoned.id)).state).toBe('EXPIRED');
  });
  it('normally completes delivered cohorts idempotently, unblocks the creator, and reopens on a later dispute', async () => {
    const creator = await user('completion-creator');
    await pool.query(
      "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_ADMIN')",
      [owner.org, creator.id],
    );
    const h = await shortCohort({ creator }),
      n = await confirmed(h),
      right = n.entitlements[0]!;
    const body = cmd('COMPLETE', h.version, { reason: '全部课次已履行且学员确认' });
    expect(await creatorBlocker(creator.id)).toBe(true);
    await expect(service.cohortCommand(other.cookie, h.id, body)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.cohortCommand(creator.cookie, h.id, body)).rejects.toMatchObject({
      code: 'TRAINING_COMPLETION_BLOCKED',
    });
    await deliver(right.sessionId);
    expect((await completionCapability(h.id)).canComplete).toBe(false);
    const consumptionId = await consume(n.id, right.id);
    expect((await completionCapability(h.id, creator)).canComplete).toBe(true);
    await expect(
      service.cohortCommand(
        creator.cookie,
        h.id,
        cmd('COMPLETE', h.version - 1, { reason: '陈旧班期版本不能结课' }),
      ),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const results = await Promise.all([
      service.cohortCommand(creator.cookie, h.id, body),
      service.cohortCommand(creator.cookie, h.id, body),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(
      (await pool.query('SELECT state,version FROM training_cohorts WHERE id=$1', [h.id])).rows[0],
    ).toEqual({ state: 'COMPLETED', version: h.version + 1 });
    expect(
      (
        await pool.query(
          'SELECT 1 FROM training_command_receipts WHERE actor_id=$1 AND command_id=$2',
          [creator.id, body.commandId],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT 1 FROM training_resource_reservations WHERE session_id=$1 AND active',
          [right.sessionId],
        )
      ).rowCount,
    ).toBe(0);
    expect(await creatorBlocker(creator.id)).toBe(false);
    await expect(
      service.cohortCommand(creator.cookie, h.id, { ...body, reason: '不同结课依据' }),
    ).rejects.toMatchObject({ code: 'COMMAND_ID_REUSED' });
    const dispute = cmd('DISPUTE', 3, { reason: '结课后发现课次消费有异议' });
    await service.consumptionCommand(learner.cookie, consumptionId, dispute);
    await service.consumptionCommand(learner.cookie, consumptionId, dispute);
    expect(
      (await pool.query('SELECT state,version FROM training_cohorts WHERE id=$1', [h.id])).rows[0],
    ).toEqual({ state: 'SUSPENDED', version: h.version + 2 });
    expect((await service.enrollmentDetail(learner.cookie, n.id)).state).toBe('CONFIRMED');
    expect(await creatorBlocker(creator.id)).toBe(true);
    await service.consumptionCommand(
      operator.cookie,
      consumptionId,
      cmd('RESOLVE_UPHOLD', 4, { reason: '独立重新核实实际授课' }),
    );
    const race = await Promise.allSettled([
      service.cohortCommand(
        creator.cookie,
        h.id,
        cmd('COMPLETE', h.version + 2, { reason: '争议已独立裁决，再次核验结课' }),
      ),
      service.consumptionCommand(
        learner.cookie,
        consumptionId,
        cmd('DISPUTE', 5, { reason: '提交新的异议证据待复核' }),
      ),
    ]);
    expect(race[1]!.status).toBe('fulfilled');
    expect(
      (await pool.query('SELECT state FROM training_cohorts WHERE id=$1', [h.id])).rows[0].state,
    ).toBe('SUSPENDED');
    expect(await creatorBlocker(creator.id)).toBe(true);
  });
  it('requires incoming and outgoing makeup rights, and reopens both completed cohorts on dispute', async () => {
    const original = await shortCohort(),
      target = await shortCohort({ delay: 6000 }),
      n = await confirmed(original),
      right = n.entitlements[0]!;
    await service.entitlementCommand(
      learner.cookie,
      right.id,
      cmd('LEAVE', right.version, { reason: '改到另一个班期补课' }),
    );
    await service.entitlementCommand(
      learner.cookie,
      right.id,
      cmd('MAKEUP', right.version + 1, { sessionId: target.sessions[0]!.id }),
    );
    await deliver(original.sessions[0]!.id);
    await deliver(target.sessions[0]!.id);
    for (const h of [original, target])
      await expect(
        service.cohortCommand(
          owner.cookie,
          h.id,
          cmd('COMPLETE', h.version, { reason: '检查跨班权益是否结清' }),
        ),
      ).rejects.toMatchObject({ code: 'TRAINING_COMPLETION_BLOCKED' });
    const consumption = await consume(n.id, right.id);
    for (const h of [original, target])
      await service.cohortCommand(
        owner.cookie,
        h.id,
        cmd('COMPLETE', h.version, { reason: '跨班课次已完成并确认' }),
      );
    await service.consumptionCommand(
      learner.cookie,
      consumption,
      cmd('DISPUTE', 3, { reason: '补课消费事实需再次核对' }),
    );
    expect(
      (
        await pool.query('SELECT state FROM training_cohorts WHERE id=ANY($1::uuid[])', [
          [original.id, target.id],
        ])
      ).rows.map((r) => r.state),
    ).toEqual(['SUSPENDED', 'SUSPENDED']);
    expect((await service.enrollmentDetail(learner.cookie, n.id)).state).toBe('CONFIRMED');
  });
  it('does not bind a completed incoming makeup to unrelated future lessons in its original cohort', async () => {
    const original = await shortCohort({ futureLesson: true }),
      target = await shortCohort({ delay: 6000 }),
      n = await confirmed(original);
    const right = n.entitlements.find((e) => e.sessionId === original.sessions[0]!.id)!;
    await service.entitlementCommand(
      learner.cookie,
      right.id,
      cmd('LEAVE', right.version, { reason: '仅本次改期补课' }),
    );
    await service.entitlementCommand(
      learner.cookie,
      right.id,
      cmd('MAKEUP', right.version + 1, { sessionId: target.sessions[0]!.id }),
    );
    await deliver(target.sessions[0]!.id);
    await consume(n.id, right.id);
    expect((await service.enrollmentDetail(learner.cookie, n.id)).state).toBe('CONFIRMED');
    await service.cohortCommand(
      owner.cookie,
      target.id,
      cmd('COMPLETE', target.version, { reason: '本班转入课次已履行' }),
    );
    await expect(
      service.cohortCommand(
        owner.cookie,
        original.id,
        cmd('COMPLETE', original.version, { reason: '原班还有未来课次' }),
      ),
    ).rejects.toMatchObject({ code: 'TRAINING_COMPLETION_BLOCKED' });
    expect(
      (
        await pool.query(
          'SELECT 1 FROM training_resource_reservations WHERE session_id=$1 AND active',
          [original.sessions[1]!.id],
        )
      ).rowCount,
    ).toBeGreaterThan(0);
  });
  it('blocks unresolved free refunds and permits precise unused cancellation without manufacturing consumption', async () => {
    const h = await shortCohort({ capacity: 2 }),
      n = await confirmed(h),
      neverConfirmed = await enroll(h, other),
      waiting = await enroll(h, coach, true);

    const refund = await service.requestRefund(owner.cookie, n.id, {
      commandId: randomUUID(),
      expectedVersion: n.version,
      entitlementIds: [n.entitlements[0]!.id],
      reason: '本人本次退课保留原始依据',
    });
    await deliver(h.sessions[0]!.id);
    await expect(
      service.cohortCommand(
        owner.cookie,
        h.id,
        cmd('COMPLETE', h.version, { reason: '尚有待批准退款' }),
      ),
    ).rejects.toMatchObject({ code: 'TRAINING_COMPLETION_BLOCKED' });
    expect((await service.enrollmentDetail(other.cookie, neverConfirmed.id)).state).toBe('HOLDING');
    expect((await service.enrollmentDetail(coach.cookie, waiting.id)).state).toBe('WAITLISTED');
    await service.refundCommand(
      reviewer.cookie,
      refund.allocationId,
      cmd('APPROVE', 1, { reason: '独立核准免费退课' }),
    );
    expect((await completionCapability(h.id)).canComplete).toBe(true);
    expect((await service.enrollmentDetail(coach.cookie, waiting.id)).state).toBe('WAITLISTED');
    await service.cohortCommand(
      owner.cookie,
      h.id,
      cmd('COMPLETE', h.version, { reason: '退款已完成，未确认报名已取消' }),
    );
    expect(
      (await service.enrollmentDetail(other.cookie, neverConfirmed.id)).entitlements[0]!.state,
    ).toBe('AVAILABLE');
    expect((await service.enrollmentDetail(learner.cookie, n.id)).entitlements[0]!.state).toBe(
      'REFUNDED',
    );
    expect((await service.enrollmentDetail(other.cookie, neverConfirmed.id)).state).toBe(
      'CANCELLED',
    );
    expect((await service.enrollmentDetail(coach.cookie, waiting.id)).state).toBe('CANCELLED');
  });
  it('completes a real paid source without inventing settlement, but blocks unknown payment facts', async () => {
    const payer = await user('completion-paid');
    const payments: TradePayments = {
      enabled: true,
      native: vi.fn(async () => ({
        codeUrl: 'weixin://wxpay/bizpayurl?pr=synthetic-complete',
      })),
      queryOrder: vi.fn(),
      refund: vi.fn(),
      queryRefund: vi.fn(),
      verifyNotification: vi.fn(),
      downloadBill: vi.fn(),
    };
    const trade = new TradeService(
      pool,
      options,
      {
        encryptionKey: Buffer.alloc(32, 7),
        merchants: {
          [owner.org]: {
            key: 'training-completion',
            merchantId: '1900000199',
            appId: 'wx1234567890abcdef',
            displayName: '合成培训结课商户',
            payments,
            receivers: {},
          },
        },
      },
      remainingSixTradeSources({ trainingEnabled: true }),
    );
    const paid = new TrainingService(pool, options, {
      enabled: true,
      trade: trainingTradeHooks(trade),
    });
    // Payment still needs the production minimum validity; no reduced gate or forged DB clock.
    const h = await shortCohort({ delay: 45000, totalFen: 101 });
    const created = await paid.enroll(payer.cookie, h.id, {
      commandId: randomUUID(),
      payerUserId: payer.id,
      learnerUserId: payer.id,
      adultConfirmed: true,
      acceptedTermsId: h.termsId,
      chargeConsent: true,
    });
    let n = await paid.enrollmentDetail(payer.cookie, created.enrollmentId);
    let order = await trade.get(payer.cookie, n.tradeOrderId!);
    await trade.pay(payer.cookie, order.id, {
      clientRequestId: randomUUID(),
      expectedVersion: order.version,
      channel: 'NATIVE',
    });
    const attempt = (
      await pool.query('SELECT * FROM trade_payment_attempts WHERE order_id=$1', [order.id])
    ).rows[0];
    vi.mocked(payments.queryOrder).mockResolvedValue({
      outTradeNo: attempt.out_trade_no,
      transactionId: 'COMPLETE' + attempt.id,
      state: 'SUCCESS',
      totalFen: 101,
      currency: 'CNY',
      successTime: new Date().toISOString(),
    });
    await trade.queryPayment(payer.cookie, order.id, attempt.id);
    await paid.enrollmentCommand(payer.cookie, n.id, cmd('CONFIRM', n.version));
    await deliver(h.sessions[0]!.id);
    const consumptionId = await consume(n.id, n.entitlements[0]!.id, payer);
    // Explicit anomaly fixture: a second unresolved provider attempt must never be ignored.
    const pending = randomUUID(),
      pendingNo = 'E4P' + pending.replaceAll('-', '').slice(0, 28);
    await pool.query(
      "INSERT INTO trade_payment_attempts(id,order_id,out_trade_no,channel,status,total_fen,fence,expires_at) VALUES($1,$2,$3,'NATIVE','UNKNOWN',101,$4,clock_timestamp()+interval '1 hour')",
      [pending, order.id, pendingNo, randomUUID()],
    );
    await expect(
      paid.cohortCommand(
        owner.cookie,
        h.id,
        cmd('COMPLETE', h.version, { reason: '尚有未知付款，必须先查原号' }),
      ),
    ).rejects.toMatchObject({ code: 'TRAINING_COMPLETION_BLOCKED' });
    vi.mocked(payments.queryOrder).mockResolvedValue({
      outTradeNo: pendingNo,
      transactionId: null,
      successTime: null,
      state: 'CLOSED',
      totalFen: 101,
      currency: 'CNY',
    });
    await trade.queryPayment(payer.cookie, order.id, pending);
    // Explicit contradictory terminal provider fixture; no production state is fabricated.
    await pool.query(
      'UPDATE trade_payment_attempts SET provider_transaction_id=$2,updated_at=clock_timestamp() WHERE id=$1',
      [pending, 'anomaly-' + pending],
    );
    await expect(
      paid.cohortCommand(
        owner.cookie,
        h.id,
        cmd('COMPLETE', h.version, { reason: '终态仍带渠道付款标记，需核对' }),
      ),
    ).rejects.toMatchObject({ code: 'TRAINING_COMPLETION_BLOCKED' });
    await pool.query(
      'UPDATE trade_payment_attempts SET provider_transaction_id=NULL,updated_at=clock_timestamp() WHERE id=$1',
      [pending],
    );
    await pool.query(
      "UPDATE trade_orders SET status='SOURCE_CONFLICT',version=version+1 WHERE id=$1",
      [order.id],
    );
    await expect(
      paid.cohortCommand(
        owner.cookie,
        h.id,
        cmd('COMPLETE', h.version, { reason: '正常已消费单仍有来源冲突' }),
      ),
    ).rejects.toMatchObject({ code: 'TRAINING_COMPLETION_BLOCKED' });
    await pool.query("UPDATE trade_orders SET status='OPEN',version=version+1 WHERE id=$1", [
      order.id,
    ]);
    await paid.cohortCommand(
      owner.cookie,
      h.id,
      cmd('COMPLETE', h.version, { reason: '正常履约完成，保留真实待结算收入' }),
    );
    order = await trade.get(payer.cookie, order.id);
    expect(order.paidFen).toBe(101);
    expect(order.refundedFen).toBe(0);
    expect(order.settlements).toHaveLength(0);
    const c = await pool.connect();
    try {
      await expect(trade.assertAccountClosureSafe(c, payer.id)).rejects.toMatchObject({
        code: 'TRADE_MONEY_UNRESOLVED',
      });
    } finally {
      c.release();
    }

    await paid.consumptionCommand(
      payer.cookie,
      consumptionId,
      cmd('DISPUTE', 3, { reason: '结课后核查消费需返还课次' }),
    );
    await paid.consumptionCommand(
      operator.cookie,
      consumptionId,
      cmd('RESOLVE_ADJUST', 4, { reason: '独立裁决返还本次课次权益' }),
    );
    n = await paid.enrollmentDetail(payer.cookie, n.id);
    const allocation = await paid.requestRefund(payer.cookie, n.id, {
      commandId: randomUUID(),
      expectedVersion: n.version,
      entitlementIds: [n.entitlements[0]!.id],
      reason: '按独立裁决逐课原路退款',
    });
    await paid.refundCommand(
      reviewer.cookie,
      allocation.allocationId,
      cmd('APPROVE', 1, { reason: '独立核对原课价和退款依据' }),
    );
    n = await paid.enrollmentDetail(payer.cookie, n.id);
    const refundId = n.refunds[0]!.trade_refund_id as string;
    order = await trade.get(operator.cookie, order.id);
    await trade.review(operator.cookie, order.id, 'REFUND', refundId, {
      clientRequestId: randomUUID(),
      expectedVersion: order.version,
      decision: 'APPROVE',
      reason: '独立审核统一账本退款',
    });
    vi.mocked(payments.refund).mockRejectedValue(
      Error('synthetic completion refund transport lost'),
    );
    order = await trade.get(owner.cookie, order.id);
    await expect(
      trade.dispatchRefund(owner.cookie, order.id, refundId, {
        clientRequestId: randomUUID(),
        expectedVersion: order.version,
      }),
    ).rejects.toThrow('synthetic');
    await paid.refundCommand(payer.cookie, allocation.allocationId, cmd('REFRESH', 2));
    const cohortVersion = h.version + 2;
    await expect(
      paid.cohortCommand(
        owner.cookie,
        h.id,
        cmd('COMPLETE', cohortVersion, { reason: '退款未知不能结课' }),
      ),
    ).rejects.toMatchObject({ code: 'TRAINING_COMPLETION_BLOCKED' });
    const refund = (await pool.query('SELECT * FROM trade_refunds WHERE id=$1', [refundId]))
      .rows[0];
    vi.mocked(payments.queryRefund).mockResolvedValue({
      outTradeNo: attempt.out_trade_no,
      outRefundNo: refund.out_refund_no,
      transactionId: 'COMPLETE' + attempt.id,
      refundId: 'R' + refund.id,
      state: 'SUCCESS',
      totalFen: 101,
      refundFen: 101,
      currency: 'CNY',
      createdTime: new Date().toISOString(),
      successTime: new Date().toISOString(),
    });
    await trade.queryRefund(payer.cookie, order.id, refundId);
    await paid.refundCommand(payer.cookie, allocation.allocationId, cmd('REFRESH', 3));
    n = await paid.enrollmentDetail(payer.cookie, n.id);
    expect(n.state).toBe('CANCELLED');
    expect(n.entitlements[0]!.state).toBe('REFUNDED');
    // Model a retained conflict marker without deleting or rewriting the confirmed refund history.
    await pool.query(
      "UPDATE trade_orders SET status='SOURCE_CONFLICT',version=version+1 WHERE id=$1",
      [order.id],
    );
    for (const anomaly of [
      'missing-binding',
      'partial-refund',
      'unknown-refund',
      'incoming-unknown-settlement',
      'incoming-unknown-return',
    ]) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const copyN = randomUUID(),
          copyE = randomUUID(),
          copyO = randomUUID(),
          copyP = randomUUID(),
          copyR = randomUUID(),
          copyA = randomUUID(),
          copyH = randomUUID(),
          copyS = randomUUID(),
          copyT = randomUUID();
        // Explicit rollback-only persisted anomaly, using INSERTs rather than altering frozen intent.
        // All copies are incoming makeup: their frozen original cohort/session differ from the target.
        await c.query(
          `INSERT INTO training_cohorts(id,org_id,course_id,court_id,title,address,capacity,total_fen,terms_id,terms_text,state,enrollment_deadline,created_by)
          SELECT $2,org_id,course_id,court_id,title,address,capacity,total_fen,$3,terms_text,'COMPLETED',enrollment_deadline,created_by FROM training_cohorts WHERE id=$1`,
          [h.id, copyH, copyT],
        );
        await c.query(
          `INSERT INTO training_sessions(id,org_id,cohort_id,starts_at,ends_at,buffer_minutes,price_weight,state,delivered_by,delivery_note,delivered_at)
          SELECT $2,org_id,$3,starts_at,ends_at,buffer_minutes,price_weight,state,delivered_by,delivery_note,delivered_at FROM training_sessions WHERE id=$1`,
          [n.entitlements[0]!.originalSessionId, copyS, copyH],
        );
        await c.query(
          `INSERT INTO training_enrollments(id,org_id,cohort_id,applicant_user_id,payer_user_id,learner_user_id,adult_confirmed,terms_id,terms_snapshot,total_fen,state)
          SELECT $2,org_id,$3::uuid,applicant_user_id,payer_user_id,learner_user_id,adult_confirmed,$4::uuid,
          jsonb_set(jsonb_set(jsonb_set(terms_snapshot,'{cohortId}',to_jsonb($3::uuid)),'{termsId}',to_jsonb($4::uuid)),'{lessons,0,id}',to_jsonb($5::uuid)),total_fen,'CANCELLED'
          FROM training_enrollments WHERE id=$1`,
          [n.id, copyN, copyH, copyT, copyS],
        );
        await c.query(
          `INSERT INTO training_lesson_entitlements(id,org_id,enrollment_id,original_session_id,current_session_id,net_fen,state)
          SELECT $2,org_id,$3,$4,current_session_id,net_fen,'REFUNDED' FROM training_lesson_entitlements WHERE id=$1`,
          [n.entitlements[0]!.id, copyE, copyN, copyS],
        );
        const identity = trainingTradeIdentity(
          (await c.query('SELECT * FROM training_enrollments WHERE id=$1', [copyN])).rows[0],
        );
        await c.query(
          `INSERT INTO trade_orders(id,org_id,kind,source_id,source_version,source_snapshot,source_hash,payer_user_id,beneficiary_user_id,terms_id,merchant_key,merchant_id,merchant_app_id,merchant_name,total_fen,currency,quote,status)
          SELECT $2,org_id,kind,$3,source_version,$4,$5,payer_user_id,beneficiary_user_id,terms_id,merchant_key,merchant_id,merchant_app_id,merchant_name,total_fen,currency,quote,'SOURCE_CONFLICT' FROM trade_orders WHERE id=$1`,
          [order.id, copyO, copyN, identity, tradeHash(identity)],
        );
        await c.query(
          'UPDATE training_enrollments SET trade_order_id=$2,version=version+1 WHERE id=$1',
          [copyN, copyO],
        );
        await c.query(
          `INSERT INTO trade_payment_attempts(id,order_id,out_trade_no,channel,status,total_fen,fence,expires_at,provider_transaction_id,paid_at)
          VALUES($1,$2,$3,'NATIVE','PAID',101,$4,clock_timestamp()+interval '1 hour',$5,clock_timestamp())`,
          [
            copyP,
            copyO,
            'CP' + copyP.replaceAll('-', '').slice(0, 28),
            randomUUID(),
            'synthetic-copy-' + copyP,
          ],
        );
        const status = anomaly === 'unknown-refund' ? 'UNKNOWN' : 'SUCCEEDED';
        await c.query(
          `INSERT INTO trade_refunds(id,order_id,payment_id,out_refund_no,amount_fen,reason,status,proposed_by,reviewed_by,provider_refund_id,success_at)
          VALUES($1,$2,$3,$4,$5,'合成持久异常回归',$6,$7,$8,CASE WHEN $6='SUCCEEDED' THEN $9 ELSE NULL END,CASE WHEN $6='SUCCEEDED' THEN clock_timestamp() ELSE NULL END)`,
          [
            copyR,
            copyO,
            copyP,
            'CR' + copyR,
            anomaly === 'partial-refund' ? 50 : 101,
            status,
            reviewer.id,
            operator.id,
            'synthetic-return-' + copyR,
          ],
        );
        await c.query(
          `INSERT INTO training_refund_allocations(id,org_id,enrollment_id,entitlement_ids,amount_fen,proposed_by,reviewed_by,reason,status,trade_refund_id)
          VALUES($1,$2,$3,$4,101,$5,$6,'合成缺陷证明夹具','SUCCEEDED',$7)`,
          [copyA, owner.org, copyN, [copyE], payer.id, reviewer.id, copyR],
        );
        if (anomaly !== 'missing-binding')
          await c.query(
            "INSERT INTO r6_trade_refund_bindings(kind,source_id,allocation_id,order_id,refund_id) VALUES('TRAINING_ENROLLMENT',$1,$2,$3,$4)",
            [copyN, copyA, copyO, copyR],
          );
        if (anomaly.startsWith('incoming-')) {
          const target = (await c.query('SELECT * FROM training_cohorts WHERE id=$1', [h.id]))
            .rows[0];
          expect(await trainingCohortCompletionBlocker(c, target)).toBeNull();
          const split = randomUUID(),
            isReturn = anomaly === 'incoming-unknown-return';
          await c.query(
            `INSERT INTO trade_settlements(id,order_id,payment_id,out_order_no,amount_fen,receiver_merchant_id,status,proposed_by,reviewed_by,provider_order_id,provider_detail_id,return_amount_fen)
            VALUES($1,$2,$3,$4,50,'synthetic-receiver',$5,$6,$7,$8,$9,$10)`,
            [
              split,
              copyO,
              copyP,
              'S' + split,
              isReturn ? 'RETURNED' : 'UNKNOWN',
              reviewer.id,
              operator.id,
              isReturn ? 'synthetic-split-' + split : null,
              isReturn ? 'synthetic-detail-' + split : null,
              isReturn ? 50 : 0,
            ],
          );
          if (isReturn) {
            // Historic split is already net-zero; a separate unresolved return must still be checked.
            const pendingReturn = randomUUID();
            await c.query(
              `INSERT INTO trade_settlement_returns(id,settlement_id,out_return_no,amount_fen,status,fence,created_by)
              VALUES($1,$2,$3,1,'UNKNOWN',$4,$5)`,
              [pendingReturn, split, 'SR' + pendingReturn, randomUUID(), operator.id],
            );
          }
          expect(await trainingCohortCompletionBlocker(c, target)).toBe(
            isReturn ? '仍有未决分账回退' : '仍有未决退款、扣减或结算，请在统一交易页核对',
          );
        }
        expect(
          await trainingCohortCompletionBlocker(
            c,
            (await c.query('SELECT * FROM training_cohorts WHERE id=$1', [h.id])).rows[0],
          ),
        ).not.toBeNull();
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
    }
    await paid.cohortCommand(
      owner.cookie,
      h.id,
      cmd('COMPLETE', cohortVersion, { reason: '全部课次真实全退，保留原冲突历史' }),
    );
    expect(
      (await pool.query('SELECT status FROM trade_orders WHERE id=$1', [order.id])).rows[0].status,
    ).toBe('SOURCE_CONFLICT');
    expect((await trade.get(payer.cookie, order.id)).refundedFen).toBe(101);
  }, 75000);
});
