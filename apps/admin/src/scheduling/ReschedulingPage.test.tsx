// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client';
import { EventSchedulingPage } from './SchedulePages';
import { court, currentOverview, officialMatches, response } from './test-fixtures';
import {
  afterReschedule,
  publishedRevision,
  reschedulingWorkspace,
  secondCourt,
} from './rescheduling-fixtures';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function harness() {
  let current = reschedulingWorkspace;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
    const url = String(path);
    if (init?.method === 'POST') {
      current = afterReschedule(current, JSON.parse(String(init.body)));
      return response(current);
    }
    if (url.endsWith('/rescheduling')) return response(current);
    if (url.includes('/courts?'))
      return response([court, secondCourt], { capabilities: { canCreateCourt: true } });
    if (url.includes('/matches?'))
      return response(
        officialMatches(publishedRevision).map((match) =>
          match.id === current.match.id ? current.match : match,
        ),
      );
    if (url.endsWith('/schedule-revisions/revision-a'))
      return response({ ...publishedRevision, eventVersion: current.event.version });
    return response({
      ...currentOverview(publishedRevision),
      event: current.event,
      publication: {
        id: 'publication-a',
        eventId: current.event.id,
        revisionId: publishedRevision.id,
        publicationHash: 'd'.repeat(64),
        publishedAt: court.createdAt,
        matchCount: 3,
      },
      capabilities: { canGenerate: false, canRedraw: false, canReadMatches: true },
    });
  });
  const context = {
    client: createApiClient({ fetcher }),
    organizationId: 'org-a',
    userId: 'owner-a',
    onSessionRefresh: async () => {},
  };
  render(
    <MemoryRouter initialEntries={['/events/event-a/scheduling']}>
      <Routes>
        <Route
          path="/events/:eventId/scheduling"
          element={<EventSchedulingPage context={context} />}
        />
        <Route
          path="/events/:eventId/scheduling/history/:revisionId"
          element={<EventSchedulingPage context={context} />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return fetcher;
}

describe('正式安排中的改期入口', () => {
  it('成功后刷新当前安排，原始发布快照仍显示旧时间且没有改期入口', async () => {
    const fetcher = harness();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '第1轮第1场 改期与记录' }));
    await screen.findByLabelText('改期原因');
    fireEvent.change(screen.getByLabelText('改期开赛时间（UTC+8）'), {
      target: { value: '2026-12-01T15:00' },
    });
    await user.type(screen.getByLabelText('改期原因'), '场地维护调整');
    await user.click(screen.getByRole('button', { name: '核对改期' }));
    await user.click(screen.getByRole('button', { name: '确认改期' }));
    await screen.findByText('正式安排已更新，改期记录已保存');
    const opener = await screen.findByRole('button', { name: '第1轮第1场 改期与记录' });
    expect(opener.closest('article')).toHaveTextContent('15:00');
    expect(screen.queryByRole('region', { name: '单场改期与记录' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: '查看原始发布快照' }));
    const heading = await screen.findByRole('heading', { name: '原始发布快照' });
    expect(heading.closest('section')).toHaveTextContent('09:00');
    expect(heading.closest('section')).not.toHaveTextContent('15:00');
    expect(screen.queryByRole('button', { name: /改期与记录/ })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('关闭内联记录后焦点回到原场次入口，不产生写入', async () => {
    const fetcher = harness();
    const user = userEvent.setup();
    const opener = await screen.findByRole('button', { name: '第1轮第1场 改期与记录' });
    await user.click(opener);
    await screen.findByLabelText('改期原因');
    expect(screen.getByRole('heading', { name: '单场改期与记录' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '关闭改期记录' }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole('region', { name: '单场改期与记录' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});
