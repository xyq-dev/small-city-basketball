import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { PoolClient } from 'pg';
import type {
  CommerceCommandResult,
  CommercePlanData,
  CommerceWorkspaceData,
  EventData,
  EventSchedulingData,
  SessionData,
} from '@small-city-basketball/contracts';
import type {
  CreateSoftwareMembershipOrderInput,
  SoftwareMembershipCommandResult,
  SoftwareMembershipOrderData,
  SoftwareMembershipPeriodData,
  SoftwareMembershipPlanData,
  SoftwareMembershipWorkspaceData,
} from '../../../packages/contracts/membership.js';
import { createApi } from '../src/app.js';
import { hashPassword } from '../src/security.js';
import { activateEventCommerce } from '../src/commerce/activation.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { ORIGIN, PASSWORD, RUN_ID, call, createEvent, data, error, login } from './support.js';
import type { User } from './support.js';
import {
  allocate,
  closeHarness,
  court,
  createHarness,
  frozen,
  fullAllocations,
  publish,
  revision,
} from './p04-support.js';
import type { Harness } from './p04-support.js';

const platformPath = '/v1/platform/software-membership';
const memberPath = (orgId: string) => `/v1/orgs/${orgId}/software-membership`;
const eventCommercePath = (orgId: string) => `/v1/orgs/${orgId}/commerce`;
const reason = '合成隔离会员验收，不涉及真实资金';
const offers = [
  { tier: 'PRO', durationDays: 30, amountFen: 19900, eventLimit: 3, maxTeams: 16, maxMatches: 128 },
  {
    tier: 'PRO',
    durationDays: 365,
    amountFen: 169900,
    eventLimit: 36,
    maxTeams: 16,
    maxMatches: 128,
  },
  {
    tier: 'BUSINESS',
    durationDays: 30,
    amountFen: 39900,
    eventLimit: 10,
    maxTeams: 32,
    maxMatches: 512,
  },
  {
    tier: 'BUSINESS',
    durationDays: 365,
    amountFen: 339900,
    eventLimit: 120,
    maxTeams: 32,
    maxMatches: 512,
  },
] as const;

/** Each fixture uses the original ledger, real SQL guards and a strictly isolated scb_test_* DB. */
describe(
  'MEMBER02 organization memberships on real isolated PostgreSQL',
  { concurrent: false },
  () => {
    let h: Harness;
    let reviewer: User;
    let plans: SoftwareMembershipPlanData[];
    let eventPlan: CommercePlanData;

    beforeAll(async () => {
      h = await createHarness(2);
      await h.api.app.close();
      await h.api.pool.end();
      h.api = await createApi({
        databaseUrl: h.databaseUrl,
        appOrigin: ORIGIN,
        commerceMode: 'ENFORCED',
        backgroundWorkersEnabled: false,
      });
      reviewer = await user('independent-reviewer');
      for (const actor of [h.otherOwner, reviewer])
        await maintainPlatformOperator(h.api.pool, {
          email: actor.email,
          status: 'ACTIVE',
          reason,
        });
      plans = [];
      for (const [index, offer] of offers.entries()) {
        const plan = data<{ plan: SoftwareMembershipPlanData }>(
          await call(h.api, 'post', `${platformPath}/plans`, {
            cookie: h.otherOwner.cookie,
            body: planInput(index, offer),
          }),
        ).plan;
        plans.push(plan);
      }
      eventPlan = data<{ plan: CommercePlanData }>(
        await call(h.api, 'post', '/v1/platform/commerce/plans', {
          cookie: h.otherOwner.cookie,
          body: {
            commandId: randomUUID(),
            code: `m02_event_${RUN_ID.slice(0, 12)}`,
            name: '合成旧按届报价',
            currency: 'CNY',
            amountFen: 9900,
            maxTeams: 2,
            maxMatches: 1,
            validDays: 90,
            reason,
          },
        }),
      ).plan;
    }, 90000);

    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    function planInput(index: number, offer: (typeof offers)[number]) {
      return {
        commandId: randomUUID(),
        code: `m02_${RUN_ID.slice(0, 12)}_${index}`,
        name: `合成${offer.tier}${offer.durationDays}天会员`,
        currency: 'CNY',
        amountFen: offer.amountFen,
        tier: offer.tier,
        durationDays: offer.durationDays,
        reason,
      };
    }

    async function user(label: string, orgId = '', role = 'ORG_OWNER'): Promise<User> {
      const id = randomUUID();
      const result: User = { id, orgId, email: `m02-${label}-${id}@example.test`, cookie: '' };
      await h.api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [id, result.email, `合成会员${label}`, await hashPassword(PASSWORD)],
      );
      if (orgId)
        await h.api.pool.query(
          'INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,$3)',
          [orgId, id, role],
        );
      result.cookie = await login(h.api, result);
      return result;
    }

    async function owner(label: string): Promise<User> {
      const id = randomUUID();
      await h.api.pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
        id,
        `合成会员机构${label}-${id.slice(0, 8)}`,
      ]);
      return user(label, id);
    }

    async function workspace(actor: User, platform = false) {
      return data<SoftwareMembershipWorkspaceData>(
        await call(h.api, 'get', platform ? platformPath : memberPath(actor.orgId), {
          cookie: actor.cookie,
        }),
      );
    }

    async function orderInput(
      actor: User,
      plan = plans[0]!,
    ): Promise<CreateSoftwareMembershipOrderInput> {
      return {
        commandId: randomUUID(),
        planId: plan.id,
        expectedMembershipVersion: (await workspace(actor)).membershipVersion,
      };
    }

    async function purchase(actor: User, plan = plans[0]!) {
      return data<SoftwareMembershipCommandResult>(
        await call(h.api, 'post', `${memberPath(actor.orgId)}/orders`, {
          cookie: actor.cookie,
          body: await orderInput(actor, plan),
        }),
      ).order;
    }

    async function fresh(orderId: string): Promise<SoftwareMembershipOrderData> {
      const current = (await workspace(h.otherOwner, true)).orders.find((o) => o.id === orderId);
      expect(current).toBeDefined();
      return current!;
    }

    async function operatorCommand(
      orderId: string,
      type: string,
      actor = h.otherOwner,
      extra: Record<string, unknown> = {},
    ) {
      return call(h.api, 'post', `${platformPath}/orders/${orderId}/commands`, {
        cookie: actor.cookie,
        body: {
          commandId: randomUUID(),
          type,
          expectedOrderVersion: (await fresh(orderId)).version,
          reason,
          ...extra,
        },
      });
    }

    async function pay(actor: User, plan = plans[0]!) {
      let current = await purchase(actor, plan);
      data(
        await operatorCommand(current.id, 'SUBMIT_PAYMENT', h.otherOwner, {
          externalReference: `m02-payment-${randomUUID()}`,
        }),
      );
      current = data<SoftwareMembershipCommandResult>(
        await operatorCommand(current.id, 'CONFIRM_PAYMENT', reviewer),
      ).order;
      return current;
    }

    async function buyerCommand(actor: User, orderId: string, type: string) {
      return call(h.api, 'post', `${memberPath(actor.orgId)}/orders/${orderId}/commands`, {
        cookie: actor.cookie,
        body: {
          commandId: randomUUID(),
          type,
          expectedOrderVersion: (await fresh(orderId)).version,
          ...(['CANCEL', 'REQUEST_REFUND'].includes(type) ? { reason } : {}),
        },
      });
    }

    async function period(actor: User, orderId: string): Promise<SoftwareMembershipPeriodData> {
      const result = (await workspace(actor)).periods.find((p) => p.orderId === orderId);
      expect(result).toBeDefined();
      return result!;
    }

    async function draftEvent(actor: User) {
      return createEvent(h.api, actor, `合成会员消费-${randomUUID().slice(0, 8)}`);
    }

    async function transactionActivation(
      actor: User,
      eventId: string,
      options: {
        participantCount?: number;
        expectedMatchCount?: number;
        after?: (c: PoolClient) => Promise<void>;
      } = {},
    ) {
      const c = await h.api.pool.connect();
      try {
        await c.query('BEGIN');
        expect(
          (await c.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [actor.orgId]))
            .rowCount,
        ).toBe(1);
        expect(
          (
            await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE', [
              actor.orgId,
              eventId,
            ])
          ).rowCount,
        ).toBe(1);
        await activateEventCommerce(c, {
          orgId: actor.orgId,
          eventId,
          participantCount: options.participantCount ?? 2,
          expectedMatchCount: options.expectedMatchCount ?? 1,
          actorId: actor.id,
          mode: 'ENFORCED',
        });
        await options.after?.(c);
        await c.query('COMMIT');
      } catch (failure) {
        await c.query('ROLLBACK');
        throw failure;
      } finally {
        c.release();
      }
    }

    async function activationRows(actor: User) {
      return (
        await h.api.pool.query(
          'SELECT * FROM event_commercial_activations WHERE org_id=$1 ORDER BY event_id',
          [actor.orgId],
        )
      ).rows;
    }

    async function eventOrder(actor: User, event: Pick<EventData, 'id' | 'version'>) {
      return data<CommerceCommandResult>(
        await call(h.api, 'post', `${eventCommercePath(actor.orgId)}/orders`, {
          cookie: actor.cookie,
          body: {
            commandId: randomUUID(),
            eventId: event.id,
            planId: eventPlan.id,
            expectedEventVersion: event.version,
          },
        }),
      ).order;
    }

    async function payEvent(actor: User, event: Pick<EventData, 'id' | 'version'>) {
      let current = await eventOrder(actor, event);
      const command = async (type: string, operator: User, extra = {}) =>
        call(h.api, 'post', `/v1/platform/commerce/orders/${current.id}/commands`, {
          cookie: operator.cookie,
          body: {
            commandId: randomUUID(),
            type,
            expectedOrderVersion: current.version,
            reason,
            ...extra,
          },
        });
      current = data<CommerceCommandResult>(
        await command('SUBMIT_PAYMENT', h.otherOwner, {
          externalReference: `m02-event-${randomUUID()}`,
        }),
      ).order;
      current = data<CommerceCommandResult>(await command('CONFIRM_PAYMENT', reviewer)).order;
      return current;
    }

    test('the four fixed tier periods derive exact server quotas without changing old EVENT plan quotes', async () => {
      for (const [index, plan] of plans.entries()) {
        const offer = offers[index]!;
        expect(plan).toMatchObject({
          scope: 'ORG_MEMBERSHIP',
          currency: 'CNY',
          amountFen: offer.amountFen,
          tier: offer.tier,
          durationDays: offer.durationDays,
          eventLimit: offer.eventLimit,
          maxTeams: offer.maxTeams,
          maxMatches: offer.maxMatches,
        });
      }
      const original = data<CommerceWorkspaceData>(
        await call(h.api, 'get', '/v1/platform/commerce', { cookie: h.otherOwner.cookie }),
      );
      expect(original.plans.find((p) => p.id === eventPlan.id)).toEqual(eventPlan);
      expect(original.plans.some((p) => plans.some((memberPlan) => memberPlan.id === p.id))).toBe(
        false,
      );
      const actor = await owner('event-quote');
      const current = await eventOrder(actor, await draftEvent(actor));
      expect(current.quote).not.toHaveProperty('scope');
      expect(current.quote).not.toHaveProperty('eventLimit');
      expect(Object.keys(current.quote).sort()).toEqual(
        [
          'planId',
          'code',
          'version',
          'name',
          'currency',
          'amountFen',
          'maxTeams',
          'maxMatches',
          'validDays',
          'hash',
        ].sort(),
      );
      expect(current.eventId).not.toBeNull();
      error(
        await call(h.api, 'post', `${memberPath(actor.orgId)}/orders/${current.id}/commands`, {
          cookie: actor.cookie,
          body: {
            commandId: randomUUID(),
            type: 'CANCEL',
            expectedOrderVersion: current.version,
            reason,
          },
        }),
        404,
      );
    });

    test('plan admission rejects caller supplied quotas, fractional money and unauthorized platform publication', async () => {
      const valid = planInput(100, offers[0]);
      for (const delta of [
        { eventLimit: 120 },
        { maxTeams: 32 },
        { amountFen: 1.5 },
        { amountFen: 0 },
        { durationDays: 31 },
        { tier: 'VIP' },
        { currency: 'USD' },
      ])
        error(
          await call(h.api, 'post', `${platformPath}/plans`, {
            cookie: h.otherOwner.cookie,
            body: { ...valid, commandId: randomUUID(), ...delta },
          }),
          422,
        );
      error(await call(h.api, 'post', `${platformPath}/plans`, { body: valid }), 401);
      error(
        await call(h.api, 'post', `${platformPath}/plans`, { cookie: h.owner.cookie, body: valid }),
        403,
      );
    });

    test('membership reads and purchases preserve authentication, tenant boundaries and owner-only procurement', async () => {
      const actor = await owner('permissions');
      const admin = await user('admin', actor.orgId, 'ORG_ADMIN');
      error(await call(h.api, 'get', memberPath(actor.orgId)), 401);
      error(
        await call(h.api, 'get', memberPath(actor.orgId), { cookie: h.otherOwner.cookie }),
        404,
      );
      error(await call(h.api, 'get', platformPath, { cookie: actor.cookie }), 403);
      const before = (
        await h.api.pool.query(
          'SELECT user_id,role,status FROM organization_memberships WHERE org_id=$1 ORDER BY user_id',
          [actor.orgId],
        )
      ).rows;
      const visible = await workspace(admin);
      expect(visible.organizationName).toContain('合成会员机构permissions');
      expect(visible.canPurchase).toBe(false);
      expect(visible.purchasablePlanIds).toEqual([]);
      error(
        await call(h.api, 'post', `${memberPath(actor.orgId)}/orders`, {
          cookie: admin.cookie,
          body: await orderInput(actor),
        }),
        403,
      );
      const paid = await pay(actor);
      error(
        await call(h.api, 'post', `${memberPath(h.otherOwner.orgId)}/orders/${paid.id}/commands`, {
          cookie: h.otherOwner.cookie,
          body: {
            commandId: randomUUID(),
            type: 'REQUEST_REFUND',
            expectedOrderVersion: paid.version,
            reason,
          },
        }),
        404,
      );
      const after = (
        await h.api.pool.query(
          'SELECT user_id,role,status FROM organization_memberships WHERE org_id=$1 ORDER BY user_id',
          [actor.orgId],
        )
      ).rows;
      expect(after).toEqual(before);
      expect((await workspace(admin)).canPurchase).toBe(false);
      error(await call(h.api, 'get', platformPath, { cookie: actor.cookie }), 403);
    });

    test('a member checkout stores no fake event, preserves its exact quote and supports replay without a second order', async () => {
      const actor = await owner('checkout');
      const beforeEvents = (
        await h.api.pool.query('SELECT id FROM events WHERE org_id=$1', [actor.orgId])
      ).rows;
      const input = await orderInput(actor);
      const checkout = () =>
        call(h.api, 'post', `${memberPath(actor.orgId)}/orders`, {
          cookie: actor.cookie,
          body: input,
        });
      const first = data<SoftwareMembershipCommandResult>(await checkout());
      expect(first.order).toMatchObject({
        eventId: null,
        status: 'PENDING_PAYMENT',
        activated: false,
      });
      expect(first.order.quote).toMatchObject({
        scope: 'ORG_MEMBERSHIP',
        tier: 'PRO',
        eventLimit: 3,
        durationDays: 30,
        previousPeriodId: null,
        amountFen: 19900,
      });
      expect(first.order.quote.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(data<SoftwareMembershipCommandResult>(await checkout())).toEqual(first);
      const stale = await call(h.api, 'post', `${memberPath(actor.orgId)}/orders`, {
        cookie: actor.cookie,
        body: { ...input, commandId: randomUUID() },
      });
      error(stale, 409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
      error(
        await call(h.api, 'post', `${memberPath(actor.orgId)}/orders`, {
          cookie: actor.cookie,
          body: await orderInput(actor),
        }),
        409,
      );
      expect(
        (await h.api.pool.query('SELECT id FROM events WHERE org_id=$1', [actor.orgId])).rows,
      ).toEqual(beforeEvents);
      expect(
        (
          await h.api.pool.query(
            'SELECT event_id,target_kind,quote FROM billing_orders WHERE id=$1',
            [first.order.id],
          )
        ).rows,
      ).toEqual([{ event_id: null, target_kind: 'ORG_MEMBERSHIP', quote: first.order.quote }]);
      expect((await workspace(actor)).periods).toEqual([]);
      error(
        await call(
          h.api,
          'post',
          `${eventCommercePath(actor.orgId)}/orders/${first.order.id}/commands`,
          {
            cookie: actor.cookie,
            body: {
              commandId: randomUUID(),
              type: 'CANCEL',
              expectedOrderVersion: first.order.version,
              reason,
            },
          },
        ),
        404,
      );
    });

    test('only two independent platform reviewers settle one real fixed-second membership period', async () => {
      const actor = await owner('settlement');
      const current = await purchase(actor);
      data(
        await operatorCommand(current.id, 'SUBMIT_PAYMENT', h.otherOwner, {
          externalReference: `m02-independent-${randomUUID()}`,
        }),
      );
      error(await operatorCommand(current.id, 'CONFIRM_PAYMENT', h.otherOwner), 403);
      await h.api.pool.query(
        'INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,$3)',
        [actor.orgId, reviewer.id, 'ORG_ADMIN'],
      );
      try {
        error(await operatorCommand(current.id, 'CONFIRM_PAYMENT', reviewer), 403);
      } finally {
        await h.api.pool.query(
          "UPDATE organization_memberships SET status='DISABLED' WHERE org_id=$1 AND user_id=$2",
          [actor.orgId, reviewer.id],
        );
      }
      const pending = await fresh(current.id);
      const command = {
        commandId: randomUUID(),
        type: 'CONFIRM_PAYMENT',
        expectedOrderVersion: pending.version,
        reason,
      };
      const before = (await h.api.pool.query('SELECT clock_timestamp() AS now')).rows[0]!
        .now as Date;
      const response = await call(h.api, 'post', `${platformPath}/orders/${current.id}/commands`, {
        cookie: reviewer.cookie,
        body: command,
      });
      const paid = data<SoftwareMembershipCommandResult>(response);
      expect(paid.order.status).toBe('PAID');
      expect(paid.order.activated).toBe(false);
      expect(
        data<SoftwareMembershipCommandResult>(
          await call(h.api, 'post', `${platformPath}/orders/${current.id}/commands`, {
            cookie: reviewer.cookie,
            body: command,
          }),
        ),
      ).toEqual(paid);
      const after = (await h.api.pool.query('SELECT clock_timestamp() AS now')).rows[0]!
        .now as Date;
      const p = await period(actor, current.id);
      expect(p).toMatchObject({
        state: 'ACTIVE',
        usedEvents: 0,
        remainingEvents: 3,
        eventLimit: 3,
        previousPeriodId: null,
      });
      expect(p.startsAt).toBe(paid.order.paidAt);
      expect(Date.parse(p.startsAt)).toBeGreaterThanOrEqual(before.getTime());
      expect(Date.parse(p.startsAt)).toBeLessThanOrEqual(after.getTime());
      expect(Date.parse(p.endsAt) - Date.parse(p.startsAt)).toBe(30 * 86400_000);
      expect(
        (
          await h.api.pool.query('SELECT id FROM software_membership_periods WHERE order_id=$1', [
            current.id,
          ])
        ).rowCount,
      ).toBe(1);
    });

    test('disabled real payment cannot start a member payment or manufacture a purchase period', async () => {
      const actor = await owner('provider-disabled');
      const current = await purchase(actor);
      const response = await buyerCommand(actor, current.id, 'CREATE_NATIVE');
      error(response, 503);
      expect(response.body.error.code).toBe('PAYMENT_PROVIDER_DISABLED');
      expect(await fresh(current.id)).toMatchObject({
        status: 'PENDING_PAYMENT',
        paidAt: null,
        channel: null,
      });
      expect((await workspace(actor)).periods).toEqual([]);
    });

    test('real formal publication rolls membership consumption back with a later failure, then activates exactly once', async () => {
      const paid = await pay(h.owner);
      const p = await period(h.owner, paid.id);
      const registration = await frozen(h);
      const resource = await court(h.api, h.owner, '合成会员正式发布场地');
      let draft = await revision(h.api, h.owner, registration, [resource]);
      draft = await allocate(
        h.api,
        h.owner,
        draft,
        fullAllocations(draft, resource, `${registration.event.startDate}T09:00:00+08:00`),
      );
      expect((await period(h.owner, paid.id)).usedEvents).toBe(0);
      const identifier = `m02_publish_rollback_${RUN_ID.slice(0, 12)}`;
      await h.api.pool.query(
        `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_id::text=TG_ARGV[0] THEN RAISE EXCEPTION 'Synthetic MEMBER02 publication failure'; END IF; RETURN NEW; END $$`,
      );
      try {
        await h.api.pool.query(
          `CREATE TRIGGER ${identifier} AFTER INSERT ON schedule_publications FOR EACH ROW EXECUTE FUNCTION ${identifier}('${registration.event.id}')`,
        );
        error(await publish(h.api, h.owner, draft), 500);
        expect((await period(h.owner, paid.id)).usedEvents).toBe(0);
        expect(
          (
            await h.api.pool.query(
              'SELECT event_id FROM event_commercial_activations WHERE event_id=$1',
              [registration.event.id],
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await h.api.pool.query('SELECT id FROM schedule_publications WHERE event_id=$1', [
              registration.event.id,
            ])
          ).rowCount,
        ).toBe(0);
      } finally {
        await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON schedule_publications`);
        await h.api.pool.query(`DROP FUNCTION ${identifier}()`);
      }
      data<EventSchedulingData>(await publish(h.api, h.owner, draft));
      expect(await period(h.owner, paid.id)).toMatchObject({
        usedEvents: 1,
        remainingEvents: 2,
        state: 'ACTIVE',
      });
      expect(await activationRows(h.owner)).toMatchObject([
        {
          event_id: registration.event.id,
          source: 'MEMBERSHIP',
          membership_period_id: p.id,
          participant_count: 2,
          expected_match_count: 1,
        },
      ]);
      await transactionActivation(h.owner, registration.event.id);
      expect((await period(h.owner, paid.id)).usedEvents).toBe(1);
      const original = data<CommerceWorkspaceData>(
        await call(h.api, 'get', eventCommercePath(h.owner.orgId), { cookie: h.owner.cookie }),
      );
      expect(original.orders.some((o) => o.id === paid.id)).toBe(false);
      expect(original.activations.some((a) => a.eventId === registration.event.id)).toBe(false);
    }, 60000);

    test('two events racing the final allowance consume only one slot and a deliberate transaction rollback consumes none', async () => {
      const actor = await owner('last-slot');
      const paid = await pay(actor);
      const rolledBack = await draftEvent(actor);
      await expect(
        transactionActivation(actor, rolledBack.id, {
          after: async () => {
            throw new Error('synthetic rollback');
          },
        }),
      ).rejects.toThrow('synthetic rollback');
      expect((await period(actor, paid.id)).usedEvents).toBe(0);
      for (let i = 0; i < 2; i++) await transactionActivation(actor, (await draftEvent(actor)).id);
      const one = await draftEvent(actor),
        two = await draftEvent(actor);
      const outcomes = await Promise.allSettled([
        transactionActivation(actor, one.id),
        transactionActivation(actor, two.id),
      ]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((o): o is PromiseRejectedResult => o.status === 'rejected');
      expect(rejected?.reason).toMatchObject({ status: 402, code: 'MEMBERSHIP_QUOTA_EXHAUSTED' });
      expect(await period(actor, paid.id)).toMatchObject({
        usedEvents: 3,
        remainingEvents: 0,
        state: 'EXHAUSTED',
      });
      expect(
        (await activationRows(actor)).filter((a) => [one.id, two.id].includes(a.event_id)),
      ).toHaveLength(1);
      expect(
        (
          await h.api.pool.query('SELECT id FROM events WHERE org_id=$1 AND id=$2', [
            actor.orgId,
            rolledBack.id,
          ])
        ).rowCount,
      ).toBe(1);
    });

    test('a paid per-event entitlement takes priority and an insufficient purchased plan never silently consumes member quota', async () => {
      const actor = await owner('per-event-priority');
      const paid = await pay(actor);
      const event = await draftEvent(actor);
      await payEvent(actor, event);
      await transactionActivation(actor, event.id);
      expect((await period(actor, paid.id)).usedEvents).toBe(0);
      expect((await activationRows(actor))[0]).toMatchObject({
        source: 'PAID',
        membership_period_id: null,
      });
      const tooLarge = await draftEvent(actor);
      await payEvent(actor, tooLarge);
      await expect(
        transactionActivation(actor, tooLarge.id, { expectedMatchCount: 2 }),
      ).rejects.toMatchObject({ status: 422, code: 'EVENT_ENTITLEMENT_LIMIT' });
      expect((await period(actor, paid.id)).usedEvents).toBe(0);
      expect(
        (
          await h.api.pool.query(
            'SELECT event_id FROM event_commercial_activations WHERE event_id=$1',
            [tooLarge.id],
          )
        ).rowCount,
      ).toBe(0);
    });

    test('unresolved per-event checkout blocks automatic membership consumption without changing either purchase', async () => {
      const actor = await owner('event-checkout-pending');
      const paid = await pay(actor);
      const event = await draftEvent(actor);
      const pending = await eventOrder(actor, event);
      await expect(transactionActivation(actor, event.id)).rejects.toMatchObject({
        status: 409,
        code: 'EVENT_PURCHASE_REVIEW_REQUIRED',
      });
      expect((await period(actor, paid.id)).usedEvents).toBe(0);
      expect(
        (await h.api.pool.query('SELECT status FROM billing_orders WHERE id=$1', [pending.id]))
          .rows,
      ).toEqual([{ status: 'PENDING_PAYMENT' }]);
    });

    test('unused refund admission freezes new membership activation and independent full refund revokes only its source', async () => {
      const actor = await owner('unused-refund');
      const paid = await pay(actor);
      const event = await draftEvent(actor);
      data(await buyerCommand(actor, paid.id, 'REQUEST_REFUND'));
      expect((await period(actor, paid.id)).state).toBe('REFUND_PENDING');
      await expect(transactionActivation(actor, event.id)).rejects.toMatchObject({ status: 402 });
      expect((await period(actor, paid.id)).usedEvents).toBe(0);
      data(
        await operatorCommand(paid.id, 'SUBMIT_REFUND', h.otherOwner, {
          externalReference: `m02-refund-${randomUUID()}`,
        }),
      );
      error(await operatorCommand(paid.id, 'CONFIRM_REFUND', h.otherOwner), 403);
      const result = data<SoftwareMembershipCommandResult>(
        await operatorCommand(paid.id, 'CONFIRM_REFUND', reviewer),
      );
      expect(result.order).toMatchObject({
        status: 'REFUNDED',
        refund: { status: 'SUCCEEDED', amountFen: 19900 },
      });
      expect(await period(actor, paid.id)).toMatchObject({
        state: 'REVOKED',
        usedEvents: 0,
        revokedAt: expect.any(String),
      });
      await expect(transactionActivation(actor, event.id)).rejects.toMatchObject({ status: 402 });
      expect(await activationRows(actor)).toHaveLength(0);
    });

    test('refund versus first activation is serialized: one outcome wins without a partially refunded consumed period', async () => {
      const actor = await owner('refund-race');
      const paid = await pay(actor);
      const event = await draftEvent(actor);
      const response = call(
        h.api,
        'post',
        `${memberPath(actor.orgId)}/orders/${paid.id}/commands`,
        {
          cookie: actor.cookie,
          body: {
            commandId: randomUUID(),
            type: 'REQUEST_REFUND',
            expectedOrderVersion: paid.version,
            reason,
          },
        },
      );
      const [activation, refund] = await Promise.allSettled([
        transactionActivation(actor, event.id),
        response,
      ]);
      expect(refund.status).toBe('fulfilled');
      if (refund.status !== 'fulfilled') throw refund.reason;
      const result = data<SoftwareMembershipCommandResult>(refund.value);
      const p = await period(actor, paid.id);
      if (activation.status === 'fulfilled') {
        expect(result.order.status).toBe('PAID');
        expect(result.notice).toContain('争议');
        expect(p).toMatchObject({ state: 'ACTIVE', usedEvents: 1, revokedAt: null });
        expect((await fresh(paid.id)).refund).toBeNull();
      } else {
        expect(activation.reason).toMatchObject({ status: 402 });
        expect(result.order.status).toBe('REFUND_PENDING');
        expect(p).toMatchObject({ state: 'REFUND_PENDING', usedEvents: 0, revokedAt: null });
        expect(await activationRows(actor)).toHaveLength(0);
      }
    });

    test('a used period records a refund dispute and preserves its activated event and original ledger', async () => {
      const actor = await owner('used-dispute');
      const paid = await pay(actor);
      const event = await draftEvent(actor);
      await transactionActivation(actor, event.id);
      const result = data<SoftwareMembershipCommandResult>(
        await buyerCommand(actor, paid.id, 'REQUEST_REFUND'),
      );
      expect(result.order.status).toBe('PAID');
      expect(result.order.refund).toBeNull();
      expect(result.notice).toContain('争议');
      await transactionActivation(actor, event.id);
      expect(await period(actor, paid.id)).toMatchObject({
        usedEvents: 1,
        remainingEvents: 2,
        revokedAt: null,
      });
      expect(await activationRows(actor)).toHaveLength(1);
    });

    test('same-month renewal creates one continuous scheduled period and cannot borrow its quota or refund its live predecessor', async () => {
      const actor = await owner('renewal');
      const paid = await pay(actor);
      const original = await period(actor, paid.id);
      const visible = await workspace(actor);
      expect(visible.purchasablePlanIds).toContain(plans[0]!.id);
      expect(visible.purchasablePlanIds).not.toContain(plans[2]!.id);
      const mismatch = await call(h.api, 'post', `${memberPath(actor.orgId)}/orders`, {
        cookie: actor.cookie,
        body: await orderInput(actor, plans[2]!),
      });
      error(mismatch, 409);
      expect(mismatch.body.error.code).toBe('MEMBERSHIP_RENEWAL_MISMATCH');
      let next = await purchase(actor);
      expect(next.quote.previousPeriodId).toBe(original.id);
      const parentRefund = await buyerCommand(actor, paid.id, 'REQUEST_REFUND');
      error(parentRefund, 409);
      expect(parentRefund.body.error.code).toBe('MEMBERSHIP_SUCCESSOR_EXISTS');
      data(
        await operatorCommand(next.id, 'SUBMIT_PAYMENT', h.otherOwner, {
          externalReference: `m02-renewal-${randomUUID()}`,
        }),
      );
      next = data<SoftwareMembershipCommandResult>(
        await operatorCommand(next.id, 'CONFIRM_PAYMENT', reviewer),
      ).order;
      const scheduled = await period(actor, next.id);
      expect(scheduled).toMatchObject({
        state: 'SCHEDULED',
        usedEvents: 0,
        remainingEvents: 3,
        previousPeriodId: original.id,
      });
      expect(scheduled.startsAt).toBe(original.endsAt);
      expect(Date.parse(scheduled.endsAt) - Date.parse(scheduled.startsAt)).toBe(30 * 86400_000);
      expect((await workspace(actor)).purchasablePlanIds).toEqual([]);
      error(
        await call(h.api, 'post', `${memberPath(actor.orgId)}/orders`, {
          cookie: actor.cookie,
          body: await orderInput(actor),
        }),
        409,
      );
      for (let i = 0; i < 3; i++) await transactionActivation(actor, (await draftEvent(actor)).id);
      await expect(
        transactionActivation(actor, (await draftEvent(actor)).id),
      ).rejects.toMatchObject({ status: 402, code: 'MEMBERSHIP_QUOTA_EXHAUSTED' });
      expect(await period(actor, paid.id)).toMatchObject({ state: 'EXHAUSTED', usedEvents: 3 });
      expect(await period(actor, next.id)).toMatchObject({
        state: 'SCHEDULED',
        usedEvents: 0,
        remainingEvents: 3,
      });
    });

    test('the real revocation CHECK rejects null, short and overlong reasons inside an otherwise valid guarded refund window', async () => {
      const actor = await owner('revoke-check');
      const paid = await pay(actor);
      const p = await period(actor, paid.id);
      data(await buyerCommand(actor, paid.id, 'REQUEST_REFUND'));
      data(
        await operatorCommand(paid.id, 'SUBMIT_REFUND', h.otherOwner, {
          externalReference: `m02-revoke-check-${randomUUID()}`,
        }),
      );
      const checks = (
        await h.api.pool.query<{ conname: string }>(
          `SELECT conname FROM pg_constraint WHERE conrelid='software_membership_periods'::regclass
           AND contype='c' AND pg_get_constraintdef(oid) LIKE '%revoke_reason%'`,
        )
      ).rows;
      expect(checks).toHaveLength(1);
      const c = await h.api.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [actor.orgId]);
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `scb-software-membership:${actor.orgId}`,
        ]);
        await c.query('SELECT id FROM billing_orders WHERE id=$1 FOR UPDATE', [paid.id]);
        await c.query('SELECT id FROM software_membership_periods WHERE id=$1 FOR UPDATE', [p.id]);
        // This is a rollback-only synthetic manual proof admitted by the original refund guards.
        // No trigger is disabled, no historical time is rewritten, and the final HTTP refund below
        // still performs the real application's independent review and source revocation.
        await c.query(
          `UPDATE billing_refunds SET status='SUCCEEDED',reviewed_by=$2,review_reason=$3,
           completed_at=clock_timestamp(),accepted_at=clock_timestamp() WHERE order_id=$1`,
          [paid.id, reviewer.id, reason],
        );
        for (const invalidReason of [null, '', '123', 'x'.repeat(501)]) {
          await c.query('SAVEPOINT member02_invalid_reason');
          await expect(
            c.query(
              'UPDATE software_membership_periods SET revoked_at=clock_timestamp(),revoke_reason=$2 WHERE id=$1',
              [p.id, invalidReason],
            ),
          ).rejects.toMatchObject({ code: '23514', constraint: checks[0]!.conname });
          await c.query('ROLLBACK TO SAVEPOINT member02_invalid_reason');
          await c.query('RELEASE SAVEPOINT member02_invalid_reason');
        }
        await c.query(
          'UPDATE software_membership_periods SET revoked_at=clock_timestamp(),revoke_reason=$2 WHERE id=$1',
          [p.id, reason],
        );
        expect(
          (
            await c.query(
              'SELECT revoked_at,revoke_reason FROM software_membership_periods WHERE id=$1',
              [p.id],
            )
          ).rows[0],
        ).toMatchObject({ revoked_at: expect.any(Date), revoke_reason: reason });
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
      expect((await period(actor, paid.id)).revokedAt).toBeNull();
      expect((await fresh(paid.id)).refund?.status).toBe('PENDING_REVIEW');
      data(await operatorCommand(paid.id, 'CONFIRM_REFUND', reviewer));
      expect(await period(actor, paid.id)).toMatchObject({ state: 'REVOKED', usedEvents: 0 });
    });

    test('an annual period uses a fixed 365-day window and rejects renewal earlier than its final 30 days', async () => {
      const actor = await owner('annual');
      const paid = await pay(actor, plans[1]!);
      const p = await period(actor, paid.id);
      expect(p).toMatchObject({ state: 'ACTIVE', eventLimit: 36, remainingEvents: 36 });
      expect(Date.parse(p.endsAt) - Date.parse(p.startsAt)).toBe(365 * 86400_000);
      const state = await workspace(actor);
      expect(state.canPurchase).toBe(false);
      expect(state.purchasablePlanIds).toEqual([]);
      expect(state.purchaseNotice).toContain('30天');
      const tooEarly = await call(h.api, 'post', `${memberPath(actor.orgId)}/orders`, {
        cookie: actor.cookie,
        body: await orderInput(actor, plans[1]!),
      });
      error(tooEarly, 409);
      expect(tooEarly.body.error.code).toBe('MEMBERSHIP_PURCHASE_BLOCKED');
      expect((await workspace(actor)).periods).toHaveLength(1);
    });
  },
);
