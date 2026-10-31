export type LiveDesired = 'DRAFT' | 'RUNNING' | 'PAUSED' | 'STOPPED';
export type LiveObserved =
  'IDLE' | 'STARTING' | 'LIVE' | 'PARTIAL' | 'INTERRUPTED' | 'STOPPING' | 'ENDED' | 'UNKNOWN';
export type RelayObserved =
  'IDLE' | 'STARTING' | 'CONNECTED' | 'FAILED' | 'STOPPING' | 'STOPPED' | 'UNKNOWN';
export type MediaJobKind = 'RECORDING' | 'TRANSCODE' | 'HIGHLIGHTS';
export interface LiveChannelData {
  id: string;
  platform: string;
  label: string;
  version: number;
  verifiedUntil: string;
  revoked: boolean;
}
export interface LiveTargetData {
  channelId: string;
  platform: string;
  label: string;
  epoch: number;
  state: RelayObserved;
  observedAt: string | null;
  platformState: 'UNKNOWN';
}
export interface LiveSessionData {
  id: string;
  matchId: string;
  version: number;
  epoch: number;
  sourceEpoch: number;
  desired: LiveDesired;
  observed: LiveObserved;
  sourceExpiresAt: string | null;
  leaseOwned: boolean;
  approved: boolean;
  recordingApproved: boolean;
  maximumSeconds: number;
  budgetFen: number;
  startedAt: string | null;
  targets: LiveTargetData[];
}
export interface StreamingWorkspace {
  match: { id: string; eventId: string; status: string };
  channels: LiveChannelData[];
  sessions: LiveSessionData[];
  capabilities: {
    canManage: boolean;
    canExecute: boolean;
    providerReady: boolean;
    blockers: string[];
  };
}
export interface StreamingCommand {
  clientRequestId: string;
  type:
    | 'CREATE'
    | 'APPROVE'
    | 'START'
    | 'HEARTBEAT'
    | 'PAUSE'
    | 'STOP'
    | 'RECONNECT_TARGET'
    | 'STOP_TARGET'
    | 'REVOKE';
  expectedVersion?: number;
  sessionId?: string;
  channelIds?: string[];
  maximumSeconds?: number;
  budgetFen?: number;
  record?: boolean;
  deviceId?: string;
  leaseToken?: string;
  channelId?: string;
  reason?: string;
}
export interface StreamingCommandResult {
  session: LiveSessionData;
  source?: { pushUrl: string; leaseToken: string; expiresAt: string; sourceEpoch: number };
}
export interface MediaJobData {
  id: string;
  sessionId: string;
  kind: MediaJobKind;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED';
  version: number;
  artifactId: string | null;
  error: string | null;
  cancelRequested: boolean;
  createdAt: string;
}
export interface MediaArtifactData {
  id: string;
  durationMs: number;
  byteLength: number;
  sha256: string;
  version: number;
  published: boolean;
  publicKey: string | null;
}
export interface LiveMediaWorkspace {
  session: LiveSessionData;
  jobs: MediaJobData[];
  artifacts: MediaArtifactData[];
  canManage: boolean;
}
