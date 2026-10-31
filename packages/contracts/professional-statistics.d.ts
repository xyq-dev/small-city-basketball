import type { ScoringSide } from './index.js';

export type ProfessionalStatKind = 'REBOUND' | 'ASSIST' | 'STEAL' | 'BLOCK' | 'TURNOVER';
export interface ProfessionalPlayerStatistics {
  memberId: string;
  name: string;
  jerseyNo: string;
  starter: boolean;
  appeared: boolean;
  onCourt: boolean;
  playingMs: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  /** null means zero attempts, never a fabricated zero-percent shooting rate. */
  fieldGoalPercentage: number | null;
  threePointPercentage: number | null;
  freeThrowPercentage: number | null;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
}
export interface ProfessionalStatistics {
  algorithmVersion: 'PLAYER_TECHNICAL_V1';
  home: { players: ProfessionalPlayerStatistics[]; lineup: string[] };
  away: { players: ProfessionalPlayerStatistics[]; lineup: string[] };
  /** Playing time uses the authoritative clock timeline, excluding clock corrections. */
  elapsedPlayingMs: number;
}
export type ProfessionalCommandPayload =
  | {
      type: 'CORRECT_LINEUP';
      payload: { targetEventId: string; memberIds: string[]; reason: string };
    }
  | {
      type: 'RECORD_SHOT';
      payload: { side: ScoringSide; memberId: string; shotValue: 1 | 2 | 3; made: boolean };
    }
  | {
      type: 'RECORD_TECHNICAL';
      payload: { side: ScoringSide; memberId: string; kind: ProfessionalStatKind };
    }
  | { type: 'SET_LINEUP'; payload: { side: ScoringSide; memberIds: string[] } }
  | {
      type: 'SUBSTITUTE_PLAYER';
      payload: { side: ScoringSide; outMemberId: string; inMemberId: string };
    }
  | { type: 'VOID_PRO_STAT'; payload: { targetEventId: string; reason: string } }
  | {
      type: 'ADD_PRO_CORRECTION';
      payload: {
        side: ScoringSide;
        memberId: string;
        kind: ProfessionalStatKind | 'SHOT';
        period: number;
        reason: string;
        shotValue?: 1 | 2 | 3;
        made?: boolean;
      };
    };
