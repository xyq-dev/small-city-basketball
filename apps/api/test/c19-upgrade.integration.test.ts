import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { testDatabaseUrl } from './support.js';

// C19 G: a persisted legacy-database upgrade drill.
//
// legacy-007.json is NOT an in-memory replay and not a single inserted user. It was produced by
// fixtures/c19-upgrade/generate-legacy-007.mjs, which ran the REAL historical API (commit
// 1534216, migrations exactly 001–007) over HTTP against its own isolated PostgreSQL, created a
// complete FINAL event (registration, frozen entries, published schedule, scoring commands with
// receipts, a voided stat, independent confirmation, standings rules, public viewing, an overlay
// grant and session, a pending invitation, a signed-out session) and exported every row of every
// table exactly. This test rebuilds that database byte-for-byte in an owned child database
// (proven by per-table hashes recorded at generation time), upgrades it with the CURRENT
// migrate() over every later migration found in the directory (so 019–022 are covered
// automatically once they exist), and then checks persistence, the current API, checksum
// behaviour and an isolated backup -> restore -> quarantine cycle.
interface LegacyTable {
  columns: string[];
  generated: string[];
  rowCount: number;
  sha256: string;
  rows: Record<string, unknown>[];
}
interface LegacyCommand {
  actor: 'owner' | 'scorer';
  body: Record<string, unknown> & { commandId: string; type: string };
  response: { receipt: Record<string, unknown>; snapshot: Record<string, unknown> };
}
interface LegacyFixture {
  format: string;
  databaseTimeZone: string;
  historicalCommit: string;
  origin: string;
  password: string;
  organizationId: string;
  eventId: string;
  matchId: string;
  users: Record<string, { id: string; email: string }>;
  credentials: {
    ownerSession: string;
    scorerSession: string;
    leaderSession: string;
    signedOutSession: string;
    pendingInvitation: { id: string; token: string };
    overlay: { overlayId: string; token: string; session: string };
  };
  commands: LegacyCommand[];
  public: {
    publicEventId: string;
    publicMatchId: string;
    event: Record<string, unknown>;
    schedule: Record<string, unknown>[];
    standings: Record<string, unknown>;
    match: Record<string, unknown>;
  };
  migrations: { name: string; checksum: string }[];
  tables: Record<string, LegacyTable>;
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/c19-upgrade/legacy-007.json', import.meta.url), 'utf8'),
) as LegacyFixture;
const migrationsDir = new URL('../migrations/', import.meta.url);
const LEGACY = [
  '001_p02_foundation.sql',
  '002_p03_registration.sql',
  '003_p04_scheduling.sql',
  '004_p05_scoring.sql',
  '005_p05_standings_public.sql',
  '006_p06_overlay.sql',
  '007_p04_match_rescheduling.sql',
];
// The complete C19 candidate must contain every frozen module table, with zero automatic rows
// after an upgrade. Missing migrations must fail instead of making a partial candidate pass.
const NO_AUTOMATIC_ROWS = [
  'event_directory_listings',
  'media_request_receipts',
  'media_upload_sessions',
  'media_upload_chunks',
  'team_request_links',
  'team_requests',
  'team_join_codes',
  'team_member_bindings',
  'team_member_claims',
  'event_follows',
  'seasons',
  'season_events',
  'season_data_grants',
];
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const quote = (name: string) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error('Unexpected identifier');
  return `"${name}"`;
};

async function tableHash(c: Pool | PoolClient, table: string, columns: string[]) {
  const list = columns.map(quote).join(',');
  const rows = (
    await c.query<{ value: string }>(
      `SELECT to_jsonb(t)::text AS value FROM (SELECT ${list} FROM public.${quote(table)}) t ORDER BY to_jsonb(t)::text COLLATE "C"`,
    )
  ).rows;
  const hash = createHash('sha256');
  for (const row of rows) hash.update(row.value).update('\n');
  return { rowCount: rows.length, sha256: hash.digest('hex') };
}
async function publicTables(c: Pool | PoolClient) {
  return (
    await c.query<{ relname: string }>(
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname",
    )
  ).rows.map((r) => r.relname);
}
async function columnsOf(c: Pool | PoolClient, table: string) {
  return (
    await c.query<{ attname: string }>(
      "SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
      [table],
    )
  ).rows.map((r) => r.attname);
}
/** Every table, every column: the full fingerprint used to compare a restore to its source. */
async function fullFingerprint(c: Pool | PoolClient) {
  const result: Record<string, { rowCount: number; sha256: string }> = {};
  for (const table of await publicTables(c))
    result[table] = await tableHash(c, table, await columnsOf(c, table));
  return result;
}
/** Deterministic load order; FK triggers are held during the load (see beforeAll). */
async function loadOrder(_c: Pool | PoolClient, tables: string[]) {
  return [...tables].sort();
}
/** Every foreign key checked explicitly: rows whose referenced row is missing. */
async function orphans(c: Pool | PoolClient) {
  const keys = (
    await c.query<{ name: string; child: string; parent: string; cc: string[]; pc: string[] }>(
      `SELECT k.conname AS name,c.relname AS child,p.relname AS parent,
        ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY u(n,i) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.n ORDER BY u.i)::text[] AS cc,
        ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY u(n,i) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=u.n ORDER BY u.i)::text[] AS pc
       FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_class p ON p.oid=k.confrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND k.contype='f' ORDER BY k.conname`,
    )
  ).rows;
  const bad: string[] = [];
  for (const k of keys) {
    const notNull = k.cc.map((col) => `x.${quote(col)} IS NOT NULL`).join(' AND ');
    const join = k.cc.map((col, i) => `y.${quote(k.pc[i]!)}=x.${quote(col)}`).join(' AND ');
    const n = (
      await c.query<{ n: number }>(
        `SELECT count(*)::int n FROM public.${quote(k.child)} x WHERE ${notNull} AND NOT EXISTS(SELECT 1 FROM public.${quote(k.parent)} y WHERE ${join})`,
      )
    ).rows[0]!.n;
    if (n) bad.push(`${k.name}:${n}`);
  }
  return bad;
}
function findPgTool(name: 'pg_dump' | 'pg_restore'): string | null {
  const candidates = [
    process.env.SCB_PG_BIN ? join(process.env.SCB_PG_BIN, name) : null,
    name,
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (result.status === 0 && /\(PostgreSQL\) 18\./.test(result.stdout)) return candidate;
  }
  return null;
}

describe(
  'C19 legacy 001–007 FINAL event: persisted upgrade, API continuity, backup/restore drill',
  { concurrent: false, shuffle: false },
  () => {
    let control: Pool | undefined;
    let pool: Pool | undefined;
    let childUrl = '';
    const owned = new Map<string, { oid: number; nonce: string }>();
    const name = `scb_test_c19_upgrade_${randomBytes(8).toString('hex')}`;
    let laterMigrations: string[] = [];
    let applied: string[] = [];
    let upgradedFingerprint: Record<string, { rowCount: number; sha256: string }> = {};
    const notes: string[] = [];

    async function createOwned(database: string, template = 'template0') {
      await control!.query(`CREATE DATABASE ${quote(database)} TEMPLATE ${quote(template)}`);
      const oid = (
        await control!.query<{ oid: number }>(
          'SELECT oid::int oid FROM pg_database WHERE datname=$1',
          [database],
        )
      ).rows[0]!.oid;
      const nonce = randomUUID();
      // A restore target carries the ops/recovery ownership comment format; others ours.
      const comment = database.startsWith('scb_restore_')
        ? `scb_restore_owner:${nonce}`
        : `scb_c19_upgrade_owner:${nonce}`;
      await control!.query(`COMMENT ON DATABASE ${quote(database)} IS '${comment}'`);
      owned.set(database, { oid, nonce });
      // to_jsonb(timestamptz) uses the connection's TimeZone. Preserve the export's explicit
      // serialization zone so an identical historical instant hashes identically on Linux
      // and Windows; never rewrite the fixture rows or regenerate expected hashes to pass.
      if (!/^[A-Za-z_]+(?:\/[A-Za-z_]+)*$/.test(fixture.databaseTimeZone))
        throw new Error('Unexpected fixture database time zone');
      await control!.query(
        `ALTER DATABASE ${quote(database)} SET TimeZone TO '${fixture.databaseTimeZone}'`,
      );
      const url = new URL(testDatabaseUrl());
      url.pathname = `/${database}`;
      return { url: url.toString(), oid, nonce };
    }
    async function dropOwned(database: string) {
      const mine = owned.get(database);
      if (!mine) return;
      const row = (
        await control!.query<{ oid: number; comment: string }>(
          "SELECT oid::int oid,shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname=$1",
          [database],
        )
      ).rows[0];
      if (!row) {
        owned.delete(database);
        return;
      }
      if (row.oid !== mine.oid || !row.comment?.endsWith(`:${mine.nonce}`))
        throw new Error(`Refused cleanup of ${database}: ownership not proven`);
      const deadline = Date.now() + 10000;
      while (
        (
          await control!.query<{ n: number }>(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1 AND backend_type='client backend'",
            [database],
          )
        ).rows[0]!.n > 0
      ) {
        if (Date.now() > deadline)
          throw new Error(`Refused cleanup of ${database}: clients remain`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await control!.query(`DROP DATABASE ${quote(database)}`);
      owned.delete(database);
    }
    async function startApi(databaseUrl: string) {
      const instance = await createApi({ databaseUrl, appOrigin: fixture.origin });
      await instance.app.listen(0, '127.0.0.1');
      const base = (await instance.app.getUrl()).replace('[::1]', '127.0.0.1');
      async function call(
        route: string,
        options: { method?: string; body?: unknown; cookie?: string } = {},
      ) {
        const response = await fetch(base + route, {
          method: options.method ?? 'GET',
          headers: {
            Origin: fixture.origin,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.cookie ? { Cookie: options.cookie } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
        const payload = (await response.json().catch(() => null)) as {
          data?: unknown;
          meta?: Record<string, unknown>;
          error?: { code: string };
        } | null;
        return {
          status: response.status,
          data: payload?.data as any,
          meta: payload?.meta,
          error: payload?.error,
          cookie: response.headers.getSetCookie()[0]?.split(';')[0],
        };
      }
      async function login(email: string) {
        const r = await call('/v1/auth/login', {
          method: 'POST',
          body: { email, password: fixture.password },
        });
        expect(r.status, JSON.stringify(r.error)).toBe(200);
        return r.cookie!;
      }
      return {
        call,
        login,
        async close() {
          await instance.app.close();
          await instance.pool.end().catch(() => {});
        },
      };
    }

    beforeAll(async () => {
      expect(fixture.format).toBe('SCB_C19_LEGACY_007_V1');
      const base = new URL(testDatabaseUrl());
      control = new Pool({ connectionString: base.toString(), connectionTimeoutMillis: 5000 });
      const child = await createOwned(name);
      childUrl = child.url;
      await control.query(`REVOKE CONNECT ON DATABASE ${quote(name)} FROM PUBLIC`);
      pool = new Pool({ connectionString: childUrl, connectionTimeoutMillis: 5000 });
      // Rebuild the historical schema from the unchanged 001–007 files plus the historical
      // schema_migrations DDL (identical in 1534216 and today), then load every exported row.
      const files = (await readdir(migrationsDir)).filter((f) => /^\d+_[a-z0-9_]+\.sql$/.test(f));
      laterMigrations = files.sort().filter((f) => !LEGACY.includes(f));
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'), applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
        for (const [index, migration] of LEGACY.entries()) {
          const sql = await readFile(new URL(migration, migrationsDir), 'utf8');
          expect(fixture.migrations[index]).toEqual({ name: migration, checksum: sha(sql) });
          await c.query(sql);
        }
        const legacyTables = Object.keys(fixture.tables).sort();
        expect(await publicTables(c)).toEqual(legacyTables);
        // Legacy foreign keys are cyclic (events <-> rulesets/publications), so the historical
        // rows are loaded with FK/user triggers held (replica role, superuser only) and every
        // foreign key is re-verified row by row right after the load.
        await c.query("SET LOCAL session_replication_role = 'replica'");
        for (const table of await loadOrder(c, legacyTables)) {
          const t = fixture.tables[table]!;
          expect(await columnsOf(c, table), table).toEqual(t.columns);
          if (!t.rows.length) continue;
          const insertable = t.columns.filter((col) => !t.generated.includes(col));
          const list = insertable.map(quote).join(',');
          await c.query(
            `INSERT INTO public.${quote(table)} (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public.${quote(table)}, $1::jsonb)`,
            [JSON.stringify(t.rows)],
          );
        }
        await c.query("SET LOCAL session_replication_role = 'origin'");
        expect(await orphans(c)).toEqual([]);
        // Identity/serial sequences continue after the historical maximum.
        const sequences = (
          await c.query<{ table_name: string; column_name: string; seq: string }>(
            "SELECT c.relname AS table_name,a.attname AS column_name,pg_get_serial_sequence('public.'||quote_ident(c.relname),a.attname) AS seq FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped AND pg_get_serial_sequence('public.'||quote_ident(c.relname),a.attname) IS NOT NULL",
          )
        ).rows;
        for (const s of sequences)
          await c.query(
            `SELECT setval($1, GREATEST((SELECT COALESCE(max(${quote(s.column_name)}),0) FROM public.${quote(s.table_name)}),1), (SELECT count(*)>0 FROM public.${quote(s.table_name)}))`,
            [s.seq],
          );
        await c.query('COMMIT');
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      } finally {
        c.release();
      }
    }, 120000);

    afterAll(async () => {
      try {
        await pool?.end();
        pool = undefined;
        for (const database of [...owned.keys()]) await dropOwned(database);
      } finally {
        await control?.end();
        if (notes.length) console.info('[C19 upgrade drill]\n- ' + notes.join('\n- '));
      }
    }, 60000);

    test('the rebuilt database is the exact historical 001–007 persisted state', async () => {
      for (const [table, t] of Object.entries(fixture.tables)) {
        expect(await tableHash(pool!, table, t.columns), table).toEqual({
          rowCount: t.rowCount,
          sha256: t.sha256,
        });
      }
      const counts = Object.fromEntries(
        Object.entries(fixture.tables).map(([k, t]) => [k, t.rowCount]),
      );
      // A complete FINAL event, not a lone user: commands, events, confirmation, schedule, identity.
      expect(counts.scoring_commands).toBeGreaterThanOrEqual(10);
      expect(counts.scoring_events).toBeGreaterThanOrEqual(10);
      expect(counts.result_confirmations).toBe(1);
      expect(counts.published_matches).toBe(1);
      expect(counts.public_event_publications).toBe(1);
      expect(counts.overlay_grants).toBe(1);
      const state = (
        await pool!.query<{ status: string }>(
          'SELECT m.status FROM published_matches m WHERE m.id=$1',
          [fixture.matchId],
        )
      ).rows[0];
      expect(state?.status).toBe('FINAL');
      expect(
        (await pool!.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows,
      ).toEqual(fixture.migrations);
    });

    test('current migrate() applies every later migration once and keeps every legacy column value', async () => {
      expect(laterMigrations.length).toBeGreaterThanOrEqual(11);
      applied = await migrate(pool!);
      expect(applied).toEqual(laterMigrations);
      const changed: string[] = [];
      for (const [table, t] of Object.entries(fixture.tables)) {
        const now = await tableHash(pool!, table, t.columns);
        if (now.sha256 !== t.sha256 || now.rowCount !== t.rowCount) changed.push(table);
      }
      // schema_migrations gains the new rows; every other legacy table keeps its exact values
      // in every column that existed at 007 (old command ids, receipts, events, confirmation,
      // schedule, public identity, overlay grant, sessions, invitations, password hashes).
      expect(changed).toEqual(['schema_migrations']);
      const legacyMigrationRows = (
        await pool!.query<{ name: string; checksum: string; applied_at: Date }>(
          'SELECT name,checksum,applied_at FROM schema_migrations WHERE name=ANY($1) ORDER BY name',
          [LEGACY],
        )
      ).rows;
      expect(legacyMigrationRows.map((r) => ({ name: r.name, checksum: r.checksum }))).toEqual(
        fixture.migrations,
      );
      expect(legacyMigrationRows.map((r) => r.applied_at.toISOString())).toEqual(
        fixture.tables.schema_migrations!.rows.map((r) =>
          new Date(String(r.applied_at)).toISOString(),
        ),
      );
    }, 120000);

    test('new tables and columns: compatible, and nothing is listed, followed, bound or granted', async () => {
      const tables = await publicTables(pool!);
      const added = tables.filter((t) => !fixture.tables[t]);
      const nonEmpty: Record<string, number> = {};
      for (const table of added) {
        const n = (
          await pool!.query<{ n: number }>(`SELECT count(*)::int n FROM public.${quote(table)}`)
        ).rows[0]!.n;
        if (n) nonEmpty[table] = n;
      }
      notes.push('New tables after upgrade: ' + added.length + ' (' + added.join(', ') + ')');
      // Only migration-seeded configuration rows are allowed; no listing, follow, binding,
      // season grant, performance link, operator, WeChat identity or booking appears.
      expect(nonEmpty).toEqual(SEEDED_CONFIGURATION);
      expect(
        (
          await pool!.query(
            'SELECT event_id,org_id,source,participant_count,expected_match_count FROM event_commercial_activations',
          )
        ).rows,
      ).toEqual([
        {
          event_id: fixture.eventId,
          org_id: fixture.organizationId,
          source: 'LEGACY',
          participant_count: 2,
          expected_match_count: 1,
        },
      ]);
      for (const table of NO_AUTOMATIC_ROWS) {
        expect(tables, `required C19 table missing: ${table}`).toContain(table);
        const n = (
          await pool!.query<{ n: number }>(`SELECT count(*)::int n FROM public.${quote(table)}`)
        ).rows[0]!.n;
        expect(n, table).toBe(0);
      }
      // New columns on legacy rows: list every one with the distinct values it took.
      const additions: Record<string, Record<string, unknown[]>> = {};
      for (const [table, t] of Object.entries(fixture.tables)) {
        if (table === 'schema_migrations') continue;
        const extra = (await columnsOf(pool!, table)).filter((c) => !t.columns.includes(c));
        for (const column of extra) {
          const values = (
            await pool!.query<{ v: unknown }>(
              `SELECT DISTINCT to_jsonb(${quote(column)}) AS v FROM public.${quote(table)} ORDER BY 1`,
            )
          ).rows.map((r) => r.v);
          (additions[table] ??= {})[column] = values;
        }
      }
      expect(additions).toEqual(EXPECTED_NEW_COLUMN_VALUES);
      // Every constraint of the upgraded schema holds for the legacy rows (no NOT VALID left).
      const unvalidated = (
        await pool!.query(
          "SELECT conname FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public' AND NOT k.convalidated",
        )
      ).rows;
      expect(unvalidated).toEqual([]);
      upgradedFingerprint = await fullFingerprint(pool!);
    });

    test('checksums: a second run is a no-op; a changed historical checksum stops the whole run', async () => {
      expect(await migrate(pool!)).toEqual([]);
      expect(await fullFingerprint(pool!)).toEqual(upgradedFingerprint);
      // Tamper only in a disposable copy of the upgraded database.
      await pool!.end();
      pool = undefined;
      const copyName = `scb_test_c19_tamper_${randomBytes(6).toString('hex')}`;
      const copy = await createOwned(copyName, name);
      const copyPool = new Pool({ connectionString: copy.url, connectionTimeoutMillis: 5000 });
      try {
        await copyPool.query(
          "UPDATE schema_migrations SET checksum=repeat('0',64) WHERE name='004_p05_scoring.sql'",
        );
        await copyPool.query('DELETE FROM schema_migrations WHERE name=$1', [
          laterMigrations.at(-1),
        ]);
        await expect(migrate(copyPool)).rejects.toThrow(
          'Migration checksum mismatch: 004_p05_scoring.sql',
        );
        // Rolled back as a unit: the deleted later migration was not re-applied either.
        expect(
          (
            await copyPool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [
              laterMigrations.at(-1),
            ])
          ).rowCount,
        ).toBe(0);
      } finally {
        await copyPool.end();
        await dropOwned(copyName);
      }
      pool = new Pool({ connectionString: childUrl, connectionTimeoutMillis: 5000 });
      expect(await fullFingerprint(pool)).toEqual(upgradedFingerprint);
    }, 120000);

    test('the current API serves the legacy commands, receipts, confirmation, results and identity unchanged', async () => {
      const api = await startApi(childUrl);
      try {
        const now = Date.now();
        const sessions = (
          await pool!.query<{ expires_at: Date; revoked_at: Date | null; token_hash: string }>(
            'SELECT expires_at,revoked_at,token_hash FROM sessions',
          )
        ).rows;
        const live = (cookie: string) => {
          const token = cookie.slice('scb.sid='.length);
          const hash = sha(token);
          const row = sessions.find((s) => s.token_hash === hash);
          return !!row && !row.revoked_at && row.expires_at.getTime() > now;
        };
        // Old credentials: still-valid sessions keep working; the signed-out one never revives.
        for (const key of ['ownerSession', 'scorerSession', 'leaderSession'] as const) {
          const r = await api.call('/v1/auth/session', { cookie: fixture.credentials[key] });
          if (live(fixture.credentials[key])) expect(r.status, key).toBe(200);
          else {
            expect(r.status, key).toBe(401);
            notes.push(`${key} has expired since the fixture was generated; checked as 401`);
          }
        }
        expect(
          (await api.call('/v1/auth/session', { cookie: fixture.credentials.signedOutSession }))
            .status,
        ).toBe(401);
        const owner = await api.login(fixture.users.owner!.email);
        const scorer = await api.login(fixture.users.scorer!.email);
        const cookies = { owner, scorer };
        const root = `/v1/orgs/${fixture.organizationId}/matches/${fixture.matchId}`;
        const eventsBefore = (
          await pool!.query<{ n: number }>(
            'SELECT count(*)::int n FROM scoring_events WHERE match_id=$1',
            [fixture.matchId],
          )
        ).rows[0]!.n;
        for (const command of fixture.commands) {
          const receipt = await api.call(`${root}/commands/${command.body.commandId}`, {
            cookie: cookies[command.actor],
          });
          expect(receipt.status, command.body.type).toBe(200);
          expect(receipt.data.receipt ?? receipt.data, command.body.type).toMatchObject(
            command.response.receipt,
          );
        }
        // The confirmation command replayed with its original envelope returns the original
        // receipt and never writes again.
        const confirm = fixture.commands.find((c) => c.body.type === 'CONFIRM_RESULT')!;
        const replay = await api.call(`${root}/commands`, {
          method: 'POST',
          cookie: owner,
          body: confirm.body,
        });
        expect(replay.status, JSON.stringify(replay.error)).toBe(200);
        expect(replay.data.receipt).toMatchObject(confirm.response.receipt);
        expect(
          (
            await pool!.query<{ n: number }>(
              'SELECT count(*)::int n FROM scoring_events WHERE match_id=$1',
              [fixture.matchId],
            )
          ).rows[0]!.n,
        ).toBe(eventsBefore);
        const confirmations = await api.call(`${root}/result-confirmations`, { cookie: owner });
        expect(confirmations.status).toBe(200);
        expect(confirmations.data).toHaveLength(1);
        // Public identity, schedule, standings and the confirmed result read the same values.
        const p = fixture.public;
        const pub = await api.call(`/v1/public/events/${p.publicEventId}`);
        expect(pub.status).toBe(200);
        expect(pub.data).toMatchObject(stripVolatile(p.event));
        const schedule = await api.call(`/v1/public/events/${p.publicEventId}/schedule?limit=50`);
        expect(schedule.data).toMatchObject(p.schedule.map(stripVolatile));
        const standings = await api.call(`/v1/public/events/${p.publicEventId}/standings`);
        expect(standings.data).toMatchObject(stripVolatile(p.standings));
        const match = await api.call(
          `/v1/public/events/${p.publicEventId}/matches/${p.publicMatchId}`,
        );
        expect(match.status).toBe(200);
        expect(match.data).toMatchObject(stripVolatile(p.match));
        // Not listed in the public directory by the upgrade.
        const directory = await api.call('/v1/public/directory');
        expect(directory.status).toBe(200);
        expect(directory.data.items ?? directory.data).toEqual([]);
        // The overlay grant and its session stay exactly as authorized (until their expiry).
        const grant = (
          await pool!.query<{ expires_at: Date; revoked_at: Date | null }>(
            'SELECT expires_at,revoked_at FROM overlay_grants',
          )
        ).rows[0]!;
        const overlay = await api.call(
          `/v1/overlays/${fixture.credentials.overlay.overlayId}/snapshot`,
          { cookie: fixture.credentials.overlay.session },
        );
        if (!grant.revoked_at && grant.expires_at.getTime() > now) expect(overlay.status).toBe(200);
        else {
          expect([401, 403, 404, 410]).toContain(overlay.status);
          notes.push(
            'overlay grant expired since generation; verified rejection ' + overlay.status,
          );
        }
      } finally {
        await api.close();
      }
      // Reads and logins only: legacy business rows are still identical.
      for (const [table, t] of Object.entries(fixture.tables)) {
        if (['schema_migrations', 'sessions', 'auth_rate_limits', 'audit_logs'].includes(table))
          continue;
        expect(await tableHash(pool!, table, t.columns), table).toEqual({
          rowCount: t.rowCount,
          sha256: t.sha256,
        });
      }
    }, 120000);

    test('backup -> restore -> quarantine: old credentials and new authorizations never revive', async () => {
      // A new post-upgrade authorization: the event is explicitly listed (C18) with a reason.
      const api = await startApi(childUrl);
      let freshOwner = '';
      const orgPath = `/v1/orgs/${fixture.organizationId}`;
      const matchPath = `${orgPath}/matches/${fixture.matchId}`;
      const newAuth: Record<string, any> = {};
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      const uploadInput = () => ({
        clientRequestId: randomUUID(),
        purpose: 'MATCH_IMAGE',
        fileName: 'upgrade-drill.png',
        contentType: 'image/png',
        byteLength: png.length,
        contentSha256: createHash('sha256').update(png).digest('hex'),
      });
      try {
        freshOwner = await api.login(fixture.users.owner!.email);
        const post = async (route: string, body: unknown, cookie = freshOwner) => {
          const result = await api.call(route, { method: 'POST', cookie, body });
          expect([200, 201], `${route}: ${JSON.stringify(result.error)}`).toContain(result.status);
          return result.data;
        };
        const eventPath = `/v1/orgs/${fixture.organizationId}/events/${fixture.eventId}`;
        const event = (await api.call(eventPath, { cookie: freshOwner })).data;
        const listed = await api.call(`${eventPath}/directory-commands`, {
          method: 'POST',
          cookie: freshOwner,
          body: {
            type: 'LIST',
            expectedEventVersion: event.version,
            displayCity: '高州',
            reason: '升级演练：显式列入目录',
          },
        });
        expect(listed.status, JSON.stringify(listed.error)).toBe(200);
        const directory = await api.call('/v1/public/directory');
        expect((directory.data.items ?? directory.data).length).toBe(1);

        // Seed each newly introduced authorization through its real HTTP command before the
        // backup. A restore test with empty C19 tables cannot prove revocation or non-revival.
        newAuth.link = await post(`${orgPath}/team-request-links`, {
          expiresInHours: 24,
          maxUses: 10,
          reason: '升级恢复演练合成入口',
        });
        const members = fixture.tables.team_members!.rows;
        newAuth.code = await post(`${orgPath}/teams/${members[0]!.team_id}/join-codes`, {});
        newAuth.pendingClaim = await post(
          `${orgPath}/teams/${members[0]!.team_id}/members/${members[0]!.id}/claims`,
          { targetUserId: fixture.users.invitee!.id },
        );
        const bindings = [];
        newAuth.grantIds = [];
        for (const [index, actor] of ['scorer', 'leader'].entries()) {
          const member = members[index + 1]!;
          const claimant = await api.login(fixture.users[actor]!.email);
          const claim = await post(
            `${orgPath}/teams/${member.team_id}/members/${member.id}/claims`,
            { targetUserId: fixture.users[actor]!.id },
          );
          bindings.push(await post(`/v1/me/member-claims/${claim.id}/accept`, {}, claimant));
          const grant = await post(`${eventPath}/season-data-grants`, {
            clientRequestId: randomUUID(),
            teamId: member.team_id,
            memberId: member.id,
            targetUserId: fixture.users[actor]!.id,
            reason: '升级恢复演练私有授权',
          });
          newAuth.grantIds.push(grant.id);
          if (actor === 'scorer') {
            const consent = await post(
              `/v1/me/season-data-grants/${grant.id}/commands`,
              { type: 'CONSENT', expectedVersion: grant.version },
              claimant,
            );
            expect(consent.status).toBe('ACTIVE');
          } else expect(grant.status).toBe('PENDING');
        }
        newAuth.bindings = bindings;
        const season = await post(`${orgPath}/seasons`, {
          clientRequestId: randomUUID(),
          name: '升级恢复演练赛季',
          startDate: event.startDate,
          endDate: event.endDate,
        });
        newAuth.seasonId = season.id;
        const attached = await post(`${orgPath}/seasons/${season.id}/commands`, {
          type: 'ATTACH_EVENT',
          eventId: fixture.eventId,
          expectedVersion: season.version,
        });
        await post(`${orgPath}/seasons/${season.id}/commands`, {
          type: 'ACTIVATE',
          expectedVersion: attached.version,
        });
        newAuth.follow = await post('/v1/me/follows', {
          publicEventId: fixture.public.publicEventId,
        });
        expect(newAuth.follow.status).toBe('ACTIVE');

        // Completed file bytes must survive; an in-progress upload and its retained chunk
        // must be cancelled/cleared. Their request identities are retained in both cases.
        newAuth.completedInput = uploadInput();
        const completed = await post(`${matchPath}/media-file-requests`, {
          ...newAuth.completedInput,
          contentBase64: png.toString('base64'),
        });
        expect(completed.state).toBe('FILE');
        newAuth.fileId = completed.file.id;
        newAuth.openInput = uploadInput();
        newAuth.session = await post(`${matchPath}/media-upload-sessions`, newAuth.openInput);
        const chunk = await api.call(
          `${matchPath}/media-upload-sessions/${newAuth.session.id}/chunks/0`,
          {
            method: 'PUT',
            cookie: freshOwner,
            body: {
              byteLength: png.length,
              sha256: newAuth.openInput.contentSha256,
              contentBase64: png.toString('base64'),
            },
          },
        );
        expect(chunk.status, JSON.stringify(chunk.error)).toBe(200);
        expect(chunk.data.receivedBytes).toBe(png.length);
      } finally {
        await api.close();
      }
      const source = await fullFingerprint(pool!);
      await pool!.end();
      pool = undefined;

      const restoreName = `scb_restore_c19v_${randomBytes(6).toString('hex')}`;
      const pgDump = findPgTool('pg_dump');
      const pgRestore = findPgTool('pg_restore');
      if (process.env.SCB_REQUIRE_ARCHIVE_RESTORE === '1') {
        expect(
          pgDump,
          'the required archive drill needs pg_dump 18 (SCB_PG_BIN or PATH)',
        ).not.toBeNull();
        expect(
          pgRestore,
          'the required archive drill needs pg_restore 18 (SCB_PG_BIN or PATH)',
        ).not.toBeNull();
      }
      let restored: { url: string; oid: number; nonce: string };
      if (pgDump && pgRestore) {
        const dir = mkdtempSync(
          join(
            process.env.SCB_PG_WORK_DIRECTORY ?? process.env.RUNNER_TEMP ?? tmpdir(),
            'scb-c19-drill-',
          ),
        );
        try {
          const archive = join(dir, 'drill.dump');
          const dump = spawnSync(
            pgDump,
            ['--format=custom', '--no-owner', '--no-acl', '--file', archive, '--dbname', childUrl],
            { encoding: 'utf8' },
          );
          expect(dump.status, 'pg_dump failed').toBe(0);
          restored = await createOwned(restoreName);
          const load = spawnSync(
            pgRestore,
            [
              '--single-transaction',
              '--exit-on-error',
              '--no-owner',
              '--no-acl',
              '--dbname',
              restored.url,
              archive,
            ],
            { encoding: 'utf8' },
          );
          expect(load.status, 'pg_restore failed').toBe(0);
          notes.push('backup/restore used pg_dump --format=custom and pg_restore (PostgreSQL 18)');
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      } else {
        // No pg_dump/pg_restore 18 on this host: a server-side database copy stands in for the
        // archive round trip. ops/recovery/{backup,restore}.mjs themselves are NOT exercised.
        restored = await createOwned(restoreName, name);
        notes.push(
          'pg_dump/pg_restore 18 not found (set SCB_PG_BIN): restore used CREATE DATABASE … TEMPLATE; the archive round trip and ops/recovery scripts remain for Linux CI',
        );
      }
      const restoredPool = new Pool({
        connectionString: restored.url,
        connectionTimeoutMillis: 5000,
      });
      try {
        expect(await fullFingerprint(restoredPool)).toEqual(source);
        // Quarantine with the real ops/recovery implementation. Without the provisioned
        // scb_migrator role (Linux CI has it) its single SET LOCAL ROLE statement is skipped.
        const { quarantineRestoredDatabase } =
          (await import('../../../ops/recovery/quarantine.mjs')) as {
            quarantineRestoredDatabase: (input: {
              pool: unknown;
              ownership: unknown;
            }) => Promise<{ counts: Record<string, number> }>;
          };
        const migrator = (
          await restoredPool.query(
            "SELECT pg_has_role(current_user,'scb_migrator','MEMBER') AS ok FROM pg_roles WHERE rolname='scb_migrator'",
          )
        ).rows[0]?.ok;
        if (process.env.SCB_REQUIRE_ARCHIVE_RESTORE === '1')
          expect(
            migrator,
            'the required archive drill must exercise the real scb_migrator role',
          ).toBe(true);
        if (migrator) {
          // pg_restore --no-owner deliberately leaves this disposable copy owned by the test
          // database user. Provision only DML in this owned database for the real NOLOGIN
          // migrator role; never change role attributes or grants in an existing database.
          await restoredPool.query('GRANT USAGE ON SCHEMA public TO scb_migrator');
          await restoredPool.query(
            'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO scb_migrator',
          );
        }
        const quarantinePool = migrator
          ? restoredPool
          : {
              query: (sql: string, params?: unknown[]) => restoredPool.query(sql, params),
              connect: async () => {
                const client = await restoredPool.connect();
                return new Proxy(client, {
                  get(target, prop) {
                    if (prop === 'query')
                      return (sql: string, params?: unknown[]) =>
                        sql === 'SET LOCAL ROLE scb_migrator'
                          ? Promise.resolve({ rows: [], rowCount: 0 })
                          : target.query(sql, params);
                    const value = Reflect.get(target, prop);
                    return typeof value === 'function' ? value.bind(target) : value;
                  },
                });
              },
            };
        if (!migrator)
          notes.push(
            'quarantine ran without the scb_migrator role switch (role not provisioned here)',
          );
        const result = await quarantineRestoredDatabase({
          pool: quarantinePool,
          ownership: {
            version: 1,
            databaseName: restoreName,
            databaseOid: restored.oid,
            nonce: restored.nonce,
          },
        });
        expect(result.counts.sessionsRevoked).toBeGreaterThan(0);
        expect(result.counts.publicPublicationsRevoked).toBe(1);
        expect(result.counts.overlayGrantsRevoked).toBe(1);
        expect(result.counts.pendingInvitationsRevoked).toBe(1);
        expect(result.counts.teamRequestLinksRevoked).toBe(1);
        expect(result.counts.teamJoinCodesRevoked).toBe(1);
        expect(result.counts.pendingMemberClaimsRevoked).toBe(1);
        expect(
          (await restoredPool.query('SELECT status FROM season_data_grants ORDER BY id')).rows,
        ).toEqual([{ status: 'WITHDRAWN' }, { status: 'WITHDRAWN' }]);
        const uploadState = (
          await restoredPool.query(
            'SELECT status,closed_at FROM media_upload_sessions WHERE id=$1',
            [newAuth.session.id],
          )
        ).rows[0]!;
        expect(['CANCELLED', 'EXPIRED']).toContain(uploadState.status);
        expect(uploadState.closed_at).not.toBeNull();
        expect(
          (
            await restoredPool.query(
              'SELECT payload FROM media_upload_chunks WHERE session_id=$1',
              [newAuth.session.id],
            )
          ).rows,
        ).toEqual([{ payload: null }]);
        expect(
          (
            await restoredPool.query('SELECT payload FROM media_files WHERE id=$1', [
              newAuth.fileId,
            ])
          ).rows[0]!.payload,
        ).toEqual(png);
        expect(
          (
            await restoredPool.query(
              "SELECT count(*)::int n FROM team_member_bindings WHERE status='ACTIVE'",
            )
          ).rows[0]!.n,
        ).toBe(2); // Historical membership is preserved; PRIVATE_SEASON consent is separately withdrawn.
        const live = (
          await restoredPool.query<{ n: number }>(
            'SELECT count(*)::int n FROM sessions WHERE revoked_at IS NULL',
          )
        ).rows[0]!.n;
        expect(live).toBe(0);
      } finally {
        await restoredPool.end();
      }
      const restoredApi = await startApi(restored.url);
      try {
        for (const cookie of [
          fixture.credentials.ownerSession,
          fixture.credentials.scorerSession,
          fixture.credentials.leaderSession,
          fixture.credentials.signedOutSession,
          freshOwner,
        ])
          expect((await restoredApi.call('/v1/auth/session', { cookie })).status).toBe(401);
        expect(
          (await restoredApi.call(`/v1/public/events/${fixture.public.publicEventId}`)).status,
        ).toBe(404);
        const overlay = await restoredApi.call(
          `/v1/overlays/${fixture.credentials.overlay.overlayId}/snapshot`,
          { cookie: fixture.credentials.overlay.session },
        );
        expect([401, 403, 404, 410]).toContain(overlay.status);
        const directory = await restoredApi.call('/v1/public/directory');
        expect(directory.data.items ?? directory.data).toEqual([]);
        const invitation = await restoredApi.call(
          `/v1/invitations/${fixture.credentials.pendingInvitation.id}/accept`,
          {
            method: 'POST',
            cookie: await restoredApi.login(fixture.users.invitee!.email),
            body: { token: fixture.credentials.pendingInvitation.token },
          },
        );
        expect(invitation.status).toBe(422);
        expect(invitation.error?.code).toBe('INVITATION_INVALID');
        // A password login still opens an account, but its organization stays disabled.
        const relogin = await restoredApi.login(fixture.users.owner!.email);
        const events = await restoredApi.call(
          `/v1/orgs/${fixture.organizationId}/events?limit=50`,
          { cookie: relogin },
        );
        expect([403, 404]).toContain(events.status);

        // Re-enable only this owned restored organization's row to simulate later recovery.
        // The blanket DISABLED guard must not be the only thing preventing old grants,
        // bearer tokens or upload reservations from silently becoming live again.
        const reenable = new Pool({ connectionString: restored.url });
        try {
          await reenable.query(
            "UPDATE organizations SET status='ACTIVE',updated_at=clock_timestamp() WHERE id=$1",
            [fixture.organizationId],
          );
        } finally {
          await reenable.end();
        }
        const ownerAfter = await restoredApi.login(fixture.users.owner!.email);
        const inviteeAfter = await restoredApi.login(fixture.users.invitee!.email);
        const scorerAfter = await restoredApi.login(fixture.users.scorer!.email);
        const link = await restoredApi.call('/v1/team-request-links/resolve', {
          method: 'POST',
          cookie: inviteeAfter,
          body: { token: newAuth.link.token },
        });
        expect([404, 409, 410, 422]).toContain(link.status);
        const join = await restoredApi.call('/v1/team-joins', {
          method: 'POST',
          cookie: inviteeAfter,
          body: { code: newAuth.code.code, displayName: '恢复后不可凭旧码入队' },
        });
        expect([404, 409, 410, 422]).toContain(join.status);
        const claim = await restoredApi.call(
          `/v1/me/member-claims/${newAuth.pendingClaim.id}/accept`,
          {
            method: 'POST',
            cookie: inviteeAfter,
            body: {},
          },
        );
        expect([404, 409, 410, 422]).toContain(claim.status);
        const grants = await restoredApi.call('/v1/me/season-data-grants', { cookie: scorerAfter });
        expect(grants.status).toBe(200);
        expect(grants.data.grants).toHaveLength(1);
        expect(grants.data.grants[0].status).toBe('WITHDRAWN');
        expect(grants.data.grants[0].capabilities.canConsent).toBe(false);
        const summary = await restoredApi.call(
          `${orgPath}/seasons/${newAuth.seasonId}/player-statistics`,
          { cookie: ownerAfter },
        );
        expect(summary.status).toBe(200);
        expect(summary.data.summary.effectiveGrantCount).toBe(0);
        expect(summary.data.summary.rows).toEqual([]);
        const followed = await restoredApi.call('/v1/me/follows', { cookie: ownerAfter });
        expect(followed.status).toBe(200);
        expect(followed.data).toHaveLength(1);
        expect(followed.data[0]).toMatchObject({ status: 'INVALID', event: null });
        const closed = await restoredApi.call(
          `${matchPath}/media-upload-sessions/${newAuth.session.id}`,
          { cookie: ownerAfter },
        );
        expect(closed.status).toBe(200);
        expect(['CANCELLED', 'EXPIRED']).toContain(closed.data.status);
        expect(closed.data.chunks).toEqual([]);
        const reuse = await restoredApi.call(`${matchPath}/media-file-requests`, {
          method: 'POST',
          cookie: ownerAfter,
          body: { ...newAuth.openInput, contentBase64: png.toString('base64') },
        });
        expect(reuse.status).toBe(409);
        expect(reuse.error?.code).toBe('REQUEST_CLOSED');
        const completedReceipt = await restoredApi.call(
          `${matchPath}/media-file-requests/${newAuth.completedInput.clientRequestId}`,
          { cookie: ownerAfter },
        );
        expect(completedReceipt.status).toBe(200);
        expect(completedReceipt.data).toMatchObject({
          state: 'FILE',
          file: { id: newAuth.fileId },
        });
      } finally {
        await restoredApi.close();
      }
      await dropOwned(restoreName);
      // The source database is untouched by the restore cycle.
      pool = new Pool({ connectionString: childUrl, connectionTimeoutMillis: 5000 });
      expect(await fullFingerprint(pool)).toEqual(source);
    }, 180000);
  },
);

/** Server time and request ids differ per read; every other public field must match. */
function stripVolatile<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripVolatile) as T;
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      if (!['serverTime', 'asOf', 'generatedAt'].includes(k)) result[k] = stripVolatile(v);
    return result as T;
  }
  return value;
}

// Filled from the first observed run and reviewed: see docs/handoffs/C19-verify.md.
// booking_settings: 016's singleton platform-rate row (no person, no grant).
// event_commercial_activations: 013 grandfathers every event whose schedule was already
// published as source LEGACY, so a legacy event keeps working without a paid activation. It
// grants no data access and is asserted field by field below.
const SEEDED_CONFIGURATION: Record<string, number> = {
  booking_settings: 1,
  event_commercial_activations: 1,
};
// New columns on legacy rows take only neutral defaults: a legacy publication is LIVE, legacy
// scoring stays team-only without player statistics, no group config, no login name.
const EXPECTED_NEW_COLUMN_VALUES: Record<string, Record<string, unknown[]>> = {
  public_event_publications: { purpose: ['LIVE'] },
  result_confirmations: { collection_mode: ['TEAM_ONLY'], player_stats: [null] },
  schedule_revisions: { group_config: [null] },
  scoring_states: { collection_mode: ['TEAM_ONLY'], player_stats: [null] },
  users: { login_name: [null] },
};
