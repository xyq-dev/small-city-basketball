import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export function usePublicResource<T>(read: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [stale, setStale] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [receivedAt, setReceivedAt] = useState(0);
  const [lastSuccess, setLastSuccess] = useState<Date>();
  const active = useRef(true),
    generation = useRef(0),
    request = useRef<AbortController | null>(null),
    inFlight = useRef(false),
    onlineRef = useRef(navigator.onLine);
  const invalidate = useCallback((cause: ApiError) => {
    if (cause.status !== 404 && cause.apiCode !== 'RESULT_SOURCE_INVALID') return;
    ++generation.current;
    request.current?.abort();
    inFlight.current = false;
    setData(undefined);
    setLoading(false);
    setNotFound(cause.status === 404);
    setStale(cause.status !== 404);
    setError(cause.message);
  }, []);
  const reload = useCallback(async () => {
    if (!onlineRef.current) {
      setOnline(false);
      setStale(true);
      setLoading(false);
      return;
    }
    const current = ++generation.current;
    inFlight.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = await read(controller.signal);
      if (!active.current || current !== generation.current) return;
      setData(next);
      setReceivedAt(performance.now());
      setLastSuccess(new Date());
      setError('');
      setNotFound(false);
      setStale(false);
      setOnline(true);
    } catch (cause) {
      if (!active.current || current !== generation.current) return;
      setError(cause instanceof Error ? cause.message : '暂时无法读取观赛资料');
      if (cause instanceof ApiError && cause.status === 404) {
        setData(undefined);
        setNotFound(true);
        setStale(false);
      } else if (cause instanceof ApiError && cause.apiCode === 'RESULT_SOURCE_INVALID') {
        setData(undefined);
        setNotFound(false);
        setStale(true);
      } else setStale(true);
    } finally {
      if (active.current && current === generation.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, [read]);
  useEffect(() => {
    active.current = true;
    void reload();
    const timer = setInterval(() => {
      if (!inFlight.current) void reload();
    }, 5000);
    const offline = () => {
      onlineRef.current = false;
      setOnline(false);
      setStale(true);
      setLoading(false);
      ++generation.current;
      request.current?.abort();
    };
    const connected = () => {
      onlineRef.current = true;
      setOnline(true);
      setStale(true);
      void reload();
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', connected);
    return () => {
      active.current = false;
      ++generation.current;
      clearInterval(timer);
      request.current?.abort();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', connected);
    };
  }, [reload]);
  return {
    data,
    loading,
    error,
    notFound,
    stale,
    online,
    receivedAt,
    lastSuccess,
    reload,
    invalidate,
  };
}
