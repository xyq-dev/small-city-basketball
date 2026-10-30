import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  EntryFilesData,
  MatchMediaData,
  MatchMediaWorkspaceData,
  MediaFileData,
  MediaMarkerData,
  MediaStorageUsage,
  PublicMatchMediaData,
} from '@small-city-basketball/contracts';
import type { Actor, ApiOptions, OrgActor } from './service.js';
import { isAdministrator } from './service.js';
import { StandingsService } from './standings-service.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { invalid, objectInput, resourceId, text } from './validation.js';
import { expectedVersion } from './registration-validation.js';
import { confirmedPlayerStatistics } from './confirmed-player-statistics.js';
import {
  MAX_MEDIA_FILE_BYTES,
  MEDIA_ORG_LIMIT_BYTES,
  mediaRange,
  parseMediaUpload,
  trustedExternalUrl,
} from './media-domain.js';
type Row = Record<string, any>;
type FileContext = Actor & { orgId: string; role: string | null };
export type MediaAccess = {
  ctx: FileContext;
  row: Row;
  event: Row;
  manager: boolean;
  manage: boolean;
  scope: 'ENTRY' | 'MATCH';
};
type Access = MediaAccess;
const iso = (v: Date) => v.toISOString();
const active = (event: Row) => !['ARCHIVED', 'CANCELLED'].includes(event.status);
const version = (actual: number, expected: unknown) => {
  if (actual !== expectedVersion(expected))
    throw new ApiError(409, 'VERSION_CONFLICT', '资料已更新，请重新读取后核对再操作');
};
const FILE_SELECT =
  'id,purpose,roster_revision_id,file_name,content_type,byte_length,sha256,version,created_at,revoked_at,purged_at';
export class MediaService extends StandingsService {
  readonly trustedExternalHosts: string[];
  constructor(
    pool: Pool,
    options: ApiOptions,
    mediaOptions: { trustedExternalHosts?: string[] } = {},
  ) {
    super(pool, options);
    const hosts = mediaOptions.trustedExternalHosts ?? [];
    if (
      hosts.length > 20 ||
      hosts.some(
        (h) =>
          !/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(h) ||
          h === 'localhost' ||
          h.endsWith('.localhost'),
      )
    )
      throw new Error('Invalid trusted media hosts');
    this.trustedExternalHosts = [...new Set(hosts)];
  }
  protected async fileContext(
    c: PoolClient,
    cookie: string | undefined,
    org: string,
    exclusive = false,
  ): Promise<FileContext> {
    const actor = await this.lockActor(c, cookie);
    const orgId = resourceId(org);
    // Take UPDATE directly before any event/match locks; never upgrade concurrent SHARE holders.
    const o = await c.query(
      `SELECT id FROM organizations WHERE id=$1 AND status='ACTIVE' FOR ${exclusive ? 'UPDATE' : 'SHARE'}`,
      [orgId],
    );
    if (!o.rowCount) throw notFound();
    const membership = await c.query(
      'SELECT role,status FROM organization_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE',
      [orgId, actor.user.id],
    );
    return {
      ...actor,
      orgId,
      role: membership.rows[0]?.status === 'ACTIVE' ? membership.rows[0].role : null,
    };
  }
  protected async access(
    c: PoolClient,
    ctx: FileContext,
    id: string,
    scope: 'ENTRY' | 'MATCH',
    writing = false,
  ): Promise<Access> {
    const routing = await c.query(
      `SELECT event_id${scope === 'ENTRY' ? ',team_id' : ''} FROM ${scope === 'ENTRY' ? 'entries' : 'published_matches'} WHERE org_id=$1 AND id=$2`,
      [ctx.orgId, resourceId(id)],
    );
    if (!routing.rows[0]) throw notFound();
    const event = (
      await c.query('SELECT * FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
        ctx.orgId,
        routing.rows[0].event_id,
      ])
    ).rows[0];
    if (!event) throw notFound();
    const staff = (
      await c.query(
        "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
        [ctx.orgId, event.id, ctx.user.id],
      )
    ).rows[0];
    const manager =
      Boolean(ctx.role && isAdministrator(ctx.role as OrgActor['role'])) ||
      staff?.role === 'EVENT_MANAGER';
    let manage = manager,
      read = manager;
    if (scope === 'ENTRY') {
      const grant = await c.query(
        "SELECT team_id FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
        [ctx.orgId, routing.rows[0].team_id, ctx.user.id],
      );
      manage = manager || Boolean(grant.rowCount);
      read = manage || staff?.role === 'REVIEWER';
    } else {
      manage = manager || staff?.role === 'STREAMER';
      read = manage;
    }
    if (!read) throw notFound();
    const row = (
      await c.query(
        `SELECT * FROM ${scope === 'ENTRY' ? 'entries' : 'published_matches'} WHERE org_id=$1 AND event_id=$2 AND id=$3 FOR ${writing ? 'UPDATE' : 'SHARE'}`,
        [ctx.orgId, event.id, id],
      )
    ).rows[0];
    if (!row) throw notFound();
    return { ctx, row, event, manager, manage, scope };
  }
  protected fileDto(r: Row): MediaFileData {
    return {
      id: r.id,
      purpose: r.purpose,
      rosterRevisionId: r.roster_revision_id ?? null,
      fileName: r.file_name,
      contentType: r.content_type,
      byteLength: r.byte_length,
      sha256: r.sha256,
      version: r.version,
      status: r.purged_at ? 'PURGED' : r.revoked_at ? 'REVOKED' : 'ACTIVE',
      createdAt: iso(r.created_at),
      revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
      purgedAt: r.purged_at ? iso(r.purged_at) : null,
    };
  }
  /** C19: OPEN, unexpired upload sessions reserve their declared bytes and one file slot. */
  protected async reservations(c: PoolClient, org: string, matchId: string | null) {
    const r = (
      await c.query(
        "SELECT count(*)::int AS sessions,count(*) FILTER(WHERE match_id=$2)::int AS scoped,COALESCE(sum(byte_length),0)::int AS bytes FROM media_upload_sessions WHERE org_id=$1 AND status='OPEN' AND expires_at>now()",
        [org, matchId],
      )
    ).rows[0];
    return { sessions: r.sessions as number, scoped: r.scoped as number, bytes: r.bytes as number };
  }
  protected async usage(c: PoolClient, org: string): Promise<MediaStorageUsage> {
    const used = (
      await c.query(
        `SELECT (COALESCE((SELECT sum(byte_length) FROM media_files WHERE org_id=$1 AND payload IS NOT NULL),0) + COALESCE((SELECT sum(payload_byte_length) FROM participant_material_revisions WHERE org_id=$1 AND payload_ciphertext IS NOT NULL),0))::int AS used`,
        [org],
      )
    ).rows[0].used;
    return {
      usedBytes: used,
      limitBytes: MEDIA_ORG_LIMIT_BYTES,
      maxFileBytes: MAX_MEDIA_FILE_BYTES,
    };
  }
  private async files(c: PoolClient, a: Access) {
    return (
      await c.query(
        `SELECT ${FILE_SELECT} FROM media_files WHERE org_id=$1 AND ${a.scope === 'ENTRY' ? 'entry_id' : 'match_id'}=$2 ORDER BY created_at,id LIMIT 100`,
        [a.ctx.orgId, a.row.id],
      )
    ).rows.map((r) => this.fileDto(r));
  }
  async getEntryFiles(
    cookie: string | undefined,
    org: string,
    id: string,
  ): Promise<EntryFilesData> {
    return this.transaction(async (c) => {
      const a = await this.access(c, await this.fileContext(c, cookie, org), id, 'ENTRY');
      await this.ensureFreshSession(c, a.ctx);
      return {
        entryId: id,
        entryVersion: a.row.version,
        rosterRevisionId: a.row.roster_revision_id,
        files: await this.files(c, a),
        usage: await this.usage(c, org),
        capabilities: {
          canUpload: a.manage && active(a.event),
          canRevoke: a.manage,
          canPurge: a.manage,
        },
      };
    });
  }
  async upload(
    cookie: string | undefined,
    org: string,
    id: string,
    scope: 'ENTRY' | 'MATCH',
    raw: unknown,
  ): Promise<MediaFileData> {
    const input = parseMediaUpload(raw, scope);
    return this.transaction(async (c) => {
      const a = await this.access(c, await this.fileContext(c, cookie, org, true), id, scope);
      if (!a.manage) throw forbidden();
      if (!active(a.event))
        throw new ApiError(409, 'INVALID_EVENT_STATE', '归档或取消赛事不能上传新资料');
      if (scope === 'ENTRY') version(a.row.version, input.expectedEntryVersion);
      const counts = (
        await c.query(
          `SELECT count(*)::int AS total,count(*) FILTER(WHERE purged_at IS NULL)::int AS retained,count(*) FILTER(WHERE ${scope === 'ENTRY' ? 'entry_id' : 'match_id'}=$2 AND purged_at IS NULL)::int AS scoped FROM media_files WHERE org_id=$1`,
          [org, id],
        )
      ).rows[0];
      // C19: open upload sessions hold file slots and bytes until they complete or close.
      const reserved = await this.reservations(c, org, scope === 'MATCH' ? id : null);
      if (
        counts.total + reserved.sessions >= 4096 ||
        counts.retained + reserved.sessions >= 512 ||
        counts.scoped + reserved.scoped >= 100
      )
        throw new ApiError(409, 'MEDIA_FILE_LIMIT', '文件数量已达上限，请先整理资料');
      if (
        (await this.usage(c, org)).usedBytes + reserved.bytes + input.payload.length >
        MEDIA_ORG_LIMIT_BYTES
      )
        throw new ApiError(
          409,
          'MEDIA_STORAGE_LIMIT',
          '机构文件额度不足，撤销后明确清除旧内容方可释放额度',
        );
      await this.ensureFreshSession(c, a.ctx);
      const fileId = randomUUID();
      const r = (
        await c.query(
          `INSERT INTO media_files(id,org_id,event_id,entry_id,match_id,roster_revision_id,purpose,file_name,content_type,byte_length,sha256,payload,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${FILE_SELECT}`,
          [
            fileId,
            org,
            a.event.id,
            scope === 'ENTRY' ? id : null,
            scope === 'MATCH' ? id : null,
            scope === 'ENTRY' ? a.row.roster_revision_id : null,
            input.purpose,
            input.fileName,
            input.contentType,
            input.payload.length,
            input.sha256,
            input.payload,
            a.ctx.user.id,
          ],
        )
      ).rows[0];
      await this.audit(c, a.ctx.user.id, org, 'media.file.uploaded', 'media_file', fileId, {
        purpose: input.purpose,
        byteLength: input.payload.length,
        sha256: input.sha256,
      });
      return this.fileDto(r);
    });
  }
  async fileCommand(
    cookie: string | undefined,
    org: string,
    id: string,
    scope: 'ENTRY' | 'MATCH',
    fileId: string,
    raw: unknown,
  ): Promise<MediaFileData> {
    const input = objectInput(raw, ['type', 'expectedVersion', 'reason']);
    if (!['REVOKE', 'PURGE'].includes(String(input.type))) invalid('不支持的文件操作');
    const reason = text(input.reason, 'reason', 4, 500);
    return this.transaction(async (c) => {
      const a = await this.access(c, await this.fileContext(c, cookie, org, true), id, scope);
      if (!a.manage) throw forbidden();
      const f = (
        await c.query(
          `SELECT ${FILE_SELECT} FROM media_files WHERE org_id=$1 AND ${scope === 'ENTRY' ? 'entry_id' : 'match_id'}=$2 AND id=$3 FOR UPDATE`,
          [org, id, resourceId(fileId)],
        )
      ).rows[0];
      if (!f) throw notFound();
      version(f.version, input.expectedVersion);
      if (
        f.purged_at ||
        (input.type === 'REVOKE' && f.revoked_at) ||
        (input.type === 'PURGE' && !f.revoked_at)
      )
        throw new ApiError(
          409,
          'INVALID_FILE_STATE',
          '请先撤销有效文件，再明确清除内容；原文件不会复活',
        );
      await this.ensureFreshSession(c, a.ctx);
      const r = (
        await c.query(
          `UPDATE media_files SET version=version+1,${input.type === 'REVOKE' ? 'revoked_at=clock_timestamp(),revoked_by=$3' : 'purged_at=clock_timestamp(),purged_by=$3,payload=NULL'} WHERE org_id=$1 AND id=$2 RETURNING ${FILE_SELECT}`,
          [org, fileId, a.ctx.user.id],
        )
      ).rows[0];
      await this.audit(
        c,
        a.ctx.user.id,
        org,
        `media.file.${String(input.type).toLowerCase()}`,
        'media_file',
        fileId,
        { reason },
      );
      return this.fileDto(r);
    });
  }
  private async confirmation(c: PoolClient, org: string, event: string, match: string) {
    const r = (await this.matches(c, org, event)).find((m) => m.id === match);
    if (!r || r.status !== 'FINAL') return null;
    confirmedPlayerStatistics(r);
    return {
      id: r.confirmation.id as string,
      version: r.confirmation.source_match_version as number,
      lastSeq: r.confirmation.last_event_seq as number,
    };
  }
  protected async safeConfirmation(c: PoolClient, org: string, event: string, match: string) {
    try {
      return await this.confirmation(c, org, event, match);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RESULT_SOURCE_INVALID') return null;
      throw error;
    }
  }
  private markerDto(r: Row, current: string | null): MediaMarkerData {
    return {
      id: r.id,
      label: r.label,
      startMs: r.start_ms,
      endMs: r.end_ms,
      sourceEventId: r.source_event_id,
      sourceSeq: r.source_seq,
      confirmationId: r.confirmation_id,
      sourceMatchVersion: r.source_match_version,
      sourceStatus: current === r.confirmation_id ? 'CURRENT' : 'STALE',
    };
  }
  protected async itemDto(c: PoolClient, r: Row, current: string | null): Promise<MatchMediaData> {
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      fileId: r.file_id,
      externalUrl: r.external_url,
      rightsDeclaration: r.rights_declaration,
      status: r.status,
      version: r.version,
      createdAt: iso(r.created_at),
      markers: (
        await c.query(
          'SELECT * FROM media_markers WHERE org_id=$1 AND media_id=$2 ORDER BY start_ms,id LIMIT 250',
          [r.org_id, r.id],
        )
      ).rows.map((m) => this.markerDto(m, current)),
    };
  }
  async getMatchMedia(
    cookie: string | undefined,
    org: string,
    id: string,
  ): Promise<MatchMediaWorkspaceData> {
    return this.transaction(async (c) => {
      const a = await this.access(c, await this.fileContext(c, cookie, org), id, 'MATCH');
      const cf = await this.safeConfirmation(c, org, a.event.id, id);
      const items = (
        await c.query(
          'SELECT * FROM match_media WHERE org_id=$1 AND match_id=$2 ORDER BY created_at,id LIMIT 50',
          [org, id],
        )
      ).rows;
      const sourceEvents = cf
        ? (
            await c.query(
              "SELECT e.id,e.seq,e.type,e.server_time FROM scoring_events e WHERE e.org_id=$1 AND e.match_id=$2 AND e.seq<=$3 AND NOT EXISTS(SELECT 1 FROM scoring_events v WHERE v.org_id=e.org_id AND v.match_id=e.match_id AND v.target_event_id=e.id AND v.type='STAT_VOIDED') ORDER BY e.seq LIMIT 500",
              [org, id, cf.lastSeq],
            )
          ).rows.map((e) => ({
            id: e.id,
            seq: e.seq,
            type: e.type,
            serverTime: iso(e.server_time),
          }))
        : [];
      await this.ensureFreshSession(c, a.ctx);
      return {
        matchId: id,
        eventId: a.event.id,
        matchStatus: a.row.status,
        matchVersion: a.row.version,
        currentConfirmationId: cf?.id ?? null,
        files: await this.files(c, a),
        media: await Promise.all(items.map((r) => this.itemDto(c, r, cf?.id ?? null))),
        sourceEvents,
        trustedExternalHosts: this.trustedExternalHosts,
        usage: await this.usage(c, org),
        capabilities: {
          canUpload: a.manage && active(a.event),
          canManage: a.manage && active(a.event),
          canPublish: a.manager && active(a.event),
          canMark: a.manage && active(a.event) && Boolean(cf),
          canPurge: a.manage,
        },
      };
    });
  }
  async createMedia(
    cookie: string | undefined,
    org: string,
    id: string,
    raw: unknown,
  ): Promise<MatchMediaData> {
    const input = objectInput(raw, ['kind', 'title', 'fileId', 'externalUrl', 'rightsDeclaration']);
    const title = text(input.title, 'title', 1, 120),
      rights = text(input.rightsDeclaration, 'rightsDeclaration', 4, 500);
    if (!['IMAGE', 'VIDEO', 'EXTERNAL_LINK'].includes(String(input.kind)))
      invalid('不支持的媒体类型');
    const external =
      input.kind === 'EXTERNAL_LINK'
        ? trustedExternalUrl(input.externalUrl, this.trustedExternalHosts)
        : null;
    if ((external && input.fileId !== undefined) || (!external && input.externalUrl !== undefined))
      invalid('媒体文件与外部链接不能混用');
    const fileId = external
      ? null
      : resourceId(typeof input.fileId === 'string' ? input.fileId : '');
    return this.transaction(async (c) => {
      const a = await this.access(c, await this.fileContext(c, cookie, org), id, 'MATCH', true);
      if (!a.manage) throw forbidden();
      if (!active(a.event))
        throw new ApiError(409, 'INVALID_EVENT_STATE', '归档或取消赛事不可创建媒体');
      // Serialize media count and IDs with a match lock after the established event lock.
      await c.query('SELECT id FROM published_matches WHERE org_id=$1 AND id=$2 FOR UPDATE', [
        org,
        id,
      ]);
      if (
        (await c.query('SELECT id FROM match_media WHERE org_id=$1 AND match_id=$2', [org, id]))
          .rowCount! >= 50
      )
        throw new ApiError(409, 'MEDIA_LIMIT', '本场媒体记录已达50条上限');
      if (fileId) {
        const f = (
          await c.query(
            'SELECT purpose FROM media_files WHERE org_id=$1 AND event_id=$2 AND match_id=$3 AND id=$4 AND revoked_at IS NULL AND purged_at IS NULL FOR SHARE',
            [org, a.event.id, id, fileId],
          )
        ).rows[0];
        if (!f) throw notFound();
        if (f.purpose !== (input.kind === 'IMAGE' ? 'MATCH_IMAGE' : 'MATCH_VIDEO'))
          invalid('禁止将私有凭证或不匹配文件发布为媒体');
      }
      await this.ensureFreshSession(c, a.ctx);
      const r = (
        await c.query(
          'INSERT INTO match_media(id,org_id,event_id,match_id,kind,file_id,external_url,title,rights_declaration,public_media_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
          [
            randomUUID(),
            org,
            a.event.id,
            id,
            input.kind,
            fileId,
            external,
            title,
            rights,
            randomBytes(32).toString('base64url'),
            a.ctx.user.id,
          ],
        )
      ).rows[0];
      await this.audit(c, a.ctx.user.id, org, 'media.draft.created', 'match_media', r.id);
      return this.itemDto(c, r, (await this.safeConfirmation(c, org, a.event.id, id))?.id ?? null);
    });
  }
  async mediaCommand(
    cookie: string | undefined,
    org: string,
    id: string,
    mediaId: string,
    raw: unknown,
  ): Promise<MatchMediaData> {
    const input = objectInput(raw, ['type', 'expectedVersion']);
    if (!['PUBLISH', 'REVOKE'].includes(String(input.type))) invalid('不支持的媒体操作');
    return this.transaction(async (c) => {
      const a = await this.access(c, await this.fileContext(c, cookie, org), id, 'MATCH', true);
      if (!a.manage || (input.type === 'PUBLISH' && !a.manager)) throw forbidden();
      const r = (
        await c.query(
          'SELECT * FROM match_media WHERE org_id=$1 AND match_id=$2 AND id=$3 FOR UPDATE',
          [org, id, resourceId(mediaId)],
        )
      ).rows[0];
      if (!r) throw notFound();
      version(r.version, input.expectedVersion);
      if (
        r.status === 'REVOKED' ||
        (input.type === 'PUBLISH' && (r.status !== 'DRAFT' || !active(a.event)))
      )
        throw new ApiError(409, 'INVALID_MEDIA_STATE', '媒体发布状态已变化，请重新读取');
      const cf = input.type === 'REVOKE' ? null : await this.confirmation(c, org, a.event.id, id);
      if (input.type === 'PUBLISH') {
        const stale = await c.query(
          'SELECT id FROM media_markers WHERE org_id=$1 AND media_id=$2 AND confirmation_id IS DISTINCT FROM $3::uuid LIMIT 1',
          [org, mediaId, cf?.id ?? null],
        );
        if (stale.rowCount)
          throw new ApiError(
            409,
            'MEDIA_SOURCE_STALE',
            '赛果确认已变化，请基于新确认重新建立媒体标记',
          );
      }
      await this.ensureFreshSession(c, a.ctx);
      const updated = (
        await c.query(
          'UPDATE match_media SET status=$3,version=version+1 WHERE org_id=$1 AND id=$2 RETURNING *',
          [org, mediaId, input.type === 'PUBLISH' ? 'PUBLISHED' : 'REVOKED'],
        )
      ).rows[0];
      await this.audit(
        c,
        a.ctx.user.id,
        org,
        `media.${String(input.type).toLowerCase()}`,
        'match_media',
        mediaId,
      );
      return this.itemDto(c, updated, cf?.id ?? null);
    });
  }
  async createMarker(
    cookie: string | undefined,
    org: string,
    id: string,
    mediaId: string,
    raw: unknown,
  ): Promise<MediaMarkerData> {
    const i = objectInput(raw, [
      'expectedVersion',
      'expectedConfirmationId',
      'sourceEventId',
      'label',
      'startMs',
      'endMs',
    ]);
    const label = text(i.label, 'label', 1, 120);
    if (
      !Number.isSafeInteger(i.startMs) ||
      !Number.isSafeInteger(i.endMs) ||
      Number(i.startMs) < 0 ||
      Number(i.endMs) <= Number(i.startMs) ||
      Number(i.endMs) > 86400000
    )
      invalid('片段起止须为0至24小时内的有效毫秒位置');
    return this.transaction(async (c) => {
      const a = await this.access(c, await this.fileContext(c, cookie, org), id, 'MATCH', true);
      if (!a.manage) throw forbidden();
      if (!active(a.event))
        throw new ApiError(409, 'INVALID_EVENT_STATE', '当前赛事不可新增媒体标记');
      const r = (
        await c.query(
          'SELECT * FROM match_media WHERE org_id=$1 AND match_id=$2 AND id=$3 FOR UPDATE',
          [org, id, resourceId(mediaId)],
        )
      ).rows[0];
      if (!r) throw notFound();
      version(r.version, i.expectedVersion);
      if (r.kind !== 'VIDEO' || r.status !== 'DRAFT')
        throw new ApiError(409, 'INVALID_MEDIA_STATE', '仅私有视频草稿可以建立人工对时标记');
      const cf = await this.confirmation(c, org, a.event.id, id);
      if (!cf || cf.id !== i.expectedConfirmationId)
        throw new ApiError(409, 'MEDIA_SOURCE_STALE', '当前赛果尚未有效独立确认或已变化');
      const se = (
        await c.query(
          "SELECT e.id,e.seq FROM scoring_events e WHERE e.org_id=$1 AND e.match_id=$2 AND e.id=$3 AND e.seq<=$4 AND NOT EXISTS(SELECT 1 FROM scoring_events v WHERE v.org_id=e.org_id AND v.match_id=e.match_id AND v.target_event_id=e.id AND v.type='STAT_VOIDED')",
          [org, id, resourceId(String(i.sourceEventId ?? '')), cf.lastSeq],
        )
      ).rows[0];
      if (!se) throw notFound();
      if (
        (
          await c.query('SELECT id FROM media_markers WHERE org_id=$1 AND media_id=$2', [
            org,
            mediaId,
          ])
        ).rowCount! >= 250
      )
        throw new ApiError(409, 'MEDIA_MARKER_LIMIT', '本媒体标记已达250条上限');
      await this.ensureFreshSession(c, a.ctx);
      const m = (
        await c.query(
          'INSERT INTO media_markers(id,org_id,event_id,match_id,media_id,public_marker_id,source_event_id,source_seq,confirmation_id,source_match_version,label,start_ms,end_ms,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',
          [
            randomUUID(),
            org,
            a.event.id,
            id,
            mediaId,
            randomBytes(32).toString('base64url'),
            se.id,
            se.seq,
            cf.id,
            cf.version,
            label,
            i.startMs,
            i.endMs,
            a.ctx.user.id,
          ],
        )
      ).rows[0];
      await c.query('UPDATE match_media SET version=version+1 WHERE org_id=$1 AND id=$2', [
        org,
        mediaId,
      ]);
      await this.audit(c, a.ctx.user.id, org, 'media.marker.created', 'media_marker', m.id, {
        sourceSeq: se.seq,
      });
      return this.markerDto(m, cf.id);
    });
  }
  private async publicMatchAccess(c: PoolClient, eventKey: string, matchKey: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(matchKey)) throw notFound();
    const a = await this.publicAccess(c, eventKey);
    const m = (
      await c.query(
        'SELECT m.* FROM public_match_links l JOIN published_matches m ON m.org_id=l.org_id AND m.event_id=l.event_id AND m.id=l.match_id WHERE l.org_id=$1 AND l.event_id=$2 AND l.publication_id=$3 AND l.public_match_id=$4 FOR SHARE OF m',
        [a.event.org_id, a.event.id, a.pub.id, matchKey],
      )
    ).rows[0];
    if (!m) throw notFound();
    return { ...a, match: m };
  }
  async getPublicMedia(eventKey: string, matchKey: string): Promise<PublicMatchMediaData> {
    return this.transaction(async (c) => {
      const a = await this.publicMatchAccess(c, eventKey, matchKey),
        org = a.event.org_id;
      const cf = await this.confirmation(c, org, a.event.id, a.match.id);
      const rows = (
        await c.query(
          "SELECT mm.*,f.content_type FROM match_media mm LEFT JOIN media_files f ON f.org_id=mm.org_id AND f.match_id=mm.match_id AND f.id=mm.file_id WHERE mm.org_id=$1 AND mm.match_id=$2 AND mm.status='PUBLISHED' AND (mm.kind='EXTERNAL_LINK' OR (f.revoked_at IS NULL AND f.purged_at IS NULL AND f.payload IS NOT NULL AND f.purpose IN ('MATCH_IMAGE','MATCH_VIDEO'))) ORDER BY mm.created_at,mm.id LIMIT 50",
          [org, a.match.id],
        )
      ).rows;
      const media: PublicMatchMediaData['media'] = [];
      for (const r of rows) {
        const markers = cf
          ? (
              await c.query(
                'SELECT public_marker_id,label,start_ms,end_ms FROM media_markers WHERE org_id=$1 AND media_id=$2 AND confirmation_id=$3 ORDER BY start_ms,id LIMIT 250',
                [org, r.id, cf.id],
              )
            ).rows
          : [];
        media.push({
          publicMediaId: r.public_media_id,
          kind: r.kind,
          title: r.title,
          contentPath: r.file_id
            ? `/v1/public/events/${encodeURIComponent(eventKey)}/matches/${encodeURIComponent(matchKey)}/media/${r.public_media_id}/content`
            : null,
          contentType: r.content_type ?? null,
          externalUrl: r.external_url,
          externalNotice:
            r.kind === 'EXTERNAL_LINK'
              ? '原本公开的外部资源；本站不抓取或控制第三方源，已经获知的第三方地址不能由本站撤回。'
              : null,
          markers: markers.map((m) => ({
            publicMarkerId: m.public_marker_id,
            label: m.label,
            startMs: m.start_ms,
            endMs: m.end_ms,
          })),
        });
      }
      return { publicEventId: eventKey, publicMatchId: matchKey, media };
    });
  }
  private binary(r: Row, range: string | undefined, privateFile: boolean) {
    if (r.revoked_at || r.purged_at || !Buffer.isBuffer(r.payload)) throw notFound();
    const selected = mediaRange(range, r.payload.length);
    return {
      body: r.payload.subarray(selected.start, selected.end + 1) as Buffer,
      contentType: r.content_type as string,
      fileName: privateFile
        ? (r.file_name as string)
        : `media.${r.content_type === 'video/mp4' ? 'mp4' : r.content_type === 'image/png' ? 'png' : 'jpg'}`,
      attachment: privateFile,
      status: selected.partial ? 206 : 200,
      contentRange: selected.partial
        ? `bytes ${selected.start}-${selected.end}/${r.payload.length}`
        : null,
      totalLength: r.payload.length as number,
    };
  }
  async getPrivateContent(
    cookie: string | undefined,
    org: string,
    id: string,
    scope: 'ENTRY' | 'MATCH',
    fileId: string,
    range?: string,
  ) {
    return this.transaction(async (c) => {
      const a = await this.access(c, await this.fileContext(c, cookie, org), id, scope);
      const r = (
        await c.query(
          `SELECT file_name,content_type,payload,revoked_at,purged_at FROM media_files WHERE org_id=$1 AND ${scope === 'ENTRY' ? 'entry_id' : 'match_id'}=$2 AND id=$3 FOR SHARE`,
          [org, id, resourceId(fileId)],
        )
      ).rows[0];
      if (!r) throw notFound();
      await this.ensureFreshSession(c, a.ctx);
      return this.binary(r, range, scope === 'ENTRY');
    });
  }
  async getPublicContent(eventKey: string, matchKey: string, mediaKey: string, range?: string) {
    return this.transaction(async (c) => {
      if (!/^[A-Za-z0-9_-]{43}$/.test(mediaKey)) throw notFound();
      const a = await this.publicMatchAccess(c, eventKey, matchKey);
      const r = (
        await c.query(
          "SELECT f.file_name,f.content_type,f.payload,f.revoked_at,f.purged_at FROM match_media mm JOIN media_files f ON f.org_id=mm.org_id AND f.match_id=mm.match_id AND f.id=mm.file_id WHERE mm.org_id=$1 AND mm.match_id=$2 AND mm.public_media_id=$3 AND mm.status='PUBLISHED' AND f.purpose IN ('MATCH_IMAGE','MATCH_VIDEO') FOR SHARE OF mm,f",
          [a.event.org_id, a.match.id, mediaKey],
        )
      ).rows[0];
      if (!r) throw notFound();
      return this.binary(r, range, false);
    });
  }
}
