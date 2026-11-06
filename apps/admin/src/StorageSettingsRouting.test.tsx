// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionData } from '@small-city-basketball/contracts';
import RuntimeApp from './RuntimeApp';
import { createApiClient } from './api/client';
import { storageSnapshot } from './storage-settings/test-fixtures';

const session = (operator: boolean, organizations = true): SessionData => ({
  user: { id: 'storage-routing-user', email: 'routing@example.test', displayName: '合成平台用户' },
  organizations: organizations ? [{ id: 'routing-org', name: '合成机构', role: 'ORG_OWNER' }] : [],
  teamContexts: [],
  ...(operator ? { platformOperator: true } : {}),
});
const ok = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { requestId: 'routing' } }), { status: 200 });
function clientFor(current: SessionData, storageStatus = 200) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (url === '/v1/auth/session') return ok(current);
    if (url === '/v1/platform/storage') {
      if (storageStatus !== 200)
        return new Response(
          JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: '请重新登录' } }),
          { status: storageStatus },
        );
      return ok(storageSnapshot({ version: 0, draft: null }));
    }
    return ok([]);
  });
  return { client: createApiClient({ fetcher }), fetcher };
}
beforeEach(() => {
  window.history.replaceState({}, '', '/system/storage');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('platform storage route and navigation', () => {
  it('shows the system settings menu and actual page to a platform operator with an organization', async () => {
    const { client, fetcher } = clientFor(session(true));
    render(<RuntimeApp mode="api" client={client} />);
    expect(await screen.findByRole('heading', { name: '对象存储' })).toBeVisible();
    expect(screen.getByRole('link', { name: '对象存储' })).toHaveAttribute(
      'href',
      '/system/storage',
    );
    expect(screen.getByText('系统设置', { exact: true })).toBeVisible();
    expect(fetcher.mock.calls.some(([path]) => path === '/v1/platform/storage')).toBe(true);
  });

  it('never treats the organization OWNER role as a platform storage grant', async () => {
    const { client, fetcher } = clientFor(session(false));
    render(<RuntimeApp mode="api" client={client} />);
    expect(await screen.findByRole('heading', { name: '当前身份不能管理对象存储' })).toBeVisible();
    expect(screen.queryByRole('link', { name: '对象存储' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/SecretKey/)).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([path]) => path === '/v1/platform/storage')).toBe(false);
  });

  it('allows an operator without any organization to open global settings and follows browser back', async () => {
    const { client } = clientFor(session(true, false));
    render(<RuntimeApp mode="api" client={client} />);
    expect(await screen.findByRole('heading', { name: '对象存储' })).toBeVisible();
    await act(async () => {
      window.history.replaceState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await screen.findByRole('heading', { name: '你的球队主场，从邀请开始' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '对象存储' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '对象存储设置' })).toHaveAttribute(
      'href',
      '/system/storage',
    );
  });

  it('clears the storage page and returns to authentication when its API session is revoked', async () => {
    const { client } = clientFor(session(true), 401);
    render(<RuntimeApp mode="api" client={client} />);
    expect(await screen.findByRole('button', { name: '登录工作台' })).toBeVisible();
    expect(screen.queryByLabelText(/SecretKey/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '对象存储' })).not.toBeInTheDocument();
  });

  it('keeps organization settings distinct from global object storage navigation', async () => {
    const { client } = clientFor(session(true));
    render(<RuntimeApp mode="api" client={client} />);
    await screen.findByRole('heading', { name: '对象存储' });
    const link = screen.getByRole('link', { name: '机构设置' });
    expect(link).toHaveAttribute('href', '/roadmap/settings');
    await userEvent.setup().click(link);
    expect(screen.queryByRole('heading', { name: '对象存储' })).not.toBeInTheDocument();
  });
});
