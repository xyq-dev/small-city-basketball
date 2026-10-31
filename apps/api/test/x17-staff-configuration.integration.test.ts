import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHarness, closeHarness } from './p04-support.js';
import type { Harness } from './p04-support.js';
import { call, data, error, eventInput, login, eventually, tokenHash } from './support.js';

describe('X17 staff configuration real PostgreSQL permissions and receipts', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness(2);
  }, 60000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  }, 30000);
  const base = () => `/v1/orgs/${h.owner.orgId}/staff-configuration`;
  const send = (body: object, cookie = h.owner.cookie) =>
    call(h.api, 'post', base() + '/commands', { cookie, body });
  async function person() {
    const id = randomUUID(),
      email = `staff-${id}@example.test`;
    await h.api.pool.query(
      'INSERT INTO users(id,email,display_name,password_hash) SELECT $1,$2,$3,password_hash FROM users WHERE id=$4',
      [id, email, '合成工作人员', h.owner.id],
    );
    const session = await login(h.api, { id, email, orgId: '', cookie: '' });
    return { id, cookie: session };
  }
  const member = (userId: string) => ({
    clientRequestId: randomUUID(),
    type: 'MEMBER',
    userId,
    eventId: null,
    role: 'ORG_ADMIN',
    status: 'ACTIVE',
    expectedVersion: null,
  });
  test('only current owner changes organization members, never owner itself or another organization', async () => {
    const target = await person();
    error(await send(member(target.id), h.otherOwner.cookie), 403);
    const outsider = await person();
    error(await send(member(target.id), outsider.cookie), 404);
    error(await send(member(h.owner.id)), 403);
    data(await send(member(target.id)));
    const other = await person();
    error(await send(member(other.id), target.cookie), 403);
    const work = data<{ members: { id: string; name: string }[] }>(
      await call(h.api, 'get', base(), { cookie: target.cookie }),
    );
    expect(work.members.find((m) => m.id === target.id)?.name).toBe('合成工作人员');
    expect(JSON.stringify(work)).not.toContain('@example.test');
  });
  test('same command is atomic under replay, body reuse rejected and legacy writes invalidate microsecond CAS', async () => {
    const target = await person(),
      body = member(target.id);
    const results = await Promise.all([send(body), send(body)]);
    expect(data(results[0]!)).toEqual(data(results[1]!));
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int n FROM staff_configuration_receipts WHERE id=$1',
          [body.clientRequestId],
        )
      ).rows[0].n,
    ).toBe(1);
    error(await send({ ...body, status: 'DISABLED' }), 409);
    const work = data<{ members: { id: string; version: string }[] }>(
      await call(h.api, 'get', base(), { cookie: h.owner.cookie }),
    );
    const version = work.members.find((m) => m.id === target.id)!.version;
    data(
      await call(h.api, 'put', `/v1/orgs/${h.owner.orgId}/members/${target.id}`, {
        cookie: h.owner.cookie,
        body: { role: 'REVIEWER', status: 'ACTIVE' },
      }),
    );
    error(
      await send({
        ...body,
        clientRequestId: randomUUID(),
        expectedVersion: version,
        status: 'DISABLED',
      }),
      409,
    );
  });
  test('event assignment requires active organization membership; current revoked permissions cannot replay receipt', async () => {
    const admin = await person(),
      target = await person();
    data(await send(member(admin.id)));
    const event = data<{ id: string }>(
      await call(h.api, 'post', `/v1/orgs/${h.owner.orgId}/events`, {
        cookie: h.owner.cookie,
        body: eventInput('工作人员配置测试'),
      }),
      201,
    );
    const staff = {
      clientRequestId: randomUUID(),
      type: 'STAFF',
      userId: target.id,
      eventId: event.id,
      role: 'SCORER',
      status: 'ACTIVE',
      expectedVersion: null,
    };
    error(await send(staff, admin.cookie), 409);
    data(await send({ ...member(target.id), role: 'SCORER' }));
    data(await send(staff, admin.cookie));
    await h.api.pool.query(
      "UPDATE organization_memberships SET status='DISABLED',updated_at=clock_timestamp() WHERE org_id=$1 AND user_id=$2",
      [h.owner.orgId, admin.id],
    );
    error(await send(staff, admin.cookie), 404);
    const row = (
      await h.api.pool.query(
        'SELECT role,status FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3',
        [h.owner.orgId, event.id, target.id],
      )
    ).rows[0];
    expect(row).toMatchObject({ role: 'SCORER', status: 'ACTIVE' });
  });
  test('receipt replay waiting on command fence cannot outlive its session', async () => {
    const target = await person(),
      body = member(target.id);
    data(await send(body));
    const cookie = h.owner.cookie,
      gate = await h.api.pool.connect();
    let open = false;
    try {
      const gatePid = (await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await gate.query('BEGIN');
      open = true;
      await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `staff-command:${body.clientRequestId}`,
      ]);
      await h.api.pool.query(
        "UPDATE sessions SET expires_at=clock_timestamp()+interval '4 seconds' WHERE token_hash=$1",
        [tokenHash(cookie)],
      );
      const result = send(body, cookie);
      await eventually(
        async () =>
          (
            await h.api.pool.query(
              'SELECT count(*)::int n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
              [gatePid],
            )
          ).rows[0].n,
        (n) => n > 0,
        'staff replay did not reach operation fence',
      );
      await eventually(
        async () =>
          (
            await h.api.pool.query(
              'SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE token_hash=$1',
              [tokenHash(cookie)],
            )
          ).rows[0].expired,
        Boolean,
        'session did not expire while replay waited',
      );
      await gate.query('COMMIT');
      open = false;
      error(await result, 401);
    } finally {
      if (open) await gate.query('ROLLBACK');
      gate.release();
      h.owner.cookie = await login(h.api, h.owner);
    }
  });
});
