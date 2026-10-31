import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ApplicationService } from './service.js';
import type { Actor, ApiOptions } from './service.js';
import { ApiError, notFound } from './errors.js';
import { objectInput, resourceId } from './validation.js';
import {
  decryptParticipantPayload,
  participantIdentityNumber,
  participantKey,
  participantKeyId,
} from './participant-materials-domain.js';
import {
  createYouthQualificationReader,
  QUALIFICATION_SUBJECT_SQL,
  qualificationBirthDate,
  qualificationMaterialCurrent,
  qualificationUnder14,
} from './qualification-precheck-service.js';
import type {
  QualificationInput,
  QualificationOptions,
  YouthQualification,
} from './qualification-precheck-service.js';
import {
  INSURANCE_TERMS_VERSION,
  insuranceCoverageEligible,
  insuranceFail,
  insuranceFingerprint,
  insuranceHash,
  insuranceId,
  insuranceKey,
  insuranceKeyId,
  openInsurance,
  parseInsuranceCommand,
  parseInsurancePurchase,
  parseInsuranceQuote,
  sealInsurance,
  verifyInsuranceNotice,
} from './insurance-domain.js';
import {
  checkInsurancePolicy,
  checkInsuranceProduct,
  checkInsuranceQuote,
} from './insurance-provider.js';
import type {
  InsuranceApplicant,
  InsurancePolicyFact,
  InsuranceProvider,
  InsuranceQuote,
} from './insurance-provider.js';
import type { InsuranceOrderData } from '../../../packages/contracts/insurance.js';

type Row = Record<string, any>;
export interface InsuranceOptions extends QualificationOptions {
  provider?: InsuranceProvider;
  dataKey?: string;
  noticeKey?: string;
  autoDispatch?: boolean;
  participationGuard?: (c: PoolClient, input: QualificationInput) => Promise<{ ready: boolean }>;
}
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
const ORDER_SQL = `SELECT o.*,q.product_id,q.binding_id,q.material_id,q.material_revision_id AS quote_material_revision_id,
 q.quote_ciphertext,q.applicant_ciphertext,q.applicant_reference,q.premium_fen,q.currency,
 q.coverage_start_date::text,q.coverage_end_date::text,q.expires_at,p.provider_id,p.external_id,p.external_version,p.terms_version AS product_terms_version,p.basketball_covered,p.active AS product_active
 FROM insurance_orders o JOIN insurance_quotes q ON q.id=o.quote_id JOIN insurance_products p ON p.id=q.product_id`;
/** Durable insurance orchestration. No default insurer, client-selected endpoint, platform premium collection or fake issuance. */
export class InsuranceService extends ApplicationService {
  private readonly key?: Buffer;
  private readonly participantKey?: Buffer;
  private readonly noticeKey?: Buffer;
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;
  constructor(
    pool: Pool,
    options: ApiOptions,
    private readonly insurance: InsuranceOptions = {},
  ) {
    super(pool, options);
    if (insurance.dataKey !== undefined) this.key = insuranceKey(insurance.dataKey);
    if (options.participantDataKey !== undefined)
      this.participantKey = participantKey(options.participantDataKey);
    if (insurance.noticeKey !== undefined) this.noticeKey = insuranceKey(insurance.noticeKey);
    if (insurance.provider && (!this.key || !this.participantKey || !insurance.participationGuard))
      throw Error('Complete insurance privacy and authorization configuration is required');
  }
  capabilities() {
    return {
      enabled: Boolean(
        this.insurance.provider &&
        this.key &&
        this.participantKey &&
        this.insurance.participationGuard,
      ),
      reason: this.insurance.provider ? null : '保险供应商尚未接入，保留已有外部保单人工审核。',
      consentVersion: INSURANCE_TERMS_VERSION,
    };
  }
  private enabled() {
    if (!this.capabilities().enabled)
      insuranceFail('INSURANCE_PROVIDER_DISABLED', '在线投保尚未接入真实供应商', 503);
    return { provider: this.insurance.provider!, key: this.key! };
  }
  async assertConfiguration() {
    if (!this.key || !this.insurance.provider) return;
    const id = insuranceKeyId(this.key),
      provider = this.insurance.provider.id;
    await this.pool.query(
      'INSERT INTO insurance_configuration(singleton,key_id,provider_id) VALUES(true,$1,$2) ON CONFLICT DO NOTHING',
      [id, provider],
    );
    const stored = (
      await this.pool.query(
        'SELECT key_id,provider_id FROM insurance_configuration WHERE singleton=true',
      )
    ).rows[0];
    if (stored?.key_id !== id || stored?.provider_id !== provider)
      throw Error('Insurance configuration differs from stored provider or key');
  }
  /** Called only by the configured worker/startup; the trusted driver supplies the product catalog. */
  async syncProducts() {
    const { provider } = this.enabled(),
      raw = await provider.catalog();
    if (!Array.isArray(raw) || raw.length > 50)
      insuranceFail('INSURANCE_CATALOG_INVALID', '保险产品资料暂不可用', 502);
    const products = raw.map((p) => checkInsuranceProduct(p, provider.allowedOrigins));
    if (new Set(products.map((p) => `${p.externalId}\0${p.version}`)).size !== products.length)
      insuranceFail('INSURANCE_CATALOG_INVALID', '保险产品版本重复', 502);
    await this.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(1127428915,37)');
      const ids: string[] = [];
      for (const p of products) {
        const hash = insuranceHash(p),
          previous = (
            await c.query(
              'SELECT id,source_hash FROM insurance_products WHERE provider_id=$1 AND external_id=$2 AND external_version=$3',
              [provider.id, p.externalId, p.version],
            )
          ).rows[0];
        if (previous && previous.source_hash !== hash)
          insuranceFail('INSURANCE_PRODUCT_VERSION_CONFLICT', '保险服务不可改写同版本条款', 409);
        const id = previous?.id ?? randomUUID();
        ids.push(id);
        if (previous) await c.query('UPDATE insurance_products SET active=true WHERE id=$1', [id]);
        else
          await c.query(
            'INSERT INTO insurance_products(id,provider_id,external_id,external_version,name,insurer,terms_version,terms_url,basketball_covered,source_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
            [
              id,
              provider.id,
              p.externalId,
              p.version,
              p.name,
              p.insurer,
              p.termsVersion,
              p.termsUrl,
              p.basketballCovered,
              hash,
            ],
          );
      }
      await c.query(
        'UPDATE insurance_products SET active=false WHERE provider_id=$1 AND NOT(id=ANY($2::uuid[]))',
        [provider.id, ids],
      );
    });
  }
  private async lockScope(c: PoolClient, org: string, event: string) {
    if (!(await c.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [org])).rowCount)
      throw notFound();
    const e = (
      await c.query(
        'SELECT *,start_date::text,end_date::text FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [org, event],
      )
    ).rows[0];
    if (!e) throw notFound();
    return e;
  }
  private async subject(c: PoolClient, actor: Actor, entryId: string, memberId: string) {
    const route = (
      await c.query('SELECT org_id,event_id,team_id FROM entries WHERE id=$1', [entryId])
    ).rows[0];
    if (!route) throw notFound();
    const event = await this.lockScope(c, route.org_id, route.event_id);
    await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
      route.org_id,
      route.team_id,
    ]);
    const row = (await c.query(QUALIFICATION_SUBJECT_SQL, [route.org_id, entryId, memberId]))
      .rows[0];
    if (!row || row.user_id !== actor.user.id) throw notFound();
    if (
      !this.participantKey ||
      !qualificationMaterialCurrent(row, participantKeyId(this.participantKey))
    )
      insuranceFail('INSURANCE_MATERIAL_REQUIRED', '请先提交本人当前身份、照片及签署资料', 409);
    return { ...row, org_id: route.org_id, member_id: memberId, entry_id: entryId, event };
  }
  private input(row: Row): QualificationInput {
    return {
      orgId: row.org_id,
      eventId: row.event_id,
      entryId: row.entry_id,
      memberId: row.member_id,
      rosterRevisionId: row.roster_revision_id,
      rulesetId: row.ruleset_id,
      policyDate: row.start_date,
    };
  }
  private applicant(row: Row): InsuranceApplicant {
    const p = decryptParticipantPayload(row.payload_ciphertext, this.participantKey!, {
      orgId: row.org_id,
      eventId: row.event_id,
      entryId: row.entry_id,
      memberId: row.member_id,
      userId: row.user_id,
      revisionId: row.material_revision_id,
    });
    const identity = participantIdentityNumber(p.identityNumber, row.start_date);
    if (!p.realName || !p.acceptedTerms || !p.portrait)
      insuranceFail('INSURANCE_MATERIAL_REQUIRED', '本人资料尚未完整', 409);
    return {
      realName: p.realName!,
      identityNumber: identity,
      applicantReference: insuranceFingerprint(this.key!, [
        row.org_id,
        row.event_id,
        row.entry_id,
        row.member_id,
        row.material_revision_id,
        identity,
      ]),
      coverageStartDate: row.start_date,
      coverageEndDate: row.end_date,
    };
  }
  private async dataConsent(c: PoolClient, row: Row, applicant: InsuranceApplicant) {
    if (
      qualificationUnder14(qualificationBirthDate(applicant.identityNumber), row.start_date) &&
      (!this.insurance.dataConsentGuard ||
        !(
          await this.insurance.dataConsentGuard(c, {
            orgId: row.org_id,
            eventId: row.event_id,
            userId: row.user_id,
            forceRequired: true,
          })
        ).ready)
    )
      insuranceFail('YOUTH_DATA_CONSENT_REQUIRED', '未满14岁资料须先取得有效监护人同意', 409);
  }
  private async authorization(c: PoolClient, row: Row): Promise<YouthQualification> {
    const reader = createYouthQualificationReader(this.options.participantDataKey!, this.insurance);
    const proof = await reader(c, this.input(row));
    if (!proof.ready)
      insuranceFail(
        'INSURANCE_QUALIFICATION_REQUIRED',
        '请先由独立审核员完成不含保险的资格预审',
        409,
      );
    if (
      !this.insurance.participationGuard ||
      !(await this.insurance.participationGuard(c, this.input(row))).ready
    )
      insuranceFail('INSURANCE_GUARDIAN_REQUIRED', '当前参赛授权或监护确认尚未满足', 409);
    return proof;
  }
  private async replay(c: PoolClient, actor: Actor, id: string, hash: string) {
    const r = (
      await c.query(
        'SELECT request_hash,response FROM insurance_receipts WHERE user_id=$1 AND client_request_id=$2',
        [actor.user.id, id],
      )
    ).rows[0];
    if (!r) return null;
    if (r.request_hash !== hash) insuranceFail('IDEMPOTENCY_CONFLICT', '原操作编号内容不同', 409);
    await this.ensureFreshSession(c, actor);
    return r.response;
  }
  private async record(
    c: PoolClient,
    actor: Actor,
    id: string,
    hash: string,
    action: string,
    response: unknown,
  ) {
    await c.query(
      'INSERT INTO insurance_receipts(user_id,client_request_id,request_hash,action,response) VALUES($1,$2,$3,$4,$5::jsonb)',
      [actor.user.id, id, hash, action, JSON.stringify(response)],
    );
    await this.ensureFreshSession(c, actor);
    return response;
  }
  private async requestLock(c: PoolClient, actor: Actor, id: string) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `insurance:${actor.user.id}:${id}`,
    ]);
  }
  async workspace(cookie?: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        products = this.capabilities().enabled
          ? (
              await c.query(
                'SELECT * FROM insurance_products WHERE active AND provider_id=$1 ORDER BY insurer,name,id',
                [this.insurance.provider!.id],
              )
            ).rows
          : [];
      const rows = (
        await c.query(
          ORDER_SQL + ' WHERE o.user_id=$1 ORDER BY o.created_at DESC,o.id DESC LIMIT 100',
          [a.user.id],
        )
      ).rows;
      const orders = [];
      for (const row of rows) orders.push(await this.orderData(c, row));
      await this.ensureFreshSession(c, a);
      return {
        ...this.capabilities(),
        products: products.map((p) => ({
          id: p.id,
          insurer: p.insurer,
          name: p.name,
          termsVersion: p.terms_version,
          termsUrl: p.terms_url,
          basketballCovered: p.basketball_covered,
        })),
        orders,
        notice:
          '保费由实际保险服务方收取。支付、出单、保障审核与最终报名分别判断；已有外部有效保单不要求重复购买。',
      };
    });
  }
  async quote(cookie: string | undefined, raw: unknown) {
    const { provider, key } = this.enabled(),
      b = parseInsuranceQuote(raw),
      hash = insuranceFingerprint(key, ['QUOTE', b]);
    const captured = await this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      await this.requestLock(c, actor, b.clientRequestId);
      const row = await this.subject(c, actor, b.entryId, b.memberId),
        replay = await this.replay(c, actor, b.clientRequestId, hash);
      if (replay) return { replay };
      if (!['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(row.event.status))
        insuranceFail('INSURANCE_EVENT_NOT_OPEN', '当前赛事不接受新的投保申请', 409);
      const p = (
        await c.query(
          'SELECT * FROM insurance_products WHERE id=$1 AND provider_id=$2 AND active AND basketball_covered',
          [b.productId, provider.id],
        )
      ).rows[0];
      if (!p) throw notFound();
      const applicant = this.applicant(row);
      await this.dataConsent(c, row, applicant);
      await this.ensureFreshSession(c, actor);
      return { row, p, applicant };
    });
    if (captured.replay) return captured.replay;
    await this.rateLimit(`insurance-quote:${captured.row!.user_id}`, 30, 3600);
    const expected = {
      productExternalId: captured.p!.external_id,
      productVersion: captured.p!.external_version,
      termsVersion: captured.p!.terms_version,
      applicantReference: captured.applicant!.applicantReference,
      coverageStartDate: captured.applicant!.coverageStartDate,
      coverageEndDate: captured.applicant!.coverageEndDate,
      currency: 'CNY' as const,
    };
    const quote = checkInsuranceQuote(
      await provider.quote({
        ...captured.applicant!,
        productExternalId: expected.productExternalId,
        productVersion: expected.productVersion,
      }),
      expected,
      Date.now(),
    );
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      await this.requestLock(c, actor, b.clientRequestId);
      const row = await this.subject(c, actor, b.entryId, b.memberId),
        replay = await this.replay(c, actor, b.clientRequestId, hash);
      if (replay) return replay;
      const applicant = this.applicant(row);
      await this.dataConsent(c, row, applicant);
      if (
        applicant.applicantReference !== quote.applicantReference ||
        row.start_date !== quote.coverageStartDate ||
        row.end_date !== quote.coverageEndDate
      )
        insuranceFail('INSURANCE_SOURCE_CHANGED', '本人资料或赛期已改变，请重新报价', 409);
      const product = (
        await c.query('SELECT active FROM insurance_products WHERE id=$1 FOR SHARE', [b.productId])
      ).rows[0];
      if (
        !product?.active ||
        !['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(row.event.status)
      )
        insuranceFail('INSURANCE_SOURCE_CHANGED', '保险产品或赛事已改变，请重新读取', 409);
      const id = randomUUID();
      const inserted = await c.query(
        `INSERT INTO insurance_quotes(id,user_id,org_id,event_id,entry_id,member_id,binding_id,material_id,material_revision_id,product_id,quote_ciphertext,applicant_ciphertext,key_id,applicant_reference,premium_fen,currency,coverage_start_date,coverage_end_date,expires_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'CNY',$16,$17,$18 WHERE $18::timestamptz>clock_timestamp()`,
        [
          id,
          actor.user.id,
          row.org_id,
          row.event_id,
          row.entry_id,
          row.member_id,
          row.binding_id,
          row.material_id,
          row.material_revision_id,
          b.productId,
          sealInsurance(key, id, quote),
          sealInsurance(key, id, applicant),
          insuranceKeyId(key),
          quote.applicantReference,
          quote.premiumFen,
          quote.coverageStartDate,
          quote.coverageEndDate,
          quote.expiresAt,
        ],
      );
      if (!inserted.rowCount)
        insuranceFail('INSURANCE_QUOTE_EXPIRED', '报价已到期，请重新申请', 409);
      return this.record(c, actor, b.clientRequestId, hash, 'QUOTE', {
        quoteId: id,
        premiumFen: quote.premiumFen,
        currency: 'CNY',
        expiresAt: quote.expiresAt,
        termsVersion: captured.p!.terms_version,
        consentVersion: INSURANCE_TERMS_VERSION,
        coverageStartDate: quote.coverageStartDate,
        coverageEndDate: quote.coverageEndDate,
      });
    });
  }
  async purchase(cookie: string | undefined, raw: unknown) {
    const { key } = this.enabled(),
      b = parseInsurancePurchase(raw),
      hash = insuranceFingerprint(key, ['PURCHASE', b]);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.requestLock(c, a, b.clientRequestId);
      const q = (
        await c.query(
          'SELECT *,coverage_start_date::text,coverage_end_date::text,expires_at>clock_timestamp() AS valid FROM insurance_quotes WHERE id=$1 AND user_id=$2',
          [b.quoteId, a.user.id],
        )
      ).rows[0];
      if (!q) throw notFound();
      const row = await this.subject(c, a, q.entry_id, q.member_id),
        replay = await this.replay(c, a, b.clientRequestId, hash);
      if (replay) return replay;
      const existing = (await c.query('SELECT id FROM insurance_orders WHERE quote_id=$1', [q.id]))
        .rows[0];
      if (existing)
        return this.record(c, a, b.clientRequestId, hash, 'PURCHASE', { orderId: existing.id });
      if (
        !['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(row.event.status) ||
        (
          await c.query('SELECT 1 FROM registration_freezes WHERE org_id=$1 AND event_id=$2', [
            row.org_id,
            row.event_id,
          ])
        ).rowCount
      )
        insuranceFail('INSURANCE_EVENT_NOT_OPEN', '当前不能创建新的投保申请', 409);
      if (
        !q.valid ||
        q.material_revision_id !== row.material_revision_id ||
        q.binding_id !== row.binding_id ||
        q.coverage_start_date !== row.start_date ||
        q.coverage_end_date !== row.end_date
      )
        insuranceFail('INSURANCE_QUOTE_EXPIRED', '报价已到期或来源改变，请重新确认', 409);
      const product = (
        await c.query('SELECT active FROM insurance_products WHERE id=$1 FOR SHARE', [q.product_id])
      ).rows[0];
      if (!product?.active) insuranceFail('INSURANCE_PRODUCT_WITHDRAWN', '该保险产品已下架', 409);
      await this.authorization(c, row);
      const unresolved = (
        await c.query(
          "SELECT id FROM insurance_orders WHERE org_id=$1 AND entry_id=$2 AND member_id=$3 AND (policy_status IN('PENDING','ISSUED','CANCEL_PENDING') OR payment_status='REFUND_PENDING' OR (policy_status='FAILED' AND payment_status='PAID'))",
          [q.org_id, q.entry_id, q.member_id],
        )
      ).rows[0];
      if (unresolved)
        insuranceFail(
          'INSURANCE_ORDER_ACTIVE',
          '已有投保或待核对保单，请先核对原单，勿重复购买',
          409,
        );
      const id = randomUUID(),
        operation = randomUUID();
      await c.query(
        'INSERT INTO insurance_orders(id,quote_id,user_id,org_id,event_id,entry_id,member_id,material_revision_id,operation_id,terms_version,key_id,authorization_valid) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)',
        [
          id,
          q.id,
          a.user.id,
          q.org_id,
          q.event_id,
          q.entry_id,
          q.member_id,
          q.material_revision_id,
          operation,
          b.acceptedTermsVersion,
          insuranceKeyId(key),
        ],
      );
      await c.query("INSERT INTO insurance_operations(id,order_id,kind) VALUES($1,$2,'APPLY')", [
        operation,
        id,
      ]);
      await this.audit(
        c,
        a.user.id,
        q.org_id,
        'INSURANCE_PURCHASE_REQUESTED',
        'insurance_order',
        id,
        {},
      );
      return this.record(c, a, b.clientRequestId, hash, 'PURCHASE', { orderId: id });
    });
  }
  private async ownOrder(c: PoolClient, a: Actor, id: string) {
    const route = (
      await c.query('SELECT org_id,event_id FROM insurance_orders WHERE id=$1 AND user_id=$2', [
        id,
        a.user.id,
      ])
    ).rows[0];
    if (!route) throw notFound();
    await this.lockScope(c, route.org_id, route.event_id);
    const o = (
      await c.query(ORDER_SQL + ' WHERE o.id=$1 AND o.user_id=$2 FOR UPDATE OF o', [id, a.user.id])
    ).rows[0];
    if (!o) throw notFound();
    return o;
  }
  private async orderData(c: PoolClient, o: Row): Promise<InsuranceOrderData> {
    const pending = (
      await c.query(
        "SELECT id FROM insurance_operations WHERE order_id=$1 AND status IN('PENDING','RUNNING','UNKNOWN') ORDER BY created_at LIMIT 1",
        [o.id],
      )
    ).rows[0];
    const m = (
      await c.query(
        'SELECT current_revision_id FROM participant_materials WHERE id=$1 AND user_id=$2',
        [o.material_id, o.user_id],
      )
    ).rows[0];
    const policy =
      o.policy_ciphertext && this.key
        ? openInsurance<InsurancePolicyFact>(this.key, o.id, o.policy_ciphertext)
        : null;
    return {
      id: o.id,
      entryId: o.entry_id,
      memberId: o.member_id,
      version: o.version,
      premiumFen: Number(o.premium_fen),
      refundedFen: o.refunded_fen === null ? null : Number(o.refunded_fen),
      currency: 'CNY',
      coverageStartDate: o.coverage_start_date,
      coverageEndDate: o.coverage_end_date,
      paymentStatus: o.payment_status,
      policyStatus: o.policy_status,
      verifiedAt: iso(o.verified_at),
      maskedPolicyNumber: policy?.policyNumber ? `****${policy.policyNumber.slice(-4)}` : null,
      canDownloadDocument: Boolean(policy?.document),
      pendingOperation: pending?.id ?? null,
      canRefresh: this.capabilities().enabled && !pending,
      canRequestCancellation:
        this.capabilities().enabled &&
        !o.cancellation_requested_at &&
        !['CANCELLED'].includes(o.policy_status),
      currentMaterial: m?.current_revision_id === o.material_revision_id,
    };
  }
  async get(cookie: string | undefined, id: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        o = await this.ownOrder(c, a, resourceId(id)),
        data = await this.orderData(c, o);
      await this.ensureFreshSession(c, a);
      return data;
    });
  }
  async requestReceipt(cookie: string | undefined, id: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        r = (
          await c.query(
            'SELECT response FROM insurance_receipts WHERE user_id=$1 AND client_request_id=$2',
            [a.user.id, resourceId(id)],
          )
        ).rows[0];
      await this.ensureFreshSession(c, a);
      return r ? { found: true, result: r.response } : { found: false };
    });
  }
  async command(cookie: string | undefined, id: string, raw: unknown) {
    const { key } = this.enabled(),
      b = parseInsuranceCommand(raw),
      hash = insuranceFingerprint(key, [id, b]);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.requestLock(c, a, b.clientRequestId);
      const o = await this.ownOrder(c, a, resourceId(id)),
        replay = await this.replay(c, a, b.clientRequestId, hash);
      if (replay) return replay;
      if (o.version !== b.expectedVersion)
        insuranceFail('VERSION_CONFLICT', '保单进度已改变，请重新读取', 409);
      const pending = (
        await c.query(
          "SELECT * FROM insurance_operations WHERE order_id=$1 AND status IN('PENDING','RUNNING','UNKNOWN') ORDER BY created_at LIMIT 1 FOR UPDATE",
          [o.id],
        )
      ).rows[0];
      if (b.type === 'REQUEST_CANCELLATION') {
        if (o.cancellation_requested_at || o.policy_status === 'CANCELLED')
          return this.record(c, a, b.clientRequestId, hash, b.type, { orderId: o.id });
        if (
          pending?.kind === 'APPLY' &&
          pending.status === 'PENDING' &&
          pending.attempt_count === 0
        ) {
          await c.query(
            "UPDATE insurance_operations SET status='FAILED',updated_at=clock_timestamp() WHERE id=$1",
            [pending.id],
          );
          await c.query(
            "UPDATE insurance_orders SET cancellation_requested_at=clock_timestamp(),authorization_valid=false,policy_status='CANCELLED',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
            [o.id],
          );
        } else {
          await c.query(
            "UPDATE insurance_orders SET cancellation_requested_at=clock_timestamp(),authorization_valid=false,policy_status='CANCEL_PENDING',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
            [o.id],
          );
          if (!pending)
            await c.query(
              "INSERT INTO insurance_operations(id,order_id,kind) VALUES($1,$2,'CANCEL')",
              [randomUUID(), o.id],
            );
        }
      } else if (!pending)
        await c.query("INSERT INTO insurance_operations(id,order_id,kind) VALUES($1,$2,'QUERY')", [
          randomUUID(),
          o.id,
        ]);
      await this.audit(
        c,
        a.user.id,
        o.org_id,
        b.type === 'REFRESH' ? 'INSURANCE_REFRESH_REQUESTED' : 'INSURANCE_CANCELLATION_REQUESTED',
        'insurance_order',
        o.id,
        {},
      );
      return this.record(c, a, b.clientRequestId, hash, b.type, { orderId: o.id });
    });
  }
  async checkout(cookie: string | undefined, id: string) {
    return this.transaction(async (c) => {
      this.enabled();
      const a = await this.lockActor(c, cookie),
        o = await this.ownOrder(c, a, resourceId(id));
      if (
        o.cancellation_requested_at ||
        !['UNPAID', 'PENDING'].includes(o.payment_status) ||
        !o.policy_ciphertext
      )
        insuranceFail('INSURANCE_CHECKOUT_UNAVAILABLE', '请先核对原投保请求', 409);
      const current = (
        await c.query(
          'SELECT *,start_date::text,end_date::text FROM events WHERE org_id=$1 AND id=$2',
          [o.org_id, o.event_id],
        )
      ).rows[0];
      if (
        !current ||
        current.start_date !== o.coverage_start_date ||
        current.end_date !== o.coverage_end_date ||
        !(await this.workerAuthorization(c, o))
      )
        insuranceFail('INSURANCE_SOURCE_CHANGED', '投保资格或赛期已改变，请先核对原申请', 409);
      const f = openInsurance<InsurancePolicyFact>(this.key!, o.id, o.policy_ciphertext);
      if (!f.checkoutUrl)
        insuranceFail('INSURANCE_CHECKOUT_UNAVAILABLE', '保险服务方尚未提供付款入口', 409);
      await this.ensureFreshSession(c, a);
      return {
        url: f.checkoutUrl,
        notice: '将在已接入保险服务方付款；返回本页查单，付款不等于已出单。',
      };
    });
  }
  async document(cookie: string | undefined, id: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        o = await this.ownOrder(c, a, resourceId(id));
      if (!this.key || !o.policy_ciphertext) throw notFound();
      const f = openInsurance<InsurancePolicyFact>(this.key, o.id, o.policy_ciphertext);
      if (!f.document) throw notFound();
      await this.ensureFreshSession(c, a);
      return {
        body: Buffer.from(f.document.base64, 'base64'),
        contentType: 'application/pdf',
        fileName: 'insurance-policy.pdf',
      };
    });
  }
  async providerNotice(raw: unknown, signature: unknown) {
    const { provider } = this.enabled();
    if (!this.noticeKey) insuranceFail('INSURANCE_NOTICE_DISABLED', '保险通知尚未配置', 503);
    const n = verifyInsuranceNotice(raw, signature, this.noticeKey!, Date.now());
    if (n.providerId !== provider.id)
      insuranceFail('INSURANCE_NOTICE_INVALID', '保险通知无法核验', 401);
    await this.transaction(async (c) => {
      const order = (
        await c.query('SELECT org_id,event_id,id FROM insurance_orders WHERE operation_id=$1', [
          n.operationId,
        ])
      ).rows[0];
      if (!order) throw notFound();
      await this.lockScope(c, order.org_id, order.event_id);
      const hash = insuranceHash(n),
        old = (
          await c.query(
            'SELECT request_hash FROM insurance_provider_events WHERE provider_id=$1 AND event_id=$2',
            [provider.id, n.eventId],
          )
        ).rows[0];
      if (old) {
        if (old.request_hash !== hash)
          insuranceFail('INSURANCE_NOTICE_CONFLICT', '保险通知编号内容不同', 409);
        return;
      }
      await c.query(
        'INSERT INTO insurance_provider_events(provider_id,event_id,operation_id,request_hash) VALUES($1,$2,$3,$4)',
        [provider.id, n.eventId, n.operationId, hash],
      );
      const pending = (
        await c.query(
          "SELECT id FROM insurance_operations WHERE order_id=$1 AND status IN('PENDING','RUNNING','UNKNOWN')",
          [order.id],
        )
      ).rows[0];
      if (!pending)
        await c.query("INSERT INTO insurance_operations(id,order_id,kind) VALUES($1,$2,'QUERY')", [
          randomUUID(),
          order.id,
        ]);
    });
    return { accepted: true };
  }
  private async workerAuthorization(c: PoolClient, o: Row): Promise<boolean> {
    const row = (await c.query(QUALIFICATION_SUBJECT_SQL, [o.org_id, o.entry_id, o.member_id]))
      .rows[0];
    if (
      !row ||
      row.material_revision_id !== o.material_revision_id ||
      row.start_date !== o.coverage_start_date ||
      row.end_date !== o.coverage_end_date
    )
      return false;
    row.org_id = o.org_id;
    row.member_id = o.member_id;
    row.entry_id = o.entry_id;
    try {
      await this.authorization(c, row);
      return true;
    } catch (e) {
      if (e instanceof ApiError && [403, 404, 409, 422, 503].includes(e.status)) return false;
      throw e;
    }
  }
  /** One lease-fenced operation. UNKNOWN and recovered leases query the original apply ID, never repeat charge-bearing calls. */
  async drain() {
    if (this.draining || !this.capabilities().enabled) return;
    this.draining = true;
    try {
      await this.pool.query(
        "UPDATE insurance_operations SET status='UNKNOWN',reconcile_only=true,fence=fence+1,lease_id=NULL,lease_until=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE status='RUNNING' AND lease_until<=clock_timestamp()",
      );
      const candidate = (
        await this.pool.query(
          `SELECT x.id,o.org_id,o.event_id FROM insurance_operations x JOIN insurance_orders o ON o.id=x.order_id WHERE x.status IN('PENDING','UNKNOWN') AND x.attempt_count<12 AND x.next_attempt_at<=clock_timestamp() ORDER BY x.created_at,x.id LIMIT 1`,
        )
      ).rows[0];
      if (!candidate) return;
      const work = await this.transaction(async (c) => {
        await this.lockScope(c, candidate.org_id, candidate.event_id);
        const x = (
          await c.query(
            "SELECT * FROM insurance_operations WHERE id=$1 AND status IN('PENDING','UNKNOWN') AND attempt_count<12 AND next_attempt_at<=clock_timestamp() FOR UPDATE SKIP LOCKED",
            [candidate.id],
          )
        ).rows[0];
        if (!x) return null;
        const o = (await c.query(ORDER_SQL + ' WHERE o.id=$1 FOR UPDATE OF o', [x.order_id]))
          .rows[0];
        const authorized = await this.workerAuthorization(c, o),
          quote = openInsurance<InsuranceQuote>(this.key!, o.quote_id, o.quote_ciphertext),
          applicant = openInsurance<InsuranceApplicant>(
            this.key!,
            o.quote_id,
            o.applicant_ciphertext,
          );
        const initialApply = x.kind === 'APPLY' && !x.reconcile_only;
        const valid = (
          await c.query('SELECT $1::timestamptz>clock_timestamp() AS valid', [o.expires_at])
        ).rows[0].valid;
        if (
          initialApply &&
          (!authorized ||
            !valid ||
            !o.product_active ||
            o.provider_id !== this.insurance.provider!.id ||
            o.cancellation_requested_at)
        ) {
          await c.query(
            "UPDATE insurance_operations SET status='FAILED',updated_at=clock_timestamp() WHERE id=$1",
            [x.id],
          );
          await c.query(
            "UPDATE insurance_orders SET policy_status='FAILED',authorization_valid=false,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
            [o.id],
          );
          return null;
        }
        const lease = randomUUID(),
          fence = Number(x.fence) + 1;
        await c.query(
          "UPDATE insurance_operations SET status='RUNNING',attempt_count=attempt_count+1,fence=$2,lease_id=$3,lease_until=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=$1",
          [x.id, fence, lease],
        );
        return { x, o, quote, applicant, lease, fence };
      });
      if (!work) return;
      let fact: InsurancePolicyFact | null = null,
        rejected = false;
      try {
        if (work.x.kind === 'APPLY' && !work.x.reconcile_only) {
          const result = await this.insurance.provider!.apply(work.o.operation_id, {
            ...work.applicant,
            quote: work.quote,
          });
          rejected = result === 'REJECTED';
        } else if (work.x.kind === 'CANCEL' && !work.x.reconcile_only)
          rejected =
            (await this.insurance.provider!.cancel(work.x.id, work.o.operation_id)) === 'REJECTED';
        if (!rejected) {
          const value = await this.insurance.provider!.query(work.o.operation_id);
          if (value)
            fact = checkInsurancePolicy(
              value,
              work.quote,
              work.o.operation_id,
              this.insurance.provider!.allowedOrigins,
            );
        }
      } catch {
        /* Transport/result uncertainty: retain the original operation and reconcile only. */
      }
      await this.transaction(async (c) => {
        await this.lockScope(c, work.o.org_id, work.o.event_id);
        const o = (await c.query(ORDER_SQL + ' WHERE o.id=$1 FOR UPDATE OF o', [work.o.id]))
          .rows[0];
        const x = (
          await c.query(
            "SELECT * FROM insurance_operations WHERE id=$1 AND status='RUNNING' AND lease_id=$2 AND fence=$3 FOR UPDATE",
            [work.x.id, work.lease, work.fence],
          )
        ).rows[0];
        if (!x) return;
        if (fact) {
          // Terminal provider facts and explicit cancellation intent cannot be resurrected by a stale query.
          if (
            (o.policy_status === 'CANCELLED' && fact.policyStatus !== 'CANCELLED') ||
            (o.payment_status === 'REFUNDED' && fact.paymentStatus !== 'REFUNDED')
          )
            fact = null;
        }
        if (fact) {
          const authorized = await this.workerAuthorization(c, o),
            policy =
              o.cancellation_requested_at && fact.policyStatus === 'ISSUED'
                ? 'CANCEL_PENDING'
                : fact.policyStatus;
          await c.query(
            'UPDATE insurance_orders SET provider_order_id=$2,payment_status=$3,policy_status=$4,policy_ciphertext=$5,verified_at=clock_timestamp(),authorization_valid=$6,refunded_fen=$7,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
            [
              o.id,
              fact.providerOrderId,
              fact.paymentStatus,
              policy,
              sealInsurance(this.key!, o.id, fact),
              authorized && !o.cancellation_requested_at,
              fact.refundedFen,
            ],
          );
          await c.query(
            "UPDATE insurance_operations SET status='DONE',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1",
            [x.id],
          );
          if (
            o.cancellation_requested_at &&
            !['CANCELLED', 'CANCEL_PENDING'].includes(fact.policyStatus) &&
            work.x.kind !== 'CANCEL'
          )
            await c.query(
              "INSERT INTO insurance_operations(id,order_id,kind) VALUES($1,$2,'CANCEL')",
              [randomUUID(), o.id],
            );
        } else if (rejected) {
          await c.query(
            "UPDATE insurance_operations SET status='FAILED',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1",
            [x.id],
          );
          if (work.x.kind === 'CANCEL') {
            const previous = o.policy_ciphertext
              ? openInsurance<InsurancePolicyFact>(this.key!, o.id, o.policy_ciphertext)
              : null;
            await c.query(
              'UPDATE insurance_orders SET cancellation_requested_at=NULL,policy_status=$2,authorization_valid=false,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
              [o.id, previous?.policyStatus ?? 'PENDING'],
            );
          }
          if (work.x.kind === 'APPLY')
            await c.query(
              "UPDATE insurance_orders SET policy_status='FAILED',payment_status='FAILED',authorization_valid=false,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
              [o.id],
            );
        } else
          await c.query(
            "UPDATE insurance_operations SET status=CASE WHEN attempt_count>=12 THEN 'FAILED' ELSE 'UNKNOWN' END,reconcile_only=true,lease_id=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=$1",
            [x.id],
          );
      });
    } finally {
      this.draining = false;
    }
  }
  startWorker() {
    if (this.capabilities().enabled && this.insurance.autoDispatch !== false && !this.timer) {
      this.timer = setInterval(() => {
        void this.drain().catch(() => {});
      }, 5000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  /** Existing event lock required; this proof supplements insurance only, never final photo/identity approval. */
  async readEligibility(
    c: PoolClient,
    input: QualificationInput & { startDate: string; endDate: string },
  ) {
    if (!this.capabilities().enabled)
      return { ready: false, orderId: null, code: 'INSURANCE_PROVIDER_DISABLED' };
    const proof = await createYouthQualificationReader(
      this.options.participantDataKey!,
      this.insurance,
    )(c, input);
    const authorized =
      proof.ready &&
      Boolean(
        this.insurance.participationGuard &&
        (await this.insurance.participationGuard(c, input)).ready,
      );
    const o = (
      await c.query(
        ORDER_SQL +
          ` WHERE o.org_id=$1 AND o.event_id=$2 AND o.entry_id=$3 AND o.member_id=$4 ORDER BY o.created_at DESC,o.id DESC LIMIT 1`,
        [input.orgId, input.eventId, input.entryId, input.memberId],
      )
    ).rows[0];
    if (!o) return { ready: false, orderId: null, code: 'ONLINE_POLICY_REQUIRED' };
    const now = (await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const ready =
      !o.cancellation_requested_at &&
      insuranceCoverageEligible({
        paymentStatus: o.payment_status,
        policyStatus: o.policy_status,
        coverageStartDate: o.coverage_start_date,
        coverageEndDate: o.coverage_end_date,
        eventStartDate: input.startDate,
        eventEndDate: input.endDate,
        currentMaterial: o.material_revision_id === proof.materialRevisionId,
        authorized: authorized && o.authorization_valid,
        basketballCovered: o.basketball_covered,
        verifiedAt: iso(o.verified_at),
        now: iso(now)!,
      });
    return {
      ready,
      orderId: ready ? o.id : null,
      code: ready ? null : 'ONLINE_POLICY_NOT_CURRENT',
    };
  }
  async closureBlockers(c: PoolClient, userId: string) {
    return (
      await c.query(
        `SELECT o.id FROM insurance_orders o WHERE o.user_id=$1 AND (o.payment_status IN('PENDING','REFUND_PENDING') OR o.policy_status IN('PENDING','CANCEL_PENDING') OR (o.policy_status='FAILED' AND o.payment_status='PAID') OR EXISTS(SELECT 1 FROM insurance_operations x WHERE x.order_id=o.id AND x.status IN('PENDING','RUNNING','UNKNOWN'))) ORDER BY o.id LIMIT 100`,
        [userId],
      )
    ).rows.map((r) => ({ code: 'INSURANCE_ORDER_PENDING', resourceId: r.id }));
  }
}

/** Account closure caller must already hold the target user's lock. Retain policy and dispute evidence. */
export async function revokeInsuranceForClosure(c: PoolClient, userId: string): Promise<void> {
  await c.query('SELECT id FROM insurance_orders WHERE user_id=$1 ORDER BY id FOR UPDATE NOWAIT', [
    userId,
  ]);
  await c.query(
    'UPDATE insurance_orders SET authorization_valid=false WHERE user_id=$1 AND authorization_valid=true',
    [userId],
  );
}
