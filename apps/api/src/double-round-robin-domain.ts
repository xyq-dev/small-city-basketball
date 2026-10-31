import { createHash } from 'node:crypto';
import type { RegistrationFreezeData, SchedulePolicy } from '@small-city-basketball/contracts';
import { canonicalFreeze, generatePairings, parseSchedulePolicy } from './scheduling-domain.js';

/** A new algorithm identity; the original RR_CIRCLE_V1 serialization stays untouched. */
export function generateDoubleRoundRobinPairings(
  freeze: RegistrationFreezeData,
  policy: SchedulePolicy,
  seed: string,
) {
  const first = generatePairings(freeze, policy, seed);
  const offset = first.rounds.length;
  const second = first.fixtures.map((f) => ({
    ...f,
    fixtureKey: `R${f.roundNo + offset}-P${f.positionNo}`,
    roundNo: f.roundNo + offset,
    homeEntryId: f.awayEntryId,
    awayEntryId: f.homeEntryId,
  }));
  const rounds = first.rounds.concat(
    first.rounds.map((r) => ({ ...r, roundNo: r.roundNo + offset })),
  );
  const fixtures = first.fixtures.concat(second);
  const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  return {
    inputHash: hash({
      algorithmVersion: 'DRR_CIRCLE_V1',
      freeze: canonicalFreeze(freeze),
      policy: parseSchedulePolicy(policy),
    }),
    pairingHash: hash({
      algorithmVersion: 'DRR_CIRCLE_V1',
      seed,
      rounds,
      fixtures: fixtures.map(({ fixtureKey, roundNo, positionNo, homeEntryId, awayEntryId }) => ({
        fixtureKey,
        roundNo,
        positionNo,
        homeEntryId,
        awayEntryId,
      })),
    }),
    rounds,
    fixtures,
    orderedEntryIds: first.orderedEntryIds,
  };
}
