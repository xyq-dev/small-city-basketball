import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
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
  EventScoringData,
  ScoringWorkbenchData,
  ScoringControl,
  ScorekeeperLeaseData,
  ScoringCommandPayload,
  ScoringCommandResponse,
  OverlayWorkbenchData,
  OverlaySnapshotData,
} from '@small-city-basketball/contracts';

// The source URL and bootstrap request contain a synthetic read secret. Do not
// include them in screenshots/traces, including failed-test artifacts.
test.use({ trace: 'off', screenshot: 'off' });

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

async function overlayFixture(
  owner: APIRequestContext,
  leader: APIRequestContext,
  scorer: APIRequestContext,
  suffix: string,
) {
  const session = await write<SessionData>(owner, 'POST', '/v1/auth/register', {
    email: `overlay-owner-${suffix}@example.test`,
    password: `Scoring-owner-${suffix}`,
    displayName: '独立赛果确认员',
    organizationName: `记分验证机构-${suffix}`,
  });
  const root = `/v1/orgs/${session.organizations[0]!.id}`;
  const captain = await write<SessionData>(leader, 'POST', '/v1/auth/register-participant', {
    email: `overlay-leader-${suffix}@example.test`,
    password: `Scoring-leader-${suffix}`,
    displayName: '报名合成领队',
  });
  const writer = await write<SessionData>(scorer, 'POST', '/v1/auth/register-participant', {
    email: `overlay-writer-${suffix}@example.test`,
    password: `Scoring-writer-${suffix}`,
    displayName: '仅场次授权记分员',
  });
  await write(owner, 'PUT', `${root}/members/${writer.user.id}`, {
    role: 'SCORER',
    status: 'ACTIVE',
  });
  const event = await write<EventData>(owner, 'POST', `${root}/events`, {
    name: `透明包装验证-${suffix}`,
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
      name: `包装合成队${index}`,
    });
    team = await write<TeamData>(owner, 'PUT', `${root}/teams/${team.id}/members`, {
      expectedVersion: team.version,
      members: [{ name: `包装合成球员${index}` }],
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
  expect(matches).toHaveLength(1);
  return { root, eventPath, eventId: event.id, writer, match: matches[0]!, revisionPath };
}

async function copiedSource(page: Page) {
  await page.getByRole('button', { name: '复制浏览器源链接', exact: true }).click();
  const value = await page.evaluate(
    () => (window as unknown as { overlayCopiedSource?: string }).overlayCopiedSource,
  );
  // Assert shape without printing the read secret if a control has failed.
  expect(
    typeof value === 'string' &&
      /^http:\/\/127\.0\.0\.1:4273\/overlay\/[A-Za-z0-9_-]{43}#token=[A-Za-z0-9_-]{43}$/.test(
        value,
      ),
  ).toBe(true);
  return new URL(value!);
}

test('透明包装独立授权、时钟、轮换撤销及离线硬截止', async ({
  page,
  browser,
  playwright,
}, testInfo) => {
  test.setTimeout(240000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as unknown as { overlayCopiedSource: string }).overlayCopiedSource = value;
        },
      },
    });
  });
  const leader = await playwright.request.newContext();
  const scorer = await playwright.request.newContext();
  const sourceContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1920, height: 1080 },
    storageState: { cookies: [], origins: [] },
  });
  const source = await sourceContext.newPage();
  const pageErrors: string[] = [];
  const privateRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  source.on('pageerror', (error) => pageErrors.push(error.message));
  source.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/v1\/(auth|orgs|invitations)(\/|$)/.test(path)) privateRequests.push(path);
  });
  let phase = 'published match without public viewing';
  const progress = (value: string) => {
    phase = value;
    console.log(`[overlay:${testInfo.project.name}] ${value}`);
  };
  let releaseLateResponse: (() => void) | undefined;
  try {
    const fixture = await overlayFixture(
      page.request,
      leader,
      scorer,
      `${testInfo.project.name}-${Date.now()}`,
    );
    const matchPath = `${fixture.root}/matches/${fixture.match.id}`;
    const managerPath = `${matchPath}/overlay`;
    const managerUi = `/matches/${fixture.match.id}/overlay`;
    const homeName = fixture.match.home.teamName;
    await page.goto(managerUi);
    await expect(page.getByText('尚未准备', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '签发包装链接', exact: true }).click();
    await page.getByLabel('授权有效分钟', { exact: true }).fill('5');
    await page.getByRole('button', { name: '确认签发', exact: true }).click();
    await expect(page.getByText('包装链接已签发', { exact: true })).toBeVisible();
    const original = await copiedSource(page);
    const originalId = original.pathname.split('/').at(-1)!;
    const snapshotPath = `/v1/overlays/${originalId}/snapshot`;

    progress('StrictMode fragment bootstrap, transparent pixels and clean cookie reload');
    await source.goto(original.href);
    await expect(source.getByText('尚未准备', { exact: true }).first()).toBeVisible();
    expect(await source.evaluate(() => location.hash)).toBe('');
    expect(
      await source.evaluate(() => [
        Object.keys(localStorage).length,
        Object.keys(sessionStorage).length,
      ]),
    ).toEqual([0, 0]);
    const before = await read<OverlaySnapshotData>(sourceContext.request, snapshotPath);
    expect(before.score).toBeNull();
    expect(before.clock).toBeNull();
    expect(before.rules).toBeNull();
    expect(before.collected.teamScore).toBe(false);
    const json = JSON.stringify(before);
    for (const id of [
      fixture.eventId,
      fixture.match.id,
      fixture.writer.user.id,
      fixture.root.split('/').at(-1)!,
    ])
      expect(json).not.toContain(id);
    const cookies = await sourceContext.cookies(origin + snapshotPath);
    expect(cookies.some((cookie) => cookie.name === 'scb.sid')).toBe(false);
    const overlayCookie = cookies.find((cookie) => cookie.name === 'scb.overlay');
    expect(
      Boolean(
        overlayCookie?.httpOnly &&
        overlayCookie.sameSite === 'Strict' &&
        overlayCookie.path === `/v1/overlays/${originalId}/`,
      ),
    ).toBe(true);
    const cornerAlpha = await source.evaluate(
      async (encoded) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + encoded;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, 1, 1).data[3];
      },
      (await source.screenshot({ omitBackground: true })).toString('base64'),
    );
    expect(cornerAlpha).toBe(0);
    await source.reload();
    await expect(source.getByText('尚未准备', { exact: true }).first()).toBeVisible();
    const fresh = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1920, height: 1080 },
      storageState: { cookies: [], origins: [] },
    });
    try {
      const reloaded = await fresh.newPage();
      await reloaded.goto(original.href);
      await expect(reloaded.getByText('尚未准备', { exact: true }).first()).toBeVisible();
      expect(await reloaded.evaluate(() => location.hash)).toBe('');
    } finally {
      await fresh.close();
    }

    progress('real score, aged raw clock, independent confirmation and reopening');
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
      const current = await read<ScoringWorkbenchData>(actor, `${matchPath}/scoring`);
      return write<ScoringCommandResponse>(actor, 'POST', `${matchPath}/commands`, {
        ...input,
        ...(input.type === 'PREPARE_MATCH' || input.type === 'START_MATCH'
          ? { payload: { expectedEventVersion: current.event.version } }
          : {}),
        commandId: randomUUID(),
        expectedVersion: current.match.version,
        capturedAt: new Date().toISOString(),
        ...(control ? { control } : {}),
      });
    }
    await command(page.request, { type: 'PREPARE_MATCH', payload: { expectedEventVersion: 0 } });
    const lease = await write<ScorekeeperLeaseData>(
      scorer,
      'POST',
      `${matchPath}/scorekeeper-lease`,
      { clientInstanceId: randomUUID() },
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
    await expect
      .poll(async () => {
        const current = await read<OverlaySnapshotData>(sourceContext.request, snapshotPath);
        return Date.parse(current.serverTime) - Date.parse(current.clock!.anchorServerTime);
      })
      .toBeGreaterThanOrEqual(3000);
    const latestResponse = await source.waitForResponse(
      (response) => new URL(response.url()).pathname === snapshotPath && response.ok(),
    );
    const live = (await latestResponse.json()).data as OverlaySnapshotData;
    expect(live.score?.home).toBe(2);
    expect(live.clock!.remainingMs).toBe(60000);
    await expect(source.getByLabel('包装主队比分', { exact: true })).toHaveText('2');
    const clock = source.getByLabel('包装剩余时间', { exact: true });
    const expectedSeconds = Math.ceil(
      (live.clock!.remainingMs -
        (Date.parse(live.serverTime) - Date.parse(live.clock!.anchorServerTime))) /
        1000,
    );
    await expect
      .poll(async () => {
        const value = await clock.textContent();
        if (!value || !/^\d+:\d{2}$/.test(value)) return Infinity;
        const [minutes, seconds] = value.split(':').map(Number);
        return Math.abs(minutes! * 60 + seconds! - expectedSeconds);
      })
      .toBeLessThanOrEqual(1);
    const firstClock = await clock.textContent();
    await expect.poll(() => clock.textContent()).not.toBe(firstClock);
    await command(scorer, { type: 'CLOCK_PAUSE', payload: {} }, control);
    await command(
      scorer,
      { type: 'CLOCK_SET', payload: { remainingMs: 0, reason: '透明包装验收归零' } },
      control,
    );
    await command(scorer, { type: 'END_MATCH', payload: {} }, control);
    await command(page.request, { type: 'CONFIRM_RESULT', payload: {} });
    await expect(source.getByText('赛果已确认', { exact: true })).toBeVisible();
    await command(page.request, { type: 'REOPEN_RESULT', payload: { reason: '透明包装重开验证' } });
    await expect(source.getByText('赛果待重新确认', { exact: true })).toBeVisible();

    progress('rotation and revocation clear an already opened source');
    await page.reload();
    await page.getByRole('button', { name: '轮换包装链接', exact: true }).click();
    await page.getByLabel('授权有效分钟', { exact: true }).fill('5');
    await page.getByLabel('轮换理由', { exact: true }).fill('浏览器源轮换验收');
    await page.getByRole('button', { name: '确认轮换', exact: true }).click();
    await expect(page.getByText('包装链接已轮换', { exact: true })).toBeVisible();
    const rotated = await copiedSource(page);
    expect(rotated.pathname !== original.pathname).toBe(true);
    await expect(source.getByText(/^包装链接不可用/)).toBeVisible();
    await expect(source.getByText(homeName, { exact: true })).toHaveCount(0);
    expect((await sourceContext.request.get(origin + snapshotPath)).status()).toBe(404);
    await source.goto(rotated.href);
    await expect(source.getByLabel('包装主队比分', { exact: true })).toHaveText('2');
    await page.getByRole('button', { name: '撤销包装链接', exact: true }).click();
    await page.getByLabel('撤销理由', { exact: true }).fill('浏览器源撤销验收');
    await page.getByRole('button', { name: '确认撤销', exact: true }).click();
    await expect(page.getByText('包装链接已撤销', { exact: true })).toBeVisible();
    await expect(source.getByText(/^包装链接不可用/)).toBeVisible();
    await expect(source.getByText(homeName, { exact: true })).toHaveCount(0);

    progress('real one-minute grant, thirty-second offline clearing and late response');
    await page.getByRole('button', { name: '签发包装链接', exact: true }).click();
    await page.getByLabel('授权有效分钟', { exact: true }).fill('1');
    await page.getByRole('button', { name: '确认签发', exact: true }).click();
    await expect(page.getByText('包装链接已签发', { exact: true })).toBeVisible();
    const expiring = await copiedSource(page);
    const expiringPath = `/v1/overlays/${expiring.pathname.split('/').at(-1)!}/snapshot`;
    const grant = (await read<OverlayWorkbenchData>(page.request, managerPath)).currentGrant!;
    const expiresAt = Date.parse(grant.expiresAt);
    await source.goto(expiring.href);
    await expect(source.getByText(homeName, { exact: true })).toBeVisible();
    await sourceContext.setOffline(true);
    await expect(source.getByText(/数据陈旧/).first()).toBeVisible();
    await expect
      .poll(() => source.getByText(homeName, { exact: true }).count(), {
        timeout: 35000,
        intervals: [500, 1000],
      })
      .toBe(0);
    await sourceContext.setOffline(false);
    await expect(source.getByText(homeName, { exact: true })).toBeVisible({ timeout: 10000 });
    let held = false;
    const lateResponse = new Promise<void>((resolve) => {
      releaseLateResponse = resolve;
    });
    await source.route(origin + expiringPath, async (route) => {
      if (held || Date.now() < expiresAt - 6000) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      if (response.status() !== 200) {
        await route.fulfill({ response });
        return;
      }
      held = true;
      await lateResponse;
      // The expiry handler should abort this request; an aborted route may reject.
      try {
        await route.fulfill({ response });
      } catch {
        /* cancelled by terminal expiry */
      }
    });
    await expect.poll(() => held, { timeout: 35000, intervals: [500] }).toBe(true);
    await expect(source.getByText(/^包装授权已到期/)).toBeVisible({
      timeout: 10000,
    });
    releaseLateResponse?.();
    await source.unrouteAll({ behavior: 'wait' });
    await expect(source.getByText(homeName, { exact: true })).toHaveCount(0);
    await expect(source.getByText(/^包装授权已到期/)).toBeVisible();
    expect((await sourceContext.request.get(origin + expiringPath)).status()).toBe(404);
    expect(privateRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  } catch (error) {
    console.log(`[overlay:${testInfo.project.name}] failed during ${phase}`);
    throw error;
  } finally {
    releaseLateResponse?.();
    await Promise.allSettled([
      sourceContext.setOffline(false),
      leader.dispose(),
      scorer.dispose(),
      sourceContext.close(),
    ]);
  }
});
