// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RuntimeApp from '../RuntimeApp';
import { createApiClient } from '../api/client';
const ok = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { requestId: 'auth-cap-test' } }));
const signedOut = () =>
  new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: '请登录' } }), {
    status: 401,
  });
const session = {
  user: { id: 'leader', email: 'leader@example.test', displayName: '当前用户' },
  organizations: [],
  teamContexts: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const entry = (fetcher: typeof fetch) => (
  <RuntimeApp mode="api" client={createApiClient({ fetcher })} />
);
const closed = { canRegisterOrganization: false, canRegisterParticipant: false };
const open = { canRegisterOrganization: true, canRegisterParticipant: true };
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const toggleNames = ['首次使用？创建机构账号', '球队领队？创建个人账号'] as const;
describe('independent signed-out registration capabilities', () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    'renders organization=%s / participant=%s independently',
    async (canRegisterOrganization, canRegisterParticipant) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async (path) =>
          path === '/v1/auth/session'
            ? signedOut()
            : ok({ canRegisterOrganization, canRegisterParticipant }),
        );
      render(entry(fetcher));
      await screen.findByRole('heading', { name: '欢迎回到你的主场' });
      await waitFor(() =>
        expect(screen.queryByText('正在读取注册开放状态…')).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('button', { name: '登录工作台' })).toBeEnabled();
      for (const [index, expected] of [canRegisterOrganization, canRegisterParticipant].entries()) {
        const button = screen.queryByRole('button', { name: toggleNames[index] });
        if (expected) expect(button).toBeVisible();
        else expect(button).not.toBeInTheDocument();
      }
      expect(fetcher.mock.calls.filter(([path]) => path === '/v1/auth/capabilities')).toHaveLength(
        1,
      );
    },
  );
  it('does not block login while capabilities are pending, and ignores their late response after login', async () => {
    const pending = deferred<Response>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        path === '/v1/auth/session'
          ? signedOut()
          : path === '/v1/auth/capabilities'
            ? pending.promise
            : path === '/v1/auth/login'
              ? ok(session)
              : ok([]),
      );
    render(entry(fetcher));
    expect(await screen.findByRole('button', { name: '登录工作台' })).toBeEnabled();
    expect(screen.getByText('正在读取注册开放状态…')).toBeVisible();
    expect(screen.queryByRole('button', { name: toggleNames[0] })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: session.user.email } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录工作台' }));
    expect(await screen.findByRole('heading', { name: '你的球队主场，从邀请开始' })).toBeVisible();
    await act(async () => pending.resolve(ok(open)));
    expect(screen.queryByRole('button', { name: toggleNames[0] })).not.toBeInTheDocument();
    expect(screen.queryByText('正在读取注册开放状态…')).not.toBeInTheDocument();
  });
  it('fails closed for an unavailable capability endpoint, keeps login enabled, and retries only that read', async () => {
    let attempts = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (path === '/v1/auth/session') return signedOut();
      if (path === '/v1/auth/capabilities') {
        if (++attempts === 1) throw new Error('offline');
        return ok({ canRegisterOrganization: false, canRegisterParticipant: true });
      }
      return ok(session);
    });
    render(entry(fetcher));
    expect(await screen.findByRole('alert')).toHaveTextContent('已有账号仍可登录');
    expect(screen.getByRole('button', { name: '登录工作台' })).toBeEnabled();
    for (const name of toggleNames)
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取注册状态' }));
    expect(await screen.findByRole('button', { name: toggleNames[1] })).toBeVisible();
    expect(screen.queryByRole('button', { name: toggleNames[0] })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([path]) => path === '/v1/auth/session')).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([path]) => path === '/v1/auth/capabilities')).toHaveLength(2);
  });
  it('does not grant registration for an incomplete success and still permits an actual login', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        path === '/v1/auth/session'
          ? signedOut()
          : path === '/v1/auth/capabilities'
            ? ok({ canRegisterOrganization: true })
            : ok(session),
      );
    render(entry(fetcher));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: toggleNames[0] })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: session.user.email } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录工作台' }));
    expect(await screen.findByRole('heading', { name: '你的球队主场，从邀请开始' })).toBeVisible();
    expect(fetcher.mock.calls.some(([path]) => String(path).includes('/register'))).toBe(false);
  });
  it('keeps closed participant registration clear in an invitation without consuming the invitation as registration', async () => {
    window.history.replaceState({}, '', '/#invitation=invite-a&token=invite-secret');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) => (path === '/v1/auth/session' ? signedOut() : ok(closed)));
    render(entry(fetcher));
    expect(await screen.findByText('本站暂未开放自助注册。已有账号可继续登录。')).toBeVisible();
    expect(screen.getByText(/本站当前未开放个人注册，请联系赛事主办方/)).toBeVisible();
    expect(window.location.hash).toBe('');
    expect(screen.getByRole('button', { name: '登录工作台' })).toBeEnabled();
    expect(
      fetcher.mock.calls.every(
        ([path]) => path === '/v1/auth/session' || path === '/v1/auth/capabilities',
      ),
    ).toBe(true);
  });
  it('ignores an aborted StrictMode capability read that resolves after the active closed result', async () => {
    const pending = deferred<Response>();
    let reads = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (path === '/v1/auth/session') return signedOut();
      if (path === '/v1/auth/capabilities') return ++reads === 1 ? pending.promise : ok(closed);
      return ok([]);
    });
    render(<StrictMode>{entry(fetcher)}</StrictMode>);
    expect(await screen.findByText('本站暂未开放自助注册。已有账号可继续登录。')).toBeVisible();
    await act(async () => pending.resolve(ok(open)));
    for (const name of toggleNames)
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });
  it('re-reads capabilities after logout instead of retaining previously open registration', async () => {
    let reads = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (path === '/v1/auth/session') return signedOut();
      if (path === '/v1/auth/capabilities') return ok(++reads === 1 ? open : closed);
      if (path === '/v1/auth/logout') return ok(null);
      return ok(session);
    });
    render(entry(fetcher));
    await screen.findByRole('button', { name: toggleNames[0] });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: session.user.email } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录工作台' }));
    fireEvent.click(await screen.findByRole('button', { name: '退出' }));
    expect(await screen.findByText('本站暂未开放自助注册。已有账号可继续登录。')).toBeVisible();
    for (const name of toggleNames)
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(reads).toBe(2);
    expect(screen.getByRole('button', { name: '登录工作台' })).toBeEnabled();
  });
  it('does not initialize auth capabilities for an existing session', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) => (path === '/v1/auth/session' ? ok(session) : ok([])));
    render(entry(fetcher));
    expect(await screen.findByRole('heading', { name: '你的球队主场，从邀请开始' })).toBeVisible();
    expect(fetcher.mock.calls.some(([path]) => path === '/v1/auth/capabilities')).toBe(false);
  });
});
