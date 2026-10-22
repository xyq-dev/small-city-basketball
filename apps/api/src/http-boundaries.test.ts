import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from './app.js';

const options = {
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  appOrigin: 'http://127.0.0.1:5173',
};
const opened: Awaited<ReturnType<typeof createApi>>[] = [];

async function api() {
  const instance = await createApi(options);
  opened.push(instance);
  return instance.app.getHttpServer();
}

afterEach(async () => {
  for (const instance of opened.splice(0)) {
    await instance.app.close();
    await instance.pool.end();
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('无需数据库即可拒绝的HTTP边界', () => {
  it('所有写请求拒绝缺失或不匹配的Origin，并返回可追踪requestId', async () => {
    const server = await api();
    for (const origin of [undefined, 'https://attacker.example']) {
      const pending = request(server).post('/v1/auth/login');
      if (origin) pending.set('Origin', origin);
      const response = await pending.send({});
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ORIGIN_REJECTED');
      expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    }
  });

  it('畸形JSON返回400，不回显请求中的凭据', async () => {
    const response = await request(await api())
      .post('/v1/auth/login')
      .set('Origin', options.appOrigin)
      .set('Content-Type', 'application/json')
      .send('{"password":"private-marker",');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    expect(JSON.stringify(response.body)).not.toContain('private-marker');
  });

  it('超限JSON保持413，不泄露body或stack', async () => {
    const response = await request(await api())
      .post('/v1/auth/login')
      .set('Origin', options.appOrigin)
      .send({ password: 'private-marker'.repeat(20000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    expect(JSON.stringify(response.body)).not.toContain('private-marker');
    expect(response.body.error.stack).toBeUndefined();
  });

  it('字段错误使用契约中的details.fieldErrors且禁止夹带身份字段', async () => {
    const server = await api();
    const response = await request(server)
      .post('/v1/auth/login')
      .set('Origin', options.appOrigin)
      .send({ email: 'bad-email', password: 'valid-long-password' });
    expect(response.status).toBe(422);
    expect(response.body.error.details.fieldErrors.email).toBeTypeOf('string');
    expect(response.body.error.details.fields).toBeUndefined();
    const forged = await request(server)
      .post('/v1/auth/login')
      .set('Origin', options.appOrigin)
      .send({ email: 'user@example.test', password: 'valid-long-password', role: 'ORG_OWNER' });
    expect(forged.status).toBe(422);
  });

  it('生产HTTP来源配置失败，空闲数据库错误只记录固定文案', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(createApi(options)).rejects.toThrow('HTTPS');
    vi.stubEnv('NODE_ENV', 'test');
    const instance = await createApi(options);
    opened.push(instance);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    instance.pool.emit('error', new Error('postgresql://private:secret@example/production'));
    expect(log).toHaveBeenCalledExactlyOnceWith('Database idle connection error');
  });
});
