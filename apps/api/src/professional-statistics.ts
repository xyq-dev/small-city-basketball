import type {
  MatchPlayerRoster,
  ProfessionalPlayerStatistics,
  ProfessionalStatistics,
  ScoringEventData,
  ScoringRules,
  ScoringSide,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';

const fail = (message: string): never => {
  throw new ApiError(422, 'PROFESSIONAL_STATISTICS_INVALID', message);
};
const sides = ['home', 'away'] as const;
const technical = ['REBOUND', 'ASSIST', 'STEAL', 'BLOCK', 'TURNOVER'] as const;
const fields = {
  REBOUND: 'rebounds',
  ASSIST: 'assists',
  STEAL: 'steals',
  BLOCK: 'blocks',
  TURNOVER: 'turnovers',
} as const;
const count = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail('专业统计数值无效');
  return value as number;
};
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function technicalCollectionEnabled(events: ScoringEventData[]): boolean {
  const prepared = events.find((e) => e.type === 'PREPARE_MATCH');
  if (prepared?.payload.technicalCollection === undefined) return false;
  if (
    typeof prepared.payload.technicalCollection !== 'boolean' ||
    (prepared.payload.technicalCollection && prepared.payload.collectionMode !== 'PLAYER_BASIC')
  )
    return fail('专业统计须在准备比赛时明确开启逐人采集');
  return prepared.payload.technicalCollection;
}
function empty(player: MatchPlayerRoster['home'][number]): ProfessionalPlayerStatistics {
  return {
    ...player,
    starter: false,
    appeared: false,
    onCourt: false,
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
}
/** One append-only stream feeds both basic scoring and technical/lineup projections. */
export function projectProfessionalStatistics(
  events: ScoringEventData[],
  rules: ScoringRules,
  roster: MatchPlayerRoster,
  asOf?: string,
): ProfessionalStatistics | null {
  if (!technicalCollectionEnabled(events)) return null;
  const result: ProfessionalStatistics = {
    algorithmVersion: 'PLAYER_TECHNICAL_V1',
    home: { players: roster.home.map(empty), lineup: [] },
    away: { players: roster.away.map(empty), lineup: [] },
    elapsedPlayingMs: 0,
  };
  const maps = {
    home: new Map(result.home.players.map((p) => [p.memberId, p])),
    away: new Map(result.away.players.map((p) => [p.memberId, p])),
  };
  const all = [...maps.home.keys(), ...maps.away.keys()];
  if (!all.length || new Set(all).size !== all.length || all.some((id) => !uuid(id)))
    fail('本场冻结名单无效');
  const active = new Map<string, ScoringEventData>();
  const lineupSet = { home: false, away: false };
  let running = false,
    remaining = rules.periodDurationSeconds * 1000,
    period = 1;
  let at = Date.parse(events[0]?.serverTime ?? '');
  if (!Number.isFinite(at)) fail('专业统计时间锚点无效');
  let matchStarted = false;
  const advance = (time: string) => {
    const next = Date.parse(time);
    if (!Number.isFinite(next) || next < at) fail('专业统计时间线无效');
    const elapsed = running ? Math.min(remaining, next - at) : 0;
    remaining -= elapsed;
    result.elapsedPlayingMs += elapsed;
    for (const side of sides)
      for (const id of result[side].lineup) maps[side].get(id)!.playingMs += elapsed;
    at = next;
  };
  const player = (side: unknown, memberId: unknown) => {
    if (side !== 'HOME' && side !== 'AWAY') return fail('专业统计队伍无效');
    const key = side === 'HOME' ? 'home' : 'away';
    const p = typeof memberId === 'string' ? maps[key].get(memberId) : undefined;
    if (!p) return fail('专业统计球员不在该方冻结名单');
    return p;
  };
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const voided = new Set(
    ordered
      .filter((e) => ['STAT_VOIDED', 'PRO_STAT_VOIDED'].includes(e.type) && e.targetEventId)
      .map((e) => e.targetEventId),
  );
  const corrections = new Map<string, ScoringEventData>();
  for (const e of ordered)
    if (e.type === 'LINEUP_CORRECTED') {
      const target = ordered.find(
        (t) =>
          t.id === e.targetEventId &&
          t.seq < e.seq &&
          ['SET_LINEUP', 'SUBSTITUTE_PLAYER'].includes(t.type),
      );
      if (
        !target ||
        target.payload.side !== e.payload.side ||
        !Array.isArray(e.payload.memberIds) ||
        typeof e.payload.reason !== 'string' ||
        !e.payload.reason.trim()
      )
        fail('阵容更正来源无效');
      corrections.set(target!.id, e);
    }
  const seen = new Set<string>();
  for (const [index, e] of ordered.entries()) {
    if (e.seq !== index + 1 || seen.has(e.id)) fail('专业统计流水不连续');
    seen.add(e.id);
    advance(e.serverTime);
    if (e.type === 'SET_LINEUP' || e.type === 'SUBSTITUTE_PLAYER') {
      if (running) fail('换人须先暂停权威时钟');
      const key =
        e.payload.side === 'HOME'
          ? 'home'
          : e.payload.side === 'AWAY'
            ? 'away'
            : fail('阵容队伍无效');
      let ids: string[];
      if (e.type === 'SET_LINEUP' && matchStarted) fail('比赛开始后不能重新设置首发');
      if (e.type === 'SUBSTITUTE_PLAYER' && (!matchStarted || !lineupSet[key]))
        fail('换人缺少有效比赛与阵容');
      const override = corrections.get(e.id);
      if (override) ids = override.payload.memberIds as string[];
      else if (e.type === 'SET_LINEUP') {
        if (matchStarted) fail('比赛开始后请通过换人操作修改阵容');
        if (!Array.isArray(e.payload.memberIds)) fail('首发名单无效');
        ids = e.payload.memberIds as string[];
      } else {
        if (!matchStarted || !lineupSet[key]) fail('换人来源阵容无效');
        const out = String(e.payload.outMemberId),
          into = String(e.payload.inMemberId);
        if (!result[key].lineup.includes(out) || result[key].lineup.includes(into))
          fail('换人球员状态无效');
        ids = result[key].lineup.map((id) => (id === out ? into : id));
      }
      if (ids.length < 1 || ids.length > 5 || new Set(ids).size !== ids.length)
        fail('在场阵容须为1至5名不同球员');
      ids.forEach((id) => player(e.payload.side, id));
      for (const p of result[key].players) p.onCourt = ids.includes(p.memberId);
      result[key].lineup = [...ids];
      lineupSet[key] = true;
      if (!matchStarted) for (const p of result[key].players) p.starter = ids.includes(p.memberId);
      if (matchStarted)
        ids.forEach((id) => {
          maps[key].get(id)!.appeared = true;
        });
    }
    if (e.type === 'START_MATCH') {
      if (!lineupSet.home || !lineupSet.away) fail('专业采集须先设置双方首发');
      matchStarted = true;
      for (const side of sides)
        result[side].lineup.forEach((id) => {
          maps[side].get(id)!.appeared = true;
        });
    }
    if (e.type === 'CLOCK_START') running = true;
    if (e.type === 'CLOCK_PAUSE' || e.type === 'END_MATCH') running = false;
    if (e.type === 'CLOCK_SET') remaining = count(e.payload.remainingMs);
    if (e.type === 'NEXT_PERIOD' || e.type === 'START_OVERTIME') {
      period++;
      remaining =
        (period <= rules.regulationPeriods
          ? rules.periodDurationSeconds
          : (rules.overtimeDurationSeconds ?? fail('加时规则无效'))) * 1000;
    }
    if (
      e.type === 'PRO_STAT_RECORDED' ||
      (e.type === 'STAT_RECORDED' && e.payload.shot !== undefined)
    ) {
      if (
        !voided.has(e.id) &&
        !e.payload.reason &&
        !player(e.payload.side, e.payload.memberId).onCourt
      )
        fail('专业现场记录的球员当时不在场');
      active.set(e.id, e);
    }
    if (e.type === 'STAT_RECORDED' && e.payload.kind === 'SCORE' && e.payload.shot === undefined)
      fail('专业采集中的得分须有明确投篮来源');
    if ((e.type === 'STAT_VOIDED' || e.type === 'PRO_STAT_VOIDED') && e.targetEventId)
      active.delete(e.targetEventId);
  }
  if (asOf) advance(asOf);
  for (const e of active.values()) {
    const p = player(e.payload.side, e.payload.memberId);
    if (e.type === 'STAT_RECORDED') {
      const shot = e.payload.shot as { shotValue?: unknown; made?: unknown };
      if (
        !shot ||
        shot.made !== true ||
        ![1, 2, 3].includes(Number(shot.shotValue)) ||
        shot.shotValue !== e.payload.value ||
        e.payload.kind !== 'SCORE'
      )
        fail('投篮与球队得分来源不一致');
      shotCount(p, Number(shot.shotValue), true);
    } else if (e.payload.kind === 'SHOT') {
      if (![1, 2, 3].includes(Number(e.payload.shotValue)) || e.payload.made !== false)
        fail('未命中投篮来源无效');
      shotCount(p, Number(e.payload.shotValue), false);
    } else {
      if (!(technical as readonly unknown[]).includes(e.payload.kind)) fail('专业统计类型无效');
      p[fields[e.payload.kind as (typeof technical)[number]]]++;
    }
  }
  for (const side of sides)
    for (const p of result[side].players) {
      p.fieldGoalPercentage = percentage(p.fieldGoalsMade, p.fieldGoalsAttempted);
      p.threePointPercentage = percentage(p.threePointersMade, p.threePointersAttempted);
      p.freeThrowPercentage = percentage(p.freeThrowsMade, p.freeThrowsAttempted);
      if (!Number.isSafeInteger(p.playingMs)) fail('球员上场时间超出范围');
    }
  return result;
}
function percentage(made: number, attempted: number) {
  return attempted === 0 ? null : Math.round((made / attempted) * 10000) / 100;
}
function shotCount(p: ProfessionalPlayerStatistics, value: number, made: boolean) {
  if (value === 1) {
    p.freeThrowsAttempted++;
    if (made) p.freeThrowsMade++;
  } else {
    p.fieldGoalsAttempted++;
    if (made) p.fieldGoalsMade++;
    if (value === 3) {
      p.threePointersAttempted++;
      if (made) p.threePointersMade++;
    }
  }
}
export function assertProfessionalPlayerOnCourt(
  stats: ProfessionalStatistics | null,
  side: ScoringSide,
  memberId: string,
) {
  const group = stats?.[side === 'HOME' ? 'home' : 'away'];
  if (!group || !group.lineup.includes(memberId))
    throw new ApiError(422, 'PLAYER_NOT_ON_COURT', '专业现场统计须选择当前在场球员');
}

/** Strict whitelist for persisted confirmation DTOs, including recomputed percentages. */
export function professionalStatisticsDto(value: unknown): ProfessionalStatistics | null {
  if (value === null || value === undefined) return null;
  const object = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('专业统计结构无效');
    return v as Record<string, unknown>;
  };
  const raw = object(value);
  if (raw.algorithmVersion !== 'PLAYER_TECHNICAL_V1') fail('专业统计算法版本无效');
  const seen = new Set<string>();
  const side = (v: unknown) => {
    const group = object(v);
    if (
      !Array.isArray(group.players) ||
      !group.players.length ||
      group.players.length > 60 ||
      !Array.isArray(group.lineup) ||
      group.lineup.length > 5
    )
      fail('专业统计名单无效');
    const lineup = (group.lineup as unknown[]).map((id) => {
      if (!uuid(id)) return fail('阵容编号无效');
      return id;
    });
    if (new Set(lineup).size !== lineup.length) fail('在场球员重复');
    const players = (group.players as unknown[]).map((v) => {
      const p = object(v);
      if (
        !uuid(p.memberId) ||
        seen.has(p.memberId) ||
        typeof p.name !== 'string' ||
        !p.name.trim() ||
        Array.from(p.name).length > 80 ||
        p.name.includes('\u0000') ||
        typeof p.jerseyNo !== 'string' ||
        !/^(?:0|00|[1-9][0-9]?)$/.test(p.jerseyNo)
      )
        fail('专业统计球员身份无效');
      seen.add(p.memberId as string);
      const row = empty({
        memberId: p.memberId as string,
        name: p.name as string,
        jerseyNo: p.jerseyNo as string,
      });
      for (const field of ['starter', 'appeared', 'onCourt'] as const) {
        if (typeof p[field] !== 'boolean') fail('上场状态无效');
        row[field] = p[field] as boolean;
      }
      for (const field of [
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
        row[field] = count(p[field]);
      if (
        row.fieldGoalsMade > row.fieldGoalsAttempted ||
        row.threePointersMade > row.threePointersAttempted ||
        row.freeThrowsMade > row.freeThrowsAttempted ||
        row.threePointersMade > row.fieldGoalsMade ||
        row.threePointersAttempted > row.fieldGoalsAttempted ||
        row.onCourt !== lineup.includes(row.memberId)
      )
        fail('投篮或阵容计数矛盾');
      row.fieldGoalPercentage = percentage(row.fieldGoalsMade, row.fieldGoalsAttempted);
      row.threePointPercentage = percentage(row.threePointersMade, row.threePointersAttempted);
      row.freeThrowPercentage = percentage(row.freeThrowsMade, row.freeThrowsAttempted);
      for (const field of [
        'fieldGoalPercentage',
        'threePointPercentage',
        'freeThrowPercentage',
      ] as const)
        if (p[field] !== row[field]) fail('命中率与出手记录不一致');
      return row;
    });
    if (lineup.some((id) => !players.some((p) => p.memberId === id))) fail('在场名单来源缺失');
    return { players, lineup };
  };
  return {
    algorithmVersion: 'PLAYER_TECHNICAL_V1',
    home: side(raw.home),
    away: side(raw.away),
    elapsedPlayingMs: count(raw.elapsedPlayingMs),
  };
}
