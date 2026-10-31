import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { ApiError } from './errors.js';
import { objectInput, resourceId } from './validation.js';
import type { LiveDesired, RelayObserved } from '../../../packages/contracts/streaming.js';
export const liveFail = (code: string, message = '直播操作无法完成', status = 409): never => {
  throw new ApiError(status, code, message);
};
export const streamHash = (v: string) => createHash('sha256').update(v).digest('hex');
export function streamKey(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9+/]{43}=$/.test(value) ||
    Buffer.from(value, 'base64').toString('base64') !== value
  )
    throw Error('Invalid streaming encryption configuration');
  return Buffer.from(value, 'base64');
}
export function sealStreamSecret(key: Buffer, id: string, value: string): Buffer {
  const iv = randomBytes(12),
    c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from('scb-stream:v1:' + id));
  const body = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}
export function openStreamSecret(key: Buffer, id: string, body: Buffer): string {
  if (!Buffer.isBuffer(body) || body.length < 29) throw Error('Invalid streaming credential');
  const d = createDecipheriv('aes-256-gcm', key, body.subarray(0, 12));
  d.setAAD(Buffer.from('scb-stream:v1:' + id));
  d.setAuthTag(body.subarray(12, 28));
  return Buffer.concat([d.update(body.subarray(28)), d.final()]).toString('utf8');
}
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const p = address.split('.').map(Number),
      a = p[0]!,
      b = p[1]!;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || b === 2)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }
  if (family === 6) {
    const a = address.toLowerCase();
    return (
      /^2[0-9a-f]{3}:/.test(a) &&
      !a.startsWith('2001:db8:') &&
      !a.startsWith('2001:0:') &&
      !a.startsWith('2002:') &&
      !a.includes('.')
    );
  }
  return false;
}
export function endpoint(
  value: string,
  protocol: 'https:' | 'rtmps:',
  hosts: readonly string[],
): URL {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return liveFail('STREAM_ENDPOINT_INVALID', '媒体端点不合法', 422);
  }
  if (
    u.protocol !== protocol ||
    u.username ||
    u.password ||
    u.hash ||
    (u.port && u.port !== (protocol === 'https:' ? '443' : '443')) ||
    !hosts.includes(u.hostname) ||
    isIP(u.hostname) ||
    /[\u0000-\u0020\\]/.test(value)
  )
    liveFail('STREAM_ENDPOINT_INVALID', '仅可使用已核验媒体端点', 422);
  return u;
}
export function parseStreamingCommand(raw: unknown) {
  const b = objectInput(raw, [
    'clientRequestId',
    'type',
    'expectedVersion',
    'sessionId',
    'channelIds',
    'maximumSeconds',
    'budgetFen',
    'record',
    'deviceId',
    'leaseToken',
    'channelId',
    'reason',
  ]);
  resourceId(String(b.clientRequestId));
  if (
    ![
      'CREATE',
      'APPROVE',
      'START',
      'HEARTBEAT',
      'PAUSE',
      'STOP',
      'RECONNECT_TARGET',
      'STOP_TARGET',
      'REVOKE',
    ].includes(String(b.type))
  )
    liveFail('INVALID_STREAM_COMMAND', '请检查直播操作', 422);
  if (b.type !== 'CREATE') {
    resourceId(String(b.sessionId));
    if (!Number.isInteger(b.expectedVersion) || Number(b.expectedVersion) < 1)
      liveFail('INVALID_STREAM_COMMAND', '请检查资料版本', 422);
  }
  if (b.type === 'CREATE') {
    if (
      !Array.isArray(b.channelIds) ||
      b.channelIds.length < 1 ||
      b.channelIds.length > 3 ||
      new Set(b.channelIds).size !== b.channelIds.length
    )
      liveFail('INVALID_STREAM_COMMAND', '请选择1至3个已核验渠道', 422);
    (b.channelIds as unknown[]).forEach((id) => resourceId(String(id)));
    if (
      !Number.isInteger(b.maximumSeconds) ||
      Number(b.maximumSeconds) < 30 ||
      Number(b.maximumSeconds) > 14400 ||
      !Number.isInteger(b.budgetFen) ||
      Number(b.budgetFen) < 1 ||
      Number(b.budgetFen) > 1000000 ||
      typeof b.record !== 'boolean'
    )
      liveFail('INVALID_STREAM_COMMAND', '请设置有效时长和费用上限', 422);
  }
  if (['START', 'HEARTBEAT'].includes(String(b.type))) resourceId(String(b.deviceId));
  if (
    b.type === 'HEARTBEAT' &&
    (typeof b.leaseToken !== 'string' || !/^[a-f0-9]{64}$/.test(b.leaseToken))
  )
    liveFail('INVALID_STREAM_COMMAND', '采集租约失效', 422);
  if (['RECONNECT_TARGET', 'STOP_TARGET'].includes(String(b.type))) resourceId(String(b.channelId));
  if (
    ['APPROVE', 'STOP', 'PAUSE', 'REVOKE'].includes(String(b.type)) &&
    (typeof b.reason !== 'string' || b.reason.trim().length < 4 || b.reason.trim().length > 500)
  )
    liveFail('INVALID_STREAM_COMMAND', '请填写操作依据', 422);
  return b;
}
export function allowedObservation(
  desired: LiveDesired,
  epoch: number,
  observedEpoch: number,
  state: RelayObserved,
): boolean {
  return (
    epoch === observedEpoch && (state === 'STOPPED' || state === 'UNKNOWN' || desired === 'RUNNING')
  );
}
export interface ScoreSource {
  source_version: number;
  home_score: number;
  away_score: number;
  period: number;
  remaining_ms: number;
  clock_running: boolean;
  anchor_server_time: Date | string;
  clock_version: number;
}
export function scoreText(
  home: string,
  away: string,
  state: ScoreSource | null,
  nowMs: number,
): string {
  if (!state) return '比分更新中';
  if (
    ![
      state.home_score,
      state.away_score,
      state.period,
      state.remaining_ms,
      state.clock_version,
    ].every(Number.isInteger)
  )
    return liveFail('STREAM_SCORE_INVALID');
  const elapsed = state.clock_running
    ? Math.max(0, nowMs - new Date(state.anchor_server_time).getTime())
    : 0;
  const left = Math.max(0, state.remaining_ms - elapsed),
    seconds = Math.ceil(left / 1000);
  const safe = (v: string) => v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80);
  return `${safe(home)}  ${state.home_score} : ${state.away_score}  ${safe(away)}\n第${state.period}节  ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export interface HighlightSource {
  capturedAt: string;
  serverTime: string;
  effective: boolean;
}
export function highlightIntervals(
  events: HighlightSource[],
  anchorAt: string,
  offsetMs: number,
  durationMs: number,
) {
  if (
    !Number.isFinite(Date.parse(anchorAt)) ||
    !Number.isInteger(offsetMs) ||
    Math.abs(offsetMs) > 3600000 ||
    !Number.isInteger(durationMs) ||
    durationMs <= 0
  )
    liveFail('MEDIA_ANCHOR_REQUIRED', '先完成源PTS时间校准', 422);
  const ranges = events
    .filter(
      (e) => e.effective && Math.abs(Date.parse(e.serverTime) - Date.parse(e.capturedAt)) <= 2000,
    )
    .map((e) => ({
      startMs: Math.max(0, Date.parse(e.capturedAt) - Date.parse(anchorAt) + offsetMs - 3000),
      endMs: Math.min(
        durationMs,
        Date.parse(e.capturedAt) - Date.parse(anchorAt) + offsetMs + 5000,
      ),
    }))
    .filter((r) => r.endMs > r.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const out: typeof ranges = [];
  for (const r of ranges) {
    const last = out.at(-1);
    if (last && r.startMs <= last.endMs) last.endMs = Math.max(last.endMs, r.endMs);
    else out.push(r);
  }
  if (out.length > 60 || out.reduce((n, r) => n + r.endMs - r.startMs, 0) > 600000)
    liveFail('MEDIA_HIGHLIGHT_LIMIT', '集锦超出10分钟上限', 422);
  return out;
}
