// C19 media request idempotency and chunked upload sessions (§2); frozen in docs/design/C19_CONTRACTS.md.
// Owned by the module agent after the freeze; field changes are listed in its handoff.
import type { MatchMediaData, MediaContentType, MediaFileData, MediaFilePurpose } from './media.js';

export type MediaRequestOperation = 'MATCH_FILE_UPLOAD' | 'MATCH_MEDIA_CREATE';
export type MatchMediaFilePurpose = Extract<MediaFilePurpose, 'MATCH_IMAGE' | 'MATCH_VIDEO'>;
export type MatchMediaContentType = Exclude<MediaContentType, 'application/pdf'>;

/**
 * Fingerprint: sha256(JSON.stringify(["v1", operation, ...fields])) over the values the server
 * writes. Strings are NFC-normalized, then trimmed (new endpoints only).
 * MATCH_FILE_UPLOAD fields: purpose, fileName, contentType, byteLength, contentSha256.
 * MATCH_MEDIA_CREATE fields: kind, title, fileId|null, externalUrl|null, rightsDeclaration.
 */
export interface MediaFileRequestInput {
  /** Lowercase UUID v4, kept for the request's whole life. */
  clientRequestId: string;
  purpose: MatchMediaFilePurpose;
  fileName: string;
  contentType: MatchMediaContentType;
  byteLength: number;
  /** Lowercase hex SHA-256 of the complete file. */
  contentSha256: string;
  contentBase64: string;
}
export interface MediaRequestInput {
  clientRequestId: string;
  kind: 'IMAGE' | 'VIDEO' | 'EXTERNAL_LINK';
  title: string;
  fileId?: string;
  /** Must already equal its canonical href (lowercase host, no characters needing escapes). */
  externalUrl?: string;
  rightsDeclaration: string;
}

export type UploadSessionStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
export interface UploadSessionChunkData {
  index: number;
  byteLength: number;
  sha256: string;
}
export interface UploadSessionData {
  id: string;
  clientRequestId: string;
  /** OPEN past expiresAt reads as EXPIRED; cleanup records it later. */
  status: UploadSessionStatus;
  purpose: MatchMediaFilePurpose;
  fileName: string;
  contentType: MatchMediaContentType;
  byteLength: number;
  contentSha256: string;
  chunkSize: 524288;
  chunkCount: number;
  /** Bytes the server has durably confirmed for this session. */
  receivedBytes: number;
  /** Confirmed chunks of an OPEN session; empty once released (completed/cancelled/expired). */
  chunks: UploadSessionChunkData[];
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
  /** Current file state once completed. */
  file: MediaFileData | null;
}
export interface UploadSessionInput {
  clientRequestId: string;
  purpose: MatchMediaFilePurpose;
  fileName: string;
  contentType: MatchMediaContentType;
  byteLength: number;
  contentSha256: string;
}
export interface UploadChunkInput {
  byteLength: number;
  sha256: string;
  contentBase64: string;
}

export type MediaFileReceiptData =
  { state: 'FILE'; file: MediaFileData } | { state: 'SESSION'; session: UploadSessionData };
export interface MediaRequestReceiptData {
  state: 'MEDIA';
  media: MatchMediaData;
}
