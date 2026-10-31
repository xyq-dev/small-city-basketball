import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ScheduleRevisionData, EventSchedulingData } from '@small-city-basketball/contracts';
import { call, data, error } from './support.js';
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
  validate,
} from './p04-support.js';
import type { Harness } from './p04-support.js';

describe('X03 double round robin persistence with real PostgreSQL', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  }, 30000);

  test('persists and atomically publishes every home/away leg, preserving the source', async () => {
    const c = await court(h.api, h.owner);
    const f = await frozen(h, h.owner, h.teams, { format: 'DOUBLE_ROUND_ROBIN' });
    let r = data<ScheduleRevisionData>(
      await call(h.api, 'post', revisionsPath(h.owner.orgId, f.event.id), {
        cookie: h.owner.cookie,
        body: {
          expectedEventVersion: f.event.version,
          freezeId: f.freeze!.id,
          algorithmVersion: 'DRR_CIRCLE_V1',
          policy: policyFor(f, [c]),
        },
      }),
      201,
    );
    expect(r.algorithmVersion).toBe('DRR_CIRCLE_V1');
    expect(r.fixtures).toHaveLength(12);
    expect(r.rounds).toHaveLength(6);
    const orientations = new Set(r.fixtures.map((x) => `${x.homeEntryId}|${x.awayEntryId}`));
    expect(orientations.size).toBe(12);
    for (const a of f.freeze!.entries)
      for (const b of f.freeze!.entries)
        if (a.entryId !== b.entryId)
          expect(orientations.has(`${a.entryId}|${b.entryId}`)).toBe(true);
    const hashes = [r.inputHash, r.pairingHash];
    r = await allocate(
      h.api,
      h.owner,
      r,
      fullAllocations(r, c, `${f.event.startDate}T08:00:00+08:00`),
    );
    expect(await validate(h.api, h.owner, r)).toMatchObject({ valid: true });
    const result = data<EventSchedulingData>(await publish(h.api, h.owner, r));
    expect(result.publication!.matchCount).toBe(12);
    expect(result.event.status).toBe('SCHEDULED');
    expect([result.currentRevision!.inputHash, result.currentRevision!.pairingHash]).toEqual(
      hashes,
    );
    const counts = (
      await h.api.pool.query(
        `SELECT
      (SELECT count(*)::int FROM published_matches WHERE event_id=$1) AS matches,
      (SELECT count(*)::int FROM court_reservations WHERE publication_id=$2) AS courts,
      (SELECT count(*)::int FROM team_reservations WHERE publication_id=$2) AS teams`,
        [f.event.id, result.publication!.id],
      )
    ).rows[0];
    expect(counts).toEqual({ matches: 12, courts: 12, teams: 24 });
    error(await publish(h.api, h.owner, r), 409);
  });

  test('format and algorithm identities cannot be interchanged', async () => {
    const c = await court(h.api, h.owner);
    for (const format of ['ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN'] as const) {
      const f = await frozen(h, h.owner, h.teams.slice(0, 2), { format });
      const rejected = await call(h.api, 'post', revisionsPath(h.owner.orgId, f.event.id), {
        cookie: h.owner.cookie,
        body: {
          expectedEventVersion: f.event.version,
          freezeId: f.freeze!.id,
          algorithmVersion: format === 'ROUND_ROBIN' ? 'DRR_CIRCLE_V1' : 'RR_CIRCLE_V1',
          policy: policyFor(f, [c]),
        },
      });
      error(rejected, 422);
      expect(rejected.body.error.code).toBe('UNSUPPORTED_EVENT_FORMAT');
      const bronze = await call(h.api, 'post', revisionsPath(h.owner.orgId, f.event.id), {
        cookie: h.owner.cookie,
        body: {
          expectedEventVersion: f.event.version,
          freezeId: f.freeze!.id,
          algorithmVersion: format === 'ROUND_ROBIN' ? 'RR_CIRCLE_V1' : 'DRR_CIRCLE_V1',
          policy: { ...policyFor(f, [c]), thirdPlaceMatch: true },
        },
      });
      error(bronze, 422);
      expect(bronze.body.error.code).toBe('UNSUPPORTED_SCHEDULE_POLICY');
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::int AS n FROM schedule_revisions WHERE event_id=$1',
            [f.event.id],
          )
        ).rows[0].n,
      ).toBe(0);
    }
  });
});
