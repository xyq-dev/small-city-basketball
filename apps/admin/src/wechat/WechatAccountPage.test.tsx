// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WechatAccountPage } from './WechatAccountPage';
const api = () => ({
  binding: vi
    .fn()
    .mockResolvedValue({ enabled: false, connected: false, version: null, linkedAt: null }),
  capabilities: vi.fn(),
  unbind: vi.fn().mockResolvedValue(undefined),
});
afterEach(cleanup);
it('unconfigured provider is visibly disabled with no fake login', async () => {
  const client = api();
  render(<WechatAccountPage api={client} />);
  expect(await screen.findByText(/微信登录尚未配置启用/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '微信登录' })).not.toBeInTheDocument();
  expect(client.unbind).not.toHaveBeenCalled();
});
it('requires password and explicit consent, submits seen version once, then reports all-session revocation', async () => {
  const client = api();
  client.binding.mockResolvedValue({
    enabled: true,
    connected: true,
    version: 3,
    linkedAt: '2026-10-23T00:00:00Z',
  });
  render(<WechatAccountPage api={client} />);
  const submit = await screen.findByRole('button', { name: '解绑并退出所有会话' });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('重新验证应用密码'), {
    target: { value: 'SYNTHETIC_PASSWORD' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(submit);
  await waitFor(() =>
    expect(client.unbind).toHaveBeenCalledWith({
      password: 'SYNTHETIC_PASSWORD',
      expectedVersion: 3,
      consent: true,
    }),
  );
  expect(await screen.findByText(/已解除微信绑定并退出全部会话/)).toBeInTheDocument();
  expect(client.unbind).toHaveBeenCalledTimes(1);
});
it('on conflict does not replay and clears the entered password', async () => {
  const client = api();
  client.binding.mockResolvedValue({
    enabled: true,
    connected: true,
    version: 1,
    linkedAt: '2026-10-23T00:00:00Z',
  });
  client.unbind.mockRejectedValue(new Error('conflict'));
  render(<WechatAccountPage api={client} />);
  await screen.findByRole('button', { name: '解绑并退出所有会话' });
  fireEvent.change(screen.getByLabelText('重新验证应用密码'), {
    target: { value: 'SYNTHETIC_PASSWORD' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '解绑并退出所有会话' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('显式刷新');
  expect(screen.getByLabelText('重新验证应用密码')).toHaveValue('');
  expect(client.unbind).toHaveBeenCalledTimes(1);
});

it('a late completed action cannot sign out a later mounted account', async () => {
  const client = api();
  client.binding.mockResolvedValue({
    enabled: true,
    connected: true,
    version: 1,
    linkedAt: '2026-10-23T00:00:00Z',
  });
  let resolve!: () => void;
  client.unbind.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const onSignedOut = vi.fn();
  const view = render(<WechatAccountPage api={client} onSignedOut={onSignedOut} />);
  await screen.findByRole('button', { name: '解绑并退出所有会话' });
  fireEvent.change(screen.getByLabelText('重新验证应用密码'), {
    target: { value: 'SYNTHETIC_PASSWORD' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '解绑并退出所有会话' }));
  view.unmount();
  resolve();
  await Promise.resolve();
  expect(onSignedOut).not.toHaveBeenCalled();
});
