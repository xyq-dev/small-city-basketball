import { expect, test, devices } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
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
  ScoringEventData,
  ScoringWorkbenchData,
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
    email: `score-owner-${suffix}@example.test`,
    password: `Scoring-owner-${suffix}`,
    displayName: '独立赛果确认员',
    organizationName: `记分验证机构-${suffix}`,
  });
  const root = `/v1/orgs/${session.organizations[0]!.id}`;
  const captain = await write<SessionData>(leader, 'POST', '/v1/auth/register-participant', {
    email: `score-leader-${suffix}@example.test`,
    password: `Scoring-leader-${suffix}`,
    displayName: '报名合成领队',
  });
  const writer = await write<SessionData>(scorer, 'POST', '/v1/auth/register-participant', {
    email: `score-writer-${suffix}@example.test`,
    password: `Scoring-writer-${suffix}`,
    displayName: '仅场次授权记分员',
  });
  await write(owner, 'PUT', `${root}/members/${writer.user.id}`, {
    role: 'SCORER',
    status: 'ACTIVE',
  });
  const event = await write<EventData>(owner, 'POST', `${root}/events`, {
    name: `基础记分验证-${suffix}`,
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
  for (let index = 1; index <= 2; index += 1) {
    let team = await write<TeamData>(owner, 'POST', `${root}/teams`, {
      name: `记分合成队${index}`,
    });
    team = await write<TeamData>(owner, 'PUT', `${root}/teams/${team.id}/members`, {
      expectedVersion: team.version,
      members: [{ name: `记分合成球员${index}` }],
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
            endsAt: '2026-12-01T03:00:00.000Z',
          },
        ],
      },
    },
  );
  const revisionPath = `${root}/schedule-revisions/${revision.id}`;
  revision = await write<ScheduleRevisionData>(owner, 'PUT', `${revisionPath}/allocations`, {
    expectedEventVersion: revision.eventVersion,
    expectedRevisionVersion: revision.version,
    allocations: revision.fixtures.map((fixture) => ({
      fixtureKey: fixture.fixtureKey,
      courtId: court.id,
      startsAt: '2026-12-01T01:00:00.000Z',
    })),
  });
  await write(owner, 'POST', `${revisionPath}/publish`, {
    expectedEventVersion: revision.eventVersion,
    expectedRevisionVersion: revision.version,
  });
  const matches = await read<ScheduledMatchData[]>(owner, `${eventPath}/matches`);
  expect(matches).toHaveLength(1);
  return { root, eventPath, eventId: event.id, writer, match: matches[0]!, revisionPath };
}

test('真实记分单端控制、丢响应核对、断网停写及独立确认重开', async ({
  page,
  playwright,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const leader = await playwright.request.newContext({ baseURL: origin });
  const scorer = await playwright.request.newContext({ baseURL: origin });
  let writerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let phase = 'prepare published fixture';
  const progress = (value: string) => {
    phase = value;
    console.log(`[scoring:${testInfo.project.name}] ${value}`);
  };
  try {
    const fixture = await publishedFixture(page.request, leader, scorer, suffix);
    const matchPath = `${fixture.root}/matches/${fixture.match.id}`;
    const uiPath = `/matches/${fixture.match.id}/scoring`;
    const frozenPlan = await read<ScheduleRevisionData>(page.request, fixture.revisionPath);
    progress('configure explicit rules and match-only staff');
    await page.goto(`/events/${fixture.eventId}/scoring`);
    await page.getByLabel('常规节数', { exact: true }).fill('1');
    await page.getByLabel('每节时长（秒）', { exact: true }).fill('60');
    for (const value of [1, 2, 3]) await page.getByLabel(`允许${value}分`, { exact: true }).check();
    await page.getByLabel('平局处理', { exact: true }).selectOption('ALLOW_DRAW');
    await page.getByRole('button', { name: '保存记分规则', exact: true }).click();
    await expect(page.getByText('记分规则已保存', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.goto(uiPath);
    await page.getByLabel('工作人员用户ID', { exact: true }).fill(fixture.writer.user.id);
    await page.getByLabel('场次角色', { exact: true }).selectOption('SCORER');
    await page.getByLabel('授权状态', { exact: true }).selectOption('ACTIVE');
    await page.getByRole('button', { name: '保存场次人员', exact: true }).click();
    await expect(page.getByText('仅场次授权记分员', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '准备比赛', exact: true }).click();
    await expect
      .poll(async () => (await read<ScoreSnapshot>(page.request, `${matchPath}/snapshot`)).status)
      .toBe('READY');

    writerContext = await browser.newContext({
      ...(testInfo.project.name.includes('mobile')
        ? devices['iPhone 13']
        : devices['Desktop Chrome']),
      viewport: page.viewportSize()!,
      baseURL: origin,
      storageState: await scorer.storageState(),
    });
    const writer = await writerContext.newPage();
    writer.on('pageerror', (error) => errors.push(error.message));
    await writer.goto(uiPath);
    await writer.getByRole('button', { name: '取得记分控制权', exact: true }).click();
    await writer.getByRole('button', { name: '开始比赛', exact: true }).click();
    await expect
      .poll(async () => (await read<ScoreSnapshot>(scorer, `${matchPath}/snapshot`)).status)
      .toBe('LIVE');

    progress('lose accepted score acknowledgement and reconcile original receipt');
    let lostCommandId = '';
    await writer.route('**/commands', async (route) => {
      const body = route.request().postDataJSON();
      if (body.type === 'RECORD_STAT' && body.payload.kind === 'SCORE' && !lostCommandId) {
        lostCommandId = body.commandId;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort('failed');
      } else await route.continue();
    });
    await writer.getByRole('button', { name: '主队加2分', exact: true }).click();
    await expect(writer.getByText('结果待核对', { exact: true })).toBeVisible();
    expect(lostCommandId).not.toBe('');
    await writer.getByRole('button', { name: '核对提交结果', exact: true }).click();
    await expect(writer.getByText('结果待核对', { exact: true })).toHaveCount(0);
    const afterLostAck = await read<ScoreSnapshot>(scorer, `${matchPath}/snapshot`);
    expect(afterLostAck.totals.home.score).toBe(2);
    const events = await read<ScoringEventData[]>(scorer, `${matchPath}/scoring-events?limit=100`);
    expect(events.filter((event) => event.commandId === lostCommandId)).toHaveLength(1);

    progress('offline prevents new writes, reconnect retains authoritative score');
    await writerContext.setOffline(true);
    await expect(writer.getByRole('button', { name: '主队加1分', exact: true })).toBeDisabled();
    await writerContext.setOffline(false);
    await expect(writer.getByRole('button', { name: '主队加1分', exact: true })).toBeEnabled();
    expect((await read<ScoreSnapshot>(scorer, `${matchPath}/snapshot`)).totals.home.score).toBe(2);

    progress('server clock and reasoned correction');
    await writer.getByRole('button', { name: '启动时钟', exact: true }).click();
    await expect
      .poll(async () => (await read<ScoreSnapshot>(scorer, `${matchPath}/snapshot`)).clock.running)
      .toBe(true);
    await writer.getByRole('button', { name: '暂停时钟', exact: true }).click();
    await expect
      .poll(async () => (await read<ScoreSnapshot>(scorer, `${matchPath}/snapshot`)).clock.running)
      .toBe(false);
    await writer.getByRole('button', { name: '修正比赛记录', exact: true }).click();
    await writer.getByLabel('修正方式', { exact: true }).selectOption('ADD_CORRECTION');
    await writer.getByLabel('统计项目', { exact: true }).selectOption('SCORE');
    await writer.getByLabel('所属球队', { exact: true }).selectOption('HOME');
    await writer.getByLabel('统计数值', { exact: true }).fill('1');
    await writer.getByLabel('统计节次', { exact: true }).fill('1');
    await writer.getByLabel('修正理由', { exact: true }).fill('合成验收：补录漏记的一分');
    await writer.getByRole('button', { name: '提交修正', exact: true }).click();
    await expect
      .poll(
        async () => (await read<ScoreSnapshot>(scorer, `${matchPath}/snapshot`)).totals.home.score,
      )
      .toBe(3);
    // Clock labels are kept explicit so the test exercises a reasoned server command.
    await writer.getByRole('button', { name: '校正时钟', exact: true }).click();
    await writer.getByLabel('剩余毫秒', { exact: true }).fill('0');
    await writer.getByLabel('校时理由', { exact: true }).fill('合成验收：节末时钟核对归零');
    await writer.getByRole('button', { name: '提交校时', exact: true }).click();
    await writer.getByRole('button', { name: '结束计分', exact: true }).click();
    await expect
      .poll(async () => (await read<ScoreSnapshot>(scorer, `${matchPath}/snapshot`)).status)
      .toBe('PENDING_CONFIRMATION');
    await expect(writer.getByRole('button', { name: '确认当前赛果', exact: true })).toHaveCount(0);

    progress('independent exact-version result confirmation and preserved reopen history');
    await page.reload();
    await page.getByRole('button', { name: '确认当前赛果', exact: true }).click();
    await page.getByRole('button', { name: '正式确认赛果', exact: true }).click();
    await expect
      .poll(async () => (await read<ScoreSnapshot>(page.request, `${matchPath}/snapshot`)).status)
      .toBe('FINAL');
    const final = await read<ScoreSnapshot>(page.request, `${matchPath}/snapshot`);
    expect(final.status).toBe('FINAL');
    expect(final.latestConfirmation?.home.score).toBe(3);
    expect(final.latestConfirmation?.confirmingUserId).not.toBe(fixture.writer.user.id);
    await page.getByRole('button', { name: '重开赛果', exact: true }).click();
    await page.getByLabel('重开理由', { exact: true }).fill('合成验收：复核历史赛果');
    await page.getByRole('button', { name: '确认重开赛果', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await read<ScoreSnapshot>(page.request, `${matchPath}/snapshot`)).requiresReconfirmation,
      )
      .toBe(true);
    await page.getByRole('button', { name: '确认当前赛果', exact: true }).click();
    await page.getByRole('button', { name: '正式确认赛果', exact: true }).click();
    await expect
      .poll(async () => (await read<ScoreSnapshot>(page.request, `${matchPath}/snapshot`)).status)
      .toBe('FINAL');
    const reconfirmed = await read<ScoreSnapshot>(page.request, `${matchPath}/snapshot`);
    expect(reconfirmed.status).toBe('FINAL');
    expect(reconfirmed.latestConfirmation?.id).not.toBe(final.latestConfirmation?.id);
    expect(
      await read<unknown[]>(page.request, `${matchPath}/result-confirmations?limit=100`),
    ).toHaveLength(2);
    const workbench = await read<ScoringWorkbenchData>(page.request, `${matchPath}/scoring`);
    expect(workbench.capabilities.canRecord).toBe(false);
    expect(await read<ScheduleRevisionData>(page.request, fixture.revisionPath)).toEqual({
      ...frozenPlan,
      eventVersion: workbench.event.version,
    });
    await page.goto(`/events/${fixture.eventId}/scheduling`);
    await expect(page.getByRole('heading', { name: '正式比赛安排', exact: true })).toBeVisible();
    expect(
      (await read<ScheduledMatchData[]>(page.request, `${fixture.eventPath}/matches`))[0]!.status,
    ).toBe('FINAL');
    expect(
      await writer.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
    ).toEqual({ local: 0, session: 0 });
    expect(errors).toEqual([]);
  } catch (error) {
    console.error(`[scoring:${testInfo.project.name}] failed during ${phase}`);
    throw error;
  } finally {
    await writerContext?.close().catch(() => {});
    await scorer.dispose().catch(() => {});
    await leader.dispose().catch(() => {});
  }
});
