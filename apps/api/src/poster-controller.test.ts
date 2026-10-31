import { describe, expect, test, vi } from 'vitest';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import type { PosterService } from './poster-service.js';
import { PosterController } from './poster-controller.js';
describe('X05 private poster content boundary', () => {
  test('uses current session on every download and emits only private image bytes', async () => {
    const bytes = Buffer.from('synthetic-png'),
      download = vi.fn().mockResolvedValue({
        bytes,
        contentType: 'image/png',
        filename: 'basketball-result-fixed.png',
      });
    const controller = new PosterController({ download } as unknown as PosterService),
      setHeader = vi.fn(),
      send = vi.fn();
    await controller.download(
      { headers: { cookie: 'current-session' } } as ApiRequest,
      'org',
      'event',
      'export',
      { setHeader, send } as unknown as Response,
    );
    expect(download).toHaveBeenCalledWith('current-session', 'org', 'event', 'export');
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(send).toHaveBeenCalledWith(bytes);
  });
});
