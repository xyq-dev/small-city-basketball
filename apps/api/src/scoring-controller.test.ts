import 'reflect-metadata';
import { Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiExceptionFilter } from './errors.js';
import { ScoringController, SCB_SCORING_SERVICE } from './scoring-controller.js';
import { ScoringService } from './scoring-service.js';

const pool = new Pool({ connectionString: 'postgresql://unused:unused@127.0.0.1:1/unused' });
const service = new ScoringService(pool, {
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  appOrigin: 'http://localhost',
});
@Module({
  controllers: [ScoringController],
  providers: [{ provide: SCB_SCORING_SERVICE, useValue: service }],
})
class TransportModule {}
let app: INestApplication;
const prefix =
  '/v1/orgs/00000000-0000-0000-0000-000000000001/matches/00000000-0000-0000-0000-000000000002';
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

describe('scoring HTTP transport (without database)', () => {
  it('rejects forged command fields before opening a database transaction', async () => {
    const connect = vi.spyOn(pool, 'connect');
    const response = await request(app.getHttpServer())
      .post(`${prefix}/commands`)
      .send({
        commandId: '00000000-0000-0000-0000-000000000003',
        expectedVersion: 1,
        capturedAt: '2026-10-22T00:00:00Z',
        type: 'PREPARE_MATCH',
        payload: { expectedEventVersion: 1 },
        actorId: 'forged-owner',
      });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(connect).not.toHaveBeenCalled();
  });
  it('requires the complete DELETE control envelope before database access', async () => {
    const connect = vi.spyOn(pool, 'connect');
    const response = await request(app.getHttpServer())
      .delete(`${prefix}/scorekeeper-lease`)
      .send({ control: { fencingToken: '1' } });
    expect(response.status).toBe(422);
    expect(connect).not.toHaveBeenCalled();
  });
  it('returns commands as HTTP 200 and preserves original receipt versus current snapshot', async () => {
    const result = { receipt: { appliedVersion: 3 }, snapshot: { version: 7 } };
    vi.spyOn(service, 'executeCommand').mockResolvedValueOnce(result as never);
    const response = await request(app.getHttpServer()).post(`${prefix}/commands`).send({});
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(result);
    expect(response.body.data.receipt.appliedVersion).not.toBe(response.body.data.snapshot.version);
  });
});
