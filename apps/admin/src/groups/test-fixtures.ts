import type {
  EventGroupKnockoutData,
  PublicGroupKnockoutData,
  StandingsTotals,
} from '@small-city-basketball/contracts';
import { overview, publicEvent } from '../viewing/test-fixtures';
export const groupHash = 'd'.repeat(64);
const totals: StandingsTotals = {
  played: 2,
  wins: 1,
  draws: 0,
  losses: 1,
  pointsFor: 10,
  pointsAgainst: 10,
  scoreDifference: 0,
  leaguePoints: 3,
};
const participants = ['甲', '乙', '丙', '丁', '戊', '己'].map((name, i) => ({
  entryId: `entry-${i}`,
  teamId: `team-${i}`,
  rosterRevisionId: `roster-${i}`,
  teamName: `合成${name}队`,
}));
export const groupEvent: EventGroupKnockoutData = {
  event: { ...overview.event, format: 'GROUP_KNOCKOUT' },
  publicationId: 'publication-a',
  config: { groupCount: 2, seededEntryIds: [] },
  capabilities: { canDrawTies: true, canPublishQualification: true, canPublishNextRound: false },
  competition: {
    algorithmVersion: 'GK_BALANCED_V1',
    groupCount: 2,
    sourceHash: groupHash,
    asOf: publicEvent.serverTime,
    groupRoundCount: 3,
    totalMatchCount: 9,
    publishedMatchCount: 6,
    confirmedMatchCount: 6,
    isComplete: false,
    groups: ['A', 'B'].map((key, i) => ({
      groupKey: key,
      label: `${key}组`,
      participants: participants.slice(i * 3, i * 3 + 3),
      standings: {
        mode: 'PUBLISHED',
        rulesetVersion: 1,
        sourceHash: String(i).repeat(64),
        asOf: publicEvent.serverTime,
        confirmedMatchCount: 3,
        totalMatchCount: 3,
        isComplete: true,
        hasSharedRanks: false,
        rows: participants.slice(i * 3, i * 3 + 3).map((p, index) => ({
          ...totals,
          entryId: p.entryId,
          teamId: p.teamId,
          teamName: p.teamName,
          rank: index + 1,
          tied: false,
        })),
      },
      qualifiedEntryIds: [participants[i * 3]!.entryId, participants[i * 3 + 1]!.entryId],
      unresolvedTieEntryIds: [],
      draw: null,
    })),
    qualification: {
      status: 'READY',
      sourceHash: groupHash,
      sources: [],
      slots: ['entry-0', 'entry-4', 'entry-3', 'entry-1'],
      unresolvedGroups: [],
      publicationId: null,
    },
    bracket: null,
    placements: [],
    nextRound: {
      roundNo: 4,
      sourceHash: groupHash,
      sources: [],
      fixtures: [
        ['entry-0', 'entry-4'],
        ['entry-3', 'entry-1'],
      ].map(([home, away], i) => ({
        fixtureKey: `R4-P${i + 1}`,
        roundNo: 4,
        positionNo: i + 1,
        homeEntryId: home!,
        awayEntryId: away!,
        courtId: null,
        startsAt: null,
        endsAt: null,
      })),
    },
  },
};
export const publicGroupEvent: PublicGroupKnockoutData = {
  publicEventId: publicEvent.publicEventId,
  algorithmVersion: 'GK_BALANCED_V1',
  sourceHash: groupHash,
  asOf: publicEvent.serverTime,
  groupCount: 2,
  totalMatchCount: 9,
  publishedMatchCount: 6,
  confirmedMatchCount: 6,
  isComplete: false,
  rules: publicEvent.rules!,
  groups: groupEvent.competition!.groups.map((g) => ({
    groupKey: g.groupKey,
    label: g.label,
    confirmedMatchCount: 3,
    totalMatchCount: 3,
    isComplete: true,
    rows: g.standings.rows.map((r) => {
      const i = Number(r.entryId.slice(-1));
      return {
        ...totals,
        teamKey: String(i).repeat(22),
        teamName: r.teamName,
        rank: r.rank,
        tied: false,
      };
    }),
    qualified: g.qualifiedEntryIds!.map((id) => ({
      teamKey: String(Number(id.slice(-1))).repeat(22),
      teamName: participants.find((p) => p.entryId === id)!.teamName,
    })),
    tieBreakRequired: false,
    tieDrawApplied: false,
  })),
  qualificationStatus: 'READY',
  bracket: null,
  placements: [],
};
export function tieEvent() {
  const value = structuredClone(groupEvent);
  const c = value.competition!;
  c.qualification.status = 'TIE_BREAK_REQUIRED';
  c.qualification.unresolvedGroups = ['A'];
  c.nextRound = null;
  value.capabilities.canPublishQualification = false;
  c.groups[0]!.qualifiedEntryIds = null;
  c.groups[0]!.unresolvedTieEntryIds = ['entry-0', 'entry-1'];
  return value;
}
