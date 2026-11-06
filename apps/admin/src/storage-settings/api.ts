import type {
  StorageActivationInput,
  StorageCommandResult,
  StorageSaveInput,
  StorageSettingsSnapshot,
  StorageTestInput,
} from '@small-city-basketball/contracts';
import { ApiError, type ApiClient } from '../api/client';

export interface StorageSettingsApi {
  read(signal?: AbortSignal): Promise<StorageSettingsSnapshot>;
  save(input: StorageSaveInput): Promise<StorageCommandResult>;
  test(input: StorageTestInput): Promise<StorageCommandResult>;
  activate(input: StorageActivationInput): Promise<StorageCommandResult>;
  operation(commandId: string): Promise<StorageCommandResult>;
}

type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const version = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const destination = (value: unknown) =>
  object(value) &&
  typeof value.bucket === 'string' &&
  typeof value.region === 'string' &&
  typeof value.prefix === 'string';
function invalid(): never {
  throw new ApiError(200, 'INVALID_RESPONSE', '对象存储返回不完整，请重新读取状态');
}

function snapshot(value: unknown): StorageSettingsSnapshot {
  if (
    !object(value) ||
    typeof value.canManage !== 'boolean' ||
    typeof value.quarantined !== 'boolean' ||
    typeof value.keyConfigured !== 'boolean' ||
    !version(value.version) ||
    typeof value.destinationLocked !== 'boolean' ||
    typeof value.cleanupPending !== 'boolean' ||
    !object(value.active) ||
    !['DATABASE', 'COS'].includes(String(value.active.provider)) ||
    !['ENVIRONMENT', 'ADMIN'].includes(String(value.active.source)) ||
    !(value.active.version === null || version(value.active.version)) ||
    !(value.active.destination === null || destination(value.active.destination)) ||
    typeof value.active.applied !== 'boolean'
  )
    return invalid();
  if (
    value.draft !== null &&
    (!object(value.draft) ||
      !destination(value.draft) ||
      !version(value.draft.version) ||
      typeof value.draft.credentialsConfigured !== 'boolean')
  )
    return invalid();
  if (value.test !== null) {
    const test = value.test;
    if (
      !object(test) ||
      typeof test.id !== 'string' ||
      !test.id ||
      !version(test.configVersion) ||
      !['RUNNING', 'PASSED', 'FAILED'].includes(String(test.status)) ||
      typeof test.cleanupPending !== 'boolean' ||
      !nullableString(test.completedAt) ||
      !nullableString(test.expiresAt) ||
      !nullableString(test.message) ||
      !Array.isArray(test.checks) ||
      test.checks.some(
        (check) =>
          !object(check) ||
          !['DESTINATION', 'VERSIONING', 'ROUND_TRIP', 'DELETE'].includes(String(check.key)) ||
          !['NOT_RUN', 'PASSED', 'FAILED'].includes(String(check.status)),
      )
    )
      return invalid();
  }
  return value as unknown as StorageSettingsSnapshot;
}

function receipt(value: unknown): StorageCommandResult {
  if (
    !object(value) ||
    typeof value.commandId !== 'string' ||
    !value.commandId ||
    !['SAVE', 'TEST', 'ACTIVATE'].includes(String(value.kind)) ||
    !['RUNNING', 'SUCCEEDED', 'FAILED'].includes(String(value.status)) ||
    !(value.configVersion === null || version(value.configVersion)) ||
    !nullableString(value.testId) ||
    !(
      value.error === null ||
      (object(value.error) &&
        typeof value.error.code === 'string' &&
        typeof value.error.message === 'string')
    )
  )
    return invalid();
  return value as unknown as StorageCommandResult;
}

export function createStorageSettingsApi(client: ApiClient): StorageSettingsApi {
  const base = '/v1/platform/storage';
  async function command(
    path: string,
    method: string,
    input: StorageSaveInput | StorageTestInput | StorageActivationInput,
  ) {
    const result = receipt(
      (await client.request<unknown>(base + path, { method, body: JSON.stringify(input) })).data,
    );
    if (result.commandId !== input.commandId) return invalid();
    return result;
  }
  return {
    async read(signal) {
      return snapshot((await client.request<unknown>(base, { signal })).data);
    },
    save: (input) => command('/draft', 'PUT', input),
    test: (input) => command('/tests', 'POST', input),
    activate: (input) => command('/activation', 'POST', input),
    async operation(commandId) {
      const result = receipt(
        (await client.request<unknown>(`${base}/operations/${encodeURIComponent(commandId)}`)).data,
      );
      if (result.commandId !== commandId) return invalid();
      return result;
    },
  };
}
