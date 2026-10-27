import { createHash, randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  MatchMediaData,
  MediaFileData,
  MediaFileReceiptData,
  MediaRequestReceiptData,
  UploadSessionData,
} from '@small-city-basketball/contracts';
import { PASSWORD, RUN_ID, call, data, error, login, staffPath } from './support.js';
import type { User } from './support.js';
import { closeHarness, createScoringHarness, published } from './p05-support.js';
import type { Harness } from './p05-support.js';
import { hashPassword } from '../src/security.js';
import { expireMediaUploadSessions } from '../src/media-request-service.js';
import { syntheticMp4, syntheticPng } from './media-fixtures.js';

const CHUNK = 524288;
const LIMIT = 134217728;
const MAX = 8388608;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** A structurally valid synthetic MP4 of an exact size: the fixture plus one `free` box. */
function mp4(size: number, salt = 0): Buffer {
  const b = Buffer.alloc(size);
  syntheticMp4.copy(b);
  b.writeUInt32BE(size - syntheticMp4.length, syntheticMp4.length);
  b.write('free', syntheticMp4.length + 4, 'ascii');
  for (let i = syntheticMp4.length + 8; i < size; i++) b[i] = (i * 31 + salt * 7 + size) & 255;
  return b;
}
const errorCode = (r: Response, status: number) => {
  error(r, status);
  return r.body.error.code as string;
};

describe(
  'C19 match media request idempotency and upload sessions on isolated PostgreSQL',
  { concurrent: false },
  () => {
    let h: Harness, matchA: string, eventA: string, matchB: string, eventB: string;
    let streamer: User;
    const extra: User[] = [];
    const base = (match = matchA, org = h.owner.orgId) => `/v1/orgs/${org}/matches/${match}`;
    const fileBody = (id: string, bytes: Buffer, over: Record<string, unknown> = {}) => {
      const video = bytes.subarray(4, 8).toString('ascii') === 'ftyp';
      return {
        clientRequestId: id,
        purpose: video ? 'MATCH_VIDEO' : 'MATCH_IMAGE',
        fileName: video ? 'clip.mp4' : 'photo.png',
        contentType: video ? 'video/mp4' : 'image/png',
        byteLength: bytes.length,
        contentSha256: sha(bytes),
        contentBase64: bytes.toString('base64'),
        ...over,
      };
    };
    const metaOf = (body: Record<string, unknown>) => {
      const { contentBase64: _bytes, ...meta } = body;
      return meta;
    };
    const post = (path: string, body: unknown, actor: User = h.owner) =>
      call(h.api, 'post', path, { cookie: actor.cookie, body: body as object });
    const get = (path: string, actor: User = h.owner) =>
      call(h.api, 'get', path, { cookie: actor.cookie });
    const put = (path: string, body: unknown, actor: User = h.owner) =>
      call(h.api, 'put', path, { cookie: actor.cookie, body: body as object });
    const q = async (sql: string, params: unknown[] = []) =>
      (await h.api.pool.query(sql, params)).rows;
    const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0];
    const filesWith = async (hash: string) =>
      (
        await one('SELECT count(*)::int AS n FROM media_files WHERE org_id=$1 AND sha256=$2', [
          h.owner.orgId,
          hash,
        ])
      ).n as number;
    const audits = async (action: string, id: string) =>
      (
        await one(
          "SELECT count(*)::int AS n FROM audit_logs WHERE org_id=$1 AND action=$2 AND metadata->>'clientRequestId'=$3",
          [h.owner.orgId, action, id],
        )
      ).n as number;
    const receipts = async (id: string) =>
      (
        await one(
          'SELECT count(*)::int AS n FROM media_request_receipts WHERE client_request_id=$1',
          [id],
        )
      ).n as number;
    const usedBytes = async () =>
      (
        await one(
          'SELECT COALESCE(sum(byte_length) FILTER(WHERE payload IS NOT NULL),0)::bigint AS n FROM media_files WHERE org_id=$1',
          [h.owner.orgId],
        )
      ).n as string;
    /** Superuser fixture statement with triggers off (time travel / archive); not an app path. */
    async function fixture(sql: string, params: unknown[]) {
      const c = await h.api.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL session_replication_role = replica');
        await c.query(sql, params);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    }
    const lapse = (sessionId: string) =>
      fixture(
        "UPDATE media_upload_sessions SET created_at=created_at-interval '25 hours',expires_at=expires_at-interval '25 hours' WHERE id=$1",
        [sessionId],
      );
    /** Owned filler files so that exactly `free` bytes remain, counting open reservations. */
    async function fill(free: number): Promise<string[]> {
      const used = Number(await usedBytes());
      const reserved = Number(
        (
          await one(
            "SELECT COALESCE(sum(byte_length),0)::bigint AS n FROM media_upload_sessions WHERE org_id=$1 AND status='OPEN' AND expires_at>clock_timestamp()",
            [h.owner.orgId],
          )
        ).n,
      );
      let remaining = LIMIT - used - reserved - free;
      const ids: string[] = [];
      while (remaining > 0) {
        const bytes = Math.min(MAX, remaining);
        const payload = Buffer.alloc(bytes);
        syntheticMp4.copy(payload);
        const id = randomUUID();
        await h.api.pool.query(
          "INSERT INTO media_files(id,org_id,event_id,match_id,purpose,file_name,content_type,byte_length,sha256,payload,created_by) VALUES($1,$2,$3,$4,'MATCH_VIDEO','quota.mp4','video/mp4',$5,$6,$7,$8)",
          [id, h.owner.orgId, eventB, matchB, bytes, sha(payload), payload, h.owner.id],
        );
        ids.push(id);
        remaining -= bytes;
      }
      return ids;
    }
    async function release(ids: string[]) {
      if (!ids.length) return;
      await h.api.pool.query(
        'UPDATE media_files SET version=version+1,revoked_at=clock_timestamp(),revoked_by=$2 WHERE id=ANY($1::uuid[])',
        [ids, h.owner.id],
      );
      await h.api.pool.query(
        'UPDATE media_files SET version=version+1,purged_at=clock_timestamp(),purged_by=$2,payload=NULL WHERE id=ANY($1::uuid[])',
        [ids, h.owner.id],
      );
    }
    async function streamerStatus(status: 'ACTIVE' | 'DISABLED', role = 'STREAMER') {
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, eventA, streamer.id), {
          cookie: h.owner.cookie,
          body: { role, status },
        }),
      );
    }
    async function admin(label: string, role = 'ORG_ADMIN'): Promise<User> {
      const id = randomUUID();
      const email = `c19-media-${label}-${RUN_ID}@example.test`;
      await h.api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [id, email, `媒体 ${label}`, await hashPassword(PASSWORD)],
      );
      await h.api.pool.query(
        'INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,$3)',
        [h.owner.orgId, id, role],
      );
      const user = { id, orgId: h.owner.orgId, email, cookie: '' };
      user.cookie = await login(h.api, user);
      return user;
    }
    const sessionsPath = (match = matchA) => `${base(match)}/media-upload-sessions`;
    const chunkBody = (bytes: Buffer, index: number) => {
      const part = bytes.subarray(index * CHUNK, (index + 1) * CHUNK);
      return { byteLength: part.length, sha256: sha(part), contentBase64: part.toString('base64') };
    };
    async function openSession(bytes: Buffer, actor: User = h.owner, id = randomUUID()) {
      return {
        id,
        session: data<UploadSessionData>(
          await post(sessionsPath(), metaOf(fileBody(id, bytes)), actor),
          201,
        ),
      };
    }
    async function sendAll(session: UploadSessionData, bytes: Buffer, actor: User = h.owner) {
      let last = session;
      for (let i = 0; i < session.chunkCount; i++)
        last = data<UploadSessionData>(
          await put(`${sessionsPath()}/${session.id}/chunks/${i}`, chunkBody(bytes, i), actor),
        );
      return last;
    }
    const cancel = (session: UploadSessionData, actor: User = h.owner) =>
      post(`${sessionsPath()}/${session.id}/cancel`, {}, actor);
    const complete = (session: UploadSessionData, actor: User = h.owner) =>
      post(`${sessionsPath()}/${session.id}/complete`, {}, actor);

    beforeAll(async () => {
      h = await createScoringHarness(4);
      const a = await published(h, h.teams.slice(0, 2));
      const b = await published(h, h.teams.slice(2, 4));
      matchA = a.matches[0]!.id;
      eventA = a.event.event.id;
      matchB = b.matches[0]!.id;
      eventB = b.event.event.id;
      // otherOwner is an organization member without media rights; STREAMER on event A grants them.
      streamer = h.otherOwner;
      await streamerStatus('ACTIVE');
    }, 180000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    test('concurrent same-ID whole-file uploads create one file, count quota once and audit once', async () => {
      const id = randomUUID();
      const bytes = mp4(4096, 1);
      const before = BigInt(await usedBytes());
      // The whole-file lane admits two bodies at a time; both race for the same request ID.
      const responses = await Promise.all(
        [1, 2].map(() => post(`${base()}/media-file-requests`, fileBody(id, bytes))),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(new Set(responses.map((r) => r.body.data.id)).size).toBe(1);
      const replay = data<MediaFileData>(
        await post(`${base()}/media-file-requests`, fileBody(id, bytes)),
      );
      expect(replay.id).toBe(responses[0]!.body.data.id);
      expect(await filesWith(sha(bytes))).toBe(1);
      expect(await receipts(id)).toBe(1);
      expect(await audits('media.file.uploaded', id)).toBe(1);
      expect(BigInt(await usedBytes()) - before).toBe(BigInt(bytes.length));
      const receipt = data<MediaFileReceiptData>(await get(`${base()}/media-file-requests/${id}`));
      expect(receipt).toMatchObject({ state: 'FILE', file: { id: replay.id, status: 'ACTIVE' } });
      expect(errorCode(await get(`${base()}/media-file-requests/${randomUUID()}`), 404)).toBe(
        'RECEIPT_NOT_FOUND',
      );
      expect(errorCode(await get(`${base()}/media-file-requests/not-a-uuid`), 404)).toBe(
        'RECEIPT_NOT_FOUND',
      );
      // The legacy entry is unchanged and still non-idempotent.
      const legacy = {
        purpose: 'MATCH_VIDEO',
        fileName: 'legacy.mp4',
        contentType: 'video/mp4',
        base64: mp4(2048, 2).toString('base64'),
      };
      const l1 = data<MediaFileData>(await post(`${base()}/media-files`, legacy), 201);
      const l2 = data<MediaFileData>(await post(`${base()}/media-files`, legacy), 201);
      expect(l1.id).not.toBe(l2.id);
    });

    test('same ID with different content is a conflict; actor and match keep separate scopes', async () => {
      const id = randomUUID();
      const bytes = mp4(3000, 3);
      data<MediaFileData>(await post(`${base()}/media-file-requests`, fileBody(id, bytes)), 201);
      const renamed = await post(
        `${base()}/media-file-requests`,
        fileBody(id, bytes, { fileName: 'other.mp4' }),
      );
      expect(errorCode(renamed, 409)).toBe('IDEMPOTENCY_CONFLICT');
      expect(JSON.stringify(renamed.body)).not.toContain('clip.mp4');
      const other = mp4(3000, 4);
      expect(errorCode(await post(`${base()}/media-file-requests`, fileBody(id, other)), 409)).toBe(
        'IDEMPOTENCY_CONFLICT',
      );
      expect(await filesWith(sha(other))).toBe(0);
      expect(await receipts(id)).toBe(1);
      // A different match or a different actor is a different request scope.
      data<MediaFileData>(
        await post(`${base(matchB)}/media-file-requests`, fileBody(id, bytes)),
        201,
      );
      data<MediaFileData>(
        await post(`${base()}/media-file-requests`, fileBody(id, bytes), streamer),
        201,
      );
      expect(await receipts(id)).toBe(3);
      expect(await filesWith(sha(bytes))).toBe(3);
    });

    test('draft requests: concurrent same ID creates one record; NFC values; replay shows REVOKED', async () => {
      const file = data<MediaFileData>(
        await post(`${base()}/media-file-requests`, fileBody(randomUUID(), syntheticPng)),
        201,
      );
      const id = randomUUID();
      const body = {
        clientRequestId: id,
        kind: 'IMAGE',
        title: '决赛最后一攻',
        fileId: file.id,
        rightsDeclaration: '主办方摄影组拍摄',
      };
      const responses = await Promise.all(
        [1, 2, 3, 4, 5].map(() => post(`${base()}/media-requests`, body)),
      );
      expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
      const mediaId = responses[0]!.body.data.id as string;
      expect(new Set(responses.map((r) => r.body.data.id))).toEqual(new Set([mediaId]));
      expect(
        (
          await one('SELECT count(*)::int AS n FROM match_media WHERE org_id=$1 AND file_id=$2', [
            h.owner.orgId,
            file.id,
          ])
        ).n,
      ).toBe(1);
      expect(await audits('media.draft.created', id)).toBe(1);
      expect(
        errorCode(await post(`${base()}/media-requests`, { ...body, title: '另一个标题' }), 409),
      ).toBe('IDEMPOTENCY_CONFLICT');
      // NFC: a decomposed title is stored composed; the composed form is the same request.
      const nfcId = randomUUID();
      const decomposed = { ...body, clientRequestId: nfcId, title: ' Café 回放 ' };
      const nfc = data<MatchMediaData>(await post(`${base()}/media-requests`, decomposed), 201);
      expect(nfc.title).toBe('Café 回放');
      expect((await one('SELECT title FROM match_media WHERE id=$1', [nfc.id])).title).toBe(
        'Café 回放',
      );
      expect(
        data<MatchMediaData>(
          await post(`${base()}/media-requests`, { ...decomposed, title: 'Café 回放' }),
        ).id,
      ).toBe(nfc.id);
      // Revoke through the existing command; the receipt replays the current REVOKED state.
      data(
        await post(`${base()}/media/${mediaId}/commands`, { type: 'REVOKE', expectedVersion: 1 }),
      );
      expect(data<MatchMediaData>(await post(`${base()}/media-requests`, body)).status).toBe(
        'REVOKED',
      );
      expect(
        data<MediaRequestReceiptData>(await get(`${base()}/media-requests/${id}`)),
      ).toMatchObject({
        state: 'MEDIA',
        media: { id: mediaId, status: 'REVOKED' },
      });
      expect(await audits('media.draft.created', id)).toBe(1);
      // Links must already be canonical; trust of the host is checked on first execution only.
      const link = {
        clientRequestId: randomUUID(),
        kind: 'EXTERNAL_LINK',
        title: '回看',
        externalUrl: 'https://Video.example.test/v',
        rightsDeclaration: '主办方授权平台发布',
      };
      expect(errorCode(await post(`${base()}/media-requests`, link), 422)).toBe('VALIDATION_ERROR');
      expect(
        errorCode(
          await post(`${base()}/media-requests`, {
            ...link,
            externalUrl: 'https://video.example.test/v',
          }),
          422,
        ),
      ).toBe('VALIDATION_ERROR');
    });

    test('a lost media role returns 403 whether or not the receipt exists; non-staff get 404', async () => {
      const id = randomUUID();
      const bytes = mp4(2500, 5);
      const file = data<MediaFileData>(
        await post(`${base()}/media-file-requests`, fileBody(id, bytes), streamer),
        201,
      );
      const missing = randomUUID();
      // Still ACTIVE event staff of this event, but in a role without media rights: visible, 403.
      await streamerStatus('ACTIVE', 'REVIEWER');
      const shapes: string[] = [];
      for (const r of [
        await get(`${base()}/media-file-requests/${id}`, streamer),
        await get(`${base()}/media-file-requests/${missing}`, streamer),
        await post(`${base()}/media-file-requests`, fileBody(id, bytes), streamer),
        await post(`${base()}/media-file-requests`, fileBody(missing, bytes), streamer),
        await get(`${base()}/media-requests/${id}`, streamer),
      ]) {
        expect(errorCode(r, 403)).toBe('FORBIDDEN');
        shapes.push(JSON.stringify({ ...r.body.error, requestId: '' }));
      }
      expect(new Set(shapes).size).toBe(1);
      // Not visible: disabled staff, a plain organization member, a former member and a total
      // outsider all get exactly the 404 of a match that does not exist.
      const hidden = (r: Response) => {
        expect(errorCode(r, 404)).toBe('RESOURCE_NOT_FOUND');
        return JSON.stringify({ ...r.body.error, requestId: '' });
      };
      const nowhere = hidden(
        await get(`${base(randomUUID())}/media-file-requests/${missing}`, h.leader),
      );
      const member = await admin('plain-member', 'SCORER');
      await streamerStatus('DISABLED');
      const shapesHidden = [];
      for (const actor of [streamer, member, h.leader])
        for (const r of [
          await get(`${base()}/media-file-requests/${id}`, actor),
          await get(`${base()}/media-file-requests/${missing}`, actor),
          await post(`${base()}/media-file-requests`, fileBody(missing, bytes), actor),
        ])
          shapesHidden.push(hidden(r));
      // Former member: ACTIVE staff row kept, organization membership disabled.
      await streamerStatus('ACTIVE');
      await h.api.pool.query(
        "UPDATE organization_memberships SET status='DISABLED' WHERE org_id=$1 AND user_id=$2",
        [h.owner.orgId, streamer.id],
      );
      try {
        shapesHidden.push(hidden(await get(`${base()}/media-file-requests/${id}`, streamer)));
      } finally {
        await h.api.pool.query(
          "UPDATE organization_memberships SET status='ACTIVE' WHERE org_id=$1 AND user_id=$2",
          [h.owner.orgId, streamer.id],
        );
      }
      expect(new Set([nowhere, ...shapesHidden])).toEqual(new Set([nowhere]));
      // Receipts are scoped to the actor: the owner does not see the streamer's request.
      expect(errorCode(await get(`${base()}/media-file-requests/${id}`), 404)).toBe(
        'RECEIPT_NOT_FOUND',
      );
      await streamerStatus('ACTIVE');
      expect(
        data<MediaFileData>(
          await post(`${base()}/media-file-requests`, fileBody(id, bytes), streamer),
        ).id,
      ).toBe(file.id);
      expect(await filesWith(sha(bytes))).toBe(1);
    });

    test('replay after purge, full quota and archive returns the current state without new rows', async () => {
      const id = randomUUID();
      const bytes = mp4(2200, 6);
      const file = data<MediaFileData>(
        await post(`${base()}/media-file-requests`, fileBody(id, bytes)),
        201,
      );
      const revoked = data<MediaFileData>(
        await post(`${base()}/media-files/${file.id}/commands`, {
          type: 'REVOKE',
          expectedVersion: 1,
          reason: '本轮重放测试撤销',
        }),
      );
      data(
        await post(`${base()}/media-files/${file.id}/commands`, {
          type: 'PURGE',
          expectedVersion: revoked.version,
          reason: '本轮重放测试清除',
        }),
      );
      expect(
        data<MediaFileData>(await post(`${base()}/media-file-requests`, fileBody(id, bytes))),
      ).toMatchObject({ id: file.id, status: 'PURGED' });
      expect(await filesWith(sha(bytes))).toBe(1);

      const fillers = await fill(0);
      try {
        expect(
          data<MediaFileData>(await post(`${base()}/media-file-requests`, fileBody(id, bytes)))
            .status,
        ).toBe('PURGED');
        expect(
          errorCode(
            await post(`${base()}/media-file-requests`, fileBody(randomUUID(), mp4(2200, 7))),
            409,
          ),
        ).toBe('MEDIA_STORAGE_LIMIT');
        expect(
          errorCode(
            await post(sessionsPath(), metaOf(fileBody(randomUUID(), mp4(CHUNK + 10, 8)))),
            409,
          ),
        ).toBe('MEDIA_STORAGE_LIMIT');
      } finally {
        await release(fillers);
      }

      const w = randomUUID();
      const wBytes = mp4(2100, 9);
      const wFile = data<MediaFileData>(
        await post(`${base(matchB)}/media-file-requests`, fileBody(w, wBytes)),
        201,
      );
      const d = randomUUID();
      const draft = {
        clientRequestId: d,
        kind: 'VIDEO',
        title: '归档前草稿',
        fileId: wFile.id,
        rightsDeclaration: '主办方摄影组拍摄',
      };
      const dMedia = data<MatchMediaData>(await post(`${base(matchB)}/media-requests`, draft), 201);
      await fixture("UPDATE events SET status='ARCHIVED',version=version+1 WHERE id=$1", [eventB]);
      expect(
        data<MediaFileData>(await post(`${base(matchB)}/media-file-requests`, fileBody(w, wBytes)))
          .id,
      ).toBe(wFile.id);
      expect(data<MatchMediaData>(await post(`${base(matchB)}/media-requests`, draft)).id).toBe(
        dMedia.id,
      );
      expect(
        errorCode(
          await post(`${base(matchB)}/media-file-requests`, fileBody(randomUUID(), wBytes)),
          409,
        ),
      ).toBe('INVALID_EVENT_STATE');
      expect(
        errorCode(
          await post(`${base(matchB)}/media-requests`, { ...draft, clientRequestId: randomUUID() }),
          409,
        ),
      ).toBe('INVALID_EVENT_STATE');
      expect(await filesWith(sha(wBytes))).toBe(1);
    });

    test('an interrupted session resumes from confirmed chunks and completes exactly once', async () => {
      const bytes = mp4(CHUNK * 2 + 1234, 10);
      const { id, session } = await openSession(bytes);
      expect(session).toMatchObject({
        status: 'OPEN',
        chunkCount: 3,
        chunkSize: CHUNK,
        receivedBytes: 0,
        chunks: [],
      });
      expect(Date.parse(session.expiresAt) - Date.parse(session.createdAt)).toBe(24 * 3600000);
      // Replaying creation returns the same session and never extends it.
      const again = data<UploadSessionData>(
        await post(sessionsPath(), metaOf(fileBody(id, bytes))),
      );
      expect(again).toMatchObject({ id: session.id, expiresAt: session.expiresAt });
      expect(errorCode(await post(`${base()}/media-file-requests`, fileBody(id, bytes)), 409)).toBe(
        'UPLOAD_SESSION_ACTIVE',
      );
      expect(
        data<MediaFileReceiptData>(await get(`${base()}/media-file-requests/${id}`)),
      ).toMatchObject({ state: 'SESSION', session: { id: session.id } });
      const path = `${sessionsPath()}/${session.id}`;
      const first = data<UploadSessionData>(await put(`${path}/chunks/0`, chunkBody(bytes, 0)));
      expect(first.receivedBytes).toBe(CHUNK);
      expect(
        data<UploadSessionData>(await put(`${path}/chunks/0`, chunkBody(bytes, 0))).receivedBytes,
      ).toBe(CHUNK);
      const wrong = mp4(CHUNK * 2 + 1234, 11);
      expect(errorCode(await put(`${path}/chunks/0`, chunkBody(wrong, 0)), 409)).toBe(
        'CHUNK_CONFLICT',
      );
      expect(errorCode(await put(`${path}/chunks/2`, chunkBody(bytes, 0)), 422)).toBe(
        'VALIDATION_ERROR',
      );
      expect(errorCode(await put(`${path}/chunks/3`, chunkBody(bytes, 2)), 422)).toBe(
        'VALIDATION_ERROR',
      );
      expect(errorCode(await put(`${path}/chunks/16`, chunkBody(bytes, 2)), 404)).toBe(
        'RESOURCE_NOT_FOUND',
      );
      expect(
        (
          await one(
            "SELECT count(*)::int AS n FROM audit_logs WHERE action='media.upload_session.chunk' AND resource_id=$1",
            [session.id],
          )
        ).n,
      ).toBe(1);
      data<UploadSessionData>(await put(`${path}/chunks/2`, chunkBody(bytes, 2)));
      expect(errorCode(await complete(session), 409)).toBe('UPLOAD_INCOMPLETE');
      // "Resume": read the confirmed chunks and send only the missing one.
      const status = data<UploadSessionData>(await get(path));
      expect(status.chunks.map((c) => c.index)).toEqual([0, 2]);
      expect(status.receivedBytes).toBe(CHUNK + 1234);
      expect(status.chunks[1]).toEqual({
        index: 2,
        byteLength: 1234,
        sha256: chunkBody(bytes, 2).sha256,
      });
      data<UploadSessionData>(await put(`${path}/chunks/1`, chunkBody(bytes, 1)));
      const done = data<MediaFileReceiptData>(await complete(session));
      expect(done.state).toBe('FILE');
      const file = (done as { file: MediaFileData }).file;
      expect(file).toMatchObject({
        byteLength: bytes.length,
        sha256: sha(bytes),
        status: 'ACTIVE',
      });
      // Lost completion response: the same receipt, never a second file.
      expect(data<MediaFileReceiptData>(await complete(session))).toEqual(done);
      expect(data<MediaFileReceiptData>(await get(`${base()}/media-file-requests/${id}`))).toEqual(
        done,
      );
      expect(
        data<MediaFileData>(await post(`${base()}/media-file-requests`, fileBody(id, bytes))).id,
      ).toBe(file.id);
      expect(
        data<UploadSessionData>(await post(sessionsPath(), metaOf(fileBody(id, bytes)))),
      ).toMatchObject({ status: 'COMPLETED', file: { id: file.id } });
      expect(await filesWith(sha(bytes))).toBe(1);
      expect(await audits('media.file.uploaded', id)).toBe(1);
      const read = await get(`${base()}/media-files/${file.id}/content`);
      expect(Buffer.from(read.body)).toEqual(bytes);
      expect(
        await q('SELECT payload IS NULL AS released FROM media_upload_chunks WHERE session_id=$1', [
          session.id,
        ]),
      ).toEqual([{ released: true }, { released: true }, { released: true }]);
      expect(errorCode(await cancel(session), 409)).toBe('UPLOAD_SESSION_COMPLETED');
      expect(errorCode(await put(`${path}/chunks/1`, chunkBody(bytes, 1)), 409)).toBe(
        'UPLOAD_SESSION_COMPLETED',
      );
      // A whole-file request ID can never open a session afterwards.
      const single = randomUUID();
      data<MediaFileData>(
        await post(`${base()}/media-file-requests`, fileBody(single, mp4(2600, 12))),
        201,
      );
      expect(
        errorCode(await post(sessionsPath(), metaOf(fileBody(single, mp4(2600, 12)))), 409),
      ).toBe('REQUEST_CLOSED');
      // Completion re-validates the existing format rules on the assembled bytes.
      const fake = Buffer.alloc(CHUNK + 50, 7);
      const { session: bad } = await openSession(fake);
      await sendAll(bad, fake);
      expect(errorCode(await complete(bad), 422)).toBe('VALIDATION_ERROR');
      expect(data<UploadSessionData>(await cancel(bad)).status).toBe('CANCELLED');
    });

    test('sessions reserve quota; cancel and expiry release it, chunks are nulled and IDs stay closed', async () => {
      const fillers = await fill(MAX);
      const opened: UploadSessionData[] = [];
      try {
        const big = mp4(MAX, 13);
        const { id: bigId, session } = await openSession(big);
        opened.push(session);
        await put(`${sessionsPath()}/${session.id}/chunks/0`, chunkBody(big, 0));
        // The reservation blocks new whole-file, legacy and session uploads alike.
        expect(
          errorCode(
            await post(`${base()}/media-file-requests`, fileBody(randomUUID(), syntheticPng)),
            409,
          ),
        ).toBe('MEDIA_STORAGE_LIMIT');
        expect(
          errorCode(
            await post(`${base()}/media-files`, {
              purpose: 'MATCH_IMAGE',
              fileName: 'x.png',
              contentType: 'image/png',
              base64: syntheticPng.toString('base64'),
            }),
            409,
          ),
        ).toBe('MEDIA_STORAGE_LIMIT');
        expect(
          errorCode(
            await post(sessionsPath(), metaOf(fileBody(randomUUID(), mp4(CHUNK + 1, 14)))),
            409,
          ),
        ).toBe('MEDIA_STORAGE_LIMIT');
        // The database enforces the same reservation even past the service checks.
        await expect(
          h.api.pool.query(
            "INSERT INTO media_files(id,org_id,event_id,match_id,purpose,file_name,content_type,byte_length,sha256,payload,created_by) VALUES($1,$2,$3,$4,'MATCH_IMAGE','x.png','image/png',$5,$6,$7,$8)",
            [
              randomUUID(),
              h.owner.orgId,
              eventA,
              matchA,
              syntheticPng.length,
              sha(syntheticPng),
              syntheticPng,
              h.owner.id,
            ],
          ),
        ).rejects.toThrow(/quota/);
        const cancelled = data<UploadSessionData>(await cancel(session));
        expect(cancelled).toMatchObject({ status: 'CANCELLED', receivedBytes: 0, chunks: [] });
        expect(data<UploadSessionData>(await cancel(session)).status).toBe('CANCELLED');
        expect(
          await q(
            'SELECT payload IS NULL AS released FROM media_upload_chunks WHERE session_id=$1',
            [session.id],
          ),
        ).toEqual([{ released: true }]);
        expect(errorCode(await complete(session), 409)).toBe('REQUEST_CLOSED');
        expect(
          errorCode(await post(`${base()}/media-file-requests`, fileBody(bigId, big)), 409),
        ).toBe('REQUEST_CLOSED');
        expect(
          data<UploadSessionData>(await post(sessionsPath(), metaOf(fileBody(bigId, big)))),
        ).toMatchObject({ id: session.id, status: 'CANCELLED' });
        const png = data<MediaFileData>(
          await post(`${base()}/media-file-requests`, fileBody(randomUUID(), syntheticPng)),
          201,
        );
        // Expiry: the reservation lapses at expiresAt and bounded cleanup records EXPIRED.
        const rest = MAX - png.byteLength;
        const later = mp4(rest, 15);
        const { id: laterId, session: s2 } = await openSession(later);
        opened.push(s2);
        await put(`${sessionsPath()}/${s2.id}/chunks/0`, chunkBody(later, 0));
        expect(
          errorCode(
            await post(`${base()}/media-file-requests`, fileBody(randomUUID(), mp4(2700, 16))),
            409,
          ),
        ).toBe('MEDIA_STORAGE_LIMIT');
        await lapse(s2.id);
        expect(data<UploadSessionData>(await get(`${sessionsPath()}/${s2.id}`)).status).toBe(
          'EXPIRED',
        );
        const small = data<MediaFileData>(
          await post(`${base()}/media-file-requests`, fileBody(randomUUID(), mp4(2700, 16))),
          201,
        );
        expect(small.status).toBe('ACTIVE');
        expect(
          await one(
            'SELECT status,closed_at IS NOT NULL AS closed FROM media_upload_sessions WHERE id=$1',
            [s2.id],
          ),
        ).toEqual({ status: 'EXPIRED', closed: true });
        expect(
          await q(
            'SELECT payload IS NULL AS released FROM media_upload_chunks WHERE session_id=$1',
            [s2.id],
          ),
        ).toEqual([{ released: true }]);
        expect(
          errorCode(await put(`${sessionsPath()}/${s2.id}/chunks/1`, chunkBody(later, 1)), 409),
        ).toBe('REQUEST_CLOSED');
        expect(errorCode(await complete(s2), 409)).toBe('REQUEST_CLOSED');
        expect(
          data<UploadSessionData>(await post(sessionsPath(), metaOf(fileBody(laterId, later)))),
        ).toMatchObject({ id: s2.id, status: 'EXPIRED' });
        expect(await receipts(laterId)).toBe(1);
        // Completed files are never touched by session cleanup.
        expect(await expireMediaUploadSessions(h.api.pool, null, 500)).toEqual(
          expect.objectContaining({ sessions: expect.any(Number) }),
        );
        expect(
          (await one('SELECT payload IS NOT NULL AS kept FROM media_files WHERE id=$1', [small.id]))
            .kept,
        ).toBe(true);
      } finally {
        for (const s of opened) await cancel(s);
        await release(fillers);
      }
    });

    test('open-session limits stop many sessions from bypassing the quota', async () => {
      while (extra.length < 4) extra.push(await admin(`admin-${extra.length}`));
      const opened: [UploadSessionData, User][] = [];
      try {
        for (const actor of [h.owner, ...extra.slice(0, 3)])
          for (const salt of [1, 2])
            opened.push([(await openSession(mp4(CHUNK + 100, 20 + salt), actor)).session, actor]);
        expect(
          errorCode(
            await post(sessionsPath(), metaOf(fileBody(randomUUID(), mp4(CHUNK + 100, 30)))),
            409,
          ),
        ).toBe('UPLOAD_SESSION_LIMIT');
        expect(
          errorCode(
            await post(
              sessionsPath(),
              metaOf(fileBody(randomUUID(), mp4(CHUNK + 100, 31))),
              extra[3],
            ),
            409,
          ),
        ).toBe('UPLOAD_SESSION_LIMIT');
        // The database trigger enforces the same limit for any writer.
        await expect(
          h.api.pool.query(
            "INSERT INTO media_upload_sessions(id,org_id,event_id,match_id,created_by,client_request_id,purpose,file_name,content_type,byte_length,sha256,chunk_size,chunk_count,expires_at) VALUES($1,$2,$3,$4,$5,$6,'MATCH_VIDEO','x.mp4','video/mp4',10,$7,524288,1,clock_timestamp()+interval '1 hour')",
            [
              randomUUID(),
              h.owner.orgId,
              eventA,
              matchA,
              extra[3]!.id,
              randomUUID(),
              'a'.repeat(64),
            ],
          ),
        ).rejects.toThrow(/open upload sessions/);
        for (const [s, actor] of opened.splice(0)) data(await cancel(s, actor));
        // Bytes: with 10 MiB free, one 6 MiB session fits and a second is rejected.
        const fillers = await fill(10 * 1048576);
        try {
          const first = await openSession(mp4(6 * 1048576, 40));
          opened.push([first.session, h.owner]);
          expect(
            errorCode(
              await post(
                sessionsPath(),
                metaOf(fileBody(randomUUID(), mp4(6 * 1048576, 41))),
                extra[0],
              ),
              409,
            ),
          ).toBe('MEDIA_STORAGE_LIMIT');
        } finally {
          await release(fillers);
        }
      } finally {
        for (const [s, actor] of opened) await cancel(s, actor);
      }
    });

    test('cancel racing complete: the transaction result wins and is reported truthfully', async () => {
      for (let round = 0; round < 4; round++) {
        const bytes = mp4(CHUNK + 300, 50 + round);
        const { id, session } = await openSession(bytes);
        await sendAll(session, bytes);
        const [done, cancelled] = await Promise.all([complete(session), cancel(session)]);
        const row = await one('SELECT status,file_id FROM media_upload_sessions WHERE id=$1', [
          session.id,
        ]);
        const receipt = data<MediaFileReceiptData>(
          await get(`${base()}/media-file-requests/${id}`),
        );
        if (row.status === 'COMPLETED') {
          expect(done.status).toBe(200);
          expect(errorCode(cancelled, 409)).toBe('UPLOAD_SESSION_COMPLETED');
          expect(receipt).toMatchObject({ state: 'FILE', file: { id: row.file_id } });
          expect(await filesWith(sha(bytes))).toBe(1);
        } else {
          expect(row.status).toBe('CANCELLED');
          expect(cancelled.status).toBe(200);
          expect(errorCode(done, 409)).toBe('REQUEST_CLOSED');
          expect(receipt).toMatchObject({
            state: 'SESSION',
            session: { status: 'CANCELLED', file: null },
          });
          expect(await filesWith(sha(bytes))).toBe(0);
        }
      }
    });

    test('only the creator operates a session, and only while still authorized', async () => {
      const bytes = mp4(CHUNK + 400, 60);
      const { session } = await openSession(bytes, streamer);
      const path = `${sessionsPath()}/${session.id}`;
      expect(errorCode(await get(path), 404)).toBe('RESOURCE_NOT_FOUND');
      expect(errorCode(await put(`${path}/chunks/0`, chunkBody(bytes, 0)), 404)).toBe(
        'RESOURCE_NOT_FOUND',
      );
      expect(errorCode(await cancel(session), 404)).toBe('RESOURCE_NOT_FOUND');
      await streamerStatus('ACTIVE', 'REVIEWER');
      try {
        for (const r of [
          await get(path, streamer),
          await put(`${path}/chunks/0`, chunkBody(bytes, 0), streamer),
          await complete(session, streamer),
          await cancel(session, streamer),
        ])
          expect(errorCode(r, 403)).toBe('FORBIDDEN');
        await streamerStatus('DISABLED');
        expect(errorCode(await get(path, streamer), 404)).toBe('RESOURCE_NOT_FOUND');
        expect(errorCode(await cancel(session, streamer), 404)).toBe('RESOURCE_NOT_FOUND');
        expect(
          (await one('SELECT status FROM media_upload_sessions WHERE id=$1', [session.id])).status,
        ).toBe('OPEN');
      } finally {
        await streamerStatus('ACTIVE');
      }
      expect(data<UploadSessionData>(await cancel(session, streamer)).status).toBe('CANCELLED');
    });

    test('a failing audit write rolls back the file and receipt; the same ID then succeeds once', async () => {
      const id = randomUUID();
      const bytes = mp4(1800, 70);
      await h.api.pool
        .query(`CREATE FUNCTION c19_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.metadata->>'clientRequestId'='${id}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$`);
      await h.api.pool.query(
        'CREATE TRIGGER c19_test_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION c19_test_fail_audit()',
      );
      try {
        expect(
          errorCode(await post(`${base()}/media-file-requests`, fileBody(id, bytes)), 500),
        ).toBe('INTERNAL_ERROR');
        expect(await filesWith(sha(bytes))).toBe(0);
        expect(await receipts(id)).toBe(0);
        expect(errorCode(await get(`${base()}/media-file-requests/${id}`), 404)).toBe(
          'RECEIPT_NOT_FOUND',
        );
      } finally {
        await h.api.pool.query('DROP TRIGGER c19_test_fail_audit ON audit_logs');
        await h.api.pool.query('DROP FUNCTION c19_test_fail_audit()');
      }
      data<MediaFileData>(await post(`${base()}/media-file-requests`, fileBody(id, bytes)), 201);
      expect(await filesWith(sha(bytes))).toBe(1);
      expect(await audits('media.file.uploaded', id)).toBe(1);
    });

    test('receipts and sessions cannot be deleted or rewritten, even by direct SQL', async () => {
      const id = randomUUID();
      data<MediaFileData>(
        await post(`${base()}/media-file-requests`, fileBody(id, mp4(2800, 80))),
        201,
      );
      await expect(
        h.api.pool.query('DELETE FROM media_request_receipts WHERE client_request_id=$1', [id]),
      ).rejects.toThrow(/cannot be deleted/);
      await expect(
        h.api.pool.query(
          'UPDATE media_request_receipts SET request_hash=$2 WHERE client_request_id=$1',
          [id, 'b'.repeat(64)],
        ),
      ).rejects.toThrow(/immutable/);
      const { session } = await openSession(mp4(CHUNK + 5, 81));
      await expect(
        h.api.pool.query(
          "UPDATE media_upload_sessions SET expires_at=expires_at+interval '1 hour',version=version+1 WHERE id=$1",
          [session.id],
        ),
      ).rejects.toThrow(/only close once/);
      await expect(
        h.api.pool.query('DELETE FROM media_upload_sessions WHERE id=$1', [session.id]),
      ).rejects.toThrow();
      data(await cancel(session));
    });
  },
);
