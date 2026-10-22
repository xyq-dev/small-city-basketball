import { describe, expect, it } from 'vitest';
import type { ScheduledMatchData, SchedulePolicy } from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import {
  canRescheduleMatch,
  currentFixture,
  parseRescheduleCommand,
  reschedulePlan,
  targetConflicts,
} from './rescheduling-domain.js';

const court = '00000000-0000-4000-8000-000000000001';
const otherCourt = '00000000-0000-4000-8000-000000000002';
const input = {
  type: 'RESCHEDULE',
  expectedEventVersion: 4,
  expectedMatchVersion: 8,
  courtId: court,
  startsAt: '2026-11-01T20:00:00+08:00',
  reason: '  天气原因  ',
};
const policy: SchedulePolicy = {
  slotDurationMinutes: 75,
  minRestMinutes: 30,
  minLocalDayGap: 0,
  courtWindows: [],
};
const match = {
  id: 'match',
  eventId: 'event',
  publicationId: 'publication',
  fixtureKey: 'R1-P1',
  roundNo: 1,
  positionNo: 1,
  courtId: court,
  courtName: '原发布场地名称',
  startsAt: '2026-11-01T11:00:00.000Z',
  endsAt: '2026-11-01T12:15:00.000Z',
  status: 'READY',
  version: 8,
  home: { entryId: 'entryA', teamId: 'teamA', teamName: 'A', rosterRevisionId: 'rosterA' },
  away: { entryId: 'entryB', teamId: 'teamB', teamName: 'B', rosterRevisionId: 'rosterB' },
} satisfies ScheduledMatchData;

describe('rescheduling command boundary', () => {
  it('requires explicit versions, normalizes offset time and trims the mandatory reason', () => {
    expect(parseRescheduleCommand(input)).toEqual({
      ...input,
      startsAt: '2026-11-01T12:00:00.000Z',
      reason: '天气原因',
    });
  });

  it.each([
    { type: 'REPLACE' },
    { expectedEventVersion: undefined },
    { expectedMatchVersion: 0 },
    { expectedMatchVersion: 1.5 },
    { courtId: undefined },
    { courtId: 'invalid' },
    { startsAt: '2026-02-29T20:00:00+08:00' },
    { startsAt: '2026-11-01T20:00:00' },
    { startsAt: '2026-11-01T24:00:00+08:00' },
    { reason: '   ' },
    { reason: '字'.repeat(501) },
    { reason: '原因\u0000' },
    { actorId: court },
    { endsAt: '2026-11-01T23:00:00+08:00' },
    { policy: {} },
  ])('rejects illegal or forged command fields %j', (change) => {
    expect(() => parseRescheduleCommand({ ...input, ...change })).toThrow(ApiError);
  });
});

describe('rescheduling state and plan', () => {
  it.each(['SCHEDULED', 'RUNNING'])('allows only unstarted SCHEDULED/READY in %s', (event) => {
    for (const state of ['SCHEDULED', 'READY']) {
      expect(canRescheduleMatch(event, state, false)).toBe(true);
      expect(canRescheduleMatch(event, state, true)).toBe(false);
    }
    for (const state of ['LIVE', 'PENDING_CONFIRMATION', 'FINAL', 'POSTPONED', 'CANCELLED'])
      expect(canRescheduleMatch(event, state, false)).toBe(false);
  });

  it.each(['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'COMPLETED', 'CANCELLED'])(
    'does not permit rescheduling in event %s',
    (event) => expect(canRescheduleMatch(event, 'SCHEDULED', false)).toBe(false),
  );

  it('keeps the historical name for the same court and computes the unchanged slot duration', () => {
    expect(reschedulePlan(match, parseRescheduleCommand(input), policy, '场地后来改名')).toEqual({
      courtId: court,
      courtName: '原发布场地名称',
      startsAt: '2026-11-01T12:00:00.000Z',
      endsAt: '2026-11-01T13:15:00.000Z',
    });
    expect(match.startsAt).toBe('2026-11-01T11:00:00.000Z');
  });

  it('uses the current canonical name only on a court change', () => {
    expect(
      reschedulePlan(
        match,
        { ...parseRescheduleCommand(input), courtId: otherCourt },
        policy,
        '新馆',
      ),
    ).toMatchObject({ courtId: otherCourt, courtName: '新馆' });
  });

  it('rejects a normalized no-op instead of writing history or relabeling a court', () => {
    try {
      reschedulePlan(match, { courtId: court, startsAt: match.startsAt }, policy, '后来名称');
      throw new Error('Expected a conflict');
    } catch (error) {
      expect(error).toMatchObject({ status: 409, code: 'RESCHEDULE_UNCHANGED' });
    }
  });

  it('builds validation fixtures from current facts and keeps only target-related conflicts', () => {
    expect(currentFixture(match)).toEqual({
      fixtureKey: 'R1-P1',
      roundNo: 1,
      positionNo: 1,
      homeEntryId: 'entryA',
      awayEntryId: 'entryB',
      courtId: court,
      startsAt: match.startsAt,
      endsAt: match.endsAt,
    });
    expect(
      targetConflicts(
        [
          { code: 'COURT_DISABLED', fixtureKeys: ['R2-P1'] },
          { code: 'MIN_REST', fixtureKeys: ['R1-P1', 'R3-P1'] },
          { code: 'COURT_OVERLAP', fixtureKeys: ['R1-P1'], external: true },
        ],
        'R1-P1',
      ),
    ).toEqual([
      { code: 'MIN_REST', fixtureKeys: ['R1-P1', 'R3-P1'] },
      { code: 'COURT_OVERLAP', fixtureKeys: ['R1-P1'], external: true },
    ]);
  });
});
