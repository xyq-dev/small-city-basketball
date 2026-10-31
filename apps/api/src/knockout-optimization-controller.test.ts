import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from './app.js';
import { KnockoutService } from './knockout-service.js';
const origin = 'http://localhost:5173';
const org = '00000000-0000-4000-8000-000000000001',
  event = '00000000-0000-4000-8000-000000000002';
const paths = ['knockout-optimization-preview', 'group-optimization-preview'];
const opened: Awaited<ReturnType<typeof createApi>>[] = [];
async function open() {
  const a = await createApi({
    databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
    appOrigin: origin,
  });
  opened.push(a);
  return a;
}
afterEach(async () => {
  for (const a of opened.splice(0)) {
    await a.app.close();
    await a.pool.end();
  }
  vi.restoreAllMocks();
});
describe('next-round optimization HTTP security boundary', () => {
  it.each(paths)('%s refuses cross-origin previews before any source read', async (suffix) => {
    const a = await open(),
      execute = vi.spyOn(KnockoutService.prototype, 'previewNextRoundOptimization'),
      connect = vi.spyOn(a.pool, 'connect');
    const r = await request(a.app.getHttpServer())
      .post(`/v1/orgs/${org}/events/${event}/${suffix}`)
      .set('Origin', 'https://attacker.invalid')
      .send({});
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ORIGIN_REJECTED');
    expect(execute).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(paths)(
    '%s rejects caller-provided entrants and stale malformed proof hashes',
    async (suffix) => {
      const a = await open(),
        connect = vi.spyOn(a.pool, 'connect');
      for (const body of [
        { expectedEventVersion: 1, fixtures: [{ homeEntryId: org }] },
        { expectedEventVersion: 1, expectedSourceHash: 'fake' },
      ]) {
        const r = await request(a.app.getHttpServer())
          .post(`/v1/orgs/${org}/events/${event}/${suffix}`)
          .set('Origin', origin)
          .send(body);
        expect(r.status).toBe(422);
      }
      expect(connect).not.toHaveBeenCalled();
    },
  );
  it.each(paths)(
    '%s keeps event scope and cookie on the authoritative service call',
    async (suffix) => {
      const a = await open();
      const body = { expectedEventVersion: 1 };
      const execute = vi
        .spyOn(KnockoutService.prototype, 'previewNextRoundOptimization')
        .mockResolvedValue({ status: 'WAITING_FOR_RESULTS', eventVersion: 1, revisionVersion: 2 });
      const r = await request(a.app.getHttpServer())
        .post(`/v1/orgs/${org}/events/${event}/${suffix}`)
        .set('Origin', origin)
        .set('Cookie', 'scb.sid=synthetic')
        .send(body);
      expect(r.status).toBe(200);
      expect(r.body.data.status).toBe('WAITING_FOR_RESULTS');
      expect(execute).toHaveBeenCalledWith('scb.sid=synthetic', org, event, body);
    },
  );
});
