import type { MatchReschedulingData, RescheduleMatchInput } from '@small-city-basketball/contracts';
import { court, officialMatches, overview, revision } from './test-fixtures';

export const secondCourt = { ...court, id: 'court-b', name: '合成备用球场' };
export const publishedRevision = {
  ...revision,
  status: 'PUBLISHED' as const,
  version: 3,
  eventVersion: 14,
  policy: {
    ...revision.policy,
    courtWindows: [
      ...revision.policy.courtWindows,
      { ...revision.policy.courtWindows[0]!, courtId: secondCourt.id },
    ],
  },
  fixtures: revision.fixtures.map((fixture, index) => ({
    ...fixture,
    courtId: court.id,
    startsAt: `2026-12-01T0${index * 2 + 1}:00:00.000Z`,
    endsAt: `2026-12-01T0${index * 2 + 2}:00:00.000Z`,
  })),
  capabilities: { canEditAllocations: false, canValidate: false, canPublish: false },
};
export const reschedulingWorkspace: MatchReschedulingData = {
  event: { ...overview.event, status: 'SCHEDULED', version: publishedRevision.eventVersion },
  match: officialMatches(publishedRevision)[0]!,
  policy: publishedRevision.policy,
  history: [],
  historyLimit: 20,
  historyTruncated: false,
  capabilities: { canReschedule: true },
};
export function afterReschedule(
  current: MatchReschedulingData,
  input: RescheduleMatchInput,
): MatchReschedulingData {
  const target = {
    courtId: input.courtId,
    courtName: input.courtId === current.match.courtId ? current.match.courtName : secondCourt.name,
    startsAt: new Date(input.startsAt).toISOString(),
    endsAt: new Date(
      Date.parse(input.startsAt) + current.policy.slotDurationMinutes * 60_000,
    ).toISOString(),
  };
  return {
    ...current,
    capabilities: { ...current.capabilities },
    event: { ...current.event, version: current.event.version + 1 },
    match: { ...current.match, ...target, version: current.match.version + 1 },
    history: [
      {
        id: `change-${current.match.version + 1}`,
        fromMatchVersion: current.match.version,
        toMatchVersion: current.match.version + 1,
        from: {
          courtId: current.match.courtId,
          courtName: current.match.courtName,
          startsAt: current.match.startsAt,
          endsAt: current.match.endsAt,
        },
        to: target,
        reason: input.reason.trim(),
        createdAt: '2026-10-23T01:00:00.000Z',
      },
      ...current.history,
    ].slice(0, 20),
  };
}
