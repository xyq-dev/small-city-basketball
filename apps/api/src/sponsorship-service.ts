import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { GovernanceService } from './governance-service.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { objectInput } from './validation.js';
import {
  govCheckVersion,
  govCommand,
  govFail,
  govId,
  govKey,
  govQuery,
  govRegion,
  govText,
  govVersion,
  parseCampaign,
  sponsorshipTransition,
} from './governance-domain.js';
import {
  governanceActiveOrg,
  governanceFinish,
  governanceReceipt,
  governanceRegion,
} from './city-operations-service.js';
import type { GovernanceRegion } from '../../../packages/contracts/governance.js';
type Row = Record<string, any>;
const iso = (v: string | Date) => new Date(v).toISOString();
const region = (r: Row): GovernanceRegion => ({
  catalogVersion: r.region_catalog_version,
  regionId: r.region_id,
});
const MEASUREMENT = 'CLIENT_REPORTED_DEDUPLICATED';
export class SponsorshipService extends GovernanceService {
  private async manager(c: PoolClient, cookie: string | undefined, orgId: string) {
    const actor = await this.lockActor(c, cookie);
    await this.govAdmin(c, actor, govId(orgId));
    return actor;
  }
  private async sponsorEvent(
    c: PoolClient,
    orgId: string,
    eventId: string | null,
    published = false,
  ) {
    if (!eventId) return;
    const row = (
      await c.query<Row>('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
        orgId,
        eventId,
      ])
    ).rows[0];
    if (!row) throw notFound();
    if (published) {
      const pubs = (
        await c.query<Row>(
          'SELECT public_event_id FROM public_event_publications WHERE org_id=$1 AND event_id=$2 AND revoked_at IS NULL ORDER BY created_at DESC',
          [orgId, eventId],
        )
      ).rows;
      let visible = false;
      for (const p of pubs) {
        try {
          await this.publicAccess(c, p.public_event_id);
          visible = true;
          break;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
        }
      }
      if (!visible) govFail('SPONSOR_EVENT_NOT_PUBLIC', '定向赛事须有当前有效的公开页面');
    }
  }
  private async row(c: PoolClient, orgId: string, id: string, write = false) {
    await governanceActiveOrg(c, govId(orgId));
    const row = (
      await c.query<Row>(
        `SELECT * FROM sponsorship_campaigns WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`,
        [orgId, govId(id)],
      )
    ).rows[0];
    if (!row) throw notFound();
    return row;
  }
  private async dto(c: PoolClient, r: Row) {
    const pub = (
      await c.query<Row>(
        'SELECT public_key FROM sponsorship_publications WHERE campaign_id=$1 AND revoked_at IS NULL',
        [r.id],
      )
    ).rows[0];
    const count = Number(
      (
        await c.query<{ count: string }>(
          'SELECT count(*) FROM sponsorship_impressions i JOIN sponsorship_publications p ON p.id=i.publication_id WHERE p.campaign_id=$1',
          [r.id],
        )
      ).rows[0]!.count,
    );
    return {
      id: r.id,
      orgId: r.org_id,
      eventId: r.event_id,
      region: region(r),
      brand: r.brand,
      title: r.title,
      body: r.body,
      startsAt: iso(r.starts_at),
      endsAt: iso(r.ends_at),
      status: r.status,
      version: r.version,
      createdBy: r.created_by,
      reviewedBy: r.reviewed_by,
      reviewReason: r.review_reason,
      publicKey: pub?.public_key ?? null,
      reportedImpressions: count,
      measurement: MEASUREMENT,
      measurementNotice:
        '客户端上报展示按发布批次及操作编号去重；不等于独立人数、真实观看或结算凭证。',
    };
  }
  async selectionOptions(cookie: string | undefined, orgId: string, raw: unknown = {}) {
    const q = objectInput(raw, ['query']);
    const query = q.query === undefined ? '' : govText(q.query, 'query', 1, 80);
    return this.transaction(async (c) => {
      await this.manager(c, cookie, orgId);
      return {
        events: (
          await c.query(
            "SELECT id,name,status FROM events WHERE org_id=$1 AND ($2='' OR position(lower($2) in lower(name))>0) ORDER BY created_at DESC,id LIMIT 101",
            [orgId, query],
          )
        ).rows.slice(0, 100),
      };
    });
  }
  async list(cookie: string | undefined, orgId: string, raw: unknown) {
    const q = govQuery(raw);
    return this.transaction(async (c) => {
      await this.manager(c, cookie, orgId);
      const rows = (
        await c.query<Row>(
          'SELECT * FROM sponsorship_campaigns WHERE org_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3',
          [orgId, q.before, q.limit + 1],
        )
      ).rows;
      return {
        items: await Promise.all(rows.slice(0, q.limit).map((r) => this.dto(c, r))),
        nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
      };
    });
  }
  async get(cookie: string | undefined, orgId: string, id: string) {
    return this.transaction(async (c) => {
      await this.manager(c, cookie, orgId);
      return this.dto(c, await this.row(c, orgId, id));
    });
  }
  async reviewQueue(cookie: string | undefined, raw: unknown) {
    const q = govQuery(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const refs = (
        await c.query<Row>(
          "SELECT s.* FROM sponsorship_campaigns s JOIN organizations o ON o.id=s.org_id AND o.status='ACTIVE' WHERE s.status IN ('SUBMITTED','APPROVED') AND ($1::uuid IS NULL OR s.id<$1) ORDER BY s.id DESC LIMIT $2",
          [q.before, q.limit + 1],
        )
      ).rows;
      const items: unknown[] = [];
      for (const row of refs.slice(0, q.limit)) {
        if (row.created_by === actor.user.id) continue;
        try {
          await this.requireCityScope(c, actor, {
            orgId: row.org_id,
            region: region(row),
            action: 'SPONSOR_REVIEW',
          });
          items.push(await this.dto(c, row));
        } catch (error) {
          if (!(error instanceof ApiError) || ![403, 404].includes(error.status)) throw error;
        }
      }
      return { items, nextCursor: refs.length > q.limit ? refs[q.limit - 1]!.id : null };
    });
  }
  async save(cookie: string | undefined, orgId: string, id: string | null, raw: unknown) {
    const input = parseCampaign(raw);
    if (Boolean(id) !== Boolean(input.expectedVersion))
      govFail('VALIDATION_ERROR', '编辑广告须提供当前版本，创建广告不带版本', 422);
    await this.govThrottle(cookie, 'sponsor-save', input.commandId, 40);
    return this.transaction(async (c) => {
      const actor = await this.manager(c, cookie, orgId);
      await governanceRegion(c, input.region);
      await this.sponsorEvent(c, orgId, input.eventId);
      const previous = id ? await this.row(c, orgId, id, true) : null;
      const request = { operation: 'SPONSOR_SAVE', orgId, id, ...input };
      const old = await governanceReceipt(c, actor, input.commandId, request);
      if (old) return old;
      if (previous) {
        govCheckVersion(previous.version, input.expectedVersion!);
        if (!['DRAFT', 'REJECTED'].includes(previous.status))
          govFail('SPONSOR_TERMS_FROZEN', '提交审核后投放条件不可直接修改');
      }
      const campaignId = id ?? randomUUID();
      const values = [
        campaignId,
        orgId,
        input.eventId,
        input.region.catalogVersion,
        input.region.regionId,
        input.brand,
        input.title,
        input.body,
        input.startsAt,
        input.endsAt,
        actor.user.id,
      ];
      const updated = previous
        ? (
            await c.query<Row>(
              "UPDATE sponsorship_campaigns SET event_id=$3,region_catalog_version=$4,region_id=$5,brand=$6,title=$7,body=$8,starts_at=$9,ends_at=$10,status='DRAFT',reviewed_by=NULL,reviewed_at=NULL,review_reason=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND org_id=$2 RETURNING *",
              values.slice(0, 10),
            )
          ).rows[0]!
        : (
            await c.query<Row>(
              'INSERT INTO sponsorship_campaigns(id,org_id,event_id,region_catalog_version,region_id,brand,title,body,starts_at,ends_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
              values,
            )
          ).rows[0]!;
      await this.audit(
        c,
        actor.user.id,
        orgId,
        'governance.sponsor_saved',
        'sponsorship',
        campaignId,
      );
      const result = await this.dto(c, updated);
      await governanceFinish(c, actor, input.commandId, request, result);
      return result;
    });
  }
  async command(cookie: string | undefined, orgId: string, id: string, raw: unknown) {
    const o = objectInput(raw, ['commandId', 'expectedVersion', 'type', 'reason']);
    const input = {
      commandId: govCommand(o.commandId),
      expectedVersion: govVersion(o.expectedVersion),
      type: String(o.type),
      reason: govText(o.reason, 'reason', 4, 500),
    };
    if (
      !['SUBMIT', 'APPROVE', 'REJECT', 'WITHDRAW', 'PUBLISH', 'REVOKE_PUBLICATION'].includes(
        input.type,
      )
    )
      govFail('VALIDATION_ERROR', '广告操作无效', 422);
    await this.govThrottle(cookie, 'sponsor-command', input.commandId);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const row = await this.row(c, orgId, id, true);
      const reviewing = ['APPROVE', 'REJECT'].includes(input.type);
      if (reviewing) {
        if (row.created_by === actor.user.id) throw forbidden();
        await this.requireCityScope(c, actor, {
          orgId,
          region: region(row),
          action: 'SPONSOR_REVIEW',
        });
      } else await this.govAdmin(c, actor, orgId);
      const request = { operation: 'SPONSOR_COMMAND', orgId, id, ...input };
      const old = await governanceReceipt(c, actor, input.commandId, request);
      if (old) return old;
      govCheckVersion(row.version, input.expectedVersion);
      const status = sponsorshipTransition(row.status, input.type, reviewing);
      await governanceRegion(c, region(row));
      await this.sponsorEvent(c, orgId, row.event_id, input.type === 'PUBLISH');
      if (input.type === 'PUBLISH') {
        if (new Date(row.ends_at).getTime() <= Date.parse(await this.now(c)))
          govFail('SPONSOR_WINDOW_ENDED', '投放时段已结束');
        if (
          (
            await c.query(
              'SELECT id FROM sponsorship_publications WHERE campaign_id=$1 AND revoked_at IS NULL',
              [id],
            )
          ).rowCount
        )
          govFail('SPONSOR_ALREADY_PUBLIC', '先撤销当前发布，再创建新发布批次');
        await c.query(
          'INSERT INTO sponsorship_publications(id,campaign_id,public_key,campaign_version,published_by) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), id, randomBytes(32).toString('base64url'), row.version + 1, actor.user.id],
        );
      } else if (['WITHDRAW', 'REVOKE_PUBLICATION'].includes(input.type)) {
        const revoked = await c.query(
          'UPDATE sponsorship_publications SET revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason=$3 WHERE campaign_id=$1 AND revoked_at IS NULL RETURNING id',
          [id, actor.user.id, input.reason],
        );
        if (input.type === 'REVOKE_PUBLICATION' && !revoked.rowCount)
          govFail('SPONSOR_NOT_PUBLIC', '当前没有可撤销的发布');
      }
      const updated = (
        await c.query<Row>(
          `UPDATE sponsorship_campaigns SET status=$2,version=version+1,reviewed_by=CASE WHEN $5::boolean THEN $3 ELSE reviewed_by END,reviewed_at=CASE WHEN $5::boolean THEN clock_timestamp() ELSE reviewed_at END,review_reason=CASE WHEN $5::boolean THEN $4 ELSE review_reason END,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
          [id, status, actor.user.id, input.reason, reviewing],
        )
      ).rows[0]!;
      await this.audit(
        c,
        actor.user.id,
        orgId,
        'governance.sponsor_' + input.type.toLowerCase(),
        'sponsorship',
        id,
      );
      const result = await this.dto(c, updated);
      await governanceFinish(c, actor, input.commandId, request, result);
      return result;
    });
  }
  private async publicRow(c: PoolClient, key: string) {
    const ref = (
      await c.query<Row>(
        'SELECT s.id,s.org_id FROM sponsorship_publications p JOIN sponsorship_campaigns s ON s.id=p.campaign_id WHERE p.public_key=$1',
        [govKey(key)],
      )
    ).rows[0];
    if (!ref) throw notFound();
    const campaign = await this.row(c, ref.org_id, ref.id);
    if (campaign.status !== 'APPROVED') throw notFound();
    try {
      await this.sponsorEvent(c, campaign.org_id, campaign.event_id, true);
    } catch (error) {
      if (error instanceof ApiError) throw notFound();
      throw error;
    }
    const row = (
      await c.query<Row>(
        'SELECT id AS publication_id,public_key,clock_timestamp() AS server_time FROM sponsorship_publications WHERE public_key=$1 AND campaign_id=$2 AND revoked_at IS NULL AND campaign_version=$3 AND $4::timestamptz<=clock_timestamp() AND $5::timestamptz>clock_timestamp() FOR SHARE',
        [govKey(key), campaign.id, campaign.version, campaign.starts_at, campaign.ends_at],
      )
    ).rows[0];
    if (!row) throw notFound();
    this.checkAtCommit(c, 'sponsor-window:' + row.publication_id, async () => {
      if (
        !(
          await c.query(
            "SELECT p.id FROM sponsorship_publications p JOIN sponsorship_campaigns s ON s.id=p.campaign_id WHERE p.id=$1 AND p.revoked_at IS NULL AND s.status='APPROVED' AND p.campaign_version=s.version AND s.starts_at<=clock_timestamp() AND s.ends_at>clock_timestamp()",
            [row.publication_id],
          )
        ).rowCount
      )
        throw notFound();
    });
    return { ...campaign, ...row };
  }
  private publicDto(row: Row) {
    return {
      publicKey: row.public_key,
      brand: row.brand,
      title: row.title,
      body: row.body,
      label: '广告／赞助',
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      region: region(row),
      measurement: MEASUREMENT,
      serverTime: iso(row.server_time),
    };
  }
  async publicOne(key: string) {
    return this.transaction(async (c) => this.publicDto(await this.publicRow(c, key)));
  }
  async publicList(raw: unknown) {
    const q = govQuery(raw, ['regionId', 'catalogVersion', 'eventPublicId']);
    if (q.before) govFail('VALIDATION_ERROR', '公开赞助使用固定有界列表，不接受私有游标', 422);
    const selected = govRegion({
      regionId: q.input.regionId,
      catalogVersion: q.input.catalogVersion,
    });
    const eventKey = q.input.eventPublicId == null ? null : govKey(q.input.eventPublicId);
    return this.transaction(async (c) => {
      await governanceRegion(c, selected);
      const event = eventKey ? await this.publicAccess(c, eventKey) : null;
      const ancestorIds = (
        await c.query<{ region_id: string }>(
          `WITH RECURSIVE ancestors AS (SELECT region_id,parent_region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=$2 UNION ALL SELECT n.region_id,n.parent_region_id FROM region_catalog_nodes n JOIN ancestors a ON n.region_id=a.parent_region_id WHERE n.catalog_version=$1) SELECT region_id FROM ancestors`,
          [selected.catalogVersion, selected.regionId],
        )
      ).rows.map((r) => r.region_id);
      const refs = (
        await c.query<Row>(
          `SELECT p.public_key FROM sponsorship_publications p JOIN sponsorship_campaigns s ON s.id=p.campaign_id JOIN organizations o ON o.id=s.org_id AND o.status='ACTIVE' WHERE p.revoked_at IS NULL AND p.campaign_version=s.version AND s.status='APPROVED' AND s.starts_at<=clock_timestamp() AND s.ends_at>clock_timestamp() AND s.region_catalog_version=$1 AND s.region_id=ANY($4::uuid[]) AND (s.event_id IS NULL OR (s.event_id=$2 AND s.org_id=$3)) ORDER BY (s.event_id IS NOT NULL) DESC,s.starts_at,s.id LIMIT $5`,
          [
            selected.catalogVersion,
            event?.event.id ?? null,
            event?.pub.org_id ?? null,
            ancestorIds,
            q.limit + 1,
          ],
        )
      ).rows;
      const eligible: Row[] = [];
      for (const row of refs.slice(0, q.limit)) {
        try {
          eligible.push(await this.publicRow(c, row.public_key));
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }
      return {
        items: eligible.slice(0, q.limit).map((r) => this.publicDto(r)),
        truncated: refs.length > q.limit,
        measurement: MEASUREMENT,
      };
    });
  }
  async impression(key: string, raw: unknown, source: string) {
    const o = objectInput(raw, ['commandId']);
    const commandId = govCommand(o.commandId);
    await this.rateLimit(
      'sponsor-impression:' + createHash('sha256').update(source).digest('hex'),
      120,
      60,
    );
    return this.transaction(async (c) => {
      const row = await this.publicRow(c, key);
      await c.query(
        'INSERT INTO sponsorship_impressions(publication_id,command_id) VALUES($1,$2) ON CONFLICT(publication_id,command_id) DO NOTHING',
        [row.publication_id, commandId],
      );
      const receipt = (
        await c.query<Row>(
          'SELECT created_at FROM sponsorship_impressions WHERE publication_id=$1 AND command_id=$2',
          [row.publication_id, commandId],
        )
      ).rows[0]!;
      return {
        publicKey: key,
        commandId,
        recordedAt: iso(receipt.created_at),
        measurement: MEASUREMENT,
      };
    });
  }
}
