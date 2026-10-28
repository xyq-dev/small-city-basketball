import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type {
  IssuedTeamJoinCodeData,
  IssuedTeamRequestLinkData,
  MembershipData,
  MembershipTeamData,
  MyMemberClaimData,
  OrgTeamRequestData,
  SessionData,
  TeamData,
  TeamJoinCodeData,
  TeamMemberBindingsData,
  TeamMemberClaimData,
  TeamRequestData,
} from '@small-city-basketball/contracts';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { ORIGIN, RUN_ID, call, data, error, eventually, membersPath, register } from './support.js';
import type { Api, User } from './support.js';
import { participant, registrationDatabaseUrl, teamPath, teamsPath } from './p03-support.js';
import type { Actor } from './p03-support.js';

const databaseUrl = registrationDatabaseUrl();

describe('C19 team membership on isolated PostgreSQL', { concurrent: false }, () => {
  let api: Api;
  let owner: User;
  let otherOwner: User;
  let leader: Actor;
  let admin2: Actor;
  const players: Actor[] = [];
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
    otherOwner = await register(api, 'c19-other-owner');
    leader = await participant(api, 'c19-leader');
    admin2 = await participant(api, 'c19-admin2');
    data(
      await call(api, 'put', `${membersPath(owner.orgId)}/${admin2.id}`, {
        cookie: owner.cookie,
        body: { role: 'ORG_ADMIN', status: 'ACTIVE' },
      }),
    );
    for (const label of ['p1', 'p2', 'p3', 'p4', 'p5']) players.push(await participant(api, label));
  }, 60000);
  // Failure limiter windows are exercised by their own test only.
  beforeEach(async () => {
    await api.pool.query("DELETE FROM auth_rate_limits WHERE key LIKE 'team-%'");
  });
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

  // ---------- helpers ----------
  const org = (o = owner) => `/v1/orgs/${o.orgId}`;
  const teamBase = (teamId: string, o = owner) => `${org(o)}/teams/${teamId}`;
  const sha = (v: string) => createHash('sha256').update(v).digest('hex');
  const code = (r: { status: number; body: { error?: { code?: string } } }) => r.body.error?.code;
  const issueLink = async (maxUses = 5, cookie = owner.cookie) =>
    data<IssuedTeamRequestLinkData>(
      await call(api, 'post', `${org()}/team-request-links`, {
        cookie,
        body: { expiresInHours: 24, maxUses, reason: '合成春季联赛建队' },
      }),
      201,
    );
  const submit = (actor: Actor, token: string, clientRequestId: string, teamName: string) =>
    call(api, 'post', '/v1/team-requests', {
      cookie: actor.cookie,
      body: { token, clientRequestId, teamName },
    });
  const review = (
    cookie: string,
    request: { id: string; version: number },
    decision: 'APPROVE' | 'REJECT' = 'APPROVE',
    reason = '资料核对无误',
  ) =>
    call(api, 'post', `${org()}/team-requests/${request.id}/review`, {
      cookie,
      body: { decision, reason, expectedVersion: request.version },
    });
  const session = async (actor: Actor) =>
    data<SessionData>(await call(api, 'get', '/v1/auth/session', { cookie: actor.cookie }));
  const issueCode = async (teamId: string, cookie: string, body: object = {}) =>
    data<IssuedTeamJoinCodeData>(
      await call(api, 'post', `${teamBase(teamId)}/join-codes`, { cookie, body }),
      201,
    );
  const join = (actor: Actor, joinCode: string, displayName: string) =>
    call(api, 'post', '/v1/team-joins', {
      cookie: actor.cookie,
      body: { code: joinCode, displayName },
    });
  const bindings = async (teamId: string, cookie: string) =>
    data<TeamMemberBindingsData>(
      await call(api, 'get', `${teamBase(teamId)}/member-bindings`, { cookie }),
    );
  const count = async (sql: string, params: unknown[]) =>
    (await api.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params)).rows[0]!
      .n;

  // The approved team every later test builds on (leader = approved applicant).
  let teamId = '';

  test('share links: admin-only, hashed token, org name only, idempotent submission and recovery', async () => {
    // Outsider 404, ordinary member 403 (players[4] becomes a plain SCORER of the org).
    error(await call(api, 'get', `${org()}/team-request-links`, { cookie: leader.cookie }), 404);
    data(
      await call(api, 'put', `${membersPath(owner.orgId)}/${players[4]!.id}`, {
        cookie: owner.cookie,
        body: { role: 'SCORER', status: 'ACTIVE' },
      }),
    );
    error(
      await call(api, 'post', `${org()}/team-request-links`, {
        cookie: players[4]!.cookie,
        body: { expiresInHours: 24, maxUses: 5, reason: '合成春季联赛建队' },
      }),
      403,
    );
    const issued = await issueLink(2);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const stored = await api.pool.query('SELECT * FROM team_request_links WHERE id=$1', [
      issued.link.id,
    ]);
    expect(stored.rows[0].token_hash).toBe(sha(issued.token));
    expect(JSON.stringify(stored.rows[0])).not.toContain(issued.token);
    const listed = data<{ id: string }[]>(
      await call(api, 'get', `${org()}/team-request-links`, { cookie: owner.cookie }),
    );
    expect(JSON.stringify(listed)).not.toContain(issued.token);

    // Resolve shows only the organization name; no org id is accepted from the applicant.
    const resolved = data<Record<string, unknown>>(
      await call(api, 'post', '/v1/team-request-links/resolve', {
        cookie: leader.cookie,
        body: { token: issued.token },
      }),
    );
    expect(Object.keys(resolved).sort()).toEqual(['expiresAt', 'linkId', 'orgName']);
    expect(resolved.orgName).toContain('机构 c19-owner');
    error(
      await call(api, 'post', '/v1/team-request-links/resolve', { body: { token: issued.token } }),
      401,
    );
    error(
      await call(api, 'post', '/v1/team-requests', {
        cookie: leader.cookie,
        body: {
          token: issued.token,
          clientRequestId: randomUUID(),
          teamName: '甲',
          orgId: owner.orgId,
        },
      }),
      422,
    );

    // First submission 201; the "lost response" replay with the same id returns 200, same row.
    const crid = randomUUID();
    const first = data<TeamRequestData>(await submit(leader, issued.token, crid, '合成青锋'), 201);
    const replay = data<TeamRequestData>(await submit(leader, issued.token, crid, '合成青锋'), 200);
    expect(replay.id).toBe(first.id);
    expect(first.status).toBe('PENDING');
    // Same id, different content: rejected, nothing written.
    expect(code(await submit(leader, issued.token, crid, '另一个名字'))).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    // Concurrent duplicates of a fresh id create exactly one request and consume one use.
    const crid2 = randomUUID();
    const racing = await Promise.all(
      Array.from({ length: 5 }, () => submit(admin2, issued.token, crid2, '合成猛龙')),
    );
    expect(racing.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(racing.map((r) => r.body.data.id)).size).toBe(1);
    expect(await count('team_requests WHERE client_request_id=$1', [crid2])).toBe(1);
    const link = await api.pool.query('SELECT use_count FROM team_request_links WHERE id=$1', [
      issued.link.id,
    ]);
    expect(link.rows[0].use_count).toBe(2);
    // Exhausted: a new submission fails, but the original replay still recovers.
    expect(code(await submit(players[0]!, issued.token, randomUUID(), '满员'))).toBe(
      'TEAM_REQUEST_LINK_INVALID',
    );
    expect(
      data<TeamRequestData>(await submit(leader, issued.token, crid, '合成青锋'), 200).id,
    ).toBe(first.id);
    // Own requests only; another account cannot read or withdraw it.
    const mine = data<TeamRequestData[]>(
      await call(api, 'get', '/v1/me/team-requests', { cookie: leader.cookie }),
    );
    expect(mine.map((r) => r.id)).toEqual([first.id]);
    error(
      await call(api, 'post', `/v1/me/team-requests/${first.id}/withdraw`, {
        cookie: players[0]!.cookie,
        body: { expectedVersion: 1 },
      }),
      404,
    );
    // Revoked links stop resolving.
    const revocable = await issueLink(5);
    data(
      await call(api, 'post', `${org()}/team-request-links/${revocable.link.id}/revoke`, {
        cookie: owner.cookie,
        body: { reason: '入口已发错群' },
      }),
    );
    error(
      await call(api, 'post', '/v1/team-request-links/resolve', {
        cookie: leader.cookie,
        body: { token: revocable.token },
      }),
      404,
    );
  });

  test('review: reviewer ≠ applicant, CAS, reason length, atomic approve creates one team + grant + audit', async () => {
    const pending = data<OrgTeamRequestData[]>(
      await call(api, 'get', `${org()}/team-requests?status=PENDING`, { cookie: owner.cookie }),
    );
    const mine = pending.find((r) => r.teamName === '合成青锋')!;
    const admins = pending.find((r) => r.teamName === '合成猛龙')!;
    // Only display names: no email or account id of the applicant.
    expect(JSON.stringify(pending)).not.toMatch(/@example\.test/);
    expect(mine).not.toHaveProperty('requesterId');
    expect(admins.capabilities.canReview).toBe(true);
    // The admin who applied cannot review their own request.
    const own = data<OrgTeamRequestData[]>(
      await call(api, 'get', `${org()}/team-requests`, { cookie: admin2.cookie }),
    ).find((r) => r.id === admins.id)!;
    expect(own.capabilities).toEqual({ canReview: false, isOwnRequest: true });
    expect(code(await review(admin2.cookie, admins))).toBe('REVIEWER_IS_REQUESTER');
    // Cross-org admins and the applicant never see or review it.
    error(await review(otherOwner.cookie, mine), 404);
    error(await review(leader.cookie, mine), 404);
    expect(code(await review(owner.cookie, mine, 'APPROVE', '短'))).toBe('VALIDATION_ERROR');
    expect(code(await review(owner.cookie, { ...mine, version: mine.version + 1 }))).toBe(
      'VERSION_CONFLICT',
    );
    // Two admins approve concurrently: exactly one wins, exactly one team exists.
    const raced = await Promise.all([review(owner.cookie, mine), review(admin2.cookie, mine)]);
    expect(raced.map((r) => r.status).sort()).toEqual([200, 409]);
    const approved = raced.find((r) => r.status === 200)!.body.data as OrgTeamRequestData;
    expect(approved.status).toBe('APPROVED');
    teamId = approved.teamId!;
    expect(await count('team_requests WHERE id=$1 AND team_id IS NOT NULL', [mine.id])).toBe(1);
    expect(await count("teams WHERE org_id=$1 AND name='合成青锋'", [owner.orgId])).toBe(1);
    expect(
      await count(
        "team_access_grants WHERE team_id=$1 AND user_id=$2 AND role='TEAM_MANAGER' AND status='ACTIVE'",
        [teamId, leader.id],
      ),
    ).toBe(1);
    expect(
      await count("audit_logs WHERE resource_id=$1 AND action='TEAM_REQUEST_APPROVED'", [mine.id]),
    ).toBe(1);
    // No organization or event staff role is granted to the applicant.
    expect(await count('organization_memberships WHERE user_id=$1', [leader.id])).toBe(0);
    expect(await count('event_staff WHERE user_id=$1', [leader.id])).toBe(0);
    // The applicant now manages exactly this team (management context, not a player binding).
    const s = await session(leader);
    expect(s.teamContexts.map((c) => c.teamId)).toEqual([teamId]);
    expect(s.organizations).toEqual([]);
    const applicantView = data<TeamRequestData[]>(
      await call(api, 'get', '/v1/me/team-requests', { cookie: leader.cookie }),
    )[0]!;
    expect(applicantView).toMatchObject({
      status: 'APPROVED',
      teamId,
      reviewReason: '资料核对无误',
    });
    // Re-review is refused; withdrawal of a decided request is refused.
    expect(code(await review(owner.cookie, approved))).toBe('TEAM_REQUEST_CLOSED');
    expect(
      code(
        await call(api, 'post', `/v1/me/team-requests/${mine.id}/withdraw`, {
          cookie: leader.cookie,
          body: { expectedVersion: approved.version },
        }),
      ),
    ).toBe('TEAM_REQUEST_CLOSED');
  });

  test('approval rolls back entirely when its audit write fails; withdraw uses CAS', async () => {
    const pending = data<OrgTeamRequestData[]>(
      await call(api, 'get', `${org()}/team-requests?status=PENDING`, { cookie: owner.cookie }),
    ).find((r) => r.teamName === '合成猛龙')!;
    const trigger = `c19_fail_${RUN_ID.slice(0, 12)}`;
    await api.pool.query(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'injected audit failure'; END $$`,
    );
    await api.pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW
       WHEN (NEW.action='TEAM_REQUEST_APPROVED' AND NEW.resource_id='${pending.id}'::uuid)
       EXECUTE FUNCTION ${trigger}()`,
    );
    const teamsBefore = await count('teams WHERE org_id=$1', [owner.orgId]);
    try {
      error(await review(owner.cookie, pending), 500);
    } finally {
      await api.pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs`);
      await api.pool.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
    }
    expect(await count('teams WHERE org_id=$1', [owner.orgId])).toBe(teamsBefore);
    expect(await count('team_access_grants WHERE user_id=$1', [admin2.id])).toBe(0);
    const after = await api.pool.query(
      'SELECT status,version,team_id FROM team_requests WHERE id=$1',
      [pending.id],
    );
    expect(after.rows[0]).toEqual({ status: 'PENDING', version: pending.version, team_id: null });
    // The applicant withdraws with CAS: a stale version is refused, the current one succeeds.
    expect(
      code(
        await call(api, 'post', `/v1/me/team-requests/${pending.id}/withdraw`, {
          cookie: admin2.cookie,
          body: { expectedVersion: pending.version + 1 },
        }),
      ),
    ).toBe('VERSION_CONFLICT');
    const withdrawn = data<TeamRequestData>(
      await call(api, 'post', `/v1/me/team-requests/${pending.id}/withdraw`, {
        cookie: admin2.cookie,
        body: { expectedVersion: pending.version },
      }),
    );
    expect(withdrawn.status).toBe('WITHDRAWN');
    // A withdrawn request can no longer be approved.
    expect(code(await review(owner.cookie, withdrawn))).toBe('TEAM_REQUEST_CLOSED');
  });

  test('join codes: hashed Base32, idempotent join, binding kept out of grants and team contexts', async () => {
    const issued = await issueCode(teamId, leader.cookie);
    expect(issued.code).toMatch(/^[A-Z2-7]{26}$/);
    expect(issued.joinCode).toMatchObject({ status: 'ACTIVE', maxUses: 30, useCount: 0 });
    const row = await api.pool.query('SELECT * FROM team_join_codes WHERE id=$1', [
      issued.joinCode.id,
    ]);
    expect(row.rows[0].code_hash).toBe(sha(issued.code));
    expect(row.rows[0].expires_at - row.rows[0].created_at).toBe(168 * 3600 * 1000);
    // Grouped lower-case input still matches.
    const grouped = issued.code.toLowerCase().replace(/(.{4})/g, '$1 ');
    const first = data<MembershipData>(await join(players[0]!, grouped, '合成球员一'), 201);
    const again = data<MembershipData>(await join(players[0]!, issued.code, '别名'), 200);
    expect(again.bindingId).toBe(first.bindingId);
    expect(first).toMatchObject({
      teamId,
      memberName: '合成球员一',
      status: 'ACTIVE',
      source: 'JOIN_CODE',
    });
    expect(
      (
        await api.pool.query('SELECT use_count FROM team_join_codes WHERE id=$1', [
          issued.joinCode.id,
        ])
      ).rows[0].use_count,
    ).toBe(1);
    // A player binding never becomes a management grant or a session team context.
    expect(await count('team_access_grants WHERE user_id=$1', [players[0]!.id])).toBe(0);
    expect((await session(players[0]!)).teamContexts).toEqual([]);
    error(
      await call(api, 'get', `${teamBase(teamId)}/member-bindings`, { cookie: players[0]!.cookie }),
      404,
    );
    error(
      await call(api, 'get', `/v1/orgs/${owner.orgId}/teams/${teamId}`, {
        cookie: players[0]!.cookie,
      }),
      404,
    );
    // Own memberships and the read-only team view.
    const memberships = data<MembershipData[]>(
      await call(api, 'get', '/v1/me/memberships', { cookie: players[0]!.cookie }),
    );
    expect(memberships.map((m) => m.bindingId)).toEqual([first.bindingId]);
    const view = data<MembershipTeamData>(
      await call(api, 'get', `/v1/me/memberships/${first.bindingId}/team`, {
        cookie: players[0]!.cookie,
      }),
    );
    expect(view.members).toEqual([{ memberId: first.memberId, name: '合成球员一', isSelf: true }]);
    error(
      await call(api, 'get', `/v1/me/memberships/${first.bindingId}/team`, {
        cookie: players[1]!.cookie,
      }),
      404,
    );
    // The leader sees member name, account display name and status only.
    const view2 = await bindings(teamId, leader.cookie);
    expect(view2.bindings).toHaveLength(1);
    expect(Object.keys(view2.bindings[0]!).sort()).toEqual(
      [
        'accountDisplayName',
        'bindingId',
        'createdAt',
        'endedAt',
        'endedReason',
        'memberId',
        'memberName',
        'source',
        'status',
      ].sort(),
    );
    expect(view2.bindings[0]!.accountDisplayName).toBe('报名测试 p1');
    expect(JSON.stringify(view2)).not.toMatch(/@example\.test|userId/);
    // Cross-organization managers see nothing.
    error(
      await call(api, 'get', `/v1/orgs/${otherOwner.orgId}/teams/${teamId}/member-bindings`, {
        cookie: otherOwner.cookie,
      }),
      404,
    );
    error(
      await call(api, 'get', `${teamBase(teamId)}/join-codes`, { cookie: otherOwner.cookie }),
      404,
    );
    error(
      await call(api, 'post', `${teamBase(teamId)}/join-codes`, {
        cookie: otherOwner.cookie,
        body: {},
      }),
      404,
    );
  });

  test('concurrent joins never exceed the code limit', async () => {
    const issued = await issueCode(teamId, leader.cookie, { maxUses: 2 });
    const raced = await Promise.all(
      [players[1]!, players[2]!, players[3]!, players[4]!].map((p, i) =>
        join(p, issued.code, `并发${i}`),
      ),
    );
    expect(raced.filter((r) => r.status === 201)).toHaveLength(2);
    expect(
      raced.filter((r) => r.status !== 201).every((r) => code(r) === 'JOIN_CODE_INVALID'),
    ).toBe(true);
    expect(
      (
        await api.pool.query('SELECT use_count FROM team_join_codes WHERE id=$1', [
          issued.joinCode.id,
        ])
      ).rows[0].use_count,
    ).toBe(2);
    expect(
      await count("team_member_bindings WHERE join_code_id=$1 AND status='ACTIVE'", [
        issued.joinCode.id,
      ]),
    ).toBe(2);
  });

  test('removal ends the binding, keeps history, and the old code cannot rejoin', async () => {
    const view = await bindings(teamId, leader.cookie);
    const target = view.bindings.find((b) => b.memberName === '合成球员一')!;
    const team = data<TeamData>(
      await call(api, 'get', teamBase(teamId), { cookie: leader.cookie }),
    );
    const removed = data<TeamMemberBindingsData>(
      await call(api, 'post', `${teamBase(teamId)}/member-bindings/${target.bindingId}/remove`, {
        cookie: leader.cookie,
        body: { reason: '本人申请离队' },
      }),
    );
    expect(removed.bindings.find((b) => b.bindingId === target.bindingId)).toMatchObject({
      status: 'ENDED',
      endedReason: 'REMOVED',
    });
    const member = await api.pool.query('SELECT status FROM team_members WHERE id=$1', [
      target.memberId,
    ]);
    expect(member.rows[0].status).toBe('ARCHIVED');
    const after = data<TeamData>(
      await call(api, 'get', teamBase(teamId), { cookie: leader.cookie }),
    );
    expect(after.version).toBe(team.version + 1);
    // Rejoining after removal needs a new authorization and creates a new member row
    // (never the old one reattached); the pre-removal refusal is the next test.
    const fresh = await issueCode(teamId, leader.cookie);
    const back = data<MembershipData>(await join(players[0]!, fresh.code, '合成球员一'), 201);
    expect(back.memberId).not.toBe(target.memberId);
    expect(back.bindingId).not.toBe(target.bindingId);
  });

  test('a code issued before the removal is refused with JOIN_CODE_PREDATES_REMOVAL', async () => {
    const early = await issueCode(teamId, leader.cookie);
    const view = await bindings(teamId, leader.cookie);
    const target = view.bindings.find(
      (b) => b.memberName === '合成球员一' && b.status === 'ACTIVE',
    )!;
    data(
      await call(api, 'post', `${teamBase(teamId)}/member-bindings/${target.bindingId}/remove`, {
        cookie: leader.cookie,
        body: { reason: '再次移除测试' },
      }),
    );
    expect(code(await join(players[0]!, early.code, '合成球员一'))).toBe(
      'JOIN_CODE_PREDATES_REMOVAL',
    );
    expect(
      await count("team_member_bindings WHERE user_id=$1 AND team_id=$2 AND status='ACTIVE'", [
        players[0]!.id,
        teamId,
      ]),
    ).toBe(0);
    // Leaving works the same way for the player's own exit.
    const later = await issueCode(teamId, leader.cookie);
    const rejoined = data<MembershipData>(await join(players[0]!, later.code, '合成球员一'), 201);
    const left = data<MembershipData>(
      await call(api, 'post', `/v1/me/memberships/${rejoined.bindingId}/leave`, {
        cookie: players[0]!.cookie,
        body: {},
      }),
    );
    expect(left).toMatchObject({ status: 'ENDED', endedReason: 'LEFT' });
    // Leaving twice is idempotent.
    expect(
      data<MembershipData>(
        await call(api, 'post', `/v1/me/memberships/${rejoined.bindingId}/leave`, {
          cookie: players[0]!.cookie,
          body: {},
        }),
      ).status,
    ).toBe('ENDED');
    expect(code(await join(players[0]!, later.code, '合成球员一'))).toBe(
      'JOIN_CODE_PREDATES_REMOVAL',
    );
  });

  test('claims bind one exact member to one exact account and never take over another binding', async () => {
    // A historical member added by the leader through the long-term list.
    let team = data<TeamData>(await call(api, 'get', teamBase(teamId), { cookie: leader.cookie }));
    team = data<TeamData>(
      await call(api, 'put', `${teamBase(teamId)}/members`, {
        cookie: leader.cookie,
        body: {
          expectedVersion: team.version,
          members: [...team.members.map((m) => ({ id: m.id, name: m.name })), { name: '历史球员' }],
        },
      }),
    );
    const historical = team.members.find((m) => m.name === '历史球员')!;
    // p5 (players[4]) has no binding in this team? It may have joined concurrently; pick an unbound one.
    const bound = new Set(
      (
        await api.pool.query(
          "SELECT user_id FROM team_member_bindings WHERE team_id=$1 AND status='ACTIVE'",
          [teamId],
        )
      ).rows.map((r) => r.user_id),
    );
    const claimant = players.find((p) => !bound.has(p.id))!;
    const other = players.find((p) => p.id !== claimant.id && !bound.has(p.id))!;
    const claim = data<TeamMemberClaimData>(
      await call(api, 'post', `${teamBase(teamId)}/members/${historical.id}/claims`, {
        cookie: leader.cookie,
        body: { targetUserId: claimant.id },
      }),
      201,
    );
    expect(claim).toMatchObject({ status: 'PENDING', memberName: '历史球员' });
    // Only the target sees and decides it.
    expect(
      data<MyMemberClaimData[]>(
        await call(api, 'get', '/v1/me/member-claims', { cookie: other.cookie }),
      ),
    ).toEqual([]);
    error(
      await call(api, 'post', `/v1/me/member-claims/${claim.claimId}/accept`, {
        cookie: other.cookie,
        body: {},
      }),
      404,
    );
    // A second claim on the same member while one is pending is refused.
    expect(
      code(
        await call(api, 'post', `${teamBase(teamId)}/members/${historical.id}/claims`, {
          cookie: leader.cookie,
          body: { targetUserId: other.id },
        }),
      ),
    ).toBe('CLAIM_PENDING');
    const accepted = data<{ membership: MembershipData }>(
      await call(api, 'post', `/v1/me/member-claims/${claim.claimId}/accept`, {
        cookie: claimant.cookie,
        body: {},
      }),
    );
    expect(accepted.membership).toMatchObject({
      memberId: historical.id,
      source: 'CLAIM',
      status: 'ACTIVE',
    });
    // Replay returns the same binding.
    const replay = data<{ membership: MembershipData }>(
      await call(api, 'post', `/v1/me/member-claims/${claim.claimId}/accept`, {
        cookie: claimant.cookie,
        body: {},
      }),
    );
    expect(replay.membership.bindingId).toBe(accepted.membership.bindingId);
    // Claiming a bound member for another account never overwrites it.
    expect(
      code(
        await call(api, 'post', `${teamBase(teamId)}/members/${historical.id}/claims`, {
          cookie: leader.cookie,
          body: { targetUserId: other.id },
        }),
      ),
    ).toBe('MEMBER_ALREADY_BOUND');
    // After the claimant leaves and the member is restored, it still cannot go to another account.
    data(
      await call(api, 'post', `/v1/me/memberships/${accepted.membership.bindingId}/leave`, {
        cookie: claimant.cookie,
        body: {},
      }),
    );
    team = data<TeamData>(await call(api, 'get', teamBase(teamId), { cookie: leader.cookie }));
    team = data<TeamData>(
      await call(api, 'put', `${teamBase(teamId)}/members`, {
        cookie: leader.cookie,
        body: {
          expectedVersion: team.version,
          members: [
            ...team.members.map((m) => ({ id: m.id, name: m.name })),
            { id: historical.id, name: '历史球员' },
          ],
        },
      }),
    );
    expect(
      code(
        await call(api, 'post', `${teamBase(teamId)}/members/${historical.id}/claims`, {
          cookie: leader.cookie,
          body: { targetUserId: other.id },
        }),
      ),
    ).toBe('MEMBER_BOUND_TO_OTHER_ACCOUNT');
    // The database refuses the takeover even without the service check.
    await expect(
      api.pool.query(
        `INSERT INTO team_member_bindings(id,org_id,team_id,member_id,user_id,source,claim_id)
         VALUES($1,$2,$3,$4,$5,'CLAIM',$6)`,
        [randomUUID(), owner.orgId, teamId, historical.id, other.id, claim.claimId],
      ),
    ).rejects.toThrow(/bound to another account/);
    // Composite ownership: a binding cannot point at another team's member.
    await expect(
      api.pool.query(
        `INSERT INTO team_member_bindings(id,org_id,team_id,member_id,user_id,source,claim_id)
         VALUES($1,$2,$3,$4,$5,'CLAIM',$6)`,
        [randomUUID(), otherOwner.orgId, teamId, historical.id, other.id, claim.claimId],
      ),
    ).rejects.toThrow();
    // Revoke and decline paths.
    const decl = data<TeamMemberClaimData>(
      await call(api, 'post', `${teamBase(teamId)}/members/${historical.id}/claims`, {
        cookie: leader.cookie,
        body: { targetUserId: claimant.id },
      }),
      201,
    );
    data(
      await call(api, 'post', `/v1/me/member-claims/${decl.claimId}/decline`, {
        cookie: claimant.cookie,
        body: {},
      }),
    );
    expect(
      code(
        await call(api, 'post', `/v1/me/member-claims/${decl.claimId}/accept`, {
          cookie: claimant.cookie,
          body: {},
        }),
      ),
    ).toBe('CLAIM_CLOSED');
    const rev = data<TeamMemberClaimData>(
      await call(api, 'post', `${teamBase(teamId)}/members/${historical.id}/claims`, {
        cookie: leader.cookie,
        body: { targetUserId: claimant.id },
      }),
      201,
    );
    expect(
      data<TeamMemberClaimData>(
        await call(api, 'post', `${teamBase(teamId)}/member-claims/${rev.claimId}/revoke`, {
          cookie: leader.cookie,
          body: {},
        }),
      ).status,
    ).toBe('REVOKED');
    expect(
      code(
        await call(api, 'post', `/v1/me/member-claims/${rev.claimId}/accept`, {
          cookie: claimant.cookie,
          body: {},
        }),
      ),
    ).toBe('CLAIM_CLOSED');
  });

  test('member save keeps retained bindings and ends only the removed member binding', async () => {
    const issued = await issueCode(teamId, leader.cookie);
    const bound = new Set(
      (
        await api.pool.query(
          "SELECT user_id FROM team_member_bindings WHERE team_id=$1 AND status='ACTIVE'",
          [teamId],
        )
      ).rows.map((r) => r.user_id),
    );
    const newcomer = players.find((p) => !bound.has(p.id) && p.id !== players[0]!.id)!;
    const joined = data<MembershipData>(await join(newcomer, issued.code, '保留球员'), 201);
    const before = await api.pool.query(
      "SELECT id,member_id FROM team_member_bindings WHERE team_id=$1 AND status='ACTIVE'",
      [teamId],
    );
    expect(before.rows.length).toBeGreaterThanOrEqual(2);
    const removeMember = before.rows.find((r) => r.member_id !== joined.memberId)!;
    const team = data<TeamData>(
      await call(api, 'get', teamBase(teamId), { cookie: leader.cookie }),
    );
    data(
      await call(api, 'put', `${teamBase(teamId)}/members`, {
        cookie: leader.cookie,
        body: {
          expectedVersion: team.version,
          members: team.members
            .filter((m) => m.id !== removeMember.member_id)
            .map((m) => ({ id: m.id, name: m.name === '保留球员' ? '保留球员改名' : m.name })),
        },
      }),
    );
    const after = await api.pool.query(
      'SELECT id,status,ended_reason FROM team_member_bindings WHERE id = ANY($1::uuid[])',
      [before.rows.map((r) => r.id)],
    );
    for (const row of after.rows)
      if (row.id === removeMember.id)
        expect(row).toMatchObject({ status: 'ENDED', ended_reason: 'MEMBER_REMOVED' });
      else expect(row.status).toBe('ACTIVE');
    // A stale save (version from before a join) is refused instead of archiving the new player.
    error(
      await call(api, 'put', `${teamBase(teamId)}/members`, {
        cookie: leader.cookie,
        body: { expectedVersion: team.version, members: [] },
      }),
      409,
    );
  });

  test('issuer losing management makes their codes unusable; failures are rate limited', async () => {
    const issued = await issueCode(teamId, leader.cookie);
    data(
      await call(api, 'put', `${teamBase(teamId)}/grants/${leader.id}`, {
        cookie: owner.cookie,
        body: { status: 'DISABLED' },
      }),
    );
    try {
      const listed = data<TeamJoinCodeData[]>(
        await call(api, 'get', `${teamBase(teamId)}/join-codes`, { cookie: owner.cookie }),
      );
      expect(listed.find((c) => c.id === issued.joinCode.id)!.status).toBe('ISSUER_INVALID');
      expect(code(await join(players[0]!, issued.code, '换人'))).toBe('JOIN_CODE_INVALID');
      error(
        await call(api, 'get', `${teamBase(teamId)}/member-bindings`, { cookie: leader.cookie }),
        404,
      );
    } finally {
      data(
        await call(api, 'put', `${teamBase(teamId)}/grants/${leader.id}`, {
          cookie: owner.cookie,
          body: { status: 'ACTIVE' },
        }),
      );
    }
    await api.pool.query("DELETE FROM auth_rate_limits WHERE key LIKE 'team-%'");
    const bogus = 'A'.repeat(26);
    for (let i = 0; i < 10; i++)
      expect(code(await join(players[1]!, bogus, '试错'))).toBe('JOIN_CODE_INVALID');
    expect((await join(players[1]!, bogus, '试错')).status).toBe(429);
    // Even a valid code is refused while the account is limited.
    expect((await join(players[1]!, issued.code, '试错')).status).toBe(429);
  });

  // ---------- review fixes ----------
  const rosterIds = async () =>
    data<TeamData>(await call(api, 'get', teamBase(teamId), { cookie: leader.cookie }));
  const addMember = async (name: string) => {
    const team = await rosterIds();
    const saved = data<TeamData>(
      await call(api, 'put', `${teamBase(teamId)}/members`, {
        cookie: leader.cookie,
        body: {
          expectedVersion: team.version,
          members: [...team.members.map((m) => ({ id: m.id, name: m.name })), { name }],
        },
      }),
    );
    return saved.members.find((m) => m.name === name)!;
  };
  const claimFor = async (memberId: string, target: Actor) =>
    data<TeamMemberClaimData>(
      await call(api, 'post', `${teamBase(teamId)}/members/${memberId}/claims`, {
        cookie: leader.cookie,
        body: { targetUserId: target.id },
      }),
      201,
    );
  const accept = (claimId: string, actor: Actor) =>
    call(api, 'post', `/v1/me/member-claims/${claimId}/accept`, { cookie: actor.cookie, body: {} });

  test('P2-1: a claim issued before removal cannot bring the removed player back', async () => {
    const x1 = await participant(api, 'rv-x1');
    const historical = await addMember('审查历史甲');
    const claim = await claimFor(historical.id, x1);
    const joined = data<MembershipData>(
      await join(x1, (await issueCode(teamId, leader.cookie)).code, '审查球员甲'),
      201,
    );
    data(
      await call(api, 'post', `${teamBase(teamId)}/member-bindings/${joined.bindingId}/remove`, {
        cookie: leader.cookie,
        body: { reason: '审查移除测试' },
      }),
    );
    // Removal withdraws every pending claim addressed to that account in the team.
    const after = await api.pool.query('SELECT status FROM team_member_claims WHERE id=$1', [
      claim.claimId,
    ]);
    expect(after.rows[0].status).toBe('REVOKED');
    expect(code(await accept(claim.claimId, x1))).toBe('CLAIM_CLOSED');
    expect(await count("team_member_bindings WHERE user_id=$1 AND status='ACTIVE'", [x1.id])).toBe(
      0,
    );
    // Defence in depth: a pending claim created before the removal is still refused.
    const ended = await api.pool.query('SELECT ended_at FROM team_member_bindings WHERE id=$1', [
      joined.bindingId,
    ]);
    const forged = randomUUID();
    await api.pool.query(
      `INSERT INTO team_member_claims(id,org_id,team_id,member_id,target_user_id,issued_by,created_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz-interval '1 second',$7::timestamptz+interval '100 hours')`,
      [forged, owner.orgId, teamId, historical.id, x1.id, leader.id, ended.rows[0].ended_at],
    );
    expect(code(await accept(forged, x1))).toBe('CLAIM_PREDATES_REMOVAL');
    // The member-save path withdraws them too.
    const x2 = await participant(api, 'rv-x2');
    const historical2 = await addMember('审查历史乙');
    const claim2 = await claimFor(historical2.id, x2);
    const joined2 = data<MembershipData>(
      await join(x2, (await issueCode(teamId, leader.cookie)).code, '审查球员乙'),
      201,
    );
    const team = await rosterIds();
    data(
      await call(api, 'put', `${teamBase(teamId)}/members`, {
        cookie: leader.cookie,
        body: {
          expectedVersion: team.version,
          members: team.members
            .filter((m) => m.id !== joined2.memberId)
            .map((m) => ({ id: m.id, name: m.name })),
        },
      }),
    );
    expect(code(await accept(claim2.claimId, x2))).toBe('CLAIM_CLOSED');
  });

  test('P3-2: one holder cannot exhaust a shared link by submit/withdraw loops', async () => {
    const y = await participant(api, 'rv-y');
    const link = await issueLink(10);
    const withdraw = async (r: TeamRequestData) =>
      data<TeamRequestData>(
        await call(api, 'post', `/v1/me/team-requests/${r.id}/withdraw`, {
          cookie: y.cookie,
          body: { expectedVersion: r.version },
        }),
      );
    const first = data<TeamRequestData>(await submit(y, link.token, randomUUID(), '审查甲队'), 201);
    expect(code(await submit(y, link.token, randomUUID(), '审查乙队'))).toBe(
      'TEAM_REQUEST_LINK_ALREADY_USED',
    );
    await withdraw(first);
    const second = data<TeamRequestData>(
      await submit(y, link.token, randomUUID(), '审查乙队'),
      201,
    );
    await withdraw(second);
    const third = data<TeamRequestData>(await submit(y, link.token, randomUUID(), '审查丙队'), 201);
    await withdraw(third);
    expect(code(await submit(y, link.token, randomUUID(), '审查丁队'))).toBe(
      'TEAM_REQUEST_LINK_SUBMISSION_LIMIT',
    );
    const used = await api.pool.query('SELECT use_count FROM team_request_links WHERE id=$1', [
      link.link.id,
    ]);
    expect(used.rows[0].use_count).toBe(3);
  });

  test('P3-3: parallel failure bursts cannot exceed the limiter; successes are refunded', async () => {
    const burster = await participant(api, 'rv-burst');
    const bogus = 'B'.repeat(26);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => join(burster, bogus, '并发试错')),
    );
    const invalid = results.filter((r) => code(r) === 'JOIN_CODE_INVALID').length;
    expect(invalid).toBeLessThanOrEqual(10);
    expect(results.filter((r) => r.status === 429).length).toBe(20 - invalid);
    await api.pool.query("DELETE FROM auth_rate_limits WHERE key LIKE 'team-%'");
    const link = await issueLink(5);
    for (let i = 0; i < 15; i++)
      data(
        await call(api, 'post', '/v1/team-request-links/resolve', {
          cookie: burster.cookie,
          body: { token: link.token },
        }),
      );
  });

  test('P3-4: the pending cap holds across links submitted concurrently', async () => {
    const z = await participant(api, 'rv-z');
    const links = await Promise.all([1, 2, 3, 4, 5].map(() => issueLink(5)));
    const results = await Promise.all(
      links.map((l, i) => submit(z, l.token, randomUUID(), `并发申请${i}`)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(
      results.filter((r) => r.status !== 201).every((r) => code(r) === 'TOO_MANY_PENDING_REQUESTS'),
    ).toBe(true);
    expect(await count("team_requests WHERE requester_id=$1 AND status='PENDING'", [z.id])).toBe(3);
  });

  test('P3-5: direct runtime-style rewinds of module state are rejected by the database', async () => {
    const one = async (sql: string) => (await api.pool.query(sql)).rows[0];
    const approved = await one(
      "SELECT id,team_id FROM team_requests WHERE status='APPROVED' LIMIT 1",
    );
    const toRevoke = await issueCode(teamId, leader.cookie);
    const revokedCode = data<TeamJoinCodeData>(
      await call(api, 'post', `${teamBase(teamId)}/join-codes/${toRevoke.joinCode.id}/revoke`, {
        cookie: leader.cookie,
        body: {},
      }),
    );
    const usedCode = await one('SELECT id FROM team_join_codes WHERE use_count>0 LIMIT 1');
    const revokedLink = await one(
      'SELECT id FROM team_request_links WHERE revoked_at IS NOT NULL LIMIT 1',
    );
    const closedClaim = await one(
      "SELECT id FROM team_member_claims WHERE status<>'PENDING' LIMIT 1",
    );
    const otherTeam = (
      await api.pool.query('SELECT id FROM teams WHERE org_id=$1 AND id<>$2 LIMIT 1', [
        owner.orgId,
        approved.team_id,
      ])
    ).rows[0];
    for (const row of [approved, revokedCode, usedCode, revokedLink, closedClaim, otherTeam])
      expect(row).toBeTruthy();
    const rejected = async (sql: string, params: unknown[] = []) => {
      const client = await api.pool.connect();
      try {
        await client.query('BEGIN');
        await expect(client.query(sql, params), sql).rejects.toThrow();
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    };
    await rejected(
      "UPDATE team_requests SET status='PENDING',team_id=NULL,reviewer_id=NULL,review_reason=NULL,reviewed_at=NULL WHERE id=$1",
      [approved.id],
    );
    await rejected('UPDATE team_requests SET team_id=$2 WHERE id=$1', [approved.id, otherTeam.id]);
    await rejected('UPDATE team_requests SET version=version+1 WHERE id=$1', [approved.id]);
    await rejected('UPDATE team_join_codes SET use_count=use_count-1 WHERE id=$1', [usedCode.id]);
    await rejected('UPDATE team_join_codes SET revoked_at=NULL,revoked_by=NULL WHERE id=$1', [
      revokedCode.id,
    ]);
    await rejected(
      "UPDATE team_join_codes SET expires_at=expires_at+interval '1 hour' WHERE id=$1",
      [usedCode.id],
    );
    await rejected(
      'UPDATE team_request_links SET revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL WHERE id=$1',
      [revokedLink.id],
    );
    await rejected("UPDATE team_member_claims SET status='PENDING',decided_at=NULL WHERE id=$1", [
      closedClaim.id,
    ]);
    for (const table of [
      'team_requests',
      'team_join_codes',
      'team_request_links',
      'team_member_claims',
      'team_member_bindings',
    ]) {
      await rejected(`DELETE FROM ${table} WHERE true`);
      await rejected(`TRUNCATE ${table} CASCADE`);
    }
  });

  test('P3-6: codes and claims do not revive when the issuer regains rights', async () => {
    const w = await participant(api, 'rv-w');
    const v = await participant(api, 'rv-v');
    const issued = await issueCode(teamId, leader.cookie);
    const historical = await addMember('审查历史丙');
    const claim = await claimFor(historical.id, v);
    for (const status of ['DISABLED', 'ACTIVE'])
      data(
        await call(api, 'put', `${teamBase(teamId)}/grants/${leader.id}`, {
          cookie: owner.cookie,
          body: { status },
        }),
      );
    const listed = data<TeamJoinCodeData[]>(
      await call(api, 'get', `${teamBase(teamId)}/join-codes`, { cookie: leader.cookie }),
    );
    expect(listed.find((c) => c.id === issued.joinCode.id)!.status).toBe('ISSUER_INVALID');
    expect(code(await join(w, issued.code, '复活测试'))).toBe('JOIN_CODE_INVALID');
    expect(code(await accept(claim.claimId, v))).toBe('CLAIM_INVALID');
    // A code issued after the rights were restored works.
    data<MembershipData>(
      await join(w, (await issueCode(teamId, leader.cookie)).code, '复活测试'),
      201,
    );
  });

  test('P3-7: binding history lookups by member and account are indexed', async () => {
    const found = await api.pool.query(
      "SELECT indexdef FROM pg_indexes WHERE tablename='team_member_bindings'",
    );
    expect(found.rows.some((r) => /\(member_id, user_id\)/.test(r.indexdef))).toBe(true);
  });

  test('an in-flight original submission is replayed after waiting, even when it uses the last link slot', async () => {
    const applicant = await participant(api, 'resume-race');
    const link = await issueLink(1);
    const id = randomUUID();
    const blocker = await api.pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM team_request_links WHERE id=$1 FOR UPDATE', [link.link.id]);
    const pending = Promise.all([
      submit(applicant, link.token, id, '并发恢复球队'),
      submit(applicant, link.token, id, '并发恢复球队'),
    ]);
    try {
      await eventually(
        async () =>
          (
            await api.pool.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname=current_database() AND wait_event_type='Lock'
             AND (query LIKE 'SELECT * FROM team_request_links%FOR UPDATE%'
               OR query LIKE 'SELECT pg_advisory_xact_lock%')`,
            )
          ).rows[0]!.n,
        (n) => n >= 2,
        'both submissions must be blocked before the link lock is released',
      );
    } finally {
      await blocker.query('COMMIT');
      blocker.release();
    }
    const responses = await pending;
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(new Set(responses.map((r) => r.body.data.id)).size).toBe(1);
    expect(
      await count('team_requests WHERE requester_id=$1 AND client_request_id=$2', [
        applicant.id,
        id,
      ]),
    ).toBe(1);
    expect(
      (await api.pool.query('SELECT use_count FROM team_request_links WHERE id=$1', [link.link.id]))
        .rows[0].use_count,
    ).toBe(1);
  });

  test('successful token resolution refunds only itself and preserves prior failed attempts', async () => {
    const applicant = await participant(api, 'resume-limiter');
    const link = await issueLink(1);
    const resolve = (token: string) =>
      call(api, 'post', '/v1/team-request-links/resolve', {
        cookie: applicant.cookie,
        body: { token },
      });
    const bogus = 'z'.repeat(22);
    error(await resolve(bogus), 404);
    data(await resolve(link.token));
    expect(
      (
        await api.pool.query('SELECT attempts FROM auth_rate_limits WHERE key=$1', [
          `team-link-account:${applicant.id}`,
        ])
      ).rows[0]?.attempts,
    ).toBe(1);
    for (let i = 1; i < 10; i++) error(await resolve(bogus), 404);
    error(await resolve(link.token), 429);
  });

  test('join authorization preserves PostgreSQL microseconds when a code follows a role update', async () => {
    const player = await participant(api, 'resume-microseconds');
    const team = await createTeam('微秒授权回归', []);
    const previous = (
      await api.pool.query<{ stamp: string }>(
        'SELECT updated_at::text AS stamp FROM organization_memberships WHERE org_id=$1 AND user_id=$2',
        [owner.orgId, owner.id],
      )
    ).rows[0]!.stamp;
    const id = randomUUID();
    const token = 'X'.repeat(26);
    try {
      await api.pool.query(
        `UPDATE organization_memberships
         SET updated_at=date_trunc('milliseconds',clock_timestamp())-interval '1 second'+interval '100 microseconds'
         WHERE org_id=$1 AND user_id=$2`,
        [owner.orgId, owner.id],
      );
      await api.pool.query(
        `INSERT INTO team_join_codes(id,org_id,team_id,code_hash,issued_by,max_uses,created_at,expires_at)
         SELECT $1,$2,$3,$4,$5,1,updated_at+interval '100 microseconds',updated_at+interval '1 hour'
         FROM organization_memberships WHERE org_id=$2 AND user_id=$5`,
        [id, owner.orgId, team.id, sha(token), owner.id],
      );
      const listed = data<TeamJoinCodeData[]>(
        await call(api, 'get', `${teamBase(team.id)}/join-codes`, {
          cookie: owner.cookie,
        }),
      );
      expect(listed.find((r) => r.id === id)?.status).toBe('ACTIVE');
      data<MembershipData>(await join(player, token, '微秒球员'), 201);
    } finally {
      await api.pool.query(
        'UPDATE organization_memberships SET updated_at=$3::timestamptz WHERE org_id=$1 AND user_id=$2',
        [owner.orgId, owner.id, previous],
      );
    }
  });
});
