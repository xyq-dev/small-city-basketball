import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, test } from 'vitest';
import {
  escapePosterText,
  parsePosterInput,
  posterDimensions,
  posterSvg,
  renderPoster,
  posterChineseFontsAvailable,
  requirePosterChineseFonts,
} from './poster-domain.js';
import type { PosterRecipe } from './poster-domain.js';

const recipe = (): PosterRecipe => ({
  rendererVersion: 'X05_POSTER_V1',
  kind: 'MATCHUP',
  eventName: 'Synthetic Cup',
  dateLabel: '2028-06-01',
  venueName: 'Court',
  headline: 'MATCHUP',
  subtitle: 'Original published fixture',
  teams: ['Alpha', 'Beta'],
  score: null,
  lines: ['Scheduled fixture'],
  players: [],
  omittedPlayerCount: 0,
  publicationId: randomUUID(),
  proof: {},
});
describe('X05 safe deterministic poster renderer', () => {
  test('always fails closed when the font capability check is negative', async () => {
    await expect(requirePosterChineseFonts(async () => false)).rejects.toMatchObject({
      status: 503,
      code: 'POSTER_FONT_UNAVAILABLE',
    });
  });
  test('type-bound references and allowed fields cannot import arbitrary HTML or private data', () => {
    const input = {
      clientRequestId: randomUUID(),
      expectedEventVersion: 1,
      kind: 'MATCHUP',
      matchId: randomUUID(),
    };
    expect(parsePosterInput(input)).toMatchObject({
      kind: 'MATCHUP',
      includePortraits: true,
      entryId: null,
    });
    for (const patch of [
      { kind: 'HONOR' },
      { entryId: randomUUID() },
      { html: '<script/>' },
      { identityNumber: 'private' },
      { url: 'https://invalid.test' },
    ])
      expect(() => parsePosterInput({ ...input, ...patch })).toThrow();
  });
  test('escapes every XML delimiter and strips control characters', () => {
    expect(escapePosterText('<script a="b">&\0\'')).toBe(
      '&lt;script a=&quot;b&quot;&gt;&amp;&apos;',
    );
    const r = recipe();
    r.eventName = '<image href="https://private.test"/>';
    const svg = posterSvg(r);
    expect(svg).not.toContain('<image href="https://');
    expect(svg).not.toContain('<script');
  });
  test('outputs a real deterministic PNG of the declared size without EXIF', async () => {
    const r = recipe();
    if (!(await posterChineseFontsAvailable())) {
      await expect(renderPoster(r)).rejects.toMatchObject({
        status: 503,
        code: 'POSTER_FONT_UNAVAILABLE',
      });
      return;
    }
    const a = await renderPoster(r),
      b = await renderPoster(r),
      metadata = await sharp(a).metadata();
    expect(a.equals(b)).toBe(true);
    expect(metadata).toMatchObject({ format: 'png', width: 1080, height: 1440 });
    expect(metadata.exif).toBeUndefined();
    expect(a.length).toBeLessThan(8 * 1024 * 1024);
  });
  test('supports all 60 roster slots with bounded raster size and no fake avatars', () => {
    const r = recipe();
    r.kind = 'ROSTER';
    r.players = Array.from({ length: 60 }, (_, n) => ({
      memberId: randomUUID(),
      name: `Player ${n}`,
      jerseyNo: String(n),
      materialId: randomUUID(),
      revisionId: randomUUID(),
      materialVersion: 1,
      portraitHash: 'a'.repeat(64),
      includePortrait: false,
    }));
    expect(posterDimensions(r)).toEqual({ width: 1080, height: 3200 });
    expect(posterSvg(r)).not.toContain('<image');
    expect(() => posterSvg(r, new Map([[r.players[0]!.memberId, '<svg>']]))).toThrow();
  });
  test('keeps all 32 tied honor placements rather than silently dropping half the table', () => {
    const r = recipe();
    r.kind = 'HONOR';
    r.lines = Array.from({ length: 32 }, (_, n) => 'Tied team ' + n);
    expect(posterSvg(r)).toContain('Tied team 31');
    expect(posterDimensions(r).height).toBe(2296);
  });
});
