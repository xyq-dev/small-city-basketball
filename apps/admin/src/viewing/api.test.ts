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
  it('preserves explicit history purpose and sends the separate command without widening anonymous DTOs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      response({
        ...overview,
        event: { ...overview.event, status: 'COMPLETED' },
        publication: {
          publicEventId: 'new-history-key',
          status: 'ACTIVE',
          purpose: 'HISTORY',
          createdAt: overview.event.createdAt,
          revokedAt: null,
        },
      }),
    );
    const api = createViewingApi(createApiClient({ fetcher }), 'org-a');
    const data = await api.publicViewing('private-event-a', {
      type: 'ENABLE_HISTORY',
      expectedEventVersion: 7,
    });
    expect(data.publication?.purpose).toBe('HISTORY');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      type: 'ENABLE_HISTORY',
      expectedEventVersion: 7,
    });
  });
  it.each(['OTHER', null, ['LIVE'], { purpose: 'LIVE' }])(
    'rejects an unrecognized publication purpose: %j',
    async (purpose) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        response({
          ...overview,
          publication: {
            publicEventId: 'new-key',
            status: 'ACTIVE',
            purpose,
            createdAt: overview.event.createdAt,
            revokedAt: null,
          },
        }),
      );
      await expect(
        createViewingApi(createApiClient({ fetcher }), 'org-a').event('private-event-a'),
      ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
    },
  );
});

// These DTOs are generated by actual API domains/projections (see generator).
import domainFixtures from '../api/test-fixtures/result-domain.json';
describe('public administrative results and double round robin', () => {
  it('accepts real DRR event/rules, resolved table counts, forfeit/cancel schedule and null-stat snapshot', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(domainFixtures.publicEvent))
      .mockResolvedValueOnce(response(domainFixtures.publicStandings))
      .mockResolvedValueOnce(
        response([domainFixtures.publicForfeit, domainFixtures.publicCancellation]),
      )
      .mockResolvedValueOnce(response(domainFixtures.publicSnapshot));
    const api = createPublicViewingApi({ fetcher });
    expect((await api.event('synthetic')).format).toBe('DOUBLE_ROUND_ROBIN');
    expect(await api.standings('synthetic')).toMatchObject({
      confirmedMatchCount: 0,
      adjudicatedMatchCount: 1,
      cancelledMatchCount: 1,
      resolvedMatchCount: 2,
      isComplete: true,
    });
    expect(await api.schedule('synthetic')).toEqual([
      domainFixtures.publicForfeit,
      domainFixtures.publicCancellation,
    ]);
    expect(await api.match('synthetic', 'match')).toMatchObject({
      adjudication: { kind: 'FORFEIT' },
      score: null,
      totals: null,
      periods: null,
      rules: null,
      clock: null,
    });
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'omit')).toBe(true);
  });
  it.each([
    { ...domainFixtures.publicEvent, resolvedMatchCount: 3 },
    { ...domainFixtures.publicEvent, adjudicatedMatchCount: undefined },
    { ...domainFixtures.publicEvent, format: 'UNSUPPORTED' },
    { ...domainFixtures.publicEvent, privateEventId: 'private' },
    {
      ...domainFixtures.publicEvent,
      rules: { ...domainFixtures.publicEvent.rules, algorithmVersion: 'DRR_STANDINGS_V1' },
    },
  ])(
    'rejects malformed counts, unknown format/algorithm or private event fields %#',
    async (value) => {
      const api = createPublicViewingApi({
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(value)),
      });
      await expect(api.event('synthetic')).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
    },
  );
  it.each([
    {
      ...domainFixtures.publicForfeit,
      adjudication: { ...domainFixtures.publicForfeit.adjudication, adjudicationId: 'private' },
    },
    {
      ...domainFixtures.publicForfeit,
      adjudication: { kind: 'FORFEIT', winner: { teamKey: 'foreign', teamName: 'foreign' } },
    },
    {
      ...domainFixtures.publicForfeit,
      adjudication: { kind: 'CANCELLED', winner: domainFixtures.publicForfeit.home },
    },
    { ...domainFixtures.publicForfeit, status: 'FINAL' },
    { ...domainFixtures.publicForfeit, score: { home: 20, away: 0 } },
    { ...domainFixtures.publicForfeit, resultStatus: 'CONFIRMED' },
    { ...domainFixtures.publicForfeit, adjudication: { kind: 'FORFEIT' } },
    { ...domainFixtures.publicForfeit, adjudication: { kind: 'UNSUPPORTED', winner: null } },
  ])('rejects false scoring data and untrusted public adjudication %#', async (value) => {
    const api = createPublicViewingApi({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response([value])),
    });
    await expect(api.schedule('synthetic')).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  it('keeps the public snapshot/standings whitelist strict around optional result fields', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          ...domainFixtures.publicSnapshot,
          adjudication: { ...domainFixtures.publicSnapshot.adjudication, requestId: 'private' },
        }),
      )
      .mockResolvedValueOnce(
        response({
          ...domainFixtures.publicStandings,
          rules: { ...domainFixtures.publicStandings.rules, eventId: 'private' },
        }),
      )
      .mockResolvedValueOnce(
        response({
          ...domainFixtures.publicSnapshot,
          clock: {
            period: 1,
            remainingMs: 0,
            running: false,
            anchorServerTime: domainFixtures.publicSnapshot.serverTime,
            clockVersion: 1,
          },
        }),
      );
    const api = createPublicViewingApi({ fetcher });
    await expect(api.match('synthetic', 'match')).rejects.toMatchObject({
      apiCode: 'INVALID_RESPONSE',
    });
    await expect(api.standings('synthetic')).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
    await expect(api.match('synthetic', 'match')).rejects.toMatchObject({
      apiCode: 'INVALID_RESPONSE',
    });
  });
});
