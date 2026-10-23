import { expect, test, devices } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../../apps/api/src/security.js';
import type {
  CourtData,
  EntryData,
  EventData,
  EventKnockoutData,
  EventRegistrationData,
  EventScoringData,
  EventStandingsData,
  PublicEventData,
  PublicKnockoutData,
  PublicScheduleMatchData,
  ScheduleRevisionData,
  ScheduledMatchData,
  ScoringCommandPayload,
  ScoringCommandResponse,
  ScoringControl,
  ScoringWorkbenchData,
  ScorekeeperLeaseData,
  SessionData,
  TeamData,
} from '@small-city-basketball/contracts';

const origin = 'http://127.0.0.1:4273';
async function read<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(origin + path);
  expect(response.ok(), `GET ${path}: HTTP ${response.status()}`).toBe(true);
  return (await response.json()).data as T;
}
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

/** Test identities only: no abuse-limit exceptions, no copied production users or sessions. */
async function syntheticIdentities() {
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(decodeURIComponent(database.pathname.slice(1))) ||
    process.env.NODE_ENV === 'production'
  )
    throw new Error('Knockout browser identities require an explicitly isolated test database');
  const orgId = randomUUID();
  const suffix = randomUUID();
  const password = `Synthetic-knockout-${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  const users = ['owner', 'leader', 'scorer'].map((role) => ({
    id: randomUUID(),
    email: `knockout-${role}-${suffix}@example.test`,
    displayName: `淘汰赛合成${role}`,
  }));
  const pool = new pg.Pool({ connectionString: database.href, max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const user of users)
      await c.query('INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)', [
        user.id,
        user.email,
        user.displayName,
        passwordHash,
      ]);
    await c.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
      orgId,
      `淘汰赛浏览器合成机构-${suffix.slice(0, 8)}`,
    ]);
    await c.query(
      "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
      [orgId, users[0]!.id],
    );
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
    await pool.end();
  }
  return { orgId, users, password };
}

async function registration(
  owner: APIRequestContext,
  leader: APIRequestContext,
  orgId: string,
  leaderId: string,
) {
  const root = `/v1/orgs/${orgId}`;
  const event = await write<EventData>(owner, 'POST', `${root}/events`, {
    name: `三队单淘汰浏览器验收-${randomUUID().slice(0, 8)}`,
    startDate: '2026-12-01',
    endDate: '2026-12-02',
    timezone: 'Asia/Shanghai',
    format: 'SINGLE_ELIMINATION',
  });
  const eventPath = `${root}/events/${event.id}`;
  let current = await write<EventRegistrationData>(
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
    current = await write<EventRegistrationData>(
      owner,
      'POST',
      `${eventPath}/registration-commands`,
      {
        type,
        expectedVersion: current.event.version,
      },
    );
  }
  await command('OPEN_REGISTRATION');
  for (let i = 1; i <= 3; i++) {
    let team = await write<TeamData>(owner, 'POST', `${root}/teams`, { name: `淘汰赛合成队${i}` });
    team = await write<TeamData>(owner, 'PUT', `${root}/teams/${team.id}/members`, {
      expectedVersion: team.version,
      members: [{ name: `仅私有合成球员${i}` }],
    });
    await write(owner, 'PUT', `${root}/teams/${team.id}/grants/${leaderId}`, { status: 'ACTIVE' });
    let entry = await write<EntryData>(leader, 'POST', `${eventPath}/entries`, { teamId: team.id });
    const entryPath = `${root}/entries/${entry.id}`;
    entry = await write<EntryData>(leader, 'PUT', `${entryPath}/roster`, {
      expectedVersion: entry.version,
      players: [{ memberId: team.members[0]!.id, jerseyNo: String(i) }],
    });
    entry = await write<EntryData>(leader, 'POST', `${entryPath}/commands`, {
      type: 'SUBMIT',
      expectedVersion: entry.version,
    });
    await write(owner, 'POST', `${entryPath}/commands`, {
      type: 'APPROVE',
      expectedVersion: entry.version,
    });
  }
  current = await read<EventRegistrationData>(owner, `${eventPath}/registration`);
  await command('CLOSE_REGISTRATION');
  await command('FREEZE_REGISTRATION');
  return { root, eventPath, eventId: event.id, registration: current };
}

async function scoreAndConfirm(
  owner: APIRequestContext,
  scorer: APIRequestContext,
  root: string,
  matchId: string,
  scorerId: string,
) {
  const path = `${root}/matches/${matchId}`;
  const workbench = () => read<ScoringWorkbenchData>(owner, `${path}/scoring`);
  let current = await workbench();
  await write(owner, 'PUT', `${path}/staff/${scorerId}`, {
    expectedMatchVersion: current.match.version,
    role: 'SCORER',
    status: 'ACTIVE',
  });
  async function act(
    actor: APIRequestContext,
    command: ScoringCommandPayload,
    control?: ScoringControl,
  ) {
    current = await workbench();
    return write<ScoringCommandResponse>(actor, 'POST', `${path}/commands`, {
      commandId: randomUUID(),
      expectedVersion: current.match.version,
      capturedAt: new Date().toISOString(),
      ...command,
      ...(control ? { control } : {}),
    });
  }
  current = await workbench();
  await act(owner, {
    type: 'PREPARE_MATCH',
    payload: { expectedEventVersion: current.event.version, collectionMode: 'TEAM_ONLY' },
  });
  const lease = await write<ScorekeeperLeaseData>(scorer, 'POST', `${path}/scorekeeper-lease`, {
    clientInstanceId: randomUUID(),
  });
  const control: ScoringControl = {
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    clientInstanceId: lease.clientInstanceId,
  };
  current = await workbench();
  await act(
    scorer,
    { type: 'START_MATCH', payload: { expectedEventVersion: current.event.version } },
    control,
  );
  await act(
    scorer,
    { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 2 } },
    control,
  );
  await act(
    scorer,
    {
      type: 'CLOCK_SET',
      payload: { remainingMs: 0, reason: '合成淘汰赛浏览器验收节末核对' },
    },
    control,
  );
  await act(scorer, { type: 'END_MATCH', payload: {} }, control);
  const confirmed = await act(owner, { type: 'CONFIRM_RESULT', payload: {} });
  expect(confirmed.snapshot.status).toBe('FINAL');
  expect(confirmed.snapshot.latestConfirmation?.confirmingUserId).not.toBe(scorerId);
  return confirmed.snapshot;
}

test('单淘汰轮空、浏览器显式晋级与最终名次使用真实API', async ({
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
  let phase = 'synthetic isolated identity seed and real HTTP login';
  const progress = (value: string) => {
    phase = value;
    console.log(`[knockout:${testInfo.project.name}] ${value}`);
  };
  try {
    const identities = await syntheticIdentities();
    for (const [index, actor] of [page.request, leader, scorer].entries()) {
      const session = await write<SessionData>(actor, 'POST', '/v1/auth/login', {
        email: identities.users[index]!.email,
        password: identities.password,
      });
      expect(session.user.id).toBe(identities.users[index]!.id);
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
      name: '单淘汰真实浏览器球场',
    });
    let revision = await write<ScheduleRevisionData>(
      page.request,
      'POST',
      `${eventPath}/schedule-revisions`,
      {
        expectedEventVersion: fixture.registration.event.version,
        freezeId: fixture.registration.freeze!.id,
        algorithmVersion: 'SE_SEEDED_V1',
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
    expect(revision.fixtures).toHaveLength(1);
    const revisionPath = `${root}/schedule-revisions/${revision.id}`;
    revision = await write<ScheduleRevisionData>(
      page.request,
      'PUT',
      `${revisionPath}/allocations`,
      {
        expectedEventVersion: revision.eventVersion,
        expectedRevisionVersion: revision.version,
        allocations: revision.fixtures.map((f) => ({
          fixtureKey: f.fixtureKey,
          courtId: court.id,
          startsAt: '2026-12-01T01:00:00.000Z',
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
    let bracket = await read<EventKnockoutData>(page.request, `${eventPath}/knockout`);
    expect(bracket.bracket?.totalMatchCount).toBe(2);
    expect(bracket.bracket?.publishedMatchCount).toBe(1);
    expect(bracket.bracket?.rounds[0]!.slots.filter((slot) => slot.status === 'BYE')).toHaveLength(
      1,
    );
    expect(bracket.bracket?.nextRound).toBeNull();
    expect((await anonymous.get(origin + `${eventPath}/knockout`)).status()).toBe(401);
    expect((await scorer.get(origin + `${eventPath}/knockout`)).status()).toBe(404);
    const first = (await read<ScheduledMatchData[]>(page.request, `${eventPath}/matches`))[0]!;
    progress('original independent confirmation unlocks the next-round preview');
    await scoreAndConfirm(page.request, scorer, root, first.id, scorerId);
    bracket = await read<EventKnockoutData>(page.request, `${eventPath}/knockout`);
    expect(bracket.bracket?.nextRound?.roundNo).toBe(2);
    let viewing = await read<EventStandingsData>(page.request, `${eventPath}/standings`);
    viewing = await write<EventStandingsData>(
      page.request,
      'POST',
      `${eventPath}/public-viewing-commands`,
      { type: 'ENABLE', expectedEventVersion: viewing.event.version },
    );
    const previousLive = viewing.publication!.publicEventId;
    expect(
      (await read<PublicEventData>(anonymous, `/v1/public/events/${previousLive}`)).format,
    ).toBe('SINGLE_ELIMINATION');

    progress('real browser fills and explicitly confirms the final-round publication');
    await page.goto(`/events/${eventId}/knockout`);
    await expect(page.getByRole('region', { name: '淘汰赛签位', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '淘汰赛签位', exact: true })).toContainText(
      '轮空',
    );
    const next = bracket.bracket!.nextRound!;
    expect(next.fixtures).toHaveLength(1);
    const label = `第${next.roundNo}轮第${next.fixtures[0]!.positionNo}场`;
    await page.getByLabel(`${label} 场地`, { exact: true }).selectOption(court.id);
    await page.getByLabel(`${label} 开始时间`, { exact: true }).fill('2026-12-01T11:00');
    await page.getByLabel('晋级发布原因', { exact: true }).fill('合成浏览器独立确认后发布决赛');
    const before = await read<ScheduledMatchData[]>(page.request, `${eventPath}/matches`);
    expect(before).toHaveLength(1);
    await page.getByRole('button', { name: '核对并发布下一轮', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '发布下一轮', exact: true });
    await expect(dialog).toBeVisible();
    // The review dialog is not itself a publication. Only its explicit confirmation writes.
    expect(await read<ScheduledMatchData[]>(page.request, `${eventPath}/matches`)).toHaveLength(1);
    await dialog.getByRole('button', { name: '确认发布下一轮', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(
        async () => (await read<ScheduledMatchData[]>(page.request, `${eventPath}/matches`)).length,
      )
      .toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await anonymous.get(origin + `/v1/public/events/${previousLive}`)).status()).toBe(404);
    expect(
      (await anonymous.get(origin + `/v1/public/events/${previousLive}/knockout`)).status(),
    ).toBe(404);
    const source = await read<ScoringWorkbenchData>(
      page.request,
      `${root}/matches/${first.id}/scoring`,
    );
    expect(source.capabilities.canReopen).toBe(false);
    const unauthorizedWrite = await anonymous.post(
      origin + `${root}/matches/${first.id}/commands`,
      {
        headers: { Origin: origin },
        data: {
          commandId: randomUUID(),
          expectedVersion: source.match.version,
          capturedAt: new Date().toISOString(),
          type: 'REOPEN_RESULT',
          payload: { reason: '匿名只读入口不能重开赛果' },
        },
      },
    );
    expect(unauthorizedWrite.status()).toBe(401);
    const matches = await read<ScheduledMatchData[]>(page.request, `${eventPath}/matches`);
    const final = matches.find((match) => match.roundNo === 2)!;
    expect(final).toBeTruthy();
    expect(final.home.entryId).not.toBe(final.away.entryId);
    progress('independently confirmed final generates actual final placements');
    const finalSnapshot = await scoreAndConfirm(page.request, scorer, root, final.id, scorerId);
    bracket = await read<EventKnockoutData>(page.request, `${eventPath}/knockout`);
    expect(bracket.bracket?.isComplete).toBe(true);
    expect(bracket.bracket?.placements.map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(bracket.bracket?.placements.find((row) => row.rank === 1)?.entryId).toBe(
      finalSnapshot.home.entryId,
    );
    await page.reload();
    const placements = page.getByRole('region', { name: '淘汰赛最终名次', exact: true });
    await expect(placements).toBeVisible();
    await expect(placements).toContainText(finalSnapshot.home.teamName);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    progress('fresh public grant displays a read-only opaque-key bracket on desktop and mobile');
    viewing = await read<EventStandingsData>(page.request, `${eventPath}/standings`);
    viewing = await write<EventStandingsData>(
      page.request,
      'POST',
      `${eventPath}/public-viewing-commands`,
      { type: 'ENABLE', expectedEventVersion: viewing.event.version },
    );
    const freshId = viewing.publication!.publicEventId;
    expect(freshId).not.toBe(previousLive);
    const publicBracket = await read<PublicKnockoutData>(
      anonymous,
      `/v1/public/events/${freshId}/knockout`,
    );
    expect(publicBracket.isComplete).toBe(true);
    expect(publicBracket.placements.map((row) => row.rank)).toEqual([1, 2, 3]);
    const publicSchedule = await read<PublicScheduleMatchData[]>(
      anonymous,
      `/v1/public/events/${freshId}/schedule`,
    );
    expect(publicSchedule).toHaveLength(2);
    const exposed = JSON.stringify(publicBracket);
    for (const participant of bracket.participants) {
      expect(exposed).not.toContain(participant.entryId);
      expect(exposed).not.toContain(participant.teamId);
      expect(exposed).not.toContain(participant.rosterRevisionId);
    }
    expect(exposed).not.toContain('仅私有合成球员');
    expect(exposed).not.toContain('expectedSourceHash');
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
    await spectator.goto(`/watch/${freshId}`);
    await spectator.getByRole('tab', { name: '晋级与名次', exact: true }).click();
    await expect(
      spectator.getByRole('region', { name: '公开淘汰赛签位', exact: true }),
    ).toBeVisible();
    await expect(
      spectator.getByRole('region', { name: '公开最终名次', exact: true }),
    ).toContainText(finalSnapshot.home.teamName);
    await expect(
      spectator.getByRole('button', { name: /发布下一轮|确认赛果|取得记分控制权/ }),
    ).toHaveCount(0);
    expect(await spectator.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  } catch (error) {
    throw new Error(`Knockout browser check failed during: ${phase}`, { cause: error });
  } finally {
    await publicContext?.close();
    await anonymous.dispose();
    await scorer.dispose();
    await leader.dispose();
  }
});
