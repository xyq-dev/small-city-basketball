import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { FfmpegMediaExecutor, LivePreflightError } from './live-media-executor.js';
const processWatch = vi.hoisted(() => ({
  onFfmpeg: undefined as ((child: import('node:child_process').ChildProcess) => void) | undefined,
}));
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  return {
    ...real,
    spawn: (...args: any[]) => {
      const child = (real.spawn as (...args: any[]) => import('node:child_process').ChildProcess)(
        ...args,
      );
      if (/(?:^|\/)ffmpeg$/.test(String(args[0]))) processWatch.onFfmpeg?.(child);
      return child;
    },
  };
});
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
  it.skipIf(!hasFfmpeg)(
    'waits for the actual FFmpeg child close before an aborted transform settles and leaves no ready or partial output',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'scb-e02-stop-'));
      try {
        const file = randomUUID() + '.mp4';
        expect(
          spawnSync(
            'ffmpeg',
            [
              '-hide_banner',
              '-loglevel',
              'error',
              '-f',
              'lavfi',
              '-i',
              'testsrc=size=320x240:rate=30',
              '-t',
              '2',
              '-c:v',
              'libx264',
              '-threads',
              '1',
              '-pix_fmt',
              'yuv420p',
              '-y',
              join(root, file),
            ],
            { stdio: 'ignore' },
          ).status,
        ).toBe(0);
        const e = new FfmpegMediaExecutor({
            root,
            ffmpeg: '/usr/bin/ffmpeg',
            ffprobe: '/usr/bin/ffprobe',
            fontFile: '/unused/font',
            inputHosts: [],
            targetHosts: [],
          }),
          controller = new AbortController();
        let child: import('node:child_process').ChildProcess | undefined,
          closed = false;
        processWatch.onFfmpeg = (p) => {
          child = p;
          p.once('close', () => {
            closed = true;
          });
          p.once('spawn', () => controller.abort());
        };
        await expect(e.transform(file, [], controller.signal)).rejects.toThrow(
          'MEDIA_TRANSCODE_FAILED',
        );
        expect(child?.pid).toBeGreaterThan(0);
        expect(closed).toBe(true);
        expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true);
        expect(await readdir(root)).toEqual([file]);
      } finally {
        processWatch.onFfmpeg = undefined;
        await rm(root, { recursive: true, force: true });
      }
    },
    30000,
  );
  it('classifies only failed preflight as proof that no publishing child existed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scb-e01-preflight-'));
    let launched = false;
    try {
      processWatch.onFfmpeg = () => {
        launched = true;
      };
      const e = new FfmpegMediaExecutor({
        root,
        ffmpeg: '/usr/bin/ffmpeg',
        ffprobe: '/usr/bin/ffprobe',
        fontFile: join(root, 'missing-font'),
        inputHosts: ['source.example.com'],
        targetHosts: ['relay.example.com'],
      });
      await expect(
        e.start({
          operationKey: 'preflight',
          inputUrl: 'https://source.example.com/owned.flv',
          targetUrl: 'rtmps://relay.example.com/live/synthetic-private-key',
          maximumSeconds: 60,
          readScore: async () => '',
        }),
      ).rejects.toBeInstanceOf(LivePreflightError);
      expect(launched).toBe(false);
      expect(await e.observe('preflight')).toBe('UNKNOWN');
    } finally {
      processWatch.onFfmpeg = undefined;
      await rm(root, { recursive: true, force: true });
    }
  });
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
