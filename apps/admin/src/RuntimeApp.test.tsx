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
