import type {
  CourtData,
  EventSchedulingData,
  RegistrationFreezeData,
  ScheduleRevisionData,
  ScheduledMatchData,
} from '@small-city-basketball/contracts';
export const court: CourtData = {
  id: 'court-a',
  orgId: 'org-a',
  name: '合成共享球场',
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-10-22T00:00:00.000Z',
  updatedAt: '2026-10-22T00:00:00.000Z',
  capabilities: { canManage: true },
};
export const freeze: RegistrationFreezeData = {
  id: 'freeze-a',
  eventId: 'event-a',
  rulesetId: 'rules-a',
  rulesetVersion: 2,
  eventVersion: 9,
  createdAt: court.createdAt,
  excludedCounts: { DRAFT: 1, REJECTED: 0, WITHDRAWN: 0 },
  entries: ['甲', '乙', '丙'].map((name, index) => ({
    entryId: `entry-${index + 1}`,
    teamId: `team-${index + 1}`,
    teamName: `合成${name}队`,
    rosterRevisionId: `roster-${index + 1}`,
    players: [
      { memberId: `member-${index + 1}`, name: `合成队员${name}`, jerseyNo: String(index + 1) },
    ],
  })),
};
export const revision: ScheduleRevisionData = {
  id: 'revision-a',
  eventId: 'event-a',
  freezeId: freeze.id,
  algorithmVersion: 'RR_CIRCLE_V1',
  seed: 'a'.repeat(64),
  inputHash: 'b'.repeat(64),
  pairingHash: 'c'.repeat(64),
  status: 'DRAFT',
  version: 1,
  eventVersion: 11,
  isCurrent: true,
  redrawReason: null,
  previousRevisionId: null,
  createdAt: court.createdAt,
  policy: {
    slotDurationMinutes: 60,
    minRestMinutes: 30,
    minLocalDayGap: 0,
    courtWindows: [
      {
        courtId: court.id,
        startsAt: '2026-12-01T01:00:00.000Z',
        endsAt: '2026-12-01T10:00:00.000Z',
      },
    ],
  },
  source: freeze,
  participants: freeze.entries.map(({ entryId, teamId, teamName, rosterRevisionId }) => ({
    entryId,
    teamId,
    teamName,
    rosterRevisionId,
  })),
  rounds: [
    { roundNo: 1, byeEntryId: 'entry-3' },
    { roundNo: 2, byeEntryId: 'entry-2' },
    { roundNo: 3, byeEntryId: 'entry-1' },
  ],
  fixtures: [
    ['entry-1', 'entry-2'],
    ['entry-1', 'entry-3'],
    ['entry-2', 'entry-3'],
  ].map(([homeEntryId, awayEntryId], index) => ({
    fixtureKey: `round-${index + 1}-match-1`,
    roundNo: index + 1,
    positionNo: 1,
    homeEntryId: homeEntryId!,
    awayEntryId: awayEntryId!,
    courtId: null,
    startsAt: null,
    endsAt: null,
  })),
  capabilities: { canEditAllocations: true, canValidate: true, canPublish: true },
};
export const overview: EventSchedulingData = {
  event: {
    id: 'event-a',
    name: '合成城市联赛',
    startDate: '2026-12-01',
    endDate: '2026-12-05',
    timezone: 'Asia/Shanghai',
    venueName: null,
    format: 'ROUND_ROBIN',
    status: 'REGISTRATION_CLOSED',
    version: 10,
    createdAt: court.createdAt,
    updatedAt: court.createdAt,
  },
  freeze: {
    id: freeze.id,
    rulesetId: freeze.rulesetId,
    rulesetVersion: freeze.rulesetVersion,
    eventVersion: freeze.eventVersion,
    entryCount: 3,
  },
  currentRevision: null,
  publication: null,
  support: { supported: true, reason: null },
  capabilities: { canGenerate: true, canRedraw: false, canReadMatches: true },
};
export function currentOverview(value: ScheduleRevisionData = revision): EventSchedulingData {
  return {
    ...overview,
    event: { ...overview.event, version: value.eventVersion },
    currentRevision: value,
    capabilities: { ...overview.capabilities, canGenerate: false, canRedraw: true },
  };
}
export function officialMatches(value: ScheduleRevisionData): ScheduledMatchData[] {
  return value.fixtures.map((fixture, index) => ({
    id: `match-${index + 1}`,
    eventId: value.eventId,
    publicationId: 'publication-a',
    fixtureKey: fixture.fixtureKey,
    roundNo: fixture.roundNo,
    positionNo: fixture.positionNo,
    home: value.participants.find((team) => team.entryId === fixture.homeEntryId)!,
    away: value.participants.find((team) => team.entryId === fixture.awayEntryId)!,
    courtId: fixture.courtId!,
    courtName: '发布时场地名称',
    startsAt: fixture.startsAt!,
    endsAt: fixture.endsAt!,
    status: 'SCHEDULED',
    version: 1,
  }));
}
export function response(data: unknown, meta: Record<string, unknown> = {}, status = 200) {
  return new Response(
    JSON.stringify(
      status < 400
        ? { data, meta: { requestId: 'scheduling-test', nextCursor: null, ...meta } }
        : { error: data },
    ),
    { status },
  );
}
