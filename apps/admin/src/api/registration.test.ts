import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { createRegistrationApi } from './registration';

const team = {
  id: 'team-a',
  orgId: 'org-a',
  name: '青峰队',
  version: 2,
  members: [],
  grants: [],
  capabilities: { canManage: true, canInvite: true },
};
const invitation = {
  id: 'invite-a',
  orgId: 'org-a',
  teamId: 'team-a',
  targetUserId: 'leader-a',
  issuerUserId: 'owner-a',
  purpose: 'TEAM_MANAGER',
  expiresAt: '2026-10-25T00:00:00Z',
  acceptedAt: null,
  revokedAt: null,
  createdAt: '2026-10-22T00:00:00Z',
  capabilities: { canRevoke: true },
};
const response = (
  data: unknown,
  nextCursor: string | null = null,
  capabilities?: { canCreateTeam: boolean },
) =>
  new Response(
    JSON.stringify({
      data,
      meta: { requestId: 'test', nextCursor, ...(capabilities ? { capabilities } : {}) },
    }),
  );
describe('报名HTTP适配器', () => {
  it('球队完整分页保留服务端创建能力，机构和游标正确编码', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([team], 'cursor/+', { canCreateTeam: false }))
      .mockResolvedValueOnce(response([{ ...team, id: 'team-b' }]));
    const result = await createRegistrationApi(createApiClient({ fetcher }), 'org/a').teams();
    expect(result).toEqual({ data: [team, { ...team, id: 'team-b' }], canCreateTeam: false });
    const urls = fetcher.mock.calls.map(([path]) => new URL(String(path), 'http://localhost'));
    expect(urls[0]!.pathname).toBe('/v1/orgs/org%2Fa/teams');
    expect(urls[1]!.searchParams.get('cursor')).toBe('cursor/+');
    expect(urls.every((url) => url.searchParams.get('limit') === '100')).toBe(true);
  });
  it('后页失败不返回半截列表，重复游标拒绝无限翻页', async () => {
    const failed = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([invitation], 'next'))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(
      createRegistrationApi(createApiClient({ fetcher: failed }), 'org-a').invitations('team-a'),
    ).rejects.toMatchObject({ status: 503 });
    const loop = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response([], 'same', { canCreateTeam: true }));
    await expect(
      createRegistrationApi(createApiClient({ fetcher: loop }), 'org-a').teams(),
    ).rejects.toMatchObject({ apiCode: 'INVALID_CURSOR' });
    expect(loop).toHaveBeenCalledTimes(2);
  });
  it('没有资源能力或创建能力时明确失败，不猜测为已授权', async () => {
    const { capabilities: _capabilities, ...noPermissions } = team;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(noPermissions))
      .mockResolvedValueOnce(response([]));
    const api = createRegistrationApi(createApiClient({ fetcher }), 'org-a');
    await expect(api.team('team-a')).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
    await expect(api.teams()).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  it('成员写入带版本、邀请token仅返回给调用方、撤销使用POST空对象', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(team))
      .mockResolvedValueOnce(response({ invitation, token: 'one-time' }))
      .mockResolvedValueOnce(response({ ...invitation, revokedAt: '2026-10-22T00:00:01Z' }));
    const api = createRegistrationApi(createApiClient({ fetcher }), 'org-a');
    await api.members('team/a', {
      expectedVersion: 7,
      members: [{ id: 'member-a', name: '同名' }, { name: '同名' }],
    });
    expect(
      (await api.invite('team/a', { targetUserId: 'leader-a', expiresInHours: 24 })).token,
    ).toBe('one-time');
    await api.revoke('team/a', 'invite/a');
    expect(fetcher.mock.calls[0]![0]).toBe('/v1/orgs/org-a/teams/team%2Fa/members');
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual({
      expectedVersion: 7,
      members: [{ id: 'member-a', name: '同名' }, { name: '同名' }],
    });
    expect(fetcher.mock.calls[2]![1]).toMatchObject({
      method: 'POST',
      body: '{}',
      credentials: 'same-origin',
    });
  });
});
