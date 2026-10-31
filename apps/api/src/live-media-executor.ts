import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, lstat, mkdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { endpoint } from './streaming-domain.js';
import { secureInput, pinnedRtmp } from './streaming-provider.js';
import type { RelayObserved } from '../../../packages/contracts/streaming.js';
/** This failure proves no publishing subprocess was ever spawned for this operation. */
export class LivePreflightError extends Error {
  constructor() {
    super('STREAM_PREFLIGHT_FAILED');
    this.name = 'LivePreflightError';
  }
}
export interface MediaExecutorOptions {
  root: string;
  ffmpeg: string;
  ffprobe: string;
  fontFile: string;
  inputHosts: readonly string[];
  targetHosts: readonly string[];
}
export interface ArtifactResult {
  fileName: string;
  sha256: string;
  byteLength: number;
  durationMs: number;
}
export interface MediaProbe {
  durationMs: number;
  audio: boolean;
}
export interface RelayRun {
  operationKey: string;
  inputUrl: string;
  targetUrl: string;
  maximumSeconds: number;
  readScore: () => Promise<string>;
}
export interface LiveExecutor {
  readonly enabled: boolean;
  start(run: RelayRun): Promise<void>;
  stop(key: string): Promise<boolean>;
  observe(key: string): Promise<RelayObserved>;
}
export interface MediaExecutor {
  readonly enabled: boolean;
  record(inputUrl: string, maximumSeconds: number, signal: AbortSignal): Promise<ArtifactResult>;
  transform(
    fileName: string,
    intervals: { startMs: number; endMs: number }[],
    signal?: AbortSignal,
  ): Promise<ArtifactResult>;
  probe(fileName: string): Promise<MediaProbe>;
  file(fileName: string): Promise<string>;
  discard(fileName: string): Promise<void>;
}
async function processRun(
  binary: string,
  args: string[],
  input?: Readable,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, stdio: ['pipe', 'pipe', 'ignore'], signal });
    let bytes = 0;
    let failed = false;
    const chunks: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => {
      bytes += b.length;
      if (bytes > 262144) {
        child.kill('SIGKILL');
        return;
      }
      chunks.push(b);
    });
    child.on('error', () => {
      failed = true;
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      timer.unref();
    });
    child.on('close', (code) =>
      !failed && code === 0 && bytes <= 262144
        ? resolve(Buffer.concat(chunks).toString('utf8'))
        : reject(Error('MEDIA_PROCESS_FAILED')),
    );
    if (input) {
      void pipeline(input, child.stdin!).catch(() => child.kill('SIGTERM'));
    } else child.stdin.end();
  });
}
const idFile = (name: string) => /^[a-f0-9-]{36}\.mp4$/.test(name) && basename(name) === name;
const escaped = (name: string) =>
  name.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
export class FfmpegMediaExecutor implements LiveExecutor, MediaExecutor {
  readonly enabled = true;
  private readonly relays = new Map<
    string,
    { state: RelayObserved; stop: () => Promise<boolean> }
  >();
  constructor(private readonly options: MediaExecutorOptions) {
    if (!options.root || !options.ffmpeg || !options.ffprobe || !options.fontFile)
      throw Error('Invalid media executor configuration');
  }
  private async root() {
    await mkdir(this.options.root, { recursive: true, mode: 0o700 });
    const p = await realpath(this.options.root);
    if (p !== resolve(this.options.root)) throw Error('MEDIA_ROOT_UNSAFE');
    return p;
  }
  async file(name: string) {
    if (!idFile(name)) throw Error('MEDIA_ARTIFACT_INVALID');
    const p = join(await this.root(), name),
      s = await lstat(p);
    if (!s.isFile() || s.isSymbolicLink() || (await realpath(p)) !== p)
      throw Error('MEDIA_ARTIFACT_INVALID');
    return p;
  }
  async discard(name: string) {
    await unlink(await this.file(name));
  }
  private async inspect(path: string): Promise<MediaProbe> {
    const raw = await processRun(this.options.ffprobe, [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type',
      '-of',
      'json',
      path,
    ]);
    const p = JSON.parse(raw),
      durationMs = Math.round(Number(p.format?.duration) * 1000);
    if (
      !Number.isInteger(durationMs) ||
      durationMs < 1 ||
      durationMs > 14400000 ||
      !p.streams?.some((s: any) => s.codec_type === 'video')
    )
      throw Error('MEDIA_ARTIFACT_INVALID');
    return { durationMs, audio: p.streams.some((s: any) => s.codec_type === 'audio') };
  }
  async probe(name: string) {
    return this.inspect(await this.file(name));
  }
  private async artifact(path: string, id: string): Promise<ArtifactResult> {
    const p = await this.inspect(path),
      s = await stat(path);
    if (s.size < 1 || s.size > 21474836480) throw Error('MEDIA_ARTIFACT_INVALID');
    const hash = createHash('sha256');
    for await (const b of createReadStream(path)) hash.update(b);
    const fileName = id + '.mp4';
    await rename(path, join(await this.root(), fileName));
    return { fileName, sha256: hash.digest('hex'), byteLength: s.size, durationMs: p.durationMs };
  }
  async record(inputUrl: string, maximumSeconds: number, signal: AbortSignal) {
    if (!Number.isInteger(maximumSeconds) || maximumSeconds < 1 || maximumSeconds > 14400)
      throw Error('MEDIA_DURATION_INVALID');
    const input = await secureInput(endpoint(inputUrl, 'https:', this.options.inputHosts)),
      id = randomUUID(),
      path = join(await this.root(), id + '.part.mp4');
    try {
      await processRun(
        this.options.ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-protocol_whitelist',
          'pipe,file',
          '-i',
          'pipe:0',
          '-t',
          String(maximumSeconds),
          '-map',
          '0:v:0',
          '-map',
          '0:a?',
          '-c:v',
          'libx264',
          '-threads',
          '1',
          '-preset',
          'veryfast',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          '-fs',
          '21474836480',
          '-y',
          path,
        ],
        input,
        signal,
      );
      return await this.artifact(path, id);
    } catch {
      if (signal.aborted) {
        try {
          return await this.artifact(path, id);
        } catch {
          /* A partial file is ready only after an actual successful probe. */
        }
      }
      await unlink(path).catch(() => {});
      throw Error('MEDIA_RECORDING_FAILED');
    } finally {
      input.destroy();
    }
  }
  async transform(
    fileName: string,
    intervals: { startMs: number; endMs: number }[],
    signal?: AbortSignal,
  ): Promise<ArtifactResult> {
    const source = await this.file(fileName),
      probe = await this.inspect(source),
      id = randomUUID(),
      path = join(await this.root(), id + '.part.mp4');
    if (
      intervals.length > 60 ||
      intervals.some(
        (r) =>
          !Number.isInteger(r.startMs) ||
          !Number.isInteger(r.endMs) ||
          r.startMs < 0 ||
          r.endMs <= r.startMs ||
          r.endMs > probe.durationMs,
      ) ||
      intervals.reduce((n, r) => n + r.endMs - r.startMs, 0) > 600000
    )
      throw Error('MEDIA_INTERVAL_INVALID');
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-protocol_whitelist',
      'file,pipe',
      '-i',
      source,
    ];
    if (intervals.length) {
      const filters: string[] = [];
      intervals.forEach((r, i) => {
        filters.push(
          `[0:v]trim=start=${r.startMs / 1000}:end=${r.endMs / 1000},setpts=PTS-STARTPTS[v${i}]`,
        );
        if (probe.audio)
          filters.push(
            `[0:a]atrim=start=${r.startMs / 1000}:end=${r.endMs / 1000},asetpts=PTS-STARTPTS[a${i}]`,
          );
      });
      filters.push(
        intervals.map((_r, i) => `[v${i}]${probe.audio ? `[a${i}]` : ''}`).join('') +
          `concat=n=${intervals.length}:v=1:a=${probe.audio ? 1 : 0}[v]${probe.audio ? '[a]' : ''}`,
      );
      args.push('-filter_complex', filters.join(';'), '-map', '[v]');
      if (probe.audio) args.push('-map', '[a]');
    } else args.push('-map', '0:v:0', '-map', '0:a?');
    args.push(
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      '-fs',
      '21474836480',
      '-y',
      path,
    );
    try {
      await processRun(
        this.options.ffmpeg,
        args,
        undefined,
        signal
          ? AbortSignal.any([signal, AbortSignal.timeout(300000)])
          : AbortSignal.timeout(300000),
      );
      return await this.artifact(path, id);
    } catch {
      await unlink(path).catch(() => {});
      throw Error('MEDIA_TRANSCODE_FAILED');
    }
  }
  private async livePreflight(run: RelayRun) {
    let transport: Awaited<ReturnType<typeof pinnedRtmp>> | undefined;
    let input: Awaited<ReturnType<typeof secureInput>> | undefined;
    let scoreFile: string | undefined;
    try {
      if (
        !Number.isInteger(run.maximumSeconds) ||
        run.maximumSeconds < 1 ||
        run.maximumSeconds > 14400
      )
        throw Error();
      const source = endpoint(run.inputUrl, 'https:', this.options.inputHosts),
        target = endpoint(run.targetUrl, 'rtmps:', this.options.targetHosts);
      await access(this.options.fontFile);
      transport = await pinnedRtmp(target);
      input = await secureInput(source);
      scoreFile = join(await this.root(), randomUUID() + '.score.txt');
      await writeFile(scoreFile, await run.readScore(), { mode: 0o600 });
      return { transport, input, scoreFile };
    } catch {
      input?.destroy();
      await transport?.close();
      if (scoreFile) await unlink(scoreFile).catch(() => {});
      throw new LivePreflightError();
    }
  }
  async start(run: RelayRun): Promise<void> {
    if (this.relays.has(run.operationKey)) return;
    const { transport, input, scoreFile } = await this.livePreflight(run);
    const sourceInput = input;
    let exited = false,
      closing = false,
      lastFrame = Date.now(),
      frame = -1,
      ticking = false;
    const child = spawn(
      this.options.ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        'pipe:0',
        '-t',
        String(run.maximumSeconds),
        '-vf',
        `drawtext=fontfile='${escaped(this.options.fontFile)}':textfile='${escaped(scoreFile)}':reload=1:expansion=none:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.65:x=20:y=20`,
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-preset',
        'veryfast',
        '-tune',
        'zerolatency',
        '-c:a',
        'aac',
        '-progress',
        'pipe:3',
        '-rtmp_tcurl',
        transport.tcUrl,
        '-f',
        'flv',
        transport.localUrl,
      ],
      { shell: false, stdio: ['pipe', 'ignore', 'ignore', 'pipe'] },
    );
    let closeResolve: () => void;
    const closed = new Promise<void>((r) => {
      closeResolve = r;
    });
    const record = { state: 'STARTING' as RelayObserved, stop: async () => false };
    child.on('error', () => {
      record.state = 'UNKNOWN';
    });
    child.on('close', () => {
      exited = true;
      closing = true;
      clearInterval(timer);
      sourceInput.destroy();
      void transport.close();
      void unlink(scoreFile).catch(() => {});
      record.state = 'STOPPED';
      closeResolve();
    });
    child.stdio[3]?.on('data', (b: Buffer) => {
      for (const line of b.toString('utf8').split('\n'))
        if (/^frame=\d+$/.test(line)) {
          const n = Number(line.slice(6));
          if (n > frame) {
            frame = n;
            lastFrame = Date.now();
            if (n > 0 && !closing) record.state = 'CONNECTED';
          }
        }
    });
    void pipeline(sourceInput, child.stdin!).catch(() => {
      if (!closing) record.state = 'FAILED';
      child.kill('SIGTERM');
    });
    const stop = async () => {
      closing = true;
      record.state = exited ? 'STOPPED' : 'STOPPING';
      clearInterval(timer);
      sourceInput.destroy();
      await transport.close();
      if (!exited) {
        child.kill('SIGTERM');
        await Promise.race([closed, new Promise<void>((r) => setTimeout(r, 2000))]);
      }
      if (!exited) {
        child.kill('SIGKILL');
        await Promise.race([closed, new Promise<void>((r) => setTimeout(r, 2000))]);
      }
      await unlink(scoreFile).catch(() => {});
      if (exited) record.state = 'STOPPED';
      else record.state = 'UNKNOWN';
      return exited;
    };
    const timer = setInterval(() => {
      if (ticking || closing) return;
      ticking = true;
      void (async () => {
        try {
          if (Date.now() - lastFrame > 10000) throw Error();
          const text = await run.readScore();
          if (closing) return;
          await writeFile(scoreFile + '.next', text, { mode: 0o600 });
          await rename(scoreFile + '.next', scoreFile);
        } catch {
          await writeFile(scoreFile, '').catch(() => {});
          await stop();
        } finally {
          ticking = false;
        }
      })();
    }, 1000);
    timer.unref();
    record.stop = stop;
    this.relays.set(run.operationKey, record);
  }
  async stop(key: string) {
    const r = this.relays.get(key);
    return r ? r.stop() : false;
  }
  async observe(key: string): Promise<RelayObserved> {
    return this.relays.get(key)?.state ?? 'UNKNOWN';
  }
}
