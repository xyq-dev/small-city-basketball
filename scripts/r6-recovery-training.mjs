import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TrainingService } from '../apps/api/dist/training-service.js';
import { TradeService } from '../apps/api/dist/trade-service.js';
import {
  remainingSixTradeSources,
  trainingTradeHooks,
} from '../apps/api/dist/remaining-six-trade.js';
const command = (action, expectedVersion, extra = {}) => ({
  commandId: randomUUID(),
  action,
  expectedVersion,
  ...extra,
});
const TABLES = [
  'training_providers',
  'training_coaches',
  'training_courses',
  'training_cohorts',
  'training_sessions',
  'training_session_coaches',
  'training_resource_reservations',
  'training_enrollments',
  'training_lesson_entitlements',
  'training_attendance',
  'training_consumptions',
  'training_refund_allocations',
  'training_guardian_grants',
  'training_command_receipts',
  'training_audit_events',
];
const QUARANTINE_FIELDS = {
  training_providers: ['status', 'version'],
  training_coaches: ['status', 'consented', 'version'],
  training_cohorts: ['state', 'version'],
  training_resource_reservations: ['active'],
  training_enrollments: ['state', 'version'],
  training_guardian_grants: ['state', 'epoch'],
};
async function snapshot(pool, p, quarantined = false) {
  const hashes = {},
    counts = {},
    stableHashes = {};
  for (const table of TABLES) {
    const condition =
        table === 'training_command_receipts' ? 'actor_id=ANY($1::uuid[])' : 'org_id=$1',
      value = table === 'training_command_receipts' ? p.actorIds : p.orgId;
    const r = (
      await pool.query(
        `SELECT count(*)::int AS count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') AS hash FROM ${table} t WHERE ${condition}`,
        [value],
      )
    ).rows[0];
    assert.ok(r.count > 0, 'nonempty ' + table);
    hashes[table] = r.hash;
    counts[table] = r.count;
    const stable = (
      await pool.query(
        `SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t)-$2::text[] ORDER BY (to_jsonb(t)-$2::text[])::text),'[]'::jsonb)::text,'UTF8')),'hex') AS hash FROM ${table} t WHERE ${condition}`,
        [value, QUARANTINE_FIELDS[table] || []],
      )
    ).rows[0];
    stableHashes[table] = stable.hash;
  }
  const linked = (
    await pool.query(
      `SELECT n.state AS enrollment_state,n.total_fen,o.kind,o.source_id,o.total_fen AS order_total,p.status AS payment_status,p.total_fen AS paid_fen,
 x.status AS consumption_state,e.state AS consumed_entitlement,r.status AS allocation_state,r.amount_fen AS refund_amount,r.trade_refund_id,f.status AS refund_state,f.amount_fen AS trade_refund_amount,
 (SELECT state FROM training_lesson_entitlements WHERE id=$8) AS refunded_entitlement,
 (SELECT state FROM training_guardian_grants WHERE id=$9) AS guardian_state,
 (SELECT count(*)::int FROM training_resource_reservations WHERE org_id=$10 AND active) AS active_resources
 FROM training_enrollments n JOIN trade_orders o ON o.id=n.trade_order_id JOIN trade_payment_attempts p ON p.order_id=o.id
 JOIN training_consumptions x ON x.id=$3 JOIN training_lesson_entitlements e ON e.id=x.entitlement_id
 JOIN training_refund_allocations r ON r.id=$4 AND r.enrollment_id=n.id JOIN trade_refunds f ON f.id=r.trade_refund_id AND f.order_id=o.id
 WHERE n.id=$1 AND o.id=$2 AND p.id=$5 AND f.id=$6 AND e.id=$7`,
      [
        p.enrollmentId,
        p.orderId,
        p.consumptionId,
        p.allocationId,
        p.paymentId,
        p.refundId,
        p.consumedEntitlementId,
        p.refundEntitlementId,
        p.guardianGrantId,
        p.orgId,
      ],
    )
  ).rows[0];
  assert.ok(linked, 'canonical training/payment/refund linkage');
  assert.equal(linked.kind, 'TRAINING_ENROLLMENT');
  assert.equal(linked.source_id, p.enrollmentId);
  assert.equal(linked.paid_fen, 201);
  assert.equal(linked.payment_status, 'PAID');
  assert.equal(linked.consumption_state, 'FINALIZED');
  assert.equal(linked.consumed_entitlement, 'CONSUMED');
  assert.equal(linked.refunded_entitlement, 'REFUND_PENDING');
  assert.equal(linked.allocation_state, 'UNKNOWN');
  assert.equal(linked.refund_state, 'UNKNOWN');
  assert.equal(linked.refund_amount, 100);
  assert.equal(linked.trade_refund_amount, 100);
  assert.equal(linked.guardian_state, 'REVOKED');
  if (quarantined) assert.equal(linked.active_resources, 0);
  else assert.ok(linked.active_resources > 0);
  return { hashes, counts, stableHashes, linked };
}
/** Isolated acceptance only. Runtime ACL writes, real domain and trade services; provider transport is synthetic. */
export async function captureR6Training(context) {
  const { runtimePool, readPool, state, databaseUrl, appOrigin, registerSynthetic, suffix } =
    context;
  const database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  assert.match(database, /^scb_test_[A-Za-z0-9_]+$/);
  assert.equal(
    (await runtimePool.query('SELECT current_database() AS name')).rows[0].name,
    database,
  );
  const reviewer = state.commerce.operators[0];
  assert.ok(reviewer?.cookie && reviewer.userId);
  const coach = await registerSynthetic('合成培训恢复教练'),
    learner = await registerSynthetic('合成培训恢复学员'),
    admin = await registerSynthetic('合成培训独立复核员');
  const coachUser = coach.userId || coach.id,
    learnerUser = learner.userId || learner.id,
    adminUser = admin.userId || admin.id;
  await runtimePool.query(
    "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_ADMIN')",
    [state.orgId, adminUser],
  );
  const courtId = randomUUID();
  await runtimePool.query('INSERT INTO courts(id,org_id,name) VALUES($1,$2,$3)', [
    courtId,
    state.orgId,
    '合成培训恢复场地-' + suffix,
  ]);
  let attempt;
  const payments = {
    enabled: true,
    async native() {
      return { codeUrl: 'weixin://wxpay/bizpayurl?pr=synthetic-r6-recovery' };
    },
    async queryOrder() {
      return {
        outTradeNo: attempt.out_trade_no,
        transactionId: 'TR6' + attempt.id,
        state: 'SUCCESS',
        totalFen: 201,
        currency: 'CNY',
        successTime: new Date().toISOString(),
      };
    },
    async refund() {
      throw Error('synthetic training refund outcome unknown');
    },
    async queryRefund() {
      throw Error('synthetic pending provider reconciliation');
    },
    verifyNotification() {
      throw Error('no external notification in recovery fixture');
    },
    async downloadBill() {
      throw Error('no external bill in recovery fixture');
    },
  };
  const options = { databaseUrl, appOrigin };
  const trade = new TradeService(
    runtimePool,
    options,
    {
      encryptionKey: Buffer.alloc(32, 19),
      merchants: {
        [state.orgId]: {
          key: 'r6-training-recovery-' + suffix,
          merchantId: '1900000199',
          appId: 'wx1234567890abcdef',
          displayName: '合成培训恢复商户',
          payments,
          receivers: {},
        },
      },
    },
    remainingSixTradeSources({ trainingEnabled: true }),
  );
  const training = new TrainingService(runtimePool, options, {
    enabled: true,
    trade: trainingTradeHooks(trade),
  });
  const start = new Date(Date.now() + 370 * 86400000),
    until = new Date(start.getTime() + 365 * 86400000).toISOString();
  await training.registerProvider(state.cookie, state.orgId, {
    commandId: randomUUID(),
    name: '合成培训恢复主体',
    evidenceReference: 'synthetic-recovery-provider',
    qualifiedUntil: until,
  });
  await training.providerCommand(
    reviewer.cookie,
    state.orgId,
    command('APPROVE', 1, { reason: '隔离恢复合成资格独立核验' }),
  );
  const coachId = (
    await training.addCoach(state.cookie, state.orgId, {
      commandId: randomUUID(),
      userId: coachUser,
      displayName: '合成恢复教练',
      evidenceReference: 'synthetic-recovery-coach',
      qualifiedUntil: until,
    })
  ).coachId;
  await training.coachCommand(coach.cookie, coachId, command('CONSENT', 1));
  await training.coachCommand(
    admin.cookie,
    coachId,
    command('APPROVE', 2, { reason: '独立核验合成教练资格' }),
  );
  const courseId = (
    await training.createCourse(state.cookie, state.orgId, {
      commandId: randomUUID(),
      title: '合成成人恢复短班',
      description: '真实服务与账本路径，只有渠道transport为隔离合成实现',
    })
  ).courseId;
  const sessions = [0, 1].map((i) => ({
    startsAt: new Date(start.getTime() + i * 86400000).toISOString(),
    endsAt: new Date(start.getTime() + i * 86400000 + 3600000).toISOString(),
    coachIds: [coachId],
    priceWeight: 1,
    bufferMinutes: 15,
  }));
  const cohortId = (
    await training.createCohort(state.cookie, state.orgId, {
      commandId: randomUUID(),
      courseId,
      courtId,
      title: '合成培训恢复班期',
      address: '隔离测试场地',
      capacity: 3,
      totalFen: 201,
      termsText: '每课按冻结净额核对；未消费课次可经独立审核原路退回。',
      enrollmentDeadline: new Date(start.getTime() - 3600000).toISOString(),
      sessions,
    })
  ).cohortId;
  await training.cohortCommand(state.cookie, cohortId, command('PUBLISH', 1));
  const cohort = await training.detail(cohortId);
  const enrollmentId = (
    await training.enroll(learner.cookie, cohortId, {
      commandId: randomUUID(),
      payerUserId: learnerUser,
      learnerUserId: learnerUser,
      adultConfirmed: true,
      acceptedTermsId: cohort.termsId,
      chargeConsent: true,
    })
  ).enrollmentId;
  let n = await training.enrollmentDetail(learner.cookie, enrollmentId);
  const orderId = n.tradeOrderId;
  assert.ok(orderId);
  let order = await trade.get(learner.cookie, orderId);
  await trade.pay(learner.cookie, orderId, {
    clientRequestId: randomUUID(),
    expectedVersion: order.version,
    channel: 'NATIVE',
  });
  attempt = (
    await readPool.query('SELECT * FROM trade_payment_attempts WHERE order_id=$1', [orderId])
  ).rows[0];
  await trade.queryPayment(learner.cookie, orderId, attempt.id);
  await training.enrollmentCommand(learner.cookie, enrollmentId, command('CONFIRM', n.version));
  n = await training.enrollmentDetail(learner.cookie, enrollmentId);
  const first = n.entitlements.find((e) => e.sessionId === cohort.sessions[0].id),
    second = n.entitlements.find((e) => e.sessionId === cohort.sessions[1].id);
  assert.ok(first && second);
  assert.equal(first.netFen, 101);
  assert.equal(second.netFen, 100);
  // Explicit isolated time advancement for a past lesson; this is not a public reschedule operation.
  await runtimePool.query(
    "UPDATE training_sessions SET starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
    [first.sessionId],
  );
  await training.entitlementCommand(coach.cookie, first.id, command('CHECKIN', first.version));
  await training.sessionCommand(
    coach.cookie,
    first.sessionId,
    command('DELIVER', 1, { reason: '隔离验收记录实际授课事实' }),
  );
  n = await training.enrollmentDetail(learner.cookie, enrollmentId);
  const current = n.entitlements.find((e) => e.id === first.id);
  const consumptionId = (
    await training.entitlementCommand(
      coach.cookie,
      first.id,
      command('PROPOSE_CONSUMPTION', current.version, { reason: '核对签到与授课后提出消费' }),
    )
  ).consumptionId;
  await training.consumptionCommand(
    admin.cookie,
    consumptionId,
    command('REVIEW', 1, { reason: '独立复核课次事实' }),
  );
  await training.consumptionCommand(learner.cookie, consumptionId, command('ACKNOWLEDGE', 2));
  n = await training.enrollmentDetail(learner.cookie, enrollmentId);
  const allocationId = (
    await training.requestRefund(learner.cookie, enrollmentId, {
      commandId: randomUUID(),
      expectedVersion: n.version,
      entitlementIds: [second.id],
      reason: '未消费第二课次申请原路退款',
    })
  ).allocationId;
  await training.refundCommand(
    admin.cookie,
    allocationId,
    command('APPROVE', 1, { reason: '独立复核未消费课次净额' }),
  );
  n = await training.enrollmentDetail(learner.cookie, enrollmentId);
  const refundId = n.refunds.find((x) => x.id === allocationId).trade_refund_id;
  assert.ok(refundId);
  order = await trade.get(reviewer.cookie, orderId);
  await trade.review(reviewer.cookie, orderId, 'REFUND', refundId, {
    clientRequestId: randomUUID(),
    expectedVersion: order.version,
    decision: 'APPROVE',
    reason: '独立核对统一交易退款',
  });
  order = await trade.get(state.cookie, orderId);
  await assert.rejects(
    trade.dispatchRefund(state.cookie, orderId, refundId, {
      clientRequestId: randomUUID(),
      expectedVersion: order.version,
    }),
    /synthetic training refund/,
  );
  await training.refundCommand(learner.cookie, allocationId, command('REFRESH', 2));
  const guardianGrantId = randomUUID();
  await runtimePool.query(
    "INSERT INTO training_guardian_grants(id,org_id,cohort_id,policy_version,learner_user_id,guardian_user_id,purpose,evidence_reference,reviewed_by,valid_until,state,epoch) VALUES($1,$2,$3,'synthetic-revoked-history-v1',$4,$5,'NECESSARY_DATA','synthetic-revoked-scope-history',$6,$7,'REVOKED',2)",
    [guardianGrantId, state.orgId, cohortId, learnerUser, coachUser, reviewer.userId, until],
  );
  const proof = {
    orgId: state.orgId,
    actorIds: [state.userId, coachUser, learnerUser, adminUser, reviewer.userId],
    courtId,
    coachId,
    courseId,
    cohortId,
    enrollmentId,
    orderId,
    paymentId: attempt.id,
    consumptionId,
    allocationId,
    refundId,
    consumedEntitlementId: first.id,
    refundEntitlementId: second.id,
    guardianGrantId,
    learnerId: learnerUser,
    guardianId: coachUser,
    youthEnrollmentEnabled: false,
    fixtureKind: 'ISOLATED_SYNTHETIC_PROVIDER_TRANSPORT',
  };
  proof.snapshot = await snapshot(readPool, proof);
  return { proof, courtIds: [courtId] };
}
/** Restore verification is read-only and confirms that quarantine never turns unknown money into success. */
export async function verifyR6Training({ readPool, saved, quarantined }) {
  const proof = saved.proof || saved;
  assert.ok(proof?.snapshot);
  assert.equal(typeof quarantined, 'boolean');
  const current = await snapshot(readPool, proof, quarantined);
  if (!quarantined) assert.deepEqual(current, proof.snapshot);
  else {
    assert.deepEqual(current.counts, proof.snapshot.counts);
    assert.deepEqual(current.stableHashes, proof.snapshot.stableHashes);
    const { active_resources: beforeActive, ...before } = proof.snapshot.linked,
      { active_resources: afterActive, ...after } = current.linked;
    assert.deepEqual(after, before);
    assert.ok(beforeActive > 0);
    assert.equal(afterActive, 0);
    for (const [table, condition] of [
      ['training_providers', "status IN('APPROVED','PENDING')"],
      ['training_coaches', "status IN('APPROVED','PENDING') OR consented"],
      ['training_cohorts', "state IN('DRAFT','ENROLLING','RUNNING')"],
      ['training_enrollments', "state IN('HOLDING','WAITLISTED')"],
      ['training_guardian_grants', "state IN('PENDING','APPROVED')"],
    ])
      assert.equal(
        (
          await readPool.query(`SELECT 1 FROM ${table} WHERE org_id=$1 AND (${condition})`, [
            proof.orgId,
          ])
        ).rowCount,
        0,
      );
  }
  const active = (
    await readPool.query(
      "SELECT 1 FROM training_guardian_grants WHERE id=$1 AND org_id=$2 AND cohort_id=$3 AND state='APPROVED' AND valid_until>clock_timestamp()",
      [proof.guardianGrantId, proof.orgId, proof.cohortId],
    )
  ).rowCount;
  assert.equal(active, 0);
  return {
    tables: TABLES.length,
    allNonempty: true,
    unknownRefundPreserved: true,
    confirmedConsumptionPreserved: true,
    guardianAuthorizationRevoked: true,
    quarantined,
  };
}
