import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type {
  BookingAppearanceData,
  BookingAppearanceInput,
  BookingCommandInput,
  BookingCreateInput,
  BookingOrderData,
  BookingPlayerData,
  BookingProfileInput,
  BookingWorkspaceData,
  TeamData,
} from '@small-city-basketball/contracts';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword } from '../src/security.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { grant, registration, team } from './p03-support.js';
import { frozen } from './p04-support.js';
import { ORIGIN, PASSWORD, RUN_ID, call, data, error, login, testDatabaseUrl } from './support.js';
import type { Api, User } from './support.js';

const root = '/v1/player-bookings';
const why = '合成球员预约隔离核验';
const base = Date.now();
const at = (milliseconds: number) => new Date(milliseconds).toISOString();
const days = (value: number) => value * 86400000;
type BookingDraft = Omit<
  BookingCreateInput,
  'reviewedSettingsVersion' | 'reviewedProfileVersions'
> &
  Partial<Pick<BookingCreateInput, 'reviewedSettingsVersion' | 'reviewedProfileVersions'>>;

describe(
  'C06 player reservations over real isolated PostgreSQL and HTTP',
  { concurrent: false },
  () => {
    let api: Api;
    let owner: User;
    let otherOwner: User;
    let leader: User;
    let outsider: User;
    let operator: User;
    let player: User;
    let firstTeam: TeamData;
    let secondTeam: TeamData;
    let mainProfile: BookingPlayerData;
    let passwordHash: string;
    let serial = 0;

    async function actor(label: string, withOrganization = false): Promise<User> {
      const user: User = {
        id: randomUUID(),
        orgId: withOrganization ? randomUUID() : '',
        email: `c06-${label}-${RUN_ID}-${++serial}@example.test`,
        cookie: '',
      };
      await api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [user.id, user.email, `合成预约${label}`, passwordHash],
      );
      if (withOrganization) {
        await api.pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
          user.orgId,
          `合成预约机构${label}-${serial}`,
        ]);
        await api.pool.query(
          "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
          [user.orgId, user.id],
        );
      }
      user.cookie = await login(api, user);
      return user;
    }

    function profileInput(overrides: Partial<BookingProfileInput> = {}): BookingProfileInput {
      return {
        commandId: randomUUID(),
        expectedVersion: 0,
        displayName: '合成控球后卫',
        position: 'PG',
        heightCm: 182,
        city: '合成高州',
        bio: `仅合成资料-${RUN_ID}`,
        priceFen: 30000,
        travelFen: 0,
        accommodationFen: 0,
        availability: [{ startAt: at(base - days(1)), endAt: at(base + days(30)) }],
        adultConfirmed: true,
        ...overrides,
      };
    }

    async function workspace(user = leader): Promise<BookingWorkspaceData> {
      return data<BookingWorkspaceData>(
        await call(api, 'get', `${root}/workspace`, { cookie: user.cookie }),
      );
    }

    async function submitProfile(user: User, input = profileInput()) {
      return data<BookingPlayerData>(
        await call(api, 'put', `${root}/profile`, { cookie: user.cookie, body: input }),
      );
    }

    async function review(profile: BookingPlayerData, status = 'APPROVED', user = operator) {
      return call(api, 'post', `${root}/profiles/${profile.id}/review`, {
        cookie: user.cookie,
        body: { commandId: randomUUID(), expectedVersion: profile.version, status, reason: why },
      });
    }

    function appearance(index: number, profileId = mainProfile.id): BookingAppearanceInput {
      const report = base + days(index + 2);
      return {
        profileId,
        label: `合成场次 ${index}`,
        reportAt: at(report),
        startAt: at(report + 30 * 60000),
        endAt: at(report + 150 * 60000),
        venue: '合成石鼓测试球场',
        conditional: false,
      };
    }

    function orderInput(
      appearances: BookingAppearanceInput[],
      overrides: Partial<BookingDraft> = {},
    ): BookingDraft {
      return {
        commandId: randomUUID(),
        orgId: owner.orgId,
        teamId: firstTeam.id,
        eventName: '合成青锋杯',
        scope: appearances.length === 1 ? 'SINGLE' : 'MULTI',
        eligibilityConfirmed: true,
        appearances,
        ...overrides,
      };
    }

    async function create(input: BookingDraft, user = leader) {
      const visible = await workspace(user);
      const reviewedProfileVersions =
        input.reviewedProfileVersions ??
        Object.fromEntries(
          input.appearances.map((item) => {
            const profile = visible.players.find((value) => value.id === item.profileId);
            expect(
              profile,
              'the fixture must review the current published quote before ordering',
            ).toBeDefined();
            return [item.profileId, profile!.version];
          }),
        );
      const body: BookingCreateInput = {
        ...input,
        reviewedSettingsVersion: input.reviewedSettingsVersion ?? visible.settings.version,
        reviewedProfileVersions,
      };
      return call(api, 'post', `${root}/orders`, { cookie: user.cookie, body });
    }

    async function seedPendingQuota(profile: BookingPlayerData, count: number) {
      const settings = (
        await api.pool.query('SELECT fee_bps,version FROM booking_settings WHERE id')
      ).rows[0]!;
      const orderId = randomUUID();
      await api.pool.query(
        `INSERT INTO booking_orders(id,org_id,team_id,event_name,team_name,buyer_user_id,scope,fee_bps,settings_version) VALUES($1,$2,$3,$4,$5,$6,'MULTI',$7,$8)`,
        [
          orderId,
          owner.orgId,
          firstTeam.id,
          '合成额度边界赛事',
          firstTeam.name,
          leader.id,
          settings.fee_bps,
          settings.version,
        ],
      );
      const fee = Math.round((profile.priceFen * settings.fee_bps) / 10000);
      // Populate only this test's synthetic valid rows. Do not alter the limiter,
      // clear another buyer's requests, or create 128 slow HTTP orders.
      await api.pool.query(
        `INSERT INTO booking_appearances(id,order_id,profile_id,player_user_id,label,status,report_at,start_at,end_at,venue,service_fen,travel_fen,accommodation_fen,platform_fee_fen,total_fen,expires_at)
         SELECT gen_random_uuid(),$1,$2,$3,'合成额度占用 '||slot,'REQUESTED',
           $4::timestamptz+slot*interval '3 hours',
           $4::timestamptz+slot*interval '3 hours'+interval '30 minutes',
           $4::timestamptz+slot*interval '3 hours'+interval '90 minutes',
           '合成额度测试球场',$5,$6,$7,$8,$9,clock_timestamp()+interval '20 minutes'
         FROM generate_series(0,$10::integer-1) slot`,
        [
          orderId,
          profile.id,
          profile.userId,
          at(base + days(1)),
          profile.priceFen,
          profile.travelFen,
          profile.accommodationFen,
          fee,
          profile.priceFen + profile.travelFen + profile.accommodationFen + fee,
          count,
        ],
      );
      return orderId;
    }

    async function pendingQuota(buyerUserId = leader.id) {
      return Number(
        (
          await api.pool.query(
            `SELECT count(*) AS count FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id WHERE o.buyer_user_id=$1 AND a.status='REQUESTED' AND a.expires_at>clock_timestamp()`,
            [buyerUserId],
          )
        ).rows[0]!.count,
      );
    }

    async function fresh(id: string, user = leader) {
      const order = (await workspace(user)).orders.find((value) => value.id === id);
      expect(order, 'the current actor must see the reservation').toBeDefined();
      return order!;
    }

    async function command(
      order: BookingOrderData,
      item: BookingAppearanceData,
      type: BookingCommandInput['type'],
      user: User,
      extra: Partial<BookingCommandInput> = {},
    ) {
      return call(api, 'post', `${root}/orders/${order.id}/commands`, {
        cookie: user.cookie,
        body: {
          commandId: randomUUID(),
          expectedVersion: item.version,
          appearanceId: item.id,
          type,
          ...(['ACCEPT', 'ACTIVATE', 'ACCEPT_CHANGE'].includes(type)
            ? { eligibilityConfirmed: true }
            : {}),
          ...extra,
        },
      });
    }

    beforeAll(async () => {
      const databaseUrl = testDatabaseUrl();
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        await migrate(pool);
      } finally {
        await pool.end();
      }
      api = await createApi({ databaseUrl, appOrigin: ORIGIN });
      passwordHash = await hashPassword(PASSWORD);
      owner = await actor('owner', true);
      otherOwner = await actor('other-owner', true);
      leader = await actor('leader');
      outsider = await actor('outsider');
      operator = await actor('operator');
      player = await actor('player');
      await maintainPlatformOperator(api.pool, {
        email: operator.email,
        status: 'ACTIVE',
        reason: why,
      });
      firstTeam = await team(api, owner, '合成预约球队甲', leader);
      secondTeam = await team(api, otherOwner, '合成预约球队乙');
      mainProfile = data<BookingPlayerData>(await review(await submitProfile(player)));
    }, 90000);

    beforeEach(async () => {
      // Each case has a synthetic authorized buyer and a separate normal booking
      // limiter budget. Production limits are never disabled or rewritten.
      leader = await actor('case-leader');
      await grant(api, owner, firstTeam, leader);
    });

    afterAll(async () => {
      if (api) {
        await api.app.close();
        await api.pool.end();
      }
    }, 30000);

    test('private routes require a current session and writes preserve the Origin guard', async () => {
      error(await call(api, 'get', `${root}/workspace`), 401);
      error(
        await call(api, 'put', `${root}/profile`, {
          cookie: player.cookie,
          body: profileInput(),
          origin: null,
        }),
        403,
      );
      error(
        await call(api, 'put', `${root}/profile`, {
          cookie: player.cookie,
          body: profileInput(),
          origin: 'https://different.example.test',
        }),
        403,
      );
    });

    test('workspace gives the leader only authorized teams and never labels unavailable payments as collected income', async () => {
      const value = await workspace();
      expect(value.viewerUserId).toBe(leader.id);
      expect(value.isPlatformOperator).toBe(false);
      expect(value.teams.map((item) => item.id)).toContain(firstTeam.id);
      expect(value.teams.map((item) => item.id)).not.toContain(secondTeam.id);
      expect(value.paymentAvailable).toBe(false);
      expect(value.paymentNotice).toEqual(expect.any(String));
      expect(value.reviewQueue).toEqual([]);
      expect(value.statistics).toMatchObject({ collectedPlatformFeeFen: 0, settledPlayerFen: 0 });
    });

    test('profile submission is bound to the authenticated user, cannot self-approve, and pending data stays out of the marketplace', async () => {
      const input = profileInput({ bio: `PRIVATE_PENDING_${RUN_ID}` });
      const pending = await submitProfile(outsider, input);
      expect(pending).toMatchObject({ userId: outsider.id, status: 'PENDING', version: 1 });
      expect((await workspace(outsider)).ownProfile?.id).toBe(pending.id);
      expect((await workspace()).players.map((item) => item.id)).not.toContain(pending.id);
      expect(JSON.stringify((await workspace()).players)).not.toContain(input.bio);
      error(await review(pending, 'APPROVED', outsider), 403);
      error(
        await call(api, 'put', `${root}/profile`, {
          cookie: outsider.cookie,
          body: {
            ...input,
            commandId: randomUUID(),
            expectedVersion: pending.version,
            userId: player.id,
            status: 'APPROVED',
          },
        }),
        422,
      );
      const approved = data<BookingPlayerData>(await review(pending));
      expect(approved.status).toBe('APPROVED');
      expect((await workspace()).players.map((item) => item.id)).toContain(pending.id);
    });

    test('even a platform operator cannot approve their own provider profile', async () => {
      const pending = await submitProfile(
        operator,
        profileInput({ displayName: '合成待独立审核球员' }),
      );
      error(await review(pending), 403);
      expect((await workspace(operator)).ownProfile?.status).toBe('PENDING');
    });

    test('profile commands are idempotent and reject reused keys with different content or stale versions', async () => {
      const provider = await actor('profile-idempotent');
      const input = profileInput();
      const first = await submitProfile(provider, input);
      expect(await submitProfile(provider, input)).toEqual(first);
      const different = await call(api, 'put', `${root}/profile`, {
        cookie: provider.cookie,
        body: { ...input, city: '另一合成城市' },
      });
      error(different, 409);
      error(
        await call(api, 'put', `${root}/profile`, {
          cookie: provider.cookie,
          body: { ...input, commandId: randomUUID(), expectedVersion: 0 },
        }),
        409,
      );
    });

    test('money, adulthood consent, and calendar intervals are validated on the server', async () => {
      const invalidInputs = [
        { priceFen: 0.5 },
        { priceFen: -1 },
        { travelFen: -1 },
        { adultConfirmed: false },
        { availability: [{ startAt: at(base + days(2)), endAt: at(base + days(1)) }] },
      ];
      for (const change of invalidInputs) {
        error(
          await call(api, 'put', `${root}/profile`, {
            cookie: player.cookie,
            body: { ...profileInput({ expectedVersion: mainProfile.version }), ...change },
          }),
          422,
        );
      }
    });

    test('the service calculates the 10% fee itself and does not accept caller price or payment overrides', async () => {
      const input = orderInput([appearance(1)]);
      const value = data<BookingOrderData>(await create(input));
      expect(value).toMatchObject({
        orgId: owner.orgId,
        teamId: firstTeam.id,
        buyerUserId: leader.id,
        feeBps: 1000,
      });
      expect(value.appearances[0]).toMatchObject({
        serviceFen: 30000,
        platformFeeFen: 3000,
        travelFen: 0,
        accommodationFen: 0,
        totalFen: 33000,
        status: 'REQUESTED',
        paymentStatus: 'UNAVAILABLE',
        settlementStatus: 'BLOCKED',
      });
      expect(value.totals).toMatchObject({
        confirmedTotalFen: 33000,
        paidFen: 0,
        settledFen: 0,
        refundedFen: 0,
      });
      error(
        await create({
          ...orderInput([appearance(2)]),
          feeBps: 0,
          paidFen: 33000,
        } as BookingCreateInput),
        422,
      );
    });

    test('travel and accommodation are separate quote items and are not included in the service-fee base', async () => {
      const provider = await actor('travel');
      const profile = data<BookingPlayerData>(
        await review(
          await submitProfile(provider, profileInput({ travelFen: 1200, accommodationFen: 2400 })),
        ),
      );
      const order = data<BookingOrderData>(await create(orderInput([appearance(3, profile.id)])));
      expect(order.appearances[0]).toMatchObject({
        serviceFen: 30000,
        platformFeeFen: 3000,
        travelFen: 1200,
        accommodationFen: 2400,
        totalFen: 36600,
      });
    });

    test('no caller can book another organization team or a pending/unavailable profile', async () => {
      error(
        await create(
          orderInput([appearance(4)], { orgId: otherOwner.orgId, teamId: secondTeam.id }),
        ),
        404,
      );
      const pending = (await workspace(operator)).ownProfile!;
      expect(pending.status).toBe('PENDING');
      error(
        await create(
          orderInput([appearance(4, pending.id)], {
            reviewedProfileVersions: { [pending.id]: pending.version },
          }),
        ),
        409,
      );
      const outsideCalendar = appearance(4);
      outsideCalendar.reportAt = at(base + days(365));
      outsideCalendar.startAt = at(base + days(365) + 30 * 60000);
      outsideCalendar.endAt = at(base + days(365) + 150 * 60000);
      error(await create(orderInput([outsideCalendar])), 409);
    });

    test('private orders are absent for outsiders and commands cannot target another organization order', async () => {
      const order = data<BookingOrderData>(await create(orderInput([appearance(5)])));
      expect((await workspace(outsider)).orders.map((value) => value.id)).not.toContain(order.id);
      expect((await workspace(otherOwner)).orders.map((value) => value.id)).not.toContain(order.id);
      error(await command(order, order.appearances[0]!, 'CANCEL', outsider, { reason: why }), 404);
      error(
        await command(order, order.appearances[0]!, 'CANCEL', otherOwner, { reason: why }),
        404,
      );
    });

    test('an existing frozen tournament records a declared service booking without changing its approved roster or claiming eligibility verification', async () => {
      const teams = [
        await team(api, owner, '合成冻结预约球队甲', leader, ['合成甲', '合成乙']),
        await team(api, owner, '合成冻结预约球队乙', leader, ['合成丙', '合成丁']),
      ];
      const target = appearance(24);
      const current = await frozen(
        {
          api,
          owner,
          otherOwner,
          leader,
          teams,
          otherTeams: [],
          databaseUrl: testDatabaseUrl(),
          nextDate: 0,
        },
        owner,
        teams,
        {
          startDate: target.reportAt!.slice(0, 10),
          endDate: at(Date.parse(target.reportAt!) + days(2)).slice(0, 10),
        },
      );
      const before = await registration(api, owner, current.event.id);
      const order = data<BookingOrderData>(
        await create(orderInput([target], { teamId: teams[0]!.id, eventId: current.event.id })),
      );
      expect(order.eventId).toBe(current.event.id);
      expect(order.eligibilityStatus).toBe('DECLARED_NOT_VERIFIED');
      expect(order.eligibilityNotice).toEqual(expect.any(String));
      const after = await registration(api, owner, current.event.id);
      expect(after.event.version).toBe(before.event.version);
      expect(after.freeze).toEqual(before.freeze);
    });

    test('conditional tournament appearances disclose estimated amounts without occupying a calendar slot', async () => {
      const condition: BookingAppearanceInput = {
        profileId: mainProfile.id,
        label: '晋级后半决赛',
        conditionText: '小组出线后且赛程另行确认',
        venue: '合成待定球场',
        conditional: true,
      };
      const order = data<BookingOrderData>(
        await create(orderInput([appearance(6), condition], { scope: 'TOURNAMENT' })),
      );
      expect(order.appearances.map((item) => item.status)).toEqual(['REQUESTED', 'CONDITIONAL']);
      expect(order.totals).toMatchObject({ confirmedTotalFen: 33000, conditionalTotalFen: 33000 });
      const other = data<BookingOrderData>(await create(orderInput([appearance(7)])));
      expect(other.appearances[0]?.status).toBe('REQUESTED');
      const conditional = order.appearances.find((item) => item.status === 'CONDITIONAL')!;
      const requested = appearance(8);
      const activated = data<BookingOrderData>(
        await command(order, conditional, 'ACTIVATE', leader, {
          reportAt: requested.reportAt,
          startAt: requested.startAt,
          endAt: requested.endAt,
          venue: requested.venue,
          eligibilityConfirmed: true,
        }),
      );
      expect(activated.appearances.find((item) => item.id === conditional.id)).toMatchObject({
        status: 'REQUESTED',
        acceptedAt: null,
      });
      expect(activated.totals.conditionalTotalFen).toBe(0);
      expect(activated.totals.confirmedTotalFen).toBe(66000);
    });

    test('concurrent reservations for the same player/time create exactly one order across organizations', async () => {
      const same = appearance(9);
      const firstInput = orderInput([same]);
      const secondInput = orderInput([same], { orgId: otherOwner.orgId, teamId: secondTeam.id });
      const responses = await Promise.all([create(firstInput), create(secondInput, otherOwner)]);
      expect(responses.map((value) => value.status).sort()).toEqual([200, 409]);
      const successful = data<BookingOrderData>(responses.find((value) => value.status === 200)!);
      const rows = (
        await api.pool.query(
          'SELECT id FROM booking_appearances WHERE profile_id=$1 AND report_at=$2',
          [mainProfile.id, same.reportAt],
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(successful.appearances[0]?.id);
    });

    test('one conflicting appearance rolls back the entire multi-match request, including its free slot', async () => {
      const taken = appearance(10);
      data(await create(orderInput([taken])));
      const free = appearance(11);
      const before = (await workspace()).orders.length;
      error(await create(orderInput([free, taken])), 409);
      expect((await workspace()).orders.length).toBe(before);
      const retry = data<BookingOrderData>(await create(orderInput([free])));
      expect(retry.appearances).toHaveLength(1);
    });

    test('the transport buffer prevents back-to-back matches until thirty minutes after the first ends', async () => {
      const first = appearance(12);
      data(await create(orderInput([first])));
      const next = appearance(12);
      next.reportAt = at(Date.parse(first.endAt!) + 29 * 60000);
      next.startAt = at(Date.parse(next.reportAt) + 30 * 60000);
      next.endAt = at(Date.parse(next.reportAt) + 150 * 60000);
      error(await create(orderInput([next])), 409);
      next.reportAt = at(Date.parse(first.endAt!) + 30 * 60000);
      next.startAt = at(Date.parse(next.reportAt) + 30 * 60000);
      next.endAt = at(Date.parse(next.reportAt) + 150 * 60000);
      expect(data<BookingOrderData>(await create(orderInput([next]))).appearances[0]?.status).toBe(
        'REQUESTED',
      );
    });

    test('only the actual player can accept, and CAS and idempotency preserve the single accepted result', async () => {
      const order = data<BookingOrderData>(await create(orderInput([appearance(13)])));
      const item = order.appearances[0]!;
      error(await command(order, item, 'ACCEPT', leader), 409);
      const body: BookingCommandInput = {
        commandId: randomUUID(),
        expectedVersion: item.version,
        appearanceId: item.id,
        type: 'ACCEPT',
        eligibilityConfirmed: true,
      };
      const accepted = data<BookingOrderData>(
        await call(api, 'post', `${root}/orders/${order.id}/commands`, {
          cookie: player.cookie,
          body,
        }),
      );
      expect(accepted.appearances[0]).toMatchObject({
        status: 'ACCEPTED',
        acceptedAt: expect.any(String),
      });
      expect(
        data(
          await call(api, 'post', `${root}/orders/${order.id}/commands`, {
            cookie: player.cookie,
            body,
          }),
        ),
      ).toEqual(accepted);
      error(await command(order, item, 'DECLINE', player, { reason: why }), 409);
      error(
        await call(api, 'post', `${root}/orders/${order.id}/commands`, {
          cookie: player.cookie,
          body: { ...body, type: 'DECLINE', reason: why },
        }),
        409,
      );
    });

    test('one appearance can be cancelled without cancelling the rest or inventing a refund', async () => {
      const order = data<BookingOrderData>(
        await create(orderInput([appearance(14), appearance(15)])),
      );
      const cancelled = data<BookingOrderData>(
        await command(order, order.appearances[0]!, 'CANCEL', leader, { reason: why }),
      );
      expect(cancelled.appearances[0]?.status).toBe('CANCELLED');
      expect(cancelled.appearances[1]?.status).toBe('REQUESTED');
      expect(cancelled.status).toBe('ACTIVE');
      expect(cancelled.totals).toMatchObject({ paidFen: 0, refundedFen: 0, settledFen: 0 });
      expect(
        data<BookingOrderData>(await create(orderInput([appearance(14)]))).appearances[0]?.status,
      ).toBe('REQUESTED');
    });

    test('a proposed change does not silently alter the booking and requires acceptance from the other party', async () => {
      let order = data<BookingOrderData>(await create(orderInput([appearance(16)])));
      order = data<BookingOrderData>(await command(order, order.appearances[0]!, 'ACCEPT', player));
      const original = order.appearances[0]!;
      const replacement = appearance(17);
      order = data<BookingOrderData>(
        await command(order, original, 'PROPOSE_CHANGE', leader, {
          reportAt: replacement.reportAt,
          startAt: replacement.startAt,
          endAt: replacement.endAt,
          venue: '合成调整后球场',
          reason: why,
        }),
      );
      expect(order.appearances[0]?.reportAt).toBe(original.reportAt);
      expect(order.appearances[0]?.changeRequest).toMatchObject({
        proposedByUserId: leader.id,
        proposedByRole: 'BUYER',
      });
      error(await command(order, order.appearances[0]!, 'ACCEPT_CHANGE', leader), 409);
      const sameSideLeader = await actor('same-side-leader');
      await grant(api, owner, firstTeam, sameSideLeader);
      error(await command(order, order.appearances[0]!, 'ACCEPT_CHANGE', sameSideLeader), 409);
      order = data<BookingOrderData>(
        await command(order, order.appearances[0]!, 'ACCEPT_CHANGE', player),
      );
      expect(order.appearances[0]).toMatchObject({
        reportAt: replacement.reportAt,
        venue: '合成调整后球场',
        changeRequest: null,
      });
    });

    test('changes recheck conflicts atomically and leave the original slot and pending proposal intact on failure', async () => {
      let first = data<BookingOrderData>(await create(orderInput([appearance(18)])));
      first = data<BookingOrderData>(await command(first, first.appearances[0]!, 'ACCEPT', player));
      const taken = appearance(19);
      const before = first.appearances[0]!;
      first = data<BookingOrderData>(
        await command(first, before, 'PROPOSE_CHANGE', leader, {
          reportAt: taken.reportAt,
          startAt: taken.startAt,
          endAt: taken.endAt,
          venue: taken.venue,
          reason: why,
        }),
      );
      // A proposal does not occupy its new slot. Another legitimate reservation
      // may win it before the counterpart accepts, so acceptance must recheck.
      data(await create(orderInput([taken])));
      error(await command(first, first.appearances[0]!, 'ACCEPT_CHANGE', player), 409);
      const current = (await fresh(first.id)).appearances[0]!;
      expect(current.reportAt).toBe(before.reportAt);
      expect(current.changeRequest).not.toBeNull();
    });

    test('revoking a team grant blocks replay of a previously successful create command before returning its receipt', async () => {
      const temporary = await actor('revoked-leader');
      await grant(api, owner, firstTeam, temporary);
      const input = orderInput([appearance(20)]);
      const created = data<BookingOrderData>(await create(input, temporary));
      await grant(api, owner, firstTeam, temporary, 'DISABLED');
      error(await create(input, temporary), 404);
      expect((await workspace(temporary)).orders.map((value) => value.id)).not.toContain(
        created.id,
      );
    });

    test('revoked platform rights cannot replay a successful settings change and old orders retain their fee snapshot', async () => {
      const before = (await workspace(operator)).settings;
      const old = data<BookingOrderData>(await create(orderInput([appearance(21)])));
      const staleQuote = orderInput([appearance(26)], {
        reviewedSettingsVersion: before.version,
        reviewedProfileVersions: { [mainProfile.id]: mainProfile.version },
      });
      const body = { commandId: randomUUID(), expectedVersion: before.version, feeBps: 1250 };
      data(await call(api, 'put', `${root}/settings`, { cookie: operator.cookie, body }));
      try {
        const stale = await create(staleQuote);
        error(stale, 409);
        expect(stale.body.error.code).toBe('QUOTE_CHANGED');
        const newer = data<BookingOrderData>(await create(orderInput([appearance(22)])));
        expect(newer.feeBps).toBe(1250);
        expect(newer.appearances[0]?.platformFeeFen).toBe(3750);
        const unchanged = await fresh(old.id);
        expect(unchanged.feeBps).toBe(old.feeBps);
        expect(unchanged.appearances[0]?.platformFeeFen).toBe(old.appearances[0]?.platformFeeFen);
        await maintainPlatformOperator(api.pool, {
          email: operator.email,
          status: 'DISABLED',
          reason: why,
        });
        error(await call(api, 'put', `${root}/settings`, { cookie: operator.cookie, body }), 403);
      } finally {
        await maintainPlatformOperator(api.pool, {
          email: operator.email,
          status: 'ACTIVE',
          reason: why,
        });
        const current = (await workspace(operator)).settings;
        data(
          await call(api, 'put', `${root}/settings`, {
            cookie: operator.cookie,
            body: {
              commandId: randomUUID(),
              expectedVersion: current.version,
              feeBps: before.feeBps,
            },
          }),
        );
      }
    });

    test('a committed EVENT_CLOSED rejection is replayed after reopening and only a new command can create the reservation', async () => {
      const provider = await actor('terminal-rejection');
      const profile = data<BookingPlayerData>(await review(await submitProfile(provider)));
      const teams = [
        await team(api, owner, '合成终态拒绝球队甲', leader, ['合成甲', '合成乙']),
        await team(api, owner, '合成终态拒绝球队乙', leader, ['合成丙', '合成丁']),
      ];
      const target = appearance(18, profile.id);
      const fixture = await frozen(
        {
          api,
          owner,
          otherOwner,
          leader,
          teams,
          otherTeams: [],
          databaseUrl: testDatabaseUrl(),
          nextDate: 0,
        },
        owner,
        teams,
        {
          startDate: target.reportAt!.slice(0, 10),
          endDate: at(Date.parse(target.reportAt!) + days(2)).slice(0, 10),
        },
      );
      const visible = await workspace();
      const body: BookingCreateInput = {
        ...orderInput([target], { teamId: teams[0]!.id, eventId: fixture.event.id }),
        reviewedSettingsVersion: visible.settings.version,
        reviewedProfileVersions: { [profile.id]: profile.version },
      };
      // Vary only this owned synthetic event to exercise a stable business
      // rejection; this is not a production lifecycle shortcut.
      await api.pool.query(
        "UPDATE events SET status='COMPLETED',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [fixture.event.id],
      );
      const first = await call(api, 'post', `${root}/orders`, { cookie: leader.cookie, body });
      error(first, 409);
      expect(first.body.error).toMatchObject({
        code: 'EVENT_CLOSED',
        details: { bookingCreateOutcome: 'REJECTED', commandId: body.commandId },
      });
      const receipt = (
        await api.pool.query(
          'SELECT request_hash,result,created_at FROM booking_operations WHERE actor_id=$1 AND command_id=$2',
          [leader.id, body.commandId],
        )
      ).rows[0]!;
      expect(receipt.result).toMatchObject({
        outcome: 'REJECTED',
        status: 409,
        code: 'EVENT_CLOSED',
      });
      expect(
        Number(
          (
            await api.pool.query('SELECT count(*) FROM booking_orders WHERE buyer_user_id=$1', [
              leader.id,
            ])
          ).rows[0]!.count,
        ),
      ).toBe(0);
      await api.pool.query(
        "UPDATE events SET status='REGISTRATION_CLOSED',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [fixture.event.id],
      );
      const replay = await call(api, 'post', `${root}/orders`, { cookie: leader.cookie, body });
      error(replay, 409);
      expect(replay.body.error).toMatchObject({
        code: 'EVENT_CLOSED',
        message: first.body.error.message,
        details: { bookingCreateOutcome: 'REJECTED', commandId: body.commandId },
      });
      expect(
        (
          await api.pool.query(
            'SELECT request_hash,result,created_at FROM booking_operations WHERE actor_id=$1 AND command_id=$2',
            [leader.id, body.commandId],
          )
        ).rows[0],
      ).toEqual(receipt);
      await grant(api, owner, teams[0]!, leader, 'DISABLED');
      try {
        const denied = await call(api, 'post', `${root}/orders`, { cookie: leader.cookie, body });
        error(denied, 404);
        expect(denied.body.error.details?.bookingCreateOutcome).toBeUndefined();
      } finally {
        await grant(api, owner, teams[0]!, leader, 'ACTIVE');
      }
      const conflict = await call(api, 'post', `${root}/orders`, {
        cookie: leader.cookie,
        body: { ...body, eventName: '不同的合成请求' },
      });
      error(conflict, 409);
      expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(conflict.body.error.details?.bookingCreateOutcome).toBeUndefined();
      expect(
        Number(
          (
            await api.pool.query('SELECT count(*) FROM booking_orders WHERE buyer_user_id=$1', [
              leader.id,
            ])
          ).rows[0]!.count,
        ),
      ).toBe(0);
      const created = data<BookingOrderData>(
        await call(api, 'post', `${root}/orders`, {
          cookie: leader.cookie,
          body: { ...body, commandId: randomUUID() },
        }),
      );
      expect(created.eventId).toBe(fixture.event.id);
      expect(created.appearances[0]?.status).toBe('REQUESTED');
    });

    test('a post-start multi-slot conflict rolls back every partial order effect before committing its terminal rejection receipt', async () => {
      const provider = await actor('partial-rejection');
      const profile = data<BookingPlayerData>(await review(await submitProfile(provider)));
      const first = appearance(19, profile.id);
      const second: BookingAppearanceInput = {
        ...first,
        label: '合成冲突的第二项',
        reportAt: at(Date.parse(first.reportAt!) + 60000),
      };
      const visible = await workspace();
      const body: BookingCreateInput = {
        ...orderInput([first, second]),
        reviewedSettingsVersion: visible.settings.version,
        reviewedProfileVersions: { [profile.id]: profile.version },
      };
      const rejected = await call(api, 'post', `${root}/orders`, { cookie: leader.cookie, body });
      error(rejected, 409);
      expect(rejected.body.error).toMatchObject({
        code: 'BOOKING_TIME_CONFLICT',
        details: { bookingCreateOutcome: 'REJECTED', commandId: body.commandId },
      });
      expect(
        Number(
          (
            await api.pool.query('SELECT count(*) FROM booking_orders WHERE buyer_user_id=$1', [
              leader.id,
            ])
          ).rows[0]!.count,
        ),
      ).toBe(0);
      expect(
        Number(
          (
            await api.pool.query('SELECT count(*) FROM booking_appearances WHERE profile_id=$1', [
              profile.id,
            ])
          ).rows[0]!.count,
        ),
      ).toBe(0);
      expect(
        (
          await api.pool.query(
            'SELECT result FROM booking_operations WHERE actor_id=$1 AND command_id=$2',
            [leader.id, body.commandId],
          )
        ).rows[0]!.result,
      ).toMatchObject({ outcome: 'REJECTED', code: 'BOOKING_TIME_CONFLICT' });
      expect(
        Number(
          (
            await api.pool.query(
              "SELECT count(*) FROM audit_logs WHERE actor_id=$1 AND action='BOOKING_CREATE'",
              [leader.id],
            )
          ).rows[0]!.count,
        ),
      ).toBe(0);
      const corrected = data<BookingOrderData>(
        await call(api, 'post', `${root}/orders`, {
          cookie: leader.cookie,
          body: { ...body, commandId: randomUUID(), scope: 'SINGLE', appearances: [first] },
        }),
      );
      expect(corrected.appearances[0]?.status).toBe('REQUESTED');
    });

    test('a lost successful creation response is reconciled with the original command and quote even after the provider changes price', async () => {
      const provider = await actor('lost-create-ack');
      const profile = data<BookingPlayerData>(await review(await submitProfile(provider)));
      const visible = await workspace();
      const body: BookingCreateInput = {
        ...orderInput(
          [
            {
              profileId: profile.id,
              label: '合成未定期合作',
              conditional: true,
              conditionText: '等待晋级后确认',
              venue: '合成待定球场',
            },
          ],
          { scope: 'TOURNAMENT' },
        ),
        reviewedSettingsVersion: visible.settings.version,
        reviewedProfileVersions: { [profile.id]: profile.version },
      };
      // Treat the first successful HTTP response as discarded by the caller.
      // The original request remains the only safe reconciliation envelope.
      const lost = await call(api, 'post', `${root}/orders`, { cookie: leader.cookie, body });
      const original = data<BookingOrderData>(lost);
      await submitProfile(
        provider,
        profileInput({ expectedVersion: profile.version, priceFen: 40000 }),
      );
      const replay = data<BookingOrderData>(
        await call(api, 'post', `${root}/orders`, { cookie: leader.cookie, body }),
      );
      expect(replay.id).toBe(original.id);
      expect(replay.appearances[0]?.serviceFen).toBe(30000);
      expect(
        Number(
          (
            await api.pool.query('SELECT count(*) FROM booking_orders WHERE buyer_user_id=$1', [
              leader.id,
            ])
          ).rows[0]!.count,
        ),
      ).toBe(1);
      expect(
        (
          await api.pool.query(
            'SELECT result FROM booking_operations WHERE actor_id=$1 AND command_id=$2',
            [leader.id, body.commandId],
          )
        ).rows[0]!.result,
      ).toEqual({ resourceId: original.id });
    });

    test('unexpected SQL or commit failure rolls back the whole attempt without a terminal marker and permits safe same-command reconciliation', async () => {
      const provider = await actor('sql-create-failure');
      const profile = data<BookingPlayerData>(await review(await submitProfile(provider)));
      const visible = await workspace();
      const body: BookingCreateInput = {
        ...orderInput([appearance(20, profile.id)]),
        reviewedSettingsVersion: visible.settings.version,
        reviewedProfileVersions: { [profile.id]: profile.version },
      };
      const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
      const functionName = `c06_owned_create_fault_${suffix}`;
      const triggerName = `c06_owned_create_fault_${suffix}`;
      try {
        // This unique trigger only faults this fixture buyer; existing guards
        // remain intact and no production schema or migration is modified.
        await api.pool.query(
          `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned synthetic booking failure'; END; $$`,
        );
        await api.pool.query(
          `CREATE TRIGGER ${triggerName} BEFORE INSERT ON booking_orders FOR EACH ROW WHEN (NEW.buyer_user_id='${leader.id}'::uuid) EXECUTE FUNCTION ${functionName}()`,
        );
        const failed = await call(api, 'post', `${root}/orders`, { cookie: leader.cookie, body });
        error(failed, 500);
        expect(failed.body.error.details?.bookingCreateOutcome).toBeUndefined();
        expect(
          Number(
            (
              await api.pool.query(
                'SELECT count(*) FROM booking_operations WHERE actor_id=$1 AND command_id=$2',
                [leader.id, body.commandId],
              )
            ).rows[0]!.count,
          ),
        ).toBe(0);
        expect(
          Number(
            (
              await api.pool.query('SELECT count(*) FROM booking_orders WHERE buyer_user_id=$1', [
                leader.id,
              ])
            ).rows[0]!.count,
          ),
        ).toBe(0);
      } finally {
        await api.pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON booking_orders`);
        await api.pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      }
      const bulkId = await seedPendingQuota(profile, 128);
      try {
        // Fail the actual COMMIT of a would-be terminal rejection. The response
        // must remain uncertain because the rejection receipt never committed.
        await api.pool.query(
          `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned synthetic rejection commit failure'; END; $$`,
        );
        await api.pool.query(
          `CREATE CONSTRAINT TRIGGER ${triggerName} AFTER UPDATE ON booking_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.actor_id='${leader.id}'::uuid AND NEW.result->>'outcome'='REJECTED') EXECUTE FUNCTION ${functionName}()`,
        );
        const commitFailed = await call(api, 'post', `${root}/orders`, {
          cookie: leader.cookie,
          body,
        });
        error(commitFailed, 500);
        expect(commitFailed.body.error.details?.bookingCreateOutcome).toBeUndefined();
        expect(
          Number(
            (
              await api.pool.query(
                'SELECT count(*) FROM booking_operations WHERE actor_id=$1 AND command_id=$2',
                [leader.id, body.commandId],
              )
            ).rows[0]!.count,
          ),
        ).toBe(0);
      } finally {
        await api.pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON booking_operations`);
        await api.pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      }
      const bulk = data<BookingOrderData>(
        await call(api, 'get', `${root}/orders/${bulkId}`, { cookie: leader.cookie }),
      );
      data(await command(bulk, bulk.appearances[0]!, 'CANCEL', leader, { reason: why }));
      const reconciled = data<BookingOrderData>(
        await call(api, 'post', `${root}/orders`, { cookie: leader.cookie, body }),
      );
      expect(reconciled.appearances[0]?.status).toBe('REQUESTED');
      expect(await pendingQuota()).toBe(128);
    });

    test('conditional activation enforces the original buyer quota, rolls back at 128, and succeeds after one real cancellation', async () => {
      const provider = await actor('activation-quota');
      const profile = data<BookingPlayerData>(await review(await submitProfile(provider)));
      const conditional = data<BookingOrderData>(
        await create(
          orderInput(
            [
              {
                profileId: profile.id,
                label: '合成晋级待定场次',
                conditionText: '晋级后明确赛程',
                conditional: true,
                venue: '合成待定球场',
              },
            ],
            { scope: 'TOURNAMENT' },
          ),
        ),
      );
      const bulkId = await seedPendingQuota(profile, 128);
      expect(await pendingQuota()).toBe(128);
      const item = conditional.appearances[0]!;
      const target = appearance(25, profile.id);
      const body: BookingCommandInput = {
        commandId: randomUUID(),
        appearanceId: item.id,
        expectedVersion: item.version,
        type: 'ACTIVATE',
        eligibilityConfirmed: true,
        reportAt: target.reportAt!,
        startAt: target.startAt!,
        endAt: target.endAt!,
        venue: target.venue,
      };
      const original = (
        await api.pool.query(
          'SELECT to_jsonb(a) AS appearance,to_jsonb(o) AS booking FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id WHERE a.id=$1',
          [item.id],
        )
      ).rows[0]!;
      // The organization owner may manage the leader's order, but must still
      // consume the order's original buyer quota, not the owner's empty quota.
      const path = `${root}/orders/${conditional.id}/commands`;
      const blocked = await call(api, 'post', path, { cookie: owner.cookie, body });
      error(blocked, 409);
      expect(blocked.body.error.code).toBe('TOO_MANY_PENDING_BOOKINGS');
      expect(
        (
          await api.pool.query(
            'SELECT to_jsonb(a) AS appearance,to_jsonb(o) AS booking FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id WHERE a.id=$1',
            [item.id],
          )
        ).rows[0],
      ).toEqual(original);
      expect(
        Number(
          (
            await api.pool.query(
              'SELECT count(*) FROM booking_operations WHERE actor_id=$1 AND command_id=$2',
              [owner.id, body.commandId],
            )
          ).rows[0]!.count,
        ),
      ).toBe(0);
      expect(await pendingQuota()).toBe(128);

      const bulk = data<BookingOrderData>(
        await call(api, 'get', `${root}/orders/${bulkId}`, { cookie: leader.cookie }),
      );
      data(await command(bulk, bulk.appearances[0]!, 'CANCEL', leader, { reason: why }));
      expect(await pendingQuota()).toBe(127);
      const activated = data<BookingOrderData>(
        await call(api, 'post', path, { cookie: owner.cookie, body }),
      );
      expect(activated.appearances[0]).toMatchObject({
        id: item.id,
        status: 'REQUESTED',
        version: item.version + 1,
      });
      expect(await pendingQuota()).toBe(128);
      const replay = data<BookingOrderData>(
        await call(api, 'post', path, { cookie: owner.cookie, body }),
      );
      expect(replay.appearances[0]).toMatchObject({
        id: item.id,
        status: 'REQUESTED',
        version: item.version + 1,
      });
      expect(await pendingQuota()).toBe(128);
    });

    test('concurrent fixed creation and another manager activating a conditional share one 128-request buyer budget', async () => {
      const provider = await actor('activation-create-race');
      const profile = data<BookingPlayerData>(await review(await submitProfile(provider)));
      const conditional = data<BookingOrderData>(
        await create(
          orderInput(
            [
              {
                profileId: profile.id,
                label: '合成并发晋级场次',
                conditionText: '晋级后确定',
                conditional: true,
                venue: '合成待定球场',
              },
            ],
            { scope: 'TOURNAMENT' },
          ),
        ),
      );
      await seedPendingQuota(profile, 127);
      const visible = await workspace();
      const target = appearance(25, profile.id);
      const activation: BookingCommandInput = {
        commandId: randomUUID(),
        appearanceId: conditional.appearances[0]!.id,
        expectedVersion: conditional.appearances[0]!.version,
        type: 'ACTIVATE',
        eligibilityConfirmed: true,
        reportAt: target.reportAt!,
        startAt: target.startAt!,
        endAt: target.endAt!,
        venue: target.venue,
      };
      const fixed: BookingCreateInput = {
        ...orderInput([appearance(26, profile.id)]),
        reviewedSettingsVersion: visible.settings.version,
        reviewedProfileVersions: { [profile.id]: profile.version },
      };
      const results = await Promise.all([
        call(api, 'post', `${root}/orders/${conditional.id}/commands`, {
          cookie: owner.cookie,
          body: activation,
        }),
        call(api, 'post', `${root}/orders`, { cookie: leader.cookie, body: fixed }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      const denied = results.find((result) => result.status === 409)!;
      expect(denied.body.error.code).toBe('TOO_MANY_PENDING_BOOKINGS');
      expect(await pendingQuota()).toBe(128);
      const current = data<BookingOrderData>(
        await call(api, 'get', `${root}/orders/${conditional.id}`, { cookie: leader.cookie }),
      );
      expect(current.appearances[0]?.status).toBe(
        results[0]!.status === 200 ? 'REQUESTED' : 'CONDITIONAL',
      );
    });

    test('a changed provider quote requires a fresh reviewed version instead of silently increasing the buyer amount', async () => {
      const provider = await actor('quote-version');
      let profile = data<BookingPlayerData>(await review(await submitProfile(provider)));
      const observed = await workspace();
      const stale = orderInput([appearance(25, profile.id)], {
        reviewedSettingsVersion: observed.settings.version,
        reviewedProfileVersions: { [profile.id]: profile.version },
      });
      profile = await submitProfile(
        provider,
        profileInput({ expectedVersion: profile.version, priceFen: 40000 }),
      );
      profile = data<BookingPlayerData>(await review(profile));
      const changed = await create(stale);
      error(changed, 409);
      expect(changed.body.error.code).toBe('QUOTE_CHANGED');
      const confirmed = data<BookingOrderData>(
        await create(orderInput([appearance(25, profile.id)])),
      );
      expect(confirmed.appearances[0]).toMatchObject({
        serviceFen: 40000,
        platformFeeFen: 4000,
        totalFen: 44000,
      });
    });

    test('there is no public command that fabricates paid or settled money', async () => {
      const order = data<BookingOrderData>(await create(orderInput([appearance(23)])));
      for (const type of ['MARK_PAID', 'PAY', 'CONFIRM_PAYMENT', 'SETTLE']) {
        error(
          await call(api, 'post', `${root}/orders/${order.id}/commands`, {
            cookie: operator.cookie,
            body: {
              commandId: randomUUID(),
              expectedVersion: order.appearances[0]!.version,
              appearanceId: order.appearances[0]!.id,
              type,
            },
          }),
          422,
        );
      }
      const unchanged = await fresh(order.id);
      expect(unchanged.appearances[0]).toMatchObject({
        paymentStatus: 'UNAVAILABLE',
        settlementStatus: 'BLOCKED',
      });
      expect(unchanged.totals).toMatchObject({ paidFen: 0, refundedFen: 0, settledFen: 0 });
    });

    test('arrival and completion are distinct: neither premature completion nor a dispute frees a future reserved slot', async () => {
      const now = Date.now();
      const upcoming: BookingAppearanceInput = {
        profileId: mainProfile.id,
        label: '合成即将到场的履约核验',
        reportAt: at(now + 10 * 60000),
        startAt: at(now + 30 * 60000),
        endAt: at(now + 90 * 60000),
        venue: '合成履约测试球场',
        conditional: false,
      };
      let order = data<BookingOrderData>(await create(orderInput([upcoming])));
      order = data<BookingOrderData>(await command(order, order.appearances[0]!, 'ACCEPT', player));
      error(await command(order, order.appearances[0]!, 'COMPLETE', leader), 409);
      error(await command(order, order.appearances[0]!, 'ARRIVE', leader), 409);
      order = data<BookingOrderData>(await command(order, order.appearances[0]!, 'ARRIVE', player));
      expect(order.appearances[0]).toMatchObject({
        status: 'ARRIVED',
        arrivedAt: expect.any(String),
      });
      error(await command(order, order.appearances[0]!, 'COMPLETE', leader), 409);
      error(await create(orderInput([upcoming])), 409);
      order = data<BookingOrderData>(
        await command(order, order.appearances[0]!, 'DISPUTE', leader, { reason: why }),
      );
      expect(order.appearances[0]).toMatchObject({
        status: 'DISPUTED',
        settlementStatus: 'BLOCKED',
      });
      error(await create(orderInput([upcoming])), 409);
      error(await command(order, order.appearances[0]!, 'COMPLETE', leader), 409);
      expect(order.totals).toMatchObject({ paidFen: 0, settledFen: 0, refundedFen: 0 });
      order = data<BookingOrderData>(
        await command(order, order.appearances[0]!, 'RESOLVE_DISPUTE', operator, {
          reason: why,
          resolution: 'RESUME',
        }),
      );
      expect(order.appearances[0]?.status).toBe('ARRIVED');
      error(await command(order, order.appearances[0]!, 'COMPLETE', leader), 409);
      order = data<BookingOrderData>(
        await command(order, order.appearances[0]!, 'DISPUTE', player, { reason: why }),
      );
      order = data<BookingOrderData>(
        await command(order, order.appearances[0]!, 'RESOLVE_DISPUTE', operator, {
          reason: why,
          resolution: 'CANCEL',
        }),
      );
      expect(order.appearances[0]?.status).toBe('CANCELLED');
      expect(
        data<BookingOrderData>(await create(orderInput([upcoming]))).appearances[0]?.status,
      ).toBe('REQUESTED');
    });
  },
);
