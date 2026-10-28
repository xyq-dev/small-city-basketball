import { createHash } from 'node:crypto';
import type { MediaContentType } from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { MAX_MEDIA_FILE_BYTES, parseMediaUpload } from './media-domain.js';
import { invalid, objectInput, text } from './validation.js';

/**
 * C19 request identity rules shared with apps/wechat/utils/media-request.js (same known vectors
 * in both test suites). Strings are NFC-normalized and then trimmed by these new endpoints only:
 * the legacy C05 validation trims but does not normalize, and is left unchanged. Every fingerprint
 * field is the exact value these endpoints write.
 */
export const CHUNK_SIZE = 524288;
export const MAX_CHUNKS = MAX_MEDIA_FILE_BYTES / CHUNK_SIZE;
export const SESSION_TTL_HOURS = 24;
export const MAX_OPEN_SESSIONS_PER_USER = 2;
export const MAX_OPEN_SESSIONS_PER_ORG = 8;
export const CLEANUP_BATCH = 20;
export type MediaRequestOperation = 'MATCH_FILE_UPLOAD' | 'MATCH_MEDIA_CREATE';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const extensions: Record<string, RegExp> = {
  'image/png': /\.png$/i,
  'image/jpeg': /\.jpe?g$/i,
  'video/mp4': /\.mp4$/i,
};

export function requestFingerprint(
  operation: MediaRequestOperation,
  fields: (string | number | null)[],
): string {
  return createHash('sha256')
    .update(JSON.stringify(['v1', operation, ...fields]), 'utf8')
    .digest('hex');
}

/** NFC first, then the existing trim and length rule. */
export function normalizedText(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'string') return text(value, field, min, max);
  return text(value.normalize('NFC'), field, min, max);
}

export function clientRequestId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value))
    invalid('请求编号须为小写UUID v4', { clientRequestId: '请求编号无效' });
  return value;
}

export function sha256Hex(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    invalid('内容摘要须为64位小写十六进制SHA-256', { [field]: '摘要无效' });
  return value;
}

export const expectedChunkLength = (byteLength: number, index: number) => {
  const count = Math.ceil(byteLength / CHUNK_SIZE);
  return index < count - 1 ? CHUNK_SIZE : byteLength - CHUNK_SIZE * (count - 1);
};

/** Fixed file metadata of a match upload request (whole file or session). */
export function parseFileMetadata(input: Record<string, unknown>) {
  const purpose = input.purpose;
  if (purpose !== 'MATCH_IMAGE' && purpose !== 'MATCH_VIDEO') invalid('文件用途与当前资源不一致');
  const fileName = normalizedText(input.fileName, 'fileName', 1, 120);
  if (/[\\/\u0000-\u001f\u007f]/.test(fileName) || fileName === '.' || fileName === '..')
    invalid('文件名不能包含路径或控制字符');
  const contentType = input.contentType as MediaContentType;
  if (!Object.hasOwn(extensions, contentType) || !extensions[contentType]!.test(fileName))
    invalid('只支持与扩展名一致的PNG、JPEG或MP4');
  if (
    (purpose === 'MATCH_IMAGE' && contentType === 'video/mp4') ||
    (purpose === 'MATCH_VIDEO' && contentType !== 'video/mp4')
  )
    invalid('文件格式与用途不一致');
  const byteLength = input.byteLength;
  if (
    typeof byteLength !== 'number' ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > MAX_MEDIA_FILE_BYTES
  )
    invalid('文件不得为空或超过8MiB', { byteLength: '大小无效' });
  const contentSha256 = sha256Hex(input.contentSha256, 'contentSha256');
  const fingerprint = requestFingerprint('MATCH_FILE_UPLOAD', [
    purpose,
    fileName,
    contentType,
    byteLength,
    contentSha256,
  ]);
  return { purpose, fileName, contentType, byteLength, contentSha256, fingerprint };
}

/** POST …/media-file-requests: metadata plus the complete bytes, validated as the C05 upload. */
export function parseFileRequest(raw: unknown) {
  const input = objectInput(raw, [
    'clientRequestId',
    'purpose',
    'fileName',
    'contentType',
    'byteLength',
    'contentSha256',
    'contentBase64',
  ]);
  const id = clientRequestId(input.clientRequestId);
  const meta = parseFileMetadata(input);
  const checked = parseMediaUpload(
    {
      purpose: meta.purpose,
      fileName: meta.fileName,
      contentType: meta.contentType,
      base64: input.contentBase64,
    },
    'MATCH',
  );
  if (checked.payload.length !== meta.byteLength || checked.sha256 !== meta.contentSha256)
    invalid('文件长度或摘要与声明不一致');
  return { clientRequestId: id, ...meta, payload: checked.payload };
}

/** POST …/media-upload-sessions: metadata only; bytes arrive as chunks. */
export function parseSessionRequest(raw: unknown) {
  const input = objectInput(raw, [
    'clientRequestId',
    'purpose',
    'fileName',
    'contentType',
    'byteLength',
    'contentSha256',
  ]);
  return { clientRequestId: clientRequestId(input.clientRequestId), ...parseFileMetadata(input) };
}

export function chunkIndex(value: string): number {
  if (!/^(0|[1-9][0-9]?)$/.test(value) || Number(value) >= MAX_CHUNKS)
    throw new ApiError(404, 'RESOURCE_NOT_FOUND', '未找到可访问的资源');
  return Number(value);
}

/** PUT …/chunks/:index: one bounded chunk, its declared length and digest. */
export function parseChunk(raw: unknown) {
  const input = objectInput(raw, ['byteLength', 'sha256', 'contentBase64']);
  const byteLength = input.byteLength;
  if (
    typeof byteLength !== 'number' ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > CHUNK_SIZE
  )
    invalid('分片长度无效', { byteLength: '长度无效' });
  const sha256 = sha256Hex(input.sha256, 'sha256');
  const base64 = input.contentBase64;
  if (
    typeof base64 !== 'string' ||
    base64.length !== Math.ceil(byteLength / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    invalid('分片编码与长度不一致');
  const payload = Buffer.from(base64, 'base64');
  if (payload.length !== byteLength || payload.toString('base64') !== base64)
    invalid('分片编码与长度不一致');
  if (createHash('sha256').update(payload).digest('hex') !== sha256)
    invalid('分片摘要与内容不一致');
  return { byteLength, sha256, payload };
}

/** Syntax only (https, parseable); the trusted-host rule is a first-execution precondition. */
export function canonicalHttpsUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) invalid('外部媒体地址无效');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid('外部媒体地址无效');
  }
  if (url.protocol !== 'https:') invalid('仅可使用HTTPS媒体链接');
  return url.href;
}

/**
 * An external link must already be in the exact form the server stores (the URL parser's href),
 * so the client fingerprints the written value without reimplementing URL normalization.
 */
export function parseMediaRequest(raw: unknown) {
  const input = objectInput(raw, [
    'clientRequestId',
    'kind',
    'title',
    'fileId',
    'externalUrl',
    'rightsDeclaration',
  ]);
  const id = clientRequestId(input.clientRequestId);
  const kind = input.kind;
  if (kind !== 'IMAGE' && kind !== 'VIDEO' && kind !== 'EXTERNAL_LINK') invalid('不支持的媒体类型');
  const title = normalizedText(input.title, 'title', 1, 120);
  const rightsDeclaration = normalizedText(input.rightsDeclaration, 'rightsDeclaration', 4, 500);
  let externalUrl: string | null = null,
    fileId: string | null = null;
  if (kind === 'EXTERNAL_LINK') {
    if (input.fileId !== undefined) invalid('媒体文件与外部链接不能混用');
    externalUrl = canonicalHttpsUrl(input.externalUrl);
    if (externalUrl !== input.externalUrl)
      invalid('外部链接须为规范形式（小写主机、无需转义的路径），请按页面提示重新填写');
  } else {
    if (input.externalUrl !== undefined) invalid('媒体文件与外部链接不能混用');
    if (typeof input.fileId !== 'string' || !LOWER_UUID.test(input.fileId))
      invalid('请选择有效的私有文件', { fileId: '文件编号无效' });
    fileId = input.fileId;
  }
  const fingerprint = requestFingerprint('MATCH_MEDIA_CREATE', [
    kind,
    title,
    fileId,
    externalUrl,
    rightsDeclaration,
  ]);
  return {
    clientRequestId: id,
    kind,
    title,
    fileId,
    externalUrl,
    rightsDeclaration,
    fingerprint,
  };
}
