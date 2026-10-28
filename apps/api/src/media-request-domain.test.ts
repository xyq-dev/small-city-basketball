import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  canonicalHttpsUrl,
  chunkIndex,
  expectedChunkLength,
  parseChunk,
  parseFileRequest,
  parseMediaRequest,
  parseSessionRequest,
  requestFingerprint,
} from './media-request-domain.js';
import { syntheticPng } from '../test/media-fixtures.js';

// Known vectors shared verbatim with apps/wechat/test/c19-media-requests.test.cjs.
export const VECTORS = [
  {
    operation: 'MATCH_FILE_UPLOAD' as const,
    fields: ['MATCH_IMAGE', '决赛.png', 'image/png', 68, 'a'.repeat(64)],
    hash: 'd5a9800aab85345850ef66d219c7fc80baf1282d43d1dfad73902356711007e8',
  },
  {
    operation: 'MATCH_MEDIA_CREATE' as const,
    fields: [
      'EXTERNAL_LINK',
      'Café 决赛',
      null,
      'https://video.example.test/v/1',
      '主办方授权平台发布',
    ],
    hash: '99f08542eba739e6e3f843a4f00395b1378140ca2af9e499fe603b0ce8308817',
  },
  {
    operation: 'MATCH_MEDIA_CREATE' as const,
    fields: [
      'IMAGE',
      '决赛最后一攻',
      '77777777-7777-4777-8777-777777777771',
      null,
      '主办方摄影组拍摄',
    ],
    hash: 'c7d769d71667fdd050236d4d7e4b78c0f6dcac37f2e90beea14310181d310f4c',
  },
];
const id = '0b0f8f5e-6c1d-4a3b-9e2f-1a2b3c4d5e6f';
const sha = (v: Buffer) => createHash('sha256').update(v).digest('hex');
const png = () => ({
  clientRequestId: id,
  purpose: 'MATCH_IMAGE',
  fileName: '  决赛.png ',
  contentType: 'image/png',
  byteLength: syntheticPng.length,
  contentSha256: sha(syntheticPng),
  contentBase64: syntheticPng.toString('base64'),
});

describe('C19 media request identity rules', () => {
  it('matches the shared known fingerprint vectors', () => {
    for (const v of VECTORS) expect(requestFingerprint(v.operation, v.fields)).toBe(v.hash);
  });
  it('fingerprints exactly the NFC-normalized, trimmed values that are written', () => {
    const decomposed = parseMediaRequest({
      clientRequestId: id,
      kind: 'EXTERNAL_LINK',
      title: '  Café 决赛 ',
      externalUrl: 'https://video.example.test/v/1',
      rightsDeclaration: '主办方授权平台发布',
    });
    expect(decomposed.title).toBe('Café 决赛');
    expect(decomposed.fingerprint).toBe(VECTORS[1]!.hash);
    const file = parseFileRequest(png());
    expect(file.fileName).toBe('决赛.png');
    expect(file.fingerprint).toBe(
      requestFingerprint('MATCH_FILE_UPLOAD', [
        'MATCH_IMAGE',
        '决赛.png',
        'image/png',
        syntheticPng.length,
        sha(syntheticPng),
      ]),
    );
    // The session form of the same request has the same fingerprint (one request identity).
    const { contentBase64: _bytes, ...meta } = png();
    expect(parseSessionRequest(meta).fingerprint).toBe(file.fingerprint);
  });
  it('rejects ids, digests and bytes that do not match the declaration', () => {
    expect(() => parseFileRequest({ ...png(), clientRequestId: id.toUpperCase() })).toThrow(/UUID/);
    expect(() =>
      parseFileRequest({ ...png(), clientRequestId: '0b0f8f5e-6c1d-1a3b-9e2f-1a2b3c4d5e6f' }),
    ).toThrow(/UUID/);
    expect(() => parseFileRequest({ ...png(), contentSha256: 'b'.repeat(64) })).toThrow(/摘要/);
    expect(() => parseFileRequest({ ...png(), byteLength: syntheticPng.length + 1 })).toThrow();
    expect(() => parseFileRequest({ ...png(), contentType: 'video/mp4' })).toThrow();
    expect(() => parseFileRequest({ ...png(), purpose: 'PRIVATE_INSURANCE' })).toThrow();
    expect(() => parseFileRequest({ ...png(), base64: 'x' })).toThrow(/不允许的字段/);
    expect(() =>
      parseSessionRequest({ ...png(), contentBase64: undefined, byteLength: 8388609 }),
    ).toThrow();
  });
  it('requires a canonical https link so the client fingerprints the stored value', () => {
    expect(canonicalHttpsUrl('https://video.example.test/v/1')).toBe(
      'https://video.example.test/v/1',
    );
    const base = {
      clientRequestId: id,
      kind: 'EXTERNAL_LINK',
      title: '回看',
      rightsDeclaration: '主办方授权平台发布',
    };
    for (const url of [
      'https://Video.example.test/v/1',
      'https://video.example.test',
      'https://video.example.test/a b',
    ])
      expect(() => parseMediaRequest({ ...base, externalUrl: url })).toThrow(/规范形式/);
    expect(() =>
      parseMediaRequest({ ...base, externalUrl: 'http://video.example.test/' }),
    ).toThrow();
    expect(() =>
      parseMediaRequest({ ...base, externalUrl: 'https://video.example.test/', fileId: id }),
    ).toThrow(/混用/);
  });
  it('bounds chunks to 512 KiB with the exact final remainder', () => {
    expect(expectedChunkLength(CHUNK_SIZE * 2 + 5, 0)).toBe(CHUNK_SIZE);
    expect(expectedChunkLength(CHUNK_SIZE * 2 + 5, 2)).toBe(5);
    expect(expectedChunkLength(CHUNK_SIZE, 0)).toBe(CHUNK_SIZE);
    expect(chunkIndex('15')).toBe(15);
    for (const bad of ['16', '01', '-1', 'a', '100']) expect(() => chunkIndex(bad)).toThrow();
    const bytes = Buffer.from('chunk bytes');
    expect(
      parseChunk({
        byteLength: bytes.length,
        sha256: sha(bytes),
        contentBase64: bytes.toString('base64'),
      }).payload,
    ).toEqual(bytes);
    expect(() =>
      parseChunk({
        byteLength: bytes.length,
        sha256: 'c'.repeat(64),
        contentBase64: bytes.toString('base64'),
      }),
    ).toThrow(/摘要/);
    expect(() =>
      parseChunk({ byteLength: CHUNK_SIZE + 1, sha256: sha(bytes), contentBase64: 'AAAA' }),
    ).toThrow();
  });
});
