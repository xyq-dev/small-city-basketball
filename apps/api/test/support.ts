import { createHash, randomUUID } from 'node:crypto';
import { Agent } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import type { Pool } from 'pg';
import type { INestApplication } from '@nestjs/common';
import { expect } from 'vitest';

export const ORIGIN = 'http://localhost:5173';
export const RUN_ID = randomUUID().replaceAll('-', '');
// Each isolated Vitest file owns a real loopback source address. Larger suites
// must not spend another file's login-IP budget. This changes TCP binding only:
// production limits, account limits and forwarded-header handling stay intact.
const clientAddress = `127.${[0, 2, 4].map((offset) => 1 + (parseInt(RUN_ID.slice(offset, offset + 2), 16) % 254)).join('.')}`;
const clientAgent = new Agent({ localAddress: clientAddress, keepAlive: false });
export const PASSWORD = 'Scb integration password 🏀 2026';

// Fail closed before creating a pool. These tests intentionally create schema,
// sessions, and narrowly scoped rollback triggers in an isolated real database.
export function testDatabaseUrl(value = process.env.TEST_DATABASE_URL): string {
  if (!value) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(database)
  ) {
    throw new Error('Integration tests require a PostgreSQL database named scb_test_*');
  }
  url.searchParams.set('application_name', `scb_security_${RUN_ID}`);
  return url.toString();
}

export interface Api {
  app: INestApplication;
  pool: Pool;
}
export type Method = 'get' | 'post' | 'put' | 'patch';
export interface CallOptions {
  cookie?: string;
  body?: string | object;
  origin?: string | null;
  headers?: Record<string, string>;
}

export async function call(
  api: Api,
  method: Method,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  let pending = request(api.app.getHttpServer())[method](path).agent(clientAgent);
  if (method !== 'get' && options.origin !== null)
    pending = pending.set('Origin', options.origin ?? ORIGIN);
  if (options.cookie) pending = pending.set('Cookie', options.cookie);
  if (options.headers) pending = pending.set(options.headers);
  if (options.body !== undefined) pending = pending.send(options.body);
  return pending;
}

export function data<T>(response: Response, status = 200): T {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(response.body.meta?.requestId).toEqual(expect.any(String));
  expect(response.body.meta.requestId.length).toBeGreaterThan(0);
  expect(response.body).not.toHaveProperty('error');
  return response.body.data as T;
}

export function error(response: Response, status: number): void {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(response.body.error).toMatchObject({
    code: expect.any(String),
    message: expect.any(String),
    requestId: expect.any(String),
  });
  expect(response.body.error.requestId.length).toBeGreaterThan(0);
  expect(response.body).not.toHaveProperty('data');
}

export function setCookies(response: Response): string[] {
  const values = response.headers['set-cookie'] as string[] | string | undefined;
  return values === undefined ? [] : Array.isArray(values) ? values : [values];
}

export function sessionCookie(response: Response): string {
  const cookie = setCookies(response).find((value) => value.startsWith('scb.sid='));
  expect(cookie).toBeDefined();
  return cookie!.split(';')[0]!;
}

export function tokenHash(cookie: string): string {
  return createHash('sha256').update(cookie.slice('scb.sid='.length)).digest('hex');
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  cookie: string;
}

export async function register(api: Api, label: string, password = PASSWORD): Promise<User> {
  const email = `${label}-${RUN_ID}@example.test`;
  const response = await call(api, 'post', '/v1/auth/register', {
    body: {
      email,
      password,
      displayName: `测试 ${label}`,
      organizationName: `机构 ${label} ${RUN_ID.slice(0, 8)}`,
    },
  });
  const session = data<{
    user: { id: string; email: string };
    organizations: { id: string; role: string }[];
  }>(response, 201);
  expect(session.user.email).toBe(email);
  expect(session.organizations).toHaveLength(1);
  expect(session.organizations[0]!.role).toBe('ORG_OWNER');
  return {
    id: session.user.id,
    orgId: session.organizations[0]!.id,
    email,
    cookie: sessionCookie(response),
  };
}

export async function login(api: Api, user: User, password = PASSWORD): Promise<string> {
  const response = await call(api, 'post', '/v1/auth/login', {
    body: { email: user.email, password },
  });
  data(response);
  return sessionCookie(response);
}

export interface Event {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  venueName: string | null;
  format: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  permissions: { canEditDraft: boolean };
}

export function eventInput(
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    startDate: '2028-02-28',
    endDate: '2028-02-29',
    timezone: 'Asia/Shanghai',
    format: 'ROUND_ROBIN',
    venueName: '第一体育馆',
    ...overrides,
  };
}

export const eventsPath = (orgId: string): string => `/v1/orgs/${orgId}/events`;
export const eventPath = (orgId: string, eventId: string): string =>
  `${eventsPath(orgId)}/${eventId}`;
export const membersPath = (orgId: string): string => `/v1/orgs/${orgId}/members`;
export const staffPath = (orgId: string, eventId: string, userId: string): string =>
  `${eventPath(orgId, eventId)}/staff/${userId}`;

export async function createEvent(api: Api, owner: User, name: string): Promise<Event> {
  const result = data<Event>(
    await call(api, 'post', eventsPath(owner.orgId), {
      cookie: owner.cookie,
      body: eventInput(name),
    }),
    201,
  );
  expect(result).toMatchObject({
    name,
    status: 'DRAFT',
    version: 1,
    permissions: { canEditDraft: true },
  });
  return result;
}

export async function membership(
  api: Api,
  owner: User,
  member: User,
  role: string,
  status = 'ACTIVE',
): Promise<void> {
  data(
    await call(api, 'put', `${membersPath(owner.orgId)}/${member.id}`, {
      cookie: owner.cookie,
      body: { role, status },
    }),
  );
}

export async function staff(
  api: Api,
  owner: User,
  event: Event,
  member: User,
  role: string,
  status = 'ACTIVE',
): Promise<void> {
  data(
    await call(api, 'put', staffPath(owner.orgId, event.id, member.id), {
      cookie: owner.cookie,
      body: { role, status },
    }),
  );
}

export async function auditCount(pool: Pool, orgId: string, resourceId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM audit_logs WHERE org_id = $1 AND resource_id = $2',
    [orgId, resourceId],
  );
  return result.rows[0]!.count;
}

export async function eventually<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  message: string,
  timeout = 8000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (matches(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error(message);
}
