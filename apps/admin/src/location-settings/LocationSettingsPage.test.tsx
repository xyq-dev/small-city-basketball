// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { LocationSettingsPage } from './LocationSettingsPage';

afterEach(() => {
  cleanup();
  localStorage.clear();
});
type Handler = (path: string, init?: RequestInit) => unknown;
function clientFor(handler: Handler) {
  const request = vi.fn(async (path: string, init?: RequestInit) => ({
    data: handler(path, init),
    meta: { requestId: 'http-synthetic' },
  }));
  return { client: { request: request as ApiClient['request'] }, request };
}
const snapshot = {
  canManage: true,
  keyConfigured: true,
  version: 0,
  draft: null,
  active: {
    provider: 'TENCENT',
    source: 'ENVIRONMENT',
    version: null,
    applied: false,
    status: 'UNCONFIGURED',
  },
  test: null,
};
const body = (init?: RequestInit) => JSON.parse(String(init?.body)) as Record<string, unknown>;

it('hides the form from an organization administrator', () => {
  const { client, request } = clientFor(() => snapshot);
  render(<LocationSettingsPage client={client} userId="org-owner" platformOperator={false} />);
  expect(screen.getByRole('heading', { name: '当前身份无法管理定位与地图' })).toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});

it('keeps save, test and activation separate and stores no key', async () => {
  const seen: Record<string, unknown>[] = [];
  const { client } = clientFor((path, init) => {
    if (init?.body) seen.push(body(init));
    if (path.endsWith('/draft')) {
      return {
        commandId: body(init).commandId,
        kind: 'SAVE',
        status: 'SUCCEEDED',
        configVersion: 1,
        testId: null,
        error: null,
      };
    }
    return snapshot;
  });
  render(<LocationSettingsPage client={client} userId="operator-a" platformOperator />);
  expect(await screen.findByRole('heading', { name: '定位与地图' })).toBeInTheDocument();
  expect(screen.getByText('沿用环境中的腾讯配置')).toBeInTheDocument();
  expect(screen.getByText(/这里不显示剩余额度，也不探测微信后台权限/)).toBeInTheDocument();
  expect(screen.queryByText(/剩余\s*\d+/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '检测配置' }));
  fireEvent.click(screen.getByRole('button', { name: '启用配置' }));
  expect(seen).toEqual([]);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'REPLACE' } });
  fireEvent.change(screen.getByLabelText('Web 服务 Key 新值'), {
    target: { value: 'synthetic-amap-key' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(seen.length).toBeGreaterThan(0));
  expect(seen[0]).toMatchObject({
    expectedVersion: 0,
    provider: 'AMAP',
    webKeyAction: 'REPLACE',
    webKey: 'synthetic-amap-key',
  });
  expect(seen[0]).not.toHaveProperty('confirmCloudTest');
  expect(localStorage.length).toBe(0);
});
