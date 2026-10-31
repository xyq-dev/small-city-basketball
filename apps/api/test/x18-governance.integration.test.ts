import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, test, expect } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword } from '../src/security.js';
import { maintainPlatformOperator } from '../src/commerce/platform-operator.js';
import { GovernanceService } from '../src/governance-service.js';
import { CityOperationsService } from '../src/city-operations-service.js';
import { testDatabaseUrl, ORIGIN, PASSWORD, RUN_ID, login } from './support.js';
import type { Api, User } from './support.js';
// Real PostgreSQL services plus real HTTP session authentication. Controller/body-lane wiring
// belongs to root integration; this file does not misrepresent service tests as HTTP acceptance.
describe(
  'X18 isolated PostgreSQL authority, private cases and operation receipts',
  { concurrent: false },
  () => {
    let api: Api, g: GovernanceService, city: CityOperationsService;
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
      const teamId = randomUUID(),
        profileId = randomUUID(),
        orderId = randomUUID(),
        appearanceId = randomUUID();
      await api.pool.query('INSERT INTO teams(id,org_id,name) VALUES($1,$2,$3)', [
        teamId,
        owner.orgId,
        '合成评价服务球队',
      ]);
      await api.pool.query(
        "INSERT INTO booking_profiles(id,user_id,display_name,position,height_cm,city,bio,price_fen,status,reviewed_by,reviewed_at) VALUES($1,$2,'合成服务方','PG',180,'合成城市','合成测试',1000,'APPROVED',$3,clock_timestamp())",
        [profileId, handler.id, operator.id],
      );
      await api.pool.query(
        "INSERT INTO booking_orders(id,org_id,team_id,event_name,team_name,buyer_user_id,scope,fee_bps,settings_version,status) VALUES($1,$2,$3,'合成履约赛事','合成评价服务球队',$4,'SINGLE',0,1,'COMPLETED')",
        [orderId, owner.orgId, teamId, owner.id],
      );
      await api.pool.query(
        "INSERT INTO booking_appearances(id,order_id,profile_id,player_user_id,label,status,report_at,start_at,end_at,venue,service_fen,platform_fee_fen,total_fen,accepted_at,arrived_at,completed_at) VALUES($1,$2,$3,$4,'合成已完成服务','COMPLETED','2024-01-01T10:00:00Z','2024-01-01T10:30:00Z','2024-01-01T11:30:00Z','合成隔离球场',1000,0,1000,'2024-01-01T09:00:00Z','2024-01-01T10:00:00Z','2024-01-01T11:30:00Z')",
        [appearanceId, orderId, profileId, handler.id],
      );
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
      await g.reviewCommand(owner.cookie, row.id as string, {
        commandId: randomUUID(),
        expectedVersion: 2,
        type: 'WITHDRAW',
        reason: '本人撤回公开评价正文',
      });
      await expect(g.publicReview(row.publicKey as string)).rejects.toMatchObject({ status: 404 });
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
