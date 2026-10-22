// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlaySourceApi } from '../api/overlay';
import { ApiError } from '../api/client';
import { deferred, snapshot } from './test-fixtures';
import { grantDeadline } from './lifecycle';
import { useOverlaySource } from './useOverlaySource';
const metadata = {
  overlayId: snapshot.overlayId,
  expiresAt: snapshot.expiresAt,
  serverTime: snapshot.serverTime,
};
const api = (): OverlaySourceApi => ({
  bootstrap: vi.fn().mockResolvedValue(metadata),
  snapshot: vi.fn().mockResolvedValue(snapshot),
});
const tick = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('overlay source lifecycle', () => {
  it('deducts full RTT and only shortens a known grant deadline', () => {
    expect(grantDeadline(100, '2026-10-22T01:00:05Z', '2026-10-22T01:00:00Z')).toBe(5100);
    expect(grantDeadline(200, '2026-10-22T01:01:00Z', '2026-10-22T01:00:00Z', 5100)).toBe(5100);
  });
  it('bootstraps first, never treats bootstrap as a snapshot, and rejects a slow near-expiry success', async () => {
    const service = api();
    const pending = deferred<typeof metadata>();
    service.bootstrap = vi.fn().mockReturnValue(pending.promise);
    const { result } = renderHook(() => useOverlaySource(service, 'overlay-a', 'token-memory'));
    await tick(1000);
    await act(async () => pending.resolve({ ...metadata, expiresAt: '2026-10-22T01:00:00.500Z' }));
    expect(result.current.terminal).toBe(true);
    expect(result.current.data).toBeNull();
    expect(service.snapshot).not.toHaveBeenCalled();
  });
  it('serializes slow requests and retries after an eight-second timeout without poll starvation', async () => {
    const service = api();
    const pending = deferred<typeof snapshot>();
    service.snapshot = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(snapshot);
    const { result } = renderHook(() => useOverlaySource(service, 'overlay-a', null));
    await tick(7000);
    expect(service.snapshot).toHaveBeenCalledTimes(1);
    await tick(1000);
    expect(result.current.stale).toBe(true);
    await tick(2000);
    expect(service.snapshot).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(snapshot);
    await act(async () => pending.resolve({ ...snapshot, score: { home: 999, away: 999 } }));
    expect(result.current.data?.score?.home).toBe(12);
  });
  it('marks offline immediately, clears every name and score after30 seconds, and waits for a fresh full snapshot online', async () => {
    const service = api();
    const { result } = renderHook(() => useOverlaySource(service, 'overlay-a', null));
    await tick();
    expect(result.current.data).toEqual(snapshot);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current.stale).toBe(true);
    await tick(30000);
    expect(result.current.data).toBeNull();
    expect(result.current.message).toContain('离线');
    act(() => window.dispatchEvent(new Event('online')));
    await tick();
    expect(result.current.data).toEqual(snapshot);
    expect(result.current.stale).toBe(false);
  });
  it('does not extend hard expiry on fresh responses and clears even while offline', async () => {
    const service = api();
    service.snapshot = vi
      .fn()
      .mockResolvedValueOnce({ ...snapshot, expiresAt: '2026-10-22T01:00:05Z' })
      .mockResolvedValue({ ...snapshot, expiresAt: '2026-10-22T02:00:00Z' });
    const { result } = renderHook(() => useOverlaySource(service, 'overlay-a', null));
    await tick();
    await tick(2000);
    act(() => window.dispatchEvent(new Event('offline')));
    await tick(3000);
    expect(result.current.terminal).toBe(true);
    expect(result.current.message).toBe('包装授权已到期');
    expect(result.current.data).toBeNull();
    act(() => window.dispatchEvent(new Event('online')));
    await tick(20000);
    expect(service.snapshot).toHaveBeenCalledTimes(2);
  });
  it('makes404 terminal and ignores an older timed-out200', async () => {
    const pending = deferred<typeof snapshot>();
    const service = api();
    service.snapshot = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValue(new ApiError(404, 'OVERLAY_NOT_FOUND', 'unavailable'));
    const { result } = renderHook(() => useOverlaySource(service, 'overlay-a', null));
    await tick(10000);
    expect(result.current.terminal).toBe(true);
    await act(async () => pending.resolve(snapshot));
    await tick(10000);
    expect(result.current.data).toBeNull();
    expect(service.snapshot).toHaveBeenCalledTimes(2);
  });
  it('clears invalid FINAL source while polling for recovery, rather than inventing zero', async () => {
    const service = api();
    service.snapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new ApiError(409, 'RESULT_SOURCE_INVALID', 'invalid'))
      .mockResolvedValue(snapshot);
    const { result } = renderHook(() => useOverlaySource(service, 'overlay-a', null));
    await tick();
    await tick(2000);
    expect(result.current.data).toBeNull();
    expect(result.current.terminal).toBe(false);
    await tick(2000);
    expect(result.current.data?.score?.home).toBe(12);
  });
  it('rejects late responses across URLs and lower business versions without refreshing freshness', async () => {
    const old = deferred<typeof snapshot>();
    const service = api();
    service.snapshot = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ ...snapshot, overlayId: 'overlay-b' });
    const { result, rerender } = renderHook(({ id }) => useOverlaySource(service, id, null), {
      initialProps: { id: 'overlay-a' },
    });
    rerender({ id: 'overlay-b' });
    await tick();
    await act(async () => old.resolve(snapshot));
    expect(result.current.data?.overlayId).toBe('overlay-b');
    cleanup();
    const second = api();
    second.snapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValue({ ...snapshot, matchVersion: 4 });
    const current = renderHook(() => useOverlaySource(second, 'overlay-a', null));
    await tick();
    await tick(30000);
    expect(current.result.current.data).toBeNull();
  });
});
