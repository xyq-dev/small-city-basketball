import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { createKnockoutApi, publicKnockout } from './knockout';
import { createPublicViewingApi } from './viewing';
import { knockout, publicKnockoutFixture } from '../knockout/test-fixtures';
import { publicEvent, response } from '../viewing/test-fixtures';
describe('knockout HTTP contracts', () => {
  it('preserves organization scope, explicit source/version and credentials on commands', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(knockout));
    const api = createKnockoutApi(createApiClient({ fetcher }), 'org/a');
    await api.publish(knockout.event.id, {
      type: 'PUBLISH_ROUND',
      expectedEventVersion: 7,
      expectedSourceHash: 'a'.repeat(64),
      roundNo: 2,
      reason: '合成独立核对',
      allocations: [
        { fixtureKey: 'R2-P1', courtId: 'court-a', startsAt: '2026-12-01T15:00:00.000+08:00' },
      ],
    });
    expect(fetcher.mock.calls[0][0]).toBe(
      '/v1/orgs/org%2Fa/events/private-event-a/knockout-round-commands',
    );
    expect(fetcher.mock.calls[0][1]?.credentials).toBe('same-origin');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      expectedEventVersion: 7,
      expectedSourceHash: 'a'.repeat(64),
    });
    expect(() => createKnockoutApi(createApiClient({ fetcher }), '')).toThrow('请先选择');
  });
  it('rejects a different event, missing capabilities and impossible complete coverage', async () => {
    const invalid = [
      { ...knockout, event: { ...knockout.event, id: 'other-event' } },
      { ...knockout, capabilities: {} },
      { ...knockout, bracket: { ...knockout.bracket, isComplete: true } },
    ];
    for (const value of invalid) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(value));
      await expect(
        createKnockoutApi(createApiClient({ fetcher }), 'org-a').event(knockout.event.id),
      ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
    }
  });
  it('reads public format before choosing a bracket, and permits null rules only for single elimination', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ ...publicEvent, format: 'SINGLE_ELIMINATION', rules: null }),
      )
      .mockResolvedValueOnce(response({ ...publicEvent, rules: null }));
    const api = createPublicViewingApi({ fetcher });
    expect(await api.event(publicEvent.publicEventId)).toMatchObject({
      format: 'SINGLE_ELIMINATION',
      rules: null,
    });
    await expect(api.event(publicEvent.publicEventId)).rejects.toMatchObject({
      apiCode: 'INVALID_RESPONSE',
    });
  });
  it('accepts only public opaque teams/matches and omits all login credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(publicKnockoutFixture));
    expect(await createPublicViewingApi({ fetcher }).knockout(publicEvent.publicEventId)).toEqual(
      publicKnockoutFixture,
    );
    expect(fetcher.mock.calls[0][0]).toBe(
      `/v1/public/events/${publicEvent.publicEventId}/knockout`,
    );
    expect(fetcher.mock.calls[0][1]?.credentials).toBe('omit');
  });
  it.each(['seed', 'entryId', 'playerRoster', 'control'])(
    'rejects unexpected public %s at every relevant boundary',
    (field) => {
      expect(publicKnockout({ ...publicKnockoutFixture, [field]: 'private' })).toBe(false);
      const top = structuredClone(publicKnockoutFixture);
      const round = top.rounds[0]!;
      (round.slots[0] as unknown as Record<string, unknown>)[field] = 'private';
      expect(publicKnockout(top)).toBe(false);
      const nested = structuredClone(publicKnockoutFixture);
      (nested.rounds[0]!.slots[0]!.home as unknown as Record<string, unknown>)[field] = 'private';
      expect(publicKnockout(nested)).toBe(false);
    },
  );
});
