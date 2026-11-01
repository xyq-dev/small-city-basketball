export type MatchingKind = 'TEAM_MATCHUP' | 'ADULT_PLAYER' | 'STAFF_SERVICE';
export interface MatchingWindow {
  reportAt: string;
  startAt: string;
  endAt: string;
}
export interface MatchingNeedInput {
  commandId: string;
  kind: MatchingKind;
  orgId: string;
  teamId?: string;
  title: string;
  address: string;
  regionId: string;
  catalogVersion: string;
  allowedRegionIds: string[];
  role: string;
  quantity: number;
  windows: MatchingWindow[];
  unitBudgetFen: number;
  totalBudgetFen: number;
  maxTravelMinutes: number;
  expiresAt: string;
  adultConfirmed: true;
}
export interface MatchingScore {
  ruleVersion: 'match-rules-v1';
  score: number;
  coverage: number;
  band: 'SUFFICIENT' | 'LIMITED' | 'INCOMPLETE';
  dimensions: {
    time: number;
    budget: number | null;
    travel: number | null;
    reliability: number | null;
  };
  reasons: string[];
}
export interface MatchingCandidateData {
  id: string;
  sourceId: string;
  sourceOrgId: string | null;
  sourceSlotId: string | null;
  sourceVersion: number;
  name: string;
  role: string;
  regionId: string;
  totalFen: number | null;
  score: MatchingScore;
  needsQuote: boolean;
  crossCity: boolean;
  preferenceVersion: number;
  settingsVersion: number | null;
}
export interface MatchingIntentData {
  candidate: MatchingCandidateData | null;
  id: string;
  needId: string;
  slotId: string;
  candidateId: string;
  status:
    | 'PENDING'
    | 'MUTUAL_INTEREST'
    | 'CONVERTED'
    | 'DECLINED'
    | 'WITHDRAWN'
    | 'EXPIRED'
    | 'STALE'
    | 'SUPERSEDED';
  version: number;
  expiresAt: string;
  canAccept: boolean;
  canWithdraw: boolean;
  canConvert: boolean;
  sourceKind: string | null;
  sourceId: string | null;
}
export interface MatchingNeedData {
  id: string;
  kind: MatchingKind;
  orgId: string;
  teamId: string | null;
  title: string;
  regionId: string;
  catalogVersion: string;
  role: string;
  address: string;
  windows: MatchingWindow[];
  quantity: number;
  unitBudgetFen: number;
  totalBudgetFen: number;
  version: number;
  status: 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'EXPIRED';
  expiresAt: string;
  slots: { id: string; number: number; generation: number; status: string }[];
  candidates: MatchingCandidateData[];
  intents: MatchingIntentData[];
  canManage: boolean;
  latestRunId: string | null;
  truncated: boolean;
}
