// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { EntryData, EventRegistrationData, TeamData } from '@small-city-basketball/contracts';
import { createApiClient } from '../api/client';
import type { RegistrationWorkspace } from './shared';
import { TeamDetailPage, TeamsPage } from './TeamsPages';
import { EntryDetailPage } from './EntryPages';
import { EventRegistrationPage } from './StaffPages';

const event = {
  id: 'event-a',
  name: '城市联赛',
  startDate: '2026-12-01',
  endDate: '2026-12-03',
  timezone: 'Asia/Shanghai',
  venueName: null,
  format: 'ROUND_ROBIN' as const,
  status: 'DRAFT' as const,
  version: 3,
  createdAt: '2026-10-22T00:00:00Z',
  updatedAt: '2026-10-22T00:00:00Z',
};
const rules = {
  id: 'rule-a',
  eventId: event.id,
  version: 1,
  minPlayers: 2,
  maxPlayers: 12,
  zeroAndDoubleZeroDistinct: false,
  requireIdentity: false,
  requireInsurance: false,
  createdAt: event.createdAt,
};
const team: TeamData = {
  id: 'team-a',
  orgId: 'org-a',
  name: '青峰队',
  version: 2,
  members: [
    { id: 'member-a', name: '张明' },
    { id: 'member-b', name: '李青' },
  ],
  grants: [],
  createdAt: event.createdAt,
  updatedAt: event.updatedAt,
  capabilities: { canManage: true, canInvite: true },
};
const entry: EntryData = {
  id: 'entry-a',
  orgId: 'org-a',
  eventId: event.id,
  teamId: team.id,
  teamName: team.name,
  status: 'DRAFT',
  version: 4,
  rosterRevisionId: null,
  lastSubmittedBy: null,
  latestReviewReason: null,
  rules,
  players: [],
  history: [],
  createdAt: event.createdAt,
  updatedAt: event.updatedAt,
  capabilities: {
    canEditRoster: true,
    canSubmit: false,
    canWithdraw: true,
    canReview: false,
    canApprove: false,
    canRequestChanges: false,
    canReject: false,
  },
};
const registration: EventRegistrationData = {
  event,
  rules,
  freeze: null,
  counts: { DRAFT: 1, SUBMITTED: 0, APPROVED: 2, CHANGES_REQUESTED: 0, REJECTED: 1, WITHDRAWN: 1 },
  capabilities: { canManageRules: true, canOpen: true, canClose: false, canFreeze: false },
};
const response = (data: unknown, status = 200, meta = {}) =>
  new Response(
    JSON.stringify(status < 400 ? { data, meta: { requestId: 'test', ...meta } } : { error: data }),
    { status },
  );
function workspace(fetcher: typeof fetch): RegistrationWorkspace {
  return {
    client: createApiClient({ fetcher }),
    organizationId: 'org-a',
    userId: 'user-owner',
    onSessionRefresh: async () => {},
  };
}
function entryPage(context: RegistrationWorkspace) {
  return render(
    <MemoryRouter initialEntries={['/entries/entry-a']}>
      <Routes>
        <Route path="/entries/:entryId" element={<EntryDetailPage context={context} />} />
      </Routes>
    </MemoryRouter>,
  );
}
function staffPage(context: RegistrationWorkspace) {
  return render(
    <MemoryRouter initialEntries={['/events/event-a/registration']}>
      <Routes>
        <Route
          path="/events/:eventId/registration"
          element={<EventRegistrationPage context={context} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}
afterEach(cleanup);

describe('球队与报名真实接口界面', () => {
  it('空列表按服务端能力显示创建，取消不提交', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([], 200, { capabilities: { canCreateTeam: true } }));
    render(
      <MemoryRouter>
        <TeamsPage context={workspace(fetcher)} />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '创建球队' }));
    await user.type(screen.getByLabelText('球队名称'), '新球队');
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('button', { name: '保存球队' })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    cleanup();
    render(
      <MemoryRouter>
        <TeamsPage
          context={workspace(
            vi
              .fn<typeof fetch>()
              .mockResolvedValue(response([], 200, { capabilities: { canCreateTeam: false } })),
          )}
        />
      </MemoryRouter>,
    );
    await screen.findByText('还没有球队');
    expect(screen.queryByRole('button', { name: '创建球队' })).not.toBeInTheDocument();
  });

  it('同号规则阻止0/00重复且保留输入，切换为不同号时按字符串保存版本', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) =>
      String(path).endsWith('/teams/team-a')
        ? response(team)
        : init?.method === 'PUT'
          ? response({
              ...entry,
              version: 5,
              players: [
                { memberId: 'member-a', name: '张明', jerseyNo: '0' },
                { memberId: 'member-b', name: '李青', jerseyNo: '00' },
              ],
              rosterRevisionId: 'revision-new',
            })
          : response(entry),
    );
    entryPage(workspace(fetcher));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: '选择张明（成员1）' }));
    await user.type(screen.getByLabelText('球衣号码（张明，成员1）'), '0');
    await user.click(screen.getByRole('checkbox', { name: '选择李青（成员2）' }));
    await user.type(screen.getByLabelText('球衣号码（李青，成员2）'), '00');
    await user.click(screen.getByRole('button', { name: '保存名单' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('0与00视为同一号码');
    expect(screen.getByLabelText('球衣号码（李青，成员2）')).toHaveValue('00');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    cleanup();
    const distinct = { ...entry, rules: { ...rules, zeroAndDoubleZeroDistinct: true } };
    const valid = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path, init) =>
        String(path).endsWith('/teams/team-a')
          ? response(team)
          : init?.method === 'PUT'
            ? response({ ...distinct, version: 5 })
            : response(distinct),
      );
    entryPage(workspace(valid));
    await user.click(await screen.findByRole('checkbox', { name: '选择张明（成员1）' }));
    await user.type(screen.getByLabelText('球衣号码（张明，成员1）'), '0');
    await user.click(screen.getByRole('checkbox', { name: '选择李青（成员2）' }));
    await user.type(screen.getByLabelText('球衣号码（李青，成员2）'), '00');
    await user.click(screen.getByRole('button', { name: '保存名单' }));
    await waitFor(() =>
      expect(valid.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    const [, write] = valid.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(write?.body))).toEqual({
      expectedVersion: 4,
      players: [
        { memberId: 'member-a', jerseyNo: '0' },
        { memberId: 'member-b', jerseyNo: '00' },
      ],
    });
  });

  it('409保留名单输入，重新读取必须由用户明确触发', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path, init) =>
        init?.method === 'PUT'
          ? response({ code: 'VERSION_CONFLICT', message: '其他领队已更新名单' }, 409)
          : String(path).endsWith('/teams/team-a')
            ? response(team)
            : response(entry),
      );
    entryPage(workspace(fetcher));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: '选择张明（成员1）' }));
    await user.type(screen.getByLabelText('球衣号码（张明，成员1）'), '12');
    await user.click(screen.getByRole('button', { name: '保存名单' }));
    await screen.findByText('资料版本已变化');
    expect(screen.getByLabelText('球衣号码（张明，成员1）')).toHaveValue('12');
    expect(fetcher).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole('button', { name: '重新读取最新资料' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5));
    expect(await screen.findByLabelText('球衣号码（张明，成员1）')).toHaveValue('');
  });

  it('即使是负责人上下文也不猜审核权限，且不在页面展示内部版本UUID', async () => {
    const readonly = {
      ...entry,
      status: 'SUBMITTED',
      players: [{ memberId: 'member-a', name: '张明', jerseyNo: '9' }],
      rosterRevisionId: 'private-roster-guid',
      capabilities: { ...entry.capabilities, canEditRoster: false, canWithdraw: false },
    };
    entryPage(workspace(vi.fn<typeof fetch>().mockResolvedValue(response(readonly))));
    await screen.findByText('已保存的本届名单');
    expect(screen.queryByRole('button', { name: '审核通过' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '退回修改' })).not.toBeInTheDocument();
    expect(screen.queryByText('private-roster-guid')).not.toBeInTheDocument();
    expect(screen.getByText(/机构负责人也不例外/)).toBeInTheDocument();
  });

  it('独立审核退回必须填写原因，取消不写入，提交附带版本', async () => {
    const review = {
      ...entry,
      status: 'SUBMITTED',
      capabilities: {
        ...entry.capabilities,
        canEditRoster: false,
        canWithdraw: false,
        canReview: true,
        canApprove: true,
        canRequestChanges: true,
        canReject: true,
      },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(review));
    entryPage(workspace(fetcher));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '退回修改' }));
    await user.click(screen.getByRole('button', { name: '确认退回修改' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('原因需为1–500');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '退回修改' }));
    await user.type(screen.getByLabelText('审核原因'), '  请核对号码  ');
    await user.click(screen.getByRole('button', { name: '确认退回修改' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );
    const [, init] = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(init?.body))).toEqual({
      type: 'REQUEST_CHANGES',
      expectedVersion: 4,
      reason: '请核对号码',
    });
  });

  it('规则未接入条件明确提示，保存只发真实规则，不自动开放', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        String(path).includes('/entries?') ? response([]) : response(registration),
      );
    staffPage(workspace(fetcher));
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText(/要求身份核验/));
    expect(screen.getByText(/此规则可以保存，但不能开放报名/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开放报名' })).toBeDisabled();
    expect(screen.getByText(/有未保存修改，请先保存/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存报名规则' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    const [, init] = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      expectedVersion: 3,
      requireIdentity: true,
      requireInsurance: false,
    });
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('冻结前显示排除待提交数，取消不会冻结', async () => {
    const freezeable = {
      ...registration,
      event: { ...event, status: 'REGISTRATION_CLOSED' },
      capabilities: { canManageRules: false, canOpen: false, canClose: false, canFreeze: true },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        String(path).includes('/entries?') ? response([]) : response(freezeable),
      );
    staffPage(workspace(fetcher));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '冻结参赛名单' }));
    expect(screen.getByText(/排除3支非通过报名/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await user.click(screen.getByRole('button', { name: '冻结参赛名单' }));
    await user.click(screen.getByRole('button', { name: '确认冻结' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );
    const [, init] = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(init?.body))).toEqual({
      type: 'FREEZE_REGISTRATION',
      expectedVersion: 3,
    });
  });
  it('球队上下文与详情不匹配时不读取另一球队资料', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const context = {
      ...workspace(fetcher),
      organizationId: undefined,
      teamContext: {
        orgId: 'org-a',
        organizationName: '机构',
        teamId: 'team-b',
        teamName: '另一队',
      },
    };
    render(
      <MemoryRouter initialEntries={['/teams/team-a']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetailPage context={context} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('此页面不属于当前选择的球队');
    expect(fetcher).not.toHaveBeenCalled();
    cleanup();
    const entryFetch = vi.fn<typeof fetch>().mockResolvedValue(response(entry));
    entryPage({ ...context, client: createApiClient({ fetcher: entryFetch }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('此报名不属于当前选择的球队');
    expect(screen.queryByText('已保存的本届名单')).not.toBeInTheDocument();
    expect(entryFetch).toHaveBeenCalledTimes(1);
  });

  it('创建请求晚返回不会将已切换的工作空间导航到旧球队', async () => {
    let finish: (value: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) =>
      init?.method === 'POST'
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : response([], 200, { capabilities: { canCreateTeam: true } }),
    );
    const context = workspace(fetcher);
    function Location() {
      return <output>{useLocation().pathname}</output>;
    }
    function Harness({ active }: { active: boolean }) {
      return (
        <MemoryRouter initialEntries={['/teams']}>
          <Location />
          <Routes>
            <Route
              path="/teams"
              element={active ? <TeamsPage context={context} /> : <h1>新工作空间</h1>}
            />
            <Route path="/teams/:teamId" element={<h1>旧请求错误导航</h1>} />
          </Routes>
        </MemoryRouter>
      );
    }
    const view = render(<Harness active />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '创建球队' }));
    await user.type(screen.getByLabelText('球队名称'), '青峰队');
    await user.click(screen.getByRole('button', { name: '保存球队' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
    );
    view.rerender(<Harness active={false} />);
    await act(async () => {
      finish(response(team));
    });
    expect(screen.getByRole('heading', { name: '新工作空间' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('/teams');
    expect(screen.queryByText('旧请求错误导航')).not.toBeInTheDocument();
  });
});
