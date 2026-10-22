import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  CourtData,
  EventRegistrationData,
  EventSchedulingData,
  ScheduleConflict,
  ScheduleFixtureData,
  ScheduleRevisionData,
  ScheduledMatchData,
} from '@small-city-basketball/contracts';
import { call, data, error, eventually, staffPath } from './support.js';
import type { User } from './support.js';
import {
  allocate,
  allocationsPath,
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
  revisionsPath,
  schedulingPath,
  validate,
  versions,
} from './p04-support.js';
import type { Harness } from './p04-support.js';

type Track = <T>(request: Promise<T>) => Promise<T>;

// These requests run through the real application; the outside transaction only
// pauses a row in the documented lock order, without a production test hook.
async function whileRowLocked(
  h: Harness,
  sql: string,
  values: string[],
  run: (blockingPid: number, release: () => Promise<void>, track: Track) => Promise<void>,
): Promise<void> {
  const blocker = await h.api.pool.connect();
  const pending: Promise<unknown>[] = [];
  let released = false;
  const track: Track = (request) => {
    pending.push(request);
    void request.catch(() => undefined);
    return request;
  };
  try {
    await blocker.query('BEGIN');
    const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
      .pid;
    expect((await blocker.query(sql, values)).rowCount).toBe(1);
    await run(
      pid,
      async () => {
        await blocker.query('COMMIT');
        released = true;
      },
      track,
    );
  } finally {
    try {
      if (!released) await blocker.query('ROLLBACK');
    } finally {
      blocker.release();
      // Free the external lock before draining requests that may still need it.
      await Promise.allSettled(pending);
    }
  }
}

async function counts(h: Harness, owner: User, eventId: string) {
  const result = await h.api.pool.query<{
    publications: number;
    matches: number;
    courtReservations: number;
    teamReservations: number;
  }>(
    `SELECT
      (SELECT count(*)::int FROM schedule_publications WHERE org_id=$1 AND event_id=$2) AS publications,
      (SELECT count(*)::int FROM published_matches WHERE org_id=$1 AND event_id=$2) AS matches,
      (SELECT count(*)::int FROM court_reservations r JOIN published_matches m ON m.org_id=r.org_id AND m.id=r.match_id WHERE m.org_id=$1 AND m.event_id=$2) AS "courtReservations",
      (SELECT count(*)::int FROM team_reservations r JOIN published_matches m ON m.org_id=r.org_id AND m.id=r.match_id WHERE m.org_id=$1 AND m.event_id=$2) AS "teamReservations"`,
    [owner.orgId, eventId],
  );
  return result.rows[0]!;
}

async function expectPublished(
  h: Harness,
  owner: User,
  result: EventSchedulingData,
  matchCount: number,
): Promise<void> {
  expect(result.event.status).toBe('SCHEDULED');
  expect(result.currentRevision?.status).toBe('PUBLISHED');
  expect(result.publication).toMatchObject({ matchCount });
  expect(await counts(h, owner, result.event.id)).toEqual({
    publications: 1,
    matches: matchCount,
    courtReservations: matchCount,
    teamReservations: matchCount * 2,
  });
  const participation = await h.api.pool.query<{
    reservations: number;
    distinctTeams: number;
  }>(
    `SELECT count(r.team_id)::int AS reservations, count(DISTINCT r.team_id)::int AS "distinctTeams"
     FROM published_matches m JOIN team_reservations r ON r.org_id=m.org_id AND r.match_id=m.id
     WHERE m.org_id=$1 AND m.event_id=$2 GROUP BY m.id`,
    [owner.orgId, result.event.id],
  );
  expect(participation.rows).toHaveLength(matchCount);
  for (const match of participation.rows)
    expect(match).toEqual({ reservations: 2, distinctTeams: 2 });
}

async function expectNoPublication(h: Harness, owner: User, eventId: string): Promise<void> {
  expect(await counts(h, owner, eventId)).toEqual({
    publications: 0,
    matches: 0,
    courtReservations: 0,
    teamReservations: 0,
  });
}

function publicationConflicts(response: Response): ScheduleConflict[] {
  error(response, 409);
  expect(response.body.error.code).toBe('SCHEDULE_CONFLICT');
  expect(response.body.error.details.conflicts).toEqual(expect.any(Array));
  return response.body.error.details.conflicts as ScheduleConflict[];
}

async function ready(
  h: Harness,
  owner: User,
  current: EventRegistrationData,
  resource: CourtData,
): Promise<ScheduleRevisionData> {
  let draft = await revision(h.api, owner, current, [resource]);
  draft = await allocate(
    h.api,
    owner,
    draft,
    fullAllocations(draft, resource, `${current.event.startDate}T10:00:00+08:00`),
  );
  expect((await validate(h.api, owner, draft)).valid).toBe(true);
  return draft;
}

async function publicationFingerprint(h: Harness, owner: User, eventId: string) {
  const sources = {
    event: 'SELECT * FROM events WHERE org_id=$1 AND id=$2',
    revisions: 'SELECT * FROM schedule_revisions WHERE org_id=$1 AND event_id=$2',
    fixtures: 'SELECT * FROM schedule_fixtures WHERE org_id=$1 AND event_id=$2',
    publications: 'SELECT * FROM schedule_publications WHERE org_id=$1 AND event_id=$2',
    matches: 'SELECT * FROM published_matches WHERE org_id=$1 AND event_id=$2',
    courtReservations:
      'SELECT r.* FROM court_reservations r JOIN published_matches m ON m.org_id=r.org_id AND m.id=r.match_id WHERE m.org_id=$1 AND m.event_id=$2',
    teamReservations:
      'SELECT r.* FROM team_reservations r JOIN published_matches m ON m.org_id=r.org_id AND m.id=r.match_id WHERE m.org_id=$1 AND m.event_id=$2',
    audit: 'SELECT * FROM audit_logs WHERE org_id=$1 AND resource_id=$2',
  };
  const fingerprint: Record<string, unknown> = {};
  for (const [name, source] of Object.entries(sources)) {
    const result = await h.api.pool.query<{ rows: unknown }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(snapshot_row) ORDER BY to_jsonb(snapshot_row)::text), '[]'::jsonb) AS rows FROM (${source}) snapshot_row`,
      [owner.orgId, eventId],
    );
    fingerprint[name] = result.rows[0]!.rows;
  }
  return fingerprint;
}

describe(
  'P04 resource publication invariants on real PostgreSQL',
  { concurrent: false, shuffle: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createHarness(4);
    }, 60000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    test('the first concurrent publishes serialize even when the organization mutex row is absent', async () => {
      const resource = await court(h.api, h.owner, 'Missing mutex court');
      const first = await frozen(h, h.owner, h.teams.slice(0, 2));
      const second = await frozen(h, h.owner, h.teams.slice(2, 4), {
        startDate: first.event.startDate,
      });
      const a = await ready(h, h.owner, first, resource);
      const b = await ready(h, h.owner, second, resource);
      // Simulate an existing organization predating scheduling. No other org is touched.
      await h.api.pool.query('DELETE FROM org_schedule_mutex WHERE org_id=$1', [h.owner.orgId]);
      expect(
        (
          await h.api.pool.query('SELECT org_id FROM org_schedule_mutex WHERE org_id=$1', [
            h.owner.orgId,
          ])
        ).rowCount,
      ).toBe(0);
      await whileRowLocked(
        h,
        'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [h.owner.orgId, first.event.id],
        async (pid, release, track) => {
          const publishingA = track(publish(h.api, h.owner, a));
          const pidA = await blockedPid(
            h.api.pool,
            pid,
            'First publish never waited for the externally locked event',
          );
          const publishingB = track(publish(h.api, h.owner, b));
          await blockedPid(
            h.api.pool,
            pidA,
            'Second publish did not wait for the newly inserted organization mutex',
          );
          await release();
          await expectPublished(h, h.owner, data<EventSchedulingData>(await publishingA), 1);
          expect(publicationConflicts(await publishingB)).toContainEqual(
            expect.objectContaining({ code: 'COURT_OVERLAP', external: true }),
          );
        },
      );
      expect(
        (
          await h.api.pool.query('SELECT org_id FROM org_schedule_mutex WHERE org_id=$1', [
            h.owner.orgId,
          ])
        ).rowCount,
      ).toBe(1);
      await expectNoPublication(h, h.owner, second.event.id);
    }, 30000);

    test('canonical teams on opposite home/away sides conflict across events even on different courts', async () => {
      const courtA = await court(h.api, h.owner, 'Canonical team court A');
      const courtB = await court(h.api, h.owner, 'Canonical team court B');
      const first = await frozen(h, h.owner, h.teams.slice(0, 3));
      const second = await frozen(h, h.owner, h.teams.slice(0, 3), {
        startDate: first.event.startDate,
      });
      let a = await revision(h.api, h.owner, first, [courtA]);
      let b = await revision(h.api, h.owner, second, [courtB]);
      const canonicalA = new Map(
        a.participants.map((participant) => [participant.entryId, participant.teamId]),
      );
      const canonicalB = new Map(
        b.participants.map((participant) => [participant.entryId, participant.teamId]),
      );
      let overlap: { a: ScheduleFixtureData; b: ScheduleFixtureData; teamId: string } | undefined;
      for (const fixtureA of a.fixtures)
        for (const fixtureB of b.fixtures) {
          if (canonicalA.get(fixtureA.homeEntryId) === canonicalB.get(fixtureB.awayEntryId))
            overlap = { a: fixtureA, b: fixtureB, teamId: canonicalA.get(fixtureA.homeEntryId)! };
          else if (canonicalA.get(fixtureA.awayEntryId) === canonicalB.get(fixtureB.homeEntryId))
            overlap = { a: fixtureA, b: fixtureB, teamId: canonicalA.get(fixtureA.awayEntryId)! };
        }
      expect(overlap).toBeDefined();
      const allocations = (
        draft: ScheduleRevisionData,
        selected: string,
        resource: CourtData,
        otherHours: number[],
      ) => {
        let next = 0;
        return draft.fixtures.map((fixture) => ({
          fixtureKey: fixture.fixtureKey,
          courtId: resource.id,
          startsAt: `${first.event.startDate}T${String(fixture.fixtureKey === selected ? 10 : otherHours[next++]!).padStart(2, '0')}:00:00+08:00`,
        }));
      };
      a = await allocate(
        h.api,
        h.owner,
        a,
        allocations(a, overlap!.a.fixtureKey, courtA, [12, 14]),
      );
      b = await allocate(
        h.api,
        h.owner,
        b,
        allocations(b, overlap!.b.fixtureKey, courtB, [16, 18]),
      );
      expect((await validate(h.api, h.owner, a)).valid).toBe(true);
      expect((await validate(h.api, h.owner, b)).valid).toBe(true);
      await whileRowLocked(
        h,
        'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [h.owner.orgId, first.event.id],
        async (pid, release, track) => {
          const publishingA = track(publish(h.api, h.owner, a));
          const pidA = await blockedPid(
            h.api.pool,
            pid,
            'First canonical-team publish never reached the event lock',
          );
          const publishingB = track(publish(h.api, h.owner, b));
          await blockedPid(
            h.api.pool,
            pidA,
            'Canonical-team competing publish did not serialize on the organization mutex',
          );
          await release();
          await expectPublished(h, h.owner, data<EventSchedulingData>(await publishingA), 3);
          const conflicts = publicationConflicts(await publishingB);
          expect(conflicts).toContainEqual(
            expect.objectContaining({
              code: 'TEAM_OVERLAP',
              resourceId: overlap!.teamId,
              external: true,
            }),
          );
          expect(conflicts.some((conflict) => conflict.code === 'COURT_OVERLAP')).toBe(false);
        },
      );
      await expectNoPublication(h, h.owner, second.event.id);
    }, 30000);

    test('publication revalidates a previously valid draft after another event takes the court', async () => {
      const resource = await court(h.api, h.owner, 'Stale validation court');
      const first = await frozen(h, h.owner, h.teams.slice(0, 2));
      const second = await frozen(h, h.owner, h.teams.slice(2, 4), {
        startDate: first.event.startDate,
      });
      const a = await ready(h, h.owner, first, resource);
      const b = await ready(h, h.owner, second, resource);
      const scopedManager = { ...h.otherOwner, orgId: h.owner.orgId };
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, first.event.id, scopedManager.id), {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
        }),
      );
      error(
        await call(h.api, 'get', schedulingPath(h.owner.orgId, second.event.id), {
          cookie: scopedManager.cookie,
        }),
        404,
      );
      const validation = await validate(h.api, scopedManager, a);
      expect(validation.valid).toBe(true);
      await expectPublished(
        h,
        h.owner,
        data<EventSchedulingData>(await publish(h.api, h.owner, b)),
        1,
      );
      const failed = await publish(h.api, scopedManager, a);
      const conflicts = publicationConflicts(failed);
      expect(conflicts).toContainEqual(
        expect.objectContaining({ code: 'COURT_OVERLAP', external: true }),
      );
      const ownFixtureKeys = new Set(a.fixtures.map((fixture) => fixture.fixtureKey));
      for (const conflict of conflicts)
        for (const key of conflict.fixtureKeys) expect(ownFixtureKeys.has(key)).toBe(true);
      const serialized = JSON.stringify(failed.body);
      for (const privateValue of [
        second.event.id,
        second.event.name,
        ...second.freeze!.entries.map((entry) => entry.teamName),
      ])
        expect(serialized).not.toContain(privateValue);
      await expectNoPublication(h, h.owner, first.event.id);
    });

    test('a publish holding the mutex completes before court disable, which then rejects future reservations', async () => {
      const resource = await court(h.api, h.owner, 'Publish before disable');
      const current = await frozen(h);
      const draft = await ready(h, h.owner, current, resource);
      await whileRowLocked(
        h,
        'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [h.owner.orgId, current.event.id],
        async (pid, release, track) => {
          const publishing = track(publish(h.api, h.owner, draft));
          const publishPid = await blockedPid(
            h.api.pool,
            pid,
            'Publish never waited for the external event lock',
          );
          const disabling = track(
            call(h.api, 'patch', courtPath(h.owner.orgId, resource.id), {
              cookie: h.owner.cookie,
              body: { expectedVersion: resource.version, name: resource.name, status: 'DISABLED' },
            }),
          );
          await blockedPid(
            h.api.pool,
            publishPid,
            'Court disable did not wait for the publish mutex',
          );
          await release();
          await expectPublished(h, h.owner, data<EventSchedulingData>(await publishing), 1);
          const refused = await disabling;
          error(refused, 409);
          expect(refused.body.error.code).toBe('COURT_HAS_RESERVATIONS');
        },
      );
      const stored = await h.api.pool.query<{ status: string; version: number }>(
        'SELECT status,version FROM courts WHERE org_id=$1 AND id=$2',
        [h.owner.orgId, resource.id],
      );
      expect(stored.rows).toEqual([{ status: 'ACTIVE', version: resource.version }]);
      data<CourtData>(
        await call(h.api, 'patch', courtPath(h.owner.orgId, resource.id), {
          cookie: h.owner.cookie,
          body: {
            expectedVersion: resource.version,
            name: `${resource.name}改名`,
            status: 'ACTIVE',
          },
        }),
      );
      const matches = data<ScheduledMatchData[]>(
        await call(h.api, 'get', matchesPath(h.owner.orgId, current.event.id), {
          cookie: h.owner.cookie,
        }),
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]!.courtName).toBe(resource.name);
    }, 30000);

    test('court disable holding the mutex wins before publish and leaves no formal schedule', async () => {
      const resource = await court(h.api, h.owner, 'Disable before publish');
      const current = await frozen(h);
      const draft = await ready(h, h.owner, current, resource);
      await whileRowLocked(
        h,
        'SELECT id FROM courts WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [h.owner.orgId, resource.id],
        async (pid, release, track) => {
          const disabling = track(
            call(h.api, 'patch', courtPath(h.owner.orgId, resource.id), {
              cookie: h.owner.cookie,
              body: { expectedVersion: resource.version, name: resource.name, status: 'DISABLED' },
            }),
          );
          const disablePid = await blockedPid(
            h.api.pool,
            pid,
            'Court disable never waited for the externally locked court',
          );
          const publishing = track(publish(h.api, h.owner, draft));
          await blockedPid(
            h.api.pool,
            disablePid,
            'Publish did not wait for court disable to release its mutex',
          );
          await release();
          expect(data<CourtData>(await disabling)).toMatchObject({
            status: 'DISABLED',
            version: resource.version + 1,
          });
          expect(publicationConflicts(await publishing)).toContainEqual(
            expect.objectContaining({ code: 'COURT_DISABLED', resourceId: resource.id }),
          );
        },
      );
      await expectNoPublication(h, h.owner, current.event.id);
    }, 30000);

    test('a different organization publishes while the first organization still holds its mutex', async () => {
      const courtA = await court(h.api, h.owner, 'Independent org court');
      const courtB = await court(h.api, h.otherOwner, 'Independent org court');
      const first = await frozen(h);
      const second = await frozen(h, h.otherOwner, h.otherTeams, {
        startDate: first.event.startDate,
      });
      const a = await ready(h, h.owner, first, courtA);
      const b = await ready(h, h.otherOwner, second, courtB);
      await whileRowLocked(
        h,
        'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [h.owner.orgId, first.event.id],
        async (pid, release, track) => {
          const publishingA = track(publish(h.api, h.owner, a));
          await blockedPid(
            h.api.pool,
            pid,
            'First organization publish did not reach the external event lock',
          );
          let responseB: Response | undefined;
          const publishingB = track(
            publish(h.api, h.otherOwner, b).then((response) => {
              responseB = response;
              return response;
            }),
          );
          await eventually(
            async () => responseB !== undefined,
            (finished) => finished,
            'Another organization was blocked by an unrelated scheduling mutex',
          );
          await expectPublished(h, h.otherOwner, data<EventSchedulingData>(await publishingB), 1);
          // A is still externally blocked; B succeeded before A could commit.
          await expectNoPublication(h, h.owner, first.event.id);
          await release();
          await expectPublished(h, h.owner, data<EventSchedulingData>(await publishingA), 1);
        },
      );
    }, 30000);

    test('audit failure rolls back all publication facts and the same versions can publish after recovery', async () => {
      const resource = await court(h.api, h.owner, 'Publication audit rollback');
      const current = await frozen(h);
      const draft = await ready(h, h.owner, current, resource);
      const original = await publicationFingerprint(h, h.owner, current.event.id);
      const identifier = `scb_p04_audit_${randomUUID().replaceAll('-', '')}`;
      for (const id of [h.owner.orgId, current.event.id]) expect(id).toMatch(/^[0-9a-f-]{36}$/);
      await h.api.pool.query(
        `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.org_id::text=TG_ARGV[0] AND NEW.resource_id::text=TG_ARGV[1] AND NEW.action='SCHEDULE_PUBLISHED' THEN RAISE EXCEPTION 'p04 publication audit failure'; END IF; RETURN NEW; END $$`,
      );
      try {
        await h.api.pool.query(
          `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}('${h.owner.orgId}','${current.event.id}')`,
        );
        const refused = await publish(h.api, h.owner, draft);
        error(refused, 500);
        expect(JSON.stringify(refused.body)).not.toMatch(
          /p04 publication|audit_logs|postgres|SQLSTATE/i,
        );
        expect(await publicationFingerprint(h, h.owner, current.event.id)).toEqual(original);
        await expectNoPublication(h, h.owner, current.event.id);
      } finally {
        await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
        await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
      }
      await expectPublished(
        h,
        h.owner,
        data<EventSchedulingData>(await publish(h.api, h.owner, draft)),
        1,
      );
    });

    test('published source, fixtures, facts and reservations reject SQL rewrites, deletion and late append', async () => {
      const resource = await court(h.api, h.owner, 'Immutable publication');
      const current = await frozen(h);
      const draft = await ready(h, h.owner, current, resource);
      const published = data<EventSchedulingData>(await publish(h.api, h.owner, draft));
      await expectPublished(h, h.owner, published, 1);
      const original = await publicationFingerprint(h, h.owner, current.event.id);
      const forbiddenWrites = [
        publish(h.api, h.owner, draft),
        call(h.api, 'put', allocationsPath(h.owner.orgId, draft.id), {
          cookie: h.owner.cookie,
          body: {
            ...versions(draft),
            allocations: fullAllocations(
              draft,
              resource,
              `${current.event.startDate}T10:00:00+08:00`,
            ),
          },
        }),
        call(h.api, 'post', revisionsPath(h.owner.orgId, current.event.id), {
          cookie: h.owner.cookie,
          body: {
            expectedEventVersion: published.event.version,
            freezeId: current.freeze!.id,
            algorithmVersion: 'RR_CIRCLE_V1',
            policy: draft.policy,
            redrawReason: '已发布计划不得重抽',
          },
        }),
      ];
      for (const response of await Promise.all(forbiddenWrites)) {
        error(response, 409);
        expect(response.body.error.code).toBe('SCHEDULE_ALREADY_PUBLISHED');
      }
      expect(await publicationFingerprint(h, h.owner, current.event.id)).toEqual(original);
      const mutations = [
        [
          'UPDATE schedule_revisions SET seed=$3 WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, current.event.id, '0'.repeat(64)],
        ],
        [
          'DELETE FROM schedule_revisions WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, current.event.id],
        ],
        [
          "UPDATE schedule_fixtures SET starts_at=starts_at+interval '1 minute',ends_at=ends_at+interval '1 minute' WHERE org_id=$1 AND event_id=$2",
          [h.owner.orgId, current.event.id],
        ],
        [
          'DELETE FROM schedule_fixtures WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, current.event.id],
        ],
        [
          "INSERT INTO schedule_fixtures(org_id,event_id,revision_id,fixture_key,round_no,position_no,home_entry_id,away_entry_id,home_team_id,away_team_id) SELECT org_id,event_id,revision_id,'late-fixture',2,1,home_entry_id,away_entry_id,home_team_id,away_team_id FROM schedule_fixtures WHERE org_id=$1 AND event_id=$2",
          [h.owner.orgId, current.event.id],
        ],
        [
          'UPDATE schedule_publications SET publication_hash=$3 WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, current.event.id, '0'.repeat(64)],
        ],
        [
          'DELETE FROM schedule_publications WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, current.event.id],
        ],
        [
          "UPDATE published_matches SET court_name='改写历史场地',version=version+1 WHERE org_id=$1 AND event_id=$2",
          [h.owner.orgId, current.event.id],
        ],
        [
          'DELETE FROM published_matches WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, current.event.id],
        ],
        [
          'INSERT INTO published_matches SELECT $3::uuid,org_id,event_id,publication_id,revision_id,fixture_key,round_no,position_no,home_entry_id,away_entry_id,home_team_id,away_team_id,home_team_name,away_team_name,home_roster_revision_id,away_roster_revision_id,court_id,court_name,starts_at,ends_at,status,version FROM published_matches WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, current.event.id, randomUUID()],
        ],
        [
          "UPDATE court_reservations SET ends_at=ends_at+interval '1 minute' WHERE org_id=$1 AND publication_id=$2",
          [h.owner.orgId, published.publication!.id],
        ],
        [
          'DELETE FROM court_reservations WHERE org_id=$1 AND publication_id=$2',
          [h.owner.orgId, published.publication!.id],
        ],
        [
          'INSERT INTO court_reservations SELECT * FROM court_reservations WHERE org_id=$1 AND publication_id=$2',
          [h.owner.orgId, published.publication!.id],
        ],
        [
          "UPDATE team_reservations SET ends_at=ends_at+interval '1 minute' WHERE org_id=$1 AND publication_id=$2",
          [h.owner.orgId, published.publication!.id],
        ],
        [
          'DELETE FROM team_reservations WHERE org_id=$1 AND publication_id=$2',
          [h.owner.orgId, published.publication!.id],
        ],
        [
          'INSERT INTO team_reservations SELECT * FROM team_reservations WHERE org_id=$1 AND publication_id=$2',
          [h.owner.orgId, published.publication!.id],
        ],
        [
          'UPDATE events SET current_schedule_revision_id=NULL WHERE org_id=$1 AND id=$2',
          [h.owner.orgId, current.event.id],
        ],
      ] satisfies [string, string[]][];
      for (const [sql, values] of mutations)
        await expect(h.api.pool.query(sql, values), sql).rejects.toMatchObject({ code: '23514' });
      expect(await publicationFingerprint(h, h.owner, current.event.id)).toEqual(original);
    });
  },
);
