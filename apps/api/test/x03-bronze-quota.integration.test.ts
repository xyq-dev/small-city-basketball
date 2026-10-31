import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  CommerceCommandResult,
  CommercePlanData,
  EventFormat,
  ScheduleRevisionData,
} from '@small-city-basketball/contracts';
import { createApi } from '../src/app.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { ORIGIN, call, data, error } from './support.js';
import {
  allocate,
  closeHarness,
  court,
  createHarness,
  frozen,
  fullAllocations,
  policyFor,
  publish,
  revisionsPath,
} from './p04-support.js';
import type { Harness } from './p04-support.js';
import { savePublishRules } from './p05b-support.js';

/** A real paid entitlement is acquired by two distinct synthetic financial operators. */
describe(
  'X03 bronze is included in the full-event commercial match limit',
  { concurrent: false },
  () => {
    let h: Harness;
    const platform = '/v1/platform/commerce';
    const reason = '隔离合成季军赛事额度核验';
    beforeAll(async () => {
      h = await createHarness(8);
      await h.api.app.close();
      await h.api.pool.end();
      h.api = await createApi({
        databaseUrl: h.databaseUrl,
        appOrigin: ORIGIN,
        commerceMode: 'ENFORCED',
      });
      for (const user of [h.otherOwner, h.leader])
        await maintainPlatformOperator(h.api.pool, { email: user.email, status: 'ACTIVE', reason });
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    async function paid(eventId: string, maxMatches: number) {
      const plan = data<{ plan: CommercePlanData }>(
        await call(h.api, 'post', `${platform}/plans`, {
          cookie: h.otherOwner.cookie,
          body: {
            commandId: randomUUID(),
            code: `x03_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
            name: '合成固定场次软件权益',
            currency: 'CNY',
            amountFen: 100,
            maxTeams: 32,
            maxMatches,
            validDays: 365,
            reason,
          },
        }),
      ).plan;
      const event = (await h.api.pool.query('SELECT version FROM events WHERE id=$1', [eventId]))
        .rows[0];
      let order = data<CommerceCommandResult>(
        await call(h.api, 'post', `/v1/orgs/${h.owner.orgId}/commerce/orders`, {
          cookie: h.owner.cookie,
          body: {
            commandId: randomUUID(),
            eventId,
            planId: plan.id,
            expectedEventVersion: event.version,
          },
        }),
      ).order;
      order = data<CommerceCommandResult>(
        await call(h.api, 'post', `${platform}/orders/${order.id}/commands`, {
          cookie: h.otherOwner.cookie,
          body: {
            commandId: randomUUID(),
            type: 'SUBMIT_PAYMENT',
            expectedOrderVersion: order.version,
            reason,
            externalReference: `synthetic-${randomUUID()}`,
          },
        }),
      ).order;
      order = data<CommerceCommandResult>(
        await call(h.api, 'post', `${platform}/orders/${order.id}/commands`, {
          cookie: h.leader.cookie,
          body: {
            commandId: randomUUID(),
            type: 'CONFIRM_PAYMENT',
            expectedOrderVersion: order.version,
            reason,
          },
        }),
      ).order;
      expect(order.status).toBe('PAID');
    }

    async function draft(format: EventFormat, thirdPlaceMatch: boolean) {
      const count = format === 'GROUP_KNOCKOUT' ? 8 : 4;
      const registration = await frozen(h, h.owner, h.teams.slice(0, count), { format });
      const resource = await court(h.api, h.owner, '合成季军额度场地');
      let version = registration.event.version;
      if (format === 'GROUP_KNOCKOUT')
        version = (
          await savePublishRules(h, registration.event.id, {
            winPoints: 2,
            lossPoints: 1,
            drawPoints: 0,
            tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR'],
          })
        ).event.version;
      let schedule = data<ScheduleRevisionData>(
        await call(h.api, 'post', revisionsPath(h.owner.orgId, registration.event.id), {
          cookie: h.owner.cookie,
          body: {
            expectedEventVersion: version,
            freezeId: registration.freeze!.id,
            algorithmVersion: format === 'GROUP_KNOCKOUT' ? 'GK_BALANCED_V1' : 'SE_SEEDED_V1',
            ...(format === 'GROUP_KNOCKOUT'
              ? {
                  groupConfig: {
                    groupCount: 2,
                    seededEntryIds: registration.freeze!.entries.slice(0, 2).map((e) => e.entryId),
                  },
                }
              : {}),
            policy: policyFor(registration, [resource], {
              ...(thirdPlaceMatch ? { thirdPlaceMatch: true } : {}),
            }),
          },
        }),
        201,
      );
      schedule = await allocate(
        h.api,
        h.owner,
        schedule,
        fullAllocations(schedule, resource, `${registration.event.startDate}T09:00:00+08:00`, 120),
      );
      return schedule;
    }

    test.each([
      ['SINGLE_ELIMINATION', false, 3, 3, true],
      ['SINGLE_ELIMINATION', true, 3, 4, false],
      ['SINGLE_ELIMINATION', true, 4, 4, true],
      ['GROUP_KNOCKOUT', true, 15, 16, false],
      ['GROUP_KNOCKOUT', true, 16, 16, true],
    ] as const)(
      '%s bronze=%s max=%i checks all %i matches',
      async (format, bronze, quota, total, allowed) => {
        const schedule = await draft(format, bronze);
        await paid(schedule.eventId, quota);
        const response = await publish(h.api, h.owner, schedule);
        if (!allowed) {
          error(response, 422);
          expect(response.body.error.code).toBe('EVENT_ENTITLEMENT_LIMIT');
          expect(
            (
              await h.api.pool.query(
                `SELECT (SELECT count(*)::int FROM event_commercial_activations WHERE event_id=$1) activations,(SELECT count(*)::int FROM schedule_publications WHERE event_id=$1) publications,(SELECT count(*)::int FROM published_matches WHERE event_id=$1) matches`,
                [schedule.eventId],
              )
            ).rows[0],
          ).toEqual({ activations: 0, publications: 0, matches: 0 });
          return;
        }
        data(response);
        expect(
          (
            await h.api.pool.query(
              'SELECT source,expected_match_count FROM event_commercial_activations WHERE event_id=$1',
              [schedule.eventId],
            )
          ).rows[0],
        ).toEqual({ source: 'PAID', expected_match_count: total });
      },
    );
  },
);
