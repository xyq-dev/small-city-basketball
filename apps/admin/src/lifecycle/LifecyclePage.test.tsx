// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EventLifecycleData } from '@small-city-basketball/contracts';
import { createApiClient } from '../api/client';
import type { RegistrationWorkspace } from '../registration/shared';
import { deferred, response } from '../viewing/test-fixtures';
import { EventLifecyclePage } from './LifecyclePage';
import { lifecycle } from './test-fixtures';
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
    <MemoryRouter initialEntries={['/events/private-event-a/lifecycle']}>
      <Routes>
        <Route path="/events/:eventId/lifecycle" element={<EventLifecyclePage context={value} />} />
      </Routes>
    </MemoryRouter>
  );
}
const reason = (value: string) =>
  fireEvent.change(screen.getByLabelText('操作原因'), { target: { value } });
describe('explicit event closure and recovery UI', () => {
  it('renders server blockers and does not infer actions from event status or local roles', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        ...lifecycle,
        completion: {
          ...lifecycle.completion,
          ready: false,
          confirmedMatchCount: 0,
          blockers: ['UNCONFIRMED_MATCHES'],
        },
        capabilities: { canComplete: true, canArchive: false, canReopen: false },
      }),
    );
    render(page(context(fetcher)));
    expect(await screen.findByLabelText('完赛阻塞项')).toHaveTextContent(
      '仍有比赛缺少当前有效的独立赛果确认',
    );
    expect(screen.getByRole('button', { name: '确认整届完赛' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '归档赛事' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重开赛事' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });
  it('requires a reason and second confirmation, cancellation sends nothing, then submits the seen version once', async () => {
    let current: EventLifecycleData = structuredClone(lifecycle);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      if (init?.method === 'POST')
        current = {
          ...current,
          event: { ...current.event, status: 'COMPLETED', version: 8 },
          capabilities: { canComplete: false, canArchive: true, canReopen: true },
        };
      return response(current);
    });
    render(page(context(fetcher)));
    fireEvent.click(await screen.findByRole('button', { name: '确认整届完赛' }));
    let dialog = screen.getByRole('dialog', { name: '确认整届完赛' });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '确认整届完赛' }));
    dialog = screen.getByRole('dialog', { name: '确认整届完赛' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认整届完赛' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('请填写4–500字');
    reason('  全场确认核对完成  ');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认整届完赛' }));
    expect(await screen.findByRole('button', { name: '归档赛事' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({
      type: 'COMPLETE',
      expectedEventVersion: 7,
      reason: '全场确认核对完成',
    });
  });
  it.each([3, 501])(
    'rejects a reason with %i Unicode code points before sending a command',
    async (length) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(lifecycle));
      render(page(context(fetcher)));
      fireEvent.click(await screen.findByRole('button', { name: '确认整届完赛' }));
      reason('🏀'.repeat(length));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: '确认整届完赛' }),
      );
      expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
        '请填写4–500字',
      );
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    },
  );
  it('accepts all 500 supplementary Unicode characters allowed by the server', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(lifecycle));
    render(page(context(fetcher)));
    fireEvent.click(await screen.findByRole('button', { name: '确认整届完赛' }));
    expect(screen.getByLabelText('操作原因')).toHaveAttribute('maxlength', '1000');
    const value = '🏀'.repeat(500);
    reason(value);
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认整届完赛' }),
    );
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
    );
    expect(
      JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1]?.body))
        .reason,
    ).toBe(value);
  });
  it.each(['ARCHIVE', 'REOPEN'] as const)(
    'explains and sends %s without inventing score changes',
    async (type) => {
      const current = {
        ...lifecycle,
        event: { ...lifecycle.event, status: 'COMPLETED' as const },
        capabilities: { canComplete: false, canArchive: true, canReopen: true },
      };
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(current));
      render(page(context(fetcher)));
      const label = type === 'ARCHIVE' ? '归档赛事' : '重开赛事';
      fireEvent.click(await screen.findByRole('button', { name: label }));
      const dialog = screen.getByRole('dialog', { name: label });
      expect(dialog).toHaveTextContent(
        type === 'ARCHIVE' ? '保留本届正式赛程' : '单场已确认赛果不会自动重开',
      );
      reason('合成审计原因');
      fireEvent.click(within(dialog).getByRole('button', { name: `确认${label}` }));
      await waitFor(() =>
        expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
      );
      expect(
        JSON.parse(
          String(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1]?.body),
        ),
      ).toEqual({ type, expectedEventVersion: 7, reason: '合成审计原因' });
    },
  );
  it('409 never replays automatically; keeps the reason, requires refresh and uses the fresh version', async () => {
    let reads = 0;
    const writes: unknown[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      if (init?.method === 'POST') {
        writes.push(JSON.parse(String(init.body)));
        return writes.length === 1
          ? response({ code: 'VERSION_CONFLICT', message: '赛事版本冲突' }, {}, 409)
          : response({ ...lifecycle, event: { ...lifecycle.event, version: 10 } });
      }
      reads++;
      return response({
        ...lifecycle,
        event: { ...lifecycle.event, version: reads === 1 ? 7 : 9 },
      });
    });
    render(page(context(fetcher)));
    fireEvent.click(await screen.findByRole('button', { name: '确认整届完赛' }));
    reason('保留此审计原因');
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认整届完赛' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '重新读取最新资料' })).toBeVisible(),
    );
    expect(screen.getByLabelText('操作原因')).toHaveValue('保留此审计原因');
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认整届完赛' }),
    ).toBeDisabled();
    expect(writes).toHaveLength(1);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '重新读取最新资料' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认整届完赛' }));
    expect(screen.getByLabelText('操作原因')).toHaveValue('保留此审计原因');
    expect(screen.getByRole('dialog')).toHaveTextContent('版本 v9');
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认整届完赛' }),
    );
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toEqual({
      type: 'COMPLETE',
      expectedEventVersion: 9,
      reason: '保留此审计原因',
    });
  });
  it('a failed write keeps the dialog and never reports completion', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_path, init) =>
        init?.method === 'POST'
          ? response({ code: 'SOURCE_INVALID', message: '赛果来源不可用' }, {}, 409)
          : response(lifecycle),
      );
    render(page(context(fetcher)));
    fireEvent.click(await screen.findByRole('button', { name: '确认整届完赛' }));
    reason('合成原因');
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认整届完赛' }),
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('赛果来源不可用'));
    expect(screen.queryByText('确认整届完赛已完成')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '归档赛事' })).not.toBeInTheDocument();
  });
  it('does not request lifecycle with team or empty organization context', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const workspace = context(fetcher);
    const { rerender } = render(
      page({
        ...workspace,
        teamContext: {
          orgId: 'org-a',
          organizationName: '合成机构',
          teamId: 'team-a',
          teamName: '合成球队',
        },
      }),
    );
    expect(screen.getByRole('heading', { name: '请切换到机构工作台' })).toBeVisible();
    rerender(page({ ...workspace, organizationId: '' }));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('changing organization clears old controls and ignores a late old response', async () => {
    const old = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) =>
      String(path).includes('/org-a/')
        ? old.promise
        : response({
            ...lifecycle,
            event: { ...lifecycle.event, name: '新机构赛事' },
            capabilities: { canComplete: false, canArchive: false, canReopen: false },
          }),
    );
    const workspace = context(fetcher);
    const { rerender } = render(page(workspace));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    rerender(page({ ...workspace, organizationId: 'org-b' }));
    expect(await screen.findByRole('heading', { name: '新机构赛事' })).toBeVisible();
    await act(async () => {
      old.resolve(response(lifecycle));
    });
    expect(screen.getByRole('heading', { name: '新机构赛事' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '确认整届完赛' })).not.toBeInTheDocument();
  });
});
