// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createApiClient } from '../api/client';
import type { RegistrationWorkspace } from '../registration/shared';
import { court } from '../scheduling/test-fixtures';
import { response } from '../viewing/test-fixtures';
import { EventGroupKnockoutPage } from './GroupKnockoutPage';
import { groupEvent, groupHash, publicGroupEvent, tieEvent } from './test-fixtures';
import { PublicGroupTables } from './GroupTables';
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
    <MemoryRouter initialEntries={['/events/private-event-a/groups']}>
      <Routes>
        <Route
          path="/events/:eventId/groups"
          element={<EventGroupKnockoutPage context={value} />}
        />
      </Routes>
    </MemoryRouter>
  );
}
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
function fill() {
  change('第4轮第1场场地', court.id);
  change('第4轮第1场开始时间', '2026-12-01T15:00');
  change('第4轮第2场场地', court.id);
  change('第4轮第2场开始时间', '2026-12-01T17:00');
  change('晋级发布原因', '  核对全部组赛与晋级顺序  ');
}
describe('group-to-knockout operator UI', () => {
  it('requires complete allocations then makes an explicit version/hash-pinned qualification decision', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/courts')
          ? response([court], { capabilities: { canCreateCourt: true } })
          : response(groupEvent),
      );
    render(page(context(fetcher)));
    fireEvent.click(await screen.findByRole('button', { name: '核对并发布淘汰首轮' }));
    expect(screen.getByRole('alert')).toHaveTextContent('需同时填写');
    fill();
    fireEvent.click(screen.getByRole('button', { name: '核对并发布淘汰首轮' }));
    let dialog = screen.getByRole('dialog', { name: '正式发布晋级赛程' });
    expect(dialog).toHaveTextContent('锁定来源并撤销旧实时观赛链接');
    expect(within(dialog).getByLabelText('本次分组晋级安排')).toHaveTextContent(court.name);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '核对并发布淘汰首轮' }));
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认正式发布' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
    );
    const write = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(write[0]).toBe('/v1/orgs/org-a/events/private-event-a/group-qualification-commands');
    expect(JSON.parse(String(write[1]?.body))).toEqual({
      type: 'PUBLISH_QUALIFICATION',
      expectedEventVersion: 7,
      expectedSourceHash: groupHash,
      reason: '核对全部组赛与晋级顺序',
      allocations: [
        { fixtureKey: 'R4-P1', courtId: court.id, startsAt: '2026-12-01T15:00:00.000+08:00' },
        { fixtureKey: 'R4-P2', courtId: court.id, startsAt: '2026-12-01T17:00:00.000+08:00' },
      ],
    });
  });
  it('pins the group source in an independent durable tie command with no schedule allocation', async () => {
    const value = tieEvent();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/courts')
          ? response([court], { capabilities: { canCreateCourt: true } })
          : response(value),
      );
    render(page(context(fetcher)));
    fireEvent.click(await screen.findByRole('button', { name: '核对并保存A组抽签' }));
    expect(screen.getByRole('alert')).toHaveTextContent('4–500字');
    change('A组抽签原因', '组赛确认且细则仍同分');
    fireEvent.click(screen.getByRole('button', { name: '核对并保存A组抽签' }));
    const dialog = screen.getByRole('dialog', { name: '保存独立同分抽签' });
    expect(dialog).toHaveTextContent('不能因之后安排冲突重复抽取');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认保存抽签' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1),
    );
    const write = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(write[0]).toContain('/group-tie-commands');
    expect(JSON.parse(String(write[1]?.body))).toEqual({
      type: 'DRAW_GROUP_TIE',
      expectedEventVersion: 7,
      expectedSourceHash: '0'.repeat(64),
      groupKey: 'A',
      reason: '组赛确认且细则仍同分',
    });
    expect(screen.queryByRole('button', { name: '核对并发布淘汰首轮' })).not.toBeInTheDocument();
  });
  it('keeps entered plans after a source conflict and requires refreshed explicit confirmation before retry', async () => {
    let reads = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).includes('/courts'))
        return response([court], { capabilities: { canCreateCourt: true } });
      if (init?.method === 'POST')
        return response({ code: 'GROUP_SOURCE_CHANGED', message: '组赛来源已变化' }, {}, 409);
      return response({ ...groupEvent, event: { ...groupEvent.event, version: 6 + ++reads } });
    });
    render(page(context(fetcher)));
    await screen.findByRole('button', { name: '核对并发布淘汰首轮' });
    fill();
    fireEvent.click(screen.getByRole('button', { name: '核对并发布淘汰首轮' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '确认正式发布' }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).getByRole('button', { name: '确认正式发布' }),
      ).toBeDisabled(),
    );
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
    expect(screen.getByLabelText('第4轮第1场场地')).toHaveValue(court.id);
    expect(screen.getByLabelText('晋级发布原因')).toHaveValue('  核对全部组赛与晋级顺序  ');
    expect(screen.getByRole('button', { name: '核对并发布淘汰首轮' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新读取分组资料' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '核对并发布淘汰首轮' })).toBeEnabled(),
    );
    expect(screen.getByLabelText('第4轮第2场开始时间')).toHaveValue('2026-12-01T17:00');
    fireEvent.click(screen.getByRole('button', { name: '核对并发布淘汰首轮' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('赛事版本 v8');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it('honors read-only capability and does not invent cross-group final ranks', async () => {
    const value = {
      ...groupEvent,
      capabilities: {
        canDrawTies: false,
        canPublishQualification: false,
        canPublishNextRound: false,
      },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('/courts')
          ? response([court], { capabilities: { canCreateCourt: false } })
          : response(value),
      );
    render(page(context(fetcher)));
    expect(await screen.findByRole('heading', { name: '当前身份没有晋级发布权限' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '核对并发布淘汰首轮' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '分组淘汰最终名次' })).toHaveTextContent(
      '最终名次未产生',
    );
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });
  it('public group tables expose only group ranks and explicit group elimination without an invented overall rank', () => {
    const data = structuredClone(publicGroupEvent);
    data.isComplete = true;
    data.placements = [
      {
        team: data.groups[0]!.rows[2]!,
        groupKey: 'A',
        groupRank: 3,
        stage: 'GROUP_ELIMINATED',
        rank: null,
        tied: false,
      },
    ];
    render(
      <MemoryRouter>
        <PublicGroupTables data={data} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('region', { name: 'A组 · 组内积分' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'B组 · 组内积分' })).toBeInTheDocument();
    const placements = screen.getByRole('region', { name: '分组淘汰最终名次' });
    expect(placements).toHaveTextContent('小组出局');
    expect(placements).toHaveTextContent('A组第3名');
    expect(placements).not.toHaveTextContent('第null名');
  });
});
