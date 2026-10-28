import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Operational MJS entrypoint is also used by the packaged runtime.
import { cleanupMedia, mediaCleanupOptions } from '../../../ops/db/media-cleanup.mjs';

describe('bounded media upload maintenance', () => {
  it('uses one bounded batch and optionally one organization', () => {
    expect(mediaCleanupOptions({})).toEqual({ orgId: null, limit: 20 });
    expect(
      mediaCleanupOptions({
        SCB_MEDIA_CLEANUP_LIMIT: '500',
        SCB_MEDIA_CLEANUP_ORG_ID: '11111111-1111-4111-8111-111111111111',
      }),
    ).toEqual({ orgId: '11111111-1111-4111-8111-111111111111', limit: 500 });
    for (const limit of ['0', '-1', '501', '1.5', '1e2', '', ' 1'])
      expect(() => mediaCleanupOptions({ SCB_MEDIA_CLEANUP_LIMIT: limit })).toThrow();
    expect(() => mediaCleanupOptions({ SCB_MEDIA_CLEANUP_ORG_ID: '*' })).toThrow();
  });

  it('refuses elevated identities before connecting or loading the compiled service', async () => {
    await expect(
      cleanupMedia({ DATABASE_URL: 'postgresql://scb_admin:synthetic-secret@127.0.0.1/scb_test' }),
    ).rejects.toThrow('Database configuration is invalid');
  });

  it('does not print credentials or accept connection arguments on failure', () => {
    const cli = fileURLToPath(new URL('../../../ops/db/media-cleanup.mjs', import.meta.url));
    for (const args of [[], ['secret-argument']]) {
      const result = spawnSync(process.execPath, [cli, ...args], {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          NODE_NO_WARNINGS: '1',
          DATABASE_URL: 'postgresql://scb_admin:synthetic-private-marker@127.0.0.1/scb_test',
          DATABASE_URL_FILE: undefined,
          SCB_MEDIA_CLEANUP_LIMIT: '20',
          SCB_MEDIA_CLEANUP_ORG_ID: undefined,
        },
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe('media-cleanup failed');
    }
  });
});
