import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, test, expect } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword } from '../src/security.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { GovernanceService } from '../src/governance-service.js';
import { CityOperationsService } from '../src/city-operations-service.js';
import { SponsorshipService } from '../src/sponsorship-service.js';
import { PublicLedgerService } from '../src/public-ledger-service.js';
import {
  testDatabaseUrl,
  ORIGIN,
  PASSWORD,
  RUN_ID,
  login,
  createEvent,
  eventually,
} from './support.js';
import type { Api, User } from './support.js';
import type {
  BookingPlayerData,
  BookingWorkspaceData,
  BookingOrderData,
  BookingCommandInput,
} from '@small-city-basketball/contracts';
import { call, data } from './support.js';
// Real PostgreSQL services plus real HTTP session authentication. Controller/body-lane wiring
// belongs to root integration; this file does not misrepresent service tests as HTTP acceptance.
describe(
  'X18 isolated PostgreSQL authority, private cases and operation receipts',
  { concurrent: false },
  () => {
    let api: Api, g: GovernanceService, city: CityOperationsService;
    let sponsor: SponsorshipService;
    let ledger: PublicLedgerService;
    let owner: User, operator: User, handler: User, stranger: User;
    let region: { catalogVersion: string; regionId: string };
    beforeAll(async () => {
      const databaseUrl = testDatabaseUrl();
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        await migrate(pool);
      } finally {
        await pool.end();
      }
      api = await createApi({ databaseUrl, appOrigin: ORIGIN });
      g = new GovernanceService(api.pool, { databaseUrl, appOrigin: ORIGIN });
      city = new CityOperationsService(api.pool, { databaseUrl, appOrigin: ORIGIN });
      sponsor = new SponsorshipService(api.pool, { databaseUrl, appOrigin: ORIGIN });
      ledger = new PublicLedgerService(api.pool, { databaseUrl, appOrigin: ORIGIN });
      const passwordHash = await hashPassword(PASSWORD);
      const actors: User[] = [];
      for (const name of ['owner', 'operator', 'handler', 'stranger']) {
        const user = {
          id: randomUUID(),
          orgId: randomUUID(),
          email: `x18-${name}-${RUN_ID}@example.test`,
          cookie: '',
        };
        await api.pool.query(
          'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
          [user.id, user.email, `合成治理${name}`, passwordHash],
        );
        await api.pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
          user.orgId,
          `合成治理机构${name}`,
        ]);
        await api.pool.query(
          "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
          [user.orgId, user.id],
        );
        user.cookie = await login(api, user);
        actors.push(user);
      }
      [owner, operator, handler, stranger] = actors as [User, User, User, User];
      await api.pool.query(
        "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_ADMIN')",
        [owner.orgId, handler.id],
      );
      await maintainPlatformOperator(api.pool, {
        email: operator.email,
        status: 'ACTIVE',
        reason: '隔离合成治理核验',
      });
      const r = (
        await api.pool.query(
          "SELECT catalog_version,region_id FROM region_catalog_nodes WHERE level='COUNTY' ORDER BY region_id LIMIT 1",
        )
      ).rows[0]!;
      region = { catalogVersion: r.catalog_version, regionId: r.region_id };
    }, 60000);
    afterAll(async () => {
      await api?.app.close();
      await api?.pool.end();
    });
    const create = (extra: Record<string, unknown> = {}) =>
      g.createCase(owner.cookie, {
        commandId: randomUUID(),
        orgId: owner.orgId,
        kind: 'SUPPORT',
        title: '合成服务问题',
        body: '合成私有工单正文',
        region,
        ...extra,
      });
    test('org owner and city grant do not imply access to another requester’s private case', async () => {
      const row = await create();
      await expect(g.getCase(stranger.cookie, row.id as string)).rejects.toMatchObject({
        status: 404,
      });
      const grant = await city.create(operator.cookie, {
        commandId: randomUUID(),
        orgId: owner.orgId,
        userId: handler.id,
        region,
        action: 'CASE_MANAGE',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        reason: '合成有限客服授权',
      });
      await expect(g.getCase(handler.cookie, row.id as string)).rejects.toMatchObject({
        status: 404,
      });
      await g.caseCommand(operator.cookie, row.id as string, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'ASSIGN',
        assigneeId: handler.id,
        grantId: grant.id,
        reason: '明确分派本件工单',
      });
      const updated = await g.getCase(handler.cookie, row.id as string);
      expect(updated.status).toBe('ASSIGNED');
      await g.reply(handler.cookie, row.id as string, {
        commandId: randomUUID(),
        expectedVersion: 2,
        body: '合成内部处理线索',
        visibility: 'INTERNAL',
      });
      const requester = await g.getCase(owner.cookie, row.id as string);
      expect(requester.messages.some((m) => m.body === '合成内部处理线索')).toBe(false);
      await city.revoke(operator.cookie, grant.id as string, {
        commandId: randomUUID(),
        expectedVersion: 1,
        reason: '撤销合成有限权限',
      });
      await expect(g.getCase(handler.cookie, row.id as string)).rejects.toMatchObject({
        status: 404,
      });
      const newer = await city.create(operator.cookie, {
        commandId: randomUUID(),
        orgId: owner.orgId,
        userId: handler.id,
        region,
        action: 'CASE_MANAGE',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        reason: '新授权不能复活分派',
      });
      expect(newer.id).not.toBe(grant.id);
      await expect(g.getCase(handler.cookie, row.id as string)).rejects.toMatchObject({
        status: 404,
      });
    });
    test('exact city grant expiry during a command lock wait rolls back message, version, audit effect and receipt', async () => {
      const grant = await city.create(operator.cookie, {
        commandId: randomUUID(),
        orgId: owner.orgId,
        userId: handler.id,
        region,
        action: 'CASE_MANAGE',
        expiresAt: new Date(Date.now() + 5000).toISOString(),
        reason: '合成短期精确权限核验',
      });
      const row = await create();
      const caseId = row.id as string;
      await g.caseCommand(operator.cookie, caseId, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'ASSIGN',
        assigneeId: handler.id,
        grantId: grant.id,
        reason: '绑定本项短期精确授权',
      });
      const commandId = randomUUID(),
        tag = '到期后不得落盘-' + randomUUID();
      const blocker = await api.pool.connect();
      try {
        await blocker.query('BEGIN');
        const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;
        await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `scb-governance:${handler.id}:${commandId}`,
        ]);
        const pending = g
          .reply(handler.cookie, caseId, {
            commandId,
            expectedVersion: 2,
            body: tag,
            visibility: 'INTERNAL',
          })
          .then(
            (value) => ({ value, error: null }),
            (error) => ({ value: null, error }),
          );
        await eventually(
          async () =>
            (
              await api.pool.query<{ waiting: boolean }>(
                'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>$1 AND $1=ANY(pg_blocking_pids(pid))) AS waiting',
                [pid],
              )
            ).rows[0]!.waiting,
          (v) => v,
          'case reply did not wait on the real command lock',
        );
        await eventually(
          async () =>
            (
              await api.pool.query<{ expired: boolean }>(
                'SELECT expires_at<=clock_timestamp() AS expired FROM city_operation_grants WHERE id=$1',
                [grant.id],
              )
            ).rows[0]!.expired,
          (v) => v,
          'city grant did not expire while the command was blocked',
          10000,
        );
        await blocker.query('ROLLBACK');
        const outcome = await pending;
        expect(outcome.error).toMatchObject({ status: 403 });
        expect(outcome.value).toBeNull();
        expect((await g.getCase(owner.cookie, caseId)).version).toBe(2);
        expect(
          (
            await api.pool.query(
              'SELECT count(*) FROM governance_case_messages WHERE case_id=$1 AND body=$2',
              [caseId, tag],
            )
          ).rows[0]!.count,
        ).toBe('0');
        expect(
          (
            await api.pool.query(
              'SELECT count(*) FROM governance_operations WHERE actor_id=$1 AND command_id=$2',
              [handler.id, commandId],
            )
          ).rows[0]!.count,
        ).toBe('0');
        expect(
          (
            await api.pool.query(
              "SELECT count(*) FROM audit_logs WHERE actor_id=$1 AND resource_id=$2 AND action='governance.case_replied'",
              [handler.id, caseId],
            )
          ).rows[0]!.count,
        ).toBe('0');
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
      }
    }, 20000);
    test('command replay is stable, changed body conflicts and cancellation blocks delayed original', async () => {
      const commandId = randomUUID();
      const raw = {
        commandId,
        orgId: owner.orgId,
        kind: 'SUPPORT',
        title: '原操作核验',
        body: '合成正文',
      };
      const row = await g.createCase(owner.cookie, raw);
      expect(await g.createCase(owner.cookie, raw)).toEqual(row);
      await expect(
        g.createCase(owner.cookie, { ...raw, body: '另一份正文' }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(await g.operationReceipt(owner.cookie, commandId)).toEqual(row);
      await expect(g.operationReceipt(stranger.cookie, commandId)).rejects.toMatchObject({
        status: 404,
      });
      const abandoned = randomUUID();
      expect(
        await g.cancelOperation(owner.cookie, abandoned, { reason: '明确放弃合成操作' }),
      ).toEqual({ commandId: abandoned, cancelled: true });
      await expect(
        g.createCase(owner.cookie, { ...raw, commandId: abandoned }),
      ).rejects.toMatchObject({ code: 'GOVERNANCE_OPERATION_CANCELLED' });
      expect(
        (
          await api.pool.query(
            'SELECT count(*) FROM governance_operations WHERE actor_id=$1 AND command_id=$2',
            [owner.id, abandoned],
          )
        ).rows[0].count,
      ).toBe('1');
    });
    test('private attachment authorizes before decoding; requester cannot create internal material', async () => {
      const row = await create();
      const raw = {
        expectedVersion: 1,
        fileName: '合成凭证.pdf',
        contentType: 'application/pdf',
        base64: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64'),
        visibility: 'REQUESTER',
      };
      await expect(
        g.attachment(stranger.cookie, row.id as string, randomUUID(), raw),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        g.attachment(owner.cookie, row.id as string, randomUUID(), {
          ...raw,
          visibility: 'INTERNAL',
        }),
      ).rejects.toMatchObject({ status: 403 });
      const commandId = randomUUID();
      const file = await g.attachment(owner.cookie, row.id as string, commandId, raw);
      expect(await g.attachment(owner.cookie, row.id as string, commandId, raw)).toEqual(file);
      expect(
        (
          await g.attachmentContent(owner.cookie, row.id as string, file.attachmentId as string)
        ).bytes.toString(),
      ).toContain('%PDF');
      await expect(
        g.attachmentContent(stranger.cookie, row.id as string, file.attachmentId as string),
      ).rejects.toMatchObject({ status: 404 });
    });
    test('closed cases reopen explicitly; appeal source derives org and belongs to requester', async () => {
      const row = await create();
      await g.caseCommand(owner.cookie, row.id as string, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'CLOSE',
        reason: '合成问题暂时关闭',
      });
      const appeal = await g.createCase(owner.cookie, {
        commandId: randomUUID(),
        kind: 'APPEAL',
        title: '合成处理申诉',
        body: '补充合成处理证据',
        parentCaseId: row.id,
      });
      expect((await g.getCase(owner.cookie, appeal.id as string)).orgId).toBe(owner.orgId);
      await expect(
        g.createCase(stranger.cookie, {
          commandId: randomUUID(),
          kind: 'APPEAL',
          title: '非法父单',
          body: '不属于本人的父单',
          parentCaseId: row.id,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (
          await g.caseCommand(owner.cookie, row.id as string, {
            commandId: randomUUID(),
            expectedVersion: 2,
            type: 'REOPEN',
            reason: '补充事实重新核对',
          })
        ).status,
      ).toBe('OPEN');
    });
    test('completed server booking supports independent publication and permanent withdrawal without public identifiers', async () => {
      const base = Date.now(),
        at = (offset: number) => new Date(base + offset).toISOString();
      const team = data<{ id: string }>(
        await call(api, 'post', `/v1/orgs/${owner.orgId}/teams`, {
          cookie: owner.cookie,
          body: { name: '合成评价服务球队' },
        }),
        201,
      );
      const profile = data<BookingPlayerData>(
        await call(api, 'put', '/v1/player-bookings/profile', {
          cookie: handler.cookie,
          body: {
            commandId: randomUUID(),
            expectedVersion: 0,
            displayName: '合成服务方',
            position: 'PG',
            heightCm: 180,
            city: '合成城市',
            bio: '仅隔离评价测试',
            priceFen: 1000,
            travelFen: 0,
            accommodationFen: 0,
            availability: [{ startAt: at(-86400000), endAt: at(14 * 86400000) }],
            adultConfirmed: true,
          },
        }),
      );
      data<BookingPlayerData>(
        await call(api, 'post', `/v1/player-bookings/profiles/${profile.id}/review`, {
          cookie: operator.cookie,
          body: {
            commandId: randomUUID(),
            expectedVersion: profile.version,
            status: 'APPROVED',
            reason: '独立审核合成服务方',
          },
        }),
      );
      const workspace = data<BookingWorkspaceData>(
        await call(api, 'get', '/v1/player-bookings/workspace', { cookie: owner.cookie }),
      );
      const quote = workspace.players.find((p) => p.id === profile.id);
      expect(quote).toBeDefined();
      let order = data<BookingOrderData>(
        await call(api, 'post', '/v1/player-bookings/orders', {
          cookie: owner.cookie,
          body: {
            commandId: randomUUID(),
            orgId: owner.orgId,
            teamId: team.id,
            eventName: '合成履约赛事',
            scope: 'SINGLE',
            eligibilityConfirmed: true,
            reviewedSettingsVersion: workspace.settings.version,
            reviewedProfileVersions: { [profile.id]: quote!.version },
            appearances: [
              {
                profileId: profile.id,
                label: '合成真实履约',
                reportAt: at(10 * 60000),
                startAt: at(30 * 60000),
                endAt: at(90 * 60000),
                venue: '合成隔离球场',
                conditional: false,
              },
            ],
          },
        }),
      );
      async function act(type: BookingCommandInput['type'], actor: User) {
        order = data<BookingOrderData>(
          await call(api, 'post', `/v1/player-bookings/orders/${order.id}/commands`, {
            cookie: actor.cookie,
            body: {
              commandId: randomUUID(),
              expectedVersion: order.appearances[0]!.version,
              appearanceId: order.appearances[0]!.id,
              type,
              ...(type === 'ACCEPT' ? { eligibilityConfirmed: true } : {}),
            },
          }),
        );
      }
      await act('ACCEPT', handler);
      await act('ARRIVE', handler);
      const appearanceId = order.appearances[0]!.id;
      // Advance only this owned synthetic schedule, following C06's own fixture pattern.
      // All state transitions, fee/profile snapshots and the completion time guard use real HTTP.
      await api.pool.query(
        "UPDATE booking_appearances SET report_at=clock_timestamp()-interval '3 hours',start_at=clock_timestamp()-interval '2 hours',end_at=clock_timestamp()-interval '1 hour',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
        [appearanceId],
      );
      order = data<BookingOrderData>(
        await call(api, 'get', `/v1/player-bookings/orders/${order.id}`, { cookie: owner.cookie }),
      );
      await act('COMPLETE', owner);
      expect(order.appearances[0]!.status).toBe('COMPLETED');
      const row = await g.createReview(owner.cookie, {
        commandId: randomUUID(),
        sourceKind: 'PLAYER_BOOKING',
        sourceId: appearanceId,
        score: 4,
        body: '合成真实履约评价正文',
        publicConsent: true,
      });
      await expect(g.publicReview(row.publicKey as string)).rejects.toMatchObject({ status: 404 });
      const published = await g.reviewCommand(operator.cookie, row.id as string, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'PUBLISH',
        reason: '独立核对合成履约事实',
      });
      expect(published.status).toBe('PUBLISHED');
      const visible = await g.publicReview(row.publicKey as string);
      expect(visible.body).toBe('合成真实履约评价正文');
      expect(JSON.stringify(visible)).not.toContain(appearanceId);
      expect(JSON.stringify(visible)).not.toContain(owner.id);
      await expect(
        g.createReview(owner.cookie, {
          commandId: randomUUID(),
          sourceKind: 'PLAYER_BOOKING',
          sourceId: appearanceId,
          score: 5,
          body: '重复刷分',
          publicConsent: true,
        }),
      ).rejects.toMatchObject({ code: 'REVIEW_ALREADY_EXISTS' });
      const blocker = await api.pool.connect();
      try {
        await blocker.query('BEGIN');
        const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;
        await blocker.query('SELECT id FROM booking_appearances WHERE id=$1 FOR UPDATE', [
          appearanceId,
        ]);
        const pending = g.publicReview(row.publicKey as string).then(
          (value) => ({ value, error: null }),
          (error) => ({ value: null, error }),
        );
        await eventually(
          async () =>
            (
              await api.pool.query<{ waiting: boolean }>(
                'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>$1 AND $1=ANY(pg_blocking_pids(pid))) AS waiting',
                [pid],
              )
            ).rows[0]!.waiting,
          (v) => v,
          'public review did not wait on the real source row',
        );
        await g.reviewCommand(owner.cookie, row.id as string, {
          commandId: randomUUID(),
          expectedVersion: 2,
          type: 'WITHDRAW',
          reason: '来源核验等待期间撤回公开评价',
        });
        await blocker.query('ROLLBACK');
        const outcome = await pending;
        expect(outcome.error).toMatchObject({ status: 404 });
        expect(outcome.value).toBeNull();
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
      }
      await expect(g.publicReview(row.publicKey as string)).rejects.toMatchObject({ status: 404 });
    });
    test('sponsor requires independent review; reports deduplicate by publication and revocation never revives old key', async () => {
      const input = {
        commandId: randomUUID(),
        region,
        brand: '合成赞助方',
        title: '合成地区投放',
        body: '仅隔离合成投放文案',
        startsAt: new Date(Date.now() - 3600000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      };
      const row = await sponsor.save(owner.cookie, owner.orgId, null, input);
      const id = row.id as string;
      await sponsor.command(owner.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'SUBMIT',
        reason: '提交合成投放审核',
      });
      await expect(
        sponsor.command(owner.cookie, owner.orgId, id, {
          commandId: randomUUID(),
          expectedVersion: 2,
          type: 'APPROVE',
          reason: '本人不能自行审核',
        }),
      ).rejects.toMatchObject({ status: 403 });
      await sponsor.command(operator.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: 2,
        type: 'APPROVE',
        reason: '独立合成城市审核',
      });
      const published = await sponsor.command(owner.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: 3,
        type: 'PUBLISH',
        reason: '发布合成有效投放',
      });
      const key = published.publicKey as string;
      expect((await sponsor.publicOne(key)).label).toBe('广告／赞助');
      expect((await sponsor.publicList(region)).items.some((i) => i.publicKey === key)).toBe(true);
      const commandId = randomUUID();
      expect(await sponsor.impression(key, { commandId }, 'synthetic-source')).toEqual(
        await sponsor.impression(key, { commandId }, 'synthetic-source'),
      );
      expect((await sponsor.get(owner.cookie, owner.orgId, id)).reportedImpressions).toBe(1);
      await expect(
        sponsor.save(owner.cookie, owner.orgId, id, {
          ...input,
          commandId: randomUUID(),
          expectedVersion: 4,
          body: '不能直接更改审核条款',
        }),
      ).rejects.toMatchObject({ code: 'SPONSOR_TERMS_FROZEN' });
      await sponsor.command(owner.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: 4,
        type: 'REVOKE_PUBLICATION',
        reason: '永久撤销合成公开地址',
      });
      await expect(sponsor.publicOne(key)).rejects.toMatchObject({ status: 404 });
      const republished = await sponsor.command(owner.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: 5,
        type: 'PUBLISH',
        reason: '创建另一合成发布批次',
      });
      expect(republished.publicKey).not.toBe(key);
      await expect(sponsor.publicOne(key)).rejects.toMatchObject({ status: 404 });
    });
    test('future sponsor is absent until its window and unpublished event cannot be advertised as public', async () => {
      const row = await sponsor.save(owner.cookie, owner.orgId, null, {
        commandId: randomUUID(),
        region,
        brand: '合成未来赞助',
        title: '未来时段',
        body: '不会提前展示',
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      });
      await sponsor.command(owner.cookie, owner.orgId, row.id as string, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'SUBMIT',
        reason: '提交未来时段投放',
      });
      await sponsor.command(operator.cookie, owner.orgId, row.id as string, {
        commandId: randomUUID(),
        expectedVersion: 2,
        type: 'APPROVE',
        reason: '独立核对未来时段',
      });
      const p = await sponsor.command(owner.cookie, owner.orgId, row.id as string, {
        commandId: randomUUID(),
        expectedVersion: 3,
        type: 'PUBLISH',
        reason: '预定未来投放窗口',
      });
      await expect(sponsor.publicOne(p.publicKey as string)).rejects.toMatchObject({ status: 404 });
      await expect(
        sponsor.impression(p.publicKey as string, { commandId: randomUUID() }, 'synthetic-source'),
      ).rejects.toMatchObject({ status: 404 });
      const event = await createEvent(api, owner, '合成未公开定向赛事');
      const draft = await sponsor.save(owner.cookie, owner.orgId, null, {
        commandId: randomUUID(),
        eventId: event.id,
        region,
        brand: '合成赛事赞助',
        title: '未公开赛事投放',
        body: '不得绕过赛事公开授权',
        startsAt: new Date(Date.now() - 3600000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      });
      await sponsor.command(owner.cookie, owner.orgId, draft.id as string, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'SUBMIT',
        reason: '提交合成赛事定向审核',
      });
      await sponsor.command(operator.cookie, owner.orgId, draft.id as string, {
        commandId: randomUUID(),
        expectedVersion: 2,
        type: 'APPROVE',
        reason: '独立审核不替代公开授权',
      });
      await expect(
        sponsor.command(owner.cookie, owner.orgId, draft.id as string, {
          commandId: randomUUID(),
          expectedVersion: 3,
          type: 'PUBLISH',
          reason: '不允许跳过赛事公开页面',
        }),
      ).rejects.toMatchObject({ code: 'SPONSOR_EVENT_NOT_PUBLIC' });
    });
    test('sponsor lock wait crossing its exact end cannot return old content or record an impression', async () => {
      const row = await sponsor.save(owner.cookie, owner.orgId, null, {
        commandId: randomUUID(),
        region,
        brand: '合成短时投放',
        title: '跨锁等待结束边界',
        body: '时段结束后不可展示',
        startsAt: new Date(Date.now() - 3600000).toISOString(),
        endsAt: new Date(Date.now() + 5000).toISOString(),
      });
      const id = row.id as string;
      await sponsor.command(owner.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'SUBMIT',
        reason: '提交合成短时投放',
      });
      await sponsor.command(operator.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: 2,
        type: 'APPROVE',
        reason: '独立审核合成短时投放',
      });
      const publication = await sponsor.command(owner.cookie, owner.orgId, id, {
          commandId: randomUUID(),
          expectedVersion: 3,
          type: 'PUBLISH',
          reason: '发布合成短时投放',
        }),
        key = publication.publicKey as string;
      const blocker = await api.pool.connect();
      try {
        await blocker.query('BEGIN');
        const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;
        await blocker.query(
          'SELECT id FROM sponsorship_publications WHERE public_key=$1 FOR UPDATE',
          [key],
        );
        const pending = sponsor.publicOne(key).then(
          (value) => ({ value, error: null }),
          (error) => ({ value: null, error }),
        );
        await eventually(
          async () =>
            (
              await api.pool.query<{ waiting: boolean }>(
                'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>$1 AND $1=ANY(pg_blocking_pids(pid))) AS waiting',
                [pid],
              )
            ).rows[0]!.waiting,
          (v) => v,
          'sponsor public read did not wait on its real publication row',
        );
        await eventually(
          async () =>
            (
              await api.pool.query<{ expired: boolean }>(
                'SELECT ends_at<=clock_timestamp() AS expired FROM sponsorship_campaigns WHERE id=$1',
                [id],
              )
            ).rows[0]!.expired,
          (v) => v,
          'sponsor window did not end during the lock wait',
          10000,
        );
        await blocker.query('ROLLBACK');
        const outcome = await pending;
        expect(outcome.error).toMatchObject({ status: 404 });
        expect(outcome.value).toBeNull();
        await expect(
          sponsor.impression(key, { commandId: randomUUID() }, 'synthetic-window-source'),
        ).rejects.toMatchObject({ status: 404 });
        expect(
          (
            await api.pool.query(
              'SELECT count(*) FROM sponsorship_impressions i JOIN sponsorship_publications p ON p.id=i.publication_id WHERE p.public_key=$1',
              [key],
            )
          ).rows[0]!.count,
        ).toBe('0');
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
      }
    }, 20000);
    test('offline ledger requires current org authority, independent entry review and a second publisher; private identifiers stay private', async () => {
      const commandId = randomUUID();
      const account = await ledger.create(owner.cookie, owner.orgId, {
        commandId,
        title: '合成公益线下账本',
        description: '已授权线下记账；无支付业务',
        authorizationConfirmed: true,
      });
      await expect(
        ledger.get(stranger.cookie, owner.orgId, account.id as string),
      ).rejects.toMatchObject({ status: 404 });
      const added = await ledger.addEntry(owner.cookie, owner.orgId, account.id as string, {
        commandId: randomUUID(),
        expectedVersion: 1,
        occurredOn: '2026-10-30',
        label: '合成已发生场地支出',
        kind: 'EXPENSE',
        amountFen: -5000,
      });
      const entry = (added as { entry: { id: string; occurredOn: string } }).entry;
      expect(entry.occurredOn).toBe('2026-10-30');
      await expect(
        ledger.command(owner.cookie, owner.orgId, account.id as string, {
          commandId: randomUUID(),
          expectedVersion: 2,
          type: 'APPROVE_ENTRY',
          entryId: entry.id,
          entryVersion: 1,
          reason: '不允许自己审批本人记录',
        }),
      ).rejects.toMatchObject({ status: 403 });
      await ledger.command(handler.cookie, owner.orgId, account.id as string, {
        commandId: randomUUID(),
        expectedVersion: 2,
        type: 'APPROVE_ENTRY',
        entryId: entry.id,
        entryVersion: 1,
        reason: '另一管理员核对合成支出',
      });
      await expect(
        ledger.command(owner.cookie, owner.orgId, account.id as string, {
          commandId: randomUUID(),
          expectedVersion: 3,
          type: 'PUBLISH',
          publicConsent: true,
          reason: '创建人不得自行公示',
        }),
      ).rejects.toMatchObject({ code: 'LEDGER_INDEPENDENT_PUBLISHER' });
      const published = await ledger.command(handler.cookie, owner.orgId, account.id as string, {
        commandId: randomUUID(),
        expectedVersion: 3,
        type: 'PUBLISH',
        publicConsent: true,
        reason: '第二人核对后公示合成账目',
      });
      const key = published.publicKey as string;
      const snapshot = await ledger.publicSnapshot(key);
      expect(snapshot.approvedNetFen).toBe(-5000);
      expect(JSON.stringify(snapshot)).not.toContain(owner.id);
      expect(JSON.stringify(snapshot)).not.toContain(owner.orgId);
      expect(snapshot.entries[0]).not.toHaveProperty('id');
      expect(snapshot.entries[0]!.occurredOn).toBe('2026-10-30');
      expect((await g.operationReceipt(owner.cookie, commandId)).id).toBe(account.id);
      await ledger.command(owner.cookie, owner.orgId, account.id as string, {
        commandId: randomUUID(),
        expectedVersion: 4,
        type: 'CLOSE',
        reason: '永久关闭合成授权账本',
      });
      await expect(ledger.publicSnapshot(key)).rejects.toMatchObject({ status: 404 });
      await expect(
        ledger.addEntry(owner.cookie, owner.orgId, account.id as string, {
          commandId: randomUUID(),
          expectedVersion: 5,
          occurredOn: '2026-10-30',
          label: '关闭后不能记账',
          kind: 'INCOME',
          amountFen: 100,
        }),
      ).rejects.toMatchObject({ code: 'LEDGER_CLOSED' });
    });
    test('ledger correction is an independently reviewed exact reversal and republishing never revives the old snapshot key', async () => {
      const account = await ledger.create(owner.cookie, owner.orgId, {
        commandId: randomUUID(),
        title: '合成冲销账本',
        description: '只记录合成线下事实',
        authorizationConfirmed: true,
      });
      const id = account.id as string;
      const added = await ledger.addEntry(owner.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        occurredOn: '2026-10-29',
        label: '原合成收入',
        kind: 'INCOME',
        amountFen: 10000,
      });
      const original = (added as { entry: { id: string } }).entry;
      await ledger.command(handler.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: 2,
        type: 'APPROVE_ENTRY',
        entryId: original.id,
        entryVersion: 1,
        reason: '独立审核原合成收入',
      });
      const publicBefore = await ledger.command(handler.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: 3,
        type: 'PUBLISH',
        publicConsent: true,
        reason: '公示原始合成记账快照',
      });
      const oldKey = publicBefore.publicKey as string;
      const reversal = {
        commandId: randomUUID(),
        expectedVersion: 4,
        occurredOn: '2026-10-30',
        label: '冲销原合成收入',
        kind: 'REVERSAL',
        amountFen: -10000,
        reversesEntryId: original.id,
      };
      await expect(
        ledger.addEntry(owner.cookie, owner.orgId, id, { ...reversal, amountFen: -9999 }),
      ).rejects.toMatchObject({ code: 'LEDGER_REVERSAL_REFUSED' });
      const reversed = await ledger.addEntry(owner.cookie, owner.orgId, id, reversal);
      const reverseEntry = (reversed as { entry: { id: string } }).entry;
      await expect(
        ledger.addEntry(owner.cookie, owner.orgId, id, {
          ...reversal,
          commandId: randomUUID(),
          expectedVersion: 5,
        }),
      ).rejects.toMatchObject({ code: 'LEDGER_ALREADY_REVERSED' });
      expect((await ledger.publicSnapshot(oldKey)).approvedNetFen).toBe(10000);
      await ledger.command(handler.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: 5,
        type: 'APPROVE_ENTRY',
        entryId: reverseEntry.id,
        entryVersion: 1,
        reason: '独立审核精确反向冲销',
      });
      const fresh = await ledger.command(handler.cookie, owner.orgId, id, {
        commandId: randomUUID(),
        expectedVersion: 6,
        type: 'PUBLISH',
        publicConsent: true,
        reason: '发布包含冲销的新快照',
      });
      expect(fresh.publicKey).not.toBe(oldKey);
      await expect(ledger.publicSnapshot(oldKey)).rejects.toMatchObject({ status: 404 });
      const now = await ledger.publicSnapshot(fresh.publicKey as string);
      expect(now.approvedNetFen).toBe(0);
      expect(now.entries[1]!.reversesSeq).toBe(1);
    });
    test('arbitrary UUID, self-reported completion and no local verifier cannot manufacture a public review', async () => {
      await expect(
        g.createReview(owner.cookie, {
          commandId: randomUUID(),
          sourceKind: 'PLAYER_BOOKING',
          sourceId: randomUUID(),
          score: 5,
          body: '合成评价',
          publicConsent: true,
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        g.createReview(owner.cookie, {
          commandId: randomUUID(),
          sourceKind: 'LOCAL_BOOKING',
          sourceId: randomUUID(),
          score: 5,
          body: '合成评价',
          publicConsent: true,
        }),
      ).rejects.toMatchObject({ status: 503 });
      await expect(
        g.createReview(owner.cookie, {
          commandId: randomUUID(),
          sourceKind: 'PLAYER_BOOKING',
          sourceId: randomUUID(),
          score: 5,
          body: '合成评价',
          publicConsent: true,
          completed: true,
        }),
      ).rejects.toMatchObject({ status: 422 });
    });
  },
);
