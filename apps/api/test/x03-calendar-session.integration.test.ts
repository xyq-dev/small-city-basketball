import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { ORIGIN, call, error, eventually, login } from './support.js';
import type { CallOptions } from './support.js';
import {
  allocate,
  court,
  frozen,
  fullAllocations,
  publishPath,
  revision,
  versions,
} from './p04-support.js';
import { closeHarness, createScoringHarness } from './p05-support.js';
import type { Harness } from './p05-support.js';
import {
  confirmKnockoutMatch,
  knockoutFacts,
  knockoutFixture,
  readKnockout,
  roundCommandsPath,
  roundInput,
} from './c04-support.js';
import {
  input,
  rescheduleCommandsPath,
  rescheduling,
  scheduled,
} from './p04-rescheduling-support.js';

/** The real 029 trigger waits on the shared calendar after the pre-write session check. */
describe(
  'X03 calendar waits cannot commit after the authenticated session expires',
  { concurrent: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness(4);
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    async function facts(eventId: string) {
      return {
        plan: await knockoutFacts(h, eventId),
        extra: (
          await h.api.pool.query(
            `SELECT
        (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.match_id),'[]'::jsonb) FROM scoring_states s WHERE org_id=$1 AND event_id=$2) states,
        (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM match_reschedules r WHERE org_id=$1 AND event_id=$2) reschedules,
        (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.event_id),'[]'::jsonb) FROM event_commercial_activations a WHERE org_id=$1 AND event_id=$2) activation,
        (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM audit_logs a WHERE org_id=$1 AND resource_id IN(SELECT id FROM published_matches WHERE org_id=$1 AND event_id=$2)) match_audit`,
            [h.owner.orgId, eventId],
          )
        ).rows[0],
      };
    }

    async function expireOnCalendar(eventId: string, path: string, body: CallOptions['body']) {
      const application = `x03_calendar_${randomUUID().slice(0, 8)}`;
      const url = new URL(h.databaseUrl);
      url.searchParams.set('application_name', application);
      const short = await createApi({
        databaseUrl: url.toString(),
        appOrigin: ORIGIN,
        sessionTtlSeconds: 2,
      });
      const blocker = await h.api.pool.connect();
      let pending: ReturnType<typeof call> | undefined;
      try {
        const cookie = await login(short, h.owner);
        const before = await facts(eventId);
        await blocker.query('BEGIN');
        await blocker.query('SELECT x12_calendar_lock()');
        pending = call(short, 'post', path, { cookie, body });
        await eventually(
          async () =>
            (
              await h.api.pool.query(
                "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND wait_event='advisory'",
                [application],
              )
            ).rows[0].n,
          (n) => n === 1,
          'The authenticated business writer must really wait on the 029 calendar',
        );
        await blocker.query('SELECT pg_sleep(2.1)');
        await blocker.query('COMMIT');
        const response = await pending;
        error(response, 401);
        expect(await facts(eventId)).toEqual(before);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        if (pending) await pending;
        await short.app.close();
        await short.pool.end();
      }
    }

    test('first publication rolls back the activation, schedule, matches and reservations after the calendar wait', async () => {
      const resource = await court(h.api, h.owner),
        registration = await frozen(h);
      let draft = await revision(h.api, h.owner, registration, [resource]);
      draft = await allocate(
        h.api,
        h.owner,
        draft,
        fullAllocations(draft, resource, `${registration.event.startDate}T09:00:00+08:00`),
      );
      await expireOnCalendar(
        registration.event.id,
        publishPath(h.owner.orgId, draft.id),
        versions(draft),
      );
    });
    test('a reschedule rolls back its proof, scoring source and all resource changes after the calendar wait', async () => {
      const fixture = await scheduled(h),
        access = await rescheduling(h, fixture.matches[0]!.id);
      await expireOnCalendar(
        access.event.id,
        rescheduleCommandsPath(h.owner.orgId, access.match.id),
        input(access),
      );
    });
    test('a next-round publication rolls back its source proof, matches and reservations after the calendar wait', async () => {
      const fixture = await knockoutFixture(h, 3);
      for (const match of fixture.matches) await confirmKnockoutMatch(h, match.id);
      const current = await readKnockout(h, fixture.event.event.id);
      await expireOnCalendar(
        current.event.id,
        roundCommandsPath(h.owner.orgId, current.event.id),
        await roundInput(h, current, fixture.court),
      );
    });
  },
);
