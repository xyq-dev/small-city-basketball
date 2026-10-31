import type { GroupResultSource } from './match-exceptions.js';
import type {
  EventData,
  KnockoutBracket,
  KnockoutPlacement,
  KnockoutSource,
  ScheduleFixtureData,
  ScheduleParticipant,
  StandingsData,
  PublicTeamData,
  PublicKnockoutData,
  PublicStandingsRow,
  PublicStandingsRules,
} from './index.js';

export interface GroupKnockoutConfig {
  groupCount: 2 | 4 | 8;
  /** At most one per group. Frozen entry IDs; the fixed draw separates these seeds. */
  seededEntryIds: string[];
}
export interface GroupTieDrawData {
  id: string;
  groupKey: string;
  sourceHash: string;
  seed: string;
  tiedEntryIds: string[];
  orderedEntryIds: string[];
  reason: string;
  createdAt: string;
}
export interface GroupQualificationProof {
  id: string;
  sourceHash: string;
  /** Full, effective group-game confirmations, never fabricated wins. */
  sources: GroupResultSource[];
  /** Fixed first-round seats, e.g. A1,B2,C1,D2,B1,A2,D1,C2. */
  slots: string[];
  drawIds: string[];
}
export interface GroupTableData {
  groupKey: string;
  label: string;
  participants: ScheduleParticipant[];
  standings: StandingsData;
  /** Explicit top-two order, after any required persisted tie draw. */
  qualifiedEntryIds: string[] | null;
  unresolvedTieEntryIds: string[];
  draw: GroupTieDrawData | null;
}
export interface GroupCompetitionPlacement {
  entryId: string;
  teamName: string;
  groupKey: string;
  groupRank: number | null;
  stage: 'KNOCKOUT' | 'GROUP_ELIMINATED';
  /** No invented cross-group rank for non-qualifiers. */
  rank: number | null;
  tied: boolean;
}
export interface GroupKnockoutProjection {
  algorithmVersion: 'GK_BALANCED_V1';
  groupCount: 2 | 4 | 8;
  sourceHash: string;
  asOf: string;
  groupRoundCount: number;
  totalMatchCount: number;
  publishedMatchCount: number;
  confirmedMatchCount: number;
  isComplete: boolean;
  groups: GroupTableData[];
  qualification: {
    status: 'WAITING' | 'TIE_BREAK_REQUIRED' | 'READY' | 'PUBLISHED';
    sourceHash: string;
    sources: GroupResultSource[];
    slots: string[];
    unresolvedGroups: string[];
    publicationId: string | null;
  };
  bracket: KnockoutBracket | null;
  placements: GroupCompetitionPlacement[];
  /** Qualification is a distinct explicit command; later rounds reuse PUBLISH_ROUND. */
  nextRound: {
    roundNo: number;
    sourceHash: string;
    sources: GroupResultSource[];
    fixtures: ScheduleFixtureData[];
  } | null;
}
export interface EventGroupKnockoutData {
  event: EventData;
  publicationId: string | null;
  config: GroupKnockoutConfig | null;
  /** Server-replayed frozen draw for review before initial publication. */
  draftGroups?: { groupKey: string; label: string; participants: ScheduleParticipant[] }[];
  competition: GroupKnockoutProjection | null;
  capabilities: {
    canDrawTies: boolean;
    canPublishQualification: boolean;
    canPublishNextRound: boolean;
  };
}
export interface DrawGroupTieInput {
  type: 'DRAW_GROUP_TIE';
  expectedEventVersion: number;
  expectedSourceHash: string;
  groupKey: string;
  reason: string;
}
export interface PublishGroupQualificationInput {
  type: 'PUBLISH_QUALIFICATION';
  expectedEventVersion: number;
  expectedSourceHash: string;
  reason: string;
  allocations: { fixtureKey: string; courtId: string; startsAt: string }[];
}
export interface PublicGroupKnockoutData {
  publicEventId: string;
  algorithmVersion: 'GK_BALANCED_V1';
  sourceHash: string;
  asOf: string;
  groupCount: 2 | 4 | 8;
  totalMatchCount: number;
  publishedMatchCount: number;
  confirmedMatchCount: number;
  isComplete: boolean;
  rules: PublicStandingsRules;
  groups: {
    groupKey: string;
    label: string;
    confirmedMatchCount: number;
    totalMatchCount: number;
    isComplete: boolean;
    rows: PublicStandingsRow[];
    qualified: PublicTeamData[];
    tieBreakRequired: boolean;
    tieDrawApplied: boolean;
  }[];
  qualificationStatus: GroupKnockoutProjection['qualification']['status'];
  bracket: PublicKnockoutData | null;
  placements: {
    team: PublicTeamData;
    groupKey: string;
    groupRank: number | null;
    stage: GroupCompetitionPlacement['stage'];
    rank: number | null;
    tied: boolean;
  }[];
}
