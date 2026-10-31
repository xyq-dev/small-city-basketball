import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { maintainPlatformOperator } from '../apps/api/dist/commerce/platform-operator.js';

const reason = 'Synthetic isolated CI software-service acceptance; no real funds';
const orgPath = (orgId) => `/v1/orgs/${orgId}/commerce`;
const platformPath = '/v1/platform/commerce';
const uuid = (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
function isolatedCluster(databaseUrl, maintenanceUrl) {
  try {
    const runtime = new URL(databaseUrl);
    const maintenance = new URL(maintenanceUrl);
    const database = decodeURIComponent(runtime.pathname.slice(1));
    const allowedHosts = ['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'];
    if (
      !['postgres:', 'postgresql:'].includes(runtime.protocol) ||
      !['postgres:', 'postgresql:'].includes(maintenance.protocol) ||
      !allowedHosts.includes(runtime.hostname) ||
      runtime.hash ||
      maintenance.hash ||
      runtime.hostname !== maintenance.hostname ||
      (runtime.port || '5432') !== (maintenance.port || '5432') ||
      database !== decodeURIComponent(maintenance.pathname.slice(1)) ||
      !/^scb_test_[A-Za-z0-9_]+$/.test(database) ||
      [...runtime.searchParams.keys(), ...maintenance.searchParams.keys()].some(
        (key) => !['application_name', 'sslmode', 'connect_timeout'].includes(key),
      )
    )
      throw new Error();
    return database;
  } catch {
    // Never print either credential-bearing URL, even in a validation error.
    throw new Error('Commerce setup requires matching isolated local scb_test_* database URLs');
  }
}
function sessionCookie(response) {
  const cookies = response.headers.getSetCookie();
  const values = cookies.filter((value) => /^scb\.sid=[A-Za-z0-9_-]{43};/.test(value));
  assert.equal(values.length, 1, 'Synthetic operator must receive exactly one application session');
  return values[0].split(';')[0];
}
function workspace(value, platform = false) {
  assert.equal(
    value.mode,
    'ENFORCED',
    'Commerce acceptance must run with enforced first publication',
  );
  assert.equal(
    value.realPaymentEnabled,
    false,
    'Real payment credentials must remain disabled in CI',
  );
  if (platform) assert.equal(value.platformOperator, true);
  assert.ok(
    Array.isArray(value.orders) && value.orders.length < 100,
    'Acceptance workspace cannot silently truncate orders',
  );
  return value;
}
function paidProof(order, setup) {
  assert.equal(order.status, 'PAID');
  assert.equal(order.channel, 'MANUAL');
  assert.equal(order.quote.amountFen, 100);
  assert.equal(order.quote.planId, setup.plan.id);
  assert.equal(order.paymentReview?.status, 'CONFIRMED');
  assert.equal(order.paymentReview.submittedByUserId, setup.operators[0].userId);
  assert.equal(order.paymentReview.reviewedByUserId, setup.operators[1].userId);
  assert.notEqual(order.createdByUserId, setup.operators[0].userId);
  assert.notEqual(order.createdByUserId, setup.operators[1].userId);
  assert.notEqual(order.paymentReview.submittedByUserId, order.paymentReview.reviewedByUserId);
  assert.ok(order.paidAt);
}
async function platformCommand(call, operator, order, type, extra = {}) {
  return (
    await call(`${platformPath}/orders/${order.id}/commands`, {
      method: 'POST',
      cookie: operator.cookie,
      body: {
        commandId: randomUUID(),
        type,
        expectedOrderVersion: order.version,
        reason,
        ...extra,
      },
    })
  ).data.order;
}

/** The only SQL writer used here is the official, audited offline platform-role helper. */
export async function captureCommerceSetup({ call, databaseUrl, maintenanceUrl }) {
  const database = isolatedCluster(databaseUrl, maintenanceUrl);
  const operators = [];
  const pool = new pg.Pool({
    connectionString: maintenanceUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    const actual = (
      await pool.query('SELECT current_database() AS name,pg_is_in_recovery() AS recovery')
    ).rows[0];
    assert.equal(actual.name, database);
    assert.equal(actual.recovery, false);
    for (let index = 1; index <= 2; index++) {
      const unique = randomUUID().replaceAll('-', '');
      const email = `scb-commerce-ci-${index}-${unique}@example.test`;
      const created = await call('/v1/auth/register-participant', {
        method: 'POST',
        body: {
          email,
          password: `Synthetic-CI-commerce-${unique}`,
          displayName: `隔离平台复核员${index}`,
        },
      });
      assert.deepEqual(created.data.organizations, []);
      assert.deepEqual(created.data.teamContexts, []);
      assert.ok(uuid(created.data.user.id));
      const elevated = await maintainPlatformOperator(pool, { email, status: 'ACTIVE', reason });
      assert.equal(elevated.userId, created.data.user.id);
      operators.push({
        userId: created.data.user.id,
        email,
        cookie: sessionCookie(created.response),
      });
    }
  } finally {
    await pool.end();
  }
  assert.notEqual(operators[0].userId, operators[1].userId);
  for (const operator of operators) {
    const current = workspace((await call(platformPath, { cookie: operator.cookie })).data, true);
    assert.equal(current.orgId, null);
  }
  const { plan } = (
    await call(`${platformPath}/plans`, {
      method: 'POST',
      cookie: operators[0].cookie,
      body: {
        commandId: randomUUID(),
        code: `ci_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        name: '隔离CI每届软件服务',
        currency: 'CNY',
        amountFen: 100,
        maxTeams: 32,
        maxMatches: 1024,
        validDays: 730,
        reason,
      },
    })
  ).data;
  assert.ok(uuid(plan.id));
  assert.deepEqual(
    [plan.amountFen, plan.maxTeams, plan.maxMatches, plan.validDays],
    [100, 32, 1024, 730],
  );
  assert.equal(plan.available, true);
  return { version: 1, database, operators, plan, orderIds: [] };
}

/** Buy one event using original CAS plus independent manual review, before the original publication. */
export async function ensureCommercialEntitlement({ call, cookie, orgId, eventId, setup }) {
  assert.ok(setup?.operators?.length === 2 && setup.plan?.id);
  const existing = workspace((await call(orgPath(orgId), { cookie })).data);
  assert.equal(existing.canPurchase, true);
  let order = existing.orders.find(
    (item) =>
      item.eventId === eventId && item.status === 'PAID' && item.quote.planId === setup.plan.id,
  );
  if (!order) {
    const event = (await call(`/v1/orgs/${orgId}/events/${eventId}`, { cookie })).data;
    assert.ok(Number.isInteger(event.version) && event.version > 0);
    order = (
      await call(`${orgPath(orgId)}/orders`, {
        method: 'POST',
        cookie,
        body: {
          commandId: randomUUID(),
          eventId,
          planId: setup.plan.id,
          expectedEventVersion: event.version,
        },
      })
    ).data.order;
    assert.equal(order.status, 'PENDING_PAYMENT');
    const paymentReference = `ci-payment-${randomUUID()}`;
    order = await platformCommand(call, setup.operators[0], order, 'SUBMIT_PAYMENT', {
      externalReference: paymentReference,
    });
    assert.equal(order.paymentReview.status, 'PENDING_REVIEW');
    order = await platformCommand(call, setup.operators[1], order, 'CONFIRM_PAYMENT');
    assert.equal(order.paymentReview.externalReference, paymentReference);
  }
  paidProof(order, setup);
  const current = workspace((await call(orgPath(orgId), { cookie })).data);
  const entitlement = current.entitlements.find((item) => item.orderId === order.id);
  assert.ok(entitlement, 'Independent confirmed payment must persist the entitlement');
  assert.equal(entitlement.revokedAt, null);
  assert.deepEqual([entitlement.maxTeams, entitlement.maxMatches], [32, 1024]);
  if (!setup.orderIds.includes(order.id)) setup.orderIds.push(order.id);
  return { order, entitlement };
}
function billDate(value) {
  assert.ok(value && Number.isFinite(Date.parse(value)), 'Expected an actual settlement timestamp');
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  return date;
}
function amount(value) {
  assert.ok(Number.isSafeInteger(value) && value > 0);
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}
function manualRows(orders) {
  const byDate = new Map();
  const add = (date, row) => {
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  };
  for (const order of orders.filter((row) => row.channel === 'MANUAL')) {
    assert.equal(order.paymentReview?.status, 'CONFIRMED');
    const paymentReference = order.paymentReview.externalReference;
    assert.ok(typeof paymentReference === 'string' && !/[,\r\n]/.test(paymentReference));
    add(billDate(order.paidAt), [
      order.id,
      paymentReference,
      amount(order.quote.amountFen),
      'CNY',
      'PAID',
    ]);
    if (order.refund?.status === 'SUCCEEDED') {
      assert.ok(
        typeof order.refund.externalReference === 'string' &&
          !/[,\r\n]/.test(order.refund.externalReference),
      );
      add(billDate(order.refund.completedAt), [
        order.id,
        order.refund.externalReference,
        amount(order.refund.amountFen),
        'CNY',
        'REFUNDED',
      ]);
    }
  }
  return byDate;
}
const factualOrder = ({ capabilities: _capabilities, ...facts }) => facts;
function facts(value) {
  return {
    plans: [...value.plans].sort((a, b) => a.id.localeCompare(b.id)),
    orders: value.orders.map(factualOrder).sort((a, b) => a.id.localeCompare(b.id)),
    entitlements: [...value.entitlements].sort((a, b) => a.id.localeCompare(b.id)),
    activations: [...value.activations].sort((a, b) => a.eventId.localeCompare(b.eventId)),
    reconciliations: [...value.reconciliations].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Refund a second, unactivated draft event and reconcile real persisted synthetic manual records. */
export async function captureCommerceEnd({
  call,
  cookie,
  orgId,
  eventId,
  setup,
  organizationReviewerId = null,
}) {
  assert.ok(
    organizationReviewerId === null ||
      setup.operators.some((operator) => operator.userId === organizationReviewerId),
    'The explicit independent organization reviewer must be a known synthetic operator',
  );
  let { order } = await ensureCommercialEntitlement({ call, cookie, orgId, eventId, setup });
  assert.equal(order.activated, false, 'The refund fixture must remain an unpublished draft');
  order = (
    await call(`${orgPath(orgId)}/orders/${order.id}/commands`, {
      method: 'POST',
      cookie,
      body: {
        commandId: randomUUID(),
        type: 'REQUEST_REFUND',
        expectedOrderVersion: order.version,
        reason,
      },
    })
  ).data.order;
  assert.equal(order.refund.status, 'REQUESTED');
  const refundReference = `ci-refund-${randomUUID()}`;
  order = await platformCommand(call, setup.operators[0], order, 'SUBMIT_REFUND', {
    externalReference: refundReference,
  });
  assert.equal(order.refund.status, 'PENDING_REVIEW');
  order = await platformCommand(call, setup.operators[1], order, 'CONFIRM_REFUND');
  assert.equal(order.status, 'REFUNDED');
  assert.equal(order.refund.status, 'SUCCEEDED');
  assert.equal(order.refund.amountFen, 100);
  assert.equal(order.refund.externalReference, refundReference);
  assert.equal(order.refund.requestedByUserId, order.createdByUserId);
  assert.equal(order.refund.submittedByUserId, setup.operators[0].userId);
  assert.equal(order.refund.reviewedByUserId, setup.operators[1].userId);
  const all = workspace(
    (await call(platformPath, { cookie: setup.operators[0].cookie })).data,
    true,
  );
  const reconciliationIds = [];
  for (const [date, rows] of [...manualRows(all.orders)].sort(([a], [b]) => a.localeCompare(b))) {
    const csv = [
      'order_id,transaction_reference,amount,currency,status',
      ...rows.map((row) => row.join(',')),
    ].join('\n');
    const result = (
      await call(`${platformPath}/reconciliations`, {
        method: 'POST',
        cookie: setup.operators[1].cookie,
        body: { commandId: randomUUID(), billDate: date, source: 'MANUAL', csv, reason },
      })
    ).data.reconciliation;
    assert.equal(result.source, 'MANUAL');
    assert.deepEqual(
      result.issues,
      [],
      'The actual persisted manual bill must reconcile without repairs',
    );
    assert.equal(result.matchedCount, rows.length);
    reconciliationIds.push(result.id);
  }
  assert.ok(reconciliationIds.length);
  const organization = workspace((await call(orgPath(orgId), { cookie })).data);
  const platform = workspace(
    (await call(platformPath, { cookie: setup.operators[0].cookie })).data,
    true,
  );
  for (const id of setup.orderIds) {
    const persisted = platform.orders.find((item) => item.id === id);
    assert.ok(persisted);
    if (id !== order.id) {
      paidProof(persisted, setup);
      assert.equal(
        persisted.activated,
        true,
        'Each purchased original publication must activate its own entitlement',
      );
      const entitlement = organization.entitlements.find((item) => item.orderId === id);
      assert.ok(entitlement && !entitlement.revokedAt && entitlement.activated);
      assert.ok(
        organization.activations.some(
          (item) =>
            item.eventId === persisted.eventId &&
            item.source === 'PAID' &&
            item.entitlementId === entitlement.id,
        ),
      );
    }
  }
  const refunded = organization.entitlements.find((item) => item.orderId === order.id);
  assert.ok(refunded?.revokedAt);
  assert.equal(refunded.activated, false);
  assert.ok(!organization.activations.some((item) => item.eventId === eventId));
  assert.ok(
    organization.activations.some((item) => item.source === 'PAID'),
    'At least one original schedule must have activated its paid entitlement',
  );
  const operatorAuthorizations = [];
  for (const operator of setup.operators) {
    const session = (await call('/v1/auth/session', { cookie: operator.cookie })).data;
    assert.equal(session.user.id, operator.userId);
    assert.deepEqual(
      session.organizations.map(({ id, role }) => ({ id, role })),
      operator.userId === organizationReviewerId ? [{ id: orgId, role: 'ORG_ADMIN' }] : [],
      'Only the explicitly reviewed X18 membership may add organization authority',
    );
    assert.deepEqual(session.teamContexts, []);
    operatorAuthorizations.push({
      userId: operator.userId,
      organizations: session.organizations,
      teamContexts: session.teamContexts,
    });
  }
  return {
    version: 2,
    operators: setup.operators,
    operatorAuthorizations,
    planId: setup.plan.id,
    orderIds: setup.orderIds,
    refundOrderId: order.id,
    reconciliationIds,
    organization: facts(organization),
    platform: facts(platform),
  };
}

/** Read-only after actual PostgreSQL restart or full restore, before explicit quarantine. */
export async function verifyCommerce({ call, saved, cookie, orgId }) {
  assert.equal(saved?.version, 2);
  assert.deepEqual(
    saved.operatorAuthorizations.map((authorization) => authorization.userId),
    saved.operators.map((operator) => operator.userId),
    'Every original operator requires its exact captured authorization context',
  );
  for (const [index, operator] of saved.operators.entries()) {
    const session = (await call('/v1/auth/session', { cookie: operator.cookie })).data;
    assert.equal(session.user.id, operator.userId);
    assert.deepEqual(session.organizations, saved.operatorAuthorizations[index].organizations);
    assert.deepEqual(session.teamContexts, saved.operatorAuthorizations[index].teamContexts);
    const capabilities = (await call('/v1/commerce/capabilities', { cookie: operator.cookie }))
      .data;
    assert.equal(capabilities.platformOperator, true);
    assert.equal(capabilities.mode, 'ENFORCED');
    assert.equal(capabilities.realPaymentEnabled, false);
  }
  const organization = workspace((await call(orgPath(orgId), { cookie })).data);
  const platform = workspace(
    (await call(platformPath, { cookie: saved.operators[0].cookie })).data,
    true,
  );
  assert.deepEqual(
    facts(organization),
    saved.organization,
    'Organization billing and activation facts must survive restart/restore',
  );
  assert.deepEqual(
    facts(platform),
    saved.platform,
    'Platform orders, immutable quotes, independent review and reconciliation must survive restart/restore',
  );
  assert.equal(
    platform.orders.find((order) => order.id === saved.refundOrderId)?.status,
    'REFUNDED',
  );
  for (const id of saved.reconciliationIds) {
    const reconciliation = platform.reconciliations.find((row) => row.id === id);
    assert.ok(reconciliation);
    assert.deepEqual(reconciliation.issues, []);
  }
  return {
    orderCount: saved.orderIds.length,
    reconciliationCount: saved.reconciliationIds.length,
    paidActivations: organization.activations.filter((row) => row.source === 'PAID').length,
    manualRefund: 'REFUNDED',
    realPaymentEnabled: false,
  };
}
