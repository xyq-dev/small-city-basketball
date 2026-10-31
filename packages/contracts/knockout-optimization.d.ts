import type { ScheduleOptimizationPreview } from './scheduling-completion.js';
export type KnockoutOptimizationPreview =
  | { status: 'WAITING_FOR_RESULTS'; eventVersion: number; revisionVersion: number | null }
  | {
      status: 'READY';
      eventVersion: number;
      revisionVersion: number;
      sourceHash: string;
      roundNo: number;
      optimization: ScheduleOptimizationPreview;
    };
