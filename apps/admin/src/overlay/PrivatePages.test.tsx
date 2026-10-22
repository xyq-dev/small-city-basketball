// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { OverlayWorkbenchData } from '@small-city-basketball/contracts';
import { createApiClient } from '../api/client';
import type { EventRepository } from '../domain/types';
import type { RegistrationWorkspace } from '../registration/shared';
import { BroadcastIndexPage, MatchOverlayPage } from './PrivatePages';
import { grant, response, workbench } from './test-fixtures';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const context = (fetcher: typeof fetch): RegistrationWorkspace => ({
  client: createApiClient({ fetcher }),
  organizationId: 'org-a',
  userId: 'user-a',
  onSessionRefresh: async () => {},
});
function page(value: RegistrationWorkspace) {
  return (
    <MemoryRouter initialEntries={['/matches/match-a/overlay']}>
      <Routes>
        <Route path="/matches/:matchId/overlay" element={<MatchOverlayPage context={value} />} />
      </Routes>
    </MemoryRouter>
  );
}
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
describe('private broadcast management', () => {
  it('requires explicit TTL, cancels without writes and pins exact EventCAS for issue; successful secret is masked and only copied from memory', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(workbench))
      .mockResolvedValueOnce(
        response({
          ...workbench,
          event: { ...workbench.event, version: 8 },
          currentGrant: grant,
          capabilities: { canIssue: false, canRotate: true, canRevoke: true },
          credential: { overlayId: 'overlay-a', token: 'secret-memory-only' },
        }),
      );
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copy },
    });
    render(page(context(fetcher)));
    fireEvent.click(await screen.findByRole('button', { name: '签发包装链接' }));
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));
    expect(screen.getByRole('alert')).toHaveTextContent('1–10080');
    expect(fetcher).toHaveBeenCalledTimes(1);
    change('授权有效分钟', '0');
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    change('授权有效分钟', '60');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '签发包装链接' }));
    expect(screen.getByLabelText('授权有效分钟', { exact: true })).toHaveValue(null);
    change('授权有效分钟', '60');
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));
    expect(await screen.findByText('包装链接已签发', { exact: true })).toBeVisible();
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      type: 'ISSUE',
      expectedEventVersion: 7,
      expiresInMinutes: 60,
    });
    const input = screen.getByLabelText('浏览器源链接（已遮罩）', { exact: true });
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.queryByText('secret-memory-only', { exact: false })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制浏览器源链接' }));
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith(
        `${window.location.origin}/overlay/overlay-a#token=secret-memory-only`,
      ),
    );
  });
  it('preserves metadata and revoke capability for damaged FINAL preview, validates reason and sends grant+event CAS', async () => {
    const data: OverlayWorkbenchData = {
      ...workbench,
      preview: null,
      previewError: { code: 'RESULT_SOURCE_INVALID', message: 'source broken' },
      currentGrant: grant,
      capabilities: { canIssue: false, canRotate: true, canRevoke: true },
      historyTruncated: true,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(data))
      .mockResolvedValueOnce(
        response({
          ...data,
          event: { ...data.event, version: 8 },
          currentGrant: null,
          credential: null,
          capabilities: { canIssue: true, canRotate: false, canRevoke: false },
          history: [
            {
              ...grant,
              status: 'REVOKED',
              version: 2,
              revokedAt: workbench.serverTime,
              revocationReason: '结束',
            },
          ],
        }),
      );
    render(page(context(fetcher)));
    fireEvent.click(await screen.findByRole('button', { name: '撤销包装链接' }));
    expect(screen.getByText('赛果来源暂不可用，授权管理仍可使用')).toBeInTheDocument();
    expect(screen.queryByLabelText('包装主队比分')).not.toBeInTheDocument();
    expect(screen.getByText('仅显示最近20条已撤销记录，较早记录未在此列出。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('1–200');
    change('撤销理由', '结束');
    expect(screen.getByLabelText('撤销理由', { exact: true })).toHaveAccessibleName('撤销理由');
    fireEvent.click(screen.getByRole('button', { name: '确认撤销' }));
    expect(await screen.findByText('包装链接已撤销', { exact: true })).toBeVisible();
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      type: 'REVOKE',
      expectedEventVersion: 7,
      overlayId: 'overlay-a',
      expectedGrantVersion: 1,
      reason: '结束',
    });
  });
  it('does not blindly repeat a lost-ACK issue; requires fresh metadata and explicit rotation when secret was lost', async () => {
    const fresh = {
      ...workbench,
      event: { ...workbench.event, version: 8 },
      currentGrant: grant,
      capabilities: { canIssue: false, canRotate: true, canRevoke: true },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(workbench))
      .mockRejectedValueOnce(new Error('lost ACK'))
      .mockResolvedValueOnce(response(fresh))
      .mockResolvedValueOnce(
        response({
          ...fresh,
          event: { ...fresh.event, version: 9 },
          credential: { overlayId: 'new-overlay', token: 'new-secret' },
        }),
      );
    render(page(context(fetcher)));
    fireEvent.click(await screen.findByRole('button', { name: '签发包装链接' }));
    change('授权有效分钟', '60');
    fireEvent.click(screen.getByRole('button', { name: '确认签发' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('请先重新读取授权元数据');
    expect(screen.getByRole('button', { name: '签发包装链接' })).toBeDisabled();
    expect(fetcher).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '重新读取授权元数据' }));
    fireEvent.click(await screen.findByRole('button', { name: '轮换包装链接' }));
    expect(screen.queryByRole('button', { name: '签发包装链接' })).not.toBeInTheDocument();
    change('授权有效分钟', '120');
    change('轮换理由', '原始链接未收到');
    fireEvent.click(screen.getByRole('button', { name: '确认轮换' }));
    expect(await screen.findByText('包装链接已轮换', { exact: true })).toBeVisible();
    expect(JSON.parse(String(fetcher.mock.calls[3][1]?.body))).toEqual({
      type: 'ROTATE',
      expectedEventVersion: 8,
      overlayId: 'overlay-a',
      expectedGrantVersion: 1,
      reason: '原始链接未收到',
      expiresInMinutes: 120,
    });
  });
  it('honors read-only server capabilities and never requests an empty organization in team mode', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        ...workbench,
        currentGrant: { ...grant, status: 'EXPIRED' },
        capabilities: { canIssue: false, canRotate: false, canRevoke: false },
      }),
    );
    const { unmount } = render(page(context(fetcher)));
    expect(await screen.findByText('授权已到期', { exact: true })).toBeVisible();
    expect(screen.queryByRole('button', { name: '签发包装链接' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '轮换包装链接' })).not.toBeInTheDocument();
    expect(
      screen.getByText('当前赛事授权仅可查看预览与授权状态，不能管理包装链接。'),
    ).toBeVisible();
    unmount();
    render(
      page({
        ...context(fetcher),
        organizationId: undefined,
        teamContext: {
          orgId: 'org-a',
          organizationName: '机构',
          teamId: 'team-a',
          teamName: '球队',
        },
      }),
    );
    expect(screen.getByRole('heading', { name: '请切换到机构工作台' })).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('indexes only visible events and selected event formal matches, including all pagination', async () => {
    const event = {
      id: 'event-a',
      name: '城市赛事',
      startDate: '2026-10-22',
      endDate: '2026-10-23',
      timezone: 'Asia/Shanghai',
      venueName: null,
      format: 'ROUND_ROBIN' as const,
      status: 'SCHEDULED' as const,
      version: 7,
      createdAt: workbench.serverTime,
      updatedAt: workbench.serverTime,
    };
    const repository: EventRepository = {
      list: vi.fn().mockResolvedValue([event]),
      get: vi.fn(),
      create: vi.fn(),
      updateDraft: vi.fn(),
    };
    const match = {
      id: 'match-a',
      eventId: 'event-a',
      publicationId: 'pub',
      fixtureKey: 'r1m1',
      courtId: 'court',
      courtName: '主馆',
      startsAt: '2026-10-22T01:00:00Z',
      endsAt: '2026-10-22T02:00:00Z',
      roundNo: 1,
      positionNo: 1,
      status: 'SCHEDULED',
      version: 1,
      home: { entryId: 'a', teamId: 'a', teamName: '青峰队', rosterRevisionId: 'a' },
      away: { entryId: 'b', teamId: 'b', teamName: '北城队', rosterRevisionId: 'b' },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [match], meta: { requestId: 'test', nextCursor: 'next' } }),
        ),
      )
      .mockResolvedValueOnce(response([]));
    render(
      <MemoryRouter>
        <BroadcastIndexPage context={context(fetcher)} repository={repository} />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('赛事', { exact: true })).toHaveAccessibleName('赛事');
    expect(fetcher).not.toHaveBeenCalled();
    change('赛事', 'event-a');
    expect(await screen.findByRole('link', { name: /管理比分包装/ })).toHaveAttribute(
      'href',
      '/matches/match-a/overlay',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url] of fetcher.mock.calls)
      expect(String(url)).toContain('/events/event-a/matches?');
    expect(String(fetcher.mock.calls[1][0])).toContain('cursor=next');
  });
});
