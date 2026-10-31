import type { ScheduleFixtureData } from './index.js';

export interface ScheduleOptimizationInput {
  expectedEventVersion: number;
  expectedRevisionVersion: number;
  /** Existing allocations are immutable within this preview unless explicitly false. */
  preserveAssigned?: boolean;
}
export interface ScheduleOptimizationPreview {
  algorithm: 'BALANCED_SEARCH_V1';
  eventVersion: number;
  revisionVersion: number;
  sourceHash: string;
  status: 'COMPLETE' | 'PARTIAL' | 'LIMIT_REACHED';
  allocations: Pick<ScheduleFixtureData, 'fixtureKey' | 'courtId' | 'startsAt'>[];
  unassigned: { fixtureKey: string; reason: 'NO_FEASIBLE_SLOT_FOUND' | 'SEARCH_LIMIT' }[];
  preservedCount: number;
  checks: number;
  limitReached: boolean;
  score: { assignedCount: number; firstLastPenalty: number; latestEnd: string | null };
  /** Preview is not a reservation or proof of global optimality. Apply and publish revalidate. */
  optimality: 'BOUNDED_HEURISTIC';
}
