// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RuntimeApp from '../RuntimeApp';
import { createApiClient, ApiError } from '../api/client';
import { PublicScoreboard } from './PublicPages';
import { StandingsTable } from './StandingsTable';
import { usePublicResource } from './usePublicResource';
import {
  deferred,
  live,
  publicEvent,
  publicMatch,
  publicStandings,
  response,
} from './test-fixtures';
beforeEach(() => {
  window.history.replaceState({}, '', `/watch/${publicEvent.publicEventId}`);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const publicFetcher = () =>
  vi
    .fn<typeof fetch>()
    .mockImplementation(async (path) =>
      response(
        String(path).includes('/schedule?')
          ? [publicMatch]
          : String(path).endsWith('/standings')
            ? publicStandings
            : publicEvent,
      ),
    );
describe('anonymous entry and read-only rendering', () => {
  it('renders a shared link without mounting private session/org or a second router', async () => {
    const privateFetch = vi.fn<typeof fetch>(),
      fetcher = publicFetcher();
    render(
      <RuntimeApp
        mode="api"
        client={createApiClient({ fetcher: privateFetch })}
        publicFetcher={fetcher}
      />,
    );
    expect(await screen.findByRole('heading', { level: 1, name: publicEvent.name })).toBeVisible();
    expect(privateFetch).not.toHaveBeenCalled();
    expect(
      fetcher.mock.calls.every(
        ([path, init]) =>
          String(path).startsWith('/v1/public/events/') && init?.credentials === 'omit',
      ),
    ).toBe(true);
    expect(screen.queryByText('正在核验登录状态…')).not.toBeInTheDocument();
    expect(screen.getByText('尚未准备', { exact: true, selector: '.status-badge' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: '筛选比赛状态' })).toHaveAttribute(
      'aria-label',
      '筛选比赛状态',
    );
  });
  it('unknown links and public 401 never show private login or leak server details', async () => {
    const privateFetch = vi.fn<typeof fetch>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ code: 'NOT_FOUND', message: 'private org name' }, {}, 404));
    render(
      <RuntimeApp
        mode="api"
        client={createApiClient({ fetcher: privateFetch })}
        publicFetcher={fetcher}
      />,
    );
    expect(await screen.findByRole('heading', { name: '观赛链接不可用' })).toBeVisible();
    expect(privateFetch).not.toHaveBeenCalled();
    expect(screen.queryByText('private org name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument();
  });
  it('zero confirmed matches have null ranks rather than first place; ties retain 1,1,3', () => {
    const { rerender } = render(<StandingsTable data={publicStandings} />);
    expect(screen.getByText('尚无已确认赛果', { exact: true })).toBeVisible();
    const ranks = Array.from(document.querySelectorAll('td .view-rank')).map(
      (node) => node.textContent,
    );
    expect(ranks).toEqual(['—', '—']);
    const rows = [
      ...publicStandings.rows,
      { ...publicStandings.rows[0], teamKey: 'third', teamName: '第三队' },
    ].map((row, index) => ({ ...row, played: 2, rank: index < 2 ? 1 : 3, tied: index < 2 }));
    rerender(
      <StandingsTable
        data={{ ...publicStandings, confirmedMatchCount: 1, rows, hasSharedRanks: true }}
      />,
    );
    expect(
      Array.from(document.querySelectorAll('td .view-rank')).map((node) => node.textContent),
    ).toEqual(['1', '1', '3']);
    expect(screen.getByText('未完成 · 暂列排名')).toBeVisible();
  });
  it('raw clock deducts server anchor and display elapsed exactly once', async () => {
    vi.useFakeTimers();
    const receivedAt = performance.now();
    render(<PublicScoreboard data={live} receivedAt={receivedAt} />);
    expect(screen.getByLabelText('比赛剩余时间')).toHaveTextContent('00:50');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByLabelText('比赛剩余时间')).toHaveTextContent('00:45');
  });
  it('switching public URL clears old data and rejects a late response from the old link', async () => {
    const old = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      const current = String(path).includes('/public-event-b');
      if (String(path).includes('/schedule?')) return response([publicMatch]);
      if (String(path).endsWith('/standings'))
        return response({
          ...publicStandings,
          publicEventId: current ? 'public-event-b' : 'public-event-a',
        });
      return current
        ? response({ ...publicEvent, publicEventId: 'public-event-b', name: '新的公开赛事' })
        : old.promise;
    });
    render(<RuntimeApp mode="api" publicFetcher={fetcher} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    act(() => {
      window.history.pushState({}, '', '/watch/public-event-b');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('heading', { level: 1, name: '新的公开赛事' })).toBeVisible();
    await act(async () => {
      old.resolve(response(publicEvent));
    });
    expect(screen.getByRole('heading', { level: 1, name: '新的公开赛事' })).toBeVisible();
    expect(
      screen.queryByRole('heading', { level: 1, name: publicEvent.name }),
    ).not.toBeInTheDocument();
  });
});
describe('public polling lifecycle', () => {
  it('export invalidation aborts an older poll and prevents its late success from restoring revoked data', async () => {
    const pending = deferred<string>();
    const read = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockResolvedValueOnce('authorized data')
      .mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => usePublicResource(read));
    await waitFor(() => expect(result.current.data).toBe('authorized data'));
    let reload!: Promise<void>;
    act(() => {
      reload = result.current.reload();
    });
    act(() => result.current.invalidate(new ApiError(404, 'PUBLIC_NOT_FOUND', 'revoked')));
    expect(read.mock.calls[1][0].aborted).toBe(true);
    await act(async () => {
      pending.resolve('late data from before revocation');
      await reload;
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.notFound).toBe(true);
  });
  it('keeps last data on network failure, clears it for 404 and source damage', async () => {
    const read = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockResolvedValue('last authoritative data');
    const { result } = renderHook(() => usePublicResource(read));
    await waitFor(() => expect(result.current.data).toBe('last authoritative data'));
    read.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'network unavailable'));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toBe('last authoritative data');
    expect(result.current.stale).toBe(true);
    read.mockRejectedValue(new ApiError(404, 'PUBLIC_NOT_FOUND', 'revoked'));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.notFound).toBe(true);
    read.mockResolvedValue('new data');
    await act(async () => {
      await result.current.reload();
    });
    read.mockRejectedValue(new ApiError(409, 'RESULT_SOURCE_INVALID', 'source unavailable'));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.notFound).toBe(false);
  });
  it('offline stops fetching and marks old data stale; reconnect refreshes then removes stale state', async () => {
    const read = vi.fn<(signal: AbortSignal) => Promise<string>>().mockResolvedValue('saved');
    const { result } = renderHook(() => usePublicResource(read));
    await waitFor(() => expect(result.current.data).toBe('saved'));
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current.online).toBe(false);
    await act(async () => {
      await result.current.reload();
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current.stale).toBe(true);
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(result.current.stale).toBe(false));
    expect(result.current.online).toBe(true);
  });
  it('a slower-than-poll request is not starved, and late responses after unmount are ignored', async () => {
    vi.useFakeTimers();
    const pending = deferred<string>();
    const read = vi.fn<(signal: AbortSignal) => Promise<string>>().mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() => usePublicResource(read));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(read).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      pending.resolve('late private-free response');
    });
    expect(result.current.data).toBeUndefined();
  });
});
