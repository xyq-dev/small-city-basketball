import { describe, expect, test } from 'vitest';
import sharp from 'sharp';
import { assertPosterPng } from '../../../scripts/x05-recruitment-check.mjs';
describe('portable tools-image PNG verifier', () => {
  test('checks a real PNG raster without importing a libc image addon in the tools image', async () => {
    const png = await sharp({
      create: { width: 1080, height: 1440, channels: 4, background: '#123c73' },
    })
      .png()
      .toBuffer();
    expect(assertPosterPng(png)).toEqual({ width: 1080, height: 1440 });
    const bad = Buffer.from(png);
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    expect(() => assertPosterPng(bad)).toThrow('PNG chunk CRC');
    expect(() => assertPosterPng(png.subarray(0, png.length - 5))).toThrow();
    expect(() => assertPosterPng(png, 1080, 100)).toThrow();
  });
  test('rejects disguised JPEG and private metadata even when the dimensions match', async () => {
    const input = sharp({
      create: { width: 1080, height: 1440, channels: 3, background: '#123c73' },
    });
    const jpeg = await input.clone().jpeg().toBuffer();
    expect(() => assertPosterPng(jpeg)).toThrow('PNG signature');
    const withExif = await input
      .clone()
      .withExif({ IFD0: { Copyright: 'synthetic private metadata' } })
      .png()
      .toBuffer();
    expect(() => assertPosterPng(withExif)).toThrow('Private PNG metadata');
  });
});
