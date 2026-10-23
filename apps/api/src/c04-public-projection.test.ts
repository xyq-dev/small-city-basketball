import { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { StandingsService } from './standings-service.js';

const pool = new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });
const service = new StandingsService(pool, {
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  appOrigin: 'http://localhost',
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const publicEventId = 'E'.repeat(43);
function bundle() {
  return {
    event: { format: 'SINGLE_ELIMINATION' },
    pub: { team_keys: { [id(1)]: 'a'.repeat(22), [id(2)]: 'b'.repeat(22) } },
    plan: {
      seed: 'private-seed',
      source: {
        entries: [1, 2].map((n) => ({
          entryId: id(n),
          teamId: id(n + 10),
          teamName: `合成${n}`,
          rosterRevisionId: id(n + 20),
          players: [{ memberId: id(n + 30), name: '私有名单' }],
        })),
      },
    },
    rows: [{ id: id(50), public_match_id: 'M'.repeat(43), confirmation: { id: id(60) } }],
    bracket: {
      algorithmVersion: 'SE_SEEDED_V1',
      sourceHash: 'f'.repeat(64),
      asOf: '2026-10-23T14:00:00.000Z',
      participantCount: 2,
      totalMatchCount: 1,
      publishedMatchCount: 1,
      confirmedMatchCount: 1,
      isComplete: true,
      rounds: [
        {
          roundNo: 1,
          label: '决赛',
          published: true,
          slots: [
            {
              fixtureKey: 'K1-P1',
              positionNo: 1,
              homeEntryId: id(1),
              awayEntryId: id(2),
              byeEntryId: null,
              matchId: id(50),
              status: 'FINAL',
              winnerEntryId: id(1),
              homeSource: 'private-source',
              awaySource: 'private-source',
            },
          ],
        },
      ],
      placements: [{ entryId: id(1), teamName: '合成1', rank: 1, tied: false }],
      nextRound: { sources: [{ confirmationId: id(60) }] },
    },
    rules: null,
    standings: null,
  };
}
function mock(value: unknown) {
  vi.spyOn(service as any, 'transaction').mockImplementation(async (work: any) => work({}));
  vi.spyOn(service as any, 'publicBundle').mockResolvedValue(value);
}
afterEach(() => vi.restoreAllMocks());
afterAll(async () => pool.end());
describe('C04 anonymous knockout DTO projection (unit, no database)', () => {
  test('rebuilds a strict opaque whitelist, omitting draw sources and private identities', async () => {
    mock(bundle());
    const result = await service.getPublicKnockout(publicEventId);
    expect(result.rounds[0]?.slots[0]).toEqual({
      positionNo: 1,
      home: { teamKey: 'a'.repeat(22), teamName: '合成1' },
      away: { teamKey: 'b'.repeat(22), teamName: '合成2' },
      bye: null,
      publicMatchId: 'M'.repeat(43),
      status: 'FINAL',
      winner: { teamKey: 'a'.repeat(22), teamName: '合成1' },
    });
    expect(result.placements).toEqual([
      { team: { teamKey: 'a'.repeat(22), teamName: '合成1' }, rank: 1, tied: false },
    ]);
    expect(Object.keys(result).sort()).toEqual(
      [
        'publicEventId',
        'algorithmVersion',
        'sourceHash',
        'asOf',
        'participantCount',
        'totalMatchCount',
        'publishedMatchCount',
        'confirmedMatchCount',
        'isComplete',
        'rounds',
        'placements',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /00000000-|private-|私有名单|confirmationId|fixtureKey|nextRound|rosterRevisionId/,
    );
  });
  test('fails closed if a materialized match has no link in the current explicit publication', async () => {
    const value = bundle();
    value.rows = [];
    mock(value);
    await expect(service.getPublicKnockout(publicEventId)).rejects.toMatchObject({
      code: 'RESULT_SOURCE_INVALID',
      status: 409,
    });
  });
  test('never invents round-robin league points for a knockout event', async () => {
    mock(bundle());
    await expect(service.getPublicStandings(publicEventId)).rejects.toMatchObject({
      code: 'UNSUPPORTED_STANDINGS_FORMAT',
      status: 422,
    });
  });
});
