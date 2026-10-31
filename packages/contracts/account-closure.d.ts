/** Product cooling-off choice, not a statutory period. Final closure is irreversible. */
export type AccountClosureStatus = 'PENDING' | 'BLOCKED' | 'CANCELLED' | 'EXPIRED_AUTH' | 'CLOSED';
export interface AccountClosureData {
  id: string;
  version: number;
  status: AccountClosureStatus;
  coolingOffDays: number;
  requestedAt: string;
  executeAfter: string;
  finishedAt: string | null;
  blockers: string[];
}
export interface AccountClosureWorkspace {
  enabled: boolean;
  request: AccountClosureData | null;
  notice: 'HISTORY_RETAINED_AND_RESTORE_QUARANTINE_REQUIRED';
}
export interface AccountClosureRequestInput {
  clientRequestId: string;
  password: string;
  coolingOffDays?: number;
}
export interface AccountClosureCancelInput {
  clientRequestId: string;
  requestId: string;
  expectedVersion: number;
  password: string;
}
