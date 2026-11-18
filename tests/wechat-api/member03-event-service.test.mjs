import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { PASSWORD, device, http, register, signIn, startServerWith, tap } from './support.mjs';

let server;
after(async () => {
  await server?.close();
});

function orderBodies(d) {
  return d.wx.calls
    .filter(
      (call) =>
        call.type === 'request' &&
        call.method === 'POST' &&
        String(call.url).includes('/commerce/orders') &&
        !String(call.url).includes('/commands'),
    )
    .map((call) => call.data);
}

test('event service purchases through the isolated API without a second charge', async () => {
  server = await startServerWith({
    commerceMode: 'ENFORCED',
    organizationRegistrationEnabled: true,
  });
  const call = http(server);
  const owner = await server.bootstrapOwner({
    email: 'owner@example.test',
    password: PASSWORD,
    displayName: '合成负责人',
    organizationName: '合成茂名篮协',
  });
  const registered = await call('/v1/auth/register', {
    method: 'POST',
    body: {
      email: 'other-owner@example.test',
      password: PASSWORD,
      displayName: '合成第二负责人',
      organizationName: '合成第二机构',
    },
  });
  const otherOrgId = registered.data.organizations[0].id;
  const otherCookie = registered.cookie;
  const login = async (email) =>
    (await call('/v1/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).cookie;
  const ownerCookie = await login('owner@example.test');
  const root = '/v1/orgs/' + owner.organizationId;
  const plannerA = device(server);
  const plannerB = device(server);
  await register(plannerA, 'planner-a@example.test', '合成核验甲');
  await register(plannerB, 'planner-b@example.test', '合成核验乙');
  await register(device(server), 'guest@example.test', '合成无机构');
  await server.grantOperator('planner-a@example.test');
  await server.grantOperator('planner-b@example.test');
  const plannerACookie = await login('planner-a@example.test');
  const plannerBCookie = await login('planner-b@example.test');
  const plan = async (code, amountFen, maxTeams, maxMatches, validDays) =>
    (
      await call('/v1/platform/commerce/plans', {
        method: 'POST',
        cookie: plannerACookie,
        body: {
          commandId: randomUUID(),
          code,
          name: code,
          currency: 'CNY',
          amountFen,
          maxTeams,
          maxMatches,
          validDays,
          reason: '隔离合成目录',
        },
      })
    ).data.plan.id;
  const standardId = await plan('stdevt', 9900, 8, 32, 90);
  const professionalId = await plan('proevt', 29900, 16, 128, 180);
  const wrongSizeId = await plan('oddevt', 14900, 8, 16, 30);
  const createEvent = async (name) =>
    (
      await call(root + '/events', {
        method: 'POST',
        cookie: ownerCookie,
        body: {
          name,
          startDate: '2028-06-01',
          endDate: '2028-06-03',
          timezone: 'Asia/Shanghai',
          format: 'ROUND_ROBIN',
        },
      })
    ).data;
  const first = await createEvent('合成杯甲');
  const second = await createEvent('合成杯乙');
  const third = await createEvent('合成杯丙');
  const fourth = await createEvent('合成杯丁');
  await call('/v1/orgs/' + otherOrgId + '/members/' + owner.userId, {
    method: 'PUT',
    cookie: otherCookie,
    body: { role: 'ORG_ADMIN', status: 'ACTIVE' },
  });

  const d = device(server);
  await signIn(d, 'owner@example.test');
  const page = d.open('pages/event-service/index', { orgId: owner.organizationId });
  await d.settle(page);
  assert.equal(page.page.data.cards[0].digits, '99');
  assert.equal(page.page.data.cards[0].planId, standardId);
  assert.equal(page.page.data.cards[1].digits, '299');
  assert.equal(page.page.data.cards[1].planId, professionalId);
  assert.equal(
    page.page.data.cards.some((card) => card.planId === wrongSizeId),
    false,
  );
  page.page.selectEvent(tap({ id: first.id }));
  const beforeReview = orderBodies(d).length;
  page.page.openReview();
  assert.equal(page.page.data.view, 'review');
  assert.equal(orderBodies(d).length, beforeReview);

  page.page.selectOffer(tap({ offer: 'pro' }));
  page.page.setData({ termsAccepted: true });
  d.approve(2);
  const firstSubmit = page.page.submit();
  const repeatedSubmit = page.page.submit();
  await firstSubmit;
  await repeatedSubmit;
  await d.settle(page);
  const bought = orderBodies(d).filter((body) => body.eventId === first.id);
  assert.equal(bought.length, 1);
  assert.equal(bought[0].planId, professionalId);
  assert.equal(bought[0].expectedEventVersion, first.version);
  let workspace = (await call(root + '/commerce', { cookie: ownerCookie })).data;
  assert.equal(workspace.orders.filter((order) => order.eventId === first.id).length, 1);
  assert.equal(workspace.orders.find((order) => order.eventId === first.id).quote.amountFen, 29900);
  const repeatCount = orderBodies(d).length;
  page.page.setData({ termsAccepted: true });
  await page.page.submit();
  assert.equal(orderBodies(d).length, repeatCount);
  assert.match(page.page.data.error, /不要重复购买/);

  page.page.selectEvent(tap({ id: second.id }));
  page.page.setData({ termsAccepted: true });
  d.dropNextResponse(
    (options) => options.method === 'POST' && String(options.url).includes('/commerce/orders'),
  );
  d.approve(1);
  await page.page.submit();
  await d.settle(page);
  assert.equal(page.page.data.unknown, true);
  const dropped = orderBodies(d).filter((body) => body.eventId === second.id);
  assert.equal(dropped.length, 1);
  page.page.openOrders();
  await page.page.onShow();
  await d.settle(page);
  const restored = orderBodies(d).filter((body) => body.eventId === second.id);
  assert.equal(restored.length, 2);
  assert.equal(restored[1].commandId, dropped[0].commandId);
  workspace = (await call(root + '/commerce', { cookie: ownerCookie })).data;
  assert.equal(workspace.orders.filter((order) => order.eventId === second.id).length, 1);

  page.page.selectOffer(tap({ offer: 'pro' }));
  page.page.selectEvent(tap({ id: third.id }));
  page.page.setData({ termsAccepted: true });
  await call(root + '/events/' + third.id, {
    method: 'PATCH',
    cookie: ownerCookie,
    body: {
      name: '合成杯丙已改',
      startDate: '2028-06-01',
      endDate: '2028-06-03',
      timezone: 'Asia/Shanghai',
      format: 'ROUND_ROBIN',
      expectedVersion: third.version,
    },
  });
  d.approve(1);
  await page.page.submit();
  await d.settle(page);
  assert.equal(page.page.data.unknown, false);
  assert.match(page.page.data.error, /重新|已更新|核对/);
  await page.page.reread();
  await d.settle(page);
  page.page.selectOffer(tap({ offer: 'pro' }));
  page.page.selectEvent(tap({ id: third.id }));
  page.page.setData({ termsAccepted: true });
  d.approve(1);
  await page.page.submit();
  await d.settle(page);
  const conflicted = orderBodies(d).filter((body) => body.eventId === third.id);
  assert.equal(conflicted.length, 2);
  assert.notEqual(conflicted[0].commandId, conflicted[1].commandId);
  assert.equal(conflicted[1].expectedEventVersion, third.version + 1);
  workspace = (await call(root + '/commerce', { cookie: ownerCookie })).data;
  assert.equal(workspace.orders.filter((order) => order.eventId === third.id).length, 1);

  const paid = workspace.orders.find((order) => order.eventId === first.id);
  const submitted = await call('/v1/platform/commerce/orders/' + paid.id + '/commands', {
    method: 'POST',
    cookie: plannerACookie,
    body: {
      commandId: randomUUID(),
      type: 'SUBMIT_PAYMENT',
      expectedOrderVersion: paid.version,
      reason: '隔离合成收款核验',
      externalReference: 'synthetic-m03-1',
    },
  });
  const confirmed = await call('/v1/platform/commerce/orders/' + paid.id + '/commands', {
    method: 'POST',
    cookie: plannerBCookie,
    body: {
      commandId: randomUUID(),
      type: 'CONFIRM_PAYMENT',
      expectedOrderVersion: submitted.data.order.version,
      reason: '隔离合成确认收款',
      externalReference: 'synthetic-m03-1',
    },
  });
  assert.equal(confirmed.data.order.status, 'PAID');
  assert.equal(confirmed.data.order.quote.amountFen, 29900);
  await page.page.reread();
  await d.settle(page);
  page.page.selectEvent(tap({ id: first.id }));
  page.page.setData({ termsAccepted: true });
  const beforeEntitled = orderBodies(d).length;
  await page.page.submit();
  assert.equal(orderBodies(d).length, beforeEntitled);
  const duplicate = await call(root + '/commerce/orders', {
    method: 'POST',
    cookie: ownerCookie,
    expect: [409],
    body: {
      commandId: randomUUID(),
      eventId: first.id,
      planId: professionalId,
      expectedEventVersion: first.version,
    },
  });
  assert.equal(duplicate.status, 409);

  await signIn(d, 'guest@example.test');
  const guestPage = d.open('pages/event-service/index', { orgId: owner.organizationId });
  await d.settle(guestPage);
  assert.equal(guestPage.page.data.orgId, '');
  guestPage.page.setData({ termsAccepted: true });
  const beforeGuest = orderBodies(d).length;
  await guestPage.page.submit();
  assert.equal(orderBodies(d).length, beforeGuest);

  await signIn(d, 'owner@example.test');
  const switched = d.open('pages/event-service/index', { orgId: owner.organizationId });
  await d.settle(switched);
  switched.page.switchOrg(tap({ id: otherOrgId }));
  await d.settle(switched);
  assert.equal(switched.page.data.orgId, otherOrgId);
  assert.equal(switched.page.data.canPurchase, false);
  const beforeSwitch = orderBodies(d).length;
  switched.page.setData({ termsAccepted: true });
  await switched.page.submit();
  assert.equal(orderBodies(d).length, beforeSwitch);

  const direct = await call(root + '/commerce/orders', {
    method: 'POST',
    cookie: ownerCookie,
    expect: [200, 409, 422],
    body: {
      commandId: randomUUID(),
      eventId: fourth.id,
      planId: wrongSizeId,
      expectedEventVersion: fourth.version,
    },
  });
  assert.equal(
    orderBodies(d).some((body) => body.planId === wrongSizeId),
    false,
  );
  console.log('MEMBER03_WRONG_SIZE_DIRECT status=' + direct.status);
});
