import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  BookingOrderData,
  BookingPlayerData,
  BookingWorkspaceData,
  MatchPlayerRoster,
  PlayerPerformanceCommandInput,
  PlayerPerformanceData,
  PlayerPerformanceLinkData,
  PlayerPerformanceNominateInput,
  PlayerPerformanceSourcesData,
  PlayerPerformanceWorkspaceData,
  ScoringControl,
} from '@small-city-basketball/contracts';
import { hashPassword } from '../src/security.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { call, data, error, login, PASSWORD, RUN_ID, staffPath } from './support.js';
import type { User } from './support.js';
import {
  acquire,
  act,
  assign,
  closeHarness,
  createScoringHarness,
  finish,
  published,
  start,
  workbench,
} from './p05-support.js';
import type { Harness, PublishedFixture } from './p05-support.js';
import { confirmMatch } from './p05b-support.js';

const root = '/v1/player-bookings';
const performance = `${root}/performance`;
const why = '合成球员数据公开授权核验';
const publicPath = (profileId: string) => `${root}/players/${profileId}/performance`;
const sourcePath = (orgId: string, eventId: string) =>
  `${performance}/sources?orgId=${orgId}&eventId=${eventId}`;

interface Provider {
  actor: User;
  profile: BookingPlayerData;
}
interface PersonalFixture {
  fixture: PublishedFixture;
  matchId: string;
  roster: MatchPlayerRoster;
  lease: ScoringControl;
  teamId: string;
  memberId: string;
}

describe(
  'C07 authorized player records over real isolated PostgreSQL and HTTP',
  { concurrent: false },
  () => {
    let h: Harness;
    let operator: User;
    let stranger: User;
    let passwordHash: string;
    let serial = 0;

    async function actor(label: string): Promise<User> {
      const value: User = {
        id: randomUUID(),
        orgId: '',
        email: `c07-${label}-${RUN_ID}-${++serial}@example.test`,
        cookie: '',
      };
      await h.api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [value.id, value.email, `合成数据${label}`, passwordHash],
      );
      value.cookie = await login(h.api, value);
      return value;
    }

    async function provider(label: string, approve = true): Promise<Provider> {
      const owner = await actor(label);
      const now = Date.now();
      let profile = data<BookingPlayerData>(
        await call(h.api, 'put', `${root}/profile`, {
          cookie: owner.cookie,
          body: {
            commandId: randomUUID(),
            expectedVersion: 0,
            displayName: `合成球员${label}`,
            position: 'PG',
            heightCm: 182,
            city: '合成高州',
            bio: '仅用于隔离数据授权测试',
            priceFen: 30000,
            travelFen: 0,
            accommodationFen: 0,
            adultConfirmed: true,
            availability: [
              {
                startAt: new Date(now - 3600000).toISOString(),
                endAt: new Date(now + 10 * 86400000).toISOString(),
              },
            ],
          },
        }),
      );
      if (approve)
        profile = data<BookingPlayerData>(
          await call(h.api, 'post', `${root}/profiles/${profile.id}/review`, {
            cookie: operator.cookie,
            body: {
              commandId: randomUUID(),
              expectedVersion: profile.version,
              status: 'APPROVED',
              reason: why,
            },
          }),
        );
      return { actor: owner, profile };
    }

    async function read(profileId: string, cookie?: string) {
      return data<PlayerPerformanceData>(
        await call(h.api, 'get', publicPath(profileId), { cookie }),
      );
    }

    async function workspace(user: User) {
      return data<PlayerPerformanceWorkspaceData>(
        await call(h.api, 'get', `${performance}/workspace`, { cookie: user.cookie }),
      );
    }

    async function personalFixture(
      points = 2,
      foul = 1,
      unassigned = false,
    ): Promise<PersonalFixture> {
      const fixture = await published(h, h.teams.slice(0, 2));
      const matchId = fixture.matches[0]!.id;
      await assign(h, matchId, h.otherOwner);
      const before = await workbench(h, matchId);
      await act(h, matchId, h.owner, {
        type: 'PREPARE_MATCH',
        payload: { expectedEventVersion: before.event.version, collectionMode: 'PLAYER_BASIC' },
      });
      const lease = await acquire(h, matchId);
      await start(h, matchId, h.otherOwner, lease);
      if (points)
        await act(
          h,
          matchId,
          h.otherOwner,
          {
            type: 'RECORD_STAT',
            payload: {
              kind: 'SCORE',
              side: 'HOME',
              value: points,
              memberId: before.playerRoster.home[0]!.memberId,
            },
          },
          lease,
        );
      if (foul)
        await act(
          h,
          matchId,
          h.otherOwner,
          {
            type: 'RECORD_STAT',
            payload: {
              kind: 'FOUL',
              side: 'HOME',
              value: foul,
              memberId: before.playerRoster.home[0]!.memberId,
            },
          },
          lease,
        );
      if (unassigned)
        await act(
          h,
          matchId,
          h.otherOwner,
          {
            type: 'RECORD_STAT',
            payload: { kind: 'SCORE', side: 'HOME', value: 1 },
          },
          lease,
        );
      if (unassigned)
        await act(
          h,
          matchId,
          h.otherOwner,
          { type: 'RECORD_STAT', payload: { kind: 'FOUL', side: 'HOME', value: 1 } },
          lease,
        );
      await finish(h, matchId, h.otherOwner, lease);
      await act(h, matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      return {
        fixture,
        matchId,
        roster: before.playerRoster,
        lease,
        teamId: before.match.home.teamId,
        memberId: before.playerRoster.home[0]!.memberId,
      };
    }

    async function nominate(
      target: Provider,
      source: PersonalFixture,
      publisher = h.owner,
      overrides: Partial<PlayerPerformanceNominateInput> = {},
    ) {
      const body: PlayerPerformanceNominateInput = {
        commandId: randomUUID(),
        profileId: target.profile.id,
        orgId: h.owner.orgId,
        eventId: source.fixture.event.event.id,
        teamId: source.teamId,
        memberId: source.memberId,
        reason: why,
        publisherConsent: true,
        ...overrides,
      };
      return call(h.api, 'post', `${performance}/links`, { cookie: publisher.cookie, body });
    }

    async function linkCommand(
      link: PlayerPerformanceLinkData,
      user: User,
      type: PlayerPerformanceCommandInput['type'],
      overrides: Partial<PlayerPerformanceCommandInput> = {},
    ) {
      return call(h.api, 'post', `${performance}/links/${link.id}/commands`, {
        cookie: user.cookie,
        body: {
          commandId: randomUUID(),
          expectedVersion: link.version,
          type,
          reason: why,
          ...(type === 'CONSENT' ? { playerConsent: true } : {}),
          ...overrides,
        },
      });
    }

    async function approved(target: Provider, source: PersonalFixture, publisher = h.owner) {
      const pending = data<PlayerPerformanceLinkData>(await nominate(target, source, publisher));
      return data<PlayerPerformanceLinkData>(await linkCommand(pending, target.actor, 'CONSENT'));
    }

    beforeAll(async () => {
      h = await createScoringHarness(3);
      passwordHash = await hashPassword(PASSWORD);
      operator = await actor('operator');
      stranger = await actor('stranger');
      await maintainPlatformOperator(h.api.pool, {
        email: operator.email,
        status: 'ACTIVE',
        reason: why,
      });
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    test('public performance needs an approved profile, while source/workspace writes retain session and Origin guards', async () => {
      const pending = await provider('pending', false);
      error(await call(h.api, 'get', publicPath(pending.profile.id)), 404);
      error(await call(h.api, 'get', publicPath(randomUUID())), 404);
      error(await call(h.api, 'get', `${performance}/workspace`), 401);
      error(
        await call(h.api, 'post', `${performance}/links`, {
          cookie: h.owner.cookie,
          origin: null,
          body: {},
        }),
        403,
      );
      const target = await provider('empty');
      const empty = await read(target.profile.id);
      expect(empty).toMatchObject({
        dataStatus: 'NO_AUTHORIZED_SOURCE',
        sourceCount: 0,
        recordedMatchCount: 0,
        totalPoints: null,
        pointsPerRecordedMatch: null,
      });
    });

    test('only current organization administration or actual event data managers can read nominatable roster sources', async () => {
      const source = await personalFixture();
      const path = sourcePath(h.owner.orgId, source.fixture.event.event.id);
      const allowed = data<PlayerPerformanceSourcesData>(
        await call(h.api, 'get', path, { cookie: h.owner.cookie }),
      );
      expect(allowed.teams.flatMap((t) => t.members.map((m) => m.id))).toContain(source.memberId);
      for (const denied of [h.leader, h.otherOwner, operator, stranger]) {
        error(await call(h.api, 'get', path, { cookie: denied.cookie }), 404);
      }
      data(
        await call(
          h.api,
          'put',
          staffPath(h.owner.orgId, source.fixture.event.event.id, h.otherOwner.id),
          {
            cookie: h.owner.cookie,
            body: { role: 'SCORER', status: 'ACTIVE' },
          },
        ),
      );
      error(await call(h.api, 'get', path, { cookie: h.otherOwner.cookie }), 404);
      data(
        await call(
          h.api,
          'put',
          staffPath(h.owner.orgId, source.fixture.event.event.id, h.otherOwner.id),
          {
            cookie: h.owner.cookie,
            body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
          },
        ),
      );
      expect(
        data<PlayerPerformanceSourcesData>(
          await call(h.api, 'get', path, { cookie: h.otherOwner.cookie }),
        ).event.id,
      ).toBe(source.fixture.event.event.id);
    });

    test('a unilateral nomination remains private, and only the target player can explicitly consent', async () => {
      const source = await personalFixture();
      const target = await provider('two-sided');
      error(await nominate(target, source, h.owner, { publisherConsent: undefined }), 422);
      const pending = data<PlayerPerformanceLinkData>(await nominate(target, source));
      expect(pending).toMatchObject({
        profileId: target.profile.id,
        status: 'PENDING',
        consentedAt: null,
      });
      expect(await read(target.profile.id)).toMatchObject({
        sourceCount: 0,
        recordedMatchCount: 0,
        totalPoints: null,
      });
      expect((await workspace(target.actor)).links.map((v) => v.id)).toContain(pending.id);
      expect((await workspace(stranger)).links.map((v) => v.id)).not.toContain(pending.id);
      error(await linkCommand(pending, h.owner, 'CONSENT'), 403);
      for (const denied of [operator, stranger])
        error(await linkCommand(pending, denied, 'CONSENT'), 404);
      error(await linkCommand(pending, target.actor, 'CONSENT', { playerConsent: undefined }), 422);
      const consented = data<PlayerPerformanceLinkData>(
        await linkCommand(pending, target.actor, 'CONSENT'),
      );
      expect(consented).toMatchObject({ status: 'APPROVED', consentedAt: expect.any(String) });
      expect(await read(target.profile.id)).toMatchObject({
        sourceCount: 1,
        recordedMatchCount: 1,
        totalPoints: 2,
      });
    });

    test('platform status cannot nominate or publish another organization private player records', async () => {
      const source = await personalFixture();
      const target = await provider('operator-no-org');
      error(await nominate(target, source, operator), 404);
      error(await nominate(target, source, h.otherOwner), 404);
      expect(await read(target.profile.id)).toMatchObject({ sourceCount: 0, totalPoints: null });
    });

    test('a valid member ID must belong to the selected team/event fixed roster and nomination never mutates that roster', async () => {
      const source = await personalFixture();
      const target = await provider('binding-check');
      error(await nominate(target, source, h.owner, { memberId: randomUUID() }), 404);
      const wrongTeam = h.teams.find((value) => value.id !== source.teamId)!;
      error(await nominate(target, source, h.owner, { teamId: wrongTeam.id }), 404);
      error(await nominate(target, source, h.owner, { orgId: h.otherOwner.orgId }), 404);
      const before = (await workbench(h, source.matchId)).playerRoster;
      await approved(target, source);
      expect((await workbench(h, source.matchId)).playerRoster).toEqual(before);
    });

    test('actual current independent confirmations expose only the nominated member totals, preserving attribution completeness', async () => {
      const source = await personalFixture(2, 1, true);
      const target = await provider('finite-record');
      await approved(target, source);
      const value = await read(target.profile.id);
      expect(value).toMatchObject({
        dataStatus: 'PARTIAL',
        sourceCount: 1,
        recordedMatchCount: 1,
        confirmedMatchCount: 1,
        partialAttributionMatchCount: 1,
        totalPoints: 2,
        totalFouls: 1,
        pointsPerRecordedMatch: 2,
        foulsPerRecordedMatch: 1,
        rebounds: null,
        assists: null,
        minutes: null,
        fieldGoalPercentage: null,
        sampleLimit: 1000,
        truncated: false,
      });
      expect(value.recentRecords).toHaveLength(1);
      expect(value.recentRecords[0]).toMatchObject({
        points: 2,
        fouls: 1,
        collectionMode: 'PLAYER_BASIC',
        attributionComplete: false,
        source: 'INDEPENDENT_CONFIRMATION',
      });
      expect(value.denominatorNotice).toEqual(expect.any(String));
      expect(value.completenessNotice).toEqual(expect.any(String));
      expect(value.completenessNotice).toMatch(/未归属|个人归属不完整/);
      const keys = Object.keys(value).sort();
      expect(keys).toEqual(
        [
          'profileId',
          'dataStatus',
          'sourceCount',
          'recordedMatchCount',
          'confirmedMatchCount',
          'teamOnlyMatchCount',
          'pendingMatchCount',
          'invalidMatchCount',
          'partialAttributionMatchCount',
          'totalPoints',
          'totalFouls',
          'pointsPerRecordedMatch',
          'foulsPerRecordedMatch',
          'rebounds',
          'assists',
          'minutes',
          'fieldGoalPercentage',
          'completedServiceCount',
          'sampleLimit',
          'truncated',
          'recentRecords',
          'denominatorNotice',
          'completenessNotice',
          'asOf',
        ].sort(),
      );
      expect(Object.keys(value.recentRecords[0]!).sort()).toEqual(
        [
          'recordKey',
          'eventName',
          'date',
          'format',
          'collectionMode',
          'attributionComplete',
          'points',
          'fouls',
          'source',
        ].sort(),
      );
      const text = JSON.stringify(value);
      for (const forbiddenValue of [
        h.owner.email,
        h.owner.cookie,
        target.actor.email,
        source.memberId,
        source.matchId,
        source.fixture.event.event.id,
        h.owner.orgId,
      ])
        expect(text).not.toContain(forbiddenValue);
      error(
        await call(
          h.api,
          'get',
          `/v1/orgs/${h.owner.orgId}/events/${source.fixture.event.event.id}/player-statistics`,
          { cookie: target.actor.cookie },
        ),
        404,
      );
      expect(await read(target.profile.id, stranger.cookie)).toMatchObject({
        totalPoints: 2,
        recordedMatchCount: 1,
      });
    });

    test('a collected PLAYER_BASIC zero is a recorded zero, while uncollected TEAM_ONLY metrics remain null', async () => {
      const zeroSource = await personalFixture(0, 0);
      const zero = await provider('true-zero');
      await approved(zero, zeroSource);
      expect(await read(zero.profile.id)).toMatchObject({
        recordedMatchCount: 1,
        totalPoints: 0,
        totalFouls: 0,
        pointsPerRecordedMatch: 0,
        foulsPerRecordedMatch: 0,
      });
      const fixture = await published(h, h.teams.slice(0, 2));
      const teamOnly = await confirmMatch(h, fixture, 0, 3, 1);
      const before = await workbench(h, teamOnly.matchId);
      const target = await provider('team-only');
      const source: PersonalFixture = {
        fixture,
        matchId: teamOnly.matchId,
        lease: teamOnly.lease,
        roster: before.playerRoster,
        teamId: before.match.home.teamId,
        memberId: before.playerRoster.home[0]!.memberId,
      };
      await approved(target, source);
      const value = await read(target.profile.id);
      expect(value).toMatchObject({
        recordedMatchCount: 0,
        confirmedMatchCount: 1,
        teamOnlyMatchCount: 1,
        totalPoints: null,
        totalFouls: null,
        pointsPerRecordedMatch: null,
        foulsPerRecordedMatch: null,
      });
      expect(value.recentRecords[0]).toMatchObject({
        collectionMode: 'TEAM_ONLY',
        points: null,
        fouls: null,
      });
    });

    test('reopening immediately removes the old record and independent reconfirmation counts only the new current snapshot', async () => {
      const source = await personalFixture(2, 0);
      const target = await provider('reconfirmation');
      await approved(target, source);
      expect(await read(target.profile.id)).toMatchObject({
        recordedMatchCount: 1,
        totalPoints: 2,
      });
      await act(h, source.matchId, h.owner, { type: 'REOPEN_RESULT', payload: { reason: why } });
      expect(await read(target.profile.id)).toMatchObject({
        recordedMatchCount: 0,
        pendingMatchCount: 1,
        totalPoints: null,
        pointsPerRecordedMatch: null,
      });
      await act(
        h,
        source.matchId,
        h.otherOwner,
        {
          type: 'ADD_CORRECTION',
          payload: {
            kind: 'SCORE',
            side: 'HOME',
            value: 1,
            period: 1,
            reason: why,
            memberId: source.memberId,
          },
        },
        source.lease,
      );
      await act(h, source.matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      const current = await read(target.profile.id);
      expect(current).toMatchObject({
        recordedMatchCount: 1,
        totalPoints: 3,
        pointsPerRecordedMatch: 3,
      });
      expect(current.recentRecords).toHaveLength(1);
      expect(current.recentRecords[0]?.points).toBe(3);
    });

    test('a damaged current personal state is counted as invalid and never falls back to an old confirmed record', async () => {
      const source = await personalFixture();
      const target = await provider('invalid-state');
      await approved(target, source);
      const original = (
        await h.api.pool.query(
          'SELECT player_stats FROM scoring_states WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, source.matchId],
        )
      ).rows[0]!.player_stats;
      const changed = structuredClone(original);
      changed.home.players[0].name = '合成损坏且不得公开的姓名';
      try {
        await h.api.pool.query(
          'UPDATE scoring_states SET player_stats=$3::jsonb WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, source.matchId, JSON.stringify(changed)],
        );
        const invalid = await read(target.profile.id);
        expect(invalid).toMatchObject({
          dataStatus: 'PARTIAL',
          sourceCount: 1,
          invalidMatchCount: 1,
          recordedMatchCount: 0,
          totalPoints: null,
          pointsPerRecordedMatch: null,
          recentRecords: [],
        });
        expect(JSON.stringify(invalid)).not.toContain(changed.home.players[0].name);
      } finally {
        await h.api.pool.query(
          'UPDATE scoring_states SET player_stats=$3::jsonb WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, source.matchId, JSON.stringify(original)],
        );
      }
      expect(await read(target.profile.id)).toMatchObject({
        recordedMatchCount: 1,
        invalidMatchCount: 0,
        totalPoints: 2,
      });
    });

    test('a bounded anonymous batch returns only requested approved finite projections and rejects oversized requests', async () => {
      const first = await provider('batch-a');
      const second = await provider('batch-b');
      const pending = await provider('batch-pending', false);
      const missing = randomUUID();
      const ids = [first.profile.id, second.profile.id, pending.profile.id, missing];
      const value = data<{ players: PlayerPerformanceData[]; unavailableProfileIds: string[] }>(
        await call(h.api, 'get', `${root}/players/performance?ids=${ids.join(',')}`),
      );
      expect(value.players.map((item) => item.profileId).sort()).toEqual(
        [first.profile.id, second.profile.id].sort(),
      );
      expect(value.unavailableProfileIds.sort()).toEqual([pending.profile.id, missing].sort());
      expect(
        value.players.every((item) => item.recordedMatchCount === 0 && item.totalPoints === null),
      ).toBe(true);
      expect(JSON.stringify(value)).not.toContain(first.actor.email);
      error(
        await call(
          h.api,
          'get',
          `${root}/players/performance?ids=${Array.from({ length: 21 }, () => randomUUID()).join(',')}`,
        ),
        422,
      );
    });

    test('idempotent nomination and repeated consent cannot duplicate a source or its sample', async () => {
      const source = await personalFixture();
      const target = await provider('idempotency');
      const commandId = randomUUID();
      const first = data<PlayerPerformanceLinkData>(
        await nominate(target, source, h.owner, { commandId }),
      );
      expect(
        data<PlayerPerformanceLinkData>(await nominate(target, source, h.owner, { commandId })).id,
      ).toBe(first.id);
      error(await nominate(target, source), 409);
      const body: PlayerPerformanceCommandInput = {
        commandId: randomUUID(),
        expectedVersion: first.version,
        type: 'CONSENT',
        reason: why,
        playerConsent: true,
      };
      const path = `${performance}/links/${first.id}/commands`;
      const confirmed = data<PlayerPerformanceLinkData>(
        await call(h.api, 'post', path, { cookie: target.actor.cookie, body }),
      );
      expect(
        data<PlayerPerformanceLinkData>(
          await call(h.api, 'post', path, { cookie: target.actor.cookie, body }),
        ).id,
      ).toBe(confirmed.id);
      expect(await read(target.profile.id)).toMatchObject({
        sourceCount: 1,
        recordedMatchCount: 1,
        totalPoints: 2,
      });
    });

    test('one profile cannot collect two identities from one event and one fixed member cannot be claimed by two profiles', async () => {
      const source = await personalFixture();
      const first = await provider('unique-source-a');
      const second = await provider('unique-source-b');
      await approved(first, source);
      error(
        await nominate(first, source, h.owner, { memberId: source.roster.home[1]!.memberId }),
        409,
      );
      error(await nominate(second, source), 409);
      expect(await read(first.profile.id)).toMatchObject({
        sourceCount: 1,
        recordedMatchCount: 1,
        totalPoints: 2,
      });
      expect(await read(second.profile.id)).toMatchObject({ sourceCount: 0, totalPoints: null });
    });

    test('either party can revoke, and a new nomination needs fresh consent instead of reviving a revoked link', async () => {
      const source = await personalFixture();
      const target = await provider('revoke');
      const first = await approved(target, source);
      const revoked = data<PlayerPerformanceLinkData>(
        await linkCommand(first, target.actor, 'REVOKE'),
      );
      expect(revoked.status).toBe('REVOKED');
      expect(await read(target.profile.id)).toMatchObject({ sourceCount: 0, totalPoints: null });
      error(await linkCommand(revoked, target.actor, 'CONSENT'), 409);
      const next = data<PlayerPerformanceLinkData>(await nominate(target, source));
      expect(next.id).not.toBe(first.id);
      expect(next.status).toBe('PENDING');
      expect(await read(target.profile.id)).toMatchObject({ sourceCount: 0 });
      const approvedAgain = data<PlayerPerformanceLinkData>(
        await linkCommand(next, target.actor, 'CONSENT'),
      );
      data(await linkCommand(approvedAgain, h.owner, 'REVOKE'));
      expect(await read(target.profile.id)).toMatchObject({ sourceCount: 0, totalPoints: null });
    });

    test('publisher actual event-role revocation hides the source and prevents replaying a formerly successful nomination', async () => {
      const source = await personalFixture();
      const target = await provider('publisher-revoked');
      const eventId = source.fixture.event.event.id;
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, eventId, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
        }),
      );
      const commandId = randomUUID();
      const pending = data<PlayerPerformanceLinkData>(
        await nominate(target, source, h.otherOwner, { commandId }),
      );
      data(await linkCommand(pending, target.actor, 'CONSENT'));
      expect(await read(target.profile.id)).toMatchObject({ sourceCount: 1, totalPoints: 2 });
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, eventId, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'DISABLED' },
        }),
      );
      expect(await read(target.profile.id)).toMatchObject({ sourceCount: 0, totalPoints: null });
      error(await nominate(target, source, h.otherOwner, { commandId }), 404);
    });

    test('organization or publisher-account suspension hides a previously consented source immediately', async () => {
      const source = await personalFixture();
      const target = await provider('identity-status');
      await approved(target, source);
      try {
        await h.api.pool.query("UPDATE organizations SET status='DISABLED' WHERE id=$1", [
          h.owner.orgId,
        ]);
        expect(await read(target.profile.id)).toMatchObject({ sourceCount: 0, totalPoints: null });
      } finally {
        await h.api.pool.query("UPDATE organizations SET status='ACTIVE' WHERE id=$1", [
          h.owner.orgId,
        ]);
      }
      expect(await read(target.profile.id)).toMatchObject({ sourceCount: 1, totalPoints: 2 });
      try {
        await h.api.pool.query("UPDATE users SET status='DISABLED' WHERE id=$1", [h.owner.id]);
        expect(await read(target.profile.id)).toMatchObject({ sourceCount: 0, totalPoints: null });
      } finally {
        await h.api.pool.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [h.owner.id]);
      }
    });

    test('disabled provider accounts and profiles cannot retain a public performance endpoint', async () => {
      const source = await personalFixture();
      const target = await provider('provider-status');
      await approved(target, source);
      await h.api.pool.query("UPDATE users SET status='DISABLED' WHERE id=$1", [target.actor.id]);
      error(await call(h.api, 'get', publicPath(target.profile.id)), 404);
      await h.api.pool.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [target.actor.id]);
      const current = data<BookingWorkspaceData>(
        await call(h.api, 'get', `${root}/workspace`, { cookie: target.actor.cookie }),
      ).ownProfile!;
      data(
        await call(h.api, 'post', `${root}/profiles/${target.profile.id}/review`, {
          cookie: operator.cookie,
          body: {
            commandId: randomUUID(),
            expectedVersion: current.version,
            status: 'DISABLED',
            reason: why,
          },
        }),
      );
      error(await call(h.api, 'get', publicPath(target.profile.id)), 404);
    });

    test('a completed reservation is a service record, never evidence of a paid transaction or collected platform revenue', async () => {
      const target = await provider('completed-service');
      const visible = data<BookingWorkspaceData>(
        await call(h.api, 'get', `${root}/workspace`, { cookie: h.leader.cookie }),
      );
      const now = Date.now();
      let order = data<BookingOrderData>(
        await call(h.api, 'post', `${root}/orders`, {
          cookie: h.leader.cookie,
          body: {
            commandId: randomUUID(),
            orgId: h.owner.orgId,
            teamId: h.teams[0]!.id,
            eventName: '合成服务履约',
            scope: 'SINGLE',
            eligibilityConfirmed: true,
            reviewedSettingsVersion: visible.settings.version,
            reviewedProfileVersions: { [target.profile.id]: target.profile.version },
            appearances: [
              {
                profileId: target.profile.id,
                label: '合成服务场次',
                conditional: false,
                venue: '合成服务球场',
                reportAt: new Date(now + 60000).toISOString(),
                startAt: new Date(now + 120000).toISOString(),
                endAt: new Date(now + 180000).toISOString(),
              },
            ],
          },
        }),
      );
      async function command(type: string, user: User) {
        const item = order.appearances[0]!;
        order = data<BookingOrderData>(
          await call(h.api, 'post', `${root}/orders/${order.id}/commands`, {
            cookie: user.cookie,
            body: {
              commandId: randomUUID(),
              appearanceId: item.id,
              expectedVersion: item.version,
              type,
              ...(type === 'ACCEPT' ? { eligibilityConfirmed: true } : {}),
              ...(type === 'DISPUTE' ? { reason: why } : {}),
            },
          }),
        );
      }
      await command('ACCEPT', target.actor);
      await command('ARRIVE', target.actor);
      // Move only this owned fixture's scheduled timestamps into the past; the
      // completion still uses the real HTTP state machine and its time check.
      await h.api.pool.query(
        `UPDATE booking_appearances SET report_at=clock_timestamp()-interval '3 hours',start_at=clock_timestamp()-interval '2 hours',end_at=clock_timestamp()-interval '1 hour',version=version+1,updated_at=clock_timestamp() WHERE id=$1`,
        [order.appearances[0]!.id],
      );
      order = data<BookingOrderData>(
        await call(h.api, 'get', `${root}/orders/${order.id}`, { cookie: h.leader.cookie }),
      );
      await command('COMPLETE', h.leader);
      expect(order.appearances[0]?.status).toBe('COMPLETED');
      expect(order.totals).toMatchObject({ paidFen: 0, settledFen: 0, refundedFen: 0 });
      const value = await read(target.profile.id);
      expect(value).toMatchObject({
        completedServiceCount: 1,
        recordedMatchCount: 0,
        totalPoints: null,
      });
      expect(value).not.toHaveProperty('paidTransactionCount');
      expect(value).not.toHaveProperty('onTimeRate');
      await command('DISPUTE', target.actor);
      expect(order.appearances[0]?.status).toBe('DISPUTED');
      expect(await read(target.profile.id)).toMatchObject({ completedServiceCount: 0 });
    });
  },
);
