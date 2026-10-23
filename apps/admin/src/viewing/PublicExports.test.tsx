// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RuntimeApp from '../RuntimeApp';
import * as exports from './exports';
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function eventFetcher() {
  return vi
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
}
describe('public export UI and authorization lifecycle', () => {
  it('rechecks the complete public source before CSV export and never calls private or upload endpoints', async () => {
    const fetcher = eventFetcher();
    const download = vi.spyOn(exports, 'downloadPublicExport').mockImplementation(() => {});
    render(<RuntimeApp mode="api" publicFetcher={fetcher} />);
    await screen.findByRole('heading', { level: 1, name: publicEvent.name });
    fetcher.mockImplementation(async (path) =>
      response(
        String(path).includes('/schedule?')
          ? [{ ...publicMatch, score: { home: 8, away: 4 } }]
          : String(path).endsWith('/standings')
            ? publicStandings
            : { ...publicEvent, name: '最新公开赛事名称' },
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '下载完整赛程CSV' }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    const asset = download.mock.calls[0][0];
    expect(asset.body).toContain('最新公开赛事名称');
    expect(asset.body).toContain('"8","4"');
    expect(asset.body).not.toContain(publicEvent.publicEventId);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(
      fetcher.mock.calls.every(
        ([path, init]) =>
          String(path).startsWith('/v1/public/events/') && init?.credentials === 'omit',
      ),
    ).toBe(true);
    expect(screen.getByText(/已下载文件无法远程撤回/)).toBeVisible();
  });
  it('immediately removes data and export actions when export revalidation learns that authorization was revoked', async () => {
    const fetcher = eventFetcher();
    const download = vi.spyOn(exports, 'downloadPublicExport').mockImplementation(() => {});
    render(<RuntimeApp mode="api" publicFetcher={fetcher} />);
    await screen.findByRole('heading', { level: 1, name: publicEvent.name });
    fetcher.mockResolvedValue(response({ code: 'NOT_FOUND', message: 'revoked' }, {}, 404));
    fireEvent.click(screen.getByRole('button', { name: '下载本页赛程海报SVG' }));
    expect(await screen.findByRole('heading', { name: '观赛链接不可用' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: publicEvent.name })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /下载/ })).not.toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
  });
  it('disables exports offline and ignores a pending successful response after going offline', async () => {
    const fetcher = eventFetcher();
    const download = vi.spyOn(exports, 'downloadPublicExport').mockImplementation(() => {});
    render(<RuntimeApp mode="api" publicFetcher={fetcher} />);
    await screen.findByRole('heading', { level: 1, name: publicEvent.name });
    const pending = deferred<Response>();
    fetcher.mockImplementation(async (path) =>
      String(path).includes('/schedule?')
        ? pending.promise
        : response(String(path).endsWith('/standings') ? publicStandings : publicEvent),
    );
    fireEvent.click(screen.getByRole('button', { name: '下载完整赛程CSV' }));
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByRole('button', { name: '下载完整赛程CSV' })).toBeDisabled();
    await act(async () => pending.resolve(response([publicMatch])));
    expect(download).not.toHaveBeenCalled();
    expect(screen.queryByAltText('本次赛程海报预览')).not.toBeInTheDocument();
  });
  it('does not download or call a partial schedule complete when a later page fails', async () => {
    const fetcher = eventFetcher();
    const download = vi.spyOn(exports, 'downloadPublicExport').mockImplementation(() => {});
    render(<RuntimeApp mode="api" publicFetcher={fetcher} />);
    await screen.findByRole('heading', { level: 1, name: publicEvent.name });
    fetcher.mockImplementation(async (path) => {
      const url = String(path);
      if (url.includes('cursor=')) return response({ code: 'UNAVAILABLE' }, {}, 503);
      if (url.includes('/schedule?')) return response([publicMatch], { nextCursor: 'page-2' });
      return response(url.endsWith('/standings') ? publicStandings : publicEvent);
    });
    fireEvent.click(screen.getByRole('button', { name: '下载完整赛程CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取公开资料');
    expect(download).not.toHaveBeenCalled();
  });
  it('creates a match poster preview from a fresh real public snapshot with its result status', async () => {
    window.history.replaceState(
      {},
      '',
      `/watch/${live.publicEventId}/matches/${live.publicMatchId}`,
    );
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(live));
    const download = vi.spyOn(exports, 'downloadPublicExport').mockImplementation(() => {});
    render(<RuntimeApp mode="api" publicFetcher={fetcher} />);
    await screen.findByRole('heading', {
      level: 1,
      name: `${live.home.teamName} vs ${live.away.teamName}`,
    });
    fireEvent.click(screen.getByRole('button', { name: '下载比分海报SVG' }));
    const preview = await screen.findByAltText('本次比分海报预览');
    expect(preview).toBeVisible();
    expect(download.mock.calls[0][0].body).toContain('剩余 00:50');
    expect(download.mock.calls[0][0].body).toContain('赛果未确认');
    expect(preview).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml;'));
    expect(fetcher.mock.calls.filter(([url]) => !String(url).endsWith('/media'))).toHaveLength(2);
  });
  it('clears a generated preview and blocks output on invalidated result sources', async () => {
    const fetcher = eventFetcher();
    const download = vi.spyOn(exports, 'downloadPublicExport').mockImplementation(() => {});
    render(<RuntimeApp mode="api" publicFetcher={fetcher} />);
    await screen.findByRole('heading', { level: 1, name: publicEvent.name });
    fireEvent.click(screen.getByRole('button', { name: '下载本页赛程海报SVG' }));
    await screen.findByAltText('本次赛程海报预览');
    fetcher.mockImplementation(async () => response({ code: 'RESULT_SOURCE_INVALID' }, {}, 409));
    fireEvent.click(screen.getByRole('button', { name: '下载完整赛程CSV' }));
    await screen.findByRole('heading', { name: '暂时无法读取观赛资料' });
    expect(screen.queryByAltText('本次赛程海报预览')).not.toBeInTheDocument();
    expect(download).toHaveBeenCalledOnce();
  });
  it('prints a freshly generated poster rather than the unrelated page controls', async () => {
    const fetcher = eventFetcher();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const download = vi.spyOn(exports, 'downloadPublicExport').mockImplementation(() => {});
    render(<RuntimeApp mode="api" publicFetcher={fetcher} />);
    await screen.findByRole('heading', { level: 1, name: publicEvent.name });
    fireEvent.click(screen.getByRole('button', { name: '打印本页海报' }));
    expect(await screen.findByAltText('本次赛程海报预览')).toBeVisible();
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(download).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
});
