import { useEffect, useState } from 'react';
import type { OverlaySnapshotData } from '@small-city-basketball/contracts';
import { ApiError } from '../api/client';
import type { OverlaySourceApi } from '../api/overlay';
import { grantDeadline, SNAPSHOT_STALE_MS, SOURCE_POLL_MS, SOURCE_TIMEOUT_MS } from './lifecycle';
export interface SourceState {
  data: OverlaySnapshotData | null;
  receivedAt: number;
  now: number;
  stale: boolean;
  message: string;
  terminal: boolean;
}
const initial = (): SourceState => ({
  data: null,
  receivedAt: 0,
  now: performance.now(),
  stale: false,
  message: '正在读取包装数据…',
  terminal: false,
});
export function useOverlaySource(api: OverlaySourceApi, overlayId: string, token: string | null) {
  const [state, setState] = useState<SourceState>(initial);
  useEffect(() => {
    let alive = true;
    let terminal = false;
    let deadline = Infinity;
    let lastSuccess: number | null = null;
    let highestVersion = -1;
    let authenticated = token === null;
    let offline = navigator.onLine === false;
    let inFlight = false;
    let generation = 0;
    let next: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    setState({
      ...initial(),
      stale: offline,
      message: offline ? '离线 · 等待重新读取包装数据' : '正在读取包装数据…',
    });
    const end = (message: string) => {
      if (!alive || terminal) return;
      terminal = true;
      generation += 1;
      controller?.abort();
      clearTimeout(next);
      setState((current) => ({ ...current, data: null, terminal: true, stale: false, message }));
    };
    const expired = () => {
      if (performance.now() >= deadline) {
        end('包装授权已到期');
        return true;
      }
      return terminal;
    };
    function updateDeadline(sent: number, expiresAt: string, serverTime: string) {
      deadline = grantDeadline(sent, expiresAt, serverTime, deadline);
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(
        () => end('包装授权已到期'),
        Math.max(0, deadline - performance.now()),
      );
    }
    async function timed<T>(read: (signal: AbortSignal) => Promise<T>) {
      controller = new AbortController();
      const current = controller;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          read(current.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              current.abort();
              reject(new ApiError(0, 'TIMEOUT', '读取超时，正在重试'));
            }, SOURCE_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    async function poll() {
      if (!alive || terminal || offline || inFlight || expired()) return;
      inFlight = true;
      const requestGeneration = generation;
      try {
        if (!authenticated) {
          const sent = performance.now();
          const metadata = await timed((signal) => api.bootstrap(overlayId, token!, signal));
          if (!alive || terminal || requestGeneration !== generation || offline) return;
          updateDeadline(sent, metadata.expiresAt, metadata.serverTime);
          if (expired()) return;
          authenticated = true;
        }
        const sent = performance.now();
        const data = await timed((signal) => api.snapshot(overlayId, signal));
        if (!alive || terminal || requestGeneration !== generation || offline) return;
        updateDeadline(sent, data.expiresAt, data.serverTime);
        if (expired()) return;
        if (data.matchVersion < highestVersion)
          throw new ApiError(200, 'STALE_RESPONSE', '正在等待最新包装资料');
        highestVersion = data.matchVersion;
        lastSuccess = performance.now();
        setState({
          data,
          receivedAt: lastSuccess,
          now: lastSuccess,
          stale: false,
          message: '',
          terminal: false,
        });
      } catch (cause) {
        if (!alive || terminal || requestGeneration !== generation || offline || expired()) return;
        if (cause instanceof ApiError && cause.status === 404) {
          end('包装链接不可用，请重新加载保存的原始源地址或联系主办方');
        } else if (cause instanceof ApiError && cause.apiCode === 'RESULT_SOURCE_INVALID') {
          setState((current) => ({
            ...current,
            data: null,
            stale: false,
            message: '赛果来源暂不可用，正在重新核对',
          }));
        } else {
          setState((current) => ({
            ...current,
            stale: true,
            message: '数据陈旧 · 连接暂时中断，正在重试',
          }));
        }
      } finally {
        inFlight = false;
        if (alive && !terminal && !offline)
          next = setTimeout(() => {
            void poll();
          }, SOURCE_POLL_MS);
      }
    }
    const goOffline = () => {
      offline = true;
      generation += 1;
      controller?.abort();
      clearTimeout(next);
      if (!terminal)
        setState((current) => ({
          ...current,
          stale: true,
          message: '离线 · 数据陈旧，恢复连接后重新核对',
        }));
    };
    const goOnline = () => {
      offline = false;
      if (!terminal) {
        setState((current) => ({ ...current, stale: true, message: '正在重新读取最新包装数据…' }));
        clearTimeout(next);
        if (!inFlight) void poll();
      }
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    const watch = setInterval(() => {
      if (!alive || expired()) return;
      const now = performance.now();
      setState((current) => ({
        ...current,
        now,
        ...(lastSuccess !== null && now - lastSuccess >= SNAPSHOT_STALE_MS
          ? {
              data: null,
              stale: true,
              message: offline
                ? '离线 · 数据陈旧，画面已清除'
                : '数据陈旧 · 画面已清除，正在重新读取',
            }
          : {}),
      }));
    }, 200);
    void poll();
    return () => {
      alive = false;
      generation += 1;
      controller?.abort();
      clearTimeout(next);
      clearTimeout(expiryTimer);
      clearInterval(watch);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [api, overlayId, token]);
  return state;
}
