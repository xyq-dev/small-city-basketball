import { describe, expect, it, vi } from 'vitest';
import fixtures from './test-fixtures/result-domain.json';
import { createApiClient } from './client';
import { createKnockoutApi, publicKnockout, privateKnockout } from './knockout';
import { createGroupKnockoutApi, publicGroups } from './group-knockout';
import { resultSource } from './result-proofs';
import { response } from '../viewing/test-fixtures';
// Regenerated from real backend domains and public projections by
// apps/admin/scripts/generate-result-fixtures.mjs; no invented confirmation IDs.
const source = fixtures.knockout.bracket.nextRound!.sources[0]!;
describe('administrative proofs and bronze web adapters', () => {
  it('accepts true forfeit semifinal winners/losers and a fully adjudicated bronze completion', async () => {
    for (const value of [fixtures.knockout, fixtures.knockoutComplete]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(value));
      const result = await createKnockoutApi(createApiClient({ fetcher }), 'org-a').event(
        value.event.id,
      );
      expect(result.bracket?.confirmedMatchCount).toBe(0);
      expect(result.bracket?.adjudicatedMatchCount).toBe(value.bracket.publishedMatchCount);
      expect(result.bracket?.totalMatchCount).toBe(4);
    }
    expect(source).not.toHaveProperty('confirmationId');
    expect(publicKnockout(fixtures.publicKnockout)).toBe(true);
    expect(publicKnockout(fixtures.publicKnockoutComplete)).toBe(true);
    expect(fixtures.publicKnockoutComplete.placements.map((p) => p.rank)).toEqual([1, 2, 3, 4]);
  });
  it('accepts explicit group cancellation proofs and actual group forfeit qualification', async () => {
    for (const value of [fixtures.groups, fixtures.cancelledGroups]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(value));
      expect(
        await createGroupKnockoutApi(createApiClient({ fetcher }), 'org-a').event(value.event.id),
      ).toEqual(value);
    }
    expect(publicGroups(fixtures.publicGroups)).toBe(true);
    expect(publicGroups(fixtures.publicCancelledGroups)).toBe(true);
    expect(fixtures.cancelledGroups.competition.qualification.sources[0]!.kind).toBe(
      'CANCELLATION',
    );
  });
  it.each([
    { ...source, kind: 'FORFEIT' },
    { ...source, confirmationId: 'not-an-administrative-proof' },
    { ...source, adjudicationId: undefined },
    { ...source, adjudicationVersion: 1 },
    { ...source, matchVersion: 0 },
    { ...source, matchId: 'untrusted-match' },
    { ...source, fixtureKey: 'R32-P1' },
    { ...source, loserEntryId: source.winnerEntryId },
    { ...source, winnerEntryId: null },
    { ...source, reviewerUserId: 'private' },
    { ...source, kind: 'CANCELLATION', winnerEntryId: null, loserEntryId: null },
  ])('rejects malformed or mixed administrative knockout source %#', (value) => {
    expect(resultSource(value)).toBe(false);
    const copy = structuredClone(fixtures.knockout);
    Object.assign(copy.bracket.nextRound!.sources[0]!, value);
    expect(privateKnockout(copy.bracket)).toBe(false);
  });
  it('fails closed when administrative proof does not match the displayed match or actual loser', () => {
    for (const field of ['matchId', 'loserEntryId']) {
      const copy = structuredClone(fixtures.knockout);
      Object.assign(copy.bracket.nextRound!.sources[0]!, {
        [field]: '00000000-0000-4000-8000-000000999999',
      });
      expect(privateKnockout(copy.bracket)).toBe(false);
    }
  });
  it('requires full internally consistent resolution metadata and the real two-slot bronze tree', () => {
    const partial = structuredClone(fixtures.publicKnockout) as unknown as Record<string, unknown>;
    delete partial.cancelledMatchCount;
    expect(publicKnockout(partial)).toBe(false);
    expect(publicKnockout({ ...fixtures.publicKnockout, resolvedMatchCount: 3 })).toBe(false);
    expect(publicKnockout({ ...fixtures.publicKnockout, totalMatchCount: 3 })).toBe(false);
    const copy = structuredClone(fixtures.publicKnockout);
    Object.assign(copy.rounds[1]!.slots[1]!, { sourceOutcome: 'WINNER' });
    expect(publicKnockout(copy)).toBe(false);
  });
  it('rejects private identifiers, false winners and score-status masquerading in public markers', () => {
    for (const marker of [
      { kind: 'FORFEIT', adjudicationId: 'private' },
      { kind: 'FINAL' },
      { kind: 'CANCELLED' },
    ]) {
      const copy = structuredClone(fixtures.publicKnockout);
      Object.assign(copy.rounds[0]!.slots[0]!, { adjudication: marker });
      expect(publicKnockout(copy)).toBe(false);
    }
    const copy = structuredClone(fixtures.publicKnockout);
    copy.rounds[0]!.slots[0]!.winner = copy.rounds[0]!.slots[1]!.winner;
    expect(publicKnockout(copy)).toBe(false);
  });
  it.each(['groups', 'qualification', 'sources', 'slots', 'unresolvedGroups', 'fixtures'])(
    'rejects malformed private group arrays/objects: %s',
    async (field) => {
      const copy = structuredClone(fixtures.groups);
      if (field === 'groups') Object.assign(copy.competition, { groups: [null] });
      else if (field === 'qualification') Object.assign(copy.competition, { qualification: [] });
      else if (field === 'fixtures')
        Object.assign(copy.competition.nextRound!, { fixtures: [null] });
      else Object.assign(copy.competition.qualification, { [field]: {} });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(copy));
      await expect(
        createGroupKnockoutApi(createApiClient({ fetcher }), 'org-a').event(copy.event.id),
      ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
    },
  );
  it('requires null outcomes for cancellation and forbids cancellation as a knockout winner proof', () => {
    const cancelled = fixtures.cancelledGroups.competition.qualification.sources[0]!;
    expect(resultSource(cancelled, true)).toBe(true);
    expect(resultSource(cancelled)).toBe(false);
    expect(resultSource({ ...cancelled, winnerEntryId: source.winnerEntryId }, true)).toBe(false);
  });
});
