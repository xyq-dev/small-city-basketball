import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { EventScoringData, FollowData, TeamData } from '@small-city-basketball/contracts';
import { PASSWORD, call, data, error, sessionCookie } from './support.js';
import type { User } from './support.js';
import { allocate, court, frozen, fullAllocations, publish, revision } from './p04-support.js';
import { defaultRules, scoringRulesPath } from './p05-support.js';
import {
  anonymous,
  closeHarness,
  createScoringHarness,
  disable,
  enable,
  publicEventPath,
  savePublishRules,
} from './p05b-support.js';
import type { Harness } from './p05b-support.js';

// C19 event follows on isolated PostgreSQL: server-side public-read gate, publication-bound
// idempotent follows, UNLIST keeps them, revocation invalidates without leaking details, a new
// public key inherits nothing, cancel works after revocation, and strict own-account scope.
describe('C19 event follows on isolated PostgreSQL', { concurrent: false }, () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createScoringHarness(6);
  }, 180000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  }, 30000);
  beforeEach(async () => {
    await h.api.pool.query("DELETE FROM auth_rate_limits WHERE key LIKE 'follow:%'");
  });

  const reject = (response: Response, status: number, code?: string) => {
    error(response, status);
    if (code) expect(response.body.error.code).toBe(code);
  };
  const follow = (publicEventId: unknown, actor?: User) =>
    call(h.api, 'post', '/v1/me/follows', {
      ...(actor ? { cookie: actor.cookie } : {}),
      body: { publicEventId },
    });
  const lookup = async (publicEventId: string, actor: User = h.leader) =>
    data<FollowData | null>(
      await call(h.api, 'get', `/v1/me/follows/lookup?publicEventId=${publicEventId}`, {
        cookie: actor.cookie,
      }),
    );
  const listPage = (actor: User, query = '') =>
    call(h.api, 'get', `/v1/me/follows${query}`, { cookie: actor.cookie });
  const listAll = async (actor: User = h.leader) => data<FollowData[]>(await listPage(actor));
  const cancel = (followId: string, actor: User = h.leader, body?: object) =>
    call(h.api, 'post', `/v1/me/follows/${followId}/cancel`, {
      cookie: actor.cookie,
      ...(body ? { body } : {}),
    });
  const rows = async (userId: string) =>
    (
      await h.api.pool.query(
        'SELECT * FROM event_follows WHERE user_id=$1 ORDER BY created_at,id',
        [userId],
      )
    ).rows;
  const audits = async (followId: string) =>
    (
      await h.api.pool.query(
        'SELECT org_id,actor_id,action,metadata FROM audit_logs WHERE resource_id=$1 ORDER BY created_at',
        [followId],
      )
    ).rows;
  const directoryCommand = async (eventId: string, type: 'LIST' | 'UNLIST') => {
    const base = `/v1/orgs/${h.owner.orgId}/events/${eventId}`;
    const current = data<{ event: { version: number } }>(
      await call(h.api, 'get', `${base}/directory`, { cookie: h.owner.cookie }),
    );
    return data(
      await call(h.api, 'post', `${base}/directory-commands`, {
        cookie: h.owner.cookie,
        body: { type, expectedEventVersion: current.event.version, reason: '合成目录操作原因' },
      }),
    );
  };

  /** Round-robin event with locked standings and LIVE public viewing. */
  async function publicEvent(teams: TeamData[] = h.teams.slice(0, 2)) {
    const registration = await frozen(h, h.owner, teams);
    const resource = await court(h.api, h.owner, '关注场地');
    let schedule = await revision(h.api, h.owner, registration, [resource]);
    schedule = await allocate(
      h.api,
      h.owner,
      schedule,
      fullAllocations(schedule, resource, `${registration.event.startDate}T09:00:00+08:00`),
    );
    const publication = data<{ event: { version: number } }>(
      await publish(h.api, h.owner, schedule),
    );
    data<EventScoringData>(
      await call(h.api, 'put', scoringRulesPath(h.owner.orgId, registration.event.id), {
        cookie: h.owner.cookie,
        body: { expectedEventVersion: publication.event.version, ...defaultRules() },
      }),
    );
    const eventId = registration.event.id;
    await savePublishRules(h, eventId);
    const viewing = await enable(h, eventId);
    return {
      eventId,
      name: registration.event.name,
      publicEventId: viewing.publication!.publicEventId,
    };
  }

  test('only a signed-in account follows; repeats and concurrent duplicates are one follow', async () => {
    const ev = await publicEvent();
    reject(await follow(ev.publicEventId), 401, 'UNAUTHENTICATED');
    for (const bad of ['short', 'k'.repeat(44), 42])
      reject(await follow(bad, h.leader), 422, 'VALIDATION_ERROR');
    reject(
      await call(h.api, 'post', '/v1/me/follows', {
        cookie: h.leader.cookie,
        body: { publicEventId: ev.publicEventId, userId: h.otherOwner.id },
      }),
      422,
    );
    expect(await rows(h.leader.id)).toHaveLength(0);

    const first = data<FollowData>(await follow(ev.publicEventId, h.leader), 201);
    expect(first).toMatchObject({
      publicEventId: ev.publicEventId,
      status: 'ACTIVE',
      event: { name: ev.name, status: 'SCHEDULED', purpose: 'LIVE' },
      cancelledAt: null,
      wechatReminder: 'NOT_ENABLED',
    });
    expect(Object.keys(first.event!).sort()).toEqual(
      ['endDate', 'name', 'purpose', 'startDate', 'status'].sort(),
    );
    // No private ids leak: only the follow id and the public key.
    expect(JSON.stringify(first).match(/[0-9a-f]{8}-[0-9a-f]{4}-/g)).toEqual([
      first.followId.slice(0, 14),
    ]);
    const again = data<FollowData>(await follow(ev.publicEventId, h.leader), 200);
    expect(again.followId).toBe(first.followId);
    // Concurrent duplicates from another account: exactly one row and one audit.
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => follow(ev.publicEventId, h.otherOwner)),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
    const ids = new Set(responses.map((r) => r.body.data.followId));
    expect(ids.size).toBe(1);
    const otherRows = await rows(h.otherOwner.id);
    expect(otherRows).toHaveLength(1);
    expect(otherRows[0]).toMatchObject({ status: 'ACTIVE', event_id: ev.eventId });
    const audit = await audits(otherRows[0].id);
    expect(audit).toHaveLength(1);
    // Personal action: organizers' organization-scoped audit never lists followers.
    expect(audit[0]).toMatchObject({ org_id: null, action: 'follow.created' });
    expect(await rows(h.leader.id)).toHaveLength(1);
    expect(await lookup(ev.publicEventId)).toMatchObject({ followId: first.followId });
  });

  test('unknown, revoked, disabled-organization and malformed keys are refused; nothing is written', async () => {
    const live = await publicEvent();
    const revoked = await publicEvent();
    await disable(h, revoked.eventId);
    const before = (await rows(h.leader.id)).length;
    data<FollowData>(await follow(live.publicEventId, h.leader), 201);
    const bodies: unknown[] = [];
    for (const key of ['u'.repeat(43), revoked.publicEventId]) {
      const response = await follow(key, h.leader);
      reject(response, 404, 'RESOURCE_NOT_FOUND');
      bodies.push({ ...response.body.error, requestId: null });
    }
    // Disabled organization: the live key is refused exactly like an unknown one.
    await h.api.pool.query(
      "UPDATE organizations SET status='DISABLED',updated_at=clock_timestamp() WHERE id=$1",
      [h.owner.orgId],
    );
    try {
      const response = await follow(live.publicEventId, h.otherOwner);
      reject(response, 404, 'RESOURCE_NOT_FOUND');
      bodies.push({ ...response.body.error, requestId: null });
      // The existing follow reads INVALID while the organization is disabled.
      const read = await lookup(live.publicEventId);
      expect(read).toMatchObject({ status: 'INVALID', event: null });
    } finally {
      await h.api.pool.query(
        "UPDATE organizations SET status='ACTIVE',updated_at=clock_timestamp() WHERE id=$1",
        [h.owner.orgId],
      );
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(await rows(h.leader.id)).toHaveLength(before + 1);
    expect((await rows(h.otherOwner.id)).filter((r) => r.event_id === live.eventId)).toHaveLength(
      0,
    );
    // The publication itself was never revoked, so the follow reads ACTIVE again.
    expect(await lookup(live.publicEventId)).toMatchObject({ status: 'ACTIVE' });
  });

  test('directory UNLIST keeps the follow ACTIVE because the share link stays valid', async () => {
    const ev = await publicEvent();
    await directoryCommand(ev.eventId, 'LIST');
    const followed = data<FollowData>(await follow(ev.publicEventId, h.leader), 201);
    await directoryCommand(ev.eventId, 'UNLIST');
    data(await anonymous(h, publicEventPath(ev.publicEventId)));
    const read = await lookup(ev.publicEventId);
    expect(read).toMatchObject({
      followId: followed.followId,
      status: 'ACTIVE',
      event: { name: ev.name },
    });
    expect((await listAll()).find((f) => f.followId === followed.followId)?.status).toBe('ACTIVE');
    // Following an unlisted but still shared event works too.
    data<FollowData>(await follow(ev.publicEventId, h.otherOwner), 201);
  });

  test('revocation invalidates without old details; the new key inherits nothing; cancel still works', async () => {
    const ev = await publicEvent();
    const followed = data<FollowData>(await follow(ev.publicEventId, h.leader), 201);
    await disable(h, ev.eventId);
    reject(await anonymous(h, publicEventPath(ev.publicEventId)), 404);
    const invalid = await lookup(ev.publicEventId);
    expect(invalid).toMatchObject({
      followId: followed.followId,
      status: 'INVALID',
      event: null,
      cancelledAt: null,
    });
    const listed = (await listAll()).find((f) => f.followId === followed.followId)!;
    expect(listed).toMatchObject({ status: 'INVALID', event: null });
    expect(JSON.stringify(await listAll())).not.toContain(ev.name);
    // Re-enabling creates a new public key; the old follow stays INVALID and is not moved.
    const renewed = await enable(h, ev.eventId);
    const newKey = renewed.publication!.publicEventId;
    expect(newKey).not.toBe(ev.publicEventId);
    expect(await lookup(newKey)).toBeNull();
    expect(await lookup(ev.publicEventId)).toMatchObject({ status: 'INVALID', event: null });
    reject(await follow(ev.publicEventId, h.leader), 404, 'RESOURCE_NOT_FOUND');
    const fresh = data<FollowData>(await follow(newKey, h.leader), 201);
    expect(fresh.followId).not.toBe(followed.followId);
    expect(fresh).toMatchObject({ status: 'ACTIVE', publicEventId: newKey });
    // Cancel does not need the old publication to be readable, and repeating it is a no-op.
    const cancelled = data<FollowData>(await cancel(followed.followId));
    expect(cancelled).toMatchObject({ status: 'CANCELLED', event: null });
    expect(cancelled.cancelledAt).toEqual(expect.any(String));
    const repeated = data<FollowData>(await cancel(followed.followId, h.leader, {}));
    expect(repeated).toEqual(cancelled);
    expect((await audits(followed.followId)).map((a) => a.action)).toEqual([
      'follow.created',
      'follow.cancelled',
    ]);
    expect(await lookup(ev.publicEventId)).toBeNull();
    expect((await listAll()).map((f) => f.followId)).not.toContain(followed.followId);
    reject(await cancel(followed.followId, h.leader, { reason: 'x' }), 422);
    // Cancel then follow again on a live key: a new row; history stays.
    data<FollowData>(await cancel(fresh.followId));
    const refollow = data<FollowData>(await follow(newKey, h.leader), 201);
    expect(refollow.followId).not.toBe(fresh.followId);
    const history = (await rows(h.leader.id)).filter((r) => r.event_id === ev.eventId);
    expect(history.map((r) => r.status)).toEqual(['CANCELLED', 'CANCELLED', 'ACTIVE']);
  });

  test('another account can neither read, look up nor cancel my follow; logout stops all reads', async () => {
    const ev = await publicEvent();
    const mine = data<FollowData>(await follow(ev.publicEventId, h.leader), 201);
    expect((await listAll(h.otherOwner)).map((f) => f.followId)).not.toContain(mine.followId);
    expect(await lookup(ev.publicEventId, h.otherOwner)).toBeNull();
    const foreign = await cancel(mine.followId, h.otherOwner);
    reject(foreign, 404, 'RESOURCE_NOT_FOUND');
    const missing = await cancel(randomUUID(), h.otherOwner);
    reject(missing, 404, 'RESOURCE_NOT_FOUND');
    expect(foreign.body.error.message).toBe(missing.body.error.message);
    reject(await cancel('not-a-uuid'), 404);
    expect((await rows(h.leader.id)).find((r) => r.id === mine.followId).status).toBe('ACTIVE');
    for (const path of [
      '/v1/me/follows',
      `/v1/me/follows/lookup?publicEventId=${ev.publicEventId}`,
    ])
      reject(await call(h.api, 'get', path), 401, 'UNAUTHENTICATED');
    reject(await call(h.api, 'post', `/v1/me/follows/${mine.followId}/cancel`), 401);
    for (const query of ['?limit=0', '?limit=51', '?userId=' + h.otherOwner.id, '?cursor=a.b'])
      error(await listPage(h.leader, query), 400);
    reject(
      await call(h.api, 'get', '/v1/me/follows/lookup?publicEventId=short', {
        cookie: h.leader.cookie,
      }),
      400,
      'INVALID_QUERY',
    );
    // A revoked session (logout) can no longer read or cancel.
    const login = await call(h.api, 'post', '/v1/auth/login', {
      body: { email: h.leader.email, password: PASSWORD },
    });
    const second = sessionCookie(login);
    const reader: User = { ...h.leader, cookie: second };
    expect((await listAll(reader)).map((f) => f.followId)).toContain(mine.followId);
    data(await call(h.api, 'post', '/v1/auth/logout', { cookie: second }));
    reject(await listPage(reader), 401);
    reject(await cancel(mine.followId, reader), 401);
  });

  test('keyset pages never repeat or skip, including equal timestamps', async () => {
    const events = [await publicEvent(), await publicEvent(), await publicEvent()];
    // A dedicated synthetic reader with three follows sharing one created_at, plus one newer.
    const reader = h.otherOwner;
    for (const r of await rows(reader.id))
      if (r.status === 'ACTIVE') data(await cancel(r.id, reader));
    const stamp = '2020-01-01T00:00:00.123456Z';
    const tied: string[] = [];
    for (const ev of events) {
      const pub = (
        await h.api.pool.query(
          'SELECT id,org_id,event_id FROM public_event_publications WHERE public_event_id=$1',
          [ev.publicEventId],
        )
      ).rows[0];
      const id = randomUUID();
      tied.push(id);
      await h.api.pool.query(
        'INSERT INTO event_follows(id,user_id,org_id,event_id,publication_id,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [id, reader.id, pub.org_id, pub.event_id, pub.id, stamp],
      );
    }
    const newest = await publicEvent();
    const top = data<FollowData>(await follow(newest.publicEventId, reader), 201);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const response = await listPage(
        reader,
        `?limit=1${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`,
      );
      const page = data<FollowData[]>(response);
      seen.push(...page.map((f) => f.followId));
      cursor = response.body.meta.nextCursor;
      if (!cursor) break;
    }
    expect(seen[0]).toBe(top.followId);
    expect(seen.slice(1)).toEqual([...tied].sort().reverse());
    // A two-row page then the rest; a cancelled follow drops out between pages without a skip.
    const firstPage = await listPage(reader, '?limit=2');
    const next = firstPage.body.meta.nextCursor as string;
    expect(next).toMatch(/^[A-Za-z0-9_-]+$/);
    data(await cancel(seen[1]!, reader));
    const rest = data<FollowData[]>(
      await listPage(reader, `?limit=50&cursor=${encodeURIComponent(next)}`),
    );
    expect(rest.map((f) => f.followId)).toEqual(seen.slice(2));
    // Another account's cursor reveals nothing: it only filters the caller's own rows.
    expect(
      data<FollowData[]>(await listPage(h.leader, `?cursor=${encodeURIComponent(next)}`)).every(
        (f) => !seen.includes(f.followId),
      ),
    ).toBe(true);
  });

  test('follow racing a revocation never leaves a readable follow of a revoked publication', async () => {
    const ev = await publicEvent();
    const reader = h.otherOwner;
    const [followed] = await Promise.all([
      follow(ev.publicEventId, reader),
      disable(h, ev.eventId),
    ]);
    if (followed.status === 201) {
      expect(await lookup(ev.publicEventId, reader)).toMatchObject({
        status: 'INVALID',
        event: null,
      });
    } else {
      reject(followed, 404, 'RESOURCE_NOT_FOUND');
      expect((await rows(reader.id)).filter((r) => r.event_id === ev.eventId)).toHaveLength(0);
    }
  });

  test('an audit failure rolls the follow back; history is immutable; inserts need a readable publication', async () => {
    const ev = await publicEvent();
    const identifier = `scb_c19_audit_${randomUUID().replaceAll('-', '')}`;
    await h.api.pool.query(
      `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'follow.%' AND NEW.actor_id::text=TG_ARGV[0] THEN RAISE EXCEPTION 'c19 synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    try {
      await h.api.pool.query(
        `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}('${h.leader.id}')`,
      );
      const failed = await follow(ev.publicEventId, h.leader);
      reject(failed, 500, 'INTERNAL_ERROR');
      expect(JSON.stringify(failed.body)).not.toMatch(/c19 synthetic|audit_logs|postgres/i);
      expect((await rows(h.leader.id)).filter((r) => r.event_id === ev.eventId)).toHaveLength(0);
    } finally {
      await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
      await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
    }
    const ok = data<FollowData>(await follow(ev.publicEventId, h.leader), 201);
    // The cancel audit failing also rolls the cancel back.
    await h.api.pool.query(
      `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='follow.cancelled' THEN RAISE EXCEPTION 'c19 synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    try {
      await h.api.pool.query(
        `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}()`,
      );
      reject(await cancel(ok.followId), 500);
      expect((await lookup(ev.publicEventId))?.status).toBe('ACTIVE');
    } finally {
      await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
      await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
    }
    await expect(
      h.api.pool.query('DELETE FROM event_follows WHERE id=$1', [ok.followId]),
    ).rejects.toThrow(/immutable/);
    await expect(h.api.pool.query('TRUNCATE event_follows')).rejects.toThrow(/immutable/);
    data(await cancel(ok.followId));
    await expect(
      h.api.pool.query("UPDATE event_follows SET status='ACTIVE',cancelled_at=NULL WHERE id=$1", [
        ok.followId,
      ]),
    ).rejects.toThrow(/ACTIVE to CANCELLED/);
    await disable(h, ev.eventId);
    const pub = (
      await h.api.pool.query(
        'SELECT id,org_id,event_id FROM public_event_publications WHERE public_event_id=$1',
        [ev.publicEventId],
      )
    ).rows[0];
    await expect(
      h.api.pool.query(
        'INSERT INTO event_follows(id,user_id,org_id,event_id,publication_id) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), h.leader.id, pub.org_id, pub.event_id, pub.id],
      ),
    ).rejects.toThrow(/currently readable public publication/);
  });

  test('the per-session follow limiter answers 429 without writing', async () => {
    const ev = await publicEvent();
    for (let i = 0; i < 30; i++)
      expect([200, 201]).toContain((await follow(ev.publicEventId, h.leader)).status);
    reject(await follow(ev.publicEventId, h.leader), 429, 'RATE_LIMITED');
    expect((await rows(h.leader.id)).filter((r) => r.event_id === ev.eventId)).toHaveLength(1);
  });

  test('the migration follows nothing by itself', async () => {
    const sql = await readFile(
      new URL('../migrations/021_c19_event_follows.sql', import.meta.url),
      'utf8',
    );
    const topLevel = sql
      .split('$$')
      .filter((_, index) => index % 2 === 0)
      .join('\n');
    expect(topLevel).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM)\b/i);
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i);
  });
});
