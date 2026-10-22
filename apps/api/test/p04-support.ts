import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect } from 'vitest';
import type {
  CourtData,
  EventData,
  EventFormat,
  EventRegistrationData,
  SchedulePolicy,
  ScheduleRevisionData,
  ScheduleValidationData,
  ScheduleVersionInput,
  TeamData,
  UpdateScheduleAllocationsInput,
} from '@small-city-basketball/contracts';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword } from '../src/security.js';
import {
  ORIGIN,
  PASSWORD,
  RUN_ID,
  call,
  data,
  eventInput,
  eventPath,
  eventsPath,
  eventually,
  login,
  testDatabaseUrl,
} from './support.js';
import type { Api, User } from './support.js';
import {
  command,
  entry,
  registrationCommand,
  roster,
  rules,
  rulesPath,
  team,
} from './p03-support.js';

export const APPLICATION_NAME = `scb_scheduling_${RUN_ID}`;
export const courtsPath = (orgId: string) => `/v1/orgs/${orgId}/courts`;
export const courtPath = (orgId: string, id: string) => `${courtsPath(orgId)}/${id}`;
export const schedulingPath = (orgId: string, eventId: string) =>
  `${eventPath(orgId, eventId)}/scheduling`;
export const revisionsPath = (orgId: string, eventId: string) =>
  `${eventPath(orgId, eventId)}/schedule-revisions`;
export const revisionPath = (orgId: string, id: string) =>
  `/v1/orgs/${orgId}/schedule-revisions/${id}`;
export const allocationsPath = (orgId: string, id: string) =>
  `${revisionPath(orgId, id)}/allocations`;
export const validatePath = (orgId: string, id: string) => `${revisionPath(orgId, id)}/validate`;
export const publishPath = (orgId: string, id: string) => `${revisionPath(orgId, id)}/publish`;
export const matchesPath = (orgId: string, eventId: string) =>
  `${eventPath(orgId, eventId)}/matches`;
export interface Harness {
  api: Api;
  owner: User;
  otherOwner: User;
  leader: User;
  teams: TeamData[];
  otherTeams: TeamData[];
  databaseUrl: string;
  nextDate: number;
}

export function plusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function plusMinutes(startsAt: string, minutes: number): string {
  return new Date(Date.parse(startsAt) + minutes * 60000).toISOString();
}

export async function createHarness(teamCount = 4): Promise<Harness> {
  const url = new URL(testDatabaseUrl());
  url.searchParams.set('application_name', APPLICATION_NAME);
  const databaseUrl = url.toString();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    expect(
      (await pool.query<{ name: string }>('SELECT current_database() AS name')).rows[0]?.name,
    ).toMatch(/^scb_test_[A-Za-z0-9_]+$/);
    await migrate(pool);
  } finally {
    await pool.end();
  }
  const api = await createApi({ databaseUrl, appOrigin: ORIGIN });
  try {
    // Dedicated synthetic identities avoid spending the registration limiter's
    // shared IP budget. Production scrypt and real HTTP login remain unchanged.
    const actors: User[] = [];
    for (const label of ['owner', 'other-owner', 'leader']) {
      const id = randomUUID();
      const orgId = label === 'leader' ? '' : randomUUID();
      const email = `p04-${label}-${RUN_ID}@example.test`;
      const passwordHash = await hashPassword(PASSWORD);
      await api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [id, email, `排赛 ${label}`, passwordHash],
      );
      if (orgId) {
        await api.pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
          orgId,
          `排赛机构 ${label} ${RUN_ID.slice(0, 8)}`,
        ]);
        await api.pool.query(
          "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
          [orgId, id],
        );
      }
      const actor = { id, orgId, email, cookie: '' };
      actor.cookie = await login(api, actor);
      actors.push(actor);
    }
    const [owner, otherOwner, leader] = actors as [User, User, User];
    await api.pool.query(
      "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'EVENT_MANAGER')",
      [owner.orgId, otherOwner.id],
    );
    const h: Harness = {
      api,
      owner,
      otherOwner,
      leader,
      teams: [],
      otherTeams: [],
      databaseUrl,
      nextDate: 0,
    };
    for (let index = 0; index < teamCount; index++)
      h.teams.push(await team(api, owner, `排赛球队 ${index}`, leader, ['合成甲', '合成乙']));
    for (let index = 0; index < 2; index++)
      h.otherTeams.push(
        await team(api, otherOwner, `另一机构球队 ${index}`, leader, ['合成丙', '合成丁']),
      );
    return h;
  } catch (failure) {
    await api.app.close();
    await api.pool.end();
    throw failure;
  }
}
export async function closeHarness(h: Harness): Promise<void> {
  await h.api.app.close();
  await h.api.pool.end();
}

export async function frozen(
  h: Harness,
  owner = h.owner,
  teams = h.teams.slice(0, 2),
  options: { startDate?: string; endDate?: string; format?: EventFormat } = {},
): Promise<EventRegistrationData> {
  const startDate =
    options.startDate ?? plusDays(`${new Date().getUTCFullYear() + 2}-01-01`, h.nextDate++ * 10);
  const endDate = options.endDate ?? plusDays(startDate, 6);
  const event = data<EventData>(
    await call(h.api, 'post', eventsPath(owner.orgId), {
      cookie: owner.cookie,
      body: eventInput(`排赛 ${randomUUID().slice(0, 8)}`, {
        startDate,
        endDate,
        format: options.format ?? 'ROUND_ROBIN',
      }),
    }),
    201,
  );
  let current = data<EventRegistrationData>(
    await call(h.api, 'put', rulesPath(owner.orgId, event.id), {
      cookie: owner.cookie,
      body: rules(event.version, { minPlayers: 2, maxPlayers: 2 }),
    }),
  );
  current = await registrationCommand(h.api, owner, current, 'OPEN_REGISTRATION');
  for (const target of teams) {
    let draft = await entry(h.api, owner, current.event.id, target, h.leader);
    draft = await roster(h.api, owner, draft, h.leader, target.members);
    draft = await command(h.api, owner, draft, h.leader, 'SUBMIT');
    await command(h.api, owner, draft, owner, 'APPROVE');
  }
  current = await registrationCommand(h.api, owner, current, 'CLOSE_REGISTRATION');
  current = await registrationCommand(h.api, owner, current, 'FREEZE_REGISTRATION');
  expect(current.freeze!.entries).toHaveLength(teams.length);
  return current;
}

export async function court(api: Api, owner: User, label = '合成场地'): Promise<CourtData> {
  return data<CourtData>(
    await call(api, 'post', courtsPath(owner.orgId), {
      cookie: owner.cookie,
      body: { name: `${label}-${randomUUID().slice(0, 8)}` },
    }),
    201,
  );
}
export function policyFor(
  current: EventRegistrationData,
  courts: CourtData[],
  overrides: Partial<SchedulePolicy> = {},
): SchedulePolicy {
  return {
    slotDurationMinutes: 60,
    minRestMinutes: 0,
    minLocalDayGap: 0,
    courtWindows: courts.map((resource) => ({
      courtId: resource.id,
      startsAt: `${current.event.startDate}T00:00:00+08:00`,
      endsAt: `${plusDays(current.event.endDate, 1)}T02:00:00+08:00`,
    })),
    ...overrides,
  };
}
export async function revision(
  api: Api,
  owner: User,
  current: EventRegistrationData,
  courts: CourtData[],
  policyOverrides: Partial<SchedulePolicy> = {},
): Promise<ScheduleRevisionData> {
  return data<ScheduleRevisionData>(
    await call(api, 'post', revisionsPath(owner.orgId, current.event.id), {
      cookie: owner.cookie,
      body: {
        expectedEventVersion: current.event.version,
        freezeId: current.freeze!.id,
        algorithmVersion: 'RR_CIRCLE_V1',
        policy: policyFor(current, courts, policyOverrides),
      },
    }),
    201,
  );
}
export const versions = (current: ScheduleRevisionData): ScheduleVersionInput => ({
  expectedEventVersion: current.eventVersion,
  expectedRevisionVersion: current.version,
});
export function fullAllocations(
  current: ScheduleRevisionData,
  resource: CourtData,
  startsAt: string,
  stepMinutes = 60,
): UpdateScheduleAllocationsInput['allocations'] {
  return current.fixtures.map((fixture, index) => ({
    fixtureKey: fixture.fixtureKey,
    courtId: resource.id,
    startsAt: plusMinutes(startsAt, index * stepMinutes),
  }));
}
export async function allocate(
  api: Api,
  owner: User,
  current: ScheduleRevisionData,
  allocations: UpdateScheduleAllocationsInput['allocations'],
): Promise<ScheduleRevisionData> {
  return data<ScheduleRevisionData>(
    await call(api, 'put', allocationsPath(owner.orgId, current.id), {
      cookie: owner.cookie,
      body: { ...versions(current), allocations },
    }),
  );
}
export async function validate(
  api: Api,
  owner: User,
  current: ScheduleRevisionData,
): Promise<ScheduleValidationData> {
  return data<ScheduleValidationData>(
    await call(api, 'post', validatePath(owner.orgId, current.id), {
      cookie: owner.cookie,
      body: versions(current),
    }),
  );
}
export async function publish(api: Api, owner: User, current: ScheduleRevisionData) {
  return call(api, 'post', publishPath(owner.orgId, current.id), {
    cookie: owner.cookie,
    body: versions(current),
  });
}
export async function blockedPid(
  pool: Pool,
  blockingPid: number,
  message: string,
): Promise<number> {
  const rows = await eventually(
    async () =>
      (
        await pool.query<{ pid: number }>(
          'SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND $2::int = ANY(pg_blocking_pids(pid))',
          [APPLICATION_NAME, blockingPid],
        )
      ).rows,
    (waiting) => waiting.length === 1,
    message,
  );
  return rows[0]!.pid;
}
