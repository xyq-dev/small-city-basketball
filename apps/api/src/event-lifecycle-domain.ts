import { administrativeResult } from './match-exception-domain.js';
import type {
  EventLifecycleCommandInput,
  EventLifecycleData,
  EventStatus,
  StandingsRulesetData,
  RegistrationFreezeData,
  SchedulePolicy,
  KnockoutSource,
} from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { expectedVersion } from './registration-validation.js';
import { invalid, objectInput, text } from './validation.js';
import { calculateStandings } from './standings-domain.js';
import type { ResultRow, StandingParticipant } from './standings-domain.js';
import { calculateKnockout } from './knockout-domain.js';
import { confirmedPlayerStatistics } from './confirmed-player-statistics.js';

export const activeEvent = (status: EventStatus) => status === 'SCHEDULED' || status === 'RUNNING';
export const closedEvent = (status: EventStatus) => status === 'COMPLETED' || status === 'ARCHIVED';
export function assertActiveEvent(status: EventStatus): void {
  if (!activeEvent(status))
    throw new ApiError(409, 'INVALID_EVENT_STATE', '赛事当前不可进行比赛写操作');
}
export function publicViewingAllowed(status: EventStatus, purpose: unknown): boolean {
  return (
    (activeEvent(status) && purpose === 'LIVE') || (closedEvent(status) && purpose === 'HISTORY')
  );
}
export function parseLifecycleCommand(raw: unknown): EventLifecycleCommandInput {
  const input = objectInput(raw, ['type', 'expectedEventVersion', 'reason']);
  if (!['COMPLETE', 'ARCHIVE', 'REOPEN'].includes(input.type as string))
    invalid('不支持的赛事生命周期操作');
  return {
    type: input.type as EventLifecycleCommandInput['type'],
    expectedEventVersion: expectedVersion(input.expectedEventVersion),
    reason: text(input.reason, 'reason', 4, 500),
  };
}
export function nextEventStatus(
  status: EventStatus,
  command: EventLifecycleCommandInput['type'],
): EventStatus {
  if (command === 'COMPLETE' && activeEvent(status)) return 'COMPLETED';
  if (command === 'ARCHIVE' && status === 'COMPLETED') return 'ARCHIVED';
  if (command === 'REOPEN' && closedEvent(status)) return 'RUNNING';
  throw new ApiError(409, 'INVALID_EVENT_STATE', '赛事状态已改变，当前不能执行该操作');
}

/** Computes a gate from the existing authoritative result statement; stores no result copy. */
export function completionReadiness(input: {
  publicationId: string | null;
  participants: StandingParticipant[] | null;
  rules: StandingsRulesetData | null;
  matches: ResultRow[];
  asOf: string;
  format?: 'ROUND_ROBIN' | 'DOUBLE_ROUND_ROBIN';
}): EventLifecycleData['completion'] {
  const completion: EventLifecycleData['completion'] = {
    totalMatchCount: input.matches.length,
    confirmedMatchCount: 0,
    ready: false,
    blockers: [],
    sourceHash: null,
  };
  if (!input.publicationId || !input.participants) completion.blockers.push('SCHEDULE_REQUIRED');
  if (!input.rules) completion.blockers.push('STANDINGS_RULES_REQUIRED');
  try {
    for (const match of input.matches) {
      // Validates TEAM_ONLY as well as PLAYER_BASIC confirmations, without another transaction.
      if (!administrativeResult(match)) confirmedPlayerStatistics(match);
      if (match.status === 'FINAL') completion.confirmedMatchCount++;
    }
    if (input.publicationId && input.participants && input.rules) {
      const standings = calculateStandings({
        format: input.format,
        participants: input.participants,
        matches: input.matches,
        rules: input.rules,
        publicationId: input.publicationId,
        asOf: input.asOf,
        mode: 'PUBLISHED',
      });
      completion.confirmedMatchCount = standings.confirmedMatchCount;
      completion.sourceHash = standings.sourceHash;
      if (!standings.isComplete) completion.blockers.push('UNCONFIRMED_MATCHES');
    } else if (!input.matches.length || completion.confirmedMatchCount !== input.matches.length) {
      completion.blockers.push('UNCONFIRMED_MATCHES');
    }
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'RESULT_SOURCE_INVALID') throw error;
    completion.blockers.push('RESULT_SOURCE_INVALID');
    completion.sourceHash = null;
  }
  completion.ready = completion.blockers.length === 0;
  return completion;
}

/** Uses the original confirmed results and deterministic bracket; no stored result copy. */
export function knockoutCompletionReadiness(input: {
  publicationId: string | null;
  source: RegistrationFreezeData | null;
  seed: string;
  policy: SchedulePolicy;
  roundPublications?: { roundNo: number; sources: KnockoutSource[] }[];
  matches: ResultRow[];
  asOf: string;
}): EventLifecycleData['completion'] {
  const completion: EventLifecycleData['completion'] = {
    totalMatchCount: input.source ? input.source.entries.length - 1 : input.matches.length,
    confirmedMatchCount: 0,
    ready: false,
    blockers: [],
    sourceHash: null,
  };
  if (!input.publicationId || !input.source) {
    completion.blockers.push('SCHEDULE_REQUIRED');
    return completion;
  }
  try {
    for (const match of input.matches)
      if (!administrativeResult(match)) confirmedPlayerStatistics(match);
    const bracket = calculateKnockout({
      publicationId: input.publicationId,
      source: input.source,
      seed: input.seed,
      policy: input.policy,
      roundPublications: input.roundPublications,
      matches: input.matches,
      asOf: input.asOf,
    });
    completion.totalMatchCount = bracket.totalMatchCount;
    completion.confirmedMatchCount = bracket.confirmedMatchCount;
    completion.sourceHash = bracket.sourceHash;
    if (!bracket.isComplete) completion.blockers.push('UNCONFIRMED_MATCHES');
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'RESULT_SOURCE_INVALID') throw error;
    completion.blockers.push('RESULT_SOURCE_INVALID');
    completion.sourceHash = null;
  }
  completion.ready = completion.blockers.length === 0;
  return completion;
}
