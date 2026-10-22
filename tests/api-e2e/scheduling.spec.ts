import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import type {
  CourtData,
  EntryData,
  EventData,
  EventRegistrationData,
  EventSchedulingData,
  ScheduleRevisionData,
  ScheduledMatchData,
  SessionData,
  TeamData,
} from '@small-city-basketball/contracts';

const origin = 'http://127.0.0.1:4273';
async function write<T>(
  request: APIRequestContext,
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
): Promise<T> {
  const response = await request.fetch(`${origin}${path}`, {
    method,
    headers: { Origin: origin },
    data: body,
  });
  expect(response.ok(), `${method} ${path}: HTTP ${response.status()}`).toBe(true);
  return (await response.json()).data as T;
}
async function read<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${origin}${path}`);
  expect(response.ok(), `${path}: HTTP ${response.status()}`).toBe(true);
  return (await response.json()).data as T;
}

test('冻结名单生成赛程、修正冲突并一次发布到真实数据库', async ({ page, playwright }, testInfo) => {
  test.setTimeout(90000);
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const session = await write<SessionData>(page.request, 'POST', '/v1/auth/register', {
    email: `schedule-owner-${suffix}@example.test`,
    password: `Schedule-owner-${suffix}`,
    displayName: '排赛验证员',
    organizationName: `排赛验证机构-${suffix}`,
  });
  const root = `/v1/orgs/${session.organizations[0]!.id}`;
  const leader = await playwright.request.newContext({ baseURL: origin });
  let phase = 'preparing frozen registration';
  const progress = (value: string) => {
    phase = value;
    console.log(`[scheduling:${testInfo.project.name}] ${value}`);
  };
  try {
    const participant = await write<SessionData>(leader, 'POST', '/v1/auth/register-participant', {
      email: `schedule-leader-${suffix}@example.test`,
      password: `Schedule-leader-${suffix}`,
      displayName: '排赛合成领队',
    });
    const event = await write<EventData>(page.request, 'POST', `${root}/events`, {
      name: `排赛验证赛事-${suffix}`,
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      timezone: 'Asia/Shanghai',
      format: 'ROUND_ROBIN',
    });
    const eventPath = `${root}/events/${event.id}`;
    let registration = await write<EventRegistrationData>(
      page.request,
      'PUT',
      `${eventPath}/registration-rules`,
      {
        expectedVersion: event.version,
        minPlayers: 1,
        maxPlayers: 3,
        zeroAndDoubleZeroDistinct: true,
        requireIdentity: false,
        requireInsurance: false,
      },
    );
    async function command(
      type: 'OPEN_REGISTRATION' | 'CLOSE_REGISTRATION' | 'FREEZE_REGISTRATION',
    ) {
      registration = await write<EventRegistrationData>(
        page.request,
        'POST',
        `${eventPath}/registration-commands`,
        { type, expectedVersion: registration.event.version },
      );
    }
    await command('OPEN_REGISTRATION');
    for (let index = 1; index <= 3; index += 1) {
      let team = await write<TeamData>(page.request, 'POST', `${root}/teams`, {
        name: `赛程合成队${index}`,
      });
      team = await write<TeamData>(page.request, 'PUT', `${root}/teams/${team.id}/members`, {
        expectedVersion: team.version,
        members: [{ name: `赛程合成球员${index}` }],
      });
      await write(page.request, 'PUT', `${root}/teams/${team.id}/grants/${participant.user.id}`, {
        status: 'ACTIVE',
      });
      let entry = await write<EntryData>(leader, 'POST', `${eventPath}/entries`, {
        teamId: team.id,
      });
      const entryPath = `${root}/entries/${entry.id}`;
      entry = await write<EntryData>(leader, 'PUT', `${entryPath}/roster`, {
        expectedVersion: entry.version,
        players: [{ memberId: team.members[0]!.id, jerseyNo: String(index) }],
      });
      entry = await write<EntryData>(leader, 'POST', `${entryPath}/commands`, {
        type: 'SUBMIT',
        expectedVersion: entry.version,
      });
      await write(page.request, 'POST', `${entryPath}/commands`, {
        type: 'APPROVE',
        expectedVersion: entry.version,
      });
    }
    registration = await read<EventRegistrationData>(page.request, `${eventPath}/registration`);
    await command('CLOSE_REGISTRATION');
    await command('FREEZE_REGISTRATION');
    const frozen = structuredClone(registration.freeze);
    expect(frozen?.entries).toHaveLength(3);

    progress('frozen registration prepared');
    await page.goto('/courts');
    await page.getByRole('button', { name: '创建场地', exact: true }).click();
    await page.getByLabel('场地名称', { exact: true }).fill(`合成共享球场-${suffix}`);
    await page.getByRole('button', { name: '保存场地', exact: true }).click();
    await expect(page.getByText(`合成共享球场-${suffix}`, { exact: true })).toBeVisible();
    const courts = await read<CourtData[]>(page.request, `${root}/courts`);
    expect(courts).toHaveLength(1);
    const court = courts[0]!;

    await page.goto(`/events/${event.id}/scheduling`);
    await page.getByLabel('每场占用分钟', { exact: true }).fill('60');
    await page.getByLabel('最少休息分钟', { exact: true }).fill('30');
    await page.getByLabel('最小日期间隔', { exact: true }).fill('0');
    await page.getByLabel('窗口1场地', { exact: true }).selectOption(court.id);
    await page.getByLabel('窗口1开始时间', { exact: true }).fill('2026-12-01T09:00');
    await page.getByLabel('窗口1结束时间', { exact: true }).fill('2026-12-01T18:00');
    await page.getByRole('button', { name: '生成单循环对阵', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存全部安排', exact: true })).toBeVisible();
    const workspace = await read<EventSchedulingData>(page.request, `${eventPath}/scheduling`);
    expect(workspace.currentRevision).not.toBeNull();
    const revisionPath = `${root}/schedule-revisions/${workspace.currentRevision!.id}`;
    const generated = await read<ScheduleRevisionData>(page.request, revisionPath);
    expect(generated.fixtures).toHaveLength(3);
    expect(generated.rounds).toHaveLength(3);
    expect(generated.rounds.every((round) => round.byeEntryId !== null)).toBe(true);
    expect(generated.source).toEqual(frozen);
    progress('round robin generated');

    // Save a real conflict first; the server must still reject publication.
    for (const fixture of generated.fixtures) {
      const label = `第${fixture.roundNo}轮第${fixture.positionNo}场`;
      await page.getByLabel(`${label} 场地`, { exact: true }).selectOption(court.id);
      await page.getByLabel(`${label} 开始时间`, { exact: true }).fill('2026-12-01T09:00');
    }
    await page.getByRole('button', { name: '保存全部安排', exact: true }).click();
    await page.getByRole('button', { name: '检查赛程冲突', exact: true }).click();
    const conflicting = await read<ScheduleRevisionData>(page.request, revisionPath);
    const blocked = await page.request.post(`${origin}${revisionPath}/publish`, {
      headers: { Origin: origin },
      data: {
        expectedEventVersion: conflicting.eventVersion,
        expectedRevisionVersion: conflicting.version,
      },
    });
    expect(blocked.status()).toBe(409);
    expect(
      (await read<EventSchedulingData>(page.request, `${eventPath}/scheduling`)).publication,
    ).toBeNull();
    progress('conflicting publication rejected');

    for (const [index, fixture] of generated.fixtures.entries()) {
      const label = `第${fixture.roundNo}轮第${fixture.positionNo}场`;
      await page
        .getByLabel(`${label} 开始时间`, { exact: true })
        .fill(`2026-12-01T${String(9 + index * 2).padStart(2, '0')}:00`);
    }
    await page.getByRole('button', { name: '保存全部安排', exact: true }).click();
    await page.getByRole('button', { name: '检查赛程冲突', exact: true }).click();
    await page.getByRole('button', { name: '发布正式赛程', exact: true }).click();
    await page.getByRole('button', { name: '确认发布正式赛程', exact: true }).click();
    await expect(page.getByRole('heading', { name: '正式赛程', exact: true })).toBeVisible();
    const published = await read<EventSchedulingData>(page.request, `${eventPath}/scheduling`);
    expect(published.event.status).toBe('SCHEDULED');
    expect(published.publication?.matchCount).toBe(3);
    expect(published.capabilities.canGenerate).toBe(false);
    expect(published.capabilities.canRedraw).toBe(false);
    const saved = await read<ScheduleRevisionData>(page.request, revisionPath);
    expect(saved.status).toBe('PUBLISHED');
    expect(saved.capabilities.canEditAllocations).toBe(false);
    const matches = await read<ScheduledMatchData[]>(page.request, `${eventPath}/matches`);
    expect(matches).toHaveLength(3);
    expect(
      matches.every((match) => match.status === 'SCHEDULED' && match.courtId === court.id),
    ).toBe(true);
    expect(matches.map((match) => match.startsAt).sort()).toEqual([
      '2026-12-01T01:00:00.000Z',
      '2026-12-01T03:00:00.000Z',
      '2026-12-01T05:00:00.000Z',
    ]);
    await page.reload();
    await expect(page.getByRole('heading', { name: '正式赛程', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存全部安排', exact: true })).toHaveCount(0);
    expect((await read<ScheduleRevisionData>(page.request, revisionPath)).source).toEqual(frozen);
    expect((await read<ScheduleRevisionData>(page.request, revisionPath)).pairingHash).toBe(
      generated.pairingHash,
    );
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    progress('published schedule retained after reload');
  } catch (cause) {
    console.error(`[scheduling:${testInfo.project.name}] failed at ${phase}: ${String(cause)}`);
    throw cause;
  } finally {
    await leader.dispose().catch(() => console.error('[scheduling] API context cleanup failed'));
  }
});
