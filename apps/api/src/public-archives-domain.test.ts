import { describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { PublicArchivesService } from './public-archives-service.js';
import type { ResultRow } from './standings-domain.js';
import {
  archiveProjection,
  archiveCommandInput,
  createArchiveInput,
  MAX_ARCHIVE_MATCHES,
} from './public-archives-domain.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const participant = (n: number) => ({
  entryId: id(10 + n),
  teamId: id(20 + n),
  teamName: `球队${n}`,
  rosterRevisionId: id(30 + n),
});
const roster = (n: number) => [
  { memberId: id(100 + n * 2), name: '合成同名', jerseyNo: '0' },
  { memberId: id(101 + n * 2), name: `合成${n}乙`, jerseyNo: '00' },
];
function final(n = 1, h = 1, a = 2, mode = 'PLAYER_BASIC'): ResultRow {
  const home = participant(h),
    away = participant(a);
  const stats = {
    mode: 'PLAYER_BASIC',
    home: {
      players: roster(h).map((p, i) => ({ ...p, score: i ? 0 : 2, fouls: i ? 0 : 2 })),
      unassigned: { score: 1, fouls: 0 },
    },
    away: {
      players: roster(a).map((p, i) => ({ ...p, score: i ? 0 : 2, fouls: i ? 0 : 1 })),
      unassigned: { score: 0, fouls: 1 },
    },
  };
  const periods = [
    {
      period: 1,
      home: { score: 3, fouls: 2, timeouts: 0 },
      away: { score: 2, fouls: 2, timeouts: 0 },
    },
  ];
  const totals = {
    home_score: 3,
    away_score: 2,
    home_fouls: 2,
    away_fouls: 2,
    home_timeouts: 0,
    away_timeouts: 0,
    period_stats: periods,
    collection_mode: mode,
    player_stats: mode === 'TEAM_ONLY' ? null : stats,
  };
  return {
    id: id(200 + n),
    status: 'FINAL',
    version: 9,
    home_entry_id: home.entryId,
    away_entry_id: away.entryId,
    home_team_id: home.teamId,
    away_team_id: away.teamId,
    home_team_name: home.teamName,
    away_team_name: away.teamName,
    home_roster_revision_id: home.rosterRevisionId,
    away_roster_revision_id: away.rosterRevisionId,
    home_roster: roster(h),
    away_roster: roster(a),
    state: {
      ...structuredClone(totals),
      source_version: 9,
      ruleset_id: id(800),
      period: 1,
      clock_running: false,
      remaining_ms: 0,
      last_event_seq: 7,
      latest_confirmation_id: id(1200 + n),
      requires_reconfirmation: false,
    },
    confirmation: {
      ...structuredClone(totals),
      id: id(1200 + n),
      match_id: id(200 + n),
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
      target_event_id: null,
      payload: {},
      command_id: id(2200 + n),
    },
    last_command: {
      command_id: id(2200 + n),
      actor_id: id(900),
      command_type: 'CONFIRM_RESULT',
      applied_version: 9,
      first_event_seq: 7,
      last_event_seq: 7,
    },
    scoring_rules: { id: id(800), version: 1, tie_policy: 'ALLOW_DRAW', regulation_periods: 1 },
  };
}

const profile = {
  publicKey: 'A'.repeat(43),
  kind: 'PLAYER' as const,
  displayName: '公开昵称',
  publishedAt: '2026-10-31T00:00:00Z',
};
const sample = (m = final()) => ({
  eventName: '已授权赛事',
  date: '2026-10-31',
  teamId: m.home_team_id,
  memberId: id(102),
  proof: m,
});
const project = (matches = [sample()]) =>
  archiveProjection(profile, matches, 1, '2026-10-31T00:00:01Z');
describe('independent public archive whitelist and effective confirmation projection', () => {
  test('legacy personal samples keep professional coverage unknown and never infer actual appearances', () => {
    const p = project();
    expect(p.points).toBe(2);
    expect(p.recordedMatchCount).toBe(1);
    expect(p.technical).toBeNull();
    expect(p.attributionIncompleteMatchCount).toBe(1);
    expect(p.coverageNotice).toContain('不等于实际出场');
  });
  test('team-only personal source remains unknown instead of a zero-point appearance', () => {
    const p = project([sample(final(1, 1, 2, 'TEAM_ONLY'))]);
    expect(p.confirmedMatchCount).toBe(1);
    expect(p.recordedMatchCount).toBe(0);
    expect(p.teamOnlyMatchCount).toBe(1);
    expect(p.points).toBeNull();
    expect(p.technical).toBeNull();
  });
  test('pending, reopened and invalid current confirmations cannot resurrect past career numbers', () => {
    const pending = final();
    pending.status = 'PENDING_CONFIRMATION';
    const invalid = final(2);
    invalid.state.requires_reconfirmation = true;
    const p = project([sample(pending), sample(invalid)]);
    expect(p.points).toBeNull();
    expect(p.confirmedMatchCount).toBe(0);
    expect(p.pendingMatchCount).toBe(1);
    expect(p.invalidMatchCount).toBe(1);
  });
  test('same name and frozen roster membership never merge different member identities', () => {
    const p = project([{ ...sample(), memberId: id(999) }]);
    expect(p.points).toBeNull();
    expect(p.recordedMatchCount).toBe(0);
    expect(p.confirmedMatchCount).toBe(0);
  });
  test('team archives aggregate confirmed team outcomes without exposing any roster identity', () => {
    const p = archiveProjection(
      { ...profile, kind: 'TEAM' },
      [sample()],
      1,
      '2026-10-31T00:00:01Z',
    );
    expect(p.points).toBe(3);
    expect(p.wins).toBe(1);
    expect(p.losses).toBe(0);
    expect(p.technical).toBeNull();
  });
  test('strict public result drops all raw IDs, proof, names and unrelated private properties', () => {
    const p = archiveProjection(
      { ...profile, owner_user_id: id(99), email: 'never@example.test' } as any,
      [sample()],
      1,
      '2026-10-31T00:00:01Z',
    );
    const raw = JSON.stringify(p);
    for (const secret of [
      id(99),
      id(102),
      id(201),
      'never@example.test',
      'home_roster',
      'confirmation',
      '合成同名',
      'orgId',
      'memberId',
    ])
      expect(raw).not.toContain(secret);
    expect(p.recentRecords[0]!.recordKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  test('deduplicates the same confirmed source and fails closed at full-computation capacity', () => {
    expect(project([sample(), sample()]).points).toBe(2);
    expect(() =>
      project(Array.from({ length: MAX_ARCHIVE_MATCHES + 1 }, () => sample())),
    ).toThrow();
  });
  test('professional totals use recorded shots and actual time with explicit partial coverage', () => {
    const m = final();
    m.state.player_stats.home.players[0].score = 3;
    m.confirmation.player_stats.home.players[0].score = 3;
    m.state.player_stats.home.unassigned.score = 0;
    m.confirmation.player_stats.home.unassigned.score = 0;
    const side = (list: any[], home: boolean) => ({
      lineup: [list[0].memberId],
      players: list.map((p, i) => ({
        ...p,
        starter: i === 0,
        appeared: i === 0,
        onCourt: i === 0,
        playingMs: i === 0 ? 10000 : 0,
        fieldGoalsMade: i === 0 ? 1 : 0,
        fieldGoalsAttempted: i === 0 ? 1 : 0,
        threePointersMade: home && i === 0 ? 1 : 0,
        threePointersAttempted: home && i === 0 ? 1 : 0,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        fieldGoalPercentage: i === 0 ? 100 : null,
        threePointPercentage: home && i === 0 ? 100 : null,
        freeThrowPercentage: null,
        rebounds: 0,
        assists: home && i === 0 ? 2 : 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
      })),
    });
    const professional = {
      algorithmVersion: 'PLAYER_TECHNICAL_V1',
      elapsedPlayingMs: 10000,
      home: side(m.home_roster, true),
      away: side(m.away_roster, false),
    };
    m.state.technical_collection = m.confirmation.technical_collection = true;
    m.state.professional_stats = structuredClone(professional);
    m.confirmation.professional_stats = structuredClone(professional);
    const p = project([sample(m), sample(final(2))]);
    expect(p.points).toBe(5);
    expect(p.recordedMatchCount).toBe(2);
    expect(p.technical).toMatchObject({
      sampledMatchCount: 1,
      appearedMatchCount: 1,
      playingMs: 10000,
      fieldGoalsMade: 1,
      threePointersMade: 1,
      fieldGoalPercentage: 100,
      assists: 2,
    });
    const team = archiveProjection(
      { ...profile, kind: 'TEAM' },
      [sample(m)],
      1,
      '2026-10-31T00:00:01Z',
    );
    expect(team.technical).toMatchObject({
      sampledMatchCount: 1,
      appearedMatchCount: 1,
      playingMs: 10000,
      fieldGoalsMade: 1,
      assists: 2,
    });
  });
  test('public publication consent is independent, explicit and cannot use booking/private-season flags', () => {
    expect(() =>
      archiveCommandInput({
        commandId: id(1),
        expectedVersion: 1,
        type: 'PUBLISH',
        bookingConsent: true,
      }),
    ).toThrow();
    expect(() =>
      archiveCommandInput({ commandId: id(1), expectedVersion: 1, type: 'PUBLISH' }),
    ).toThrow();
    expect(
      archiveCommandInput({
        commandId: id(1),
        expectedVersion: 1,
        type: 'PUBLISH',
        publicConsent: true,
      }).publicConsent,
    ).toBe(true);
    expect(() =>
      createArchiveInput({ commandId: id(1), kind: 'PLAYER', displayName: '同名', teamId: id(2) }),
    ).toThrow();
  });
});

function rankingHarness(profiles: any[], proofs: any[]) {
  const statements: string[] = [];
  const c = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.startsWith('BEGIN') || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.startsWith('SELECT p.*,k.consented_at')) return { rows: profiles };
      if (
        sql.startsWith(
          'SELECT id,org_id,event_id,team_id,nominated_by FROM public_archive_sources',
        ) ||
        sql.includes('FOR SHARE')
      )
        return { rows: [] };
      if (sql === 'SELECT statement_timestamp() AS now')
        return { rows: [{ now: new Date('2026-10-31T00:00:00Z') }] };
      if (sql.startsWith('SELECT EXISTS(SELECT 1 FROM youth_guardian_preconsents'))
        return { rows: [{ known: false }] };
      if (sql.includes('FROM public_archive_sources s JOIN youth_event_policies'))
        return { rows: [] };
      if (sql.startsWith('SELECT g.*,p.kind'))
        return {
          rows: profiles.map((p) => ({
            id: p.id,
            profile_id: p.id,
            profile_kind: p.kind,
            owner_user_id: p.owner_user_id,
            youth_enabled: false,
          })),
        };
      if (sql.startsWith('SELECT profile_id,count'))
        return { rows: profiles.map((p) => ({ profile_id: p.id, count: 1 })) };
      if (sql.startsWith('SELECT requested.id')) return { rows: proofs };
      throw Error('Unexpected ranking query');
    },
    release() {},
  };
  const pool = {
    async connect() {
      return c;
    },
    async query() {
      return { rows: [{ attempts: 1 }] };
    },
  };
  return {
    service: new PublicArchivesService(pool as unknown as Pool, {
      databaseUrl: 'postgresql://localhost/scb_test_unit',
      appOrigin: 'http://localhost:5173',
    }),
    statements,
  };
}
describe('public ranking completeness', () => {
  const candidate = (n: number) => ({
    id: id(600 + n),
    public_key: String.fromCharCode(65 + n).repeat(43),
    kind: 'PLAYER',
    owner_user_id: id(700 + n),
    display_name: '公开' + n,
    consented_at: '2026-10-31T00:00:00Z',
  });
  test('refuses an incomplete candidate set rather than publishing a partial top list', async () => {
    const h = rankingHarness(
      Array.from({ length: 1001 }, (_, n) => candidate(n % 20)),
      [],
    );
    await expect(h.service.rankings({ kind: 'PLAYER' }, 'unit')).rejects.toMatchObject({
      status: 503,
      code: 'ARCHIVE_RANKING_CAPACITY',
    });
    expect(h.statements.at(-1)).toBe('ROLLBACK');
  });
  test('refuses a truncated proof set instead of calculating plausible but wrong rankings', async () => {
    const h = rankingHarness(
      [candidate(1)],
      Array.from({ length: 5001 }, () => ({})),
    );
    await expect(h.service.rankings({ kind: 'PLAYER' }, 'unit')).rejects.toMatchObject({
      status: 503,
      code: 'ARCHIVE_RANKING_CAPACITY',
    });
    expect(h.statements.at(-1)).toBe('ROLLBACK');
  });
  test('excludes incomplete personal attribution from ranking while retaining a valid complete profile', async () => {
    const complete = final();
    for (const target of [complete.state, complete.confirmation]) {
      target.player_stats.home.players[0].score = 3;
      target.player_stats.home.unassigned.score = 0;
    }
    const profiles = [candidate(1), candidate(2)],
      h = rankingHarness(profiles, [
        {
          profile_id: profiles[0]!.id,
          event_name: '公开赛事',
          match_date: '2026-10-31',
          team_id: complete.home_team_id,
          member_id: id(102),
          proof: complete,
        },
        {
          profile_id: profiles[1]!.id,
          event_name: '公开赛事',
          match_date: '2026-10-31',
          team_id: complete.home_team_id,
          member_id: id(102),
          proof: final(2),
        },
      ]);
    const result = await h.service.rankings({ kind: 'PLAYER' }, 'unit');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.archive.points).toBe(3);
    expect(result.entries[0]!.rank).toBe(1);
    expect(h.statements.at(-1)).toBe('COMMIT');
  });
});

describe('public archive permission-lock retries', () => {
  test('bounded NOWAIT conflicts return unavailable without projecting old data', async () => {
    let attempts = 0,
      rollbacks = 0,
      releases = 0,
      projectionReads = 0;
    const p = {
      id: id(600),
      kind: 'PLAYER',
      owner_user_id: id(601),
      public_key: 'A'.repeat(43),
      display_name: '旧公开姓名',
      consented_at: '2026-10-31T00:00:00Z',
    };
    const pool = {
      async query() {
        return { rows: [{ attempts: 1 }] };
      },
      async connect() {
        attempts++;
        return {
          async query(sql: string) {
            if (sql.startsWith('BEGIN')) return { rows: [] };
            if (sql === 'ROLLBACK') {
              rollbacks++;
              return { rows: [] };
            }
            if (sql.startsWith('SELECT p.*,k.consented_at')) return { rows: [p] };
            if (sql.startsWith('SELECT id,org_id,event_id,team_id,nominated_by'))
              return { rows: [] };
            if (sql.includes('FOR SHARE')) throw Object.assign(Error('busy'), { code: '55P03' });
            projectionReads++;
            throw Error('Old projection must not be read');
          },
          release() {
            releases++;
          },
        };
      },
    };
    const service = new PublicArchivesService(pool as unknown as Pool, {
      databaseUrl: 'postgresql://localhost/scb_test_unit',
      appOrigin: 'http://localhost:5173',
    });
    await expect(service.publicOne(p.public_key, 'unit')).rejects.toMatchObject({
      status: 503,
      code: 'PUBLIC_ARCHIVE_BUSY',
    });
    expect({ attempts, rollbacks, releases, projectionReads }).toEqual({
      attempts: 3,
      rollbacks: 3,
      releases: 3,
      projectionReads: 0,
    });
  });
  test('serialization change after an old publication lookup restarts and sees the revoked profile', async () => {
    let attempts = 0;
    const p = {
      id: id(600),
      kind: 'PLAYER',
      owner_user_id: id(601),
      public_key: 'A'.repeat(43),
      display_name: '已撤回姓名',
      consented_at: '2026-10-31T00:00:00Z',
    };
    const pool = {
      async query() {
        return { rows: [{ attempts: 1 }] };
      },
      async connect() {
        const attempt = ++attempts;
        return {
          async query(sql: string) {
            if (sql.startsWith('BEGIN') || sql === 'ROLLBACK') return { rows: [] };
            if (sql.startsWith('SELECT p.*,k.consented_at'))
              return { rows: attempt === 1 ? [p] : [] };
            if (sql.startsWith('SELECT id,org_id,event_id,team_id,nominated_by'))
              return { rows: [] };
            if (sql.includes('FOR SHARE')) throw Object.assign(Error('changed'), { code: '40001' });
            throw Error('Unexpected stale read');
          },
          release() {},
        };
      },
    };
    const service = new PublicArchivesService(pool as unknown as Pool, {
      databaseUrl: 'postgresql://localhost/scb_test_unit',
      appOrigin: 'http://localhost:5173',
    });
    await expect(service.publicOne(p.public_key, 'unit')).rejects.toMatchObject({ status: 404 });
    expect(attempts).toBe(2);
  });
});

test('legacy team-only proof with contradictory professional JSON cannot retain score after source rejection', () => {
  const m = final(1, 1, 2, 'TEAM_ONLY');
  m.state.technical_collection = false;
  m.confirmation.technical_collection = false;
  m.state.professional_stats = { algorithmVersion: 'PLAYER_TECHNICAL_V1' };
  m.confirmation.professional_stats = structuredClone(m.state.professional_stats);
  const result = archiveProjection(
    { ...profile, kind: 'TEAM' },
    [sample(m)],
    1,
    '2026-10-31T00:00:01Z',
  );
  expect(result.invalidMatchCount).toBe(1);
  expect(result.recordedMatchCount).toBe(0);
  expect(result.confirmedMatchCount).toBe(0);
  expect(result.points).toBeNull();
  expect(result.technical).toBeNull();
});
