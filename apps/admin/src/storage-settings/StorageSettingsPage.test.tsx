// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { ApiError } from '../api/client';
import { StorageSettingsPage } from './StorageSettingsPage';
import { passedSnapshot, storageReceipt, storageSnapshot } from './test-fixtures';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
type Handler = (path: string, init?: RequestInit) => unknown | Promise<unknown>;
function clientFor(handler: Handler) {
  const request = vi.fn(async (path: string, init?: RequestInit) => ({
    data: await handler(path, init),
    meta: { requestId: 'http-synthetic' },
  }));
  return { client: { request: request as ApiClient['request'] }, request };
}
const body = (init?: RequestInit) => JSON.parse(String(init?.body)) as Record<string, unknown>;
function renderPage(client: ApiClient, userId = 'operator-a') {
  return render(<StorageSettingsPage client={client} userId={userId} platformOperator />);
}
async function ready() {
  await screen.findByLabelText('存储桶名称');
}
function replaceCredentials() {
  fireEvent.click(screen.getByLabelText('更换密钥'));
  fireEvent.change(screen.getByLabelText('SecretId'), { target: { value: 'SYNTHETIC_ID' } });
  fireEvent.change(screen.getByLabelText('SecretKey'), { target: { value: 'SYNTHETIC_KEY' } });
}
const consent = () => screen.getByLabelText(/我已在腾讯云控制台确认/);
function pendingProbeSnapshot() {
  const state = passedSnapshot();
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  return {
    ...state,
    destinationLocked: true,
    cleanupPending: true,
    active: {
      provider: 'COS' as const,
      source: 'ADMIN' as const,
      version: 1,
      destination: { bucket: 'bound-1250000000', region: 'ap-shanghai', prefix: 'bound-media/v2' },
      applied: true,
    },
    test: {
      ...state.test!,
      status: 'FAILED' as const,
      cleanupPending: true,
      completedAt: old,
      expiresAt: old,
    },
  };
}

it('does not call the platform API for an organization administrator without operator rights', () => {
  const { client, request } = clientFor(() => storageSnapshot());
  render(<StorageSettingsPage client={client} userId="org-owner" platformOperator={false} />);
  expect(screen.getByRole('heading', { name: '当前身份不能管理对象存储' })).toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});

it('honors fresh server permission revocation', async () => {
  const { client, request } = clientFor(() => storageSnapshot({ canManage: false }));
  renderPage(client);
  expect(
    await screen.findByRole('heading', { name: '当前身份不能管理对象存储' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
});

it('shows the denied view when the initial configuration read is forbidden', async () => {
  const { client, request } = clientFor(() => {
    throw new ApiError(403, 'FORBIDDEN', 'forbidden');
  });
  renderPage(client);
  expect(
    await screen.findByRole('heading', { name: '当前身份不能管理对象存储' }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText('存储桶名称')).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
});

it('discards stale activation permissions when an explicit refresh is forbidden', async () => {
  let forbidden = false;
  const { client } = clientFor(() => {
    if (forbidden) throw new ApiError(403, 'FORBIDDEN', 'forbidden');
    return passedSnapshot();
  });
  renderPage(client);
  await ready();
  fireEvent.click(consent());
  expect(screen.getByRole('button', { name: '确认启用 COS' })).toBeEnabled();
  forbidden = true;
  fireEvent.click(screen.getByRole('button', { name: '重新读取状态' }));
  expect(
    await screen.findByRole('heading', { name: '当前身份不能管理对象存储' }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText('存储桶名称')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('SecretKey')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '确认启用 COS' })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('submits the resource CAS and a new credential pair once, clears inputs immediately, and never persists credentials in browser storage', async () => {
  let state = storageSnapshot();
  let finish!: (value: unknown) => void;
  let submitted: Record<string, unknown> | undefined;
  const local = vi.spyOn(Storage.prototype, 'setItem');
  const { client, request } = clientFor((path, init) => {
    if (path.endsWith('/draft')) {
      submitted = body(init);
      return new Promise((done) => {
        finish = done;
      });
    }
    return state;
  });
  renderPage(client);
  await ready();
  replaceCredentials();
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(submitted).toMatchObject({
    expectedVersion: 7,
    bucket: 'scb-media-1250000000',
    secretId: 'SYNTHETIC_ID',
    secretKey: 'SYNTHETIC_KEY',
  });
  expect(screen.getByLabelText('SecretId')).toHaveValue('');
  expect(screen.getByLabelText('SecretKey')).toHaveValue('');
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
  state = storageSnapshot({ version: 8, draft: { ...state.draft!, version: 4 } });
  await act(async () =>
    finish(storageReceipt(String(submitted!.commandId), 'SAVE', { configVersion: 4 })),
  );
  expect(await screen.findByText(/草稿 v4 已保存/)).toBeInTheDocument();
  expect(screen.queryByLabelText('SecretKey')).not.toBeInTheDocument();
  expect(local).not.toHaveBeenCalled();
  expect(request.mock.calls.filter(([path]) => path.endsWith('/draft'))).toHaveLength(1);
});

it('keeps an uncertain command locked and queries the original ID; a missing receipt is not permission to replay', async () => {
  let commandId = '';
  let queries = 0;
  const { client, request } = clientFor((path, init) => {
    if (path.endsWith('/draft')) {
      commandId = String(body(init).commandId);
      throw new ApiError(0, 'NETWORK_ERROR', 'network');
    }
    if (path.includes('/operations/')) {
      queries++;
      if (queries === 1) throw new ApiError(404, 'NOT_FOUND', 'not found');
      return storageReceipt(commandId, 'SAVE', { configVersion: 4 });
    }
    return storageSnapshot(
      queries > 1 ? { version: 8, draft: { ...storageSnapshot().draft!, version: 4 } } : {},
    );
  });
  renderPage(client);
  await ready();
  replaceCredentials();
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('不要重复提交');
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '查询操作结果' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('不能据此判断未执行');
  fireEvent.click(screen.getByRole('button', { name: '查询操作结果' }));
  expect(await screen.findByText(/草稿 v4 已保存/)).toBeInTheDocument();
  expect(request.mock.calls.filter(([path]) => path.endsWith('/draft'))).toHaveLength(1);
  expect(
    request.mock.calls.filter(([path]) => path.includes('/operations/')).map(([path]) => path),
  ).toEqual([
    `/v1/platform/storage/operations/${commandId}`,
    `/v1/platform/storage/operations/${commandId}`,
  ]);
});

it('does not automatically replay a CAS conflict and requires an explicit refresh', async () => {
  const { client, request } = clientFor((path) => {
    if (path.endsWith('/draft')) throw new ApiError(409, 'VERSION_CONFLICT', 'conflict');
    return storageSnapshot();
  });
  renderPage(client);
  await ready();
  replaceCredentials();
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请重新读取状态');
  expect(screen.getByLabelText('SecretKey')).toHaveValue('');
  expect(screen.queryByRole('button', { name: '查询操作结果' })).not.toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
});

it('requires explicit cloud-test consent and pins the saved config revision', async () => {
  let state = storageSnapshot();
  let submitted: Record<string, unknown> | undefined;
  const { client } = clientFor((path, init) => {
    if (path.endsWith('/tests')) {
      submitted = body(init);
      state = passedSnapshot();
      return storageReceipt(String(submitted.commandId), 'TEST');
    }
    return state;
  });
  renderPage(client);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '检测连接' }));
  const dialog = screen.getByRole('dialog', { name: '检测 COS 连接' });
  expect(within(dialog).getByText(/会产生少量 COS 请求费用/)).toBeInTheDocument();
  expect(submitted).toBeUndefined();
  fireEvent.click(within(dialog).getByRole('button', { name: '开始检测' }));
  await waitFor(() =>
    expect(submitted).toMatchObject({ configVersion: 3, confirmCloudTest: true }),
  );
  expect(await screen.findByText(/连接检测通过，尚未启用/)).toBeInTheDocument();
  expect(consent()).not.toBeChecked();
  expect(screen.getByText('需人工确认')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认启用 COS' })).toBeDisabled();
});

it('locks the destination while failed probe cleanup remains and permits only a fresh cleanup test', async () => {
  const state = passedSnapshot();
  state.test = {
    ...state.test!,
    status: 'FAILED',
    cleanupPending: true,
    checks: state.test!.checks.map((item) => ({
      ...item,
      status: item.key === 'DELETE' ? 'FAILED' : 'PASSED',
    })),
  };
  state.cleanupPending = true;
  const { client } = clientFor(() => state);
  renderPage(client);
  await ready();
  expect(screen.getByLabelText('存储桶名称')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('所属地域')).toBeDisabled();
  expect(screen.getByLabelText('对象路径前缀')).toHaveAttribute('readonly');
  expect(screen.getByRole('button', { name: '清理并重新检测' })).toBeEnabled();
  expect(consent()).toBeDisabled();
  expect(screen.getByRole('button', { name: '确认启用 COS' })).toBeDisabled();
  expect(screen.getByLabelText('更换密钥')).toBeEnabled();
});

it('keeps a pending probe at draft B ahead of active A recovery and saves B credentials before cleanup', async () => {
  let state = pendingProbeSnapshot();
  let submitted: Record<string, unknown> | undefined;
  const { client, request } = clientFor((path, init) => {
    if (path.endsWith('/draft')) {
      submitted = body(init);
      state = { ...state, version: 8, draft: { ...state.draft!, version: 4 } };
      return storageReceipt(String(submitted.commandId), 'SAVE', { configVersion: 4 });
    }
    return state;
  });
  renderPage(client);
  await ready();
  expect(screen.getByLabelText('存储桶名称')).toHaveValue('scb-media-1250000000');
  expect(screen.getByLabelText('存储桶名称')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('所属地域')).toBeDisabled();
  expect(screen.getByLabelText('对象路径前缀')).toHaveAttribute('readonly');
  expect(screen.queryByRole('button', { name: '恢复为当前实际存储位置' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '清理并重新检测' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '确认启用 COS' })).toBeDisabled();
  replaceCredentials();
  expect(screen.getByRole('button', { name: '清理并重新检测' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(submitted).toMatchObject({
    expectedVersion: 7,
    bucket: 'scb-media-1250000000',
    region: 'ap-guangzhou',
    prefix: 'scb-media/v1',
    secretId: 'SYNTHETIC_ID',
    secretKey: 'SYNTHETIC_KEY',
  });
  expect(await screen.findByText(/草稿 v4 已保存/)).toBeInTheDocument();
  expect(screen.queryByLabelText('SecretKey')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '恢复为当前实际存储位置' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '清理并重新检测' })).toBeEnabled();
  expect(request.mock.calls.filter(([path]) => path.endsWith('/tests'))).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '清理并重新检测' }));
  const dialog = screen.getByRole('dialog', { name: '检测 COS 连接' });
  expect(within(dialog).getByText('scb-media-1250000000')).toBeInTheDocument();
  expect(
    within(dialog).getByText(/若当前业务位置受限，清理完成后需恢复当前实际存储地址，不继续新检测/),
  ).toBeInTheDocument();
  expect(request.mock.calls.filter(([path]) => path.endsWith('/tests'))).toHaveLength(0);
});

it('allows explicit cleanup retries for a failed or uncertain probe older than 24 hours', async () => {
  const state = pendingProbeSnapshot();
  const commands: string[] = [];
  const { client, request } = clientFor((path, init) => {
    if (path.endsWith('/tests')) {
      const commandId = String(body(init).commandId);
      commands.push(commandId);
      return storageReceipt(commandId, 'TEST', {
        status: 'FAILED',
        error: {
          code: 'STORAGE_PROBE_CLEANUP_FAILED',
          message: '检测对象暂时无法确认已删除，请稍后重试',
        },
      });
    }
    return state;
  });
  renderPage(client);
  await ready();
  expect(screen.getByRole('button', { name: '清理并重新检测' })).toBeEnabled();
  for (let count = 1; count <= 2; count++) {
    fireEvent.click(screen.getByRole('button', { name: '清理并重新检测' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '开始检测' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('检测对象暂时无法确认已删除');
    expect(screen.getByRole('button', { name: '清理并重新检测' })).toBeEnabled();
    expect(screen.getByLabelText('存储桶名称')).toHaveValue('scb-media-1250000000');
    expect(
      screen.queryByRole('button', { name: '恢复为当前实际存储位置' }),
    ).not.toBeInTheDocument();
    expect(request.mock.calls.filter(([path]) => path.endsWith('/tests'))).toHaveLength(count);
  }
  expect(new Set(commands).size).toBe(2);
  expect(
    request.mock.calls.some(([path]) => path.endsWith('/draft') || path.endsWith('/activation')),
  ).toBe(false);
});

it('offers active A recovery only after B cleanup is confirmed complete and preserves unknown-command guards', async () => {
  let state = pendingProbeSnapshot();
  let commandId = '';
  let queries = 0;
  const { client, request } = clientFor((path, init) => {
    if (path.endsWith('/tests')) {
      commandId = String(body(init).commandId);
      throw new ApiError(0, 'NETWORK_ERROR', 'network');
    }
    if (path.includes('/operations/')) {
      queries++;
      if (queries === 1) throw new ApiError(404, 'NOT_FOUND', 'not found');
      state = {
        ...state,
        cleanupPending: false,
        test: {
          ...state.test,
          cleanupPending: false,
          message: '检测对象已清理，已有业务文件绑定当前实际位置，请恢复地址后重试',
        },
      };
      return storageReceipt(commandId, 'TEST', {
        status: 'FAILED',
        error: { code: 'STORAGE_DESTINATION_LOCKED', message: state.test.message! },
      });
    }
    return state;
  });
  renderPage(client);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '清理并重新检测' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '开始检测' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('不要重复提交');
  expect(screen.getByRole('button', { name: '清理并重新检测' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '恢复为当前实际存储位置' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查询操作结果' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('不能据此判断未执行');
  expect(screen.getByRole('button', { name: '清理并重新检测' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '查询操作结果' }));
  expect(await screen.findByRole('button', { name: '恢复为当前实际存储位置' })).toBeEnabled();
  expect(screen.getByLabelText('存储桶名称')).toHaveValue('scb-media-1250000000');
  expect(screen.getByRole('button', { name: '检测连接' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '查询操作结果' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '恢复为当前实际存储位置' }));
  expect(screen.getByLabelText('存储桶名称')).toHaveValue('bound-1250000000');
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '检测连接' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '确认启用 COS' })).toBeDisabled();
  expect(request.mock.calls.filter(([path]) => path.endsWith('/tests'))).toHaveLength(1);
  expect(
    request.mock.calls.filter(([path]) => path.includes('/operations/')).map(([path]) => path),
  ).toEqual([
    `/v1/platform/storage/operations/${commandId}`,
    `/v1/platform/storage/operations/${commandId}`,
  ]);
  expect(
    request.mock.calls.some(([path]) => path.endsWith('/draft') || path.endsWith('/activation')),
  ).toBe(false);
});

it.each(['ENVIRONMENT', 'ADMIN'] as const)(
  'explicitly restores an obsolete locked draft to the actual %s destination without saving or migrating',
  async (source) => {
    const actual = { bucket: 'bound-1250000000', region: 'ap-shanghai', prefix: 'bound-media/v2' };
    let state = passedSnapshot({
      destinationLocked: true,
      active: {
        provider: 'COS',
        source,
        version: source === 'ADMIN' ? 1 : null,
        destination: actual,
        applied: true,
      },
    });
    let submitted: Record<string, unknown> | undefined;
    const { client, request } = clientFor((path, init) => {
      if (path.endsWith('/draft')) {
        submitted = body(init);
        state = {
          ...state,
          version: 8,
          draft: { ...actual, version: 4, credentialsConfigured: true },
          test: null,
        };
        return storageReceipt(String(submitted.commandId), 'SAVE', { configVersion: 4 });
      }
      return state;
    });
    renderPage(client);
    await ready();
    expect(screen.getByLabelText('存储桶名称')).toHaveValue('scb-media-1250000000');
    expect(screen.getByLabelText('存储桶名称')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: '检测连接' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '确认启用 COS' })).toBeDisabled();
    fireEvent.click(consent());
    expect(consent()).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '恢复为当前实际存储位置' }));
    expect(screen.getByLabelText('存储桶名称')).toHaveValue(actual.bucket);
    expect(screen.getByLabelText('所属地域')).toHaveValue(actual.region);
    expect(screen.getByLabelText('对象路径前缀')).toHaveValue(actual.prefix);
    expect(screen.getByLabelText('存储桶名称')).toHaveAttribute('readonly');
    expect(consent()).not.toBeChecked();
    expect(consent()).toBeDisabled();
    expect(screen.getByText('草稿 v3 · 有未保存修改')).toBeInTheDocument();
    expect(screen.getByText(/你可以保留已保存的密钥/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '检测连接' })).toBeDisabled();
    expect(screen.queryByText('检测通过')).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
    expect(submitted).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(submitted).toMatchObject({ ...actual, expectedVersion: 7 });
    expect(submitted).not.toHaveProperty('secretId');
    expect(submitted).not.toHaveProperty('secretKey');
    expect(await screen.findByText(/草稿 v4 已保存/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '恢复为当前实际存储位置' }),
    ).not.toBeInTheDocument();
    expect(request.mock.calls.some(([path]) => path.endsWith('/activation'))).toBe(false);
  },
);

it('disables destination recovery while the original command has an unknown result', async () => {
  const state = storageSnapshot({
    destinationLocked: true,
    active: {
      provider: 'COS',
      source: 'ADMIN',
      version: 1,
      destination: { bucket: 'bound-1250000000', region: 'ap-shanghai', prefix: 'bound-media/v2' },
      applied: true,
    },
  });
  const { client, request } = clientFor((path) => {
    if (path.endsWith('/draft')) throw new ApiError(0, 'NETWORK_ERROR', 'network');
    return state;
  });
  renderPage(client);
  await ready();
  replaceCredentials();
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('不要重复提交');
  const restore = screen.getByRole('button', { name: '恢复为当前实际存储位置' });
  expect(restore).toBeDisabled();
  fireEvent.click(restore);
  expect(screen.getByLabelText('存储桶名称')).toHaveValue('scb-media-1250000000');
  expect(screen.getByRole('button', { name: '查询操作结果' })).toBeEnabled();
  expect(request).toHaveBeenCalledTimes(2);
});

it('blocks every write in restore quarantine', async () => {
  const { client } = clientFor(() => passedSnapshot({ quarantined: true }));
  renderPage(client);
  await ready();
  expect(screen.getByText('备份恢复隔离中')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '检测连接' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '确认启用 COS' })).toBeDisabled();
  expect(consent()).toBeDisabled();
});

it('rejects expired test evidence and invalidates consent on an unsaved edit', async () => {
  let state = passedSnapshot();
  const { client } = clientFor(() => state);
  renderPage(client);
  await ready();
  fireEvent.click(consent());
  expect(screen.getByRole('button', { name: '确认启用 COS' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('存储桶名称'), { target: { value: 'other-1250000000' } });
  expect(consent()).not.toBeChecked();
  expect(consent()).toBeDisabled();
  state = passedSnapshot({
    test: { ...state.test!, expiresAt: new Date(Date.now() - 1000).toISOString() },
  });
  fireEvent.click(screen.getByRole('button', { name: '重新读取状态' }));
  expect(await screen.findByText(/检测结果已过期/)).toBeInTheDocument();
  expect(consent()).toBeDisabled();
});

it('waits for a fresh resolver-confirmed ADMIN active version before reporting activation', async () => {
  let state = passedSnapshot();
  let submitted: Record<string, unknown> | undefined;
  const { client, request } = clientFor((path, init) => {
    if (path.endsWith('/activation')) {
      submitted = body(init);
      state = {
        ...state,
        active: {
          provider: 'COS',
          source: 'ADMIN',
          version: 3,
          destination: state.draft!,
          applied: false,
        },
      };
      return storageReceipt(String(submitted.commandId), 'ACTIVATE');
    }
    if (path.includes('/operations/')) {
      state = { ...state, active: { ...state.active, applied: true } };
      return storageReceipt(String(submitted!.commandId), 'ACTIVATE');
    }
    return state;
  });
  renderPage(client);
  await ready();
  fireEvent.click(consent());
  fireEvent.click(screen.getByRole('button', { name: '确认启用 COS' }));
  const dialog = screen.getByRole('dialog', { name: '确认启用 COS' });
  expect(within(dialog).getByText('scb-media-1250000000')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: '确认启用' }));
  expect(await screen.findByText(/启用申请已记录，等待服务确认/)).toBeInTheDocument();
  expect(screen.queryByText(/服务已确认：COS 配置 v3 已生效/)).not.toBeInTheDocument();
  expect(submitted).toMatchObject({
    expectedVersion: 7,
    configVersion: 3,
    testId: 'test-synthetic-3',
    privatePolicyConfirmed: true,
  });
  fireEvent.click(screen.getByRole('button', { name: '查询操作结果' }));
  expect(await screen.findByText('服务已确认：COS 配置 v3 已生效。')).toBeInTheDocument();
  expect(request.mock.calls.filter(([path]) => path.endsWith('/activation'))).toHaveLength(1);
});

it.each(['operation', 'snapshot'] as const)(
  'revokes the whole page when the %s read while querying an activation becomes forbidden',
  async (forbiddenRead) => {
    let commandId = '';
    let queried = false;
    const { client, request } = clientFor((path, init) => {
      if (path.endsWith('/activation')) {
        commandId = String(body(init).commandId);
        return storageReceipt(commandId, 'ACTIVATE', { status: 'RUNNING' });
      }
      if (path.includes('/operations/')) {
        queried = true;
        if (forbiddenRead === 'operation') throw new ApiError(403, 'FORBIDDEN', 'forbidden');
        return storageReceipt(commandId, 'ACTIVATE');
      }
      if (queried) throw new ApiError(403, 'FORBIDDEN', 'forbidden');
      return passedSnapshot();
    });
    renderPage(client);
    await ready();
    fireEvent.click(consent());
    fireEvent.click(screen.getByRole('button', { name: '确认启用 COS' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认启用' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '查询操作结果' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '查询操作结果' }));
    expect(
      await screen.findByRole('heading', { name: '当前身份不能管理对象存储' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('存储桶名称')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认启用 COS' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查询操作结果' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(request.mock.calls.filter(([path]) => path.endsWith('/activation'))).toHaveLength(1);
  },
);

it('releases a superseded activation for an explicit refresh without submitting it again', async () => {
  let state = passedSnapshot();
  const { client, request } = clientFor((path, init) => {
    if (path.endsWith('/activation')) {
      const commandId = String(body(init).commandId);
      state = passedSnapshot({
        version: 10,
        draft: { ...state.draft!, version: 4 },
        active: {
          provider: 'COS',
          source: 'ADMIN',
          version: 4,
          destination: state.draft!,
          applied: true,
        },
        test: { ...state.test!, id: 'test-synthetic-4', configVersion: 4 },
      });
      return storageReceipt(commandId, 'ACTIVATE', { configVersion: 3 });
    }
    return state;
  });
  renderPage(client);
  await ready();
  fireEvent.click(consent());
  fireEvent.click(screen.getByRole('button', { name: '确认启用 COS' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认启用' }));
  expect(await screen.findByText(/本次启用版本 v3 已被后续配置 v4 取代/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '查询操作结果' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '检测连接' })).toBeDisabled();
  expect(consent()).toBeDisabled();
  expect(consent()).not.toBeChecked();
  const reload = screen.getByRole('button', { name: '重新读取状态' });
  expect(reload).toBeEnabled();
  fireEvent.click(reload);
  await waitFor(() => expect(consent()).toBeEnabled());
  expect(request.mock.calls.filter(([path]) => path.endsWith('/activation'))).toHaveLength(1);
});

it.each([4, null])(
  'keeps the original activation target when a successful receipt claims version %s',
  async (configVersion) => {
    let commandId = '';
    const { client, request } = clientFor((path, init) => {
      if (path.endsWith('/activation')) {
        commandId = String(body(init).commandId);
        return storageReceipt(commandId, 'ACTIVATE', { configVersion });
      }
      if (path.includes('/operations/'))
        return storageReceipt(commandId, 'ACTIVATE', { configVersion });
      return passedSnapshot();
    });
    renderPage(client);
    await ready();
    fireEvent.click(consent());
    fireEvent.click(screen.getByRole('button', { name: '确认启用 COS' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认启用' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('不要重复提交');
    expect(screen.getByRole('button', { name: '查询操作结果' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '重新读取状态' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '查询操作结果' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('继续查询');
    expect(screen.queryByText(/服务已确认：COS 配置/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查询操作结果' })).toBeEnabled();
    expect(request.mock.calls.filter(([path]) => path.endsWith('/activation'))).toHaveLength(1);
    expect(request.mock.calls.filter(([path]) => path === '/v1/platform/storage')).toHaveLength(1);
  },
);

it.each([
  { source: 'ENVIRONMENT' as const, applied: true },
  { source: 'ADMIN' as const, applied: false },
])(
  'keeps waiting when the newer version is not verified as applied ADMIN config: %j',
  async (active) => {
    let state = passedSnapshot();
    const { client, request } = clientFor((path, init) => {
      if (path.endsWith('/activation')) {
        state = {
          ...state,
          active: { provider: 'COS', ...active, version: 4, destination: state.draft! },
        };
        return storageReceipt(String(body(init).commandId), 'ACTIVATE');
      }
      return state;
    });
    renderPage(client);
    await ready();
    fireEvent.click(consent());
    fireEvent.click(screen.getByRole('button', { name: '确认启用 COS' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '确认启用' }));
    expect(await screen.findByText(/启用申请已记录，等待服务确认/)).toBeInTheDocument();
    expect(screen.queryByText(/本次启用版本/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查询操作结果' })).toBeEnabled();
    expect(request.mock.calls.filter(([path]) => path.endsWith('/activation'))).toHaveLength(1);
  },
);

it('does not confuse an applied ENVIRONMENT COS config with a newly saved ADMIN revision', async () => {
  const state = passedSnapshot({
    active: {
      provider: 'COS',
      source: 'ENVIRONMENT',
      version: 3,
      destination: storageSnapshot().draft!,
      applied: true,
    },
  });
  const { client } = clientFor(() => state);
  renderPage(client);
  await ready();
  expect(screen.getByText('沿用服务环境配置')).toBeInTheDocument();
  expect(screen.getByText('草稿 v3 · 尚未生效')).toBeInTheDocument();
  fireEvent.click(consent());
  expect(screen.getByRole('button', { name: '确认启用 COS' })).toBeEnabled();
});

it('clears credential input and ignores a former identity’s late response', async () => {
  let finish!: (value: unknown) => void;
  let submitted: Record<string, unknown> | undefined;
  const first = clientFor((path, init) => {
    if (path.endsWith('/draft')) {
      submitted = body(init);
      return new Promise((done) => {
        finish = done;
      });
    }
    return storageSnapshot();
  });
  const second = clientFor(() =>
    storageSnapshot({
      draft: { ...storageSnapshot().draft!, bucket: 'second-1250000000', version: 11 },
    }),
  );
  const view = renderPage(first.client);
  await ready();
  replaceCredentials();
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  view.rerender(
    <StorageSettingsPage client={second.client} userId="operator-b" platformOperator />,
  );
  await waitFor(() => expect(screen.getByLabelText('存储桶名称')).toHaveValue('second-1250000000'));
  await act(async () =>
    finish(storageReceipt(String(submitted!.commandId), 'SAVE', { configVersion: 4 })),
  );
  expect(screen.getByLabelText('存储桶名称')).toHaveValue('second-1250000000');
  expect(screen.queryByText(/草稿 v4 已保存/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('SecretKey')).not.toBeInTheDocument();
  expect(first.request).toHaveBeenCalledTimes(2);
});
