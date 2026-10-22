import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type {
  EventScoringData,
  EventSchedulingData,
  MatchStaffRole,
  ScheduledMatchData,
  ScoringCommandInput,
  ScoringCommandPayload,
  ScoringCommandResponse,
  ScoringControl,
  ScoringRules,
  ScoringWorkbenchData,
  ScorekeeperLeaseData,
  ScheduleRevisionData,
  TeamData,
} from '@small-city-basketball/contracts';
import { ORIGIN, call, data } from './support.js';
import type { User } from './support.js';
import {
  allocate,
  closeHarness,
  court,
  createHarness,
  frozen,
  fullAllocations,
  matchesPath,
  publish,
  revision,
} from './p04-support.js';
import type { Harness } from './p04-support.js';

export { closeHarness };
export type { Harness };
export const scoringMatchesPath = (orgId: string) => `/v1/orgs/${orgId}/scoring-matches`;
export const eventScoringPath = (orgId: string, eventId: string) =>
  `/v1/orgs/${orgId}/events/${eventId}/scoring`;
export const scoringRulesPath = (orgId: string, eventId: string) =>
  `/v1/orgs/${orgId}/events/${eventId}/scoring-rules`;
export const workbenchPath = (orgId: string, id: string) =>
  `/v1/orgs/${orgId}/matches/${id}/scoring`;
export const staffPath = (orgId: string, id: string, userId: string) =>
  `/v1/orgs/${orgId}/matches/${id}/staff/${userId}`;
export const leasePath = (orgId: string, id: string) =>
  `/v1/orgs/${orgId}/matches/${id}/scorekeeper-lease`;
export const renewPath = (orgId: string, id: string) => `${leasePath(orgId, id)}/renew`;
export const commandsPath = (orgId: string, id: string) =>
  `/v1/orgs/${orgId}/matches/${id}/commands`;
export const receiptPath = (orgId: string, id: string, commandId: string) =>
  `${commandsPath(orgId, id)}/${commandId}`;
export const snapshotPath = (orgId: string, id: string) =>
  `/v1/orgs/${orgId}/matches/${id}/snapshot`;
export const scoringEventsPath = (orgId: string, id: string) =>
  `/v1/orgs/${orgId}/matches/${id}/scoring-events`;
export const confirmationsPath = (orgId: string, id: string) =>
  `/v1/orgs/${orgId}/matches/${id}/result-confirmations`;
export const defaultRules = (overrides: Partial<ScoringRules> = {}): ScoringRules => ({
  regulationPeriods: 1,
  periodDurationSeconds: 1,
  allowedScoreValues: [1, 2, 3],
  tiePolicy: 'ALLOW_DRAW',
  overtimeDurationSeconds: null,
  ...overrides,
});
export const createScoringHarness = (teamCount = 4) => createHarness(teamCount);
export interface PublishedFixture {
  event: EventScoringData;
  publication: EventSchedulingData;
  schedule: ScheduleRevisionData;
  matches: ScheduledMatchData[];
}

export async function published(
  h: Harness,
  teams: TeamData[] = h.teams.slice(0, 4),
  overrides: Partial<ScoringRules> = {},
): Promise<PublishedFixture> {
  const registration = await frozen(h, h.owner, teams);
  const resource = await court(h.api, h.owner, '记分场地');
  let schedule = await revision(h.api, h.owner, registration, [resource]);
  schedule = await allocate(
    h.api,
    h.owner,
    schedule,
    fullAllocations(schedule, resource, `${registration.event.startDate}T09:00:00+08:00`),
  );
  const publication = data<EventSchedulingData>(await publish(h.api, h.owner, schedule));
  const matches = data<ScheduledMatchData[]>(
    await call(h.api, 'get', matchesPath(h.owner.orgId, registration.event.id), {
      cookie: h.owner.cookie,
    }),
  );
  const event = data<EventScoringData>(
    await call(h.api, 'put', scoringRulesPath(h.owner.orgId, registration.event.id), {
      cookie: h.owner.cookie,
      body: { expectedEventVersion: publication.event.version, ...defaultRules(overrides) },
    }),
  );
  return { event, publication, schedule, matches };
}
export async function workbench(
  h: Harness,
  matchId: string,
  actor: User = h.owner,
): Promise<ScoringWorkbenchData> {
  return data<ScoringWorkbenchData>(
    await call(h.api, 'get', workbenchPath(h.owner.orgId, matchId), { cookie: actor.cookie }),
  );
}
export async function assign(
  h: Harness,
  matchId: string,
  actor: User,
  role: MatchStaffRole = 'SCORER',
  status: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
): Promise<ScoringWorkbenchData> {
  const current = await workbench(h, matchId);
  return data<ScoringWorkbenchData>(
    await call(h.api, 'put', staffPath(h.owner.orgId, matchId, actor.id), {
      cookie: h.owner.cookie,
      body: { expectedMatchVersion: current.match.version, role, status },
    }),
  );
}
export const control = (lease: ScoringControl): ScoringControl => ({
  leaseId: lease.leaseId,
  fencingToken: lease.fencingToken,
  clientInstanceId: lease.clientInstanceId,
});
export async function acquire(
  h: Harness,
  matchId: string,
  actor: User = h.otherOwner,
  clientInstanceId = randomUUID(),
): Promise<ScorekeeperLeaseData> {
  return data<ScorekeeperLeaseData>(
    await call(h.api, 'post', leasePath(h.owner.orgId, matchId), {
      cookie: actor.cookie,
      body: { clientInstanceId },
    }),
  );
}
export async function renew(h: Harness, matchId: string, actor: User, lease: ScoringControl) {
  return call(h.api, 'post', renewPath(h.owner.orgId, matchId), {
    cookie: actor.cookie,
    body: { control: control(lease) },
  });
}
export async function release(h: Harness, matchId: string, actor: User, lease: ScoringControl) {
  return request(h.api.app.getHttpServer())
    .delete(leasePath(h.owner.orgId, matchId))
    .set('Origin', ORIGIN)
    .set('Cookie', actor.cookie)
    .send({ control: control(lease) });
}
export function envelope(
  expectedVersion: number,
  command: ScoringCommandPayload,
  lease?: ScoringControl,
): ScoringCommandInput {
  return {
    commandId: randomUUID(),
    expectedVersion,
    capturedAt: new Date().toISOString(),
    ...command,
    ...(lease ? { control: control(lease) } : {}),
  } as ScoringCommandInput;
}
export async function sendCommand(
  h: Harness,
  matchId: string,
  actor: User,
  input: ScoringCommandInput,
) {
  return call(h.api, 'post', commandsPath(h.owner.orgId, matchId), {
    cookie: actor.cookie,
    body: input,
  });
}
export async function act(
  h: Harness,
  matchId: string,
  actor: User,
  command: ScoringCommandPayload,
  lease?: ScoringControl,
): Promise<ScoringCommandResponse> {
  const current = await workbench(h, matchId, actor);
  return data<ScoringCommandResponse>(
    await sendCommand(h, matchId, actor, envelope(current.match.version, command, lease)),
  );
}
export async function prepare(h: Harness, matchId: string): Promise<ScoringCommandResponse> {
  const current = await workbench(h, matchId);
  return data<ScoringCommandResponse>(
    await sendCommand(
      h,
      matchId,
      h.owner,
      envelope(current.match.version, {
        type: 'PREPARE_MATCH',
        payload: { expectedEventVersion: current.event.version },
      }),
    ),
  );
}
export async function start(
  h: Harness,
  matchId: string,
  actor: User,
  lease: ScoringControl,
): Promise<ScoringCommandResponse> {
  const current = await workbench(h, matchId, actor);
  return data<ScoringCommandResponse>(
    await sendCommand(
      h,
      matchId,
      actor,
      envelope(
        current.match.version,
        { type: 'START_MATCH', payload: { expectedEventVersion: current.event.version } },
        lease,
      ),
    ),
  );
}
export async function liveMatch(
  h: Harness,
  fixture: PublishedFixture,
  matchIndex = 0,
  scorer: User = h.otherOwner,
) {
  const matchId = fixture.matches[matchIndex]!.id;
  await assign(h, matchId, scorer);
  await prepare(h, matchId);
  const lease = await acquire(h, matchId, scorer);
  const response = await start(h, matchId, scorer, lease);
  return { matchId, lease, snapshot: response.snapshot };
}
export async function finish(
  h: Harness,
  matchId: string,
  scorer: User,
  lease: ScoringControl,
): Promise<ScoringCommandResponse> {
  await act(
    h,
    matchId,
    scorer,
    { type: 'CLOCK_SET', payload: { remainingMs: 0, reason: '合成测试节次计时完成' } },
    lease,
  );
  return act(h, matchId, scorer, { type: 'END_MATCH', payload: {} }, lease);
}
