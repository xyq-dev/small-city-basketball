import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { TeamData } from '@small-city-basketball/contracts';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { ORIGIN, RUN_ID, call, data, register } from './support.js';
import type { Api, User } from './support.js';
import { participant, registrationDatabaseUrl, teamPath, teamsPath } from './p03-support.js';
import type { Actor } from './p03-support.js';

const databaseUrl = registrationDatabaseUrl();

describe('C19 team membership on isolated PostgreSQL', { concurrent: false }, () => {
  let api: Api;
  let owner: User;
  let leader: Actor;
  const instances: Api[] = [];

  beforeAll(async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const actual = await pool.query<{ name: string }>('SELECT current_database() AS name');
      expect(actual.rows[0]?.name).toMatch(/^scb_test_[A-Za-z0-9_]+$/);
      await migrate(pool);
    } finally {
      await pool.end();
    }
    api = await createApi({ databaseUrl, appOrigin: ORIGIN });
    instances.push(api);
    owner = await register(api, 'c19-owner');
    leader = await participant(api, 'c19-leader');
  }, 60000);
  afterAll(async () => {
    for (const instance of instances.reverse()) {
      await instance.app.close();
      await instance.pool.end();
    }
  }, 30000);

  const createTeam = async (name: string, members: string[]) => {
    let team = data<TeamData>(
      await call(api, 'post', teamsPath(owner.orgId), { cookie: owner.cookie, body: { name } }),
      201,
    );
    team = data<TeamData>(
      await call(api, 'put', `${teamPath(owner.orgId, team.id)}/members`, {
        cookie: owner.cookie,
        body: { expectedVersion: team.version, members: members.map((n) => ({ name: n })) },
      }),
    );
    return team;
  };

  test('member save archives only removed members; retained rows never flip archive→restore', async () => {
    const team = await createTeam(`保存回归 ${RUN_ID.slice(0, 6)}`, ['甲', '乙', '丙']);
    const [a, b, c] = team.members;
    const before = await api.pool.query<{ id: string; status: string; updated_at: Date }>(
      'SELECT id,status,updated_at FROM team_members WHERE team_id=$1 ORDER BY id',
      [team.id],
    );
    // Record every status transition of this team's member rows while the save runs.
    const log = `c19_member_log_${RUN_ID.slice(0, 12)}`;
    await api.pool.query(`CREATE TABLE ${log}(member_id uuid, old_status text, new_status text)`);
    await api.pool.query(
      `CREATE FUNCTION ${log}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.team_id='${team.id}'::uuid THEN
          INSERT INTO ${log} VALUES (NEW.id, OLD.status, NEW.status);
        END IF; RETURN NEW; END $$`,
    );
    await api.pool.query(
      `CREATE TRIGGER ${log} AFTER UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION ${log}()`,
    );
    let saved: TeamData;
    try {
      saved = data<TeamData>(
        await call(api, 'put', `${teamPath(owner.orgId, team.id)}/members`, {
          cookie: owner.cookie,
          // a unchanged, b renamed, c removed, one new member.
          body: {
            expectedVersion: team.version,
            members: [{ id: a!.id, name: a!.name }, { id: b!.id, name: '乙改' }, { name: '丁' }],
          },
        }),
      );
      const transitions = await api.pool.query<{
        member_id: string;
        old_status: string;
        new_status: string;
      }>(`SELECT * FROM ${log}`);
      // Only the removed member changes status; the retained rows never pass through ARCHIVED.
      expect(transitions.rows.filter((r) => r.old_status !== r.new_status)).toEqual([
        { member_id: c!.id, old_status: 'ACTIVE', new_status: 'ARCHIVED' },
      ]);
      expect(transitions.rows.some((r) => r.member_id === a!.id)).toBe(false);
      expect(transitions.rows.filter((r) => r.member_id === b!.id)).toEqual([
        { member_id: b!.id, old_status: 'ACTIVE', new_status: 'ACTIVE' },
      ]);
    } finally {
      await api.pool.query(`DROP TRIGGER IF EXISTS ${log} ON team_members`);
      await api.pool.query(`DROP FUNCTION IF EXISTS ${log}()`);
      await api.pool.query(`DROP TABLE IF EXISTS ${log}`);
    }
    expect(saved.members.map((m) => m.name)).toEqual(['甲', '乙改', '丁']);
    expect(saved.members[0]!.id).toBe(a!.id);
    expect(saved.members[1]!.id).toBe(b!.id);
    const after = await api.pool.query<{ id: string; status: string; updated_at: Date }>(
      'SELECT id,status,updated_at FROM team_members WHERE team_id=$1 AND id = ANY($2::uuid[]) ORDER BY id',
      [team.id, [a!.id, b!.id, c!.id]],
    );
    const row = (id: string, rows: typeof after.rows) => rows.find((r) => r.id === id)!;
    // The unchanged member keeps its row untouched (identity, status and timestamp).
    expect(row(a!.id, after.rows)).toEqual(row(a!.id, before.rows));
    expect(row(b!.id, after.rows).status).toBe('ACTIVE');
    expect(row(c!.id, after.rows).status).toBe('ARCHIVED');
  });
});
