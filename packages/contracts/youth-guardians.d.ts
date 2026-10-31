/** E08 current-consent guard. Private identity/evidence are never part of these public DTOs. */
export type YouthPurpose = 'PARTICIPATION' | 'PUBLICITY' | 'PUBLIC_ARCHIVE' | 'LIVE_RECORDING';
export type YouthGuardianStatus =
  'AWAITING_GUARDIAN' | 'AWAITING_REVIEW' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
export interface YouthPolicyData {
  enabled: boolean;
  version: number;
  guardianAgeThreshold: number;
  termsVersion: string;
}
export interface YouthGuardianRequestData {
  id: string;
  orgId: string;
  eventId: string;
  eventName: string;
  entryId: string;
  memberId: string;
  subjectName: string;
  guardianName: string;
  version: number;
  status: YouthGuardianStatus;
  role: 'SUBJECT' | 'GUARDIAN' | 'REVIEWER';
  policyVersion: number;
  termsVersion: string;
  guardianPayloadVersion: number;
  subjectPurposes: YouthPurpose[];
  guardianPurposes: YouthPurpose[];
  subjectConfirmed: boolean;
  guardianConfirmed: boolean;
  reviewReason: string | null;
  current: boolean;
  blockers: string[];
  capabilities: {
    canConfirm: boolean;
    canReview: boolean;
    canWithdraw: boolean;
    canReadProof: boolean;
  };
}
export interface YouthSnapshot {
  memberId: string;
  requestId: string;
  requestVersion: number;
  policyVersion: number;
  materialRevisionId: string;
  qualificationId: string;
  guardianPayloadVersion: number;
  termsVersion: string;
}
export interface YouthEligibility {
  required: boolean;
  ready: boolean;
  blockers: string[];
  snapshot: YouthSnapshot | null;
}
export interface YouthEntryEligibility {
  ready: boolean;
  blockers: { memberId: string; code: string }[];
  snapshots: YouthSnapshot[];
}
