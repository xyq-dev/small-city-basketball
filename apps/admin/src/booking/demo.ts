import type {
  BookingAppearanceData,
  BookingCommandInput,
  BookingCreateInput,
  BookingOrderData,
  BookingPlayerData,
  BookingProfileInput,
  BookingWorkspaceData,
} from '@small-city-basketball/contracts';
import type { BookingRepository } from './model';
import { commandId, fee } from './model';
export type DemoRole = 'buyer' | 'player' | 'operator' | 'publisher';
const clone = <T>(v: T): T => structuredClone(v);
const now = () => new Date().toISOString();
const day = (offset: number, hour = 19) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(Math.floor(hour) - 8, Math.round((hour - Math.floor(hour)) * 60), 0, 0);
  return d.toISOString();
};
const window = [{ startAt: day(-30, 0), endAt: day(120, 23) }];
const makePlayer = (
  id: string,
  name: string,
  position: BookingPlayerData['position'],
  heightCm: number,
  priceFen: number,
  bio: string,
): BookingPlayerData => ({
  id,
  userId: `demo-user-${id}`,
  displayName: name,
  position,
  heightCm,
  city: '高州 · 石鼓',
  bio,
  priceFen,
  travelFen: 0,
  accommodationFen: 0,
  availability: clone(window),
  version: 1,
  status: 'APPROVED',
  reviewReason: null,
  createdAt: now(),
  updatedAt: now(),
});
export function createDemoBookingRepository() {
  let role: DemoRole = 'buyer';
  let settings = { feeBps: 1000, version: 1 };
  const players = [
    makePlayer(
      'demo-guard',
      '陈宇航',
      'PG',
      182,
      30000,
      '擅长组织控场、突破分球。愿意配合球队战术，认真对待每一场比赛。',
    ),
    {
      ...makePlayer(
        'demo-guard-two',
        '林泽宇',
        'PG',
        184,
        30000,
        '偏重外线接应与无球跑动，愿意承担不同战术角色。以上为本人自述，不是统计结论。',
      ),
      travelFen: 8000,
    },
    makePlayer(
      'demo-center',
      '周启明',
      'C',
      195,
      35000,
      '篮板保护、内线防守，适应阵地配合。可参加本地单场及系列赛事。',
    ),
    makePlayer(
      'demo-wing',
      '梁泽阳',
      'SF',
      188,
      28000,
      '侧翼防守与空切跑位，喜欢团队篮球，赛前可提前沟通角色。',
    ),
    {
      ...makePlayer(
        'demo-pending',
        '许嘉俊',
        'SG',
        185,
        26000,
        '外线投射和积极防守，申请加入本地球员预约。',
      ),
      status: 'PENDING' as const,
    },
  ];
  const orders: BookingOrderData[] = [];
  const receipts = new Map<string, { hash: string; value: unknown }>();
  const actor = () =>
    role === 'buyer'
      ? 'demo-buyer'
      : role === 'player'
        ? 'demo-user-demo-guard'
        : role === 'publisher'
          ? 'demo-publisher'
          : 'demo-operator';
  function cap(a: BookingAppearanceData, o: BookingOrderData) {
    const buyer = o.buyerUserId === actor(),
      player = a.playerUserId === actor();
    const active = !['DECLINED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'DISPUTED'].includes(
      a.status,
    );
    a.capabilities = {
      canAccept: player && a.status === 'REQUESTED',
      canDecline: player && a.status === 'REQUESTED',
      canCancel: (buyer || player) && active,
      canActivate: buyer && a.status === 'CONDITIONAL',
      canProposeChange:
        (buyer || player) && ['REQUESTED', 'ACCEPTED'].includes(a.status) && !a.changeRequest,
      canAcceptChange:
        (buyer || player) && !!a.changeRequest && a.changeRequest.proposedByUserId !== actor(),
      canRejectChange:
        (buyer || player) && !!a.changeRequest && a.changeRequest.proposedByUserId !== actor(),
      canArrive: player && a.status === 'ACCEPTED' && !a.changeRequest,
      canComplete: buyer && a.status === 'ARRIVED' && !a.changeRequest,
      canDispute: (buyer || player) && ['ACCEPTED', 'ARRIVED', 'COMPLETED'].includes(a.status),
      canResolveDispute: role === 'operator' && a.status === 'DISPUTED',
    };
  }
  function project(o: BookingOrderData) {
    o.appearances.forEach((a) => cap(a, o));
    const rows = o.appearances.filter(
      (a) => !['CONDITIONAL', 'DECLINED', 'CANCELLED', 'EXPIRED'].includes(a.status),
    );
    o.totals = {
      confirmedServiceFen: rows.reduce((s, a) => s + a.serviceFen, 0),
      confirmedPlatformFeeFen: rows.reduce((s, a) => s + a.platformFeeFen, 0),
      confirmedTravelFen: rows.reduce((s, a) => s + a.travelFen, 0),
      confirmedAccommodationFen: rows.reduce((s, a) => s + a.accommodationFen, 0),
      confirmedTotalFen: rows.reduce((s, a) => s + a.totalFen, 0),
      conditionalTotalFen: o.appearances
        .filter((a) => a.status === 'CONDITIONAL')
        .reduce((s, a) => s + a.totalFen, 0),
      paidFen: 0,
      settledFen: 0,
      refundedFen: 0,
    };
    o.status = o.appearances.every((a) => ['CANCELLED', 'DECLINED', 'EXPIRED'].includes(a.status))
      ? 'CANCELLED'
      : o.appearances.every((a) =>
            ['COMPLETED', 'CANCELLED', 'DECLINED', 'EXPIRED'].includes(a.status),
          )
        ? 'COMPLETED'
        : 'ACTIVE';
    return o;
  }
  function appearance(
    p: BookingPlayerData,
    label: string,
    status: BookingAppearanceData['status'],
    offset: number,
  ): BookingAppearanceData {
    const serviceFen = p.priceFen,
      platformFeeFen = fee(serviceFen, settings.feeBps);
    return {
      id: commandId(),
      bufferMinutes: 30,
      scheduleChanged: false,
      orderId: '',
      profileId: p.id,
      playerUserId: p.userId,
      playerName: p.displayName,
      position: p.position,
      label,
      conditionText: status === 'CONDITIONAL' ? '球队晋级后确认赛程' : null,
      status,
      version: 1,
      matchId: null,
      reportAt: status === 'CONDITIONAL' ? null : day(offset, 19),
      startAt: status === 'CONDITIONAL' ? null : day(offset, 19.5),
      endAt: status === 'CONDITIONAL' ? null : day(offset, 21),
      venue: '石鼓公园网红球场',
      serviceFen,
      travelFen: p.travelFen,
      accommodationFen: p.accommodationFen,
      platformFeeFen,
      totalFen: serviceFen + p.travelFen + p.accommodationFen + platformFeeFen,
      paymentStatus: 'UNAVAILABLE',
      settlementStatus: 'BLOCKED',
      expiresAt: status === 'REQUESTED' ? day(1, 23) : null,
      acceptedAt: ['ACCEPTED', 'COMPLETED', 'ARRIVED'].includes(status) ? now() : null,
      arrivedAt: status === 'COMPLETED' ? now() : null,
      completedAt: status === 'COMPLETED' ? now() : null,
      cancellationReason: null,
      changeRequest: null,
      capabilities: {} as BookingAppearanceData['capabilities'],
    };
  }
  const seed: BookingOrderData = {
    id: 'demo-series',
    orgId: 'demo-org',
    teamId: 'demo-team',
    teamName: '石鼓青锋（示例）',
    eventId: 'demo-event',
    eventName: '青锋杯（示例）',
    eligibilityStatus: 'DECLARED_NOT_VERIFIED',
    eligibilityNotice: '参赛资格仅由双方声明，尚未通过主办方核验；预约不会修改赛事报名名单。',
    buyerUserId: 'demo-buyer',
    scope: 'TOURNAMENT',
    status: 'ACTIVE',
    version: 1,
    feeBps: 1000,
    settingsVersion: 1,
    createdAt: now(),
    updatedAt: now(),
    appearances: [
      appearance(players[0]!, '小组赛 · 第1场', 'COMPLETED', -2),
      appearance(players[0]!, '小组赛 · 第2场', 'ACCEPTED', 2),
      appearance(players[0]!, '小组赛 · 第3场', 'REQUESTED', 4),
      appearance(players[0]!, '半决赛', 'CONDITIONAL', 6),
      appearance(players[0]!, '决赛', 'CONDITIONAL', 8),
    ],
    totals: {} as BookingOrderData['totals'],
  };
  seed.appearances.forEach((a) => (a.orderId = seed.id));
  orders.push(seed);
  function once<T>(id: string, input: unknown, work: () => T): T {
    const key = `${actor()}:${id}`,
      hash = JSON.stringify(input),
      previous = receipts.get(key);
    if (previous) {
      if (previous.hash !== hash) throw new Error('操作编号已用于不同资料，请重新读取。');
      return clone(previous.value as T);
    }
    const value = work();
    receipts.set(key, { hash, value: clone(value) });
    return clone(value);
  }
  function conflict(profileId: string, reportAt: string, endAt: string, exceptId?: string) {
    if (
      orders.some((o) =>
        o.appearances.some(
          (a) =>
            a.id !== exceptId &&
            a.profileId === profileId &&
            ['REQUESTED', 'ACCEPTED', 'ARRIVED'].includes(a.status) &&
            a.reportAt &&
            a.endAt &&
            Date.parse(reportAt) < Date.parse(a.endAt) + 60 * 60 * 1000 &&
            Date.parse(endAt) + 60 * 60 * 1000 > Date.parse(a.reportAt),
        ),
      )
    )
      throw new Error('球员档期冲突，请调整时间或选择其他球员。');
  }
  const repository: BookingRepository = {
    async get(id) {
      const row = orders.find(
        (o) =>
          o.id === id &&
          (role === 'operator' ||
            o.buyerUserId === actor() ||
            o.appearances.some((a) => a.playerUserId === actor())),
      );
      if (!row) throw new Error('预约不存在或当前无权查看。');
      return clone(project(row));
    },
    async workspace() {
      const visible = orders
        .filter(
          (o) =>
            role === 'operator' ||
            o.buyerUserId === actor() ||
            o.appearances.some((a) => a.playerUserId === actor()),
        )
        .map(project);
      return clone({
        viewerUserId: actor(),
        isPlatformOperator: role === 'operator',
        ordersHasMore: false,
        paymentAvailable: false,
        paymentNotice: '在线支付及分账尚未接通。当前仅记录预约与履约，不发生真实收款、退款或结算。',
        settings,
        players: players.filter((p) => p.status === 'APPROVED'),
        ownProfile: players.find((p) => p.userId === actor()) ?? null,
        reviewQueue: role === 'operator' ? players : [],
        teams:
          role === 'buyer'
            ? [{ id: 'demo-team', orgId: 'demo-org', name: '石鼓青锋（示例）' }]
            : [],
        events:
          role === 'buyer'
            ? [{ id: 'demo-event', orgId: 'demo-org', name: '青锋杯（示例）', status: 'SCHEDULED' }]
            : [],
        matches: [],
        orders: visible,
        statistics: {
          orders: visible.length,
          completedAppearances: visible
            .flatMap((o) => o.appearances)
            .filter((a) => a.status === 'COMPLETED').length,
          quotedPlatformFeeFen: visible.reduce((s, o) => s + o.totals.confirmedPlatformFeeFen, 0),
          collectedPlatformFeeFen: 0,
          settledPlayerFen: 0,
        },
      } as BookingWorkspaceData);
    },
    async saveProfile(input: BookingProfileInput) {
      return once(input.commandId, input, () => {
        const current = players.find((p) => p.userId === actor());
        if (input.expectedVersion !== (current?.version ?? 0))
          throw new Error('资料版本已变更，请重新读取。');
        const {
          commandId: _commandId,
          expectedVersion: _expectedVersion,
          adultConfirmed: _adultConfirmed,
          ...fields
        } = input;
        const row: BookingPlayerData = {
          id: current?.id ?? commandId(),
          userId: actor(),
          ...fields,
          accommodationFen: fields.accommodationFen ?? 0,
          version: (current?.version ?? 0) + 1,
          status: 'PENDING',
          reviewReason: null,
          createdAt: current?.createdAt ?? now(),
          updatedAt: now(),
        };
        if (current) Object.assign(current, row);
        else players.push(row);
        return row;
      });
    },
    async reviewProfile(id, version, status, reason, commandId) {
      return once(commandId, { id, version, status, reason }, () => {
        if (role !== 'operator') throw new Error('当前没有平台审核权限。');
        const p = players.find((x) => x.id === id);
        if (!p || p.version !== version) throw new Error('球员资料已变化，请刷新。');
        p.status = status;
        p.reviewReason = reason;
        p.version++;
        return p;
      });
    },
    async create(input: BookingCreateInput) {
      return once(input.commandId, input, () => {
        if (role !== 'buyer') throw new Error('请先切换到领队演示身份。');
        const next: BookingOrderData = {
          id: commandId(),
          orgId: input.orgId,
          teamId: input.teamId,
          teamName: '石鼓青锋（示例）',
          eventId: input.eventId ?? null,
          eventName: input.eventName,
          eligibilityStatus: 'DECLARED_NOT_VERIFIED',
          eligibilityNotice: '参赛资格仅由双方声明，尚未通过主办方核验；预约不会修改赛事报名名单。',
          buyerUserId: actor(),
          scope: input.scope,
          status: 'ACTIVE',
          version: 1,
          feeBps: settings.feeBps,
          settingsVersion: settings.version,
          createdAt: now(),
          updatedAt: now(),
          appearances: [],
          totals: {} as BookingOrderData['totals'],
        };
        for (const entry of input.appearances) {
          const p = players.find((x) => x.id === entry.profileId && x.status === 'APPROVED');
          if (!p) throw new Error('球员当前不可预约。');
          if (!entry.conditional) {
            if (
              !entry.reportAt ||
              !entry.startAt ||
              !entry.endAt ||
              Date.parse(entry.reportAt) > Date.parse(entry.startAt) ||
              Date.parse(entry.startAt) >= Date.parse(entry.endAt)
            )
              throw new Error('请检查报到、开赛与结束时间。');
            conflict(p.id, entry.reportAt, entry.endAt);
            if (
              next.appearances.some(
                (a) =>
                  a.profileId === p.id &&
                  a.reportAt &&
                  a.endAt &&
                  Date.parse(entry.reportAt!) < Date.parse(a.endAt) &&
                  Date.parse(entry.endAt!) > Date.parse(a.reportAt),
              )
            )
              throw new Error('本次预约的场次有时间重叠。');
          }
          const a = appearance(p, entry.label, entry.conditional ? 'CONDITIONAL' : 'REQUESTED', 0);
          Object.assign(a, {
            orderId: next.id,
            matchId: entry.matchId ?? null,
            reportAt: entry.reportAt ?? null,
            startAt: entry.startAt ?? null,
            endAt: entry.endAt ?? null,
            venue: entry.venue,
            conditionText: entry.conditionText ?? null,
          });
          next.appearances.push(a);
        }
        orders.unshift(next);
        return project(next);
      });
    },
    async command(id, input: BookingCommandInput) {
      return once(input.commandId, input, () => {
        const o = orders.find((x) => x.id === id),
          a = o?.appearances.find((x) => x.id === input.appearanceId);
        if (!o || !a) throw new Error('预约不存在。');
        project(o);
        if (a.version !== input.expectedVersion) throw new Error('场次已更新，请重新读取。');
        const keys: Record<string, keyof BookingAppearanceData['capabilities']> = {
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
        if (!a.capabilities[keys[input.type]!]) throw new Error('当前身份或场次状态不允许此操作。');
        if (input.type === 'ACTIVATE' || input.type === 'PROPOSE_CHANGE') {
          if (!input.reportAt || !input.startAt || !input.endAt || !input.venue)
            throw new Error('请补全时间与地点。');
          if (input.type === 'ACTIVATE') {
            conflict(a.profileId, input.reportAt, input.endAt, a.id);
            Object.assign(a, {
              reportAt: input.reportAt,
              startAt: input.startAt,
              endAt: input.endAt,
              venue: input.venue,
              status: 'REQUESTED',
            });
          } else
            a.changeRequest = {
              proposedByUserId: actor(),
              proposedByRole: role === 'buyer' ? 'BUYER' : 'PLAYER',
              reportAt: input.reportAt,
              startAt: input.startAt,
              endAt: input.endAt,
              venue: input.venue,
              reason: input.reason ?? '',
              createdAt: now(),
            };
        } else if (input.type === 'RESOLVE_DISPUTE') {
          a.status =
            input.resolution === 'COMPLETE'
              ? 'COMPLETED'
              : input.resolution === 'CANCEL'
                ? 'CANCELLED'
                : 'ACCEPTED';
          a.cancellationReason = input.reason ?? '';
        } else if (input.type === 'ACCEPT_CHANGE') {
          const c = a.changeRequest!;
          conflict(a.profileId, c.reportAt, c.endAt, a.id);
          Object.assign(a, {
            reportAt: c.reportAt,
            startAt: c.startAt,
            endAt: c.endAt,
            venue: c.venue,
            changeRequest: null,
          });
        } else if (input.type === 'REJECT_CHANGE') a.changeRequest = null;
        else {
          const next = {
            ACCEPT: 'ACCEPTED',
            DECLINE: 'DECLINED',
            CANCEL: 'CANCELLED',
            ARRIVE: 'ARRIVED',
            COMPLETE: 'COMPLETED',
            DISPUTE: 'DISPUTED',
          } as const;
          a.status = next[input.type as keyof typeof next];
          if (input.type === 'CANCEL' || input.type === 'DECLINE')
            a.cancellationReason = input.reason ?? '';
          if (input.type === 'ACCEPT') a.acceptedAt = now();
          if (input.type === 'ARRIVE') a.arrivedAt = now();
          if (input.type === 'COMPLETE') a.completedAt = now();
        }
        a.version++;
        o.version++;
        o.updatedAt = now();
        return project(o);
      });
    },
    async updateFee(version, feeBps, commandId) {
      once(commandId, { version, feeBps }, () => {
        if (role !== 'operator') throw new Error('没有费率配置权限。');
        if (settings.version !== version) throw new Error('费率已更新，请重新读取。');
        settings = { feeBps, version: version + 1 };
        return null;
      });
    },
  };
  return {
    repository,
    setRole(next: DemoRole) {
      role = next;
    },
    getRole() {
      return role;
    },
    completedServiceCount(profileId: string) {
      return orders
        .flatMap((order) => order.appearances)
        .filter((a) => a.profileId === profileId && a.status === 'COMPLETED').length;
    },
  };
}
export const bookingDemo = createDemoBookingRepository();
