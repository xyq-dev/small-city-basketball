import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { TradeService } from '../apps/api/dist/trade-service.js';
import { RegistrationService } from '../apps/api/dist/registration-service.js';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const uuid = (v) => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v);
function references(saved) {
  for (const field of [
    'orgId',
    'eventId',
    'entryId',
    'termId',
    'orderId',
    'attemptId',
    'refundId',
    'deductionId',
    'settlementId',
    'returnId',
    'eventNoticeId',
  ])
    assert.ok(uuid(saved?.[field]), 'E04 requires its exact linked ' + field);
  for (const value of Object.values(saved.hashes ?? {})) assert.match(value, /^[a-f0-9]{64}$/);
}
async function snapshot(readPool, saved) {
  const row = (
    await readPool.query(
      `SELECT o.id,o.status,o.version,o.money_version::text,
      encode(sha256(convert_to((to_jsonb(o)-ARRAY['status','version','updated_at'])::text,'UTF8')),'hex') AS order_hash,
      t.status AS term_status,t.version AS term_version,
      encode(sha256(convert_to((to_jsonb(t)-ARRAY['status','version'])::text,'UTF8')),'hex') AS term_hash,
      p.status AS payment_status,p.total_fen,p.profit_sharing,p.checkout IS NULL AS checkout_absent,
      encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') AS payment_hash,
      f.status AS refund_status,f.amount_fen AS refund_reserved,
      encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') AS refund_hash,
      d.status AS deduction_status,encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex') AS deduction_hash,
      s.status AS settlement_status,s.amount_fen AS split_amount,s.return_amount_fen AS returned_amount,
      encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') AS settlement_hash,
      r.status AS return_status,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS return_hash,
      encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex') AS notice_hash,
      (SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(c) ORDER BY c.actor_id,c.command_id)::text,'UTF8')),'hex') FROM trade_operations c WHERE c.order_id=o.id) AS commands_hash,
      (SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'UTF8')),'hex') FROM trade_reconciliations c WHERE c.merchant_key=o.merchant_key) AS reconciliations_hash
     FROM trade_orders o JOIN trade_terms t ON t.id=o.terms_id
     JOIN trade_payment_attempts p ON p.id=$2 AND p.order_id=o.id
     JOIN trade_refunds f ON f.id=$3 AND f.order_id=o.id
     JOIN trade_deductions d ON d.id=$4 AND d.order_id=o.id
     JOIN trade_settlements s ON s.id=$5 AND s.order_id=o.id
     JOIN trade_settlement_returns r ON r.id=$6 AND r.settlement_id=s.id
     JOIN trade_provider_events e ON e.merchant_key=o.merchant_key AND e.event_id=$7
     WHERE o.id=$1`,
      [
        saved.orderId,
        saved.attemptId,
        saved.refundId,
        saved.deductionId,
        saved.settlementId,
        saved.returnId,
        saved.eventNoticeId,
      ],
    )
  ).rows;
  assert.equal(
    row.length,
    1,
    'All ten business money tables must retain their linked actual service records',
  );
  return row[0];
}
function hashes(r) {
  return Object.fromEntries(Object.entries(r).filter(([name]) => name.endsWith('_hash')));
}
/** Actual money orchestration with synthetic trusted channel facts; no official network or real funds. */
export async function captureExpansionTrade(c) {
  const { call, state, runtimePool, readPool, databaseUrl, appOrigin, registerSynthetic } = c;
  const payer = await registerSynthetic('合成恢复保证金需求方');
  const reviewer = state.commerce.operators[0];
  assert.ok(uuid(reviewer?.userId) && reviewer.cookie);
  const root = '/v1/orgs/' + state.orgId;
  const event = (
    await call(root + '/events', {
      method: 'POST',
      cookie: state.cookie,
      body: {
        name: '资金归档独立合成赛事-' + c.suffix,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
      },
    })
  ).data;
  let registration = (
    await call(`${root}/events/${event.id}/registration-rules`, {
      method: 'PUT',
      cookie: state.cookie,
      body: {
        expectedVersion: event.version,
        minPlayers: 1,
        maxPlayers: 2,
        zeroAndDoubleZeroDistinct: true,
        requireIdentity: false,
        requireInsurance: false,
        requireParticipantMaterials: false,
      },
    })
  ).data;
  registration = (
    await call(`${root}/events/${event.id}/registration-commands`, {
      method: 'POST',
      cookie: state.cookie,
      body: { type: 'OPEN_REGISTRATION', expectedVersion: registration.event.version },
    })
  ).data;
  const team = (
    await call(root + '/teams', {
      method: 'POST',
      cookie: state.cookie,
      body: { name: '资金恢复独立球队-' + c.suffix },
    })
  ).data;
  const invite = (
    await call(`${root}/teams/${team.id}/invitations`, {
      method: 'POST',
      cookie: state.cookie,
      body: { targetUserId: payer.id, expiresInHours: 1 },
    })
  ).data;
  await call('/v1/invitations/' + invite.invitation.id + '/accept', {
    method: 'POST',
    cookie: payer.cookie,
    body: { token: invite.token },
  });
  const merchantKey = 'recovery-' + randomUUID();
  const signedNoticeKey = randomBytes(32),
    channelOrders = new Map();
  let nativeCalls = 0,
    refundCalls = 0,
    splitCalls = 0,
    returnCalls = 0;
  const payments = {
    enabled: true,
    async native(input) {
      nativeCalls++;
      channelOrders.set(input.outTradeNo, { ...input, state: 'NOTPAY' });
      return { codeUrl: 'weixin://wxpay/bizpayurl?pr=synthetic-recovery' };
    },
    async queryOrder(id) {
      const p = channelOrders.get(id);
      assert.ok(p?.paid);
      return p.paid;
    },
    async refund() {
      refundCalls++;
      throw new Error('synthetic-recovery-refund-result-unknown');
    },
    async queryRefund() {
      throw new Error('This retained original refund remains UNKNOWN');
    },
    verifyNotification(raw, headers) {
      assert.equal(
        headers['x-synthetic-fixture-signature'],
        createHmac('sha256', signedNoticeKey).update(raw).digest('hex'),
      );
      return JSON.parse(raw.toString('utf8'));
    },
    async downloadBill(date) {
      const rows = [...channelOrders.values()]
        .filter((p) => p.paid)
        .map((p) => ({
          outTradeNo: p.paid.outTradeNo,
          transactionId: p.paid.transactionId,
          totalFen: p.paid.totalFen,
          tradeState: 'SUCCESS',
          outRefundNo: null,
          refundId: null,
          refundFen: null,
          refundState: null,
        }));
      return {
        date,
        hashType: 'SHA1',
        hashValue: 'a'.repeat(40),
        bodyHash: sha(JSON.stringify({ date, rows })),
        rows,
      };
    },
  };
  const settlementPort = {
    enabled: true,
    returnSupported: true,
    async split(i) {
      splitCalls++;
      return {
        transactionId: i.transactionId,
        outOrderNo: i.outOrderNo,
        orderId: 'S' + randomUUID(),
        state: 'FINISHED',
        receiver: {
          merchantId: i.receiverMerchantId,
          amountFen: i.amountFen,
          result: 'SUCCESS',
          detailId: 'D' + randomUUID(),
        },
      };
    },
    async query() {
      throw Error('No automatic query of a successful synthetic split');
    },
    async returnFunds() {
      returnCalls++;
      throw Error('synthetic-recovery-return-result-unknown');
    },
    async queryReturn(i) {
      return {
        outOrderNo: i.outOrderNo,
        outReturnNo: i.outReturnNo,
        returnId: 'R' + i.outReturnNo,
        merchantId: i.receiverMerchantId,
        amountFen: i.amountFen,
        state: 'SUCCESS',
      };
    },
  };
  const service = new TradeService(
    runtimePool,
    { databaseUrl, appOrigin },
    {
      encryptionKey: Buffer.alloc(32, 7),
      merchants: {
        [state.orgId]: {
          key: merchantKey,
          merchantId: '1900000101',
          appId: 'wx1234567890abcdef',
          displayName: '合成恢复业务商户',
          payments,
          receivers: {
            [state.userId]: { merchantId: '1900000102', displayName: '合成恢复履约接收方' },
          },
          settlements: settlementPort,
        },
      },
    },
  );
  const term = await service.createTerms(state.cookie, state.orgId, {
    clientRequestId: randomUUID(),
    kind: 'ENTRY_DEPOSIT',
    sourceId: event.id,
    amountFen: 1000,
    terms: '隔离合成保证金，赛后独立证据扣减与原路退款；本样本不发生真实资金',
  });
  await service.reviewTerms(reviewer.cookie, state.orgId, term.termsId, {
    clientRequestId: randomUUID(),
    expectedVersion: 1,
    decision: 'APPROVE',
    reason: '独立复核合成保证金条款',
  });
  const sourceService = new RegistrationService(runtimePool, { databaseUrl, appOrigin }, service);
  const entry = await sourceService.createEntry(payer.cookie, state.orgId, event.id, {
    teamId: team.id,
    acceptedTermsIds: { ENTRY_DEPOSIT: term.termsId },
    chargeConsent: true,
  });
  const source = await service.sourceOrder(payer.cookie, 'ENTRY_DEPOSIT', entry.id);
  assert.ok(uuid(source.orderId));
  const orderId = source.orderId;
  const version = async () => (await service.get(payer.cookie, orderId)).version;
  const payInput = {
    clientRequestId: randomUUID(),
    expectedVersion: await version(),
    channel: 'NATIVE',
  };
  await service.pay(payer.cookie, orderId, payInput);
  await service.pay(payer.cookie, orderId, payInput);
  assert.equal(nativeCalls, 1, 'Original payment receipt must not create a second channel request');
  const attempt = (
    await readPool.query('SELECT * FROM trade_payment_attempts WHERE order_id=$1', [orderId])
  ).rows[0];
  assert.equal(attempt.status, 'NOTPAY');
  assert.equal(attempt.profit_sharing, true);
  const paid = {
    outTradeNo: attempt.out_trade_no,
    transactionId: 'T' + randomUUID(),
    state: 'SUCCESS',
    totalFen: 1000,
    currency: 'CNY',
    successTime: new Date().toISOString(),
  };
  channelOrders.get(attempt.out_trade_no).paid = paid;
  const notice = { id: randomUUID(), kind: 'PAYMENT', payment: paid };
  const raw = Buffer.from(JSON.stringify(notice)),
    headers = {
      'x-synthetic-fixture-signature': createHmac('sha256', signedNoticeKey)
        .update(raw)
        .digest('hex'),
    };
  await service.notification(merchantKey, raw, headers);
  await service.notification(merchantKey, raw, headers);
  assert.equal((await service.get(payer.cookie, orderId)).paidFen, 1000);
  // The independent event is deliberately constructed as an already fulfilled
  // source. Sporting lifecycle completion is exercised by the parent harness;
  // this fixture does not pretend a payment callback completed a tournament.
  await runtimePool.query("UPDATE events SET status='COMPLETED',version=version+1 WHERE id=$1", [
    event.id,
  ]);
  const day = (
    await readPool.query(
      "SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS day",
    )
  ).rows[0].day;
  const reconciliation = await service.reconcile(state.cookie, state.orgId, {
    clientRequestId: randomUUID(),
    date: day,
  });
  assert.deepEqual(reconciliation.reconciliation.issues, []);
  const review = async (kind, id, decision) =>
    service.review(reviewer.cookie, orderId, kind, id, {
      clientRequestId: randomUUID(),
      expectedVersion: await version(),
      decision,
      reason: '独立复核隔离恢复合成资金证据',
    });
  const deduction = await service.proposeDeduction(state.cookie, orderId, {
    clientRequestId: randomUUID(),
    expectedVersion: await version(),
    amountFen: 100,
    reason: '合成履约证据支持扣减',
    evidenceReference: 'synthetic-recovery-evidence',
  });
  await review('DEDUCTION', deduction.deductionId, 'APPROVE');
  const settlement = await service.proposeSettlement(state.cookie, orderId, {
    clientRequestId: randomUUID(),
    expectedVersion: await version(),
  });
  await review('SETTLEMENT', settlement.settlementId, 'APPROVE');
  await service.dispatchSettlement(state.cookie, orderId, settlement.settlementId, {
    clientRequestId: randomUUID(),
    expectedVersion: await version(),
  });
  assert.equal(splitCalls, 1);
  assert.equal((await service.get(payer.cookie, orderId)).settledFen, 100);
  await review('DEDUCTION', deduction.deductionId, 'REVERSE');
  const returnInput = {
    clientRequestId: randomUUID(),
    expectedVersion: await version(),
    reason: '独立批准更正后回退原分账',
  };
  await assert.rejects(
    service.returnSettlement(state.cookie, orderId, settlement.settlementId, returnInput),
    /synthetic-recovery-return-result-unknown/,
  );
  await service.returnSettlement(state.cookie, orderId, settlement.settlementId, returnInput);
  assert.equal(
    returnCalls,
    1,
    'An unknown return may query the original number but must never be sent again',
  );
  await service.queryReturn(state.cookie, orderId, settlement.settlementId);
  await review('DEDUCTION', deduction.deductionId, 'REVERSE');
  assert.equal((await service.get(payer.cookie, orderId)).refundableFen, 1000);
  const refund = await service.requestRefund(payer.cookie, orderId, {
    clientRequestId: randomUUID(),
    expectedVersion: await version(),
    amountFen: 300,
    reason: '隔离合成部分原路退款请求',
  });
  await review('REFUND', refund.refundId, 'APPROVE');
  const refundInput = { clientRequestId: randomUUID(), expectedVersion: await version() };
  await assert.rejects(
    service.dispatchRefund(state.cookie, orderId, refund.refundId, refundInput),
    /synthetic-recovery-refund-result-unknown/,
  );
  await service.dispatchRefund(state.cookie, orderId, refund.refundId, refundInput);
  assert.equal(refundCalls, 1);
  const returnRow = (
    await readPool.query('SELECT id FROM trade_settlement_returns WHERE settlement_id=$1', [
      settlement.settlementId,
    ])
  ).rows[0];
  const saved = {
    orgId: state.orgId,
    eventId: event.id,
    entryId: entry.id,
    termId: term.termsId,
    orderId,
    attemptId: attempt.id,
    refundId: refund.refundId,
    deductionId: deduction.deductionId,
    settlementId: settlement.settlementId,
    returnId: returnRow.id,
    eventNoticeId: notice.id,
  };
  const proof = await snapshot(readPool, saved);
  assert.equal(proof.payment_status, 'PAID');
  assert.equal(proof.refund_status, 'UNKNOWN');
  assert.equal(proof.deduction_status, 'REVERSED');
  assert.equal(proof.settlement_status, 'RETURNED');
  assert.equal(proof.return_status, 'SUCCEEDED');
  assert.equal(proof.refund_reserved, 300);
  const result = { ...saved, hashes: hashes(proof), proof };
  references(result);
  return result;
}
export async function verifyExpansionTrade({ readPool, saved }) {
  references(saved);
  assert.deepEqual(
    await snapshot(readPool, saved),
    saved.proof,
    'Business quotes, original channel IDs, unknown refund reservation and successful return survive unchanged',
  );
}
export async function verifyExpansionTradeQuarantine({ readPool, saved }) {
  references(saved);
  const current = await snapshot(readPool, saved);
  assert.deepEqual(
    hashes(current),
    saved.hashes,
    'Quarantine must retain every original money observation and immutable claim identity',
  );
  for (const field of [
    'money_version',
    'payment_status',
    'total_fen',
    'profit_sharing',
    'refund_status',
    'refund_reserved',
    'deduction_status',
    'settlement_status',
    'split_amount',
    'returned_amount',
    'return_status',
  ])
    assert.equal(current[field], saved.proof[field]);
  assert.equal(current.status, 'SOURCE_CONFLICT');
  assert.equal(current.term_status, 'REVOKED');
  assert.ok(
    current.version > saved.proof.version && current.term_version > saved.proof.term_version,
  );
  assert.equal(current.checkout_absent, true);
}
