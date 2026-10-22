import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import {
  ORIGIN,
  PASSWORD,
  RUN_ID,
  auditCount,
  call,
  createEvent,
  data,
  error,
  eventInput,
  eventPath,
  eventsPath,
  eventually,
  login,
  membersPath,
  membership,
  register,
  sessionCookie,
  setCookies,
  staff,
  staffPath,
  testDatabaseUrl,
  tokenHash,
} from './support.js';
import type { Api, Event, User } from './support.js';

const databaseUrl = testDatabaseUrl();

describe('P02 HTTP + real PostgreSQL security boundaries', { concurrent: false }, () => {
  let api: Api;
  let ownerA: User;
  let ownerB: User;
  let manager: User;
  let reviewer: User;
  const openedApis: Api[] = [];

  async function openApi(
    options: { secureCookies?: boolean; registrationEnabled?: boolean } = {},
  ): Promise<Api> {
    const instance = await createApi({ databaseUrl, appOrigin: ORIGIN, ...options });
    openedApis.push(instance);
    return instance;
  }

  beforeAll(async () => {
    const migrationPool = new Pool({ connectionString: databaseUrl });
    try {
      const database = await migrationPool.query<{ name: string }>(
        'SELECT current_database() AS name',
      );
      expect(database.rows[0]?.name).toMatch(/^scb_test_[A-Za-z0-9_]+$/);
      await migrate(migrationPool);
    } finally {
      await migrationPool.end();
    }
    api = await openApi();
    ownerA = await register(api, 'owner-a');
    ownerB = await register(api, 'owner-b');
    manager = await register(api, 'manager');
    reviewer = await register(api, 'reviewer');
    await membership(api, ownerA, manager, 'EVENT_MANAGER');
    await membership(api, ownerA, reviewer, 'REVIEWER');
  }, 60000);

  afterAll(async () => {
    for (const instance of openedApis.reverse()) {
      await instance.app.close();
      await instance.pool.end();
    }
  }, 30000);

  test('health and session return public shapes; cookie tokens and passwords are only stored as hashes', async () => {
    const health = await call(api, 'get', '/health');
    expect(health.status).toBe(200);
    expect(JSON.stringify(health.body)).not.toMatch(
      /postgres(?:ql)?:|password|databaseUrl|token_hash/i,
    );
    const response = await call(api, 'get', '/v1/auth/session', { cookie: ownerA.cookie });
    const session = data<{ user: { id: string }; organizations: { id: string }[] }>(response);
    expect(session.user.id).toBe(ownerA.id);
    expect(session.organizations.some((org) => org.id === ownerA.orgId)).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/password|token|hash/i);
    const loggedIn = await call(api, 'post', '/v1/auth/login', {
      body: { email: ownerA.email.toUpperCase(), password: PASSWORD },
    });
    data(loggedIn);
    const cookie = sessionCookie(loggedIn);
    expect(cookie).toMatch(/^scb\.sid=[A-Za-z0-9_-]{43}$/);
    const cookieHeader = setCookies(loggedIn).find((value) => value.startsWith('scb.sid='))!;
    expect(cookieHeader).toMatch(/;\s*HttpOnly/i);
    expect(cookieHeader).toMatch(/;\s*SameSite=(Lax|Strict)/i);
    const stored = await api.pool.query<{ token_hash: string; password_hash: string }>(
      'SELECT s.token_hash, u.password_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1',
      [tokenHash(cookie)],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.token_hash).toBe(tokenHash(cookie));
    expect(stored.rows[0]!.password_hash).not.toContain(PASSWORD);
    const second = await api.pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [ownerB.id],
    );
    expect(second.rows[0]!.password_hash).not.toBe(stored.rows[0]!.password_hash);
  });

  test('secure cookie mode is explicit and disabling registration does not disable existing-user login', async () => {
    const locked = await openApi({ secureCookies: true, registrationEnabled: false });
    const response = await call(locked, 'post', '/v1/auth/login', {
      body: { email: ownerB.email, password: PASSWORD },
    });
    data(response);
    expect(setCookies(response).find((value) => value.startsWith('scb.sid='))).toMatch(
      /;\s*Secure/i,
    );
    const blocked = await call(locked, 'post', '/v1/auth/register', {
      body: {
        email: `disabled-${RUN_ID}@example.test`,
        password: PASSWORD,
        displayName: '停用注册',
        organizationName: '停用注册机构',
      },
    });
    error(blocked, 403);
    expect(setCookies(blocked)).toHaveLength(0);
  });

  test('all unsafe entry points require the exact configured Origin, including login and logout', async () => {
    const event = await createEvent(api, ownerA, 'Origin protected draft');
    const routes = [
      {
        method: 'post' as const,
        path: '/v1/auth/login',
        body: { email: ownerA.email, password: PASSWORD },
      },
      {
        method: 'post' as const,
        path: '/v1/auth/register',
        body: {
          email: `origin-${RUN_ID}@example.test`,
          password: PASSWORD,
          displayName: '来源',
          organizationName: '来源机构',
        },
      },
      { method: 'post' as const, path: '/v1/auth/logout', body: undefined },
      {
        method: 'post' as const,
        path: eventsPath(ownerA.orgId),
        body: eventInput('Origin blocked'),
      },
      {
        method: 'patch' as const,
        path: eventPath(ownerA.orgId, event.id),
        body: { ...eventInput('Origin blocked edit'), expectedVersion: event.version },
      },
      {
        method: 'put' as const,
        path: `${membersPath(ownerA.orgId)}/${manager.id}`,
        body: { role: 'EVENT_MANAGER', status: 'DISABLED' },
      },
      {
        method: 'put' as const,
        path: staffPath(ownerA.orgId, event.id, manager.id),
        body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
      },
    ];
    for (const origin of [null, 'https://attacker.example', `${ORIGIN}.attacker.example`]) {
      for (const route of routes) {
        const response = await call(api, route.method, route.path, {
          cookie: ownerA.cookie,
          body: route.body,
          origin,
        });
        error(response, 403);
        expect(setCookies(response)).toHaveLength(0);
      }
    }
    expect(
      data<Event>(
        await call(api, 'get', eventPath(ownerA.orgId, event.id), { cookie: ownerA.cookie }),
      ),
    ).toMatchObject({ name: event.name, version: event.version });
    data(await call(api, 'get', '/v1/auth/session', { cookie: ownerA.cookie }));
  });

  test('invalid credentials do not reveal account existence and forged cookies are rejected', async () => {
    const wrong = await call(api, 'post', '/v1/auth/login', {
      body: { email: ownerA.email, password: 'incorrect-password-2026' },
    });
    const absent = await call(api, 'post', '/v1/auth/login', {
      body: { email: `absent-${RUN_ID}@example.test`, password: 'incorrect-password-2026' },
    });
    error(wrong, 401);
    error(absent, 401);
    expect(wrong.body.error.code).toBe(absent.body.error.code);
    expect(wrong.body.error.message).toBe(absent.body.error.message);
    expect(setCookies(wrong)).toHaveLength(0);
    error(await call(api, 'get', '/v1/auth/session', { cookie: `scb.sid=${'A'.repeat(43)}` }), 401);
    error(await call(api, 'get', eventsPath(ownerA.orgId)), 401);
    error(
      await call(api, 'post', eventsPath(ownerA.orgId), { body: eventInput('Anonymous draft') }),
      401,
    );
  });

  test('logout revokes the old token and expiry is enforced without waiting for a browser cookie to expire', async () => {
    const cookie = await login(api, ownerB);
    const response = await call(api, 'post', '/v1/auth/logout', { cookie });
    expect(data(response)).toBeNull();
    expect(
      setCookies(response).some(
        (value) =>
          value.startsWith('scb.sid=') && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(value),
      ),
    ).toBe(true);
    error(await call(api, 'get', '/v1/auth/session', { cookie }), 401);
    const revoked = await api.pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM sessions WHERE token_hash = $1',
      [tokenHash(cookie)],
    );
    expect(revoked.rows[0]!.revoked_at).not.toBeNull();
    const expired = await login(api, ownerB);
    await api.pool.query(
      "UPDATE sessions SET created_at = clock_timestamp() - interval '2 minutes', expires_at = clock_timestamp() - interval '1 minute' WHERE token_hash = $1",
      [tokenHash(expired)],
    );
    error(await call(api, 'get', '/v1/auth/session', { cookie: expired }), 401);
    error(
      await call(api, 'post', eventsPath(ownerB.orgId), {
        cookie: expired,
        body: eventInput('Expired token draft'),
      }),
      401,
    );
  });

  test('cross-organization and unknown resources all return non-disclosing 404s', async () => {
    const secret = await createEvent(api, ownerA, 'Private A event not visible to B');
    const attempts = [
      call(api, 'get', eventsPath(ownerA.orgId), { cookie: ownerB.cookie }),
      call(api, 'get', eventPath(ownerA.orgId, secret.id), { cookie: ownerB.cookie }),
      call(api, 'get', eventPath(ownerB.orgId, secret.id), { cookie: ownerB.cookie }),
      call(api, 'get', eventPath(ownerB.orgId, randomUUID()), { cookie: ownerB.cookie }),
      call(api, 'post', eventsPath(ownerA.orgId), {
        cookie: ownerB.cookie,
        body: eventInput('Spoofed cross-org create'),
      }),
      call(api, 'patch', eventPath(ownerA.orgId, secret.id), {
        cookie: ownerB.cookie,
        body: { ...eventInput('Spoofed edit'), expectedVersion: secret.version },
      }),
      call(api, 'put', staffPath(ownerA.orgId, secret.id, ownerB.id), {
        cookie: ownerB.cookie,
        body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
      }),
      call(api, 'get', eventPath(ownerA.orgId, secret.id), {
        cookie: ownerB.cookie,
        headers: { 'X-Org-Id': ownerA.orgId, 'X-User-Id': ownerA.id, 'X-Role': 'ORG_OWNER' },
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      error(response, 404);
      expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
      expect(JSON.stringify(response.body)).not.toContain(secret.name);
      expect(JSON.stringify(response.body)).not.toContain(ownerA.email);
    }
  });

  test('JSON whitelists reject forged organization, status and actor attributes without creating or editing data', async () => {
    const event = await createEvent(api, ownerA, 'Whitelist unchanged');
    const auditBefore = await auditCount(api.pool, ownerA.orgId, event.id);
    for (const [field, value] of Object.entries({
      orgId: ownerB.orgId,
      status: 'RUNNING',
      actorId: ownerB.id,
      createdBy: ownerB.id,
    })) {
      const name = `forged-${field}-${RUN_ID.slice(0, 8)}`;
      error(
        await call(api, 'post', eventsPath(ownerA.orgId), {
          cookie: ownerA.cookie,
          body: { ...eventInput(name), [field]: value },
        }),
        422,
      );
      const found = data<Event[]>(
        await call(api, 'get', `${eventsPath(ownerA.orgId)}?q=${encodeURIComponent(name)}`, {
          cookie: ownerA.cookie,
        }),
      );
      expect(found).toHaveLength(0);
      error(
        await call(api, 'patch', eventPath(ownerA.orgId, event.id), {
          cookie: ownerA.cookie,
          body: { ...eventInput('forged edit'), expectedVersion: event.version, [field]: value },
        }),
        422,
      );
    }
    error(
      await call(api, 'put', `${membersPath(ownerA.orgId)}/${manager.id}`, {
        cookie: ownerA.cookie,
        body: { role: 'ORG_ADMIN', status: 'ACTIVE', actorId: ownerB.id },
      }),
      422,
    );
    error(
      await call(api, 'put', staffPath(ownerA.orgId, event.id, manager.id), {
        cookie: ownerA.cookie,
        body: { role: 'EVENT_MANAGER', status: 'ACTIVE', orgId: ownerB.orgId },
      }),
      422,
    );
    error(
      await call(api, 'post', '/v1/auth/login', {
        body: { email: ownerA.email, password: PASSWORD, role: 'ORG_OWNER' },
      }),
      422,
    );
    expect(
      data<Event>(
        await call(api, 'get', eventPath(ownerA.orgId, event.id), { cookie: ownerA.cookie }),
      ),
    ).toMatchObject({ name: event.name, version: event.version });
    expect(await auditCount(api.pool, ownerA.orgId, event.id)).toBe(auditBefore);
  });

  test('only OWNER manages existing-user membership and OWNER membership cannot be granted or changed', async () => {
    data(await call(api, 'get', membersPath(ownerA.orgId), { cookie: ownerA.cookie }));
    error(await call(api, 'get', membersPath(ownerA.orgId), { cookie: manager.cookie }), 403);
    error(
      await call(api, 'put', `${membersPath(ownerA.orgId)}/${reviewer.id}`, {
        cookie: manager.cookie,
        body: { role: 'ORG_ADMIN', status: 'ACTIVE' },
      }),
      403,
    );
    error(
      await call(api, 'put', `${membersPath(ownerA.orgId)}/${randomUUID()}`, {
        cookie: ownerA.cookie,
        body: { role: 'REVIEWER', status: 'ACTIVE' },
      }),
      404,
    );
    error(
      await call(api, 'put', `${membersPath(ownerA.orgId)}/${reviewer.id}`, {
        cookie: ownerA.cookie,
        body: { role: 'ORG_OWNER', status: 'ACTIVE' },
      }),
      422,
    );
    const existingOwner = await call(api, 'put', `${membersPath(ownerA.orgId)}/${ownerA.id}`, {
      cookie: ownerA.cookie,
      body: { role: 'ORG_ADMIN', status: 'DISABLED' },
    });
    error(existingOwner, 403);
    const owner = await api.pool.query<{ role: string; status: string }>(
      'SELECT role, status FROM organization_memberships WHERE org_id = $1 AND user_id = $2',
      [ownerA.orgId, ownerA.id],
    );
    expect(owner.rows).toEqual([{ role: 'ORG_OWNER', status: 'ACTIVE' }]);
    await membership(api, ownerA, ownerB, 'ORG_ADMIN');
    try {
      error(await call(api, 'get', membersPath(ownerA.orgId), { cookie: ownerB.cookie }), 403);
      const event = data<Event>(
        await call(api, 'post', eventsPath(ownerA.orgId), {
          cookie: ownerB.cookie,
          body: eventInput('Admin can create'),
        }),
        201,
      );
      expect(event.permissions.canEditDraft).toBe(true);
      data(
        await call(api, 'put', staffPath(ownerA.orgId, event.id, manager.id), {
          cookie: ownerB.cookie,
          body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
        }),
      );
    } finally {
      await membership(api, ownerA, ownerB, 'ORG_ADMIN', 'DISABLED');
    }
  });

  test('explicit event assignment controls list, detail, editing and per-event permissions', async () => {
    const event = await createEvent(api, ownerA, `Assignment ${RUN_ID.slice(0, 8)}`);
    const query = `${eventsPath(ownerA.orgId)}?q=${encodeURIComponent(event.name)}`;
    expect(data<Event[]>(await call(api, 'get', query, { cookie: manager.cookie }))).toEqual([]);
    error(
      await call(api, 'get', eventPath(ownerA.orgId, event.id), { cookie: manager.cookie }),
      404,
    );
    error(
      await call(api, 'patch', eventPath(ownerA.orgId, event.id), {
        cookie: manager.cookie,
        body: { ...eventInput('Unassigned'), expectedVersion: event.version },
      }),
      404,
    );
    error(
      await call(api, 'post', eventsPath(ownerA.orgId), {
        cookie: manager.cookie,
        body: eventInput('Manager create blocked'),
      }),
      403,
    );
    await staff(api, ownerA, event, manager, 'EVENT_MANAGER');
    await staff(api, ownerA, event, reviewer, 'REVIEWER');
    const assigned = data<Event[]>(await call(api, 'get', query, { cookie: manager.cookie }));
    expect(assigned.map((item) => item.id)).toEqual([event.id]);
    expect(assigned[0]!.permissions.canEditDraft).toBe(true);
    expect(
      data<Event>(
        await call(api, 'get', eventPath(ownerA.orgId, event.id), { cookie: reviewer.cookie }),
      ).permissions.canEditDraft,
    ).toBe(false);
    error(
      await call(api, 'patch', eventPath(ownerA.orgId, event.id), {
        cookie: reviewer.cookie,
        body: { ...eventInput('Reviewer edit blocked'), expectedVersion: event.version },
      }),
      403,
    );
    const edited = data<Event>(
      await call(api, 'patch', eventPath(ownerA.orgId, event.id), {
        cookie: manager.cookie,
        body: { ...eventInput('Assigned manager saved'), expectedVersion: event.version },
      }),
    );
    expect(edited).toMatchObject({
      name: 'Assigned manager saved',
      version: event.version + 1,
      permissions: { canEditDraft: true },
    });
    error(
      await call(api, 'put', staffPath(ownerA.orgId, event.id, ownerB.id), {
        cookie: ownerA.cookie,
        body: { role: 'REVIEWER', status: 'ACTIVE' },
      }),
      404,
    );
  });

  test('staff and membership revocation take effect immediately for old cookies', async () => {
    const event = await createEvent(api, ownerA, 'Revoked assignment');
    await staff(api, ownerA, event, manager, 'EVENT_MANAGER');
    data(await call(api, 'get', eventPath(ownerA.orgId, event.id), { cookie: manager.cookie }));
    await staff(api, ownerA, event, manager, 'EVENT_MANAGER', 'DISABLED');
    error(
      await call(api, 'get', eventPath(ownerA.orgId, event.id), { cookie: manager.cookie }),
      404,
    );
    error(
      await call(api, 'patch', eventPath(ownerA.orgId, event.id), {
        cookie: manager.cookie,
        body: { ...eventInput('Revoked staff write'), expectedVersion: event.version },
      }),
      404,
    );
    await staff(api, ownerA, event, manager, 'EVENT_MANAGER');
    await membership(api, ownerA, manager, 'EVENT_MANAGER', 'DISABLED');
    try {
      error(await call(api, 'get', eventsPath(ownerA.orgId), { cookie: manager.cookie }), 404);
      error(
        await call(api, 'patch', eventPath(ownerA.orgId, event.id), {
          cookie: manager.cookie,
          body: { ...eventInput('Revoked member write'), expectedVersion: event.version },
        }),
        404,
      );
      const session = data<{ organizations: { id: string }[] }>(
        await call(api, 'get', '/v1/auth/session', { cookie: manager.cookie }),
      );
      expect(session.organizations.map((org) => org.id)).not.toContain(ownerA.orgId);
    } finally {
      await membership(api, ownerA, manager, 'EVENT_MANAGER');
    }
  });

  test('disabled users and organizations invalidate existing session access on the next request', async () => {
    await api.pool.query("UPDATE users SET status = 'DISABLED' WHERE id = $1", [reviewer.id]);
    try {
      error(await call(api, 'get', '/v1/auth/session', { cookie: reviewer.cookie }), 401);
      error(
        await call(api, 'post', eventsPath(reviewer.orgId), {
          cookie: reviewer.cookie,
          body: eventInput('Disabled user'),
        }),
        401,
      );
    } finally {
      await api.pool.query("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [reviewer.id]);
    }
    await api.pool.query("UPDATE organizations SET status = 'DISABLED' WHERE id = $1", [
      ownerB.orgId,
    ]);
    try {
      error(await call(api, 'get', eventsPath(ownerB.orgId), { cookie: ownerB.cookie }), 404);
      error(
        await call(api, 'post', eventsPath(ownerB.orgId), {
          cookie: ownerB.cookie,
          body: eventInput('Disabled org'),
        }),
        404,
      );
    } finally {
      await api.pool.query("UPDATE organizations SET status = 'ACTIVE' WHERE id = $1", [
        ownerB.orgId,
      ]);
    }
  });

  test('server validates calendar dates, Unicode codepoint limits, optional venue and draft state', async () => {
    const invalidInputs = [
      { name: ' ' },
      { name: '🏀'.repeat(81) },
      { venueName: '场'.repeat(101) },
      { startDate: '2027-02-29', endDate: '2027-03-01' },
      { startDate: '2028-02-30', endDate: '2028-03-01' },
      { startDate: '0000-01-01' },
      { startDate: '２０２８-02-28' },
      { startDate: '2028-2-28' },
      { startDate: '2028-03-01', endDate: '2028-02-29' },
      { timezone: 'UTC' },
      { format: 'UNRECOGNIZED' },
    ];
    for (const overrides of invalidInputs) {
      error(
        await call(api, 'post', eventsPath(ownerA.orgId), {
          cookie: ownerA.cookie,
          body: eventInput('Invalid input', overrides),
        }),
        422,
      );
    }
    const unicode = data<Event>(
      await call(api, 'post', eventsPath(ownerA.orgId), {
        cookie: ownerA.cookie,
        body: eventInput(`  ${'🏀'.repeat(80)}  `, { venueName: ' ' }),
      }),
      201,
    );
    expect(unicode.name).toBe('🏀'.repeat(80));
    expect(unicode.venueName).toBeNull();
    expect(unicode).toMatchObject({ startDate: '2028-02-28', endDate: '2028-02-29' });
    for (const expectedVersion of [undefined, 0, -1, '1', 1.5, 2147483648]) {
      error(
        await call(api, 'patch', eventPath(ownerA.orgId, unicode.id), {
          cookie: ownerA.cookie,
          body: { ...eventInput('Invalid version'), expectedVersion },
        }),
        422,
      );
    }
    await api.pool.query("UPDATE events SET status = 'RUNNING' WHERE id = $1 AND org_id = $2", [
      unicode.id,
      ownerA.orgId,
    ]);
    const running = data<Event>(
      await call(api, 'get', eventPath(ownerA.orgId, unicode.id), { cookie: ownerA.cookie }),
    );
    expect(running.permissions.canEditDraft).toBe(false);
    error(
      await call(api, 'patch', eventPath(ownerA.orgId, unicode.id), {
        cookie: ownerA.cookie,
        body: { ...eventInput('Cannot edit running'), expectedVersion: unicode.version },
      }),
      422,
    );
    expect(
      data<Event>(
        await call(api, 'get', eventPath(ownerA.orgId, unicode.id), { cookie: ownerA.cookie }),
      ),
    ).toMatchObject({ name: unicode.name, version: unicode.version, status: 'RUNNING' });
  });

  test('registration validates password Unicode codepoints and never accepts privileged extra fields', async () => {
    for (const password of ['短'.repeat(11), '🏀'.repeat(129)]) {
      error(
        await call(api, 'post', '/v1/auth/register', {
          body: {
            email: `invalid-${randomUUID()}@example.test`,
            password,
            displayName: '测试',
            organizationName: '测试机构',
          },
        }),
        422,
      );
    }
    error(
      await call(api, 'post', '/v1/auth/register', {
        body: {
          email: `extra-${RUN_ID}@example.test`,
          password: PASSWORD,
          displayName: '测试',
          organizationName: '测试机构',
          role: 'ORG_ADMIN',
        },
      }),
      422,
    );
    const unicodePassword = '🏀'.repeat(12);
    const user = await register(api, 'unicode-password', unicodePassword);
    await login(api, user, unicodePassword);
  });

  test('simultaneous writes with the same expectedVersion have one commit, one conflict and one audit record', async () => {
    const event = await createEvent(api, ownerA, 'Concurrent CAS');
    const before = await auditCount(api.pool, ownerA.orgId, event.id);
    const responses = await Promise.all(
      ['CAS winner A', 'CAS winner B'].map((name) =>
        call(api, 'patch', eventPath(ownerA.orgId, event.id), {
          cookie: ownerA.cookie,
          body: { ...eventInput(name), expectedVersion: event.version },
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = data<Event>(responses.find((response) => response.status === 200)!);
    error(
      responses.find((response) => response.status === 409)!,
      409,
    );
    const persisted = data<Event>(
      await call(api, 'get', eventPath(ownerA.orgId, event.id), { cookie: ownerA.cookie }),
    );
    expect(persisted).toMatchObject({ name: winner.name, version: event.version + 1 });
    expect(await auditCount(api.pool, ownerA.orgId, event.id)).toBe(before + 1);
  });

  test('pagination is stable, filters before pagination and binds cursors to organization and filters', async () => {
    const prefix = `page-${RUN_ID.slice(0, 10)}`;
    const created: Event[] = [];
    for (let index = 0; index < 5; index++)
      created.push(await createEvent(api, ownerA, `${prefix}-${index}`));
    // Identical timestamps exercise the documented secondary UUID ordering.
    await api.pool.query(
      'UPDATE events SET created_at = $1 WHERE org_id = $2 AND id = ANY($3::uuid[])',
      ['2026-01-01T00:00:00.000Z', ownerA.orgId, created.map((event) => event.id)],
    );
    const expected = created
      .map((event) => event.id)
      .sort()
      .reverse();
    const base = `${eventsPath(ownerA.orgId)}?q=${prefix}&status=DRAFT&limit=2`;
    const first = await call(api, 'get', base, { cookie: ownerA.cookie });
    const firstPage = data<Event[]>(first);
    const cursor = first.body.meta.nextCursor as string;
    expect(cursor).toEqual(expect.any(String));
    expect(cursor.length).toBeGreaterThan(0);
    const repeated = await call(api, 'get', base, { cookie: ownerA.cookie });
    expect(data<Event[]>(repeated).map((event) => event.id)).toEqual(
      firstPage.map((event) => event.id),
    );
    expect(repeated.body.meta.nextCursor).toBe(cursor);
    const seen = firstPage.map((event) => event.id);
    let next: string | null | undefined = cursor;
    for (let pages = 0; next && pages < 5; pages++) {
      const response = await call(api, 'get', `${base}&cursor=${encodeURIComponent(next)}`, {
        cookie: ownerA.cookie,
      });
      seen.push(...data<Event[]>(response).map((event) => event.id));
      next = response.body.meta.nextCursor;
    }
    expect(next ?? null).toBeNull();
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(5);
    for (const path of [
      `${eventsPath(ownerA.orgId)}?q=different&status=DRAFT&limit=2&cursor=${cursor}`,
      `${eventsPath(ownerA.orgId)}?q=${prefix}&status=RUNNING&limit=2&cursor=${cursor}`,
      `${base}&cursor=not_a_valid_cursor`,
      `${eventsPath(ownerA.orgId)}?limit=0`,
      `${eventsPath(ownerA.orgId)}?limit=101`,
      `${eventsPath(ownerA.orgId)}?status=UNKNOWN`,
      `${eventsPath(ownerA.orgId)}?unexpected=true`,
    ])
      error(await call(api, 'get', path, { cookie: ownerA.cookie }), 422);
    error(
      await call(
        api,
        'get',
        `${eventsPath(ownerB.orgId)}?q=${prefix}&status=DRAFT&limit=2&cursor=${cursor}`,
        { cookie: ownerB.cookie },
      ),
      422,
    );
    // A member sees its authorized subset before limit/cursor are applied.
    await staff(api, ownerA, created[0]!, reviewer, 'REVIEWER');
    await staff(api, ownerA, created[4]!, reviewer, 'REVIEWER');
    const memberFirst = await call(api, 'get', `${eventsPath(ownerA.orgId)}?q=${prefix}&limit=1`, {
      cookie: reviewer.cookie,
    });
    const memberSeen = data<Event[]>(memberFirst).map((event) => event.id);
    const memberNext = memberFirst.body.meta.nextCursor as string;
    expect(memberNext).toEqual(expect.any(String));
    const memberSecond = await call(
      api,
      'get',
      `${eventsPath(ownerA.orgId)}?q=${prefix}&limit=1&cursor=${memberNext}`,
      { cookie: reviewer.cookie },
    );
    memberSeen.push(...data<Event[]>(memberSecond).map((event) => event.id));
    expect(memberSeen.sort()).toEqual([created[0]!.id, created[4]!.id].sort());
    expect(memberSecond.body.meta.nextCursor ?? null).toBeNull();
  });

  test('migration replay is a no-op and preserves existing sessions, events and audit history', async () => {
    const event = await createEvent(api, ownerA, 'Migration persistence');
    const auditBefore = await auditCount(api.pool, ownerA.orgId, event.id);
    expect(await migrate(api.pool)).toEqual([]);
    expect(await migrate(api.pool)).toEqual([]);
    expect(
      data<Event>(
        await call(api, 'get', eventPath(ownerA.orgId, event.id), { cookie: ownerA.cookie }),
      ),
    ).toMatchObject({ id: event.id, version: event.version });
    expect(await auditCount(api.pool, ownerA.orgId, event.id)).toBe(auditBefore);
    data(await call(api, 'get', '/v1/auth/session', { cookie: ownerA.cookie }));
  });

  test('a database audit insertion failure rolls back the business update and hides database details', async () => {
    const event = await createEvent(api, ownerA, 'Audit rollback original');
    const count = await auditCount(api.pool, ownerA.orgId, event.id);
    const identifier = `scb_test_audit_${randomUUID().replaceAll('-', '')}`;
    // Identifiers are locally generated hex. Values are validated UUIDs, not request text.
    for (const id of [ownerA.orgId, event.id]) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await api.pool.query(
      `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.org_id::text = TG_ARGV[0] AND NEW.resource_id::text = TG_ARGV[1] THEN RAISE EXCEPTION 'scb integration audit failure'; END IF; RETURN NEW; END $$`,
    );
    try {
      await api.pool.query(
        `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}('${ownerA.orgId}', '${event.id}')`,
      );
      const failed = await call(api, 'patch', eventPath(ownerA.orgId, event.id), {
        cookie: ownerA.cookie,
        body: { ...eventInput('Audit should roll back'), expectedVersion: event.version },
      });
      error(failed, 500);
      expect(JSON.stringify(failed.body)).not.toMatch(
        /audit_logs|scb integration|RAISE|postgres|SQLSTATE/i,
      );
      const unchanged = data<Event>(
        await call(api, 'get', eventPath(ownerA.orgId, event.id), { cookie: ownerA.cookie }),
      );
      expect(unchanged).toMatchObject({
        name: event.name,
        version: event.version,
        updatedAt: event.updatedAt,
      });
      expect(await auditCount(api.pool, ownerA.orgId, event.id)).toBe(count);
    } finally {
      await api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
      await api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
    }
    data(
      await call(api, 'patch', eventPath(ownerA.orgId, event.id), {
        cookie: ownerA.cookie,
        body: { ...eventInput('Audit recovered'), expectedVersion: event.version },
      }),
    );
  });

  test('in-flight event writes serialize with membership revocation using actual PostgreSQL locks', async () => {
    const event = await createEvent(api, ownerA, 'Revocation lock original');
    await staff(api, ownerA, event, manager, 'EVENT_MANAGER');
    let blocker: PoolClient | undefined;
    let patch: ReturnType<typeof call> | undefined;
    let revoke: ReturnType<typeof call> | undefined;
    let released = false;
    try {
      blocker = await api.pool.connect();
      await blocker.query('BEGIN');
      const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      await blocker.query('SELECT id FROM events WHERE org_id = $1 AND id = $2 FOR UPDATE', [
        ownerA.orgId,
        event.id,
      ]);
      // call() is async and assimilates the supertest thenable immediately.
      patch = call(api, 'patch', eventPath(ownerA.orgId, event.id), {
        cookie: manager.cookie,
        body: { ...eventInput('In-flight write before revoke'), expectedVersion: event.version },
      });
      const blocked = await eventually(
        async () => {
          const result = await api.pool.query<{ pid: number }>(
            'SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND $2::int = ANY(pg_blocking_pids(pid))',
            [`scb_security_${RUN_ID}`, pid],
          );
          return result.rows;
        },
        (rows) => rows.length === 1,
        'Manager PATCH never waited on the externally locked event row',
      );
      const patchPid = blocked[0]!.pid;
      revoke = call(api, 'put', `${membersPath(ownerA.orgId)}/${manager.id}`, {
        cookie: ownerA.cookie,
        body: { role: 'EVENT_MANAGER', status: 'DISABLED' },
      });
      await eventually(
        async () => {
          const result = await api.pool.query<{ pid: number }>(
            'SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND $2::int = ANY(pg_blocking_pids(pid))',
            [`scb_security_${RUN_ID}`, patchPid],
          );
          return result.rows;
        },
        (rows) => rows.length === 1,
        'Membership revocation did not wait for the in-flight writer membership lock',
      );
      await blocker.query('COMMIT');
      released = true;
      const saved = data<Event>(await patch);
      expect(saved).toMatchObject({
        name: 'In-flight write before revoke',
        version: event.version + 1,
      });
      data(await revoke);
      error(
        await call(api, 'patch', eventPath(ownerA.orgId, event.id), {
          cookie: manager.cookie,
          body: { ...eventInput('After revoke must fail'), expectedVersion: saved.version },
        }),
        404,
      );
      expect(
        data<Event>(
          await call(api, 'get', eventPath(ownerA.orgId, event.id), { cookie: ownerA.cookie }),
        ),
      ).toMatchObject({ name: saved.name, version: saved.version });
    } finally {
      if (blocker) {
        if (!released) await blocker.query('ROLLBACK');
        blocker.release();
      }
      await Promise.allSettled([patch, revoke].filter((pending) => pending !== undefined));
      await membership(api, ownerA, manager, 'EVENT_MANAGER');
    }
  }, 30000);

  test('new application instances retain persisted sessions and events', async () => {
    const event = await createEvent(api, ownerA, 'Second application persistence');
    const second = await openApi();
    const session = data<{ user: { id: string } }>(
      await call(second, 'get', '/v1/auth/session', { cookie: ownerA.cookie }),
    );
    expect(session.user.id).toBe(ownerA.id);
    expect(
      data<Event>(
        await call(second, 'get', eventPath(ownerA.orgId, event.id), { cookie: ownerA.cookie }),
      ),
    ).toMatchObject({ id: event.id, name: event.name, version: event.version });
  });

  test('repeated failed logins are rate limited and include Retry-After', async () => {
    let limited = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const response = await call(api, 'post', '/v1/auth/login', {
        body: { email: `ratelimit-${RUN_ID}@example.test`, password: 'wrong-password-2026' },
      });
      if (response.status === 429) {
        error(response, 429);
        expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
        expect(setCookies(response)).toHaveLength(0);
        limited = true;
        break;
      }
      error(response, 401);
    }
    expect(limited).toBe(true);
  }, 30000);
});
