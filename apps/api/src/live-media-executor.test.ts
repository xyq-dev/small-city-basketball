import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { FfmpegMediaExecutor } from './live-media-executor.js';
const hasFfmpeg =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
describe('E02 actual bounded FFmpeg artifact pipeline', () => {
  it.skipIf(!hasFfmpeg)(
    'produces independently probed MP4 and actual event clips, without a network or shell',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'scb-e02-'));
      try {
        const file = randomUUID() + '.mp4';
        const result = spawnSync(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            'testsrc=size=160x120:rate=10',
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=440:sample_rate=44100',
            '-t',
            '2',
            '-c:v',
            'libx264',
            '-threads',
            '1',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-y',
            join(root, file),
          ],
          { stdio: 'ignore' },
        );
        expect(result.status).toBe(0);
        const e = new FfmpegMediaExecutor({
          root,
          ffmpeg: '/usr/bin/ffmpeg',
          ffprobe: '/usr/bin/ffprobe',
          fontFile: '/unused/font',
          inputHosts: [],
          targetHosts: [],
        });
        const transcode = await e.transform(file, []);
        expect(transcode.durationMs).toBeGreaterThanOrEqual(1900);
        expect(transcode.sha256).toBe(
          createHash('sha256')
            .update(await readFile(join(root, transcode.fileName)))
            .digest('hex'),
        );
        const clip = await e.transform(transcode.fileName, [
          { startMs: 0, endMs: 500 },
          { startMs: 1000, endMs: 1500 },
        ]);
        expect(clip.durationMs).toBeGreaterThanOrEqual(900);
        expect(clip.durationMs).toBeLessThan(1600);
        expect((await e.probe(clip.fileName)).audio).toBe(true);
        await expect(e.transform(file, [{ startMs: 0, endMs: 99999 }])).rejects.toThrow(
          'MEDIA_INTERVAL_INVALID',
        );
        await expect(e.file('../outside.mp4')).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30000,
  );
  it('rejects symlink and malformed artifacts and never claims a missing old process stopped', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scb-e02-'));
    try {
      const e = new FfmpegMediaExecutor({
        root,
        ffmpeg: '/usr/bin/ffmpeg',
        ffprobe: '/usr/bin/ffprobe',
        fontFile: '/unused/font',
        inputHosts: [],
        targetHosts: [],
      });
      const name = randomUUID() + '.mp4';
      await writeFile(join(root, 'outside'), 'secret');
      await symlink(join(root, 'outside'), join(root, name));
      await expect(e.file(name)).rejects.toThrow('MEDIA_ARTIFACT_INVALID');
      expect(await e.stop('old-worker')).toBe(false);
      expect(await e.observe('old-worker')).toBe('UNKNOWN');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
