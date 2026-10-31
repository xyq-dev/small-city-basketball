import type { ScoringCommandInput, ScoringCommandResponse, ScoringControl } from './index.js';
/** Stable logical operation. Never stores or hashes a renewable lease/session credential. */
export interface OfflineScoringIntent {
  intentId: string;
  queueId: string;
  ordinal: number;
  previousIntentId: string | null;
  command: Omit<ScoringCommandInput, 'control'>;
}
export interface OfflineScoringSubmission {
  intent: OfflineScoringIntent;
  control: ScoringControl;
  confirmImport: true;
}
export interface OfflineScoringResponse extends ScoringCommandResponse {
  intentId: string;
}
