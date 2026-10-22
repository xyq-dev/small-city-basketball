import { afterEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({
  active: 0,
  maximumActive: 0,
  pending: [] as ((error: Error | null, key: Buffer) => void)[],
  throwSynchronously: false,
}));
vi.mock('node:crypto', async (original) => ({
  ...(await original<typeof import('node:crypto')>()),
  scrypt: vi.fn(
    (
      _password: string,
      _salt: Buffer,
      _length: number,
      _options: unknown,
      callback: (error: Error | null, key: Buffer) => void,
    ) => {
      if (worker.throwSynchronously) {
        worker.throwSynchronously = false;
        throw new Error('private-worker-diagnostic');
      }
      worker.active++;
      worker.maximumActive = Math.max(worker.maximumActive, worker.active);
      worker.pending.push((error, key) => {
        worker.active--;
        callback(error, key);
      });
    },
  ),
}));

import { hashPassword, verifyPassword } from './security.js';

async function complete(error: Error | null = null) {
  expect(worker.pending).toHaveLength(1);
  worker.pending.shift()!(error, Buffer.alloc(64));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  expect(worker.active).toBe(0);
  expect(worker.pending).toHaveLength(0);
  worker.maximumActive = 0;
});

describe('password derivation resource bounds', () => {
  it('serializes hashing and unknown-account verification, bounds the queue, then accepts work again', async () => {
    const jobs = Array.from({ length: 17 }, (_, index) =>
      index % 2 ? verifyPassword('synthetic-password') : hashPassword('synthetic-password'),
    );
    await expect(hashPassword('synthetic-overflow')).rejects.toMatchObject({
      status: 503,
      code: 'AUTH_UNAVAILABLE',
    });
    expect(worker.maximumActive).toBe(1);
    for (let index = 0; index < jobs.length; index++) await complete();
    expect(await Promise.all(jobs)).toHaveLength(17);
    expect(worker.maximumActive).toBe(1);
    const next = hashPassword('synthetic-next');
    await Promise.resolve();
    await complete();
    expect(await next).toMatch(/^scrypt\$/);
  });

  it('releases the slot after a worker callback failure without exposing diagnostics', async () => {
    const first = hashPassword('synthetic-first');
    const result = expect(first).rejects.toMatchObject({
      status: 503,
      code: 'AUTH_UNAVAILABLE',
      message: '认证服务繁忙，请稍后重试',
    });
    const second = hashPassword('synthetic-second');
    await Promise.resolve();
    await complete(new Error('private-worker-diagnostic'));
    await result;
    await complete();
    expect(await second).toMatch(/^scrypt\$/);
    expect(worker.maximumActive).toBe(1);
  });

  it('releases a slot after a synchronous worker exception', async () => {
    worker.throwSynchronously = true;
    const failure = await hashPassword('synthetic-first').catch((error: unknown) => error);
    expect(failure).toMatchObject({
      status: 503,
      code: 'AUTH_UNAVAILABLE',
      message: '认证服务繁忙，请稍后重试',
    });
    expect((failure as Error).cause).toBeUndefined();
    expect(String(failure)).not.toContain('private-worker-diagnostic');
    const next = hashPassword('synthetic-next');
    await Promise.resolve();
    await complete();
    expect(await next).toMatch(/^scrypt\$/);
  });
});
