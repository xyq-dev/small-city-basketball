import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import { ApiError } from './errors.js';
import { readVerifiedRegionCatalog } from './region-catalog-integrity.js';

export interface PrivilegeManifest {
  version: 1;
  schema: 'public';
  runtimeRole: 'scb_runtime';
  backupRole: 'scb_backup';
  tables: Record<
    string,
    { privileges: ('SELECT' | 'INSERT' | 'DELETE')[]; updateColumns: string[] }
  >;
}
export interface TablePrivileges {
  name: string;
  owner: boolean;
  select: boolean;
  insert: boolean;
  delete: boolean;
  update: boolean;
  dangerous: boolean;
  columns: {
    name: string;
    select: boolean;
    insert: boolean;
    update: boolean;
    references: boolean;
  }[];
}
export function migrationSetsMatch(
  expected: Map<string, string>,
  rows: { name: string; checksum: string }[],
): boolean {
  return (
    expected.size === rows.length &&
    new Set(rows.map((r) => r.name)).size === rows.length &&
    rows.every((r) => expected.get(r.name) === r.checksum)
  );
}
export function privilegesMatch(manifest: PrivilegeManifest, tables: TablePrivileges[]): boolean {
  const expected = Object.keys(manifest.tables);
  if (
    tables.length !== expected.length ||
    new Set(tables.map((t) => t.name)).size !== expected.length
  )
    return false;
  return tables.every((t) => {
    const rule = manifest.tables[t.name];
    if (!rule || t.owner || t.update || t.dangerous) return false;
    const p = new Set(rule.privileges);
    if (
      t.select !== p.has('SELECT') ||
      t.insert !== p.has('INSERT') ||
      t.delete !== p.has('DELETE')
    )
      return false;
    const columns = new Set(t.columns.map((c) => c.name));
    if (rule.updateColumns.some((name) => !columns.has(name))) return false;
    return t.columns.every(
      (c) =>
        c.update === rule.updateColumns.includes(c.name) &&
        c.select === p.has('SELECT') &&
        c.insert === p.has('INSERT') &&
        !c.references,
    );
  });
}

async function expectations() {
  const manifest = JSON.parse(
    await readFile(
      new URL('../../../packages/contracts/runtime-privileges.json', import.meta.url),
      'utf8',
    ),
  ) as PrivilegeManifest;
  if (
    manifest.version !== 1 ||
    manifest.schema !== 'public' ||
    manifest.runtimeRole !== 'scb_runtime' ||
    manifest.backupRole !== 'scb_backup' ||
    !manifest.tables ||
    Object.keys(manifest.tables).length !== 81
  )
    throw new Error();
  for (const [name, t] of Object.entries(manifest.tables)) {
    if (
      !/^[a-z][a-z_]+$/.test(name) ||
      !Array.isArray(t.privileges) ||
      !Array.isArray(t.updateColumns) ||
      t.privileges.some((p) => !['SELECT', 'INSERT', 'DELETE'].includes(p)) ||
      (t.privileges.includes('DELETE') &&
        !['auth_rate_limits', 'wechat_auth_attempts'].includes(name)) ||
      t.updateColumns.some((v) => !/^[a-z][a-z_]+$/.test(v)) ||
      new Set(t.privileges).size !== t.privileges.length ||
      new Set(t.updateColumns).size !== t.updateColumns.length
    )
      throw new Error();
  }
  const directory = new URL('../migrations/', import.meta.url);
  const names = (await readdir(directory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (names.length === 0) throw new Error();
  const expected = new Map(
    await Promise.all(
      names.map(
        async (name) =>
          [
            name,
            createHash('sha256')
              .update(await readFile(new URL(name, directory)))
              .digest('hex'),
          ] as const,
      ),
    ),
  );
  return { manifest, expected };
}

/** Read-only verification. It never migrates, grants, writes a counter, or logs a cause. */
export async function assertRuntimeReadiness(pool: Pool): Promise<void> {
  let client: PoolClient | undefined;
  try {
    const { manifest, expected } = await expectations();
    client = await pool.connect();
    await client.query('BEGIN READ ONLY');
    const role = (
      await client.query<{ safe: boolean }>(
        `SELECT current_user=$1 AND session_user=$1 AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
       AND NOT pg_is_in_recovery() AND current_setting('default_transaction_read_only')='off' AND current_setting('session_replication_role')='origin'
       AND NOT has_parameter_privilege(current_user,'session_replication_role','SET')
       AND NOT has_database_privilege(current_user,current_database(),'CREATE') AND NOT has_database_privilege(current_user,current_database(),'TEMP')
       AND has_schema_privilege(current_user,'public','USAGE')
       AND NOT EXISTS(SELECT 1 FROM pg_roles other WHERE other.oid<>r.oid AND pg_has_role(current_user,other.oid,'MEMBER'))
       AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (n.nspowner=r.oid OR has_schema_privilege(current_user,n.oid,'CREATE')))
       AND NOT EXISTS(SELECT 1 FROM pg_database d WHERE d.datname=current_database() AND d.datdba=r.oid)
       AS safe FROM pg_roles r WHERE r.rolname=current_user`,
        [manifest.runtimeRole],
      )
    ).rows[0];
    if (role?.safe !== true) throw new Error();
    const extension = await client.query("SELECT 1 FROM pg_extension WHERE extname='btree_gist'");
    if (extension.rowCount !== 1) throw new Error();
    const applied = await client.query<{ name: string; checksum: string }>(
      'SELECT name,checksum FROM public.schema_migrations ORDER BY name',
    );
    if (!migrationSetsMatch(expected, applied.rows)) throw new Error();
    const tables = await client.query<TablePrivileges>(
      `SELECT c.relname AS name,c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owner,
       has_table_privilege(current_user,c.oid,'SELECT') AS "select",has_table_privilege(current_user,c.oid,'INSERT') AS "insert",has_table_privilege(current_user,c.oid,'DELETE') AS "delete",has_table_privilege(current_user,c.oid,'UPDATE') AS "update",
       (has_table_privilege(current_user,c.oid,'TRUNCATE') OR has_table_privilege(current_user,c.oid,'TRIGGER') OR has_table_privilege(current_user,c.oid,'REFERENCES') OR has_table_privilege(current_user,c.oid,'MAINTAIN')) AS dangerous,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('name',a.attname,'select',has_column_privilege(current_user,c.oid,a.attnum,'SELECT'),'insert',has_column_privilege(current_user,c.oid,a.attnum,'INSERT'),'update',has_column_privilege(current_user,c.oid,a.attnum,'UPDATE'),'references',has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES')) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb) AS columns
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`,
    );
    if (!privilegesMatch(manifest, tables.rows)) throw new Error();
    const extra = await client.query<{ present: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND
       CASE WHEN c.relkind='S' THEN (has_sequence_privilege(current_user,c.oid,'SELECT') OR has_sequence_privilege(current_user,c.oid,'UPDATE') OR has_sequence_privilege(current_user,c.oid,'USAGE'))
       WHEN c.relkind IN ('r','p','v','m','f') AND (n.nspname<>'public' OR c.relkind NOT IN ('r','p')) THEN (c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR has_any_column_privilege(current_user,c.oid,'SELECT') OR has_any_column_privilege(current_user,c.oid,'INSERT') OR has_any_column_privilege(current_user,c.oid,'UPDATE') OR has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE') OR has_table_privilege(current_user,c.oid,'TRIGGER') OR has_any_column_privilege(current_user,c.oid,'REFERENCES') OR has_table_privilege(current_user,c.oid,'MAINTAIN')) ELSE false END) AS present`,
    );
    if (extra.rows[0]?.present !== false) throw new Error();
    await readVerifiedRegionCatalog(client);
    await client.query('COMMIT');
  } catch {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* Keep the fixed public error. */
      }
    }
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', '服务尚未就绪');
  } finally {
    client?.release();
  }
}
