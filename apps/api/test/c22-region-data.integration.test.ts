import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createC22LegacyRegistrationApi } from './fixtures/c22-legacy-registration-api.js';
import { loadManifest } from '../../../ops/db/privileges.mjs';
import { migrate } from '../src/database/migrate.js';
import {
  REGION_CATALOG_VERSION,
  REGION_NODE_COUNT,
  REGION_ALIAS_COUNT,
  REGION_NODES_SHA256,
  REGION_ALIASES_SHA256,
} from '../src/region-catalog-data.js';
import { ORIGIN, register, testDatabaseUrl } from './support.js';
import type { Api } from './support.js';
import { team } from './p03-support.js';
import { published, enable, savePublishRules } from './p05b-support.js';
import type { Harness } from './p05b-support.js';

const migrations = new URL('../migrations/', import.meta.url);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const quote = (name: string) => {
  if (!/^[a-z][a-z0-9_]+$/.test(name)) throw new Error('Unexpected test database identifier');
  return `"${name}"`;
};

// Both databases are created by this file on the explicitly configured isolated PG server.
// No existing database is adopted, truncated, reset or dropped.
describe(
  'C22 fixed region data and 001–022 upgrade on owned PostgreSQL',
  { concurrent: false },
  () => {
    let control: Pool;
    let fresh: Pool;
    let upgraded: Pool;
    let api: Api | undefined;
    const owned: { name: string; oid: number; nonce: string; pool: Pool }[] = [];
    let baseline: Record<string, unknown[]>;
    let legacyListingId: string;
    let legacyEventId: string;

    async function createOwned(label: string) {
      const nonce = randomUUID();
      const name = `scb_test_c22_${label}_${nonce.replaceAll('-', '')}`;
      await control.query(`CREATE DATABASE ${quote(name)} TEMPLATE template0`);
      await control.query(`COMMENT ON DATABASE ${quote(name)} IS 'scb_c22_owner:${nonce}'`);
      const oid = (
        await control.query<{ oid: number }>(
          'SELECT oid::int AS oid FROM pg_database WHERE datname=$1',
          [name],
        )
      ).rows[0]!.oid;
      const url = new URL(testDatabaseUrl());
      url.pathname = `/${name}`;
      const pool = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
      owned.push({ name, oid, nonce, pool });
      return { pool, url: url.toString() };
    }

    async function tableNames(pool: Pool) {
      return (
        await pool.query<{ name: string }>(
          'SELECT tablename AS name FROM pg_tables WHERE schemaname=\'public\' ORDER BY tablename COLLATE "C"',
        )
      ).rows.map((r) => r.name);
    }

    async function snapshot(pool: Pool, names: string[]) {
      const result: Record<string, unknown[]> = {};
      for (const name of names) {
        const projection =
          name === 'event_directory_listings'
            ? "to_jsonb(t)-ARRAY['region_catalog_version','region_id']"
            : name === 'event_rulesets'
              ? "to_jsonb(t)-'require_participant_materials'"
              : name === 'users'
                ? "to_jsonb(t)-ARRAY['email_verified_at','credential_reset_at']"
                : ['scoring_states', 'result_confirmations'].includes(name)
                  ? "to_jsonb(t)-ARRAY['technical_collection','professional_stats']"
                  : 'to_jsonb(t)';
        result[name] = (
          await pool.query<{ rows: unknown[] }>(
            `SELECT coalesce(jsonb_agg(${projection} ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb) AS rows FROM ${quote(name)} t`,
          )
        ).rows[0]!.rows;
      }
      return result;
    }

    beforeAll(async () => {
      control = new Pool({ connectionString: testDatabaseUrl(), connectionTimeoutMillis: 5000 });
      const empty = await createOwned('empty');
      fresh = empty.pool;
      const old = await createOwned('upgrade');
      upgraded = old.pool;
      const c = await upgraded.connect();
      try {
        await c.query('BEGIN');
        await c.query(
          "CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum char(64) NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'),applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
        );
        const files = (await readdir(migrations))
          .filter((f) => /^\d+_[a-z0-9_]+\.sql$/.test(f) && Number(f.slice(0, 3)) <= 22)
          .sort();
        expect(files).toHaveLength(22);
        for (const name of files) {
          const sql = await readFile(new URL(name, migrations), 'utf8');
          await c.query(sql);
          await c.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
            name,
            sha(sql),
          ]);
        }
        await c.query('COMMIT');
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      } finally {
        c.release();
      }
      expect(await tableNames(upgraded)).toHaveLength(78);
      const assertOldRegistrationSchema = async () => {
        expect(
          (await upgraded.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n,
        ).toBe(22);
        expect(
          (
            await upgraded.query(
              "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='event_rulesets' AND column_name='require_participant_materials'",
            )
          ).rowCount,
        ).toBe(0);
      };
      await assertOldRegistrationSchema();
      // Fixed historical registration SQL is injected only by this fixture factory.
      // The genuine 001–022 schema is never extended before the upgrade baseline.
      api = await createC22LegacyRegistrationApi({ databaseUrl: old.url, appOrigin: ORIGIN });
      const owner = await register(api, 'c22-old-owner');
      const leader = await register(api, 'c22-old-leader');
      const otherOwner = await register(api, 'c22-old-other');
      const teams = [
        await team(api, owner, '升级甲队', leader, ['合成甲', '合成乙']),
        await team(api, owner, '升级乙队', leader, ['合成丙', '合成丁']),
      ];
      const h: Harness = {
        api,
        owner,
        leader,
        otherOwner,
        teams,
        otherTeams: [],
        databaseUrl: old.url,
        nextDate: 0,
      };
      const fixture = await published(h, teams);
      legacyEventId = fixture.event.event.id;
      await savePublishRules(h, legacyEventId);
      await enable(h, legacyEventId);
      legacyListingId = randomUUID();
      const tx = await upgraded.connect();
      try {
        await tx.query('BEGIN');
        const event = (
          await tx.query<{ version: number }>('SELECT version FROM events WHERE id=$1 FOR UPDATE', [
            legacyEventId,
          ])
        ).rows[0]!;
        const pub = (
          await tx.query<{ id: string }>(
            'SELECT id FROM public_event_publications WHERE event_id=$1 AND revoked_at IS NULL FOR SHARE',
            [legacyEventId],
          )
        ).rows[0]!;
        await tx.query(
          `INSERT INTO event_directory_listings(id,org_id,event_id,publication_id,display_city,listed_by,listed_event_version,list_reason)
        VALUES($1,$2,$3,$4,'高州',$5,$6,'迁移前合成目录')`,
          [legacyListingId, owner.orgId, legacyEventId, pub.id, owner.id, event.version + 1],
        );
        await tx.query(
          'UPDATE events SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
          [legacyEventId],
        );
        await tx.query(
          "INSERT INTO audit_logs(id,org_id,actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,'directory.listed','event',$4,$5)",
          [
            randomUUID(),
            owner.orgId,
            owner.id,
            legacyEventId,
            { listingId: legacyListingId, reason: '迁移前合成目录' },
          ],
        );
        await tx.query('COMMIT');
      } catch (error) {
        await tx.query('ROLLBACK');
        throw error;
      } finally {
        tx.release();
      }
      await api.app.close();
      await api.pool.end();
      api = undefined;
      await assertOldRegistrationSchema();
      baseline = await snapshot(upgraded, await tableNames(upgraded));
    }, 180000);

    afterAll(async () => {
      if (api) {
        await api.app.close();
        await api.pool.end();
      }
      for (const target of owned.reverse()) {
        await target.pool.end();
        const actual = (
          await control.query<{ oid: number; comment: string }>(
            "SELECT oid::int AS oid,shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname=$1",
            [target.name],
          )
        ).rows[0];
        if (actual?.oid !== target.oid || actual.comment !== `scb_c22_owner:${target.nonce}`)
          throw new Error('Refused cleanup of a database without matching ownership');
        // Pool.end may resolve just before the last TCP backend disappears; never terminate it.
        for (let n = 0; n < 20; n++) {
          const count = Number(
            (
              await control.query('SELECT count(*) AS n FROM pg_stat_activity WHERE datname=$1', [
                target.name,
              ])
            ).rows[0].n,
          );
          if (!count) break;
          if (n === 19) throw new Error('Owned C22 database still has connections; preserved');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await control.query(`DROP DATABASE ${quote(target.name)}`);
      }
      await control?.end();
    }, 30000);

    test('fresh migration imports the complete catalog and preserves deterministic hashes', async () => {
      const names = (await readdir(migrations))
        .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
        .sort();
      expect(await migrate(fresh)).toEqual(names);
      expect(await tableNames(fresh)).toEqual(Object.keys((await loadManifest()).tables).sort());
      const nodes = (
        await fresh.query(
          `SELECT region_id::text AS "regionId",source_code AS "sourceCode",name,level,parent_region_id::text AS "parentRegionId"
      FROM region_catalog_nodes WHERE catalog_version=$1 ORDER BY source_code COLLATE "C"`,
          [REGION_CATALOG_VERSION],
        )
      ).rows;
      const aliases = (
        await fresh.query(
          `SELECT label,region_id::text AS "regionId",kind,provenance FROM region_legacy_aliases
      WHERE catalog_version=$1 ORDER BY label COLLATE "C"`,
          [REGION_CATALOG_VERSION],
        )
      ).rows;
      expect(nodes).toHaveLength(REGION_NODE_COUNT);
      expect(aliases).toHaveLength(REGION_ALIAS_COUNT);
      expect(sha(JSON.stringify(nodes))).toBe(REGION_NODES_SHA256);
      expect(sha(JSON.stringify(aliases))).toBe(REGION_ALIASES_SHA256);
      expect(await migrate(fresh)).toEqual([]);
    });

    test('001–022 upgrade keeps every legacy row and leaves existing listing regions NULL', async () => {
      const added = (await readdir(migrations))
        .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name) && Number(name.slice(0, 3)) > 22)
        .sort();
      expect(await migrate(upgraded)).toEqual(added);
      const after = await snapshot(upgraded, Object.keys(baseline));
      expect(
        (
          await upgraded.query(
            'SELECT count(*)::int AS n FROM event_rulesets WHERE require_participant_materials',
          )
        ).rows[0].n,
      ).toBe(0);
      // The ledger only appends the exact current suffix; every pre-existing checksum/applied_at remains byte-for-byte.
      after.schema_migrations = after.schema_migrations!.filter(
        (r: any) => !added.includes(r.name),
      );
      expect(after).toEqual(baseline);
      expect(
        (
          await upgraded.query(
            'SELECT region_catalog_version,region_id,status,display_city FROM event_directory_listings WHERE id=$1',
            [legacyListingId],
          )
        ).rows[0],
      ).toEqual({
        region_catalog_version: null,
        region_id: null,
        status: 'ACTIVE',
        display_city: '高州',
      });
      expect(await migrate(upgraded)).toEqual([]);
    });

    test('published reference versions reject mutation, truncation and late appends', async () => {
      for (const table of [
        'region_catalog_versions',
        'region_catalog_nodes',
        'region_legacy_aliases',
      ]) {
        for (const query of [`DELETE FROM ${table}`, `TRUNCATE ${table} CASCADE`])
          await expect(upgraded.query(query)).rejects.toMatchObject({ code: '23514' });
      }
      await expect(
        upgraded.query('UPDATE region_catalog_versions SET license=license'),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        upgraded.query('UPDATE region_catalog_nodes SET name=name'),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        upgraded.query('UPDATE region_legacy_aliases SET provenance=provenance'),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        upgraded.query(
          `INSERT INTO region_catalog_nodes(catalog_version,region_id,source_code,name,level) VALUES($1,$2,'990000','合成省','PROVINCE')`,
          [REGION_CATALOG_VERSION, randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        upgraded.query(
          `INSERT INTO region_legacy_aliases(catalog_version,label,region_id,kind,provenance) SELECT catalog_version,'新增别名',region_id,'REVIEWED_ALIAS','late' FROM region_catalog_nodes WHERE source_code='440981'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    test('new unpublished versions enforce the real province/prefecture hierarchy and unique-name aliases', async () => {
      async function rejected(action: (c: PoolClient, version: string) => Promise<unknown>) {
        const c = await upgraded.connect();
        const version = `test-${randomUUID()}`;
        try {
          await c.query('BEGIN');
          await c.query(
            `INSERT INTO region_catalog_versions SELECT $1,data_date,source_repo,source_commit,source_blob,source_sha256,license,normalized_sha256,alias_sha256,node_count,alias_count,created_at FROM region_catalog_versions WHERE version=$2`,
            [version, REGION_CATALOG_VERSION],
          );
          await c.query(
            `INSERT INTO region_catalog_nodes SELECT $1,region_id,source_code,name,level,parent_region_id FROM region_catalog_nodes WHERE catalog_version=$2 AND source_code IN ('330000','440000','440900','440902') ORDER BY source_code COLLATE "C"`,
            [version, REGION_CATALOG_VERSION],
          );
          await expect(action(c, version)).rejects.toMatchObject({ code: '23514' });
        } finally {
          await c.query('ROLLBACK');
          c.release();
        }
      }
      for (const wrongParent of ['330000', '440000', '440902']) {
        await rejected((c, v) =>
          c.query(
            `INSERT INTO region_catalog_nodes(catalog_version,region_id,source_code,name,level,parent_region_id)
        SELECT $1,$2,'440981','高州市','COUNTY',region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND source_code=$3`,
            [v, randomUUID(), wrongParent],
          ),
        );
      }
      await rejected((c, v) =>
        c.query(
          `INSERT INTO region_legacy_aliases(catalog_version,label,region_id,kind,provenance)
      SELECT $1,'高州市',region_id,'CANONICAL_UNIQUE','wrong target' FROM region_catalog_nodes WHERE catalog_version=$1 AND source_code='440902'`,
          [v],
        ),
      );
    });

    test('legacy listings cannot acquire a region through an UPDATE, even during withdrawal', async () => {
      await expect(
        upgraded.query(
          `UPDATE event_directory_listings SET region_catalog_version=$1,region_id=$2 WHERE id=$3`,
          [REGION_CATALOG_VERSION, '5dbae224-8a72-5c66-8b2e-d6a7a9f312e3', legacyListingId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        upgraded.query(
          `UPDATE event_directory_listings SET status='REVOKED',revoked_at=clock_timestamp(),revoked_by=listed_by,revoke_source='UNLIST',revoke_reason='合成撤出尝试',region_catalog_version=$1,region_id=$2 WHERE id=$3`,
          [REGION_CATALOG_VERSION, '5dbae224-8a72-5c66-8b2e-d6a7a9f312e3', legacyListingId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect(
        (
          await upgraded.query(
            'SELECT status,region_id FROM event_directory_listings WHERE id=$1',
            [legacyListingId],
          )
        ).rows[0],
      ).toEqual({ status: 'ACTIVE', region_id: null });
    });
  },
);
