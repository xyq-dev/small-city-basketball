import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createApi } from '../apps/api/dist/app.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/^scb_test_[A-Za-z0-9_]+$/.test(new URL(databaseUrl).pathname.slice(1))) {
  throw new Error(
    'Database restart check requires TEST_DATABASE_URL with an isolated scb_test_* database',
  );
}
const stateFile = process.env.SCB_PERSISTENCE_FILE;
if (!stateFile)
  throw new Error('SCB_PERSISTENCE_FILE must be a private temporary file outside the repository');
const mode = process.argv[2];
if (!['capture', 'verify'].includes(mode)) throw new Error('Use capture or verify');
const instance = await createApi({ databaseUrl, appOrigin: 'http://127.0.0.1:5173' });
await instance.app.listen(0, '127.0.0.1');
const baseUrl = await instance.app.getUrl();
async function call(route, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(baseUrl + route, {
    method,
    headers: {
      Origin: 'http://127.0.0.1:5173',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(response.ok, `Restart check ${method} ${route} returned ${response.status}`);
  return { response, data: (await response.json()).data };
}
async function fingerprint() {
  const hash = createHash('sha256');
  for (const [table, order] of [
    ['users', 'id'],
    ['organizations', 'id'],
    ['organization_memberships', 'org_id,user_id'],
    ['sessions', 'id'],
    ['events', 'id'],
    ['event_staff', 'org_id,event_id,user_id'],
    ['audit_logs', 'id'],
    ['schema_migrations', 'name'],
  ]) {
    // Table and order names are fixed source constants; no request input is interpolated.
    const rows = await instance.pool.query(`SELECT * FROM ${table} ORDER BY ${order}`);
    hash.update(table + '\n' + JSON.stringify(rows.rows) + '\n');
  }
  return hash.digest('hex');
}
try {
  if (mode === 'capture') {
    const suffix = randomUUID();
    const registration = await call('/v1/auth/register', {
      method: 'POST',
      body: {
        email: `restart-${suffix}@example.test`,
        password: randomBytes(24).toString('base64url'),
        displayName: '重启验证员',
        organizationName: '隔离重启验证机构',
      },
    });
    const cookie = registration.response.headers.getSetCookie()[0]?.split(';')[0];
    assert.ok(cookie, 'Registration must create a server-side session');
    const orgId = registration.data.organizations[0].id;
    const created = await call(`/v1/orgs/${orgId}/events`, {
      method: 'POST',
      cookie,
      body: {
        name: `数据库重启验证-${suffix}`,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
      },
    });
    const state = {
      cookie,
      userId: registration.data.user.id,
      orgId,
      event: created.data,
      fingerprint: await fingerprint(),
    };
    await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
    console.log(
      'Captured an authenticated event and database fingerprint for the isolated restart check.',
    );
  } else {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    const session = await call('/v1/auth/session', { cookie: state.cookie });
    assert.equal(session.data.user.id, state.userId);
    const event = await call(`/v1/orgs/${state.orgId}/events/${state.event.id}`, {
      cookie: state.cookie,
    });
    assert.deepEqual(event.data, state.event);
    assert.equal(await fingerprint(), state.fingerprint);
    console.log(
      'PostgreSQL restart retained the session, event, versions, permissions, audit history and migration checksum.',
    );
  }
} finally {
  await instance.app.close();
  await instance.pool.end();
}
