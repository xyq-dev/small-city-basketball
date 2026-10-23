import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { createGroupKnockoutApi, publicGroups } from './group-knockout';
import { createPublicViewingApi } from './viewing';
import { groupEvent, groupHash, publicGroupEvent } from '../groups/test-fixtures';
import { publicEvent, response } from '../viewing/test-fixtures';
describe('group competition HTTP contracts', () => {
  it('pins scoped event/version/source and separates durable tie draws from qualification publication', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(groupEvent));
    const api = createGroupKnockoutApi(createApiClient({ fetcher }), 'org/a');
    await api.command(groupEvent.event.id, {
      type: 'DRAW_GROUP_TIE',
      expectedEventVersion: 7,
      expectedSourceHash: '0'.repeat(64),
      groupKey: 'A',
      reason: '合成同分抽签',
    });
    await api.command(groupEvent.event.id, {
      type: 'PUBLISH_QUALIFICATION',
      expectedEventVersion: 8,
      expectedSourceHash: groupHash,
      allocations: [],
      reason: '合成资格核对',
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/v1/orgs/org%2Fa/events/private-event-a/group-tie-commands',
      '/v1/orgs/org%2Fa/events/private-event-a/group-qualification-commands',
    ]);
    expect(fetcher.mock.calls[0][1]?.credentials).toBe('same-origin');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      expectedEventVersion: 7,
      expectedSourceHash: '0'.repeat(64),
    });
  });
  it('refuses wrong-event, missing capability and impossible coverage responses', async () => {
    for (const invalid of [
      { ...groupEvent, event: { ...groupEvent.event, id: 'other' } },
      { ...groupEvent, capabilities: {} },
      { ...groupEvent, competition: { ...groupEvent.competition, isComplete: true } },
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(invalid));
      await expect(
        createGroupKnockoutApi(createApiClient({ fetcher }), 'org-a').event(groupEvent.event.id),
      ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
    }
  });
  it('reads an exact public group projection without app credentials or private draw proof', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(publicGroupEvent));
    expect(await createPublicViewingApi({ fetcher }).groups(publicEvent.publicEventId)).toEqual(
      publicGroupEvent,
    );
    expect(fetcher.mock.calls[0][1]?.credentials).toBe('omit');
    expect(publicGroups({ ...publicGroupEvent, seed: 'private' })).toBe(false);
    for (const key of ['entryId', 'roster', 'control', 'seed']) {
      const copy = structuredClone(publicGroupEvent);
      (copy.groups[0]!.rows[0] as unknown as Record<string, unknown>)[key] = 'private';
      expect(publicGroups(copy)).toBe(false);
    }
  });
  it('requires locked rules for public group events and does not accept private credentials in teams', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...publicEvent, format: 'GROUP_KNOCKOUT' }))
      .mockResolvedValueOnce(response({ ...publicEvent, format: 'GROUP_KNOCKOUT', rules: null }));
    const api = createPublicViewingApi({ fetcher });
    expect((await api.event(publicEvent.publicEventId)).format).toBe('GROUP_KNOCKOUT');
    await expect(api.event(publicEvent.publicEventId)).rejects.toMatchObject({
      apiCode: 'INVALID_RESPONSE',
    });
    const copy = structuredClone(publicGroupEvent);
    (copy.groups[0]!.qualified[0] as unknown as Record<string, unknown>).entryId = 'private';
    expect(publicGroups(copy)).toBe(false);
  });
  it('accepts bounded global round numbers after group rounds instead of truncating a valid knockout bracket at round five', () => {
    const copy = structuredClone(publicGroupEvent);
    const teams = copy.groups.flatMap((g) => g.qualified);
    copy.qualificationStatus = 'PUBLISHED';
    copy.publishedMatchCount = 8;
    copy.bracket = {
      publicEventId: copy.publicEventId,
      algorithmVersion: 'SE_SEEDED_V1',
      sourceHash: groupHash,
      asOf: copy.asOf,
      participantCount: 4,
      totalMatchCount: 3,
      publishedMatchCount: 2,
      confirmedMatchCount: 0,
      isComplete: false,
      placements: [],
      rounds: [
        {
          roundNo: 11,
          label: '半决赛',
          published: true,
          slots: [0, 1].map((i) => ({
            positionNo: i + 1,
            home: teams[i * 2]!,
            away: teams[i * 2 + 1]!,
            bye: null,
            publicMatchId: String(i).repeat(43),
            status: 'SCHEDULED' as const,
            winner: null,
          })),
        },
        {
          roundNo: 12,
          label: '决赛',
          published: false,
          slots: [
            {
              positionNo: 1,
              home: null,
              away: null,
              bye: null,
              publicMatchId: null,
              status: 'WAITING',
              winner: null,
            },
          ],
        },
      ],
    };
    expect(publicGroups(copy)).toBe(true);
    copy.bracket.rounds[1]!.roundNo = 32;
    expect(publicGroups(copy)).toBe(false);
  });
});
