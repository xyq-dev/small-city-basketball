// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicViewingApp } from '../viewing/PublicPages';
import { live, publicEvent, publicMatch, response } from '../viewing/test-fixtures';
import { publicGroupEvent } from './test-fixtures';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('anonymous group viewing format dispatch', () => {
  it('reads scoped groups instead of a fictitious whole-event league table and clears all group content when revoked', async () => {
    window.history.replaceState({}, '', `/watch/${publicEvent.publicEventId}`);
    let revoked = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (revoked) return response({ code: 'PUBLIC_NOT_FOUND', message: '已撤销' }, {}, 404);
      return response(
        String(url).includes('/schedule?')
          ? [publicMatch]
          : String(url).endsWith('/groups')
            ? publicGroupEvent
            : {
                ...publicEvent,
                format: 'GROUP_KNOCKOUT',
                totalMatchCount: 9,
                confirmedMatchCount: 6,
              },
      );
    });
    render(<PublicViewingApp fetcher={fetcher} />);
    await screen.findByRole('tab', { name: '分组与晋级' });
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/groups'))).toBe(true);
    expect(
      fetcher.mock.calls.some(
        ([url]) => String(url).endsWith('/standings') || String(url).endsWith('/knockout'),
      ),
    ).toBe(false);
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'omit')).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: '分组与晋级' }));
    expect(screen.getByRole('region', { name: 'A组 · 组内积分' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '淘汰阶段尚未发布' })).toBeVisible();
    revoked = true;
    fireEvent.click(screen.getByRole('button', { name: '刷新公开资料' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'A组 · 组内积分' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('tab', { name: '分组与晋级' })).not.toBeInTheDocument();
  });
  it.each([404, 410, 503])(
    'unmounts protected media when the original match authorization read fails with %s',
    async (status) => {
      window.history.replaceState(
        {},
        '',
        `/watch/${live.publicEventId}/matches/${live.publicMatchId}`,
      );
      let unavailable = false;
      const mediaKey = 'x'.repeat(43);
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
        if (String(url).endsWith('/media'))
          return response({
            publicEventId: live.publicEventId,
            publicMatchId: live.publicMatchId,
            media: [
              {
                publicMediaId: mediaKey,
                kind: 'IMAGE',
                title: '媒体合成图',
                contentPath: `/v1/public/events/${live.publicEventId}/matches/${live.publicMatchId}/media/${mediaKey}/content`,
                contentType: 'image/png',
                externalUrl: null,
                externalNotice: null,
                markers: [],
              },
            ],
          });
        return unavailable
          ? response({ code: 'PUBLIC_UNAVAILABLE', message: '不可用' }, {}, status)
          : response(live);
      });
      render(<PublicViewingApp fetcher={fetcher} />);
      expect(await screen.findByRole('img', { name: '媒体合成图' })).toBeVisible();
      expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'omit')).toBe(true);
      unavailable = true;
      fireEvent.click(screen.getByRole('button', { name: '刷新公开资料' }));
      await waitFor(() =>
        expect(screen.queryByRole('img', { name: '媒体合成图' })).not.toBeInTheDocument(),
      );
      expect(screen.queryByRole('region', { name: '公开比赛媒体' })).not.toBeInTheDocument();
    },
  );
});
