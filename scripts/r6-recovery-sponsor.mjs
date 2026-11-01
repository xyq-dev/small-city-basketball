import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readSponsorTradeSource } from '../apps/api/dist/sponsor-commerce-source.js';
import { sponsorHash } from '../apps/api/dist/sponsor-commerce-domain.js';
import { tradeHash } from '../apps/api/dist/trade-domain.js';

const UUID = /^[a-f0-9-]{36}$/i;
const columns = {
  sponsor_beneficiaries: ['status', 'version'],
  sponsor_contracts: ['status', 'version', 'updated_at'],
  sponsor_orders: ['status', 'version', 'updated_at'],
  sponsor_deliveries: [],
  sponsor_settlement_batches: ['status', 'finish_status', 'fence', 'version', 'updated_at'],
  sponsor_settlement_items: [],
  sponsor_refund_plans: [],
  sponsor_refund_retries: [],
  sponsor_return_items: ['status', 'fence', 'updated_at'],
  sponsor_recovery_cases: [],
  sponsor_commerce_operations: [],
  trade_orders: ['status', 'version', 'updated_at'],
  trade_payment_attempts: [],
  trade_refunds: [],
  r6_trade_refund_bindings: [],
};
async function snapshot(readPool, saved) {
  const proof = {},
    mutable = {};
  for (const [table, ids] of Object.entries(saved.references)) {
    assert.ok(Object.hasOwn(columns, table));
    assert.ok(ids.length > 0 && ids.every((x) => UUID.test(x)));
    const key =
      table === 'sponsor_commerce_operations'
        ? 'command_id'
        : table === 'r6_trade_refund_bindings'
          ? 'allocation_id'
          : 'id';
    const result = (
      await readPool.query(
        `SELECT ${key} AS key,to_jsonb(r)-$2::text[] AS immutable,to_jsonb(r) AS full FROM ${table} r WHERE ${key}=ANY($1::uuid[]) ORDER BY ${key}`,
        [ids, columns[table]],
      )
    ).rows;
    assert.equal(
      result.length,
      ids.length,
      'Every linked synthetic sponsor row survives: ' + table,
    );
    proof[table] = result.map((r) => ({ key: r.key, hash: sponsorHash(r.immutable) }));
    mutable[table] = result.map((r) => ({
      key: r.key,
      ...Object.fromEntries(
        columns[table].filter((k) => k !== 'updated_at').map((k) => [k, r.full[k]]),
      ),
    }));
  }
  const relationships = (
    await readPool.query(
      `SELECT count(*)::integer AS n FROM sponsor_orders s JOIN sponsor_contracts c ON c.id=s.contract_id AND c.org_id=s.org_id JOIN sponsorship_campaigns campaign ON campaign.id=c.campaign_id AND campaign.org_id=c.org_id JOIN trade_orders t ON t.source_id=s.id AND t.kind='SPONSOR_ORDER' AND t.org_id=s.org_id JOIN trade_payment_attempts p ON p.order_id=t.id AND p.status='PAID' AND p.profit_sharing JOIN sponsor_settlement_batches b ON b.order_id=s.id AND b.trade_order_id=t.id AND b.payment_id=p.id JOIN sponsor_refund_plans plan ON plan.order_id=s.id AND plan.batch_id=b.id WHERE s.id=ANY($1::uuid[])`,
      [saved.references.sponsor_orders],
    )
  ).rows[0].n;
  assert.equal(
    relationships,
    2,
    'Recovery uses genuine owner contracts and canonical trade sources',
  );
  const sources = (
    await readPool.query(
      `SELECT s.id,s.contract_id,s.snapshot,s.merchant_id,s.merchant_app_id,t.source_snapshot,t.source_hash FROM sponsor_orders s JOIN trade_orders t ON t.source_id=s.id AND t.kind='SPONSOR_ORDER' WHERE s.id=ANY($1::uuid[]) ORDER BY s.id`,
      [saved.references.sponsor_orders],
    )
  ).rows;
  assert.equal(sources.length, 2, 'Both synthetic orders retain a canonical trade identity');
  for (const s of sources) {
    // Match readSponsorTradeSource's identity projection without its FOR UPDATE on the read-only fingerprint connection.
    const identity = {
      contractId: s.contract_id,
      snapshot: s.snapshot,
      merchantId: s.merchant_id,
      merchantAppId: s.merchant_app_id,
    };
    assert.deepEqual(
      s.source_snapshot,
      identity,
      'Common trade stores only the frozen source identity: ' + s.id,
    );
    assert.equal(
      s.source_hash,
      tradeHash(identity),
      'Common trade hash matches the current source identity: ' + s.id,
    );
  }
  const retryProof = (
    await readPool.query(
      `SELECT count(*)::integer AS n FROM sponsor_refund_retries x JOIN sponsor_refund_plans p ON p.id=x.plan_id AND p.order_id=x.order_id AND p.org_id=x.org_id JOIN trade_refunds old ON old.id=x.previous_refund_id AND old.id=p.trade_refund_id JOIN trade_refunds current ON current.id=x.trade_refund_id AND current.order_id=old.order_id AND current.payment_id=old.payment_id AND current.amount_fen=old.amount_fen JOIN r6_trade_refund_bindings b ON b.allocation_id=x.id AND b.refund_id=current.id AND b.source_id=x.order_id WHERE x.id=ANY($1::uuid[]) AND x.status='CLAIMED' AND old.status='FAILED' AND old.provider_refund_id IS NOT NULL AND current.status='UNKNOWN'`,
      [saved.references.sponsor_refund_retries],
    )
  ).rows[0].n;
  assert.equal(
    retryProof,
    1,
    'Explicit retry preserves the failed original, successful return and unknown replacement',
  );
  return { proof, mutable };
}
/** Explicit synthetic database fixtures only. No provider, transport, credential or real payment is invoked. */
export async function captureR6Sponsor(context) {
  const { runtimePool, readPool, state, registerSynthetic } = context;
  const db = (await readPool.query('SELECT current_database() AS name')).rows[0].name;
  assert.match(db, /^scb_test_[A-Za-z0-9_]+$/);
  const payer = await registerSynthetic('合成R6广告恢复广告主'),
    f1 = await registerSynthetic('合成R6广告恢复审核甲'),
    f2 = await registerSynthetic('合成R6广告恢复审核乙'),
    receiver = await registerSynthetic('合成R6广告恢复受益人');
  const owner = state.userId,
    org = state.orgId,
    beneficiaryOrg = randomUUID(),
    campaign = randomUUID(),
    beneficiary = randomUUID(),
    command = randomUUID();
  const saved = { references: Object.fromEntries(Object.keys(columns).map((k) => [k, []])) };
  const ref = (table, id) => {
    saved.references[table].push(id);
    return id;
  };
  const c = await runtimePool.connect();
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
      beneficiaryOrg,
      '合成R6广告恢复受益机构',
    ]);
    await c.query(
      "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
      [beneficiaryOrg, receiver.id],
    );
    for (const actor of [f1.id, f2.id])
      await c.query(
        "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_ADMIN')",
        [org, actor],
      );
    const region = (
      await c.query(
        "SELECT catalog_version,region_id FROM region_catalog_nodes WHERE level='COUNTY' ORDER BY region_id LIMIT 1",
      )
    ).rows[0];
    const start = new Date(Date.now() + 3600_000).toISOString(),
      end = new Date(Date.now() + 86400_000).toISOString(),
      merchantKey = 'synthetic-r6ads-' + randomUUID();
    await c.query(
      "INSERT INTO sponsorship_campaigns(id,org_id,region_catalog_version,region_id,brand,title,body,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,'合成恢复品牌','合成恢复广告','隔离恢复验证，不是真实广告或资金',$5,$6,$7)",
      [campaign, org, region.catalog_version, region.region_id, start, end, owner],
    );
    await c.query(
      "INSERT INTO sponsor_beneficiaries(id,org_id,beneficiary_org_id,merchant_id,display_name,authorization_version,evidence,expires_at,status,created_by,reviewed_by) VALUES($1,$2,$3,'1900000902','合成受益商户','synthetic-v1','合成回退授权证据',$4,'APPROVED',$5,$6)",
      [ref('sponsor_beneficiaries', beneficiary), org, beneficiaryOrg, end, f1.id, f2.id],
    );
    const shares = [
      {
        id: org,
        beneficiaryOrgId: org,
        merchantId: '1900000901',
        displayName: '合成原收款商户',
        basisPoints: 7000,
        retained: true,
        authorizationVersion: merchantKey,
      },
      {
        id: beneficiaryOrg,
        beneficiaryOrgId: beneficiaryOrg,
        merchantId: '1900000902',
        displayName: '合成受益商户',
        basisPoints: 3000,
        retained: false,
        authorizationVersion: 'synthetic-v1',
      },
    ];
    for (const failedReturn of [false, true]) {
      const contract = ref('sponsor_contracts', randomUUID()),
        order = ref('sponsor_orders', randomUUID()),
        trade = ref('trade_orders', randomUUID()),
        payment = ref('trade_payment_attempts', randomUUID()),
        batch = ref('sponsor_settlement_batches', randomUUID()),
        plan = ref('sponsor_refund_plans', randomUUID());
      const delivery = ref('sponsor_deliveries', randomUUID()),
        retained = ref('sponsor_settlement_items', randomUUID()),
        split = ref('sponsor_settlement_items', randomUUID()),
        returnId = ref('sponsor_return_items', randomUUID());
      const amount = failedReturn ? 500 : 1001,
        externalReturn = failedReturn ? 150 : 300,
        transaction = 'SYNTHETIC_R6_' + payment.replaceAll('-', ''),
        outOrderNo = 'SCBADS' + batch.replaceAll('-', '');
      await c.query(
        "INSERT INTO sponsor_contracts(id,org_id,campaign_id,payer_user_id,beneficiary_user_id,title,total_fen,allowed_fee_fen,terms,starts_at,ends_at,merchant_key,merchant_id,merchant_app_id,shares,status,created_by,reviewed_by,owner_signed_by,advertiser_signed_at,reviewed_at) VALUES($1,$2,$3,$4,$5,'合成恢复固定价合同',10003,0,'合成签署条款，仅隔离恢复断言',$6,$7,$8,'1900000901','syntheticApp',$9,'SIGNED',$5,$10,$5,clock_timestamp(),clock_timestamp())",
        [
          contract,
          org,
          campaign,
          payer.id,
          owner,
          start,
          end,
          merchantKey,
          JSON.stringify(shares),
          f1.id,
        ],
      );
      const frozen = {
        contractId: contract,
        contractHash: sponsorHash({ contract, shares }),
        shares,
        allowedFeeFen: 0,
        startsAt: start,
        endsAt: end,
        ownerSigner: owner,
        reviewer: f1.id,
        advertiserSignedAt: start,
      };
      await c.query(
        "INSERT INTO sponsor_orders(id,org_id,contract_id,payer_user_id,beneficiary_user_id,title,total_fen,merchant_key,merchant_id,merchant_app_id,terms,snapshot,status,verified_fee_fen,fee_evidence,fee_verified_by,accepted_at,created_by) VALUES($1,$2,$3,$4,$5,'合成恢复固定价订单',10003,$6,'1900000901','syntheticApp','合成签署条款，仅隔离恢复断言',$7,'ACCEPTED',0,'合成核验手续费为零',$8,clock_timestamp(),$4)",
        [order, org, contract, payer.id, owner, merchantKey, frozen, f1.id],
      );
      const source = await readSponsorTradeSource(c, order);
      await c.query(
        "INSERT INTO trade_orders(id,org_id,kind,source_id,source_version,source_snapshot,source_hash,payer_user_id,beneficiary_user_id,merchant_key,merchant_id,merchant_app_id,merchant_name,total_fen,quote) VALUES($1,$2,'SPONSOR_ORDER',$3,1,$4,$5,$6,$7,$8,'1900000901','syntheticApp','合成原收款商户',10003,$9)",
        [
          trade,
          org,
          order,
          source.identity,
          tradeHash(source.identity),
          payer.id,
          owner,
          merchantKey,
          { synthetic: true, sourceId: order, contractId: contract, totalFen: 10003 },
        ],
      );
      await c.query(
        "INSERT INTO trade_payment_attempts(id,order_id,out_trade_no,channel,status,total_fen,fence,expires_at,provider_transaction_id,paid_at,profit_sharing) VALUES($1,$2,$3,'NATIVE','PAID',10003,$4,$5,$6,clock_timestamp(),true)",
        [payment, trade, payment.replaceAll('-', ''), randomUUID(), end, transaction],
      );
      await c.query(
        "INSERT INTO sponsor_deliveries(id,org_id,order_id,evidence,created_by,status,reviewed_by,reviewed_at) VALUES($1,$2,$3,'合成交付验收证据',$4,'ACCEPTED',$5,clock_timestamp())",
        [delivery, org, order, owner, payer.id],
      );
      await c.query(
        "INSERT INTO sponsor_settlement_batches(id,org_id,order_id,trade_order_id,payment_id,transaction_id,out_order_no,pool_fen,source_hash,money_version,status,proposed_by,approvals,provider_order_id,finished,finish_status) VALUES($1,$2,$3,$4,$5,$6,$7,10003,$8,1,'SUCCEEDED',$9,$10,$11,$12,$13)",
        [
          batch,
          org,
          order,
          trade,
          payment,
          transaction,
          outOrderNo,
          sponsorHash(frozen),
          owner,
          [f1.id, f2.id],
          'SYNTHETIC_SPLIT_' + batch,
          !failedReturn,
          failedReturn ? 'PENDING' : 'SUCCEEDED',
        ],
      );
      await c.query(
        "INSERT INTO sponsor_settlement_items(id,org_id,batch_id,beneficiary_org_id,receiver_merchant_id,display_name,authorization_version,amount_fen,retained,status,provider_detail_id) VALUES($1,$2,$3,$4,'1900000901','合成原收款商户',$5,7002,true,'RETAINED',NULL),($6,$2,$3,$7,'1900000902','合成受益商户','synthetic-v1',3001,false,'SUCCEEDED',$8)",
        [
          retained,
          org,
          batch,
          org,
          merchantKey,
          split,
          beneficiaryOrg,
          'SYNTHETIC_DETAIL_' + split,
        ],
      );
      let refund = null;
      if (!failedReturn) {
        refund = ref('trade_refunds', randomUUID());
        await c.query(
          "INSERT INTO trade_refunds(id,order_id,payment_id,out_refund_no,amount_fen,reason,status,proposed_by,reviewed_by,fence,provider_refund_id) VALUES($1,$2,$3,$4,1001,'合成恢复未知退款结果','FAILED',$5,$6,$7,$8)",
          [
            refund,
            trade,
            payment,
            'SCBADSRF' + refund.replaceAll('-', ''),
            f1.id,
            f2.id,
            randomUUID(),
            'SYNTHETIC_CLOSED_' + refund,
          ],
        );
      }
      await c.query(
        'INSERT INTO sponsor_refund_plans(id,org_id,order_id,batch_id,amount_fen,pool_reduction_fen,reason,status,proposed_by,reviewed_by,trade_refund_id) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10)',
        [
          plan,
          org,
          order,
          batch,
          amount,
          '合成恢复退款义务与追偿独立',
          failedReturn ? 'RECOVERY_REQUIRED' : 'CLAIMED',
          payer.id,
          f1.id,
          refund,
        ],
      );
      await c.query(
        'INSERT INTO sponsor_return_items(id,org_id,refund_plan_id,settlement_item_id,amount_fen,out_return_no,status,provider_return_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          returnId,
          org,
          plan,
          split,
          externalReturn,
          'SCBADSR' + returnId.replaceAll('-', ''),
          failedReturn ? 'FAILED' : 'SUCCEEDED',
          'SYNTHETIC_RETURN_' + returnId,
        ],
      );
      const kept = ref('sponsor_return_items', randomUUID());
      await c.query(
        "INSERT INTO sponsor_return_items(id,org_id,refund_plan_id,settlement_item_id,amount_fen,out_return_no,status) VALUES($1,$2,$3,$4,$5,$6,'NOT_REQUIRED')",
        [kept, org, plan, retained, amount - externalReturn, 'SCBADSR' + kept.replaceAll('-', '')],
      );
      if (failedReturn) {
        const recovery = ref('sponsor_recovery_cases', randomUUID());
        await c.query(
          "INSERT INTO sponsor_recovery_cases(id,org_id,refund_plan_id,return_item_id,amount_fen,status) VALUES($1,$2,$3,$4,$5,'OPEN')",
          [recovery, org, plan, returnId, externalReturn],
        );
      } else {
        ref('r6_trade_refund_bindings', plan);
        await c.query(
          "INSERT INTO r6_trade_refund_bindings(kind,source_id,allocation_id,order_id,refund_id) VALUES('SPONSOR_ORDER',$1,$2,$3,$4)",
          [order, plan, trade, refund],
        );
        const retry = ref('sponsor_refund_retries', randomUUID()),
          replacement = ref('trade_refunds', randomUUID());
        await c.query(
          "INSERT INTO trade_refunds(id,order_id,payment_id,out_refund_no,amount_fen,reason,status,proposed_by,reviewed_by,fence) VALUES($1,$2,$3,$4,1001,'合成恢复替代退款未知结果','UNKNOWN',$5,$6,$7)",
          [
            replacement,
            trade,
            payment,
            'SCBADSRF' + replacement.replaceAll('-', ''),
            f1.id,
            f2.id,
            randomUUID(),
          ],
        );
        await c.query(
          "INSERT INTO sponsor_refund_retries(id,org_id,order_id,plan_id,previous_refund_id,status,evidence,proposed_by,reviewed_by,trade_refund_id) VALUES($1,$2,$3,$4,$5,'CLAIMED','合成渠道明确关闭后的独立审核恢复',$6,$7,$8)",
          [retry, org, order, plan, refund, f1.id, f2.id, replacement],
        );
        ref('r6_trade_refund_bindings', retry);
        await c.query(
          "INSERT INTO r6_trade_refund_bindings(kind,source_id,allocation_id,order_id,refund_id) VALUES('SPONSOR_ORDER',$1,$2,$3,$4)",
          [order, retry, trade, replacement],
        );
      }
    }
    await c.query(
      'INSERT INTO sponsor_commerce_operations(actor_id,command_id,request_hash,org_id,result) VALUES($1,$2,$3,$4,$5)',
      [
        owner,
        ref('sponsor_commerce_operations', command),
        sponsorHash({ synthetic: true, command }),
        org,
        { synthetic: true, orders: saved.references.sponsor_orders },
      ],
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  Object.assign(saved, await snapshot(readPool, saved));
  return saved;
}
export async function verifyR6Sponsor({ readPool, saved, quarantined = false }) {
  const current = await snapshot(readPool, saved);
  assert.deepEqual(
    current.proof,
    saved.proof,
    'All sponsor contracts, money amounts, original IDs, approvals and recovery obligations remain frozen',
  );
  if (!quarantined) {
    assert.deepEqual(current.mutable, saved.mutable);
    return;
  }
  for (const table of Object.keys(columns))
    for (let n = 0; n < current.mutable[table].length; n++) {
      const before = saved.mutable[table][n],
        after = current.mutable[table][n];
      if (table === 'sponsor_beneficiaries')
        assert.ok(['APPROVED', 'DISABLED'].includes(after.status));
      else if (table === 'trade_orders') {
        assert.equal(after.status, 'SOURCE_CONFLICT');
        assert.ok(after.version > before.version);
      } else if (table === 'sponsor_contracts' || table === 'sponsor_orders') {
        assert.equal(after.status, before.status);
        assert.ok(after.version >= before.version);
      } else if (table === 'sponsor_settlement_batches' || table === 'sponsor_return_items') {
        assert.equal(after.status, before.status === 'SENDING' ? 'UNKNOWN' : before.status);
        if ('finish_status' in before)
          assert.equal(
            after.finish_status,
            before.finish_status === 'SENDING' ? 'UNKNOWN' : before.finish_status,
          );
        if ('version' in before) assert.ok(after.version >= before.version);
      } else assert.deepEqual(after, before);
    }
}
