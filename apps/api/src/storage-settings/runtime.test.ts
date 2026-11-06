import { describe, expect, test, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { createStorageSettingsResolver } from './runtime.js';

describe('storage configuration runtime resolver', () => {
  test('quarantine and unverifiable database stop before credentials or fallback', async () => {
    const fallback = vi.fn();
    for (const rows of [[{ blocked: true }], []]) {
      const c = { query: vi.fn().mockResolvedValue({ rows }) } as unknown as PoolClient;
      await expect(createStorageSettingsResolver({} as Pool, fallback)(c)).rejects.toMatchObject({
        code: 'MEDIA_STORAGE_UNAVAILABLE',
      });
      expect(c.query).toHaveBeenCalledTimes(1);
    }
    expect(fallback).not.toHaveBeenCalled();
  });
  test('only a positively empty active selection uses legacy environment', async () => {
    const fallback = vi.fn().mockReturnValue(undefined),
      c = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ blocked: false }] })
          .mockResolvedValueOnce({ rows: [{ active_revision_id: null }] }),
      } as unknown as PoolClient;
    await expect(createStorageSettingsResolver({} as Pool, fallback)(c)).resolves.toBeUndefined();
    expect(fallback).toHaveBeenCalledOnce();
    const broken = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ blocked: false }] })
        .mockRejectedValue(new Error('db unavailable')),
    } as unknown as PoolClient;
    await expect(createStorageSettingsResolver({} as Pool, fallback)(broken)).rejects.toThrow(
      'db unavailable',
    );
    expect(fallback).toHaveBeenCalledOnce();
  });
  test('invalid active configuration fails closed, never falling back', async () => {
    const fallback = vi.fn(),
      c = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ blocked: false }] })
          .mockResolvedValueOnce({
            rows: [{ id: 'synthetic', active_revision_id: 'synthetic', mode: 'COS', bucket: null }],
          }),
      } as unknown as PoolClient;
    await expect(createStorageSettingsResolver({} as Pool, fallback)(c)).rejects.toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    expect(fallback).not.toHaveBeenCalled();
    const missing = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ blocked: false }] })
        .mockResolvedValueOnce({ rows: [] }),
    } as unknown as PoolClient;
    await expect(
      createStorageSettingsResolver({} as Pool, fallback)(missing),
    ).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' });
    expect(fallback).not.toHaveBeenCalled();
  });
});
