/** C05 bounded files and explicitly published media. Files are never independent public grants. */
export type MediaFilePurpose =
  'PRIVATE_INSURANCE' | 'REGISTRATION_DOC' | 'MATCH_IMAGE' | 'MATCH_VIDEO';
export type MediaContentType = 'application/pdf' | 'image/png' | 'image/jpeg' | 'video/mp4';
export interface MediaFileData {
  id: string;
  purpose: MediaFilePurpose;
  rosterRevisionId: string | null;
  fileName: string;
  contentType: MediaContentType;
  byteLength: number;
  sha256: string;
  version: number;
  status: 'ACTIVE' | 'REVOKED' | 'PURGED';
  createdAt: string;
  revokedAt: string | null;
  purgedAt: string | null;
}
export interface MediaStorageUsage {
  usedBytes: number;
  limitBytes: 134217728;
  maxFileBytes: 8388608;
}
export interface EntryFilesData {
  entryId: string;
  entryVersion: number;
  rosterRevisionId: string | null;
  files: MediaFileData[];
  usage: MediaStorageUsage;
  capabilities: { canUpload: boolean; canRevoke: boolean; canPurge: boolean };
}
export interface UploadMediaFileInput {
  purpose: MediaFilePurpose;
  fileName: string;
  contentType: MediaContentType;
  base64: string;
  expectedEntryVersion?: number;
}
export interface MediaFileCommandInput {
  type: 'REVOKE' | 'PURGE';
  expectedVersion: number;
  reason: string;
}
export interface MediaMarkerData {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  sourceEventId: string;
  sourceSeq: number;
  confirmationId: string;
  sourceMatchVersion: number;
  sourceStatus: 'CURRENT' | 'STALE';
}
export interface MatchMediaData {
  id: string;
  kind: 'IMAGE' | 'VIDEO' | 'EXTERNAL_LINK';
  title: string;
  fileId: string | null;
  externalUrl: string | null;
  rightsDeclaration: string;
  status: 'DRAFT' | 'PUBLISHED' | 'REVOKED';
  version: number;
  createdAt: string;
  markers: MediaMarkerData[];
}
export interface MatchMediaWorkspaceData {
  matchId: string;
  eventId: string;
  matchStatus: string;
  matchVersion: number;
  currentConfirmationId: string | null;
  files: MediaFileData[];
  media: MatchMediaData[];
  sourceEvents: { id: string; seq: number; type: string; serverTime: string }[];
  trustedExternalHosts: string[];
  usage: MediaStorageUsage;
  capabilities: {
    canUpload: boolean;
    canManage: boolean;
    canPublish: boolean;
    canMark: boolean;
    canPurge: boolean;
  };
}
export interface CreateMatchMediaInput {
  kind: 'IMAGE' | 'VIDEO' | 'EXTERNAL_LINK';
  title: string;
  fileId?: string;
  externalUrl?: string;
  rightsDeclaration: string;
}
export interface MatchMediaCommandInput {
  type: 'PUBLISH' | 'REVOKE';
  expectedVersion: number;
}
export interface CreateMediaMarkerInput {
  expectedVersion: number;
  expectedConfirmationId: string;
  sourceEventId: string;
  label: string;
  startMs: number;
  endMs: number;
}
export interface PublicMatchMediaData {
  publicEventId: string;
  publicMatchId: string;
  media: {
    publicMediaId: string;
    kind: 'IMAGE' | 'VIDEO' | 'EXTERNAL_LINK';
    title: string;
    contentPath: string | null;
    contentType: 'image/png' | 'image/jpeg' | 'video/mp4' | null;
    externalUrl: string | null;
    externalNotice: string | null;
    markers: { publicMarkerId: string; label: string; startMs: number; endMs: number }[];
  }[];
}
