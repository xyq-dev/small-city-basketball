export type TrainingCohortState =
  'DRAFT' | 'ENROLLING' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'SUSPENDED';
export type TrainingEnrollmentState =
  | 'WAITLISTED'
  | 'HOLDING'
  | 'CONFIRMED'
  | 'EXPIRED'
  | 'PAID_UNALLOCATED'
  | 'CANCELLED'
  | 'COMPLETED';
export interface TrainingSessionData {
  id: string;
  startsAt: string;
  endsAt: string;
  state: string;
  version: number;
  coaches: { id: string; name: string }[];
}
export interface TrainingCohortData {
  id: string;
  orgId: string;
  courseId: string;
  title: string;
  description: string;
  address: string;
  state: TrainingCohortState;
  capacity: number;
  available: number;
  totalFen: number;
  termsId: string;
  termsText: string;
  enrollmentDeadline: string;
  version: number;
  sessions: TrainingSessionData[];
  capabilities: {
    canEnroll: boolean;
    canManage: boolean;
    paidEnrollmentEnabled: boolean;
    canComplete: boolean;
    completionBlocker: string | null;
    canResume: boolean;
    resumeBlocker: string | null;
  };
}
export interface TrainingEntitlementData {
  id: string;
  sessionId: string;
  originalSessionId: string;
  netFen: number;
  state: string;
  version: number;
}
export interface TrainingEnrollmentData {
  id: string;
  orgId: string;
  cohortId: string;
  applicantUserId: string;
  payerUserId: string;
  learnerUserId: string;
  state: TrainingEnrollmentState;
  totalFen: number;
  tradeOrderId: string | null;
  holdExpiresAt: string | null;
  version: number;
  entitlements: TrainingEntitlementData[];
  consumptions: Record<string, unknown>[];
  refunds: Record<string, unknown>[];
  capabilities: {
    canConfirm: boolean;
    canCancel: boolean;
    canRequestRefund: boolean;
    canManage: boolean;
  };
}

/** Authorized learner-only alternatives; choosing one still revalidates live capacity and calendars. */
export interface TrainingMakeupOptionData {
  sessionId: string;
  cohortId: string;
  cohortTitle: string;
  address: string;
  startsAt: string;
  endsAt: string;
  availableSeats: number;
  coaches: { name: string }[];
}
export interface TrainingMakeupOptionsData {
  entitlementId: string;
  entitlementVersion: number;
  items: TrainingMakeupOptionData[];
  truncated: boolean;
}
