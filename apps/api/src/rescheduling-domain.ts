import type {
  MatchReschedulePlan,
  RescheduleMatchInput,
  ScheduleConflict,
  ScheduleFixtureData,
  SchedulePolicy,
  ScheduledMatchData,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { expectedVersion } from './registration-validation.js';
import { parseScheduleTimestamp } from './scheduling-domain.js';
import { invalid, objectInput, resourceId, text } from './validation.js';

export function parseRescheduleCommand(value: unknown): RescheduleMatchInput {
  const input = objectInput(value, [
    'type',
    'expectedEventVersion',
    'expectedMatchVersion',
    'courtId',
    'startsAt',
    'reason',
  ]);
  if (input.type !== 'RESCHEDULE') invalid('不支持的改期命令');
  if (
    typeof input.courtId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.courtId)
  )
    invalid('场地编号无效');
  return {
    type: 'RESCHEDULE',
    expectedEventVersion: expectedVersion(input.expectedEventVersion),
    expectedMatchVersion: expectedVersion(input.expectedMatchVersion),
    courtId: resourceId(input.courtId),
    startsAt: parseScheduleTimestamp(input.startsAt),
    reason: text(input.reason, 'reason', 1, 500),
  };
}

export function canRescheduleMatch(eventStatus: string, matchStatus: string, started: boolean) {
  return (
    ['SCHEDULED', 'RUNNING'].includes(eventStatus) &&
    ['SCHEDULED', 'READY'].includes(matchStatus) &&
    !started
  );
}

export function reschedulePlan(
  match: ScheduledMatchData,
  input: Pick<RescheduleMatchInput, 'courtId' | 'startsAt'>,
  policy: SchedulePolicy,
  courtName: string,
): MatchReschedulePlan {
  if (match.courtId === input.courtId && match.startsAt === input.startsAt)
    throw new ApiError(409, 'RESCHEDULE_UNCHANGED', '场地和开赛时间没有变化');
  return {
    courtId: input.courtId,
    courtName: match.courtId === input.courtId ? match.courtName : courtName,
    startsAt: input.startsAt,
    endsAt: new Date(
      Date.parse(input.startsAt) + policy.slotDurationMinutes * 60_000,
    ).toISOString(),
  };
}

export function currentFixture(match: ScheduledMatchData): ScheduleFixtureData {
  return {
    fixtureKey: match.fixtureKey,
    roundNo: match.roundNo,
    positionNo: match.positionNo,
    homeEntryId: match.home.entryId,
    awayEntryId: match.away.entryId,
    courtId: match.courtId,
    startsAt: match.startsAt,
    endsAt: match.endsAt,
  };
}

export function targetConflicts(conflicts: ScheduleConflict[], fixtureKey: string) {
  return conflicts.filter((conflict) => conflict.fixtureKeys.includes(fixtureKey));
}
