import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const platformPath = '/v1/platform/software-membership';
const orgPath = (orgId) => `/v1/orgs/${orgId}/software-membership`;
const reason = 'Synthetic isolated membership acceptance; no real funds';

/** All writes use the real HTTP/service API and the original independent payment review. */
export async function captureMembershipSetup({ call, cookie, orgId, operators }) {
  assert.ok(orgId && cookie && operators.length === 2);
  const { plan } = (
    await call(`${platformPath}/plans`, {
      method: 'POST',
      cookie: operators[0].cookie,
      body: {
        commandId: randomUUID(),
        code: `ci_member_${randomUUID().replaceAll('-', '').slice(0, 18)}`,
        name: '隔离CI专业机构年费',
        currency: 'CNY',
        amountFen: 100,
        tier: 'PRO',
        durationDays: 365,
        reason,
      },
    })
  ).data;
  assert.equal(plan.scope, 'ORG_MEMBERSHIP');
  assert.equal(plan.amountFen, 100);
  assert.deepEqual([plan.eventLimit, plan.maxTeams, plan.maxMatches], [36, 16, 128]);
  const workspace = (await call(orgPath(orgId), { cookie })).data;
  assert.equal(workspace.canPurchase, true);
  assert.ok(workspace.purchasablePlanIds.includes(plan.id));
  let order = (
    await call(`${orgPath(orgId)}/orders`, {
      method: 'POST',
      cookie,
      body: {
        commandId: randomUUID(),
        planId: plan.id,
        expectedMembershipVersion: workspace.membershipVersion,
      },
    })
  ).data.order;
  assert.equal(order.eventId, null);
  assert.equal(order.status, 'PENDING_PAYMENT');
  assert.equal(order.quote.scope, 'ORG_MEMBERSHIP');
  assert.equal(order.quote.amountFen, 100);
  const reference = `ci-member-pay-${randomUUID()}`;
  for (const [index, type] of ['SUBMIT_PAYMENT', 'CONFIRM_PAYMENT'].entries()) {
    order = (
      await call(`${platformPath}/orders/${order.id}/commands`, {
        method: 'POST',
        cookie: operators[index].cookie,
        body: {
          commandId: randomUUID(),
          type,
          expectedOrderVersion: order.version,
          reason,
          ...(index === 0 ? { externalReference: reference } : {}),
        },
      })
    ).data.order;
  }
  assert.equal(order.status, 'PAID');
  assert.equal(order.activated, false);
  assert.equal(order.paymentReview.reviewedByUserId, operators[1].userId);
  assert.equal(order.paymentReview.externalReference, reference);
  const current = (await call(orgPath(orgId), { cookie })).data;
  const period = current.periods.find((item) => item.orderId === order.id);
  assert.ok(period);
  assert.deepEqual([period.state, period.usedEvents, period.remainingEvents], ['ACTIVE', 0, 36]);
  assert.equal(Date.parse(period.endsAt) - Date.parse(period.startsAt), 365 * 86400_000);
  // Unlisting a catalog version must not interrupt its already paid service period.
  const retired = (
    await call(`${platformPath}/plans/${plan.id}/commands`, {
      method: 'POST',
      cookie: operators[0].cookie,
      body: {
        commandId: randomUUID(),
        type: 'SET_AVAILABILITY',
        expectedCatalogVersion: plan.catalogVersion,
        available: false,
        reason,
      },
    })
  ).data.plan;
  assert.equal(retired.available, false);
  return { orderId: order.id, periodId: period.id, planId: plan.id, activationEventId: null };
}

/** Quotas and monetary facts are compared, excluding only the server read clock. */
export function membershipFacts(value) {
  const { serverTime: _serverTime, ...rest } = value;
  return {
    ...rest,
    plans: [...value.plans].sort((a, b) => a.id.localeCompare(b.id)),
    orders: value.orders
      .map(({ capabilities: _capabilities, ...order }) => order)
      .sort((a, b) => a.id.localeCompare(b.id)),
    periods: [...value.periods].sort((a, b) => a.id.localeCompare(b.id)),
    allocations: [...value.allocations].sort((a, b) => a.eventId.localeCompare(b.eventId)),
  };
}

export async function captureMembershipEnd({ call, cookie, orgId, setup }) {
  assert.ok(setup.activationEventId, 'The original full lifecycle must consume a real membership');
  const workspace = (await call(orgPath(orgId), { cookie })).data;
  assert.deepEqual(workspace.historyTruncated, {
    plans: false,
    orders: false,
    periods: false,
    allocations: false,
  });
  const period = workspace.periods.find((item) => item.id === setup.periodId);
  assert.deepEqual([period.usedEvents, period.remainingEvents], [1, 35]);
  const allocation = workspace.allocations.find((item) => item.eventId === setup.activationEventId);
  assert.equal(allocation.periodId, period.id);
  assert.equal(allocation.source, 'MEMBERSHIP');
  const order = workspace.orders.find((item) => item.id === setup.orderId);
  assert.equal(order.activated, true);
  assert.equal(order.status, 'PAID');
  return { ...setup, workspace: membershipFacts(workspace) };
}

export async function verifyMembership({ call, cookie, orgId, saved }) {
  assert.ok(saved?.workspace);
  const current = (await call(orgPath(orgId), { cookie })).data;
  assert.deepEqual(
    membershipFacts(current),
    saved.workspace,
    'Membership payment, exact period, consumed quota and original event allocation survive restart/restore',
  );
  assert.equal(current.periods.find((item) => item.id === saved.periodId).usedEvents, 1);
  assert.equal(current.periods.find((item) => item.id === saved.periodId).remainingEvents, 35);
}
