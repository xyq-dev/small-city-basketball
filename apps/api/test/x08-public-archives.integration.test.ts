import type { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PublicArchivesService } from '../src/public-archives-service.js';
import { team } from './p03-support.js';
import { hashToken, readSessionToken } from '../src/security.js';
import { ORIGIN, testDatabaseUrl, login, call, data } from './support.js';
import {
  acquire,
  act,
  assign,
  closeHarness,
  createScoringHarness,
  finish,
  published,
  start,
  workbench,
} from './p05-support.js';
import type { Harness } from './p05-support.js';
import type { PublicArchiveProfileData } from '@small-city-basketball/contracts';
describe(
  'X08 independent public long-term archive on real PostgreSQL',
  { concurrent: false },
  () => {
    let h: Harness, s: PublicArchivesService;
    beforeAll(async () => {
      h = await createScoringHarness(4);
      s = new PublicArchivesService(h.api.pool, {
        databaseUrl: testDatabaseUrl(),
        appOrigin: ORIGIN,
      });
    });
    afterAll(async () => {
      if (h) await closeHarness(h);
    });
    async function scored(target = h.leader) {
      const pair = await Promise.all([
        team(h.api, h.owner, '合成公共主' + randomUUID().slice(0, 6), h.leader, [
          '合成甲',
          '合成乙',
        ]),
        team(h.api, h.owner, '合成公共客' + randomUUID().slice(0, 6), h.leader, [
          '合成丙',
          '合成丁',
        ]),
      ]);
      const f = await published(h, pair);
      const id = f.matches[0]!.id;
      await assign(h, id, h.otherOwner);
      const before = await workbench(h, id);
      await act(h, id, h.owner, {
        type: 'PREPARE_MATCH',
        payload: { expectedEventVersion: before.event.version, collectionMode: 'PLAYER_BASIC' },
      });
      const lease = await acquire(h, id, h.otherOwner);
      await start(h, id, h.otherOwner, lease);
      const memberId = before.playerRoster.home[0]!.memberId,
        teamId = before.match.home.teamId;
      await act(
        h,
        id,
        h.otherOwner,
        { type: 'RECORD_STAT', payload: { side: 'HOME', kind: 'SCORE', value: 2, memberId } },
        lease,
      );
      await finish(h, id, h.otherOwner, lease);
      await act(h, id, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      const codeId = randomUUID();
      await h.api.pool.query(
        "INSERT INTO team_join_codes(id,org_id,team_id,code_hash,issued_by,max_uses,expires_at) VALUES($1,$2,$3,$4,$5,30,clock_timestamp()+interval '1 day')",
        [codeId, h.owner.orgId, teamId, randomBytes(32).toString('hex'), h.owner.id],
      );
      const bindingId = randomUUID();
      await h.api.pool.query(
        "INSERT INTO team_member_bindings(id,org_id,team_id,member_id,user_id,source,join_code_id) VALUES($1,$2,$3,$4,$5,'JOIN_CODE',$6)",
        [bindingId, h.owner.orgId, teamId, memberId, target.id, codeId],
      );
      return { matchId: id, eventId: f.event.event.id, teamId, memberId, bindingId, lease };
    }
    async function publish(p: PublicArchiveProfileData, cookie = h.leader.cookie) {
      return s.command(cookie, p.id, {
        commandId: randomUUID(),
        expectedVersion: p.version,
        type: 'PUBLISH',
        publicConsent: true,
      });
    }
    async function source(f: Awaited<ReturnType<typeof scored>>, p: PublicArchiveProfileData) {
      return s.nominate(h.owner.cookie, {
        commandId: randomUUID(),
        profileId: p.id,
        orgId: h.owner.orgId,
        eventId: f.eventId,
        teamId: f.teamId,
        memberId: f.memberId,
        publisherConsent: true,
        reason: '合成明确公开来源授权',
      });
    }
    test('personal publication never inherits a booking/private-season consent; exact nomination needs independent subject consent', async () => {
      const f = await scored(),
        p = await s.create(h.leader.cookie, {
          commandId: randomUUID(),
          kind: 'PLAYER',
          displayName: '合成公共球员',
        });
      await expect(
        s.command(h.leader.cookie, p.id, {
          commandId: randomUUID(),
          expectedVersion: 1,
          type: 'PUBLISH',
        }),
      ).rejects.toMatchObject({ status: 422 });
      const published = await publish(p);
      const nominated = await source(f, p);
      expect((await s.publicOne(published.publicKey!, 'fixture')).recordedMatchCount).toBe(0);
      await s.sourceCommand(h.leader.cookie, nominated.id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'CONSENT',
        playerConsent: true,
        reason: '本人明确同意独立公共来源',
      });
      const result = await s.publicOne(published.publicKey!, 'fixture');
      expect(result.points).toBe(2);
      expect(result.technical).toBeNull();
      for (const secret of [
        f.memberId,
        f.teamId,
        h.leader.id,
        h.leader.email,
        'memberId',
        'orgId',
        'confirmation',
      ])
        expect(JSON.stringify(result)).not.toContain(secret);
    });
    test('unified search uses authorized public projections and immediately drops revoked profiles', async () => {
      const f = await scored(),
        label = '跨域合成搜索' + randomUUID().slice(0, 8);
      const p = await s.create(h.owner.cookie, {
        commandId: randomUUID(),
        kind: 'TEAM',
        displayName: label,
        orgId: h.owner.orgId,
        teamId: f.teamId,
      });
      const pub = await publish(p, h.owner.cookie);
      await s.nominate(h.owner.cookie, {
        commandId: randomUUID(),
        profileId: p.id,
        orgId: h.owner.orgId,
        eventId: f.eventId,
        teamId: f.teamId,
        memberId: null,
        publisherConsent: true,
        reason: '合成跨域搜索公开来源',
      });
      const path = '/v1/public/search?q=' + encodeURIComponent(label) + '&kind=TEAM';
      const found = data<{ items: Record<string, unknown>[] }>(await call(h.api, 'get', path));
      expect(found.items).toEqual([
        {
          kind: 'TEAM',
          publicKey: pub.publicKey,
          displayName: label,
          city: null,
          startsOn: null,
          endsOn: null,
        },
      ]);
      for (const secret of [p.id, f.teamId, f.eventId, h.owner.id, h.owner.email])
        expect(JSON.stringify(found)).not.toContain(secret);
      const scoped = data<{ items: unknown[] }>(
        await call(h.api, 'get', path + '&city=' + encodeURIComponent('未公开合成城市')),
      );
      expect(scoped.items).toEqual([]);
      await s.command(h.owner.cookie, p.id, {
        commandId: randomUUID(),
        expectedVersion: pub.version,
        type: 'REVOKE',
        reason: '合成撤回搜索公开权限',
      });
      expect(data<{ items: unknown[] }>(await call(h.api, 'get', path)).items).toEqual([]);
    }, 120000);
    test('same-name members cannot nominate to another account; revoked keys never revive after republication', async () => {
      const f = await scored();
      const p = await s.create(h.otherOwner.cookie, {
        commandId: randomUUID(),
        kind: 'PLAYER',
        displayName: '合成公共球员',
      });
      await expect(source(f, p)).rejects.toMatchObject({ status: 409 });
      const first = await publish(p, h.otherOwner.cookie);
      const revoked = await s.command(h.otherOwner.cookie, p.id, {
        commandId: randomUUID(),
        expectedVersion: first.version,
        type: 'REVOKE',
        reason: '本人撤销公开授权',
      });
      await expect(s.publicOne(first.publicKey!, 'fixture')).rejects.toMatchObject({ status: 404 });
      const again = await publish(revoked, h.otherOwner.cookie);
      expect(again.publicKey).not.toBe(first.publicKey);
      await expect(s.publicOne(first.publicKey!, 'fixture')).rejects.toMatchObject({ status: 404 });
    });
    test('team archives aggregate the same explicit team across editions and immediately drop reopened confirmations', async () => {
      const f = await scored();
      const p = await s.create(h.owner.cookie, {
        commandId: randomUUID(),
        kind: 'TEAM',
        displayName: '合成公共球队',
        orgId: h.owner.orgId,
        teamId: f.teamId,
      });
      const pub = await publish(p, h.owner.cookie);
      await s.nominate(h.owner.cookie, {
        commandId: randomUUID(),
        profileId: p.id,
        orgId: h.owner.orgId,
        eventId: f.eventId,
        teamId: f.teamId,
        memberId: null,
        publisherConsent: true,
        reason: '本组织明确公开球队来源',
      });
      expect((await s.publicOne(pub.publicKey!, 'fixture')).points).toBe(2);
      await act(h, f.matchId, h.owner, {
        type: 'REOPEN_RESULT',
        payload: { reason: '合成复核来源失效' },
      });
      expect((await s.publicOne(pub.publicKey!, 'fixture')).points).toBeNull();
    });
    test('ending a team binding does not transfer historical identity; source and profile revocation remove career/ranking data', async () => {
      // Reuse the original player's profile, add a distinct edition, and explicitly approve it.
      const f = await scored();
      const workspace = await s.workspace(h.leader.cookie);
      const p = workspace.profiles.find((p) => p.kind === 'PLAYER')!;
      const nominated = await source(f, p);
      await s.sourceCommand(h.leader.cookie, nominated.id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'CONSENT',
        playerConsent: true,
        reason: '本人明确同意本届公开来源',
      });
      await h.api.pool.query(
        "UPDATE team_member_bindings SET status='ENDED',ended_reason='LEFT',ended_at=clock_timestamp() WHERE id=$1",
        [f.bindingId],
      );
      expect((await s.publicOne(p.publicKey!, 'fixture')).points).toBe(4);
      await s.sourceCommand(h.leader.cookie, nominated.id, {
        commandId: randomUUID(),
        expectedVersion: 2,
        type: 'REVOKE',
        reason: '本人撤销本届公开来源',
      });
      expect((await s.publicOne(p.publicKey!, 'fixture')).points).toBe(2);
      const current = (await s.workspace(h.leader.cookie)).profiles.find((x) => x.id === p.id)!;
      await s.command(h.leader.cookie, p.id, {
        commandId: randomUUID(),
        expectedVersion: current.version,
        type: 'REVOKE',
        reason: '本人撤销全部公开档案',
      });
      expect(
        (await s.rankings({ kind: 'PLAYER' }, 'fixture')).entries.some(
          (e) => e.archive.publicKey === p.publicKey,
        ),
      ).toBe(false);
    });
    test('concurrent source/profile withdrawal cannot return the pre-withdrawal archive, and a busy consent row fails closed', async () => {
      const f = await scored(h.otherOwner),
        p = (await s.workspace(h.otherOwner.cookie)).profiles.find((p) => p.kind === 'PLAYER')!;
      const nominated = await source(f, p);
      await s.sourceCommand(h.otherOwner.cookie, nominated.id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'CONSENT',
        playerConsent: true,
        reason: '本人独立同意并发撤回验证',
      });
      expect((await s.publicOne(p.publicKey!, 'privacy')).points).toBe(2);
      function pausedReader() {
        let observed!: () => void,
          unblock!: () => void,
          once = true;
        const started = new Promise<void>((resolve) => {
            observed = resolve;
          }),
          resume = new Promise<void>((resolve) => {
            unblock = resolve;
          });
        const pool = {
          query: h.api.pool.query.bind(h.api.pool),
          async connect() {
            const c = await h.api.pool.connect();
            return {
              async query(sql: string, args?: any[]) {
                const result = await c.query(sql, args);
                if (once && sql.startsWith('SELECT p.*,k.consented_at')) {
                  once = false;
                  observed();
                  await resume;
                }
                return result;
              },
              release() {
                c.release();
              },
            };
          },
        };
        return {
          reader: new PublicArchivesService(pool as unknown as Pool, {
            databaseUrl: testDatabaseUrl(),
            appOrigin: ORIGIN,
          }),
          started,
          release: () => unblock(),
        };
      }
      const sourceGate = pausedReader(),
        readingSource = sourceGate.reader.publicOne(p.publicKey!, 'privacy');
      await Promise.race([
        sourceGate.started,
        readingSource.then(() => {
          throw Error('Public read completed before concurrency gate');
        }),
      ]);
      await s.sourceCommand(h.otherOwner.cookie, nominated.id, {
        commandId: randomUUID(),
        expectedVersion: 2,
        type: 'REVOKE',
        reason: '本人在读取快照后撤回来源',
      });
      sourceGate.release();
      const afterSource = await readingSource;
      expect(afterSource.points).toBeNull();
      expect(afterSource.recordedMatchCount).toBe(0);
      expect(afterSource.recentRecords).toEqual([]);
      const blocker = await h.api.pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM public_archive_profiles WHERE id=$1 FOR UPDATE', [
          p.id,
        ]);
        await expect(s.publicOne(p.publicKey!, 'privacy')).rejects.toMatchObject({
          status: 503,
          code: 'PUBLIC_ARCHIVE_BUSY',
        });
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
      }
      const profileGate = pausedReader(),
        readingProfile = profileGate.reader.publicOne(p.publicKey!, 'privacy');
      await Promise.race([
        profileGate.started,
        readingProfile.then(() => {
          throw Error('Public read completed before concurrency gate');
        }),
      ]);
      const current = (await s.workspace(h.otherOwner.cookie)).profiles.find(
        (row) => row.id === p.id,
      )!;
      await s.command(h.otherOwner.cookie, p.id, {
        commandId: randomUUID(),
        expectedVersion: current.version,
        type: 'REVOKE',
        reason: '本人在读取快照后撤回档案',
      });
      profileGate.release();
      await expect(readingProfile).rejects.toMatchObject({ status: 404 });
    });
    test('current publisher authority and organization state gate public sources; subject can revoke even after organization suspension', async () => {
      const f = await scored();
      const p = (await s.workspace(h.leader.cookie)).profiles.find((p) => p.kind === 'PLAYER')!;
      const published = await publish(p);
      const nominated = await source(f, p);
      await s.sourceCommand(h.leader.cookie, nominated.id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'CONSENT',
        playerConsent: true,
        reason: '本人明确同意当前来源',
      });
      expect((await s.publicOne(published.publicKey!, 'fixture')).points).toBe(4);
      await h.api.pool.query("UPDATE organizations SET status='DISABLED' WHERE id=$1", [
        h.owner.orgId,
      ]);
      expect((await s.publicOne(published.publicKey!, 'fixture')).authorizedSourceCount).toBe(0);
      const revoked = await s.sourceCommand(h.leader.cookie, nominated.id, {
        commandId: randomUUID(),
        expectedVersion: 2,
        type: 'REVOKE',
        reason: '本人在机构停用后撤销公开',
      });
      expect(revoked.status).toBe('REVOKED');
    });
    test('private writes, cached operation replies and workspace recheck natural session expiry after database waits', async () => {
      let cookie = h.otherOwner.cookie;
      const profile = (await s.workspace(cookie)).profiles.find((p) => p.kind === 'PLAYER')!;
      const original = {
        commandId: randomUUID(),
        expectedVersion: profile.version,
        type: 'UPDATE',
        displayName: '合成尾部会话核验',
      };
      const accepted = await s.command(cookie, profile.id, original);
      async function expireSoon() {
        await h.api.pool.query(
          "UPDATE sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE token_hash=$1",
          [hashToken(readSessionToken(cookie)!)],
        );
      }
      function slowService(kind: 'operation' | 'workspace') {
        let delayed = false;
        const pool = {
          query: h.api.pool.query.bind(h.api.pool),
          async connect() {
            const c = await h.api.pool.connect();
            return {
              async query(sql: string, args?: any[]) {
                const result = await c.query(sql, args);
                if (
                  !delayed &&
                  ((kind === 'operation' && sql.includes('pg_advisory_xact_lock')) ||
                    (kind === 'workspace' && sql.includes('WHERE g.profile_id=$1 AND g.status<>')))
                ) {
                  delayed = true;
                  await c.query('SELECT pg_sleep(1.1)');
                }
                return result;
              },
              release() {
                c.release();
              },
            };
          },
        };
        return {
          service: new PublicArchivesService(pool as unknown as Pool, {
            databaseUrl: testDatabaseUrl(),
            appOrigin: ORIGIN,
          }),
          hit: () => delayed,
        };
      }
      await expireSoon();
      const replay = slowService('operation');
      await expect(replay.service.command(cookie, profile.id, original)).rejects.toMatchObject({
        status: 401,
      });
      expect(replay.hit()).toBe(true);
      cookie = await login(h.api, h.otherOwner);
      await expireSoon();
      const fresh = slowService('operation'),
        newCommand = randomUUID();
      await expect(
        fresh.service.command(cookie, profile.id, {
          commandId: newCommand,
          expectedVersion: accepted.version,
          type: 'UPDATE',
          displayName: '不得在过期后写入',
        }),
      ).rejects.toMatchObject({ status: 401 });
      expect(fresh.hit()).toBe(true);
      expect(
        (
          await h.api.pool.query('SELECT 1 FROM public_archive_operations WHERE command_id=$1', [
            newCommand,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await h.api.pool.query('SELECT display_name FROM public_archive_profiles WHERE id=$1', [
            profile.id,
          ])
        ).rows[0]!.display_name,
      ).toBe(accepted.displayName);
      cookie = await login(h.api, h.otherOwner);
      await expireSoon();
      const workspace = slowService('workspace');
      await expect(workspace.service.workspace(cookie)).rejects.toMatchObject({ status: 401 });
      expect(workspace.hit()).toBe(true);
    });
  },
);
