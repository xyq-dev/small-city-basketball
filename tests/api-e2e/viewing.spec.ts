import { devices, expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type {
  CourtData,
  EntryData,
  EventData,
  EventRegistrationData,
  ScheduleRevisionData,
  ScheduledMatchData,
  SessionData,
  TeamData,
  ScoreSnapshot,
  ScoringWorkbenchData,
  EventScoringData,
  EventStandingsData,
  PublicEventData,
  PublicStandingsData,
  PublicScheduleMatchData,
  PublicMatchSnapshotData,
  ScoringControl,
  ScorekeeperLeaseData,
  ScoringCommandPayload,
  ScoringCommandResponse,
} from '@small-city-basketball/contracts';

const origin = 'http://127.0.0.1:4273';
async function write<T>(
  request: APIRequestContext,
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
): Promise<T> {
  const response = await request.fetch(origin + path, {
    method,
    headers: { Origin: origin },
    data: body,
  });
  expect(response.ok(), `${method} ${path}: HTTP ${response.status()}`).toBe(true);
  return (await response.json()).data as T;
}
async function read<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(origin + path);
  expect(response.ok(), `${path}: HTTP ${response.status()}`).toBe(true);
  return (await response.json()).data as T;
}

async function publishedFixture(
  owner: APIRequestContext,
  leader: APIRequestContext,
  scorer: APIRequestContext,
  suffix: string,
) {
  const session = await write<SessionData>(owner, 'POST', '/v1/auth/register', {
    email: `watch-owner-${suffix}@example.test`,
    password: `Scoring-owner-${suffix}`,
    displayName: '独立赛果确认员',
    organizationName: `记分验证机构-${suffix}`,
  });
  const root = `/v1/orgs/${session.organizations[0]!.id}`;
  const captain = await write<SessionData>(leader, 'POST', '/v1/auth/register-participant', {
    email: `watch-leader-${suffix}@example.test`,
    password: `Scoring-leader-${suffix}`,
    displayName: '报名合成领队',
  });
  const writer = await write<SessionData>(scorer, 'POST', '/v1/auth/register-participant', {
    email: `watch-writer-${suffix}@example.test`,
    password: `Scoring-writer-${suffix}`,
    displayName: '仅场次授权记分员',
  });
  await write(owner, 'PUT', `${root}/members/${writer.user.id}`, {
    role: 'SCORER',
    status: 'ACTIVE',
  });
  const event = await write<EventData>(owner, 'POST', `${root}/events`, {
    name: `公开观赛验证-${suffix}`,
    startDate: '2026-12-01',
    endDate: '2026-12-02',
    timezone: 'Asia/Shanghai',
    format: 'ROUND_ROBIN',
  });
  const eventPath = `${root}/events/${event.id}`;
  let registration = await write<EventRegistrationData>(
    owner,
    'PUT',
    `${eventPath}/registration-rules`,
    {
      expectedVersion: event.version,
      minPlayers: 1,
      maxPlayers: 2,
      zeroAndDoubleZeroDistinct: true,
      requireIdentity: false,
      requireInsurance: false,
    },
  );
  async function command(type: 'OPEN_REGISTRATION' | 'CLOSE_REGISTRATION' | 'FREEZE_REGISTRATION') {
    registration = await write<EventRegistrationData>(
      owner,
      'POST',
      `${eventPath}/registration-commands`,
      {
        type,
        expectedVersion: registration.event.version,
      },
    );
  }
  await command('OPEN_REGISTRATION');
  for (let index = 1; index <= 3; index += 1) {
    let team = await write<TeamData>(owner, 'POST', `${root}/teams`, {
      name: `观赛合成队${index}`,
    });
    team = await write<TeamData>(owner, 'PUT', `${root}/teams/${team.id}/members`, {
      expectedVersion: team.version,
      members: [{ name: `观赛合成球员${index}` }],
    });
    await write(owner, 'PUT', `${root}/teams/${team.id}/grants/${captain.user.id}`, {
      status: 'ACTIVE',
    });
    let entry = await write<EntryData>(leader, 'POST', `${eventPath}/entries`, { teamId: team.id });
    const path = `${root}/entries/${entry.id}`;
    entry = await write<EntryData>(leader, 'PUT', `${path}/roster`, {
      expectedVersion: entry.version,
      players: [{ memberId: team.members[0]!.id, jerseyNo: String(index) }],
    });
    entry = await write<EntryData>(leader, 'POST', `${path}/commands`, {
      type: 'SUBMIT',
      expectedVersion: entry.version,
    });
    await write(owner, 'POST', `${path}/commands`, {
      type: 'APPROVE',
      expectedVersion: entry.version,
    });
  }
  registration = await read<EventRegistrationData>(owner, `${eventPath}/registration`);
  await command('CLOSE_REGISTRATION');
  await command('FREEZE_REGISTRATION');
  const court = await write<CourtData>(owner, 'POST', `${root}/courts`, {
    name: `记分合成场-${suffix}`,
  });
  let revision = await write<ScheduleRevisionData>(
    owner,
    'POST',
    `${eventPath}/schedule-revisions`,
    {
      expectedEventVersion: registration.event.version,
      freezeId: registration.freeze!.id,
      algorithmVersion: 'RR_CIRCLE_V1',
      policy: {
        slotDurationMinutes: 60,
        minRestMinutes: 0,
        minLocalDayGap: 0,
        courtWindows: [
          {
            courtId: court.id,
            startsAt: '2026-12-01T01:00:00.000Z',
            endsAt: '2026-12-01T05:00:00.000Z',
          },
        ],
      },
    },
  );
  const revisionPath = `${root}/schedule-revisions/${revision.id}`;
  revision = await write<ScheduleRevisionData>(owner, 'PUT', `${revisionPath}/allocations`, {
    expectedEventVersion: revision.eventVersion,
    expectedRevisionVersion: revision.version,
    allocations: revision.fixtures.map((fixture, index) => ({
      fixtureKey: fixture.fixtureKey,
      courtId: court.id,
      startsAt: `2026-12-01T0${index + 1}:00:00.000Z`,
    })),
  });
  await write(owner, 'POST', `${revisionPath}/publish`, {
    expectedEventVersion: revision.eventVersion,
    expectedRevisionVersion: revision.version,
  });
  const matches = await read<ScheduledMatchData[]>(owner, `${eventPath}/matches`);
  expect(matches).toHaveLength(3);
  return { root, eventPath, eventId: event.id, writer, match: matches[0]!, revisionPath };
}

test('公开观赛隔离会话、正式排名重开重算、撤销及新链接', async ({
  page,
  browser,
  playwright,
}, testInfo) => {
  test.setTimeout(150000);
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const leader = await playwright.request.newContext();
  const scorer = await playwright.request.newContext();
  const anonymous = await browser.newContext({
    ...(testInfo.project.name.includes('mobile')
      ? devices['iPhone 13']
      : devices['Desktop Chrome']),
    baseURL: origin,
    viewport: page.viewportSize()!,
    storageState: { cookies: [], origins: [] },
  });
  const viewer = await anonymous.newPage();
  const errors: string[] = [];
  const privateRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  viewer.on('pageerror', (error) => errors.push(error.message));
  viewer.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/v1\/(auth|orgs|invitations)(\/|$)/.test(path)) privateRequests.push(path);
  });
  let phase = 'publish fixture';
  const progress = (value: string) => {
    phase = value;
    console.log(`[viewing:${testInfo.project.name}] ${value}`);
  };
  try {
    const fixture = await publishedFixture(page.request, leader, scorer, suffix);
    const privatePath = `${fixture.eventPath}/standings`;
    const privateUi = `/events/${fixture.eventId}/standings`;
    progress('explicit ranking rules and public publication through owner UI');
    await page.goto(privateUi);
    await page.getByLabel('胜场积分', { exact: true }).fill('3');
    await page.getByLabel('负场积分', { exact: true }).fill('0');
    await page.getByLabel('平局积分', { exact: true }).fill('1');
    await page.getByRole('button', { name: '保存排名规则草稿', exact: true }).click();
    await expect
      .poll(async () => (await read<EventStandingsData>(page.request, privatePath)).rules?.version)
      .toBe(1);
    await page.getByRole('button', { name: '发布排名规则', exact: true }).click();
    await page.getByRole('button', { name: '正式发布排名规则', exact: true }).click();
    await expect
      .poll(async () => (await read<EventStandingsData>(page.request, privatePath)).locked)
      .toBe(true);
    await page.getByRole('button', { name: '启用公开观赛', exact: true }).click();
    await page.getByRole('button', { name: '确认启用公开观赛', exact: true }).click();
    await expect
      .poll(
        async () => (await read<EventStandingsData>(page.request, privatePath)).publication?.status,
      )
      .toBe('ACTIVE');
    const workspace = await read<EventStandingsData>(page.request, privatePath);
    const publicId = workspace.publication!.publicEventId;
    const publicPath = `/v1/public/events/${publicId}`;
    const publicUi = `/watch/${publicId}`;
    await viewer.goto(publicUi);
    const overview = await read<PublicEventData>(anonymous.request, publicPath);
    await expect(viewer.getByRole('heading', { name: overview.name, exact: true })).toBeVisible();
    await viewer.getByRole('tab', { name: '赛事排名', exact: true }).click();
    await expect(viewer.getByText('尚无已确认赛果', { exact: true }).first()).toBeVisible();
    const schedule = await read<PublicScheduleMatchData[]>(
      anonymous.request,
      `${publicPath}/schedule`,
    );
    expect(schedule).toHaveLength(3);
    const publicMatch = schedule[0]!;
    const publicMatchPath = `${publicPath}/matches/${publicMatch.publicMatchId}`;
    const before = await read<PublicMatchSnapshotData>(anonymous.request, publicMatchPath);
    expect(before.score).toBeNull();
    expect(before.clock).toBeNull();
    expect(before.totals).toBeNull();
    expect(before.collected.teamScore).toBe(false);
    const publicJson = JSON.stringify({ overview, schedule, before });
    for (const id of [
      fixture.eventId,
      fixture.match.id,
      fixture.writer.user.id,
      fixture.root.split('/').at(-1)!,
    ]) {
      expect(publicJson).not.toContain(id);
    }
    await viewer.goto(`${publicUi}/matches/${publicMatch.publicMatchId}`);
    await expect(viewer.getByText('尚未准备', { exact: true }).first()).toBeVisible();

    progress('independent confirmed result enters ranking once');
    const matchPath = `${fixture.root}/matches/${fixture.match.id}`;
    const scoring = await read<EventScoringData>(page.request, `${fixture.eventPath}/scoring`);
    await write(page.request, 'PUT', `${fixture.eventPath}/scoring-rules`, {
      expectedEventVersion: scoring.event.version,
      regulationPeriods: 1,
      periodDurationSeconds: 60,
      allowedScoreValues: [1, 2, 3],
      tiePolicy: 'ALLOW_DRAW',
      overtimeDurationSeconds: null,
    });
    await write(page.request, 'PUT', `${matchPath}/staff/${fixture.writer.user.id}`, {
      expectedMatchVersion: fixture.match.version,
      role: 'SCORER',
      status: 'ACTIVE',
    });
    async function command(
      actor: APIRequestContext,
      input: ScoringCommandPayload,
      control?: ScoringControl,
    ) {
      const workbench = await read<ScoringWorkbenchData>(actor, `${matchPath}/scoring`);
      return write<ScoringCommandResponse>(actor, 'POST', `${matchPath}/commands`, {
        ...input,
        ...(input.type === 'PREPARE_MATCH' || input.type === 'START_MATCH'
          ? { payload: { expectedEventVersion: workbench.event.version } }
          : {}),
        commandId: randomUUID(),
        expectedVersion: workbench.match.version,
        capturedAt: new Date().toISOString(),
        ...(control ? { control } : {}),
      });
    }
    await command(page.request, { type: 'PREPARE_MATCH', payload: { expectedEventVersion: 0 } });
    const lease = await write<ScorekeeperLeaseData>(
      scorer,
      'POST',
      `${matchPath}/scorekeeper-lease`,
      {
        clientInstanceId: randomUUID(),
      },
    );
    const control: ScoringControl = {
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      clientInstanceId: lease.clientInstanceId,
    };
    await command(scorer, { type: 'START_MATCH', payload: { expectedEventVersion: 0 } }, control);
    await command(
      scorer,
      { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 2 } },
      control,
    );
    await command(scorer, { type: 'CLOCK_START', payload: {} }, control);
    // An aged raw anchor detects deducting elapsed server time twice in the UI.
    await expect
      .poll(async () => {
        const live = await read<PublicMatchSnapshotData>(anonymous.request, publicMatchPath);
        return Date.parse(live.serverTime) - Date.parse(live.clock!.anchorServerTime);
      })
      .toBeGreaterThanOrEqual(3000);
    const freshClockResponse = viewer.waitForResponse(
      (response) => new URL(response.url()).pathname === publicMatchPath && response.ok(),
    );
    await viewer.getByRole('button', { name: '刷新公开资料', exact: true }).click();
    const live = (await (await freshClockResponse).json()).data as PublicMatchSnapshotData;
    expect(live.clock!.running).toBe(true);
    expect(live.clock!.remainingMs).toBe(60000);
    const expectedSeconds = Math.ceil(
      (live.clock!.remainingMs -
        (Date.parse(live.serverTime) - Date.parse(live.clock!.anchorServerTime))) /
        1000,
    );
    const clock = viewer.getByLabel('比赛剩余时间', { exact: true });
    await expect
      .poll(async () => {
        const text = await clock.textContent();
        if (!text || !/^\d+:\d{2}$/.test(text)) return Infinity;
        const [minutes, seconds] = text.split(':').map(Number);
        return Math.abs(minutes! * 60 + seconds! - expectedSeconds);
      })
      .toBeLessThanOrEqual(1);
    const firstClock = await clock.textContent();
    await expect.poll(() => clock.textContent()).not.toBe(firstClock);
    await command(scorer, { type: 'CLOCK_PAUSE', payload: {} }, control);
    await command(
      scorer,
      { type: 'CLOCK_SET', payload: { remainingMs: 0, reason: '公开观赛验收节末归零' } },
      control,
    );
    await command(scorer, { type: 'END_MATCH', payload: {} }, control);
    await command(page.request, { type: 'CONFIRM_RESULT', payload: {} });
    const confirmed = await read<PublicStandingsData>(anonymous.request, `${publicPath}/standings`);
    expect(confirmed.confirmedMatchCount).toBe(1);
    expect(confirmed.totalMatchCount).toBe(3);
    expect(confirmed.isComplete).toBe(false);
    expect(confirmed.rows.reduce((sum, row) => sum + row.played, 0)).toBe(2);
    expect(confirmed.rows.reduce((sum, row) => sum + row.leaguePoints, 0)).toBe(3);
    await expect
      .poll(
        async () =>
          (await read<PublicMatchSnapshotData>(anonymous.request, publicMatchPath)).resultStatus,
      )
      .toBe('CONFIRMED');
    await expect(viewer.getByText('赛果已确认', { exact: true }).first()).toBeVisible();
    await viewer.goto(publicUi);
    await viewer.getByRole('tab', { name: '赛事排名', exact: true }).click();
    const winner = confirmed.rows.find((row) => row.wins === 1)!;
    const ranking = viewer.getByRole('region', { name: '赛事排名', exact: true });
    const winningRow = ranking
      .getByRole(testInfo.project.name.includes('mobile') ? 'article' : 'row')
      .filter({ hasText: winner.teamName });
    await expect(winningRow).toBeVisible();
    if (testInfo.project.name.includes('mobile'))
      await expect(winningRow.getByText('3 积分', { exact: true })).toBeVisible();
    else await expect(winningRow.getByRole('cell').last()).toHaveText('3');

    progress('reopen removes result immediately; reconfirm restores only newest confirmation');
    await command(page.request, {
      type: 'REOPEN_RESULT',
      payload: { reason: '公开观赛验收复核赛果' },
    });
    expect(
      (await read<PublicStandingsData>(anonymous.request, `${publicPath}/standings`))
        .confirmedMatchCount,
    ).toBe(0);
    expect(
      (await read<PublicMatchSnapshotData>(anonymous.request, publicMatchPath)).resultStatus,
    ).toBe('REQUIRES_RECONFIRMATION');
    await expect(viewer.getByText('尚无已确认赛果', { exact: true }).first()).toBeVisible();
    await command(page.request, { type: 'CONFIRM_RESULT', payload: {} });
    const reconfirmed = await read<PublicStandingsData>(
      anonymous.request,
      `${publicPath}/standings`,
    );
    expect(reconfirmed.confirmedMatchCount).toBe(1);
    expect(reconfirmed.rows).toEqual(confirmed.rows);
    expect(reconfirmed.sourceHash).not.toBe(confirmed.sourceHash);

    progress('public offline freshness and no private session initialization');
    await anonymous.setOffline(true);
    await expect(viewer.getByText(/离线/).first()).toBeVisible();
    await anonymous.setOffline(false);
    await expect(viewer.getByText(/离线/)).toHaveCount(0);
    expect(privateRequests).toEqual([]);
    expect(await anonymous.cookies()).toEqual([]);

    progress('revoke active link, clear open page and issue entirely new public identities');
    await page.reload();
    await page.getByRole('button', { name: '撤销公开观赛', exact: true }).click();
    await page.getByRole('button', { name: '确认撤销公开观赛', exact: true }).click();
    await expect
      .poll(async () => (await anonymous.request.get(origin + publicPath)).status())
      .toBe(404);
    await expect(viewer.getByText('观赛链接不可用', { exact: true })).toBeVisible();
    await expect(viewer.getByRole('heading', { name: overview.name, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '启用公开观赛', exact: true }).click();
    await page.getByRole('button', { name: '确认启用公开观赛', exact: true }).click();
    await expect
      .poll(
        async () => (await read<EventStandingsData>(page.request, privatePath)).publication?.status,
      )
      .toBe('ACTIVE');
    const nextId = (await read<EventStandingsData>(page.request, privatePath)).publication!
      .publicEventId;
    expect(nextId).not.toBe(publicId);
    expect((await anonymous.request.get(origin + publicMatchPath)).status()).toBe(404);
    const nextSchedule = await read<PublicScheduleMatchData[]>(
      anonymous.request,
      `/v1/public/events/${nextId}/schedule`,
    );
    expect(
      nextSchedule
        .map((match) => match.publicMatchId)
        .some((id) => schedule.some((old) => old.publicMatchId === id)),
    ).toBe(false);
    expect(
      nextSchedule
        .flatMap((match) => [match.home.teamKey, match.away.teamKey])
        .some((key) =>
          schedule.some((old) => old.home.teamKey === key || old.away.teamKey === key),
        ),
    ).toBe(false);
    await viewer.goto(`/watch/${nextId}`);
    await expect(viewer.getByRole('heading', { name: overview.name, exact: true })).toBeVisible();
    expect(privateRequests).toEqual([]);
    expect(errors).toEqual([]);
  } catch (error) {
    console.error(`[viewing:${testInfo.project.name}] failed during ${phase}`);
    throw error;
  } finally {
    await anonymous.close().catch(() => {});
    await scorer.dispose().catch(() => {});
    await leader.dispose().catch(() => {});
  }
});
