import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiExceptionFilter } from './errors.js';
import { OverlayController, SCB_OVERLAY_SERVICE } from './overlay-controller.js';
import { OverlaySourceController } from './overlay-bootstrap.js';
import { OverlayService } from './overlay-service.js';

const pool = new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });
const service = new OverlayService(pool, {
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  appOrigin: 'http://localhost',
});
@Module({
  controllers: [OverlayController, OverlaySourceController],
  providers: [{ provide: SCB_OVERLAY_SERVICE, useValue: service }],
})
class TransportModule {}
const id = 'A'.repeat(43);
const prefix =
  '/v1/orgs/00000000-0000-0000-0000-000000000001/matches/00000000-0000-0000-0000-000000000002';
let app: INestApplication;
beforeAll(async () => {
  app = await NestFactory.create(TransportModule, { logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('overlay HTTP transport without database', () => {
  it('strictly rejects a forged management identity before a database connection', async () => {
    const connect = vi.spyOn(pool, 'connect');
    const response = await request(app.getHttpServer())
      .post(`${prefix}/overlay-commands`)
      .send({ type: 'ISSUE', expectedEventVersion: 1, expiresInMinutes: 60, issuerId: 'forged' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(connect).not.toHaveBeenCalled();
  });

  it('cannot bootstrap with a private Cookie and a missing or malformed secret', async () => {
    const connect = vi.spyOn(pool, 'connect');
    for (const token of [undefined, '', 'wrong', 'x'.repeat(44)]) {
      const response = await request(app.getHttpServer())
        .post(`/v1/overlays/${id}/bootstrap`)
        .set('Cookie', `scb.sid=${'P'.repeat(43)}`)
        .send(token === undefined ? {} : { token });
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it('never treats a private Cookie as source authorization', async () => {
    const connect = vi.spyOn(pool, 'connect');
    const response = await request(app.getHttpServer())
      .get(`/v1/overlays/${id}/snapshot`)
      .set('Cookie', `scb.sid=${'P'.repeat(43)}`);
    expect(response.status).toBe(404);
    expect(connect).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain('P'.repeat(43));
  });

  it('keeps the source session token exclusively in Set-Cookie with HTTP200', async () => {
    const session = 'S'.repeat(43);
    const data = {
      overlayId: id,
      expiresAt: '2026-10-22T09:00:00.000Z',
      serverTime: '2026-10-22T08:00:00.000Z',
    };
    vi.spyOn(service, 'bootstrap').mockResolvedValueOnce({
      data,
      cookie: `scb.overlay=${session}; Path=/v1/overlays/${id}/; Max-Age=3600; HttpOnly; SameSite=Strict`,
    });
    const response = await request(app.getHttpServer())
      .post(`/v1/overlays/${id}/bootstrap`)
      .send({ token: 'T'.repeat(43) });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(data);
    expect(response.headers['set-cookie']?.[0]).toContain(`scb.overlay=${session};`);
    expect(JSON.stringify(response.body)).not.toContain(session);
    expect(JSON.stringify(response.body)).not.toContain('T'.repeat(43));
  });

  it('keeps successful management HTTP200 despite a nullable invalid preview', async () => {
    const data = {
      event: { id: 'event', name: '测试赛事', version: 2 },
      matchId: 'match',
      preview: null,
      previewError: { code: 'RESULT_SOURCE_INVALID', message: '赛果来源无法校验' },
      currentGrant: null,
      history: [],
      historyLimit: 20,
      historyTruncated: false,
      capabilities: { canIssue: true, canRotate: false, canRevoke: false },
      serverTime: '2026-10-22T08:00:00.000Z',
      credential: null,
    };
    vi.spyOn(service, 'executeCommand').mockResolvedValueOnce(data as never);
    const response = await request(app.getHttpServer()).post(`${prefix}/overlay-commands`).send({});
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(data);
  });

  it('exposes source corruption as a fixed409 error without private details', async () => {
    vi.spyOn(service, 'getSnapshot').mockRejectedValueOnce(
      new ApiError(409, 'RESULT_SOURCE_INVALID', '赛果来源无法校验'),
    );
    const response = await request(app.getHttpServer()).get(`/v1/overlays/${id}/snapshot`);
    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: 'RESULT_SOURCE_INVALID',
      message: '赛果来源无法校验',
    });
    expect(response.body.error.details).toBeUndefined();
    expect(response.body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
