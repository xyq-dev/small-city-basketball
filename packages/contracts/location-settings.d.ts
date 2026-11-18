export type LocationProviderName = 'AMAP' | 'TENCENT';
export type LocationSecretAction = 'KEEP' | 'REPLACE' | 'CLEAR';
export interface LocationSettingsDraft {
  version: number;
  provider: LocationProviderName;
  signatureEnabled: boolean;
  webKeyConfigured: boolean;
  privateKeyConfigured: boolean;
}
export type LocationTestCheckKey = 'CREDENTIALS' | 'REVERSE' | 'PLACE_SEARCH';
export interface LocationTestCheck {
  key: LocationTestCheckKey;
  status: 'NOT_RUN' | 'PASSED' | 'FAILED';
  message: string | null;
}
export interface LocationSettingsTest {
  id: string;
  configVersion: number;
  status: 'RUNNING' | 'PASSED' | 'FAILED';
  checks: LocationTestCheck[];
  completedAt: string | null;
  message: string | null;
}
export interface LocationSettingsSnapshot {
  canManage: boolean;
  keyConfigured: boolean;
  version: number;
  draft: LocationSettingsDraft | null;
  active: {
    provider: LocationProviderName | 'NONE';
    source: 'ENVIRONMENT' | 'ADMIN' | 'DISABLED';
    version: number | null;
    applied: boolean;
    status: 'UNCONFIGURED' | 'ACTIVE' | 'DISABLED';
  };
  test: LocationSettingsTest | null;
}
export interface LocationSaveInput {
  commandId: string;
  expectedVersion: number;
  provider: LocationProviderName;
  signatureEnabled: boolean;
  webKeyAction: LocationSecretAction;
  webKey?: string;
  privateKeyAction: LocationSecretAction;
  privateKey?: string;
}
export interface LocationTestInput {
  commandId: string;
  configVersion: number;
  confirmCloudTest: true;
}
export interface LocationActivationInput {
  commandId: string;
  expectedVersion: number;
  configVersion: number;
  testId: string;
}
export interface LocationDisableInput {
  commandId: string;
  expectedVersion: number;
}
export interface LocationCommandResult {
  commandId: string;
  kind: 'SAVE' | 'TEST' | 'ACTIVATE' | 'DISABLE';
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  configVersion: number | null;
  testId: string | null;
  error: { code: string; message: string } | null;
}
