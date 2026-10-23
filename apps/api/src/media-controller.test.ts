import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiExceptionFilter } from './errors.js';
import { MediaController, PublicMediaController, SCB_MEDIA_SERVICE } from './media-controller.js';
import { MediaService } from './media-service.js';
import { syntheticMp4, syntheticPdf } from '../test/media-fixtures.js';
const pool = new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });
const service = new MediaService(pool, {
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  appOrigin: 'http://localhost',
});
@Module({
  controllers: [MediaController, PublicMediaController],
  providers: [{ provide: SCB_MEDIA_SERVICE, useValue: service }],
})
class Transport {}
let app: INestApplication;
beforeAll(async () => {
  app = await NestFactory.create(Transport, { logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await app.close();
  await pool.end();
});
const prefix =
  '/v1/orgs/00000000-0000-4000-8000-000000000001/entries/00000000-0000-4000-8000-000000000002';
const publicPrefix = `/v1/public/events/${'a'.repeat(43)}/matches/${'b'.repeat(43)}/media/${'c'.repeat(43)}/content`;
describe('media transport and safe content responses (mock service)', () => {
  it('rejects forged upload purpose and unknown command identity before a database connection', async () => {
    const connect = vi.spyOn(pool, 'connect');
    const r = await request(app.getHttpServer())
      .post(prefix + '/media-files')
      .send({
        purpose: 'MATCH_VIDEO',
        fileName: 'video.mp4',
        contentType: 'video/mp4',
        base64: syntheticMp4.toString('base64'),
      });
    expect(r.status).toBe(422);
    expect(connect).not.toHaveBeenCalled();
    const command = await request(app.getHttpServer())
      .post(prefix + '/media-files/00000000-0000-4000-8000-000000000003/commands')
      .send({ type: 'REVOKE', expectedVersion: 1, reason: 'synthetic', actorId: 'forged' });
    expect(command.status).toBe(422);
    expect(connect).not.toHaveBeenCalled();
  });
  it('sends PDF as exact binary attachment with no-store and no JSON wrapper or raw credentials', async () => {
    vi.spyOn(service, 'getPrivateContent').mockResolvedValue({
      body: syntheticPdf,
      contentType: 'application/pdf',
      fileName: '合成凭证.pdf',
      attachment: true,
      status: 200,
      contentRange: null,
      totalLength: syntheticPdf.length,
    });
    const r = await request(app.getHttpServer())
      .get(prefix + '/media-files/00000000-0000-4000-8000-000000000003/content')
      .set('Cookie', 'scb.sid=private');
    expect(r.status).toBe(200);
    expect(r.body).toEqual(syntheticPdf);
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.headers['content-disposition']).toContain('filename*=UTF-8');
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.headers['content-security-policy']).toContain('sandbox');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
  it('keeps public Range semantics and binary lengths after the service authorizes a request', async () => {
    const content = syntheticMp4.subarray(0, 32);
    const get = vi.spyOn(service, 'getPublicContent').mockResolvedValue({
      body: content,
      contentType: 'video/mp4',
      fileName: 'media.mp4',
      attachment: false,
      status: 206,
      contentRange: `bytes 0-31/${syntheticMp4.length}`,
      totalLength: syntheticMp4.length,
    });
    const r = await request(app.getHttpServer()).get(publicPrefix).set('Range', 'bytes=0-31');
    expect(r.status).toBe(206);
    expect(r.body).toEqual(content);
    expect(r.headers['content-length']).toBe('32');
    expect(r.headers['content-range']).toBe(`bytes 0-31/${syntheticMp4.length}`);
    expect(get).toHaveBeenCalledWith('a'.repeat(43), 'b'.repeat(43), 'c'.repeat(43), 'bytes=0-31');
  });
  it('returns an unavailable grant before revealing any byte range or file length', async () => {
    vi.spyOn(service, 'getPublicContent').mockRejectedValue(
      new ApiError(404, 'RESOURCE_NOT_FOUND', '未找到可访问的资源'),
    );
    const r = await request(app.getHttpServer()).get(publicPrefix).set('Range', 'bytes=999999-');
    expect(r.status).toBe(404);
    expect(r.headers['content-range']).toBeUndefined();
    expect(r.body).not.toHaveProperty('data');
  });
});
