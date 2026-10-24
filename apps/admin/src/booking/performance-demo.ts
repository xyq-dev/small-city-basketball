import type {
  PlayerPerformanceData,
  PlayerPerformanceLinkData,
  PlayerPerformanceNominateInput,
  PlayerPerformanceCommandInput,
  PlayerPerformanceWorkspaceData,
  PlayerPerformanceRecord,
} from '@small-city-basketball/contracts';
import type { PlayerPerformanceRepository } from './performance-model';
import { denominatorNotice, emptyPerformance } from './performance-model';
import { bookingDemo } from './demo';
import { commandId } from './model';
const copy = <T>(value: T): T => structuredClone(value);
const iso = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString();
const events = [
  {
    id: 'demo-publication-event',
    orgId: 'demo-org',
    name: '社区友谊赛（合成）',
    format: 'ROUND_ROBIN',
  },
  {
    id: 'demo-stats-event-0',
    orgId: 'demo-org',
    name: '青锋杯（合成统计）',
    format: 'GROUP_KNOCKOUT',
  },
  {
    id: 'demo-stats-event-1',
    orgId: 'demo-org',
    name: '社区联赛（合成统计）',
    format: 'ROUND_ROBIN',
  },
  {
    id: 'demo-invite-event',
    orgId: 'demo-org',
    name: '高州邀请赛（合成）',
    format: 'GROUP_KNOCKOUT',
  },
];
const baseSources = [
  {
    id: 'demo-base-guard',
    profileId: 'demo-guard',
    profileName: '陈宇航',
    eventName: '青锋杯（合成统计）',
    memberName: '陈宇航',
  },
  {
    id: 'demo-base-guard-two',
    profileId: 'demo-guard-two',
    profileName: '林泽宇',
    eventName: '社区联赛（合成统计）',
    memberName: '林泽宇',
  },
];
export function createDemoPerformanceRepository(
  booking = bookingDemo,
): PlayerPerformanceRepository {
  const links: PlayerPerformanceLinkData[] = baseSources.map((s, i) => ({
    id: s.id,
    profileId: s.profileId,
    profileName: s.profileName,
    orgId: 'demo-org',
    eventId: `demo-stats-event-${i}`,
    eventName: s.eventName,
    teamId: 'demo-team',
    teamName: '合成篮球队',
    memberId: `demo-fixed-member-${i}`,
    memberName: s.memberName,
    status: 'APPROVED',
    version: 1,
    nominatedByUserId: 'demo-publisher',
    consentedAt: iso(-10),
    revokedAt: null,
    reason: '主办方提名且球员已同意的合成示例。',
    sourceCurrentlyAvailable: true,
    createdAt: iso(-12),
    capabilities: { canConsent: false, canRevoke: false },
  }));
  links.push({
    id: 'demo-pending-record-link',
    profileId: 'demo-guard',
    profileName: '陈宇航',
    orgId: 'demo-org',
    eventId: 'demo-invite-event',
    eventName: '高州邀请赛（合成）',
    teamId: 'demo-team',
    teamName: '石鼓青锋（示例）',
    memberId: 'demo-member-guard',
    memberName: '陈宇航',
    status: 'PENDING',
    version: 1,
    nominatedByUserId: 'demo-publisher',
    consentedAt: null,
    revokedAt: null,
    reason: '请本人核对这份邀请赛名单及有限数据公开范围。',
    sourceCurrentlyAvailable: false,
    createdAt: iso(-1),
    capabilities: { canConsent: false, canRevoke: false },
  });
  function roster(eventId: string) {
    const index = baseSources.findIndex((_value, i) => eventId === `demo-stats-event-${i}`);
    return index >= 0
      ? [
          {
            id: `demo-fixed-member-${index}`,
            name: baseSources[index]!.memberName,
            jerseyNo: index === 0 ? '7' : '11',
          },
        ]
      : [
          { id: 'demo-member-guard', name: '陈宇航', jerseyNo: '7' },
          { id: 'demo-member-guard-two', name: '林泽宇', jerseyNo: '11' },
        ];
  }
  const receipts = new Map<string, { hash: string; result: PlayerPerformanceLinkData }>();
  const user = () =>
    booking.getRole() === 'player'
      ? 'demo-user-demo-guard'
      : booking.getRole() === 'publisher'
        ? 'demo-publisher'
        : booking.getRole() === 'operator'
          ? 'demo-operator'
          : 'demo-buyer';
  const own = () => (booking.getRole() === 'player' ? 'demo-guard' : null);
  const publisher = () => booking.getRole() === 'publisher';
  function project(link: PlayerPerformanceLinkData) {
    const self = link.profileId === own();
    return {
      ...link,
      capabilities: {
        canConsent: self && link.status === 'PENDING',
        canRevoke: (self || publisher()) && link.status !== 'REVOKED',
      },
    };
  }
  function once(id: string, input: unknown, work: () => PlayerPerformanceLinkData) {
    const key = `${user()}:${id}`,
      hash = JSON.stringify(input),
      old = receipts.get(key);
    if (old) {
      if (old.hash !== hash) throw new Error('同一操作编号不能用于不同授权内容。');
      return copy(old.result);
    }
    const result = work();
    receipts.set(key, { hash, result: copy(result) });
    return copy(result);
  }
  async function performance(profileId: string): Promise<PlayerPerformanceData> {
    const active = links.filter(
      (l) => l.profileId === profileId && l.status === 'APPROVED' && l.sourceCurrentlyAvailable,
    );
    const services = booking.completedServiceCount(profileId);
    if (!active.length) return emptyPerformance(profileId, services);
    const recordedSource = active.find(
      (link) =>
        link.id === (profileId === 'demo-guard-two' ? 'demo-base-guard-two' : 'demo-base-guard'),
    );
    if (!recordedSource)
      return {
        ...emptyPerformance(profileId, services),
        dataStatus: 'NO_PERSONAL_STATS',
        sourceCount: active.length,
        completenessNotice: '已有双方授权，但这些合成来源尚无有效个人统计记录。',
      };
    const second = profileId === 'demo-guard-two';
    const values = second ? [18, 22, 15] : [12, 0, 10, 6, 14];
    const fouls = second ? [2, 3, 1] : [2, 1, 2, 0, 3];
    const records: PlayerPerformanceRecord[] = values.map((points, i) => ({
      recordKey: `synthetic-${profileId}-record-${i}`,
      eventName: recordedSource.eventName,
      date: iso(-i - 2).slice(0, 10),
      format: second ? 'ROUND_ROBIN' : 'GROUP_KNOCKOUT',
      collectionMode: 'PLAYER_BASIC' as const,
      points,
      fouls: fouls[i]!,
      attributionComplete: !(second && i === 1),
      source: 'INDEPENDENT_CONFIRMATION' as const,
    }));
    if (second)
      records.push({
        recordKey: `synthetic-${profileId}-team-only`,
        eventName: recordedSource.eventName,
        date: iso(-8).slice(0, 10),
        format: 'ROUND_ROBIN',
        collectionMode: 'TEAM_ONLY',
        points: null,
        fouls: null,
        attributionComplete: null,
        source: 'INDEPENDENT_CONFIRMATION',
      });
    const totalPoints = values.reduce((a, b) => a + b, 0),
      totalFouls = fouls.reduce((a, b) => a + b, 0);
    return {
      profileId,
      sampleLimit: 1000,
      truncated: false,
      dataStatus: second ? 'PARTIAL' : 'AVAILABLE',
      sourceCount: active.length,
      recordedMatchCount: values.length,
      confirmedMatchCount: values.length + (second ? 1 : 0),
      teamOnlyMatchCount: second ? 1 : 0,
      partialAttributionMatchCount: second ? 1 : 0,
      pendingMatchCount: second ? 1 : 0,
      invalidMatchCount: 0,
      totalPoints,
      totalFouls,
      pointsPerRecordedMatch: Number((totalPoints / values.length).toFixed(2)),
      foulsPerRecordedMatch: Number((totalFouls / values.length).toFixed(2)),
      rebounds: null,
      assists: null,
      minutes: null,
      fieldGoalPercentage: null,
      completedServiceCount: services,
      recentRecords: records.slice(0, 5),
      denominatorNotice,
      completenessNotice: second
        ? '合成记录中有一场仅采集球队数据，未计入个人统计分母；另有一场待确认。'
        : '仅展示已授权且当前有效独立确认的合成名单记录，包含一场得分真实记录为0的示例。',
      asOf: iso(),
    };
  }
  return {
    performance,
    async performances(ids) {
      const available = ['demo-guard', 'demo-guard-two', 'demo-center', 'demo-wing'];
      return {
        players: await Promise.all(ids.filter((id) => available.includes(id)).map(performance)),
        unavailableProfileIds: ids.filter((id) => !available.includes(id)),
      };
    },
    async workspace(): Promise<PlayerPerformanceWorkspaceData> {
      return copy({
        viewerUserId: user(),
        ownProfileId: own(),
        manageableEvents: publisher() ? events : [],
        links: links.filter((l) => l.profileId === own() || publisher()).map(project),
        linksHasMore: false,
        disclosureNotice:
          '主办方提名与球员本人同意后，仅公开本人有限得分/犯规记录。撤销后下次读取不再展示该来源，不开放原私有赛事接口。',
      });
    },
    async sources(orgId, eventId) {
      if (!publisher()) throw new Error('当前没有该赛事数据管理权。');
      const event = events.find((e) => e.id === eventId && e.orgId === orgId);
      if (!event) throw new Error('赛事不可管理。');
      return {
        event,
        teams: [
          {
            id: 'demo-team',
            name: eventId.startsWith('demo-stats-event-') ? '合成篮球队' : '石鼓青锋（示例）',
            members: roster(eventId),
          },
        ],
      };
    },
    async nominate(input: PlayerPerformanceNominateInput) {
      if (!publisher()) throw new Error('当前没有主办方发布权。');
      const target = (await booking.repository.workspace()).players.find(
        (player) => player.id === input.profileId,
      );
      if (!target || !publisher()) throw new Error('球员档案不可提名或当前身份已变化。');
      const member = roster(input.eventId).find((candidate) => candidate.id === input.memberId);
      if (!member) throw new Error('成员不在该赛事固定名单中。');
      return once(input.commandId, input, () => {
        const event = events.find((e) => e.id === input.eventId && e.orgId === input.orgId);
        if (!event || input.teamId !== 'demo-team' || !input.publisherConsent)
          throw new Error('请核对当前有权赛事与公开同意。');
        if (
          links.some(
            (l) =>
              l.profileId === input.profileId &&
              l.eventId === input.eventId &&
              l.memberId === input.memberId &&
              l.status !== 'REVOKED',
          )
        )
          throw new Error('该来源已有有效或待确认提名。');
        const row: PlayerPerformanceLinkData = {
          id: commandId(),
          profileId: input.profileId,
          profileName: target.displayName,
          orgId: input.orgId,
          eventId: input.eventId,
          eventName: event.name,
          teamId: input.teamId,
          teamName: input.eventId.startsWith('demo-stats-event-')
            ? '合成篮球队'
            : '石鼓青锋（示例）',
          memberId: input.memberId,
          memberName: member.name,
          status: 'PENDING',
          version: 1,
          nominatedByUserId: user(),
          consentedAt: null,
          revokedAt: null,
          reason: input.reason,
          sourceCurrentlyAvailable: false,
          createdAt: iso(),
          capabilities: { canConsent: false, canRevoke: true },
        };
        links.unshift(row);
        return project(row);
      });
    },
    async command(id, input: PlayerPerformanceCommandInput) {
      const link = links.find((l) => l.id === id);
      if (!link) throw new Error('授权记录不存在。');
      const capabilities = project(link).capabilities;
      if (input.type === 'CONSENT' ? !capabilities.canConsent : !capabilities.canRevoke)
        throw new Error('当前身份不能处理该授权。');
      return once(input.commandId, input, () => {
        if (link.version !== input.expectedVersion)
          throw new Error('授权记录已更新，请刷新后核对。');
        if (input.type === 'CONSENT') {
          if (!input.playerConsent) throw new Error('需要本人明确同意。');
          link.status = 'APPROVED';
          link.consentedAt = iso();
          link.sourceCurrentlyAvailable = true;
        } else {
          link.status = 'REVOKED';
          link.revokedAt = iso();
          link.sourceCurrentlyAvailable = false;
        }
        link.version++;
        link.reason = input.reason;
        return project(link);
      });
    },
  };
}
export const performanceDemo = createDemoPerformanceRepository();
