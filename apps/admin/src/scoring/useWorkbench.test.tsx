// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScoringCommandResponse } from '@small-city-basketball/contracts';
import { ApiError } from '../api/client';
import { useWorkbench } from './useWorkbench';
import { ack, deferred, mockApi, snapshot, workbench } from './test-fixtures';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const command = {
  type: 'RECORD_STAT',
  payload: { kind: 'SCORE', side: 'HOME', value: 2 },
} as const;
async function setup() {
  const api = mockApi();
  const hook = renderHook(() => useWorkbench(api, 'match-a'));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => {
    await hook.result.current.acquire();
  });
  return { api, ...hook };
}
describe('online scoring command ownership', () => {
  it('waits for server ack, locks repeated clicks and does not persist credentials', async () => {
    const { api, result } = await setup();
    const request = deferred<ScoringCommandResponse>();
    vi.mocked(api.command).mockReturnValue(request.promise);
    let submission: Promise<boolean>;
    act(() => {
      submission = result.current.send(command, true);
    });
    expect(result.current.data?.workbench.snapshot?.totals.home.score).toBe(0);
    await act(async () => {
      await result.current.send(command, true);
    });
    expect(api.command).toHaveBeenCalledTimes(1);
    const envelope = vi.mocked(api.command).mock.calls[0][1];
    expect(envelope.control?.clientInstanceId).toBeTruthy();
    vi.mocked(api.workbench).mockResolvedValue({
      ...workbench,
      match: { ...workbench.match, version: 4 },
      snapshot: ack(envelope).snapshot,
    });
    await act(async () => {
      request.resolve(ack(envelope));
      await submission!;
    });
    expect(result.current.data?.workbench.snapshot?.totals.home.score).toBe(2);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it('retains lost acknowledgement and resolves by the original receipt without another write', async () => {
    const { api, result } = await setup();
    vi.mocked(api.command).mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', '失去响应'));
    await act(async () => {
      await result.current.send(command, true);
    });
    const input = result.current.pending!.envelope;
    expect(result.current.pending?.envelope.commandId).toBeTruthy();
    expect(result.current.data?.workbench.snapshot?.totals.home.score).toBe(0);
    await act(async () => {
      await result.current.send(command, true);
    });
    expect(api.command).toHaveBeenCalledTimes(1);
    vi.mocked(api.receipt).mockResolvedValue(ack(input));
    vi.mocked(api.workbench).mockResolvedValue({
      ...workbench,
      match: { ...workbench.match, version: 4 },
      snapshot: ack(input).snapshot,
    });
    await act(async () => {
      await result.current.checkPending();
    });
    expect(api.receipt).toHaveBeenCalledWith('match-a', input.commandId);
    expect(result.current.pending).toBeNull();
    expect(result.current.data?.workbench.snapshot?.totals.home.score).toBe(2);
    expect(api.command).toHaveBeenCalledTimes(1);
  });
  it('a missing receipt is not failure; retry uses identical envelope and version changes block it', async () => {
    const { api, result } = await setup();
    vi.mocked(api.command).mockRejectedValue(new ApiError(503, 'SERVICE_UNAVAILABLE', '结果未知'));
    await act(async () => {
      await result.current.send(command, true);
    });
    const envelope = result.current.pending!.envelope;
    vi.mocked(api.receipt).mockRejectedValue(new ApiError(404, 'COMMAND_NOT_FOUND', '尚无收据'));
    await act(async () => {
      await result.current.checkPending();
    });
    expect(result.current.pending).not.toBeNull();
    expect(result.current.canRetry).toBe(true);
    await act(async () => {
      await result.current.retryPending();
    });
    expect(vi.mocked(api.command).mock.calls[1][1]).toBe(envelope);
    vi.mocked(api.workbench).mockResolvedValue({
      ...workbench,
      match: { ...workbench.match, version: 4 },
      snapshot: { ...snapshot, version: 4 },
    });
    await act(async () => {
      await result.current.checkPending();
    });
    expect(result.current.canRetry).toBe(false);
    await act(async () => {
      await result.current.retryPending();
    });
    expect(api.command).toHaveBeenCalledTimes(2);
  });
  it('offline stops new writes; online first refreshes authority', async () => {
    const { api, result } = await setup();
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current.online).toBe(false);
    await act(async () => {
      await result.current.send(command, true);
    });
    expect(api.command).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(result.current.stale).toBe(false));
    expect(result.current.online).toBe(true);
  });
  it('late accepted response after unmount does not refresh, revive control or update another screen', async () => {
    const { api, result, unmount } = await setup();
    const request = deferred<ScoringCommandResponse>();
    vi.mocked(api.command).mockReturnValue(request.promise);
    let submission: Promise<boolean>;
    act(() => {
      submission = result.current.send(command, true);
    });
    const input = vi.mocked(api.command).mock.calls[0][1];
    const reads = vi.mocked(api.workbench).mock.calls.length;
    unmount();
    request.resolve(ack(input));
    await expect(submission!).resolves.toBe(false);
    expect(api.workbench).toHaveBeenCalledTimes(reads);
  });
  it('SPA remount preserves only the tab identity in memory and never browser storage', async () => {
    const first = await setup();
    const id1 = vi.mocked(first.api.acquire).mock.calls[0][1];
    first.unmount();
    const second = await setup();
    const id2 = vi.mocked(second.api.acquire).mock.calls[0][1];
    expect(id1).toBe(id2);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('renews at ten seconds without changing match version, and a failed renewal stops new writing', async () => {
    vi.useFakeTimers();
    const api = mockApi();
    const hook = renderHook(() => useWorkbench(api, 'match-a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await hook.result.current.acquire();
    });
    const input = vi.mocked(api.acquire).mock.calls[0][1];
    vi.mocked(api.renew).mockResolvedValue({
      ...hook.result.current.lease!,
      clientInstanceId: input,
      serverTime: '2026-10-22T08:00:10Z',
      expiresAt: '2026-10-22T08:00:40Z',
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(api.renew).toHaveBeenCalledTimes(1);
    expect(hook.result.current.data?.workbench.match.version).toBe(3);
    vi.mocked(api.renew).mockRejectedValue(new ApiError(409, 'LEASE_EXPIRED', '控制权过期'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(hook.result.current.lease).toBeNull();
    await act(async () => {
      await hook.result.current.send(command, true);
    });
    expect(api.command).not.toHaveBeenCalled();
  });
  it('refreshes a same-version running clock using the newer server time', async () => {
    const { api, result } = await setup();
    vi.mocked(api.workbench).mockResolvedValue({
      ...workbench,
      snapshot: {
        ...snapshot,
        clock: { ...snapshot.clock, running: true },
        serverTime: '2026-10-22T08:00:05Z',
      },
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.data?.workbench.snapshot?.serverTime).toBe('2026-10-22T08:00:05Z');
    expect(result.current.data?.workbench.match.version).toBe(3);
  });
  it('explicit version failures remain visible after authoritative reload', async () => {
    const { api, result } = await setup();
    vi.mocked(api.command).mockRejectedValue(
      new ApiError(409, 'VERSION_CONFLICT', '比赛资料已变化'),
    );
    await act(async () => {
      await result.current.send(command, true);
    });
    expect(result.current.error).toContain('比赛资料已变化');
    expect(result.current.pending).toBeNull();
  });
});
