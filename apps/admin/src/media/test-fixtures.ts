import type {
  EntryFilesData,
  MatchMediaWorkspaceData,
  MediaFileData,
  PublicMatchMediaData,
} from '@small-city-basketball/contracts';
export const file: MediaFileData = {
  id: 'file-a',
  purpose: 'MATCH_VIDEO',
  rosterRevisionId: null,
  fileName: 'synthetic.mp4',
  contentType: 'video/mp4',
  byteLength: 1708,
  sha256: 'a'.repeat(64),
  version: 1,
  status: 'ACTIVE',
  createdAt: '2026-10-24T00:00:00Z',
  revokedAt: null,
  purgedAt: null,
};
const usage = { usedBytes: 1708, limitBytes: 134217728 as const, maxFileBytes: 8388608 as const };
export const entry: EntryFilesData = {
  entryId: 'entry-a',
  entryVersion: 4,
  rosterRevisionId: 'roster-a',
  files: [],
  usage,
  capabilities: { canUpload: true, canRevoke: true, canPurge: true },
};
export const workspace: MatchMediaWorkspaceData = {
  matchId: 'match-a',
  eventId: 'event-a',
  matchStatus: 'FINAL',
  matchVersion: 8,
  currentConfirmationId: 'confirmation-a',
  files: [file],
  media: [
    {
      id: 'media-a',
      kind: 'VIDEO',
      title: '合成回放',
      fileId: file.id,
      externalUrl: null,
      rightsDeclaration: '合成生成且有权公开',
      status: 'DRAFT',
      version: 1,
      createdAt: file.createdAt,
      markers: [],
    },
  ],
  sourceEvents: [
    { id: 'event-point-a', seq: 3, type: 'STAT_RECORDED', serverTime: file.createdAt },
  ],
  trustedExternalHosts: [],
  usage,
  capabilities: {
    canUpload: true,
    canManage: true,
    canPublish: true,
    canMark: true,
    canPurge: true,
  },
};
export const publicMedia: PublicMatchMediaData = {
  publicEventId: 'p'.repeat(43),
  publicMatchId: 'm'.repeat(43),
  media: [
    {
      publicMediaId: 'v'.repeat(43),
      kind: 'VIDEO',
      title: '已公开合成回放',
      contentPath: `/v1/public/events/${'p'.repeat(43)}/matches/${'m'.repeat(43)}/media/${'v'.repeat(43)}/content`,
      contentType: 'video/mp4',
      externalUrl: null,
      externalNotice: null,
      markers: [
        { publicMarkerId: 'k'.repeat(43), label: '人工得分定位', startMs: 100, endMs: 750 },
      ],
    },
  ],
};
