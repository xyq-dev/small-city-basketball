import { accessSync, constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { readRequiredSecret } from './env.js';
import { FfmpegMediaExecutor } from './live-media-executor.js';
import { TencentCssIngress } from './streaming-provider.js';
import type { StreamingOptions, StreamingTargetTemplate } from './streaming-service.js';
const flag = (name: string) => {
  const v = process.env[name];
  if (v !== undefined && v !== 'true' && v !== 'false')
    throw Error('Invalid streaming configuration');
  return v === 'true';
};
const required = (name: string) => {
  const v = process.env[name];
  if (!v || v !== v.trim()) throw Error('Incomplete streaming configuration');
  return v;
};
const integer = (name: string) => {
  const v = required(name);
  if (!/^\d{1,7}$/.test(v)) throw Error('Invalid streaming price configuration');
  return Number(v);
};
const executable = (name: string, fallback: string, mode: number) => {
  const p = process.env[name] ?? fallback;
  if (!isAbsolute(p)) throw Error('Streaming executable paths must be absolute');
  accessSync(p, mode);
  return p;
};
/** Construct real adapters only after explicit operator configuration; reading this does not create cloud resources. */
export function readStreamingOptions(
  authorizeRecording?: StreamingOptions['authorizeRecording'],
): StreamingOptions {
  if (!flag('SCB_STREAMING_ENABLED')) return { autoDispatch: false, authorizeRecording };
  let templates: StreamingTargetTemplate[];
  try {
    const raw = JSON.parse(required('SCB_STREAMING_TARGETS_JSON'));
    const keys = [
      'key',
      'orgId',
      'platform',
      'host',
      'appPath',
      'accountSlot',
      'verifiedUntil',
      'fenPerMinute',
    ];
    if (
      !Array.isArray(raw) ||
      raw.length < 1 ||
      raw.length > 20 ||
      raw.some(
        (t) =>
          !t ||
          typeof t !== 'object' ||
          Object.keys(t).some((k) => !keys.includes(k)) ||
          keys.some((k) => !(k in t)),
      )
    )
      throw Error();
    templates = raw;
  } catch {
    throw Error('Invalid organization-bound streaming targets');
  }
  const pushHost = required('SCB_CSS_PUSH_HOST'),
    playbackHost = required('SCB_CSS_PLAYBACK_HOST');
  const protocol = process.env.SCB_CSS_PUSH_PROTOCOL ?? 'rtmp:';
  if (protocol !== 'rtmp:' && protocol !== 'rtmps:') throw Error('Invalid CSS push protocol');
  const ingress = new TencentCssIngress({
    pushHost,
    playbackHost,
    appName: required('SCB_CSS_APP_NAME'),
    pushKey: readRequiredSecret('SCB_CSS_PUSH_KEY'),
    playbackKey: readRequiredSecret('SCB_CSS_PLAYBACK_KEY'),
    secretId: readRequiredSecret('SCB_CSS_SECRET_ID'),
    secretKey: readRequiredSecret('SCB_CSS_SECRET_KEY'),
    pushProtocol: protocol,
  });
  const root = required('SCB_LIVE_MEDIA_ROOT');
  if (!isAbsolute(root) || root === '/') throw Error('Invalid dedicated live media root');
  const executor = new FfmpegMediaExecutor({
    root,
    ffmpeg: executable('SCB_FFMPEG_PATH', '/usr/bin/ffmpeg', constants.X_OK),
    ffprobe: executable('SCB_FFPROBE_PATH', '/usr/bin/ffprobe', constants.X_OK),
    fontFile: executable(
      'SCB_STREAM_FONT_PATH',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      constants.R_OK,
    ),
    inputHosts: [playbackHost],
    targetHosts: [...new Set(templates.map((t) => t.host))],
  });
  return {
    encryptionKey: readRequiredSecret('SCB_STREAMING_DATA_KEY'),
    templates,
    ingress,
    executor,
    capabilitiesVerified: flag('SCB_STREAMING_CAPABILITIES_VERIFIED'),
    baseFenPerMinute: integer('SCB_STREAMING_BASE_FEN_PER_MINUTE'),
    autoDispatch: true,
    authorizeRecording,
  };
}
