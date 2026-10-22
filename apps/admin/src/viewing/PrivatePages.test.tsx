// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EventStandingsData } from '@small-city-basketball/contracts';
import { createApiClient } from '../api/client';
import type { RegistrationWorkspace } from '../registration/shared';
import { EventStandingsPage } from './PrivatePages';
import { StandingsRulesForm } from './RulesForm';
import { deferred, overview, response } from './test-fixtures';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const context = (fetcher: typeof fetch): RegistrationWorkspace => ({
  client: createApiClient({ fetcher }),
  organizationId: 'org-a',
  userId: 'user-a',
  onSessionRefresh: async () => {},
});
function page(value: RegistrationWorkspace) {
  return (
    <MemoryRouter initialEntries={['/events/private-event-a/standings']}>
      <Routes>
        <Route path="/events/:eventId/standings" element={<EventStandingsPage context={value} />} />
      </Routes>
    </MemoryRouter>
  );
}
describe('declared standings rules and publication controls', () => {
  it('requires all three explicit point values, accepts zero, preserves declared tiebreaker order and cancels without writing', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<StandingsRulesForm data={{ ...overview, rules: null }} busy={false} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: '保存排名规则草稿' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('胜场积分');
    change('胜场积分', '0');
    change('负场积分', '0');
    change('平局积分', '0');
    change('添加同分判定', 'POINTS_FOR');
    expect(screen.getByLabelText('添加同分判定', { exact: true })).toHaveAccessibleName(
      '添加同分判定',
    );
    fireEvent.click(screen.getByRole('button', { name: '添加判定项' }));
    change('添加同分判定', 'SCORE_DIFFERENCE');
    fireEvent.click(screen.getByRole('button', { name: '添加判定项' }));
    fireEvent.click(screen.getByRole('button', { name: '上移净胜分' }));
    fireEvent.click(screen.getByRole('button', { name: '保存排名规则草稿' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        expectedEventVersion: 7,
        winPoints: 0,
        lossPoints: 0,
        drawPoints: 0,
        tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR'],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '取消规则修改' }));
    expect(screen.getByLabelText('胜场积分')).toHaveValue(null);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('empty tiebreakers stay empty instead of silently adding wins or another default', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <StandingsRulesForm
        data={{ ...overview, rules: { ...overview.rules!, tiebreakers: [] } }}
        busy={false}
        onSave={save}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '保存排名规则草稿' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ tiebreakers: [] })),
    );
    expect(screen.queryByRole('option', { name: '相互战绩' })).not.toBeInTheDocument();
  });
  it('publication is explicit, cancellation does not post, locked rules survive successful revoke with null standings', async () => {
    let current: EventStandingsData = structuredClone(overview);
    const writes: { path: string; body: Record<string, unknown> }[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (!init?.body) return response(current);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      writes.push({ path: String(path), body });
      if (body.type === 'PUBLISH_STANDINGS_RULES')
        current = {
          ...current,
          locked: true,
          event: { ...current.event, version: 8 },
          standings: { ...current.standings!, mode: 'PUBLISHED' },
          capabilities: {
            canManageRules: false,
            canPublishRules: false,
            canEnablePublicViewing: true,
            canDisablePublicViewing: false,
          },
        };
      else if (body.type === 'ENABLE')
        current = {
          ...current,
          event: { ...current.event, version: 9 },
          publication: {
            publicEventId: 'fresh-public-id',
            status: 'ACTIVE',
            createdAt: '2026-10-22T08:00:00Z',
            revokedAt: null,
          },
          capabilities: {
            ...current.capabilities,
            canEnablePublicViewing: false,
            canDisablePublicViewing: true,
          },
        };
      else
        current = {
          ...current,
          event: { ...current.event, version: 10 },
          standings: null,
          publication: {
            ...current.publication!,
            status: 'REVOKED',
            revokedAt: '2026-10-22T08:01:00Z',
          },
          capabilities: {
            ...current.capabilities,
            canEnablePublicViewing: true,
            canDisablePublicViewing: false,
          },
        };
      return response(current);
    });
    render(page(context(fetcher)));
    fireEvent.click(await screen.findByRole('button', { name: '发布排名规则' }));
    expect(writes).toHaveLength(0);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '发布排名规则' })).getByRole('button', {
        name: '取消',
      }),
    );
    expect(writes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '发布排名规则' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '发布排名规则' })).getByRole('button', {
        name: '正式发布排名规则',
      }),
    );
    expect(await screen.findByRole('heading', { name: '排名规则已正式发布并锁定' })).toBeVisible();
    expect(writes[0].body).toEqual({
      type: 'PUBLISH_STANDINGS_RULES',
      rulesetId: 'private-rules-a',
      expectedEventVersion: 7,
    });
    fireEvent.click(screen.getByRole('button', { name: '启用公开观赛' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '启用公开观赛' })).getByRole('button', {
        name: '确认启用公开观赛',
      }),
    );
    expect(await screen.findByRole('link', { name: '打开公开观赛' })).toHaveAttribute(
      'href',
      '/watch/fresh-public-id',
    );
    expect(writes[1].body).toEqual({ type: 'ENABLE', expectedEventVersion: 8 });
    fireEvent.click(screen.getByRole('button', { name: '撤销公开观赛' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '撤销公开观赛' })).getByRole('button', {
        name: '确认撤销公开观赛',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: '打开公开观赛' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: '排名规则已正式发布并锁定' })).toBeVisible();
    expect(screen.getByText(/规则仍已保存/)).toBeVisible();
    expect(writes[2].body).toEqual({ type: 'DISABLE', expectedEventVersion: 9 });
    expect(fetcher.mock.calls.filter(([, init]) => !init?.body)).toHaveLength(1);
  });
  it('version conflicts retain edited points and do not publish or fall back to demo data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_path, init) =>
        init?.method === 'PUT'
          ? response({ code: 'VERSION_CONFLICT', message: '规则版本已变化' }, {}, 409)
          : response(overview),
      );
    render(page(context(fetcher)));
    await screen.findByLabelText('胜场积分');
    change('胜场积分', '17');
    fireEvent.click(screen.getByRole('button', { name: '保存排名规则草稿' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('规则版本已变化');
    expect(screen.getByLabelText('胜场积分')).toHaveValue(17);
    expect(screen.getByRole('button', { name: '发布排名规则' })).toBeDisabled();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });
  it('server capabilities and team context do not infer management or make empty-org requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        ...overview,
        capabilities: {
          canManageRules: false,
          canPublishRules: false,
          canEnablePublicViewing: false,
          canDisablePublicViewing: false,
        },
      }),
    );
    const view = render(page(context(fetcher)));
    await screen.findByRole('heading', { name: '排名规则只读' });
    expect(screen.queryByRole('button', { name: '发布排名规则' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存排名规则草稿' })).not.toBeInTheDocument();
    view.unmount();
    fetcher.mockClear();
    render(
      page({
        ...context(fetcher),
        organizationId: undefined,
        teamContext: {
          orgId: 'org-a',
          organizationName: '机构',
          teamId: 'team-a',
          teamName: '本队',
        },
      }),
    );
    expect(screen.getByRole('heading', { name: '请切换到机构工作台' })).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('a late save after context unmount cannot replace the next organization page', async () => {
    const saved = deferred<Response>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path, init) =>
        init?.method === 'PUT'
          ? saved.promise
          : String(path).includes('/org-b/')
            ? response({ code: 'NOT_FOUND', message: '无此赛事' }, {}, 404)
            : response(overview),
      );
    const first = context(fetcher);
    const view = render(page(first));
    await screen.findByLabelText('胜场积分');
    change('胜场积分', '9');
    fireEvent.click(screen.getByRole('button', { name: '保存排名规则草稿' }));
    view.rerender(page({ ...first, organizationId: 'org-b' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无此赛事');
    await act(async () => {
      saved.resolve(
        response({ ...overview, event: { ...overview.event, name: '旧机构保存结果', version: 8 } }),
      );
    });
    expect(screen.queryByRole('heading', { name: '旧机构保存结果' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('胜场积分')).not.toBeInTheDocument();
  });
});
