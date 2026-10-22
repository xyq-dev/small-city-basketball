import { describe, expect, it } from 'vitest';
import type { StandingsRules, StandingsRulesetData } from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { calculateStandings, confirmedResult, parseStandingsRules } from './standings-domain.js';
import type { ResultRow, StandingParticipant } from './standings-domain.js';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const now = '2026-10-22T03:00:00.000Z';
const rules: StandingsRulesetData = {
  id: id(700),
  eventId: id(701),
  version: 2,
  algorithmVersion: 'RR_STANDINGS_V1',
  createdAt: now,
  winPoints: 3,
  lossPoints: 0,
  drawPoints: 1,
  tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR', 'WINS'],
};
const explicitRules: StandingsRules = {
  winPoints: rules.winPoints,
  lossPoints: rules.lossPoints,
  drawPoints: rules.drawPoints,
  tiebreakers: [...rules.tiebreakers],
};
function participants(count = 3): StandingParticipant[] {
  return Array.from({ length: count }, (_, index) => ({
    entryId: id(100 + index),
    // Deliberately opposite UUID/name order: only the freeze order may stabilize a tie.
    teamId: id(500 - index),
    teamName: `${String.fromCharCode(90 - index)}队`,
  }));
}
const totals = (score: number, fouls = 0, timeouts = 0) => ({ score, fouls, timeouts });
function finalMatch(
  home: StandingParticipant,
  away: StandingParticipant,
  homeScore = 10,
  awayScore = 8,
  matchNumber = 200,
) {
  const periods = [{ period: 1, home: totals(homeScore, 2, 1), away: totals(awayScore, 3, 0) }];
  const statistics = {
    home_score: homeScore,
    away_score: awayScore,
    home_fouls: 2,
    away_fouls: 3,
    home_timeouts: 1,
    away_timeouts: 0,
    period_stats: periods,
  };
  return {
    id: id(matchNumber),
    status: 'FINAL',
    version: 9,
    home_entry_id: home.entryId,
    away_entry_id: away.entryId,
    state: {
      ...structuredClone(statistics),
      source_version: 9,
      ruleset_id: id(800),
      period: 1,
      clock_running: false,
      remaining_ms: 0,
      last_event_seq: 7,
      latest_confirmation_id: id(matchNumber + 1000),
      requires_reconfirmation: false,
    },
    confirmation: {
      ...structuredClone(statistics),
      id: id(matchNumber + 1000),
      match_id: id(matchNumber),
      ruleset_id: id(800),
      ruleset_version: 1,
      confirming_user_id: id(900),
      source_match_version: 8,
      last_event_seq: 6,
    },
    last_event: {
      seq: 7,
      type: 'CONFIRM_RESULT',
      actor_id: id(900),
      target_event_id: null as string | null,
      payload: {} as Record<string, unknown>,
      command_id: id(matchNumber + 2000),
    },
    last_command: {
      command_id: id(matchNumber + 2000),
      actor_id: id(900),
      command_type: 'CONFIRM_RESULT',
      applied_version: 9,
      first_event_seq: 7,
      last_event_seq: 7,
    },
    scoring_rules: {
      id: id(800),
      version: 1,
      tie_policy: 'ALLOW_DRAW',
      regulation_periods: 1,
      period_duration_seconds: 60,
      allowed_score_values: [1, 2, 3],
      overtime_duration_seconds: null,
    },
  };
}
type FinalMatch = ReturnType<typeof finalMatch>;
function oneMatch() {
  const teams = participants(2);
  return finalMatch(teams[0]!, teams[1]!);
}
function schedule(teams: StandingParticipant[], scores: Record<string, [number, number]> = {}) {
  const matches: ResultRow[] = [];
  for (let home = 0; home < teams.length; home++) {
    for (let away = home + 1; away < teams.length; away++) {
      const score = scores[`${home + 1}-${away + 1}`];
      const match = finalMatch(
        teams[home]!,
        teams[away]!,
        score?.[0] ?? 0,
        score?.[1] ?? 0,
        200 + matches.length,
      );
      matches.push(
        score
          ? match
          : {
              id: match.id,
              status: 'SCHEDULED',
              version: 1,
              home_entry_id: match.home_entry_id,
              away_entry_id: match.away_entry_id,
              state: null,
              confirmation: null,
              last_event: null,
              last_command: null,
              scoring_rules: null,
            },
      );
    }
  }
  return matches;
}
function table(
  teams: StandingParticipant[],
  matches: ResultRow[],
  overrides: Partial<StandingsRulesetData> = {},
  asOf = now,
) {
  return calculateStandings({
    participants: teams,
    matches,
    rules: { ...rules, ...overrides },
    publicationId: id(702),
    asOf,
    mode: 'PUBLISHED',
  });
}
function expectCode(attempt: () => unknown, code: string, status: number) {
  let error: unknown;
  try {
    attempt();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ code, status });
}

describe('显式单循环排名规则', () => {
  it('三个积分均显式填写，可取0与1000，不推断胜负大小关系', () => {
    expect(
      parseStandingsRules({ winPoints: 0, lossPoints: 1000, drawPoints: 0, tiebreakers: [] }),
    ).toEqual({ winPoints: 0, lossPoints: 1000, drawPoints: 0, tiebreakers: [] });
    expect(parseStandingsRules({ ...explicitRules, winPoints: 1000, lossPoints: 0 })).toEqual({
      ...explicitRules,
      winPoints: 1000,
      lossPoints: 0,
    });
    for (const field of ['winPoints', 'lossPoints', 'drawPoints']) {
      for (const value of [undefined, null, '3', true, -1, 1001, 0.5, NaN, Infinity]) {
        expectCode(
          () => parseStandingsRules({ ...explicitRules, [field]: value }),
          'VALIDATION_ERROR',
          422,
        );
      }
    }
  });

  it('空排序无默认项，有序子集按原顺序保留且与输入隔离', () => {
    expect(parseStandingsRules({ ...explicitRules, tiebreakers: [] }).tiebreakers).toEqual([]);
    const input: StandingsRules = {
      ...explicitRules,
      tiebreakers: ['WINS', 'POINTS_FOR', 'SCORE_DIFFERENCE'],
    };
    const parsed = parseStandingsRules(input);
    expect(parsed.tiebreakers).toEqual(['WINS', 'POINTS_FOR', 'SCORE_DIFFERENCE']);
    input.tiebreakers.reverse();
    expect(parsed.tiebreakers).toEqual(['WINS', 'POINTS_FOR', 'SCORE_DIFFERENCE']);
  });

  it('拒绝H2H、胜率、重复排序及未声明配置', () => {
    for (const tiebreakers of [
      undefined,
      null,
      'WINS',
      ['HEAD_TO_HEAD'],
      ['WIN_PERCENTAGE'],
      ['wins'],
      ['WINS', 'WINS'],
      ['SCORE_DIFFERENCE', 'POINTS_FOR', 'WINS', 'HEAD_TO_HEAD'],
    ])
      expectCode(
        () => parseStandingsRules({ ...explicitRules, tiebreakers }),
        'VALIDATION_ERROR',
        422,
      );
    for (const input of [null, [], {}, { ...explicitRules, scoreDifferenceCap: 20 }])
      expectCode(() => parseStandingsRules(input), 'VALIDATION_ERROR', 422);
  });
});

describe('唯一当前赛果与确认凭据', () => {
  it('只提取精确当前确认的比分和来源，不把运行版本当确认来源版本', () => {
    const match = oneMatch();
    expect(confirmedResult(match)).toEqual({
      matchId: match.id,
      confirmationId: match.confirmation.id,
      sourceMatchVersion: 8,
      lastEventSeq: 6,
      homeEntryId: match.home_entry_id,
      awayEntryId: match.away_entry_id,
      homeScore: 10,
      awayScore: 8,
    });
    match.version = 15;
    match.state.source_version = 15;
    expect(confirmedResult(match)?.sourceMatchVersion).toBe(8);
  });

  it('多节含显式零统计仍按完整合计核验，不要求每节均有得分', () => {
    const match = oneMatch();
    const periods = [
      { period: 1, home: totals(4, 2, 0), away: totals(8, 0, 0) },
      { period: 2, home: totals(0, 0, 0), away: totals(0, 3, 0) },
      { period: 3, home: totals(6, 0, 1), away: totals(0, 0, 0) },
    ];
    match.state.period = 3;
    match.state.period_stats = structuredClone(periods);
    match.confirmation.period_stats = structuredClone(periods);
    expect(confirmedResult(match)).toMatchObject({ homeScore: 10, awayScore: 8 });
  });

  it.each(['SCHEDULED', 'READY', 'LIVE', 'PENDING_CONFIRMATION'])(
    '%s不计旧确认，重开立即撤出而非沿用历史比分',
    (status) => {
      const match = oneMatch();
      match.status = status;
      match.state.requires_reconfirmation = true;
      expect(confirmedResult(match)).toBeNull();
    },
  );

  const damaged: Array<[string, (match: FinalMatch) => void]> = [
    ['FINAL时钟仍运行', (m) => (m.state.clock_running = true)],
    ['FINAL仍有剩余时间', (m) => (m.state.remaining_ms = 1)],
    ['FINAL未完成常规节', (m) => (m.scoring_rules.regulation_periods = 2)],
    ['待重确认标记', (m) => (m.state.requires_reconfirmation = true)],
    ['投影运行版本', (m) => m.state.source_version++],
    ['当前确认指针', (m) => (m.state.latest_confirmation_id = id(9999))],
    ['确认场次', (m) => (m.confirmation.match_id = id(9999))],
    ['投影规则', (m) => (m.state.ruleset_id = id(9999))],
    ['规则版本', (m) => m.scoring_rules.version++],
    ['确认前事件位置', (m) => m.confirmation.last_event_seq--],
    ['最后事件seq', (m) => m.last_event.seq++],
    ['最后事件不是确认', (m) => (m.last_event.type = 'REOPEN_RESULT')],
    ['最后事件操作者', (m) => (m.last_event.actor_id = id(9999))],
    ['最后事件目标', (m) => (m.last_event.target_event_id = id(9999))],
    ['确认事件payload', (m) => (m.last_event.payload = { reason: '伪造' })],
    ['收据命令身份', (m) => (m.last_command.command_id = id(9999))],
    ['收据操作者', (m) => (m.last_command.actor_id = id(9999))],
    ['收据类型', (m) => (m.last_command.command_type = 'RECORD_STAT')],
    ['收据与确认来源版本', (m) => m.last_command.applied_version++],
    [
      '收据来自未来版本',
      (m) => {
        m.confirmation.source_match_version = 20;
        m.last_command.applied_version = 21;
      },
    ],
    ['收据起始事件', (m) => m.last_command.first_event_seq--],
    ['收据结束事件', (m) => m.last_command.last_event_seq++],
    ['确认按节统计', (m) => m.confirmation.period_stats[0]!.home.score++],
    ['确认总比分', (m) => m.confirmation.home_score++],
    ['确认犯规统计', (m) => m.confirmation.away_fouls++],
    ['确认暂停统计', (m) => m.confirmation.home_timeouts++],
    [
      '负数总比分即使投影相同',
      (m) => {
        m.state.home_score = -1;
        m.confirmation.home_score = -1;
      },
    ],
    [
      '非整数统计即使投影相同',
      (m) => {
        m.state.away_timeouts = 0.5;
        m.confirmation.away_timeouts = 0.5;
      },
    ],
    [
      '双方按节统计都为空',
      (m) => {
        m.state.period_stats = [];
        m.confirmation.period_stats = [];
      },
    ],
    [
      '双方按节合计同时与总数不符',
      (m) => {
        m.state.period_stats[0]!.home.score = 3;
        m.confirmation.period_stats[0]!.home.score = 3;
      },
    ],
    [
      '双方按节编号跳跃',
      (m) => {
        m.state.period_stats[0]!.period = 2;
        m.confirmation.period_stats[0]!.period = 2;
      },
    ],
    ['按节数与当前period不符', (m) => m.state.period++],
    [
      '双方按节负数统计相同',
      (m) => {
        m.state.period_stats[0]!.away.fouls = -1;
        m.confirmation.period_stats[0]!.away.fouls = -1;
      },
    ],
  ];
  it.each(damaged)('拒绝损坏来源：%s', (_name, mutate) => {
    const match = oneMatch();
    mutate(match);
    expectCode(() => confirmedResult(match), 'RESULT_SOURCE_INVALID', 409);
  });

  it.each(['state', 'confirmation', 'last_event', 'last_command', 'scoring_rules'])(
    'FINAL缺失%s时拒绝伪装成正常榜单',
    (field) => {
      const match: ResultRow = oneMatch();
      match[field] = null;
      expectCode(() => confirmedResult(match), 'RESULT_SOURCE_INVALID', 409);
    },
  );

  it('同比分旧确认即使替换当前指针，也必须匹配最后CONFIRM及命令收据', () => {
    const match = oneMatch();
    const old = structuredClone(match.confirmation);
    old.id = id(9998);
    old.source_match_version = 4;
    old.last_event_seq = 2;
    match.confirmation = old;
    match.state.latest_confirmation_id = old.id;
    // Scores, reviewer and rules match: those facts alone do not authenticate a result.
    expectCode(() => confirmedResult(match), 'RESULT_SOURCE_INVALID', 409);
  });

  it('允许显式平局；OVERTIME规则下平分FINAL视为损坏', () => {
    const teams = participants(2);
    const match = finalMatch(teams[0]!, teams[1]!, 4, 4);
    expect(confirmedResult(match)).toMatchObject({ homeScore: 4, awayScore: 4 });
    match.scoring_rules.tie_policy = 'OVERTIME';
    expectCode(() => confirmedResult(match), 'RESULT_SOURCE_INVALID', 409);
  });
});

describe('完整单循环来源与排名', () => {
  it.each([2, 3, 32])('%i队完整正式场次但零确认：全部rank null', (count) => {
    const teams = participants(count);
    const result = table(teams, schedule(teams));
    expect(result).toMatchObject({
      confirmedMatchCount: 0,
      totalMatchCount: (count * (count - 1)) / 2,
      isComplete: false,
      hasSharedRanks: false,
    });
    expect(result.rows.map((row) => row.entryId)).toEqual(teams.map((team) => team.entryId));
    for (const row of result.rows)
      expect(row).toMatchObject({
        rank: null,
        tied: false,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        scoreDifference: 0,
        leaguePoints: 0,
      });
  });

  it('部分赛果仍包含未赛队，不暗加场次补偿或隐式同分排序', () => {
    const teams = participants();
    const result = table(teams, schedule(teams, { '1-2': [10, 3] }), { tiebreakers: [] });
    expect(result).toMatchObject({
      confirmedMatchCount: 1,
      totalMatchCount: 3,
      isComplete: false,
      hasSharedRanks: true,
    });
    expect(result.rows.map((row) => [row.entryId, row.played, row.leaguePoints, row.rank])).toEqual(
      [
        [teams[0]!.entryId, 1, 3, 1],
        [teams[1]!.entryId, 1, 0, 2],
        [teams[2]!.entryId, 0, 0, 2],
      ],
    );
  });

  it('三队循环互胜且指标相同，共享第1并只按冻结顺序展示', () => {
    const teams = participants();
    const result = table(
      teams,
      schedule(teams, { '1-2': [10, 0], '1-3': [0, 10], '2-3': [10, 0] }),
    );
    expect(result).toMatchObject({
      isComplete: true,
      hasSharedRanks: true,
      confirmedMatchCount: 3,
    });
    expect(result.rows.map((row) => row.entryId)).toEqual(teams.map((team) => team.entryId));
    for (const row of result.rows)
      expect(row).toMatchObject({
        rank: 1,
        tied: true,
        wins: 1,
        losses: 1,
        pointsFor: 10,
        pointsAgainst: 10,
        scoreDifference: 0,
        leaguePoints: 3,
      });
  });

  it('并列采用1,1,3竞赛排名，不用内部ID/队名决胜', () => {
    const teams = participants();
    const result = table(
      teams,
      schedule(teams, { '1-2': [10, 10], '1-3': [20, 0], '2-3': [20, 0] }),
    );
    expect(result.rows.map((row) => [row.entryId, row.rank, row.tied])).toEqual([
      [teams[0]!.entryId, 1, true],
      [teams[1]!.entryId, 1, true],
      [teams[2]!.entryId, 3, false],
    ]);
  });

  it('排序项顺序改变实际结果，不偷偷插入H2H或其他兜底', () => {
    const teams = participants();
    const matches = schedule(teams, { '1-2': [100, 90], '1-3': [0, 30], '2-3': [20, 0] });
    const differenceFirst = table(teams, matches, {
      tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR'],
    });
    const pointsFirst = table(teams, matches, { tiebreakers: ['POINTS_FOR', 'SCORE_DIFFERENCE'] });
    expect(differenceFirst.rows.map((row) => row.entryId)).toEqual([
      teams[1]!.entryId,
      teams[2]!.entryId,
      teams[0]!.entryId,
    ]);
    expect(pointsFirst.rows.map((row) => row.entryId)).toEqual([
      teams[1]!.entryId,
      teams[0]!.entryId,
      teams[2]!.entryId,
    ]);
    expect(table(teams, matches, { tiebreakers: [] }).rows.map((row) => row.rank)).toEqual([
      1, 1, 1,
    ]);
    expect(pointsFirst.sourceHash).not.toBe(differenceFirst.sourceHash);
  });

  it('WINS仅在显式配置后参与，同积分不等于默认比较胜场', () => {
    const teams = participants();
    const matches = schedule(teams, { '1-2': [1, 2] });
    const zeroPoints = { winPoints: 0, lossPoints: 0, drawPoints: 0 };
    expect(
      table(teams, matches, { ...zeroPoints, tiebreakers: [] }).rows.map((r) => r.rank),
    ).toEqual([1, 1, 1]);
    const result = table(teams, matches, { ...zeroPoints, tiebreakers: ['WINS'] });
    expect(result.rows.map((row) => [row.entryId, row.rank])).toEqual([
      [teams[1]!.entryId, 1],
      [teams[0]!.entryId, 2],
      [teams[2]!.entryId, 2],
    ]);
  });

  it('显式胜负平积分和统计已知向量，全榜双方统计守恒', () => {
    const teams = participants();
    const result = table(teams, schedule(teams, { '1-2': [5, 5], '1-3': [10, 2], '2-3': [3, 4] }), {
      winPoints: 7,
      lossPoints: 2,
      drawPoints: 4,
    });
    expect(result.rows).toEqual([
      {
        ...teams[0]!,
        played: 2,
        wins: 1,
        draws: 1,
        losses: 0,
        pointsFor: 15,
        pointsAgainst: 7,
        scoreDifference: 8,
        leaguePoints: 11,
        rank: 1,
        tied: false,
      },
      {
        ...teams[2]!,
        played: 2,
        wins: 1,
        draws: 0,
        losses: 1,
        pointsFor: 6,
        pointsAgainst: 13,
        scoreDifference: -7,
        leaguePoints: 9,
        rank: 2,
        tied: false,
      },
      {
        ...teams[1]!,
        played: 2,
        wins: 0,
        draws: 1,
        losses: 1,
        pointsFor: 8,
        pointsAgainst: 9,
        scoreDifference: -1,
        leaguePoints: 6,
        rank: 3,
        tied: false,
      },
    ]);
    const sum = (
      field:
        | 'played'
        | 'wins'
        | 'draws'
        | 'losses'
        | 'pointsFor'
        | 'pointsAgainst'
        | 'scoreDifference'
        | 'leaguePoints',
    ) => result.rows.reduce((total, row) => total + row[field], 0);
    expect(sum('played')).toBe(6);
    expect(sum('wins')).toBe(2);
    expect(sum('losses')).toBe(2);
    expect(sum('draws')).toBe(2);
    expect(sum('pointsFor')).toBe(29);
    expect(sum('pointsAgainst')).toBe(29);
    expect(sum('scoreDifference')).toBe(0);
    expect(sum('leaguePoints')).toBe(26);
    for (const row of result.rows) expect(row.played).toBe(row.wins + row.draws + row.losses);
  });

  it('REOPEN撤出当前整场，重确认只计最新结果一次，损坏FINAL拒绝整张榜单', () => {
    const teams = participants(2);
    const match = oneMatch();
    const confirmed = table(teams, [match]);
    match.status = 'PENDING_CONFIRMATION';
    match.state.requires_reconfirmation = true;
    const reopened = table(teams, [match]);
    expect(reopened.confirmedMatchCount).toBe(0);
    expect(reopened.isComplete).toBe(false);
    expect(reopened.rows.map((row) => row.rank)).toEqual([null, null]);
    expect(reopened.sourceHash).not.toBe(confirmed.sourceHash);
    const reconfirmed = oneMatch();
    reconfirmed.version = 15;
    reconfirmed.state.source_version = 15;
    reconfirmed.state.latest_confirmation_id = id(5000);
    reconfirmed.confirmation.id = id(5000);
    reconfirmed.confirmation.source_match_version = 14;
    reconfirmed.confirmation.last_event_seq = 11;
    reconfirmed.state.last_event_seq = 12;
    reconfirmed.last_event.seq = 12;
    reconfirmed.last_event.command_id = id(5001);
    reconfirmed.last_command.command_id = id(5001);
    reconfirmed.last_command.applied_version = 15;
    reconfirmed.last_command.first_event_seq = 12;
    reconfirmed.last_command.last_event_seq = 12;
    const result = table(teams, [reconfirmed]);
    expect(result.confirmedMatchCount).toBe(1);
    expect(result.rows.map((row) => row.played)).toEqual([1, 1]);
    expect(result.sourceHash).not.toBe(confirmed.sourceHash);
    reconfirmed.state.requires_reconfirmation = true;
    expectCode(() => table(teams, [reconfirmed]), 'RESULT_SOURCE_INVALID', 409);
  });

  it('不修改输入，asOf和读取顺序不影响业务hash', () => {
    const teams = participants();
    const matches = schedule(teams, { '1-2': [3, 2], '1-3': [5, 5] });
    const before = structuredClone({ teams, matches, rules });
    const result = table(teams, matches);
    const later = table(teams, [...matches].reverse(), {}, '2027-01-01T00:00:00.000Z');
    expect({ teams, matches, rules }).toEqual(before);
    expect(later.sourceHash).toBe(result.sourceHash);
    expect(later.rows).toEqual(result.rows);
    expect(later.asOf).not.toBe(result.asOf);
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('UTF8来源哈希已知向量绑定规则、冻结球队顺序及当前确认身份', () => {
    const result = table(participants(2), [oneMatch()]);
    // Independently calculated with Python hashlib/json, UTF8 and compact separators.
    expect(result.sourceHash).toBe(
      '2118863c461c4c0d61030f17af63bf0ccf0132639de1c5ca839bed4125c7a8fa',
    );
  });

  it('FINAL后合法staff运行版本和元数据变化，不撤结果也不改变来源hash', () => {
    const teams = participants(2);
    const match = oneMatch();
    const result = table(teams, [match]);
    const after: ResultRow = structuredClone(match);
    after.version = 22;
    after.state.source_version = 22;
    after.updated_at = '2027-01-01T00:00:00.000Z';
    after.staff = [{ user_id: id(9999), role: 'RESULT_REVIEWER', status: 'DISABLED' }];
    after.state.updated_at = after.updated_at;
    const changed = table(teams, [after]);
    expect(changed).toEqual(result);
    expect(table(teams, [match], { version: 3 }).sourceHash).not.toBe(result.sourceHash);
    expect(table(teams, [match], { winPoints: 4 }).sourceHash).not.toBe(result.sourceHash);
  });

  it('参赛数、身份、正式场数和每对球队必须构成唯一完整单循环', () => {
    for (const count of [0, 1, 33]) {
      const teams = participants(count);
      expectCode(() => table(teams, schedule(teams)), 'RESULT_SOURCE_INVALID', 409);
    }
    const teams = participants();
    const matches = schedule(teams);
    for (const invalidMatches of [
      matches.slice(0, 2),
      [...matches, { ...matches[0], id: id(9998) }],
      [
        matches[0]!,
        {
          ...matches[0],
          id: id(9998),
          home_entry_id: teams[1]!.entryId,
          away_entry_id: teams[0]!.entryId,
        },
        matches[2]!,
      ],
      [matches[0]!, { ...matches[1], id: matches[0]!.id }, matches[2]!],
      [{ ...matches[0], home_entry_id: id(9999) }, ...matches.slice(1)],
      [{ ...matches[0], away_entry_id: teams[0]!.entryId }, ...matches.slice(1)],
    ])
      expectCode(() => table(teams, invalidMatches), 'RESULT_SOURCE_INVALID', 409);
    for (const field of ['entryId', 'teamId'] as const) {
      const duplicate = structuredClone(teams);
      duplicate[1]![field] = duplicate[0]![field];
      expectCode(() => table(duplicate, matches), 'RESULT_SOURCE_INVALID', 409);
    }
  });
});
