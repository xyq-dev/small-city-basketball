export interface StorageDestination {
  bucket: string;
  region: string;
  prefix: string;
}
export interface StorageSettingsDraft extends StorageDestination {
  version: number;
  credentialsConfigured: boolean;
}
export type StorageTestCheckKey = 'DESTINATION' | 'VERSIONING' | 'ROUND_TRIP' | 'DELETE';
export interface StorageTestCheck {
  key: StorageTestCheckKey;
  status: 'NOT_RUN' | 'PASSED' | 'FAILED';
}
export interface StorageSettingsTest {
  id: string;
  configVersion: number;
  status: 'RUNNING' | 'PASSED' | 'FAILED';
  checks: StorageTestCheck[];
  cleanupPending: boolean;
  completedAt: string | null;
  expiresAt: string | null;
  message: string | null;
}
export interface StorageSettingsSnapshot {
  canManage: boolean;
  quarantined: boolean;
  keyConfigured: boolean;
  /** Resource CAS version; may advance independently of the saved revision. */
  version: number;
  draft: StorageSettingsDraft | null;
  active: {
    provider: 'DATABASE' | 'COS';
    source: 'ENVIRONMENT' | 'ADMIN';
    version: number | null;
    destination: StorageDestination | null;
    /** Verified by the same resolver used by media operations, never a UI timer. */
    applied: boolean;
  };
  test: StorageSettingsTest | null;
  destinationLocked: boolean;
  cleanupPending: boolean;
}
export interface StorageSaveInput extends StorageDestination {
  commandId: string;
  expectedVersion: number;
  /** Both omitted retains saved credentials; a replacement requires both values. */
  secretId?: string;
  secretKey?: string;
}
export interface StorageTestInput {
  commandId: string;
  configVersion: number;
  confirmCloudTest: true;
}
export interface StorageActivationInput {
  commandId: string;
  expectedVersion: number;
  configVersion: number;
  testId: string;
  privatePolicyConfirmed: true;
}
export interface StorageCommandResult {
  commandId: string;
  kind: 'SAVE' | 'TEST' | 'ACTIVATE';
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  configVersion: number | null;
  testId: string | null;
  error: { code: string; message: string } | null;
}
