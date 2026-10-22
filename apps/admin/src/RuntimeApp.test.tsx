// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionData } from '@small-city-basketball/contracts';
import RuntimeApp from './RuntimeApp';
import { createApiClient } from './api/client';

const session: SessionData = {
  user: { id: 'user-a', email: 'owner@example.test', displayName: '机构负责人' },
  organizations: [
    { id: 'org-a', name: '真实机构甲', role: 'ORG_OWNER' },
    { id: 'org-b', name: '真实机构乙', role: 'REVIEWER' },
  ],
  teamContexts: [],
};
const event = (name: string, canEditDraft = true) => ({
  id: name,
  name,
  startDate: '2026-11-01',
  endDate: '2026-11-03',
  timezone: 'Asia/Shanghai',
  venueName: null,
  format: 'ROUND_ROBIN',
  status: 'DRAFT',
  version: 1,
  createdAt: '2026-10-22T00:00:00Z',
  updatedAt: '2026-10-22T00:00:00Z',
  permissions: { canEditDraft },
});
function ok(data: unknown) {
  return new Response(JSON.stringify({ data, meta: { requestId: 'test', nextCursor: null } }), {
    status: 200,
  });
}
function failed(status: number, message: string) {
  return new Response(
    JSON.stringify({
      error: { code: status === 401 ? 'UNAUTHENTICATED' : 'SERVICE_ERROR', message },
    }),
    { status },
  );
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  window.history.replaceState({}, '', '/events');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('API模式登录与机构边界', () => {
  it('登录失败显示错误且不渲染Mock，成功后显示真实机构与资料', async () => {
    let attempts = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (url === '/v1/auth/session') return failed(401, '未登录');
      if (url === '/v1/auth/login')
        return ++attempts === 1 ? failed(401, '邮箱或密码错误') : ok(session);
      return ok([event('机构甲赛事')]);
    });
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: '欢迎回到你的主场' })).toBeVisible();
    expect(screen.queryByText('青锋杯篮球邀请赛')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('邮箱'), session.user.email);
    await user.type(screen.getByLabelText('密码'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: '登录工作台' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码错误');
    expect(screen.queryByText('2026 秋季城市联赛')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('密码'));
    await user.type(screen.getByLabelText('密码'), 'correct-password');
    await user.click(screen.getByRole('button', { name: '登录工作台' }));
    expect(await screen.findByRole('link', { name: '机构甲赛事' })).toBeVisible();
    expect(screen.getByLabelText('切换机构')).toHaveValue('org-a');
    expect(screen.getByText('业务服务 · 数据持久保存')).toBeVisible();
    expect(screen.queryByText('演示模式 · Mock 数据')).not.toBeInTheDocument();
  });

  it('切换机构清除旧列表和写入口，不能把旧机构数据留在新机构', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        url === '/v1/auth/session'
          ? ok(session)
          : String(url).includes('/org-b/')
            ? ok([event('机构乙只读赛事', false)])
            : ok([event('机构甲赛事')]),
      );
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    expect(await screen.findByRole('link', { name: '机构甲赛事' })).toBeVisible();
    expect(screen.getByRole('link', { name: '创建赛事' })).toBeVisible();
    await userEvent.setup().selectOptions(screen.getByLabelText('切换机构'), 'org-b');
    expect(await screen.findByRole('link', { name: '机构乙只读赛事' })).toBeVisible();
    expect(screen.queryByRole('link', { name: '机构甲赛事' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '创建赛事' })).not.toBeInTheDocument();
  });

  it('EVENT_MANAGER不凭全局角色显示草稿编辑，直接创建路由也受控', async () => {
    const manager = {
      ...session,
      organizations: [{ id: 'org-a', name: '赛事机构', role: 'EVENT_MANAGER' }],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        url === '/v1/auth/session' ? ok(manager) : ok(event('未获编辑授权的草稿', false)),
      );
    window.history.replaceState({}, '', '/events/private-draft');
    const first = render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    expect(await screen.findByRole('heading', { name: '未获编辑授权的草稿' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '编辑草稿' })).not.toBeInTheDocument();
    expect(screen.getByText('当前身份仅可查看此赛事，没有编辑草稿的权限。')).toBeVisible();
    first.unmount();
    window.history.replaceState({}, '', '/events/new');
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    expect(await screen.findByRole('heading', { name: '当前身份不能创建赛事' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
  });

  it('业务请求401回登录，服务不可达显示重试而不回退Mock', async () => {
    const unauthorized = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        url === '/v1/auth/session' ? ok(session) : failed(401, '会话已失效'),
      );
    const first = render(
      <RuntimeApp mode="api" client={createApiClient({ fetcher: unauthorized })} />,
    );
    expect(await screen.findByRole('heading', { name: '欢迎回到你的主场' })).toBeVisible();
    expect(screen.queryByText('2026 秋季城市联赛')).not.toBeInTheDocument();
    first.unmount();
    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher: unavailable })} />);
    expect(await screen.findByRole('heading', { name: '暂时无法连接工作台' })).toBeVisible();
    expect(screen.getByText('请恢复连接后重试，当前未载入赛事数据。')).toBeVisible();
    expect(screen.queryByText('青锋杯篮球邀请赛')).not.toBeInTheDocument();
  });

  it('注册校验密码并只发送账户字段，不写浏览器token；退出后回到登录', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        url === '/v1/auth/session'
          ? failed(401, '未登录')
          : url === '/v1/auth/register'
            ? ok(session)
            : url === '/v1/auth/logout'
              ? ok(null)
              : ok([]),
      );
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '首次使用？创建机构账号' }));
    await user.type(screen.getByLabelText('邮箱'), 'new@example.test');
    await user.type(screen.getByLabelText('密码'), 'short');
    await user.type(screen.getByLabelText('称呼'), '新用户');
    await user.type(screen.getByLabelText('机构名称'), '新机构');
    await user.click(screen.getByRole('button', { name: '创建账号并进入' }));
    expect(screen.getByText('密码需为12–128个字符')).toBeVisible();
    expect(fetcher.mock.calls.some(([url]) => url === '/v1/auth/register')).toBe(false);
    await user.clear(screen.getByLabelText('密码'));
    await user.type(screen.getByLabelText('密码'), 'strong-test-password');
    await user.click(screen.getByRole('button', { name: '创建账号并进入' }));
    expect(await screen.findByRole('button', { name: '退出' })).toBeVisible();
    const call = fetcher.mock.calls.find(([url]) => url === '/v1/auth/register')!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      email: 'new@example.test',
      password: 'strong-test-password',
      displayName: '新用户',
      organizationName: '新机构',
    });
    expect(setItem).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '退出' }));
    expect(await screen.findByRole('heading', { name: '欢迎回到你的主场' })).toBeVisible();
  });

  it('严格模式中过期的启动检查401不会清掉刚登录的新身份', async () => {
    let release!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let checks = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (url === '/v1/auth/session') return ++checks === 1 ? first : failed(401, '未登录');
      if (url === '/v1/auth/login') return ok(session);
      return ok([event('新身份的赛事')]);
    });
    vi.stubGlobal('fetch', fetcher);
    render(
      <StrictMode>
        <RuntimeApp mode="api" />
      </StrictMode>,
    );
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: '欢迎回到你的主场' })).toBeVisible();
    await user.type(screen.getByLabelText('邮箱'), session.user.email);
    await user.type(screen.getByLabelText('密码'), 'correct-password');
    await user.click(screen.getByRole('button', { name: '登录工作台' }));
    expect(await screen.findByRole('link', { name: '新身份的赛事' })).toBeVisible();
    await act(async () => {
      release(failed(401, '旧检查未登录'));
      await first;
    });
    expect(screen.getByRole('link', { name: '新身份的赛事' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '欢迎回到你的主场' })).not.toBeInTheDocument();
  });

  it('只读角色的总览快捷卡和空列表均不会暴露创建入口', async () => {
    const reader = {
      ...session,
      organizations: [{ id: 'org-a', name: '只读机构', role: 'REVIEWER' }],
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) => (url === '/v1/auth/session' ? ok(reader) : ok([])));
    window.history.replaceState({}, '', '/');
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    expect(await screen.findByRole('heading', { name: /欢迎回来，只读机构/ })).toBeVisible();
    expect(await screen.findByText('当前没有可见赛事')).toBeVisible();
    expect(screen.queryByRole('link', { name: '创建一届赛事' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '创建赛事' })).not.toBeInTheDocument();
    expect(screen.getByText('当前角色不可创建赛事；仅能编辑明确授权的草稿。')).toBeVisible();
  });

  it('无效模式明确失败，不静默回退演示', () => {
    render(<RuntimeApp mode="typo" />);
    expect(screen.getByRole('heading', { name: '数据模式配置无效' })).toBeVisible();
    expect(screen.queryByText('演示模式 · Mock 数据')).not.toBeInTheDocument();
  });
});

describe('领队个人账号与绑定邀请', () => {
  const participant: SessionData = {
    user: { id: 'leader-user-a', email: 'leader@example.test', displayName: '城市队领队' },
    organizations: [],
    teamContexts: [],
  };

  it('机构成员可切到独立球队上下文，旧机构赛事不留在领队页面', async () => {
    const dualSession: SessionData = {
      ...session,
      teamContexts: [
        {
          orgId: 'org-c',
          organizationName: '球队所属机构',
          teamId: 'team-c',
          teamName: '我的授权队',
        },
      ],
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (url === '/v1/auth/session') return ok(dualSession);
      if (url === '/v1/orgs/org-c/teams/team-c')
        return ok({
          id: 'team-c',
          orgId: 'org-c',
          name: '我的授权队',
          version: 1,
          members: [],
          grants: [],
          createdAt: '2026-10-22T00:00:00Z',
          updatedAt: '2026-10-22T00:00:00Z',
          capabilities: { canManage: false, canInvite: false },
        });
      if (String(url).includes('/registration-events?')) return ok([]);
      return ok([event('机构甲赛事')]);
    });
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    expect(await screen.findByRole('link', { name: '机构甲赛事' })).toBeVisible();
    await userEvent.setup().selectOptions(screen.getByLabelText('工作空间'), 'team');
    expect(await screen.findByRole('heading', { name: '当前暂无可报名赛事' })).toBeVisible();
    expect(screen.getByLabelText('切换球队')).toHaveValue('team-c');
    expect(screen.queryByRole('link', { name: '机构甲赛事' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '创建赛事' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => url === '/v1/orgs/org-c/teams/team-c')).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/org-c/events?'))).toBe(false);
  });

  it('直接刷新保留本队详情，显式切换同机构球队则回主场并清掉前队数据', async () => {
    window.history.replaceState({ usr: { from: 'detail' } }, '', '/teams/team-a');
    const teamsSession: SessionData = {
      ...participant,
      teamContexts: [
        { orgId: 'org-a', organizationName: '同一机构', teamId: 'team-a', teamName: '甲队' },
        { orgId: 'org-a', organizationName: '同一机构', teamId: 'team-b', teamName: '乙队' },
      ],
    };
    const teamData = (id: string, name: string) => ({
      id,
      orgId: 'org-a',
      name,
      version: 1,
      members: [{ id: `${id}-member`, name: `${name}专属球员` }],
      grants: [],
      createdAt: '2026-10-22T00:00:00Z',
      updatedAt: '2026-10-22T00:00:00Z',
      capabilities: { canManage: false, canInvite: false },
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (url === '/v1/auth/session') return ok(teamsSession);
      if (url === '/v1/orgs/org-a/teams/team-a') return ok(teamData('team-a', '甲队'));
      if (url === '/v1/orgs/org-a/teams/team-b') return ok(teamData('team-b', '乙队'));
      if (String(url).includes('/registration-events?')) return ok([]);
      return failed(404, '未知资料');
    });
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    expect(await screen.findByRole('heading', { name: '甲队', level: 1 })).toBeVisible();
    expect(screen.getByDisplayValue('甲队专属球员')).toBeVisible();
    expect(window.location.pathname).toBe('/teams/team-a');
    const callsBeforeSwitch = fetcher.mock.calls.length;
    await userEvent.setup().selectOptions(screen.getByLabelText('切换球队'), 'team-b');
    expect(await screen.findByRole('heading', { name: '当前暂无可报名赛事' })).toBeVisible();
    expect(window.location.pathname).toBe('/my-team');
    expect(window.history.state.usr).toEqual({ from: 'detail' });
    expect(screen.getByLabelText('切换球队')).toHaveValue('team-b');
    expect(screen.queryByRole('heading', { name: '甲队', level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('甲队专属球员')).not.toBeInTheDocument();
    expect(
      fetcher.mock.calls
        .slice(callsBeforeSwitch)
        .some(([url]) => url === '/v1/orgs/org-a/teams/team-a'),
    ).toBe(false);
  });

  it('外部领队可以注册个人账号，不发送机构字段，并能看到本人ID', async () => {
    const store = vi.spyOn(Storage.prototype, 'setItem');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        url === '/v1/auth/session' ? failed(401, '未登录') : ok(participant),
      );
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '球队领队？创建个人账号' }));
    expect(screen.getByRole('heading', { name: '创建领队账号' })).toBeVisible();
    expect(screen.queryByLabelText('机构名称')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('邮箱'), participant.user.email);
    await user.type(screen.getByLabelText('密码'), 'strong-test-password');
    await user.type(screen.getByLabelText('称呼'), participant.user.displayName);
    await user.click(screen.getByRole('button', { name: '创建账号并进入' }));
    expect(await screen.findByRole('heading', { name: '你的球队主场，从邀请开始' })).toBeVisible();
    expect(screen.getByLabelText('我的个人 ID')).toHaveValue(participant.user.id);
    const call = fetcher.mock.calls.find(([url]) => url === '/v1/auth/register-participant');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      email: participant.user.email,
      password: 'strong-test-password',
      displayName: participant.user.displayName,
    });
    expect(store).not.toHaveBeenCalled();
    expect(screen.queryByText('演示模式 · Mock 数据')).not.toBeInTheDocument();
  });

  it('已登录页面收到邀请hashchange时立即清片段并打开填写正确凭据的对话框', async () => {
    const store = vi.spyOn(Storage.prototype, 'setItem');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(ok(participant));
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    await screen.findByRole('heading', { name: '你的球队主场，从邀请开始' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => {
      window.history.replaceState({ usr: { retained: true } }, '', '/?source=share#section');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(window.location.hash).toBe('#section');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => {
      window.history.replaceState(
        window.history.state,
        '',
        '/?source=share#invitation=invite-live&token=live-secret',
      );
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      expect(window.location.hash).toBe('');
    });
    expect(screen.getByRole('dialog', { name: '个人账号与球队邀请' })).toBeVisible();
    expect(screen.getByLabelText('邀请 ID')).toHaveValue('invite-live');
    expect(screen.getByLabelText('邀请令牌')).toHaveValue('live-secret');
    expect(window.location.search).toBe('?source=share');
    expect(window.history.state.usr).toEqual({ retained: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store).not.toHaveBeenCalled();
    act(() => {
      window.history.replaceState(
        window.history.state,
        '',
        '/?source=share#invitation=invite-next&token=next-secret',
      );
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(window.location.hash).toBe('');
    expect(screen.getByLabelText('邀请 ID')).toHaveValue('invite-next');
    expect(screen.getByLabelText('邀请令牌')).toHaveValue('next-secret');
  });

  it('邀请片段在登录前移除，只在当前内存保留；登录后以绑定账号接受并刷新会话', async () => {
    const store = vi.spyOn(Storage.prototype, 'setItem');
    window.history.replaceState({}, '', '/events#invitation=invite-a&token=one-time-secret');
    let sessionReads = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (url === '/v1/auth/session')
        return ++sessionReads === 1 ? failed(401, '未登录') : ok(participant);
      if (url === '/v1/auth/login') return ok(participant);
      if (url === '/v1/invitations/invite-a/accept')
        return ok({
          orgId: 'org-a',
          organizationName: '机构',
          teamId: 'team-a',
          teamName: '城市队',
        });
      return ok([]);
    });
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    expect(window.location.hash).toBe('');
    expect(await screen.findByText(/已读取球队邀请/)).toBeVisible();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('邮箱'), participant.user.email);
    await user.type(screen.getByLabelText('密码'), 'strong-test-password');
    await user.click(screen.getByRole('button', { name: '登录工作台' }));
    expect(await screen.findByRole('dialog', { name: '个人账号与球队邀请' })).toBeVisible();
    expect(screen.getByLabelText('邀请 ID')).toHaveValue('invite-a');
    expect(screen.getByLabelText('邀请令牌')).toHaveValue('one-time-secret');
    await user.click(screen.getByRole('button', { name: '接受球队邀请' }));
    expect(
      await screen.findByText('邀请已接受，球队授权已刷新。请选择“我的球队”开始报名。'),
    ).toBeVisible();
    expect(screen.queryByLabelText('邀请令牌')).not.toBeInTheDocument();
    const call = fetcher.mock.calls.find(([url]) => url === '/v1/invitations/invite-a/accept');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ token: 'one-time-secret' });
    expect(sessionReads).toBe(2);
    expect(store).not.toHaveBeenCalled();
  });

  it('邀请冒领失败保留输入；对话框聚焦关闭按钮并支持Escape返回', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        url === '/v1/auth/session' ? ok(participant) : failed(403, '仅被邀请的账号可以接受'),
      );
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '个人 ID / 邀请' }));
    expect(screen.getByRole('button', { name: '关闭个人账号' })).toHaveFocus();
    await user.type(screen.getByLabelText('邀请 ID'), 'invite-other');
    await user.type(screen.getByLabelText('邀请令牌'), 'other-token');
    await user.click(screen.getByRole('button', { name: '接受球队邀请' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('仅被邀请的账号可以接受');
    expect(screen.getByLabelText('邀请令牌')).toHaveValue('other-token');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '个人 ID / 邀请' })).toHaveFocus();
  });

  it('邀请消费后刷新失败只重试读取授权，不重复消费令牌', async () => {
    let reads = 0;
    let accepts = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (url === '/v1/auth/session')
        return ++reads === 2 ? failed(503, '授权暂时无法读取') : ok(participant);
      if (String(url).endsWith('/accept')) {
        accepts += 1;
        return ok({
          orgId: 'org-a',
          organizationName: '机构',
          teamId: 'team-a',
          teamName: '城市队',
        });
      }
      return ok([]);
    });
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '个人 ID / 邀请' }));
    await user.type(screen.getByLabelText('邀请 ID'), 'invite-a');
    await user.type(screen.getByLabelText('邀请令牌'), 'once-token');
    await user.click(screen.getByRole('button', { name: '接受球队邀请' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('邀请已接受，刷新授权失败');
    expect(screen.queryByRole('button', { name: '接受球队邀请' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '刷新球队授权' }));
    expect(await screen.findByText('授权已刷新，可切换到“我的球队”。')).toBeVisible();
    expect(accepts).toBe(1);
    expect(reads).toBe(3);
  });
});
