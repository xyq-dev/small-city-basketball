import { describe, expect, it } from 'vitest';
import { EVENT_STATUSES } from '@small-city-basketball/contracts';
import { generateKnockoutPairings } from './knockout-domain.js';
import type {
  RegistrationFreezeData,
  SchedulePolicy,
  EventStatus,
  StandingsRulesetData,
} from '@small-city-basketball/contracts';
import {
  activeEvent,
  assertActiveEvent,
  completionReadiness,
  knockoutCompletionReadiness,
  nextEventStatus,
  parseLifecycleCommand,
  publicViewingAllowed,
} from './event-lifecycle-domain.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asOf = '2026-10-23T06:00:00.000Z';
const participants = [0, 1].map((n) => ({
  entryId: id(n + 1),
  teamId: id(n + 3),
  teamName: `合成${n}`,
}));
const rules: StandingsRulesetData = {
  id: id(10),
  eventId: id(11),
  version: 1,
  algorithmVersion: 'RR_STANDINGS_V1',
  winPoints: 3,
  lossPoints: 0,
  drawPoints: 1,
  tiebreakers: [],
  createdAt: asOf,
};
function currentFinal() {
  const stats = {
    home_score: 2,
    away_score: 0,
    home_fouls: 0,
    away_fouls: 0,
    home_timeouts: 0,
    away_timeouts: 0,
    period_stats: [
      {
        period: 1,
        home: { score: 2, fouls: 0, timeouts: 0 },
        away: { score: 0, fouls: 0, timeouts: 0 },
      },
    ],
    collection_mode: 'TEAM_ONLY',
    player_stats: null as Record<string, unknown> | null,
  };
  return {
    id: id(20),
    status: 'FINAL',
    version: 9,
    home_entry_id: id(1),
    away_entry_id: id(2),
    state: {
      ...structuredClone(stats),
      source_version: 9,
      ruleset_id: id(30),
      period: 1,
      clock_running: false,
      remaining_ms: 0,
      last_event_seq: 7,
      latest_confirmation_id: id(21),
      requires_reconfirmation: false,
    },
    confirmation: {
      ...structuredClone(stats),
      id: id(21),
      match_id: id(20),
      ruleset_id: id(30),
      ruleset_version: 1,
      confirming_user_id: id(40),
      source_match_version: 8,
      last_event_seq: 6,
    },
    last_event: {
      seq: 7,
      type: 'CONFIRM_RESULT',
      actor_id: id(40),
      target_event_id: null,
      payload: {},
      command_id: id(22),
    },
    last_command: {
      command_id: id(22),
      actor_id: id(40),
      command_type: 'CONFIRM_RESULT',
      applied_version: 9,
      first_event_seq: 7,
      last_event_seq: 7,
    },
    scoring_rules: { id: id(30), version: 1, tie_policy: 'ALLOW_DRAW', regulation_periods: 1 },
  };
}
const gate = (matches = [currentFinal()], overrides = {}) =>
  completionReadiness({
    publicationId: id(12),
    participants,
    rules,
    matches,
    asOf,
    ...overrides,
  });

describe('explicit event lifecycle', () => {
  it('requires explicit typed commands, a positive version and a trimmed 4–500 character reason', () => {
    expect(
      parseLifecycleCommand({
        type: 'COMPLETE',
        expectedEventVersion: 2,
        reason: '  整届独立复核完毕  ',
      }),
    ).toEqual({ type: 'COMPLETE', expectedEventVersion: 2, reason: '整届独立复核完毕' });
    for (const raw of [
      null,
      [],
      {},
      { type: 'CANCEL', expectedEventVersion: 1, reason: '合成复核原因' },
      { type: 'COMPLETE', expectedEventVersion: 0, reason: '合成复核原因' },
      { type: 'COMPLETE', expectedEventVersion: 1, reason: '三字长' },
      { type: 'REOPEN', expectedEventVersion: 1, reason: ' '.repeat(8) },
      { type: 'ARCHIVE', expectedEventVersion: 1, reason: '字'.repeat(501) },
      { type: 'COMPLETE', expectedEventVersion: 1, reason: '合成复核原因', status: 'COMPLETED' },
    ])
      expect(() => parseLifecycleCommand(raw)).toThrowError(
        expect.objectContaining({ status: 422, code: 'VALIDATION_ERROR' }),
      );
  });

  it('only accepts the frozen status transitions and never turns reopening into a publication', () => {
    const accepted = new Map([
      ['SCHEDULED:COMPLETE', 'COMPLETED'],
      ['RUNNING:COMPLETE', 'COMPLETED'],
      ['COMPLETED:ARCHIVE', 'ARCHIVED'],
      ['COMPLETED:REOPEN', 'RUNNING'],
      ['ARCHIVED:REOPEN', 'RUNNING'],
    ]);
    for (const status of EVENT_STATUSES) {
      for (const command of ['COMPLETE', 'ARCHIVE', 'REOPEN'] as const) {
        const next = accepted.get(`${status}:${command}`);
        if (next) expect(nextEventStatus(status, command)).toBe(next);
        else
          expect(() => nextEventStatus(status, command)).toThrowError(
            expect.objectContaining({ status: 409, code: 'INVALID_EVENT_STATE' }),
          );
      }
      expect(activeEvent(status)).toBe(['SCHEDULED', 'RUNNING'].includes(status));
      if (activeEvent(status)) expect(() => assertActiveEvent(status)).not.toThrow();
      else
        expect(() => assertActiveEvent(status)).toThrowError(
          expect.objectContaining({ code: 'INVALID_EVENT_STATE' }),
        );
    }
  });

  it('requires explicit purpose and the matching event state on every public read', () => {
    for (const status of EVENT_STATUSES)
      for (const purpose of ['LIVE', 'HISTORY', undefined, null, 'UNKNOWN'])
        expect(publicViewingAllowed(status as EventStatus, purpose)).toBe(
          (['SCHEDULED', 'RUNNING'].includes(status) && purpose === 'LIVE') ||
            (['COMPLETED', 'ARCHIVED'].includes(status) && purpose === 'HISTORY'),
        );
  });

  it('uses the existing valid current confirmation and deterministic standings source', () => {
    const before = currentFinal();
    expect(gate([before])).toMatchObject({
      totalMatchCount: 1,
      confirmedMatchCount: 1,
      ready: true,
      blockers: [],
      sourceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(gate([before], { asOf: '2026-10-23T08:00:00.000Z' }).sourceHash).toBe(
      gate([before]).sourceHash,
    );
    expect(before).toEqual(currentFinal());
  });

  it('blocks missing formal sources, pending/reopened matches and incomplete pairings', () => {
    expect(gate([], { publicationId: null, participants: null, rules: null })).toMatchObject({
      ready: false,
      blockers: ['SCHEDULE_REQUIRED', 'STANDINGS_RULES_REQUIRED', 'UNCONFIRMED_MATCHES'],
      sourceHash: null,
    });
    const pending = currentFinal();
    pending.status = 'PENDING_CONFIRMATION';
    expect(gate([pending])).toMatchObject({
      ready: false,
      confirmedMatchCount: 0,
      blockers: ['UNCONFIRMED_MATCHES'],
    });
    expect(gate([])).toMatchObject({
      ready: false,
      blockers: ['RESULT_SOURCE_INVALID'],
      sourceHash: null,
    });
  });

  it('fails closed for stale confirmation proof and C02 personal statistics even if team standings are valid', () => {
    const stale = currentFinal();
    stale.state.source_version--;
    expect(gate([stale])).toMatchObject({
      ready: false,
      blockers: ['RESULT_SOURCE_INVALID'],
      sourceHash: null,
    });
    const mismatch = currentFinal();
    mismatch.state.collection_mode = 'PLAYER_BASIC';
    expect(gate([mismatch])).toMatchObject({ ready: false, blockers: ['RESULT_SOURCE_INVALID'] });
    const leaked = currentFinal();
    leaked.state.player_stats = { unapproved: 'private field' };
    leaked.confirmation.player_stats = structuredClone(leaked.state.player_stats);
    expect(gate([leaked])).toMatchObject({ ready: false, blockers: ['RESULT_SOURCE_INVALID'] });
  });
});

describe('C04 knockout completion, without round-robin points rules', () => {
  const policy: SchedulePolicy = {
    slotDurationMinutes: 30,
    minRestMinutes: 0,
    minLocalDayGap: 0,
    courtWindows: [
      { courtId: id(80), startsAt: '2026-10-23T00:00:00.000Z', endsAt: '2026-10-23T23:59:00.000Z' },
    ],
  };
  function input(count: number) {
    const source: RegistrationFreezeData = {
      id: id(81),
      eventId: id(82),
      rulesetId: id(83),
      rulesetVersion: 1,
      eventVersion: 3,
      entries: Array.from({ length: count }, (_, i) => ({
        entryId: id(i + 1),
        teamId: id(i + 11),
        teamName: `合成${i + 1}`,
        rosterRevisionId: id(i + 21),
        players: [{ memberId: id(i + 101), name: `合成球员${i + 1}`, jerseyNo: String(i + 1) }],
      })),
      excludedCounts: { DRAFT: 0, REJECTED: 0, WITHDRAWN: 0 },
      createdAt: asOf,
    };
    const seed = '1'.repeat(64);
    const fixture = generateKnockoutPairings(source, policy, seed).fixtures[0]!;
    const home = source.entries.find((e) => e.entryId === fixture.homeEntryId)!;
    const away = source.entries.find((e) => e.entryId === fixture.awayEntryId)!;
    const match = {
      ...currentFinal(),
      event_id: source.eventId,
      publication_id: id(84),
      revision_id: id(85),
      fixture_key: fixture.fixtureKey,
      round_no: fixture.roundNo,
      position_no: fixture.positionNo,
      home_entry_id: home.entryId,
      home_team_id: home.teamId,
      home_team_name: home.teamName,
      home_roster_revision_id: home.rosterRevisionId,
      away_entry_id: away.entryId,
      away_team_id: away.teamId,
      away_team_name: away.teamName,
      away_roster_revision_id: away.rosterRevisionId,
      court_id: id(80),
      court_name: '合成球场',
      starts_at: '2026-10-23T01:00:00.000Z',
      ends_at: '2026-10-23T01:30:00.000Z',
      scoring_rules: { ...currentFinal().scoring_rules, tie_policy: 'OVERTIME' },
    };
    return { publicationId: id(84), source, seed, policy, matches: [match], asOf };
  }
  it('completes a two-team final using the original effective confirmation, without standings rules', () => {
    expect(knockoutCompletionReadiness(input(2))).toMatchObject({
      totalMatchCount: 1,
      confirmedMatchCount: 1,
      ready: true,
      blockers: [],
    });
  });
  it('blocks a completed initial round until the unpublished final is played and independently confirmed', () => {
    expect(knockoutCompletionReadiness(input(3))).toMatchObject({
      totalMatchCount: 2,
      confirmedMatchCount: 1,
      ready: false,
      blockers: ['UNCONFIRMED_MATCHES'],
    });
  });
  it('fails closed on a mismatched current confirmation, and reports missing publication separately', () => {
    const bad = input(2);
    bad.matches[0]!.state.latest_confirmation_id = id(999);
    expect(knockoutCompletionReadiness(bad)).toMatchObject({
      ready: false,
      sourceHash: null,
      blockers: ['RESULT_SOURCE_INVALID'],
    });
    expect(knockoutCompletionReadiness({ ...input(2), publicationId: null })).toMatchObject({
      ready: false,
      blockers: ['SCHEDULE_REQUIRED'],
    });
  });
});
