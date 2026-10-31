import type { PoolClient } from 'pg';
import type { TeamData } from '@small-city-basketball/contracts';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { createScoringHarness, closeHarness } from './p05-support.js';
import type { Harness } from './p05-support.js';
import { grant, invite, acceptPath, teamPath } from './p03-support.js';
import { call, data } from './support.js';

describe(
  'public RR permission fences after actual authority changes on PostgreSQL',
  { concurrent: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness(4);
    }, 60000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);
    async function snapshot(c: PoolClient, team: TeamData) {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      return (
        await c.query('SELECT version,updated_at FROM teams WHERE org_id=$1 AND id=$2', [
          h.owner.orgId,
          team.id,
        ])
      ).rows[0];
    }
    async function retry(c: PoolClient, team: TeamData, before: unknown) {
      await expect(
        c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE NOWAIT', [
          h.owner.orgId,
          team.id,
        ]),
      ).rejects.toMatchObject({ code: '40001' });
      await c.query('ROLLBACK');
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE NOWAIT', [
        h.owner.orgId,
        team.id,
      ]);
      expect(
        (
          await c.query('SELECT version,updated_at FROM teams WHERE org_id=$1 AND id=$2', [
            h.owner.orgId,
            team.id,
          ])
        ).rows[0],
      ).toEqual(before);
    }
    async function grantCount(c: PoolClient, team: TeamData) {
      return (
        await c.query(
          "SELECT count(*)::int AS n FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE'",
          [h.owner.orgId, team.id, h.otherOwner.id],
        )
      ).rows[0]!.n;
    }
    test('putTeamGrant invalidates an old independent-reviewer snapshot without changing team business data', async () => {
      const team = h.teams[0]!,
        c = await h.api.pool.connect();
      try {
        const before = await snapshot(c, team);
        expect(await grantCount(c, team)).toBe(0);
        await grant(h.api, h.owner, team, h.otherOwner);
        // The appended/reactivated authority stays invisible in the old snapshot until its team lock retries.
        expect(await grantCount(c, team)).toBe(0);
        await retry(c, team, before);
        expect(await grantCount(c, team)).toBe(1);
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
      }
    });
    test('acceptInvitation applies the same fence after its real grant write', async () => {
      const team = h.teams[1]!,
        issued = await invite(h.api, h.owner, team, h.otherOwner),
        c = await h.api.pool.connect();
      try {
        const before = await snapshot(c, team);
        expect(await grantCount(c, team)).toBe(0);
        data(
          await call(h.api, 'post', acceptPath(issued.invitation.id), {
            cookie: h.otherOwner.cookie,
            body: { token: issued.token },
          }),
        );
        expect(await grantCount(c, team)).toBe(0);
        await retry(c, team, before);
        expect(await grantCount(c, team)).toBe(1);
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
      }
    });
    test('accepting a C19 claim invalidates a prior snapshot of reviewer non-membership', async () => {
      const team = h.teams[2]!,
        member = team.members[0]!.id;
      const claim = data<{ claimId: string }>(
        await call(
          h.api,
          'post',
          teamPath(h.owner.orgId, team.id) + '/members/' + member + '/claims',
          { cookie: h.leader.cookie, body: { targetUserId: h.otherOwner.id } },
        ),
        201,
      );
      const c = await h.api.pool.connect();
      const count = async () =>
        (
          await c.query(
            "SELECT count(*)::int AS n FROM team_member_bindings WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE'",
            [h.owner.orgId, team.id, h.otherOwner.id],
          )
        ).rows[0]!.n;
      try {
        const before = await snapshot(c, team);
        expect(await count()).toBe(0);
        data(
          await call(h.api, 'post', '/v1/me/member-claims/' + claim.claimId + '/accept', {
            cookie: h.otherOwner.cookie,
            body: {},
          }),
        );
        expect(await count()).toBe(0);
        await retry(c, team, before);
        expect(await count()).toBe(1);
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
      }
    });
  },
);
