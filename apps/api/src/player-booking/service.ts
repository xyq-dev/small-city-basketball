import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  BookingAppearanceData,
  BookingChangeData,
  BookingOrderData,
  BookingPlayerData,
  BookingSettingsData,
  BookingWorkspaceData,
  BookingWindow,
} from '@small-city-basketball/contracts';
import { ApplicationService, isAdministrator } from '../service.js';
import type { Actor } from '../service.js';
import { ApiError, forbidden, notFound } from '../errors.js';
import { objectInput, text } from '../validation.js';
import { expectedVersion } from '../registration-validation.js';
import {
  BUFFER_MINUTES,
  REQUEST_MINUTES,
  bookingFail,
  bookingHash,
  futureSchedule,
  id,
  insideAvailability,
  integer,
  parseCommand,
  parseCreate,
  parseProfile,
  quote,
} from './domain.js';

type Row = Record<string, any>;
type CreateRejection = { outcome: 'REJECTED'; status: number; code: string; message: string };
type CreateAttempt = { order: BookingOrderData } | { rejection: CreateRejection };
type OrderContext = {
  actor: Actor;
  order: Row;
  buyer: boolean;
  operator: boolean;
  player: boolean;
  independentOperator: boolean;
};
const iso = (v: Date | string | null): string | null =>
  v == null ? null : new Date(v).toISOString();
const terminal = new Set(['DECLINED', 'CANCELLED', 'EXPIRED', 'COMPLETED']);
const appearanceAudit = (a: Row) => ({
  appearanceId: a.id,
  profileId: a.profile_id,
  playerUserId: a.player_user_id,
  matchId: a.match_id,
  label: a.label,
  conditionText: a.condition_text,
  status: a.status,
  version: a.version,
  schedule: {
    reportAt: iso(a.report_at),
    startAt: iso(a.start_at),
    endAt: iso(a.end_at),
    venue: a.venue,
  },
  changeRequest: a.change_request,
  acceptedAt: iso(a.accepted_at),
  arrivedAt: iso(a.arrived_at),
  completedAt: iso(a.completed_at),
  quote: {
    serviceFen: a.service_fen,
    travelFen: a.travel_fen,
    accommodationFen: a.accommodation_fen,
    platformFeeFen: a.platform_fee_fen,
    totalFen: a.total_fen,
  },
});
// PostgreSQL exclusion and X12 cross-calendar triggers abort the current effects.
// Convert only this known business conflict, inside the caller's savepoint boundary.
const reservationConflict = (error: unknown) =>
  (error as { code?: string })?.code === '23P01'
    ? new ApiError(
        409,
        'BOOKING_TIME_CONFLICT',
        '球员或同城服务档期冲突，场次间需预留30分钟交通时间',
      )
    : error;
const checkVersion = (actual: number, expected: number) => {
  if (actual !== expected) bookingFail('VERSION_CONFLICT', '预约资料已更新，请刷新后核对再操作');
};

/** No payment credentials or dispatch calls exist in this module. */
export class PlayerBookingService extends ApplicationService {
  private async lockBuyerQuota(c: PoolClient, buyerUserId: string) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `scb-booking-buyer:${buyerUserId}`,
    ]);
  }
  /** Caller holds lockBuyerQuota until commit; expired requests do not consume quota. */
  private async requirePendingCapacity(c: PoolClient, buyerUserId: string, additional: number) {
    const existing = (
      await c.query<{ count: string }>(
        `SELECT count(*) FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id WHERE o.buyer_user_id=$1 AND a.status='REQUESTED' AND a.expires_at>clock_timestamp()`,
        [buyerUserId],
      )
    ).rows[0]!;
    if (Number(existing.count) + additional > 128)
      bookingFail('TOO_MANY_PENDING_BOOKINGS', '待接单场次过多，请先处理现有预约');
  }
  /** Release authentication connection before the inherited pool-based limiter. */
  private async preflight(cookie: string | undefined, namespace: string, commandId: string) {
    const identity = await this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const receipt = await c.query(
        'SELECT command_id FROM booking_operations WHERE actor_id=$1 AND command_id=$2 AND result IS NOT NULL',
        [actor.user.id, commandId],
      );
      return { userId: actor.user.id, replay: Boolean(receipt.rowCount) };
    });
    if (!identity.replay) await this.rateLimit(`booking-${namespace}:${identity.userId}`, 20, 3600);
    // Authority and receipt hash are checked again inside the following transaction.
  }
  // lockActor holds this user's SHARE lock. Offline maintenance takes that user
  // FOR UPDATE before changing roles; the runtime role table stays SELECT-only.
  private async operator(c: PoolClient, userId: string) {
    return Boolean(
      (
        await c.query(
          "SELECT p.user_id FROM platform_operators p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND p.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF u",
          [userId],
        )
      ).rowCount,
    );
  }
  private async teamAccess(c: PoolClient, actor: Actor, orgId: string, teamId: string) {
    const team = (
      await c.query<Row>(
        `SELECT t.* FROM teams t JOIN organizations o ON o.id=t.org_id AND o.status='ACTIVE' WHERE t.org_id=$1 AND t.id=$2 FOR SHARE OF t,o`,
        [orgId, teamId],
      )
    ).rows[0];
    if (!team) throw notFound();
    const member = (
      await c.query<Row>(
        "SELECT role FROM organization_memberships WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE",
        [orgId, actor.user.id],
      )
    ).rows[0];
    const grant = await c.query(
      "SELECT user_id FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
      [orgId, teamId, actor.user.id],
    );
    return {
      team,
      allowed: Boolean(grant.rowCount) || Boolean(member && isAdministrator(member.role)),
    };
  }
  private async start(
    c: PoolClient,
    actor: Actor,
    command: string,
    body: unknown,
  ): Promise<Row | null> {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `scb-booking-operation:${actor.user.id}:${command}`,
    ]);
    const hash = bookingHash(body);
    const old = (
      await c.query<Row>(
        'SELECT request_hash,result FROM booking_operations WHERE actor_id=$1 AND command_id=$2',
        [actor.user.id, command],
      )
    ).rows[0];
    if (old) {
      if (old.request_hash !== hash)
        bookingFail('IDEMPOTENCY_CONFLICT', '操作编号已用于其他预约内容');
      if (!old.result) bookingFail('OPERATION_PENDING', '原操作结果待核对，请读取预约记录');
      return old.result;
    }
    await c.query(
      'INSERT INTO booking_operations(actor_id,command_id,request_hash) VALUES($1,$2,$3)',
      [actor.user.id, command, hash],
    );
    return null;
  }
  private async finish(c: PoolClient, actor: Actor, command: string, resourceId: string) {
    await c.query(
      'UPDATE booking_operations SET result=$3::jsonb WHERE actor_id=$1 AND command_id=$2',
      [actor.user.id, command, JSON.stringify({ resourceId })],
    );
  }
  private profileDto(p: Row, privateFields = false): BookingPlayerData {
    return {
      id: p.id,
      userId: p.user_id,
      displayName: p.display_name,
      position: p.position,
      heightCm: p.height_cm,
      city: p.city,
      bio: p.bio,
      priceFen: p.price_fen,
      travelFen: p.travel_fen,
      accommodationFen: p.accommodation_fen,
      availability: p.availability,
      version: p.version,
      status: p.status,
      reviewReason: privateFields ? p.review_reason : null,
      createdAt: iso(p.created_at)!,
      updatedAt: iso(p.updated_at)!,
    };
  }
  private async expire(c: PoolClient, profileIds?: string[]) {
    await c.query(
      `UPDATE booking_appearances SET status='EXPIRED',version=version+1,cancellation_reason='球员接单时限已过',change_request=NULL,updated_at=clock_timestamp() WHERE status='REQUESTED' AND expires_at<=clock_timestamp() ${profileIds ? 'AND profile_id=ANY($1::uuid[])' : ''}`,
      profileIds ? [profileIds] : [],
    );
  }
  private async profileLock(c: PoolClient, profileId: string): Promise<Row> {
    // A player-level advisory lock serializes every calendar mutation across organizations.
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `scb-booking-player:${profileId}`,
    ]);
    const p = (
      await c.query<Row>(
        `SELECT p.*,u.status AS user_status FROM booking_profiles p JOIN users u ON u.id=p.user_id WHERE p.id=$1 FOR SHARE OF p,u`,
        [profileId],
      )
    ).rows[0];
    if (!p) throw notFound();
    return p;
  }
  private async scheduleAllowed(
    c: PoolClient,
    profile: Row,
    reportAt: string,
    endAt: string,
    now: Date,
    excludeId?: string,
  ) {
    if (profile.status !== 'APPROVED' || profile.user_status !== 'ACTIVE')
      bookingFail('PLAYER_UNAVAILABLE', '球员当前未开放预约');
    futureSchedule(reportAt, endAt, now);
    if (!insideAvailability(profile.availability as BookingWindow[], reportAt, endAt))
      bookingFail('OUTSIDE_AVAILABILITY', '该场次不在球员公布的可约档期内');
    const conflict = await c.query(
      `SELECT id FROM booking_appearances WHERE player_user_id=$1 AND status IN ('REQUESTED','ACCEPTED','ARRIVED','COMPLETED','DISPUTED') AND report_at<$3::timestamptz+interval '30 minutes' AND end_at+interval '30 minutes'>$2::timestamptz AND ($4::uuid IS NULL OR id<>$4) LIMIT 1`,
      [profile.user_id, reportAt, endAt, excludeId ?? null],
    );
    if (conflict.rowCount)
      bookingFail('BOOKING_TIME_CONFLICT', '球员档期冲突，场次间需预留30分钟交通时间');
  }
  private async eventAllowed(c: PoolClient, orgId: string, teamId: string, eventId?: string) {
    if (!eventId) return null;
    const event = (
      await c.query<Row>('SELECT * FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
        orgId,
        eventId,
      ])
    ).rows[0];
    if (!event) throw notFound();
    if (['COMPLETED', 'ARCHIVED', 'CANCELLED'].includes(event.status))
      bookingFail('EVENT_CLOSED', '该赛事已结束或关闭，不能新增预约');
    const entry = (
      await c.query<Row>(
        "SELECT * FROM entries WHERE org_id=$1 AND event_id=$2 AND team_id=$3 AND status NOT IN ('REJECTED','WITHDRAWN') FOR SHARE",
        [orgId, eventId, teamId],
      )
    ).rows[0];
    if (!entry) bookingFail('TEAM_NOT_ENTERED', '该球队尚未报名所选赛事；预约不能代替赛事报名');
    // Reservation is independent of roster registration. Frozen rosters are never altered.
    event.registration_frozen = Boolean(
      (
        await c.query('SELECT id FROM registration_freezes WHERE org_id=$1 AND event_id=$2', [
          orgId,
          eventId,
        ])
      ).rowCount,
    );
    return event;
  }
  private async representativeAllowed(
    c: PoolClient,
    profile: Row,
    teamId: string,
    eventId?: string,
  ) {
    if (!eventId) return;
    const other = await c.query(
      `SELECT a.id FROM booking_appearances a JOIN booking_orders o ON o.id=a.order_id WHERE o.event_id=$1 AND o.team_id<>$2 AND a.player_user_id=$3 AND (a.status IN ('REQUESTED','ACCEPTED','ARRIVED','COMPLETED','DISPUTED') OR a.accepted_at IS NOT NULL) LIMIT 1`,
      [eventId, teamId, profile.user_id],
    );
    if (other.rowCount)
      bookingFail(
        'EVENT_TEAM_CONFLICT',
        '该球员在同一赛事已有其他球队合作记录，需先核验代表队资格',
      );
  }
  private async officialMatch(
    c: PoolClient,
    input: { matchId?: string; startAt?: string; endAt?: string; venue: string },
    orgId: string,
    teamId: string,
    eventId?: string,
  ) {
    if (!input.matchId) return;
    const match = (
      await c.query<Row>(
        'SELECT * FROM published_matches WHERE id=$1 AND org_id=$2 AND event_id=$3 AND ($4=home_team_id OR $4=away_team_id) FOR SHARE',
        [input.matchId, orgId, eventId ?? null, teamId],
      )
    ).rows[0];
    if (!match) throw notFound();
    if (['CANCELLED', 'POSTPONED'].includes(match.status))
      bookingFail('MATCH_SCHEDULE_CHANGED', '正式比赛已取消或延期，请先确认主办方新安排');
    if (
      iso(match.starts_at) !== input.startAt ||
      iso(match.ends_at) !== input.endAt ||
      match.court_name !== input.venue
    )
      bookingFail('MATCH_SCHEDULE_CHANGED', '预约安排与正式赛程不一致，请读取最新比赛安排');
  }
  private async context(
    c: PoolClient,
    actor: Actor,
    orderId: string,
    writing: boolean | 'AUTH' = false,
  ): Promise<OrderContext> {
    const ref = (
      await c.query<Row>('SELECT org_id,team_id FROM booking_orders WHERE id=$1', [id(orderId)])
    ).rows[0];
    if (!ref) throw notFound();
    const team = await this.teamAccess(c, actor, ref.org_id, ref.team_id);
    const operator = await this.operator(c, actor.user.id);
    const player = Boolean(
      (
        await c.query(
          'SELECT id FROM booking_appearances WHERE order_id=$1 AND player_user_id=$2 LIMIT 1',
          [orderId, actor.user.id],
        )
      ).rowCount,
    );
    if (!team.allowed && !operator && !player) throw notFound();
    const order = (
      await c.query<Row>(
        `SELECT * FROM booking_orders WHERE id=$1 ${writing === 'AUTH' ? '' : `FOR ${writing ? 'UPDATE' : 'SHARE'}`}`,
        [orderId],
      )
    ).rows[0]!;
    const staff = Boolean(
      (
        await c.query(
          "SELECT user_id FROM organization_memberships WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE",
          [ref.org_id, actor.user.id],
        )
      ).rowCount,
    );
    return {
      actor,
      order,
      buyer: team.allowed,
      operator,
      player,
      independentOperator:
        operator && !team.allowed && !staff && !player && order.buyer_user_id !== actor.user.id,
    };
  }
  private async orderDto(c: PoolClient, ctx: OrderContext): Promise<BookingOrderData> {
    const rows = (
      await c.query<Row>(
        `SELECT a.*,p.display_name,p.position,p.status AS profile_status,u.status AS user_status,m.starts_at AS official_start,m.ends_at AS official_end,m.court_name AS official_venue,m.status AS official_status FROM booking_appearances a JOIN booking_profiles p ON p.id=a.profile_id JOIN users u ON u.id=a.player_user_id LEFT JOIN published_matches m ON m.id=a.match_id WHERE a.order_id=$1 ${ctx.buyer || ctx.operator ? '' : 'AND a.player_user_id=$2'} ORDER BY a.created_at,a.id`,
        ctx.buyer || ctx.operator ? [ctx.order.id] : [ctx.order.id, ctx.actor.user.id],
      )
    ).rows;
    const now = (await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
    const appearances: BookingAppearanceData[] = rows.map((source) => {
      const a =
        source.status === 'REQUESTED' && new Date(source.expires_at).getTime() <= now.getTime()
          ? { ...source, status: 'EXPIRED' }
          : source;
      const player = a.player_user_id === ctx.actor.user.id;
      const scheduleChanged =
        a.match_id !== null &&
        (iso(a.official_start) !== iso(a.start_at) ||
          iso(a.official_end) !== iso(a.end_at) ||
          a.official_venue !== a.venue ||
          ['CANCELLED', 'POSTPONED'].includes(a.official_status));
      const counterpart =
        a.change_request?.proposedByUserId !== ctx.actor.user.id &&
        (a.change_request?.proposedByRole === 'BUYER'
          ? player
          : a.change_request?.proposedByRole === 'PLAYER'
            ? ctx.buyer && !player
            : false);
      const hasChange = a.change_request !== null;
      return {
        id: a.id,
        orderId: a.order_id,
        profileId: a.profile_id,
        playerUserId: a.player_user_id,
        playerName: a.display_name,
        position: a.position,
        label: a.label,
        conditionText: a.condition_text,
        status: a.status,
        scheduleChanged,
        version: a.version,
        matchId: a.match_id,
        reportAt: iso(a.report_at),
        startAt: iso(a.start_at),
        endAt: iso(a.end_at),
        venue: a.venue,
        serviceFen: a.service_fen,
        travelFen: a.travel_fen,
        accommodationFen: a.accommodation_fen,
        bufferMinutes: BUFFER_MINUTES,
        platformFeeFen: a.platform_fee_fen,
        totalFen: a.total_fen,
        paymentStatus: 'UNAVAILABLE',
        settlementStatus: 'BLOCKED',
        expiresAt: iso(a.expires_at),
        acceptedAt: iso(a.accepted_at),
        arrivedAt: iso(a.arrived_at),
        completedAt: iso(a.completed_at),
        cancellationReason: a.cancellation_reason,
        changeRequest: a.change_request,
        capabilities: {
          canAccept:
            player &&
            !scheduleChanged &&
            a.status === 'REQUESTED' &&
            a.profile_status === 'APPROVED' &&
            a.user_status === 'ACTIVE',
          canDecline: player && ['REQUESTED', 'CONDITIONAL'].includes(a.status),
          canCancel:
            (ctx.buyer || player) && ['CONDITIONAL', 'REQUESTED', 'ACCEPTED'].includes(a.status),
          canActivate: ctx.buyer && !player && a.status === 'CONDITIONAL',
          canProposeChange:
            (ctx.buyer || player) &&
            a.status === 'ACCEPTED' &&
            !hasChange &&
            new Date(a.report_at).getTime() > now.getTime(),
          canAcceptChange: counterpart && hasChange && a.status === 'ACCEPTED',
          canRejectChange: counterpart && hasChange && a.status === 'ACCEPTED',
          canArrive:
            player &&
            !scheduleChanged &&
            a.status === 'ACCEPTED' &&
            !hasChange &&
            new Date(a.report_at).getTime() - 1800_000 <= now.getTime() &&
            now.getTime() <= new Date(a.end_at).getTime() + 86400_000,
          canComplete:
            ctx.buyer &&
            !player &&
            !scheduleChanged &&
            a.status === 'ARRIVED' &&
            new Date(a.end_at).getTime() <= now.getTime(),
          canDispute:
            (ctx.buyer || player) &&
            (['ACCEPTED', 'ARRIVED'].includes(a.status) ||
              (a.status === 'COMPLETED' &&
                now.getTime() <= new Date(a.completed_at).getTime() + 86400_000)),
          canResolveDispute: ctx.independentOperator && a.status === 'DISPUTED',
        },
      };
    });
    const confirmed = appearances.filter(
      (a) => !['CONDITIONAL', 'CANCELLED', 'DECLINED', 'EXPIRED'].includes(a.status),
    );
    const sum = (
      key: 'serviceFen' | 'travelFen' | 'accommodationFen' | 'platformFeeFen' | 'totalFen',
    ) => confirmed.reduce((v, a) => v + a[key], 0);
    const all = (
      await c.query<Row>('SELECT status,expires_at FROM booking_appearances WHERE order_id=$1', [
        ctx.order.id,
      ])
    ).rows.map((a) =>
      a.status === 'REQUESTED' && new Date(a.expires_at).getTime() <= now.getTime()
        ? 'EXPIRED'
        : a.status,
    );
    const overallStatus = all.every((s) => ['CANCELLED', 'DECLINED', 'EXPIRED'].includes(s))
      ? 'CANCELLED'
      : all.every((s) => terminal.has(s))
        ? 'COMPLETED'
        : 'ACTIVE';
    return {
      id: ctx.order.id,
      orgId: ctx.order.org_id,
      teamId: ctx.order.team_id,
      eventId: ctx.order.event_id,
      eventName: ctx.order.event_name,
      teamName: ctx.order.team_name,
      buyerUserId: ctx.order.buyer_user_id,
      scope: ctx.order.scope,
      eligibilityStatus: 'DECLARED_NOT_VERIFIED',
      eligibilityNotice:
        '参赛资格仅由双方声明，平台尚未核验。预约不等于报名、名单变更或保险审核通过，最终以主办方赛事规则及冻结名单为准。',
      status: overallStatus,
      version: ctx.order.version,
      feeBps: ctx.order.fee_bps,
      settingsVersion: ctx.order.settings_version,
      createdAt: iso(ctx.order.created_at)!,
      updatedAt: iso(ctx.order.updated_at)!,
      appearances,
      totals: {
        confirmedServiceFen: sum('serviceFen'),
        confirmedTravelFen: sum('travelFen'),
        confirmedAccommodationFen: sum('accommodationFen'),
        confirmedPlatformFeeFen: sum('platformFeeFen'),
        confirmedTotalFen: sum('totalFen'),
        conditionalTotalFen: appearances
          .filter((a) => a.status === 'CONDITIONAL')
          .reduce((v, a) => v + a.totalFen, 0),
        paidFen: 0,
        settledFen: 0,
        refundedFen: 0,
      },
    };
  }
  async workspace(cookie: string | undefined): Promise<BookingWorkspaceData> {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const operator = await this.operator(c, actor.user.id);
      const settings = (await c.query<Row>('SELECT * FROM booking_settings WHERE id FOR SHARE'))
        .rows[0]!;
      const catalog = (
        await c.query<Row>(
          "SELECT p.* FROM booking_profiles p JOIN users u ON u.id=p.user_id WHERE p.status='APPROVED' AND u.status='ACTIVE' ORDER BY p.updated_at DESC,p.id LIMIT 200",
        )
      ).rows;
      const own = (
        await c.query<Row>('SELECT * FROM booking_profiles WHERE user_id=$1', [actor.user.id])
      ).rows[0];
      const review = operator
        ? (
            await c.query<Row>(
              "SELECT * FROM booking_profiles WHERE status IN ('PENDING','APPROVED','REJECTED','DISABLED') ORDER BY CASE WHEN status='PENDING' THEN 0 ELSE 1 END,updated_at DESC,id LIMIT 200",
            )
          ).rows
        : [];
      const teams = (
        await c.query<Row>(
          `SELECT t.id,t.org_id,t.name FROM teams t JOIN organizations o ON o.id=t.org_id AND o.status='ACTIVE' WHERE EXISTS(SELECT 1 FROM team_access_grants g WHERE g.org_id=t.org_id AND g.team_id=t.id AND g.user_id=$1 AND g.status='ACTIVE') OR EXISTS(SELECT 1 FROM organization_memberships m WHERE m.org_id=t.org_id AND m.user_id=$1 AND m.status='ACTIVE' AND m.role IN ('ORG_OWNER','ORG_ADMIN')) ORDER BY t.name,t.id LIMIT 200`,
          [actor.user.id],
        )
      ).rows;
      const teamIds = teams.map((t) => t.id);
      const events = teamIds.length
        ? (
            await c.query<Row>(
              `SELECT DISTINCT e.id,e.org_id,e.name,e.status FROM events e JOIN entries n ON n.org_id=e.org_id AND n.event_id=e.id WHERE n.team_id=ANY($1::uuid[]) AND n.status NOT IN ('REJECTED','WITHDRAWN') ORDER BY e.name,e.id LIMIT 200`,
              [teamIds],
            )
          ).rows
        : [];
      const matches = teamIds.length
        ? (
            await c.query<Row>(
              'SELECT * FROM published_matches WHERE home_team_id=ANY($1::uuid[]) OR away_team_id=ANY($1::uuid[]) ORDER BY starts_at,id LIMIT 300',
              [teamIds],
            )
          ).rows
        : [];
      const refs = (
        await c.query<Row>(
          `SELECT DISTINCT o.id,o.created_at FROM booking_orders o JOIN organizations org ON org.id=o.org_id AND org.status='ACTIVE' WHERE $3::boolean OR o.team_id=ANY($2::uuid[]) OR EXISTS(SELECT 1 FROM booking_appearances a WHERE a.order_id=o.id AND a.player_user_id=$1) ORDER BY o.created_at DESC,o.id DESC LIMIT 101`,
          [actor.user.id, teamIds, operator],
        )
      ).rows;
      const orders: BookingOrderData[] = [];
      for (const ref of refs.slice(0, 100))
        orders.push(await this.orderDto(c, await this.context(c, actor, ref.id)));
      return {
        viewerUserId: actor.user.id,
        isPlatformOperator: operator,
        paymentAvailable: false,
        paymentNotice:
          '球员撮合支付及分账尚未开通。这里只记录预约与履约，所有实收、退款到账和结算金额均为0；统计仅包含当前最新100份可见预约。',
        settings: { feeBps: settings.fee_bps, version: settings.version },
        players: catalog.map((p) => this.profileDto(p)),
        ownProfile: own ? this.profileDto(own, true) : null,
        reviewQueue: review.map((p) => this.profileDto(p, true)),
        teams: teams.map((t) => ({ id: t.id, orgId: t.org_id, name: t.name })),
        events: events.map((e) => ({ id: e.id, orgId: e.org_id, name: e.name, status: e.status })),
        matches: matches.map((m) => ({
          id: m.id,
          orgId: m.org_id,
          eventId: m.event_id,
          homeTeamId: m.home_team_id,
          awayTeamId: m.away_team_id,
          label: `${m.home_team_name} vs ${m.away_team_name}`,
          startAt: iso(m.starts_at)!,
          endAt: iso(m.ends_at)!,
          venue: m.court_name,
        })),
        orders,
        ordersHasMore: refs.length > 100,
        statistics: {
          orders: orders.length,
          completedAppearances: orders
            .flatMap((o) => o.appearances)
            .filter((a) => a.status === 'COMPLETED').length,
          quotedPlatformFeeFen: orders.reduce((v, o) => v + o.totals.confirmedPlatformFeeFen, 0),
          collectedPlatformFeeFen: 0,
          settledPlayerFen: 0,
        },
      };
    });
  }
  async getOrder(cookie: string | undefined, orderId: string): Promise<BookingOrderData> {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      return this.orderDto(c, await this.context(c, actor, orderId));
    });
  }
  async putProfile(cookie: string | undefined, raw: unknown): Promise<BookingPlayerData> {
    const input = parseProfile(raw);
    await this.preflight(cookie, 'profile', input.commandId);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `scb-booking-profile:${actor.user.id}`,
      ]);
      const replay = await this.start(c, actor, input.commandId, { op: 'profile', input });
      let profile = (
        await c.query<Row>('SELECT * FROM booking_profiles WHERE user_id=$1 FOR UPDATE', [
          actor.user.id,
        ])
      ).rows[0];
      if (replay) return this.profileDto(profile!, true);
      checkVersion(profile?.version ?? 0, input.expectedVersion);
      const values = [
        input.displayName,
        input.position,
        input.heightCm,
        input.city,
        input.bio,
        input.priceFen,
        input.travelFen,
        input.accommodationFen ?? 0,
        JSON.stringify(input.availability),
      ];
      if (!profile) {
        profile = (
          await c.query<Row>(
            `INSERT INTO booking_profiles(id,user_id,display_name,position,height_cm,city,bio,price_fen,travel_fen,accommodation_fen,availability) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
            [randomUUID(), actor.user.id, ...values],
          )
        ).rows[0]!;
      } else {
        profile = (
          await c.query<Row>(
            `UPDATE booking_profiles SET display_name=$2,position=$3,height_cm=$4,city=$5,bio=$6,price_fen=$7,travel_fen=$8,accommodation_fen=$9,availability=$10::jsonb,status='PENDING',review_reason=NULL,reviewed_by=NULL,reviewed_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
            [profile.id, ...values],
          )
        ).rows[0]!;
      }
      await this.audit(
        c,
        actor.user.id,
        null,
        'BOOKING_PROFILE_SUBMIT',
        'booking_profile',
        profile.id,
      );
      await this.finish(c, actor, input.commandId, profile.id);
      return this.profileDto(profile, true);
    });
  }
  async reviewProfile(
    cookie: string | undefined,
    profileId: string,
    raw: unknown,
  ): Promise<BookingPlayerData> {
    const v = objectInput(raw, ['commandId', 'expectedVersion', 'status', 'reason']);
    const command = id(v.commandId);
    const version = expectedVersion(v.expectedVersion);
    if (!['APPROVED', 'REJECTED', 'DISABLED'].includes(String(v.status)))
      bookingFail('VALIDATION_ERROR', '请选择有效审核结果', 422);
    const reason = text(v.reason, 'reason', 2, 500);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      if (!(await this.operator(c, actor.user.id))) throw forbidden();
      const replay = await this.start(c, actor, command, { op: 'review', profileId, v });
      const p = (
        await c.query<Row>(
          "SELECT p.* FROM booking_profiles p JOIN users u ON u.id=p.user_id AND u.status='ACTIVE' WHERE p.id=$1 FOR UPDATE OF p",
          [id(profileId)],
        )
      ).rows[0];
      if (!p) throw notFound();
      if (p.user_id === actor.user.id) throw forbidden();
      if (replay) return this.profileDto(p, true);
      checkVersion(p.version, version);
      const result = (
        await c.query<Row>(
          'UPDATE booking_profiles SET status=$2,review_reason=$3,reviewed_by=$4,reviewed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
          [p.id, v.status, reason, actor.user.id],
        )
      ).rows[0]!;
      await this.audit(c, actor.user.id, null, 'BOOKING_PROFILE_REVIEW', 'booking_profile', p.id, {
        status: v.status,
        reason,
      });
      await this.finish(c, actor, command, p.id);
      return this.profileDto(result, true);
    });
  }
  async putSettings(cookie: string | undefined, raw: unknown): Promise<BookingSettingsData> {
    const v = objectInput(raw, ['commandId', 'expectedVersion', 'feeBps']);
    const command = id(v.commandId);
    const version = expectedVersion(v.expectedVersion);
    const feeBps = integer(v.feeBps, 'feeBps', 0, 10_000);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      if (!(await this.operator(c, actor.user.id))) throw forbidden();
      const replay = await this.start(c, actor, command, { op: 'settings', v });
      const settings = (await c.query<Row>('SELECT * FROM booking_settings WHERE id FOR UPDATE'))
        .rows[0]!;
      if (replay) return { feeBps: settings.fee_bps, version: settings.version };
      checkVersion(settings.version, version);
      await c.query(
        'UPDATE booking_settings SET fee_bps=$1,updated_by=$2,version=version+1,updated_at=clock_timestamp() WHERE id',
        [feeBps, actor.user.id],
      );
      await this.audit(
        c,
        actor.user.id,
        null,
        'BOOKING_FEE_UPDATE',
        'booking_settings',
        '00000000-0000-4000-8000-000000000006',
        { previousFeeBps: settings.fee_bps, feeBps },
      );
      await this.finish(c, actor, command, 'settings');
      return { feeBps, version: settings.version + 1 };
    });
  }
  async createOrder(cookie: string | undefined, raw: unknown): Promise<BookingOrderData> {
    const input = parseCreate(raw);
    await this.preflight(cookie, 'create', input.commandId);
    const outcome = await this.transaction<CreateAttempt>(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const access = await this.teamAccess(c, actor, input.orgId, input.teamId);
      if (!access.allowed) throw notFound();
      await this.lockBuyerQuota(c, actor.user.id);
      const replay = await this.start(c, actor, input.commandId, { op: 'create', input });
      if (replay) {
        if (replay.outcome === 'REJECTED') return { rejection: replay as CreateRejection };
        return { order: await this.orderDto(c, await this.context(c, actor, replay.resourceId)) };
      }
      // The operation row and buyer/command locks precede this savepoint.
      // A terminal business rejection must survive rollback of partial effects.
      await c.query('SAVEPOINT booking_create_effects');
      try {
        await this.requirePendingCapacity(
          c,
          actor.user.id,
          input.appearances.filter((a) => !a.conditional).length,
        );
        const event = await this.eventAllowed(c, input.orgId, input.teamId, input.eventId);
        const profiles = new Map<string, Row>();
        for (const profileId of [...new Set(input.appearances.map((a) => a.profileId))].sort())
          profiles.set(profileId, await this.profileLock(c, profileId));
        await this.expire(c, [...profiles.keys()]);
        const settings = (await c.query<Row>('SELECT * FROM booking_settings WHERE id FOR SHARE'))
          .rows[0]!;
        if (
          settings.version !== input.reviewedSettingsVersion ||
          [...profiles.values()].some((p) => input.reviewedProfileVersions[p.id] !== p.version)
        )
          bookingFail('QUOTE_CHANGED', '球员报价或平台费率已变化，请重新读取并确认后再提交预约');
        const now = (await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
        const orderId = randomUUID();
        await c.query(
          `INSERT INTO booking_orders(id,org_id,team_id,event_id,event_name,team_name,buyer_user_id,scope,fee_bps,settings_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            orderId,
            input.orgId,
            input.teamId,
            input.eventId ?? null,
            event?.name ?? input.eventName,
            access.team.name,
            actor.user.id,
            input.scope,
            settings.fee_bps,
            settings.version,
          ],
        );
        for (const appearance of input.appearances) {
          const profile = profiles.get(appearance.profileId)!;
          if (profile.user_id === actor.user.id)
            bookingFail('SELF_BOOKING_NOT_ALLOWED', '不能预约自己的参赛服务');
          if (profile.status !== 'APPROVED' || profile.user_status !== 'ACTIVE')
            bookingFail('PLAYER_UNAVAILABLE', '球员当前未开放预约');
          await this.representativeAllowed(c, profile, input.teamId, input.eventId);
          await this.officialMatch(c, appearance, input.orgId, input.teamId, input.eventId);
          if (!appearance.conditional)
            await this.scheduleAllowed(c, profile, appearance.reportAt!, appearance.endAt!, now);
          const price = quote(
            profile.price_fen,
            profile.travel_fen,
            profile.accommodation_fen,
            settings.fee_bps,
          );
          await c.query(
            `INSERT INTO booking_appearances(id,order_id,profile_id,player_user_id,match_id,label,condition_text,status,report_at,start_at,end_at,venue,service_fen,travel_fen,accommodation_fen,platform_fee_fen,total_fen,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,CASE WHEN $8='REQUESTED' THEN clock_timestamp()+interval '20 minutes' ELSE NULL END)`,
            [
              randomUUID(),
              orderId,
              profile.id,
              profile.user_id,
              appearance.matchId ?? null,
              appearance.label,
              appearance.conditionText ?? null,
              appearance.conditional ? 'CONDITIONAL' : 'REQUESTED',
              appearance.reportAt ?? null,
              appearance.startAt ?? null,
              appearance.endAt ?? null,
              appearance.venue,
              price.serviceFen,
              price.travelFen,
              price.accommodationFen,
              price.platformFeeFen,
              price.totalFen,
            ],
          );
        }
        const initialAppearances = (
          await c.query<Row>(
            'SELECT * FROM booking_appearances WHERE order_id=$1 ORDER BY created_at,id',
            [orderId],
          )
        ).rows;
        await this.audit(
          c,
          actor.user.id,
          input.orgId,
          'BOOKING_CREATE',
          'booking_order',
          orderId,
          {
            scope: input.scope,
            appearanceCount: input.appearances.length,
            appointments: initialAppearances.map(appearanceAudit),
            feeBps: settings.fee_bps,
            eligibilityDeclaration: true,
            paymentAvailable: false,
          },
        );
        await this.finish(c, actor, input.commandId, orderId);
        const order = await this.orderDto(c, await this.context(c, actor, orderId));
        await c.query('RELEASE SAVEPOINT booking_create_effects');
        return { order };
      } catch (sourceError) {
        const error = reservationConflict(sourceError);
        if (!(error instanceof ApiError) || error.status < 400 || error.status >= 500) throw error;
        await c.query('ROLLBACK TO SAVEPOINT booking_create_effects');
        await c.query('RELEASE SAVEPOINT booking_create_effects');
        const rejection: CreateRejection = {
          outcome: 'REJECTED',
          status: error.status,
          code: error.code,
          message: error.message,
        };
        await c.query(
          'UPDATE booking_operations SET result=$3::jsonb WHERE actor_id=$1 AND command_id=$2',
          [actor.user.id, input.commandId, JSON.stringify(rejection)],
        );
        await this.audit(
          c,
          actor.user.id,
          input.orgId,
          'BOOKING_CREATE_REJECTED',
          'booking_command',
          input.commandId,
          { commandId: input.commandId, status: rejection.status, code: rejection.code },
        );
        return { rejection };
      }
    });
    // A marker is emitted only after transaction() has confirmed COMMIT.
    // SQL/unexpected/5xx failures and authorization/hash failures above never receive it.
    if ('rejection' in outcome)
      throw new ApiError(
        outcome.rejection.status,
        outcome.rejection.code,
        outcome.rejection.message,
        { bookingCreateOutcome: 'REJECTED', commandId: input.commandId },
      );
    return outcome.order;
  }
  async command(
    cookie: string | undefined,
    orderId: string,
    raw: unknown,
  ): Promise<BookingOrderData> {
    const input = parseCommand(raw);
    const outcome = await this.transaction<CreateAttempt>(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const ctx = await this.context(c, actor, orderId, 'AUTH');
      // Recheck current authority before even reading an idempotency receipt.
      const ref = (
        await c.query<Row>(
          'SELECT profile_id,player_user_id FROM booking_appearances WHERE id=$1 AND order_id=$2',
          [input.appearanceId, ctx.order.id],
        )
      ).rows[0];
      if (!ref) throw notFound();
      const player = ref.player_user_id === actor.user.id;
      if (!ctx.buyer && !player && !(input.type === 'RESOLVE_DISPUTE' && ctx.independentOperator))
        throw forbidden();
      // The original buyer owns this order's quota, even when another authorized
      // leader activates it. Match create's quota -> operation -> order -> player lock order.
      if (
        input.type === 'ACTIVATE' ||
        (input.type === 'RESOLVE_DISPUTE' && input.resolution === 'RESUME')
      )
        await this.lockBuyerQuota(c, ctx.order.buyer_user_id);
      const replay = await this.start(c, actor, input.commandId, { op: 'command', orderId, input });
      ctx.order = (
        await c.query<Row>('SELECT * FROM booking_orders WHERE id=$1 FOR UPDATE', [ctx.order.id])
      ).rows[0]!;
      const profile = await this.profileLock(c, ref.profile_id);
      await this.expire(c, [profile.id]);
      if (replay) {
        if (replay.outcome === 'REJECTED') return { rejection: replay as CreateRejection };
        return { order: await this.orderDto(c, ctx) };
      }
      await c.query('SAVEPOINT booking_command_effects');
      try {
        const a = (
          await c.query<Row>(
            'SELECT * FROM booking_appearances WHERE id=$1 AND order_id=$2 FOR UPDATE',
            [input.appearanceId, ctx.order.id],
          )
        ).rows[0]!;
        checkVersion(a.version, input.expectedVersion);
        const dto = await this.orderDto(c, ctx);
        const current = dto.appearances.find((x) => x.id === a.id)!;
        const capability: Record<string, keyof BookingAppearanceData['capabilities']> = {
          ACCEPT: 'canAccept',
          DECLINE: 'canDecline',
          CANCEL: 'canCancel',
          ACTIVATE: 'canActivate',
          PROPOSE_CHANGE: 'canProposeChange',
          ACCEPT_CHANGE: 'canAcceptChange',
          REJECT_CHANGE: 'canRejectChange',
          ARRIVE: 'canArrive',
          COMPLETE: 'canComplete',
          DISPUTE: 'canDispute',
          RESOLVE_DISPUTE: 'canResolveDispute',
        };
        if (!current.capabilities[capability[input.type]!])
          bookingFail('BOOKING_ACTION_NOT_ALLOWED', '当前身份或场次状态不允许此操作');
        const now = (await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
        let status = a.status;
        let reportAt = iso(a.report_at),
          startAt = iso(a.start_at),
          endAt = iso(a.end_at),
          venue = a.venue;
        let expiresAt = iso(a.expires_at),
          acceptedAt = iso(a.accepted_at),
          arrivedAt = iso(a.arrived_at),
          completedAt = iso(a.completed_at);
        let change: BookingChangeData | null = a.change_request;
        let cancellationReason = a.cancellation_reason;
        if (input.type === 'ACCEPT') {
          await this.scheduleAllowed(c, profile, reportAt!, endAt!, now, a.id);
          await this.eventAllowed(
            c,
            ctx.order.org_id,
            ctx.order.team_id,
            ctx.order.event_id ?? undefined,
          );
          await this.officialMatch(
            c,
            { matchId: a.match_id ?? undefined, startAt: startAt!, endAt: endAt!, venue },
            ctx.order.org_id,
            ctx.order.team_id,
            ctx.order.event_id ?? undefined,
          );
          await this.representativeAllowed(
            c,
            profile,
            ctx.order.team_id,
            ctx.order.event_id ?? undefined,
          );
          status = 'ACCEPTED';
          acceptedAt = now.toISOString();
          expiresAt = null;
        } else if (input.type === 'DECLINE' || input.type === 'CANCEL') {
          status = input.type === 'DECLINE' ? 'DECLINED' : 'CANCELLED';
          cancellationReason = input.reason;
          change = null;
        } else if (input.type === 'ACTIVATE') {
          await this.requirePendingCapacity(c, ctx.order.buyer_user_id, 1);
          await this.eventAllowed(
            c,
            ctx.order.org_id,
            ctx.order.team_id,
            ctx.order.event_id ?? undefined,
          );
          await this.representativeAllowed(
            c,
            profile,
            ctx.order.team_id,
            ctx.order.event_id ?? undefined,
          );
          await this.scheduleAllowed(c, profile, input.reportAt!, input.endAt!, now, a.id);
          status = 'REQUESTED';
          reportAt = input.reportAt!;
          startAt = input.startAt!;
          endAt = input.endAt!;
          venue = input.venue!;
          expiresAt = new Date(now.getTime() + REQUEST_MINUTES * 60_000).toISOString();
        } else if (input.type === 'PROPOSE_CHANGE') {
          await this.scheduleAllowed(c, profile, input.reportAt!, input.endAt!, now, a.id);
          change = {
            proposedByUserId: actor.user.id,
            proposedByRole: player ? 'PLAYER' : 'BUYER',
            reportAt: input.reportAt!,
            startAt: input.startAt!,
            endAt: input.endAt!,
            venue: input.venue!,
            reason: input.reason!,
            createdAt: now.toISOString(),
          };
        } else if (input.type === 'ACCEPT_CHANGE') {
          await this.scheduleAllowed(c, profile, change!.reportAt, change!.endAt, now, a.id);
          reportAt = change!.reportAt;
          startAt = change!.startAt;
          endAt = change!.endAt;
          venue = change!.venue;
          change = null;
        } else if (input.type === 'REJECT_CHANGE') {
          change = null;
        } else if (input.type === 'ARRIVE') {
          await this.officialMatch(
            c,
            { matchId: a.match_id ?? undefined, startAt: startAt!, endAt: endAt!, venue },
            ctx.order.org_id,
            ctx.order.team_id,
            ctx.order.event_id ?? undefined,
          );
          status = 'ARRIVED';
          arrivedAt = now.toISOString();
        } else if (input.type === 'COMPLETE') {
          await this.officialMatch(
            c,
            { matchId: a.match_id ?? undefined, startAt: startAt!, endAt: endAt!, venue },
            ctx.order.org_id,
            ctx.order.team_id,
            ctx.order.event_id ?? undefined,
          );
          status = 'COMPLETED';
          completedAt = now.toISOString();
        } else if (input.type === 'DISPUTE') {
          status = 'DISPUTED';
          cancellationReason = input.reason;
          change = null;
        } else if (input.type === 'RESOLVE_DISPUTE') {
          cancellationReason = input.reason;
          change = null;
          if (input.resolution === 'CANCEL') status = 'CANCELLED';
          else if (input.resolution === 'COMPLETE') {
            if (!arrivedAt || !endAt || Date.parse(endAt) > now.getTime())
              bookingFail(
                'COMPLETION_NOT_PROVEN',
                '须先有球员报到记录且服务时段已结束，才能确认服务完成',
              );
            await this.officialMatch(
              c,
              { matchId: a.match_id ?? undefined, startAt: startAt!, endAt: endAt!, venue },
              ctx.order.org_id,
              ctx.order.team_id,
              ctx.order.event_id ?? undefined,
            );
            status = 'COMPLETED';
            completedAt = now.toISOString();
          } else {
            if (!reportAt || !endAt || completedAt)
              bookingFail('BOOKING_ACTION_NOT_ALLOWED', '该争议场次不能恢复履约');
            if (!arrivedAt) await this.scheduleAllowed(c, profile, reportAt, endAt, now, a.id);
            status = arrivedAt ? 'ARRIVED' : acceptedAt ? 'ACCEPTED' : 'REQUESTED';
            if (status === 'REQUESTED') {
              await this.requirePendingCapacity(c, ctx.order.buyer_user_id, 1);
              expiresAt = new Date(now.getTime() + REQUEST_MINUTES * 60_000).toISOString();
            }
          }
        }
        // A change to an official match cannot silently keep a stale match link.
        const matchId = a.match_id;
        if (['ACTIVATE', 'ACCEPT_CHANGE'].includes(input.type) && matchId) {
          await this.officialMatch(
            c,
            { matchId, startAt: startAt!, endAt: endAt!, venue },
            ctx.order.org_id,
            ctx.order.team_id,
            ctx.order.event_id ?? undefined,
          );
        }
        await c.query(
          `UPDATE booking_appearances SET status=$2,report_at=$3,start_at=$4,end_at=$5,venue=$6,expires_at=$7,accepted_at=$8,arrived_at=$9,completed_at=$10,change_request=$11::jsonb,cancellation_reason=$12,version=version+1,updated_at=clock_timestamp() WHERE id=$1`,
          [
            a.id,
            status,
            reportAt,
            startAt,
            endAt,
            venue,
            expiresAt,
            acceptedAt,
            arrivedAt,
            completedAt,
            change ? JSON.stringify(change) : null,
            cancellationReason,
          ],
        );
        const statuses = (
          await c.query<{ status: string }>(
            'SELECT status FROM booking_appearances WHERE order_id=$1',
            [ctx.order.id],
          )
        ).rows;
        const orderStatus = statuses.every((x) =>
          ['CANCELLED', 'DECLINED', 'EXPIRED'].includes(x.status),
        )
          ? 'CANCELLED'
          : statuses.every((x) => terminal.has(x.status))
            ? 'COMPLETED'
            : 'ACTIVE';
        ctx.order = (
          await c.query<Row>(
            'UPDATE booking_orders SET status=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
            [ctx.order.id, orderStatus],
          )
        ).rows[0]!;
        await this.audit(
          c,
          actor.user.id,
          ctx.order.org_id,
          `BOOKING_${input.type}`,
          'booking_appearance',
          a.id,
          {
            reason: input.reason ?? null,
            resolution: input.resolution ?? null,
            previousVersion: a.version,
            paymentAvailable: false,
            before: appearanceAudit(a),
            after: appearanceAudit({
              ...a,
              status,
              version: a.version + 1,
              report_at: reportAt,
              start_at: startAt,
              end_at: endAt,
              venue,
              accepted_at: acceptedAt,
              arrived_at: arrivedAt,
              completed_at: completedAt,
              change_request: change,
            }),
          },
        );
        await this.finish(c, actor, input.commandId, ctx.order.id);
        const order = await this.orderDto(c, ctx);
        await c.query('RELEASE SAVEPOINT booking_command_effects');
        return { order };
      } catch (sourceError) {
        const error = reservationConflict(sourceError);
        // Preserve existing command semantics for all other business/SQL failures.
        if ((sourceError as { code?: string })?.code !== '23P01' || !(error instanceof ApiError))
          throw sourceError;
        await c.query('ROLLBACK TO SAVEPOINT booking_command_effects');
        await c.query('RELEASE SAVEPOINT booking_command_effects');
        const rejection: CreateRejection = {
          outcome: 'REJECTED',
          status: error.status,
          code: error.code,
          message: error.message,
        };
        await c.query(
          'UPDATE booking_operations SET result=$3::jsonb WHERE actor_id=$1 AND command_id=$2',
          [actor.user.id, input.commandId, JSON.stringify(rejection)],
        );
        await this.audit(
          c,
          actor.user.id,
          ctx.order.org_id,
          'BOOKING_COMMAND_REJECTED',
          'booking_command',
          input.commandId,
          {
            commandId: input.commandId,
            type: input.type,
            status: rejection.status,
            code: rejection.code,
          },
        );
        return { rejection };
      }
    });
    if ('rejection' in outcome)
      throw new ApiError(
        outcome.rejection.status,
        outcome.rejection.code,
        outcome.rejection.message,
        { bookingCommandOutcome: 'REJECTED', commandId: input.commandId },
      );
    return outcome.order;
  }
}
