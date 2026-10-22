import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './errors.js';
import { StandingsController, SCB_STANDINGS_SERVICE } from './standings-controller.js';
import { PublicViewingController } from './public-viewing-controller.js';
import { StandingsService } from './standings-service.js';
const pool = new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });
const service = new StandingsService(pool, {
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  appOrigin: 'http://localhost',
});
@Module({
  controllers: [StandingsController, PublicViewingController],
  providers: [{ provide: SCB_STANDINGS_SERVICE, useValue: service }],
})
class TransportModule {}
let app: INestApplication;
const publicKey = 'E'.repeat(43);
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
describe('public viewing HTTP transport without database', () => {
  it('rejects an internal UUID as public match identity before database access', async () => {
    const connect = vi.spyOn(pool, 'connect');
    const res = await request(app.getHttpServer()).get(
      `/v1/public/events/${publicKey}/matches/00000000-0000-0000-0000-000000000001`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(connect).not.toHaveBeenCalled();
  });
  it('never passes a private Cookie into the anonymous application interface', async () => {
    const get = vi
      .spyOn(service, 'getPublicEvent')
      .mockResolvedValueOnce({ publicEventId: publicKey, name: '公开赛事' } as never);
    const res = await request(app.getHttpServer())
      .get(`/v1/public/events/${publicKey}`)
      .set('Cookie', 'scb.sid=private-marker');
    expect(res.status).toBe(200);
    expect(get).toHaveBeenCalledExactlyOnceWith(publicKey);
    expect(JSON.stringify(res.body)).not.toContain('private-marker');
  });
  it('rejects a cursor from another public event before database access', async () => {
    const connect = vi.spyOn(pool, 'connect');
    const cursor = Buffer.from(
      JSON.stringify({
        scope: `public-schedule:${'A'.repeat(43)}:`,
        time: '2026-10-22T00:00:00.000000Z',
        publicMatchId: 'M'.repeat(43),
      }),
    ).toString('base64url');
    const res = await request(app.getHttpServer())
      .get(`/v1/public/events/${publicKey}/schedule`)
      .query({ cursor });
    expect(res.status).toBe(422);
    expect(connect).not.toHaveBeenCalled();
  });
  it('requires explicit rule fields and forbids caller identity before database access', async () => {
    const connect = vi.spyOn(pool, 'connect');
    const res = await request(app.getHttpServer())
      .put(
        '/v1/orgs/00000000-0000-0000-0000-000000000001/events/00000000-0000-0000-0000-000000000002/standings-rules',
      )
      .send({
        expectedEventVersion: 1,
        winPoints: 3,
        lossPoints: 0,
        drawPoints: 1,
        tiebreakers: [],
        actorId: 'forged-owner',
      });
    expect(res.status).toBe(422);
    expect(connect).not.toHaveBeenCalled();
  });
  it('uses HTTP200 for publication commands and preserves pagination metadata', async () => {
    vi.spyOn(service, 'publicViewingCommand').mockResolvedValueOnce({
      locked: true,
      standings: null,
    } as never);
    const post = await request(app.getHttpServer())
      .post(
        '/v1/orgs/00000000-0000-0000-0000-000000000001/events/00000000-0000-0000-0000-000000000002/public-viewing-commands',
      )
      .send({});
    expect(post.status).toBe(200);
    expect(post.body.data.standings).toBeNull();
    vi.spyOn(service, 'getPublicSchedule').mockResolvedValueOnce({
      data: [],
      nextCursor: 'public-only-cursor',
    });
    const get = await request(app.getHttpServer()).get(`/v1/public/events/${publicKey}/schedule`);
    expect(get.status).toBe(200);
    expect(get.body.meta.nextCursor).toBe('public-only-cursor');
  });
});
