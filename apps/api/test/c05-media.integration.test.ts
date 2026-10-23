import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  EntryFilesData,
  MatchMediaData,
  MatchMediaWorkspaceData,
  MediaFileData,
  MediaMarkerData,
  PublicMatchMediaData,
  PublicScheduleMatchData,
} from '@small-city-basketball/contracts';
import { call, data, error } from './support.js';
import { act, closeHarness, createScoringHarness, published, workbench } from './p05-support.js';
import type { Harness } from './p05-support.js';
import {
  anonymous,
  confirmMatch,
  disable,
  enable,
  publicSchedulePath,
  savePublishRules,
} from './p05b-support.js';
import { syntheticMp4, syntheticPdf, syntheticPng } from './media-fixtures.js';
const hash = (v: Buffer) => createHash('sha256').update(v).digest('hex');
describe('C05 actual bounded files and media on isolated PostgreSQL', { concurrent: false }, () => {
  let h: Harness,
    matchId: string,
    eventId: string,
    entryId: string,
    publicEventId: string,
    publicMatchId: string;
  const base = () => `/v1/orgs/${h.owner.orgId}/matches/${matchId}`;
  const entryBase = () => `/v1/orgs/${h.owner.orgId}/entries/${entryId}`;
  const pub = () => `/v1/public/events/${publicEventId}/matches/${publicMatchId}/media`;
  const workspace = async () =>
    data<MatchMediaWorkspaceData>(
      await call(h.api, 'get', `${base()}/media`, { cookie: h.owner.cookie }),
    );
  const upload = async (payload = syntheticPng, video = false) =>
    data<MediaFileData>(
      await call(h.api, 'post', `${base()}/media-files`, {
        cookie: h.owner.cookie,
        body: {
          purpose: video ? 'MATCH_VIDEO' : 'MATCH_IMAGE',
          fileName: video ? 'synthetic.mp4' : 'synthetic.png',
          contentType: video ? 'video/mp4' : 'image/png',
          base64: payload.toString('base64'),
        },
      }),
      201,
    );
  const create = async (file: MediaFileData) =>
    data<MatchMediaData>(
      await call(h.api, 'post', `${base()}/media`, {
        cookie: h.owner.cookie,
        body: {
          kind: file.purpose === 'MATCH_VIDEO' ? 'VIDEO' : 'IMAGE',
          fileId: file.id,
          title: '合成比赛交付',
          rightsDeclaration: '本合成样片由本轮生成并有权公开',
        },
      }),
      201,
    );
  const publish = async (m: MatchMediaData) =>
    data<MatchMediaData>(
      await call(h.api, 'post', `${base()}/media/${m.id}/commands`, {
        cookie: h.owner.cookie,
        body: { type: 'PUBLISH', expectedVersion: m.version },
      }),
    );
  const publicMedia = async () => data<PublicMatchMediaData>(await anonymous(h, pub()));
  async function refreshGrant() {
    const grant = await enable(h, eventId);
    publicEventId = grant.publication!.publicEventId;
    publicMatchId = data<PublicScheduleMatchData[]>(
      await anonymous(h, publicSchedulePath(publicEventId)),
    )[0]!.publicMatchId;
  }
  beforeAll(async () => {
    h = await createScoringHarness(2);
    const fixture = await published(h, h.teams.slice(0, 2));
    matchId = fixture.matches[0]!.id;
    eventId = fixture.event.event.id;
    entryId = fixture.schedule.source.entries[0]!.entryId;
    await savePublishRules(h, eventId);
    await confirmMatch(h, fixture);
    await refreshGrant();
  }, 120000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  }, 30000);
  test('persists actual private PDF bytes, binds the roster version and isolates team grants and reviewers', async () => {
    const current = data<EntryFilesData>(
      await call(h.api, 'get', `${entryBase()}/media-files`, { cookie: h.leader.cookie }),
    );
    const file = data<MediaFileData>(
      await call(h.api, 'post', `${entryBase()}/media-files`, {
        cookie: h.leader.cookie,
        body: {
          purpose: 'PRIVATE_INSURANCE',
          fileName: '合成保险凭证.pdf',
          contentType: 'application/pdf',
          base64: syntheticPdf.toString('base64'),
          expectedEntryVersion: current.entryVersion,
        },
      }),
      201,
    );
    expect(file).toMatchObject({
      purpose: 'PRIVATE_INSURANCE',
      sha256: hash(syntheticPdf),
      byteLength: syntheticPdf.length,
      rosterRevisionId: current.rosterRevisionId,
    });
    expect(file).not.toHaveProperty('payload');
    const read = await call(h.api, 'get', `${entryBase()}/media-files/${file.id}/content`, {
      cookie: h.leader.cookie,
    });
    expect(read.status).toBe(200);
    expect(Buffer.from(read.body)).toEqual(syntheticPdf);
    expect(read.headers['content-disposition']).toContain('attachment');
    expect(read.headers['cache-control']).toContain('no-store');
    expect(read.headers['x-content-type-options']).toBe('nosniff');
    error(await call(h.api, 'get', `${entryBase()}/media-files/${file.id}/content`), 401);
    error(
      await call(
        h.api,
        'get',
        entryBase().replace(h.owner.orgId, h.otherOwner.orgId) + `/media-files/${file.id}/content`,
        { cookie: h.otherOwner.cookie },
      ),
      404,
    );
    error(
      await call(h.api, 'get', `${entryBase()}/media-files`, { cookie: h.otherOwner.cookie }),
      404,
    );
    error(
      await call(h.api, 'post', `${base()}/media`, {
        cookie: h.owner.cookie,
        body: {
          kind: 'IMAGE',
          fileId: file.id,
          title: '不得公开保单',
          rightsDeclaration: '合成测试不能发布私有凭证',
        },
      }),
      404,
    );
    expect(JSON.stringify(await publicMedia())).not.toContain('合成保险凭证');
  });
  test('rejects bad format, stale entry versions, wrong purpose and unauthorized publication without writing', async () => {
    const before = (await workspace()).files.length;
    error(
      await call(h.api, 'post', `${base()}/media-files`, {
        cookie: h.owner.cookie,
        body: {
          purpose: 'MATCH_IMAGE',
          fileName: 'fake.png',
          contentType: 'image/png',
          base64: Buffer.from('<svg/>').toString('base64'),
        },
      }),
      422,
    );
    error(
      await call(h.api, 'post', `${base()}/media-files`, {
        cookie: h.owner.cookie,
        body: {
          purpose: 'PRIVATE_INSURANCE',
          fileName: 'policy.pdf',
          contentType: 'application/pdf',
          base64: syntheticPdf.toString('base64'),
        },
      }),
      422,
    );
    error(
      await call(h.api, 'post', `${entryBase()}/media-files`, {
        cookie: h.leader.cookie,
        body: {
          purpose: 'REGISTRATION_DOC',
          fileName: 'test.pdf',
          contentType: 'application/pdf',
          base64: syntheticPdf.toString('base64'),
          expectedEntryVersion: 999999,
        },
      }),
      409,
    );
    error(
      await call(h.api, 'post', `${base()}/media-files`, {
        cookie: h.otherOwner.cookie,
        body: {
          purpose: 'MATCH_IMAGE',
          fileName: 'test.png',
          contentType: 'image/png',
          base64: syntheticPng.toString('base64'),
        },
      }),
      404,
    );
    expect((await workspace()).files).toHaveLength(before);
  });
  test('requires explicit media publication, serves real MP4 and ranges, and permanently closes old grant content paths', async () => {
    const file = await upload(syntheticMp4, true),
      draft = await create(file);
    expect((await publicMedia()).media.some((m) => m.title === draft.title)).toBe(false);
    await publish(draft);
    const record = (await publicMedia()).media.find((m) => m.kind === 'VIDEO')!;
    expect(record).toBeDefined();
    expect(Object.keys(record).sort()).toEqual(
      [
        'publicMediaId',
        'kind',
        'title',
        'contentPath',
        'contentType',
        'externalUrl',
        'externalNotice',
        'markers',
      ].sort(),
    );
    expect(JSON.stringify(record)).not.toContain(file.id);
    const entire = await anonymous(h, record.contentPath!);
    expect(entire.status).toBe(200);
    expect(Buffer.from(entire.body)).toEqual(syntheticMp4);
    const range = await call(h.api, 'get', record.contentPath!, {
      headers: { Range: 'bytes=8-31' },
    });
    expect(range.status).toBe(206);
    expect(Buffer.from(range.body)).toEqual(syntheticMp4.subarray(8, 32));
    expect(range.headers['content-range']).toBe(`bytes 8-31/${syntheticMp4.length}`);
    error(
      await call(h.api, 'get', record.contentPath!, { headers: { Range: 'bytes=999999-' } }),
      416,
    );
    const oldPath = record.contentPath!,
      oldList = pub();
    await disable(h, eventId);
    error(await anonymous(h, oldList), 404);
    error(await call(h.api, 'get', oldPath, { headers: { Range: 'bytes=0-31' } }), 404);
    await refreshGrant();
    const fresh = (await publicMedia()).media.find(
      (m) => m.publicMediaId === record.publicMediaId,
    )!;
    expect((await anonymous(h, fresh.contentPath!)).status).toBe(200);
    error(await anonymous(h, oldPath), 404);
  });
  test('ties manual media markers to original confirmed events and hides them after result reopen or reconfirmation', async () => {
    const file = await upload(syntheticMp4, true);
    let draft = await create(file);
    const ws = await workspace();
    const source = ws.sourceEvents.find((s) => s.type === 'STAT_RECORDED')!;
    const marker = data<MediaMarkerData>(
      await call(h.api, 'post', `${base()}/media/${draft.id}/markers`, {
        cookie: h.owner.cookie,
        body: {
          expectedVersion: draft.version,
          expectedConfirmationId: ws.currentConfirmationId,
          sourceEventId: source.id,
          label: '合成得分片段',
          startMs: 0,
          endMs: 750,
        },
      }),
      201,
    );
    expect(marker).toMatchObject({
      sourceEventId: source.id,
      sourceSeq: source.seq,
      sourceStatus: 'CURRENT',
    });
    draft = (await workspace()).media.find((m) => m.id === draft.id)!;
    await publish(draft);
    const publicItem = () =>
      publicMedia().then((p) =>
        p.media.find((m) => m.markers.some((k) => k.label === '合成得分片段')),
      );
    const visible = await publicItem();
    expect(visible).toBeDefined();
    expect(Object.keys(visible!.markers[0]!).sort()).toEqual(
      ['publicMarkerId', 'label', 'startMs', 'endMs'].sort(),
    );
    await act(h, matchId, h.owner, {
      type: 'REOPEN_RESULT',
      payload: { reason: '合成媒体确认来源恢复测试' },
    });
    expect(await publicItem()).toBeUndefined();
    expect((await workspace()).media.find((m) => m.id === draft.id)!.markers[0]!.sourceStatus).toBe(
      'STALE',
    );
    await act(h, matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
    expect(await publicItem()).toBeUndefined();
    const fresh = await create(file);
    const next = await workspace();
    error(
      await call(h.api, 'post', `${base()}/media/${fresh.id}/markers`, {
        cookie: h.owner.cookie,
        body: {
          expectedVersion: fresh.version,
          expectedConfirmationId: ws.currentConfirmationId,
          sourceEventId: source.id,
          label: '旧确认不能复活',
          startMs: 0,
          endMs: 500,
        },
      }),
      409,
    );
    expect(next.currentConfirmationId).not.toBe(ws.currentConfirmationId);
  });
  test('revoke and purge deny every file path, release bytes, preserve immutable metadata and forbid resurrection', async () => {
    const file = await upload();
    const m = await publish(await create(file));
    const found = (await publicMedia()).media.find(
      (p) => p.title === m.title && p.kind === 'IMAGE',
    )!;
    const before = (await workspace()).usage.usedBytes;
    const revoked = data<MediaFileData>(
      await call(h.api, 'post', `${base()}/media-files/${file.id}/commands`, {
        cookie: h.owner.cookie,
        body: { type: 'REVOKE', expectedVersion: file.version, reason: '合成文件撤销验证' },
      }),
    );
    error(await anonymous(h, found.contentPath!), 404);
    error(
      await call(h.api, 'get', `${base()}/media-files/${file.id}/content`, {
        cookie: h.owner.cookie,
      }),
      404,
    );
    expect((await workspace()).usage.usedBytes).toBe(before);
    const purged = data<MediaFileData>(
      await call(h.api, 'post', `${base()}/media-files/${file.id}/commands`, {
        cookie: h.owner.cookie,
        body: { type: 'PURGE', expectedVersion: revoked.version, reason: '合成文件明确清除验证' },
      }),
    );
    expect(purged).toMatchObject({
      status: 'PURGED',
      sha256: file.sha256,
      byteLength: file.byteLength,
    });
    expect((await workspace()).usage.usedBytes).toBe(before - file.byteLength);
    await expect(
      h.api.pool.query('UPDATE media_files SET payload=$2,version=version+1 WHERE id=$1', [
        file.id,
        syntheticPng,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (await h.api.pool.query('SELECT payload FROM media_files WHERE id=$1', [file.id])).rows[0]
        .payload,
    ).toBeNull();
  });
  test('serializes concurrent publication CAS and rejects marker forgery atomically', async () => {
    const file = await upload(syntheticMp4, true),
      draft = await create(file);
    const writes = await Promise.all(
      [1, 2].map(() =>
        call(h.api, 'post', `${base()}/media/${draft.id}/commands`, {
          cookie: h.owner.cookie,
          body: { type: 'PUBLISH', expectedVersion: draft.version },
        }),
      ),
    );
    expect(writes.map((r) => r.status).sort()).toEqual([200, 409]);
    const markDraft = await create(file);
    const ws = await workspace();
    error(
      await call(h.api, 'post', `${base()}/media/${markDraft.id}/markers`, {
        cookie: h.owner.cookie,
        body: {
          expectedVersion: markDraft.version,
          expectedConfirmationId: ws.currentConfirmationId,
          sourceEventId: randomUUID(),
          label: '伪造来源拒绝',
          startMs: 0,
          endMs: 500,
        },
      }),
      404,
    );
    expect((await workspace()).media.find((m) => m.id === markDraft.id)!.version).toBe(
      markDraft.version,
    );
    error(
      await call(h.api, 'post', `${base()}/media`, {
        cookie: h.owner.cookie,
        body: {
          kind: 'EXTERNAL_LINK',
          title: '拒绝任意外链',
          externalUrl: 'https://127.0.0.1/private',
          rightsDeclaration: '合成不允许任意服务端抓取',
        },
      }),
      422,
    );
  });
  test('enforces organization byte quota under two concurrent real uploads and releases owned filler content', async () => {
    const before = (await workspace()).usage.usedBytes;
    const max = 8388608,
      large = Buffer.alloc(max);
    syntheticMp4.copy(large);
    large.writeUInt32BE(max - syntheticMp4.length, syntheticMp4.length);
    large.write('free', syntheticMp4.length + 4, 'ascii');
    const fillerIds: string[] = [];
    let remaining = 134217728 - max - before;
    while (remaining > 0) {
      const bytes = Math.min(max, remaining);
      const payload = Buffer.alloc(bytes);
      syntheticMp4.copy(payload);
      payload.writeUInt32BE(bytes - syntheticMp4.length, syntheticMp4.length);
      payload.write('free', syntheticMp4.length + 4, 'ascii');
      const id = randomUUID();
      await h.api.pool.query(
        "INSERT INTO media_files(id,org_id,event_id,match_id,purpose,file_name,content_type,byte_length,sha256,payload,created_by) VALUES($1,$2,$3,$4,'MATCH_VIDEO','quota.mp4','video/mp4',$5,$6,$7,$8)",
        [id, h.owner.orgId, eventId, matchId, bytes, hash(payload), payload, h.owner.id],
      );
      fillerIds.push(id);
      remaining -= bytes;
    }
    const responses = await Promise.all(
      [1, 2].map(() =>
        call(h.api, 'post', `${base()}/media-files`, {
          cookie: h.owner.cookie,
          body: {
            purpose: 'MATCH_VIDEO',
            fileName: 'concurrent-quota.mp4',
            contentType: 'video/mp4',
            base64: large.toString('base64'),
          },
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await workspace()).usage.usedBytes).toBe(134217728);
    fillerIds.push(responses.find((r) => r.status === 201)!.body.data.id);
    for (const id of fillerIds) {
      const f = data<MediaFileData>(
        await call(h.api, 'post', `${base()}/media-files/${id}/commands`, {
          cookie: h.owner.cookie,
          body: { type: 'REVOKE', expectedVersion: 1, reason: '本轮隔离额度夹具撤销' },
        }),
      );
      data(
        await call(h.api, 'post', `${base()}/media-files/${id}/commands`, {
          cookie: h.owner.cookie,
          body: { type: 'PURGE', expectedVersion: f.version, reason: '本轮隔离额度夹具清除' },
        }),
      );
    }
    expect((await workspace()).usage.usedBytes).toBe(before);
  }, 90000);
});
