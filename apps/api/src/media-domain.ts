import { createHash } from 'node:crypto';
import type { MediaContentType, MediaFilePurpose } from '@small-city-basketball/contracts';
import { ApiError } from './errors.js';
import { invalid, objectInput, text } from './validation.js';
export const MAX_MEDIA_FILE_BYTES = 8388608;
export const MEDIA_ORG_LIMIT_BYTES = 134217728;
const mimeExtensions: Record<MediaContentType, RegExp> = {
  'application/pdf': /\.pdf$/i,
  'image/png': /\.png$/i,
  'image/jpeg': /\.jpe?g$/i,
  'video/mp4': /\.mp4$/i,
};
const magicError = () => invalid('文件内容与声明格式不一致或文件结构无效');
function dimensions(w: number, h: number) {
  if (!w || !h || w > 8192 || h > 8192 || w * h > 16777216)
    invalid('图片尺寸不得超过8192边长或16777216像素');
}
function validatePng(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) magicError();
  let cursor = 8,
    first = true,
    data = false,
    end = false;
  while (cursor + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(cursor);
    const name = bytes.toString('ascii', cursor + 4, cursor + 8);
    if (length > bytes.length - cursor - 12) magicError();
    if (first) {
      if (name !== 'IHDR' || length !== 13) magicError();
      dimensions(bytes.readUInt32BE(cursor + 8), bytes.readUInt32BE(cursor + 12));
    }
    first = false;
    if (name === 'IDAT') data = true;
    cursor += 12 + length;
    if (name === 'IEND') {
      if (length !== 0 || cursor !== bytes.length) magicError();
      end = true;
      break;
    }
  }
  if (!data || !end) magicError();
}
function validateJpeg(bytes: Buffer) {
  if (
    bytes.length < 10 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217
  )
    magicError();
  let cursor = 2,
    found = false;
  while (cursor + 4 <= bytes.length) {
    if (bytes[cursor++] !== 255) magicError();
    while (bytes[cursor] === 255) cursor++;
    const marker = bytes[cursor++]!;
    if (marker === 218) break;
    if (marker === 216 || marker === 217 || marker === 1 || (marker >= 208 && marker <= 215))
      continue;
    if (cursor + 2 > bytes.length) magicError();
    const length = bytes.readUInt16BE(cursor);
    if (length < 2 || cursor + length > bytes.length) magicError();
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (length < 8) magicError();
      dimensions(bytes.readUInt16BE(cursor + 5), bytes.readUInt16BE(cursor + 3));
      found = true;
    }
    cursor += length;
  }
  if (!found) magicError();
}
function validateMp4(bytes: Buffer) {
  let cursor = 0;
  const boxes = new Set<string>();
  while (cursor + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(cursor);
    const kind = bytes.toString('ascii', cursor + 4, cursor + 8);
    if (length < 8 || length > bytes.length - cursor) magicError();
    if (
      cursor === 0 &&
      (kind !== 'ftyp' ||
        length < 16 ||
        !['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '].includes(
          bytes.toString('ascii', cursor + 8, cursor + 12),
        ))
    )
      magicError();
    boxes.add(kind);
    cursor += length;
  }
  if (cursor !== bytes.length || !['ftyp', 'moov', 'mdat'].every((kind) => boxes.has(kind)))
    magicError();
}
export function parseMediaUpload(raw: unknown, scope: 'ENTRY' | 'MATCH') {
  const input = objectInput(raw, [
    'purpose',
    'fileName',
    'contentType',
    'base64',
    ...(scope === 'ENTRY' ? ['expectedEntryVersion'] : []),
  ]);
  const purpose = input.purpose as MediaFilePurpose;
  if (
    !(
      scope === 'ENTRY' ? ['PRIVATE_INSURANCE', 'REGISTRATION_DOC'] : ['MATCH_IMAGE', 'MATCH_VIDEO']
    ).includes(purpose)
  )
    invalid('文件用途与当前资源不一致');
  const fileName = text(input.fileName, 'fileName', 1, 120);
  if (/[\\/\u0000-\u001f\u007f]/.test(fileName) || fileName === '.' || fileName === '..')
    invalid('文件名不能包含路径或控制字符');
  const contentType = input.contentType as MediaContentType;
  if (!Object.hasOwn(mimeExtensions, contentType) || !mimeExtensions[contentType].test(fileName))
    invalid('只支持与扩展名一致的PDF、PNG、JPEG或MP4');
  if (
    (scope === 'ENTRY' && contentType === 'video/mp4') ||
    (purpose === 'MATCH_IMAGE' && !['image/png', 'image/jpeg'].includes(contentType)) ||
    (purpose === 'MATCH_VIDEO' && contentType !== 'video/mp4')
  )
    invalid('文件格式与用途不一致');
  if (
    typeof input.base64 !== 'string' ||
    input.base64.length > Math.ceil(MAX_MEDIA_FILE_BYTES / 3) * 4 ||
    input.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)
  )
    invalid('文件编码或大小无效');
  const payload = Buffer.from(input.base64, 'base64');
  if (
    !payload.length ||
    payload.length > MAX_MEDIA_FILE_BYTES ||
    payload.toString('base64') !== input.base64
  )
    invalid('文件不得为空或超过8MiB，编码必须完整');
  if (contentType === 'application/pdf') {
    if (
      !/^%PDF-(?:1\.[0-7]|2\.0)/.test(payload.toString('ascii', 0, 9)) ||
      !/%%EOF\s*$/.test(payload.subarray(-1024).toString('ascii'))
    )
      magicError();
  } else if (contentType === 'image/png') validatePng(payload);
  else if (contentType === 'image/jpeg') validateJpeg(payload);
  else validateMp4(payload);
  return {
    purpose,
    fileName,
    contentType,
    payload,
    sha256: createHash('sha256').update(payload).digest('hex'),
    expectedEntryVersion: input.expectedEntryVersion,
  };
}
export function trustedExternalUrl(value: unknown, trustedHosts: string[]) {
  if (typeof value !== 'string' || value.length > 2048) invalid('外部媒体地址无效');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid('外部媒体地址无效');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !trustedHosts.includes(url.hostname.toLowerCase()) ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname) ||
    url.hostname.includes(':') ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost')
  )
    invalid('仅可使用已配置受信主机的HTTPS媒体链接');
  return url.href;
}
export function mediaRange(
  raw: string | undefined,
  length: number,
): { start: number; end: number; partial: boolean } {
  if (!raw) return { start: 0, end: length - 1, partial: false };
  const m = /^bytes=(\d*)-(\d*)$/.exec(raw);
  const fail = (): never => {
    throw new ApiError(416, 'INVALID_RANGE', '请求的媒体字节范围无效');
  };
  if (!m || (!m[1] && !m[2])) return fail();
  let start: number, end: number;
  if (!m[1]) {
    const size = Number(m[2]);
    if (!Number.isSafeInteger(size) || size < 1) return fail();
    start = Math.max(0, length - size);
    end = length - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), length - 1) : length - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= length ||
    end < start
  )
    return fail();
  return { start, end, partial: true };
}
