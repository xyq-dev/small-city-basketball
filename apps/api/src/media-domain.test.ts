import { describe, expect, it } from 'vitest';
import {
  mediaRange,
  parseMediaUpload,
  trustedExternalUrl,
  MAX_MEDIA_FILE_BYTES,
} from './media-domain.js';
import { syntheticMp4, syntheticPng, syntheticPdf } from '../test/media-fixtures.js';
const image = () => ({
  purpose: 'MATCH_IMAGE',
  fileName: '合成图片.png',
  contentType: 'image/png',
  base64: syntheticPng.toString('base64'),
});
describe('bounded media validation', () => {
  it('accepts actual synthetic PNG PDF and MP4 bytes and computes byte-bound hashes', () => {
    expect(parseMediaUpload(image(), 'MATCH')).toMatchObject({
      payload: syntheticPng,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      parseMediaUpload(
        {
          purpose: 'PRIVATE_INSURANCE',
          fileName: '合成保单.pdf',
          contentType: 'application/pdf',
          base64: syntheticPdf.toString('base64'),
          expectedEntryVersion: 2,
        },
        'ENTRY',
      ).payload,
    ).toEqual(syntheticPdf);
    expect(
      parseMediaUpload(
        {
          purpose: 'MATCH_VIDEO',
          fileName: '合成视频.mp4',
          contentType: 'video/mp4',
          base64: syntheticMp4.toString('base64'),
        },
        'MATCH',
      ).payload,
    ).toEqual(syntheticMp4);
  });
  it.each(['../image.png', '..\\image.png', 'line\r\nheader.png', '\u0000image.png'])(
    'rejects unsafe file name %j',
    (fileName) => expect(() => parseMediaUpload({ ...image(), fileName }, 'MATCH')).toThrow(),
  );
  it.each(['image/svg+xml', 'text/html', 'application/javascript'])(
    'rejects active MIME %s',
    (contentType) => expect(() => parseMediaUpload({ ...image(), contentType }, 'MATCH')).toThrow(),
  );
  it.each(['', 'invalid!', 'YQ=', 'YQ===', 'YQ==\n'])('rejects noncanonical base64 %j', (base64) =>
    expect(() => parseMediaUpload({ ...image(), base64 }, 'MATCH')).toThrow(),
  );
  it('rejects spoofed magic, inconsistent purpose, a missing PNG end and excessive image pixels', () => {
    expect(() =>
      parseMediaUpload({ ...image(), base64: Buffer.from('<html>').toString('base64') }, 'MATCH'),
    ).toThrow();
    expect(() => parseMediaUpload({ ...image(), purpose: 'PRIVATE_INSURANCE' }, 'MATCH')).toThrow(
      '用途',
    );
    expect(() =>
      parseMediaUpload(
        { ...image(), base64: syntheticPng.subarray(0, -12).toString('base64') },
        'MATCH',
      ),
    ).toThrow();
    const bomb = Buffer.from(syntheticPng);
    bomb.writeUInt32BE(65536, 16);
    expect(() =>
      parseMediaUpload({ ...image(), base64: bomb.toString('base64') }, 'MATCH'),
    ).toThrow('尺寸');
  });
  it('rejects overflow before persisting any decoded body', () =>
    expect(() =>
      parseMediaUpload(
        { ...image(), base64: Buffer.alloc(MAX_MEDIA_FILE_BYTES + 1).toString('base64') },
        'MATCH',
      ),
    ).toThrow());
  it('allows only explicitly trusted HTTPS origins without ever fetching', () => {
    expect(trustedExternalUrl('https://video.example.com/watch?id=1', ['video.example.com'])).toBe(
      'https://video.example.com/watch?id=1',
    );
    for (const url of [
      'http://video.example.com/v',
      'https://127.0.0.1/v',
      'https://video.example.com.evil.test/v',
      'https://u:p@video.example.com/v',
      'https://video.example.com:8443/v',
      'https://video.example.com/v#secret',
    ])
      expect(() => trustedExternalUrl(url, ['video.example.com'])).toThrow();
  });
  it('supports full, bounded, open and suffix byte ranges and rejects multiple/overflow ranges', () => {
    expect(mediaRange(undefined, 100)).toEqual({ start: 0, end: 99, partial: false });
    expect(mediaRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19, partial: true });
    expect(mediaRange('bytes=10-', 100)).toEqual({ start: 10, end: 99, partial: true });
    expect(mediaRange('bytes=-10', 100)).toEqual({ start: 90, end: 99, partial: true });
    for (const r of [
      'bytes=100-',
      'bytes=10-9',
      'bytes=0-1,3-4',
      'bytes=-0',
      'bytes=',
      'bytes=999999999999999999999-',
    ])
      expect(() => mediaRange(r, 100)).toThrow();
  });
});
