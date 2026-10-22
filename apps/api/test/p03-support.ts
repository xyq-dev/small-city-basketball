import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { expect } from 'vitest';
import type {
  EntryData,
  EventRegistrationData,
  IssuedInvitationData,
  RegistrationRulesInput,
  SessionData,
  TeamData,
} from '@small-city-basketball/contracts';
import {
  PASSWORD,
  RUN_ID,
  call,
  createEvent,
  data,
  eventPath,
  eventually,
  sessionCookie,
  staffPath,
  testDatabaseUrl,
} from './support.js';
import type { Api, User } from './support.js';

export type Actor = Pick<User, 'id' | 'email' | 'cookie'>;
export const APPLICATION_NAME = `scb_registration_${RUN_ID}`;
export function registrationDatabaseUrl(): string {
  const url = new URL(testDatabaseUrl());
  url.searchParams.set('application_name', APPLICATION_NAME);
  return url.toString();
}

export async function participant(api: Api, label: string): Promise<Actor> {
  const email = `p03-${label}-${RUN_ID}@example.test`;
  const response = await call(api, 'post', '/v1/auth/register-participant', {
    body: { email, password: PASSWORD, displayName: `报名测试 ${label}` },
  });
  const session = data<SessionData>(response, 201);
  expect(session.organizations).toEqual([]);
  expect(session.teamContexts).toEqual([]);
  return { id: session.user.id, email, cookie: sessionCookie(response) };
}

export const teamsPath = (orgId: string): string => `/v1/orgs/${orgId}/teams`;
export const teamPath = (orgId: string, teamId: string): string => `${teamsPath(orgId)}/${teamId}`;
export const invitationsPath = (orgId: string, teamId: string): string =>
  `${teamPath(orgId, teamId)}/invitations`;
export const grantPath = (orgId: string, teamId: string, userId: string): string =>
  `${teamPath(orgId, teamId)}/grants/${userId}`;
export const acceptPath = (invitationId: string): string =>
  `/v1/invitations/${invitationId}/accept`;
export const registrationPath = (orgId: string, eventId: string): string =>
  `${eventPath(orgId, eventId)}/registration`;
export const rulesPath = (orgId: string, eventId: string): string =>
  `${eventPath(orgId, eventId)}/registration-rules`;
export const registrationCommandsPath = (orgId: string, eventId: string): string =>
  `${eventPath(orgId, eventId)}/registration-commands`;
export const entriesPath = (orgId: string, eventId: string): string =>
  `${eventPath(orgId, eventId)}/entries`;
export const entryPath = (orgId: string, entryId: string): string =>
  `/v1/orgs/${orgId}/entries/${entryId}`;
export const entryCommandsPath = (orgId: string, entryId: string): string =>
  `${entryPath(orgId, entryId)}/commands`;

export async function grant(
  api: Api,
  owner: User,
  team: TeamData,
  actor: Actor,
  status: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
): Promise<void> {
  data(
    await call(api, 'put', grantPath(owner.orgId, team.id, actor.id), {
      cookie: owner.cookie,
      body: { status },
    }),
  );
}

export async function team(
  api: Api,
  owner: User,
  label: string,
  leader?: Actor,
  memberNames = ['球员甲', '球员乙', '球员丙'],
): Promise<TeamData> {
  const created = data<TeamData>(
    await call(api, 'post', teamsPath(owner.orgId), {
      cookie: owner.cookie,
      body: { name: `${label}-${randomUUID().slice(0, 8)}` },
    }),
    201,
  );
  expect(created.grants).toEqual([]);
  expect(created.capabilities).toEqual({ canManage: true, canInvite: true });
  const populated = data<TeamData>(
    await call(api, 'put', `${teamPath(owner.orgId, created.id)}/members`, {
      cookie: owner.cookie,
      body: { expectedVersion: created.version, members: memberNames.map((name) => ({ name })) },
    }),
  );
  expect(populated.members.map((member) => member.name).sort()).toEqual([...memberNames].sort());
  if (leader) await grant(api, owner, populated, leader);
  return populated;
}

export async function invite(
  api: Api,
  owner: User,
  targetTeam: TeamData,
  target: Actor,
): Promise<IssuedInvitationData> {
  const issued = data<IssuedInvitationData>(
    await call(api, 'post', invitationsPath(owner.orgId, targetTeam.id), {
      cookie: owner.cookie,
      body: { targetUserId: target.id, expiresInHours: 24 },
    }),
    201,
  );
  expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(issued.invitation).toMatchObject({
    orgId: owner.orgId,
    teamId: targetTeam.id,
    targetUserId: target.id,
    issuerUserId: owner.id,
    purpose: 'TEAM_MANAGER',
    acceptedAt: null,
    revokedAt: null,
  });
  return issued;
}

export function rules(
  expectedVersion: number,
  overrides: Partial<RegistrationRulesInput> = {},
): RegistrationRulesInput {
  return {
    expectedVersion,
    minPlayers: 2,
    maxPlayers: 3,
    zeroAndDoubleZeroDistinct: false,
    requireIdentity: false,
    requireInsurance: false,
    ...overrides,
  };
}

export async function registration(
  api: Api,
  owner: User,
  eventId: string,
): Promise<EventRegistrationData> {
  return data<EventRegistrationData>(
    await call(api, 'get', registrationPath(owner.orgId, eventId), { cookie: owner.cookie }),
  );
}

export async function registrationCommand(
  api: Api,
  owner: User,
  current: EventRegistrationData,
  type: string,
): Promise<EventRegistrationData> {
  return data<EventRegistrationData>(
    await call(api, 'post', registrationCommandsPath(owner.orgId, current.event.id), {
      cookie: owner.cookie,
      body: { type, expectedVersion: current.event.version },
    }),
  );
}

export async function openRegistration(
  api: Api,
  owner: User,
  label: string,
  reviewer?: Actor,
  overrides: Partial<RegistrationRulesInput> = {},
): Promise<EventRegistrationData> {
  const event = await createEvent(api, owner, `${label}-${randomUUID().slice(0, 8)}`);
  if (reviewer)
    data(
      await call(api, 'put', staffPath(owner.orgId, event.id, reviewer.id), {
        cookie: owner.cookie,
        body: { role: 'REVIEWER', status: 'ACTIVE' },
      }),
    );
  const configured = data<EventRegistrationData>(
    await call(api, 'put', rulesPath(owner.orgId, event.id), {
      cookie: owner.cookie,
      body: rules(event.version, overrides),
    }),
  );
  return registrationCommand(api, owner, configured, 'OPEN_REGISTRATION');
}

export async function entry(
  api: Api,
  owner: User,
  eventId: string,
  targetTeam: TeamData,
  leader: Actor,
): Promise<EntryData> {
  const created = data<EntryData>(
    await call(api, 'post', entriesPath(owner.orgId, eventId), {
      cookie: leader.cookie,
      body: { teamId: targetTeam.id },
    }),
    201,
  );
  expect(created).toMatchObject({
    eventId,
    teamId: targetTeam.id,
    teamName: targetTeam.name,
    status: 'DRAFT',
    version: 1,
    lastSubmittedBy: null,
  });
  return created;
}

export async function roster(
  api: Api,
  owner: User,
  current: EntryData,
  leader: Actor,
  members: TeamData['members'],
  numbers = members.map((_, index) => String(index + 1)),
): Promise<EntryData> {
  return data<EntryData>(
    await call(api, 'put', `${entryPath(owner.orgId, current.id)}/roster`, {
      cookie: leader.cookie,
      body: {
        expectedVersion: current.version,
        players: members.map((member, index) => ({
          memberId: member.id,
          jerseyNo: numbers[index],
        })),
      },
    }),
  );
}

export async function command(
  api: Api,
  owner: User,
  current: EntryData,
  actor: Actor,
  type: string,
  reason?: string,
): Promise<EntryData> {
  return data<EntryData>(
    await call(api, 'post', entryCommandsPath(owner.orgId, current.id), {
      cookie: actor.cookie,
      body: { type, expectedVersion: current.version, ...(reason === undefined ? {} : { reason }) },
    }),
  );
}

export async function getEntry(
  api: Api,
  owner: User,
  entryId: string,
  actor: Actor = owner,
): Promise<EntryData> {
  return data<EntryData>(
    await call(api, 'get', entryPath(owner.orgId, entryId), { cookie: actor.cookie }),
  );
}

export async function submittedEntry(
  api: Api,
  owner: User,
  current: EventRegistrationData,
  leader: Actor,
  label: string,
): Promise<{ team: TeamData; entry: EntryData }> {
  const target = await team(api, owner, label, leader);
  let created = await entry(api, owner, current.event.id, target, leader);
  created = await roster(api, owner, created, leader, target.members.slice(0, 2));
  created = await command(api, owner, created, leader, 'SUBMIT');
  return { team: target, entry: created };
}

export async function blockedPid(
  pool: Pool,
  blockingPid: number,
  message: string,
): Promise<number> {
  const rows = await eventually(
    async () => {
      const result = await pool.query<{ pid: number }>(
        'SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND $2::int = ANY(pg_blocking_pids(pid))',
        [APPLICATION_NAME, blockingPid],
      );
      return result.rows;
    },
    (waiting) => waiting.length === 1,
    message,
  );
  return rows[0]!.pid;
}

export async function allPages<T>(
  api: Api,
  path: string,
  actor: Actor,
): Promise<{ items: T[]; firstCursor: string | null }> {
  const items: T[] = [];
  let cursor: string | null = null;
  let firstCursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const response = await call(
      api,
      'get',
      `${path}${cursor ? `${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : ''}`,
      { cookie: actor.cookie },
    );
    items.push(...data<T[]>(response));
    cursor = response.body.meta.nextCursor as string | null;
    expect(cursor === null || typeof cursor === 'string').toBe(true);
    if (page === 0) firstCursor = cursor;
    if (!cursor) return { items, firstCursor };
  }
  throw new Error('Pagination did not terminate within 100 pages');
}
