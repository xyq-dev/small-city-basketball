import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  EventGroupKnockoutData,
  EventScoringData,
  ScheduleRevisionData,
  SchedulePolicy,
} from '@small-city-basketball/contracts';
import { LocalServicesService } from '../src/local-services-service.js';
import { REGION_CATALOG_VERSION } from '../src/region-catalog-data.js';
import { ORIGIN, call, data, error, membersPath } from './support.js';
import { grant } from './p03-support.js';
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
  closeHarness,
  createScoringHarness,
  defaultRules,
  scoringRulesPath,
} from './p05-support.js';
import type { Harness } from './p05-support.js';
import {
  confirmKnockoutMatch,
  currentMatches,
  knockoutFacts,
  publishRound,
  readKnockout,
  roundInput,
} from './c04-support.js';
import { savePublishRules } from './p05b-support.js';

/** All calendars below are produced by real supply/booking/matchup and scoring commands. */
describe(
  'X03 manual knockout rounds share the live local team calendar',
  { concurrent: false },
  () => {
    let h: Harness, local: LocalServicesService, regionId: string;
    beforeAll(async () => {
      h = await createScoringHarness(4);
      for (const team of h.teams) await grant(h.api, h.owner, team, h.owner);
      await grant(h.api, h.otherOwner, h.otherTeams[0]!, h.otherOwner);
      local = new LocalServicesService(h.api.pool, {
        databaseUrl: h.databaseUrl,
        appOrigin: ORIGIN,
      });
      data(
        await call(h.api, 'put', `${membersPath(h.owner.orgId)}/${h.otherOwner.id}`, {
          cookie: h.owner.cookie,
          body: { role: 'ORG_ADMIN', status: 'ACTIVE' },
        }),
      );
      regionId = (
        await h.api.pool.query(
          "SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND level='COUNTY' ORDER BY source_code LIMIT 1",
          [REGION_CATALOG_VERSION],
        )
      ).rows[0].region_id;
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    const futureDate = (days: number) =>
      new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    async function singleFixture(days: number, overrides: Partial<SchedulePolicy>) {
      const registration = await frozen(h, h.owner, h.teams.slice(0, 3), {
        format: 'SINGLE_ELIMINATION',
        startDate: futureDate(days),
      });
      const resource = await court(h.api, h.owner, '合成有界日期淘汰球场');
      let schedule = data<ScheduleRevisionData>(
        await call(h.api, 'post', revisionsPath(h.owner.orgId, registration.event.id), {
          cookie: h.owner.cookie,
          body: {
            expectedEventVersion: registration.event.version,
            freezeId: registration.freeze!.id,
            algorithmVersion: 'SE_SEEDED_V1',
            policy: policyFor(registration, [resource], overrides),
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
      const publication = data<{ event: { version: number } }>(
        await publish(h.api, h.owner, schedule),
      );
      const event = data<EventScoringData>(
        await call(h.api, 'put', scoringRulesPath(h.owner.orgId, registration.event.id), {
          cookie: h.owner.cookie,
          body: {
            expectedEventVersion: publication.event.version,
            ...defaultRules({ tiePolicy: 'OVERTIME', overtimeDurationSeconds: 1 }),
          },
        }),
      );
      return {
        event,
        schedule,
        court: resource,
        matches: await currentMatches(h, registration.event.id),
      };
    }

    async function matchup(teamId: string, startsAt: string, endsAt: string) {
      const region = { catalogVersion: REGION_CATALOG_VERSION, regionId };
      const resource = await court(h.api, h.owner, '合成独立约赛球场');
      const listing = await local.createListing(h.otherOwner.cookie, h.owner.orgId, {
        commandId: randomUUID(),
        kind: 'COURT',
        title: '合成晋级资源日历',
        description: '隔离测试真实审核及双方约赛',
        address: '公开合成球场地址',
        region,
        coverageRegionIds: [regionId],
        providerUserId: h.otherOwner.id,
        courtId: resource.id,
        qualificationNote: '合成经营资质',
        terms: '双方线下履约；天气取消无线上扣费',
      });
      await local.listingCommand(h.otherOwner.cookie, listing.resourceId, {
        commandId: randomUUID(),
        type: 'SUBMIT',
        expectedVersion: 1,
        reason: '合成独立审核申请',
      });
      await local.listingCommand(h.owner.cookie, listing.resourceId, {
        commandId: randomUUID(),
        type: 'APPROVE',
        expectedVersion: 2,
        reason: '独立核对合成经营资质',
        qualificationChecked: true,
        scopeChecked: true,
        qualifiedUntil: plusMinutes(endsAt, 1440),
      });
      await local.listingCommand(h.otherOwner.cookie, listing.resourceId, {
        commandId: randomUUID(),
        type: 'PUBLISH',
        expectedVersion: 3,
        reason: '发布已审核合成供给',
      });
      const slot = await local.createSlot(h.otherOwner.cookie, listing.resourceId, {
        commandId: randomUUID(),
        expectedVersion: 4,
        startsAt,
        endsAt,
      });
      const booking = await local.book(h.owner.cookie, {
        commandId: randomUUID(),
        listingId: listing.resourceId,
        slotId: slot.slotId,
        serviceRegion: region,
        acceptedTerms: true,
      });
      await local.bookingCommand(h.otherOwner.cookie, booking.resourceId, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'CONFIRM',
        reason: '实际经营方确认球场',
      });
      const proposal = await local.createMatchup(h.owner.cookie, {
        commandId: randomUUID(),
        homeOrgId: h.owner.orgId,
        homeTeamId: teamId,
        awayOrgId: h.otherOwner.orgId,
        awayTeamId: h.otherTeams[0]!.id,
        courtBookingId: booking.resourceId,
        terms: '双方核对实际场地与合成约赛时间',
      });
      const confirmed = await local.matchupCommand(h.otherOwner.cookie, proposal.resourceId, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'CONFIRM',
        reason: '对方队长确认合成约赛',
      });
      return {
        id: proposal.resourceId as string,
        version: confirmed.version as number,
        bookingId: booking.resourceId as string,
      };
    }

    async function rejectsUnchanged(
      id: string,
      response: Awaited<ReturnType<typeof publishRound>>,
      code: string,
      before: Awaited<ReturnType<typeof knockoutFacts>>,
      hidden: { id: string; bookingId: string },
    ) {
      error(response, 409);
      expect(response.body.error).toMatchObject({
        code: 'SCHEDULE_CONFLICT',
        details: {
          conflicts: expect.arrayContaining([expect.objectContaining({ code, external: true })]),
        },
      });
      expect(JSON.stringify(response.body)).not.toContain(hidden.id);
      expect(JSON.stringify(response.body)).not.toContain(hidden.bookingId);
      expect(await knockoutFacts(h, id)).toEqual(before);
    }

    test('manual single-elimination publication rejects nonoverlapping local rest, then succeeds after actual cancellation', async () => {
      const fixture = await singleFixture(30, { minRestMinutes: 60 });
      const id = fixture.event.event.id,
        day = fixture.event.event.startDate;
      for (const match of fixture.matches) await confirmKnockoutMatch(h, match.id);
      const current = await readKnockout(h, id);
      const entryId = current.bracket!.nextRound!.fixtures[0]!.homeEntryId;
      const teamId = fixture.schedule.source.entries.find((e) => e.entryId === entryId)!.teamId;
      const occupied = await matchup(teamId, `${day}T14:00:00+08:00`, `${day}T15:00:00+08:00`);
      const input = await roundInput(h, current, fixture.court, `${day}T15:15:00+08:00`);
      const before = await knockoutFacts(h, id);
      await rejectsUnchanged(id, await publishRound(h, id, input), 'MIN_REST', before, occupied);
      await local.matchupCommand(h.owner.cookie, occupied.id, {
        commandId: randomUUID(),
        expectedVersion: occupied.version,
        type: 'CANCEL',
        reason: '双方取消合成约赛安排',
      });
      data(await publishRound(h, id, input));
      expect(await currentMatches(h, id)).toHaveLength(2);
    });

    test('manual next-round publication rejects a local day-gap conflict beyond the previous official round', async () => {
      const fixture = await singleFixture(40, { minLocalDayGap: 2 });
      const id = fixture.event.event.id,
        day = fixture.event.event.startDate;
      for (const match of fixture.matches) await confirmKnockoutMatch(h, match.id);
      const current = await readKnockout(h, id);
      const entryId = current.bracket!.nextRound!.fixtures[0]!.homeEntryId;
      const teamId = fixture.schedule.source.entries.find((e) => e.entryId === entryId)!.teamId;
      const occupied = await matchup(
        teamId,
        plusMinutes(`${day}T14:00:00+08:00`, 1440),
        plusMinutes(`${day}T15:00:00+08:00`, 1440),
      );
      const input = await roundInput(
        h,
        current,
        fixture.court,
        plusMinutes(`${day}T15:15:00+08:00`, 2880),
      );
      const before = await knockoutFacts(h, id);
      await rejectsUnchanged(
        id,
        await publishRound(h, id, input),
        'MIN_LOCAL_DAY_GAP',
        before,
        occupied,
      );
    });

    test('manual group qualification uses the same local team rest protection', async () => {
      const registration = await frozen(h, h.owner, h.teams, {
        format: 'GROUP_KNOCKOUT',
        startDate: futureDate(50),
      });
      const resource = await court(h.api, h.owner, '合成分组晋级球场');
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
            policy: policyFor(registration, [resource], { minRestMinutes: 60 }),
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
      const publication = data<{ event: { version: number } }>(
        await publish(h.api, h.owner, schedule),
      );
      data<EventScoringData>(
        await call(h.api, 'put', scoringRulesPath(h.owner.orgId, registration.event.id), {
          cookie: h.owner.cookie,
          body: {
            expectedEventVersion: publication.event.version,
            ...defaultRules({ tiePolicy: 'OVERTIME', overtimeDurationSeconds: 1 }),
          },
        }),
      );
      const id = registration.event.id,
        day = registration.event.startDate;
      for (const match of await currentMatches(h, id)) await confirmKnockoutMatch(h, match.id);
      const current = data<EventGroupKnockoutData>(
        await call(h.api, 'get', `/v1/orgs/${h.owner.orgId}/events/${id}/groups`, {
          cookie: h.owner.cookie,
        }),
      );
      const next = current.competition!.nextRound!;
      const teamId = schedule.source.entries.find(
        (e) => e.entryId === next.fixtures[0]!.homeEntryId,
      )!.teamId;
      const occupied = await matchup(teamId, `${day}T14:00:00+08:00`, `${day}T15:00:00+08:00`);
      const before = await knockoutFacts(h, id);
      const response = await call(
        h.api,
        'post',
        `/v1/orgs/${h.owner.orgId}/events/${id}/group-qualification-commands`,
        {
          cookie: h.owner.cookie,
          body: {
            type: 'PUBLISH_QUALIFICATION',
            expectedEventVersion: current.event.version,
            expectedSourceHash: next.sourceHash,
            reason: '合成手工发布分组出线',
            allocations: next.fixtures.map((f, i) => ({
              fixtureKey: f.fixtureKey,
              courtId: resource.id,
              startsAt: plusMinutes(`${day}T15:15:00+08:00`, i * 120),
            })),
          },
        },
      );
      await rejectsUnchanged(id, response, 'MIN_REST', before, occupied);
    });
  },
);
