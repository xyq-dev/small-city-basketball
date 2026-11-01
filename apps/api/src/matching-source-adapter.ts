import type { PoolClient } from 'pg';
import type { Actor } from './service.js';
import type { MatchingKind, MatchingWindow } from '../../../packages/contracts/matching.js';

export interface MatchingConversionInput {
  commandId: string;
  kind: MatchingKind;
  need: {
    id: string;
    orgId: string;
    teamId: string | null;
    regionId: string;
    catalogVersion: string;
    startsAt: string;
    endsAt: string;
    address: string;
    windows: MatchingWindow[];
  };
  candidate: {
    sourceId: string;
    sourceOrgId: string | null;
    userId: string;
    sourceVersion: number;
    sourceSlotId: string | null;
    totalFen: number | null;
  };
  sourceInput: unknown;
}
export interface MatchingSourceResult {
  sourceKind: 'LOCAL_BOOKING' | 'PLAYER_ORDER' | 'TEAM_MATCHUP';
  sourceId: string;
  totalFen: number;
}
/** prepare locks existing org/calendar/source rows BEFORE matching rows.
 * execute creates the original order in this same transaction, never via HTTP.
 * No remote I/O or transaction commit is permitted in either phase. */
export interface MatchingSourceHooks {
  prepare(
    c: PoolClient,
    actor: Actor,
    input: MatchingConversionInput,
  ): Promise<{
    execute(): Promise<MatchingSourceResult>;
  }>;
  inspectEnded?(
    c: PoolClient,
    actor: Actor,
    source: { sourceKind: string; sourceId: string },
  ): Promise<{
    ended: boolean;
    completed: boolean;
    unresolvedMoney: boolean;
    retainedCostFen: number;
  }>;
}
