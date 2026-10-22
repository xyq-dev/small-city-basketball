import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  EntryData,
  EventRegistrationData,
  InvitationData,
  SessionData,
  TeamContext,
  TeamData,
  TeamRegistrationEventData,
} from '@small-city-basketball/contracts';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import {
  ORIGIN,
  PASSWORD,
  RUN_ID,
  auditCount,
  call,
  createEvent,
  data,
  error,
  eventPath,
  eventsPath,
  membersPath,
  register,
  staffPath,
} from './support.js';
import type { Api, User } from './support.js';
import {
  acceptPath,
  allPages,
  blockedPid,
  command,
  entriesPath,
  entry,
  entryCommandsPath,
  entryPath,
  getEntry,
  grant,
  grantPath,
  invitationsPath,
  invite,
  openRegistration,
  participant,
  registration,
  registrationCommand,
  registrationCommandsPath,
  registrationDatabaseUrl,
  registrationPath,
  roster,
  rules,
  rulesPath,
  submittedEntry,
  team,
  teamPath,
  teamsPath,
} from './p03-support.js';
import type { Actor } from './p03-support.js';

const databaseUrl = registrationDatabaseUrl();

describe(
  'P03-A registration HTTP + real PostgreSQL invariants',
  { concurrent: false, shuffle: false },
  () => {
    let api: Api;
    let owner: User;
    let otherOwner: User;
    let leader: Actor;
    let otherLeader: Actor;
    let reviewer: Actor;
    const instances: Api[] = [];

    async function anotherApi(): Promise<Api> {
      const instance = await createApi({ databaseUrl, appOrigin: ORIGIN });
      instances.push(instance);
      return instance;
    }

    beforeAll(async () => {
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        const actual = await pool.query<{ name: string }>('SELECT current_database() AS name');
        expect(actual.rows[0]?.name).toMatch(/^scb_test_[A-Za-z0-9_]+$/);
        await migrate(pool);
      } finally {
        await pool.end();
      }
      api = await anotherApi();
      owner = await register(api, 'p03-owner');
      otherOwner = await register(api, 'p03-other-owner');
      leader = await participant(api, 'leader');
      otherLeader = await participant(api, 'other-leader');
      reviewer = await participant(api, 'reviewer');
      data(
        await call(api, 'put', `${membersPath(owner.orgId)}/${reviewer.id}`, {
          cookie: owner.cookie,
          body: { role: 'REVIEWER', status: 'ACTIVE' },
        }),
      );
    }, 60000);

    afterAll(async () => {
      for (const instance of instances.reverse()) {
        await instance.app.close();
        await instance.pool.end();
      }
    }, 30000);

    test('participant registration creates only a user/session, rejects extra privileges and requires Origin', async () => {
      const session = data<SessionData>(
        await call(api, 'get', '/v1/auth/session', { cookie: leader.cookie }),
      );
      expect(session.organizations).toEqual([]);
      expect(session.teamContexts).toEqual([]);
      const memberships = await api.pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM organization_memberships WHERE user_id = $1',
        [leader.id],
      );
      expect(memberships.rows[0]!.count).toBe(0);
      const body = {
        email: `p03-forged-${RUN_ID}@example.test`,
        password: PASSWORD,
        displayName: '外部用户',
      };
      for (const origin of [null, 'https://attacker.example'])
        error(await call(api, 'post', '/v1/auth/register-participant', { origin, body }), 403);
      for (const extra of [
        { organizationName: '伪造机构' },
        { role: 'ORG_OWNER' },
        { orgId: owner.orgId },
      ])
        error(
          await call(api, 'post', '/v1/auth/register-participant', { body: { ...body, ...extra } }),
          422,
        );
      const forged = await api.pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM users WHERE email = $1',
        [body.email],
      );
      expect(forged.rows[0]!.count).toBe(0);
    });

    test('team creation is staff-only, grants are separate and team/member updates have CAS and whitelist validation', async () => {
      const target = await team(api, owner, 'Team CAS');
      error(
        await call(api, 'post', teamsPath(owner.orgId), {
          cookie: leader.cookie,
          body: { name: '越权球队' },
        }),
        403,
      );
      error(
        await call(api, 'post', teamsPath(owner.orgId), {
          cookie: reviewer.cookie,
          body: { name: '审核员越权' },
        }),
        403,
      );
      error(
        await call(api, 'post', teamsPath(owner.orgId), {
          cookie: owner.cookie,
          body: { name: ' ', orgId: otherOwner.orgId },
        }),
        422,
      );
      error(
        await call(api, 'put', `${teamPath(owner.orgId, target.id)}/members`, {
          cookie: owner.cookie,
          body: {
            expectedVersion: target.version,
            members: Array.from({ length: 61 }, () => ({ name: '合成球员' })),
          },
        }),
        422,
      );
      const before = await auditCount(api.pool, owner.orgId, target.id);
      const responses = await Promise.all(
        ['CAS甲', 'CAS乙'].map((name) =>
          call(api, 'patch', teamPath(owner.orgId, target.id), {
            cookie: owner.cookie,
            body: { name, expectedVersion: target.version },
          }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const winner = data<TeamData>(responses.find((response) => response.status === 200)!);
      error(
        responses.find((response) => response.status === 409)!,
        409,
      );
      expect(winner.version).toBe(target.version + 1);
      expect(await auditCount(api.pool, owner.orgId, target.id)).toBe(before + 1);
      const sameNames = data<TeamData>(
        await call(api, 'put', `${teamPath(owner.orgId, target.id)}/members`, {
          cookie: owner.cookie,
          body: {
            expectedVersion: winner.version,
            members: [{ name: '同名球员' }, { name: '同名球员' }],
          },
        }),
      );
      expect(sameNames.members).toHaveLength(2);
      expect(new Set(sameNames.members.map((member) => member.id)).size).toBe(2);
      for (const members of [
        [{ id: randomUUID(), name: '不属于本队的编号' }],
        [sameNames.members[0]!, sameNames.members[0]!],
        [{ name: '🏀'.repeat(81) }],
      ])
        error(
          await call(api, 'put', `${teamPath(owner.orgId, target.id)}/members`, {
            cookie: owner.cookie,
            body: { expectedVersion: sameNames.version, members },
          }),
          422,
        );
    });

    test('tenant and team isolation applies to read, member edit, invitations, grants and registration discovery', async () => {
      const ownTeam = await team(api, owner, 'Leader team', leader);
      const hiddenTeam = await team(api, owner, 'Hidden team', otherLeader);
      const foreignTeam = await team(api, otherOwner, 'Foreign team', otherLeader);
      for (const path of [
        teamPath(owner.orgId, hiddenTeam.id),
        teamPath(otherOwner.orgId, foreignTeam.id),
        `${teamPath(owner.orgId, hiddenTeam.id)}/registration-events`,
      ])
        error(await call(api, 'get', path, { cookie: leader.cookie }), 404);
      error(
        await call(api, 'get', teamPath(otherOwner.orgId, ownTeam.id), {
          cookie: otherOwner.cookie,
        }),
        404,
      );
      error(
        await call(api, 'put', `${teamPath(owner.orgId, hiddenTeam.id)}/members`, {
          cookie: leader.cookie,
          body: { expectedVersion: hiddenTeam.version, members: [] },
        }),
        404,
      );
      error(
        await call(api, 'put', grantPath(owner.orgId, ownTeam.id, otherLeader.id), {
          cookie: leader.cookie,
          body: { status: 'ACTIVE' },
        }),
        403,
      );
      error(
        await call(api, 'post', invitationsPath(owner.orgId, ownTeam.id), {
          cookie: leader.cookie,
          body: { targetUserId: otherLeader.id, expiresInHours: 24 },
        }),
        403,
      );
      error(
        await call(api, 'get', invitationsPath(owner.orgId, ownTeam.id), { cookie: leader.cookie }),
        403,
      );
      // A team grant must never turn into the old staff/membership authority.
      error(await call(api, 'get', eventsPath(owner.orgId), { cookie: leader.cookie }), 404);
      const event = await createEvent(api, owner, 'No staff bypass');
      error(
        await call(api, 'put', staffPath(owner.orgId, event.id, leader.id), {
          cookie: leader.cookie,
          body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
        }),
        404,
      );
      const context = data<SessionData>(
        await call(api, 'get', '/v1/auth/session', { cookie: leader.cookie }),
      );
      expect(context.organizations).toEqual([]);
      expect(
        context.teamContexts.some(
          (item) => item.teamId === ownTeam.id && item.orgId === owner.orgId,
        ),
      ).toBe(true);
      expect(
        context.teamContexts.some((item) => [hiddenTeam.id, foreignTeam.id].includes(item.teamId)),
      ).toBe(false);
    });

    test('invitations bind an existing target, expose the token once and do not grant organization membership', async () => {
      const target = await team(api, owner, 'Invitation binding');
      const issued = await invite(api, owner, target, leader);
      const unrelated = await team(api, owner, 'Wrong invitation team');
      error(
        await call(
          api,
          'post',
          `${invitationsPath(owner.orgId, unrelated.id)}/${issued.invitation.id}/revoke`,
          { cookie: owner.cookie, body: {} },
        ),
        404,
      );
      error(
        await call(
          api,
          'post',
          `${invitationsPath(otherOwner.orgId, target.id)}/${issued.invitation.id}/revoke`,
          { cookie: otherOwner.cookie, body: {} },
        ),
        404,
      );
      error(
        await call(api, 'post', invitationsPath(owner.orgId, target.id), {
          cookie: owner.cookie,
          body: { targetUserId: randomUUID(), expiresInHours: 24 },
        }),
        404,
      );
      for (const expiresInHours of [0, 169, 1.5, '24'])
        error(
          await call(api, 'post', invitationsPath(owner.orgId, target.id), {
            cookie: owner.cookie,
            body: { targetUserId: leader.id, expiresInHours },
          }),
          422,
        );
      const stored = await api.pool.query<{ token_hash: string }>(
        'SELECT token_hash FROM team_invitations WHERE id = $1',
        [issued.invitation.id],
      );
      expect(stored.rows[0]!.token_hash).toBe(
        createHash('sha256').update(issued.token).digest('hex'),
      );
      expect(stored.rows[0]!.token_hash).not.toContain(issued.token);
      const listing = await call(api, 'get', invitationsPath(owner.orgId, target.id), {
        cookie: owner.cookie,
      });
      expect(data<InvitationData[]>(listing).some((item) => item.id === issued.invitation.id)).toBe(
        true,
      );
      expect(JSON.stringify(listing.body)).not.toMatch(/token|hash/i);
      error(
        await call(api, 'post', acceptPath(issued.invitation.id), {
          cookie: otherLeader.cookie,
          body: { token: issued.token },
        }),
        404,
      );
      error(
        await call(api, 'post', acceptPath(issued.invitation.id), {
          body: { token: issued.token },
        }),
        401,
      );
      error(
        await call(api, 'post', acceptPath(issued.invitation.id), {
          cookie: leader.cookie,
          body: { token: 'A'.repeat(43) },
        }),
        422,
      );
      const context = data<TeamContext>(
        await call(api, 'post', acceptPath(issued.invitation.id), {
          cookie: leader.cookie,
          body: { token: issued.token },
        }),
      );
      expect(context).toMatchObject({
        orgId: owner.orgId,
        teamId: target.id,
        teamName: target.name,
      });
      const acceptanceState = async () => {
        const result = await api.pool.query<{
          acceptedAt: string;
          grantUpdatedAt: string;
          grantStatus: string;
        }>(
          `SELECT i.accepted_at::text AS "acceptedAt", g.updated_at::text AS "grantUpdatedAt", g.status AS "grantStatus"
           FROM team_invitations i JOIN team_access_grants g
             ON g.org_id = i.org_id AND g.team_id = i.team_id AND g.user_id = i.target_user_id
           WHERE i.id = $1`,
          [issued.invitation.id],
        );
        expect(result.rows).toHaveLength(1);
        return result.rows[0]!;
      };
      const stateBeforeRetry = await acceptanceState();
      expect(stateBeforeRetry).toMatchObject({
        acceptedAt: expect.any(String),
        grantUpdatedAt: expect.any(String),
        grantStatus: 'ACTIVE',
      });
      const auditsBeforeRetry = await auditCount(api.pool, owner.orgId, target.id);
      const repeated = data<TeamContext>(
        await call(api, 'post', acceptPath(issued.invitation.id), {
          cookie: leader.cookie,
          body: { token: issued.token },
        }),
      );
      expect(repeated).toEqual(context);
      const wrongToken = `${issued.token[0] === 'A' ? 'B' : 'A'}${issued.token.slice(1)}`;
      const invalidReplay = await call(api, 'post', acceptPath(issued.invitation.id), {
        cookie: leader.cookie,
        body: { token: wrongToken },
      });
      error(invalidReplay, 422);
      expect(invalidReplay.body.error.code).toBe('INVITATION_INVALID');
      expect(await acceptanceState()).toEqual(stateBeforeRetry);
      expect(await auditCount(api.pool, owner.orgId, target.id)).toBe(auditsBeforeRetry);
      const session = data<SessionData>(
        await call(api, 'get', '/v1/auth/session', { cookie: leader.cookie }),
      );
      expect(session.organizations).toEqual([]);
      expect(session.teamContexts.map((item) => item.teamId)).toContain(target.id);
    });

    test('expired, revoked and consumed invitations cannot establish or resurrect grants', async () => {
      const target = await team(api, owner, 'Invitation lifecycle');
      const expired = await invite(api, owner, target, leader);
      await api.pool.query(
        "UPDATE team_invitations SET created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 hour' WHERE id = $1",
        [expired.invitation.id],
      );
      error(
        await call(api, 'post', acceptPath(expired.invitation.id), {
          cookie: leader.cookie,
          body: { token: expired.token },
        }),
        422,
      );
      const revoked = await invite(api, owner, target, leader);
      data(
        await call(
          api,
          'post',
          `${invitationsPath(owner.orgId, target.id)}/${revoked.invitation.id}/revoke`,
          { cookie: owner.cookie, body: {} },
        ),
      );
      error(
        await call(api, 'post', acceptPath(revoked.invitation.id), {
          cookie: leader.cookie,
          body: { token: revoked.token },
        }),
        422,
      );
      const consumed = await invite(api, owner, target, leader);
      data(
        await call(api, 'post', acceptPath(consumed.invitation.id), {
          cookie: leader.cookie,
          body: { token: consumed.token },
        }),
      );
      await grant(api, owner, target, leader, 'DISABLED');
      const replay = await call(api, 'post', acceptPath(consumed.invitation.id), {
        cookie: leader.cookie,
        body: { token: consumed.token },
      });
      error(replay, 409);
      expect(replay.body.error.code).toBe('INVITATION_CONSUMED');
      error(
        await call(api, 'get', teamPath(owner.orgId, target.id), { cookie: leader.cookie }),
        404,
      );
      const session = data<SessionData>(
        await call(api, 'get', '/v1/auth/session', { cookie: leader.cookie }),
      );
      expect(session.teamContexts.map((item) => item.teamId)).not.toContain(target.id);
      expect(
        (
          await api.pool.query<{ status: string }>(
            'SELECT status FROM team_access_grants WHERE org_id = $1 AND team_id = $2 AND user_id = $3',
            [owner.orgId, target.id, leader.id],
          )
        ).rows,
      ).toEqual([{ status: 'DISABLED' }]);
    });

    test('grant revocation immediately removes existing-cookie write access and cannot be bypassed by actor/org fields', async () => {
      const target = await team(api, owner, 'Grant revoke', leader);
      const current = await openRegistration(api, owner, 'Grant revoke event');
      const draft = await entry(api, owner, current.event.id, target, leader);
      await grant(api, owner, target, leader, 'DISABLED');
      error(
        await call(api, 'get', entryPath(owner.orgId, draft.id), { cookie: leader.cookie }),
        404,
      );
      error(
        await call(api, 'put', `${entryPath(owner.orgId, draft.id)}/roster`, {
          cookie: leader.cookie,
          body: { expectedVersion: draft.version, players: [] },
        }),
        404,
      );
      error(
        await call(api, 'post', entryCommandsPath(owner.orgId, draft.id), {
          cookie: leader.cookie,
          body: { type: 'WITHDRAW', expectedVersion: draft.version },
        }),
        404,
      );
      error(
        await call(api, 'put', grantPath(owner.orgId, target.id, leader.id), {
          cookie: owner.cookie,
          body: { status: 'ACTIVE', actorId: otherOwner.id },
        }),
        422,
      );
      expect((await getEntry(api, owner, draft.id)).version).toBe(draft.version);
    });

    test('registration requires a complete supported ruleset and locks its version when opened', async () => {
      const event = await createEvent(api, owner, 'Rules must be complete');
      let current = await registration(api, owner, event.id);
      expect(current.rules).toBeNull();
      error(
        await call(api, 'post', registrationCommandsPath(owner.orgId, event.id), {
          cookie: owner.cookie,
          body: { type: 'OPEN_REGISTRATION', expectedVersion: current.event.version },
        }),
        422,
      );
      for (const overrides of [
        { minPlayers: 0 },
        { minPlayers: 4, maxPlayers: 3 },
        { maxPlayers: 61 },
        { requireIdentity: 'false' },
        { orgId: otherOwner.orgId },
      ])
        error(
          await call(api, 'put', rulesPath(owner.orgId, event.id), {
            cookie: owner.cookie,
            body: { ...rules(current.event.version), ...overrides },
          }),
          422,
        );
      for (const unsupported of [{ requireIdentity: true }, { requireInsurance: true }]) {
        current = data<EventRegistrationData>(
          await call(api, 'put', rulesPath(owner.orgId, event.id), {
            cookie: owner.cookie,
            body: rules(current.event.version, unsupported),
          }),
        );
        error(
          await call(api, 'post', registrationCommandsPath(owner.orgId, event.id), {
            cookie: owner.cookie,
            body: { type: 'OPEN_REGISTRATION', expectedVersion: current.event.version },
          }),
          422,
        );
        expect((await registration(api, owner, event.id)).event.status).toBe('DRAFT');
      }
      current = data<EventRegistrationData>(
        await call(api, 'put', rulesPath(owner.orgId, event.id), {
          cookie: owner.cookie,
          body: rules(current.event.version),
        }),
      );
      const rulesId = current.rules!.id;
      const rulesVersion = current.rules!.version;
      current = await registrationCommand(api, owner, current, 'OPEN_REGISTRATION');
      expect(current).toMatchObject({
        event: { status: 'REGISTRATION_OPEN' },
        rules: { id: rulesId, version: rulesVersion },
        capabilities: { canManageRules: false, canOpen: false, canClose: true },
      });
      error(
        await call(api, 'put', rulesPath(owner.orgId, event.id), {
          cookie: owner.cookie,
          body: rules(current.event.version),
        }),
        422,
      );
      const locked = await registration(api, owner, event.id);
      expect(locked.rules).toEqual(current.rules);
      expect(locked.event.version).toBe(current.event.version);
      expect(current.event.version).toBe(event.version + 4);
    });

    test('leaders discover only open events and their own entries and cannot read another team entry or unpublished draft', async () => {
      const target = await team(api, owner, 'Discovery own team', leader);
      const different = await team(api, owner, 'Discovery hidden entry', otherLeader);
      const unpublished = await createEvent(api, owner, 'Hidden draft');
      const current = await openRegistration(api, owner, 'Visible open event');
      const ownEntry = await entry(api, owner, current.event.id, target, leader);
      const hiddenEntry = await entry(api, owner, current.event.id, different, otherLeader);
      const events = data<TeamRegistrationEventData[]>(
        await call(
          api,
          'get',
          `${teamPath(owner.orgId, target.id)}/registration-events?limit=100`,
          { cookie: leader.cookie },
        ),
      );
      expect(
        events.some((item) => item.event.id === current.event.id && item.entry?.id === ownEntry.id),
      ).toBe(true);
      expect(events.some((item) => item.event.id === unpublished.id)).toBe(false);
      const listing = data<EntryData[]>(
        await call(api, 'get', `${entriesPath(owner.orgId, current.event.id)}?limit=100`, {
          cookie: leader.cookie,
        }),
      );
      expect(listing.map((item) => item.id)).toEqual([ownEntry.id]);
      error(
        await call(api, 'get', entryPath(owner.orgId, hiddenEntry.id), { cookie: leader.cookie }),
        404,
      );
      error(
        await call(api, 'get', registrationPath(owner.orgId, unpublished.id), {
          cookie: leader.cookie,
        }),
        404,
      );
      error(
        await call(api, 'get', eventPath(owner.orgId, unpublished.id), { cookie: leader.cookie }),
        404,
      );
      error(
        await call(api, 'post', entriesPath(owner.orgId, current.event.id), {
          cookie: leader.cookie,
          body: { teamId: different.id },
        }),
        404,
      );
      error(
        await call(api, 'post', entriesPath(otherOwner.orgId, current.event.id), {
          cookie: otherLeader.cookie,
          body: { teamId: different.id },
        }),
        404,
      );
      error(
        await call(api, 'post', entriesPath(owner.orgId, current.event.id), {
          cookie: owner.cookie,
          body: { teamId: target.id },
        }),
        403,
      );
    });

    test('rosters reject foreign, duplicate and archived members and enforce jersey grammar and zero equivalence', async () => {
      const target = await team(api, owner, 'Roster validation', leader);
      const different = await team(api, owner, 'Foreign roster member', otherLeader);
      const current = await openRegistration(api, owner, 'Roster validation event');
      let draft = await entry(api, owner, current.event.id, target, leader);
      const first = target.members[0]!;
      const second = target.members[1]!;
      const oversizedTeam = await team(api, owner, 'Too many submitted players', leader, [
        '合成一',
        '合成二',
        '合成三',
        '合成四',
      ]);
      let oversized = await entry(api, owner, current.event.id, oversizedTeam, leader);
      oversized = await roster(api, owner, oversized, leader, oversizedTeam.members);
      expect(oversized.capabilities.canSubmit).toBe(false);
      error(
        await call(api, 'post', entryCommandsPath(owner.orgId, oversized.id), {
          cookie: leader.cookie,
          body: { type: 'SUBMIT', expectedVersion: oversized.version },
        }),
        422,
      );
      const invalidPlayers = [
        [{ memberId: different.members[0]!.id, jerseyNo: '1' }],
        [
          { memberId: first.id, jerseyNo: '1' },
          { memberId: first.id, jerseyNo: '2' },
        ],
        [
          { memberId: first.id, jerseyNo: '1' },
          { memberId: second.id, jerseyNo: '1' },
        ],
        [
          { memberId: first.id, jerseyNo: '0' },
          { memberId: second.id, jerseyNo: '00' },
        ],
        ...['01', '-1', '100', '０', '1 ', '1.0'].map((jerseyNo) => [
          { memberId: first.id, jerseyNo },
        ]),
        [{ memberId: first.id, jerseyNo: 1 }],
      ];
      for (const players of invalidPlayers)
        error(
          await call(api, 'put', `${entryPath(owner.orgId, draft.id)}/roster`, {
            cookie: leader.cookie,
            body: { expectedVersion: draft.version, players },
          }),
          422,
        );
      error(
        await call(api, 'put', `${entryPath(owner.orgId, draft.id)}/roster`, {
          cookie: leader.cookie,
          body: { expectedVersion: draft.version, players: [], orgId: otherOwner.orgId },
        }),
        422,
      );
      draft = await roster(api, owner, draft, leader, [first], ['0']);
      error(
        await call(api, 'post', entryCommandsPath(owner.orgId, draft.id), {
          cookie: leader.cookie,
          body: { type: 'SUBMIT', expectedVersion: draft.version },
        }),
        422,
      );
      expect((await getEntry(api, owner, draft.id, leader)).status).toBe('DRAFT');
      const distinct = await openRegistration(api, owner, 'Zero distinct', undefined, {
        zeroAndDoubleZeroDistinct: true,
      });
      let distinctEntry = await entry(api, owner, distinct.event.id, target, leader);
      distinctEntry = await roster(api, owner, distinctEntry, leader, [first, second], ['0', '00']);
      expect((await command(api, owner, distinctEntry, leader, 'SUBMIT')).status).toBe('SUBMITTED');
      const updated = data<TeamData>(
        await call(api, 'put', `${teamPath(owner.orgId, target.id)}/members`, {
          cookie: leader.cookie,
          body: {
            expectedVersion: target.version,
            members: target.members.filter((member) => member.id !== first.id),
          },
        }),
      );
      expect(updated.members.map((member) => member.id)).not.toContain(first.id);
      error(
        await call(api, 'put', `${entryPath(owner.orgId, draft.id)}/roster`, {
          cookie: leader.cookie,
          body: {
            expectedVersion: draft.version,
            players: [{ memberId: first.id, jerseyNo: '1' }],
          },
        }),
        422,
      );
    });

    test('long-term team edits do not mutate existing immutable roster revisions or team-name snapshots', async () => {
      const target = await team(api, owner, 'Roster history', leader);
      const current = await openRegistration(api, owner, 'Roster snapshot');
      let draft = await entry(api, owner, current.event.id, target, leader);
      draft = await roster(api, owner, draft, leader, target.members.slice(0, 2));
      const original = structuredClone(draft);
      let changed = data<TeamData>(
        await call(api, 'patch', teamPath(owner.orgId, target.id), {
          cookie: leader.cookie,
          body: { expectedVersion: target.version, name: '长期球队已改名' },
        }),
      );
      changed = data<TeamData>(
        await call(api, 'put', `${teamPath(owner.orgId, target.id)}/members`, {
          cookie: leader.cookie,
          body: {
            expectedVersion: changed.version,
            members: [{ id: target.members[1]!.id, name: '球员新姓名' }, { name: '新球员' }],
          },
        }),
      );
      const unchanged = await getEntry(api, owner, draft.id, leader);
      expect(unchanged).toMatchObject({
        teamName: original.teamName,
        rosterRevisionId: original.rosterRevisionId,
        version: original.version,
        players: original.players,
      });
      draft = await roster(api, owner, draft, leader, changed.members);
      expect(draft.rosterRevisionId).not.toBe(original.rosterRevisionId);
      expect(draft.players.map((player) => player.name).sort()).toEqual(
        ['新球员', '球员新姓名'].sort(),
      );
      const oldPlayers = await api.pool.query<{ name: string; jersey_no: string }>(
        'SELECT name, jersey_no FROM entry_roster_players WHERE revision_id = $1 ORDER BY jersey_no',
        [original.rosterRevisionId],
      );
      expect(
        oldPlayers.rows.map((player) => ({ name: player.name, jerseyNo: player.jersey_no })),
      ).toEqual(
        original.players
          .map((player) => ({ name: player.name, jerseyNo: player.jerseyNo }))
          .sort((a, b) => a.jerseyNo.localeCompare(b.jerseyNo)),
      );
    });

    test('OWNER has no self-review exception, including after losing the grant or changing leaders', async () => {
      const current = await openRegistration(api, owner, 'No owner self approval', reviewer);
      const target = await team(api, owner, 'Owner as leader', owner);
      let submitted = await entry(api, owner, current.event.id, target, owner);
      submitted = await roster(api, owner, submitted, owner, target.members.slice(0, 2));
      submitted = await command(api, owner, submitted, owner, 'SUBMIT');
      expect(submitted.lastSubmittedBy).toBe(owner.id);
      for (const type of ['APPROVE', 'REQUEST_CHANGES', 'REJECT'])
        error(
          await call(api, 'post', entryCommandsPath(owner.orgId, submitted.id), {
            cookie: owner.cookie,
            body: { type, expectedVersion: submitted.version, reason: '不能自审' },
          }),
          403,
        );
      await grant(api, owner, target, owner, 'DISABLED');
      await grant(api, owner, target, otherLeader);
      const read = await getEntry(api, owner, submitted.id);
      expect(read.lastSubmittedBy).toBe(owner.id);
      expect(read.capabilities.canReview).toBe(false);
      error(
        await call(api, 'post', entryCommandsPath(owner.orgId, submitted.id), {
          cookie: owner.cookie,
          body: { type: 'APPROVE', expectedVersion: submitted.version },
        }),
        403,
      );
      const approved = await command(api, owner, submitted, reviewer, 'APPROVE');
      expect(approved.status).toBe('APPROVED');
      expect(approved.history.at(-1)).toMatchObject({
        type: 'APPROVE',
        actorId: reviewer.id,
        rosterRevisionId: submitted.rosterRevisionId,
      });
      const other = await submittedEntry(api, owner, current, leader, 'Current owner leader');
      await grant(api, owner, other.team, owner);
      error(
        await call(api, 'post', entryCommandsPath(owner.orgId, other.entry.id), {
          cookie: owner.cookie,
          body: { type: 'APPROVE', expectedVersion: other.entry.version },
        }),
        403,
      );
    });

    test('request changes, resubmission and CLOSED guards preserve state and reason history', async () => {
      let current = await openRegistration(api, owner, 'Closed corrections', reviewer);
      const prepared = await submittedEntry(api, owner, current, leader, 'Correction team');
      let pending = prepared.entry;
      error(
        await call(api, 'put', `${entryPath(owner.orgId, pending.id)}/roster`, {
          cookie: leader.cookie,
          body: { expectedVersion: pending.version, players: [] },
        }),
        422,
      );
      for (const reason of [undefined, ' ', '理'.repeat(501)])
        error(
          await call(api, 'post', entryCommandsPath(owner.orgId, pending.id), {
            cookie: reviewer.cookie,
            body: { type: 'REQUEST_CHANGES', expectedVersion: pending.version, reason },
          }),
          422,
        );
      pending = await command(api, owner, pending, reviewer, 'APPROVE');
      error(
        await call(api, 'put', `${entryPath(owner.orgId, pending.id)}/roster`, {
          cookie: leader.cookie,
          body: { expectedVersion: pending.version, players: [] },
        }),
        422,
      );
      pending = await command(api, owner, pending, reviewer, 'REQUEST_CHANGES', '请更正球衣号码');
      const untouchedTeam = await team(api, owner, 'Closed untouched draft', otherLeader);
      let untouched = await entry(api, owner, current.event.id, untouchedTeam, otherLeader);
      untouched = await roster(
        api,
        owner,
        untouched,
        otherLeader,
        untouchedTeam.members.slice(0, 2),
      );
      current = await registrationCommand(
        api,
        owner,
        await registration(api, owner, current.event.id),
        'CLOSE_REGISTRATION',
      );
      const newTeam = await team(api, owner, 'Cannot enter closed', otherLeader);
      error(
        await call(api, 'post', entriesPath(owner.orgId, current.event.id), {
          cookie: otherLeader.cookie,
          body: { teamId: newTeam.id },
        }),
        404,
      );
      await grant(api, owner, newTeam, owner);
      error(
        await call(api, 'post', entriesPath(owner.orgId, current.event.id), {
          cookie: owner.cookie,
          body: { teamId: newTeam.id },
        }),
        422,
      );
      error(
        await call(api, 'post', entryCommandsPath(owner.orgId, untouched.id), {
          cookie: otherLeader.cookie,
          body: { type: 'SUBMIT', expectedVersion: untouched.version },
        }),
        422,
      );
      error(
        await call(api, 'put', `${entryPath(owner.orgId, untouched.id)}/roster`, {
          cookie: otherLeader.cookie,
          body: { expectedVersion: untouched.version, players: [] },
        }),
        422,
      );
      const beforeRevision = pending.rosterRevisionId;
      pending = await roster(api, owner, pending, leader, prepared.team.members.slice(0, 2), [
        '8',
        '9',
      ]);
      expect(pending.status).toBe('CHANGES_REQUESTED');
      expect(pending.rosterRevisionId).not.toBe(beforeRevision);
      expect(pending.latestReviewReason).toBe('请更正球衣号码');
      pending = await command(api, owner, pending, leader, 'SUBMIT');
      expect(pending).toMatchObject({ status: 'SUBMITTED', lastSubmittedBy: leader.id });
      pending = await command(api, owner, pending, reviewer, 'APPROVE');
      expect(pending.status).toBe('APPROVED');
      expect(pending.history.filter((item) => item.type === 'SUBMIT')).toHaveLength(2);
      expect(pending.history.find((item) => item.type === 'REQUEST_CHANGES')).toMatchObject({
        reason: '请更正球衣号码',
        actorId: reviewer.id,
        rosterRevisionId: beforeRevision,
      });
    });

    test('REJECTED and WITHDRAWN remain terminal and the unique entry cannot be recreated', async () => {
      const current = await openRegistration(api, owner, 'Terminal entries', reviewer);
      for (const terminal of ['REJECTED', 'WITHDRAWN'] as const) {
        const prepared = await submittedEntry(api, owner, current, leader, terminal);
        const closed = await command(
          api,
          owner,
          prepared.entry,
          terminal === 'REJECTED' ? reviewer : leader,
          terminal === 'REJECTED' ? 'REJECT' : 'WITHDRAW',
          terminal === 'REJECTED' ? '不符合报名要求' : undefined,
        );
        expect(closed.status).toBe(terminal);
        const duplicate = await call(api, 'post', entriesPath(owner.orgId, current.event.id), {
          cookie: leader.cookie,
          body: { teamId: prepared.team.id },
        });
        error(duplicate, 409);
        expect(duplicate.body.error.code).toBe('ENTRY_ALREADY_EXISTS');
        error(
          await call(api, 'put', `${entryPath(owner.orgId, closed.id)}/roster`, {
            cookie: leader.cookie,
            body: { expectedVersion: closed.version, players: [] },
          }),
          422,
        );
        error(
          await call(api, 'post', entryCommandsPath(owner.orgId, closed.id), {
            cookie: leader.cookie,
            body: { type: 'SUBMIT', expectedVersion: closed.version },
          }),
          422,
        );
        error(
          await call(api, 'post', entryCommandsPath(owner.orgId, closed.id), {
            cookie: reviewer.cookie,
            body: { type: 'APPROVE', expectedVersion: closed.version },
          }),
          422,
        );
        expect((await getEntry(api, owner, closed.id)).status).toBe(terminal);
      }
    });

    test('a revoked invitation issuer cannot authorize a later acceptance', async () => {
      const target = await team(api, owner, 'Issuer current authority');
      data(
        await call(api, 'put', `${membersPath(owner.orgId)}/${otherOwner.id}`, {
          cookie: owner.cookie,
          body: { role: 'ORG_ADMIN', status: 'ACTIVE' },
        }),
      );
      try {
        const issued = await invite(api, { ...otherOwner, orgId: owner.orgId }, target, leader);
        data(
          await call(api, 'put', `${membersPath(owner.orgId)}/${otherOwner.id}`, {
            cookie: owner.cookie,
            body: { role: 'ORG_ADMIN', status: 'DISABLED' },
          }),
        );
        error(
          await call(api, 'post', acceptPath(issued.invitation.id), {
            cookie: leader.cookie,
            body: { token: issued.token },
          }),
          422,
        );
        error(
          await call(api, 'get', teamPath(owner.orgId, target.id), { cookie: leader.cookie }),
          404,
        );
      } finally {
        data(
          await call(api, 'put', `${membersPath(owner.orgId)}/${otherOwner.id}`, {
            cookie: owner.cookie,
            body: { role: 'ORG_ADMIN', status: 'DISABLED' },
          }),
        );
      }
    });

    test('invitation acceptance retains the issuer membership lock until its team/grant transaction commits', async () => {
      const target = await team(api, owner, 'Issuer lock acceptance');
      data(
        await call(api, 'put', `${membersPath(owner.orgId)}/${otherOwner.id}`, {
          cookie: owner.cookie,
          body: { role: 'ORG_ADMIN', status: 'ACTIVE' },
        }),
      );
      const issued = await invite(api, { ...otherOwner, orgId: owner.orgId }, target, leader);
      let blocker: PoolClient | undefined;
      let accepting: ReturnType<typeof call> | undefined;
      let revoking: ReturnType<typeof call> | undefined;
      let released = false;
      try {
        blocker = await api.pool.connect();
        await blocker.query('BEGIN');
        const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;
        await blocker.query('SELECT id FROM teams WHERE org_id = $1 AND id = $2 FOR UPDATE', [
          owner.orgId,
          target.id,
        ]);
        accepting = call(api, 'post', acceptPath(issued.invitation.id), {
          cookie: leader.cookie,
          body: { token: issued.token },
        });
        const acceptingPid = await blockedPid(
          api.pool,
          pid,
          'Acceptance never waited for the externally locked team',
        );
        revoking = call(api, 'put', `${membersPath(owner.orgId)}/${otherOwner.id}`, {
          cookie: owner.cookie,
          body: { role: 'ORG_ADMIN', status: 'DISABLED' },
        });
        await blockedPid(
          api.pool,
          acceptingPid,
          'Issuer membership revocation did not wait for acceptance to finish',
        );
        await blocker.query('COMMIT');
        released = true;
        data(await accepting);
        data(await revoking);
        const read = data<SessionData>(
          await call(api, 'get', '/v1/auth/session', { cookie: leader.cookie }),
        );
        expect(read.teamContexts.map((item) => item.teamId)).toContain(target.id);
      } finally {
        if (blocker) {
          if (!released) await blocker.query('ROLLBACK');
          blocker.release();
        }
        await Promise.allSettled([accepting, revoking].filter((pending) => pending !== undefined));
        data(
          await call(api, 'put', `${membersPath(owner.orgId)}/${otherOwner.id}`, {
            cookie: owner.cookie,
            body: { role: 'ORG_ADMIN', status: 'DISABLED' },
          }),
        );
      }
    }, 30000);

    test('grant activation and review serialize on the team so a newly active leader cannot approve itself', async () => {
      const current = await openRegistration(api, owner, 'Grant-review race', reviewer);
      const prepared = await submittedEntry(api, owner, current, leader, 'Grant-review team');
      await grant(api, owner, prepared.team, reviewer, 'DISABLED');
      let blocker: PoolClient | undefined;
      let activating: ReturnType<typeof call> | undefined;
      let reviewing: ReturnType<typeof call> | undefined;
      let released = false;
      try {
        blocker = await api.pool.connect();
        await blocker.query('BEGIN');
        const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;
        await blocker.query(
          'SELECT user_id FROM team_access_grants WHERE org_id = $1 AND team_id = $2 AND user_id = $3 FOR UPDATE',
          [owner.orgId, prepared.team.id, reviewer.id],
        );
        activating = call(api, 'put', grantPath(owner.orgId, prepared.team.id, reviewer.id), {
          cookie: owner.cookie,
          body: { status: 'ACTIVE' },
        });
        const activationPid = await blockedPid(
          api.pool,
          pid,
          'Grant activation never waited for the externally locked grant row',
        );
        reviewing = call(api, 'post', entryCommandsPath(owner.orgId, prepared.entry.id), {
          cookie: reviewer.cookie,
          body: { type: 'APPROVE', expectedVersion: prepared.entry.version },
        });
        await blockedPid(
          api.pool,
          activationPid,
          'Review did not wait for grant activation to release its team lock',
        );
        await blocker.query('COMMIT');
        released = true;
        data(await activating);
        error(await reviewing, 403);
        const unchanged = await getEntry(api, owner, prepared.entry.id);
        expect(unchanged).toMatchObject({ status: 'SUBMITTED', version: prepared.entry.version });
        expect(unchanged.history.some((item) => item.type === 'APPROVE')).toBe(false);
      } finally {
        if (blocker) {
          if (!released) await blocker.query('ROLLBACK');
          blocker.release();
        }
        await Promise.allSettled(
          [activating, reviewing].filter((pending) => pending !== undefined),
        );
        await grant(api, owner, prepared.team, reviewer, 'DISABLED');
      }
    }, 30000);

    test('entry CAS permits one roster revision and one audit commit for simultaneous same-version saves', async () => {
      const target = await team(api, owner, 'Roster CAS', leader);
      const current = await openRegistration(api, owner, 'Roster CAS event');
      const draft = await entry(api, owner, current.event.id, target, leader);
      const before = await auditCount(api.pool, owner.orgId, draft.id);
      const responses = await Promise.all(
        ['7', '8'].map((jerseyNo) =>
          call(api, 'put', `${entryPath(owner.orgId, draft.id)}/roster`, {
            cookie: leader.cookie,
            body: {
              expectedVersion: draft.version,
              players: [{ memberId: target.members[0]!.id, jerseyNo }],
            },
          }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const saved = data<EntryData>(responses.find((response) => response.status === 200)!);
      expect(saved.version).toBe(draft.version + 1);
      expect(await auditCount(api.pool, owner.orgId, draft.id)).toBe(before + 1);
      const revisions = await api.pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM entry_roster_revisions WHERE org_id = $1 AND entry_id = $2',
        [owner.orgId, draft.id],
      );
      expect(revisions.rows[0]!.count).toBe(1);
      expect((await getEntry(api, owner, draft.id, leader)).rosterRevisionId).toBe(
        saved.rosterRevisionId,
      );
    });

    test('audit insertion failure atomically rolls back roster revision, entry version and immutable history', async () => {
      const target = await team(api, owner, 'Audit rollback roster', leader);
      const current = await openRegistration(api, owner, 'Audit rollback event');
      const draft = await entry(api, owner, current.event.id, target, leader);
      const before = await auditCount(api.pool, owner.orgId, draft.id);
      const identifier = `scb_test_p03_audit_${randomUUID().replaceAll('-', '')}`;
      for (const id of [owner.orgId, draft.id]) expect(id).toMatch(/^[0-9a-f-]{36}$/);
      await api.pool.query(
        `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.org_id::text = TG_ARGV[0] AND NEW.resource_id::text = TG_ARGV[1] THEN RAISE EXCEPTION 'p03 integration audit failure'; END IF; RETURN NEW; END $$`,
      );
      let saved: EntryData | undefined;
      try {
        await api.pool.query(
          `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}('${owner.orgId}', '${draft.id}')`,
        );
        const failed = await call(api, 'put', `${entryPath(owner.orgId, draft.id)}/roster`, {
          cookie: leader.cookie,
          body: {
            expectedVersion: draft.version,
            players: [{ memberId: target.members[0]!.id, jerseyNo: '1' }],
          },
        });
        error(failed, 500);
        expect(JSON.stringify(failed.body)).not.toMatch(
          /audit_logs|p03 integration|SQLSTATE|postgres/i,
        );
        expect(await getEntry(api, owner, draft.id, leader)).toMatchObject({
          version: draft.version,
          status: 'DRAFT',
          rosterRevisionId: null,
          players: [],
        });
        expect(await auditCount(api.pool, owner.orgId, draft.id)).toBe(before);
        const revisions = await api.pool.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM entry_roster_revisions WHERE org_id = $1 AND entry_id = $2',
          [owner.orgId, draft.id],
        );
        expect(revisions.rows[0]!.count).toBe(0);
        await api.pool.query(`DROP TRIGGER ${identifier} ON audit_logs`);
        saved = await roster(api, owner, draft, leader, target.members.slice(0, 2));
        await api.pool.query(
          `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}('${owner.orgId}', '${draft.id}')`,
        );
        const failedSubmit = await call(api, 'post', entryCommandsPath(owner.orgId, saved.id), {
          cookie: leader.cookie,
          body: { type: 'SUBMIT', expectedVersion: saved.version },
        });
        error(failedSubmit, 500);
        expect(await getEntry(api, owner, saved.id, leader)).toMatchObject({
          version: saved.version,
          status: 'DRAFT',
          lastSubmittedBy: null,
          rosterRevisionId: saved.rosterRevisionId,
          history: [],
        });
        expect(await auditCount(api.pool, owner.orgId, draft.id)).toBe(before + 1);
      } finally {
        await api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
        await api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
      }
      expect(saved!.version).toBe(draft.version + 1);
      expect((await command(api, owner, saved!, leader, 'SUBMIT')).status).toBe('SUBMITTED');
    });

    test('an in-flight roster save finishes before grant revocation, and every later old-cookie write fails', async () => {
      const current = await openRegistration(api, owner, 'Grant revoke race');
      const target = await team(api, owner, 'Grant revoke race team', leader);
      const draft = await entry(api, owner, current.event.id, target, leader);
      let blocker: PoolClient | undefined;
      let saving: ReturnType<typeof call> | undefined;
      let revoking: ReturnType<typeof call> | undefined;
      let released = false;
      try {
        blocker = await api.pool.connect();
        await blocker.query('BEGIN');
        const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;
        await blocker.query('SELECT id FROM entries WHERE org_id = $1 AND id = $2 FOR UPDATE', [
          owner.orgId,
          draft.id,
        ]);
        saving = call(api, 'put', `${entryPath(owner.orgId, draft.id)}/roster`, {
          cookie: leader.cookie,
          body: {
            expectedVersion: draft.version,
            players: [{ memberId: target.members[0]!.id, jerseyNo: '1' }],
          },
        });
        const savingPid = await blockedPid(
          api.pool,
          pid,
          'Roster save did not reach the external entry lock',
        );
        revoking = call(api, 'put', grantPath(owner.orgId, target.id, leader.id), {
          cookie: owner.cookie,
          body: { status: 'DISABLED' },
        });
        await blockedPid(
          api.pool,
          savingPid,
          'Grant revocation did not wait for the in-flight roster team lock',
        );
        await blocker.query('COMMIT');
        released = true;
        const saved = data<EntryData>(await saving);
        data(await revoking);
        expect(saved.version).toBe(draft.version + 1);
        error(
          await call(api, 'put', `${entryPath(owner.orgId, draft.id)}/roster`, {
            cookie: leader.cookie,
            body: { expectedVersion: saved.version, players: [] },
          }),
          404,
        );
        expect((await getEntry(api, owner, draft.id)).version).toBe(saved.version);
      } finally {
        if (blocker) {
          if (!released) await blocker.query('ROLLBACK');
          blocker.release();
        }
        await Promise.allSettled([saving, revoking].filter((pending) => pending !== undefined));
      }
    }, 30000);

    test('submit, review and freeze serialize on the event and never freeze a pending submission', async () => {
      let current = await openRegistration(api, owner, 'Submit review freeze race', reviewer);
      const approved: EntryData[] = [];
      for (let index = 0; index < 2; index++) {
        const prepared = await submittedEntry(
          api,
          owner,
          current,
          leader,
          `Approved race ${index}`,
        );
        approved.push(await command(api, owner, prepared.entry, reviewer, 'APPROVE'));
      }
      const correction = await submittedEntry(api, owner, current, leader, 'Correction race');
      let pending = await command(
        api,
        owner,
        correction.entry,
        reviewer,
        'REQUEST_CHANGES',
        '请补正',
      );
      current = await registrationCommand(
        api,
        owner,
        await registration(api, owner, current.event.id),
        'CLOSE_REGISTRATION',
      );
      let blocker: PoolClient | undefined;
      let submitting: ReturnType<typeof call> | undefined;
      let freezing: ReturnType<typeof call> | undefined;
      let released = false;
      try {
        blocker = await api.pool.connect();
        await blocker.query('BEGIN');
        const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;
        await blocker.query('SELECT id FROM events WHERE org_id = $1 AND id = $2 FOR UPDATE', [
          owner.orgId,
          current.event.id,
        ]);
        submitting = call(api, 'post', entryCommandsPath(owner.orgId, pending.id), {
          cookie: leader.cookie,
          body: { type: 'SUBMIT', expectedVersion: pending.version },
        });
        const submittingPid = await blockedPid(
          api.pool,
          pid,
          'Submission did not wait for the externally locked event',
        );
        freezing = call(api, 'post', registrationCommandsPath(owner.orgId, current.event.id), {
          cookie: owner.cookie,
          body: { type: 'FREEZE_REGISTRATION', expectedVersion: current.event.version },
        });
        await blockedPid(
          api.pool,
          submittingPid,
          'Freeze did not queue behind the pending submission event lock',
        );
        await blocker.query('COMMIT');
        released = true;
        pending = data<EntryData>(await submitting);
        error(await freezing, 422);
        expect(pending.status).toBe('SUBMITTED');
        expect((await registration(api, owner, current.event.id)).freeze).toBeNull();
      } finally {
        if (blocker) {
          if (!released) await blocker.query('ROLLBACK');
          blocker.release();
        }
        await Promise.allSettled([submitting, freezing].filter((request) => request !== undefined));
      }
      let reviewing: ReturnType<typeof call> | undefined;
      freezing = undefined;
      blocker = undefined;
      released = false;
      try {
        blocker = await api.pool.connect();
        await blocker.query('BEGIN');
        const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;
        await blocker.query('SELECT id FROM entries WHERE org_id = $1 AND id = $2 FOR UPDATE', [
          owner.orgId,
          pending.id,
        ]);
        reviewing = call(api, 'post', entryCommandsPath(owner.orgId, pending.id), {
          cookie: reviewer.cookie,
          body: { type: 'APPROVE', expectedVersion: pending.version },
        });
        const reviewingPid = await blockedPid(
          api.pool,
          pid,
          'Approval did not wait for the externally locked entry',
        );
        freezing = call(api, 'post', registrationCommandsPath(owner.orgId, current.event.id), {
          cookie: owner.cookie,
          body: { type: 'FREEZE_REGISTRATION', expectedVersion: current.event.version },
        });
        await blockedPid(
          api.pool,
          reviewingPid,
          'Freeze did not wait for approval to release its event lock',
        );
        await blocker.query('COMMIT');
        released = true;
        pending = data<EntryData>(await reviewing);
        const frozen = data<EventRegistrationData>(await freezing);
        expect(frozen.freeze!.entries.map((item) => item.entryId).sort()).toEqual(
          [...approved.map((item) => item.id), pending.id].sort(),
        );
        expect(frozen.counts.SUBMITTED).toBe(0);
        expect(frozen.counts.CHANGES_REQUESTED).toBe(0);
        expect(frozen.event.status).toBe('REGISTRATION_CLOSED');
      } finally {
        if (blocker) {
          if (!released) await blocker.query('ROLLBACK');
          blocker.release();
        }
        await Promise.allSettled([reviewing, freezing].filter((request) => request !== undefined));
      }
    }, 60000);

    test('pagination filters authorization before slicing and binds team, entry and invitation cursors to their context', async () => {
      const prefix = `p03-page-${randomUUID().slice(0, 8)}`;
      const firstTeam = await team(api, owner, `${prefix}-first`, leader);
      const hiddenTeam = await team(api, owner, `${prefix}-hidden`, otherLeader);
      const lastTeam = await team(api, owner, `${prefix}-last`, leader);
      const baseline = await call(api, 'get', `${teamsPath(owner.orgId)}?q=${prefix}&limit=1`, {
        cookie: leader.cookie,
      });
      data(baseline);
      expect(baseline.body.meta.capabilities).toEqual({ canCreateTeam: false });
      const visible = await allPages<TeamData>(
        api,
        `${teamsPath(owner.orgId)}?q=${prefix}&limit=1`,
        leader,
      );
      expect(visible.items.map((item) => item.id).sort()).toEqual(
        [firstTeam.id, lastTeam.id].sort(),
      );
      expect(new Set(visible.items.map((item) => item.id)).size).toBe(2);
      expect(visible.firstCursor).toEqual(expect.any(String));
      error(
        await call(
          api,
          'get',
          `${teamsPath(owner.orgId)}?q=another&limit=1&cursor=${visible.firstCursor}`,
          { cookie: leader.cookie },
        ),
        422,
      );
      error(
        await call(
          api,
          'get',
          `${teamsPath(owner.orgId)}?q=${prefix}&limit=1&cursor=${visible.firstCursor}`,
          { cookie: otherLeader.cookie },
        ),
        422,
      );
      const issued = [];
      for (let index = 0; index < 3; index++)
        issued.push(await invite(api, owner, firstTeam, leader));
      const invitationPages = await allPages<InvitationData>(
        api,
        `${invitationsPath(owner.orgId, firstTeam.id)}?limit=1`,
        owner,
      );
      expect(invitationPages.items.map((item) => item.id).sort()).toEqual(
        issued.map((item) => item.invitation.id).sort(),
      );
      expect(JSON.stringify(invitationPages.items)).not.toMatch(/token|hash/i);
      error(
        await call(
          api,
          'get',
          `${invitationsPath(owner.orgId, lastTeam.id)}?limit=1&cursor=${invitationPages.firstCursor}`,
          { cookie: owner.cookie },
        ),
        422,
      );
      const current = await openRegistration(api, owner, 'Paged entries');
      const ownEntries = [
        await entry(api, owner, current.event.id, firstTeam, leader),
        await entry(api, owner, current.event.id, lastTeam, leader),
      ];
      const hiddenEntry = await entry(api, owner, current.event.id, hiddenTeam, otherLeader);
      const entryPages = await allPages<EntryData>(
        api,
        `${entriesPath(owner.orgId, current.event.id)}?limit=1`,
        leader,
      );
      expect(entryPages.items.map((item) => item.id).sort()).toEqual(
        ownEntries.map((item) => item.id).sort(),
      );
      expect(entryPages.items.some((item) => item.id === hiddenEntry.id)).toBe(false);
      error(
        await call(
          api,
          'get',
          `${entriesPath(owner.orgId, current.event.id)}?limit=1&status=SUBMITTED&cursor=${entryPages.firstCursor}`,
          { cookie: leader.cookie },
        ),
        422,
      );
      error(
        await call(
          api,
          'get',
          `${entriesPath(owner.orgId, current.event.id)}?limit=1&cursor=${entryPages.firstCursor}`,
          { cookie: otherLeader.cookie },
        ),
        422,
      );
      error(
        await call(
          api,
          'get',
          `${entriesPath(owner.orgId, current.event.id)}?teamId=${hiddenTeam.id}`,
          { cookie: leader.cookie },
        ),
        404,
      );
      const allVisibleEvents = data<TeamRegistrationEventData[]>(
        await call(
          api,
          'get',
          `${teamPath(owner.orgId, firstTeam.id)}/registration-events?limit=100`,
          { cookie: leader.cookie },
        ),
      );
      const eventPages = await allPages<TeamRegistrationEventData>(
        api,
        `${teamPath(owner.orgId, firstTeam.id)}/registration-events?limit=2`,
        leader,
      );
      expect(eventPages.items.map((item) => item.event.id)).toEqual(
        allVisibleEvents.map((item) => item.event.id),
      );
      expect(new Set(eventPages.items.map((item) => item.event.id)).size).toBe(
        eventPages.items.length,
      );
      expect(eventPages.firstCursor).toEqual(expect.any(String));
      error(
        await call(
          api,
          'get',
          `${teamPath(owner.orgId, lastTeam.id)}/registration-events?limit=2&cursor=${eventPages.firstCursor}`,
          { cookie: leader.cookie },
        ),
        422,
      );
      for (const query of ['limit=0', 'limit=101', 'unexpected=true', 'cursor=not_a_cursor'])
        error(
          await call(api, 'get', `${teamsPath(owner.orgId)}?${query}`, { cookie: owner.cookie }),
          422,
        );
    }, 30000);

    test('event management depends on the actual assignment while a REVIEWER cannot change rules or registration state', async () => {
      const scoped = await createEvent(api, owner, 'Assigned manager rules');
      data(
        await call(api, 'put', staffPath(owner.orgId, scoped.id, reviewer.id), {
          cookie: owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
        }),
      );
      let current = data<EventRegistrationData>(
        await call(api, 'put', rulesPath(owner.orgId, scoped.id), {
          cookie: reviewer.cookie,
          body: rules(scoped.version),
        }),
      );
      current = data<EventRegistrationData>(
        await call(api, 'post', registrationCommandsPath(owner.orgId, scoped.id), {
          cookie: reviewer.cookie,
          body: { type: 'OPEN_REGISTRATION', expectedVersion: current.event.version },
        }),
      );
      expect(current.event.status).toBe('REGISTRATION_OPEN');
      const readOnly = await createEvent(api, owner, 'Assigned reviewer rules');
      data(
        await call(api, 'put', staffPath(owner.orgId, readOnly.id, reviewer.id), {
          cookie: owner.cookie,
          body: { role: 'REVIEWER', status: 'ACTIVE' },
        }),
      );
      const read = data<EventRegistrationData>(
        await call(api, 'get', registrationPath(owner.orgId, readOnly.id), {
          cookie: reviewer.cookie,
        }),
      );
      expect(read.capabilities.canManageRules).toBe(false);
      error(
        await call(api, 'put', rulesPath(owner.orgId, readOnly.id), {
          cookie: reviewer.cookie,
          body: rules(readOnly.version),
        }),
        403,
      );
      error(
        await call(api, 'post', registrationCommandsPath(owner.orgId, readOnly.id), {
          cookie: reviewer.cookie,
          body: { type: 'OPEN_REGISTRATION', expectedVersion: readOnly.version },
        }),
        403,
      );
      const unassigned = await createEvent(api, owner, 'Unassigned reviewer hidden');
      error(
        await call(api, 'get', registrationPath(owner.orgId, unassigned.id), {
          cookie: reviewer.cookie,
        }),
        404,
      );
    });

    test('freeze generates its own approved snapshot, excludes terminal/draft entries and blocks all registration writes', async () => {
      let empty = await openRegistration(api, owner, 'Insufficient approval freeze');
      empty = await registrationCommand(api, owner, empty, 'CLOSE_REGISTRATION');
      error(
        await call(api, 'post', registrationCommandsPath(owner.orgId, empty.event.id), {
          cookie: owner.cookie,
          body: { type: 'FREEZE_REGISTRATION', expectedVersion: empty.event.version },
        }),
        422,
      );
      let current = await openRegistration(api, owner, 'Final freeze', reviewer);
      const approved: { team: TeamData; entry: EntryData }[] = [];
      for (let index = 0; index < 2; index++) {
        const prepared = await submittedEntry(
          api,
          owner,
          current,
          leader,
          `Frozen approved ${index}`,
        );
        approved.push({
          team: prepared.team,
          entry: await command(api, owner, prepared.entry, reviewer, 'APPROVE'),
        });
      }
      const draftTeam = await team(api, owner, 'Frozen excluded draft', leader);
      const excludedDraft = await entry(api, owner, current.event.id, draftTeam, leader);
      for (const type of ['REJECT', 'WITHDRAW']) {
        const prepared = await submittedEntry(
          api,
          owner,
          current,
          leader,
          `Frozen excluded ${type}`,
        );
        await command(
          api,
          owner,
          prepared.entry,
          type === 'REJECT' ? reviewer : leader,
          type,
          type === 'REJECT' ? '排除不合格报名' : undefined,
        );
      }
      current = await registrationCommand(
        api,
        owner,
        await registration(api, owner, current.event.id),
        'CLOSE_REGISTRATION',
      );
      error(
        await call(api, 'post', registrationCommandsPath(owner.orgId, current.event.id), {
          cookie: owner.cookie,
          body: {
            type: 'FREEZE_REGISTRATION',
            expectedVersion: current.event.version,
            entries: [],
          },
        }),
        422,
      );
      const before = current.event.version;
      current = await registrationCommand(api, owner, current, 'FREEZE_REGISTRATION');
      const snapshot = structuredClone(current.freeze!);
      expect(current.event).toMatchObject({ status: 'REGISTRATION_CLOSED', version: before + 1 });
      expect(snapshot).toMatchObject({
        eventId: current.event.id,
        rulesetId: current.rules!.id,
        rulesetVersion: current.rules!.version,
        eventVersion: current.event.version,
        excludedCounts: { DRAFT: 1, REJECTED: 1, WITHDRAWN: 1 },
      });
      expect(snapshot.entries.map((item) => item.entryId).sort()).toEqual(
        approved.map((item) => item.entry.id).sort(),
      );
      for (const accepted of approved) {
        expect(snapshot.entries.find((item) => item.entryId === accepted.entry.id)).toMatchObject({
          teamName: accepted.entry.teamName,
          rosterRevisionId: accepted.entry.rosterRevisionId,
          players: accepted.entry.players,
        });
      }
      const frozenEntry = approved[0]!.entry;
      const attempts = [
        call(api, 'put', rulesPath(owner.orgId, current.event.id), {
          cookie: owner.cookie,
          body: rules(current.event.version),
        }),
        call(api, 'post', registrationCommandsPath(owner.orgId, current.event.id), {
          cookie: owner.cookie,
          body: { type: 'FREEZE_REGISTRATION', expectedVersion: current.event.version },
        }),
        call(api, 'post', entriesPath(owner.orgId, current.event.id), {
          cookie: leader.cookie,
          body: { teamId: approved[0]!.team.id },
        }),
        call(api, 'put', `${entryPath(owner.orgId, frozenEntry.id)}/roster`, {
          cookie: leader.cookie,
          body: { expectedVersion: frozenEntry.version, players: [] },
        }),
        call(api, 'post', entryCommandsPath(owner.orgId, frozenEntry.id), {
          cookie: leader.cookie,
          body: { type: 'WITHDRAW', expectedVersion: frozenEntry.version },
        }),
        call(api, 'post', entryCommandsPath(owner.orgId, frozenEntry.id), {
          cookie: reviewer.cookie,
          body: {
            type: 'REQUEST_CHANGES',
            expectedVersion: frozenEntry.version,
            reason: '冻结后不能退回',
          },
        }),
        call(api, 'put', `${entryPath(owner.orgId, excludedDraft.id)}/roster`, {
          cookie: leader.cookie,
          body: { expectedVersion: excludedDraft.version, players: [] },
        }),
        call(api, 'post', entryCommandsPath(owner.orgId, excludedDraft.id), {
          cookie: leader.cookie,
          body: { type: 'SUBMIT', expectedVersion: excludedDraft.version },
        }),
      ];
      for (const failed of await Promise.all(attempts)) {
        error(failed, 422);
        expect(failed.body.error.code).toBe('REGISTRATION_FROZEN');
      }
      const target = approved[0]!.team;
      const changed = data<TeamData>(
        await call(api, 'patch', teamPath(owner.orgId, target.id), {
          cookie: leader.cookie,
          body: { name: '冻结后长期队名更新', expectedVersion: target.version },
        }),
      );
      data(
        await call(api, 'put', `${teamPath(owner.orgId, target.id)}/members`, {
          cookie: leader.cookie,
          body: { expectedVersion: changed.version, members: [{ name: '冻结后新球员' }] },
        }),
      );
      expect((await registration(api, owner, current.event.id)).freeze).toEqual(snapshot);
      expect((await getEntry(api, owner, frozenEntry.id, leader)).players).toEqual(
        frozenEntry.players,
      );
      const nextInstance = await anotherApi();
      const persisted = data<EventRegistrationData>(
        await call(nextInstance, 'get', registrationPath(owner.orgId, current.event.id), {
          cookie: owner.cookie,
        }),
      );
      expect(persisted.freeze).toEqual(snapshot);
      const session = data<SessionData>(
        await call(nextInstance, 'get', '/v1/auth/session', { cookie: leader.cookie }),
      );
      expect(session.teamContexts.some((context) => context.teamId === target.id)).toBe(true);
    }, 60000);
  },
);
