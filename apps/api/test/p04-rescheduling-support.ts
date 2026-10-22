import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Response } from 'supertest';
import { expect } from 'vitest';
import type {
  CourtData,
  EventRegistrationData,
  EventSchedulingData,
  MatchReschedulingData,
  RescheduleMatchInput,
  SchedulePolicy,
  ScheduleRevisionData,
  ScheduledMatchData,
  TeamData,
} from '@small-city-basketball/contracts';
import { call, data, error } from './support.js';
import type { User } from './support.js';
import {
  allocate,
  court,
  frozen,
  fullAllocations,
  matchesPath,
  publish,
  revision,
} from './p04-support.js';
import type { Harness } from './p04-support.js';

export interface ReschedulingFixture {
  registration: EventRegistrationData;
  schedule: ScheduleRevisionData;
  publication: EventSchedulingData;
  matches: ScheduledMatchData[];
  courts: CourtData[];
}

export async function scheduled(
  h: Harness,
  options: {
    owner?: User;
    teams?: TeamData[];
    courts?: CourtData[];
    startDate?: string;
    endDate?: string;
    startsAt?: string;
    stepMinutes?: number;
    policy?: Partial<SchedulePolicy>;
  } = {},
): Promise<ReschedulingFixture> {
  const owner = options.owner ?? h.owner;
  const registration = await frozen(h, owner, options.teams ?? h.teams.slice(0, 2), {
    ...(options.startDate ? { startDate: options.startDate } : {}),
    ...(options.endDate ? { endDate: options.endDate } : {}),
  });
  const courts = options.courts ?? [await court(h.api, owner), await court(h.api, owner)];
  let schedule = await revision(h.api, owner, registration, courts, options.policy);
  schedule = await allocate(
    h.api,
    owner,
    schedule,
    fullAllocations(
      schedule,
      courts[0]!,
      options.startsAt ?? `${registration.event.startDate}T09:00:00+08:00`,
      options.stepMinutes ?? 60,
    ),
  );
  const publication = data<EventSchedulingData>(await publish(h.api, owner, schedule));
  const matches = data<ScheduledMatchData[]>(
    await call(h.api, 'get', matchesPath(owner.orgId, registration.event.id), {
      cookie: owner.cookie,
    }),
  );
  return { registration, schedule, publication, matches, courts };
}

export const reschedulingPath = (orgId: string, id: string) =>
  `/v1/orgs/${orgId}/matches/${id}/rescheduling`;
export const rescheduleCommandsPath = (orgId: string, id: string) =>
  `/v1/orgs/${orgId}/matches/${id}/reschedule-commands`;

export async function rescheduling(
  h: Harness,
  id: string,
  actor: User = h.owner,
  orgId = h.owner.orgId,
): Promise<MatchReschedulingData> {
  return data<MatchReschedulingData>(
    await call(h.api, 'get', reschedulingPath(orgId, id), { cookie: actor.cookie }),
  );
}

export function input(
  current: MatchReschedulingData,
  overrides: Partial<RescheduleMatchInput> = {},
): RescheduleMatchInput {
  return {
    type: 'RESCHEDULE',
    expectedEventVersion: current.event.version,
    expectedMatchVersion: current.match.version,
    courtId: current.match.courtId,
    startsAt: new Date(Date.parse(current.match.startsAt) + 120 * 60000).toISOString(),
    reason: '合成赛事受控改期',
    ...overrides,
  };
}

export const reschedule = (
  h: Harness,
  current: MatchReschedulingData,
  overrides: Partial<RescheduleMatchInput> = {},
  actor: User = h.owner,
) =>
  call(h.api, 'post', rescheduleCommandsPath(h.owner.orgId, current.match.id), {
    cookie: actor.cookie,
    body: input(current, overrides),
  });

export function rejected(response: Response, status: number, code?: string) {
  error(response, status);
  if (code) expect(response.body.error.code).toBe(code);
}

export function conflicts(response: Response, code: string) {
  rejected(response, 409, 'SCHEDULE_CONFLICT');
  expect(response.body.error.details.conflicts).toEqual(
    expect.arrayContaining([expect.objectContaining({ code })]),
  );
  return response.body.error.details.conflicts as Record<string, unknown>[];
}

export async function rows(h: Harness, sql: string, values: unknown[]) {
  return (
    await h.api.pool.query<{ value: unknown }>(
      `SELECT to_jsonb(record_row) AS value FROM (${sql}) record_row ORDER BY to_jsonb(record_row)::text`,
      values,
    )
  ).rows.map((row) => row.value);
}

export async function originalFacts(h: Harness, eventId: string) {
  const facts: Record<string, unknown> = {};
  for (const [name, sql] of Object.entries({
    freeze: 'SELECT * FROM registration_freezes WHERE org_id=$1 AND event_id=$2',
    revisions: 'SELECT * FROM schedule_revisions WHERE org_id=$1 AND event_id=$2',
    fixtures: 'SELECT * FROM schedule_fixtures WHERE org_id=$1 AND event_id=$2',
    publication: 'SELECT * FROM schedule_publications WHERE org_id=$1 AND event_id=$2',
  }))
    facts[name] = await rows(h, sql, [h.owner.orgId, eventId]);
  return facts;
}

export async function currentFacts(h: Harness, eventId: string, matchId: string) {
  const facts: Record<string, unknown> = {};
  for (const [name, sql] of Object.entries({
    event: 'SELECT * FROM events WHERE org_id=$1 AND id=$2',
    matches: 'SELECT * FROM published_matches WHERE org_id=$1 AND event_id=$2',
    history: 'SELECT * FROM match_reschedules WHERE org_id=$1 AND event_id=$2',
    courtReservations:
      'SELECT r.* FROM court_reservations r JOIN published_matches m ON m.org_id=r.org_id AND m.id=r.match_id WHERE m.org_id=$1 AND m.event_id=$2',
    teamReservations:
      'SELECT r.* FROM team_reservations r JOIN published_matches m ON m.org_id=r.org_id AND m.id=r.match_id WHERE m.org_id=$1 AND m.event_id=$2',
    state: 'SELECT * FROM scoring_states WHERE org_id=$1 AND event_id=$2',
    events: 'SELECT * FROM scoring_events WHERE org_id=$1 AND event_id=$2',
    commands: 'SELECT * FROM scoring_commands WHERE org_id=$1 AND event_id=$2',
    leases: 'SELECT * FROM scoring_leases WHERE org_id=$1 AND event_id=$2',
  }))
    facts[name] = await rows(h, sql, [h.owner.orgId, eventId]);
  facts.audit = await rows(
    h,
    'SELECT * FROM audit_logs WHERE org_id=$1 AND resource_id IN ($2,$3)',
    [h.owner.orgId, eventId, matchId],
  );
  return facts;
}

export async function assertReservations(h: Harness, current: MatchReschedulingData) {
  const target = current.match;
  const courtRows = await h.api.pool.query(
    'SELECT * FROM court_reservations WHERE org_id=$1 AND match_id=$2',
    [h.owner.orgId, target.id],
  );
  expect(courtRows.rows).toHaveLength(1);
  expect(courtRows.rows[0]).toMatchObject({
    publication_id: target.publicationId,
    court_id: target.courtId,
    starts_at: new Date(target.startsAt),
    ends_at: new Date(target.endsAt),
  });
  const teams = await h.api.pool.query(
    'SELECT * FROM team_reservations WHERE org_id=$1 AND match_id=$2 ORDER BY team_id',
    [h.owner.orgId, target.id],
  );
  expect(teams.rows.map((row) => row.team_id)).toEqual(
    [target.home.teamId, target.away.teamId].sort(),
  );
  for (const row of teams.rows)
    expect(row).toMatchObject({
      publication_id: target.publicationId,
      starts_at: new Date(target.startsAt),
      ends_at: new Date(target.endsAt),
    });
}

export async function insertProof(client: PoolClient, h: Harness, current: MatchReschedulingData) {
  return client.query(
    `INSERT INTO match_reschedules(id,org_id,event_id,match_id,created_by,from_event_version,to_event_version,from_match_version,to_match_version,old_court_id,old_court_name,old_starts_at,old_ends_at,new_court_id,new_court_name,new_starts_at,new_ends_at,reason)
     SELECT $3,m.org_id,m.event_id,m.id,$4,e.version,e.version+1,m.version,m.version+1,m.court_id,m.court_name,m.starts_at,m.ends_at,m.court_id,m.court_name,m.starts_at+interval '2 hours',m.ends_at+interval '2 hours','合成SQL改期完整性验证'
     FROM published_matches m JOIN events e ON e.org_id=m.org_id AND e.id=m.event_id WHERE m.org_id=$1 AND m.id=$2`,
    [h.owner.orgId, current.match.id, randomUUID(), h.owner.id],
  );
}

// All identifiers are generated locally; no caller-controlled SQL names enter these helpers.
export async function failingAudit(
  h: Harness,
  eventId: string,
  matchId: string,
  run: () => Promise<void>,
) {
  const name = `scb_p04b_${randomUUID().replaceAll('-', '')}`;
  await h.api.pool.query(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.org_id::text=TG_ARGV[0] AND (NEW.resource_id::text=TG_ARGV[1] OR NEW.resource_id::text=TG_ARGV[2]) THEN RAISE EXCEPTION 'synthetic rescheduling failure'; END IF; RETURN NEW; END $$`,
  );
  try {
    await h.api.pool.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}('${h.owner.orgId}','${eventId}','${matchId}')`,
    );
    await run();
  } finally {
    try {
      await h.api.pool.query(`DROP TRIGGER IF EXISTS ${name} ON audit_logs`);
    } finally {
      await h.api.pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
    }
  }
}
