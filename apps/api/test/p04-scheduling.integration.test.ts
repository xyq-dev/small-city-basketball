import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  CourtData,
  EventSchedulingData,
  ScheduleRevisionData,
  ScheduledMatchData,
  TeamData,
} from '@small-city-basketball/contracts';
import { call, data, error, membersPath, staffPath } from './support.js';
import { allPages, openRegistration, registrationCommand, team, teamPath } from './p03-support.js';
import {
  allocate,
  allocationsPath,
  closeHarness,
  court,
  courtPath,
  courtsPath,
  createHarness,
  frozen,
  fullAllocations,
  matchesPath,
  plusDays,
  plusMinutes,
  policyFor,
  publish,
  publishPath,
  revision,
  revisionPath,
  revisionsPath,
  schedulingPath,
  validate,
  validatePath,
  versions,
} from './p04-support.js';
import type { Harness } from './p04-support.js';

describe(
  'P04-A scheduling HTTP and PostgreSQL contracts',
  { concurrent: false, shuffle: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createHarness(33);
    }, 60000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    for (const count of [2, 3, 4, 32])
      test(
        `${count} frozen teams generate a complete round robin with stable persisted source and pairings`,
        async () => {
          const current = await frozen(h, h.owner, h.teams.slice(0, count));
          const resource = await court(h.api, h.owner);
          const draft = await revision(h.api, h.owner, current, [resource]);
          expect(draft).toMatchObject({
            freezeId: current.freeze!.id,
            algorithmVersion: 'RR_CIRCLE_V1',
            status: 'DRAFT',
            eventVersion: current.event.version + 1,
            version: 1,
            isCurrent: true,
          });
          expect(draft.seed).toMatch(/^[0-9a-f]{64}$/);
          expect(draft.inputHash).toMatch(/^[0-9a-f]{64}$/);
          expect(draft.pairingHash).toMatch(/^[0-9a-f]{64}$/);
          expect(draft.source).toEqual(current.freeze);
          expect(draft.fixtures).toHaveLength((count * (count - 1)) / 2);
          expect(draft.rounds).toHaveLength(count % 2 ? count : count - 1);
          const ids = current.freeze!.entries.map((item) => item.entryId);
          expect(draft.participants.map((item) => item.entryId).sort()).toEqual([...ids].sort());
          const pairs = new Set<string>();
          const appearances = new Map(ids.map((id) => [id, 0]));
          const byes = new Map(ids.map((id) => [id, 0]));
          for (const round of draft.rounds) {
            const played = new Set<string>();
            const fixtures = draft.fixtures.filter((item) => item.roundNo === round.roundNo);
            expect(fixtures).toHaveLength(Math.floor(count / 2));
            for (const fixture of fixtures) {
              expect(fixture.homeEntryId).not.toBe(fixture.awayEntryId);
              for (const id of [fixture.homeEntryId, fixture.awayEntryId]) {
                expect(ids).toContain(id);
                expect(played.has(id)).toBe(false);
                played.add(id);
                appearances.set(id, appearances.get(id)! + 1);
              }
              const key = [fixture.homeEntryId, fixture.awayEntryId].sort().join('|');
              expect(pairs.has(key)).toBe(false);
              pairs.add(key);
              expect(fixture).toMatchObject({ courtId: null, startsAt: null, endsAt: null });
            }
            if (count % 2) {
              expect(round.byeEntryId).not.toBeNull();
              expect(played.has(round.byeEntryId!)).toBe(false);
              expect(ids).toContain(round.byeEntryId);
              byes.set(round.byeEntryId!, byes.get(round.byeEntryId!)! + 1);
            } else expect(round.byeEntryId).toBeNull();
          }
          expect([...appearances.values()]).toEqual(Array(count).fill(count - 1));
          expect([...byes.values()]).toEqual(Array(count).fill(count % 2));
          const reread = data<ScheduleRevisionData>(
            await call(h.api, 'get', revisionPath(h.owner.orgId, draft.id), {
              cookie: h.owner.cookie,
            }),
          );
          expect(reread).toEqual(draft);
          const initialValidation = await validate(h.api, h.owner, draft);
          expect(initialValidation.valid).toBe(false);
          expect(initialValidation.conflicts.length).toBeGreaterThan(0);
          expect(initialValidation.conflicts.every((item) => item.code === 'UNASSIGNED')).toBe(
            true,
          );
        },
        count === 32 ? 60000 : 30000,
      );

    test('missing/wrong freeze, unsupported format, count and algorithm fail without creating a revision', async () => {
      const resource = await court(h.api, h.owner);
      let noFreeze = await openRegistration(h.api, h.owner, '排赛缺少freeze');
      noFreeze = await registrationCommand(h.api, h.owner, noFreeze, 'CLOSE_REGISTRATION');
      const request = (current: typeof noFreeze, overrides: object = {}) =>
        call(h.api, 'post', revisionsPath(h.owner.orgId, current.event.id), {
          cookie: h.owner.cookie,
          body: {
            expectedEventVersion: current.event.version,
            freezeId: current.freeze?.id ?? randomUUID(),
            algorithmVersion: 'RR_CIRCLE_V1',
            policy: policyFor(current, [resource]),
            ...overrides,
          },
        });
      const missing = await request(noFreeze);
      error(missing, 422);
      expect(missing.body.error.code).toBe('REGISTRATION_FREEZE_REQUIRED');
      const valid = await frozen(h);
      const wrong = await request(valid, { freezeId: randomUUID() });
      error(wrong, 422);
      expect(wrong.body.error.code).toBe('REGISTRATION_FREEZE_REQUIRED');
      const unsupportedAlgorithm = await request(valid, { algorithmVersion: 'RR_CIRCLE_V2' });
      error(unsupportedAlgorithm, 422);
      expect(unsupportedAlgorithm.body.error.code).toBe('UNSUPPORTED_SCHEDULE_ALGORITHM');
      for (const format of ['GROUP_KNOCKOUT', 'SINGLE_ELIMINATION'] as const) {
        const current = await frozen(h, h.owner, h.teams.slice(0, 2), { format });
        const response = await request(current);
        error(response, 422);
        expect(response.body.error.code).toBe('UNSUPPORTED_EVENT_FORMAT');
      }
      const tooMany = await frozen(h, h.owner, h.teams);
      const response = await request(tooMany);
      error(response, 422);
      expect(response.body.error.code).toBe('UNSUPPORTED_TEAM_COUNT');
      expect(
        data<EventSchedulingData>(
          await call(h.api, 'get', schedulingPath(h.owner.orgId, tooMany.event.id), {
            cookie: h.owner.cookie,
          }),
        ).currentRevision,
      ).toBeNull();
    }, 60000);

    test('redraw creates a new seeded source, preserves history and rejects writes or publication through a superseded revision', async () => {
      const current = await frozen(h, h.owner, h.teams.slice(0, 3));
      const resource = await court(h.api, h.owner);
      const first = await revision(h.api, h.owner, current, [resource]);
      const base = {
        expectedEventVersion: first.eventVersion,
        freezeId: current.freeze!.id,
        algorithmVersion: 'RR_CIRCLE_V1',
        policy: first.policy,
      };
      for (const reason of [undefined, ' ', '理'.repeat(501)])
        error(
          await call(h.api, 'post', revisionsPath(h.owner.orgId, current.event.id), {
            cookie: h.owner.cookie,
            body: { ...base, redrawReason: reason },
          }),
          422,
        );
      error(
        await call(h.api, 'post', revisionsPath(h.owner.orgId, current.event.id), {
          cookie: h.owner.cookie,
          body: { ...base, redrawReason: '重抽', seed: first.seed },
        }),
        422,
      );
      const next = data<ScheduleRevisionData>(
        await call(h.api, 'post', revisionsPath(h.owner.orgId, current.event.id), {
          cookie: h.owner.cookie,
          body: { ...base, redrawReason: '场馆安排调整，重新抽签' },
        }),
        201,
      );
      expect(next).toMatchObject({
        previousRevisionId: first.id,
        redrawReason: '场馆安排调整，重新抽签',
        eventVersion: first.eventVersion + 1,
      });
      expect(next.seed).not.toBe(first.seed);
      const old = data<ScheduleRevisionData>(
        await call(h.api, 'get', revisionPath(h.owner.orgId, first.id), { cookie: h.owner.cookie }),
      );
      expect(old).toMatchObject({
        status: 'SUPERSEDED',
        isCurrent: false,
        seed: first.seed,
        inputHash: first.inputHash,
        pairingHash: first.pairingHash,
        source: first.source,
        fixtures: first.fixtures,
      });
      for (const response of [
        await call(h.api, 'put', allocationsPath(h.owner.orgId, old.id), {
          cookie: h.owner.cookie,
          body: {
            ...versions(old),
            allocations: fullAllocations(
              old,
              resource,
              `${current.event.startDate}T09:00:00+08:00`,
            ),
          },
        }),
        await publish(h.api, h.owner, old),
      ]) {
        error(response, 409);
        expect(response.body.error.code).toBe('SCHEDULE_REVISION_NOT_CURRENT');
      }
    });

    test('freeze remains the sole source after long-term team names and members change', async () => {
      const originalTeams = [
        await team(h.api, h.owner, '历史freeze甲', h.leader, ['历史甲一', '历史甲二']),
        await team(h.api, h.owner, '历史freeze乙', h.leader, ['历史乙一', '历史乙二']),
      ];
      const current = await frozen(h, h.owner, originalTeams);
      const target = originalTeams[0]!;
      const changed = data<TeamData>(
        await call(h.api, 'patch', teamPath(h.owner.orgId, target.id), {
          cookie: h.leader.cookie,
          body: { expectedVersion: target.version, name: '未来长期队名' },
        }),
      );
      data(
        await call(h.api, 'put', `${teamPath(h.owner.orgId, target.id)}/members`, {
          cookie: h.leader.cookie,
          body: {
            expectedVersion: changed.version,
            members: [{ name: '未来球员一' }, { name: '未来球员二' }],
          },
        }),
      );
      const resource = await court(h.api, h.owner);
      const draft = await revision(h.api, h.owner, current, [resource]);
      expect(draft.source).toEqual(current.freeze);
      expect(draft.participants.find((item) => item.teamId === target.id)!.teamName).toBe(
        target.name,
      );
      expect(
        draft.source.entries
          .find((item) => item.teamId === target.id)!
          .players.map((item) => item.name)
          .sort(),
      ).toEqual(target.members.map((item) => item.name).sort());
      expect(draft.eventVersion).toBeGreaterThan(draft.source.eventVersion);
    });

    test('full allocation replacement enforces both CAS tokens, exact fixture coverage and immutable matchup fields', async () => {
      const current = await frozen(h, h.owner, h.teams.slice(0, 3));
      const resource = await court(h.api, h.owner);
      const draft = await revision(h.api, h.owner, current, [resource]);
      const allocations = fullAllocations(
        draft,
        resource,
        `${current.event.startDate}T09:00:00+08:00`,
      );
      for (const invalid of [
        allocations.slice(1),
        [...allocations, allocations[0]!],
        allocations.map((item, index) =>
          index === 1 ? { ...item, fixtureKey: allocations[0]!.fixtureKey } : item,
        ),
        allocations.map((item, index) =>
          index === 0 ? { ...item, fixtureKey: 'unknown-key' } : item,
        ),
        allocations.map((item, index) => (index === 0 ? { ...item, startsAt: null } : item)),
        allocations.map((item, index) =>
          index === 0 ? { ...item, homeEntryId: randomUUID() } : item,
        ),
        allocations.map((item, index) =>
          index === 0 ? { ...item, startsAt: '2028-02-30T09:00:00+08:00' } : item,
        ),
        allocations.map((item, index) =>
          index === 0 ? { ...item, startsAt: `${current.event.startDate}T09:00:00` } : item,
        ),
      ])
        error(
          await call(h.api, 'put', allocationsPath(h.owner.orgId, draft.id), {
            cookie: h.owner.cookie,
            body: { ...versions(draft), allocations: invalid },
          }),
          422,
        );
      const responses = await Promise.all(
        [
          allocations,
          allocations.map((item) => ({ ...item, startsAt: plusMinutes(item.startsAt!, 10) })),
        ].map((items) =>
          call(h.api, 'put', allocationsPath(h.owner.orgId, draft.id), {
            cookie: h.owner.cookie,
            body: { ...versions(draft), allocations: items },
          }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const saved = data<ScheduleRevisionData>(
        responses.find((response) => response.status === 200)!,
      );
      expect(saved).toMatchObject({
        eventVersion: draft.eventVersion + 1,
        version: draft.version + 1,
        seed: draft.seed,
        pairingHash: draft.pairingHash,
      });
      for (const expected of [
        { expectedEventVersion: draft.eventVersion, expectedRevisionVersion: saved.version },
        { expectedEventVersion: saved.eventVersion, expectedRevisionVersion: draft.version },
      ])
        error(
          await call(h.api, 'put', allocationsPath(h.owner.orgId, saved.id), {
            cookie: h.owner.cookie,
            body: { ...expected, allocations },
          }),
          409,
        );
      error(
        await call(h.api, 'post', validatePath(h.owner.orgId, saved.id), {
          cookie: h.owner.cookie,
          body: versions(draft),
        }),
        409,
      );
      const removed = await allocate(
        h.api,
        h.owner,
        saved,
        allocations.map((item) => ({ fixtureKey: item.fixtureKey, courtId: null, startsAt: null })),
      );
      expect(
        removed.fixtures.every(
          (item) => item.courtId === null && item.startsAt === null && item.endsAt === null,
        ),
      ).toBe(true);
      const validation = await validate(h.api, h.owner, removed);
      expect(validation).toMatchObject({ ...versions(removed), valid: false });
      expect(validation.conflicts.map((item) => item.code)).toContain('UNASSIGNED');
      const rejected = await publish(h.api, h.owner, removed);
      error(rejected, 409);
      expect(rejected.body.error.code).toBe('SCHEDULE_CONFLICT');
    });

    test('policy rejects malformed timestamps, overlapping same-Court windows and foreign resource IDs', async () => {
      const current = await frozen(h);
      const resource = await court(h.api, h.owner);
      const foreign = await court(h.api, h.otherOwner);
      const base = {
        expectedEventVersion: current.event.version,
        freezeId: current.freeze!.id,
        algorithmVersion: 'RR_CIRCLE_V1',
      };
      for (const policy of [
        policyFor(current, [resource], { slotDurationMinutes: 0 }),
        policyFor(current, [resource], { minRestMinutes: -1 }),
        policyFor(current, [resource], { minLocalDayGap: 366 }),
        policyFor(current, [resource], { courtWindows: [] }),
        policyFor(current, [resource], {
          courtWindows: [
            {
              courtId: resource.id,
              startsAt: '2027-02-29T09:00:00+08:00',
              endsAt: '2027-03-01T09:00:00+08:00',
            },
          ],
        }),
        policyFor(current, [resource], {
          courtWindows: [
            {
              courtId: resource.id,
              startsAt: `${current.event.startDate}T24:00:00+08:00`,
              endsAt: `${current.event.endDate}T09:00:00+08:00`,
            },
          ],
        }),
        policyFor(current, [resource, resource]),
      ])
        error(
          await call(h.api, 'post', revisionsPath(h.owner.orgId, current.event.id), {
            cookie: h.owner.cookie,
            body: { ...base, policy },
          }),
          422,
        );
      error(
        await call(h.api, 'post', revisionsPath(h.owner.orgId, current.event.id), {
          cookie: h.owner.cookie,
          body: { ...base, policy: policyFor(current, [foreign]) },
        }),
        404,
      );
      error(
        await call(h.api, 'post', revisionsPath(h.owner.orgId, current.event.id), {
          cookie: h.owner.cookie,
          body: { ...base, policy: policyFor(current, [resource]), orgId: h.otherOwner.orgId },
        }),
        422,
      );
      const secondCourt = await court(h.api, h.owner);
      const draft = await revision(h.api, h.owner, current, [resource, secondCourt]);
      error(
        await call(h.api, 'put', allocationsPath(h.owner.orgId, draft.id), {
          cookie: h.owner.cookie,
          body: {
            ...versions(draft),
            allocations: fullAllocations(
              draft,
              foreign,
              `${current.event.startDate}T09:00:00+08:00`,
            ),
          },
        }),
        404,
      );
    });

    test('half-open adjacency is valid while overlapping internal Court slots and outside-window allocations remain repairable drafts', async () => {
      const current = await frozen(h, h.owner, h.teams.slice(0, 4));
      const resource = await court(h.api, h.owner);
      let draft = await revision(h.api, h.owner, current, [resource], {
        courtWindows: [
          {
            courtId: resource.id,
            startsAt: `${current.event.startDate}T09:00:00+08:00`,
            endsAt: `${current.event.startDate}T15:00:00+08:00`,
          },
        ],
      });
      const good = fullAllocations(draft, resource, `${current.event.startDate}T09:00:00+08:00`);
      draft = await allocate(h.api, h.owner, draft, good);
      expect((await validate(h.api, h.owner, draft)).valid).toBe(true);
      expect(draft.fixtures[0]!.endsAt).toBe(draft.fixtures[1]!.startsAt);
      draft = await allocate(
        h.api,
        h.owner,
        draft,
        good.map((item, index) => (index === 1 ? { ...item, startsAt: good[0]!.startsAt } : item)),
      );
      expect((await validate(h.api, h.owner, draft)).conflicts.map((item) => item.code)).toContain(
        'COURT_OVERLAP',
      );
      draft = await allocate(
        h.api,
        h.owner,
        draft,
        good.map((item, index) =>
          index === 0 ? { ...item, startsAt: plusMinutes(item.startsAt!, -1) } : item,
        ),
      );
      expect((await validate(h.api, h.owner, draft)).conflicts.map((item) => item.code)).toContain(
        'OUTSIDE_WINDOW',
      );
      const failed = await publish(h.api, h.owner, draft);
      error(failed, 409);
      draft = await allocate(h.api, h.owner, draft, good);
      expect((await validate(h.api, h.owner, draft)).valid).toBe(true);
    });

    test('event end-date uses the local half-open midnight boundary with a server-calculated end', async () => {
      const current = await frozen(h);
      const resource = await court(h.api, h.owner);
      let draft = await revision(h.api, h.owner, current, [resource]);
      draft = await allocate(
        h.api,
        h.owner,
        draft,
        fullAllocations(draft, resource, `${current.event.endDate}T23:00:00+08:00`),
      );
      expect((await validate(h.api, h.owner, draft)).valid).toBe(true);
      expect(draft.fixtures[0]!.endsAt).toBe(
        new Date(`${plusDays(current.event.endDate, 1)}T00:00:00+08:00`).toISOString(),
      );
      draft = await allocate(
        h.api,
        h.owner,
        draft,
        fullAllocations(draft, resource, `${current.event.endDate}T23:01:00+08:00`),
      );
      expect((await validate(h.api, h.owner, draft)).conflicts.map((item) => item.code)).toContain(
        'OUTSIDE_EVENT_DATES',
      );
    });

    test('minimum rest accepts the exact minute and rejects one minute less', async () => {
      const current = await frozen(h, h.owner, h.teams.slice(0, 3));
      const resource = await court(h.api, h.owner);
      let draft = await revision(h.api, h.owner, current, [resource], { minRestMinutes: 30 });
      const good = fullAllocations(
        draft,
        resource,
        `${current.event.startDate}T09:00:00+08:00`,
        90,
      );
      draft = await allocate(h.api, h.owner, draft, good);
      expect((await validate(h.api, h.owner, draft)).valid).toBe(true);
      draft = await allocate(
        h.api,
        h.owner,
        draft,
        good.map((item, index) =>
          index === 1 ? { ...item, startsAt: plusMinutes(item.startsAt!, -1) } : item,
        ),
      );
      expect((await validate(h.api, h.owner, draft)).conflicts.map((item) => item.code)).toContain(
        'MIN_REST',
      );
    });

    test('minimum local day gap follows calendar dates even when the real elapsed time is shorter', async () => {
      const current = await frozen(h, h.owner, h.teams.slice(0, 3));
      const resource = await court(h.api, h.owner);
      let draft = await revision(h.api, h.owner, current, [resource], { minLocalDayGap: 2 });
      const starts = [
        `${current.event.startDate}T23:30:00+08:00`,
        `${plusDays(current.event.startDate, 2)}T00:01:00+08:00`,
        `${plusDays(current.event.startDate, 4)}T00:01:00+08:00`,
      ];
      const good = draft.fixtures.map((fixture, index) => ({
        fixtureKey: fixture.fixtureKey,
        courtId: resource.id,
        startsAt: starts[index]!,
      }));
      draft = await allocate(h.api, h.owner, draft, good);
      expect((await validate(h.api, h.owner, draft)).valid).toBe(true);
      draft = await allocate(
        h.api,
        h.owner,
        draft,
        good.map((item, index) =>
          index === 1
            ? { ...item, startsAt: `${plusDays(current.event.startDate, 1)}T23:59:00+08:00` }
            : item,
        ),
      );
      expect((await validate(h.api, h.owner, draft)).conflicts.map((item) => item.code)).toContain(
        'MIN_LOCAL_DAY_GAP',
      );
    });

    test('actual event assignments govern scheduling; staff and membership revocation immediately invalidate old cookies', async () => {
      const current = await frozen(h);
      const resource = await court(h.api, h.owner);
      error(
        await call(h.api, 'get', schedulingPath(h.owner.orgId, current.event.id), {
          cookie: h.otherOwner.cookie,
        }),
        404,
      );
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, current.event.id, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'SCORER', status: 'ACTIVE' },
        }),
      );
      const read = data<EventSchedulingData>(
        await call(h.api, 'get', schedulingPath(h.owner.orgId, current.event.id), {
          cookie: h.otherOwner.cookie,
        }),
      );
      expect(read.capabilities.canGenerate).toBe(false);
      const body = {
        expectedEventVersion: current.event.version,
        freezeId: current.freeze!.id,
        algorithmVersion: 'RR_CIRCLE_V1',
        policy: policyFor(current, [resource]),
      };
      error(
        await call(h.api, 'post', revisionsPath(h.owner.orgId, current.event.id), {
          cookie: h.otherOwner.cookie,
          body,
        }),
        403,
      );
      for (const role of ['REVIEWER', 'STREAMER']) {
        data(
          await call(h.api, 'put', staffPath(h.owner.orgId, current.event.id, h.otherOwner.id), {
            cookie: h.owner.cookie,
            body: { role, status: 'ACTIVE' },
          }),
        );
        expect(
          data<EventSchedulingData>(
            await call(h.api, 'get', schedulingPath(h.owner.orgId, current.event.id), {
              cookie: h.otherOwner.cookie,
            }),
          ).capabilities.canGenerate,
        ).toBe(false);
      }
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, current.event.id, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
        }),
      );
      const draft = data<ScheduleRevisionData>(
        await call(h.api, 'post', revisionsPath(h.owner.orgId, current.event.id), {
          cookie: h.otherOwner.cookie,
          body,
        }),
        201,
      );
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, current.event.id, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'DISABLED' },
        }),
      );
      error(
        await call(h.api, 'get', revisionPath(h.owner.orgId, draft.id), {
          cookie: h.otherOwner.cookie,
        }),
        404,
      );
      error(await publish(h.api, { ...h.otherOwner, orgId: h.owner.orgId }, draft), 404);
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, current.event.id, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
        }),
      );
      data(
        await call(h.api, 'put', `${membersPath(h.owner.orgId)}/${h.otherOwner.id}`, {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'DISABLED' },
        }),
      );
      try {
        error(
          await call(h.api, 'post', validatePath(h.owner.orgId, draft.id), {
            cookie: h.otherOwner.cookie,
            body: versions(draft),
          }),
          404,
        );
      } finally {
        data(
          await call(h.api, 'put', `${membersPath(h.owner.orgId)}/${h.otherOwner.id}`, {
            cookie: h.owner.cookie,
            body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
          }),
        );
      }
      for (const path of [
        courtsPath(h.owner.orgId),
        schedulingPath(h.owner.orgId, current.event.id),
        revisionPath(h.owner.orgId, draft.id),
        matchesPath(h.owner.orgId, current.event.id),
      ])
        error(await call(h.api, 'get', path, { cookie: h.leader.cookie }), 404);
    });

    test('Court names are canonical per org, management is owner/admin-only, and all private paths remain tenant-scoped', async () => {
      const resource = await court(h.api, h.owner, 'Canonical Court');
      const duplicate = await call(h.api, 'post', courtsPath(h.owner.orgId), {
        cookie: h.owner.cookie,
        body: { name: ` ${resource.name.toUpperCase()} ` },
      });
      error(duplicate, 409);
      expect(duplicate.body.error.code).toBe('COURT_NAME_CONFLICT');
      data(
        await call(h.api, 'post', courtsPath(h.otherOwner.orgId), {
          cookie: h.otherOwner.cookie,
          body: { name: resource.name },
        }),
        201,
      );
      expect(
        data<CourtData[]>(
          await call(h.api, 'get', courtsPath(h.owner.orgId), { cookie: h.otherOwner.cookie }),
        ).every((item) => !item.capabilities.canManage),
      ).toBe(true);
      error(
        await call(h.api, 'post', courtsPath(h.owner.orgId), {
          cookie: h.otherOwner.cookie,
          body: { name: 'staff forbidden Court' },
        }),
        403,
      );
      error(
        await call(h.api, 'patch', courtPath(h.owner.orgId, resource.id), {
          cookie: h.otherOwner.cookie,
          body: { expectedVersion: resource.version, name: resource.name, status: 'DISABLED' },
        }),
        403,
      );
      error(
        await call(h.api, 'post', courtsPath(h.owner.orgId), {
          cookie: h.owner.cookie,
          body: { name: '🏀'.repeat(81) },
        }),
        422,
      );
      const renamed = data<CourtData>(
        await call(h.api, 'patch', courtPath(h.owner.orgId, resource.id), {
          cookie: h.owner.cookie,
          body: {
            expectedVersion: resource.version,
            name: `${resource.name}-renamed`,
            status: 'ACTIVE',
          },
        }),
      );
      expect(renamed.version).toBe(resource.version + 1);
      error(
        await call(h.api, 'patch', courtPath(h.owner.orgId, resource.id), {
          cookie: h.owner.cookie,
          body: { expectedVersion: resource.version, name: resource.name, status: 'ACTIVE' },
        }),
        409,
      );
      error(
        await call(h.api, 'post', courtsPath(h.owner.orgId), {
          cookie: h.owner.cookie,
          body: { name: 'Forged', orgId: h.otherOwner.orgId },
        }),
        422,
      );
      error(
        await call(h.api, 'get', courtsPath(h.otherOwner.orgId), { cookie: h.owner.cookie }),
        404,
      );
      error(
        await call(h.api, 'patch', courtPath(h.otherOwner.orgId, resource.id), {
          cookie: h.otherOwner.cookie,
          body: { expectedVersion: resource.version, name: resource.name, status: 'ACTIVE' },
        }),
        404,
      );
      const current = await frozen(h);
      const draft = await revision(h.api, h.owner, current, [resource]);
      error(
        await call(h.api, 'get', revisionPath(h.otherOwner.orgId, draft.id), {
          cookie: h.otherOwner.cookie,
        }),
        404,
      );
      for (const [path, body] of [
        [validatePath(h.owner.orgId, draft.id), versions(draft)],
        [publishPath(h.owner.orgId, draft.id), versions(draft)],
      ] as const) {
        error(await call(h.api, 'post', path, { cookie: h.owner.cookie, body, origin: null }), 403);
        error(
          await call(h.api, 'post', path, {
            cookie: h.owner.cookie,
            body: { ...body, actorId: h.otherOwner.id },
          }),
          422,
        );
      }
    });

    test('Court and match pagination is stable, user-bound and keeps unauthorized match lists private', async () => {
      const courts = await allPages<CourtData>(
        h.api,
        `${courtsPath(h.owner.orgId)}?limit=2`,
        h.owner,
      );
      const baseline = data<CourtData[]>(
        await call(h.api, 'get', `${courtsPath(h.owner.orgId)}?limit=100`, {
          cookie: h.owner.cookie,
        }),
      );
      expect(courts.items.map((item) => item.id)).toEqual(baseline.map((item) => item.id));
      expect(new Set(courts.items.map((item) => item.id)).size).toBe(courts.items.length);
      error(
        await call(
          h.api,
          'get',
          `${courtsPath(h.owner.orgId)}?limit=2&cursor=${courts.firstCursor}`,
          { cookie: h.otherOwner.cookie },
        ),
        422,
      );
      const current = await frozen(h, h.owner, h.teams.slice(0, 4));
      const resource = await court(h.api, h.owner);
      let draft = await revision(h.api, h.owner, current, [resource]);
      draft = await allocate(
        h.api,
        h.owner,
        draft,
        fullAllocations(draft, resource, `${current.event.startDate}T09:00:00+08:00`),
      );
      const published = data<EventSchedulingData>(await publish(h.api, h.owner, draft));
      expect(published.publication!.matchCount).toBe(6);
      const pages = await allPages<ScheduledMatchData>(
        h.api,
        `${matchesPath(h.owner.orgId, current.event.id)}?limit=2`,
        h.owner,
      );
      expect(pages.items).toHaveLength(6);
      expect(new Set(pages.items.map((item) => item.id)).size).toBe(6);
      expect(
        pages.items.every(
          (item) => item.status === 'SCHEDULED' && item.publicationId === published.publication!.id,
        ),
      ).toBe(true);
      expect(pages.items.map((item) => item.startsAt)).toEqual(
        [...pages.items.map((item) => item.startsAt)].sort(),
      );
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, current.event.id, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'SCORER', status: 'ACTIVE' },
        }),
      );
      error(
        await call(
          h.api,
          'get',
          `${matchesPath(h.owner.orgId, current.event.id)}?limit=2&cursor=${pages.firstCursor}`,
          { cookie: h.otherOwner.cookie },
        ),
        422,
      );
      error(
        await call(h.api, 'get', matchesPath(h.owner.orgId, current.event.id), {
          cookie: h.leader.cookie,
        }),
        404,
      );
    });
  },
);
