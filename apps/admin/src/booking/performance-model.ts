import type {
  PlayerPerformanceData,
  PlayerPerformanceWorkspaceData,
  PlayerPerformanceSourcesData,
  PlayerPerformanceLinkData,
  PlayerPerformanceNominateInput,
  PlayerPerformanceCommandInput,
} from '@small-city-basketball/contracts';
export type {
  PlayerPerformanceData,
  PlayerPerformanceWorkspaceData,
  PlayerPerformanceSourcesData,
  PlayerPerformanceLinkData,
  PlayerPerformanceNominateInput,
  PlayerPerformanceCommandInput,
} from '@small-city-basketball/contracts';
export interface PlayerPerformanceRepository {
  performance(profileId: string): Promise<PlayerPerformanceData>;
  performances(
    profileIds: string[],
  ): Promise<{ players: PlayerPerformanceData[]; unavailableProfileIds: string[] }>;
  workspace(): Promise<PlayerPerformanceWorkspaceData>;
  sources(orgId: string, eventId: string): Promise<PlayerPerformanceSourcesData>;
  nominate(input: PlayerPerformanceNominateInput): Promise<PlayerPerformanceLinkData>;
  command(linkId: string, input: PlayerPerformanceCommandInput): Promise<PlayerPerformanceLinkData>;
}
export const denominatorNotice =
  '统计场次仅指球员在已授权名单中的PLAYER_BASIC独立确认记录，不代表实际出场次数或上场时间。';
export function emptyPerformance(
  profileId: string,
  completedServiceCount = 0,
): PlayerPerformanceData {
  return {
    profileId,
    sampleLimit: 1000,
    truncated: false,
    dataStatus: 'NO_AUTHORIZED_SOURCE',
    sourceCount: 0,
    recordedMatchCount: 0,
    confirmedMatchCount: 0,
    teamOnlyMatchCount: 0,
    partialAttributionMatchCount: 0,
    pendingMatchCount: 0,
    invalidMatchCount: 0,
    totalPoints: null,
    totalFouls: null,
    pointsPerRecordedMatch: null,
    foulsPerRecordedMatch: null,
    rebounds: null,
    assists: null,
    minutes: null,
    fieldGoalPercentage: null,
    completedServiceCount,
    recentRecords: [],
    denominatorNotice,
    completenessNotice: '暂无经过双方授权且有效的个人统计来源，未统计不代表球员能力为0。',
    asOf: new Date().toISOString(),
  };
}
/** Used only when a component test injects the pre-C07 repository, never as an API failure fallback. */
export const unavailablePerformanceRepository: PlayerPerformanceRepository = {
  async performance(id) {
    return emptyPerformance(id);
  },
  async performances(ids) {
    return { players: ids.map((id) => emptyPerformance(id)), unavailableProfileIds: [] };
  },
  async workspace() {
    return {
      viewerUserId: '',
      ownProfileId: null,
      manageableEvents: [],
      links: [],
      linksHasMore: false,
      disclosureNotice: '请连接球员数据授权服务后查看本人记录。',
    };
  },
  async sources() {
    throw new Error('当前没有连接球员数据授权服务。');
  },
  async nominate() {
    throw new Error('当前没有连接球员数据授权服务。');
  },
  async command() {
    throw new Error('当前没有连接球员数据授权服务。');
  },
};
export const metric = (v: number | null, decimals = 1) =>
  v === null ? '未统计' : Number.isInteger(v) ? String(v) : v.toFixed(decimals);
