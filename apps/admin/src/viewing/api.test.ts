// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client';
import { createPublicViewingApi, createViewingApi } from '../api/viewing';
import {
  overview,
  publicEvent,
  publicMatch,
  publicStandings,
  response,
  unprepared,
} from './test-fixtures';
describe('private and anonymous viewing adapters', () => {
  it('sends private versions and commands through the credentialed organization client', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(overview));
    const api = createViewingApi(createApiClient({ fetcher }), 'org/a');
    await api.publishRules('private-event-a', {
      type: 'PUBLISH_STANDINGS_RULES',
      rulesetId: 'private-rules-a',
      expectedEventVersion: 7,
    });
    expect(fetcher.mock.calls[0][0]).toBe(
      '/v1/orgs/org%2Fa/events/private-event-a/standings-rule-commands',
    );
    expect(fetcher.mock.calls[0][1]?.credentials).toBe('same-origin');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      type: 'PUBLISH_STANDINGS_RULES',
      rulesetId: 'private-rules-a',
      expectedEventVersion: 7,
    });
    expect(() => createViewingApi(createApiClient(), '')).toThrow('请先选择');
  });
  it('public reads omit cookies, use only anonymous paths, and take every schedule page', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([publicMatch], { nextCursor: 'opaque-public-cursor' }))
      .mockResolvedValueOnce(response([{ ...publicMatch, publicMatchId: 'public-match-b' }]));
    const api = createPublicViewingApi({ fetcher });
    expect(await api.schedule('public/event', 'LIVE')).toHaveLength(2);
    expect(fetcher.mock.calls[0][0]).toBe(
      '/v1/public/events/public%2Fevent/schedule?limit=100&status=LIVE',
    );
    expect(String(fetcher.mock.calls[1][0])).toContain('cursor=opaque-public-cursor');
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'omit')).toBe(true);
  });
  it('a later public page failure rejects the whole result', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([publicMatch], { nextCursor: 'next' }))
      .mockResolvedValueOnce(
        response({ code: 'SERVICE_ERROR', message: 'internal detail' }, {}, 503),
      );
    await expect(
      createPublicViewingApi({ fetcher }).schedule('public-event-a'),
    ).rejects.toMatchObject({ status: 503, apiCode: 'PUBLIC_UNAVAILABLE' });
  });
  it('rejects private fields recursively rather than spreading private snapshots into public UI', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...publicEvent, orgId: 'private-org-secret' }))
      .mockResolvedValueOnce(
        response({ ...unprepared, home: { ...unprepared.home, teamId: 'private-team-secret' } }),
      )
      .mockResolvedValueOnce(
        response({
          ...publicStandings,
          rows: [{ ...publicStandings.rows[0], userId: 'private-user-secret' }],
        }),
      );
    const api = createPublicViewingApi({ fetcher });
    await expect(api.event('public-event-a')).rejects.toMatchObject({
      apiCode: 'INVALID_RESPONSE',
    });
    await expect(api.match('public-event-a', 'public-match-a')).rejects.toMatchObject({
      apiCode: 'INVALID_RESPONSE',
    });
    await expect(api.standings('public-event-a')).rejects.toMatchObject({
      apiCode: 'INVALID_RESPONSE',
    });
  });
  it('preserves unprepared nulls and hides server error details, including public unauthorized responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(unprepared))
      .mockResolvedValueOnce(
        response(
          {
            code: 'UNAUTHORIZED',
            message: 'private person secret',
            details: { session: 'secret' },
          },
          {},
          401,
        ),
      )
      .mockResolvedValueOnce(
        response(
          {
            code: 'RESULT_SOURCE_INVALID',
            message: 'damaged private ID',
            details: { userId: 'secret' },
          },
          {},
          409,
        ),
      );
    const api = createPublicViewingApi({ fetcher });
    expect((await api.match('public-event-a', 'public-match-a')).clock).toBeNull();
    await expect(api.event('public-event-a')).rejects.toMatchObject({
      status: 401,
      message: '暂时无法读取公开资料，请稍后重试',
    });
    await expect(api.standings('public-event-a')).rejects.toMatchObject({
      apiCode: 'RESULT_SOURCE_INVALID',
      details: undefined,
    });
  });
  it('accepts a successful revoke with standings null without deleting locked rules', async () => {
    const revoked = {
      ...overview,
      locked: true,
      standings: null,
      publication: {
        publicEventId: 'old-public-id',
        status: 'REVOKED',
        createdAt: '2026-10-22T08:00:00Z',
        revokedAt: '2026-10-22T08:01:00Z',
      },
    };
    const api = createViewingApi(
      createApiClient({ fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(revoked)) }),
      'org-a',
    );
    const data = await api.publicViewing('event-a', { type: 'DISABLE', expectedEventVersion: 7 });
    expect(data.rules?.version).toBe(1);
    expect(data.standings).toBeNull();
    expect(data.publication?.status).toBe('REVOKED');
  });
});
