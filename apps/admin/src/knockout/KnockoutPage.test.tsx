// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { RegistrationWorkspace } from '../registration/shared';
import { createApiClient } from '../api/client';
import { court } from '../scheduling/test-fixtures';
import { deferred, response } from '../viewing/test-fixtures';
import { EventKnockoutPage } from './KnockoutPage';
import { knockout } from './test-fixtures';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const context = (fetcher: typeof fetch, org = 'org-a'): RegistrationWorkspace => ({
  client: createApiClient({ fetcher }),
  organizationId: org,
  userId: 'user-a',
  onSessionRefresh: async () => {},
});
function page(value: RegistrationWorkspace) {
  return (
    <MemoryRouter initialEntries={['/events/private-event-a/knockout']}>
      <Routes>
        <Route path="/events/:eventId/knockout" element={<EventKnockoutPage context={value} />} />
      </Routes>
    </MemoryRouter>
  );
}
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
function fill() {
  change('第2轮第1场 场地', court.id);
  change('第2轮第1场 开始时间', '2026-12-01T15:00');
  change('晋级发布原因', '  独立确认核对无误  ');
}
describe('explicit knockout advancement UI', () => {
  it('shows byes without synthetic matches, keeps final placings pending, and trusts read-only capabilities', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        String(path).includes('/courts')
          ? response([court], { capabilities: { canCreateCourt: true } })
          : response({ ...knockout, capabilities: { canPublishNextRound: false } }),
      );
    render(page(context(fetcher)));
    expect(await screen.findByRole('region', { name: '淘汰赛签位' })).toHaveTextContent(
      '轮空晋级 · 无比赛记录',
    );
    expect(screen.getByRole('region', { name: '淘汰赛最终名次' })).toHaveTextContent(
      '最终名次未产生',
    );
    expect(screen.queryByRole('button', { name: '核对并发布下一轮' })).not.toBeInTheDocument();
    expect(screen.getByText('当前身份没有发布下一轮的权限，请联系赛事负责人。')).toBeVisible();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });
  it('requires full allocations and a Unicode reason, then pins version/hash in an explicit second confirmation', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        String(path).includes('/courts')
          ? response([court], { capabilities: { canCreateCourt: true } })
          : response(knockout),
      );
    render(page(context(fetcher)));
    fireEvent.click(await screen.findByRole('button', { name: '核对并发布下一轮' }));
    expect(screen.getByRole('alert')).toHaveTextContent('4–500字');
    fill();
    fireEvent.click(screen.getByRole('button', { name: '核对并发布下一轮' }));
    let dialog = screen.getByRole('dialog', { name: '发布下一轮' });
    expect(dialog).toHaveTextContent('撤销现有实时观赛链接');
    expect(within(dialog).getByLabelText('本次发布安排')).toHaveTextContent(court.name);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '核对并发布下一轮' }));
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认发布下一轮' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
    );
    const write = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(write[0]).toBe('/v1/orgs/org-a/events/private-event-a/knockout-round-commands');
    expect(JSON.parse(String(write[1]?.body))).toEqual({
      type: 'PUBLISH_ROUND',
      expectedEventVersion: 7,
      expectedSourceHash: 'a'.repeat(64),
      roundNo: 2,
      reason: '独立确认核对无误',
      allocations: [
        { fixtureKey: 'R2-P1', courtId: court.id, startsAt: '2026-12-01T15:00:00.000+08:00' },
      ],
    });
  });
  it('preserves input after a source conflict, blocks replay, and only accepts a fresh explicit decision after refresh', async () => {
    let reads = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (String(path).includes('/courts'))
        return response([court], { capabilities: { canCreateCourt: true } });
      if (init?.method === 'POST')
        return response({ code: 'KNOCKOUT_SOURCE_CHANGED', message: '来源确认已更改' }, {}, 409);
      reads++;
      return response({ ...knockout, event: { ...knockout.event, version: 6 + reads } });
    });
    render(page(context(fetcher)));
    await screen.findByRole('button', { name: '核对并发布下一轮' });
    fill();
    fireEvent.click(screen.getByRole('button', { name: '核对并发布下一轮' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认发布下一轮' }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).getByRole('button', { name: '确认发布下一轮' }),
      ).toBeDisabled(),
    );
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
    expect(screen.getByLabelText('晋级发布原因')).toHaveValue('  独立确认核对无误  ');
    expect(screen.getByLabelText('第2轮第1场 场地')).toHaveValue(court.id);
    expect(screen.getByRole('button', { name: '核对并发布下一轮' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '刷新晋级资料' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '核对并发布下一轮' })).toBeEnabled(),
    );
    expect(screen.getByLabelText('晋级发布原因')).toHaveValue('  独立确认核对无误  ');
    expect(screen.getByLabelText('第2轮第1场 开始时间')).toHaveValue('2026-12-01T15:00');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '核对并发布下一轮' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('版本 v8');
  });
  it('clears old organization data and ignores its late response when switching workspace', async () => {
    const pending = deferred<Response>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        String(path).includes('/courts')
          ? response([court], { capabilities: { canCreateCourt: true } })
          : String(path).includes('/org-a/')
            ? pending.promise
            : response({ ...knockout, event: { ...knockout.event, name: '乙机构独立赛事' } }),
      );
    const view = render(page(context(fetcher)));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    view.rerender(page(context(fetcher, 'org-b')));
    expect(await screen.findByRole('heading', { level: 1, name: '乙机构独立赛事' })).toBeVisible();
    await act(async () => pending.resolve(response(knockout)));
    expect(screen.getByRole('heading', { level: 1, name: '乙机构独立赛事' })).toBeVisible();
    expect(
      screen.queryByRole('heading', { level: 1, name: knockout.event.name }),
    ).not.toBeInTheDocument();
  });
});
