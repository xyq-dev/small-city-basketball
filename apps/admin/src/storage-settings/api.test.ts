import { expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { ApiError } from '../api/client';
import { createStorageSettingsApi } from './api';
import { storageReceipt, storageSnapshot } from './test-fixtures';

function clientFor(data: unknown) {
  const request = vi.fn().mockResolvedValue({ data, meta: { requestId: 'http-synthetic' } });
  return { request, api: createStorageSettingsApi({ request: request as ApiClient['request'] }) };
}

it('uses only the global same-origin platform routes and forwards an abort signal for reads', async () => {
  const { request, api } = clientFor(storageSnapshot());
  const controller = new AbortController();
  expect(await api.read(controller.signal)).toEqual(storageSnapshot());
  expect(request).toHaveBeenCalledWith('/v1/platform/storage', { signal: controller.signal });
});

it('preserves the config command ID and does not invent retained credentials', async () => {
  const { request, api } = clientFor(storageReceipt('command-synthetic', 'SAVE'));
  await api.save({
    commandId: 'command-synthetic',
    expectedVersion: 7,
    bucket: 'scb-media-1250000000',
    region: 'ap-guangzhou',
    prefix: 'scb-media/v1',
  });
  expect(request).toHaveBeenCalledWith('/v1/platform/storage/draft', {
    method: 'PUT',
    body: JSON.stringify({
      commandId: 'command-synthetic',
      expectedVersion: 7,
      bucket: 'scb-media-1250000000',
      region: 'ap-guangzhou',
      prefix: 'scb-media/v1',
    }),
  });
});

it('rejects incomplete state instead of enabling actions from guessed defaults', async () => {
  const { api } = clientFor({ ...storageSnapshot(), active: { provider: 'COS', applied: true } });
  await expect(api.read()).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
});

it('rejects a command response for a different operation without retrying it', async () => {
  const { request, api } = clientFor(storageReceipt('different-command', 'TEST'));
  await expect(
    api.test({ commandId: 'original-command', configVersion: 3, confirmCloudTest: true }),
  ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  expect(request).toHaveBeenCalledTimes(1);
});

it('leaves a missing operation receipt as a 404 for the UI to keep unresolved', async () => {
  const { request, api } = clientFor(null);
  request.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'not found'));
  await expect(api.operation('original-command')).rejects.toMatchObject({ status: 404 });
  expect(request).toHaveBeenCalledWith('/v1/platform/storage/operations/original-command');
  expect(request).toHaveBeenCalledTimes(1);
});
