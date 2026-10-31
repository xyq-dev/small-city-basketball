import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { InsuranceService } from '../apps/api/dist/insurance-service.js';
import { QualificationPrecheckService } from '../apps/api/dist/qualification-precheck-service.js';
import { openInsurance } from '../apps/api/dist/insurance-domain.js';
import { captureParticipantMaterials } from './c23-participant-material-check.mjs';
import { syntheticPdf } from './c05-media-fixtures.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const uuid = (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
const providerId = 'synthetic-e03-integration';
const dataKey = (sourceDatabase) =>
  createHash('sha256')
    .update('synthetic-e03:' + sourceDatabase)
    .digest();
const consentVersion = 'insurance-purchase-consent-v1';
const tableNames = [
  'insurance_configuration',
  'insurance_products',
  'insurance_quotes',
  'insurance_orders',
  'insurance_operations',
  'insurance_receipts',
  'insurance_provider_events',
  'insurance_policy_facts',
  'participant_qualification_requests',
  'participant_qualification_prechecks',
  'participant_qualification_receipts',
];
function references(saved) {
  assert.match(saved?.sourceDatabase ?? '', /^scb_test_[A-Za-z0-9_]+$/);
  for (const field of [
    'orgId',
    'eventId',
    'entryId',
    'memberId',
    'subjectId',
    'reviewerId',
    'materialId',
    'qualificationRequestId',
    'qualificationId',
    'productId',
    'quoteId',
    'orderId',
    'operationId',
    'quoteRequestId',
    'purchaseRequestId',
    'cancelRequestId',
    'qualificationCommandId',
    'reviewCommandId',
    'noticeEventId',
  ])
    assert.ok(uuid(saved?.[field]), 'E03 recovery fixture requires its exact ' + field);
  assert.equal(saved.providerId, providerId);
  assert.match(saved.documentSha256, /^[0-9a-f]{64}$/);
  assert.match(saved.productIdentityHash, /^[0-9a-f]{64}$/);
  for (const table of tableNames) {
    assert.ok(
      Number.isSafeInteger(saved?.tables?.[table]?.count) && saved.tables[table].count > 0,
      'E03 requires a nonempty ' + table,
    );
    assert.match(saved.tables[table].hash, /^[0-9a-f]{64}$/);
  }
}
async function isolated(runtimePool, readPool, databaseUrl, appOrigin) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw Error('E03 fixture requires an isolated PostgreSQL URL');
  }
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
  const sourceDatabase = decodeURIComponent(parsed.pathname.slice(1));
  assert.match(
    sourceDatabase,
    /^scb_test_[A-Za-z0-9_]+$/,
    'E03 fixture refuses non-isolated databases',
  );
  const runtime = (
    await runtimePool.query(
      'SELECT current_database() AS name,current_user AS role,pg_backend_pid() AS pid',
    )
  ).rows[0];
  assert.equal(runtime.name, sourceDatabase);
  if (runtime.role !== 'scb_runtime') {
    const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    let origin;
    try {
      origin = new URL(appOrigin);
    } catch {
      throw Error('E03 local owner fixture requires a loopback origin');
    }
    assert.ok(
      loopback.has(parsed.hostname) && origin.protocol === 'http:' && loopback.has(origin.hostname),
      'E03 owner fixture refuses remote targets',
    );
    assert.equal(runtime.role, decodeURIComponent(parsed.username));
  }
  assert.equal(
    (await readPool.query('SELECT current_database() AS name')).rows[0].name,
    sourceDatabase,
  );
  assert.equal(
    (
      await readPool.query(
        'SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND datname=$2 AND usename=$3',
        [runtime.pid, sourceDatabase, runtime.role],
      )
    ).rowCount,
    1,
    'E03 readers and writers must address the same isolated cluster',
  );
  return sourceDatabase;
}
function syntheticIdentity() {
  // A non-real district. Format/checksum validity never claims official identity verification.
  const first = '99000019900101091',
    weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  return (
    first + '10X98765432'[[...first].reduce((sum, n, i) => sum + Number(n) * weights[i], 0) % 11]
  );
}
function sessionCookie(response) {
  const cookies = response.headers
    .getSetCookie()
    .filter((v) => /^scb\.sid=[A-Za-z0-9_-]{43};/.test(v));
  assert.equal(
    cookies.length,
    1,
    'E03 synthetic reviewer requires exactly one application session',
  );
  return cookies[0].split(';')[0];
}
/** Every table scope is fixed here. No raw identity, document or secret appears in the returned metadata. */
async function snapshot(readPool, saved) {
  const scopes = {
    insurance_configuration: ['singleton=true', []],
    insurance_products: ['id=$1', [saved.productId]],
    insurance_quotes: ['id=$1', [saved.quoteId]],
    insurance_orders: ['id=$1', [saved.orderId]],
    insurance_operations: ['order_id=$1', [saved.orderId]],
    insurance_receipts: [
      'user_id=$1 AND client_request_id=ANY($2::uuid[])',
      [saved.subjectId, [saved.quoteRequestId, saved.purchaseRequestId, saved.cancelRequestId]],
    ],
    insurance_provider_events: [
      'provider_id=$1 AND event_id=$2',
      [saved.providerId, saved.noticeEventId],
    ],
    insurance_policy_facts: ['order_id=$1', [saved.orderId]],
    participant_qualification_requests: ['id=$1', [saved.qualificationRequestId]],
    participant_qualification_prechecks: ['id=$1', [saved.qualificationId]],
    participant_qualification_receipts: [
      '(user_id=$1 AND client_request_id=$2) OR (user_id=$3 AND client_request_id=$4)',
      [saved.subjectId, saved.qualificationCommandId, saved.reviewerId, saved.reviewCommandId],
    ],
  };
  const tables = {};
  for (const name of tableNames) {
    const [where, values] = scopes[name];
    const r = (
      await readPool.query(
        `SELECT count(*)::int AS count,encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') AS hash FROM ${name} t WHERE ${where}`,
        values,
      )
    ).rows[0];
    tables[name] = { count: r.count, hash: r.hash };
  }
  const order = (
    await readPool.query(
      `SELECT payment_status,policy_status,authorization_valid,cancellation_requested_at IS NOT NULL AS cancellation_requested,
    encode(sha256(convert_to((to_jsonb(o)-ARRAY['authorization_valid','version','updated_at'])::text,'UTF8')),'hex') AS identity_hash
    FROM insurance_orders o WHERE id=$1 AND user_id=$2`,
      [saved.orderId, saved.subjectId],
    )
  ).rows[0];
  assert.ok(order, 'E03 linked order must exist');
  const pending = (
    await readPool.query(
      "SELECT count(*)::int AS count FROM insurance_operations WHERE order_id=$1 AND status IN('PENDING','RUNNING','UNKNOWN')",
      [saved.orderId],
    )
  ).rows[0].count;
  const product = (
    await readPool.query(
      "SELECT active,encode(sha256(convert_to((to_jsonb(p)-'active')::text,'UTF8')),'hex') AS identity_hash FROM insurance_products p WHERE id=$1",
      [saved.productId],
    )
  ).rows[0];
  assert.ok(product, 'E03 retained provider product must exist');
  return { tables, order, pending, product };
}
/** A dedicated synthetic supplier exists only inside this isolated fixture and never uses the network. */
export async function captureExpansionInsurance({
  call,
  state,
  runtimePool,
  readPool,
  databaseUrl,
  appOrigin,
  participantDataKey,
  suffix,
  registerSynthetic,
}) {
  const sourceDatabase = await isolated(runtimePool, readPool, databaseUrl, appOrigin);
  assert.ok(uuid(state?.orgId) && uuid(state?.userId) && typeof state.cookie === 'string');
  assert.equal(
    typeof participantDataKey,
    'string',
    'E03 fixture requires the existing isolated material key',
  );
  const ownerSession = (await call('/v1/auth/session', { cookie: state.cookie })).data;
  assert.equal(ownerSession.user.id, state.userId);
  // A separate event/team/person leaves the original C23 partial draft and all old actor roles untouched.
  const base = await captureParticipantMaterials({
    call,
    readPool,
    orgId: state.orgId,
    ownerCookie: state.cookie,
    suffix: 'e03-' + sha(String(suffix) + randomUUID()).slice(0, 20),
  });
  const subject = (await call('/v1/auth/session', { cookie: base.cookie })).data.user;
  const completed = (
    await call(base.materialPath + '/mine', {
      method: 'PUT',
      cookie: base.cookie,
      body: {
        clientRequestId: randomUUID(),
        expectedVersion: base.mine.material.version,
        identityNumber: syntheticIdentity(),
        insurance: null,
        acceptedTerms: true,
        publicityConsent: false,
      },
    })
  ).data;
  assert.equal(completed.material.storedStatus, 'DRAFT');
  assert.equal(completed.material.insurance, null);
  const eventId = (
    await readPool.query('SELECT event_id FROM entries WHERE org_id=$1 AND id=$2', [
      state.orgId,
      base.entryId,
    ])
  ).rows[0]?.event_id;
  assert.ok(uuid(eventId));
  let reviewerId, reviewerCookie;
  if (registerSynthetic) {
    const r = await registerSynthetic('合成保险独立预审员');
    reviewerId = r.userId ?? r.id;
    reviewerCookie = r.cookie;
  } else {
    const r = await call('/v1/auth/register-participant', {
      method: 'POST',
      body: {
        email: 'e03-review-' + randomUUID() + '@example.test',
        password: randomBytes(24).toString('base64url'),
        displayName: '合成保险独立预审员',
      },
    });
    reviewerId = r.data.user.id;
    reviewerCookie = sessionCookie(r.response);
  }
  assert.ok(uuid(reviewerId) && typeof reviewerCookie === 'string');
  await call(`/v1/orgs/${state.orgId}/members/${reviewerId}`, {
    method: 'PUT',
    cookie: state.cookie,
    body: { role: 'REVIEWER', status: 'ACTIVE' },
  });
  await call(`/v1/orgs/${state.orgId}/events/${eventId}/staff/${reviewerId}`, {
    method: 'PUT',
    cookie: state.cookie,
    body: { role: 'REVIEWER', status: 'ACTIVE' },
  });
  const config = { databaseUrl, appOrigin, participantDataKey };
  const qualification = new QualificationPrecheckService(runtimePool, config);
  const qualificationCommandId = randomUUID(),
    reviewCommandId = randomUUID();
  const requested = await qualification.request(base.cookie, state.orgId, base.entryId, {
    clientRequestId: qualificationCommandId,
    memberId: base.memberId,
    expectedMaterialVersion: completed.material.version,
    acceptedTermsVersion: 'qualification-precheck-v1',
  });
  const reviewed = await qualification.review(reviewerCookie, state.orgId, base.entryId, {
    clientRequestId: reviewCommandId,
    memberId: base.memberId,
    requestId: requested.requestId,
    expectedMaterialVersion: completed.material.version,
    decision: 'APPROVED',
    reason: '隔离合成身份照片签署独立核对',
    identityReviewed: true,
    portraitReviewed: true,
    signatureReviewed: true,
  });
  const noticeKey = Buffer.alloc(32, 27);
  let fact = null,
    applyId = null,
    applyCalls = 0,
    cancelCalls = 0,
    queryCalls = 0;
  const provider = {
    id: providerId,
    allowedOrigins: ['https://synthetic.invalid'],
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
    },
    async quote(i) {
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
    },
    async apply(id, i) {
      applyCalls++;
      assert.equal(applyCalls, 1, 'E03 recovery fixture must never reapply');
      applyId = id;
      fact = {
        ...i.quote,
        operationId: id,
        providerOrderId: 'synthetic-order-' + id,
        paymentStatus: 'PAID',
        policyStatus: 'ISSUED',
        policyNumber: 'synthetic-policy-' + id,
        refundedFen: 0,
        document: { contentType: 'application/pdf', base64: syntheticPdf.toString('base64') },
        checkoutUrl: null,
      };
      return 'ACCEPTED';
    },
    async query(id) {
      queryCalls++;
      assert.equal(id, applyId, 'E03 queries retain the original apply id');
      return fact;
    },
    async cancel(_cancellationId, id) {
      cancelCalls++;
      assert.equal(cancelCalls, 1);
      assert.equal(id, applyId);
      fact = {
        ...fact,
        paymentStatus: 'REFUNDED',
        policyStatus: 'CANCELLED',
        refundedFen: 123,
        document: null,
      };
      return 'ACCEPTED';
    },
  };
  const insurance = new InsuranceService(runtimePool, config, {
    provider,
    dataKey: dataKey(sourceDatabase).toString('base64'),
    noticeKey: noticeKey.toString('base64'),
    autoDispatch: false,
    participationGuard: async () => ({ ready: true }),
  });
  try {
    await insurance.assertConfiguration();
    await insurance.syncProducts();
    const product = (await insurance.workspace(base.cookie)).products.find(
      (p) => p.basketballCovered,
    );
    assert.ok(product);
    const quoteRequestId = randomUUID(),
      purchaseRequestId = randomUUID(),
      cancelRequestId = randomUUID();
    const quote = await insurance.quote(base.cookie, {
      clientRequestId: quoteRequestId,
      entryId: base.entryId,
      memberId: base.memberId,
      productId: product.id,
    });
    const purchased = await insurance.purchase(base.cookie, {
      clientRequestId: purchaseRequestId,
      quoteId: quote.quoteId,
      acceptedTermsVersion: consentVersion,
    });
    await insurance.drain(purchased.orderId);
    const issued = await insurance.get(base.cookie, purchased.orderId);
    assert.equal(issued.policyStatus, 'ISSUED');
    assert.equal(issued.paymentStatus, 'PAID');
    assert.equal(issued.canDownloadDocument, true);
    assert.equal(
      sha((await insurance.document(base.cookie, purchased.orderId)).body),
      sha(syntheticPdf),
    );
    const noticeEventId = randomUUID(),
      notice = {
        providerId,
        eventId: noticeEventId,
        operationId: applyId,
        timestamp: new Date().toISOString(),
      };
    const signature = createHmac('sha256', noticeKey).update(JSON.stringify(notice)).digest('hex');
    const before = queryCalls;
    await insurance.providerNotice(notice, signature);
    await insurance.providerNotice(notice, signature);
    assert.equal(queryCalls, before, 'Notice cannot apply provider facts itself');
    await insurance.drain(purchased.orderId);
    const current = await insurance.get(base.cookie, purchased.orderId);
    await insurance.command(base.cookie, purchased.orderId, {
      clientRequestId: cancelRequestId,
      expectedVersion: current.version,
      type: 'REQUEST_CANCELLATION',
    });
    await insurance.drain(purchased.orderId);
    const cancelled = await insurance.get(base.cookie, purchased.orderId);
    assert.equal(cancelled.policyStatus, 'CANCELLED');
    assert.equal(cancelled.paymentStatus, 'REFUNDED');
    assert.equal(cancelled.refundedFen, 123);
    assert.equal(cancelled.canDownloadDocument, true);
    assert.equal(
      sha((await insurance.document(base.cookie, purchased.orderId)).body),
      sha(syntheticPdf),
      'Historical signed PDF survives provider cancellation without a new document',
    );
    assert.equal(applyCalls, 1);
    assert.equal(cancelCalls, 1);
    assert.equal(queryCalls, 3);
    const saved = {
      sourceDatabase,
      orgId: state.orgId,
      eventId,
      entryId: base.entryId,
      memberId: base.memberId,
      subjectId: subject.id,
      reviewerId,
      materialId: completed.material.id,
      qualificationRequestId: requested.requestId,
      qualificationId: reviewed.qualificationId,
      productId: product.id,
      quoteId: quote.quoteId,
      orderId: purchased.orderId,
      operationId: applyId,
      providerId,
      quoteRequestId,
      purchaseRequestId,
      cancelRequestId,
      qualificationCommandId,
      reviewCommandId,
      noticeEventId,
      documentSha256: sha(syntheticPdf),
    };
    const retained = await snapshot(readPool, saved);
    saved.tables = retained.tables;
    saved.orderIdentityHash = retained.order.identity_hash;
    saved.productIdentityHash = retained.product.identity_hash;
    assert.equal(retained.pending, 0);
    assert.equal(retained.order.authorization_valid, false);
    references(saved);
    return saved;
  } finally {
    insurance.onModuleDestroy();
  }
}
/** SELECT and in-memory decryption only; no restored provider calls or authorization changes. */
export async function verifyExpansionInsurance({ readPool, saved }) {
  references(saved);
  const current = await snapshot(readPool, saved);
  assert.deepEqual(
    current.tables,
    saved.tables,
    'All eleven nonempty insurance/independent-precheck tables survive exactly',
  );
  assert.equal(current.order.payment_status, 'REFUNDED');
  assert.equal(current.order.policy_status, 'CANCELLED');
  assert.equal(current.order.authorization_valid, false);
  assert.equal(current.order.cancellation_requested, true);
  assert.equal(current.pending, 0);
  const archive = (
    await readPool.query(
      'SELECT id,fact_ciphertext FROM insurance_policy_facts WHERE order_id=$1 AND has_document ORDER BY observed_at DESC,id DESC LIMIT 1',
      [saved.orderId],
    )
  ).rows[0];
  assert.ok(archive);
  const fact = openInsurance(dataKey(saved.sourceDatabase), archive.id, archive.fact_ciphertext);
  assert.equal(fact.policyStatus, 'ISSUED');
  assert.equal(sha(Buffer.from(fact.document.base64, 'base64')), saved.documentSha256);
}
export async function verifyExpansionInsuranceQuarantine({ readPool, saved }) {
  references(saved);
  const current = await snapshot(readPool, saved);
  for (const name of tableNames.filter(
    (n) => !['insurance_orders', 'insurance_operations', 'insurance_products'].includes(n),
  ))
    assert.deepEqual(
      current.tables[name],
      saved.tables[name],
      'E03 quarantine retains ' + name + ' source evidence',
    );
  assert.equal(
    current.order.identity_hash,
    saved.orderIdentityHash,
    'Quarantine retains insurance business and encrypted policy identity',
  );
  assert.equal(current.product.active, false, 'Quarantine closes the restored insurance product');
  assert.equal(
    current.product.identity_hash,
    saved.productIdentityHash,
    'Quarantine retains provider product and terms identity',
  );
  assert.equal(current.order.authorization_valid, false);
  assert.equal(current.order.payment_status, 'REFUNDED');
  assert.equal(current.order.policy_status, 'CANCELLED');
  assert.equal(current.pending, 0);
  assert.equal(
    current.tables.insurance_operations.hash,
    saved.tables.insurance_operations.hash,
    'Already DONE original insurance operations are retained',
  );
}
