import { readFile } from 'node:fs/promises';
import { quoteIdentifier } from './common.mjs';

export async function loadManifest() {
  const manifest = JSON.parse(
    await readFile(
      new URL('../../packages/contracts/runtime-privileges.json', import.meta.url),
      'utf8',
    ),
  );
  if (
    manifest.version !== 1 ||
    manifest.schema !== 'public' ||
    manifest.runtimeRole !== 'scb_runtime' ||
    manifest.backupRole !== 'scb_backup' ||
    Object.keys(manifest.tables).length !== 65
  )
    throw new Error('Invalid privilege manifest');
  for (const [table, rule] of Object.entries(manifest.tables)) {
    quoteIdentifier(table);
    if (
      !Array.isArray(rule.privileges) ||
      !Array.isArray(rule.updateColumns) ||
      new Set(rule.privileges).size !== rule.privileges.length ||
      new Set(rule.updateColumns).size !== rule.updateColumns.length ||
      rule.privileges.some((p) => !['SELECT', 'INSERT', 'DELETE'].includes(p)) ||
      (rule.privileges.includes('DELETE') &&
        !['auth_rate_limits', 'wechat_auth_attempts'].includes(table))
    )
      throw new Error('Invalid privilege manifest');
    rule.updateColumns.forEach(quoteIdentifier);
  }
  return manifest;
}

export async function assertManifestSchema(client, manifest) {
  const actual = await client.query(
    "SELECT c.relname,r.rolname AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname",
  );
  const expected = Object.keys(manifest.tables).sort();
  if (
    JSON.stringify(actual.rows.map((r) => r.relname)) !== JSON.stringify(expected) ||
    actual.rows.some((r) => r.owner !== 'scb_migrator')
  )
    throw new Error('Database schema does not match the privilege manifest');
  const unexpected = await client.query(
    "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('S','v','m','f') LIMIT 1",
  );
  const definer = await client.query(
    "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef LIMIT 1",
  );
  if (unexpected.rowCount || definer.rowCount)
    throw new Error('Unexpected database privilege surface');
}

/** Reapplication removes old table AND column grants before granting only named objects. */
export async function applyRuntimePrivileges(pool) {
  const manifest = await loadManifest(),
    client = await pool.connect();
  try {
    await client.query('BEGIN');
    const role = (await client.query('SELECT current_user AS current,session_user AS session'))
      .rows[0];
    if (role.current !== 'scb_migrator' || role.session !== 'scb_migrator')
      throw new Error('Migration ownership is required');
    await assertManifestSchema(client, manifest);
    for (const [table, rule] of Object.entries(manifest.tables)) {
      const name = `public.${quoteIdentifier(table)}`;
      const columns = (
        await client.query(
          "SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
          [table],
        )
      ).rows.map((r) => r.attname);
      if (rule.updateColumns.some((column) => !columns.includes(column)))
        throw new Error('Invalid privilege manifest column');
      await client.query(
        `REVOKE ALL PRIVILEGES ON TABLE ${name} FROM PUBLIC,scb_runtime,scb_backup`,
      );
      await client.query(
        `REVOKE ALL PRIVILEGES (${columns.map(quoteIdentifier).join(',')}) ON TABLE ${name} FROM PUBLIC,scb_runtime,scb_backup`,
      );
      if (rule.privileges.length)
        await client.query(`GRANT ${rule.privileges.join(',')} ON TABLE ${name} TO scb_runtime`);
      if (rule.updateColumns.length)
        await client.query(
          `GRANT UPDATE (${rule.updateColumns.map(quoteIdentifier).join(',')}) ON TABLE ${name} TO scb_runtime`,
        );
      await client.query(`GRANT SELECT ON TABLE ${name} TO scb_backup`);
    }
    await client.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE scb_migrator IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC,scb_runtime,scb_backup',
    );
    await client.query('COMMIT');
    return { status: 'granted', tables: Object.keys(manifest.tables).length };
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error('Privilege application failed');
  } finally {
    client.release();
  }
}
