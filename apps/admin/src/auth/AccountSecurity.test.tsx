// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RuntimeApp from '../RuntimeApp';
import { createApiClient } from '../api/client';
import { AccountSecurityForm } from './AccountSecurityForm';

function response(data: unknown) {
  return new Response(JSON.stringify({ data, meta: { requestId: 'security-test' } }), {
    status: 200,
  });
}

const owner = {
  user: { id: 'synthetic-owner', email: 'owner@example.test', displayName: '测试负责人' },
  organizations: [{ id: 'synthetic-org', name: '测试机构', role: 'ORG_OWNER' }],
  teamContexts: [],
};

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fillSetup() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('机构名称'), '合成测试机构');
  await user.type(screen.getByLabelText('管理员邮箱'), 'owner@example.test');
  await user.type(screen.getByLabelText('显示名称'), '测试负责人');
  await user.type(screen.getByLabelText('密码', { exact: true }), 'synthetic-first-pass');
  await user.type(screen.getByLabelText('确认密码'), 'synthetic-first-pass');
  return user;
}

describe('first deployment setup page', () => {
  it('immediately removes fragment, survives StrictMode, sends only a POST body and forgets credentials after success', async () => {
    window.history.replaceState({}, '', `/setup#token=${'A'.repeat(43)}`);
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ created: true }));
    render(
      <StrictMode>
        <RuntimeApp mode="api" client={createApiClient({ fetcher })} />
      </StrictMode>,
    );
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('');
    expect(fetcher).not.toHaveBeenCalled();
    const user = await fillSetup();
    const password = screen.getByLabelText('密码', { exact: true });
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('管理员邮箱')).toHaveAttribute('autocomplete', 'username');
    await user.click(screen.getByRole('button', { name: '显示密码' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: '隐藏密码' }));
    await user.click(screen.getByRole('button', { name: '完成首次设置' }));
    expect(await screen.findByRole('heading', { name: '初始化完成' })).toBeVisible();
    expect(screen.getByRole('link', { name: '前往登录' })).toHaveAttribute('href', '/');
    expect(screen.queryByLabelText('密码', { exact: true })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [path, init] = fetcher.mock.calls[0]!;
    expect(path).toBe('/v1/setup/initialize');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin' });
    const body = JSON.parse(String(init?.body));
    expect(Object.keys(body).sort()).toEqual([
      'confirmPassword',
      'displayName',
      'email',
      'organizationName',
      'password',
      'token',
    ]);
    expect(body.organizationName).toBe('合成测试机构');
    expect(typeof body.token === 'string' && body.token.length === 43).toBe(true);
    expect(storage).not.toHaveBeenCalled();
  });

  it.each([
    '/setup',
    '/setup?token=not-accepted',
    '/setup#token=invalid',
    `/setup#token=${'A'.repeat(43)}&token=${'B'.repeat(43)}`,
  ])('requires a single valid fragment credential', (path) => {
    window.history.replaceState({}, '', path);
    const fetcher = vi.fn<typeof fetch>();
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('有效初始化链接');
    expect(screen.queryByRole('button', { name: '完成首次设置' })).not.toBeInTheDocument();
    expect(window.location.href.endsWith('/setup')).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates required fields and confirmation, locks duplicate submissions and preserves form on rejection', async () => {
    window.history.replaceState({}, '', `/setup#token=${'A'.repeat(43)}`);
    let resolve: (value: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    const button = screen.getByRole('button', { name: '完成首次设置' });
    fireEvent.click(button);
    expect(screen.getByText('机构名称需为1–80个字符')).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
    const user = await fillSetup();
    await user.clear(screen.getByLabelText('确认密码'));
    await user.type(screen.getByLabelText('确认密码'), 'different-test-pass');
    await user.click(button);
    expect(screen.getByText('两次输入的密码不一致')).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('确认密码'));
    await user.type(screen.getByLabelText('确认密码'), 'synthetic-first-pass');
    const form = button.closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () =>
      resolve(
        new Response(
          JSON.stringify({ error: { code: 'SETUP_INVALID', message: 'untrusted-secret-canary' } }),
          { status: 403 },
        ),
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('链接已失效');
    expect(screen.queryByText('untrusted-secret-canary')).not.toBeInTheDocument();
    expect(button).toBeEnabled();
    expect(screen.getByLabelText('机构名称')).toHaveValue('合成测试机构');
  });
});

describe('account security password change', () => {
  it('validates current password, no reuse and confirmation without making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const changed = vi.fn();
    render(
      <AccountSecurityForm
        client={createApiClient({ fetcher })}
        email="owner@example.test"
        onBusyChange={vi.fn()}
        onPasswordChanged={changed}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '修改密码并重新登录' }));
    expect(screen.getByText('请输入当前密码')).toBeVisible();
    await user.type(screen.getByLabelText('当前密码'), 'synthetic-old-pass');
    await user.type(screen.getByLabelText('新密码', { exact: true }), 'synthetic-old-pass');
    await user.type(screen.getByLabelText('确认新密码'), 'synthetic-old-pass');
    await user.click(screen.getByRole('button', { name: '修改密码并重新登录' }));
    expect(screen.getByText('新密码不能与当前密码相同')).toBeVisible();
    await user.clear(screen.getByLabelText('新密码', { exact: true }));
    await user.type(screen.getByLabelText('新密码', { exact: true }), 'synthetic-new-pass');
    await user.click(screen.getByRole('button', { name: '修改密码并重新登录' }));
    expect(screen.getByText('两次输入的新密码不一致')).toBeVisible();
    expect(screen.getByLabelText('当前密码')).toHaveAttribute('autocomplete', 'current-password');
    await user.click(screen.getByRole('button', { name: '显示当前密码' }));
    expect(screen.getByLabelText('当前密码')).toHaveAttribute('type', 'text');
    expect(fetcher).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it('locks duplicate submissions, keeps the session on failure and never renders arbitrary error details', async () => {
    let resolve: (value: Response) => void = () => {};
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const changed = vi.fn();
    render(
      <AccountSecurityForm
        client={createApiClient({ fetcher })}
        email="owner@example.test"
        onBusyChange={vi.fn()}
        onPasswordChanged={changed}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('当前密码'), 'synthetic-old-pass');
    await user.type(screen.getByLabelText('新密码', { exact: true }), 'synthetic-new-pass');
    await user.type(screen.getByLabelText('确认新密码'), 'synthetic-new-pass');
    const button = screen.getByRole('button', { name: '修改密码并重新登录' });
    fireEvent.submit(button.closest('form')!);
    fireEvent.submit(button.closest('form')!);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    const [path, init] = fetcher.mock.calls[0]!;
    expect(path).toBe('/v1/auth/change-password');
    expect(Object.keys(JSON.parse(String(init?.body))).sort()).toEqual([
      'confirmPassword',
      'currentPassword',
      'newPassword',
    ]);
    await act(async () =>
      resolve(
        new Response(
          JSON.stringify({
            error: { code: 'CURRENT_PASSWORD_INVALID', message: 'untrusted-secret-canary' },
          }),
          { status: 422 },
        ),
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('当前密码不正确');
    expect(screen.queryByText('untrusted-secret-canary')).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    expect(button).toBeEnabled();
  });

  it('opens within existing account settings and clears runtime authentication after success', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (path === '/v1/auth/session') return response(owner);
      if (path === '/v1/auth/change-password') return response({ changed: true });
      if (path === '/v1/auth/capabilities')
        return response({ canRegisterOrganization: false, canRegisterParticipant: false });
      return response([]);
    });
    render(<RuntimeApp mode="api" client={createApiClient({ fetcher })} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '个人 ID / 邀请' }));
    expect(screen.getByRole('heading', { name: '账号安全 → 修改密码' })).toBeVisible();
    await user.type(screen.getByLabelText('当前密码'), 'synthetic-old-pass');
    await user.type(screen.getByLabelText('新密码', { exact: true }), 'synthetic-new-pass');
    await user.type(screen.getByLabelText('确认新密码'), 'synthetic-new-pass');
    await user.click(screen.getByRole('button', { name: '修改密码并重新登录' }));
    expect(await screen.findByRole('heading', { name: '欢迎回到你的主场' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('所有旧会话已退出，请重新登录');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(fetcher.mock.calls.filter(([path]) => path === '/v1/auth/logout')).toHaveLength(0);
  });
});
