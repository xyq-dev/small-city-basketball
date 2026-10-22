// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RuntimeApp from '../RuntimeApp';
import { response, snapshot } from './test-fixtures';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});
describe('independent overlay Runtime entry', () => {
  it('consumes fragment under StrictMode before bootstrap, preserves history and bypasses private auth/storage', async () => {
    window.history.replaceState(
      { keep: 'state' },
      '',
      '/overlay/overlay-a?scene=main#token=secret-memory',
    );
    const privateRequest = vi.fn();
    const local = vi.spyOn(Storage.prototype, 'setItem');
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) =>
      String(path).endsWith('/bootstrap')
        ? response({
            overlayId: 'overlay-a',
            expiresAt: snapshot.expiresAt,
            serverTime: snapshot.serverTime,
          })
        : response(snapshot),
    );
    render(
      <StrictMode>
        <RuntimeApp mode="api" client={{ request: privateRequest }} overlayFetcher={fetcher} />
      </StrictMode>,
    );
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?scene=main');
    expect(window.history.state).toEqual({ keep: 'state' });
    expect(await screen.findByLabelText('包装主队比分')).toHaveTextContent('12');
    const boots = fetcher.mock.calls.filter(([path]) => String(path).endsWith('/bootstrap'));
    expect(boots.length).toBeGreaterThan(0);
    for (const [, init] of boots)
      expect(init?.body).toBe(JSON.stringify({ token: 'secret-memory' }));
    expect(String(fetcher.mock.calls[0][0])).toContain('/bootstrap');
    expect(privateRequest).not.toHaveBeenCalled();
    expect(local).not.toHaveBeenCalled();
    expect(document.documentElement).toHaveClass('overlay-source-mode');
  });
  it('reads a saved cookie without fragment and never falls back to private auth when unavailable', async () => {
    window.history.replaceState({}, '', '/overlay/overlay-a');
    const privateRequest = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'private' } }), {
        status: 404,
      }),
    );
    render(<RuntimeApp mode="api" client={{ request: privateRequest }} overlayFetcher={fetcher} />);
    expect(await screen.findByRole('status')).toHaveTextContent('包装链接不可用');
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls[0][0]).toBe('/v1/overlays/overlay-a/snapshot');
    expect(privateRequest).not.toHaveBeenCalled();
  });
});
