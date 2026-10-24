import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandId } from './model';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const nativeCryptography = globalThis.crypto;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('预约操作编号的浏览器兼容性', () => {
  it('优先使用原生randomUUID并保留方法接收者', () => {
    const randomUUID = vi.fn(function (this: object) {
      expect(this).toBe(cryptography);
      return '541a2900-8938-42ac-b949-5ee8266c3325';
    });
    const getRandomValues = vi.fn();
    const cryptography = { randomUUID, getRandomValues };
    vi.stubGlobal('crypto', cryptography);
    expect(commandId()).toBe('541a2900-8938-42ac-b949-5ee8266c3325');
    expect(getRandomValues).not.toHaveBeenCalled();
  });
  it('randomUUID缺失时使用16字节安全随机源并设置UUIDv4版本和variant', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(255);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });
    const weakRandom = vi.spyOn(Math, 'random');
    expect(commandId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(16);
    expect(weakRandom).not.toHaveBeenCalled();
  });
  it('HTTP环境缺失randomUUID时演示模块仍能初始化，所有初始场次有规范UUID', async () => {
    vi.resetModules();
    vi.stubGlobal('crypto', {
      getRandomValues: nativeCryptography.getRandomValues.bind(nativeCryptography),
    });
    const { createDemoBookingRepository } = await import('./demo');
    const workspace = await createDemoBookingRepository().repository.workspace();
    expect(workspace.orders).toHaveLength(1);
    const ids = workspace.orders[0]!.appearances.map((a) => a.id);
    expect(ids).toHaveLength(5);
    ids.forEach((id) => expect(id).toMatch(uuid));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it.each([undefined, {}])('没有安全随机数API时明确拒绝创建编号', (cryptography) => {
    vi.stubGlobal('crypto', cryptography);
    expect(() => commandId()).toThrow('当前浏览器缺少安全随机数能力');
  });
});
