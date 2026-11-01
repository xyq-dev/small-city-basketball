/** Real PostgreSQL retained obligations. Synthetic rows, no provider I/O or production data. */
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { migrate } from '../src/database/migrate.js';
import { createAccountClosureHooks } from '../src/account-closure-hooks.js';
import { hashPassword } from '../src/security.js';
import {
  readRemainingSixClosureOrgs,
  lockRemainingSixClosure,
  readRemainingSixClosureBlockers,
  revokeRemainingSixPrivacy,
} from '../src/remaining-six-privacy.js';
import { testDatabaseUrl } from './support.js';
const pool = new Pool({ connectionString: testDatabaseUrl(), max: 4 });
let c: PoolClient,
  user: string,
  owner: string,
  reviewer: string,
  org: string,
  region: { catalog_version: string; region_id: string };
const id = () => randomUUID();
let syntheticPasswordHash: string;
const hooks = createAccountClosureHooks({
  streaming: { inspect: async () => [], revoke: async () => {} },
  insurance: { inspect: async () => [], revoke: async () => {} },
  trade: { assertSafe: async () => {} },
  notifications: { revoke: async () => {} },
  guardians: { revoke: async () => {} },
  remainingSix: {
    orgScopes: readRemainingSixClosureOrgs,
    lock: lockRemainingSixClosure,
    inspect: readRemainingSixClosureBlockers,
    revoke: revokeRemainingSixPrivacy,
  },
})!;
beforeAll(async () => {
  await migrate(pool);
  // Generated solely for these rollback-only synthetic users; no real credential.
  syntheticPasswordHash = await hashPassword(`r6-closure-synthetic-${randomUUID()}`);
}, 120000);
afterAll(() => pool.end());
beforeEach(async () => {
  c = await pool.connect();
  await c.query('BEGIN');
  [user, owner, reviewer, org] = [id(), id(), id(), id()];
  for (const uid of [user, owner, reviewer])
    await c.query(
      "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'合成注销主体',$3)",
      [uid, `r6closure-${uid}@example.test`, syntheticPasswordHash],
    );
  await c.query("INSERT INTO organizations(id,name) VALUES($1,'合成R6注销机构')", [org]);
  await c.query('INSERT INTO org_schedule_mutex(org_id) VALUES($1)', [org]);
  region = (
    await c.query(
      "SELECT catalog_version,region_id FROM region_catalog_nodes WHERE level='COUNTY' ORDER BY region_id LIMIT 1",
    )
  ).rows[0];
  await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user]);
});
afterEach(async () => {
  if (c) {
    await c.query('ROLLBACK');
    c.release();
  }
});
async function inspect() {
  return hooks.lockAndInspect(c, user);
}
async function training() {
  const course = id(),
    court = id(),
    cohort = id(),
    session = id(),
    enrollment = id();
  await c.query(
    "INSERT INTO training_providers(org_id,name,evidence_reference,qualified_until,created_by) VALUES($1,'合成培训','synthetic-only',clock_timestamp()+interval '30 days',$2)",
    [org, owner],
  );
  await c.query("INSERT INTO courts(id,org_id,name) VALUES($1,$2,'合成训练场')", [court, org]);
  await c.query(
    "INSERT INTO training_courses(id,org_id,title,description,created_by) VALUES($1,$2,'合成课','合成说明',$3)",
    [course, org, owner],
  );
  await c.query(
    "INSERT INTO training_cohorts(id,org_id,course_id,court_id,title,address,capacity,total_fen,terms_id,terms_text,state,enrollment_deadline,created_by) VALUES($1,$2,$3,$4,'合成班','合成地址',2,100,$5,'合成条款','ENROLLING',clock_timestamp()+interval '1 day',$6)",
    [cohort, org, course, court, id(), owner],
  );
  await c.query(
    "INSERT INTO training_sessions(id,org_id,cohort_id,starts_at,ends_at,price_weight) VALUES($1,$2,$3,clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour',1)",
    [session, org, cohort],
  );
  await c.query(
    "INSERT INTO training_enrollments(id,org_id,cohort_id,applicant_user_id,payer_user_id,learner_user_id,adult_confirmed,terms_id,terms_snapshot,total_fen,state) VALUES($1,$2,$3,$4,$4,$4,true,$5,'{}',100,'WAITLISTED')",
    [enrollment, org, cohort, user, id()],
  );
  return { course, court, cohort, session, enrollment };
}
describe('R6 mandatory closure scopes, obligations and privacy on PostgreSQL', () => {
  test('training waitlist, unused lessons and uncertain refunds block independently of the common trade hook', async () => {
    const t = await training();
    expect(await readRemainingSixClosureOrgs(c, user)).toContain(org);
    expect(await inspect()).toContain('TRAINING_SERVICE_UNRESOLVED');
    await c.query("UPDATE training_enrollments SET state='CANCELLED' WHERE id=$1", [t.enrollment]);
    expect(await inspect()).toEqual([]);
    const entitlement = id();
    await c.query(
      "INSERT INTO training_lesson_entitlements(id,org_id,enrollment_id,original_session_id,current_session_id,net_fen,state) VALUES($1,$2,$3,$4,$4,100,'MAKEUP_DUE')",
      [entitlement, org, t.enrollment, t.session],
    );
    expect(await inspect()).toContain('TRAINING_SERVICE_UNRESOLVED');
    await c.query("UPDATE training_lesson_entitlements SET state='REFUNDED' WHERE id=$1", [
      entitlement,
    ]);
    const refund = id();
    await c.query(
      "INSERT INTO training_refund_allocations(id,org_id,enrollment_id,entitlement_ids,amount_fen,proposed_by,reviewed_by,reason,status) VALUES($1,$2,$3,$4::uuid[],100,$5,$6,'合成不确定退款','UNKNOWN')",
      [refund, org, t.enrollment, [entitlement], owner, reviewer],
    );
    expect(await inspect()).toContain('TRAINING_MONEY_UNRESOLVED');
    await c.query("UPDATE training_refund_allocations SET status='FAILED' WHERE id=$1", [refund]);
    await c.query("UPDATE training_lesson_entitlements SET state='MAKEUP_DUE' WHERE id=$1", [
      entitlement,
    ]);
    expect(await inspect()).toEqual(['TRAINING_SERVICE_UNRESOLVED']);
    // A new approved refund may finish later; the immutable old failure must not
    // become a permanent obligation after all lesson and actual money facts settle.
    await c.query(
      "INSERT INTO training_refund_allocations(id,org_id,enrollment_id,entitlement_ids,amount_fen,proposed_by,reviewed_by,reason,status) VALUES($1,$2,$3,$4::uuid[],100,$5,$6,'合成已确认退款','SUCCEEDED')",
      [id(), org, t.enrollment, [entitlement], owner, reviewer],
    );
    await c.query("UPDATE training_lesson_entitlements SET state='REFUNDED' WHERE id=$1", [
      entitlement,
    ]);
    expect(await inspect()).toEqual([]);
    expect(
      (await c.query('SELECT status FROM training_refund_allocations WHERE id=$1', [refund]))
        .rows[0].status,
    ).toBe('FAILED');
  });
  test('pending coach delivery blocks closure; completed withdrawal retains coach and guardian evidence', async () => {
    const t = await training(),
      coach = id(),
      grant = id();
    await c.query("UPDATE training_enrollments SET state='CANCELLED' WHERE id=$1", [t.enrollment]);
    await c.query(
      "INSERT INTO training_coaches(id,org_id,user_id,display_name,evidence_reference,qualified_until,consented,status,created_by,reviewed_by) VALUES($1,$2,$3,'合成教练','synthetic-coach',clock_timestamp()+interval '30 days',true,'APPROVED',$4,$5)",
      [coach, org, user, owner, reviewer],
    );
    await c.query(
      'INSERT INTO training_session_coaches(session_id,org_id,coach_id) VALUES($1,$2,$3)',
      [t.session, org, coach],
    );
    expect(await inspect()).toContain('TRAINING_SERVICE_UNRESOLVED');
    await c.query("UPDATE training_sessions SET state='CANCELLED' WHERE id=$1", [t.session]);
    await c.query(
      "INSERT INTO training_guardian_grants(id,org_id,cohort_id,learner_user_id,guardian_user_id,purpose,evidence_reference,valid_until,policy_version) VALUES($1,$2,$3,$4,$5,'PUBLICITY','synthetic-publicity',clock_timestamp()+interval '1 day','synthetic-policy')",
      [grant, org, t.cohort, user, owner],
    );
    expect(await inspect()).toEqual([]);
    await hooks.revoke(c, user, id());
    expect(
      (
        await c.query(
          'SELECT consented,status,evidence_reference FROM training_coaches WHERE id=$1',
          [coach],
        )
      ).rows[0],
    ).toEqual({ consented: false, status: 'SUSPENDED', evidence_reference: 'synthetic-coach' });
    expect(
      (
        await c.query(
          'SELECT state,epoch,evidence_reference FROM training_guardian_grants WHERE id=$1',
          [grant],
        )
      ).rows[0],
    ).toEqual({ state: 'REVOKED', epoch: 2, evidence_reference: 'synthetic-publicity' });
  });
  test('another writer holding matching contact consent causes NOWAIT retry rather than closing across it', async () => {
    const source = id(),
      other = await pool.connect();
    await c.query(
      "INSERT INTO matching_supply_preferences(source_kind,source_id,owner_id,org_id,region_catalog_version,region_id,allowed_region_ids,discovery_enabled,contact_enabled,adult_confirmed,availability) VALUES('STAFF_SERVICE',$1,$2,$3,$4,$5,$6::uuid[],true,true,true,'[]')",
      [source, user, org, region.catalog_version, region.region_id, [region.region_id]],
    );
    try {
      await other.query('BEGIN');
      await other.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4402))', [
        'STAFF_SERVICE:' + source,
      ]);
      await expect(inspect()).rejects.toMatchObject({ code: '55P03' });
      expect(
        (
          await c.query(
            'SELECT contact_enabled FROM matching_supply_preferences WHERE source_id=$1',
            [source],
          )
        ).rows[0].contact_enabled,
      ).toBe(true);
    } finally {
      await other.query('ROLLBACK');
      other.release();
    }
    expect(await inspect()).toEqual([]);
  });
  test('live mutual interests block; after withdrawal discovery and pending notices close without erasing history', async () => {
    const source = id(),
      need = id(),
      slot = id(),
      run = id(),
      candidate = id(),
      intent = id(),
      notice = id();
    await c.query(
      "INSERT INTO matching_supply_preferences(source_kind,source_id,owner_id,org_id,region_catalog_version,region_id,allowed_region_ids,discovery_enabled,contact_enabled,adult_confirmed,availability) VALUES('STAFF_SERVICE',$1,$2,$3,$4,$5,$6::uuid[],true,true,true,'[]')",
      [source, user, org, region.catalog_version, region.region_id, [region.region_id]],
    );
    await c.query(
      "INSERT INTO matching_needs(id,owner_id,org_id,kind,title,address,region_catalog_version,region_id,allowed_region_ids,role,quantity,windows,unit_budget_fen,total_budget_fen,max_travel_minutes,expires_at) VALUES($1,$2,$3,'STAFF_SERVICE','合成需求','合成地址',$4,$5,$6::uuid[],'REFEREE',1,'[{}]',100,100,30,clock_timestamp()+interval '1 day')",
      [need, owner, org, region.catalog_version, region.region_id, [region.region_id]],
    );
    await c.query('INSERT INTO matching_demand_slots(id,need_id,seat_no) VALUES($1,$2,1)', [
      slot,
      need,
    ]);
    await c.query(
      "INSERT INTO matching_runs(id,need_id,need_version,rule_version,seed,truncated,status) VALUES($1,$2,1,'match-rules-v1','synthetic',false,'READY')",
      [run, need],
    );
    await c.query(
      "INSERT INTO matching_candidates(id,need_id,run_id,source_id,source_org_id,source_user_id,source_version,preference_version,snapshot) VALUES($1,$2,$3,$4,$5,$6,1,1,'{}')",
      [candidate, need, run, source, org, user],
    );
    await c.query(
      "INSERT INTO matching_intents(id,need_id,slot_id,candidate_id,generation,need_version,receiver_id,status,accepted_at,expires_at) VALUES($1,$2,$3,$4,1,1,$5,'MUTUAL_INTEREST',clock_timestamp(),clock_timestamp()+interval '1 hour')",
      [intent, need, slot, candidate, user],
    );
    await c.query(
      "INSERT INTO matching_outbox(id,need_id,intent_id,recipient_id,event,resource_version) VALUES($1,$2,$3,$4,'INTENT_ACCEPTED',1)",
      [notice, need, intent, owner],
    );
    expect(await inspect()).toContain('MATCHING_INTENT_UNRESOLVED');
    await c.query("UPDATE matching_intents SET status='DECLINED',version=version+1 WHERE id=$1", [
      intent,
    ]);
    expect(await inspect()).toEqual([]);
    await hooks.revoke(c, user, id());
    expect(
      (
        await c.query(
          'SELECT discovery_enabled,contact_enabled FROM matching_supply_preferences WHERE source_id=$1',
          [source],
        )
      ).rows[0],
    ).toEqual({ discovery_enabled: false, contact_enabled: false });
    expect(
      (await c.query('SELECT state FROM matching_outbox WHERE id=$1', [notice])).rows[0].state,
    ).toBe('CANCELLED');
    expect(
      (await c.query('SELECT id FROM matching_candidates WHERE id=$1', [candidate])).rowCount,
    ).toBe(1);
  });
  test('a past dispatch decliner does not cancel or block a different provider winning the same request', async () => {
    const listing = id(),
      otherListing = id(),
      request = id(),
      batch = id(),
      ownOffer = id(),
      otherOffer = id(),
      hold = id();
    for (const [lid, provider] of [
      [listing, user],
      [otherListing, reviewer],
    ])
      await c.query(
        "INSERT INTO local_listings(id,org_id,provider_user_id,created_by,kind,title,description,address,region_catalog_version,region_id,coverage_region_ids,qualification_note,terms) VALUES($1,$2,$3,$4,'REFEREE','合成裁判','合成描述','合成球场',$5,$6,$7::uuid[],'合成资质记录','合成服务条款')",
        [lid, org, provider, owner, region.catalog_version, region.region_id, [region.region_id]],
      );
    await c.query(
      'INSERT INTO dispatch_preferences(provider_user_id,enabled,region_ids,daily_limit) VALUES($1,true,$2::uuid[],3)',
      [user, [region.region_id]],
    );
    await c.query(
      "INSERT INTO dispatch_requests(id,org_id,owner_user_id,kind,region_catalog_version,service_region_id,service_address,starts_at,ends_at,expires_at,budget,invite_region_ids,allow_cross_city) VALUES($1,$2,$3,'REFEREE',$4,$5,'合成详细地址',clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour',clock_timestamp()+interval '1 day','{}',$6::uuid[],true)",
      [request, org, owner, region.catalog_version, region.region_id, [region.region_id]],
    );
    await c.query(
      "INSERT INTO dispatch_batches(id,request_id,batch_no,expires_at) VALUES($1,$2,1,clock_timestamp()+interval '1 hour')",
      [batch, request],
    );
    await c.query(
      "INSERT INTO dispatch_offers(id,request_id,batch_id,provider_user_id,listing_id,listing_version,status,expires_at) VALUES($1,$2,$3,$4,$5,1,'PENDING',clock_timestamp()+interval '1 hour')",
      [ownOffer, request, batch, user, listing],
    );
    expect(await inspect()).toContain('DISPATCH_INTENT_UNRESOLVED');
    await c.query("UPDATE dispatch_offers SET status='DECLINED',version=version+1 WHERE id=$1", [
      ownOffer,
    ]);
    await c.query(
      "INSERT INTO dispatch_offers(id,request_id,batch_id,provider_user_id,listing_id,listing_version,status,expires_at,quote,quote_hash,travel_verified_by,travel_verified_at,hold_expires_at) VALUES($1,$2,$3,$4,$5,1,'ACCEPTED_HELD',clock_timestamp()+interval '1 hour',jsonb_build_object('hash',$6::text),$6,$7,clock_timestamp(),clock_timestamp()+interval '10 minutes')",
      [otherOffer, request, batch, reviewer, otherListing, 'a'.repeat(64), owner],
    );
    await c.query(
      "INSERT INTO dispatch_holds(id,request_id,offer_id,provider_user_id,starts_at,ends_at,expires_at,state) VALUES($1,$2,$3,$4,clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour',clock_timestamp()+interval '10 minutes','ACTIVE')",
      [hold, request, otherOffer, reviewer],
    );
    expect(await inspect()).toEqual([]);
    await hooks.revoke(c, user, id());
    expect(
      (await c.query('SELECT enabled FROM dispatch_preferences WHERE provider_user_id=$1', [user]))
        .rows[0].enabled,
    ).toBe(false);
    expect(
      (await c.query('SELECT state FROM dispatch_holds WHERE id=$1', [hold])).rows[0].state,
    ).toBe('ACTIVE');
    expect(
      (await c.query('SELECT status FROM dispatch_offers WHERE id=$1', [otherOffer])).rows[0]
        .status,
    ).toBe('ACCEPTED_HELD');
  });
  test('a closed sponsor source still blocks unknown multi-party recovery even when the common trade check is empty', async () => {
    const campaign = id(),
      contract = id(),
      order = id(),
      plan = id(),
      trade = id(),
      payment = id(),
      batch = id(),
      item = id(),
      returned = id(),
      recovery = id();
    await c.query(
      "INSERT INTO sponsorship_campaigns(id,org_id,region_catalog_version,region_id,brand,title,body,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,'合成品牌','合成广告','合成广告内容',clock_timestamp(),clock_timestamp()+interval '1 day',$5)",
      [campaign, org, region.catalog_version, region.region_id, owner],
    );
    await c.query(
      "INSERT INTO sponsor_contracts(id,org_id,campaign_id,payer_user_id,beneficiary_user_id,title,total_fen,allowed_fee_fen,terms,starts_at,ends_at,merchant_key,merchant_id,merchant_app_id,shares,status,created_by) VALUES($1,$2,$3,$4,$5,'合成合同',100,0,'合成交易条款',clock_timestamp(),clock_timestamp()+interval '1 day','synthetic','synthetic','synthetic',$6::jsonb,'CLOSED',$5)",
      [
        contract,
        org,
        campaign,
        user,
        owner,
        JSON.stringify([{ beneficiaryOrgId: org, basisPoints: 10000 }]),
      ],
    );
    await c.query(
      "INSERT INTO sponsor_orders(id,org_id,contract_id,payer_user_id,beneficiary_user_id,title,total_fen,merchant_key,merchant_id,merchant_app_id,terms,snapshot,status,created_by) VALUES($1,$2,$3,$4,$5,'合成原单',100,'synthetic','synthetic','synthetic','合成交易条款','{}','CLOSED',$4)",
      [order, org, contract, user, owner],
    );
    await c.query(
      "INSERT INTO trade_orders(id,org_id,kind,source_id,source_version,source_snapshot,source_hash,payer_user_id,beneficiary_user_id,merchant_key,merchant_id,merchant_app_id,merchant_name,total_fen,quote) VALUES($1,$2,'SPONSOR_ORDER',$3,1,'{}',$4,$5,$6,'synthetic','synthetic','synthetic','合成商户',100,'{}')",
      [trade, org, order, 'a'.repeat(64), user, owner],
    );
    await c.query(
      "INSERT INTO trade_payment_attempts(id,order_id,out_trade_no,channel,status,total_fen,fence,expires_at,provider_transaction_id,paid_at) VALUES($1,$2,$3,'NATIVE','PAID',100,$4,clock_timestamp()+interval '1 hour',$5,clock_timestamp())",
      [payment, trade, id().replaceAll('-', ''), id(), id()],
    );
    await c.query(
      "INSERT INTO sponsor_settlement_batches(id,org_id,order_id,trade_order_id,payment_id,transaction_id,out_order_no,pool_fen,source_hash,money_version,status,proposed_by,approval_required,approvals,finished,finish_status) VALUES($1,$2,$3,$4,$5,'synthetic',$6,100,$7,1,'SUCCEEDED',$8,1,$9::uuid[],true,'SUCCEEDED')",
      [batch, org, order, trade, payment, id(), 'a'.repeat(64), owner, [reviewer]],
    );
    await c.query(
      "INSERT INTO sponsor_settlement_items(id,org_id,batch_id,beneficiary_org_id,receiver_merchant_id,display_name,authorization_version,amount_fen,retained,status,provider_detail_id) VALUES($1,$2,$3,$2,'synthetic','合成受益方','synthetic',100,false,'SUCCEEDED','synthetic')",
      [item, org, batch],
    );
    await c.query(
      "INSERT INTO sponsor_refund_plans(id,org_id,order_id,batch_id,amount_fen,pool_reduction_fen,reason,status,proposed_by,reviewed_by) VALUES($1,$2,$3,$4,100,100,'合成追回原因','RECOVERY_REQUIRED',$5,$6)",
      [plan, org, order, batch, owner, reviewer],
    );
    await c.query(
      "INSERT INTO sponsor_return_items(id,org_id,refund_plan_id,settlement_item_id,amount_fen,out_return_no,status) VALUES($1,$2,$3,$4,100,$5,'UNKNOWN')",
      [returned, org, plan, item, id()],
    );
    await c.query(
      "INSERT INTO sponsor_recovery_cases(id,org_id,refund_plan_id,return_item_id,amount_fen,status) VALUES($1,$2,$3,$4,100,'OPEN')",
      [recovery, org, plan, returned],
    );
    expect(await inspect()).toEqual(['SPONSOR_MONEY_UNRESOLVED']);
    expect(
      (await c.query('SELECT status FROM sponsor_orders WHERE id=$1', [order])).rows[0].status,
    ).toBe('CLOSED');
    // A terminal FAILED provider return remains FAILED. Only an independently
    // evidenced recovery decision can resolve that old claim; UNKNOWN never can.
    await c.query(
      "UPDATE sponsor_refund_plans SET status='REJECTED',version=version+1 WHERE id=$1",
      [plan],
    );
    await c.query(
      "UPDATE sponsor_recovery_cases SET status='WRITTEN_OFF',evidence='synthetic reviewed closure evidence' WHERE id=$1",
      [recovery],
    );
    expect(await inspect()).toEqual(['SPONSOR_MONEY_UNRESOLVED']);
    await c.query('UPDATE sponsor_recovery_cases SET proposed_by=$2,reviewed_by=$3 WHERE id=$1', [
      recovery,
      owner,
      reviewer,
    ]);
    expect(await inspect()).toEqual(['SPONSOR_MONEY_UNRESOLVED']);
    await c.query("UPDATE sponsor_return_items SET status='FAILED' WHERE id=$1", [returned]);
    expect(await inspect()).toEqual([]);
    expect(
      (await c.query('SELECT status FROM sponsor_return_items WHERE id=$1', [returned])).rows[0]
        .status,
    ).toBe('FAILED');
  });
});
