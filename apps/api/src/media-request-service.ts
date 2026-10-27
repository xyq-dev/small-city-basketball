import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  MatchMediaData,
  MediaFileData,
  MediaFileReceiptData,
  MediaRequestReceiptData,
  UploadSessionData,
} from '@small-city-basketball/contracts';
import { MediaService } from './media-service.js';
import type { MediaAccess } from './media-service.js';
import type { ApiOptions } from './service.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { invalid, resourceId } from './validation.js';
import { MEDIA_ORG_LIMIT_BYTES, parseMediaUpload, trustedExternalUrl } from './media-domain.js';
import {
  CHUNK_SIZE,
  CLEANUP_BATCH,
  MAX_OPEN_SESSIONS_PER_ORG,
  MAX_OPEN_SESSIONS_PER_USER,
  SESSION_TTL_HOURS,
  chunkIndex,
  expectedChunkLength,
  parseChunk,
  parseFileRequest,
  parseMediaRequest,
  parseSessionRequest,
} from './media-request-domain.js';
import type { MediaRequestOperation } from './media-request-domain.js';

type Row = Record<string, any>;
type MatchAccess = MediaAccess;
export type Created<T> = { created: boolean; data: T };
/** A concurrent request committed the same receipt first: roll back, then replay it. */
class ReceiptRace extends Error {}
const iso = (v: Date) => v.toISOString();
const active = (event: Row) => !['ARCHIVED', 'CANCELLED'].includes(event.status);
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FILE_COLUMNS =
  'id,purpose,roster_revision_id,file_name,content_type,byte_length,sha256,version,created_at,revoked_at,purged_at';
const SESSION_COLUMNS = '*,expires_at<=clock_timestamp() AS lapsed';
const conflict = () =>
  new ApiError(409, 'IDEMPOTENCY_CONFLICT', '该请求编号已用于不同内容，原请求不会被改写');
const closed = (message = '该请求编号对应的上传会话已取消或过期，编号不能再次使用') =>
  new ApiError(409, 'REQUEST_CLOSED', message);
const completedSession = () =>
  new ApiError(409, 'UPLOAD_SESSION_COMPLETED', '上传会话已完成并生成文件，不能再修改或取消');
const archived = () => new ApiError(409, 'INVALID_EVENT_STATE', '归档或取消赛事不能上传或创建媒体');
const noReceipt = () => new ApiError(404, 'RECEIPT_NOT_FOUND', '未找到该请求编号的回执');

/**
 * Bounded expiry of this module's own upload sessions: OPEN sessions past expires_at become
 * EXPIRED and their chunk payloads are nulled. Receipts, completed sessions and files are never
 * touched. Runs inside request transactions (same organization) and can be called by an
 * operator maintenance run with `orgId: null`; nothing runs it in the background.
 */
export async function expireMediaUploadSessions(
  db: Pool | PoolClient,
  orgId: string | null,
  limit = CLEANUP_BATCH,
): Promise<{ sessions: number; chunks: number }> {
  const bounded = Math.max(1, Math.min(Math.trunc(limit) || CLEANUP_BATCH, 500));
  const r = await db.query(
    `WITH due AS (
       SELECT org_id,id FROM media_upload_sessions
       WHERE status='OPEN' AND expires_at<=clock_timestamp() AND ($1::uuid IS NULL OR org_id=$1::uuid)
       ORDER BY expires_at,id LIMIT $2 FOR UPDATE SKIP LOCKED
     ), expired AS (
       UPDATE media_upload_sessions s SET status='EXPIRED',closed_at=clock_timestamp(),version=s.version+1
       FROM due WHERE s.org_id=due.org_id AND s.id=due.id RETURNING s.org_id,s.id
     ), released AS (
       UPDATE media_upload_chunks ch SET payload=NULL,released_at=clock_timestamp()
       FROM expired WHERE ch.org_id=expired.org_id AND ch.session_id=expired.id AND ch.payload IS NOT NULL
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM expired)::int AS sessions,(SELECT count(*) FROM released)::int AS chunks`,
    [orgId, bounded],
  );
  return { sessions: r.rows[0].sessions, chunks: r.rows[0].chunks };
}

/**
 * C19 §2: idempotent match media requests and bounded chunked upload sessions. Order in every
 * call: session -> organization -> event -> match permission (the existing media managers only)
 * -> receipt -> first-execution checks. Business rows, receipt, quota effect and audit share one
 * transaction; a lost receipt race rolls back and replays in a new transaction.
 */
export class MediaRequestService extends MediaService {
  constructor(
    pool: Pool,
    options: ApiOptions,
    mediaOptions: { trustedExternalHosts?: string[] } = {},
  ) {
    super(pool, options, mediaOptions);
  }

  private async once<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.transaction(work);
      } catch (error) {
        if (error instanceof ReceiptRace && attempt < 2) continue;
        throw error;
      }
    }
  }

  /** 404 when the match is invisible to the actor, 403 when visible but not a media manager. */
  private async matchAccess(
    c: PoolClient,
    cookie: string | undefined,
    org: string,
    match: string,
    exclusive: boolean,
    writing = false,
  ): Promise<MatchAccess> {
    const ctx = await this.fileContext(c, cookie, org, exclusive);
    const id = resourceId(match);
    let a: MatchAccess;
    try {
      a = await this.access(c, ctx, id, 'MATCH', writing);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        const visible = await c.query(
          'SELECT 1 FROM published_matches m WHERE m.org_id=$1 AND m.id=$2 AND ($3::boolean OR EXISTS(SELECT 1 FROM event_staff s WHERE s.org_id=m.org_id AND s.event_id=m.event_id AND s.user_id=$4))',
          [ctx.orgId, id, Boolean(ctx.role), ctx.user.id],
        );
        if (visible.rowCount) throw forbidden();
      }
      throw error;
    }
    if (!a.manage) throw forbidden();
    return a;
  }

  private async receipt(
    c: PoolClient,
    a: MatchAccess,
    operation: MediaRequestOperation,
    id: string,
    lock: boolean,
  ): Promise<Row | undefined> {
    return (
      await c.query(
        `SELECT * FROM media_request_receipts WHERE org_id=$1 AND actor_user_id=$2 AND match_id=$3 AND operation=$4 AND client_request_id=$5${lock ? ' FOR UPDATE' : ''}`,
        [a.ctx.orgId, a.ctx.user.id, a.row.id, operation, id],
      )
    ).rows[0];
  }

  private async insertReceipt(
    c: PoolClient,
    a: MatchAccess,
    operation: MediaRequestOperation,
    id: string,
    hash: string,
    result: { fileId?: string; mediaId?: string; sessionId?: string },
  ) {
    const r = await c.query(
      'INSERT INTO media_request_receipts(id,org_id,event_id,match_id,actor_user_id,operation,client_request_id,request_hash,result_file_id,result_media_id,upload_session_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (org_id,actor_user_id,match_id,operation,client_request_id) DO NOTHING RETURNING id',
      [
        randomUUID(),
        a.ctx.orgId,
        a.event.id,
        a.row.id,
        a.ctx.user.id,
        operation,
        id,
        hash,
        result.fileId ?? null,
        result.mediaId ?? null,
        result.sessionId ?? null,
      ],
    );
    if (!r.rowCount) throw new ReceiptRace();
  }

  private async fileById(c: PoolClient, org: string, id: string): Promise<MediaFileData> {
    const r = (
      await c.query(`SELECT ${FILE_COLUMNS} FROM media_files WHERE org_id=$1 AND id=$2`, [org, id])
    ).rows[0];
    if (!r) throw notFound();
    return this.fileDto(r);
  }

  private async sessionRow(c: PoolClient, org: string, id: string): Promise<Row> {
    const r = (
      await c.query(
        `SELECT ${SESSION_COLUMNS} FROM media_upload_sessions WHERE org_id=$1 AND id=$2`,
        [org, id],
      )
    ).rows[0];
    if (!r) throw notFound();
    return r;
  }

  /** Only the creator, and only while the creator still manages this match's media. */
  private async ownSession(c: PoolClient, a: MatchAccess, raw: string, lock: boolean) {
    const id = resourceId(raw);
    const r = (
      await c.query(
        `SELECT ${SESSION_COLUMNS} FROM media_upload_sessions WHERE org_id=$1 AND match_id=$2 AND id=$3 AND created_by=$4${lock ? ' FOR UPDATE' : ''}`,
        [a.ctx.orgId, a.row.id, id, a.ctx.user.id],
      )
    ).rows[0];
    if (!r) throw notFound();
    return r;
  }

  private async sessionDto(c: PoolClient, s: Row): Promise<UploadSessionData> {
    const open = s.status === 'OPEN' && !s.lapsed;
    const chunks = open
      ? (
          await c.query(
            'SELECT chunk_index,byte_length,sha256 FROM media_upload_chunks WHERE org_id=$1 AND session_id=$2 AND payload IS NOT NULL ORDER BY chunk_index',
            [s.org_id, s.id],
          )
        ).rows.map((r) => ({
          index: r.chunk_index as number,
          byteLength: r.byte_length as number,
          sha256: r.sha256 as string,
        }))
      : [];
    return {
      id: s.id,
      clientRequestId: s.client_request_id,
      status: open ? 'OPEN' : s.status === 'OPEN' ? 'EXPIRED' : s.status,
      purpose: s.purpose,
      fileName: s.file_name,
      contentType: s.content_type,
      byteLength: s.byte_length,
      contentSha256: s.sha256,
      chunkSize: CHUNK_SIZE,
      chunkCount: s.chunk_count,
      receivedBytes:
        s.status === 'COMPLETED' ? s.byte_length : chunks.reduce((n, ch) => n + ch.byteLength, 0),
      chunks,
      createdAt: iso(s.created_at),
      expiresAt: iso(s.expires_at),
      closedAt: s.closed_at ? iso(s.closed_at) : null,
      file: s.file_id ? await this.fileById(c, s.org_id, s.file_id) : null,
    };
  }

  /** File slots and bytes, counting OPEN unexpired session reservations. */
  private async ensureCapacity(c: PoolClient, org: string, match: string, bytes: number) {
    const counts = (
      await c.query(
        'SELECT count(*)::int AS total,count(*) FILTER(WHERE purged_at IS NULL)::int AS retained,count(*) FILTER(WHERE match_id=$2 AND purged_at IS NULL)::int AS scoped FROM media_files WHERE org_id=$1',
        [org, match],
      )
    ).rows[0];
    const reserved = await this.reservations(c, org, match);
    if (
      counts.total + reserved.sessions >= 4096 ||
      counts.retained + reserved.sessions >= 512 ||
      counts.scoped + reserved.scoped >= 100
    )
      throw new ApiError(409, 'MEDIA_FILE_LIMIT', '文件数量已达上限，请先整理资料');
    if ((await this.usage(c, org)).usedBytes + reserved.bytes + bytes > MEDIA_ORG_LIMIT_BYTES)
      throw new ApiError(
        409,
        'MEDIA_STORAGE_LIMIT',
        '机构文件额度不足（含进行中的上传预留），撤销后明确清除旧内容方可释放额度',
      );
  }

  private async releaseChunks(c: PoolClient, s: Row) {
    await c.query(
      'UPDATE media_upload_chunks SET payload=NULL,released_at=clock_timestamp() WHERE org_id=$1 AND session_id=$2 AND payload IS NOT NULL',
      [s.org_id, s.id],
    );
  }

  private async mediaById(c: PoolClient, a: MatchAccess, id: string): Promise<MatchMediaData> {
    const row = (
      await c.query('SELECT * FROM match_media WHERE org_id=$1 AND id=$2', [a.ctx.orgId, id])
    ).rows[0];
    if (!row) throw notFound();
    const current = await this.safeConfirmation(c, a.ctx.orgId, a.event.id, a.row.id);
    return this.itemDto(c, row, current?.id ?? null);
  }

  // ---------- B1: whole-file upload and draft creation with request identity ----------

  async uploadFileRequest(
    cookie: string | undefined,
    org: string,
    match: string,
    raw: unknown,
  ): Promise<Created<MediaFileData>> {
    const input = parseFileRequest(raw);
    return this.once(async (c) => {
      const a = await this.matchAccess(c, cookie, org, match, true);
      const orgId = a.ctx.orgId;
      const r = await this.receipt(c, a, 'MATCH_FILE_UPLOAD', input.clientRequestId, true);
      if (r) {
        if (r.request_hash !== input.fingerprint) throw conflict();
        await this.ensureFreshSession(c, a.ctx);
        if (r.result_file_id)
          return { created: false, data: await this.fileById(c, orgId, r.result_file_id) };
        const s = await this.sessionRow(c, orgId, r.upload_session_id);
        if (s.status === 'OPEN' && !s.lapsed)
          throw new ApiError(
            409,
            'UPLOAD_SESSION_ACTIVE',
            '该请求编号已有进行中的分片上传，请继续该会话',
            { sessionId: s.id },
          );
        throw closed();
      }
      if (!active(a.event)) throw archived();
      await expireMediaUploadSessions(c, orgId);
      await this.ensureCapacity(c, orgId, a.row.id, input.byteLength);
      await this.ensureFreshSession(c, a.ctx);
      const fileId = randomUUID();
      const row = (
        await c.query(
          `INSERT INTO media_files(id,org_id,event_id,match_id,purpose,file_name,content_type,byte_length,sha256,payload,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${FILE_COLUMNS}`,
          [
            fileId,
            orgId,
            a.event.id,
            a.row.id,
            input.purpose,
            input.fileName,
            input.contentType,
            input.byteLength,
            input.contentSha256,
            input.payload,
            a.ctx.user.id,
          ],
        )
      ).rows[0];
      await this.insertReceipt(
        c,
        a,
        'MATCH_FILE_UPLOAD',
        input.clientRequestId,
        input.fingerprint,
        { fileId },
      );
      await this.audit(c, a.ctx.user.id, orgId, 'media.file.uploaded', 'media_file', fileId, {
        purpose: input.purpose,
        byteLength: input.byteLength,
        sha256: input.contentSha256,
        clientRequestId: input.clientRequestId,
      });
      return { created: true, data: this.fileDto(row) };
    });
  }

  async fileReceipt(
    cookie: string | undefined,
    org: string,
    match: string,
    rawId: string,
  ): Promise<MediaFileReceiptData> {
    return this.transaction(async (c) => {
      const a = await this.matchAccess(c, cookie, org, match, false);
      // A malformed path ID simply has no receipt; looked at only after the permission check.
      const r = REQUEST_ID.test(rawId)
        ? await this.receipt(c, a, 'MATCH_FILE_UPLOAD', rawId, false)
        : undefined;
      await this.ensureFreshSession(c, a.ctx);
      if (!r) throw noReceipt();
      if (r.result_file_id)
        return { state: 'FILE', file: await this.fileById(c, a.ctx.orgId, r.result_file_id) };
      return {
        state: 'SESSION',
        session: await this.sessionDto(
          c,
          await this.sessionRow(c, a.ctx.orgId, r.upload_session_id),
        ),
      };
    });
  }

  async createMediaRequest(
    cookie: string | undefined,
    org: string,
    match: string,
    raw: unknown,
  ): Promise<Created<MatchMediaData>> {
    const input = parseMediaRequest(raw);
    return this.once(async (c) => {
      // Media count and IDs serialize on the match lock, after the established event lock.
      const a = await this.matchAccess(c, cookie, org, match, false, true);
      const orgId = a.ctx.orgId;
      const r = await this.receipt(c, a, 'MATCH_MEDIA_CREATE', input.clientRequestId, true);
      if (r) {
        if (r.request_hash !== input.fingerprint) throw conflict();
        await this.ensureFreshSession(c, a.ctx);
        return { created: false, data: await this.mediaById(c, a, r.result_media_id) };
      }
      if (!active(a.event)) throw archived();
      if (
        input.externalUrl &&
        trustedExternalUrl(input.externalUrl, this.trustedExternalHosts) !== input.externalUrl
      )
        invalid('外部链接须为规范形式');
      if (
        (
          await c.query('SELECT id FROM match_media WHERE org_id=$1 AND match_id=$2', [
            orgId,
            a.row.id,
          ])
        ).rowCount! >= 50
      )
        throw new ApiError(409, 'MEDIA_LIMIT', '本场媒体记录已达50条上限');
      if (input.fileId) {
        const f = (
          await c.query(
            'SELECT purpose FROM media_files WHERE org_id=$1 AND event_id=$2 AND match_id=$3 AND id=$4 AND revoked_at IS NULL AND purged_at IS NULL FOR SHARE',
            [orgId, a.event.id, a.row.id, input.fileId],
          )
        ).rows[0];
        if (!f) throw notFound();
        if (f.purpose !== (input.kind === 'IMAGE' ? 'MATCH_IMAGE' : 'MATCH_VIDEO'))
          invalid('禁止将私有凭证或不匹配文件发布为媒体');
      }
      await this.ensureFreshSession(c, a.ctx);
      const mediaId = randomUUID();
      await c.query(
        'INSERT INTO match_media(id,org_id,event_id,match_id,kind,file_id,external_url,title,rights_declaration,public_media_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          mediaId,
          orgId,
          a.event.id,
          a.row.id,
          input.kind,
          input.fileId,
          input.externalUrl,
          input.title,
          input.rightsDeclaration,
          randomBytes(32).toString('base64url'),
          a.ctx.user.id,
        ],
      );
      await this.insertReceipt(
        c,
        a,
        'MATCH_MEDIA_CREATE',
        input.clientRequestId,
        input.fingerprint,
        { mediaId },
      );
      await this.audit(c, a.ctx.user.id, orgId, 'media.draft.created', 'match_media', mediaId, {
        clientRequestId: input.clientRequestId,
      });
      return { created: true, data: await this.mediaById(c, a, mediaId) };
    });
  }

  async mediaReceipt(
    cookie: string | undefined,
    org: string,
    match: string,
    rawId: string,
  ): Promise<MediaRequestReceiptData> {
    return this.transaction(async (c) => {
      const a = await this.matchAccess(c, cookie, org, match, false);
      const r = REQUEST_ID.test(rawId)
        ? await this.receipt(c, a, 'MATCH_MEDIA_CREATE', rawId, false)
        : undefined;
      await this.ensureFreshSession(c, a.ctx);
      if (!r) throw noReceipt();
      return { state: 'MEDIA', media: await this.mediaById(c, a, r.result_media_id) };
    });
  }

  // ---------- B2: bounded chunked upload sessions ----------

  async createUploadSession(
    cookie: string | undefined,
    org: string,
    match: string,
    raw: unknown,
  ): Promise<Created<UploadSessionData>> {
    const input = parseSessionRequest(raw);
    return this.once(async (c) => {
      const a = await this.matchAccess(c, cookie, org, match, true);
      const orgId = a.ctx.orgId;
      const r = await this.receipt(c, a, 'MATCH_FILE_UPLOAD', input.clientRequestId, true);
      if (r) {
        if (r.request_hash !== input.fingerprint) throw conflict();
        await this.ensureFreshSession(c, a.ctx);
        if (!r.upload_session_id)
          throw closed('该请求编号已通过整体上传完成，请查询原回执，不会再建立上传会话');
        return {
          created: false,
          data: await this.sessionDto(c, await this.sessionRow(c, orgId, r.upload_session_id)),
        };
      }
      if (!active(a.event)) throw archived();
      await expireMediaUploadSessions(c, orgId);
      const open = (
        await c.query(
          "SELECT count(*)::int AS org,count(*) FILTER(WHERE created_by=$2)::int AS mine FROM media_upload_sessions WHERE org_id=$1 AND status='OPEN' AND expires_at>clock_timestamp()",
          [orgId, a.ctx.user.id],
        )
      ).rows[0];
      if (open.mine >= MAX_OPEN_SESSIONS_PER_USER || open.org >= MAX_OPEN_SESSIONS_PER_ORG)
        throw new ApiError(
          409,
          'UPLOAD_SESSION_LIMIT',
          `进行中的上传会话已达上限（每人${MAX_OPEN_SESSIONS_PER_USER}个、每机构${MAX_OPEN_SESSIONS_PER_ORG}个），请完成或取消后再试`,
        );
      await this.ensureCapacity(c, orgId, a.row.id, input.byteLength);
      await this.ensureFreshSession(c, a.ctx);
      const sessionId = randomUUID();
      const row = (
        await c.query(
          `WITH t AS (SELECT clock_timestamp() AS now)
           INSERT INTO media_upload_sessions(id,org_id,event_id,match_id,created_by,client_request_id,purpose,file_name,content_type,byte_length,sha256,chunk_size,chunk_count,created_at,expires_at)
           SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,t.now,t.now+($14::int*interval '1 hour') FROM t
           RETURNING ${SESSION_COLUMNS}`,
          [
            sessionId,
            orgId,
            a.event.id,
            a.row.id,
            a.ctx.user.id,
            input.clientRequestId,
            input.purpose,
            input.fileName,
            input.contentType,
            input.byteLength,
            input.contentSha256,
            CHUNK_SIZE,
            Math.ceil(input.byteLength / CHUNK_SIZE),
            SESSION_TTL_HOURS,
          ],
        )
      ).rows[0];
      await this.insertReceipt(
        c,
        a,
        'MATCH_FILE_UPLOAD',
        input.clientRequestId,
        input.fingerprint,
        { sessionId },
      );
      await this.audit(
        c,
        a.ctx.user.id,
        orgId,
        'media.upload_session.created',
        'media_upload_session',
        sessionId,
        {
          purpose: input.purpose,
          byteLength: input.byteLength,
          sha256: input.contentSha256,
          clientRequestId: input.clientRequestId,
        },
      );
      return { created: true, data: await this.sessionDto(c, row) };
    });
  }

  async getUploadSession(
    cookie: string | undefined,
    org: string,
    match: string,
    session: string,
  ): Promise<UploadSessionData> {
    return this.transaction(async (c) => {
      const a = await this.matchAccess(c, cookie, org, match, false);
      const s = await this.ownSession(c, a, session, false);
      await this.ensureFreshSession(c, a.ctx);
      return this.sessionDto(c, s);
    });
  }

  async putChunk(
    cookie: string | undefined,
    org: string,
    match: string,
    session: string,
    rawIndex: string,
    raw: unknown,
  ): Promise<UploadSessionData> {
    const index = chunkIndex(rawIndex);
    const chunk = parseChunk(raw);
    return this.transaction(async (c) => {
      const a = await this.matchAccess(c, cookie, org, match, false);
      const s = await this.ownSession(c, a, session, true);
      if (s.status === 'COMPLETED') throw completedSession();
      if (s.status !== 'OPEN' || s.lapsed) throw closed();
      if (index >= s.chunk_count || chunk.byteLength !== expectedChunkLength(s.byte_length, index))
        invalid('分片序号或长度与会话不一致');
      const existing = (
        await c.query(
          'SELECT byte_length,sha256 FROM media_upload_chunks WHERE org_id=$1 AND session_id=$2 AND chunk_index=$3',
          [s.org_id, s.id, index],
        )
      ).rows[0];
      if (existing) {
        if (existing.byte_length !== chunk.byteLength || existing.sha256 !== chunk.sha256)
          throw new ApiError(409, 'CHUNK_CONFLICT', '该分片已以不同内容确认，原分片不会被改写');
        await this.ensureFreshSession(c, a.ctx);
        return this.sessionDto(c, s);
      }
      if (!active(a.event)) throw archived();
      await this.ensureFreshSession(c, a.ctx);
      await c.query(
        'INSERT INTO media_upload_chunks(org_id,session_id,chunk_index,byte_length,sha256,payload) VALUES($1,$2,$3,$4,$5,$6)',
        [s.org_id, s.id, index, chunk.byteLength, chunk.sha256, chunk.payload],
      );
      await this.audit(
        c,
        a.ctx.user.id,
        s.org_id,
        'media.upload_session.chunk',
        'media_upload_session',
        s.id,
        { index, byteLength: chunk.byteLength, sha256: chunk.sha256 },
      );
      return this.sessionDto(c, s);
    });
  }

  async completeUploadSession(
    cookie: string | undefined,
    org: string,
    match: string,
    session: string,
  ): Promise<MediaFileReceiptData> {
    return this.transaction(async (c) => {
      const a = await this.matchAccess(c, cookie, org, match, true);
      const s = await this.ownSession(c, a, session, true);
      if (s.status === 'COMPLETED') {
        await this.ensureFreshSession(c, a.ctx);
        return { state: 'FILE', file: await this.fileById(c, s.org_id, s.file_id) };
      }
      if (s.status !== 'OPEN' || s.lapsed) throw closed();
      if (!active(a.event)) throw archived();
      const chunks = (
        await c.query(
          'SELECT chunk_index,payload FROM media_upload_chunks WHERE org_id=$1 AND session_id=$2 AND payload IS NOT NULL ORDER BY chunk_index',
          [s.org_id, s.id],
        )
      ).rows;
      if (chunks.length !== s.chunk_count)
        throw new ApiError(409, 'UPLOAD_INCOMPLETE', '仍有分片未被服务端确认，请继续上传', {
          receivedChunks: chunks.length,
          chunkCount: s.chunk_count,
        });
      const payload = Buffer.concat(chunks.map((ch) => ch.payload as Buffer));
      if (
        payload.length !== s.byte_length ||
        createHash('sha256').update(payload).digest('hex') !== s.sha256
      )
        throw new ApiError(
          422,
          'UPLOAD_DIGEST_MISMATCH',
          '组装后的文件长度或整体摘要与原请求不一致，请取消本次会话',
        );
      // The existing C05 format rules (magic bytes, structure, image bounds) for the whole file.
      parseMediaUpload(
        {
          purpose: s.purpose,
          fileName: s.file_name,
          contentType: s.content_type,
          base64: payload.toString('base64'),
        },
        'MATCH',
      );
      await this.ensureFreshSession(c, a.ctx);
      const fileId = randomUUID();
      // Close first (deferred FK) so the file insert's quota no longer counts the reservation.
      await c.query(
        "UPDATE media_upload_sessions SET status='COMPLETED',file_id=$3,closed_at=clock_timestamp(),closed_by=$4,version=version+1 WHERE org_id=$1 AND id=$2",
        [s.org_id, s.id, fileId, a.ctx.user.id],
      );
      const row = (
        await c.query(
          `INSERT INTO media_files(id,org_id,event_id,match_id,purpose,file_name,content_type,byte_length,sha256,payload,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${FILE_COLUMNS}`,
          [
            fileId,
            s.org_id,
            s.event_id,
            s.match_id,
            s.purpose,
            s.file_name,
            s.content_type,
            s.byte_length,
            s.sha256,
            payload,
            a.ctx.user.id,
          ],
        )
      ).rows[0];
      await this.releaseChunks(c, s);
      const receipt = await c.query(
        'UPDATE media_request_receipts SET result_file_id=$3 WHERE org_id=$1 AND upload_session_id=$2 AND result_file_id IS NULL',
        [s.org_id, s.id, fileId],
      );
      if (receipt.rowCount !== 1) throw new Error('Upload session receipt is missing');
      await this.audit(c, a.ctx.user.id, s.org_id, 'media.file.uploaded', 'media_file', fileId, {
        purpose: s.purpose,
        byteLength: s.byte_length,
        sha256: s.sha256,
        clientRequestId: s.client_request_id,
        uploadSessionId: s.id,
      });
      return { state: 'FILE', file: this.fileDto(row) };
    });
  }

  async cancelUploadSession(
    cookie: string | undefined,
    org: string,
    match: string,
    session: string,
  ): Promise<UploadSessionData> {
    return this.transaction(async (c) => {
      const a = await this.matchAccess(c, cookie, org, match, true);
      let s = await this.ownSession(c, a, session, true);
      if (s.status === 'COMPLETED') throw completedSession();
      await this.ensureFreshSession(c, a.ctx);
      if (s.status === 'OPEN') {
        const next = s.lapsed ? 'EXPIRED' : 'CANCELLED';
        await c.query(
          'UPDATE media_upload_sessions SET status=$3,closed_at=clock_timestamp(),closed_by=$4,version=version+1 WHERE org_id=$1 AND id=$2',
          [s.org_id, s.id, next, next === 'CANCELLED' ? a.ctx.user.id : null],
        );
        await this.releaseChunks(c, s);
        if (next === 'CANCELLED')
          await this.audit(
            c,
            a.ctx.user.id,
            s.org_id,
            'media.upload_session.cancelled',
            'media_upload_session',
            s.id,
            { clientRequestId: s.client_request_id },
          );
        s = await this.sessionRow(c, s.org_id, s.id);
      }
      return this.sessionDto(c, s);
    });
  }
}
