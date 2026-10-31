import { describe, expect, it } from 'vitest';
import {
  administrativeOutcome,
  administrativeResult,
  exceptionProposalInput,
  exceptionReviewInput,
  exceptionRulesInput,
} from './match-exception-domain.js';
import { calculateStandings } from './standings-domain.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-10-31T00:00:00.000Z';
function evidence(kind = 'FORFEIT') {
  const match = {
    id: id(1),
    event_id: id(2),
    fixture_key: 'R1-P1',
    version: 1,
    status: 'SCHEDULED',
    home_entry_id: id(3),
    away_entry_id: id(4),
  };
  const rules = {
    id: id(5),
    event_id: id(2),
    version: 1,
    forfeit_win_points: 2,
    forfeit_loss_points: 0,
    cancellation_policy: 'EXCLUDE_FROM_TABLE',
  };
  const request = {
    id: id(6),
    match_id: id(1),
    event_id: id(2),
    status: 'APPROVED',
    operation: 'DECLARE',
    version: 2,
    proposed_by: id(7),
    reviewed_by: id(8),
    reviewed_at: now,
    source_match_version: 1,
    rules_id: id(5),
    rules_version: 1,
    kind,
    forfeiting_side: kind === 'FORFEIT' ? 'HOME' : null,
    winner_entry_id: kind === 'FORFEIT' ? id(4) : null,
    loser_entry_id: kind === 'FORFEIT' ? id(3) : null,
  };
  return {
    match,
    proof: {
      checked: true as const,
      head: { version: 2, active_request_id: request.id },
      request,
      rules,
    },
  };
}
const bad = (fn: () => unknown) =>
  expect(fn).toThrowError(expect.objectContaining({ code: 'RESULT_SOURCE_INVALID' }));
describe('administrative adjudication proof and independent inputs', () => {
  it('forfeit provides actual opponent and explicit provenance without score or confirmation', () => {
    const { match, proof } = evidence();
    const result = administrativeOutcome(match, proof)!;
    expect(result).toMatchObject({
      winnerEntryId: id(4),
      loserEntryId: id(3),
      homeLeaguePoints: 0,
      awayLeaguePoints: 2,
      contributesRecordedStatistics: false,
    });
    expect(result.source).toEqual({
      kind: 'ADJUDICATION',
      fixtureKey: 'R1-P1',
      matchId: id(1),
      adjudicationId: id(6),
      adjudicationVersion: 2,
      matchVersion: 1,
      winnerEntryId: id(4),
      loserEntryId: id(3),
    });
    expect(result).not.toHaveProperty('homeScore');
    expect(result.source).not.toHaveProperty('confirmationId');
  });
  it('active adjudication never masks a started/final or incompatible prepared state', () => {
    const { match, proof } = evidence();
    for (const status of ['LIVE', 'FINAL', 'PAUSED'])
      bad(() => administrativeOutcome({ ...match, status }, proof));
    bad(() =>
      administrativeOutcome(
        { ...match, status: 'READY', state: { source_version: 1, clock_running: true } },
        proof,
      ),
    );
    bad(() =>
      administrativeOutcome(
        {
          ...match,
          status: 'READY',
          state: { source_version: 1, clock_running: false, latest_confirmation_id: id(42) },
        },
        proof,
      ),
    );
  });
  it('administrative source requires real UUID identities', () => {
    const { match, proof } = evidence();
    proof.request.id = 'fake';
    proof.head.active_request_id = 'fake';
    bad(() => administrativeOutcome(match, proof));
  });
  it('cancellation has no winner and no knockout source', () => {
    const { match, proof } = evidence('CANCELLED');
    expect(administrativeOutcome(match, proof)).toMatchObject({
      kind: 'CANCELLED',
      winnerEntryId: null,
      loserEntryId: null,
      source: null,
      homeLeaguePoints: null,
    });
  });
  it.each(['request', 'rules', 'head'])('missing %s join fails closed', (field) => {
    const { match, proof } = evidence();
    delete (proof as any)[field];
    bad(() => administrativeOutcome(match, proof));
  });
  it.each([
    'reviewed_by',
    'reviewed_at',
    'rules_id',
    'source_match_version',
    'winner_entry_id',
    'loser_entry_id',
    'status',
    'operation',
  ])('tampered %s fails closed', (field) => {
    const { match, proof } = evidence();
    (proof.request as any)[field] = null;
    bad(() => administrativeOutcome(match, proof));
  });
  it('same proposer/reviewer and wrong rules version fail closed', () => {
    const { match, proof } = evidence();
    proof.request.reviewed_by = proof.request.proposed_by;
    bad(() => administrativeOutcome(match, proof));
    proof.request.reviewed_by = id(8);
    proof.rules.version = 2;
    bad(() => administrativeOutcome(match, proof));
  });
  it('only explicit join may represent revoked/no decision', () => {
    expect(
      administrativeResult({
        exception_checked: true,
        exception_head: null,
        exception_request: null,
        exception_rules: null,
      }),
    ).toBeNull();
    bad(() => administrativeResult({ exception_checked: true }));
  });
  it('commands require explicit versioned rules and no fabricated cancellation winner', () => {
    expect(() =>
      exceptionRulesInput({
        clientRequestId: id(99),
        expectedEventVersion: 1,
        expectedVersion: 0,
        forfeitWinPoints: 2,
        cancellationPolicy: 'EXCLUDE_FROM_TABLE',
      }),
    ).toThrow();
    expect(() =>
      exceptionProposalInput({
        clientRequestId: id(99),
        expectedEventVersion: 1,
        expectedMatchVersion: 1,
        operation: 'DECLARE',
        kind: 'CANCELLED',
        forfeitingSide: 'HOME',
        reason: '合成取消原因',
      }),
    ).toThrow();
    expect(() =>
      exceptionReviewInput({
        clientRequestId: id(99),
        expectedEventVersion: 1,
        expectedMatchVersion: 1,
        expectedRequestVersion: 1,
        type: 'APPROVE',
        reason: '短',
      }),
    ).toThrow();
  });
});
describe('table consumes adjudications without inventing recorded points', () => {
  function table(kind = 'FORFEIT', double = false) {
    const { match, proof } = evidence(kind);
    const m = {
      ...match,
      exception_checked: true,
      exception_head: proof.head,
      exception_request: proof.request,
      exception_rules: proof.rules,
    };
    const matches = double
      ? [
          m,
          {
            ...m,
            id: id(10),
            fixture_key: 'R2-P1',
            home_entry_id: match.away_entry_id,
            away_entry_id: match.home_entry_id,
            exception_head: { version: 2, active_request_id: id(11) },
            exception_request: {
              ...proof.request,
              id: id(11),
              match_id: id(10),
              winner_entry_id: kind === 'FORFEIT' ? match.home_entry_id : null,
              loser_entry_id: kind === 'FORFEIT' ? match.away_entry_id : null,
            },
          },
        ]
      : [m];
    return calculateStandings({
      participants: [
        { entryId: id(3), teamId: id(13), teamName: '合成主队' },
        { entryId: id(4), teamId: id(14), teamName: '合成客队' },
      ],
      matches,
      rules: {
        id: id(20),
        eventId: id(2),
        version: 1,
        algorithmVersion: 'RR_STANDINGS_V1',
        createdAt: now,
        winPoints: 3,
        lossPoints: 1,
        drawPoints: 0,
        tiebreakers: ['WINS'],
      },
      publicationId: id(22),
      asOf: now,
      mode: 'PUBLISHED',
      ...(double ? { format: 'DOUBLE_ROUND_ROBIN' as const } : {}),
    });
  }
  it('awards locked administrative league points without claiming recorded confirmation', () => {
    const t = table();
    expect(t).toMatchObject({
      confirmedMatchCount: 0,
      adjudicatedMatchCount: 1,
      resolvedMatchCount: 1,
      isComplete: true,
    });
    expect(t.rows[0]).toMatchObject({
      entryId: id(4),
      wins: 1,
      leaguePoints: 2,
      pointsFor: 0,
      pointsAgainst: 0,
    });
  });
  it('excludes cancelled games from played, scores and points while resolving lifecycle', () => {
    const t = table('CANCELLED');
    expect(t).toMatchObject({
      confirmedMatchCount: 0,
      cancelledMatchCount: 1,
      resolvedMatchCount: 1,
      isComplete: true,
    });
    for (const r of t.rows)
      expect(r).toMatchObject({ played: 0, leaguePoints: 0, pointsFor: 0, pointsAgainst: 0 });
  });
  it('validates both directed legs in double round robin', () => {
    const t = table('FORFEIT', true);
    expect(t).toMatchObject({ totalMatchCount: 2, adjudicatedMatchCount: 2, isComplete: true });
    expect(t.rows.every((r) => r.played === 2 && r.wins === 1 && r.losses === 1)).toBe(true);
  });
});
