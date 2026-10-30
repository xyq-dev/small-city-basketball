import { describe, expect, it } from 'vitest';
import {
  parseDirectoryCommand,
  parseDirectoryQuery,
  encodeDirectoryCursor,
  encodeRegionDirectoryCursor,
} from './directory-domain.js';
import { parseRegionCatalogQuery, parseRegionSelection } from './region-catalog-domain.js';
import { REGION_CATALOG_VERSION } from './region-catalog-data.js';

const region = {
  catalogVersion: REGION_CATALOG_VERSION,
  regionId: '5dbae224-8a72-5c66-8b2e-d6a7a9f312e3',
};
const key = 'A'.repeat(43);
const listing = '11111111-1111-4111-8111-111111111111';
const fail = (message: string): never => {
  throw Error(message);
};
const command = { type: 'LIST', expectedEventVersion: 3, reason: '确认标准地区' };

describe('C22 standard region query and command contracts', () => {
  it('keeps the legacy exact-city query and original v1 token unchanged', () => {
    const cursor = encodeDirectoryCursor('UPCOMING', '高州', '2031-01-01', key);
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString())).toEqual({
      v: 1,
      s: 'UPCOMING',
      c: '高州',
      d: '2031-01-01',
      k: key,
    });
    expect(parseDirectoryQuery({ status: 'UPCOMING', city: ' 高州 ', cursor })).toEqual({
      group: 'UPCOMING',
      city: '高州',
      limit: 20,
      cursor: { sortDate: '2031-01-01', publicEventId: key },
    });
  });
  it('binds a v2 cursor to region, catalog, group and limit', () => {
    const cursor = encodeRegionDirectoryCursor('UPCOMING', region, 7, '2031-01-01', key);
    const query = { status: 'UPCOMING', ...region, limit: '7', cursor };
    expect(parseDirectoryQuery(query)).toEqual({
      group: 'UPCOMING',
      city: null,
      limit: 7,
      region,
      cursor: { sortDate: '2031-01-01', publicEventId: key },
    });
    for (const changed of [
      { ...query, regionId: listing },
      { ...query, status: 'LIVE' },
      { ...query, limit: '8' },
      { status: 'UPCOMING', limit: '7', cursor },
      { ...query, cursor: encodeDirectoryCursor('UPCOMING', null, '2031-01-01', key) },
      { ...query, cursor: cursor + 'A' },
    ])
      expect(() => parseDirectoryQuery(changed)).toThrow(
        expect.objectContaining({ code: 'INVALID_CURSOR' }),
      );
    expect(() => parseDirectoryQuery({ ...query, catalogVersion: 'cn-admin-2024-r1' })).toThrow(
      expect.objectContaining({ status: 409, code: 'REGION_CATALOG_CHANGED' }),
    );
  });
  it('rejects mixed, partial, repeated and malformed region queries', () => {
    for (const input of [
      { regionId: region.regionId },
      { catalogVersion: REGION_CATALOG_VERSION },
      { ...region, city: '' },
      { ...region, city: '高州' },
      { ...region, regionId: '440981' },
      { ...region, regionId: [region.regionId] },
      { ...region, extra: 'x' },
    ])
      expect(() => parseDirectoryQuery(input)).toThrow(
        expect.objectContaining({ code: 'INVALID_QUERY' }),
      );
  });
  it('rejects noncanonical dates, extra cursor fields and alternate field ordering', () => {
    const value = {
      v: 2,
      s: 'LIVE',
      r: region.regionId,
      g: region.catalogVersion,
      l: 20,
      d: '2031-01-01',
      k: key,
    };
    const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    for (const bad of [
      { ...value, d: '2031-02-29' },
      { ...value, k: 'short' },
      { ...value, v: 3 },
      { ...value, extra: true },
      { s: value.s, v: value.v, r: value.r, g: value.g, l: 20, d: value.d, k: key },
    ])
      expect(() => parseDirectoryQuery({ ...region, cursor: encode(bad) })).toThrow(
        expect.objectContaining({ code: 'INVALID_CURSOR' }),
      );
  });
  it('adds standard LIST and target-bound REPLACE_REGION without weakening old LIST/UNLIST', () => {
    expect(parseDirectoryCommand({ ...command, region })).toEqual({
      ...command,
      displayCity: null,
      region,
    });
    expect(
      parseDirectoryCommand({
        ...command,
        type: 'REPLACE_REGION',
        region,
        expectedListingId: listing,
      }),
    ).toEqual({
      ...command,
      type: 'REPLACE_REGION',
      region,
      displayCity: null,
      expectedListingId: listing,
    });
    expect(parseDirectoryCommand({ ...command, displayCity: '高州' })).toEqual({
      ...command,
      displayCity: '高州',
    });
    for (const bad of [
      { ...command, region, displayCity: null },
      { ...command, region: null },
      { ...command, expectedListingId: listing },
      { ...command, type: 'UNLIST', region },
      { ...command, type: 'REPLACE_REGION', region },
      { ...command, type: 'REPLACE_REGION', region, expectedListingId: 'bad' },
      { ...command, type: 'REPLACE_REGION', expectedListingId: listing },
      {
        ...command,
        type: 'REPLACE_REGION',
        region,
        expectedListingId: listing,
        displayCity: '高州',
      },
      { ...command, region: { ...region, name: '高州' } },
    ])
      expect(() => parseDirectoryCommand(bad)).toThrow(expect.objectContaining({ status: 422 }));
  });
  it('accepts only a complete region selector and an unparameterized catalog request', () => {
    expect(parseRegionSelection(region, fail)).toEqual(region);
    for (const raw of [
      null,
      [],
      {},
      { ...region, regionId: '440981' },
      { ...region, catalogVersion: '../source' },
    ])
      expect(() => parseRegionSelection(raw, fail)).toThrow();
    expect(parseRegionCatalogQuery({})).toBeUndefined();
    for (const raw of [
      undefined,
      null,
      [],
      { catalogVersion: REGION_CATALOG_VERSION },
      { cookie: 'x' },
    ])
      expect(() => parseRegionCatalogQuery(raw)).toThrow(expect.objectContaining({ status: 400 }));
  });
});
