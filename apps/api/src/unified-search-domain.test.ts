import { describe, expect, test } from 'vitest';
import {
  parsePublicSearch,
  publicSearchCursor,
  literalSearchPattern,
} from './unified-search-domain.js';
describe('unified public search input and scoped cursor', () => {
  test('normalizes literal text without allowing wildcard expansion', () => {
    const q = parsePublicSearch({ q: '  青锋%_\\  ', kind: 'TEAM' });
    expect(q.q).toBe('青锋%_\\');
    expect(literalSearchPattern(q.q)).toBe('%青锋\\%\\_\\\\%');
  });
  test('cursor contains only public key and query scope, never internal identity', () => {
    const q = parsePublicSearch({ q: '青锋' }),
      cursor = publicSearchCursor(q.context, 'T:' + 'a'.repeat(43));
    expect(parsePublicSearch({ q: '青锋', cursor }).after).toBe('T:' + 'a'.repeat(43));
    expect(() => parsePublicSearch({ q: '另一队', cursor })).toThrow();
    expect(() => parsePublicSearch({ q: '青锋', kind: 'PLAYER', cursor })).toThrow();
  });
  test.each([
    { q: '' },
    { q: 'a'.repeat(81) },
    { q: 'a\n' },
    { q: 'x', kind: 'PRIVATE' },
    { q: 'x', userId: 'secret' },
    { q: 'x', limit: '21' },
    { q: 'x', limit: '01' },
    { q: 'x', cursor: '%%%%' },
    { q: 'x', regionId: 'x' },
  ])('rejects untrusted or broadened input %j', (raw) => {
    expect(() => parsePublicSearch(raw)).toThrow();
  });
});
