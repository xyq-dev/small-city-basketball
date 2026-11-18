import type {
  LocationActivationInput,
  LocationCommandResult,
  LocationDisableInput,
  LocationSaveInput,
  LocationSettingsSnapshot,
  LocationTestInput,
} from '@small-city-basketball/contracts';
import { ApiError, type ApiClient } from '../api/client';

export interface LocationSettingsApi {
  read(signal?: AbortSignal): Promise<LocationSettingsSnapshot>;
  save(input: LocationSaveInput): Promise<LocationCommandResult>;
  test(input: LocationTestInput): Promise<LocationCommandResult>;
  activate(input: LocationActivationInput): Promise<LocationCommandResult>;
  disable(input: LocationDisableInput): Promise<LocationCommandResult>;
  operation(commandId: string): Promise<LocationCommandResult>;
}

type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const version = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableString = (value: unknown) => value === null || typeof value === 'string';
function invalid(): never {
  throw new ApiError(200, 'INVALID_RESPONSE', '定位配置返回不完整，请重新读取状态');
}
function snapshot(value: unknown): LocationSettingsSnapshot {
  if (
    !object(value) ||
    typeof value.canManage !== 'boolean' ||
    typeof value.keyConfigured !== 'boolean' ||
    !version(value.version) ||
    !object(value.active) ||
    !['AMAP', 'TENCENT', 'NONE'].includes(String(value.active.provider)) ||
    !['ENVIRONMENT', 'ADMIN', 'DISABLED'].includes(String(value.active.source)) ||
    !(value.active.version === null || version(value.active.version)) ||
    typeof value.active.applied !== 'boolean' ||
    !['UNCONFIGURED', 'ACTIVE', 'DISABLED'].includes(String(value.active.status))
  )
    return invalid();
  if (
    value.draft !== null &&
    (!object(value.draft) ||
      !version(value.draft.version) ||
      !['AMAP', 'TENCENT'].includes(String(value.draft.provider)) ||
      typeof value.draft.signatureEnabled !== 'boolean' ||
      typeof value.draft.webKeyConfigured !== 'boolean' ||
      typeof value.draft.privateKeyConfigured !== 'boolean')
  )
    return invalid();
  if (value.test !== null) {
    const test = value.test;
    if (
      !object(test) ||
      typeof test.id !== 'string' ||
      !version(test.configVersion) ||
      !['RUNNING', 'PASSED', 'FAILED'].includes(String(test.status)) ||
      !nullableString(test.completedAt) ||
      !nullableString(test.message) ||
      !Array.isArray(test.checks)
    )
      return invalid();
  }
  return value as unknown as LocationSettingsSnapshot;
}
function receipt(value: unknown): LocationCommandResult {
  if (
    !object(value) ||
    typeof value.commandId !== 'string' ||
    !['SAVE', 'TEST', 'ACTIVATE', 'DISABLE'].includes(String(value.kind)) ||
    !['RUNNING', 'SUCCEEDED', 'FAILED'].includes(String(value.status)) ||
    !(value.configVersion === null || version(value.configVersion)) ||
    !nullableString(value.testId)
  )
    return invalid();
  return value as unknown as LocationCommandResult;
}
export function createLocationSettingsApi(client: ApiClient): LocationSettingsApi {
  const base = '/v1/platform/location';
  async function command(path: string, method: string, input: { commandId: string }) {
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
    save: (input: LocationSaveInput) => command('/draft', 'PUT', input),
    test: (input: LocationTestInput) => command('/tests', 'POST', input),
    activate: (input: LocationActivationInput) => command('/activation', 'POST', input),
    disable: (input: LocationDisableInput) => command('/disable', 'POST', input),
    async operation(commandId: string) {
      const result = receipt(
        (await client.request<unknown>(`${base}/operations/${commandId}`)).data,
      );
      if (result.commandId !== commandId) return invalid();
      return result;
    },
  };
}
