import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NotificationService, revokeNotificationGrants } from '../src/notification-service.js';
import type { NotificationOptions } from '../src/notification-service.js';
import type { WechatNotificationResult } from '../src/notification-provider.js';
import { hashToken } from '../src/security.js';
import { openNotificationTarget } from '../src/notification-domain.js';
import {
  closeHarness,
  createScoringHarness,
  defaultRules,
  scoringRulesPath,
} from './p05-support.js';
import { enable, disable, savePublishRules } from './p05b-support.js';
import type { Harness } from './p05-support.js';
import { scheduled, rescheduling, reschedule } from './p04-rescheduling-support.js';
import { command, openRegistration, submittedEntry, grant } from './p03-support.js';
import { ORIGIN, data, call } from './support.js';
import type { User } from './support.js';

// These are deliberately synthetic recipients and transports. No official endpoint is contacted.
const appId = 'wx1234567890abcdef';
const encryptionKey = Buffer.alloc(32, 55).toString('base64');
const openid = 'synthetic-e05-owner';
const templates = {
  MATCH_STARTING: { id: 'synthetic-start', fields: { thing1: 'event', time2: 'time' } },
  MATCH_RESCHEDULED: { id: 'synthetic-change', fields: { thing1: 'event', time2: 'time' } },
  REGISTRATION_REVIEW: { id: 'synthetic-review', fields: { thing1: 'event', thing2: 'detail' } },
} satisfies NonNullable<NotificationOptions['templates']>;
let h: Harness;
let fixtureIndex = 0;
const services: NotificationService[] = [];
function service(
  send: () => Promise<WechatNotificationResult> = async () => ({ state: 'ACCEPTED' }),
  exchange?: NotificationOptions['exchange'],
) {
  const s = new NotificationService(
    h.api.pool,
    { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
    {
      appId,
      encryptionKey,
      templates,
      autoDispatch: false,
      exchange: exchange ?? { exchange: async () => ({ appId, openid }) },
      provider: { send },
    },
  );
  services.push(s);
  return s;
}
async function tx<T>(run: (c: PoolClient) => Promise<T>) {
  const c = await h.api.pool.connect();
  try {
    await c.query('BEGIN');
    const result = await run(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
async function soon(s: NotificationService) {
  const now = (await h.api.pool.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!
    .now;
  const startsAt = new Date(now.getTime() + 12 * 60000).toISOString();
  const startDate = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const endDate = new Date(now.getTime() + 32 * 3600000).toISOString().slice(0, 10);
  const teamOffset = fixtureIndex++ * 2;
  const f = await scheduled(h, {
    teams: h.teams.slice(teamOffset, teamOffset + 2),
    startDate,
    endDate,
    startsAt,
  });
  const eventId = f.registration.event.id,
    matchId = f.matches[0]!.id;
  expect(
    (
      await h.api.pool.query(
        "SELECT count(*)::int AS n FROM notification_source_events WHERE org_id=$1 AND resource_id=$2 AND kind='MATCH_STARTING'",
        [h.owner.orgId, matchId],
      )
    ).rows[0]!.n,
  ).toBeGreaterThan(0);
  const sourceId = (
    await h.api.pool.query(
      "SELECT id FROM notification_source_events WHERE org_id=$1 AND resource_id=$2 AND kind='MATCH_STARTING'",
      [h.owner.orgId, matchId],
    )
  ).rows[0]!.id;
  const queued = (
    await h.api.pool.query(`SELECT
    count(*) FILTER(WHERE s.expires_at<=clock_timestamp()+interval '2 hours')::int AS urgent,
    count(*) FILTER(WHERE s.expires_at>clock_timestamp()+interval '2 hours')::int AS long_lived
    FROM notification_fanout_state f JOIN notification_source_events s ON s.id=f.source_id
    WHERE f.done=false AND s.due_at<=clock_timestamp() AND s.expires_at>clock_timestamp()`)
  ).rows[0]!;
  // The publication hook already captured this source. Explicitly run the real global
  // queue: no test relies on a background timer or a source-scoped shortcut to create it.
  await s.fanout();
  if (queued.urgent <= 10) {
    expect(
      (
        await h.api.pool.query('SELECT done FROM notification_fanout_state WHERE source_id=$1', [
          sourceId,
        ])
      ).rows[0]?.done,
    ).toBe(true);
    if (queued.long_lived > 10)
      expect(
        (
          await h.api.pool.query(
            `SELECT count(*)::int AS n FROM notification_fanout_state f JOIN notification_source_events s ON s.id=f.source_id WHERE f.done=false AND s.due_at<=clock_timestamp() AND s.expires_at>clock_timestamp()+interval '2 hours'`,
          )
        ).rows[0]!.n,
      ).toBeGreaterThan(0);
  }
  await fanoutCommitted(s, sourceId);
  const source = {
    kind: 'MATCH_STARTING' as const,
    orgId: h.owner.orgId,
    eventId,
    resourceId: matchId,
  };
  const row = (
    await h.api.pool.query(
      `SELECT m.id,d.id AS delivery_id,d.state FROM notification_messages m JOIN notification_deliveries d ON d.message_id=m.id JOIN notification_source_events s ON s.id=m.source_id WHERE m.user_id=$1 AND s.resource_id=$2 AND s.kind='MATCH_STARTING'`,
      [h.owner.id, matchId],
    )
  ).rows[0];
  expect(row).toBeDefined();
  return { ...f, source, row, eventId, matchId };
}
async function allow(s: NotificationService, actor: User = h.owner) {
  const intent = await s.createIntent(actor.cookie, {
    clientRequestId: randomUUID(),
    kind: 'MATCH_STARTING',
  });
  const body = {
    clientRequestId: randomUUID(),
    intentId: intent.id,
    result: 'accept',
    code: randomUUID(),
  };
  const confirmed = await s.confirm(actor.cookie, body);
  expect(confirmed?.state).toBe('ACCEPTED');
  return { intent, body, confirmed: confirmed! };
}
async function delivery(id: string) {
  return (await h.api.pool.query('SELECT * FROM notification_deliveries WHERE id=$1', [id]))
    .rows[0];
}
async function fanoutCommitted(s: NotificationService, sourceId: string) {
  if (
    (
      await h.api.pool.query('SELECT done FROM notification_fanout_state WHERE source_id=$1', [
        sourceId,
      ])
    ).rows[0]?.done
  )
    return;
  const pending = Number(
    (
      await h.api.pool.query(
        `SELECT count(*)::int AS n FROM notification_fanout_state f JOIN notification_source_events s ON s.id=f.source_id WHERE f.done=false AND s.due_at<=clock_timestamp() AND s.expires_at>clock_timestamp()`,
      )
    ).rows[0]!.n,
  );
  for (let round = 0; round <= pending; round++) {
    const marker = (await h.api.pool.query('SELECT clock_timestamp()::text AS at')).rows[0]!.at;
    await s.fanout();
    if (
      (
        await h.api.pool.query('SELECT done FROM notification_fanout_state WHERE source_id=$1', [
          sourceId,
        ])
      ).rows[0]?.done
    )
      return;
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int AS n FROM notification_fanout_state WHERE updated_at>=$1::timestamptz',
          [marker],
        )
      ).rows[0]!.n,
    ).toBeGreaterThan(0);
  }
  throw Error(
    'The committed source did not progress through ' +
      String(pending + 1) +
      ' global rounds derived from the real due queue',
  );
}
async function allMessages(s: NotificationService, cookie: string) {
  const result = [];
  let cursor: string | null = null;
  for (let page = 0; page < 30; page++) {
    const data = await s.list(cookie, cursor ? { cursor } : {});
    result.push(...data.items);
    if (!data.nextCursor) return result;
    expect(data.nextCursor).not.toBe(cursor);
    cursor = data.nextCursor;
  }
  throw Error('Notification pagination did not advance');
}
async function createUnsubscribedBacklog(s: NotificationService) {
  const source = (
    await h.api.pool.query(
      "SELECT id,event_id,resource_id FROM notification_source_events WHERE org_id=$1 AND kind='REGISTRATION_REVIEW' ORDER BY created_at,id LIMIT 1",
      [h.owner.orgId],
    )
  ).rows[0]!;
  const people = Array.from({ length: 25 }, (_, index) => ({
    id: randomUUID(),
    email: 'e05-waiting-' + randomUUID() + '@example.test',
    name: '合成未订阅审核员' + index,
  }));
  // Fixture identities reuse the already synthetic harness password hash; no real person or
  // credentials are imported. The current membership/staff relationships use real APIs.
  await h.api.pool.query(
    `INSERT INTO users(id,email,display_name,password_hash)
    SELECT p.id,p.email,p.name,u.password_hash FROM jsonb_to_recordset($1::jsonb) p(id uuid,email text,name text)
    JOIN users u ON u.id=$2`,
    [JSON.stringify(people), h.owner.id],
  );
  for (const p of people) {
    data(
      await call(h.api, 'put', `/v1/orgs/${h.owner.orgId}/members/${p.id}`, {
        cookie: h.owner.cookie,
        body: { role: 'REVIEWER', status: 'ACTIVE' },
      }),
    );
    data(
      await call(
        h.api,
        'put',
        `/v1/orgs/${h.owner.orgId}/events/${source.event_id}/staff/${p.id}`,
        { cookie: h.owner.cookie, body: { role: 'REVIEWER', status: 'ACTIVE' } },
      ),
    );
  }
  await tx((c) =>
    s.capture(c, {
      kind: 'REGISTRATION_REVIEW',
      orgId: h.owner.orgId,
      eventId: source.event_id,
      resourceId: source.resource_id,
    }),
  );
  await fanoutCommitted(s, source.id);
  expect(
    (
      await h.api.pool.query(
        "SELECT count(*)::int AS n FROM notification_messages m JOIN notification_deliveries d ON d.message_id=m.id WHERE m.user_id=ANY($1::uuid[]) AND d.state='WAITING_PERMISSION'",
        [people.map((p) => p.id)],
      )
    ).rows[0]!.n,
  ).toBe(25);
  return people.map((p) => p.id);
}

describe('E05 authoritative notifications in real PostgreSQL', () => {
  beforeAll(async () => {
    h = await createScoringHarness(14);
    await h.api.pool.query(
      'INSERT INTO wechat_identities(id,user_id,app_id,openid_hash) VALUES($1,$2,$3,$4)',
      [randomUUID(), h.owner.id, appId, hashToken(appId + '\n' + openid)],
    );
  }, 180000);
  afterEach(async () => {
    if (!h) return;
    await tx(async (c) => {
      for (const kind of ['MATCH_STARTING', 'MATCH_RESCHEDULED', 'REGISTRATION_REVIEW'] as const)
        await revokeNotificationGrants(c, h.owner.id, kind);
    });
  });
  afterAll(async () => {
    for (const s of services) s.onModuleDestroy();
    if (h) await closeHarness(h);
  });

  it('works as a private station inbox with defaults off, deduplicates capture, and rolls source writes back', async () => {
    const s = new NotificationService(
      h.api.pool,
      { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
      { autoDispatch: false },
    );
    services.push(s);
    const f = await soon(s);
    expect(s.capabilities().wechatEnabled).toBe(false);
    await s.drain();
    expect((await delivery(f.row.delivery_id)).state).toBe('WAITING_PERMISSION');
    await tx((c) => s.capture(c, f.source));
    await s.fanout();
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int AS n FROM notification_messages m JOIN notification_source_events s ON s.id=m.source_id WHERE m.user_id=$1 AND s.resource_id=$2',
          [h.owner.id, f.matchId],
        )
      ).rows[0]!.n,
    ).toBe(1);
    const inbox = await s.list(h.owner.cookie, {});
    expect(inbox.items.some((x) => x.id === f.row.id)).toBe(true);
    expect(inbox.items.find((x) => x.id === f.row.id)).toMatchObject({
      time: f.matches[0]!.startsAt,
      location: f.matches[0]!.courtName,
    });
    await expect(s.list(undefined, {})).rejects.toMatchObject({ status: 401 });
    await expect(
      s.read(h.otherOwner.cookie, f.row.id, { clientRequestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    const before = (
      await h.api.pool.query(
        'SELECT count(*)::int AS n FROM notification_source_events WHERE org_id=$1',
        [h.owner.orgId],
      )
    ).rows[0]!.n;
    await expect(
      tx(async (c) => {
        await c.query(
          "INSERT INTO notification_source_events(id,org_id,event_id,kind,resource_id,source_fingerprint,due_at,expires_at) VALUES($1,$2,$3,'MATCH_STARTING',$4,$5,clock_timestamp(),clock_timestamp()+interval '1 minute')",
          [randomUUID(), h.owner.orgId, f.eventId, randomUUID(), 'a'.repeat(64)],
        );
        throw Error('synthetic business rollback');
      }),
    ).rejects.toThrow('synthetic business rollback');
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int AS n FROM notification_source_events WHERE org_id=$1',
          [h.owner.orgId],
        )
      ).rows[0]!.n,
    ).toBe(before);
    const changed = new NotificationService(
      h.api.pool,
      { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
      { startingLeadMinutes: 30, autoDispatch: false },
    );
    services.push(changed);
    expect((await changed.list(h.owner.cookie, {})).items.some((x) => x.id === f.row.id)).toBe(
      false,
    );
    await changed.scheduleStarts();
    await changed.fanout();
    const generated = (
      await h.api.pool.query(
        "SELECT s.id,f.done FROM notification_source_events s JOIN notification_fanout_state f ON f.source_id=s.id WHERE s.org_id=$1 AND s.resource_id=$2 AND s.kind='MATCH_STARTING' AND s.due_at=s.expires_at-interval '30 minutes'",
        [h.owner.orgId, f.matchId],
      )
    ).rows[0]!;
    expect(generated.done).toBe(true);
    expect(
      (await changed.list(h.owner.cookie, {})).items.some((x) => x.time === f.matches[0]!.startsAt),
    ).toBe(true);
    await changed.scheduleStarts();
    expect(
      (
        await h.api.pool.query('SELECT done FROM notification_fanout_state WHERE source_id=$1', [
          generated.id,
        ])
      ).rows[0]!.done,
    ).toBe(true);
  });

  it('binds encrypted recipient to current AppID/hash/version, never trusting the client target', async () => {
    const bad = service(undefined, { exchange: async () => ({ appId, openid: 'somebody-else' }) });
    const i = await bad.createIntent(h.owner.cookie, {
      clientRequestId: randomUUID(),
      kind: 'MATCH_STARTING',
    });
    await expect(
      bad.confirm(h.owner.cookie, {
        clientRequestId: randomUUID(),
        intentId: i.id,
        result: 'accept',
        code: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'NOTIFICATION_IDENTITY_MISMATCH' });
    const s = service();
    const a = await allow(s);
    const g = (
      await h.api.pool.query('SELECT * FROM notification_subscription_grants WHERE id=$1', [
        a.confirmed.subscriptionId,
      ])
    ).rows[0]!;
    expect(g.evidence).toBe('CLIENT_REPORTED');
    expect(g.target_cipher.includes(Buffer.from(openid))).toBe(false);
    expect(
      openNotificationTarget(
        Buffer.from(encryptionKey, 'base64'),
        [g.id, g.user_id, appId, g.identity_id, g.identity_version].join(':'),
        g.target_cipher,
      ),
    ).toBe(openid);
    expect(() =>
      openNotificationTarget(
        Buffer.from(encryptionKey, 'base64'),
        [g.id, h.otherOwner.id, appId, g.identity_id, g.identity_version].join(':'),
        g.target_cipher,
      ),
    ).toThrow();
    const replay = await s.confirm(h.owner.cookie, a.body);
    expect(replay?.subscriptionId).toBe(a.confirmed.subscriptionId);
    expect((await s.settings(h.owner.cookie)).subscriptions.some((x) => x.id === g.id)).toBe(true);
    expect(JSON.stringify(await s.settings(h.owner.cookie))).not.toContain(openid);
  });

  it('global dispatch passes an older unconsented backlog, persists SENDING, and never repeats UNKNOWN without fresh permission', async () => {
    let sends = 0;
    const s = service(async () => {
      sends++;
      const committed = (
        await h.api.pool.query(
          "SELECT state FROM notification_delivery_attempts a JOIN notification_subscription_grants g ON g.id=a.grant_id WHERE g.user_id=$1 AND a.state='SENDING'",
          [h.owner.id],
        )
      ).rows;
      expect(committed).toHaveLength(1);
      return sends === 1 ? { state: 'UNKNOWN' } : { state: 'ACCEPTED' };
    });
    const backlog = await createUnsubscribedBacklog(s);
    const f = await soon(s);
    const first = await allow(s);
    expect(
      (
        await h.api.pool.query(
          `SELECT count(*)::int AS n FROM notification_deliveries d
      JOIN notification_messages m ON m.id=d.message_id JOIN notification_deliveries target ON target.id=$2
      WHERE m.user_id=ANY($1::uuid[]) AND d.state='WAITING_PERMISSION'
      AND d.next_attempt_at<target.next_attempt_at`,
          [backlog, f.row.delivery_id],
        )
      ).rows[0]!.n,
    ).toBe(25);
    await s.drain();
    expect((await delivery(f.row.delivery_id)).state).toBe('UNKNOWN');
    expect(
      (
        await h.api.pool.query(
          "SELECT count(*)::int AS n FROM notification_deliveries d JOIN notification_messages m ON m.id=d.message_id WHERE m.user_id=ANY($1::uuid[]) AND d.state='WAITING_PERMISSION'",
          [backlog],
        )
      ).rows[0]!.n,
    ).toBe(25);
    expect(
      (
        await h.api.pool.query(
          'SELECT status,target_cipher FROM notification_subscription_grants WHERE id=$1',
          [first.confirmed.subscriptionId],
        )
      ).rows[0],
    ).toMatchObject({ status: 'CONSUMED', target_cipher: null });
    await s.drain();
    expect(sends).toBe(1);
    const request = { clientRequestId: randomUUID(), acknowledgePossibleDuplicate: true };
    await expect(s.retry(h.owner.cookie, f.row.id, request)).rejects.toMatchObject({
      code: 'NOTIFICATION_NEW_PERMISSION_REQUIRED',
    });
    await allow(s);
    await s.retry(h.owner.cookie, f.row.id, request);
    await s.drain();
    await s.retry(h.owner.cookie, f.row.id, request);
    await s.drain();
    expect(sends).toBe(2);
    expect((await delivery(f.row.delivery_id)).state).toBe('ACCEPTED');
    expect(
      (
        await h.api.pool.query(
          'SELECT state FROM notification_delivery_attempts WHERE delivery_id=$1 ORDER BY created_at',
          [f.row.delivery_id],
        )
      ).rows.map((x) => x.state),
    ).toEqual(['UNKNOWN', 'ACCEPTED']);
  });

  it('retries only proven no-send token failures and keeps the same reserved one-use permission', async () => {
    let sends = 0;
    const s = service(async () =>
      ++sends === 1 ? { state: 'RETRYABLE', reason: 'TOKEN_UNAVAILABLE' } : { state: 'ACCEPTED' },
    );
    const f = await soon(s);
    const a = await allow(s);
    await s.drain();
    expect((await delivery(f.row.delivery_id)).state).toBe('PENDING');
    expect(
      (
        await h.api.pool.query('SELECT status FROM notification_subscription_grants WHERE id=$1', [
          a.confirmed.subscriptionId,
        ])
      ).rows[0]!.status,
    ).toBe('RESERVED');
    await s.drain();
    expect(sends).toBe(1);
    await h.api.pool.query(
      "UPDATE notification_deliveries SET next_attempt_at=clock_timestamp(),updated_at='2000-01-01'::timestamptz WHERE id=$1",
      [f.row.delivery_id],
    );
    const disabled = new NotificationService(
      h.api.pool,
      { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
      { autoDispatch: false },
    );
    services.push(disabled);
    await disabled.drain();
    expect((await delivery(f.row.delivery_id)).state).toBe('PENDING');
    expect(
      (
        await h.api.pool.query('SELECT status FROM notification_subscription_grants WHERE id=$1', [
          a.confirmed.subscriptionId,
        ])
      ).rows[0]!.status,
    ).toBe('RESERVED');
    await s.drain();
    expect(sends).toBe(2);
    expect((await delivery(f.row.delivery_id)).state).toBe('ACCEPTED');
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int AS n FROM notification_delivery_attempts WHERE delivery_id=$1',
          [f.row.delivery_id],
        )
      ).rows[0]!.n,
    ).toBe(1);
  });

  it('revocation invalidates pending and claimed intents; a late exchange and old revoke cannot revive or erase newer permission', async () => {
    let release!: (value: { appId: string; openid: string }) => void;
    let started!: () => void;
    const ready = new Promise<void>((done) => {
      started = done;
    });
    const s = service(undefined, {
      exchange: async () => {
        started();
        return new Promise((done) => {
          release = done;
        });
      },
    });
    const pending = await s.createIntent(h.owner.cookie, {
      clientRequestId: randomUUID(),
      kind: 'MATCH_STARTING',
    });
    const claimed = await s.createIntent(h.owner.cookie, {
      clientRequestId: randomUUID(),
      kind: 'MATCH_STARTING',
    });
    const inflight = s.confirm(h.owner.cookie, {
      clientRequestId: randomUUID(),
      intentId: claimed.id,
      result: 'accept',
      code: randomUUID(),
    });
    const rejected = expect(inflight).rejects.toMatchObject({
      code: 'NOTIFICATION_INTENT_UNAVAILABLE',
    });
    await ready;
    const original = { clientRequestId: randomUUID(), kind: 'MATCH_STARTING' };
    await s.revoke(h.owner.cookie, original);
    release({ appId, openid });
    await rejected;
    expect((await s.intent(h.owner.cookie, pending.id)).state).toBe('FAILED');
    expect((await s.intent(h.owner.cookie, claimed.id)).state).toBe('FAILED');
    const newer = service();
    const grant = await allow(newer);
    await s.revoke(h.owner.cookie, original);
    expect(
      (
        await h.api.pool.query('SELECT status FROM notification_subscription_grants WHERE id=$1', [
          grant.confirmed.subscriptionId,
        ])
      ).rows[0]!.status,
    ).toBe('AVAILABLE');
  });

  it('rechecks real reschedule and team authorization before displaying or dispatching the old generation', async () => {
    let sends = 0;
    const s = service(async () => {
      sends++;
      return { state: 'ACCEPTED' };
    });
    const f = await soon(s);
    await allow(s);
    const before = await s.list(h.leader.cookie, {});
    expect(before.items.some((x) => x.eventName === f.registration.event.name)).toBe(true);
    await grant(h.api, h.owner, h.teams[(fixtureIndex - 1) * 2]!, h.leader, 'DISABLED');
    await grant(h.api, h.owner, h.teams[(fixtureIndex - 1) * 2 + 1]!, h.leader, 'DISABLED');
    expect(
      (await s.list(h.leader.cookie, {})).items.some(
        (x) => x.eventName === f.registration.event.name,
      ),
    ).toBe(false);
    const current = await rescheduling(h, f.matchId);
    data(
      await reschedule(h, current, {
        startsAt: new Date(Date.parse(current.match.startsAt) + 120 * 60000).toISOString(),
      }),
    );
    expect(
      (
        await h.api.pool.query(
          "SELECT count(*)::int AS n FROM notification_source_events WHERE org_id=$1 AND resource_id=$2 AND kind='MATCH_RESCHEDULED'",
          [h.owner.orgId, f.matchId],
        )
      ).rows[0]!.n,
    ).toBe(1);
    await s.drain();
    expect(sends).toBe(0);
    expect((await delivery(f.row.delivery_id)).state).toBe('CANCELLED');
    expect((await s.list(h.owner.cookie, {})).items.some((x) => x.id === f.row.id)).toBe(false);
    await tx((c) => s.capture(c, { ...f.source, kind: 'MATCH_RESCHEDULED' }));
    await s.fanout();
    expect(
      (await s.list(h.owner.cookie, {})).items.some(
        (x) => x.kind === 'MATCH_RESCHEDULED' && x.eventName === f.registration.event.name,
      ),
    ).toBe(true);
  });

  it('recovers an expired durable lease as UNKNOWN without ever calling the provider', async () => {
    let sends = 0;
    const s = service(async () => {
      sends++;
      return { state: 'ACCEPTED' };
    });
    const f = await soon(s);
    await allow(s);
    const claim = await (s as any).claim(f.row.delivery_id);
    expect(claim).not.toBeNull();
    await h.api.pool.query(
      "UPDATE notification_deliveries SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [f.row.delivery_id],
    );
    await s.recoverExpiredLeases();
    await s.drain();
    expect(sends).toBe(0);
    expect((await delivery(f.row.delivery_id)).state).toBe('UNKNOWN');
    expect(
      (
        await h.api.pool.query(
          'SELECT state FROM notification_delivery_attempts WHERE delivery_id=$1',
          [f.row.delivery_id],
        )
      ).rows[0]!.state,
    ).toBe('UNKNOWN');
  });

  it('revoking a recovered SENDING capability preserves UNKNOWN instead of claiming an external send was recalled', async () => {
    const target = 'synthetic-e05-leader';
    await h.api.pool.query(
      'INSERT INTO wechat_identities(id,user_id,app_id,openid_hash) VALUES($1,$2,$3,$4)',
      [randomUUID(), h.leader.id, appId, hashToken(appId + '\n' + target)],
    );
    let sends = 0;
    const s = service(
      async () => {
        sends++;
        return { state: 'ACCEPTED' };
      },
      { exchange: async () => ({ appId, openid: target }) },
    );
    const f = await soon(s);
    const permission = await allow(s, h.leader);
    const row = (
      await h.api.pool.query(
        `SELECT d.id FROM notification_deliveries d JOIN notification_messages m ON m.id=d.message_id JOIN notification_source_events s ON s.id=m.source_id WHERE m.user_id=$1 AND s.resource_id=$2 AND s.kind='MATCH_STARTING'`,
        [h.leader.id, f.matchId],
      )
    ).rows[0]!;
    await (s as any).claim(row.id);
    await tx((c) => revokeNotificationGrants(c, h.leader.id));
    expect((await delivery(row.id)).state).toBe('UNKNOWN');
    expect(
      (
        await h.api.pool.query(
          'SELECT state FROM notification_delivery_attempts WHERE delivery_id=$1',
          [row.id],
        )
      ).rows[0]!.state,
    ).toBe('UNKNOWN');
    expect(
      (
        await h.api.pool.query(
          'SELECT status,target_cipher FROM notification_subscription_grants WHERE id=$1',
          [permission.confirmed.subscriptionId],
        )
      ).rows[0],
    ).toMatchObject({ status: 'REVOKED', target_cipher: null });
    await s.drain();
    expect(sends).toBe(0);
  });

  it('a new public follow catches up a completed fanout but does not create external permission; revocation hides it', async () => {
    let sends = 0;
    const s = service(async () => {
      sends++;
      return { state: 'ACCEPTED' };
    });
    const f = await soon(s);
    data(
      await call(h.api, 'put', scoringRulesPath(h.owner.orgId, f.eventId), {
        cookie: h.owner.cookie,
        body: { expectedEventVersion: f.publication.event.version, ...defaultRules() },
      }),
    );
    await savePublishRules(h, f.eventId);
    const publicView = await enable(h, f.eventId);
    const key = publicView.publication!.publicEventId;
    expect(
      (await s.list(h.otherOwner.cookie, {})).items.some(
        (x) => x.eventName === f.registration.event.name,
      ),
    ).toBe(false);
    data(
      await call(h.api, 'post', '/v1/me/follows', {
        cookie: h.otherOwner.cookie,
        body: { publicEventId: key },
      }),
      201,
    );
    await s.fanout();
    await s.drain();
    const inbox = await s.list(h.otherOwner.cookie, {});
    expect(inbox.items.find((x) => x.eventName === f.registration.event.name)?.delivery).toBe(
      'WAITING_PERMISSION',
    );
    expect(sends).toBe(0);
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int AS n FROM notification_subscription_grants WHERE user_id=$1',
          [h.otherOwner.id],
        )
      ).rows[0]!.n,
    ).toBe(0);
    await disable(h, f.eventId);
    expect(
      (await s.list(h.otherOwner.cookie, {})).items.some(
        (x) => x.eventName === f.registration.event.name,
      ),
    ).toBe(false);
  });

  it('derives review messages from committed business review history without copying confidential reasons', async () => {
    const s = service();
    const current = await openRegistration(h.api, h.owner, 'E05审核通知');
    const submitted = await submittedEntry(h.api, h.owner, current, h.leader, 'E05审核球队');
    const reviewed = await command(
      h.api,
      h.owner,
      submitted.entry,
      h.owner,
      'REQUEST_CHANGES',
      '合成证件号码 private-material-123',
    );
    expect(
      (
        await h.api.pool.query(
          "SELECT count(*)::int AS n FROM notification_source_events WHERE org_id=$1 AND resource_id=$2 AND kind='REGISTRATION_REVIEW'",
          [h.owner.orgId, reviewed.id],
        )
      ).rows[0]!.n,
    ).toBe(1);
    await tx((c) =>
      s.capture(c, {
        kind: 'REGISTRATION_REVIEW',
        orgId: h.owner.orgId,
        eventId: current.event.id,
        resourceId: reviewed.id,
      }),
    );
    const sourceId = (
      await h.api.pool.query(
        "SELECT id FROM notification_source_events WHERE org_id=$1 AND resource_id=$2 AND kind='REGISTRATION_REVIEW'",
        [h.owner.orgId, reviewed.id],
      )
    ).rows[0]!.id;
    await fanoutCommitted(s, sourceId);
    const owner = await allMessages(s, h.owner.cookie),
      leader = await allMessages(s, h.leader.cookie);
    expect(
      owner.some((x) => x.kind === 'REGISTRATION_REVIEW' && x.detail === '报名需要补充资料'),
    ).toBe(true);
    expect(
      leader.some((x) => x.kind === 'REGISTRATION_REVIEW' && x.eventName === current.event.name),
    ).toBe(true);
    expect(JSON.stringify(owner)).not.toContain('private-material-123');
    await grant(h.api, h.owner, submitted.team, h.leader, 'DISABLED');
    expect(
      (await s.list(h.leader.cookie, {})).items.some((x) => x.eventName === current.event.name),
    ).toBe(false);
  });

  it('gives reviews inside the two-hour boundary a fair slot alongside starts and retires expired work separately', async () => {
    const s = new NotificationService(
      h.api.pool,
      { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
      { autoDispatch: false },
    );
    services.push(s);
    const eventId = (
      await h.api.pool.query(
        'SELECT id FROM events WHERE org_id=$1 ORDER BY created_at,id LIMIT 1',
        [h.owner.orgId],
      )
    ).rows[0]!.id;
    const within = randomUUID(),
      outside = randomUUID(),
      expired = randomUUID(),
      starts = Array.from({ length: 12 }, () => randomUUID());
    const probes = [
      { id: within, kind: 'REGISTRATION_REVIEW', ttl: '2 hours', touched: '2000-01-01' },
      { id: outside, kind: 'REGISTRATION_REVIEW', ttl: '121 minutes', touched: '1990-01-01' },
      { id: expired, kind: 'REGISTRATION_REVIEW', ttl: null, touched: '1990-01-01' },
      ...starts.map((id) => ({
        id,
        kind: 'MATCH_STARTING',
        ttl: '10 minutes',
        touched: '2000-01-02',
      })),
    ];
    await tx(async (c) => {
      for (const p of probes) {
        // Queue-priority probes intentionally lack a current business proof. They must be
        // inspected fairly and retired, and must never fabricate a notification body/send.
        await c.query(
          `INSERT INTO notification_source_events(id,org_id,event_id,kind,resource_id,source_fingerprint,due_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7::text IS NULL THEN '1999-01-01'::timestamptz ELSE statement_timestamp()-interval '1 minute' END,
       CASE WHEN $7::text IS NULL THEN '2000-01-01'::timestamptz ELSE statement_timestamp()+$7::interval END)`,
          [p.id, h.owner.orgId, eventId, p.kind, randomUUID(), hashToken(p.id), p.ttl],
        );
        await c.query(
          'INSERT INTO notification_fanout_state(source_id,updated_at) VALUES($1,$2::timestamptz)',
          [p.id, p.touched],
        );
      }
    });
    await s.fanout();
    const states = (
      await h.api.pool.query(
        'SELECT source_id,done FROM notification_fanout_state WHERE source_id=ANY($1::uuid[])',
        [probes.map((p) => p.id)],
      )
    ).rows;
    expect(states.find((p) => p.source_id === within)?.done).toBe(true);
    expect(states.find((p) => p.source_id === outside)?.done).toBe(false);
    expect(states.find((p) => p.source_id === expired)?.done).toBe(true);
    expect(states.filter((p) => starts.includes(p.source_id) && p.done)).toHaveLength(9);
    expect(states.filter((p) => starts.includes(p.source_id) && !p.done)).toHaveLength(3);
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int AS n FROM notification_messages WHERE source_id=ANY($1::uuid[])',
          [probes.map((p) => p.id)],
        )
      ).rows[0]!.n,
    ).toBe(0);
  });
});
