import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  EventGroupKnockoutData,
  EventLifecycleData,
  EventScoringData,
  PublicGroupKnockoutData,
  SchedulePolicy,
  ScheduleRevisionData,
} from '@small-city-basketball/contracts';
import { call, data, error } from './support.js';
import {
  allocate,
  court,
  frozen,
  fullAllocations,
  plusMinutes,
  policyFor,
  publish,
  revisionsPath,
} from './p04-support.js';
import {
  act,
  closeHarness,
  createScoringHarness,
  defaultRules,
  envelope,
  scoringRulesPath,
  sendCommand,
  workbench,
} from './p05-support.js';
import type { Harness } from './p05-support.js';
import {
  confirmKnockoutMatch,
  currentMatches,
  knockoutFacts,
  knockoutFixture,
  lifecyclePath,
  proofFixtures,
  publishRound,
  readKnockout,
  roundCommandsPath,
  roundInput,
} from './c04-support.js';
import { anonymous, enable, publicEventPath, savePublishRules } from './p05b-support.js';

const thirdPlace = { thirdPlaceMatch: true } as Partial<SchedulePolicy>;
const groupPath = (h: Harness, id: string) => `/v1/orgs/${h.owner.orgId}/events/${id}/groups`;
const readGroup = async (h: Harness, id: string) =>
  data<EventGroupKnockoutData>(
    await call(h.api, 'get', groupPath(h, id), { cookie: h.owner.cookie }),
  );

async function groupFixture(h: Harness) {
  const registration = await frozen(h, h.owner, h.teams, { format: 'GROUP_KNOCKOUT' });
  const resource = await court(h.api, h.owner, '合成X01季军赛球场');
  const rules = await savePublishRules(h, registration.event.id, {
    winPoints: 2,
    lossPoints: 1,
    drawPoints: 0,
    tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR'],
  });
  let schedule = data<ScheduleRevisionData>(
    await call(h.api, 'post', revisionsPath(h.owner.orgId, registration.event.id), {
      cookie: h.owner.cookie,
      body: {
        expectedEventVersion: rules.event.version,
        freezeId: registration.freeze!.id,
        algorithmVersion: 'GK_BALANCED_V1',
        groupConfig: {
          groupCount: 2,
          seededEntryIds: registration.freeze!.entries.slice(0, 2).map((e) => e.entryId),
        },
        policy: policyFor(registration, [resource], { ...thirdPlace, minRestMinutes: 30 }),
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
  const publication = data<{ event: { version: number } }>(await publish(h.api, h.owner, schedule));
  data<EventScoringData>(
    await call(h.api, 'put', scoringRulesPath(h.owner.orgId, registration.event.id), {
      cookie: h.owner.cookie,
      body: {
        expectedEventVersion: publication.event.version,
        ...defaultRules({ tiePolicy: 'OVERTIME', overtimeDurationSeconds: 1 }),
      },
    }),
  );
  return { event: registration.event.id, resource, schedule };
}

async function publishGroupStep(h: Harness, id: string, courtId: string, qualification: boolean) {
  const current = await readGroup(h, id),
    next = current.competition!.nextRound!;
  const last = (await currentMatches(h, id))
    .map((m) => m.endsAt)
    .sort()
    .at(-1)!;
  return data(
    await call(
      h.api,
      'post',
      qualification
        ? groupPath(h, id).replace('/groups', '/group-qualification-commands')
        : roundCommandsPath(h.owner.orgId, id),
      {
        cookie: h.owner.cookie,
        body: {
          type: qualification ? 'PUBLISH_QUALIFICATION' : 'PUBLISH_ROUND',
          expectedEventVersion: current.event.version,
          expectedSourceHash: next.sourceHash,
          ...(!qualification ? { roundNo: next.roundNo } : {}),
          reason: '合成季军赛独立来源发布',
          allocations: next.fixtures.map((f, i) => ({
            fixtureKey: f.fixtureKey,
            courtId,
            startsAt: plusMinutes(last, 60 + i * 120),
          })),
        },
      },
    ),
  );
}

describe(
  'X01 optional bronze on real PostgreSQL and authoritative HTTP',
  { concurrent: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness(8);
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    test('four-team bronze uses actual semifinal losers and blocks closure until both final-round results', async () => {
      const f = await knockoutFixture(h, 4, thirdPlace),
        id = f.event.event.id;
      for (const m of f.matches) await confirmKnockoutMatch(h, m.id);
      let current = await readKnockout(h, id);
      const next = current.bracket!.nextRound!;
      expect(next.fixtures).toHaveLength(2);
      const semis = current.bracket!.rounds[0]!.slots;
      expect([next.fixtures[1]!.homeEntryId, next.fixtures[1]!.awayEntryId]).toEqual(
        semis.map((s) => (s.homeEntryId === s.winnerEntryId ? s.awayEntryId : s.homeEntryId)),
      );
      data(await publishRound(h, id, await roundInput(h, current, f.court)));
      const semibench = await workbench(h, f.matches[0]!.id);
      const denied = await sendCommand(
        h,
        f.matches[0]!.id,
        h.owner,
        envelope(semibench.match.version, {
          type: 'REOPEN_RESULT',
          payload: { reason: '合成来源已消费后的更正' },
        }),
      );
      error(denied, 409);
      expect(denied.body.error.code).toBe('KNOCKOUT_RESULT_CONSUMED');
      const last = (await currentMatches(h, id)).filter((m) => m.roundNo === 2);
      expect(last).toHaveLength(2);
      await confirmKnockoutMatch(h, last[0]!.id);
      expect(
        data<EventLifecycleData>(
          await call(h.api, 'get', lifecyclePath(h.owner.orgId, id), { cookie: h.owner.cookie }),
        ).completion.ready,
      ).toBe(false);
      await confirmKnockoutMatch(h, last[1]!.id);
      current = await readKnockout(h, id);
      expect(current.bracket).toMatchObject({
        isComplete: true,
        totalMatchCount: 4,
        publishedMatchCount: 4,
        confirmedMatchCount: 4,
      });
      expect(current.bracket!.placements.map((p) => p.rank)).toEqual([1, 2, 3, 4]);
      expect(
        data<EventLifecycleData>(
          await call(h.api, 'get', lifecyclePath(h.owner.orgId, id), { cookie: h.owner.cookie }),
        ).completion.ready,
      ).toBe(true);
    }, 90000);

    test('database independently rejects a bronze proof which substitutes semifinal winners', async () => {
      const f = await knockoutFixture(h, 4, thirdPlace),
        id = f.event.event.id;
      for (const m of f.matches) await confirmKnockoutMatch(h, m.id);
      const current = await readKnockout(h, id),
        input = await roundInput(h, current, f.court),
        fixtures = proofFixtures(f, current, input);
      const bronze = fixtures[1]!,
        championship = fixtures[0]!;
      for (const field of [
        'homeEntryId',
        'homeTeamId',
        'homeTeamName',
        'homeRosterRevisionId',
      ] as const)
        bronze[field] = championship[field];
      const before = await knockoutFacts(h, id),
        client = await h.api.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT org_id FROM org_schedule_mutex WHERE org_id=$1 FOR UPDATE', [
          h.owner.orgId,
        ]);
        await client.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE', [
          h.owner.orgId,
          id,
        ]);
        await expect(
          client.query(
            'INSERT INTO knockout_round_publications(id,org_id,event_id,publication_id,revision_id,round_no,from_event_version,to_event_version,source_hash,sources,fixtures,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13)',
            [
              randomUUID(),
              h.owner.orgId,
              id,
              current.publicationId,
              f.schedule.id,
              input.roundNo,
              current.event.version,
              current.event.version + 1,
              input.expectedSourceHash,
              JSON.stringify(current.bracket!.nextRound!.sources),
              JSON.stringify(fixtures),
              input.reason,
              h.owner.id,
            ],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      expect(await knockoutFacts(h, id)).toEqual(before);
    }, 90000);

    test('eight-team group flow publishes and confirms exactly sixteen games, including third and fourth places', async () => {
      const f = await groupFixture(h);
      expect(await currentMatches(h, f.event)).toHaveLength(12);
      for (const m of await currentMatches(h, f.event)) await confirmKnockoutMatch(h, m.id);
      let current = await readGroup(h, f.event);
      for (const group of current.competition!.groups) {
        if (!group.unresolvedTieEntryIds.length) continue;
        const fresh = await readGroup(h, f.event);
        data(
          await call(
            h.api,
            'post',
            groupPath(h, f.event).replace('/groups', '/group-tie-commands'),
            {
              cookie: h.owner.cookie,
              body: {
                type: 'DRAW_GROUP_TIE',
                expectedEventVersion: fresh.event.version,
                expectedSourceHash: group.standings.sourceHash,
                groupKey: group.groupKey,
                reason: '合成八队季军赛同分抽签',
              },
            },
          ),
        );
      }
      await publishGroupStep(h, f.event, f.resource.id, true);
      for (const m of await currentMatches(h, f.event))
        if (m.status === 'SCHEDULED') await confirmKnockoutMatch(h, m.id);
      await publishGroupStep(h, f.event, f.resource.id, false);
      const all = await currentMatches(h, f.event);
      expect(all).toHaveLength(16);
      for (const m of all) if (m.status === 'SCHEDULED') await confirmKnockoutMatch(h, m.id);
      current = await readGroup(h, f.event);
      expect(current.competition).toMatchObject({
        isComplete: true,
        totalMatchCount: 16,
        publishedMatchCount: 16,
        confirmedMatchCount: 16,
      });
      expect(
        current
          .competition!.placements.filter((p) => p.stage === 'KNOCKOUT')
          .map((p) => p.rank)
          .sort(),
      ).toEqual([1, 2, 3, 4]);
      const grant = await enable(h, f.event);
      const publicGroups = data<PublicGroupKnockoutData>(
        await anonymous(h, `${publicEventPath(grant.publication!.publicEventId)}/groups`),
      );
      expect(publicGroups).toMatchObject({
        isComplete: true,
        totalMatchCount: 16,
        confirmedMatchCount: 16,
      });
      expect(JSON.stringify(publicGroups)).not.toContain(f.event);
      expect(publicGroups.bracket!.rounds.at(-1)!.slots).toHaveLength(2);
    }, 180000);
  },
);
