import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Fixed, offline C21/C22 import. This generator never connects to a database or the network.
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'apps/api/data/regions');
export const VERSION = 'cn-admin-2025-r1';
export const DATA_DATE = '2025-12-31';
export const SOURCE_SHA256 = '73520f533c8e3f1aadb3bb55166656a491fb1e7703b2e2172e5694ec8845bab0';
const SOURCE_BLOB = 'a31f53c95324bf8723be9f653bafce17bc253a61';
const SOURCE_COMMIT = 'e2c2b2e1fb4ce1fb76e879aa0b80e229adaf950c';
const SOURCE_REPO = 'https://github.com/yescallop/areacodes';
const NAMESPACE = '494a6df2-5f24-5c6d-9949-9476ff74f5bd';
const CITY = /^[A-Za-z0-9 ·一-鿿]+$/;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const fail = (message) => {
  throw new Error(message);
};
const sql = (value) => (value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`);

function uuid5(name) {
  const hash = createHash('sha1')
    .update(Buffer.from(NAMESPACE.replaceAll('-', ''), 'hex'))
    .update(name)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function buildCatalog(source) {
  if (sha256(source) !== SOURCE_SHA256) fail('Fixed region source SHA-256 mismatch');
  if (
    createHash('sha1')
      .update(`blob ${Buffer.byteLength(source)}\0`)
      .update(source)
      .digest('hex') !== SOURCE_BLOB
  )
    fail('Fixed region source Git blob mismatch');
  const codes = new Map();
  for (const line of source.trimEnd().split('\n')) {
    const match = /^([1-9]\d{5}) (\S+)$/.exec(line);
    if (!match || codes.has(match[1])) fail('Invalid or duplicate region source row');
    const [, code, name] = match;
    if (name.normalize('NFC') !== name || !CITY.test(name) || Array.from(name).length > 20)
      fail('Region name is incompatible with the existing public displayCity contract');
    codes.set(code, name);
  }
  if (codes.size !== 3212) fail('Unexpected fixed region count');
  const ids = new Map([...codes.keys()].map((code) => [code, uuid5(`mca:${code}:${DATA_DATE}`)]));
  const nodes = [...codes]
    .sort(([a], [b]) => compare(a, b))
    .map(([sourceCode, name]) => {
      const level = sourceCode.endsWith('0000')
        ? 'PROVINCE'
        : sourceCode.endsWith('00')
          ? 'PREFECTURE'
          : 'COUNTY';
      let parentCode = null;
      if (level !== 'PROVINCE') {
        const prefecture = sourceCode.slice(0, 4) + '00';
        parentCode =
          level === 'COUNTY' && codes.has(prefecture)
            ? prefecture
            : sourceCode.slice(0, 2) + '0000';
        if (!codes.has(parentCode) || parentCode === sourceCode)
          fail('Region parent is missing or cyclic');
      }
      return {
        regionId: ids.get(sourceCode),
        sourceCode,
        name,
        level,
        parentRegionId: parentCode ? ids.get(parentCode) : null,
      };
    });
  const byId = new Map(nodes.map((node) => [node.regionId, node]));
  const ranks = { PROVINCE: 0, PREFECTURE: 1, COUNTY: 2 };
  for (const node of nodes) {
    let current = node;
    const seen = new Set();
    while (current) {
      if (seen.has(current.regionId)) fail('Region hierarchy cycle');
      seen.add(current.regionId);
      const parent = current.parentRegionId ? byId.get(current.parentRegionId) : null;
      if (
        current.parentRegionId &&
        (!parent ||
          ranks[parent.level] >= ranks[current.level] ||
          parent.sourceCode.slice(0, 2) !== current.sourceCode.slice(0, 2))
      )
        fail('Invalid region parent level or province');
      current = parent;
    }
  }
  const names = new Map();
  for (const node of nodes) names.set(node.name, [...(names.get(node.name) || []), node]);
  const aliases = [...names]
    .filter(([, matches]) => matches.length === 1)
    .map(([label, [node]]) => ({
      label,
      regionId: node.regionId,
      kind: 'CANONICAL_UNIQUE',
      provenance: `${VERSION}:unique-formal-name:${node.sourceCode}`,
    }));
  for (const [label, code] of [
    ['广东', '440000'],
    ['茂名', '440900'],
    ['高州', '440981'],
  ]) {
    if (names.has(label) || !ids.has(code))
      fail('Reviewed alias collides with a formal name or missing region');
    aliases.push({
      label,
      regionId: ids.get(code),
      kind: 'REVIEWED_ALIAS',
      provenance: `C21:exact-short-name:${code}`,
    });
  }
  aliases.sort((a, b) => compare(a.label, b.label));
  if (aliases.length !== 3151 || new Set(aliases.map((a) => a.label)).size !== aliases.length)
    fail('Unexpected or ambiguous region aliases');
  const partialRootIds = ['710000', '810000', '820000'].map((code) => ids.get(code));
  return {
    nodes,
    aliases,
    partialRootIds,
    nodesSha256: sha256(JSON.stringify(nodes)),
    aliasesSha256: sha256(JSON.stringify(aliases)),
  };
}

function schema() {
  return `-- C22 implements the reviewed C21 region catalog. Offline, fixed 2025 snapshot.
-- New reference rows are inserted only with their version in the same transaction.
-- Existing listings keep NULL regions; no historical city, publication or event is rewritten.
CREATE TABLE region_catalog_versions (
  version text PRIMARY KEY CHECK (version ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  data_date date NOT NULL CHECK (isfinite(data_date)),
  source_repo text NOT NULL,
  source_commit text NOT NULL CHECK (source_commit ~ '^[0-9a-f]{40}$'),
  source_blob text NOT NULL CHECK (source_blob ~ '^[0-9a-f]{40}$'),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  license text NOT NULL,
  normalized_sha256 text NOT NULL CHECK (normalized_sha256 ~ '^[0-9a-f]{64}$'),
  alias_sha256 text NOT NULL CHECK (alias_sha256 ~ '^[0-9a-f]{64}$'),
  node_count integer NOT NULL CHECK (node_count BETWEEN 1 AND 10000),
  alias_count integer NOT NULL CHECK (alias_count BETWEEN 1 AND 20000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at))
);
CREATE TABLE region_catalog_nodes (
  catalog_version text NOT NULL REFERENCES region_catalog_versions(version),
  region_id uuid NOT NULL,
  source_code text NOT NULL CHECK (source_code ~ '^[1-9][0-9]{5}$'),
  name text NOT NULL CHECK (name = normalize(name, NFC) AND name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  level text NOT NULL CHECK (level IN ('PROVINCE','PREFECTURE','COUNTY')),
  parent_region_id uuid,
  PRIMARY KEY (catalog_version,region_id),
  UNIQUE (catalog_version,source_code),
  FOREIGN KEY (catalog_version,parent_region_id) REFERENCES region_catalog_nodes(catalog_version,region_id),
  CHECK ((level='PROVINCE' AND parent_region_id IS NULL AND right(source_code,4)='0000')
    OR (level='PREFECTURE' AND parent_region_id IS NOT NULL AND right(source_code,4)<>'0000' AND right(source_code,2)='00')
    OR (level='COUNTY' AND parent_region_id IS NOT NULL AND right(source_code,2)<>'00')),
  CHECK (parent_region_id IS DISTINCT FROM region_id)
);
CREATE INDEX region_catalog_nodes_parent ON region_catalog_nodes(catalog_version,parent_region_id);
CREATE TABLE region_legacy_aliases (
  catalog_version text NOT NULL REFERENCES region_catalog_versions(version),
  label text NOT NULL CHECK (label=normalize(label,NFC) AND label=btrim(label)
    AND label !~ '  ' AND char_length(label) BETWEEN 1 AND 20 AND label ~ '^[A-Za-z0-9 ·一-鿿]+$'),
  region_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('CANONICAL_UNIQUE','REVIEWED_ALIAS')),
  provenance text NOT NULL CHECK (char_length(provenance) BETWEEN 1 AND 200),
  PRIMARY KEY (catalog_version,label),
  FOREIGN KEY (catalog_version,region_id) REFERENCES region_catalog_nodes(catalog_version,region_id)
);

CREATE FUNCTION c22_region_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent region_catalog_nodes%ROWTYPE;
  target region_catalog_nodes%ROWTYPE;
  version_xid bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Region catalog versions are immutable' USING ERRCODE='23514';
  END IF;
  SELECT xmin::text::bigint INTO version_xid FROM region_catalog_versions WHERE version=NEW.catalog_version;
  IF version_xid IS NULL OR version_xid <> (pg_current_xact_id()::text::numeric % 4294967296)::bigint THEN
    RAISE EXCEPTION 'A published catalog version cannot receive more rows' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='region_catalog_nodes' THEN
    IF NEW.parent_region_id IS NOT NULL THEN
      SELECT * INTO parent FROM region_catalog_nodes
        WHERE catalog_version=NEW.catalog_version AND region_id=NEW.parent_region_id;
      IF parent.region_id IS NULL OR left(parent.source_code,2)<>left(NEW.source_code,2)
        OR (NEW.level='PREFECTURE' AND parent.level<>'PROVINCE')
        OR (NEW.level='COUNTY' AND parent.level NOT IN ('PROVINCE','PREFECTURE'))
        OR (parent.level='PREFECTURE' AND parent.source_code<>left(NEW.source_code,4)||'00') THEN
        RAISE EXCEPTION 'Invalid region parent hierarchy' USING ERRCODE='23514';
      END IF;
      IF NEW.level='COUNTY' AND parent.level='PROVINCE' AND EXISTS (
        SELECT 1 FROM region_catalog_nodes WHERE catalog_version=NEW.catalog_version
          AND source_code=left(NEW.source_code,4)||'00'
      ) THEN
        RAISE EXCEPTION 'County must reference its real prefecture' USING ERRCODE='23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='region_legacy_aliases' THEN
    SELECT * INTO target FROM region_catalog_nodes
      WHERE catalog_version=NEW.catalog_version AND region_id=NEW.region_id;
    IF target.region_id IS NULL THEN
      RAISE EXCEPTION 'Alias requires a catalog region' USING ERRCODE='23514';
    END IF;
    IF NEW.kind='CANONICAL_UNIQUE' AND (target.name<>NEW.label OR
      (SELECT count(*) FROM region_catalog_nodes WHERE catalog_version=NEW.catalog_version AND name=NEW.label)<>1) THEN
      RAISE EXCEPTION 'Canonical alias must be an unambiguous formal name' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER region_catalog_versions_immutable BEFORE UPDATE OR DELETE ON region_catalog_versions
  FOR EACH ROW EXECUTE FUNCTION c22_region_reference_guard();
CREATE TRIGGER region_catalog_versions_no_truncate BEFORE TRUNCATE ON region_catalog_versions
  FOR EACH STATEMENT EXECUTE FUNCTION c22_region_reference_guard();
CREATE TRIGGER region_catalog_nodes_guard BEFORE INSERT OR UPDATE OR DELETE ON region_catalog_nodes
  FOR EACH ROW EXECUTE FUNCTION c22_region_reference_guard();
CREATE TRIGGER region_catalog_nodes_no_truncate BEFORE TRUNCATE ON region_catalog_nodes
  FOR EACH STATEMENT EXECUTE FUNCTION c22_region_reference_guard();
CREATE TRIGGER region_legacy_aliases_guard BEFORE INSERT OR UPDATE OR DELETE ON region_legacy_aliases
  FOR EACH ROW EXECUTE FUNCTION c22_region_reference_guard();
CREATE TRIGGER region_legacy_aliases_no_truncate BEFORE TRUNCATE ON region_legacy_aliases
  FOR EACH STATEMENT EXECUTE FUNCTION c22_region_reference_guard();

ALTER TABLE event_directory_listings
  ADD COLUMN region_catalog_version text,
  ADD COLUMN region_id uuid,
  ADD CONSTRAINT event_directory_region_pair CHECK ((region_catalog_version IS NULL)=(region_id IS NULL)),
  ADD CONSTRAINT event_directory_region_fk FOREIGN KEY (region_catalog_version,region_id)
    REFERENCES region_catalog_nodes(catalog_version,region_id);
CREATE INDEX event_directory_active_region ON event_directory_listings(region_id) WHERE status='ACTIVE';
CREATE INDEX event_directory_active_city ON event_directory_listings(display_city) WHERE status='ACTIVE';
`;
}

async function generated(source) {
  const catalog = buildCatalog(source);
  const license = await readFile(path.join(directory, 'LICENSE'), 'utf8');
  if (!license.startsWith('Creative Commons Legal Code\n\nCC0 1.0 Universal\n'))
    fail('Missing upstream CC0 license');
  const licenseBlob = createHash('sha1')
    .update(`blob ${Buffer.byteLength(license)}\0`)
    .update(license)
    .digest('hex');
  if (licenseBlob !== '0e259d42c996742e9e3cba14c677129b2c1b6311')
    fail('Fixed license Git blob mismatch');
  const manifest = {
    catalogVersion: VERSION,
    dataDate: DATA_DATE,
    sourceRepo: SOURCE_REPO,
    sourceCommit: SOURCE_COMMIT,
    sourcePath: 'data/2025.txt',
    sourceBlob: SOURCE_BLOB,
    sourceSha256: SOURCE_SHA256,
    license: 'CC0-1.0',
    licenseBlob,
    licenseSha256: sha256(license),
    namespace: NAMESPACE,
    nodeCount: catalog.nodes.length,
    aliasCount: catalog.aliases.length,
    normalizedSha256: catalog.nodesSha256,
    aliasSha256: catalog.aliasesSha256,
    partialRootIds: catalog.partialRootIds,
  };
  const registry = {
    namespace: NAMESPACE,
    firstSeen: DATA_DATE,
    ids: Object.fromEntries(catalog.nodes.map((n) => [n.sourceCode, n.regionId])),
  };
  const constants =
    [
      ['REGION_CATALOG_VERSION', VERSION],
      ['REGION_DATA_DATE', DATA_DATE],
      ['REGION_NODE_COUNT', catalog.nodes.length],
      ['REGION_ALIAS_COUNT', catalog.aliases.length],
      ['REGION_SOURCE_REPO', SOURCE_REPO],
      ['REGION_SOURCE_COMMIT', SOURCE_COMMIT],
      ['REGION_SOURCE_BLOB', SOURCE_BLOB],
      ['REGION_SOURCE_SHA256', SOURCE_SHA256],
      ['REGION_LICENSE', 'CC0-1.0'],
      ['REGION_NODES_SHA256', catalog.nodesSha256],
      ['REGION_ALIASES_SHA256', catalog.aliasesSha256],
    ]
      .map(([name, value]) => {
        const literal = typeof value === 'string' ? sql(value) : value;
        const line = `export const ${name} = ${literal};`;
        return line.length > 100 ? `export const ${name} =\n  ${literal};` : line;
      })
      .join('\n') +
    '\nexport const REGION_PARTIAL_ROOT_IDS = [\n' +
    catalog.partialRootIds.map((id) => `  '${id}',`).join('\n') +
    '\n] as const;\n';
  let migration =
    schema() +
    '\n-- Keep all C18 authorization, locking and withdrawal rules; only add region immutability.\n';
  const original = await readFile(
    path.join(root, 'apps/api/migrations/018_c18_public_event_directory.sql'),
    'utf8',
  );
  const guard = /CREATE FUNCTION c18_directory_listing_guard\(\)[\s\S]*?\n\$\$;/.exec(
    original,
  )?.[0];
  if (!guard || !guard.includes('OR NEW.display_city IS DISTINCT FROM OLD.display_city'))
    fail('C18 listing guard changed; review before regenerating');
  migration +=
    guard
      .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
      .replace(
        'OR NEW.display_city IS DISTINCT FROM OLD.display_city',
        'OR NEW.display_city IS DISTINCT FROM OLD.display_city\n    OR NEW.region_catalog_version IS DISTINCT FROM OLD.region_catalog_version\n    OR NEW.region_id IS DISTINCT FROM OLD.region_id',
      ) + '\n\n-- Fixed reference seed. A later catalog release must append a new version.\n';
  const versionValues = [
    VERSION,
    DATA_DATE,
    SOURCE_REPO,
    SOURCE_COMMIT,
    SOURCE_BLOB,
    SOURCE_SHA256,
    'CC0-1.0',
    catalog.nodesSha256,
    catalog.aliasesSha256,
  ];
  migration +=
    'INSERT INTO region_catalog_versions(version,data_date,source_repo,source_commit,source_blob,source_sha256,license,normalized_sha256,alias_sha256,node_count,alias_count) VALUES\n  (' +
    versionValues.map(sql).join(',') +
    `,${catalog.nodes.length},${catalog.aliases.length});\n`;
  migration +=
    'INSERT INTO region_catalog_nodes(catalog_version,region_id,source_code,name,level,parent_region_id) VALUES\n' +
    catalog.nodes
      .map(
        (n) =>
          '  (' +
          [VERSION, n.regionId, n.sourceCode, n.name, n.level, n.parentRegionId]
            .map(sql)
            .join(',') +
          ')',
      )
      .join(',\n') +
    ';\n';
  migration +=
    'INSERT INTO region_legacy_aliases(catalog_version,label,region_id,kind,provenance) VALUES\n' +
    catalog.aliases
      .map(
        (a) =>
          '  (' + [VERSION, a.label, a.regionId, a.kind, a.provenance].map(sql).join(',') + ')',
      )
      .join(',\n') +
    ';\n';
  return {
    files: new Map([
      ['apps/api/data/regions/manifest.json', JSON.stringify(manifest, null, 2) + '\n'],
      ['apps/api/data/regions/registry.json', JSON.stringify(registry, null, 2) + '\n'],
      [
        'apps/api/src/region-catalog-data.ts',
        '// Generated by scripts/build-region-catalog.mjs; do not edit.\n' + constants,
      ],
      ['apps/api/migrations/023_c21_region_directory.sql', migration],
    ]),
    manifest,
  };
}

export async function checkOrWrite(mode) {
  if (!['--check', '--write'].includes(mode))
    fail('Use --check or --write; no network or database options are accepted');
  const { files, manifest } = await generated(
    await readFile(path.join(directory, '2025.txt'), 'utf8'),
  );
  for (const [name, value] of files) {
    if (mode === '--write') await writeFile(path.join(root, name), value, 'utf8');
    else if ((await readFile(path.join(root, name), 'utf8')) !== value)
      fail(`Generated region file differs: ${name}`);
  }
  return {
    mode,
    catalogVersion: VERSION,
    nodeCount: manifest.nodeCount,
    aliasCount: manifest.aliasCount,
    normalizedSha256: manifest.normalizedSha256,
    aliasSha256: manifest.aliasSha256,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) fail('Expected exactly --check or --write');
    console.log(JSON.stringify(await checkOrWrite(process.argv[2])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
