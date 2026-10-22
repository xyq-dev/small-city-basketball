import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { OverlayBootstrapData, OverlaySnapshotData } from '@small-city-basketball/contracts';
import { createApi } from '../src/app.js';
import { call, data, error, eventually, setCookies } from './support.js';
import {
  APPLICATION_NAME,
  blockedPid,
  bootstrap,
  bootstrapPath,
  closeHarness,
  createScoringHarness,
  issue,
  overlayCommand,
  overlayCookie,
  overlayData,
  overlaySnapshot,
  overlayWorkbench,
  published,
  withRowsLocked,
} from './p06-support.js';
import type { Harness } from './p06-support.js';

const opaque = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function notFound(response: Response): void {
  error(response, 404);
  expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
  expect(response.body.error).not.toHaveProperty('details');
}

async function sessions(h: Harness, overlayId: string) {
  return (
    await h.api.pool.query<{ id: string; token_hash: string; created_at: Date; expires_at: Date }>(
      `SELECT s.id,s.token_hash,s.created_at,s.expires_at FROM overlay_sessions s
       JOIN overlay_grants g ON g.id=s.grant_id WHERE g.overlay_id=$1 ORDER BY s.id`,
      [overlayId],
    )
  ).rows;
}

async function persistentState(h: Harness, eventId: string): Promise<unknown> {
  return (
    await h.api.pool.query<{ value: unknown }>(
      `SELECT jsonb_build_object(
         'event',(SELECT to_jsonb(e) FROM events e WHERE e.org_id=$1 AND e.id=$2),
         'matches',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM published_matches m WHERE m.org_id=$1 AND m.event_id=$2),
         'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM overlay_grants g WHERE g.org_id=$1 AND g.event_id=$2),
         'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM overlay_sessions s WHERE s.org_id=$1 AND s.event_id=$2),
         'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_logs a WHERE a.org_id=$1)
       ) AS value`,
      [h.owner.orgId, eventId],
    )
  ).rows[0]!.value;
}

// Deliberately inserted, valid synthetic history avoids mutating immutable expiry.
// Normal API-issued grants and bootstrap sessions are exercised in the other cases.
async function historicalGrant(
  h: Harness,
  eventId: string,
  matchId: string,
  millisecondsUntilExpiry: number,
) {
  const id = randomUUID();
  const overlayId = opaque();
  const token = opaque();
  const result = await h.api.pool.query<{ expires_at: Date }>(
    `WITH deadline AS (SELECT clock_timestamp()+($8::integer * interval '1 millisecond') AS expires_at)
     INSERT INTO overlay_grants(id,org_id,event_id,match_id,overlay_id,secret_hash,issuer_id,created_at,expires_at)
     SELECT $1,$2,$3,$4,$5,$6,$7,expires_at-interval '1 minute',expires_at FROM deadline
     RETURNING expires_at`,
    [
      id,
      h.owner.orgId,
      eventId,
      matchId,
      overlayId,
      hash(token),
      h.owner.id,
      millisecondsUntilExpiry,
    ],
  );
  return { id, eventId, matchId, overlayId, token, expiresAt: result.rows[0]!.expires_at };
}

async function historicalSession(h: Harness, grantId: string) {
  const id = randomUUID();
  const token = opaque();
  const result = await h.api.pool.query(
    `INSERT INTO overlay_sessions(id,org_id,event_id,match_id,grant_id,token_hash,created_at,expires_at)
     SELECT $1,org_id,event_id,match_id,id,$2,created_at,expires_at FROM overlay_grants WHERE id=$3`,
    [id, hash(token), grantId],
  );
  expect(result.rowCount).toBe(1);
  return { id, token, cookie: `scb.overlay=${token}` };
}

describe('P06 overlay sessions and database guards (isolated real PostgreSQL)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createScoringHarness(3);
  }, 60000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  });

  test('bootstrap verifies the secret before cookie reuse, reuses a matching session, and restores invalid or cross-grant cookies', async () => {
    const fixture = await published(h, h.teams.slice(0, 3));
    const first = await issue(h, fixture.matches[0]!.id);
    const second = await issue(h, fixture.matches[1]!.id);
    const credential = first.credential!;
    const otherCredential = second.credential!;
    expect(credential).toBeTruthy();
    const boot = await bootstrap(h, credential.overlayId, credential.token);
    const metadata = data<OverlayBootstrapData>(boot);
    expect(Object.keys(metadata).sort()).toEqual(['expiresAt', 'overlayId', 'serverTime']);
    const cookie = overlayCookie(boot);
    const original = await sessions(h, credential.overlayId);
    expect(original).toHaveLength(1);
    expect(original[0]!.token_hash === hash(cookie.slice('scb.overlay='.length))).toBe(true);
    expect(original[0]!.token_hash === cookie.slice('scb.overlay='.length)).toBe(false);
    data(await bootstrap(h, credential.overlayId, credential.token, cookie));
    expect(await sessions(h, credential.overlayId)).toEqual(original);

    // A valid cookie must not bypass verification of the supplied bootstrap secret.
    notFound(await bootstrap(h, credential.overlayId, opaque(), cookie));
    expect(await sessions(h, credential.overlayId)).toEqual(original);
    const restored = await bootstrap(h, credential.overlayId, credential.token, 'scb.overlay=bad');
    data(restored);
    expect(hash(overlayCookie(restored)) === hash(cookie)).toBe(false);
    expect(await sessions(h, credential.overlayId)).toHaveLength(2);

    const other = await bootstrap(h, otherCredential.overlayId, otherCredential.token);
    data(other);
    const cross = await bootstrap(h, credential.overlayId, credential.token, overlayCookie(other));
    data(cross);
    expect(await sessions(h, credential.overlayId)).toHaveLength(3);
    expect(await sessions(h, otherCredential.overlayId)).toHaveLength(1);
    data(await overlaySnapshot(h, credential.overlayId, overlayCookie(cross)));
    notFound(await overlaySnapshot(h, otherCredential.overlayId, overlayCookie(cross)));
  });

  test('dedicated cookies have exact Path, Strict, HttpOnly and host-only scope, Secure when configured, and bootstrap keeps the write Origin guard', async () => {
    const fixture = await published(h, h.teams.slice(0, 2));
    const issued = await issue(h, fixture.matches[0]!.id, 1);
    const credential = issued.credential!;
    const response = await bootstrap(h, credential.overlayId, credential.token);
    const metadata = data<OverlayBootstrapData>(response);
    const cookies = setCookies(response);
    expect(cookies.length).toBe(1);
    const header = cookies[0]!.slice(cookies[0]!.indexOf(';'));
    expect(header).toContain(`Path=/v1/overlays/${credential.overlayId}/`);
    expect(header).toMatch(/; HttpOnly(?:;|$)/);
    expect(header).toMatch(/; SameSite=Strict(?:;|$)/);
    expect(header).not.toMatch(/(?:^|;)\s*Domain=/i);
    expect(header).not.toMatch(/; Secure(?:;|$)/);
    const maxAge = Number(header.match(/(?:^|;)\s*Max-Age=(\d+)/)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(
      Math.floor((Date.parse(metadata.expiresAt) - Date.parse(metadata.serverTime)) / 1000),
    );
    const before = await sessions(h, credential.overlayId);
    for (const origin of [null, 'https://untrusted.example.test']) {
      const rejected = await bootstrap(
        h,
        credential.overlayId,
        credential.token,
        undefined,
        origin,
      );
      error(rejected, 403);
      expect(rejected.body.error.code).toBe('ORIGIN_REJECTED');
      expect(setCookies(rejected).length).toBe(0);
    }
    expect(await sessions(h, credential.overlayId)).toEqual(before);

    const secureOrigin = 'https://overlay.example.test';
    const secureApi = await createApi({
      databaseUrl: h.databaseUrl,
      appOrigin: secureOrigin,
      secureCookies: true,
    });
    try {
      const secure = await call(secureApi, 'post', bootstrapPath(credential.overlayId), {
        origin: secureOrigin,
        body: { token: credential.token },
      });
      data(secure);
      const secureCookies = setCookies(secure);
      expect(secureCookies.length).toBe(1);
      const attributes = secureCookies[0]!.slice(secureCookies[0]!.indexOf(';'));
      expect(attributes).toMatch(/; Secure(?:;|$)/);
      expect(attributes).toMatch(/; HttpOnly(?:;|$)/);
      expect(attributes).toContain(`Path=/v1/overlays/${credential.overlayId}/`);
      expect(attributes).not.toMatch(/(?:^|;)\s*Domain=/i);
    } finally {
      try {
        await secureApi.app.close();
      } finally {
        await secureApi.pool.end();
      }
    }
  });

  test('duplicate same-name cookies are rejected even for identical values, and private or wrong-grant cookies cannot authorize a snapshot', async () => {
    const fixture = await published(h, h.teams.slice(0, 3));
    const first = (await issue(h, fixture.matches[0]!.id)).credential!;
    const second = (await issue(h, fixture.matches[1]!.id)).credential!;
    const firstBoot = await bootstrap(h, first.overlayId, first.token);
    const secondBoot = await bootstrap(h, second.overlayId, second.token);
    data(firstBoot);
    data(secondBoot);
    const cookie = overlayCookie(firstBoot);
    const otherCookie = overlayCookie(secondBoot);
    const before = await persistentState(h, fixture.event.event.id);
    for (const ambiguous of [`${cookie}; ${cookie}`, `${cookie}; ${otherCookie}`]) {
      notFound(await overlaySnapshot(h, first.overlayId, ambiguous));
      notFound(await bootstrap(h, first.overlayId, first.token, ambiguous));
    }
    for (const invalid of [undefined, h.owner.cookie, otherCookie, 'scb.overlay=bad'])
      notFound(await overlaySnapshot(h, first.overlayId, invalid));
    notFound(await bootstrap(h, first.overlayId, opaque(), h.owner.cookie));
    const snapshot = data<OverlaySnapshotData>(await overlaySnapshot(h, first.overlayId, cookie));
    const withPrivate = data<OverlaySnapshotData>(
      await overlaySnapshot(h, first.overlayId, `${h.owner.cookie}; ${cookie}`),
    );
    expect({ ...withPrivate, serverTime: null }).toEqual({ ...snapshot, serverTime: null });
    expect(setCookies(await overlaySnapshot(h, first.overlayId, cookie)).length).toBe(0);
    expect(await persistentState(h, fixture.event.event.id)).toEqual(before);
  });

  test('sessions expire exactly with their grant; GET and valid-cookie bootstrap neither write nor extend the session', async () => {
    const fixture = await published(h, h.teams.slice(0, 2));
    const issued = await issue(h, fixture.matches[0]!.id, 1);
    const credential = issued.credential!;
    const boot = await bootstrap(h, credential.overlayId, credential.token);
    data(boot);
    const cookie = overlayCookie(boot);
    const joined = await h.api.pool.query<{
      same_deadline: boolean;
      token_hash: string;
      secret_hash: string;
    }>(
      `SELECT s.expires_at=g.expires_at AS same_deadline,s.token_hash,g.secret_hash
       FROM overlay_sessions s JOIN overlay_grants g ON g.id=s.grant_id WHERE g.overlay_id=$1`,
      [credential.overlayId],
    );
    expect(joined.rows).toHaveLength(1);
    expect(joined.rows[0]!.same_deadline).toBe(true);
    expect(joined.rows[0]!.token_hash === hash(cookie.slice('scb.overlay='.length))).toBe(true);
    expect(joined.rows[0]!.secret_hash === hash(credential.token)).toBe(true);
    const before = await persistentState(h, fixture.event.event.id);
    for (let index = 0; index < 3; index++) {
      const read = await overlaySnapshot(h, credential.overlayId, cookie);
      const snapshot = data<OverlaySnapshotData>(read);
      expect(snapshot.expiresAt).toBe(issued.currentGrant!.expiresAt);
      expect(read.headers['cache-control']).toBe('no-store');
      expect(setCookies(read).length).toBe(0);
    }
    data(await bootstrap(h, credential.overlayId, credential.token, cookie));
    expect(await persistentState(h, fixture.event.event.id)).toEqual(before);
  });

  test('006 accepts valid synthetic history, then rejects composite mismatches, duplicate identities, mutable expiry or sessions, and repeated revocation', async () => {
    const first = await published(h, h.teams.slice(0, 2));
    const second = await published(h, h.teams.slice(0, 2));
    const grant = await historicalGrant(h, first.event.event.id, first.matches[0]!.id, 60000);
    const session = await historicalSession(h, grant.id);
    data(await overlaySnapshot(h, grant.overlayId, session.cookie));
    const before = await persistentState(h, first.event.event.id);
    const inserts = [
      {
        sql: `INSERT INTO overlay_sessions(id,org_id,event_id,match_id,grant_id,token_hash,created_at,expires_at)
              SELECT $1,org_id,event_id,match_id,id,$2,created_at,expires_at+interval '1 millisecond' FROM overlay_grants WHERE id=$3`,
        values: [randomUUID(), hash(opaque()), grant.id],
        code: '23503',
      },
      {
        sql: `INSERT INTO overlay_sessions(id,org_id,event_id,match_id,grant_id,token_hash,created_at,expires_at)
              SELECT $1,org_id,$2,$3,id,$4,created_at,expires_at FROM overlay_grants WHERE id=$5`,
        values: [
          randomUUID(),
          second.event.event.id,
          second.matches[0]!.id,
          hash(opaque()),
          grant.id,
        ],
        code: '23503',
      },
      {
        sql: `INSERT INTO overlay_sessions(id,org_id,event_id,match_id,grant_id,token_hash,created_at,expires_at)
              SELECT $1,org_id,event_id,match_id,grant_id,token_hash,created_at,expires_at FROM overlay_sessions WHERE id=$2`,
        values: [randomUUID(), session.id],
        code: '23505',
      },
      {
        sql: `INSERT INTO overlay_grants(id,org_id,event_id,match_id,overlay_id,secret_hash,issuer_id,created_at,expires_at)
              SELECT $1,org_id,event_id,match_id,$2,$3,issuer_id,created_at,expires_at FROM overlay_grants WHERE id=$4`,
        values: [randomUUID(), opaque(), hash(opaque()), grant.id],
        code: '23505',
      },
      {
        sql: `INSERT INTO overlay_grants(id,org_id,event_id,match_id,overlay_id,secret_hash,issuer_id,created_at,expires_at)
              SELECT $1,org_id,$2,$3,overlay_id,$4,issuer_id,created_at,expires_at FROM overlay_grants WHERE id=$5`,
        values: [
          randomUUID(),
          second.event.event.id,
          second.matches[0]!.id,
          hash(opaque()),
          grant.id,
        ],
        code: '23505',
      },
      {
        sql: `INSERT INTO overlay_grants(id,org_id,event_id,match_id,overlay_id,secret_hash,issuer_id,created_at,expires_at)
              SELECT $1,org_id,$2,$3,$4,secret_hash,issuer_id,created_at,expires_at FROM overlay_grants WHERE id=$5`,
        values: [randomUUID(), second.event.event.id, second.matches[0]!.id, opaque(), grant.id],
        code: '23505',
      },
      {
        sql: `INSERT INTO overlay_grants(id,org_id,event_id,match_id,overlay_id,secret_hash,issuer_id,created_at,expires_at)
              SELECT $1,org_id,event_id,$2,$3,$4,issuer_id,created_at,expires_at FROM overlay_grants WHERE id=$5`,
        values: [randomUUID(), second.matches[0]!.id, opaque(), hash(opaque()), grant.id],
        code: '23503',
      },
      {
        sql: `INSERT INTO overlay_grants(id,org_id,event_id,match_id,overlay_id,secret_hash,issuer_id,created_at,expires_at)
              SELECT $1,$2,event_id,match_id,$3,$4,issuer_id,created_at,expires_at FROM overlay_grants WHERE id=$5`,
        values: [randomUUID(), h.otherOwner.orgId, opaque(), hash(opaque()), grant.id],
        code: '23503',
      },
    ];
    for (const candidate of inserts)
      await expect(h.api.pool.query(candidate.sql, candidate.values)).rejects.toMatchObject({
        code: candidate.code,
      });
    for (const mutation of [
      "expires_at=expires_at+interval '1 second'",
      "created_at=created_at-interval '1 second'",
      "secret_hash=repeat('a',64)",
      `issuer_id='${h.otherOwner.id}'::uuid`,
      "overlay_id=repeat('a',43)",
    ])
      await expect(
        h.api.pool.query(`UPDATE overlay_grants SET ${mutation} WHERE id=$1`, [grant.id]),
      ).rejects.toMatchObject({ code: '23514' });
    for (const sql of [
      'DELETE FROM overlay_grants WHERE id=$1',
      'UPDATE overlay_sessions SET expires_at=expires_at WHERE id=$1',
      'DELETE FROM overlay_sessions WHERE id=$1',
    ])
      await expect(
        h.api.pool.query(sql, [sql.includes('overlay_sessions') ? session.id : grant.id]),
      ).rejects.toMatchObject({ code: '23514' });
    expect(await persistentState(h, first.event.event.id)).toEqual(before);

    const revoked = await h.api.pool.query(
      "UPDATE overlay_grants SET version=2,revoked_at=clock_timestamp(),revocation_reason='合成历史撤销' WHERE id=$1",
      [grant.id],
    );
    expect(revoked.rowCount).toBe(1);
    for (const mutation of [
      "revocation_reason='再次撤销'",
      'version=1,revoked_at=NULL,revocation_reason=NULL',
    ])
      await expect(
        h.api.pool.query(`UPDATE overlay_grants SET ${mutation} WHERE id=$1`, [grant.id]),
      ).rejects.toMatchObject({ code: '23514' });
    notFound(await overlaySnapshot(h, grant.overlayId, session.cookie));
    await historicalGrant(h, first.event.event.id, first.matches[0]!.id, 60000);

    // Expiry alone must not evade the one-unrevoked-grant index.
    const expired = await historicalGrant(h, second.event.event.id, second.matches[0]!.id, -1000);
    await expect(
      historicalGrant(h, second.event.event.id, second.matches[0]!.id, 60000),
    ).rejects.toMatchObject({ code: '23505' });
    expect(
      (
        await h.api.pool.query('SELECT version,revoked_at FROM overlay_grants WHERE id=$1', [
          expired.id,
        ])
      ).rows,
    ).toEqual([{ version: 1, revoked_at: null }]);
  });

  test('an earlier snapshot keeps Event and Grant read locks until its session lock completes, so revoke waits', async () => {
    const fixture = await published(h, h.teams.slice(0, 2));
    const matchId = fixture.matches[0]!.id;
    const credential = (await issue(h, matchId)).credential!;
    const boot = await bootstrap(h, credential.overlayId, credential.token);
    data(boot);
    const cookie = overlayCookie(boot);
    const stored = (await sessions(h, credential.overlayId))[0]!;
    const current = await overlayWorkbench(h, matchId);
    await withRowsLocked(
      h,
      'SELECT id FROM overlay_sessions WHERE id=$1 FOR UPDATE',
      [stored.id],
      1,
      async (pid, unlock, track) => {
        const reading = track(overlaySnapshot(h, credential.overlayId, cookie));
        const readerPid = await blockedPid(
          h.api.pool,
          pid,
          'Overlay snapshot did not reach its session lock while retaining Event and Grant locks',
        );
        const revoking = track(
          overlayCommand(h, matchId, {
            type: 'REVOKE',
            overlayId: credential.overlayId,
            expectedEventVersion: current.event.version,
            expectedGrantVersion: current.currentGrant!.version,
            reason: '读取先获得锁后的撤销',
          }),
        );
        await blockedPid(
          h.api.pool,
          readerPid,
          'Revocation did not wait for the earlier overlay snapshot',
        );
        await unlock();
        data(await reading);
        overlayData(await revoking);
      },
    );
    notFound(await overlaySnapshot(h, credential.overlayId, cookie));
    notFound(await bootstrap(h, credential.overlayId, credential.token));
  });

  test('a later snapshot queues behind revocation at the Event lock and returns 404 after revocation commits', async () => {
    const fixture = await published(h, h.teams.slice(0, 2));
    const matchId = fixture.matches[0]!.id;
    const credential = (await issue(h, matchId)).credential!;
    const boot = await bootstrap(h, credential.overlayId, credential.token);
    data(boot);
    const cookie = overlayCookie(boot);
    const current = await overlayWorkbench(h, matchId);
    await withRowsLocked(
      h,
      'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
      [h.owner.orgId, fixture.event.event.id],
      1,
      async (pid, unlock, track) => {
        const revoking = track(
          overlayCommand(h, matchId, {
            type: 'REVOKE',
            overlayId: credential.overlayId,
            expectedEventVersion: current.event.version,
            expectedGrantVersion: current.currentGrant!.version,
            reason: '撤销先排队后的读取',
          }),
        );
        const writerPid = await blockedPid(
          h.api.pool,
          pid,
          'Revocation did not queue on the Event lock',
        );
        const reading = track(overlaySnapshot(h, credential.overlayId, cookie));
        await eventually(
          async () =>
            (
              await h.api.pool.query<{ waiting: boolean }>(
                `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND pid<>$2 AND $3=ANY(pg_blocking_pids(pid))) AS waiting`,
                [APPLICATION_NAME, pid, writerPid],
              )
            ).rows[0]!.waiting,
          (waiting) => waiting,
          'Later overlay snapshot did not queue behind the earlier revocation',
        );
        await unlock();
        overlayData(await revoking);
        notFound(await reading);
      },
    );
    notFound(await overlaySnapshot(h, credential.overlayId, cookie));
  });

  test('bootstrap whose session INSERT waits for an official-match foreign key must recheck the deadline and roll back its new session', async () => {
    const fixture = await published(h, h.teams.slice(0, 2));
    const matchId = fixture.matches[0]!.id;
    const grant = await historicalGrant(h, fixture.event.event.id, matchId, 3000);
    expect(await sessions(h, grant.overlayId)).toHaveLength(0);
    const before = await persistentState(h, fixture.event.event.id);
    await withRowsLocked(
      h,
      'SELECT id FROM published_matches WHERE org_id=$1 AND id=$2 FOR UPDATE',
      [h.owner.orgId, matchId],
      1,
      async (pid, unlock, track) => {
        const booting = track(bootstrap(h, grant.overlayId, grant.token));
        const bootstrapPid = await blockedPid(
          h.api.pool,
          pid,
          'Bootstrap session INSERT did not wait for the official-match foreign key lock',
        );
        const statement = await h.api.pool.query<{ inserting: boolean }>(
          "SELECT query ILIKE '%INSERT INTO overlay_sessions%' AS inserting FROM pg_stat_activity WHERE pid=$1",
          [bootstrapPid],
        );
        expect(statement.rows).toEqual([{ inserting: true }]);
        await eventually(
          async () =>
            (
              await h.api.pool.query<{ expired: boolean }>(
                'SELECT clock_timestamp() >= expires_at AS expired FROM overlay_grants WHERE id=$1',
                [grant.id],
              )
            ).rows[0]!.expired,
          (expired) => expired,
          'The real grant deadline did not pass while its new session waited on the match FK',
        );
        await unlock();
        notFound(await booting);
      },
    );
    expect(await sessions(h, grant.overlayId)).toHaveLength(0);
    expect(await persistentState(h, fixture.event.event.id)).toEqual(before);
    notFound(await bootstrap(h, grant.overlayId, grant.token));
  });

  test('snapshot and bootstrap that wait across the real DB deadline both fail closed after locking, without creating or extending sessions', async () => {
    const fixture = await published(h, h.teams.slice(0, 2));
    const grant = await historicalGrant(h, fixture.event.event.id, fixture.matches[0]!.id, 3000);
    const session = await historicalSession(h, grant.id);
    data(await overlaySnapshot(h, grant.overlayId, session.cookie));
    const before = await persistentState(h, fixture.event.event.id);
    await withRowsLocked(
      h,
      'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
      [h.owner.orgId, fixture.event.event.id],
      1,
      async (pid, unlock, track) => {
        const reading = track(overlaySnapshot(h, grant.overlayId, session.cookie));
        const readerPid = await blockedPid(
          h.api.pool,
          pid,
          'Near-deadline snapshot did not wait for the Event lock',
        );
        const booting = track(bootstrap(h, grant.overlayId, grant.token, session.cookie));
        await eventually(
          async () =>
            (
              await h.api.pool.query<{ waiting: boolean }>(
                `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND pid<>$2 AND pid<>$3 AND $2=ANY(pg_blocking_pids(pid))) AS waiting`,
                [APPLICATION_NAME, pid, readerPid],
              )
            ).rows[0]!.waiting,
          (waiting) => waiting,
          'Near-deadline bootstrap did not wait behind the held Event',
        );
        await eventually(
          async () =>
            (
              await h.api.pool.query<{ expired: boolean }>(
                'SELECT clock_timestamp() >= expires_at AS expired FROM overlay_grants WHERE id=$1',
                [grant.id],
              )
            ).rows[0]!.expired,
          (expired) => expired,
          'The actual database clock did not pass the valid synthetic deadline',
        );
        await unlock();
        notFound(await reading);
        notFound(await booting);
      },
    );
    notFound(await overlaySnapshot(h, grant.overlayId, session.cookie));
    notFound(await bootstrap(h, grant.overlayId, grant.token));
    expect(await persistentState(h, fixture.event.event.id)).toEqual(before);
    const current = await overlayWorkbench(h, fixture.matches[0]!.id);
    expect(current.currentGrant).toMatchObject({
      overlayId: grant.overlayId,
      status: 'EXPIRED',
      version: 1,
    });
  });
});
