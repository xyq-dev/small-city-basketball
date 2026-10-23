import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { assertManifestSchema, loadManifest } from '../db/privileges.mjs';
import { quoteIdentifier } from '../db/common.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => JSON.stringify(value);

/** Only digests leave this function: token hashes, passwords and PII never enter reports. */
export async function fingerprintDatabase(pool) {
  const manifest = await loadManifest();
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query('SET LOCAL search_path=public,pg_catalog');
    await assertManifestSchema(client, manifest);
    const version = (
      await client.query("SELECT current_setting('server_version_num')::int AS version")
    ).rows[0].version;
    if (version < 180000 || version >= 190000) throw new Error();
    const migrations = (
      await client.query('SELECT name,checksum FROM schema_migrations ORDER BY name')
    ).rows;
    const directory = new URL('../../apps/api/migrations/', import.meta.url);
    const files = (await readdir(directory)).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
    const expected = await Promise.all(
      files.map(async (name) => ({
        name,
        checksum: digest(await readFile(new URL(name, directory))),
      })),
    );
    if (canonical(migrations) !== canonical(expected) || expected.length !== 11) throw new Error();
    const schema = {};
    const queries = {
      tables:
        "SELECT c.relname,r.rolname AS owner,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname",
      columns:
        "SELECT c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum",
      constraints:
        "SELECT c.relname,k.conname,k.contype,k.condeferrable,k.condeferred,k.convalidated,pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname",
      indexes:
        "SELECT c.relname,i.relname AS name,pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,i.relname",
      triggers:
        "SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
      functions:
        "SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)",
      extensions:
        'SELECT e.extname,e.extversion,n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname',
    };
    for (const [name, sql] of Object.entries(queries))
      schema[name] = (await client.query(sql)).rows;
    const tables = {};
    for (const table of Object.keys(manifest.tables).sort()) {
      // Keep PostgreSQL JSON text rather than JS numbers, including bigint fence values.
      const rows = (
        await client.query(
          `SELECT to_jsonb(t)::text AS value FROM public.${quoteIdentifier(table)} t ORDER BY to_jsonb(t)::text COLLATE "C"`,
        )
      ).rows;
      const hash = createHash('sha256');
      for (const row of rows) hash.update(row.value).update('\n');
      tables[table] = { rows: rows.length, sha256: hash.digest('hex') };
    }
    await client.query('COMMIT');
    return { version: 1, schemaSha256: digest(canonical(schema)), migrations, tables };
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error('Database fingerprint failed');
  } finally {
    client.release();
  }
}
