export type PublicArchiveKind = 'PLAYER' | 'TEAM';
export interface PublicArchiveTechnicalTotals {
  sampledMatchCount: number;
  appearedMatchCount: number;
  playingMs: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  fieldGoalPercentage: number | null;
  threePointPercentage: number | null;
  freeThrowPercentage: number | null;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
}
export interface PublicArchiveData {
  publicKey: string;
  kind: PublicArchiveKind;
  displayName: string;
  publishedAt: string;
  asOf: string;
  authorizedSourceCount: number;
  confirmedMatchCount: number;
  recordedMatchCount: number;
  pendingMatchCount: number;
  invalidMatchCount: number;
  teamOnlyMatchCount: number;
  attributionIncompleteMatchCount: number;
  points: number | null;
  fouls: number | null;
  pointsPerRecordedMatch: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  technical: PublicArchiveTechnicalTotals | null;
  recentRecords: {
    recordKey: string;
    eventName: string;
    date: string;
    points: number | null;
    fouls: number | null;
    source: 'INDEPENDENT_CONFIRMATION';
  }[];
  coverageNotice: string;
}
export interface PublicArchiveProfileData {
  id: string;
  kind: PublicArchiveKind;
  displayName: string;
  version: number;
  orgId: string | null;
  teamId: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'REVOKED';
  publicKey: string | null;
  sources: PublicArchiveSourceData[];
}
export interface PublicArchiveSourceData {
  id: string;
  profileId: string;
  orgId: string;
  eventId: string;
  teamId: string;
  memberId: string | null;
  eventName: string;
  teamName: string;
  memberName: string | null;
  status: 'PENDING' | 'APPROVED' | 'REVOKED';
  version: number;
  reason: string;
  currentlyEffective: boolean;
  canConsent: boolean;
  canRevoke: boolean;
}
export interface PublicArchiveWorkspaceData {
  profiles: PublicArchiveProfileData[];
  manageableTeams: { orgId: string; id: string; name: string }[];
  manageableEvents: { orgId: string; id: string; name: string }[];
  pendingSources: PublicArchiveSourceData[];
  optionsTruncated: boolean;
  disclosureNotice: string;
}
export interface PublicArchiveRankingsData {
  kind: PublicArchiveKind;
  asOf: string;
  entries: { rank: number; archive: PublicArchiveData }[];
  notice: string;
}
