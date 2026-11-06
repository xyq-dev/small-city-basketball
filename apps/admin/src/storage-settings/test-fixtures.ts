import type {
  StorageCommandResult,
  StorageSettingsSnapshot,
} from '@small-city-basketball/contracts';

export function storageSnapshot(
  overrides: Partial<StorageSettingsSnapshot> = {},
): StorageSettingsSnapshot {
  return {
    canManage: true,
    quarantined: false,
    keyConfigured: true,
    version: 7,
    draft: {
      bucket: 'scb-media-1250000000',
      region: 'ap-guangzhou',
      prefix: 'scb-media/v1',
      version: 3,
      credentialsConfigured: true,
    },
    active: {
      provider: 'DATABASE',
      source: 'ENVIRONMENT',
      version: null,
      destination: null,
      applied: true,
    },
    test: null,
    destinationLocked: false,
    cleanupPending: false,
    ...overrides,
  };
}

export function passedSnapshot(
  overrides: Partial<StorageSettingsSnapshot> = {},
): StorageSettingsSnapshot {
  return storageSnapshot({
    test: {
      id: 'test-synthetic-3',
      configVersion: 3,
      status: 'PASSED',
      checks: ['DESTINATION', 'VERSIONING', 'ROUND_TRIP', 'DELETE'].map((key) => ({
        key: key as 'DESTINATION' | 'VERSIONING' | 'ROUND_TRIP' | 'DELETE',
        status: 'PASSED',
      })),
      cleanupPending: false,
      completedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      message: null,
    },
    ...overrides,
  });
}

export function storageReceipt(
  commandId: string,
  kind: StorageCommandResult['kind'],
  overrides: Partial<StorageCommandResult> = {},
): StorageCommandResult {
  return {
    commandId,
    kind,
    status: 'SUCCEEDED',
    configVersion: 3,
    testId: kind === 'TEST' ? 'test-synthetic-3' : null,
    error: null,
    ...overrides,
  };
}
