import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Real-API checks for the native mini program: actual Page/utils code runs in the VM harness
// and every wx.request is forwarded to a real API on loopback, backed by an owned isolated
// PostgreSQL database. Never a production origin; the mini program's fixed origin is only
// rewritten inside this test transport.
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
export const programRoot = path.join(root, 'apps', 'wechat');
const { createWx, loadPage } = require(
  path.join(programRoot, 'test', 'helpers', 'native-page.cjs'),
);
export const APP_ORIGIN = 'https://basketball.playhubs.cn';
export const PASSWORD = 'Scb wechat real api 2026 合成';

export function isolatedBase() {
  let url;
  try {
    url = new URL(process.env.TEST_DATABASE_URL ?? '');
  } catch {
    throw new Error('Real-API mini program checks require TEST_DATABASE_URL (scb_test_*)');
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(name) ||
    process.env.NODE_ENV === 'production'
  )
    throw new Error('Real-API mini program checks require an isolated scb_test_* database');
  return url;
}

/** Owned database + migrated schema + real API on 127.0.0.1. */
export async function startServer() {
  const base = isolatedBase();
  const owned = `${decodeURIComponent(base.pathname.slice(1)).slice(0, 30)}_w_${randomBytes(6).toString('hex')}`;
  assert.match(owned, /^scb_test_[A-Za-z0-9_]+$/);
  const admin = new pg.Pool({ connectionString: base.href, max: 1 });
  await admin.query(`CREATE DATABASE "${owned}"`);
  const target = new URL(base);
  target.pathname = '/' + owned;
  const { migrate } = await import('../../apps/api/dist/database/migrate.js');
  const { createApi } = await import('../../apps/api/dist/app.js');
  const { bootstrapOwner } = await import('../../apps/api/dist/bootstrap-owner.js');
  const schemaPool = new pg.Pool({ connectionString: target.href, max: 1 });
  await migrate(schemaPool);
  await schemaPool.end();
  const instance = await createApi({
    databaseUrl: target.href,
    appOrigin: APP_ORIGIN,
    participantRegistrationEnabled: true,
  });
  await instance.app.listen(0, '127.0.0.1');
  const url = (await instance.app.getUrl()).replace('[::1]', '127.0.0.1');
  return {
    url,
    pool: instance.pool,
    bootstrapOwner: (body) => bootstrapOwner(instance.pool, body),
    async close() {
      await instance.app.close();
      await instance.pool.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS "${owned}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

/** Direct HTTP for steps that remain Web-only (event setup, scheduling, staff assignment). */
export function http(server) {
  return async function call(route, { method = 'GET', body, cookie, expect = [200, 201] } = {}) {
    const response = await fetch(server.url + route, {
      method,
      headers: {
        Origin: APP_ORIGIN,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => null);
    assert.ok(
      expect.includes(response.status),
      `${method} ${route} -> ${response.status} ${JSON.stringify(payload && payload.error)}`,
    );
    const set = response.headers.getSetCookie()[0];
    return {
      status: response.status,
      data: payload?.data,
      meta: payload?.meta,
      cookie: set?.split(';')[0],
    };
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One device: one wx double and one shared api client, so the session cookie carries across
 * every page this actor opens, exactly as a single mini program instance would.
 */
export function device(server) {
  const modalAnswers = [];
  const navigations = [];
  const drops = [];
  let inflight = 0;
  const wx = createWx({
    modalAnswers,
    async request(options) {
      assert.ok(options.url.startsWith(APP_ORIGIN + '/v1/'), 'unexpected origin ' + options.url);
      inflight++;
      try {
        const response = await fetch(server.url + options.url.slice(APP_ORIGIN.length), {
          method: options.method || 'GET',
          headers: options.header,
          body:
            options.data === undefined || (options.method || 'GET') === 'GET'
              ? undefined
              : JSON.stringify(options.data),
        });
        const cookies = response.headers.getSetCookie();
        const text = await response.text();
        // Simulate a lost response: the server applied the request, the device never heard.
        const drop = drops.findIndex((match) => match(options));
        if (drop >= 0) {
          drops.splice(drop, 1);
          throw new Error('response lost');
        }
        return {
          statusCode: response.status,
          header: cookies.length ? { 'Set-Cookie': cookies.join(', ') } : {},
          cookies,
          data: text ? JSON.parse(text) : null,
        };
      } finally {
        inflight--;
      }
    },
  });
  const original = { navigateTo: wx.navigateTo, redirectTo: wx.redirectTo };
  wx.navigateTo = (options) => {
    navigations.push(options.url);
    original.navigateTo(options);
  };
  wx.redirectTo = (options) => {
    navigations.push(options.url);
    original.redirectTo(options);
  };
  const apiFile = path.join(programRoot, 'utils', 'api.js');
  const first = loadPage({ root: programRoot, route: 'pages/account/index', wx });
  const apiModule = first.requireLocal('utils/api.js');
  const modules = { [apiFile]: apiModule };
  return {
    wx,
    modalAnswers,
    navigations,
    client: apiModule.getClient(),
    open(route, query = {}) {
      const h = loadPage({ root: programRoot, route, wx, modules });
      h.page.onLoad?.(query);
      h.page.onShow?.();
      return h;
    },
    /** Wait until the real network is idle and the page is not busy for several ticks. */
    async settle(h, timeout = 15000) {
      const started = Date.now();
      let quiet = 0;
      while (Date.now() - started < timeout) {
        await sleep(15);
        const busy = h && (h.page.data.busy === true || h.page.data.loading === true);
        quiet = inflight === 0 && wx.pendingRequests === 0 && !busy ? quiet + 1 : 0;
        if (quiet >= 4) return;
      }
      throw new Error(
        'Page did not settle: ' +
          JSON.stringify({ inflight, busy: h?.page.data.busy, loading: h?.page.data.loading }),
      );
    },
    dropNextResponse(match) {
      drops.push(match);
    },
    approve(count = 1) {
      for (let i = 0; i < count; i++) modalAnswers.push(true);
    },
  };
}

/** Sign in through the real account page, as a person would. */
export async function signIn(d, email, password = PASSWORD) {
  const account = d.open('pages/account/index');
  await d.settle(account);
  account.page.setData({ email, password });
  account.page.login();
  await d.settle(account);
  assert.equal(account.page.data.user?.email, email, account.page.data.message);
  return account;
}
export async function register(d, email, displayName) {
  const account = d.open('pages/account/index');
  await d.settle(account);
  assert.equal(account.page.data.canRegister, true, 'participant registration must be enabled');
  account.page.setData({ email, password: PASSWORD, displayName, registerMode: true });
  account.page.register();
  await d.settle(account);
  assert.equal(account.page.data.user?.email, email, account.page.data.message);
  return account;
}
export const tap = (dataset = {}, detail = {}) => ({ currentTarget: { dataset }, detail });
