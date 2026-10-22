import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthCapabilitiesData } from '@small-city-basketball/contracts';
import type { ApiClient } from '../api/client';
import { createAuthCapabilitiesApi } from '../api/auth';

/** A failed or pending read never grants registration. Login is independent. */
export function useRegistrationCapabilities(client: ApiClient) {
  const api = useMemo(() => createAuthCapabilitiesApi(client), [client]);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    api: typeof api;
    capabilities: AuthCapabilitiesData | null;
    phase: 'loading' | 'ready' | 'error';
  }>({ api, capabilities: null, phase: 'loading' });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setResult({ api, capabilities: null, phase: 'loading' });
    void api
      .read(controller.signal)
      .then((capabilities) => {
        if (active) setResult({ api, capabilities, phase: 'ready' });
      })
      .catch(() => {
        if (active) setResult({ api, capabilities: null, phase: 'error' });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, revision]);
  const reload = useCallback(() => {
    setResult({ api, capabilities: null, phase: 'loading' });
    setRevision((value) => value + 1);
  }, [api]);
  return {
    capabilities: result.api === api ? result.capabilities : null,
    phase: result.api === api ? result.phase : ('loading' as const),
    reload,
  };
}
