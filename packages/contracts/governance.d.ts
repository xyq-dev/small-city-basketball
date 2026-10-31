export type GovernanceCaseKind = 'SUPPORT' | 'REPORT' | 'APPEAL';
export type GovernanceCaseStatus = 'OPEN' | 'ASSIGNED' | 'RESOLVED' | 'CLOSED';
export type GovernanceVisibility = 'REQUESTER' | 'INTERNAL';
export type CityOperation = 'SUPPLY_REVIEW' | 'SUPPLY_SUSPEND' | 'CASE_MANAGE' | 'SPONSOR_REVIEW';
export interface GovernanceRegion {
  catalogVersion: string;
  regionId: string;
}
export interface GovernanceCaseData {
  id: string;
  orgId: string;
  kind: GovernanceCaseKind;
  title: string;
  status: GovernanceCaseStatus;
  version: number;
  requesterId: string;
  region: GovernanceRegion | null;
  source: { kind: string; id: string } | null;
  parentCaseId: string | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities: {
    canReply: boolean;
    canAssign: boolean;
    canResolve: boolean;
    canClose: boolean;
    canReopen: boolean;
  };
  messages?: {
    id: string;
    authorId: string;
    body: string;
    visibility: GovernanceVisibility;
    createdAt: string;
  }[];
  attachments?: {
    id: string;
    fileName: string;
    contentType: string;
    byteLength: number;
    visibility: GovernanceVisibility;
    createdAt: string;
  }[];
}
export interface CityOperationGrantData {
  id: string;
  userId: string;
  orgId: string;
  region: GovernanceRegion;
  action: CityOperation;
  status: 'ACTIVE' | 'REVOKED';
  version: number;
  expiresAt: string;
  createdAt: string;
  reason: string;
}
export interface SponsorshipData {
  id: string;
  orgId: string;
  eventId: string | null;
  region: GovernanceRegion;
  brand: string;
  title: string;
  body: string;
  startsAt: string;
  endsAt: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  version: number;
  createdBy: string;
  reviewedBy: string | null;
  reviewReason: string | null;
  publicKey: string | null;
  reportedImpressions: number;
}
export interface PublicSponsorshipData {
  publicKey: string;
  brand: string;
  title: string;
  body: string;
  label: '广告／赞助';
  startsAt: string;
  endsAt: string;
  region: GovernanceRegion;
  measurement: 'CLIENT_REPORTED_DEDUPLICATED';
  serverTime: string;
}
export interface PublicLedgerEntryData {
  id: string;
  occurredOn: string;
  label: string;
  amountFen: number;
  kind: 'INCOME' | 'EXPENSE' | 'REVERSAL';
  reversesEntryId: string | null;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  version: number;
  createdBy: string;
  reviewedBy: string | null;
}
export interface PublicLedgerAccountData {
  id: string;
  orgId: string;
  teamId: string | null;
  title: string;
  description: string;
  version: number;
  status: 'ACTIVE' | 'CLOSED';
  publicKey: string | null;
  entries: PublicLedgerEntryData[];
  approvedNetFen: number;
  notice: string;
}
export interface GovernanceReviewData {
  id: string;
  orgId: string;
  sourceKind: 'PLAYER_BOOKING' | 'LOCAL_BOOKING';
  sourceId: string;
  score: number;
  body: string;
  status: 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'WITHDRAWN';
  version: number;
  createdAt: string;
}
export interface PublicLedgerSnapshotData {
  publicKey: string;
  publishedAt: string;
  title: string;
  description: string;
  asOf: string;
  entries: {
    seq: number;
    occurredOn: string;
    label: string;
    kind: 'INCOME' | 'EXPENSE' | 'REVERSAL';
    amountFen: number;
    reversesSeq: number | null;
  }[];
  approvedNetFen: number;
  entryCount: number;
  notice: string;
}
