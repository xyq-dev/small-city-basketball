import { readFile } from 'node:fs/promises';
import { quoteIdentifier } from './common.mjs';
const functionPattern =
  /^([a-z][a-z0-9_]+)\(((?:(?:uuid|integer|text|jsonb|boolean|timestamp with time zone)(?:,(?:uuid|integer|text|jsonb|boolean|timestamp with time zone))*)?)\)$/;
export function functionSql(signature) {
  const match = functionPattern.exec(signature);
  if (!match) throw new Error('Invalid application function signature');
  return `public.${quoteIdentifier(match[1])}(${match[2]})`;
}
export const APPLICATION_FUNCTIONS_SQL = `SELECT p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')' AS signature,
 r.rolname AS owner,p.prosecdef AS definer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY signature`;

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
    !manifest.tables ||
    !Object.keys(manifest.tables).length ||
    !manifest.functions ||
    !Object.keys(manifest.functions).length
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
  for (const [signature, privileges] of Object.entries(manifest.functions)) {
    functionSql(signature);
    if (
      !Array.isArray(privileges) ||
      privileges.length > 1 ||
      privileges.some((p) => p !== 'EXECUTE')
    )
      throw new Error('Invalid function privilege manifest');
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
  const functions = await client.query(APPLICATION_FUNCTIONS_SQL);
  if (
    JSON.stringify(functions.rows.map((row) => row.signature).sort()) !==
      JSON.stringify(Object.keys(manifest.functions).sort()) ||
    functions.rows.some((row) => row.owner !== 'scb_migrator' || row.definer)
  )
    throw new Error('Database functions do not match the privilege manifest');
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
    for (const [signature, privileges] of Object.entries(manifest.functions)) {
      const name = functionSql(signature);
      await client.query(
        `REVOKE ALL PRIVILEGES ON FUNCTION ${name} FROM PUBLIC,scb_runtime,scb_backup`,
      );
      if (privileges.includes('EXECUTE'))
        await client.query(`GRANT EXECUTE ON FUNCTION ${name} TO scb_runtime`);
    }
    await client.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE scb_migrator IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,scb_runtime,scb_backup',
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

function withoutSqlComments(source) {
  let result = '',
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "'") {
      result += c;
      if (quoted && source[i + 1] === "'") {
        result += source[++i];
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (!quoted && c === '-' && source[i + 1] === '-') {
      while (i < source.length && source[i] !== '\n') i++;
      result += '\n';
      continue;
    }
    if (!quoted && c === '/' && source[i + 1] === '*') {
      i += 2;
      let depth = 1;
      while (i < source.length && depth) {
        if (source[i] === '/' && source[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (source[i] === '*' && source[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          if (source[i] === '\n') result += '\n';
          i++;
        }
      }
      i--;
      continue;
    }
    result += c;
  }
  return result;
}
function sqlList(source) {
  const values = [];
  let depth = 0,
    quoted = false,
    start = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "'") {
      if (quoted && source[i + 1] === "'") {
        i++;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      values.push(source.slice(start, i));
      start = i + 1;
    }
  }
  values.push(source.slice(start));
  return values;
}
function tableBody(source, start) {
  let depth = 1,
    quoted = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === "'") {
      if (quoted && source[i + 1] === "'") {
        i++;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (c === '(') depth++;
    if (c === ')' && --depth === 0) return source.slice(start, i);
  }
  throw Error('Incomplete checked-in table declaration');
}
/** Offline identity/column check for the deliberately constrained checked-in DDL. Real PostgreSQL remains the execution authority. */
export function assertMigrationManifestSurface(manifest, sources) {
  const tables = new Map([['schema_migrations', new Set(['name', 'checksum', 'applied_at'])]]),
    functions = new Set();
  for (const source of sources) {
    const sql = withoutSqlComments(source.sql);
    for (const m of sql.matchAll(/^\s*CREATE TABLE (?:IF NOT EXISTS )?([a-z][a-z0-9_]*)\s*\(/gm)) {
      if (tables.has(m[1])) throw Error('Duplicate checked-in table identity');
      const cols = new Set();
      for (const declaration of sqlList(tableBody(sql, m.index + m[0].length))) {
        const col = /^\s*([a-z][a-z0-9_]*)\s/i.exec(declaration)?.[1];
        if (
          col &&
          !['UNIQUE', 'CHECK', 'CONSTRAINT', 'FOREIGN', 'PRIMARY'].includes(col.toUpperCase())
        )
          cols.add(col);
      }
      tables.set(m[1], cols);
    }
    for (const m of sql.matchAll(/^\s*ALTER TABLE ([a-z][a-z0-9_]*)\s+([\s\S]*?);/gm)) {
      for (const col of m[2].matchAll(/(?:^|,)\s*ADD (?:COLUMN )?([a-z][a-z0-9_]*)\s/gi)) {
        if (!['CONSTRAINT', 'CHECK', 'UNIQUE', 'FOREIGN', 'PRIMARY'].includes(col[1].toUpperCase()))
          tables.get(m[1])?.add(col[1]);
      }
    }
    for (const m of sql.matchAll(
      /^\s*CREATE (?:OR REPLACE )?FUNCTION ([a-z][a-z0-9_]*)\(([\s\S]*?)\)\s*RETURNS/gm,
    )) {
      const types = m[2].trim()
        ? sqlList(m[2]).map((arg) => {
            const type = arg
              .trim()
              .replace(/\s+DEFAULT[\s\S]*$/i, '')
              .replace(
                /^[a-z][a-z0-9_]*\s+(?=(?:uuid|integer|text|jsonb|boolean|timestamptz|timestamp)\b)/i,
                '',
              )
              .replace(/^timestamptz$/, 'timestamp with time zone')
              .replace(/\s+/g, ' ');
            if (!/^(uuid|integer|text|jsonb|boolean|timestamp with time zone)$/.test(type))
              throw Error('Unreviewed checked-in function argument');
            return type;
          })
        : [];
      const signature = m[1] + '(' + types.join(',') + ')';
      functionSql(signature);
      functions.add(signature);
    }
  }
  if (
    JSON.stringify([...tables.keys()].sort()) !==
      JSON.stringify(Object.keys(manifest.tables).sort()) ||
    JSON.stringify([...functions].sort()) !== JSON.stringify(Object.keys(manifest.functions).sort())
  )
    throw Error('Checked-in migrations do not match the privilege manifest');
  for (const [name, rule] of Object.entries(manifest.tables))
    if (rule.updateColumns.some((col) => !tables.get(name).has(col)))
      throw Error('Privilege manifest names a missing update column');
  return { tables: tables.size, functions: functions.size };
}
