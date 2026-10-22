import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { createOverlayManagementApi, createOverlaySourceApi } from './overlay';
import { grant, response, snapshot, workbench } from '../overlay/test-fixtures';
describe('bounded overlay HTTP adapters', () => {
  it('uses dedicated same-origin cookies with no private unauthorized handler and bootstrap token only in JSON', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          overlayId: 'overlay-a',
          expiresAt: snapshot.expiresAt,
          serverTime: snapshot.serverTime,
        }),
      )
      .mockResolvedValueOnce(response(snapshot));
    const api = createOverlaySourceApi({ fetcher });
    await api.bootstrap('overlay-a', 'secret-only-memory');
    await api.snapshot('overlay-a');
    expect(fetcher.mock.calls[0][0]).toBe('/v1/overlays/overlay-a/bootstrap');
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ token: 'secret-only-memory' }),
    });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'GET', credentials: 'same-origin' });
    expect(fetcher.mock.calls[1][1]?.body).toBeUndefined();
  });
  it('rejects private IDs, leaked fields, malformed nested values and wrong overlay identity', async () => {
    for (const value of [
      { ...snapshot, userId: 'private' },
      { ...snapshot, overlayId: 'other' },
      { ...snapshot, home: { ...snapshot.home, teamId: 'private' } },
      { ...snapshot, clock: { ...snapshot.clock, remainingMs: '60000' } },
    ]) {
      const api = createOverlaySourceApi({
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(value)),
      });
      await expect(api.snapshot('overlay-a')).rejects.toMatchObject({
        apiCode: 'INVALID_RESPONSE',
      });
    }
  });
  it('preserves unprepared nulls and rejects partial pretend scores', async () => {
    const empty = {
      ...snapshot,
      status: 'SCHEDULED',
      score: null,
      totals: null,
      periods: null,
      rules: null,
      clock: null,
      collected: {
        teamScore: false,
        teamFouls: false,
        teamTimeouts: false,
        playerStatistics: false,
      },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(empty))
      .mockResolvedValueOnce(response({ ...empty, score: { home: 0, away: 0 } }));
    const api = createOverlaySourceApi({ fetcher });
    expect((await api.snapshot('overlay-a')).score).toBeNull();
    await expect(api.snapshot('overlay-a')).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  it('maps 404 and source-invalid without using arbitrary server error details', async () => {
    for (const status of [404, 409]) {
      const api = createOverlaySourceApi({
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: 'RESULT_SOURCE_INVALID',
                message: 'private',
                details: { token: 'secret' },
              },
            }),
            { status },
          ),
        ),
      });
      await expect(api.snapshot('overlay-a')).rejects.toMatchObject({
        status,
        apiCode: status === 404 ? 'OVERLAY_NOT_FOUND' : 'RESULT_SOURCE_INVALID',
        details: undefined,
      });
    }
  });
  it('keeps bad preview metadata usable, sends exact management CAS and never accepts credential from GET', async () => {
    const data = {
      ...workbench,
      currentGrant: grant,
      preview: null,
      previewError: { code: 'RESULT_SOURCE_INVALID', message: '来源损坏' },
      capabilities: { canIssue: false, canRotate: true, canRevoke: true },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(data))
      .mockResolvedValueOnce(response({ ...data, credential: null }))
      .mockResolvedValueOnce(
        response({ ...data, credential: { overlayId: 'overlay-a', token: 'secret' } }),
      );
    const api = createOverlayManagementApi(createApiClient({ fetcher }), 'org-a');
    expect((await api.workbench('match-a')).preview).toBeNull();
    const input = {
      type: 'REVOKE' as const,
      expectedEventVersion: 7,
      overlayId: 'overlay-a',
      expectedGrantVersion: 1,
      reason: '停止直播',
    };
    await api.command('match-a', input);
    expect(fetcher.mock.calls[1][1]?.body).toBe(JSON.stringify(input));
    await expect(api.workbench('match-a')).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
    expect(() => createOverlayManagementApi(createApiClient(), '')).toThrow('请先选择机构');
  });
});
