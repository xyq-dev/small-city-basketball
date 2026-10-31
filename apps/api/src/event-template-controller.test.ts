import request from 'supertest';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createApi } from './app.js';
import { EventTemplateService } from './event-template-service.js';
import { templatePresets } from './event-template-domain.js';

const origin = 'http://localhost:5173',
  org = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222',
  root = `/v1/orgs/${org}`;
const opened: Awaited<ReturnType<typeof createApi>>[] = [];
async function open() {
  const api = await createApi({
    databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
    appOrigin: origin,
  });
  opened.push(api);
  return api;
}
afterEach(async () => {
  for (const api of opened.splice(0)) {
    await api.app.close();
    await api.pool.end();
  }
  vi.restoreAllMocks();
});
describe('X03 registered template HTTP boundary without PostgreSQL', () => {
  test('exact Origin and strict caller/config fields reject before any database connection', async () => {
    const api = await open(),
      connect = vi.spyOn(api.pool, 'connect');
    for (const supplied of [undefined, 'https://attacker.invalid', origin + '/']) {
      const call = request(api.app.getHttpServer()).post(root + '/event-template-commands');
      if (supplied) call.set('Origin', supplied);
      const response = await call.send({});
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ORIGIN_REJECTED');
    }
    for (const body of [
      { type: 'INSTANTIATE', clientRequestId: id, actorId: id },
      {
        type: 'CREATE_TEMPLATE',
        clientRequestId: id,
        name: '模板',
        configuration: { ...templatePresets()[0]!.configuration, teams: [id] },
      },
    ]) {
      const response = await request(api.app.getHttpServer())
        .post(root + '/event-template-commands')
        .set('Origin', origin)
        .send(body);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(connect).not.toHaveBeenCalled();
  });
  test('registered catalog, command receipt, command and guide route to the scoped service', async () => {
    const api = await open(),
      marker = { value: 'synthetic-private-fixture' };
    const catalog = vi
        .spyOn(EventTemplateService.prototype, 'listTemplates')
        .mockResolvedValue(marker as never),
      execute = vi
        .spyOn(EventTemplateService.prototype, 'executeTemplate')
        .mockResolvedValue(marker as never),
      receipt = vi
        .spyOn(EventTemplateService.prototype, 'getTemplateReceipt')
        .mockResolvedValue(marker as never),
      guide = vi
        .spyOn(EventTemplateService.prototype, 'setupGuide')
        .mockResolvedValue(marker as never);
    for (const [method, path] of [
      ['get', root + '/event-templates'],
      ['post', root + '/event-template-commands'],
      ['get', root + '/event-template-commands/' + id],
      ['get', root + '/events/' + id + '/setup-guide'],
    ] as const) {
      const response = await request(api.app.getHttpServer())
        [method](path)
        .set('Origin', origin)
        .set('Cookie', 'scb.sid=synthetic')
        .send(method === 'post' ? { type: 'INSTANTIATE' } : undefined);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(marker);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(catalog).toHaveBeenCalledWith('scb.sid=synthetic', org);
    expect(execute).toHaveBeenCalledWith('scb.sid=synthetic', org, { type: 'INSTANTIATE' });
    expect(receipt).toHaveBeenCalledWith('scb.sid=synthetic', org, id);
    expect(guide).toHaveBeenCalledWith('scb.sid=synthetic', org, id);
  });
  test('malformed receipt IDs are rejected without looking up another resource', async () => {
    const api = await open(),
      connect = vi.spyOn(api.pool, 'connect');
    const response = await request(api.app.getHttpServer()).get(
      root + '/event-template-commands/not-a-uuid',
    );
    expect(response.status).toBe(404);
    expect(connect).not.toHaveBeenCalled();
  });
});
