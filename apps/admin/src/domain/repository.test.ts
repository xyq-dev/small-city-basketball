import { describe, expect, it } from 'vitest';
import { AppError, createMemoryEventRepository } from './repository';
import type { CreateEventInput } from './types';

const input: CreateEventInput = {
  name: '  城市周末邀请赛  ',
  startDate: '2026-11-01',
  endDate: '2026-11-08',
  timezone: 'Asia/Shanghai',
  venueName: '  城市公园球场  ',
  format: 'ROUND_ROBIN',
};
const repository = () => createMemoryEventRepository({ seed: [], latencyMs: 0 });

describe('内存赛事演示服务', () => {
  it('创建规范化草稿，并能从列表和详情读取同一数据', async () => {
    const repo = repository();
    const created = await repo.create(input);
    expect(created).toMatchObject({
      name: '城市周末邀请赛',
      venueName: '城市公园球场',
      status: 'DRAFT',
      version: 1,
    });
    expect(created.id).toBeTruthy();
    expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);
    expect(await repo.get(created.id)).toEqual(created);
    expect(await repo.list()).toEqual([created]);
  });

  it('空白或省略地点均读取为null', async () => {
    const repo = repository();
    expect((await repo.create({ ...input, venueName: ' ' })).venueName).toBeNull();
    const withoutVenue = { ...input };
    delete withoutVenue.venueName;
    expect((await repo.create(withoutVenue)).venueName).toBeNull();
  });

  it('允许同名赛事但不会复用ID或覆盖已有记录', async () => {
    const repo = repository();
    const [first, second] = await Promise.all([repo.create(input), repo.create(input)]);
    expect(first.id).not.toBe(second.id);
    expect(await repo.list()).toHaveLength(2);
  });

  it('新建入口只取允许字段，不能提交状态/版本覆盖系统值', async () => {
    const repo = repository();
    const created = await repo.create({
      ...input,
      id: 'forced',
      status: 'RUNNING',
      version: 999,
    } as CreateEventInput);
    expect(created.id).not.toBe('forced');
    expect(created.status).toBe('DRAFT');
    expect(created.version).toBe(1);
  });

  it('非法输入保留字段错误且不写入记录', async () => {
    const repo = repository();
    await expect(
      repo.create({ ...input, name: '  ', endDate: '2026-10-01' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fieldErrors: { name: expect.any(String), endDate: expect.any(String) },
    });
    expect(await repo.list()).toEqual([]);
  });

  it('读取不存在记录与更新不存在记录均有明确错误', async () => {
    const repo = repository();
    await expect(repo.get('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(repo.updateDraft('missing', input, 1)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('列表搜索与状态筛选可组合，并可清空筛选', async () => {
    const repo = createMemoryEventRepository({ latencyMs: 0 });
    expect(await repo.list()).toHaveLength(3);
    expect(await repo.list({ query: '  秋季  ', status: 'RUNNING' })).toHaveLength(1);
    expect(await repo.list({ query: '秋季', status: 'DRAFT' })).toEqual([]);
    expect(await repo.list({ query: '不存在' })).toEqual([]);
    expect(await repo.list({ query: '', status: 'ALL' })).toHaveLength(3);
  });

  it('编辑草稿保持ID与创建时间、增加版本且列表详情一致', async () => {
    const repo = repository();
    const created = await repo.create(input);
    const updated = await repo.updateDraft(
      created.id,
      { ...input, name: '新版邀请赛' },
      created.version,
    );
    expect(updated).toMatchObject({
      id: created.id,
      createdAt: created.createdAt,
      version: 2,
      name: '新版邀请赛',
      status: 'DRAFT',
    });
    expect(await repo.get(created.id)).toEqual(updated);
    expect(await repo.list({ query: '新版' })).toEqual([updated]);
  });

  it('旧版本与非法版本不能覆盖已保存资料', async () => {
    const repo = repository();
    const created = await repo.create(input);
    await repo.updateDraft(created.id, { ...input, name: '已保存版本' }, 1);
    for (const version of [1, 0, NaN, 1.5]) {
      await expect(
        repo.updateDraft(created.id, { ...input, name: '不应覆盖' }, version),
      ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    }
    expect((await repo.get(created.id)).name).toBe('已保存版本');
  });

  it('并发同版本编辑只有一条成功，另一条报告冲突', async () => {
    const repo = createMemoryEventRepository({ seed: [], latencyMs: 5 });
    const created = await repo.create(input);
    const results = await Promise.allSettled([
      repo.updateDraft(created.id, { ...input, name: '操作A' }, 1),
      repo.updateDraft(created.id, { ...input, name: '操作B' }, 1),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection).toMatchObject({ reason: { code: 'VERSION_CONFLICT' } });
    expect((await repo.get(created.id)).version).toBe(2);
  });

  it('拒绝编辑非草稿，不会改变其资料', async () => {
    const repo = createMemoryEventRepository({ latencyMs: 0 });
    const event = await repo.get('event-autumn-2026');
    await expect(repo.updateDraft(event.id, input, event.version)).rejects.toMatchObject({
      code: 'INVALID_EVENT_STATE',
    });
    expect(await repo.get(event.id)).toEqual(event);
  });

  it('创建和读取的返回值不能被外部修改来篡改仓库', async () => {
    const repo = repository();
    const created = await repo.create(input);
    const id = created.id;
    created.name = '篡改创建返回';
    const fetched = await repo.get(id);
    fetched.name = '篡改详情返回';
    const listed = await repo.list();
    listed[0]!.name = '篡改列表返回';
    listed.pop();
    expect(await repo.get(id)).toMatchObject({ name: '城市周末邀请赛', version: 1 });
    expect(await repo.list()).toHaveLength(1);
  });

  it('输入与种子记录的后续外部修改不影响保存的数据', async () => {
    const seedRepo = repository();
    const seed = await seedRepo.create(input);
    const repo = createMemoryEventRepository({ seed: [seed], latencyMs: 0 });
    seed.name = '篡改种子';
    const mutable = { ...input };
    const pending = repo.create(mutable);
    mutable.name = '在等待期间篡改输入';
    expect((await pending).name).toBe('城市周末邀请赛');
    expect((await repo.list()).every((event) => event.name === '城市周末邀请赛')).toBe(true);
  });

  it('实例相互隔离，新实例不会继承上一轮演示创建的数据', async () => {
    const first = repository();
    const created = await first.create(input);
    const second = repository();
    expect(await second.list()).toEqual([]);
    await expect(second.get(created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('拒绝重复的种子ID，并提供可识别的错误实例', async () => {
    const repo = repository();
    const record = await repo.create(input);
    expect(() => createMemoryEventRepository({ seed: [record, record] })).toThrow(AppError);
    const error = new AppError('VALIDATION_ERROR', '字段错误', { name: '请填写' });
    expect(error).toBeInstanceOf(Error);
    expect(error.fieldErrors).toEqual({ name: '请填写' });
  });
});
