import { describe, expect, it } from 'vitest';
import type { EventPlayerStatisticsRow } from '@small-city-basketball/contracts';
import {
  DISCLOSURE,
  aggregateSeason,
  createSeasonInput,
  eventWithinSeason,
  grantCommandInput,
  grantTransition,
  ineffectiveReasons,
  nominateInput,
  seasonCommandInput,
  seasonCommandTarget,
  teamsByEntry,
  updateSeasonInput,
  upstreamValid,
  withdrawInput,
} from './season-domain.js';
import type { EffectiveGrant, GrantConditions, SeasonEventInput } from './season-domain.js';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const v4 = '7c1f2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string; status?: number }).code;
  }
  return null;
};

describe('C19 season inputs', () => {
  it('creates with a UUID v4 request id, a trimmed name and a bounded date range', () => {
    expect(
      createSeasonInput({
        clientRequestId: v4.toUpperCase(),
        name: '  2028 春季  ',
        startDate: '2028-03-01',
        endDate: '2028-06-30',
      }),
    ).toEqual({
      clientRequestId: v4,
      name: '2028 春季',
      startDate: '2028-03-01',
      endDate: '2028-06-30',
    });
    const base = { clientRequestId: v4, name: '赛季', startDate: '2028-03-01' };
    expect(code(() => createSeasonInput({ ...base, endDate: '2028-02-28' }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(code(() => createSeasonInput({ ...base, endDate: '2030-03-03' }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(code(() => createSeasonInput({ ...base, endDate: '2030-03-01' }))).toBeNull();
    expect(code(() => createSeasonInput({ ...base, endDate: '2028-02-30' }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      code(() =>
        createSeasonInput({
          ...base,
          clientRequestId: '00000000-0000-1000-8000-000000000001',
          endDate: '2028-04-01',
        }),
      ),
    ).toBe('VALIDATION_ERROR');
    expect(code(() => createSeasonInput({ ...base, endDate: '2028-04-01', orgId: u(1) }))).toBe(
      'VALIDATION_ERROR',
    );
  });
  it('patches only provided fields and requires a version and one change', () => {
    const current = { name: '旧', startDate: '2028-01-01', endDate: '2028-12-31' };
    expect(updateSeasonInput({ expectedVersion: 3, name: '新' }, current)).toEqual({
      expectedVersion: 3,
      name: '新',
      startDate: '2028-01-01',
      endDate: '2028-12-31',
    });
    expect(code(() => updateSeasonInput({ expectedVersion: 3 }, current))).toBe('VALIDATION_ERROR');
    expect(code(() => updateSeasonInput({ name: '新' }, current))).toBe('VALIDATION_ERROR');
    expect(
      code(() => updateSeasonInput({ expectedVersion: 1, endDate: '2027-12-31' }, current)),
    ).toBe('VALIDATION_ERROR');
  });
  it('commands carry an event id only for attach/detach', () => {
    expect(seasonCommandInput({ type: 'ACTIVATE', expectedVersion: 1 })).toEqual({
      type: 'ACTIVATE',
      expectedVersion: 1,
    });
    expect(
      seasonCommandInput({ type: 'ATTACH_EVENT', eventId: u(5).toUpperCase(), expectedVersion: 2 }),
    ).toEqual({ type: 'ATTACH_EVENT', eventId: u(5), expectedVersion: 2 });
    expect(code(() => seasonCommandInput({ type: 'ATTACH_EVENT', expectedVersion: 1 }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      code(() => seasonCommandInput({ type: 'CLOSE', eventId: u(1), expectedVersion: 1 })),
    ).toBe('VALIDATION_ERROR');
    expect(code(() => seasonCommandInput({ type: 'REOPEN', expectedVersion: 1 }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(code(() => seasonCommandInput({ type: 'CLOSE', expectedVersion: 0 }))).toBe(
      'VALIDATION_ERROR',
    );
  });
  it('season state machine: DRAFT -> ACTIVE -> CLOSED, CLOSED locks everything', () => {
    expect(seasonCommandTarget('DRAFT', 'ACTIVATE')).toBe('ACTIVE');
    expect(seasonCommandTarget('ACTIVE', 'CLOSE')).toBe('CLOSED');
    expect(seasonCommandTarget('DRAFT', 'ATTACH_EVENT')).toBe('DRAFT');
    expect(seasonCommandTarget('ACTIVE', 'DETACH_EVENT')).toBe('ACTIVE');
    expect(code(() => seasonCommandTarget('DRAFT', 'CLOSE'))).toBe('SEASON_STATE');
    expect(code(() => seasonCommandTarget('ACTIVE', 'ACTIVATE'))).toBe('SEASON_STATE');
    for (const type of ['ACTIVATE', 'CLOSE', 'ATTACH_EVENT', 'DETACH_EVENT'] as const)
      expect(code(() => seasonCommandTarget('CLOSED', type))).toBe('SEASON_CLOSED');
  });
  it('an event belongs in range only when both dates are inside the season', () => {
    const season = { startDate: '2028-03-01', endDate: '2028-03-31' };
    expect(eventWithinSeason({ startDate: '2028-03-01', endDate: '2028-03-31' }, season)).toBe(
      true,
    );
    expect(eventWithinSeason({ startDate: '2028-02-28', endDate: '2028-03-02' }, season)).toBe(
      false,
    );
    expect(eventWithinSeason({ startDate: '2028-03-30', endDate: '2028-04-01' }, season)).toBe(
      false,
    );
  });
});

describe('C19 PRIVATE_SEASON grant rules', () => {
  it('nomination names exact ids and a 4–500 character reason', () => {
    const body = {
      clientRequestId: v4,
      teamId: u(1),
      memberId: u(2),
      targetUserId: u(3),
      reason: '  本届逐人统计提名  ',
    };
    expect(nominateInput(body)).toEqual({ ...body, reason: '本届逐人统计提名' });
    expect(code(() => nominateInput({ ...body, reason: '短' }))).toBe('VALIDATION_ERROR');
    expect(code(() => nominateInput({ ...body, profileId: u(9) }))).toBe('VALIDATION_ERROR');
    expect(code(() => nominateInput({ ...body, memberId: 'x' }))).toBe('VALIDATION_ERROR');
    expect(withdrawInput({ reason: '主办方撤回提名', expectedVersion: 2 })).toEqual({
      reason: '主办方撤回提名',
      expectedVersion: 2,
    });
    expect(grantCommandInput({ type: 'REVOKE', expectedVersion: 2 })).toEqual({
      type: 'REVOKE',
      expectedVersion: 2,
    });
    expect(code(() => grantCommandInput({ type: 'APPROVE', expectedVersion: 1 }))).toBe(
      'VALIDATION_ERROR',
    );
  });
  it('transitions never leave a terminal state, so nothing is revived', () => {
    expect(grantTransition('PENDING', 'CONSENT')).toBe('ACTIVE');
    expect(grantTransition('PENDING', 'DECLINE')).toBe('DECLINED');
    expect(grantTransition('PENDING', 'WITHDRAW')).toBe('WITHDRAWN');
    expect(grantTransition('ACTIVE', 'REVOKE')).toBe('REVOKED');
    expect(grantTransition('ACTIVE', 'WITHDRAW')).toBe('WITHDRAWN');
    for (const status of ['DECLINED', 'WITHDRAWN', 'REVOKED'] as const)
      for (const command of ['CONSENT', 'DECLINE', 'REVOKE', 'WITHDRAW'] as const)
        expect(code(() => grantTransition(status, command))).toBe('SEASON_GRANT_STATE');
    expect(code(() => grantTransition('ACTIVE', 'CONSENT'))).toBe('SEASON_GRANT_STATE');
    expect(code(() => grantTransition('PENDING', 'REVOKE'))).toBe('SEASON_GRANT_STATE');
  });
  it('only an ACTIVE grant with every current condition is effective', () => {
    const ok: GrantConditions = {
      status: 'ACTIVE',
      bindingActive: true,
      nominatorAuthorized: true,
      sourceFrozen: true,
      targetActive: true,
      organizationActive: true,
    };
    expect(ineffectiveReasons(ok)).toEqual([]);
    expect(ineffectiveReasons({ ...ok, status: 'PENDING' })).toEqual(['NOT_CONSENTED']);
    expect(ineffectiveReasons({ ...ok, status: 'REVOKED' })).toEqual(['TERMINATED']);
    expect(ineffectiveReasons({ ...ok, bindingActive: false })).toEqual(['BINDING_ENDED']);
    expect(ineffectiveReasons({ ...ok, nominatorAuthorized: false })).toEqual([
      'NOMINATOR_UNAUTHORIZED',
    ]);
    expect(ineffectiveReasons({ ...ok, sourceFrozen: false })).toEqual(['SOURCE_NOT_FROZEN']);
    expect(ineffectiveReasons({ ...ok, targetActive: false, organizationActive: false })).toEqual([
      'TARGET_INACTIVE',
      'ORGANIZATION_INACTIVE',
    ]);
    expect(upstreamValid({ ...ok, status: 'PENDING' })).toBe(true);
    expect(upstreamValid({ ...ok, status: 'PENDING', bindingActive: false })).toBe(false);
    // A restored permission satisfies the current conditions but cannot revive old consent.
    expect(ineffectiveReasons({ ...ok, invalidationReason: 'NOMINATOR_UNAUTHORIZED' })).toEqual([
      'NOMINATOR_UNAUTHORIZED',
    ]);
    expect(
      upstreamValid({ ...ok, status: 'PENDING', invalidationReason: 'NOMINATOR_UNAUTHORIZED' }),
    ).toBe(false);
    expect(
      ineffectiveReasons({
        ...ok,
        nominatorAuthorized: false,
        invalidationReason: 'NOMINATOR_UNAUTHORIZED',
      }),
    ).toEqual(['NOMINATOR_UNAUTHORIZED']);
  });
  it('the consent disclosure states scope, readers, metric definition, revocation and independence', () => {
    expect(DISCLOSURE.purpose).toMatch(/PRIVATE_SEASON/);
    expect(DISCLOSURE.scope).toMatch(/不跨机构/);
    expect(DISCLOSURE.readers).toMatch(/OWNER\/ADMIN/);
    expect(DISCLOSURE.readers).toMatch(/没有匿名/);
    expect(DISCLOSURE.metrics).toMatch(/未统计/);
    expect(DISCLOSURE.metrics).toMatch(/不代表实际出场/);
    expect(DISCLOSURE.revocation).toMatch(/撤销/);
    expect(DISCLOSURE.independence).toMatch(/预约档案/);
  });
});

describe('C19 season aggregation over confirmed per-event statistics', () => {
  const row = (
    entry: number,
    member: number,
    score: number,
    fouls = 0,
    samples = 1,
  ): EventPlayerStatisticsRow => ({
    entryId: u(100 + entry),
    rosterRevisionId: u(200 + entry),
    memberId: u(member),
    teamName: `队${entry}`,
    name: `成员${member}`,
    jerseyNo: String(member),
    score,
    fouls,
    rosterSampleMatchCount: samples,
    rank: 1,
    tied: false,
  });
  const summary = (rows: EventPlayerStatisticsRow[], hash: string, complete = true) => ({
    algorithmVersion: 'EVENT_PLAYER_BASIC_V1' as const,
    sourceHash: hash,
    asOf: '2028-03-02T00:00:00.000Z',
    totalMatchCount: 1,
    includedMatchCount: complete ? 1 : 0,
    teamOnlyConfirmedMatchCount: 0,
    pendingMatchCount: complete ? 0 : 1,
    coverageComplete: complete,
    attributionComplete: complete,
    rows,
    teams: [],
  });
  const teams = new Map([
    [u(101), u(51)],
    [u(102), u(52)],
  ]);
  const event = (
    id: number,
    rows: EventPlayerStatisticsRow[],
    hash = 'h' + id,
  ): SeasonEventInput => ({
    eventId: u(id),
    name: `赛事${id}`,
    state: 'INCLUDED',
    teamByEntry: teams,
    summary: summary(rows, hash),
  });
  const grant = (n: number, eventId: number, team: number, member: number, user: number) =>
    ({
      grantId: u(900 + n),
      version: 2,
      bindingId: u(800 + n),
      eventId: u(eventId),
      teamId: u(team),
      memberId: u(member),
      userId: u(user),
      displayName: `账号${user}`,
    }) satisfies EffectiveGrant;
  const base = { seasonId: u(1), seasonVersion: 4, asOf: '2028-03-03T00:00:00.000Z' };

  it('groups only granted sources by account, across events, never ungranted players', () => {
    const result = aggregateSeason({
      ...base,
      events: [event(10, [row(1, 7, 6, 1), row(2, 8, 9)]), event(11, [row(1, 7, 4, 2, 2)])],
      grants: [grant(1, 10, 51, 7, 70), grant(2, 11, 51, 7, 70)],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      userId: u(70),
      score: 10,
      fouls: 3,
      rosterSampleMatchCount: 3,
      eventCount: 2,
      rank: 1,
      rebounds: null,
      assists: null,
      minutesPlayed: null,
    });
    expect(result.rows[0]!.sources.map((s) => s.eventId)).toEqual([u(10), u(11)]);
    expect(JSON.stringify(result)).not.toContain('成员8');
    expect(result.notCollected).toEqual(['REBOUNDS', 'ASSISTS', 'MINUTES']);
    expect(result.effectiveGrantCount).toBe(2);
    expect(result.rankingComplete).toBe(true);
  });
  it('a grant for another team never claims a same-member row; duplicate grants count once', () => {
    const result = aggregateSeason({
      ...base,
      events: [event(10, [row(1, 7, 6)])],
      grants: [grant(1, 10, 52, 7, 70), grant(2, 10, 51, 7, 71), grant(3, 10, 51, 7, 71)],
    });
    const byUser = Object.fromEntries(result.rows.map((r) => [r.userId, r.score]));
    expect(byUser[u(70)]).toBeUndefined();
    expect(byUser[u(71)]).toBe(6);
  });
  it('a consent without current confirmed per-player samples never creates a zero-score ranking', () => {
    for (const state of ['NO_SCHEDULE', 'INVALID', 'OUT_OF_RANGE'] as const) {
      const result = aggregateSeason({
        ...base,
        events: [{ eventId: u(10), name: '尚无有效样本', state }],
        grants: [grant(1, 10, 51, 7, 70)],
      });
      expect(result.rows).toEqual([]);
      expect(result.effectiveGrantCount).toBe(1);
      expect(result.rankingComplete).toBe(false);
    }
    const pending = aggregateSeason({
      ...base,
      events: [event(10, [row(1, 7, 0, 0, 0)])],
      grants: [grant(1, 10, 51, 7, 70)],
    });
    expect(pending.rows).toEqual([]);
    const confirmedZero = aggregateSeason({
      ...base,
      events: [event(10, [row(1, 7, 0, 0, 1)])],
      grants: [grant(1, 10, 51, 7, 70)],
    });
    expect(confirmedZero.rows[0]).toMatchObject({ score: 0, rosterSampleMatchCount: 1 });
  });
  it('ties share a rank; excluded events contribute nothing and mark the ranking incomplete', () => {
    const result = aggregateSeason({
      ...base,
      events: [
        event(10, [row(1, 7, 5), row(2, 8, 5)]),
        { eventId: u(12), name: '无效', state: 'INVALID' },
      ],
      grants: [grant(1, 10, 51, 7, 70), grant(2, 10, 52, 8, 71), grant(3, 12, 51, 7, 70)],
    });
    expect(result.rows.map((r) => [r.rank, r.tied])).toEqual([
      [1, true],
      [1, true],
    ]);
    expect(result.rankingComplete).toBe(false);
    expect(result.events.find((e) => e.eventId === u(12))).toMatchObject({
      state: 'INVALID',
      coverageComplete: false,
    });
    const pending = aggregateSeason({
      ...base,
      events: [{ ...event(10, [row(1, 7, 5)]), summary: summary([row(1, 7, 5)], 'p', false) }],
      grants: [grant(1, 10, 51, 7, 70)],
    });
    expect(pending.rankingComplete).toBe(false);
    const empty = aggregateSeason({ ...base, events: [], grants: [] });
    expect(empty.rankingComplete).toBe(false);
    expect(empty.rows).toEqual([]);
  });
  it('sourceHash changes with the season version, event set, grants and confirmed sources', () => {
    const input = {
      ...base,
      events: [event(10, [row(1, 7, 6)])],
      grants: [grant(1, 10, 51, 7, 70)],
    };
    const hash = aggregateSeason(input).sourceHash;
    expect(
      aggregateSeason(structuredClone({ ...input, events: [event(10, [row(1, 7, 6)])] }))
        .sourceHash,
    ).toBe(hash);
    expect(aggregateSeason({ ...input, seasonVersion: 5 }).sourceHash).not.toBe(hash);
    expect(
      aggregateSeason({ ...input, events: [...input.events, event(11, [])] }).sourceHash,
    ).not.toBe(hash);
    expect(aggregateSeason({ ...input, grants: [] }).sourceHash).not.toBe(hash);
    expect(
      aggregateSeason({ ...input, grants: [{ ...input.grants[0]!, version: 3 }] }).sourceHash,
    ).not.toBe(hash);
    expect(
      aggregateSeason({ ...input, events: [event(10, [row(1, 7, 6)], 'reconfirmed')] }).sourceHash,
    ).not.toBe(hash);
  });
  it('maps entries to teams only from the published source', () => {
    expect(
      teamsByEntry({ entries: [{ entryId: u(1), teamId: u(2) }, { entryId: 3 }, null] }),
    ).toEqual(new Map([[u(1), u(2)]]));
    expect(teamsByEntry(null).size).toBe(0);
  });
});
