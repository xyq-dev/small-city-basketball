import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client';
import { createLifecycleApi } from '../api/lifecycle';
import { response } from '../viewing/test-fixtures';
import { lifecycle } from './test-fixtures';
describe('event lifecycle organization adapter', () => {
  it('pins explicit commands and versions to credentialed, encoded organization paths', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(lifecycle));
    const api = createLifecycleApi(createApiClient({ fetcher }), 'org/a');
    await api.event(lifecycle.event.id);
    await api.command(lifecycle.event.id, {
      type: 'COMPLETE',
      expectedEventVersion: 7,
      reason: '合成完赛核对',
    });
    expect(fetcher.mock.calls[0][0]).toBe('/v1/orgs/org%2Fa/events/private-event-a/lifecycle');
    expect(fetcher.mock.calls[1][0]).toBe(
      '/v1/orgs/org%2Fa/events/private-event-a/lifecycle-commands',
    );
    expect(fetcher.mock.calls[1][1]?.credentials).toBe('same-origin');
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      type: 'COMPLETE',
      expectedEventVersion: 7,
      reason: '合成完赛核对',
    });
    expect(() => createLifecycleApi(createApiClient(), ' ')).toThrow('请先选择');
  });
  it.each([
    { event: { ...lifecycle.event, id: 'other-event' } },
    { event: { ...lifecycle.event, status: 'UNKNOWN' } },
    { event: { ...lifecycle.event, version: 0 } },
    { completion: { ...lifecycle.completion, confirmedMatchCount: 2 } },
    { completion: { ...lifecycle.completion, totalMatchCount: -1 } },
    { completion: { ...lifecycle.completion, blockers: [7] } },
    { completion: { ...lifecycle.completion, sourceHash: {} } },
    { capabilities: { canComplete: true, canArchive: false } },
  ])('rejects malformed or mismatched resources without enabling controls: %j', async (change) => {
    const api = createLifecycleApi(
      createApiClient({
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(response({ ...lifecycle, ...change })),
      }),
      'org-a',
    );
    await expect(api.event(lifecycle.event.id)).rejects.toMatchObject({
      apiCode: 'INVALID_RESPONSE',
    });
  });
});
