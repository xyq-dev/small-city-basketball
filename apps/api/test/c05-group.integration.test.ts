import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  CourtData,
  EventGroupKnockoutData,
  EventPlayerStatisticsData,
  ScheduleRevisionData,
  PublicGroupKnockoutData,
  EventScoringData,
} from '@small-city-basketball/contracts';
import { call, data, error } from './support.js';
import {
  allocate,
  court,
  frozen,
  fullAllocations,
  policyFor,
  publish,
  revisionsPath,
  plusMinutes,
} from './p04-support.js';
import {
  createScoringHarness,
  closeHarness,
  assign,
  act,
  acquire,
  start,
  finish,
  workbench,
  scoringRulesPath,
  defaultRules,
  sendCommand,
  envelope,
} from './p05-support.js';
import type { Harness } from './p05-support.js';
import {
  currentMatches,
  lifecyclePath,
  lifecycleCommandsPath,
  playerSummaryPath,
  roundCommandsPath,
} from './c04-support.js';
import {
  savePublishRules,
  enable,
  anonymous,
  publicEventPath,
  viewingCommand,
} from './p05b-support.js';
const groupsPath = (h: Harness, id: string) => `/v1/orgs/${h.owner.orgId}/events/${id}/groups`;
const read = (h: Harness, id: string) =>
  call(h.api, 'get', groupsPath(h, id), { cookie: h.owner.cookie }).then((r) =>
    data<EventGroupKnockoutData>(r),
  );
async function fixture(h: Harness, count = 4, groupCount: 2 | 4 | 8 = 2) {
  const registration = await frozen(h, h.owner, h.teams.slice(0, count), {
      format: 'GROUP_KNOCKOUT',
    }),
    resource = await court(h.api, h.owner, '合成分组场地');
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
          groupCount,
          seededEntryIds: registration.freeze!.entries.slice(0, groupCount).map((e) => e.entryId),
        },
        policy: policyFor(registration, [resource], { minRestMinutes: 30 }),
      },
    }),
    201,
  );
  const draft = await read(h, registration.event.id);
  expect(draft.draftGroups).toHaveLength(groupCount);
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
  return { event: registration.event.id, schedule, resource };
}
async function confirm(h: Harness, id: string, side: 'HOME' | 'AWAY' = 'HOME', personal = false) {
  await assign(h, id, h.otherOwner);
  const before = await workbench(h, id);
  await act(h, id, h.owner, {
    type: 'PREPARE_MATCH',
    payload: {
      expectedEventVersion: before.event.version,
      collectionMode: personal ? 'PLAYER_BASIC' : 'TEAM_ONLY',
    },
  });
  const lease = await acquire(h, id, h.otherOwner);
  await start(h, id, h.otherOwner, lease);
  await act(
    h,
    id,
    h.otherOwner,
    {
      type: 'RECORD_STAT',
      payload: {
        kind: 'SCORE',
        side,
        value: 2,
        ...(personal
          ? { memberId: before.playerRoster[side === 'HOME' ? 'home' : 'away'][0]!.memberId }
          : {}),
      },
    },
    lease,
  );
  await finish(h, id, h.otherOwner, lease);
  await act(h, id, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
}
async function roundBody(h: Harness, id: string, resource: CourtData, qualification: boolean) {
  const current = await read(h, id),
    next = current.competition!.nextRound!,
    matches = await currentMatches(h, id),
    last = matches
      .map((m) => m.endsAt)
      .sort()
      .at(-1)!;
  return {
    type: qualification ? 'PUBLISH_QUALIFICATION' : 'PUBLISH_ROUND',
    expectedEventVersion: current.event.version,
    expectedSourceHash: next.sourceHash,
    ...(!qualification ? { roundNo: next.roundNo } : {}),
    reason: '合成赛事逐轮独立复核发布',
    allocations: next.fixtures.map((f, i) => ({
      fixtureKey: f.fixtureKey,
      courtId: resource.id,
      startsAt: plusMinutes(last, 60 + i * 120),
    })),
  };
}
const qualify = (h: Harness, id: string, body: unknown) =>
  call(h.api, 'post', groupsPath(h, id).replace('/groups', '/group-qualification-commands'), {
    cookie: h.owner.cookie,
    body: body as object,
  });
describe('C05 GROUP_KNOCKOUT real PostgreSQL and HTTP boundaries', { concurrent: false }, () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createScoringHarness(16);
  }, 90000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  }, 30000);
  test('balanced frozen draft groups and current published group fixtures have exactly group-local pairs', async () => {
    const f = await fixture(h, 5),
      current = await read(h, f.event);
    expect(current.config?.groupCount).toBe(2);
    expect(current.competition!.groups.map((g) => g.participants.length).sort()).toEqual([2, 3]);
    expect(current.competition).toMatchObject({
      totalMatchCount: 7,
      publishedMatchCount: 4,
      confirmedMatchCount: 0,
      qualification: { status: 'WAITING' },
    });
    expect(await currentMatches(h, f.event)).toHaveLength(4);
    const summary = data<EventPlayerStatisticsData>(
      await call(h.api, 'get', playerSummaryPath(h.owner.orgId, f.event), {
        cookie: h.owner.cookie,
      }),
    ).summary!;
    expect(summary.totalMatchCount).toBe(7);
    expect(summary.pendingMatchCount).toBe(7);
    expect(summary.coverageComplete).toBe(false);
  });
  test('complete real group-to-knockout closure, personal rematch samples, public revocation and explicit history', async () => {
    const f = await fixture(h);
    let current = await read(h, f.event);
    for (const m of await currentMatches(h, f.event)) await confirm(h, m.id, 'HOME', true);
    current = await read(h, f.event);
    expect(current.competition!.qualification.status).toBe('READY');
    const groupA = new Set(current.competition!.groups[0]!.participants.map((p) => p.entryId));
    const grant = await enable(h, f.event);
    const key = grant.publication!.publicEventId;
    const body = await roundBody(h, f.event, f.resource, true);
    data<EventGroupKnockoutData>(await qualify(h, f.event, body));
    for (const path of [publicEventPath(key), `${publicEventPath(key)}/groups`])
      error(await anonymous(h, path), 404);
    const source = (await currentMatches(h, f.event)).find(
      (m) => m.roundNo <= f.schedule.rounds.length,
    )!;
    const beforeMaintenance = (await read(h, f.event)).competition!.qualification.sourceHash;
    await assign(h, source.id, h.otherOwner, 'SCORER', 'DISABLED');
    expect((await read(h, f.event)).competition!.qualification.sourceHash).toBe(beforeMaintenance);
    const sourceWorkbench = await workbench(h, source.id);
    const reopen = envelope(sourceWorkbench.match.version, {
      type: 'REOPEN_RESULT',
      payload: { reason: '来源已用于资格不得重开' },
    });
    error(await sendCommand(h, source.id, h.owner, reopen), 409);
    for (const m of await currentMatches(h, f.event))
      if (m.status === 'SCHEDULED')
        await confirm(h, m.id, groupA.has(m.home.entryId) ? 'HOME' : 'AWAY', true);
    const next = await roundBody(h, f.event, f.resource, false);
    data(
      await call(h.api, 'post', roundCommandsPath(h.owner.orgId, f.event), {
        cookie: h.owner.cookie,
        body: next,
      }),
    );
    const final = (await currentMatches(h, f.event)).find((m) => m.status === 'SCHEDULED')!;
    expect(groupA.has(final.home.entryId) && groupA.has(final.away.entryId)).toBe(true);
    await confirm(h, final.id, 'HOME', true);
    current = await read(h, f.event);
    expect(current.competition).toMatchObject({
      totalMatchCount: 5,
      publishedMatchCount: 5,
      confirmedMatchCount: 5,
      isComplete: true,
    });
    const summary = data<EventPlayerStatisticsData>(
      await call(h.api, 'get', playerSummaryPath(h.owner.orgId, f.event), {
        cookie: h.owner.cookie,
      }),
    ).summary!;
    expect(summary.includedMatchCount).toBe(5);
    expect(summary.coverageComplete).toBe(true);
    expect(summary.rows.some((r) => r.rosterSampleMatchCount === 3)).toBe(true);
    const lifecycle = data<{ event: { version: number }; completion: { ready: boolean } }>(
      await call(h.api, 'get', lifecyclePath(h.owner.orgId, f.event), { cookie: h.owner.cookie }),
    );
    expect(lifecycle.completion.ready).toBe(true);
    data(
      await call(h.api, 'post', lifecycleCommandsPath(h.owner.orgId, f.event), {
        cookie: h.owner.cookie,
        body: {
          type: 'COMPLETE',
          expectedEventVersion: lifecycle.event.version,
          reason: '分组淘汰全届独立确认完成',
        },
      }),
    );
    const history = data<{ publication: { publicEventId: string } }>(
      await viewingCommand(h, f.event, 'ENABLE_HISTORY'),
    );
    const publicGroups = data<PublicGroupKnockoutData>(
      await anonymous(h, `${publicEventPath(history.publication.publicEventId)}/groups`),
    );
    expect(publicGroups.isComplete).toBe(true);
    expect(publicGroups.bracket?.placements).toHaveLength(4);
    expect(JSON.stringify(publicGroups)).not.toContain(final.home.entryId);
  }, 90000);
  test('cyclic tied groups require persistent single draws; failed allocation never rerolls; concurrent qualification commits once', async () => {
    const f = await fixture(h, 6);
    let current = await read(h, f.event);
    for (const m of await currentMatches(h, f.event)) {
      const g = current.competition!.groups.find((g) =>
        g.participants.some((p) => p.entryId === m.home.entryId),
      )!;
      const ids = g.participants.map((p) => p.entryId),
        a = ids.indexOf(m.home.entryId),
        b = ids.indexOf(m.away.entryId);
      await confirm(h, m.id, (a + 1) % 3 === b ? 'HOME' : 'AWAY');
    }
    current = await read(h, f.event);
    expect(current.competition!.qualification.status).toBe('TIE_BREAK_REQUIRED');
    for (const group of current.competition!.groups) {
      const latest = await read(h, f.event);
      const request = {
        type: 'DRAW_GROUP_TIE',
        expectedEventVersion: latest.event.version,
        expectedSourceHash: group.standings.sourceHash,
        groupKey: group.groupKey,
        reason: '三队循环同分必须独立抽签',
      };
      data(
        await call(
          h.api,
          'post',
          groupsPath(h, f.event).replace('/groups', '/group-tie-commands'),
          { cookie: h.owner.cookie, body: request },
        ),
      );
      const fresh = await read(h, f.event);
      error(
        await call(
          h.api,
          'post',
          groupsPath(h, f.event).replace('/groups', '/group-tie-commands'),
          {
            cookie: h.owner.cookie,
            body: { ...request, expectedEventVersion: fresh.event.version },
          },
        ),
        409,
      );
    }
    const drawn = await read(h, f.event),
      drawIds = drawn.competition!.groups.map((g) => g.draw!.id);
    expect(drawn.competition!.qualification.status).toBe('READY');
    const valid = await roundBody(h, f.event, f.resource, true),
      bad = structuredClone(valid);
    bad.allocations[0]!.startsAt = f.schedule.policy.courtWindows[0]!.startsAt;
    const rejected = await qualify(h, f.event, bad);
    error(rejected, 409);
    expect(rejected.body.error.code).toBe('KNOCKOUT_DEPENDENCY_ORDER');
    expect((await read(h, f.event)).competition!.groups.map((g) => g.draw!.id)).toEqual(drawIds);
    const responses = await Promise.all([qualify(h, f.event, valid), qualify(h, f.event, valid)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int n FROM group_qualification_publications WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, f.event],
        )
      ).rows[0]!.n,
    ).toBe(1);
    await expect(
      h.api.pool.query(
        'UPDATE group_tiebreak_draws SET reason=reason WHERE org_id=$1 AND event_id=$2',
        [h.owner.orgId, f.event],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      h.api.pool.query(
        'DELETE FROM group_qualification_publications WHERE org_id=$1 AND event_id=$2',
        [h.owner.orgId, f.event],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  }, 90000);
  test('four and eight groups retain separated seeds and exact fixed qualification in the original tables', async () => {
    for (const groupCount of [4, 8] as const) {
      const f = await fixture(h, groupCount * 2, groupCount);
      let current = await read(h, f.event);
      expect(current.competition!.groups).toHaveLength(groupCount);
      for (const m of await currentMatches(h, f.event)) await confirm(h, m.id);
      current = await read(h, f.event);
      expect(current.competition!.qualification.status).toBe('READY');
      data(await qualify(h, f.event, await roundBody(h, f.event, f.resource, true)));
      const next = await read(h, f.event);
      expect(next.competition!.bracket!.rounds[0]!.slots).toHaveLength(groupCount);
      expect((await currentMatches(h, f.event)).length).toBe(groupCount * 2);
    }
  }, 90000);
  test('group management reads and commands remain inaccessible to anonymous, other organization and leader roles', async () => {
    const f = await fixture(h);
    error(await call(h.api, 'get', groupsPath(h, f.event)), 401);
    error(
      await call(h.api, 'get', groupsPath(h, f.event).replace(h.owner.orgId, h.otherOwner.orgId), {
        cookie: h.otherOwner.cookie,
      }),
      404,
    );
    error(await call(h.api, 'get', groupsPath(h, f.event), { cookie: h.leader.cookie }), 404);
    const before = (await read(h, f.event)).event.version;
    error(
      await qualify(h, f.event, {
        type: 'PUBLISH_QUALIFICATION',
        expectedEventVersion: before,
        expectedSourceHash: '0'.repeat(64),
        reason: '未确认不得提前产生晋级',
        allocations: [],
      }),
      409,
    );
    expect((await read(h, f.event)).event.version).toBe(before);
  });
});
