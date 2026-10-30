/** C23 private participant materials. These resources are never anonymous media. */
export type ParticipantMaterialStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED';
export type ParticipantMaterialDisplayStatus = ParticipantMaterialStatus | 'STALE' | 'MISSING';
export interface ParticipantMaterialBlocker {
  code: string;
  message: string;
}
export interface ParticipantMaterialFileInput {
  fileName: string;
  contentType: 'image/jpeg' | 'image/png' | 'application/pdf';
  base64: string;
}
export interface SaveParticipantMaterialsInput {
  /** Lowercase UUID v4. Reuse this exact ID/body to recover an unknown save result. */
  clientRequestId: string;
  /** Zero only for the first draft. */
  expectedVersion: number;
  /** Omitted fields retain their previous value; explicit null clears draft values. */
  realName?: string | null;
  identityNumber?: string | null;
  portrait?: ParticipantMaterialFileInput | null;
  insurance?: {
    insurer?: string | null;
    policyNumber?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    document?: ParticipantMaterialFileInput | null;
  } | null;
  acceptedTerms?: boolean;
  /** Separate opt-in. A replacement photograph never inherits consent implicitly. */
  publicityConsent?: boolean;
}
export interface ParticipantMaterialVersionInput {
  expectedVersion: number;
}
export interface ReviewParticipantMaterialsInput extends ParticipantMaterialVersionInput {
  decision: 'APPROVE' | 'REQUEST_CHANGES';
  reason: string;
  identityChecked?: boolean;
  portraitChecked?: boolean;
  insuranceChecked?: boolean;
}
export interface ParticipantMaterialFileData {
  /** Sanitized generated filename; not the original local filename. */
  fileName: string;
  contentType: 'image/jpeg' | 'application/pdf';
  byteLength: number;
  sha256: string;
}
export interface ParticipantMaterialData {
  /** MISSING entries have null IDs and version 0. */
  id: string | null;
  memberId: string;
  memberName: string;
  status: ParticipantMaterialDisplayStatus;
  storedStatus: ParticipantMaterialStatus | null;
  version: number;
  revisionId: string | null;
  clientRequestId: string | null;
  /** Null for leaders without independent private-material permission. */
  realName: string | null;
  identityMasked: string | null;
  portrait: ParticipantMaterialFileData | null;
  insurance: {
    insurer: string | null;
    policyNumberMasked: string | null;
    startDate: string | null;
    endDate: string | null;
    document: ParticipantMaterialFileData | null;
  } | null;
  acceptedTerms: boolean;
  publicityConsent: boolean;
  reviewReason: string | null;
  reviewedAt: string | null;
  blockers: ParticipantMaterialBlocker[];
  capabilities: { canReview: boolean; canReadPrivate: boolean };
}
export interface MyParticipantMaterialsData {
  entryId: string;
  memberId: string;
  eventName: string;
  teamName: string;
  startDate: string;
  endDate: string;
  rules: { requireInsurance: boolean; termsVersion: 'registration-materials-v1' };
  enabled: boolean;
  frozen: boolean;
  material: ParticipantMaterialData | null;
  capabilities: {
    canSave: boolean;
    canSubmit: boolean;
    canWithdrawPublicity: boolean;
  };
}
export interface ParticipantMaterialsWorkspaceData {
  entryId: string;
  eventName: string;
  teamName: string;
  enabled: boolean;
  frozen: boolean;
  members: ParticipantMaterialData[];
}
/** Returned only by an explicit independently authorized and audited private-info request. */
export interface ParticipantMaterialsPrivateData {
  realName: string | null;
  identityNumber: string | null;
  insurance: {
    insurer: string | null;
    policyNumber: string | null;
    startDate: string | null;
    endDate: string | null;
  } | null;
}
export interface ParticipantMaterialReceiptData {
  clientRequestId: string;
  revisionId: string;
  isCurrent: boolean;
  currentVersion: number;
}
