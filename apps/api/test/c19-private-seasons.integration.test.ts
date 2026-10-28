import { randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  BookingPlayerData,
  EventSeasonGrantsData,
  MySeasonDataGrantsData,
  MySeasonStatisticsData,
  PlayerPerformanceLinkData,
  ScoringControl,
  SeasonDataGrantData,
  SeasonDetailData,
  SeasonStatisticsData,
  TeamData,
} from '@small-city-basketball/contracts';
import { hashPassword } from '../src/security.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { call, data, error, login, PASSWORD, RUN_ID } from './support.js';
import type { User } from './support.js';
import { team } from './p03-support.js';
import { frozen } from './p04-support.js';
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
import type { Harness } from './p05-support.js';

// C19 private seasons and the independent PRIVATE_SEASON grant over real HTTP and an isolated
// PostgreSQL database. Member bindings (migration 020) are prepared by direct SQL fixture rows
// that respect 020's constraints: the C19 teams endpoints are not implemented on this branch's
// base, so these rows are FIXTURE PREPARATION, not acceptance of the join/claim flow.
const why = '合成私有赛季授权核验';
const YEAR = new Date().getUTCFullYear() + 2;

interface Scored {
  eventId: string;
  matchId: string;
  lease: ScoringControl;
  side: 'HOME' | 'AWAY';
  teamId: string;
  memberId: string;
  awayTeamId: string;
  awayMemberId: string;
}

describe(
  'C19 private seasons over real isolated PostgreSQL and HTTP',
  { concurrent: false },
  () => {
    let h: Harness;
    let passwordHash: string;
    let operator: User;
    let stranger: User;
    let serial = 0;

    const org = () => `/v1/orgs/${h.owner.orgId}`;
    const reject = (response: Response, status: number, code?: string) => {
      error(response, status);
      if (code) expect(response.body.error.code).toBe(code);
    };

    async function person(label: string): Promise<User> {
      const value: User = {
        id: randomUUID(),
        orgId: '',
        email: `c19s-${label}-${RUN_ID}-${++serial}@example.test`,
        cookie: '',
      };
      await h.api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [value.id, value.email, `合成球员${label}`, passwordHash],
      );
      value.cookie = await login(h.api, value);
      return value;
    }
    async function pair(label: string): Promise<TeamData[]> {
      return [
        await team(h.api, h.owner, `${label}主`, h.leader, ['合成甲', '合成乙']),
        await team(h.api, h.owner, `${label}客`, h.leader, ['合成丙', '合成丁']),
      ];
    }
    /**
     * One published round-robin match, PLAYER_BASIC, points/fouls to the first frozen member of
     * teams[0] (whichever side it plays), confirmed by an independent organizer.
     */
    async function scored(teams: TeamData[], points = 2, fouls = 1): Promise<Scored> {
      const fixture = await published(h, teams);
      const matchId = fixture.matches[0]!.id;
      await assign(h, matchId, h.otherOwner);
      const before = await workbench(h, matchId);
      const side = before.match.home.teamId === teams[0]!.id ? 'HOME' : 'AWAY';
      const mineKey = side === 'HOME' ? 'home' : 'away';
      const otherKey = side === 'HOME' ? 'away' : 'home';
      await act(h, matchId, h.owner, {
        type: 'PREPARE_MATCH',
        payload: { expectedEventVersion: before.event.version, collectionMode: 'PLAYER_BASIC' },
      });
      const lease = await acquire(h, matchId);
      await start(h, matchId, h.otherOwner, lease);
      const memberId = before.playerRoster[mineKey][0]!.memberId;
      // Locked rules allow 1–3 points per record: larger totals are several records.
      for (let left = points; left > 0; left -= Math.min(3, left))
        await act(
          h,
          matchId,
          h.otherOwner,
          {
            type: 'RECORD_STAT',
            payload: { kind: 'SCORE', side, value: Math.min(3, left), memberId },
          },
          lease,
        );
      for (let left = fouls; left > 0; left--)
        await act(
          h,
          matchId,
          h.otherOwner,
          { type: 'RECORD_STAT', payload: { kind: 'FOUL', side, value: 1, memberId } },
          lease,
        );
      await finish(h, matchId, h.otherOwner, lease);
      await act(h, matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      return {
        eventId: fixture.event.event.id,
        matchId,
        lease,
        side,
        teamId: teams[0]!.id,
        memberId,
        awayTeamId: teams[1]!.id,
        awayMemberId: before.playerRoster[otherKey][0]!.memberId,
      };
    }
    // ---- FIXTURE PREPARATION (migration 020 rows; not acceptance of the teams flow) ----
    async function bind(
      user: User,
      teamId: string,
      memberId: string,
      orgId = h.owner.orgId,
      issuer = h.owner,
    ): Promise<string> {
      const codeId = randomUUID();
      await h.api.pool.query(
        "INSERT INTO team_join_codes(id,org_id,team_id,code_hash,issued_by,max_uses,expires_at) VALUES($1,$2,$3,$4,$5,30,clock_timestamp()+interval '1 day')",
        [codeId, orgId, teamId, randomBytes(32).toString('hex'), issuer.id],
      );
      const id = randomUUID();
      await h.api.pool.query(
        "INSERT INTO team_member_bindings(id,org_id,team_id,member_id,user_id,source,join_code_id) VALUES($1,$2,$3,$4,$5,'JOIN_CODE',$6)",
        [id, orgId, teamId, memberId, user.id, codeId],
      );
      return id;
    }
    async function endBinding(bindingId: string, reason = 'LEFT') {
      await h.api.pool.query(
        "UPDATE team_member_bindings SET status='ENDED',ended_reason=$2,ended_at=clock_timestamp() WHERE id=$1",
        [bindingId, reason],
      );
    }
    // ---- season helpers over HTTP ----
    async function createSeason(
      name = `合成赛季-${randomUUID().slice(0, 6)}`,
      startDate = `${YEAR}-01-01`,
      endDate = `${YEAR}-12-31`,
      actor = h.owner,
    ) {
      return data<SeasonDetailData>(
        await call(h.api, 'post', `/v1/orgs/${actor.orgId}/seasons`, {
          cookie: actor.cookie,
          body: { clientRequestId: randomUUID(), name, startDate, endDate },
        }),
        201,
      );
    }
    const readSeason = async (id: string, actor = h.owner) =>
      data<SeasonDetailData>(
        await call(h.api, 'get', `/v1/orgs/${actor.orgId}/seasons/${id}`, { cookie: actor.cookie }),
      );
    async function seasonCommand(
      id: string,
      type: string,
      eventId?: string,
      expectedVersion?: number,
      actor = h.owner,
    ) {
      return call(h.api, 'post', `/v1/orgs/${actor.orgId}/seasons/${id}/commands`, {
        cookie: actor.cookie,
        body: {
          type,
          ...(eventId ? { eventId } : {}),
          expectedVersion: expectedVersion ?? (await readSeason(id, actor)).version,
        },
      });
    }
    async function activeSeasonWith(...eventIds: string[]) {
      const season = await createSeason();
      for (const eventId of eventIds) data(await seasonCommand(season.id, 'ATTACH_EVENT', eventId));
      data(await seasonCommand(season.id, 'ACTIVATE'));
      return readSeason(season.id);
    }
    const board = async (seasonId: string, actor = h.owner) =>
      data<SeasonStatisticsData>(
        await call(h.api, 'get', `/v1/orgs/${actor.orgId}/seasons/${seasonId}/player-statistics`, {
          cookie: actor.cookie,
        }),
      );
    const mine = async (user: User, seasonId: string, orgId = h.owner.orgId) =>
      call(h.api, 'get', `/v1/me/season-statistics?orgId=${orgId}&seasonId=${seasonId}`, {
        cookie: user.cookie,
      });
    async function nominate(
      eventId: string,
      teamId: string,
      memberId: string,
      target: User,
      actor = h.owner,
      clientRequestId = randomUUID(),
    ) {
      return call(h.api, 'post', `/v1/orgs/${actor.orgId}/events/${eventId}/season-data-grants`, {
        cookie: actor.cookie,
        body: { clientRequestId, teamId, memberId, targetUserId: target.id, reason: why },
      });
    }
    async function answer(user: User, grant: SeasonDataGrantData, type: string, version?: number) {
      return call(h.api, 'post', `/v1/me/season-data-grants/${grant.id}/commands`, {
        cookie: user.cookie,
        body: { type, expectedVersion: version ?? grant.version },
      });
    }
    async function consented(s: Scored, target: User, actor = h.owner) {
      const pending = data<SeasonDataGrantData>(
        await nominate(s.eventId, s.teamId, s.memberId, target, actor),
        201,
      );
      return data<SeasonDataGrantData>(await answer(target, pending, 'CONSENT'));
    }
    const grantRow = async (id: string) =>
      (await h.api.pool.query('SELECT * FROM season_data_grants WHERE id=$1', [id])).rows[0];
    const myGrants = async (user: User) =>
      data<MySeasonDataGrantsData>(
        await call(h.api, 'get', '/v1/me/season-data-grants', { cookie: user.cookie }),
      );
    const rowFor = (stats: SeasonStatisticsData, user: User) =>
      stats.summary.rows.find((r) => r.userId === user.id);

    beforeAll(async () => {
      h = await createScoringHarness(0);
      passwordHash = await hashPassword(PASSWORD);
      operator = await person('operator');
      stranger = await person('stranger');
      await maintainPlatformOperator(h.api.pool, {
        email: operator.email,
        status: 'ACTIVE',
        reason: why,
      });
    }, 120000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    test('season lifecycle: OWNER/ADMIN only, idempotent create, CAS, explicit in-range attach, CLOSED locks', async () => {
      const clientRequestId = randomUUID();
      const body = {
        clientRequestId,
        name: '合成春季赛季',
        startDate: `${YEAR}-01-01`,
        endDate: `${YEAR}-06-30`,
      };
      reject(await call(h.api, 'get', `${org()}/seasons`), 401);
      reject(
        await call(h.api, 'post', `${org()}/seasons`, {
          cookie: h.owner.cookie,
          origin: null,
          body,
        }),
        403,
      );
      // otherOwner is an EVENT_MANAGER member of this organization: visible but not permitted.
      reject(await call(h.api, 'get', `${org()}/seasons`, { cookie: h.otherOwner.cookie }), 403);
      reject(
        await call(h.api, 'post', `${org()}/seasons`, { cookie: h.otherOwner.cookie, body }),
        403,
      );
      reject(await call(h.api, 'get', `${org()}/seasons`, { cookie: stranger.cookie }), 404);
      const created = data<SeasonDetailData>(
        await call(h.api, 'post', `${org()}/seasons`, { cookie: h.owner.cookie, body }),
        201,
      );
      expect(created).toMatchObject({ status: 'DRAFT', version: 1, events: [] });
      // A lost response is recovered with the original id: same season, no second row or audit.
      const replay = data<SeasonDetailData>(
        await call(h.api, 'post', `${org()}/seasons`, { cookie: h.owner.cookie, body }),
        200,
      );
      expect(replay.id).toBe(created.id);
      reject(
        await call(h.api, 'post', `${org()}/seasons`, {
          cookie: h.owner.cookie,
          body: { ...body, name: '不同内容' },
        }),
        409,
        'IDEMPOTENCY_CONFLICT',
      );
      expect(
        (
          await h.api.pool.query(
            "SELECT count(*)::int AS n FROM audit_logs WHERE resource_id=$1 AND action='SEASON_CREATED'",
            [created.id],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        data<{ id: string }[]>(
          await call(h.api, 'get', `${org()}/seasons`, { cookie: h.owner.cookie }),
        ).map((s) => s.id),
      ).toContain(created.id);

      // CAS on edit.
      const renamed = data<SeasonDetailData>(
        await call(h.api, 'patch', `${org()}/seasons/${created.id}`, {
          cookie: h.owner.cookie,
          body: { expectedVersion: 1, name: '合成春季赛季（改）' },
        }),
      );
      expect(renamed.version).toBe(2);
      reject(
        await call(h.api, 'patch', `${org()}/seasons/${created.id}`, {
          cookie: h.owner.cookie,
          body: { expectedVersion: 1, name: '过期版本' },
        }),
        409,
        'VERSION_CONFLICT',
      );

      // Explicit attach only; dates must be inside the range; never inferred by date.
      const inRange = await frozen(h, h.owner, await pair('季内'), {
        startDate: `${YEAR}-03-01`,
        endDate: `${YEAR}-03-03`,
      });
      const outside = await frozen(h, h.owner, await pair('季外'), {
        startDate: `${YEAR}-06-29`,
        endDate: `${YEAR}-07-02`,
      });
      expect((await readSeason(created.id)).events).toEqual([]);
      expect((await readSeason(created.id)).candidates.map((c) => c.eventId)).toContain(
        inRange.event.id,
      );
      reject(
        await seasonCommand(created.id, 'ATTACH_EVENT', outside.event.id),
        422,
        'EVENT_OUTSIDE_SEASON',
      );
      reject(await seasonCommand(created.id, 'ATTACH_EVENT', randomUUID()), 404);
      reject(
        await seasonCommand(created.id, 'ATTACH_EVENT', inRange.event.id, 1),
        409,
        'VERSION_CONFLICT',
      );
      let season = data<SeasonDetailData>(
        await seasonCommand(created.id, 'ATTACH_EVENT', inRange.event.id),
      );
      expect(season.events.map((e) => e.eventId)).toEqual([inRange.event.id]);
      // First version: one season per event.
      const other = await createSeason('另一赛季');
      reject(
        await seasonCommand(other.id, 'ATTACH_EVENT', inRange.event.id),
        409,
        'EVENT_ALREADY_IN_SEASON',
      );
      // The range can no longer exclude an attached event.
      reject(
        await call(h.api, 'patch', `${org()}/seasons/${created.id}`, {
          cookie: h.owner.cookie,
          body: { expectedVersion: season.version, startDate: `${YEAR}-03-02` },
        }),
        422,
        'SEASON_RANGE_EXCLUDES_EVENT',
      );
      reject(await seasonCommand(created.id, 'CLOSE'), 409, 'SEASON_STATE');
      season = data(await seasonCommand(created.id, 'ACTIVATE'));
      expect(season).toMatchObject({ status: 'ACTIVE' });
      expect(season.activatedAt).not.toBeNull();
      season = data(await seasonCommand(created.id, 'CLOSE'));
      expect(season).toMatchObject({ status: 'CLOSED', candidates: [] });
      expect(season.capabilities).toEqual({ canEdit: false, canActivate: false, canClose: false });
      // CLOSED locks configuration and attachments, at the API and in the database.
      reject(
        await call(h.api, 'patch', `${org()}/seasons/${created.id}`, {
          cookie: h.owner.cookie,
          body: { expectedVersion: season.version, name: '关闭后改名' },
        }),
        409,
        'SEASON_CLOSED',
      );
      reject(
        await seasonCommand(created.id, 'DETACH_EVENT', inRange.event.id),
        409,
        'SEASON_CLOSED',
      );
      reject(
        await seasonCommand(created.id, 'ATTACH_EVENT', outside.event.id),
        409,
        'SEASON_CLOSED',
      );
      await expect(
        h.api.pool.query("UPDATE seasons SET name='直写',version=version+1 WHERE id=$1", [
          created.id,
        ]),
      ).rejects.toThrow(/closed season is locked/);
      await expect(
        h.api.pool.query(
          "UPDATE season_events SET status='DETACHED',detached_by=$2,detached_at=clock_timestamp() WHERE season_id=$1",
          [created.id, h.owner.id],
        ),
      ).rejects.toThrow(/closed season locks/);
      await expect(
        h.api.pool.query('DELETE FROM seasons WHERE id=$1', [created.id]),
      ).rejects.toThrow(/cannot be deleted/);
      const actions = (
        await h.api.pool.query(
          'SELECT action FROM audit_logs WHERE resource_id=$1 ORDER BY created_at,id',
          [created.id],
        )
      ).rows.map((r) => r.action);
      expect(actions).toEqual([
        'SEASON_CREATED',
        'SEASON_UPDATED',
        'SEASON_ATTACH_EVENT',
        'SEASON_ACTIVATE',
        'SEASON_CLOSE',
      ]);
      // DETACH on an open season keeps history: a new attachment is a new row.
      data(await seasonCommand(other.id, 'ATTACH_EVENT', outside.event.id));
      data(await seasonCommand(other.id, 'DETACH_EVENT', outside.event.id));
      data(await seasonCommand(other.id, 'ATTACH_EVENT', outside.event.id));
      expect(
        (
          await h.api.pool.query(
            'SELECT status FROM season_events WHERE event_id=$1 ORDER BY attached_at',
            [outside.event.id],
          )
        ).rows.map((r) => r.status),
      ).toEqual(['DETACHED', 'ACTIVE']);
    });

    test('binding alone, nomination alone and a booking profile with C07 consent never aggregate', async () => {
      const s = await scored(await pair('只绑定'), 7, 2);
      const season = await activeSeasonWith(s.eventId);
      const player = await person('bound');
      // Booking profile + approved C07 public link for the same member (separate purpose).
      const now = Date.now();
      let profile = data<BookingPlayerData>(
        await call(h.api, 'put', '/v1/player-bookings/profile', {
          cookie: player.cookie,
          body: {
            commandId: randomUUID(),
            expectedVersion: 0,
            displayName: '合成预约档案',
            position: 'PG',
            heightCm: 182,
            city: '合成高州',
            bio: '仅用于隔离私有赛季测试',
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
      profile = data<BookingPlayerData>(
        await call(h.api, 'post', `/v1/player-bookings/profiles/${profile.id}/review`, {
          cookie: operator.cookie,
          body: {
            commandId: randomUUID(),
            expectedVersion: profile.version,
            status: 'APPROVED',
            reason: why,
          },
        }),
      );
      const link = data<PlayerPerformanceLinkData>(
        await call(h.api, 'post', '/v1/player-bookings/performance/links', {
          cookie: h.owner.cookie,
          body: {
            commandId: randomUUID(),
            profileId: profile.id,
            orgId: h.owner.orgId,
            eventId: s.eventId,
            teamId: s.teamId,
            memberId: s.memberId,
            reason: why,
            publisherConsent: true,
          },
        }),
      );
      data(
        await call(h.api, 'post', `/v1/player-bookings/performance/links/${link.id}/commands`, {
          cookie: player.cookie,
          body: {
            commandId: randomUUID(),
            expectedVersion: link.version,
            type: 'CONSENT',
            reason: why,
            playerConsent: true,
          },
        }),
      );
      // C07 consent alone: no season grant row exists and nothing aggregates.
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::int AS n FROM season_data_grants WHERE target_user_id=$1 OR member_id=$2',
            [player.id, s.memberId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect((await board(season.id)).summary.rows).toEqual([]);
      reject(await mine(player, season.id), 404);

      // Binding alone (fixture): still nothing.
      await bind(player, s.teamId, s.memberId);
      expect((await board(season.id)).summary).toMatchObject({ rows: [], effectiveGrantCount: 0 });
      expect((await myGrants(player)).grants).toEqual([]);

      // Nomination alone: PENDING never counts; the consent screen data is complete.
      const pending = data<SeasonDataGrantData>(
        await nominate(s.eventId, s.teamId, s.memberId, player),
        201,
      );
      expect(pending).toMatchObject({
        purpose: 'PRIVATE_SEASON',
        status: 'PENDING',
        effective: false,
        ineffectiveReasons: ['NOT_CONSENTED'],
      });
      expect((await board(season.id)).summary.rows).toEqual([]);
      const ownPending = data<MySeasonStatisticsData>(await mine(player, season.id));
      expect(ownPending.summary.rows).toEqual([]);
      const listed = await myGrants(player);
      expect(listed.grants[0]).toMatchObject({
        id: pending.id,
        capabilities: { canConsent: true, canDecline: true, canRevoke: false, canWithdraw: false },
        season: { id: season.id, status: 'ACTIVE' },
      });
      for (const key of ['purpose', 'scope', 'readers', 'metrics', 'revocation', 'independence'])
        expect(
          (listed.disclosure as unknown as Record<string, string>)[key]!.length,
        ).toBeGreaterThan(10);
      expect(JSON.stringify(listed)).not.toMatch(/@example\.test/);

      // Consent: the season grant still creates no C07 link, and C07 data is unchanged.
      const c07Before = (
        await h.api.pool.query(
          'SELECT id,status,version FROM booking_performance_links ORDER BY id',
        )
      ).rows;
      const active = data<SeasonDataGrantData>(await answer(player, pending, 'CONSENT'));
      expect(active).toMatchObject({ status: 'ACTIVE', effective: true, ineffectiveReasons: [] });
      expect(
        (
          await h.api.pool.query(
            'SELECT id,status,version FROM booking_performance_links ORDER BY id',
          )
        ).rows,
      ).toEqual(c07Before);
      const stats = await board(season.id);
      expect(rowFor(stats, player)).toMatchObject({
        score: 7,
        fouls: 2,
        rosterSampleMatchCount: 1,
        eventCount: 1,
        rebounds: null,
        assists: null,
        minutesPlayed: null,
      });
      expect(stats.summary.notCollected).toEqual(['REBOUNDS', 'ASSISTS', 'MINUTES']);
      expect(stats.summary.rankingComplete).toBe(true);
      const own = data<MySeasonStatisticsData>(await mine(player, season.id));
      expect(own.summary.rows).toHaveLength(1);
      expect(own.summary.rows[0]!.userId).toBe(player.id);
      expect(JSON.stringify(own)).not.toMatch(/@example\.test/);
    });

    test('binding ended excludes on the next read; rebinding or a new grant never revives the old grant', async () => {
      const s = await scored(await pair('解绑'), 4, 0);
      const season = await activeSeasonWith(s.eventId);
      const player = await person('rebind');
      const firstBinding = await bind(player, s.teamId, s.memberId);
      const first = await consented(s, player);
      expect(rowFor(await board(season.id), player)?.score).toBe(4);
      await endBinding(firstBinding, 'LEFT');
      expect(rowFor(await board(season.id), player)).toBeUndefined();
      expect(data<MySeasonStatisticsData>(await mine(player, season.id)).summary.rows).toEqual([]);
      const listed = (await myGrants(player)).grants.find((g) => g.id === first.id)!;
      expect(listed).toMatchObject({
        status: 'ACTIVE',
        effective: false,
        ineffectiveReasons: ['BINDING_ENDED'],
      });
      // Rebinding creates a NEW binding row; the old ACTIVE grant stays bound to the ended one.
      const secondBinding = await bind(player, s.teamId, s.memberId);
      expect(secondBinding).not.toBe(firstBinding);
      expect(rowFor(await board(season.id), player)).toBeUndefined();
      // The player revokes the stale grant; it stays REVOKED forever.
      const revoked = data<SeasonDataGrantData>(await answer(player, listed, 'REVOKE'));
      expect(revoked.status).toBe('REVOKED');
      reject(await answer(player, revoked, 'CONSENT'), 409, 'SEASON_GRANT_STATE');
      // A new nomination is a new row for the new binding and needs a new consent.
      const renewed = data<SeasonDataGrantData>(
        await nominate(s.eventId, s.teamId, s.memberId, player),
        201,
      );
      expect(renewed.id).not.toBe(first.id);
      expect(rowFor(await board(season.id), player)).toBeUndefined();
      data(await answer(player, renewed, 'CONSENT'));
      expect(rowFor(await board(season.id), player)).toMatchObject({ score: 4 });
      expect((await grantRow(first.id)).status).toBe('REVOKED');
      expect((await grantRow(renewed.id)).binding_id).toBe(secondBinding);
      // Only one effective grant per member: the score is counted once.
      expect((await board(season.id)).summary.effectiveGrantCount).toBe(1);
      // Removing the member ends the binding (MEMBER_REMOVED) and excludes again.
      await endBinding(secondBinding, 'MEMBER_REMOVED');
      expect(rowFor(await board(season.id), player)).toBeUndefined();
      // A grant can never be inserted for an ended binding (database guard).
      await expect(
        h.api.pool.query(
          'INSERT INTO season_data_grants(id,org_id,event_id,team_id,member_id,target_user_id,binding_id,nominated_by,nominate_reason,client_request_id,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            randomUUID(),
            h.owner.orgId,
            s.eventId,
            s.teamId,
            s.memberId,
            player.id,
            secondBinding,
            h.owner.id,
            why,
            randomUUID(),
            'a'.repeat(64),
          ],
        ),
      ).rejects.toThrow(/active member binding/);
      await expect(
        h.api.pool.query('DELETE FROM season_data_grants WHERE id=$1', [first.id]),
      ).rejects.toThrow(/cannot be deleted/);
    });

    test('reopening a match removes it at once and a reconfirmation counts only the current one', async () => {
      const s = await scored(await pair('重开'), 2, 0);
      const season = await activeSeasonWith(s.eventId);
      const player = await person('reopen');
      await bind(player, s.teamId, s.memberId);
      await consented(s, player);
      const before = await board(season.id);
      expect(rowFor(before, player)).toMatchObject({ score: 2, rosterSampleMatchCount: 1 });
      await act(h, s.matchId, h.owner, { type: 'REOPEN_RESULT', payload: { reason: why } });
      const reopened = await board(season.id);
      expect(rowFor(reopened, player)).toBeUndefined();
      expect(reopened.summary.events[0]).toMatchObject({
        state: 'INCLUDED',
        includedMatchCount: 0,
        pendingMatchCount: 1,
        coverageComplete: false,
      });
      expect(reopened.summary.rankingComplete).toBe(false);
      expect(reopened.summary.sourceHash).not.toBe(before.summary.sourceHash);
      await act(
        h,
        s.matchId,
        h.otherOwner,
        {
          type: 'ADD_CORRECTION',
          payload: {
            kind: 'SCORE',
            side: s.side,
            value: 1,
            period: 1,
            reason: why,
            memberId: s.memberId,
          },
        },
        s.lease,
      );
      await act(h, s.matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      const reconfirmed = await board(season.id);
      expect(rowFor(reconfirmed, player)).toMatchObject({ score: 3, rosterSampleMatchCount: 1 });
      expect(reconfirmed.summary.sourceHash).not.toBe(before.summary.sourceHash);
      expect(reconfirmed.summary.sourceHash).not.toBe(reopened.summary.sourceHash);
      const own = data<MySeasonStatisticsData>(await mine(player, season.id));
      expect(own.summary.rows[0]).toMatchObject({ score: 3, rosterSampleMatchCount: 1 });
    });

    test('a nominator losing EVENT_MANAGER removes the grant; an event manager never reads season data', async () => {
      const s = await scored(await pair('提名权'), 5, 0);
      const second = await scored(await pair('他届'), 1, 0);
      const season = await activeSeasonWith(s.eventId, second.eventId);
      // otherOwner is an EVENT_MANAGER member of this organization; it acts in this organization here.
      const manager: User = { ...h.otherOwner, orgId: h.owner.orgId };
      const eventStaff = (eventId: string, status: string) =>
        call(h.api, 'put', `${org()}/events/${eventId}/staff/${manager.id}`, {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status },
        });
      // Before being assigned to the event, the member cannot nominate or read event grants.
      const player = await person('manager-nominee');
      await bind(player, s.teamId, s.memberId);
      reject(await nominate(s.eventId, s.teamId, s.memberId, player, manager), 403);
      data(await eventStaff(s.eventId, 'ACTIVE'));
      const sources = data<EventSeasonGrantsData>(
        await call(h.api, 'get', `${org()}/events/${s.eventId}/season-data-grants`, {
          cookie: manager.cookie,
        }),
      );
      expect(sources.frozen).toBe(true);
      const member = sources.sources
        .flatMap((t) => t.members)
        .find((m) => m.memberId === s.memberId)!;
      expect(member.binding).toMatchObject({
        userId: player.id,
        displayName: '合成球员manager-nominee',
      });
      expect(JSON.stringify(sources)).not.toMatch(/@example\.test/);
      reject(
        await call(h.api, 'get', `${org()}/events/${second.eventId}/season-data-grants`, {
          cookie: manager.cookie,
        }),
        403,
      );
      const original = await consented(s, player, manager);
      expect(rowFor(await board(season.id), player)?.score).toBe(5);
      // Managing one event never opens organization-wide season data.
      reject(
        await call(h.api, 'get', `${org()}/seasons/${season.id}/player-statistics`, {
          cookie: manager.cookie,
        }),
        403,
      );
      reject(
        await call(h.api, 'get', `${org()}/seasons/${season.id}`, { cookie: manager.cookie }),
        403,
      );
      // Losing the event role: excluded on the next read; the reason is visible to the player.
      data(await eventStaff(s.eventId, 'DISABLED'));
      expect(rowFor(await board(season.id), player)).toBeUndefined();
      expect((await myGrants(player)).grants[0]!.ineffectiveReasons).toEqual([
        'NOMINATOR_UNAUTHORIZED',
      ]);
      // Restoring power cannot reuse an old consent; the invalidation persists without a read.
      data(await eventStaff(s.eventId, 'ACTIVE'));
      expect(rowFor(await board(season.id), player)).toBeUndefined();
      const invalid = (await myGrants(player)).grants.find((g) => g.id === original.id)!;
      expect(invalid).toMatchObject({
        effective: false,
        invalidationReason: 'NOMINATOR_UNAUTHORIZED',
      });
      expect(invalid.invalidatedAt).not.toBeNull();
      expect(invalid.version).toBe(original.version + 1);
      await expect(
        h.api.pool.query(
          'UPDATE season_data_grants SET invalidated_at=NULL,invalidation_reason=NULL,version=version+1 WHERE id=$1',
          [original.id],
        ),
      ).rejects.toThrow(/invalidation is permanent/);
      const renewed = data<SeasonDataGrantData>(
        await nominate(s.eventId, s.teamId, s.memberId, player, manager),
        201,
      );
      expect(renewed.id).not.toBe(original.id);
      expect(rowFor(await board(season.id), player)).toBeUndefined();
      data(await answer(player, renewed, 'CONSENT'));
      expect(rowFor(await board(season.id), player)?.score).toBe(5);
      data(await eventStaff(s.eventId, 'DISABLED'));
    });

    test('permission, account and organization restoration never revive pending or active grants', async () => {
      const s = await scored(await pair('永久失效'), 3, 0);
      const season = await activeSeasonWith(s.eventId);
      const player = await person('permanent');
      await bind(player, s.teamId, s.memberId);
      const manager: User = { ...h.otherOwner, orgId: h.owner.orgId };
      const member = async (role: string, status: string) =>
        data(
          await call(h.api, 'put', `${org()}/members/${manager.id}`, {
            cookie: h.owner.cookie,
            body: { role, status },
          }),
        );
      data(
        await call(h.api, 'put', `${org()}/events/${s.eventId}/staff/${manager.id}`, {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
        }),
      );
      const pending = data<SeasonDataGrantData>(
        await nominate(s.eventId, s.teamId, s.memberId, player, manager),
        201,
      );
      // No intermediate GET: a disabled/re-enabled membership still permanently invalidates.
      await member('EVENT_MANAGER', 'DISABLED');
      await member('EVENT_MANAGER', 'ACTIVE');
      const stale = (await myGrants(player)).grants.find((g) => g.id === pending.id)!;
      expect(stale).toMatchObject({
        status: 'PENDING',
        effective: false,
        invalidationReason: 'NOMINATOR_UNAUTHORIZED',
      });
      expect(stale.capabilities.canConsent).toBe(false);
      reject(await answer(player, stale, 'CONSENT'), 409, 'SEASON_GRANT_SOURCE_UNAVAILABLE');

      // A fresh nomination requires fresh consent; disabling one of two authority routes
      // does not invalidate while another route is continuously valid.
      await member('ORG_ADMIN', 'ACTIVE');
      const active = await consented(s, player, manager);
      data(
        await call(h.api, 'put', `${org()}/events/${s.eventId}/staff/${manager.id}`, {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'DISABLED' },
        }),
      );
      expect(rowFor(await board(season.id), player)?.score).toBe(3);
      expect((await grantRow(active.id)).invalidated_at).toBeNull();
      await member('EVENT_MANAGER', 'ACTIVE');
      await member('ORG_ADMIN', 'ACTIVE');
      expect(rowFor(await board(season.id), player)).toBeUndefined();

      for (const [table, id, reason] of [
        ['users', manager.id, 'NOMINATOR_UNAUTHORIZED'],
        ['users', player.id, 'TARGET_INACTIVE'],
        ['organizations', h.owner.orgId, 'ORGANIZATION_INACTIVE'],
      ] as const) {
        const granted = await consented(s, player, manager);
        const c = await h.api.pool.connect();
        try {
          await c.query('BEGIN');
          await c.query(`UPDATE ${table} SET status='DISABLED' WHERE id=$1`, [id]);
          await c.query(`UPDATE ${table} SET status='ACTIVE' WHERE id=$1`, [id]);
          await c.query('COMMIT');
        } finally {
          c.release();
        }
        expect(rowFor(await board(season.id), player)).toBeUndefined();
        const row = (await myGrants(player)).grants.find((g) => g.id === granted.id)!;
        expect(row).toMatchObject({
          status: 'ACTIVE',
          effective: false,
          invalidationReason: reason,
        });
        expect(row.ineffectiveReasons).toContain(reason);
        expect(row.invalidatedAt).not.toBeNull();
      }
      await member('EVENT_MANAGER', 'ACTIVE');
    });

    test('consent and binding loss use the same lock order and cannot leave effective consent', async () => {
      const s = await scored(await pair('解绑竞争'), 2, 0);
      const player = await person('consent-race');
      const binding = await bind(player, s.teamId, s.memberId);
      const pending = data<SeasonDataGrantData>(
        await nominate(s.eventId, s.teamId, s.memberId, player),
        201,
      );
      const c = await h.api.pool.connect();
      let answering: Promise<Response> | undefined;
      try {
        await c.query('BEGIN');
        await c.query("SET LOCAL lock_timeout='3s'");
        await c.query('SELECT 1 FROM team_member_bindings WHERE id=$1 FOR UPDATE', [binding]);
        answering = answer(player, pending, 'CONSENT');
        // Wait for the real HTTP transaction to reach the locked binding before ending it.
        let waiting = false;
        for (let tries = 0; tries < 100 && !waiting; tries++) {
          const active = await h.api.pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT 1 FROM team_member_bindings WHERE id=%'",
          );
          waiting = active.rowCount! > 0;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await c.query(
          "UPDATE team_member_bindings SET status='ENDED',ended_reason='LEFT',ended_at=clock_timestamp() WHERE id=$1",
          [binding],
        );
        await c.query('COMMIT');
        reject(await answering, 409, 'VERSION_CONFLICT');
      } finally {
        await c.query('ROLLBACK');
        c.release();
        if (answering) await answering;
      }
      expect((await myGrants(player)).grants[0]).toMatchObject({
        status: 'PENDING',
        effective: false,
        invalidationReason: 'BINDING_ENDED',
      });
    });

    test('organizations are isolated: no cross-organization reads, nomination or merging', async () => {
      const s = await scored(await pair('隔离'), 3, 0);
      const season = await activeSeasonWith(s.eventId);
      const player = await person('two-orgs');
      await bind(player, s.teamId, s.memberId);
      await consented(s, player);
      // The other organization's owner sees nothing of this organization.
      const foreign = `/v1/orgs/${h.owner.orgId}`;
      for (const path of [
        `${foreign}/seasons`,
        `${foreign}/seasons/${season.id}`,
        `${foreign}/seasons/${season.id}/player-statistics`,
        `${foreign}/events/${s.eventId}/season-data-grants`,
      ])
        reject(await call(h.api, 'get', path, { cookie: stranger.cookie }), 404);
      reject(
        await call(h.api, 'get', `/v1/orgs/${h.otherOwner.orgId}/seasons/${season.id}`, {
          cookie: h.otherOwner.cookie,
        }),
        404,
      );
      // The same account in the other organization: its own event, binding, grant and season.
      const otherEvent = await frozen(h, h.otherOwner, h.otherTeams.slice(0, 2), {
        startDate: `${YEAR}-11-01`,
        endDate: `${YEAR}-11-03`,
      });
      const otherTeam = otherEvent.freeze!.entries[0]!;
      const otherMember = otherTeam.players[0]!.memberId;
      await bind(player, otherTeam.teamId, otherMember, h.otherOwner.orgId, h.otherOwner);
      // Nominating this organization's member through the other organization's event fails.
      reject(
        await nominate(otherEvent.event.id, s.teamId, s.memberId, player, h.otherOwner),
        422,
        'SEASON_GRANT_SOURCE_INVALID',
      );
      const otherGrant = data<SeasonDataGrantData>(
        await nominate(otherEvent.event.id, otherTeam.teamId, otherMember, player, h.otherOwner),
        201,
      );
      data(await answer(player, otherGrant, 'CONSENT'));
      const otherSeason = await createSeason(
        '他机构赛季',
        `${YEAR}-01-01`,
        `${YEAR}-12-31`,
        h.otherOwner,
      );
      data(
        await seasonCommand(
          otherSeason.id,
          'ATTACH_EVENT',
          otherEvent.event.id,
          undefined,
          h.otherOwner,
        ),
      );
      data(await seasonCommand(otherSeason.id, 'ACTIVATE', undefined, undefined, h.otherOwner));
      // Each organization's figures only contain its own sources; nothing is merged across.
      const here = rowFor(await board(season.id), player)!;
      expect(here.sources.map((x) => x.eventId)).toEqual([s.eventId]);
      expect(here.score).toBe(3);
      const there = rowFor(await board(otherSeason.id, h.otherOwner), player)!;
      expect(there.sources).toEqual([]);
      expect(there.score).toBe(0);
      reject(await mine(player, season.id, h.otherOwner.orgId), 404);
      reject(await mine(player, otherSeason.id, h.owner.orgId), 404);
      expect(
        data<MySeasonStatisticsData>(await mine(player, season.id)).summary.events.map(
          (e) => e.eventId,
        ),
      ).toEqual([s.eventId]);
      // The player's grant list shows both, each with its own organization.
      const orgs = new Set((await myGrants(player)).grants.map((g) => g.orgId));
      expect(orgs).toEqual(new Set([h.owner.orgId, h.otherOwner.orgId]));
    });

    test('sourceHash covers season version, event set, grants and confirmed sources; CLOSED still honours revocation', async () => {
      const teams = await pair('哈希');
      const s = await scored(teams, 6, 0);
      const later = await scored(teams, 1, 0); // same long-term members, a second event
      const season = await activeSeasonWith(s.eventId);
      const player = await person('hash');
      await bind(player, s.teamId, s.memberId);
      const hashes: string[] = [];
      const record = async () => {
        const value = (await board(season.id)).summary.sourceHash;
        expect(hashes).not.toContain(value);
        hashes.push(value);
      };
      await record();
      const grant = await consented(s, player);
      await record();
      data(
        await call(h.api, 'patch', `${org()}/seasons/${season.id}`, {
          cookie: h.owner.cookie,
          body: { expectedVersion: (await readSeason(season.id)).version, name: '哈希赛季改名' },
        }),
      );
      await record();
      data(await seasonCommand(season.id, 'ATTACH_EVENT', later.eventId));
      await record();
      // Same account across two events of one season (explicit account relation).
      const secondGrant = await consented(later, player);
      await record();
      expect(rowFor(await board(season.id), player)).toMatchObject({
        score: 7,
        eventCount: 2,
        rosterSampleMatchCount: 2,
      });
      // An unchanged state reads the same hash: nothing is cached and nothing drifts.
      expect((await board(season.id)).summary.sourceHash).toBe(hashes.at(-1));
      data(await seasonCommand(season.id, 'CLOSE'));
      await record();
      // CLOSED does not freeze privacy: revocation takes effect at once in both views.
      const revoked = data<SeasonDataGrantData>(await answer(player, secondGrant, 'REVOKE'));
      expect(revoked.status).toBe('REVOKED');
      await record();
      expect(rowFor(await board(season.id), player)).toMatchObject({ score: 6, eventCount: 1 });
      // The organizer can still withdraw on a closed season.
      const withdrawn = data<SeasonDataGrantData>(
        await call(h.api, 'post', `${org()}/season-data-grants/${grant.id}/withdraw`, {
          cookie: h.owner.cookie,
          body: { reason: '主办方撤回合成授权', expectedVersion: grant.version },
        }),
      );
      expect(withdrawn).toMatchObject({ status: 'WITHDRAWN', effective: false });
      await record();
      expect(rowFor(await board(season.id), player)).toBeUndefined();
      expect(data<MySeasonStatisticsData>(await mine(player, season.id)).summary.rows).toEqual([]);
      // CLOSED does not freeze result validity either: a reopen still changes the hash.
      await act(h, s.matchId, h.owner, { type: 'REOPEN_RESULT', payload: { reason: why } });
      await record();
    });

    test('concurrent duplicate nominations, CAS conflicts, foreign answers and binding checks', async () => {
      const s = await scored(await pair('并发'), 2, 0);
      await activeSeasonWith(s.eventId);
      const player = await person('concurrent');
      const other = await person('other');
      // Not bound yet: nomination needs the target's active binding to that exact member.
      reject(
        await nominate(s.eventId, s.teamId, s.memberId, player),
        409,
        'SEASON_GRANT_BINDING_REQUIRED',
      );
      await bind(player, s.teamId, s.memberId);
      reject(
        await nominate(s.eventId, s.teamId, s.memberId, other),
        409,
        'SEASON_GRANT_BINDING_REQUIRED',
      );
      reject(
        await nominate(s.eventId, s.teamId, s.awayMemberId, player),
        422,
        'SEASON_GRANT_SOURCE_INVALID',
      );
      const clientRequestId = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          nominate(s.eventId, s.teamId, s.memberId, player, h.owner, clientRequestId),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      const grantId = results[0]!.body.data.id as string;
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::int AS n FROM season_data_grants WHERE client_request_id=$1',
            [clientRequestId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await h.api.pool.query(
            "SELECT count(*)::int AS n FROM audit_logs WHERE resource_id=$1 AND action='SEASON_GRANT_NOMINATED'",
            [grantId],
          )
        ).rows[0].n,
      ).toBe(1);
      reject(
        await call(h.api, 'post', `${org()}/events/${s.eventId}/season-data-grants`, {
          cookie: h.owner.cookie,
          body: {
            clientRequestId,
            teamId: s.teamId,
            memberId: s.memberId,
            targetUserId: player.id,
            reason: '不同的提名原因',
          },
        }),
        409,
        'IDEMPOTENCY_CONFLICT',
      );
      // Different ids for an already open source are refused.
      const raced = await Promise.all([
        nominate(s.eventId, s.teamId, s.memberId, player),
        nominate(s.eventId, s.teamId, s.memberId, player),
      ]);
      expect(raced.map((r) => r.status)).toEqual([409, 409]);
      expect(raced.every((r) => r.body.error.code === 'SEASON_GRANT_EXISTS')).toBe(true);
      const grant = (await myGrants(player)).grants.find((g) => g.id === grantId)!;
      // Only the target may answer; the nominator and others cannot even see it.
      reject(await answer(h.owner, grant, 'CONSENT'), 404);
      reject(await answer(other, grant, 'CONSENT'), 404);
      reject(await answer(player, grant, 'REVOKE'), 409, 'SEASON_GRANT_STATE');
      reject(await answer(player, grant, 'CONSENT', grant.version + 1), 409, 'VERSION_CONFLICT');
      const active = data<SeasonDataGrantData>(await answer(player, grant, 'CONSENT'));
      // A stale retry after a lost response is a CAS conflict, never a second transition.
      reject(await answer(player, grant, 'CONSENT'), 409, 'VERSION_CONFLICT');
      reject(
        await call(h.api, 'post', `${org()}/season-data-grants/${grantId}/withdraw`, {
          cookie: h.owner.cookie,
          body: { reason: '过期版本撤回', expectedVersion: grant.version },
        }),
        409,
        'VERSION_CONFLICT',
      );
      reject(
        await call(h.api, 'post', `${org()}/season-data-grants/${grantId}/withdraw`, {
          cookie: h.otherOwner.cookie,
          body: { reason: '无权撤回尝试', expectedVersion: active.version },
        }),
        403,
      );
      // Decline path: a separate nomination declined is terminal.
      const declinedTarget = await person('decline');
      await bind(declinedTarget, s.awayTeamId, s.awayMemberId);
      // Two different request ids racing for one fresh source: exactly one open grant.
      const fresh = await Promise.all([
        nominate(s.eventId, s.awayTeamId, s.awayMemberId, declinedTarget),
        nominate(s.eventId, s.awayTeamId, s.awayMemberId, declinedTarget),
      ]);
      expect(fresh.map((r) => r.status).sort()).toEqual([201, 409]);
      const toDecline = fresh.find((r) => r.status === 201)!.body.data as SeasonDataGrantData;
      expect(fresh.find((r) => r.status === 409)!.body.error.code).toBe('SEASON_GRANT_EXISTS');
      expect(
        (
          await h.api.pool.query(
            "SELECT count(*)::int AS n FROM season_data_grants WHERE member_id=$1 AND status IN ('PENDING','ACTIVE')",
            [s.awayMemberId],
          )
        ).rows[0].n,
      ).toBe(1);
      const declined = data<SeasonDataGrantData>(
        await answer(declinedTarget, toDecline, 'DECLINE'),
      );
      expect(declined).toMatchObject({ status: 'DECLINED', effective: false });
      reject(await answer(declinedTarget, declined, 'CONSENT'), 409, 'SEASON_GRANT_STATE');
      expect(
        (
          await h.api.pool.query(
            'SELECT action FROM audit_logs WHERE resource_id=$1 ORDER BY created_at,id',
            [grantId],
          )
        ).rows.map((r) => r.action),
      ).toEqual(['SEASON_GRANT_NOMINATED', 'SEASON_GRANT_CONSENTED']);
    });

    test('own grant pagination preserves exact cursor position and keeps older consent revocable', async () => {
      const s = await scored(await pair('授权分页'), 2, 0);
      const player = await person('grant-pages');
      await bind(player, s.teamId, s.memberId);
      await bind(player, s.awayTeamId, s.awayMemberId);
      const old = await consented(s, player);
      const latest = data<SeasonDataGrantData>(
        await nominate(s.eventId, s.awayTeamId, s.awayMemberId, player),
        201,
      );
      const first = data<MySeasonDataGrantsData>(
        await call(h.api, 'get', '/v1/me/season-data-grants?limit=1', { cookie: player.cookie }),
      );
      expect(first.grants.map((g) => g.id)).toEqual([latest.id]);
      expect(first.truncated).toBe(true);
      expect(first.nextCursor).toBeTruthy();
      const cursor = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'));
      const persisted = (
        await h.api.pool.query(
          'SELECT created_at::text AS at FROM season_data_grants WHERE id=$1',
          [latest.id],
        )
      ).rows[0];
      expect(cursor).toEqual({ at: persisted.at, id: latest.id });
      const second = data<MySeasonDataGrantsData>(
        await call(h.api, 'get', `/v1/me/season-data-grants?limit=1&cursor=${first.nextCursor}`, {
          cookie: player.cookie,
        }),
      );
      expect(second.grants.map((g) => g.id)).toEqual([old.id]);
      expect(second.nextCursor).toBeNull();
      expect(second.truncated).toBe(false);
      expect(
        data<SeasonDataGrantData>(await answer(player, second.grants[0]!, 'REVOKE')).status,
      ).toBe('REVOKED');
      // A cursor never changes ownership filtering, and malformed cursor/query values fail closed.
      expect(
        data<MySeasonDataGrantsData>(
          await call(h.api, 'get', `/v1/me/season-data-grants?limit=1&cursor=${first.nextCursor}`, {
            cookie: stranger.cookie,
          }),
        ).grants,
      ).toEqual([]);
      for (const query of ['limit=0', 'limit=51', 'limit=1&limit=2', 'cursor=garbage'])
        reject(
          await call(h.api, 'get', `/v1/me/season-data-grants?${query}`, { cookie: player.cookie }),
          400,
        );
    });

    test('an account disabled or a session revoked stops reads and writes; consent re-checks upstream', async () => {
      const s = await scored(await pair('失效'), 2, 0);
      const season = await activeSeasonWith(s.eventId);
      const player = await person('upstream');
      const binding = await bind(player, s.teamId, s.memberId);
      const pending = data<SeasonDataGrantData>(
        await nominate(s.eventId, s.teamId, s.memberId, player),
        201,
      );
      await endBinding(binding);
      const stale = (await myGrants(player)).grants[0]!;
      expect(stale.capabilities.canConsent).toBe(false);
      reject(await answer(player, pending, 'CONSENT'), 409, 'VERSION_CONFLICT');
      reject(await answer(player, stale, 'CONSENT'), 409, 'SEASON_GRANT_SOURCE_UNAVAILABLE');
      expect((await grantRow(pending.id)).status).toBe('PENDING');
      // Logging out ends every read and write for that session.
      const logout = await call(h.api, 'post', '/v1/auth/logout', { cookie: player.cookie });
      expect(logout.status).toBeLessThan(300);
      reject(await call(h.api, 'get', '/v1/me/season-data-grants', { cookie: player.cookie }), 401);
      reject(await answer(player, pending, 'DECLINE'), 401);
      reject(await mine(player, season.id), 401);
    });

    test('an audit failure rolls back the whole write and leaks nothing', async () => {
      const s = await scored(await pair('审计'), 2, 0);
      const season = await activeSeasonWith(s.eventId);
      const player = await person('audit');
      await bind(player, s.teamId, s.memberId);
      const pending = data<SeasonDataGrantData>(
        await nominate(s.eventId, s.teamId, s.memberId, player),
        201,
      );
      const identifier = `scb_c19s_audit_${randomUUID().replaceAll('-', '')}`;
      await h.api.pool.query(
        `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'SEASON_%' THEN RAISE EXCEPTION 'c19 synthetic audit failure'; END IF; RETURN NEW; END $$`,
      );
      try {
        await h.api.pool.query(
          `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}()`,
        );
        const failedConsent = await answer(player, pending, 'CONSENT');
        reject(failedConsent, 500);
        expect(JSON.stringify(failedConsent.body)).not.toMatch(
          /c19 synthetic|audit_logs|postgres/i,
        );
        expect(await grantRow(pending.id)).toMatchObject({ status: 'PENDING', version: 1 });
        const clientRequestId = randomUUID();
        reject(
          await call(h.api, 'post', `${org()}/seasons`, {
            cookie: h.owner.cookie,
            body: {
              clientRequestId,
              name: '审计失败赛季',
              startDate: `${YEAR}-01-01`,
              endDate: `${YEAR}-02-01`,
            },
          }),
          500,
        );
        expect(
          (
            await h.api.pool.query('SELECT 1 FROM seasons WHERE client_request_id=$1', [
              clientRequestId,
            ])
          ).rowCount,
        ).toBe(0);
        const version = (await readSeason(season.id)).version;
        reject(await seasonCommand(season.id, 'CLOSE', undefined, version), 500);
        expect((await readSeason(season.id)).status).toBe('ACTIVE');
        const other = await person('audit-other');
        await bind(other, s.awayTeamId, s.awayMemberId);
        const nomineeRequest = randomUUID();
        reject(
          await nominate(s.eventId, s.awayTeamId, s.awayMemberId, other, h.owner, nomineeRequest),
          500,
        );
        expect(
          (
            await h.api.pool.query('SELECT 1 FROM season_data_grants WHERE client_request_id=$1', [
              nomineeRequest,
            ])
          ).rowCount,
        ).toBe(0);
      } finally {
        await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
        await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
      }
      // After the failure, the original request works normally.
      expect(data<SeasonDataGrantData>(await answer(player, pending, 'CONSENT')).status).toBe(
        'ACTIVE',
      );
      expect(rowFor(await board(season.id), player)?.score).toBe(2);
    });
  },
);
