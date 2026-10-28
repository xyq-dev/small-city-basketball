import { describe, expect, it } from 'vitest';
import {
  directoryGroup,
  encodeDirectoryCursor,
  normalizeCity,
  parseDirectoryCommand,
  parseDirectoryQuery,
} from './directory-domain.js';

const key = 'A'.repeat(43);
const fail = (message: string): never => {
  throw new Error(message);
};

describe('C18 directory rules', () => {
  it('derives the group from status and purpose only', () => {
    expect(directoryGroup('RUNNING', 'LIVE')).toBe('LIVE');
    expect(directoryGroup('SCHEDULED', 'LIVE')).toBe('UPCOMING');
    expect(directoryGroup('COMPLETED', 'HISTORY')).toBe('HISTORY');
    expect(directoryGroup('ARCHIVED', 'HISTORY')).toBe('HISTORY');
    for (const [status, purpose] of [
      ['RUNNING', 'HISTORY'],
      ['COMPLETED', 'LIVE'],
      ['DRAFT', 'LIVE'],
      ['REGISTRATION_OPEN', 'LIVE'],
      ['CANCELLED', 'LIVE'],
      ['SCHEDULED', 'HISTORY'],
    ] as const)
      expect(directoryGroup(status, purpose)).toBeNull();
  });

  it('normalizes cities and rejects anything outside the allowed characters', () => {
    expect(normalizeCity(' 茂名　 高州 ', fail)).toBe('茂名 高州');
    expect(normalizeCity('Gao·Zhou 2', fail)).toBe('Gao·Zhou 2');
    expect(normalizeCity('', fail)).toBeNull();
    expect(normalizeCity(undefined, fail)).toBeNull();
    for (const bad of ['茂名!', '<b>', 'é', 'a\u0000', '一'.repeat(21), 12])
      expect(() => normalizeCity(bad, fail)).toThrow();
  });

  it('parses LIST/UNLIST strictly', () => {
    expect(
      parseDirectoryCommand({
        type: 'LIST',
        expectedEventVersion: 3,
        displayCity: ' 湛江 ',
        reason: '  列入目录  ',
      }),
    ).toEqual({ type: 'LIST', expectedEventVersion: 3, displayCity: '湛江', reason: '列入目录' });
    expect(
      parseDirectoryCommand({ type: 'UNLIST', expectedEventVersion: 1, reason: '撤出目录' }),
    ).toMatchObject({ type: 'UNLIST', displayCity: null });
    for (const bad of [
      { type: 'LIST', expectedEventVersion: 1, reason: '短' },
      { type: 'LIST', expectedEventVersion: 0, reason: '列入目录' },
      { type: 'HIDE', expectedEventVersion: 1, reason: '列入目录' },
      { type: 'UNLIST', expectedEventVersion: 1, reason: '撤出目录', displayCity: '湛江' },
      { type: 'LIST', expectedEventVersion: 1, reason: '列入目录', extra: 1 },
      { type: 'LIST', expectedEventVersion: 1, reason: 'x'.repeat(501) },
    ])
      expect(() => parseDirectoryCommand(bad)).toThrow();
  });

  it('defaults to LIVE / 20 and bounds the page size', () => {
    expect(parseDirectoryQuery({})).toEqual({ group: 'LIVE', limit: 20, city: null, cursor: null });
    expect(parseDirectoryQuery({ status: 'HISTORY', limit: '50' }).limit).toBe(50);
    for (const bad of [
      { limit: '0' },
      { limit: '51' },
      { limit: '01' },
      { status: 'OPEN' },
      { q: 'x' },
      { status: ['LIVE', 'LIVE'] },
    ])
      expect(() => parseDirectoryQuery(bad)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('accepts only canonical cursors bound to the same status and city', () => {
    const cursor = encodeDirectoryCursor('UPCOMING', '茂名', '2031-05-01', key);
    expect(parseDirectoryQuery({ status: 'UPCOMING', city: '茂名', cursor }).cursor).toEqual({
      sortDate: '2031-05-01',
      publicEventId: key,
    });
    const bad = (raw: unknown) => Buffer.from(JSON.stringify(raw)).toString('base64url');
    for (const [query, label] of [
      [{ status: 'LIVE', city: '茂名', cursor }, 'status'],
      [{ status: 'UPCOMING', cursor }, 'city'],
      [{ status: 'UPCOMING', city: '湛江', cursor }, 'other city'],
      [{ status: 'UPCOMING', city: '茂名', cursor: cursor + 'A' }, 'non canonical'],
      [
        {
          status: 'UPCOMING',
          city: '茂名',
          cursor: bad({ v: 1, s: 'UPCOMING', c: '茂名', d: '2031-02-30', k: key }),
        },
        'date',
      ],
      [
        {
          status: 'UPCOMING',
          city: '茂名',
          cursor: bad({ v: 2, s: 'UPCOMING', c: '茂名', d: '2031-05-01', k: key }),
        },
        'version',
      ],
      [
        {
          status: 'UPCOMING',
          city: '茂名',
          cursor: bad({ v: 1, s: 'UPCOMING', c: '茂名', d: '2031-05-01', k: 'short' }),
        },
        'key',
      ],
      [
        {
          status: 'UPCOMING',
          city: '茂名',
          cursor: bad({ v: 1, s: 'UPCOMING', c: '茂名', d: '2031-05-01', k: key, x: 1 }),
        },
        'extra',
      ],
      [{ status: 'UPCOMING', city: '茂名', cursor: '!!' }, 'charset'],
    ] as const)
      expect(() => parseDirectoryQuery(query), label).toThrow(
        expect.objectContaining({ status: 400, code: 'INVALID_CURSOR' }),
      );
  });
});
