import { Pool } from 'pg';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from './app.js';
import type { ApiOptions } from './service.js';
import { hashToken } from './security.js';

const options = {
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  appOrigin: 'http://localhost:5173',
};
const opened: Awaited<ReturnType<typeof createApi>>[] = [];
async function open(extra: Partial<ApiOptions> = {}) {
  const instance = await createApi({ ...options, ...extra });
  opened.push(instance);
  return instance;
}
afterEach(async () => {
  for (const a of opened.splice(0)) {
    await a.app.close();
    await a.pool.end();
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('runtime HTTP boundaries without PostgreSQL', () => {
  it('returns exactly two anonymous configuration capabilities and independently closes registration', async () => {
    const a = await open({
      organizationRegistrationEnabled: false,
      participantRegistrationEnabled: true,
    });
    const connect = vi.spyOn(a.pool, 'connect');
    const response = await request(a.app.getHttpServer())
      .get('/v1/auth/capabilities')
      .set('Cookie', 'scb.sid=private-marker');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      canRegisterOrganization: false,
      canRegisterParticipant: true,
    });
    expect(response.body.meta.requestId).toEqual(expect.any(String));
    expect(response.headers['cache-control']).toBe('no-store');
    const blocked = await request(a.app.getHttpServer())
      .post('/v1/auth/register')
      .set('Origin', options.appOrigin)
      .send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('REGISTRATION_DISABLED');
    expect(connect).not.toHaveBeenCalled();
    const other = await open({
      organizationRegistrationEnabled: true,
      participantRegistrationEnabled: false,
    });
    const part = await request(other.app.getHttpServer())
      .post('/v1/auth/register-participant')
      .set('Origin', options.appOrigin)
      .send({});
    expect(part.status).toBe(403);
    expect(part.body.error.code).toBe('REGISTRATION_DISABLED');
  });
  it('does not trust forwarded client identity by default', async () => {
    const a = await open();
    const query = vi.spyOn(a.pool, 'query').mockResolvedValue({ rows: [{ attempts: 1 }] } as never);
    for (const ip of ['198.51.100.1', '203.0.113.2'])
      expect(
        (
          await request(a.app.getHttpServer())
            .post('/v1/auth/register-participant')
            .set('Origin', options.appOrigin)
            .set('X-Forwarded-For', ip)
            .send({})
        ).status,
      ).toBe(422);
    const counters = query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO auth_rate_limits'),
    );
    expect(counters).toHaveLength(2);
    expect((counters[0]![1] as unknown as unknown[])[0]).toBe(
      (counters[1]![1] as unknown as unknown[])[0],
    );
  });
  it('with one trusted hop uses only the nearest forwarded address, leaving Web to overwrite the untrusted chain', async () => {
    const a = await open({ trustProxyHops: 1 });
    const query = vi.spyOn(a.pool, 'query').mockResolvedValue({ rows: [{ attempts: 1 }] } as never);
    for (const ip of ['198.51.100.1', '198.51.100.2'])
      expect(
        (
          await request(a.app.getHttpServer())
            .post('/v1/auth/register-participant')
            .set('Origin', options.appOrigin)
            .set('X-Forwarded-For', `${ip}, 203.0.113.9`)
            .send({})
        ).status,
      ).toBe(422);
    const counters = query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO auth_rate_limits'),
    );
    expect(counters).toHaveLength(2);
    for (const call of counters)
      expect((call[1] as unknown as unknown[])[0]).toBe(`register:${hashToken('203.0.113.9')}`);
  });
  it('returns fixed readiness503 and rejects production startup without a verified runtime database', async () => {
    const a = await open();
    vi.spyOn(a.pool, 'connect').mockImplementation(
      () => Promise.reject(new Error('private-url-marker')) as never,
    );
    const result = await request(a.app.getHttpServer()).get('/ready');
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(result.body.error.details).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain('private-url-marker');
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(Pool.prototype, 'connect').mockImplementation(
      () => Promise.reject(new Error('private-url-marker')) as never,
    );
    await expect(
      createApi({ ...options, appOrigin: 'https://example.test' }),
    ).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  });
});
