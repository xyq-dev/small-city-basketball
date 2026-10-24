/** C07: finite public projection, never a grant to private roster/scoring APIs. */
export type PlayerPerformanceLinkStatus = 'PENDING' | 'APPROVED' | 'REVOKED';
export interface PlayerPerformanceRecord {
  recordKey: string;
  eventName: string;
  date: string;
  format: string;
  collectionMode: 'PLAYER_BASIC' | 'TEAM_ONLY';
  attributionComplete: boolean | null;
  points: number | null;
  fouls: number | null;
  source: 'INDEPENDENT_CONFIRMATION';
}
export interface PlayerPerformanceData {
  profileId: string;
  dataStatus: 'NO_AUTHORIZED_SOURCE' | 'NO_PERSONAL_STATS' | 'AVAILABLE' | 'PARTIAL';
  sourceCount: number;
  recordedMatchCount: number;
  confirmedMatchCount: number;
  teamOnlyMatchCount: number;
  pendingMatchCount: number;
  invalidMatchCount: number;
  partialAttributionMatchCount: number;
  totalPoints: number | null;
  totalFouls: number | null;
  pointsPerRecordedMatch: number | null;
  foulsPerRecordedMatch: number | null;
  rebounds: null;
  assists: null;
  minutes: null;
  fieldGoalPercentage: null;
  completedServiceCount: number;
  sampleLimit: 1000;
  truncated: boolean;
  recentRecords: PlayerPerformanceRecord[];
  denominatorNotice: string;
  completenessNotice: string;
  asOf: string;
}
export interface PlayerPerformanceBatchData {
  players: PlayerPerformanceData[];
  unavailableProfileIds: string[];
}
export interface PlayerPerformanceLinkData {
  id: string;
  profileId: string;
  profileName: string;
  orgId: string;
  eventId: string;
  eventName: string;
  teamId: string;
  teamName: string;
  memberId: string;
  memberName: string;
  status: PlayerPerformanceLinkStatus;
  version: number;
  nominatedByUserId: string;
  consentedAt: string | null;
  revokedAt: string | null;
  reason: string;
  sourceCurrentlyAvailable: boolean;
  createdAt: string;
  capabilities: { canConsent: boolean; canRevoke: boolean };
}
export interface PlayerPerformanceWorkspaceData {
  viewerUserId: string;
  ownProfileId: string | null;
  manageableEvents: { id: string; orgId: string; name: string; format: string }[];
  links: PlayerPerformanceLinkData[];
  linksHasMore: boolean;
  /** Private, actor-bound keyset cursor. Null means there is no following page. */
  nextCursor: string | null;
  disclosureNotice: string;
}
export interface PlayerPerformanceSourcesData {
  event: { id: string; orgId: string; name: string; format: string };
  teams: { id: string; name: string; members: { id: string; name: string; jerseyNo: string }[] }[];
}
export interface PlayerPerformanceNominateInput {
  commandId: string;
  profileId: string;
  orgId: string;
  eventId: string;
  teamId: string;
  memberId: string;
  reason: string;
  publisherConsent: true;
}
export interface PlayerPerformanceCommandInput {
  commandId: string;
  expectedVersion: number;
  type: 'CONSENT' | 'REVOKE';
  reason: string;
  playerConsent?: true;
}
