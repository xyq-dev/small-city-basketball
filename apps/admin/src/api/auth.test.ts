import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthCapabilitiesApi } from './auth';
import { createApiClient } from './client';

function response(data: unknown) {
  return new Response(JSON.stringify({ data, meta: { requestId: 'auth-capabilities-test' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('auth capability configuration adapter', () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('reads organization=%s and participant=%s exactly', async (organization, participant) => {
    const data = { canRegisterOrganization: organization, canRegisterParticipant: participant };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(data));
    const result = await createAuthCapabilitiesApi(createApiClient({ fetcher })).read();
    expect(result).toEqual(data);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [path, init] = fetcher.mock.calls[0];
    expect(path).toBe('/v1/auth/capabilities');
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('Authorization')).toBeNull();
  });

  it.each([
    null,
    [],
    true,
    {},
    { canRegisterOrganization: true },
    { canRegisterParticipant: true },
    { canRegisterOrganization: 'false', canRegisterParticipant: true },
    { canRegisterOrganization: false, canRegisterParticipant: 1 },
    { canRegisterOrganization: true, canRegisterParticipant: true, token: 'unexpected' },
    { canRegisterOrganization: true, canRegisterParticipant: false, unused: null },
  ])('rejects malformed or extra capability fields: %j', async (data) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(data));
    await expect(
      createAuthCapabilitiesApi(createApiClient({ fetcher })).read(),
    ).rejects.toMatchObject({ apiCode: 'INVALID_AUTH_CAPABILITIES' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('propagates service failure without assuming open registration or posting an account', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network down'));
    await expect(
      createAuthCapabilitiesApi(createApiClient({ fetcher })).read(),
    ).rejects.toMatchObject({ apiCode: 'NETWORK_ERROR' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/v1/auth/capabilities');
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
  });

  it('bounds a request to eight seconds even when transport ignores abort', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = createAuthCapabilitiesApi(createApiClient({ fetcher })).read();
    const failure = expect(pending).rejects.toMatchObject({ apiCode: 'AUTH_CAPABILITIES_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(8000);
    await failure;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('forwards cancellation and rejects an ignored-abort late result', async () => {
    let resolve: (result: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const signal = new AbortController();
    const pending = createAuthCapabilitiesApi(createApiClient({ fetcher })).read(signal.signal);
    const failure = expect(pending).rejects.toMatchObject({ apiCode: 'AUTH_CAPABILITIES_ABORTED' });
    signal.abort();
    await failure;
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    resolve(response({ canRegisterOrganization: true, canRegisterParticipant: true }));
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not request when already cancelled and removes timeout after success', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ canRegisterOrganization: false, canRegisterParticipant: false }),
      );
    const api = createAuthCapabilitiesApi(createApiClient({ fetcher }));
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(api.read(cancelled.signal)).rejects.toMatchObject({
      apiCode: 'AUTH_CAPABILITIES_ABORTED',
    });
    expect(fetcher).not.toHaveBeenCalled();
    await api.read();
    expect(vi.getTimerCount()).toBe(0);
  });
});
