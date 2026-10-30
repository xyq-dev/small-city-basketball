import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REGION_CATALOG_VERSION,
  REGION_NODE_COUNT,
  REGION_ALIAS_COUNT,
  REGION_SOURCE_SHA256,
  REGION_NODES_SHA256,
  REGION_ALIASES_SHA256,
  REGION_PARTIAL_ROOT_IDS,
} from './region-catalog-data.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (name: string) =>
  readFileSync(new URL(`../data/regions/${name}`, import.meta.url), 'utf8');
const inspect = (body: string) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { buildCatalog } from './scripts/build-region-catalog.mjs';import {readFileSync} from 'node:fs';const source=readFileSync('./apps/api/data/regions/2025.txt','utf8');${body}`,
      ],
      { cwd: root, encoding: 'utf8' },
    ),
  );

describe('fixed C22 region catalog and offline generation', () => {
  it('checks the exact licensed source and all generated artifacts without writing', () => {
    const result = JSON.parse(
      execFileSync(process.execPath, ['scripts/build-region-catalog.mjs', '--check'], {
        cwd: root,
        encoding: 'utf8',
      }),
    );
    expect(result).toMatchObject({
      mode: '--check',
      catalogVersion: REGION_CATALOG_VERSION,
      nodeCount: REGION_NODE_COUNT,
      aliasCount: REGION_ALIAS_COUNT,
      normalizedSha256: REGION_NODES_SHA256,
      aliasSha256: REGION_ALIASES_SHA256,
    });
    expect(createHash('sha256').update(read('2025.txt')).digest('hex')).toBe(REGION_SOURCE_SHA256);
    expect(read('LICENSE')).toContain('CC0 1.0 Universal');
    const manifest = JSON.parse(read('manifest.json'));
    expect(manifest).toMatchObject({
      dataDate: '2025-12-31',
      license: 'CC0-1.0',
      nodeCount: 3212,
      aliasCount: 3151,
    });
  });

  it('generates the same identities and hashes on repeated offline reads', () => {
    const result = inspect(
      `const a=buildCatalog(source),b=buildCatalog(source);console.log(JSON.stringify({equal:JSON.stringify(a)===JSON.stringify(b),nodes:a.nodesSha256,aliases:a.aliasesSha256}));`,
    );
    expect(result).toEqual({
      equal: true,
      nodes: REGION_NODES_SHA256,
      aliases: REGION_ALIASES_SHA256,
    });
    const registry = JSON.parse(read('registry.json'));
    expect(Object.keys(registry.ids)).toHaveLength(3212);
    expect(new Set(Object.values(registry.ids)).size).toBe(3212);
    expect(registry.ids['440981']).toBe('5dbae224-8a72-5c66-8b2e-d6a7a9f312e3');
  });

  it('retains real hierarchy, direct counties and partial province-only coverage', () => {
    const result = inspect(
      `const c=buildCatalog(source);const byCode=Object.fromEntries(c.nodes.map(n=>[n.sourceCode,n]));console.log(JSON.stringify({gaozhou:byCode['440981'].parentRegionId,maoming:byCode['440900'].regionId,beijing:byCode['110101'].parentRegionId,beijingRoot:byCode['110000'].regionId,jiyuan:byCode['419001'].parentRegionId,henan:byCode['410000'].regionId,dongguanChildren:c.nodes.filter(n=>n.parentRegionId===byCode['441900'].regionId).length,partial:c.partialRootIds,partialChildren:c.nodes.filter(n=>c.partialRootIds.includes(n.parentRegionId)).length,synthetic:!!byCode['110100']||!!byCode['469000']}));`,
    );
    expect(result.gaozhou).toBe(result.maoming);
    expect(result.beijing).toBe(result.beijingRoot);
    expect(result.jiyuan).toBe(result.henan);
    expect(result.dongguanChildren).toBe(0);
    expect(result.partial).toEqual([...REGION_PARTIAL_ROOT_IDS]);
    expect(result.partialChildren).toBe(0);
    expect(result.synthetic).toBe(false);
  });

  it('does not guess duplicate names, remove suffixes globally or parse a town out of a label', () => {
    const result = inspect(
      `const c=buildCatalog(source);console.log(JSON.stringify({aliases:c.aliases.filter(a=>['高州','高州市','朝阳区','高州·石鼓','石鼓','广州','广东','茂名'].includes(a.label)),short:c.aliases.filter(a=>a.kind==='REVIEWED_ALIAS').map(a=>a.label)}));`,
    );
    expect(result.aliases.map((a: { label: string }) => a.label).sort()).toEqual(
      ['广东', '茂名', '高州', '高州市'].sort(),
    );
    expect(
      result.aliases
        .filter((a: { label: string }) => a.label.startsWith('高州'))
        .map((a: { regionId: string }) => a.regionId),
    ).toEqual(['5dbae224-8a72-5c66-8b2e-d6a7a9f312e3', '5dbae224-8a72-5c66-8b2e-d6a7a9f312e3']);
    expect(result.short.sort()).toEqual(['广东', '茂名', '高州'].sort());
  });

  it('rejects altered source bytes and refuses missing or additional CLI options', () => {
    expect(
      inspect(
        `try{buildCatalog(source.replace('高州市','合成市'));console.log('false')}catch(e){console.log(JSON.stringify(e.message))}`,
      ),
    ).toBe('Fixed region source SHA-256 mismatch');
    for (const options of [[], ['--database', 'postgres://example'], ['--write', '--check']]) {
      const result = spawnSync(process.execPath, ['scripts/build-region-catalog.mjs', ...options], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Expected exactly --check or --write');
    }
  });

  it('preserves the entire C18 listing guard except adding region immutability', () => {
    const original = readFileSync(
      new URL('../migrations/018_c18_public_event_directory.sql', import.meta.url),
      'utf8',
    );
    const migration = readFileSync(
      new URL('../migrations/023_c21_region_directory.sql', import.meta.url),
      'utf8',
    );
    const before = /CREATE FUNCTION c18_directory_listing_guard\(\)[\s\S]*?\n\$\$;/.exec(
      original,
    )![0];
    const after = /CREATE OR REPLACE FUNCTION c18_directory_listing_guard\(\)[\s\S]*?\n\$\$;/.exec(
      migration,
    )![0];
    expect(
      after
        .replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
        .replace(
          '    OR NEW.region_catalog_version IS DISTINCT FROM OLD.region_catalog_version\n',
          '',
        )
        .replace('    OR NEW.region_id IS DISTINCT FROM OLD.region_id\n', ''),
    ).toBe(before);
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).not.toMatch(
      /UPDATE\s+event_directory_listings\s+SET\s+(region|display_city)/i,
    );
  });
});
