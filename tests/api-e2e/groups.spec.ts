import { expect, test, devices } from '@playwright/test';
import type {
  CourtData,
  EventGroupKnockoutData,
  EventScoringData,
  EventStandingsData,
  PublicEventData,
  PublicGroupKnockoutData,
  PublicScheduleMatchData,
  ScheduleRevisionData,
  ScheduledMatchData,
  ScoringWorkbenchData,
  SessionData,
} from '@small-city-basketball/contracts';
import {
  origin,
  read,
  write,
  registration,
  scoreAndConfirm,
  syntheticIdentities,
} from './helpers/commercial-fixtures.js';
test('分组循环、固定交叉晋级与匿名组榜使用真实API及浏览器', async ({
  page,
  playwright,
  browser,
}, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const leader = await playwright.request.newContext({ baseURL: origin });
  const scorer = await playwright.request.newContext({ baseURL: origin });
  const anonymous = await playwright.request.newContext({ baseURL: origin });
  let publicContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let phase = 'isolated synthetic identities and real HTTP login';
  const progress = (value: string) => {
    phase = value;
    console.log(`[groups:${testInfo.project.name}] ${value}`);
  };
  try {
    const identities = await syntheticIdentities();
    for (const [i, actor] of [page.request, leader, scorer].entries()) {
      const session = await write<SessionData>(actor, 'POST', '/v1/auth/login', {
        email: identities.users[i]!.email,
        password: identities.password,
      });
      expect(session.user.id).toBe(identities.users[i]!.id);
    }
    const fixture = await registration(
      page.request,
      leader,
      identities.orgId,
      identities.users[1]!.id,
    );
    const { root, eventPath, eventId } = fixture;
    const scorerId = identities.users[2]!.id;
    await write(page.request, 'PUT', `${root}/members/${scorerId}`, {
      role: 'SCORER',
      status: 'ACTIVE',
    });
    const court = await write<CourtData>(page.request, 'POST', `${root}/courts`, {
      name: '分组真实浏览器球场',
    });
    let viewing = await write<EventStandingsData>(
      page.request,
      'PUT',
      `${eventPath}/standings-rules`,
      {
        expectedEventVersion: fixture.registration.event.version,
        winPoints: 2,
        lossPoints: 1,
        drawPoints: 0,
        tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR', 'WINS'],
      },
    );
    viewing = await write<EventStandingsData>(
      page.request,
      'POST',
      `${eventPath}/standings-rule-commands`,
      {
        type: 'PUBLISH_STANDINGS_RULES',
        expectedEventVersion: viewing.event.version,
        rulesetId: viewing.rules!.id,
      },
    );
    expect(viewing.locked).toBe(true);
    let revision = await write<ScheduleRevisionData>(
      page.request,
      'POST',
      `${eventPath}/schedule-revisions`,
      {
        expectedEventVersion: viewing.event.version,
        freezeId: fixture.registration.freeze!.id,
        algorithmVersion: 'GK_BALANCED_V1',
        groupConfig: {
          groupCount: 2,
          seededEntryIds: fixture.registration.freeze!.entries.slice(0, 2).map((e) => e.entryId),
        },
        policy: {
          slotDurationMinutes: 60,
          minRestMinutes: 30,
          minLocalDayGap: 0,
          courtWindows: [
            {
              courtId: court.id,
              startsAt: '2026-12-01T01:00:00.000Z',
              endsAt: '2026-12-01T09:00:00.000Z',
            },
          ],
        },
      },
    );
    expect(revision.fixtures).toHaveLength(2);
    expect(revision.groupConfig?.groupCount).toBe(2);
    progress('real browser reads the fixed server draw before schedule publication');
    await page.goto(`/events/${eventId}/scheduling`);
    const draw = page.getByRole('region', { name: '发布前分组核对', exact: true });
    await expect(draw).toBeVisible();
    await expect(draw.getByRole('heading', { name: 'A组', exact: true })).toBeVisible();
    await expect(draw.getByRole('heading', { name: 'B组', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const revisionPath = `${root}/schedule-revisions/${revision.id}`;
    revision = await write<ScheduleRevisionData>(
      page.request,
      'PUT',
      `${revisionPath}/allocations`,
      {
        expectedEventVersion: revision.eventVersion,
        expectedRevisionVersion: revision.version,
        allocations: revision.fixtures.map((f, i) => ({
          fixtureKey: f.fixtureKey,
          courtId: court.id,
          startsAt: `2026-12-01T0${1 + i * 2}:00:00.000Z`,
        })),
      },
    );
    await write(page.request, 'POST', `${revisionPath}/publish`, {
      expectedEventVersion: revision.eventVersion,
      expectedRevisionVersion: revision.version,
    });
    let scoring = await read<EventScoringData>(page.request, `${eventPath}/scoring`);
    scoring = await write<EventScoringData>(page.request, 'PUT', `${eventPath}/scoring-rules`, {
      expectedEventVersion: scoring.event.version,
      regulationPeriods: 1,
      periodDurationSeconds: 60,
      allowedScoreValues: [1, 2, 3],
      tiePolicy: 'OVERTIME',
      overtimeDurationSeconds: 60,
    });
    expect(scoring.rules?.tiePolicy).toBe('OVERTIME');
    let grouped = await read<EventGroupKnockoutData>(page.request, `${eventPath}/groups`);
    expect(grouped.competition?.totalMatchCount).toBe(5);
    expect(grouped.competition?.qualification.status).toBe('WAITING');
    expect(grouped.competition?.groups.map((g) => g.participants.length)).toEqual([2, 2]);
    const seeds = revision.groupConfig!.seededEntryIds;
    expect(
      grouped.competition?.groups.every(
        (g) => g.participants.filter((p) => seeds.includes(p.entryId)).length === 1,
      ),
    ).toBe(true);
    expect((await anonymous.get(origin + `${eventPath}/groups`)).status()).toBe(401);
    expect((await scorer.get(origin + `${eventPath}/groups`)).status()).toBe(404);
    const groupMatches = await read<ScheduledMatchData[]>(page.request, `${eventPath}/matches`);
    expect(groupMatches).toHaveLength(2);
    progress('the two original group matches are independently confirmed before qualification');
    for (const match of groupMatches)
      await scoreAndConfirm(page.request, scorer, root, match.id, scorerId);
    grouped = await read<EventGroupKnockoutData>(page.request, `${eventPath}/groups`);
    expect(grouped.competition?.qualification.status).toBe('READY');
    const next = grouped.competition!.nextRound!;
    expect(next.fixtures).toHaveLength(2);
    const [a, b] = grouped.competition!.groups;
    expect(next.fixtures[0]!.homeEntryId).toBe(a!.qualifiedEntryIds![0]);
    expect(next.fixtures[0]!.awayEntryId).toBe(b!.qualifiedEntryIds![1]);
    expect(next.fixtures[1]!.homeEntryId).toBe(b!.qualifiedEntryIds![0]);
    expect(next.fixtures[1]!.awayEntryId).toBe(a!.qualifiedEntryIds![1]);
    viewing = await read<EventStandingsData>(page.request, `${eventPath}/standings`);
    viewing = await write<EventStandingsData>(
      page.request,
      'POST',
      `${eventPath}/public-viewing-commands`,
      { type: 'ENABLE', expectedEventVersion: viewing.event.version },
    );
    const oldGrant = viewing.publication!.publicEventId;
    expect((await read<PublicEventData>(anonymous, `/v1/public/events/${oldGrant}`)).format).toBe(
      'GROUP_KNOCKOUT',
    );
    progress(
      'real browser reviews both fixed crossover games and explicitly confirms qualification publication',
    );
    await page.goto(`/events/${eventId}/groups`);
    await expect(page.getByRole('region', { name: 'A组 · 组内积分', exact: true })).toBeVisible();
    for (const [i, f] of next.fixtures.entries()) {
      const label = `第${next.roundNo}轮第${f.positionNo}场`;
      await page.getByLabel(`${label}场地`, { exact: true }).selectOption(court.id);
      await page
        .getByLabel(`${label}开始时间`, { exact: true })
        .fill(`2026-12-01T${13 + i * 2}:00`);
    }
    await page
      .getByLabel('晋级发布原因', { exact: true })
      .fill('浏览器核对已确认组赛和固定交叉席位');
    await page.getByRole('button', { name: '核对并发布淘汰首轮', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '正式发布晋级赛程', exact: true });
    await expect(dialog).toBeVisible();
    expect(await read<ScheduledMatchData[]>(page.request, `${eventPath}/matches`)).toHaveLength(2);
    await dialog.getByRole('button', { name: '确认正式发布', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(
        async () => (await read<ScheduledMatchData[]>(page.request, `${eventPath}/matches`)).length,
      )
      .toBe(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await anonymous.get(origin + `/v1/public/events/${oldGrant}`)).status()).toBe(404);
    expect((await anonymous.get(origin + `/v1/public/events/${oldGrant}/groups`)).status()).toBe(
      404,
    );
    const consumed = await read<ScoringWorkbenchData>(
      page.request,
      `${root}/matches/${groupMatches[0]!.id}/scoring`,
    );
    expect(consumed.capabilities.canReopen).toBe(false);
    viewing = await read<EventStandingsData>(page.request, `${eventPath}/standings`);
    viewing = await write<EventStandingsData>(
      page.request,
      'POST',
      `${eventPath}/public-viewing-commands`,
      { type: 'ENABLE', expectedEventVersion: viewing.event.version },
    );
    const freshGrant = viewing.publication!.publicEventId;
    expect(freshGrant).not.toBe(oldGrant);
    const publicData = await read<PublicGroupKnockoutData>(
      anonymous,
      `/v1/public/events/${freshGrant}/groups`,
    );
    expect(publicData.qualificationStatus).toBe('PUBLISHED');
    expect(publicData.groups.every((g) => g.qualified.length === 2)).toBe(true);
    expect(publicData.bracket?.publishedMatchCount).toBe(2);
    const publicSchedule = await read<PublicScheduleMatchData[]>(
      anonymous,
      `/v1/public/events/${freshGrant}/schedule`,
    );
    expect(publicSchedule).toHaveLength(4);
    const exposed = JSON.stringify(publicData);
    for (const p of grouped.competition!.groups.flatMap((g) => g.participants)) {
      expect(exposed).not.toContain(p.entryId);
      expect(exposed).not.toContain(p.teamId);
      expect(exposed).not.toContain(p.rosterRevisionId);
    }
    expect(exposed).not.toContain('仅私有合成球员');
    expect(exposed).not.toContain(revision.seed);
    publicContext = await browser.newContext({
      ...(testInfo.project.name === 'mobile-api'
        ? devices['iPhone 13']
        : devices['Desktop Chrome']),
      viewport: page.viewportSize()!,
      baseURL: origin,
    });
    const spectator = await publicContext.newPage();
    spectator.on('pageerror', (error) => errors.push(error.message));
    await spectator.goto(`/watch/${freshGrant}`);
    await spectator.getByRole('tab', { name: '分组与晋级', exact: true }).click();
    await expect(
      spectator.getByRole('region', { name: 'A组 · 组内积分', exact: true }),
    ).toBeVisible();
    await expect(
      spectator.getByRole('region', { name: 'B组 · 组内积分', exact: true }),
    ).toBeVisible();
    await expect(
      spectator.getByRole('region', { name: '公开淘汰赛签位', exact: true }),
    ).toBeVisible();
    await expect(
      spectator.getByRole('region', { name: '分组淘汰最终名次', exact: true }),
    ).toContainText('最终名次未产生');
    await expect(
      spectator.getByRole('button', { name: /发布淘汰首轮|发布下一轮|确认赛果|取得记分控制权/ }),
    ).toHaveCount(0);
    expect(await spectator.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    progress('desktop or mobile group standings and bracket are read-only and fit the viewport');
  } catch (error) {
    throw new Error(`Group browser check failed during: ${phase}`, { cause: error });
  } finally {
    await publicContext?.close();
    await anonymous.dispose();
    await scorer.dispose();
    await leader.dispose();
  }
});
