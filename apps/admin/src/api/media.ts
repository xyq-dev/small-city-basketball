import type { ApiClient } from './client';
import { ApiError } from './client';
import type {
  CreateMatchMediaInput,
  CreateMediaMarkerInput,
  EntryFilesData,
  MatchMediaCommandInput,
  MatchMediaData,
  MatchMediaWorkspaceData,
  MediaFileCommandInput,
  MediaFileData,
  MediaMarkerData,
  PublicMatchMediaData,
  UploadMediaFileInput,
} from '@small-city-basketball/contracts';
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const id = (v: unknown) => typeof v === 'string' && v.length > 0;
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const exact = (v: unknown, keys: string[]): v is Obj =>
  obj(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const bools = (v: unknown, keys: string[]) =>
  obj(v) && keys.every((k) => typeof v[k] === 'boolean');
const file = (v: unknown) =>
  obj(v) &&
  ['id', 'purpose', 'fileName', 'contentType', 'sha256', 'createdAt'].every((k) => id(v[k])) &&
  count(v.byteLength) &&
  count(v.version) &&
  ['ACTIVE', 'REVOKED', 'PURGED'].includes(String(v.status));
const marker = (v: unknown) =>
  obj(v) &&
  ['id', 'label', 'sourceEventId', 'confirmationId'].every((k) => id(v[k])) &&
  ['startMs', 'endMs', 'sourceSeq', 'sourceMatchVersion'].every((k) => count(v[k])) &&
  ['CURRENT', 'STALE'].includes(String(v.sourceStatus));
const item = (v: unknown) =>
  obj(v) &&
  id(v.id) &&
  id(v.title) &&
  count(v.version) &&
  ['IMAGE', 'VIDEO', 'EXTERNAL_LINK'].includes(String(v.kind)) &&
  ['DRAFT', 'PUBLISHED', 'REVOKED'].includes(String(v.status)) &&
  Array.isArray(v.markers) &&
  v.markers.every(marker);
const usage = (v: unknown) =>
  obj(v) && count(v.usedBytes) && v.limitBytes === 134217728 && v.maxFileBytes === 8388608;
function check<T>(v: unknown, guard: (v: unknown) => boolean): T {
  if (!guard(v)) throw new ApiError(200, 'INVALID_RESPONSE', '媒体资料格式不完整，请重新读取');
  return structuredClone(v) as T;
}
export function createMediaApi(
  client: ApiClient,
  org: string,
  scope: 'entries' | 'matches',
  resourceId: string,
) {
  if (!org.trim() || !resourceId.trim())
    throw new ApiError(0, 'INVALID_ORGANIZATION', '请选择有效机构与资料资源');
  const base = `/v1/orgs/${encodeURIComponent(org)}/${scope}/${encodeURIComponent(resourceId)}`;
  async function request<T>(suffix: string, guard: (v: unknown) => boolean, input?: unknown) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      return check<T>(
        (
          await client.request<unknown>(base + suffix, {
            signal: controller.signal,
            ...(input === undefined ? {} : { method: 'POST', body: JSON.stringify(input) }),
          })
        ).data,
        guard,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    entry: () =>
      request<EntryFilesData>(
        '/media-files',
        (v) =>
          obj(v) &&
          v.entryId === resourceId &&
          count(v.entryVersion) &&
          Array.isArray(v.files) &&
          v.files.every(file) &&
          usage(v.usage) &&
          bools(v.capabilities, ['canUpload', 'canRevoke', 'canPurge']),
      ),
    match: () =>
      request<MatchMediaWorkspaceData>(
        '/media',
        (v) =>
          obj(v) &&
          v.matchId === resourceId &&
          id(v.eventId) &&
          Array.isArray(v.files) &&
          v.files.every(file) &&
          Array.isArray(v.media) &&
          v.media.every(item) &&
          Array.isArray(v.sourceEvents) &&
          v.sourceEvents.every((e) => obj(e) && id(e.id) && count(e.seq) && id(e.type)) &&
          Array.isArray(v.trustedExternalHosts) &&
          v.trustedExternalHosts.every((h) => typeof h === 'string') &&
          usage(v.usage) &&
          bools(v.capabilities, ['canUpload', 'canManage', 'canPublish', 'canMark', 'canPurge']),
      ),
    upload: (input: UploadMediaFileInput) => request<MediaFileData>('/media-files', file, input),
    fileCommand: (id: string, input: MediaFileCommandInput) =>
      request<MediaFileData>(`/media-files/${encodeURIComponent(id)}/commands`, file, input),
    contentPath: (id: string) => `${base}/media-files/${encodeURIComponent(id)}/content`,
    create: (input: CreateMatchMediaInput) => request<MatchMediaData>('/media', item, input),
    command: (id: string, input: MatchMediaCommandInput) =>
      request<MatchMediaData>(`/media/${encodeURIComponent(id)}/commands`, item, input),
    marker: (id: string, input: CreateMediaMarkerInput) =>
      request<MediaMarkerData>(`/media/${encodeURIComponent(id)}/markers`, marker, input),
  };
}
export async function readUploadFile(
  file: File,
): Promise<{ fileName: string; contentType: UploadMediaFileInput['contentType']; base64: string }> {
  if (!file.size || file.size > 8388608) throw new Error('请选择非空且不超过8MiB的文件');
  const mime =
    file.type ||
    (/\.pdf$/i.test(file.name)
      ? 'application/pdf'
      : /\.png$/i.test(file.name)
        ? 'image/png'
        : /\.jpe?g$/i.test(file.name)
          ? 'image/jpeg'
          : /\.mp4$/i.test(file.name)
            ? 'video/mp4'
            : '');
  if (!['application/pdf', 'image/png', 'image/jpeg', 'video/mp4'].includes(mime))
    throw new Error('只支持PDF、PNG、JPEG和MP4，禁止SVG');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败，请重新选择'));
    reader.onload = () => {
      const v = String(reader.result ?? '').split(',')[1];
      if (!v) reject(new Error('文件读取失败'));
      else resolve(v);
    };
    reader.readAsDataURL(file);
  });
  return { fileName: file.name, contentType: mime as UploadMediaFileInput['contentType'], base64 };
}
export function checkedPublicMedia(v: unknown, event: string, match: string): PublicMatchMediaData {
  const opaque = (x: unknown) => typeof x === 'string' && /^[A-Za-z0-9_-]{43}$/.test(x);
  const valid =
    exact(v, ['publicEventId', 'publicMatchId', 'media']) &&
    v.publicEventId === event &&
    v.publicMatchId === match &&
    Array.isArray(v.media) &&
    v.media.every((m) => {
      if (
        !exact(m, [
          'publicMediaId',
          'kind',
          'title',
          'contentPath',
          'contentType',
          'externalUrl',
          'externalNotice',
          'markers',
        ]) ||
        !opaque(m.publicMediaId) ||
        !id(m.title) ||
        !Array.isArray(m.markers)
      )
        return false;
      if (m.kind === 'EXTERNAL_LINK') {
        if (
          m.contentPath !== null ||
          m.contentType !== null ||
          typeof m.externalUrl !== 'string' ||
          !m.externalUrl.startsWith('https://') ||
          !id(m.externalNotice)
        )
          return false;
      } else if (
        !['IMAGE', 'VIDEO'].includes(String(m.kind)) ||
        m.contentPath !==
          `/v1/public/events/${encodeURIComponent(event)}/matches/${encodeURIComponent(match)}/media/${m.publicMediaId}/content` ||
        !(m.kind === 'VIDEO'
          ? m.contentType === 'video/mp4'
          : ['image/png', 'image/jpeg'].includes(String(m.contentType))) ||
        m.externalUrl !== null ||
        m.externalNotice !== null
      )
        return false;
      return m.markers.every(
        (s) =>
          exact(s, ['publicMarkerId', 'label', 'startMs', 'endMs']) &&
          opaque(s.publicMarkerId) &&
          id(s.label) &&
          count(s.startMs) &&
          count(s.endMs) &&
          Number(s.endMs) > Number(s.startMs),
      );
    });
  return check<PublicMatchMediaData>(v, () => valid);
}
export async function readPublicMedia(
  event: string,
  match: string,
  signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 20000);
  try {
    const response = await fetcher(
      `/v1/public/events/${encodeURIComponent(event)}/matches/${encodeURIComponent(match)}/media`,
      {
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    );
    if (!response.ok)
      throw new ApiError(
        [404, 410, 403].includes(response.status) ? 404 : response.status,
        [404, 410, 403].includes(response.status) ? 'PUBLIC_NOT_FOUND' : 'PUBLIC_UNAVAILABLE',
        '当前媒体不可用或公开授权已撤销',
      );
    const body: unknown = await response.json();
    if (!obj(body) || !obj(body.meta) || typeof body.meta.requestId !== 'string')
      throw new ApiError(200, 'INVALID_RESPONSE', '媒体资料格式不完整');
    return checkedPublicMedia(body.data, event, match);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
