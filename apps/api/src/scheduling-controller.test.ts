import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from './app.js';
import { SchedulingService } from './scheduling-service.js';

const origin = 'http://localhost:5173';
const prefix =
  '/v1/orgs/00000000-0000-0000-0000-000000000001/matches/00000000-0000-0000-0000-000000000002';
const opened: Awaited<ReturnType<typeof createApi>>[] = [];
async function open() {
  const result = await createApi({
    databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
    appOrigin: origin,
  });
  opened.push(result);
  return result;
}
afterEach(async () => {
  for (const a of opened.splice(0)) {
    await a.app.close();
    await a.pool.end();
  }
  vi.restoreAllMocks();
});

describe('rescheduling HTTP boundary without PostgreSQL', () => {
  it('requires the exact configured Origin before calling any write handler', async () => {
    const a = await open();
    const execute = vi.spyOn(SchedulingService.prototype, 'rescheduleMatch');
    const connect = vi.spyOn(a.pool, 'connect');
    for (const supplied of [undefined, 'https://attacker.invalid', `${origin}/`]) {
      const call = request(a.app.getHttpServer()).post(`${prefix}/reschedule-commands`);
      if (supplied) call.set('Origin', supplied);
      const response = await call.send({});
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ORIGIN_REJECTED');
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(execute).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects forged actor and caller-supplied duration before opening a database connection', async () => {
    const a = await open();
    const connect = vi.spyOn(a.pool, 'connect');
    const response = await request(a.app.getHttpServer())
      .post(`${prefix}/reschedule-commands`)
      .set('Origin', origin)
      .send({ type: 'RESCHEDULE', actorId: 'forged', endsAt: '2026-11-01T14:00:00Z' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(connect).not.toHaveBeenCalled();
  });

  it('routes both authenticated operations and keeps successful commands HTTP200/no-store', async () => {
    const a = await open();
    const data = { capabilities: { canReschedule: false }, history: [], historyLimit: 20 };
    const read = vi
      .spyOn(SchedulingService.prototype, 'getRescheduling')
      .mockResolvedValueOnce(data as never);
    const write = vi
      .spyOn(SchedulingService.prototype, 'rescheduleMatch')
      .mockResolvedValueOnce(data as never);
    for (const method of ['get', 'post'] as const) {
      const response = await request(a.app.getHttpServer())
        [method](`${prefix}/${method === 'get' ? 'rescheduling' : 'reschedule-commands'}`)
        .set('Origin', origin)
        .set('Cookie', 'scb.sid=test-session')
        .send(method === 'post' ? { type: 'RESCHEDULE' } : undefined);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(data);
      expect(response.body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(read).toHaveBeenCalledWith(
      'scb.sid=test-session',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
    );
    expect(write).toHaveBeenCalledWith(
      'scb.sid=test-session',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      { type: 'RESCHEDULE' },
    );
  });
});

describe('optimization preview HTTP boundary without PostgreSQL', () => {
  const url =
    '/v1/orgs/00000000-0000-0000-0000-000000000001/schedule-revisions/00000000-0000-0000-0000-000000000002/optimization-preview';
  it('rejects Origin and caller-supplied private fixtures before a DB connection', async () => {
    const a = await open();
    const connect = vi.spyOn(a.pool, 'connect');
    expect((await request(a.app.getHttpServer()).post(url).send({})).status).toBe(403);
    const invalid = await request(a.app.getHttpServer())
      .post(url)
      .set('Origin', origin)
      .send({ expectedEventVersion: 1, expectedRevisionVersion: 1, fixtures: [] });
    expect(invalid.status).toBe(422);
    expect(connect).not.toHaveBeenCalled();
  });
  it('returns a private HTTP200 envelope from the optimization service', async () => {
    const a = await open();
    const value = { algorithm: 'BALANCED_SEARCH_V1', allocations: [], status: 'PARTIAL' };
    const read = vi
      .spyOn(SchedulingService.prototype, 'previewOptimization')
      .mockResolvedValueOnce(value as never);
    const body = { expectedEventVersion: 1, expectedRevisionVersion: 2, preserveAssigned: true };
    const response = await request(a.app.getHttpServer())
      .post(url)
      .set('Origin', origin)
      .set('Cookie', 'scb.sid=test-session')
      .send(body);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(value);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(read).toHaveBeenCalledWith(
      'scb.sid=test-session',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      body,
    );
  });
});
