import { expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { createSchedulingApi } from './scheduling';
import { optimizationPreview } from '../scheduling/optimization-fixtures';
import { court, revision, response } from '../scheduling/test-fixtures';

it('服务端预演只向同源精确机构/草稿发送双版本和保留意图，并传递取消信号', async () => {
  const saved = { ...revision, id: 'revision/a' };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(optimizationPreview(saved)));
  const api = createSchedulingApi(createApiClient({ fetcher }), 'org/a');
  const controller = new AbortController();
  await api.optimizationPreview(saved, [court], false, controller.signal);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![0]).toBe(
    '/v1/orgs/org%2Fa/schedule-revisions/revision%2Fa/optimization-preview',
  );
  const request = fetcher.mock.calls[0]![1]!;
  expect(request.method).toBe('POST');
  expect(request.signal).toBe(controller.signal);
  expect(JSON.parse(String(request.body))).toEqual({
    expectedEventVersion: 11,
    expectedRevisionVersion: 1,
    preserveAssigned: false,
  });
});
it('拒绝非当前草稿对应的响应，不触发保存或回退本地建议', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response({ ...optimizationPreview(), revisionVersion: 2 }));
  const api = createSchedulingApi(createApiClient({ fetcher }), 'org-a');
  await expect(api.optimizationPreview(revision, [court], true)).rejects.toMatchObject({
    apiCode: 'INVALID_RESPONSE',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([401, 403, 409])('服务端%d失败原样传回且不重放', async (status) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      response(
        { code: status === 409 ? 'VERSION_CONFLICT' : 'DENIED', message: '拒绝预演' },
        {},
        status,
      ),
    );
  const api = createSchedulingApi(createApiClient({ fetcher }), 'org-a');
  await expect(api.optimizationPreview(revision, [court], true)).rejects.toMatchObject({ status });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
