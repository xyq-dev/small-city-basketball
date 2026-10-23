import express from 'express';
import type { ErrorRequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requestBodyMiddleware, WECHAT_PAYMENT_NOTIFICATION_PATH } from './request-body.js';
import type { ApiRequest } from './errors.js';

const upload =
  '/v1/orgs/00000000-0000-4000-8000-000000000001/matches/00000000-0000-4000-8000-000000000002/media-files';
const failure: ErrorRequestHandler = (error: { status?: number }, _req, res, _next) => {
  res.sendStatus(error.status ?? 500);
};
function fixture() {
  const app = express();
  app.use(requestBodyMiddleware());
  app.post(/.*/, (req, res) => {
    res.json({
      length: JSON.stringify(req.body).length,
      raw: (req as ApiRequest).rawBody?.toString('utf8') ?? null,
    });
  });
  app.use(failure);
  return app;
}

describe('bounded request ingestion', () => {
  it('accepts a larger upload only at the dedicated route and keeps other writes at 100KiB', async () => {
    const app = fixture();
    const data = { base64: 'A'.repeat(200_000) };
    expect((await request(app).post(upload).send(data)).status).toBe(200);
    for (const path of ['/v1/auth/login', upload + '/commands', upload + '/anything']) {
      expect((await request(app).post(path).send(data)).status).toBe(413);
    }
    expect(
      (
        await request(app)
          .post(upload)
          .send({ base64: 'A'.repeat(12 * 1024 * 1024) })
      ).status,
    ).toBe(413);
  });
  it('captures webhook bytes exactly while ordinary requests retain no raw copy', async () => {
    const body = '{ "id" : "signature-dependent",\n"resource": {"a":1} }';
    const response = await request(fixture())
      .post(WECHAT_PAYMENT_NOTIFICATION_PATH)
      .type('json')
      .send(body);
    expect(response.status).toBe(200);
    expect(response.body.raw).toBe(body);
    expect(
      (await request(fixture()).post('/v1/auth/login').send({ password: 'synthetic' })).body.raw,
    ).toBeNull();
  });
  it('rejects compressed bodies instead of inflating untrusted compressed uploads', async () => {
    const { gzipSync } = await import('node:zlib');
    const response = await request(fixture())
      .post(upload)
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send(gzipSync('{"x":1}'));
    expect(response.status).toBe(415);
  });
  it('has no waiting upload queue and releases slots after responses finish', async () => {
    const app = express();
    app.use(requestBodyMiddleware());
    const pending: Array<() => void> = [];
    let entered = 0;
    let bothReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      bothReady = resolve;
    });
    app.post(upload, (_req, res) => {
      pending.push(() => res.sendStatus(200));
      if (++entered === 2) bothReady();
    });
    app.use(failure);
    const first = request(app)
      .post(upload)
      .send({ base64: 'AAAA' })
      .then((result) => result);
    const second = request(app)
      .post(upload)
      .send({ base64: 'AAAA' })
      .then((result) => result);
    await ready;
    const busy = await request(app).post(upload).send({ base64: 'AAAA' });
    expect(busy.status).toBe(429);
    expect(busy.body.error.code).toBe('UPLOAD_BUSY');
    expect(busy.headers['retry-after']).toBe('1');
    pending.splice(0).forEach((finish) => finish());
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    const third = request(app)
      .post(upload)
      .send({ base64: 'AAAA' })
      .then((result) => result);
    while (pending.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    pending.splice(0).forEach((finish) => finish());
    expect((await third).status).toBe(200);
  });
});
