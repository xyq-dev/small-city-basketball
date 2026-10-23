import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../../../apps/api/src/security.js';
import type {
  EntryData,
  EventData,
  EventRegistrationData,
  ScoringCommandPayload,
  ScoringCommandResponse,
  ScoringControl,
  ScoringWorkbenchData,
  ScorekeeperLeaseData,
  TeamData,
} from '@small-city-basketball/contracts';
export const origin = 'http://127.0.0.1:4273';
export async function read<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(origin + path);
  expect(response.ok(), `GET ${path}: HTTP ${response.status()}`).toBe(true);
  return (await response.json()).data as T;
}
export async function write<T>(
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
export async function syntheticIdentities() {
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(decodeURIComponent(database.pathname.slice(1))) ||
    process.env.NODE_ENV === 'production'
  )
    throw new Error('Group browser identities require an explicitly isolated test database');
  const orgId = randomUUID();
  const suffix = randomUUID();
  const password = `Synthetic-groups-${randomUUID()}`;
  const passwordHash = await hashPassword(password);
  const users = ['owner', 'leader', 'scorer'].map((role) => ({
    id: randomUUID(),
    email: `groups-${role}-${suffix}@example.test`,
    displayName: `分组合成${role}`,
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
      `分组浏览器合成机构-${suffix.slice(0, 8)}`,
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

export async function registration(
  owner: APIRequestContext,
  leader: APIRequestContext,
  orgId: string,
  leaderId: string,
  format: EventData['format'] = 'GROUP_KNOCKOUT',
  teamCount = 4,
) {
  const root = `/v1/orgs/${orgId}`;
  const event = await write<EventData>(owner, 'POST', `${root}/events`, {
    name: `合成商业浏览器验收-${randomUUID().slice(0, 8)}`,
    startDate: '2026-12-01',
    endDate: '2026-12-02',
    timezone: 'Asia/Shanghai',
    format,
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
  for (let i = 1; i <= teamCount; i++) {
    let team = await write<TeamData>(owner, 'POST', `${root}/teams`, { name: `分组合成队${i}` });
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

export async function scoreAndConfirm(
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
      payload: { remainingMs: 0, reason: '合成分组浏览器验收节末核对' },
    },
    control,
  );
  await act(scorer, { type: 'END_MATCH', payload: {} }, control);
  const confirmed = await act(owner, { type: 'CONFIRM_RESULT', payload: {} });
  expect(confirmed.snapshot.status).toBe('FINAL');
  expect(confirmed.snapshot.latestConfirmation?.confirmingUserId).not.toBe(scorerId);
  return confirmed.snapshot;
}
