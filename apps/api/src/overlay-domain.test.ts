import { describe, expect, it } from 'vitest';
import { ApiError } from './errors.js';
import {
  hashOverlayToken,
  newOverlayToken,
  opaqueOverlayId,
  overlayCookie,
  overlayPreview,
  parseOverlayBootstrap,
  parseOverlayCommand,
  readOverlayCookie,
} from './overlay-domain.js';
import type { ResultRow } from './standings-domain.js';

const overlayId = 'O'.repeat(43);
const token = 'T'.repeat(43);
const now = '2026-10-22T03:00:30.000Z';
const anchor = '2026-10-22T03:00:00.000Z';
const issue = { type: 'ISSUE', expectedEventVersion: 5, expiresInMinutes: 60 };
const rotate = {
  type: 'ROTATE',
  expectedEventVersion: 5,
  overlayId,
  expectedGrantVersion: 1,
  expiresInMinutes: 60,
  reason: ' 更换直播设备 ',
};
const revoke = {
  type: 'REVOKE',
  expectedEventVersion: 5,
  overlayId,
  expectedGrantVersion: 1,
  reason: '结束包装授权',
};
function expectCode(action: () => unknown, code: string, status: number) {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ code, status });
  expect((error as ApiError).details).toBeUndefined();
}
function row(): ResultRow {
  return {
    id: 'internal-match',
    org_id: 'internal-org',
    event_id: 'internal-event',
    home_entry_id: 'internal-home',
    away_entry_id: 'internal-away',
    home_team_name: '海风队',
    away_team_name: '星火队',
    status: 'LIVE',
    version: 9,
    state: {
      match_id: 'internal-match',
      ruleset_id: 'internal-rules',
      source_version: 9,
      last_event_seq: 7,
      latest_confirmation_id: 'internal-confirmation',
      requires_reconfirmation: false,
      home_score: 12,
      away_score: 8,
      home_fouls: 2,
      away_fouls: 3,
      home_timeouts: 1,
      away_timeouts: 0,
      period: 2,
      remaining_ms: 45_000,
      clock_running: true,
      anchor_server_time: anchor,
      clock_version: 4,
      period_stats: [
        {
          period: 1,
          home: { score: 4, fouls: 0, timeouts: 1 },
          away: { score: 8, fouls: 3, timeouts: 0 },
        },
        {
          period: 2,
          home: { score: 8, fouls: 2, timeouts: 0 },
          away: { score: 0, fouls: 0, timeouts: 0 },
        },
      ],
    },
    scoring_rules: {
      id: 'internal-rules',
      version: 2,
      regulation_periods: 2,
      period_duration_seconds: 60,
      allowed_score_values: [1, 2, 3],
      tie_policy: 'ALLOW_DRAW',
      overtime_duration_seconds: null,
    },
  };
}
function finalRow(): ResultRow {
  const match = row();
  match.status = 'FINAL';
  match.state.clock_running = false;
  match.state.remaining_ms = 0;
  match.confirmation = {
    id: 'internal-confirmation',
    match_id: match.id,
    ruleset_id: 'internal-rules',
    ruleset_version: 2,
    confirming_user_id: 'private-reviewer',
    source_match_version: 8,
    last_event_seq: 6,
    home_score: 12,
    away_score: 8,
    home_fouls: 2,
    away_fouls: 3,
    home_timeouts: 1,
    away_timeouts: 0,
    period_stats: structuredClone(match.state.period_stats),
  };
  match.last_event = {
    seq: 7,
    type: 'CONFIRM_RESULT',
    actor_id: 'private-reviewer',
    target_event_id: null,
    payload: {},
    command_id: 'private-command',
  };
  match.last_command = {
    command_id: 'private-command',
    actor_id: 'private-reviewer',
    command_type: 'CONFIRM_RESULT',
    applied_version: 9,
    first_event_seq: 7,
    last_event_seq: 7,
  };
  return match;
}

describe('包装授权命令的显式边界', () => {
  it('ISSUE/ROTATE/REVOKE按类型重建，理由trim且不替换授权身份', () => {
    expect(parseOverlayCommand(issue)).toEqual(issue);
    expect(parseOverlayCommand(rotate)).toEqual({ ...rotate, reason: '更换直播设备' });
    expect(parseOverlayCommand(revoke)).toEqual(revoke);
    expect(parseOverlayCommand({ ...issue, expiresInMinutes: 1 })).toMatchObject({
      expiresInMinutes: 1,
    });
    expect(parseOverlayCommand({ ...issue, expiresInMinutes: 10080 })).toMatchObject({
      expiresInMinutes: 10080,
    });
    expect(
      parseOverlayCommand({ ...issue, expectedEventVersion: Number.MAX_SAFE_INTEGER }),
    ).toMatchObject({ expectedEventVersion: Number.MAX_SAFE_INTEGER });
    expect(parseOverlayCommand({ ...revoke, reason: '字'.repeat(200) })).toMatchObject({
      reason: '字'.repeat(200),
    });
  });

  it('Cookie期限不会因PG微秒经JS时间截断而增加一秒', () => {
    expect(
      overlayCookie(
        'T'.repeat(43),
        overlayId,
        '2026-10-22 03:00:00.000900+00',
        '2026-10-22T03:00:01.000Z',
        true,
      ),
    ).toContain('Max-Age=0;');
  });

  it('拒绝隐含TTL、不安全版本和不合法理由，并提供字段错误', () => {
    const invalidInputs = [
      ...[undefined, null, '60', 0, -1, 1.5, 10081, NaN, Infinity].map((expiresInMinutes) => ({
        ...issue,
        expiresInMinutes,
      })),
      ...[undefined, null, '5', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(
        (expectedEventVersion) => ({ ...issue, expectedEventVersion }),
      ),
      ...[undefined, '1', 0, 0.1, Number.MAX_SAFE_INTEGER + 1].map((expectedGrantVersion) => ({
        ...revoke,
        expectedGrantVersion,
      })),
      ...[undefined, null, '', ' ', '字'.repeat(201), '理由\u0000注入'].map((reason) => ({
        ...rotate,
        reason,
      })),
      { ...revoke, overlayId: 'bad' },
    ];
    for (const input of invalidInputs) {
      let error: unknown;
      try {
        parseOverlayCommand(input);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 422 });
      expect((error as ApiError).details?.fieldErrors).toBeDefined();
    }
  });

  it('严格拒绝跨类型字段、客户端模板/凭据及非对象', () => {
    for (const input of [
      { ...issue, overlayId },
      { ...issue, expectedGrantVersion: 1 },
      { ...issue, reason: '不属于ISSUE' },
      { ...issue, template: 'SCOREBAR_1080P_V1' },
      { ...issue, token },
      { ...issue, expiresAt: now },
      { ...revoke, expiresInMinutes: 60 },
      { ...rotate, userId: 'private-user' },
      { ...issue, type: 'EXTEND' },
      { ...issue, type: undefined },
      null,
      [],
      'ISSUE',
    ])
      expect(() => parseOverlayCommand(input)).toThrow(ApiError);
  });
});

describe('独立包装身份与Cookie', () => {
  it('产生独立256bit base64url token且哈希具有固定SHA256向量', () => {
    const generated = Array.from({ length: 8 }, newOverlayToken);
    expect(new Set(generated).size).toBe(8);
    for (const value of generated) {
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(value, 'base64url')).toHaveLength(32);
      expect(hashOverlayToken(value)).toMatch(/^[a-f0-9]{64}$/);
      expect(hashOverlayToken(value)).not.toBe(value);
    }
    expect(hashOverlayToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('opaqueId和bootstrap错误token统一404，不trim/解码或回退私人身份', () => {
    expect(opaqueOverlayId(overlayId)).toBe(overlayId);
    expect(parseOverlayBootstrap({ token })).toEqual({ token });
    for (const value of [
      '',
      'A'.repeat(42),
      'A'.repeat(44),
      `${token}=`,
      ` ${token}`,
      `${token}\n`,
      '中'.repeat(43),
    ]) {
      expectCode(() => opaqueOverlayId(value), 'RESOURCE_NOT_FOUND', 404);
      expectCode(() => parseOverlayBootstrap({ token: value }), 'RESOURCE_NOT_FOUND', 404);
    }
    for (const value of [undefined, null, 1, [], {}])
      expectCode(() => parseOverlayBootstrap({ token: value }), 'RESOURCE_NOT_FOUND', 404);
    expect(() => parseOverlayBootstrap({ token, sid: token })).toThrow(ApiError);
    expect(() => parseOverlayBootstrap({ token, actorId: 'forged' })).toThrow(ApiError);
  });

  it('只读精确scb.overlay，私人会话和其他Cookie均不提供授权', () => {
    expect(readOverlayCookie()).toBeNull();
    expect(readOverlayCookie('')).toBeNull();
    expect(readOverlayCookie(`scb.sid=${token}`)).toBeNull();
    expect(readOverlayCookie(`scb.overlayed=${token}; other=scb.overlay=${token}`)).toBeNull();
    expect(readOverlayCookie(`scb.sid=${'S'.repeat(43)}; scb.overlay=${token}; other=ok`)).toBe(
      token,
    );
    expect(readOverlayCookie(`other=ok;\t scb.overlay=${token}`)).toBe(token);
    for (const value of ['', 'bad', 'A'.repeat(42), 'A'.repeat(44), `${token}=`])
      expect(readOverlayCookie(`scb.overlay=${value}`)).toBeNull();
  });

  it.each([
    `scb.overlay=${token}; scb.overlay=${token}`,
    `scb.overlay=bad; scb.overlay=${token}`,
    `scb.overlay=${token}; scb.overlay=`,
    `scb.overlay`,
    `scb.overlay =${token}`,
    `scb .overlay=${token}`,
    `"scb.overlay"=${token}`,
    `'scb.overlay'=${token}`,
    `scb.overlay="${token}"`,
    `scb.overlay='${token}'`,
    `scb.overlay= ${token}`,
    `scb.overlay=${token} `,
    `scb.overlay=${token}, scb.overlay=${token}`,
    `scb.overlay=${token}; scb.overlay`,
  ])('重复或歧义同名Cookie拒绝，不选择第一个/最后一个：%s', (header) => {
    expectCode(() => readOverlayCookie(header), 'RESOURCE_NOT_FOUND', 404);
  });

  it('Cookie限定本Grant路径、host-only、HttpOnly、Strict且剩余秒只向下取整', () => {
    const cookie = overlayCookie(
      token,
      overlayId,
      '2026-10-22T03:00:00.900Z',
      '2026-10-22T03:00:10.800Z',
      true,
    );
    expect(cookie).toBe(
      `scb.overlay=${token}; Path=/v1/overlays/${overlayId}/; Max-Age=9; HttpOnly; SameSite=Strict; Secure`,
    );
    expect(cookie).not.toContain('Domain=');
    expect(overlayCookie(token, overlayId, new Date(now), new Date(now), false)).toBe(
      `scb.overlay=${token}; Path=/v1/overlays/${overlayId}/; Max-Age=0; HttpOnly; SameSite=Strict`,
    );
    expect(overlayCookie(token, overlayId, now, anchor, true)).toContain('Max-Age=0;');
    expect(overlayCookie(token, overlayId, anchor, '2026-10-22T03:00:00.999Z', true)).toContain(
      'Max-Age=0;',
    );
    expect(() => overlayCookie('bad\r\nCookie: forged', overlayId, anchor, now, true)).toThrow(
      ApiError,
    );
    expect(() => overlayCookie(token, '../escape', anchor, now, true)).toThrow(ApiError);
  });
});

describe('独立有限包装投影', () => {
  it('未准备返回null与未采集，不要求public publication或排名规则', () => {
    const match = row();
    match.status = 'SCHEDULED';
    match.state = null;
    match.scoring_rules = null;
    expect(overlayPreview(match, '城市联赛', now)).toEqual({
      eventName: '城市联赛',
      home: { teamName: '海风队' },
      away: { teamName: '星火队' },
      status: 'SCHEDULED',
      matchVersion: 9,
      score: null,
      totals: null,
      periods: null,
      rules: null,
      clock: null,
      collected: {
        teamScore: false,
        teamFouls: false,
        teamTimeouts: false,
        playerStatistics: false,
      },
      resultStatus: 'UNCONFIRMED',
      serverTime: now,
    });
  });

  it('逐项重建全部嵌套字段，保持raw clock而不是再次扣时', () => {
    const match = row();
    const privateValue = 'SYNTHETIC_PRIVATE_DO_NOT_EXPOSE';
    match.roster = [{ name: privateValue }];
    match.staff = [{ email: privateValue }];
    match.lease = { token: privateValue, fencingToken: privateValue };
    match.scoring_rules.created_by = privateValue;
    match.state.secret = privateValue;
    match.state.period_stats[0].home.privatePlayer = privateValue;
    match.state.period_stats[0].actor_id = privateValue;
    const preview = overlayPreview(match, '城市联赛', now);
    expect(preview).toEqual({
      eventName: '城市联赛',
      home: { teamName: '海风队' },
      away: { teamName: '星火队' },
      status: 'LIVE',
      matchVersion: 9,
      score: { home: 12, away: 8 },
      totals: {
        home: { score: 12, fouls: 2, timeouts: 1 },
        away: { score: 8, fouls: 3, timeouts: 0 },
      },
      periods: [
        {
          period: 1,
          home: { score: 4, fouls: 0, timeouts: 1 },
          away: { score: 8, fouls: 3, timeouts: 0 },
        },
        {
          period: 2,
          home: { score: 8, fouls: 2, timeouts: 0 },
          away: { score: 0, fouls: 0, timeouts: 0 },
        },
      ],
      rules: {
        version: 2,
        regulationPeriods: 2,
        periodDurationSeconds: 60,
        allowedScoreValues: [1, 2, 3],
        tiePolicy: 'ALLOW_DRAW',
        overtimeDurationSeconds: null,
      },
      clock: {
        period: 2,
        remainingMs: 45000,
        running: true,
        anchorServerTime: anchor,
        clockVersion: 4,
      },
      collected: { teamScore: true, teamFouls: true, teamTimeouts: true, playerStatistics: false },
      resultStatus: 'UNCONFIRMED',
      serverTime: now,
    });
    expect(JSON.stringify(preview)).not.toContain(privateValue);
    expect(JSON.stringify(preview)).not.toContain('internal-');
    preview.periods![0]!.home.score = 999;
    preview.totals!.home.score = 999;
    preview.rules!.allowedScoreValues.push(2);
    expect(match.state.period_stats[0].home.score).toBe(4);
    expect(match.state.home_score).toBe(12);
    expect(match.scoring_rules.allowed_score_values).toEqual([1, 2, 3]);
  });

  it('READY显式零统计仍已采集，重开待确认不冒充FINAL', () => {
    const match = row();
    match.status = 'READY';
    for (const side of ['home', 'away']) {
      for (const field of ['score', 'fouls', 'timeouts']) {
        match.state[`${side}_${field}`] = 0;
        for (const period of match.state.period_stats) period[side][field] = 0;
      }
    }
    expect(overlayPreview(match, '城市联赛', now)).toMatchObject({
      status: 'READY',
      score: { home: 0, away: 0 },
      collected: { teamScore: true },
      resultStatus: 'UNCONFIRMED',
    });
    match.status = 'PENDING_CONFIRMATION';
    match.state.requires_reconfirmation = true;
    expect(overlayPreview(match, '城市联赛', now).resultStatus).toBe('REQUIRES_RECONFIRMATION');
  });

  it('FINAL必须当前有效确认，合法staff运行版本变化保留正式结果', () => {
    const match = finalRow();
    expect(overlayPreview(match, '城市联赛', now)).toMatchObject({
      resultStatus: 'CONFIRMED',
      score: { home: 12, away: 8 },
    });
    match.version = 12;
    match.state.source_version = 12;
    const preview = overlayPreview(match, '城市联赛', now);
    expect(preview).toMatchObject({ matchVersion: 12, resultStatus: 'CONFIRMED' });
    expect(JSON.stringify(preview)).not.toContain('private-reviewer');
    expect(JSON.stringify(preview)).not.toContain('private-command');
  });

  it.each([
    (m: ResultRow) => {
      m.state.latest_confirmation_id = 'old-confirmation';
    },
    (m: ResultRow) => {
      m.state.requires_reconfirmation = true;
    },
    (m: ResultRow) => {
      m.state.clock_running = true;
    },
    (m: ResultRow) => {
      m.last_command.command_id = 'another-command';
    },
    (m: ResultRow) => {
      m.confirmation.home_score++;
    },
    (m: ResultRow) => {
      m.state.period_stats = [];
      m.confirmation.period_stats = [];
    },
  ])('坏FINAL统一固定409，不泄漏证明或伪造0分', (damage) => {
    const match = finalRow();
    damage(match);
    expectCode(() => overlayPreview(match, '城市联赛', now), 'RESULT_SOURCE_INVALID', 409);
  });

  it.each([
    (m: ResultRow) => {
      m.scoring_rules = null;
    },
    (m: ResultRow) => {
      m.state = null;
    },
    (m: ResultRow) => {
      m.state.period_stats = null;
    },
    (m: ResultRow) => {
      m.state.period_stats = [null];
    },
    (m: ResultRow) => {
      m.state.home_score = -1;
    },
    (m: ResultRow) => {
      m.state.clock_running = 'true';
    },
    (m: ResultRow) => {
      m.state.anchor_server_time = 'not-a-date';
    },
    (m: ResultRow) => {
      m.scoring_rules.allowed_score_values = [];
    },
  ])('已准备结构缺损拒绝，不能降级成未准备null或500', (damage) => {
    const match = row();
    damage(match);
    expectCode(() => overlayPreview(match, '城市联赛', now), 'RESULT_SOURCE_INVALID', 409);
  });
});
