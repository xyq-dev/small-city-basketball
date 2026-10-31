import { createHash } from 'node:crypto';
import type {
  PublicArchiveData,
  PublicArchiveKind,
  PublicArchiveTechnicalTotals,
} from '@small-city-basketball/contracts';
import { confirmedPlayerStatistics } from './confirmed-player-statistics.js';
import { professionalStatisticsDto } from './professional-statistics.js';
import { confirmedResult } from './standings-domain.js';
import type { ResultRow } from './standings-domain.js';
import { invalid, objectInput, text } from './validation.js';
export const PUBLIC_ARCHIVE_NOTICE =
  '公开长期档案是独立用途授权。公开显示名、授权赛事名称及日期、有效独立确认的统计与榜单；不公开账号、联系方式、内部身份编号或完整名单。可随时撤销，旧分享链接永久失效。球队与球员身份只按明确绑定和逐届授权关联，不按同名合并。';
export const MAX_ARCHIVE_SOURCES = 100;
export const MAX_ARCHIVE_MATCHES = 2000;
export function publicKey(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) invalid('公开档案地址无效');
  return raw;
}
export function archiveId(raw: unknown): string {
  if (
    typeof raw !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
  )
    invalid('档案编号无效');
  return raw.toLowerCase();
}
export function archiveVersion(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < 1) invalid('档案版本无效');
  return raw as number;
}
export function archiveHash(raw: unknown): string {
  const stable = (v: any): string =>
    v === null || typeof v !== 'object'
      ? JSON.stringify(v)
      : Array.isArray(v)
        ? '[' + v.map(stable).join(',') + ']'
        : '{' +
          Object.keys(v)
            .sort()
            .map((k) => JSON.stringify(k) + ':' + stable(v[k]))
            .join(',') +
          '}';
  return createHash('sha256').update(stable(raw)).digest('hex');
}
export function createArchiveInput(raw: unknown) {
  const v = objectInput(raw, ['commandId', 'kind', 'displayName', 'orgId', 'teamId']);
  if (!['PLAYER', 'TEAM'].includes(String(v.kind))) invalid('请选择球员或球队档案');
  if (v.kind === 'PLAYER' && (v.orgId !== undefined || v.teamId !== undefined))
    invalid('球员档案不能按球队或姓名自动绑定');
  return {
    commandId: archiveId(v.commandId),
    kind: v.kind as PublicArchiveKind,
    displayName: text(v.displayName, 'displayName', 1, 80),
    orgId: v.kind === 'TEAM' ? archiveId(v.orgId) : null,
    teamId: v.kind === 'TEAM' ? archiveId(v.teamId) : null,
  };
}
export function archiveCommandInput(raw: unknown) {
  const v = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'type',
    'publicConsent',
    'displayName',
    'reason',
  ]);
  if (!['PUBLISH', 'REVOKE', 'UPDATE'].includes(String(v.type))) invalid('无效公开档案操作');
  if (v.type === 'PUBLISH' && v.publicConsent !== true)
    invalid('请本人明确同意PUBLIC_ARCHIVE独立公开用途');
  return {
    commandId: archiveId(v.commandId),
    expectedVersion: archiveVersion(v.expectedVersion),
    type: String(v.type),
    ...(v.type === 'PUBLISH' ? { publicConsent: true } : {}),
    ...(v.type === 'UPDATE' ? { displayName: text(v.displayName, 'displayName', 1, 80) } : {}),
    ...(v.type === 'REVOKE' ? { reason: text(v.reason, 'reason', 4, 500) } : {}),
  };
}
export interface ArchiveSample {
  eventName: string;
  date: string;
  teamId: string;
  memberId: string | null;
  proof: ResultRow;
}
const percent = (made: number, attempted: number) =>
  attempted === 0 ? null : Math.round((made / attempted) * 10000) / 100;
/** Strict public whitelist. No raw proof or internal identity can enter the returned object. */
export function archiveProjection(
  profile: { publicKey: string; kind: PublicArchiveKind; displayName: string; publishedAt: string },
  samples: ArchiveSample[],
  sourceCount: number,
  asOf: string,
): PublicArchiveData {
  if (samples.length > MAX_ARCHIVE_MATCHES) invalid('档案来源超过安全计算上限，请缩小公开来源');
  let confirmed = 0,
    recorded = 0,
    pending = 0,
    bad = 0,
    teamOnly = 0,
    incomplete = 0,
    points = 0,
    fouls = 0,
    wins = 0,
    draws = 0,
    losses = 0;
  const technical: PublicArchiveTechnicalTotals = {
    sampledMatchCount: 0,
    appearedMatchCount: 0,
    playingMs: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    fieldGoalPercentage: null,
    threePointPercentage: null,
    freeThrowPercentage: null,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
  };
  const rows: PublicArchiveData['recentRecords'] = [],
    seen = new Set<string>();
  for (const sample of samples) {
    const m = sample.proof;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    try {
      const result = confirmedResult(m);
      if (!result) {
        pending++;
        continue;
      }
      const side =
        m.home_team_id === sample.teamId
          ? 'home'
          : m.away_team_id === sample.teamId
            ? 'away'
            : null;
      if (!side) throw Error('wrong team');
      const playerStats = confirmedPlayerStatistics(m);
      confirmed++;
      let score: number | null = null,
        foul: number | null = null;
      if (profile.kind === 'TEAM') {
        score = side === 'home' ? result.homeScore : result.awayScore;
        foul = m.confirmation[side + '_fouls'];
        recorded++;
        points += score;
        fouls += foul!;
        const other = side === 'home' ? 'away' : 'home';
        if (score > (other === 'home' ? result.homeScore : result.awayScore)) wins++;
        else if (score === (other === 'home' ? result.homeScore : result.awayScore)) draws++;
        else losses++;
        const pro = professionalStatisticsDto(m.confirmation.professional_stats);
        if (pro) {
          technical.sampledMatchCount++;
          if (pro[side].players.some((p) => p.appeared)) technical.appearedMatchCount++;
          technical.playingMs += pro.elapsedPlayingMs;
          for (const p of pro[side].players)
            for (const k of [
              'fieldGoalsMade',
              'fieldGoalsAttempted',
              'threePointersMade',
              'threePointersAttempted',
              'freeThrowsMade',
              'freeThrowsAttempted',
              'rebounds',
              'assists',
              'steals',
              'blocks',
              'turnovers',
            ] as const)
              technical[k] += p[k];
        }
      } else if (!playerStats) teamOnly++;
      else {
        const p = playerStats[side].players.find((p) => p.memberId === sample.memberId);
        if (!p) {
          confirmed--;
          continue;
        }
        score = p.score;
        foul = p.fouls;
        recorded++;
        points += score;
        fouls += foul;
        if (playerStats[side].unassigned.score || playerStats[side].unassigned.fouls) incomplete++;
        const pro = professionalStatisticsDto(m.confirmation.professional_stats);
        if (pro) {
          const p = pro[side].players.find((p) => p.memberId === sample.memberId);
          if (!p) throw Error('missing technical player');
          technical.sampledMatchCount++;
          if (p.appeared) technical.appearedMatchCount++;
          for (const k of [
            'playingMs',
            'fieldGoalsMade',
            'fieldGoalsAttempted',
            'threePointersMade',
            'threePointersAttempted',
            'freeThrowsMade',
            'freeThrowsAttempted',
            'rebounds',
            'assists',
            'steals',
            'blocks',
            'turnovers',
          ] as const)
            technical[k] += p[k];
        }
      }
      rows.push({
        recordKey: createHash('sha256')
          .update(profile.publicKey + ':' + m.confirmation.id)
          .digest('base64url'),
        eventName: sample.eventName,
        date: sample.date,
        points: score,
        fouls: foul,
        source: 'INDEPENDENT_CONFIRMATION',
      });
    } catch {
      bad++;
    }
  }
  for (const value of [
    points,
    fouls,
    ...Object.values(technical).filter((v) => typeof v === 'number'),
  ])
    if (!Number.isSafeInteger(value)) invalid('公开统计数值超出范围');
  technical.fieldGoalPercentage = percent(technical.fieldGoalsMade, technical.fieldGoalsAttempted);
  technical.threePointPercentage = percent(
    technical.threePointersMade,
    technical.threePointersAttempted,
  );
  technical.freeThrowPercentage = percent(technical.freeThrowsMade, technical.freeThrowsAttempted);
  return {
    publicKey: profile.publicKey,
    kind: profile.kind,
    displayName: profile.displayName,
    publishedAt: profile.publishedAt,
    asOf,
    authorizedSourceCount: sourceCount,
    confirmedMatchCount: confirmed,
    recordedMatchCount: recorded,
    pendingMatchCount: pending,
    invalidMatchCount: bad,
    teamOnlyMatchCount: teamOnly,
    attributionIncompleteMatchCount: incomplete,
    points: recorded ? points : null,
    fouls: recorded ? fouls : null,
    pointsPerRecordedMatch: recorded ? Math.round((points / recorded) * 100) / 100 : null,
    wins: profile.kind === 'TEAM' ? wins : null,
    draws: profile.kind === 'TEAM' ? draws : null,
    losses: profile.kind === 'TEAM' ? losses : null,
    technical: technical.sampledMatchCount ? technical : null,
    recentRecords: rows
      .sort((a, b) => b.date.localeCompare(a.date) || a.recordKey.localeCompare(b.recordKey))
      .slice(0, 30),
    coverageNotice:
      '仅计算当前授权且赛果独立确认的真实比赛。逐人统计样本不等于实际出场；未采集项未知，专业数据只覆盖明确启用专业采集的样本；球队时间为权威比赛时长，球员时间为权威在场时间。重开或失效来源即时移除，行政弃权／取消不计个人统计。',
  };
}
