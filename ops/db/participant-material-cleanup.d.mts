import type { Pool } from 'pg';
export interface ParticipantCleanupOptions {
  orgId: string;
  actorId: string;
  limit: number;
}
export function participantCleanupOptions(env?: NodeJS.ProcessEnv): ParticipantCleanupOptions;
export function purgeParticipantMaterials(
  pool: Pool,
  options: Partial<ParticipantCleanupOptions>,
): Promise<{
  status: 'complete';
  purgedRevisions: number;
  touchedEvents: number;
}>;
export function cleanupParticipantMaterials(
  env?: NodeJS.ProcessEnv,
): ReturnType<typeof purgeParticipantMaterials>;
