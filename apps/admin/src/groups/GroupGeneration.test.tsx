// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PolicyForm } from '../scheduling/PolicyForm';
import { court, currentOverview, revision, response } from '../scheduling/test-fixtures';
import { EventSchedulingPage } from '../scheduling/SchedulePages';
import { createApiClient } from '../api/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { groupEvent } from './test-fixtures';
afterEach(cleanup);
const teams = Array.from({ length: 8 }, (_, i) => ({
  entryId: `entry-${i}`,
  teamName: `合成${i}队`,
}));
describe('group draw policy form', () => {
  it('limits seed picks to the selected group count and saves only frozen entry IDs with explicit group configuration', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <PolicyForm
        courts={[court]}
        initial={revision.policy}
        groupOptions={{ participants: teams }}
        redraw={false}
        busy={false}
        onSave={save}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('合成0队（种子队）'));
    fireEvent.click(screen.getByLabelText('合成1队（种子队）'));
    expect(screen.getByLabelText('合成2队（种子队）')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('小组数量'), { target: { value: '4' } });
    expect(screen.getByLabelText('合成2队（种子队）')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '生成分组循环对阵' }));
    expect(save).toHaveBeenCalledWith(
      {
        ...revision.policy,
        courtWindows: [
          {
            courtId: court.id,
            startsAt: '2026-12-01T09:00:00.000+08:00',
            endsAt: '2026-12-01T18:00:00.000+08:00',
          },
        ],
      },
      undefined,
      { groupCount: 4, seededEntryIds: ['entry-0', 'entry-1'] },
    );
  });
  it('refuses an invalid restored configuration with too many seeds instead of silently discarding picks', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <PolicyForm
        courts={[court]}
        initial={revision.policy}
        groupOptions={{
          participants: teams,
          initial: { groupCount: 2, seededEntryIds: ['entry-0', 'entry-1', 'entry-2'] },
        }}
        redraw={false}
        busy={false}
        onSave={save}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '生成分组循环对阵' }));
    expect(screen.getByRole('alert')).toHaveTextContent('数量不能超过小组数');
    expect(save).not.toHaveBeenCalled();
  });
  it('requires at least two frozen teams per group and does not submit an undersized event', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <PolicyForm
        courts={[court]}
        initial={revision.policy}
        groupOptions={{ participants: teams.slice(0, 3) }}
        redraw={false}
        busy={false}
        onSave={save}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '生成分组循环对阵' }));
    expect(screen.getByRole('alert')).toHaveTextContent('每组至少2队');
    expect(save).not.toHaveBeenCalled();
  });
  it('shows the authoritative saved draft groups before publication instead of reproducing the draw in the browser', async () => {
    const participants = groupEvent.competition!.groups.flatMap((g) => g.participants);
    const draft = {
      ...revision,
      algorithmVersion: 'GK_BALANCED_V1' as const,
      groupConfig: { groupCount: 2 as const, seededEntryIds: [] },
      participants,
    };
    const current = {
      ...currentOverview(draft),
      event: { ...currentOverview(draft).event, format: 'GROUP_KNOCKOUT' as const },
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
      response(
        String(url).includes('/courts')
          ? [court]
          : String(url).endsWith('/groups')
            ? {
                ...groupEvent,
                event: current.event,
                competition: null,
                draftGroups: groupEvent.competition!.groups.map((g) => ({
                  groupKey: g.groupKey,
                  label: g.label,
                  participants: g.participants,
                })),
              }
            : String(url).includes('/schedule-revisions/')
              ? draft
              : current,
        String(url).includes('/courts') ? { capabilities: { canCreateCourt: true } } : {},
      ),
    );
    render(
      <MemoryRouter initialEntries={['/events/event-a/scheduling']}>
        <Routes>
          <Route
            path="/events/:eventId/scheduling"
            element={
              <EventSchedulingPage
                context={{
                  client: createApiClient({ fetcher }),
                  organizationId: 'org-a',
                  userId: 'owner-a',
                  onSessionRefresh: async () => {},
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('region', { name: '发布前分组核对' })).toHaveTextContent(
      '合成甲队',
    );
    expect(screen.getByRole('region', { name: '发布前分组核对' })).toHaveTextContent('合成己队');
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/groups'))).toBe(true);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });
});
