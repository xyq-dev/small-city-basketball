import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { assertOwnedRestoreTarget } from '../../../ops/db/common.mjs';
import { quarantineRestoredDatabase } from '../../../ops/recovery/quarantine.mjs';
import { createApi } from '../src/app.js';
import { REGION_CATALOG_VERSION } from '../src/region-catalog-data.js';
import { hashPassword, verifyPassword } from '../src/security.js';
import { call, createEvent, data, login, ORIGIN, PASSWORD } from './support.js';
import type { User } from './support.js';
import { acceptPath, invitationsPath, invite, team } from './p03-support.js';
import { acquire, assign, commandsPath, prepare, published, renew } from './p05-support.js';
import type { Harness } from './p05-support.js';
import {
  anonymous,
  confirmMatch,
  disable,
  enable,
  publicEventPath,
  savePublishRules,
} from './p05b-support.js';
import { bootstrap, issue, overlayCookie, overlaySnapshot, rotate } from './p06-support.js';
import { createOwnedRestoreDatabase } from './p07-support.js';

type Target = Awaited<ReturnType<typeof createOwnedRestoreDatabase>>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/** Pause after an actual successful SQL statement, without replacing its result or locks. */
function pauseAfter(pool: Pool, matches: (sql: string) => boolean) {
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const proceed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originals = new Map<PoolClient, PoolClient['query']>();
  let used = false;
  const attach = (client: PoolClient) => {
    if (originals.has(client)) return;
    const original = client.query;
    originals.set(client, original);
    client.query = function (...args: unknown[]) {
      const result = Reflect.apply(original, client, args);
      if (!used && typeof args[0] === 'string' && matches(args[0])) {
        used = true;
        return Promise.resolve(result).then(async (rows) => {
          entered();
          await proceed;
          return rows;
        });
      }
      return result;
    } as PoolClient['query'];
  };
  pool.on('acquire', attach);
  return {
    reached,
    release,
    restore() {
      release();
      pool.off('acquire', attach);
      for (const [client, original] of originals) client.query = original;
    },
  };
}

async function within<T>(pending: Promise<T>, milliseconds = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Deterministic concurrency barrier timed out')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function activeReplacement(target: Target, seeded: Awaited<ReturnType<typeof fixture>>) {
  const current = (
    await target.pool.query<{ id: string; event_id: string; version: number }>(
      `SELECT l.id,l.event_id,e.version FROM event_directory_listings l
     JOIN events e ON e.id=l.event_id WHERE l.status='ACTIVE'`,
    )
  ).rows[0]!;
  return {
    path: `/v1/orgs/${seeded.h.owner.orgId}/events/${current.event_id}/directory-commands`,
    body: {
      type: 'REPLACE_REGION',
      expectedEventVersion: current.version,
      expectedListingId: current.id,
      region: {
        catalogVersion: REGION_CATALOG_VERSION,
        regionId: '5dbae224-8a72-5c66-8b2e-d6a7a9f312e3',
      },
      reason: '合成恢复并发地区更正',
    },
  };
}

async function assertQuarantined(target: Target, seeded: Awaited<ReturnType<typeof fixture>>) {
  expect(
    (await target.pool.query("SELECT id FROM event_directory_listings WHERE status='ACTIVE'")).rows,
  ).toEqual([]);
  expect(
    (await target.pool.query('SELECT id FROM public_event_publications WHERE revoked_at IS NULL'))
      .rows,
  ).toEqual([]);
  expect(data(await anonymous(seeded.h, '/v1/public/directory?status=LIVE'))).toEqual([]);
  expect((await anonymous(seeded.h, publicEventPath(seeded.publicId))).status).toBe(404);
}

test('C22 an in-flight REPLACE makes offline quarantine fail immediately and wholly; retry after draining revokes the replacement', async () => {
  const target = await createOwnedRestoreDatabase();
  let seeded: Awaited<ReturnType<typeof fixture>> | undefined;
  let barrier: ReturnType<typeof pauseAfter> | undefined;
  let pendingReplace: ReturnType<typeof call> | undefined;
  let pendingQuarantine: Promise<unknown> | undefined;
  try {
    seeded = await fixture(target);
    const request = await activeReplacement(target, seeded);
    const before = await fingerprints(target.pool);
    // Hold the real API transaction after sessions/users FOR SHARE, before it asks for
    // organizations. The old quarantine waits with org/event table locks for 15 seconds;
    // NOWAIT must reject within this 5-second observation while the API stays paused.
    barrier = pauseAfter(seeded.h.api.pool, (sql) =>
      sql.includes('FROM users WHERE id=$1 FOR SHARE'),
    );
    pendingReplace = call(seeded.h.api, 'post', request.path, {
      cookie: seeded.h.owner.cookie,
      body: request.body,
    });
    await within(barrier.reached);
    pendingQuarantine = quarantineRestoredDatabase(target);
    await within(expect(pendingQuarantine).rejects.toThrow('Restore quarantine failed'));
    expect(await fingerprints(target.pool)).toEqual(before);
    barrier.restore();
    data(await within(pendingReplace));
    // It is an offline operator retry after writers have drained, never an automatic retry.
    const quarantine = await quarantineRestoredDatabase(target);
    expect(quarantine.status).toBe('quarantined');
    await assertQuarantined(target, seeded);
  } finally {
    barrier?.restore();
    await Promise.allSettled([pendingReplace, pendingQuarantine]);
    if (seeded) {
      await seeded.h.api.app.close();
      await seeded.h.api.pool.end();
    }
    await target.close();
  }
}, 120000);

test('C22 quarantine holding every table lock commits before REPLACE and its revoked session cannot revive a listing', async () => {
  const target = await createOwnedRestoreDatabase();
  let seeded: Awaited<ReturnType<typeof fixture>> | undefined;
  let barrier: ReturnType<typeof pauseAfter> | undefined;
  let pendingReplace: ReturnType<typeof call> | undefined;
  let pendingQuarantine: Promise<{ status: string }> | undefined;
  try {
    seeded = await fixture(target);
    const request = await activeReplacement(target, seeded);
    // The recovery operation has actually acquired all EXCLUSIVE locks. This barrier is
    // before it chooses the revocation time; the HTTP request then demonstrably waits on
    // the sessions table and must observe revoked credentials after quarantine commits.
    barrier = pauseAfter(target.pool, (sql) => /^LOCK TABLE organizations,/.test(sql));
    pendingQuarantine = quarantineRestoredDatabase(target);
    await within(barrier.reached);
    pendingReplace = call(seeded.h.api, 'post', request.path, {
      cookie: seeded.h.owner.cookie,
      body: request.body,
    });
    await within(
      (async () => {
        const deadline = Date.now() + 4500;
        while (Date.now() < deadline) {
          const waiting = (
            await target.pool.query<{ waiting: boolean }>(
              `SELECT EXISTS(SELECT 1 FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database())
           AND relation='sessions'::regclass AND mode='RowShareLock' AND NOT granted) AS waiting`,
            )
          ).rows[0]!.waiting;
          if (waiting) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('REPLACE did not wait for the held quarantine lock');
      })(),
    );
    barrier.restore();
    expect((await within(pendingQuarantine)).status).toBe('quarantined');
    const response = await within(pendingReplace);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    await assertQuarantined(target, seeded);
  } finally {
    barrier?.restore();
    await Promise.allSettled([pendingReplace, pendingQuarantine]);
    if (seeded) {
      await seeded.h.api.app.close();
      await seeded.h.api.pool.end();
    }
    await target.close();
  }
}, 120000);

async function fingerprints(pool: Pool, selected?: readonly string[]) {
  const tables = selected
    ? [...selected]
    : (
        await pool.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        )
      ).rows.map((row) => row.tablename);
  const result: Record<string, string> = {};
  for (const tableName of tables) {
    const row = (
      await pool.query<{ content: unknown }>(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS content FROM public.${quote(tableName)} t`,
      )
    ).rows[0]!;
    // Failure output contains aggregate digests, never restored credentials or row bodies.
    result[tableName] = hash(JSON.stringify(row.content));
  }
  return result;
}

async function fixture(target: Target) {
  const api = await createApi({ databaseUrl: target.databaseUrl, appOrigin: ORIGIN });
  try {
    const actors: User[] = [];
    for (const label of ['owner', 'scorer', 'leader']) {
      const actor: User = {
        id: randomUUID(),
        orgId: label === 'leader' ? '' : randomUUID(),
        email: `p07-${label}-${randomUUID()}@example.test`,
        cookie: '',
      };
      await api.pool.query(
        'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [actor.id, actor.email, `隔离恢复合成 ${label}`, await hashPassword(PASSWORD)],
      );
      if (actor.orgId) {
        await api.pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
          actor.orgId,
          `恢复合成机构 ${label}`,
        ]);
        await api.pool.query(
          "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
          [actor.orgId, actor.id],
        );
      }
      actor.cookie = await login(api, actor);
      actors.push(actor);
    }
    const [owner, otherOwner, leader] = actors as [User, User, User];
    await api.pool.query(
      "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'EVENT_MANAGER')",
      [owner.orgId, otherOwner.id],
    );
    const h: Harness = {
      api,
      owner,
      otherOwner,
      leader,
      teams: [],
      otherTeams: [],
      databaseUrl: target.databaseUrl,
      nextDate: 0,
    };
    for (let index = 0; index < 4; index++) {
      h.teams.push(await team(api, owner, `恢复球队 ${index}`, leader, ['合成甲', '合成乙']));
    }
    const schedule = await published(h);
    const final = await confirmMatch(h, schedule, 0, 2, 1);
    const activeLease = final.lease;
    // Explicit fixture times make both the live and expired lease branches deterministic.
    await api.pool.query(
      "UPDATE scoring_leases SET expires_at=clock_timestamp()+interval '10 minutes' WHERE org_id=$1 AND match_id=$2",
      [owner.orgId, final.matchId],
    );
    const expiredLeaseMatch = schedule.matches[1]!.id;
    await assign(h, expiredLeaseMatch, otherOwner);
    await prepare(h, expiredLeaseMatch);
    await acquire(h, expiredLeaseMatch, otherOwner);
    await api.pool.query(
      "UPDATE scoring_leases SET expires_at=clock_timestamp()-interval '1 minute' WHERE org_id=$1 AND match_id=$2",
      [owner.orgId, expiredLeaseMatch],
    );
    const emptyLeaseMatch = schedule.matches[2]!.id;
    await api.pool.query('INSERT INTO scoring_leases(org_id,event_id,match_id) VALUES($1,$2,$3)', [
      owner.orgId,
      schedule.event.event.id,
      emptyLeaseMatch,
    ]);
    await savePublishRules(h, schedule.event.event.id);
    await enable(h, schedule.event.event.id);
    await disable(h, schedule.event.event.id);
    const publicViewing = await enable(h, schedule.event.event.id);
    const publicId = publicViewing.publication!.publicEventId;
    // C18: an explicit directory listing must not survive (or be revived by) a restore.
    const directoryPath = `/v1/orgs/${owner.orgId}/events/${schedule.event.event.id}/directory`;
    const directoryVersion = data<{ event: { version: number } }>(
      await call(api, 'get', directoryPath, { cookie: owner.cookie }),
    ).event.version;
    data(
      await call(api, 'post', `${directoryPath}-commands`, {
        cookie: owner.cookie,
        body: { type: 'LIST', expectedEventVersion: directoryVersion, reason: '恢复前目录上架' },
      }),
    );
    const firstOverlay = await issue(h, final.matchId);
    if (!firstOverlay.credential) throw new Error('Synthetic overlay fixture has no credential');
    const firstBootstrap = await bootstrap(
      h,
      firstOverlay.credential.overlayId,
      firstOverlay.credential.token,
    );
    expect(firstBootstrap.status).toBe(200);
    const currentOverlay = await rotate(h, final.matchId);
    if (!currentOverlay.credential) throw new Error('Synthetic overlay fixture has no credential');
    const currentBootstrap = await bootstrap(
      h,
      currentOverlay.credential.overlayId,
      currentOverlay.credential.token,
    );
    expect(currentBootstrap.status).toBe(200);
    const sourceCookie = overlayCookie(currentBootstrap);
    // An expired-but-unrevoked grant must be closed too, without changing its immutable TTL.
    await api.pool.query(
      `INSERT INTO overlay_grants(id,org_id,event_id,match_id,overlay_id,secret_hash,issuer_id,created_at,expires_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,t-interval '2 hours',t-interval '1 hour' FROM (SELECT clock_timestamp() AS t) clock`,
      [
        randomUUID(),
        owner.orgId,
        schedule.event.event.id,
        schedule.matches[3]!.id,
        opaque(),
        hash(opaque()),
        owner.id,
      ],
    );
    const pending = await invite(api, owner, h.teams[0]!, leader);
    const consumed = await invite(api, owner, h.teams[0]!, leader);
    data(
      await call(api, 'post', acceptPath(consumed.invitation.id), {
        cookie: leader.cookie,
        body: { token: consumed.token },
      }),
    );
    const revoked = await invite(api, owner, h.teams[0]!, leader);
    data(
      await call(
        api,
        'post',
        `${invitationsPath(owner.orgId, h.teams[0]!.id)}/${revoked.invitation.id}/revoke`,
        {
          cookie: owner.cookie,
          body: {},
        },
      ),
    );
    await createEvent(api, otherOwner, '另一机构隔离草稿');
    return {
      h,
      pending,
      consumedId: consumed.invitation.id,
      revokedId: revoked.invitation.id,
      publicId,
      overlayCredential: currentOverlay.credential,
      sourceCookie,
      activeLease,
      activeLeaseMatch: final.matchId,
      expiredLeaseMatch,
      emptyLeaseMatch,
    };
  } catch (error) {
    await api.app.close();
    await api.pool.end();
    throw error;
  }
}

describe('P07 owned restore quarantine on the real migrated PostgreSQL schema', () => {
  let target: Target;
  let seeded: Awaited<ReturnType<typeof fixture>>;

  beforeAll(async () => {
    target = await createOwnedRestoreDatabase();
    seeded = await fixture(target);
  }, 120000);

  afterAll(async () => {
    if (seeded) {
      await seeded.h.api.app.close();
      await seeded.h.api.pool.end();
    }
    await target?.close();
  });

  test('accepts shared-catalog ownership from either database and rejects a wrong name, OID or nonce', async () => {
    // Database comments are cluster-shared objects, stored in pg_shdescription.
    // Check the catalog directly from both the control and restored database;
    // obj_description wrongly looks in the per-database description catalog.
    for (const connection of [target.adminPool, target.pool]) {
      const comment = (
        await connection.query<{ description: string }>(
          `SELECT s.description FROM pg_database d JOIN pg_shdescription s
           ON s.objoid=d.oid AND s.classoid='pg_database'::regclass
           WHERE d.datname=$1`,
          [target.ownership.databaseName],
        )
      ).rows[0]?.description;
      expect(comment).toBe(`scb_restore_owner:${target.ownership.nonce}`);
    }
    await expect(assertOwnedRestoreTarget(target.pool, target.ownership)).resolves.toBeUndefined();
    const before = await fingerprints(target.pool);
    for (const ownership of [
      { ...target.ownership, databaseName: 'scb_test_production_control' },
      { ...target.ownership, databaseOid: target.ownership.databaseOid + 1 },
      { ...target.ownership, nonce: randomUUID() },
    ]) {
      await expect(quarantineRestoredDatabase({ pool: target.pool, ownership })).rejects.toThrow(
        'Restore quarantine failed',
      );
    }
    expect(await fingerprints(target.pool)).toEqual(before);
  });

  test('an audit failure rolls back every credential, version, organization and system actor change', async () => {
    const before = await fingerprints(target.pool);
    await target.pool
      .query(`CREATE FUNCTION p07_quarantine_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='RESTORE_QUARANTINE' THEN RAISE EXCEPTION 'Synthetic P07 audit rejection'; END IF; RETURN NEW; END; $$`);
    await target.pool.query(`CREATE TRIGGER p07_quarantine_fail_audit BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION p07_quarantine_fail_audit()`);
    try {
      await expect(quarantineRestoredDatabase(target)).rejects.toThrow('Restore quarantine failed');
      expect(await fingerprints(target.pool)).toEqual(before);
    } finally {
      await target.pool.query('DROP TRIGGER p07_quarantine_fail_audit ON audit_logs');
      await target.pool.query('DROP FUNCTION p07_quarantine_fail_audit()');
    }
  });

  test('closes old access atomically while preserving immutable results, empty leases and counters', async () => {
    const mutable = new Set([
      'users',
      'sessions',
      'organizations',
      'events',
      'team_invitations',
      'public_event_publications',
      'event_directory_listings',
      'overlay_grants',
      'scoring_leases',
      'audit_logs',
    ]);
    const all = await fingerprints(target.pool);
    const protectedNames = Object.keys(all).filter((name) => !mutable.has(name));
    const protectedBefore = await fingerprints(target.pool, protectedNames);
    const historicalBefore = await target.pool.query(
      `SELECT (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public_event_publications p WHERE revoked_at IS NOT NULL) AS public,
       (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM overlay_grants g WHERE revoked_at IS NOT NULL) AS overlay,
       (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM team_invitations i WHERE accepted_at IS NOT NULL OR revoked_at IS NOT NULL) AS invitations`,
    );
    const historyDigest = hash(JSON.stringify(historicalBefore.rows));
    const leasesBefore = (
      await target.pool.query(
        'SELECT *,expires_at::text AS exact_expiry FROM scoring_leases ORDER BY match_id',
      )
    ).rows;
    const eventsBefore = (await target.pool.query('SELECT id,version FROM events')).rows;
    const result = await quarantineRestoredDatabase(target);
    expect(result.status).toBe('quarantined');
    expect(result.counts).toMatchObject({
      pendingInvitationsRevoked: 1,
      publicPublicationsRevoked: 1,
      overlayGrantsRevoked: 2,
      activeLeasesExpired: 1,
      organizationsDisabled: 2,
      eventsTouched: eventsBefore.length,
    });
    expect(result.counts.sessionsRevoked).toBeGreaterThanOrEqual(3);
    const system = (
      await target.pool.query('SELECT * FROM users WHERE id=$1', [result.systemUserId])
    ).rows[0]!;
    expect(system.status).toBe('DISABLED');
    expect(system.password_hash.length >= 80 && system.password_hash.length <= 256).toBe(true);
    expect(system.password_hash.startsWith('scrypt$')).toBe(false);
    expect(await verifyPassword(PASSWORD, system.password_hash)).toBe(false);
    expect(
      (
        await target.pool.query(
          'SELECT count(*)::int AS n FROM organization_memberships WHERE user_id=$1',
          [system.id],
        )
      ).rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await target.pool.query(
          "SELECT count(*)::int AS n FROM organizations WHERE status<>'DISABLED'",
        )
      ).rows[0]!.n,
    ).toBe(0);
    expect(
      (await target.pool.query('SELECT count(*)::int AS n FROM sessions WHERE revoked_at IS NULL'))
        .rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await target.pool.query(
          'SELECT count(*)::int AS n FROM overlay_grants WHERE revoked_at IS NULL',
        )
      ).rows[0]!.n,
    ).toBe(0);
    for (const event of eventsBefore) {
      expect(
        (await target.pool.query('SELECT version FROM events WHERE id=$1', [event.id])).rows[0]!
          .version,
      ).toBe(event.version + 1);
    }
    expect(await fingerprints(target.pool, protectedNames)).toEqual(protectedBefore);
    const historicalAfter = await target.pool.query(
      `SELECT (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public_event_publications p WHERE id=ANY($1::uuid[])) AS public,
       (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM overlay_grants g WHERE id=ANY($2::uuid[])) AS overlay,
       (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM team_invitations i WHERE accepted_at IS NOT NULL OR id=$3) AS invitations`,
      [
        historicalBefore.rows[0]!.public.map((row: { id: string }) => row.id),
        historicalBefore.rows[0]!.overlay.map((row: { id: string }) => row.id),
        seeded.revokedId,
      ],
    );
    expect(hash(JSON.stringify(historicalAfter.rows))).toBe(historyDigest);
    const leasesAfter = (
      await target.pool.query(
        'SELECT *,expires_at::text AS exact_expiry FROM scoring_leases ORDER BY match_id',
      )
    ).rows;
    for (const before of leasesBefore) {
      const after = leasesAfter.find((row) => row.match_id === before.match_id)!;
      const { expires_at: ignoredBefore, exact_expiry: exactBefore, ...beforeIdentity } = before;
      const { expires_at: ignoredAfter, exact_expiry: exactAfter, ...afterIdentity } = after;
      expect(afterIdentity).toEqual(beforeIdentity);
      if (before.match_id === seeded.activeLeaseMatch) {
        expect(Date.parse(exactAfter)).toBeLessThan(Date.parse(exactBefore));
      } else expect(exactAfter).toBe(exactBefore);
    }
    expect(
      (await call(seeded.h.api, 'get', '/v1/auth/session', { cookie: seeded.h.owner.cookie }))
        .status,
    ).toBe(401);
    expect((await anonymous(seeded.h, publicEventPath(seeded.publicId))).status).toBe(404);
    // The directory listing went with its publication, recorded against the restore actor.
    const listings = (
      await target.pool.query(
        'SELECT status,revoke_source,revoked_by FROM event_directory_listings',
      )
    ).rows;
    expect(listings).toEqual([
      { status: 'REVOKED', revoke_source: 'PUBLICATION_REVOKED', revoked_by: result.systemUserId },
    ]);
    expect(
      data<unknown[]>(await anonymous(seeded.h, '/v1/public/directory?status=UPCOMING')),
    ).toEqual([]);
    expect(
      (await overlaySnapshot(seeded.h, seeded.overlayCredential.overlayId, seeded.sourceCookie))
        .status,
    ).toBe(404);
    expect(
      (
        await bootstrap(
          seeded.h,
          seeded.overlayCredential.overlayId,
          seeded.overlayCredential.token,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(seeded.h.api, 'post', acceptPath(seeded.pending.invitation.id), {
          cookie: seeded.h.leader.cookie,
          body: { token: seeded.pending.token },
        })
      ).status,
    ).toBe(401);
    expect(
      (await renew(seeded.h, seeded.activeLeaseMatch, seeded.h.otherOwner, seeded.activeLease))
        .status,
    ).toBe(401);
    const relogged = await login(seeded.h.api, seeded.h.owner);
    const session = data<{ organizations: unknown[]; teamContexts: unknown[] }>(
      await call(seeded.h.api, 'get', '/v1/auth/session', { cookie: relogged }),
    );
    expect(session.organizations).toEqual([]);
    expect(session.teamContexts).toEqual([]);
    expect(
      (
        await call(
          seeded.h.api,
          'post',
          commandsPath(seeded.h.owner.orgId, seeded.activeLeaseMatch),
          {
            cookie: relogged,
            body: {
              commandId: randomUUID(),
              expectedVersion: 1,
              type: 'CONFIRM_RESULT',
              payload: {},
              capturedAt: new Date().toISOString(),
            },
          },
        )
      ).status,
    ).toBe(404);
  });

  test('a repeated quarantine never mutates already revoked histories or immutable session/lease facts', async () => {
    const names = [
      'public_event_publications',
      'event_directory_listings',
      'overlay_grants',
      'overlay_sessions',
      'scoring_leases',
      'published_matches',
      'scoring_states',
      'scoring_events',
      'scoring_commands',
      'result_confirmations',
      'events',
    ];
    const before = await fingerprints(target.pool, names);
    const result = await quarantineRestoredDatabase(target);
    expect(result.counts).toMatchObject({
      pendingInvitationsRevoked: 0,
      publicPublicationsRevoked: 0,
      overlayGrantsRevoked: 0,
      activeLeasesExpired: 0,
      organizationsDisabled: 0,
      eventsTouched: 0,
    });
    expect(await fingerprints(target.pool, names)).toEqual(before);
  });
});
