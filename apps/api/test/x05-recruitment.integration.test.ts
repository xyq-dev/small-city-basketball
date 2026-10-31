import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { ORIGIN, call, data, error } from './support.js';
import { openRegistration, registration, registrationCommand, team } from './p03-support.js';
import { closeHarness, createHarness } from './p04-support.js';
import type { Harness } from './p04-support.js';
import type { Api, User } from './support.js';

type Row = Record<string, any>;
describe('X05 public recruitment and imports on isolated PostgreSQL', { concurrent: false }, () => {
  let h: Harness;
  const extras: Api[] = [];
  beforeAll(async () => {
    h = await createHarness(0);
  }, 90000);
  afterAll(async () => {
    for (const api of extras) {
      await api.app.close();
      await api.pool.end();
    }
    if (h) await closeHarness(h);
  }, 30000);
  const base = (event: string) => `/v1/orgs/${h.owner.orgId}/events/${event}`;
  const post = (path: string, body: object, actor: User = h.owner, api = h.api) =>
    call(api, 'post', path, { cookie: actor.cookie, body });
  async function workspace(event: string) {
    return data<Row>(
      await call(h.api, 'get', base(event) + '/recruitment', { cookie: h.owner.cookie }),
    );
  }
  async function publish(event: string) {
    const w = await workspace(event);
    return data<Row>(
      await post(base(event) + '/recruitment/publish', {
        clientRequestId: randomUUID(),
        expectedEventVersion: w.event.version,
        title: '合成公开招募',
        description: '只使用合成测试资料；先招募后发布赛程。',
        closesAt: new Date(Date.now() + 86400000).toISOString(),
        maxApplications: 64,
      }),
      201,
    ).publication;
  }
  test('independent recruitment is public before formal schedule, approval drafts one team and no organization role', async () => {
    const reg = await openRegistration(h.api, h.owner, 'X05独立招募'),
      event = reg.event.id,
      pub = await publish(event),
      publicPath = `/v1/public/recruitments/${pub.publicId}`;
    const publicDto = data<Row>(await call(h.api, 'get', publicPath));
    expect(Object.keys(publicDto).sort()).toEqual(
      ['publicId', 'title', 'description', 'closesAt', 'event', 'requirements', 'notice'].sort(),
    );
    for (const marker of [h.owner.id, h.owner.orgId, event, h.leader.id, h.leader.email])
      expect(JSON.stringify(publicDto)).not.toContain(marker);
    const input = {
      clientRequestId: randomUUID(),
      teamName: 'X05新队-' + randomUUID().slice(0, 8),
      teamId: null,
      note: '本人申请',
    };
    error(await call(h.api, 'post', publicPath + '/applications', { body: input }), 401);
    const submitted = data<Row>(
      await post(publicPath + '/applications', input, h.leader),
      201,
    ).application;
    expect(submitted.status).toBe('PENDING');
    expect(
      data<Row>(await post(publicPath + '/applications', input, h.leader), 201).application.id,
    ).toBe(submitted.id);
    error(
      await post(publicPath + '/applications', { ...input, teamName: '篡改原内容' }, h.leader),
      409,
    );
    const command = {
      clientRequestId: randomUUID(),
      expectedVersion: submitted.version,
      type: 'APPROVE',
      reason: '独立核对招募通过',
    };
    const approved = data<Row>(
      await post(base(event) + `/recruitment-applications/${submitted.id}/commands`, command),
    ).application;
    expect(approved).toMatchObject({ status: 'APPROVED', applicantId: h.leader.id });
    const entry = (
      await h.api.pool.query('SELECT status,team_id FROM entries WHERE id=$1', [approved.entryId])
    ).rows[0]!;
    expect(entry.status).toBe('DRAFT');
    expect(
      (
        await h.api.pool.query(
          "SELECT role FROM team_access_grants WHERE team_id=$1 AND user_id=$2 AND status='ACTIVE'",
          [entry.team_id, h.leader.id],
        )
      ).rows,
    ).toEqual([{ role: 'TEAM_MANAGER' }]);
    expect(
      (
        await h.api.pool.query(
          'SELECT 1 FROM organization_memberships WHERE org_id=$1 AND user_id=$2',
          [h.owner.orgId, h.leader.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await h.api.pool.query(
          'SELECT 1 FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3',
          [h.owner.orgId, event, h.leader.id],
        )
      ).rowCount,
    ).toBe(0);
    const w = await workspace(event);
    data(
      await post(base(event) + '/recruitment/revoke', {
        clientRequestId: randomUUID(),
        expectedVersion: w.publication.version,
        reason: '合成招募关闭',
      }),
    );
    error(await call(h.api, 'get', publicPath), 404);
    expect(
      data<Row>(
        await call(h.api, 'get', '/v1/me/recruitment-requests/' + input.clientRequestId, {
          cookie: h.leader.cookie,
        }),
      ).result.application.id,
    ).toBe(submitted.id);
  });
  test('a manager cannot approve their own application and closing registration permanently revokes the old public link', async () => {
    const reg = await openRegistration(h.api, h.owner, 'X05独立审核'),
      event = reg.event.id,
      pub = await publish(event),
      path = `/v1/public/recruitments/${pub.publicId}`;
    const row = data<Row>(
      await post(path + '/applications', {
        clientRequestId: randomUUID(),
        teamName: '申请人即办赛人-' + randomUUID().slice(0, 8),
      }),
      201,
    ).application;
    const response = await post(base(event) + `/recruitment-applications/${row.id}/commands`, {
      clientRequestId: randomUUID(),
      expectedVersion: 1,
      type: 'APPROVE',
      reason: '不能自己批准自己',
    });
    error(response, 403);
    expect(response.body.error.code).toBe('INDEPENDENT_REVIEW_REQUIRED');
    let current = await registration(h.api, h.owner, event);
    current = await registrationCommand(h.api, h.owner, current, 'CLOSE_REGISTRATION');
    error(await call(h.api, 'get', path), 404);
    expect(
      (
        await h.api.pool.query(
          'SELECT status,revoke_reason FROM recruitment_publications WHERE id=$1',
          [pub.id],
        )
      ).rows[0],
    ).toMatchObject({ status: 'REVOKED' });
    await expect(
      h.api.pool.query("UPDATE recruitment_publications SET status='ACTIVE' WHERE id=$1", [pub.id]),
    ).rejects.toMatchObject({ code: '23514' });
    error(await call(h.api, 'get', path), 404);
  });
  test('bulk preview locates each bad row and refuses partial or stale commit', async () => {
    const reg = await openRegistration(h.api, h.owner, 'X05逐行错误'),
      event = reg.event.id,
      w = await workspace(event);
    const body = {
      clientRequestId: randomUUID(),
      expectedEventVersion: w.event.version,
      rows: [
        { teamName: '唯一新队-' + randomUUID() },
        { teamName: '' },
        { teamName: '重复合成队' },
        { teamName: '重复合成队' },
        { teamName: '领队不存在', leaderUserId: randomUUID() },
      ],
    };
    const p = data<Row>(await post(base(event) + '/team-import/previews', body), 201).preview;
    expect(p.issues.map((i: Row) => i.row)).toEqual(expect.arrayContaining([2, 4, 5]));
    expect(p.canCommit).toBe(false);
    error(
      await post(base(event) + '/team-import/commit', {
        clientRequestId: randomUUID(),
        expectedEventVersion: p.eventVersion,
        previewId: p.id,
        previewHash: p.previewHash,
      }),
      422,
    );
    expect(
      (await h.api.pool.query('SELECT 1 FROM entries WHERE event_id=$1', [event])).rowCount,
    ).toBe(0);
    const good = data<Row>(
      await post(base(event) + '/team-import/previews', {
        clientRequestId: randomUUID(),
        expectedEventVersion: w.event.version,
        rows: [{ teamName: '过期预览队-' + randomUUID() }],
      }),
      201,
    ).preview;
    await publish(event);
    error(
      await post(base(event) + '/team-import/commit', {
        clientRequestId: randomUUID(),
        expectedEventVersion: good.eventVersion,
        previewId: good.id,
        previewHash: good.previewHash,
      }),
      409,
    );
  });
  test('concurrent import commits one set, restart replays original receipt and only the named invitee may accept without staff privileges', async () => {
    const reg = await openRegistration(h.api, h.owner, 'X05原子导入'),
      event = reg.event.id,
      w = await workspace(event);
    const p = data<Row>(
      await post(base(event) + '/team-import/previews', {
        clientRequestId: randomUUID(),
        expectedEventVersion: w.event.version,
        rows: [
          { teamName: '导入合成队-' + randomUUID().slice(0, 8), leaderUserId: h.leader.id },
          { teamName: '另队-' + randomUUID().slice(0, 8) },
        ],
      }),
      201,
    ).preview;
    const body = {
      clientRequestId: randomUUID(),
      expectedEventVersion: p.eventVersion,
      previewId: p.id,
      previewHash: p.previewHash,
    };
    const responses = await Promise.all([
        post(base(event) + '/team-import/commit', body),
        post(base(event) + '/team-import/commit', body),
      ]),
      first = data<Row>(responses[0]!),
      second = data<Row>(responses[1]!);
    expect(second).toEqual(first);
    expect(first.entries).toHaveLength(2);
    expect(
      (await h.api.pool.query('SELECT 1 FROM entries WHERE event_id=$1', [event])).rowCount,
    ).toBe(2);
    const imported = first.entries[0],
      inv = imported.invitation;
    expect(
      (
        await h.api.pool.query('SELECT 1 FROM team_access_grants WHERE team_id=$1', [
          imported.teamId,
        ])
      ).rowCount,
    ).toBe(0);
    const fresh = await createApi({ databaseUrl: h.databaseUrl, appOrigin: ORIGIN });
    extras.push(fresh);
    expect(
      data<Row>(await post(base(event) + '/team-import/commit', body, h.owner, fresh)),
    ).toEqual(first);
    const accept = { clientRequestId: randomUUID(), expectedVersion: inv.version, type: 'ACCEPT' },
      path = `/v1/event-invitations/${inv.id}/commands`;
    error(await post(path, accept, h.otherOwner), 404);
    const mine = data<Row>(
      await call(h.api, 'get', '/v1/me/event-invitations', { cookie: h.leader.cookie }),
    );
    expect(mine.items.some((x: Row) => x.id === inv.id)).toBe(true);
    expect(data<Row>(await post(path, accept, h.leader)).invitation.entryId).toBe(imported.entryId);
    expect(
      (
        await h.api.pool.query(
          "SELECT role FROM team_access_grants WHERE team_id=$1 AND user_id=$2 AND status='ACTIVE'",
          [imported.teamId, h.leader.id],
        )
      ).rows,
    ).toEqual([{ role: 'TEAM_MANAGER' }]);
    expect(
      (
        await h.api.pool.query(
          'SELECT 1 FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3',
          [h.owner.orgId, event, h.leader.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await h.api.pool.query(
          'SELECT 1 FROM organization_memberships WHERE org_id=$1 AND user_id=$2',
          [h.owner.orgId, h.leader.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  test('existing team cannot be merged by name or taken over through import', async () => {
    const reg = await openRegistration(h.api, h.owner, 'X05不接管'),
      event = reg.event.id,
      target = await team(h.api, h.owner, '已有领队队', h.leader),
      w = await workspace(event);
    const p = data<Row>(
      await post(base(event) + '/team-import/previews', {
        clientRequestId: randomUUID(),
        expectedEventVersion: w.event.version,
        rows: [
          { teamName: target.name },
          { teamName: target.name, teamId: target.id, leaderUserId: h.otherOwner.id },
        ],
      }),
      201,
    ).preview;
    expect(p.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 1, code: 'EXISTING_NAME_REQUIRES_ID' }),
        expect.objectContaining({ row: 2, code: 'LEADER_CONFLICT' }),
      ]),
    );
    expect(
      (
        await h.api.pool.query(
          "SELECT user_id FROM team_access_grants WHERE team_id=$1 AND status='ACTIVE'",
          [target.id],
        )
      ).rows,
    ).toEqual([{ user_id: h.leader.id }]);
  });
});
