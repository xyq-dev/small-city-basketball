import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/database/migrate.js';
import { ApplicationService } from '../src/service.js';
import { TrainingService } from '../src/training-service.js';
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
async function cohort(capacity = 2, totalFen = 0, extra: Record<string, unknown> = {}) {
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
  const created = await service.createCohort(owner.cookie, owner.org, v);
  await service.cohortCommand(owner.cookie, created.cohortId, cmd('PUBLISH', 1));
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
});
afterAll(() => pool.end());
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
    const r = await service.requestRefund(learner.cookie, n.id, {
      commandId: randomUUID(),
      expectedVersion: current.version,
      entitlementIds: [e.id],
      reason: '申请退回未消费课次',
    });
    await expect(
      service.refundCommand(
        learner.cookie,
        r.allocationId,
        cmd('APPROVE', 1, { reason: '不能自己批准' }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await service.refundCommand(
      reviewer.cookie,
      r.allocationId,
      cmd('APPROVE', 1, { reason: '独立确认免费课退课' }),
    );
    const end = await service.enrollmentDetail(learner.cookie, n.id);
    expect(end.state).toBe('CANCELLED');
    expect(end.refunds[0]!.status).toBe('COMPLETED_ZERO');
    expect(end.refunds[0]!.trade_refund_id).toBeNull();
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
});
