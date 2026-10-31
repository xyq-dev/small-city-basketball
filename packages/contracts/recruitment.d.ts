/** X05: independent pre-schedule recruitment. None of these states grants final eligibility. */
export interface RecruitmentPublicationData {
  id: string;
  publicId: string;
  title: string;
  description: string;
  closesAt: string;
  maxApplications: number;
  status: 'ACTIVE' | 'REVOKED';
  version: number;
  createdAt: string;
  revokedAt: string | null;
}
export interface RecruitmentApplicationData {
  id: string;
  publicationId: string;
  orgId: string;
  eventId: string;
  applicantId: string;
  teamId: string | null;
  teamName: string;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  version: number;
  entryId: string | null;
  reviewReason: string | null;
  createdAt: string;
  decidedAt: string | null;
}
export interface PublicRecruitmentData {
  publicId: string;
  title: string;
  description: string;
  closesAt: string;
  event: { name: string; startDate: string; endDate: string; venueName: string | null };
  requirements: {
    minPlayers: number;
    maxPlayers: number;
    requireIdentity: boolean;
    requireInsurance: boolean;
    requireParticipantMaterials: boolean;
  };
  notice: string;
}
export interface RecruitmentWorkspaceData {
  event: { id: string; name: string; version: number; status: string };
  publication: RecruitmentPublicationData | null;
  capabilities: { canPublish: boolean; canRevoke: boolean; canImport: boolean; canInvite: boolean };
}
export interface EventTeamImportRow {
  teamName: string;
  teamId: string | null;
  leaderUserId: string | null;
}
export interface EventTeamImportIssue {
  row: number;
  field: string;
  code: string;
  message: string;
}
export interface EventTeamImportPreviewData {
  id: string;
  eventVersion: number;
  previewHash: string;
  rows: EventTeamImportRow[];
  issues: EventTeamImportIssue[];
  expiresAt: string;
  canCommit: boolean;
  blocker: string | null;
}
export interface EventInvitationData {
  id: string;
  orgId: string;
  eventId: string;
  teamId: string;
  targetUserId: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';
  version: number;
  entryId: string | null;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
  teamName?: string;
  eventName?: string;
}
export interface RecruitmentPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface PosterExportData {
  id: string;
  kind: 'ROSTER' | 'MATCHUP' | 'RESULT' | 'HONOR';
  sourceHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  width: 1080;
  height: 1440;
  contentType: 'image/png';
}
