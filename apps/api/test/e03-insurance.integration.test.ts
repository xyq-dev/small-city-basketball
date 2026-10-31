/** Real PostgreSQL orchestration with synthetic trusted driver; no insurer network or real policy. */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { InsuranceService } from '../src/insurance-service.js';
import {
  QualificationPrecheckService,
  createYouthQualificationReader,
} from '../src/qualification-precheck-service.js';
import { ParticipantMaterialsService } from '../src/participant-materials-service.js';
import { participantKey, participantKeyId } from '../src/participant-materials-domain.js';
import { readEntryParticipantEligibility } from '../src/participant-materials-eligibility.js';
import type {
  InsuranceApplicant,
  InsurancePolicyFact,
  InsuranceProvider,
  InsuranceQuote,
} from '../src/insurance-provider.js';
import { INSURANCE_TERMS_VERSION } from '../src/insurance-domain.js';
import { ORIGIN, call, data, membersPath, register } from './support.js';
import type { Api, User } from './support.js';
import { participant, registrationDatabaseUrl } from './p03-support.js';
import type { Actor } from './p03-support.js';
import { createYouthRosterFixture, syntheticYouthIdentity } from './fixtures/youth-registration.js';
import type { YouthRosterFixture } from './fixtures/youth-registration.js';
import { syntheticPdf } from './media-fixtures.js';
const databaseUrl = registrationDatabaseUrl();
const participantDataKey = createHash('sha256')
  .update(`synthetic-c23-restart:${new URL(databaseUrl).pathname.slice(1)}`)
  .digest('base64');
const insuranceKey = createHash('sha256')
  .update(`synthetic-e03:${new URL(databaseUrl).pathname.slice(1)}`)
  .digest('base64');
const noticeKey = Buffer.alloc(32, 27);
class SyntheticDriver implements InsuranceProvider {
  readonly id = 'synthetic-e03-integration';
  readonly allowedOrigins = ['https://synthetic.invalid'];
  applies: string[] = [];
  cancels: string[] = [];
  queries: string[] = [];
  inputs = new Map<string, InsuranceApplicant & { quote: InsuranceQuote }>();
  facts = new Map<string, InsurancePolicyFact>();
  async catalog() {
    return [
      {
        externalId: 'synthetic-basketball',
        version: 'v1',
        name: '合成测试篮球保障',
        insurer: '合成测试机构',
        termsVersion: 'synthetic-terms-v1',
        termsUrl: 'https://synthetic.invalid/terms',
        basketballCovered: true,
      },
    ];
  }
  async quote(
    i: InsuranceApplicant & { productExternalId: string; productVersion: string },
  ): Promise<InsuranceQuote> {
    return {
      quoteReference: randomUUID(),
      productExternalId: i.productExternalId,
      productVersion: i.productVersion,
      termsVersion: 'synthetic-terms-v1',
      applicantReference: i.applicantReference,
      premiumFen: 123,
      currency: 'CNY',
      coverageStartDate: i.coverageStartDate,
      coverageEndDate: i.coverageEndDate,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };
  }
  async apply(id: string, i: InsuranceApplicant & { quote: InsuranceQuote }) {
    this.applies.push(id);
    this.inputs.set(id, i);
    return 'UNKNOWN' as const;
  }
  async query(id: string) {
    this.queries.push(id);
    return this.facts.get(id) ?? null;
  }
  async cancel(_id: string, original: string) {
    this.cancels.push(original);
    return 'UNKNOWN' as const;
  }
  issued(id: string) {
    const q = this.inputs.get(id)!.quote;
    const f: InsurancePolicyFact = {
      ...q,
      operationId: id,
      providerOrderId: 'synthetic-order-' + id,
      paymentStatus: 'PAID',
      policyStatus: 'ISSUED',
      policyNumber: 'synthetic-policy-' + id,
      refundedFen: 0,
      document: { contentType: 'application/pdf', base64: syntheticPdf.toString('base64') },
      checkoutUrl: null,
    };
    this.facts.set(id, f);
    return f;
  }
}
describe('E03 durable insurance on isolated PostgreSQL', { concurrent: false }, () => {
  let api: Api,
    owner: User,
    leader: Actor,
    reviewer: Actor,
    outsider: Actor,
    subjects: Actor[],
    f: YouthRosterFixture;
  let insurance: InsuranceService,
    qualification: QualificationPrecheckService,
    materials: ParticipantMaterialsService;
  const driver = new SyntheticDriver();
  let participationReady = true;
  beforeAll(async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await migrate(pool);
    } finally {
      await pool.end();
    }
    const config = { databaseUrl, appOrigin: ORIGIN, participantDataKey };
    api = await createApi(config);
    owner = await register(api, 'e03-owner');
    leader = await participant(api, 'e03-leader');
    reviewer = await participant(api, 'e03-reviewer');
    outsider = await participant(api, 'e03-outsider');
    subjects = [await participant(api, 'e03-subject1'), await participant(api, 'e03-subject2')];
    data(
      await call(api, 'put', `${membersPath(owner.orgId)}/${reviewer.id}`, {
        cookie: owner.cookie,
        body: { role: 'REVIEWER', status: 'ACTIVE' },
      }),
    );
    f = await createYouthRosterFixture({
      api,
      owner,
      leader,
      reviewer,
      subjects,
      birthDates: ['1990-01-01', '1991-01-01'],
      requireInsurance: true,
    });
    qualification = new QualificationPrecheckService(api.pool, config);
    insurance = new InsuranceService(api.pool, config, {
      provider: driver,
      dataKey: insuranceKey,
      noticeKey: noticeKey.toString('base64'),
      autoDispatch: false,
      participationGuard: async () => ({ ready: participationReady }),
    });
    await insurance.assertConfiguration();
    await insurance.syncProducts();
    materials = new ParticipantMaterialsService(api.pool, config, {
      participationGuard: async () => ({ ready: participationReady }),
      onlineInsuranceGuard: (c, i) => insurance.readEligibility(c, i),
    });
  }, 90000);
  afterAll(async () => {
    insurance?.onModuleDestroy();
    if (api) {
      await api.app.close();
      await api.pool.end();
    }
  }, 30000);
  async function locked<T>(work: (c: import('pg').PoolClient) => Promise<T>) {
    const c = await api.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
        owner.orgId,
        f.registration.event.id,
      ]);
      const r = await work(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  const input = () => ({
    orgId: owner.orgId,
    eventId: f.registration.event.id,
    entryId: f.entry.id,
    memberId: f.members[0]!.memberId,
    rosterRevisionId: f.entry.rosterRevisionId!,
    rulesetId: f.registration.rules!.id,
    policyDate: f.registration.event.startDate,
    startDate: f.registration.event.startDate,
    endDate: f.registration.event.endDate,
  });
  async function readyOperation(orderId: string) {
    await api.pool.query(
      "UPDATE insurance_operations SET next_attempt_at=clock_timestamp() WHERE order_id=$1 AND status IN('PENDING','UNKNOWN')",
      [orderId],
    );
  }
  test('DRAFT own request → independent precheck → unknown apply → verified issuance → C23 approval → cancellation queries original id', async () => {
    const member = f.members[0]!,
      s = subjects[0]!;
    const product = (await insurance.workspace(s.cookie)).products[0]!;
    const quote = (await insurance.quote(s.cookie, {
      clientRequestId: randomUUID(),
      entryId: f.entry.id,
      memberId: member.memberId,
      productId: product.id,
    })) as { quoteId: string };
    const purchase = {
      clientRequestId: randomUUID(),
      quoteId: quote.quoteId,
      acceptedTermsVersion: INSURANCE_TERMS_VERSION,
    };
    await expect(insurance.purchase(s.cookie, purchase)).rejects.toMatchObject({
      code: 'INSURANCE_QUALIFICATION_REQUIRED',
    });
    expect(
      (await locked((c) => createYouthQualificationReader(participantDataKey)(c, input()))).ready,
    ).toBe(false);
    const request = await qualification.request(s.cookie, owner.orgId, f.entry.id, {
      clientRequestId: randomUUID(),
      memberId: member.memberId,
      expectedMaterialVersion: member.materialVersion,
      acceptedTermsVersion: 'qualification-precheck-v1',
    });
    await expect(
      qualification.review(leader.cookie, owner.orgId, f.entry.id, {
        clientRequestId: randomUUID(),
        memberId: member.memberId,
        requestId: request.requestId,
        expectedMaterialVersion: member.materialVersion,
        decision: 'APPROVED',
        reason: '合成独立核对',
        identityReviewed: true,
        portraitReviewed: true,
        signatureReviewed: true,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await qualification.review(reviewer.cookie, owner.orgId, f.entry.id, {
      clientRequestId: randomUUID(),
      memberId: member.memberId,
      requestId: request.requestId,
      expectedMaterialVersion: member.materialVersion,
      decision: 'APPROVED',
      reason: '合成身份照片签署独立人工核对',
      identityReviewed: true,
      portraitReviewed: true,
      signatureReviewed: true,
    });
    const own = await locked((c) => createYouthQualificationReader(participantDataKey)(c, input()));
    expect(own.ready).toBe(true);
    expect(own.birthDate).toBe('1990-01-01');
    const created = (await insurance.purchase(s.cookie, purchase)) as { orderId: string };
    expect(await insurance.purchase(s.cookie, purchase)).toEqual(created);
    await expect(insurance.get(outsider.cookie, created.orderId)).rejects.toMatchObject({
      status: 404,
    });
    await insurance.drain(created.orderId);
    expect(driver.applies).toHaveLength(1);
    const operation = driver.applies[0]!;
    const stored = (
      await api.pool.query(
        'SELECT status,reconcile_only FROM insurance_operations WHERE order_id=$1',
        [created.orderId],
      )
    ).rows[0];
    expect(stored).toMatchObject({ status: 'UNKNOWN', reconcile_only: true });
    expect(await locked((c) => insurance.closureBlockers(c, s.id))).toContainEqual({
      code: 'INSURANCE_ORDER_PENDING',
      resourceId: created.orderId,
    });
    const duplicateQuote = (await insurance.quote(s.cookie, {
      clientRequestId: randomUUID(),
      entryId: f.entry.id,
      memberId: member.memberId,
      productId: product.id,
    })) as { quoteId: string };
    await expect(
      insurance.purchase(s.cookie, {
        ...purchase,
        clientRequestId: randomUUID(),
        quoteId: duplicateQuote.quoteId,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await locked((c) => insurance.readEligibility(c, input()))).ready).toBe(false);
    driver.issued(operation);
    await readyOperation(created.orderId);
    await insurance.drain(created.orderId);
    expect(driver.applies).toEqual([operation]);
    expect(driver.queries).toEqual([operation, operation]);
    const issued = await insurance.get(s.cookie, created.orderId);
    expect(issued).toMatchObject({
      paymentStatus: 'PAID',
      policyStatus: 'ISSUED',
      canDownloadDocument: true,
      refundedFen: 0,
    });
    expect((await locked((c) => insurance.readEligibility(c, input()))).ready).toBe(true);
    expect((await insurance.document(s.cookie, created.orderId)).body.equals(syntheticPdf)).toBe(
      true,
    );
    expect(JSON.stringify(issued)).not.toContain('1990-01-01');
    expect(JSON.stringify(issued)).not.toContain('合成参赛者');
    const submitted = await materials.submit(s.cookie, owner.orgId, f.entry.id, {
      expectedVersion: member.materialVersion,
    });
    expect(submitted.material?.storedStatus).toBe('SUBMITTED');
    const approved = await materials.review(
      reviewer.cookie,
      owner.orgId,
      f.entry.id,
      member.memberId,
      {
        expectedVersion: submitted.material!.version,
        decision: 'APPROVE',
        reason: '合成资料与在线保障已逐项核对',
        identityChecked: true,
        portraitChecked: true,
        insuranceChecked: true,
      },
    );
    expect(approved.storedStatus).toBe('APPROVED');
    const readiness = await locked((c) =>
      readEntryParticipantEligibility(
        c,
        {
          orgId: owner.orgId,
          eventId: f.registration.event.id,
          entryId: f.entry.id,
          rosterRevisionId: f.entry.rosterRevisionId!,
          rulesetId: f.registration.rules!.id,
          startDate: f.registration.event.startDate,
          endDate: f.registration.event.endDate,
          requireParticipantMaterials: true,
          requireInsurance: true,
          keyId: participantKeyId(participantKey(participantDataKey)),
          participantDataKey,
        },
        {
          participationGuard: async () => ({ ready: participationReady }),
          onlineInsuranceGuard: (c, i) => insurance.readEligibility(c, i),
        },
      ),
    );
    expect(
      readiness.snapshots.find((x) => x.memberId === member.memberId)?.onlineInsuranceOrderId,
    ).toBe(created.orderId);

    expect((await locked((c) => insurance.readEligibility(c, input()))).ready).toBe(true);
    participationReady = false;
    expect((await locked((c) => insurance.readEligibility(c, input()))).ready).toBe(false);
    participationReady = true;
    const cancel = await insurance.command(s.cookie, created.orderId, {
      clientRequestId: randomUUID(),
      expectedVersion: issued.version,
      type: 'REQUEST_CANCELLATION',
    });
    expect(cancel).toEqual(created);
    expect((await locked((c) => insurance.readEligibility(c, input()))).ready).toBe(false);
    await insurance.drain(created.orderId);
    await readyOperation(created.orderId);
    await insurance.drain(created.orderId);
    expect(driver.cancels).toEqual([operation]);
    driver.facts.set(operation, {
      ...driver.facts.get(operation)!,
      policyStatus: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      refundedFen: 123,
      document: null,
    });
    await readyOperation(created.orderId);
    await insurance.drain(created.orderId);
    expect(await insurance.get(s.cookie, created.orderId)).toMatchObject({
      policyStatus: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      refundedFen: 123,
    });
    const policy = (
      await api.pool.query('SELECT policy_ciphertext FROM insurance_orders WHERE id=$1', [
        created.orderId,
      ])
    ).rows[0].policy_ciphertext;
    expect(policy).not.toContain('synthetic-policy');
    expect(await locked((c) => insurance.closureBlockers(c, s.id))).toEqual([]);
    expect((await insurance.document(s.cookie, created.orderId)).body.equals(syntheticPdf)).toBe(
      true,
    );
    const archive = (
      await api.pool.query(
        'SELECT id,has_document FROM insurance_policy_facts WHERE order_id=$1 ORDER BY observed_at,id',
        [created.orderId],
      )
    ).rows;
    expect(archive.length).toBeGreaterThanOrEqual(2);
    expect(archive.some((x) => x.has_document)).toBe(true);
    await expect(
      api.pool.query('UPDATE insurance_policy_facts SET has_document=false WHERE id=$1', [
        archive[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });

    expect((await locked((c) => insurance.readEligibility(c, input()))).ready).toBe(false);
  });
  test('signed notices only schedule original query; replay and late ISSUED facts do not revive cancellation', async () => {
    const order = (
      await api.pool.query(
        'SELECT id,operation_id FROM insurance_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
        [subjects[0]!.id],
      )
    ).rows[0];
    const notice = {
      providerId: driver.id,
      eventId: randomUUID(),
      operationId: order.operation_id,
      timestamp: new Date().toISOString(),
    };
    const signature = createHmac('sha256', noticeKey).update(JSON.stringify(notice)).digest('hex');
    await expect(insurance.providerNotice(notice, '0'.repeat(64))).rejects.toMatchObject({
      status: 401,
    });
    const before = driver.queries.length;
    await insurance.providerNotice(notice, signature);
    await insurance.providerNotice(notice, signature);
    expect(driver.queries.length).toBe(before);
    expect(
      (
        await api.pool.query(
          'SELECT count(*)::integer AS n FROM insurance_provider_events WHERE provider_id=$1 AND event_id=$2',
          [driver.id, notice.eventId],
        )
      ).rows[0].n,
    ).toBe(1);
    driver.issued(order.operation_id);
    await insurance.drain(order.id);
    expect(await insurance.get(subjects[0]!.cookie, order.id)).toMatchObject({
      policyStatus: 'CANCELLED',
      paymentStatus: 'REFUNDED',
    });
  });
  test('an expired untouched lease cannot refresh policy evidence and a replacement supplier cannot query or cancel the original order', async () => {
    const member = f.members[1]!,
      subject = subjects[1]!;
    const request = await qualification.request(subject.cookie, owner.orgId, f.entry.id, {
      clientRequestId: randomUUID(),
      memberId: member.memberId,
      expectedMaterialVersion: member.materialVersion,
      acceptedTermsVersion: 'qualification-precheck-v1',
    });
    await qualification.review(reviewer.cookie, owner.orgId, f.entry.id, {
      clientRequestId: randomUUID(),
      memberId: member.memberId,
      requestId: request.requestId,
      expectedMaterialVersion: member.materialVersion,
      decision: 'APPROVED',
      reason: '合成独立身份照片签署核对',
      identityReviewed: true,
      portraitReviewed: true,
      signatureReviewed: true,
    });
    const product = (await insurance.workspace(subject.cookie)).products[0]!;
    const quote = (await insurance.quote(subject.cookie, {
      clientRequestId: randomUUID(),
      entryId: f.entry.id,
      memberId: member.memberId,
      productId: product.id,
    })) as { quoteId: string };
    const created = (await insurance.purchase(subject.cookie, {
      clientRequestId: randomUUID(),
      quoteId: quote.quoteId,
      acceptedTermsVersion: INSURANCE_TERMS_VERSION,
    })) as { orderId: string };
    await insurance.drain(created.orderId);
    const original = (
      await api.pool.query('SELECT operation_id FROM insurance_orders WHERE id=$1', [
        created.orderId,
      ])
    ).rows[0].operation_id;
    driver.issued(original);
    await readyOperation(created.orderId);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
        enter = resolve;
      }),
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    const originalQuery = driver.query;
    driver.query = async (id) => {
      const fact = await originalQuery.call(driver, id);
      if (id === original) {
        enter();
        await hold;
      }
      return fact;
    };
    let pending: Promise<void> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      pending = insurance.drain(created.orderId);
      await Promise.race([
        entered,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Original query barrier did not enter')),
            5000,
          );
        }),
      ]);
      clearTimeout(timeout);
      // Move only the real lease deadline, not the fence/state/result. No other worker
      // claims it: this is the exact late-response-without-takeover boundary.
      const lease = (
        await api.pool.query(
          "UPDATE insurance_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE order_id=$1 AND status='RUNNING' RETURNING fence",
          [created.orderId],
        )
      ).rows[0];
      expect(lease).toBeTruthy();
      release();
      await pending;
      pending = undefined;
      const late = (
        await api.pool.query(
          'SELECT payment_status,policy_status,verified_at FROM insurance_orders WHERE id=$1',
          [created.orderId],
        )
      ).rows[0];
      expect(late).toEqual({
        payment_status: 'UNPAID',
        policy_status: 'PENDING',
        verified_at: null,
      });
      expect(
        (
          await api.pool.query('SELECT * FROM insurance_policy_facts WHERE order_id=$1', [
            created.orderId,
          ])
        ).rowCount,
      ).toBe(0);
      const recovered = (
        await api.pool.query(
          'SELECT status,reconcile_only,fence,lease_id FROM insurance_operations WHERE order_id=$1',
          [created.orderId],
        )
      ).rows[0];
      expect(recovered).toMatchObject({ status: 'UNKNOWN', reconcile_only: true, lease_id: null });
      expect(Number(recovered.fence)).toBeGreaterThan(Number(lease.fence));
    } finally {
      clearTimeout(timeout);
      release();
      driver.query = originalQuery;
      if (pending) await pending;
    }
    await readyOperation(created.orderId);
    await insurance.drain(created.orderId);
    const issued = await insurance.get(subject.cookie, created.orderId);
    expect(issued).toMatchObject({ paymentStatus: 'PAID', policyStatus: 'ISSUED' });
    expect(driver.applies.filter((id) => id === original)).toHaveLength(1);
    await insurance.command(subject.cookie, created.orderId, {
      clientRequestId: randomUUID(),
      expectedVersion: issued.version,
      type: 'REQUEST_CANCELLATION',
    });
    const noCall = vi.fn(async (): Promise<never> => {
      throw new Error('Replacement supplier must never receive the original order');
    });
    const foreignProvider: InsuranceProvider = {
      id: 'synthetic-e03-replacement',
      allowedOrigins: ['https://synthetic.invalid'],
      catalog: noCall,
      quote: noCall,
      apply: noCall,
      query: noCall,
      cancel: noCall,
    };
    const foreign = new InsuranceService(
      api.pool,
      { databaseUrl, appOrigin: ORIGIN, participantDataKey },
      {
        provider: foreignProvider,
        dataKey: insuranceKey,
        autoDispatch: false,
        participationGuard: async () => ({ ready: true }),
      },
    );
    // Normal startup already rejects changing the singleton supplier. The worker
    // independently enforces the same pin even if a caller skipped that assertion.
    await expect(foreign.assertConfiguration()).rejects.toThrow('Insurance configuration differs');
    const before = (
      await api.pool.query(
        'SELECT provider_id,provider_order_id,payment_status,policy_status,refunded_fen,verified_at FROM insurance_orders WHERE id=$1',
        [created.orderId],
      )
    ).rows[0];
    await foreign.drain(created.orderId);
    await readyOperation(created.orderId);
    await foreign.drain(created.orderId);
    expect(noCall).not.toHaveBeenCalled();
    expect(
      (
        await api.pool.query(
          'SELECT provider_id,provider_order_id,payment_status,policy_status,refunded_fen,verified_at FROM insurance_orders WHERE id=$1',
          [created.orderId],
        )
      ).rows[0],
    ).toEqual(before);
    expect(
      (
        await api.pool.query(
          "SELECT status,reconcile_only FROM insurance_operations WHERE order_id=$1 AND kind='CANCEL'",
          [created.orderId],
        )
      ).rows[0],
    ).toEqual({ status: 'UNKNOWN', reconcile_only: true });
  }, 30000);
  test('today thirteen cannot bypass private collection by moving the event after the fourteenth birthday', async () => {
    const member = f.members[0]!,
      subject = subjects[0]!;
    const calendar = (
      await api.pool.query(
        "SELECT d::text AS today,(d-interval '13 years')::date::text AS birth_date,(d+interval '1 year')::date::text AS future_start FROM (SELECT (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date AS d) t",
      )
    ).rows[0];
    await api.pool.query(
      'UPDATE events SET start_date=$3::date,end_date=$3::date+1 WHERE org_id=$1 AND id=$2',
      [owner.orgId, f.registration.event.id, calendar.future_start],
    );
    const before = (
      await api.pool.query(
        'SELECT version,current_revision_id FROM participant_materials WHERE id=$1',
        [member.materialId],
      )
    ).rows[0];
    await expect(
      materials.save(subject.cookie, owner.orgId, f.entry.id, {
        clientRequestId: randomUUID(),
        expectedVersion: before.version,
        identityNumber: syntheticYouthIdentity(calendar.birth_date, 91),
      }),
    ).rejects.toMatchObject({ code: 'YOUTH_DATA_PROCESSING_CONSENT_REQUIRED' });
    const after = (
      await api.pool.query(
        'SELECT version,current_revision_id FROM participant_materials WHERE id=$1',
        [member.materialId],
      )
    ).rows[0];
    expect(after).toEqual(before);
  });
});
