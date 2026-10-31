import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ScheduleRevisionData } from '@small-city-basketball/contracts';
import type { ScheduleOptimizationPreview } from '../../../packages/contracts/scheduling-completion.js';
import { call, data, error } from './support.js';
import {
  allocate,
  closeHarness,
  court,
  createHarness,
  frozen,
  fullAllocations,
  publish,
  revision,
  revisionPath,
  versions,
} from './p04-support.js';
import type { Harness } from './p04-support.js';

describe('X03 authoritative scheduling optimization with real PostgreSQL', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  }, 30000);
  const preview = (r: ScheduleRevisionData, body: Record<string, unknown> = {}) =>
    call(h.api, 'post', `${revisionPath(h.owner.orgId, r.id)}/optimization-preview`, {
      cookie: h.owner.cookie,
      body: { ...versions(r), ...body },
    });
  test('preview returns a complete legal allocation but creates no reservation or revision', async () => {
    const c = await court(h.api, h.owner),
      f = await frozen(h, h.owner, h.teams);
    const r = await revision(h.api, h.owner, f, [c], {
      courtWindows: [
        {
          courtId: c.id,
          startsAt: `${f.event.startDate}T14:00:00+08:00`,
          endsAt: `${f.event.startDate}T23:00:00+08:00`,
        },
      ],
    });
    const before = await h.api.pool.query('SELECT version FROM schedule_revisions WHERE id=$1', [
      r.id,
    ]);
    const result = data<ScheduleOptimizationPreview>(await preview(r));
    expect(result.algorithm).toBe('BALANCED_SEARCH_V1');
    expect(result.status).toBe('COMPLETE');
    expect(result.allocations).toHaveLength(6);
    expect(result.score.assignedCount).toBe(6);
    expect(result.unassigned).toEqual([]);
    expect(
      (await h.api.pool.query('SELECT version FROM schedule_revisions WHERE id=$1', [r.id])).rows,
    ).toEqual(before.rows);
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int AS n FROM court_reservations WHERE publication_id IN(SELECT id FROM schedule_publications WHERE event_id=$1)',
          [f.event.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const applied = await allocate(h.api, h.owner, r, result.allocations);
    expect(
      data(
        await call(h.api, 'post', `${revisionPath(h.owner.orgId, r.id)}/validate`, {
          cookie: h.owner.cookie,
          body: versions(applied),
        }),
      ),
    ).toMatchObject({ valid: true });
  });
  test('private external occupancy is honored without exposing its event identity', async () => {
    const c = await court(h.api, h.owner),
      first = await frozen(h, h.owner, h.teams.slice(2, 4));
    let occupied = await revision(h.api, h.owner, first, [c]);
    occupied = await allocate(
      h.api,
      h.owner,
      occupied,
      fullAllocations(occupied, c, `${first.event.startDate}T18:00:00+08:00`),
    );
    data(await publish(h.api, h.owner, occupied));
    const second = await frozen(h, h.owner, h.teams.slice(0, 2), {
      startDate: first.event.startDate,
    });
    const r = await revision(h.api, h.owner, second, [c], {
      courtWindows: [
        {
          courtId: c.id,
          startsAt: `${first.event.startDate}T18:00:00+08:00`,
          endsAt: `${first.event.startDate}T20:00:00+08:00`,
        },
      ],
    });
    const result = data<ScheduleOptimizationPreview>(await preview(r));
    expect(result.allocations[0]!.startsAt).toBe(`${first.event.startDate}T11:00:00.000Z`);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(first.event.id);
    expect(serialized).not.toContain(first.event.name);
  });
  test('cross-org, non-manager and stale versions cannot optimize private drafts', async () => {
    const c = await court(h.api, h.owner),
      f = await frozen(h),
      r = await revision(h.api, h.owner, f, [c]);
    error(
      await call(h.api, 'post', `${revisionPath(h.owner.orgId, r.id)}/optimization-preview`, {
        cookie: h.otherOwner.cookie,
        body: versions(r),
      }),
      404,
    );
    error(await preview(r, { expectedRevisionVersion: r.version + 1 }), 409);
    error(
      await call(h.api, 'post', `${revisionPath(h.owner.orgId, r.id)}/optimization-preview`, {
        cookie: h.leader.cookie,
        body: versions(r),
      }),
      404,
    );
  });
  test('published schedules cannot be optimized through the draft endpoint', async () => {
    const c = await court(h.api, h.owner),
      f = await frozen(h);
    let r = await revision(h.api, h.owner, f, [c]);
    r = await allocate(
      h.api,
      h.owner,
      r,
      fullAllocations(r, c, `${f.event.startDate}T10:00:00+08:00`),
    );
    data(await publish(h.api, h.owner, r));
    error(await preview(r), 409);
  });
});
