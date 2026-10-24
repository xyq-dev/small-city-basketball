import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { commandHash, replayStats } from '../src/scoring-domain.js';
import { recordedCollectionMode } from '../src/player-statistics.js';
import { hashPassword, verifyPassword } from '../src/security.js';
import type {
  ScoringCommandInput,
  ScoringEventData,
  ScoringRules,
} from '@small-city-basketball/contracts';
import { ORIGIN, call, data, testDatabaseUrl } from './support.js';

// This is a genuine 001–007 -> 008–016 database upgrade, never a downgrade of a
// database first migrated by the new application. The persisted legacy fixture
// is a user. Old scoring schema/defaults and legacy command/replay fixtures are
// checked, but this file does NOT claim an existing FINAL match upgrade test.
const migrations = new URL('../migrations/', import.meta.url);
const legacyNames = [
  '001_p02_foundation.sql',
  '002_p03_registration.sql',
  '003_p04_scheduling.sql',
  '004_p05_scoring.sql',
  '005_p05_standings_public.sql',
  '006_p06_overlay.sql',
  '007_p04_match_rescheduling.sql',
];
const additions = [
  '008_p05_player_statistics.sql',
  '009_c02_login_names.sql',
  '010_c03_event_history.sql',
  '011_c04_knockout.sql',
  '012_c05_group_knockout.sql',
  '013_c05_commerce.sql',
  '014_c05_wechat.sql',
  '015_c05_media.sql',
  '016_c06_player_bookings.sql',
];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-23T00:00:00.000Z';
const oldCommand: ScoringCommandInput = {
  commandId: id(10),
  expectedVersion: 4,
  capturedAt: at,
  type: 'RECORD_STAT',
  payload: { kind: 'SCORE', side: 'HOME', value: 2 },
  control: { leaseId: id(11), fencingToken: '1', clientInstanceId: id(12) },
};
// Canonical bytes from the old public contract, with no memberId/default field.
const oldHash = createHash('sha256')
  .update(
    JSON.stringify({
      commandId: oldCommand.commandId,
      expectedVersion: oldCommand.expectedVersion,
      capturedAt: oldCommand.capturedAt,
      type: oldCommand.type,
      payload: oldCommand.payload,
      control: oldCommand.control,
    }),
  )
  .digest('hex');
const oldEvents: ScoringEventData[] = [
  {
    id: id(20),
    seq: 1,
    type: 'PREPARE_MATCH',
    payload: {},
    actorId: id(1),
    commandId: id(21),
    capturedAt: at,
    serverTime: at,
    targetEventId: null,
  },
  {
    id: id(22),
    seq: 2,
    type: 'STAT_RECORDED',
    payload: { kind: 'SCORE', side: 'HOME', value: 2, period: 1 },
    actorId: id(1),
    commandId: oldCommand.commandId,
    capturedAt: at,
    serverTime: at,
    targetEventId: null,
  },
];
const rules: ScoringRules = {
  regulationPeriods: 1,
  periodDurationSeconds: 60,
  allowedScoreValues: [1, 2, 3],
  tiePolicy: 'ALLOW_DRAW',
  overtimeDurationSeconds: null,
};

describe(
  'C02 actual legacy-schema upgrade in an exclusively owned PostgreSQL child database',
  { concurrent: false, shuffle: false },
  () => {
    let control: Pool | undefined;
    let pool: Pool | undefined;
    let childUrl: string;
    let created = false;
    let ownership: { name: string; oid: number; nonce: string } | undefined;
    const name = `scb_test_c02_upgrade_${randomUUID().replaceAll('-', '')}`;
    const nonce = randomUUID();
    const email = `legacy-${randomUUID()}@example.test`;
    const password = 'C02 isolated legacy account password 2026';
    let legacyUser: Record<string, unknown>;
    let legacyStateColumns: {
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }[];
    let checksums: { name: string; checksum: string }[];

    async function ownsDatabase() {
      if (!ownership || !control) return false;
      const row = (
        await control.query<{ oid: number; comment: string }>(
          "SELECT oid::int AS oid,shobj_description(oid,'pg_database') AS comment FROM pg_database WHERE datname=$1",
          [name],
        )
      ).rows[0];
      return (
        row?.oid === ownership.oid && row.comment === `scb_c02_upgrade_owner:${ownership.nonce}`
      );
    }
    async function close() {
      try {
        if (pool) {
          await pool.end();
          pool = undefined;
        }
        if (created) {
          if (!(await ownsDatabase()))
            throw new Error('Refused C02 cleanup: child ownership not proven');
          const deadline = Date.now() + 5000;
          while (true) {
            const n = (
              await control!.query<{ n: number }>(
                "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1 AND backend_type='client backend'",
                [name],
              )
            ).rows[0]!.n;
            if (n === 0) break;
            if (Date.now() >= deadline)
              throw new Error('Refused C02 cleanup: child connections remain');
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          if (!(await ownsDatabase()))
            throw new Error('Refused C02 cleanup: child ownership changed');
          // Ordinary DROP only; no FORCE or termination of any unknown client.
          await control!.query(`DROP DATABASE "${name}"`);
          created = false;
        }
      } finally {
        if (control) {
          await control.end();
          control = undefined;
        }
      }
    }
    const userFacts = async () =>
      (
        await pool!.query(
          'SELECT id,email,display_name,password_hash,status,created_at,updated_at FROM users WHERE id=$1',
          [id(1)],
        )
      ).rows[0];
    const stateColumns = async () =>
      (
        await pool!.query<{
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }>(
          "SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='scoring_states' ORDER BY ordinal_position",
        )
      ).rows;

    beforeAll(async () => {
      // Fail before CREATE if a caller supplied anything except an isolated test DB.
      const base = new URL(testDatabaseUrl());
      if (!/^scb_test_[a-z0-9_]+$/.test(name) || name.length > 63)
        throw new Error('Invalid C02 owned database name');
      control = new Pool({ connectionString: base.toString(), connectionTimeoutMillis: 5000 });
      try {
        expect(
          (await control.query<{ name: string }>('SELECT current_database() name')).rows[0]!.name,
        ).toBe(decodeURIComponent(base.pathname.slice(1)));
        await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
        created = true;
        const oid = (
          await control.query<{ oid: number }>(
            'SELECT oid::int oid FROM pg_database WHERE datname=$1',
            [name],
          )
        ).rows[0]!.oid;
        await control.query(`COMMENT ON DATABASE "${name}" IS 'scb_c02_upgrade_owner:${nonce}'`);
        ownership = { name, oid, nonce };
        await control.query(`REVOKE CONNECT ON DATABASE "${name}" FROM PUBLIC`);
        base.pathname = `/${name}`;
        childUrl = base.toString();
        pool = new Pool({ connectionString: childUrl, connectionTimeoutMillis: 5000 });
        expect(
          (await pool.query<{ name: string }>('SELECT current_database() name')).rows[0]!.name,
        ).toBe(name);
        const connection = await pool.connect();
        try {
          await connection.query('BEGIN');
          await connection.query('SELECT pg_advisory_xact_lock($1)', [7240202601]);
          await connection.query(
            "CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum char(64) NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'),applied_at timestamptz NOT NULL DEFAULT clock_timestamp())",
          );
          checksums = [];
          for (const migration of legacyNames) {
            const sql = await readFile(new URL(migration, migrations), 'utf8');
            const checksum = createHash('sha256').update(sql).digest('hex');
            await connection.query(sql);
            await connection.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
              migration,
              checksum,
            ]);
            checksums.push({ name: migration, checksum });
          }
          await connection.query('COMMIT');
        } catch (error) {
          await connection.query('ROLLBACK');
          throw error;
        } finally {
          connection.release();
        }
        await pool.query(
          'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
          [id(1), email, '合成旧版用户', await hashPassword(password)],
        );
        legacyUser = await userFacts();
        legacyStateColumns = await stateColumns();
        expect(legacyStateColumns.some((c) => c.column_name === 'collection_mode')).toBe(false);
        expect(
          (await pool.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows,
        ).toEqual(checksums);
      } catch (error) {
        await close();
        throw error;
      }
    }, 60000);
    afterAll(close, 30000);

    test('applies only 008 through 010 over seven real historical checksums and preserves existing user values', async () => {
      const files = await readdir(migrations);
      for (const migration of additions) expect(files).toContain(migration);
      expect(await migrate(pool!)).toEqual(additions);
      expect(await userFacts()).toEqual(legacyUser);
      expect(
        (await pool!.query('SELECT login_name FROM users WHERE id=$1', [id(1)])).rows[0].login_name,
      ).toBeNull();
      expect(await verifyPassword(password, String(legacyUser.password_hash))).toBe(true);
      const recorded = (
        await pool!.query(
          'SELECT name,checksum FROM schema_migrations WHERE name=ANY($1::text[]) ORDER BY name',
          [legacyNames],
        )
      ).rows;
      expect(recorded).toEqual(checksums);
      const after = await stateColumns();
      expect(
        after.filter((c) => legacyStateColumns.some((old) => old.column_name === c.column_name)),
      ).toEqual(legacyStateColumns);
      expect(after.find((c) => c.column_name === 'collection_mode')).toMatchObject({
        data_type: 'text',
        is_nullable: 'NO',
        column_default: expect.stringContaining('TEAM_ONLY'),
      });
      const confirmationMode = (
        await pool!.query(
          "SELECT column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='result_confirmations' AND column_name='collection_mode'",
        )
      ).rows[0];
      expect(confirmationMode).toMatchObject({
        is_nullable: 'NO',
        column_default: expect.stringContaining('TEAM_ONLY'),
      });
      const historyPurpose = (
        await pool!.query(
          "SELECT column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='public_event_publications' AND column_name='purpose'",
        )
      ).rows[0];
      expect(historyPurpose).toMatchObject({
        is_nullable: 'NO',
        column_default: expect.stringContaining('LIVE'),
      });
      const guard = (
        await pool!.query<{ definition: string }>(
          "SELECT pg_get_functiondef('p05_state_guard()'::regprocedure) definition",
        )
      ).rows[0]!.definition;
      expect(guard).toContain('OLD.collection_mode');
      expect(guard).toContain('NEW.collection_mode');
    });

    test('keeps the old email account usable through real HTTP after the upgrade', async () => {
      const api = await createApi({ databaseUrl: childUrl, appOrigin: ORIGIN });
      try {
        const session = data<{ user: { id: string; email: string } }>(
          await call(api, 'post', '/v1/auth/login', { body: { email, password } }),
        );
        expect(session.user).toMatchObject({ id: id(1), email });
        expect(await userFacts()).toEqual(legacyUser);
      } finally {
        await api.app.close();
        await api.pool.end();
      }
    });

    test('keeps the sixty-three manifest tables and every declared runtime update column compatible', async () => {
      const manifest = JSON.parse(
        await readFile(
          new URL('../../../packages/contracts/runtime-privileges.json', import.meta.url),
          'utf8',
        ),
      ) as { tables: Record<string, { updateColumns: string[] }> };
      const actual = (
        await pool!.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
        )
      ).rows.map((row) => row.table_name);
      expect(actual).toHaveLength(63);
      expect(Object.keys(manifest.tables).sort()).toEqual(actual);
      const columns = (
        await pool!.query<{ table_name: string; column_name: string }>(
          "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'",
        )
      ).rows;
      for (const [table, rule] of Object.entries(manifest.tables))
        for (const column of rule.updateColumns)
          expect(
            columns.some((row) => row.table_name === table && row.column_name === column),
            `${table}.${column}`,
          ).toBe(true);
    });

    test('preserves legacy command canonical bytes, team-only replay semantics and idempotent migration', async () => {
      expect(commandHash(oldCommand)).toBe(oldHash);
      const replay = replayStats(oldEvents, rules, 1);
      expect(recordedCollectionMode(oldEvents)).toBe('TEAM_ONLY');
      expect(replay.home).toEqual({ score: 2, fouls: 0, timeouts: 0 });
      expect(replay.away).toEqual({ score: 0, fouls: 0, timeouts: 0 });
      expect(replay.activeStats.get(id(22))).not.toHaveProperty('memberId');
      const rows = (
        await pool!.query('SELECT name,checksum,applied_at FROM schema_migrations ORDER BY name')
      ).rows;
      expect(await migrate(pool!)).toEqual([]);
      expect(
        (await pool!.query('SELECT name,checksum,applied_at FROM schema_migrations ORDER BY name'))
          .rows,
      ).toEqual(rows);
    });

    test('rejects a changed historical checksum without applying or rewriting anything', async () => {
      const original = checksums[0]!;
      try {
        await pool!.query('UPDATE schema_migrations SET checksum=$2 WHERE name=$1', [
          original.name,
          '0'.repeat(64),
        ]);
        await expect(migrate(pool!)).rejects.toThrow(
          `Migration checksum mismatch: ${original.name}`,
        );
        expect(await userFacts()).toEqual(legacyUser);
        expect((await pool!.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n).toBe(
          16,
        );
      } finally {
        await pool!.query('UPDATE schema_migrations SET checksum=$2 WHERE name=$1', [
          original.name,
          original.checksum,
        ]);
      }
      expect(await migrate(pool!)).toEqual([]);
    });
  },
);
