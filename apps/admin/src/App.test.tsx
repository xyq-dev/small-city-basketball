// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createMemoryEventRepository } from './domain/repository';
import type { CreateEventInput, EventRecord, EventRepository } from './domain/types';

const draft: EventRecord = {
  id: 'test-draft',
  name: '组件验证赛事',
  startDate: '2026-11-12',
  endDate: '2026-11-19',
  timezone: 'Asia/Shanghai',
  venueName: null,
  format: 'ROUND_ROBIN',
  status: 'DRAFT',
  version: 1,
  createdAt: '2026-10-22T04:00:00.000Z',
  updatedAt: '2026-10-22T04:00:00.000Z',
};

function renderAt(path: string, repository: EventRepository) {
  window.history.replaceState({}, '', path);
  return render(<App repository={repository} />);
}

async function fillValidForm(name: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/赛事名称/), name);
  await user.type(screen.getByLabelText(/开始日期/), '2026-11-12');
  await user.type(screen.getByLabelText(/结束日期/), '2026-11-19');
  return user;
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('真实页面的服务失败与恢复', () => {
  it('赛事列表读取失败时显示错误，重试后显示返回的数据', async () => {
    const repository = createMemoryEventRepository({ seed: [draft], latencyMs: 0 });
    const list = vi
      .fn<EventRepository['list']>()
      .mockRejectedValueOnce(new Error('列表服务暂不可用'))
      .mockResolvedValue([draft]);
    renderAt('/events', { ...repository, list });

    expect(await screen.findByRole('alert')).toHaveTextContent('列表服务暂不可用');
    await userEvent.setup().click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByRole('link', { name: draft.name })).toBeVisible();
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('详情读取失败不会冒用列表数据，显式重试才恢复', async () => {
    const repository = createMemoryEventRepository({ seed: [draft], latencyMs: 0 });
    const get = vi
      .fn<EventRepository['get']>()
      .mockRejectedValueOnce(new Error('详情读取失败'))
      .mockResolvedValue(draft);
    renderAt('/events/test-draft', { ...repository, get });

    expect(await screen.findByRole('alert')).toHaveTextContent('详情读取失败');
    expect(screen.queryByRole('button', { name: '编辑草稿' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByRole('heading', { level: 1, name: draft.name })).toBeVisible();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('保存失败保留用户输入，重试成功后进入真实创建记录的详情', async () => {
    const repository = createMemoryEventRepository({ seed: [], latencyMs: 0 });
    const create = vi
      .fn<EventRepository['create']>()
      .mockRejectedValueOnce(new Error('模拟保存服务失败'))
      .mockImplementation(repository.create);
    renderAt('/events/new', { ...repository, create });
    const user = await fillValidForm('可恢复的赛事');
    await user.type(screen.getByLabelText(/比赛地点/), '测试体育馆');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('模拟保存服务失败');
    expect(screen.getByLabelText(/赛事名称/)).toHaveValue('可恢复的赛事');
    expect(screen.getByLabelText(/比赛地点/)).toHaveValue('测试体育馆');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByRole('heading', { level: 1, name: '可恢复的赛事' })).toBeVisible();
    expect(create).toHaveBeenCalledTimes(2);
    expect(await repository.list()).toHaveLength(1);
  });

  it('保存请求未完成时禁用提交，重复点击不创建第二条赛事', async () => {
    const repository = createMemoryEventRepository({ seed: [], latencyMs: 0 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = vi.fn(async (input: CreateEventInput) => {
      await gate;
      return repository.create(input);
    });
    renderAt('/events/new', { ...repository, create });
    const user = await fillValidForm('仅创建一次');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));

    const saving = screen.getByRole('button', { name: '正在保存…' });
    expect(saving).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    await user.click(saving);
    expect(create).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
    });
    expect(await screen.findByRole('heading', { level: 1, name: '仅创建一次' })).toBeVisible();
    expect(await repository.list()).toHaveLength(1);
  });

  it('保存期间离开创建页后，旧请求完成不抢导航且创建结果仍可查询', async () => {
    const repository = createMemoryEventRepository({ seed: [], latencyMs: 0 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = vi.fn(async (input: CreateEventInput) => {
      await gate;
      return repository.create(input);
    });
    renderAt('/events/new', { ...repository, create });
    const user = await fillValidForm('后台完成的赛事');
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(create).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('link', { name: '赛事管理' }));
    expect(await screen.findByRole('heading', { level: 1, name: '赛事管理' })).toBeVisible();

    let created!: EventRecord;
    await act(async () => {
      release();
      created = await create.mock.results[0]!.value;
    });

    expect(window.location.pathname).toBe('/events');
    expect(screen.getByRole('heading', { level: 1, name: '赛事管理' })).toBeVisible();
    expect(
      screen.queryByRole('heading', { level: 1, name: '后台完成的赛事' }),
    ).not.toBeInTheDocument();
    expect(await repository.get(created.id)).toMatchObject({
      name: '后台完成的赛事',
      status: 'DRAFT',
    });
    expect(await repository.list()).toHaveLength(1);
  });

  it('表单完整保留80个emoji名称，81个码点时阻止保存', async () => {
    const repository = createMemoryEventRepository({ seed: [], latencyMs: 0 });
    renderAt('/events/new', repository);
    const eightyEmoji = '🏀'.repeat(80);
    const user = await fillValidForm(eightyEmoji);
    expect(screen.getByLabelText(/赛事名称/)).toHaveValue(eightyEmoji);
    expect(screen.getByText('80/80', { exact: true })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByRole('heading', { level: 1, name: eightyEmoji })).toBeVisible();

    await user.click(screen.getByRole('link', { name: '赛事管理' }));
    await user.click(screen.getByRole('link', { name: '创建赛事' }));
    const tooLong = 'A'.repeat(81);
    await fillValidForm(tooLong);
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(screen.getByText('赛事名称最多80个字符', { exact: true })).toBeVisible();
    expect(screen.getByLabelText(/赛事名称/)).toHaveValue(tooLong);
    expect(await repository.list()).toHaveLength(1);
  });
});

describe('未知功能路由', () => {
  it.each(['/roadmap/constructor', '/roadmap/toString'])(
    '%s 返回可恢复的未找到页面，不将继承属性当作功能配置',
    async (path) => {
      const repository = createMemoryEventRepository({ seed: [], latencyMs: 0 });
      renderAt(path, repository);

      expect(screen.getByRole('heading', { level: 1, name: '这个页面还没有开场' })).toBeVisible();
      await userEvent.setup().click(screen.getByRole('link', { name: '返回工作总览' }));
      expect(window.location.pathname).toBe('/');
      expect(screen.getByRole('heading', { level: 1, name: /欢迎回来/ })).toBeVisible();
    },
  );
});
