import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { MatchReschedulingData } from '@small-city-basketball/contracts';
import { call, data, staffPath } from './support.js';
import {
  allocate,
  blockedPid,
  closeHarness,
  court,
  courtPath,
  createHarness,
  frozen,
  fullAllocations,
  matchesPath,
  publish,
  revision,
  revisionPath,
} from './p04-support.js';
import type { Harness } from './p04-support.js';
import {
  acquire,
  assign,
  envelope,
  prepare,
  published,
  sendCommand,
  workbench,
} from './p05-support.js';
import { withRowsLocked } from './p05b-support.js';
import {
  assertReservations,
  conflicts,
  currentFacts,
  rejected,
  reschedule,
  rescheduling,
  scheduled,
} from './p04-rescheduling-support.js';

describe('P04-B shared resource and scoring races on real PostgreSQL', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  }, 30000);

  test('external court occupancy blocks a change without disclosing an unreadable event', async () => {
    const resource = await court(h.api, h.owner, '跨赛事占用');
    const target = await scheduled(h, { courts: [resource] });
    const hidden = await scheduled(h, {
      teams: h.teams.slice(2, 4),
      courts: [resource],
      startDate: target.registration.event.startDate,
      startsAt: `${target.registration.event.startDate}T12:00:00+08:00`,
    });
    data(
      await call(
        h.api,
        'put',
        staffPath(h.owner.orgId, target.registration.event.id, h.otherOwner.id),
        {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
        },
      ),
    );
    const current = await rescheduling(h, target.matches[0]!.id, h.otherOwner);
    const response = await reschedule(
      h,
      current,
      { startsAt: hidden.matches[0]!.startsAt },
      h.otherOwner,
    );
    const details = conflicts(response, 'COURT_OVERLAP');
    expect(details).toContainEqual(expect.objectContaining({ external: true }));
    const serialized = JSON.stringify(response.body.error.details);
    for (const privateFact of [
      hidden.registration.event.id,
      hidden.registration.event.name,
      hidden.matches[0]!.id,
      hidden.matches[0]!.home.teamName,
      hidden.matches[0]!.away.teamName,
    ])
      expect(serialized.includes(privateFact)).toBe(false);
    expect((await rescheduling(h, current.match.id)).history).toEqual([]);
    await assertReservations(h, current);
  });

  test('concurrent changes across events cannot double-book the same canonical team on different courts', async () => {
    const courtA = await court(h.api, h.owner, '球队占用 A');
    const courtB = await court(h.api, h.owner, '球队占用 B');
    const a = await scheduled(h, { courts: [courtA] });
    const b = await scheduled(h, {
      courts: [courtB],
      startDate: a.registration.event.startDate,
      startsAt: `${a.registration.event.startDate}T15:00:00+08:00`,
    });
    const first = await rescheduling(h, a.matches[0]!.id);
    const second = await rescheduling(h, b.matches[0]!.id);
    const target = `${a.registration.event.startDate}T12:00:00+08:00`;
    await withRowsLocked(
      h,
      'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
      [h.owner.orgId, first.event.id],
      1,
      async (pid, unlock, track) => {
        const changingA = track(reschedule(h, first, { startsAt: target }));
        const firstPid = await blockedPid(
          h.api.pool,
          pid,
          'The first change did not reach its locked event',
        );
        const changingB = track(reschedule(h, second, { startsAt: target }));
        await blockedPid(
          h.api.pool,
          firstPid,
          'The second event did not wait on the organization schedule mutex',
        );
        await unlock();
        const changed = data<MatchReschedulingData>(await changingA);
        expect(conflicts(await changingB, 'TEAM_OVERLAP')).toContainEqual(
          expect.objectContaining({ external: true }),
        );
        await assertReservations(h, changed);
      },
    );
    expect((await rescheduling(h, second.match.id)).match).toEqual(second.match);
    expect((await rescheduling(h, second.match.id)).history).toEqual([]);
  });

  test('a reschedule and a new publication competing for one court cannot both commit', async () => {
    const resource = await court(h.api, h.owner, '改期与发布');
    const a = await scheduled(h, { courts: [resource] });
    const registration = await frozen(h, h.owner, h.teams.slice(2, 4), {
      startDate: a.registration.event.startDate,
    });
    let draft = await revision(h.api, h.owner, registration, [resource]);
    const target = `${registration.event.startDate}T12:00:00+08:00`;
    draft = await allocate(h.api, h.owner, draft, fullAllocations(draft, resource, target));
    const current = await rescheduling(h, a.matches[0]!.id);
    await withRowsLocked(
      h,
      'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
      [h.owner.orgId, current.event.id],
      1,
      async (pid, unlock, track) => {
        const changing = track(reschedule(h, current, { startsAt: target }));
        const changePid = await blockedPid(
          h.api.pool,
          pid,
          'Rescheduling did not reach the locked event',
        );
        const publishing = track(publish(h.api, h.owner, draft));
        await blockedPid(
          h.api.pool,
          changePid,
          'Publication did not wait on the existing schedule mutex',
        );
        await unlock();
        data(await changing);
        conflicts(await publishing, 'COURT_OVERLAP');
      },
    );
    const stillDraft = data<{ status: string }>(
      await call(h.api, 'get', revisionPath(h.owner.orgId, draft.id), { cookie: h.owner.cookie }),
    );
    expect(stillDraft.status).toBe('DRAFT');
    expect(
      data(
        await call(h.api, 'get', matchesPath(h.owner.orgId, registration.event.id), {
          cookie: h.owner.cookie,
        }),
      ),
    ).toEqual([]);
  });

  test('court disable and incoming reschedule share the mutex in either queue order', async () => {
    for (const disableFirst of [true, false]) {
      const fixture = await scheduled(h);
      const current = await rescheduling(h, fixture.matches[0]!.id);
      const target = fixture.courts[1]!;
      const before = await currentFacts(h, current.event.id, current.match.id);
      const disable = () =>
        call(h.api, 'patch', courtPath(h.owner.orgId, target.id), {
          cookie: h.owner.cookie,
          body: { expectedVersion: target.version, name: target.name, status: 'DISABLED' },
        });
      const change = () => reschedule(h, current, { courtId: target.id });
      await withRowsLocked(
        h,
        'SELECT org_id FROM org_schedule_mutex WHERE org_id=$1 FOR UPDATE',
        [h.owner.orgId],
        1,
        async (pid, unlock, track) => {
          const first = track(disableFirst ? disable() : change());
          const firstPid = await blockedPid(
            h.api.pool,
            pid,
            'First court operation did not wait on the mutex',
          );
          const second = track(disableFirst ? change() : disable());
          await blockedPid(
            h.api.pool,
            firstPid,
            'Second court operation did not queue behind the first',
          );
          await unlock();
          data(await first);
          const loser = await second;
          if (disableFirst) conflicts(loser, 'COURT_DISABLED');
          else rejected(loser, 409);
        },
      );
      if (disableFirst)
        expect(await currentFacts(h, current.event.id, current.match.id)).toEqual(before);
      else {
        const changed = await rescheduling(h, current.match.id);
        expect(changed.match.courtId).toBe(target.id);
        expect(changed.history).toHaveLength(1);
        await assertReservations(h, changed);
      }
    }
  });

  test('PREPARE and START races recheck versions and state after the event lock in both queue orders', async () => {
    for (const phase of ['PREPARE_MATCH', 'START_MATCH'] as const) {
      for (const scoringFirst of [true, false]) {
        const fixture = await published(h, h.teams.slice(0, 2), { periodDurationSeconds: 600 });
        const id = fixture.matches[0]!.id;
        if (phase === 'START_MATCH') {
          await assign(h, id, h.otherOwner);
          await prepare(h, id);
        }
        const lease = phase === 'START_MATCH' ? await acquire(h, id) : undefined;
        const actor = phase === 'START_MATCH' ? h.otherOwner : h.owner;
        const scoring = await workbench(h, id, actor);
        const current = await rescheduling(h, id);
        const command = envelope(
          scoring.match.version,
          { type: phase, payload: { expectedEventVersion: scoring.event.version } },
          lease,
        );
        const writeScoring = () => sendCommand(h, id, actor, command);
        const change = () => reschedule(h, current);
        await withRowsLocked(
          h,
          'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
          [h.owner.orgId, current.event.id],
          1,
          async (pid, unlock, track) => {
            const first = track(scoringFirst ? writeScoring() : change());
            const firstPid = await blockedPid(
              h.api.pool,
              pid,
              'The first state command did not wait for the event',
            );
            const second = track(scoringFirst ? change() : writeScoring());
            await blockedPid(
              h.api.pool,
              firstPid,
              'The second state command did not queue behind the first',
            );
            await unlock();
            data(await first);
            const loser = await second;
            rejected(loser, 409);
            expect(['VERSION_CONFLICT', 'MATCH_CANNOT_RESCHEDULE']).toContain(
              loser.body.error.code,
            );
          },
        );
        const after = await rescheduling(h, id);
        expect(after.history).toHaveLength(scoringFirst ? 0 : 1);
        if (phase === 'START_MATCH' && scoringFirst) expect(after.match.status).toBe('LIVE');
        await assertReservations(h, after);
      }
    }
  }, 60000);
});
