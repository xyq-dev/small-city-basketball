import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  LocalBookingData,
  LocalCheckinData,
  LocalBookingStatus,
  LocalListingData,
  LocalMatchupData,
  LocalPoint,
  LocalRegion,
} from '../../../packages/contracts/local-services.js';
import { ApplicationService, isAdministrator } from './service.js';
import type { Actor, ApiOptions } from './service.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { hashToken } from './security.js';
import { invalid, objectInput, resourceId, text } from './validation.js';
import { assertCurrentRegionVersion } from './region-catalog-domain.js';
import { REGION_CATALOG_VERSION } from './region-catalog-data.js';
import { TencentLocationProvider } from './location-provider.js';
import type { LocationProvider } from './location-provider.js';
import type { SourceTradeHooks } from './trade-source-hooks.js';
import {
  distanceMeters,
  localBookingTransition,
  localCommandId,
  localFail,
  localHash,
  localPoint,
  localVersion,
  parseLocalBooking,
  parseLocalBookingCommand,
  parseLocalListing,
  parseLocalListingCommand,
  parseLocalQuery,
  parseLocalSlot,
} from './local-services-domain.js';

type Row = Record<string, any>;
type Action = 'SUPPLY_REVIEW' | 'SUPPLY_SUSPEND';
export type LocalReviewAuthorizer = (
  c: PoolClient,
  actor: Actor,
  input: { orgId: string; region: LocalRegion; action: Action; grantId?: string | null },
) => Promise<{ grantId: string | null; platformOperator: boolean }>;
const iso = (v: Date | string) => new Date(v).toISOString();
const active = ['HELD', 'REQUESTED', 'CONFIRMED', 'ARRIVED', 'DELIVERED', 'DISPUTED'];
const baseListing = `SELECT l.*,clock_timestamp() AS db_now,o.name AS organization_name,actual_court.status AS court_status FROM local_listings l JOIN organizations o ON o.id=l.org_id JOIN users provider ON provider.id=l.provider_user_id LEFT JOIN courts actual_court ON actual_court.id=l.court_id AND actual_court.org_id=l.org_id WHERE o.status='ACTIVE' AND provider.status='ACTIVE'`;
const visible = `l.status='APPROVED' AND l.published AND l.provider_confirmed AND l.qualified_until>clock_timestamp() AND (l.kind<>'COURT' OR actual_court.status='ACTIVE')`;

/** No payment is recorded or inferred. All resource mutations follow the calendar mutex. */
export class LocalServicesService extends ApplicationService {
  readonly locationProvider: LocationProvider;
  constructor(
    pool: Pool,
    options: ApiOptions,
    locationProvider?: LocationProvider,
    private readonly reviewAuthorizer?: LocalReviewAuthorizer,
    private readonly trade?: SourceTradeHooks,
  ) {
    super(pool, options);
    this.locationProvider = locationProvider ?? new TencentLocationProvider();
  }
  private async mutex(c: PoolClient, orgIds: string[]) {
    const sorted = [...new Set(orgIds)].sort();
    for (const id of sorted) {
      if (
        !(
          await c.query("SELECT id FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE", [
            id,
          ])
        ).rowCount
      )
        throw notFound();
      await c.query('INSERT INTO org_schedule_mutex(org_id) VALUES($1) ON CONFLICT DO NOTHING', [
        id,
      ]);
    }
    await c.query(
      'SELECT org_id FROM org_schedule_mutex WHERE org_id=ANY($1::uuid[]) ORDER BY org_id FOR UPDATE',
      [sorted],
    );
    await c.query('SELECT x12_calendar_lock()');
    await c.query('SELECT x12_release_expired()');
  }
  private async operation(
    c: PoolClient,
    actor: Actor,
    commandId: string,
    input: unknown,
    work: () => Promise<Row>,
    revalidate?: () => Promise<void>,
  ): Promise<Row> {
    const requestHash = localHash(input);
    const old = (
      await c.query(
        'SELECT request_hash,result FROM local_command_receipts WHERE actor_id=$1 AND command_id=$2',
        [actor.user.id, commandId],
      )
    ).rows[0];
    if (old) {
      if (old.request_hash !== requestHash)
        localFail('COMMAND_ID_REUSED', '原操作编号不能用于不同内容');
      await this.ensureFreshSession(c, actor);
      if (revalidate) await revalidate();
      return old.result;
    }
    const result = await work();
    await c.query(
      'INSERT INTO local_command_receipts(actor_id,command_id,request_hash,result) VALUES($1,$2,$3,$4)',
      [actor.user.id, commandId, requestHash, result],
    );
    await this.ensureFreshSession(c, actor);
    if (revalidate) await revalidate();
    return result;
  }
  private async history(
    c: PoolClient,
    actor: Actor,
    id: string,
    action: string,
    version: number,
    reason: string,
  ) {
    await c.query(
      'INSERT INTO local_service_history(id,actor_id,resource_id,action,version,reason) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), actor.user.id, id, action, version, reason],
    );
  }
  private checkVersion(row: Row, expected: number) {
    if (row.version !== expected) localFail('VERSION_CONFLICT', '资料已变化，请刷新后核对');
  }
  private async region(c: PoolClient, r: LocalRegion) {
    assertCurrentRegionVersion(r.catalogVersion);
    if (
      !(
        await c.query(
          'SELECT 1 FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=$2',
          [r.catalogVersion, r.regionId],
        )
      ).rowCount
    )
      invalid('所选地区不在当前目录');
  }
  private async manager(c: PoolClient, actor: Actor, orgId: string) {
    const ctx = await this.lockOrganization(c, actor, orgId);
    if (!isAdministrator(ctx.role)) throw forbidden();
    return ctx;
  }
  private async listing(c: PoolClient, id: string, write = false): Promise<Row> {
    const row = (
      await c.query(`${baseListing} AND l.id=$1 ${write ? 'FOR UPDATE OF l' : ''}`, [
        resourceId(id),
      ])
    ).rows[0];
    if (!row) throw notFound();
    return row;
  }
  private async listingAccess(c: PoolClient, actor: Actor, row: Row) {
    if (row.provider_user_id === actor.user.id) return 'PROVIDER' as const;
    await this.manager(c, actor, row.org_id);
    return 'ADMIN' as const;
  }
  private async reviewAuthorization(c: PoolClient, actor: Actor, row: Row, action: Action) {
    if (actor.user.id === row.created_by || actor.user.id === row.provider_user_id)
      throw forbidden();
    try {
      await this.manager(c, actor, row.org_id);
      return;
    } catch (error) {
      if (!(error instanceof ApiError) || ![403, 404].includes(error.status)) throw error;
      if (!this.reviewAuthorizer) throw error;
    }
    const scope = {
      orgId: row.org_id,
      region: { catalogVersion: row.region_catalog_version, regionId: row.region_id },
      action,
    };
    const authority = await this.reviewAuthorizer(c, actor, scope);
    return async () => {
      const current = await this.reviewAuthorizer!(c, actor, {
        ...scope,
        grantId: authority.grantId,
      });
      if (
        current.grantId !== authority.grantId ||
        current.platformOperator !== authority.platformOperator
      )
        throw forbidden();
    };
  }
  private async viewListing(c: PoolClient, actor: Actor, row: Row) {
    let canManage = row.provider_user_id === actor.user.id,
      canReview = false;
    if (!canManage) {
      try {
        await this.manager(c, actor, row.org_id);
        canManage = true;
      } catch (error) {
        if (!(error instanceof ApiError) || ![403, 404].includes(error.status)) throw error;
      }
    }
    if (actor.user.id !== row.provider_user_id && actor.user.id !== row.created_by) {
      try {
        await this.reviewAuthorization(c, actor, row, 'SUPPLY_REVIEW');
        canReview = true;
      } catch (error) {
        if (!(error instanceof ApiError) || ![403, 404].includes(error.status)) throw error;
      }
    }
    let canSuspend = false;
    if (this.reviewAuthorizer) {
      try {
        await this.reviewAuthorization(c, actor, row, 'SUPPLY_SUSPEND');
        canSuspend = true;
      } catch (error) {
        if (!(error instanceof ApiError) || ![403, 404].includes(error.status)) throw error;
      }
    }
    if (!canManage && !canReview && !canSuspend) throw notFound();
    return {
      canManage,
      canReview,
      canSuspend: this.reviewAuthorizer ? canSuspend : canReview,
      canConfirmProvider: actor.user.id === row.provider_user_id && !row.provider_confirmed,
    };
  }
  private listingDto(
    row: Row,
    privateData = false,
    point: LocalPoint | null = null,
  ): LocalListingData {
    const location: LocalPoint | null =
      row.latitude === null
        ? null
        : {
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            coordinateSystem: 'GCJ02',
          };
    const meters = point && location ? distanceMeters(point, location) : null;
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      description: row.description,
      address: row.address,
      region: { catalogVersion: row.region_catalog_version, regionId: row.region_id },
      point: location,
      coverageRegionIds: row.coverage_region_ids,
      status: row.status,
      version: row.version,
      providerConfirmed: row.provider_confirmed,
      qualifiedUntil: row.qualified_until ? iso(row.qualified_until) : null,
      published: row.published,
      organizationName: row.organization_name,
      distanceMeters: meters,
      distanceLabel:
        meters === null ? null : `约${(meters / 1000).toFixed(1)}公里（距所选起点直线）`,
      ...(privateData
        ? {
            qualificationNote: row.qualification_note,
            reviewReason: row.review_reason,
            providerUserId: row.provider_user_id,
            courtId: row.court_id,
          }
        : {}),
    };
  }
  private validSupply(row: Row, endsAt?: string) {
    if (
      row.status !== 'APPROVED' ||
      (row.kind === 'COURT' && row.court_status !== 'ACTIVE') ||
      !row.published ||
      !row.provider_confirmed ||
      !row.qualified_until ||
      Date.parse(iso(row.qualified_until)) <= new Date(row.db_now).getTime() ||
      (endsAt && iso(row.qualified_until) < endsAt)
    )
      localFail('LOCAL_SUPPLY_UNAVAILABLE', '供给或实际球场未开放、或资格有效期不足，请重新核对');
  }
  async publicList(raw: unknown, ip: string) {
    const q = parseLocalQuery(raw);
    await this.rateLimit(`local-public:${hashToken(ip)}`, 60, 60);
    return this.transaction(async (c) => {
      if (q.region) await this.region(c, q.region);
      const values: unknown[] = [];
      const bind = (v: unknown) => {
        values.push(v);
        return `$${values.length}`;
      };
      let regionSql = '';
      if (q.region) {
        const ver = bind(q.region.catalogVersion),
          id = bind(q.region.regionId);
        regionSql = ` AND (l.region_id IN (WITH RECURSIVE d AS (SELECT region_id FROM region_catalog_nodes WHERE catalog_version=${ver} AND region_id=${id} UNION ALL SELECT n.region_id FROM region_catalog_nodes n JOIN d ON n.parent_region_id=d.region_id WHERE n.catalog_version=${ver}) SELECT region_id FROM d) OR (l.kind<>'COURT' AND EXISTS(SELECT 1 FROM unnest(l.coverage_region_ids) cover(id) WHERE cover.id IN (WITH RECURSIVE a AS (SELECT region_id,parent_region_id FROM region_catalog_nodes WHERE catalog_version=${ver} AND region_id=${id} UNION ALL SELECT n.region_id,n.parent_region_id FROM region_catalog_nodes n JOIN a ON n.region_id=a.parent_region_id WHERE n.catalog_version=${ver}) SELECT region_id FROM a))))`;
      }
      let filter = ` AND ${visible}${regionSql}`;
      if (q.kind) filter += ` AND l.kind=${bind(q.kind)}`;
      if (q.q)
        filter += ` AND position(lower(${bind(q.q)}) in lower(l.title||' '||l.description))>0`;
      // The result cap is explicit. No partial result is presented as an exhaustive nearest list.
      if (q.cursor && !q.point) filter += ` AND l.id>${bind(q.cursor.id)}`;
      const rows = (
        await c.query(
          `${baseListing}${filter} ORDER BY l.id LIMIT ${bind(q.point ? 501 : q.limit + 1)}`,
          values,
        )
      ).rows;
      if (q.point && rows.length > 500)
        localFail('LOCAL_SEARCH_TOO_BROAD', '附近供给较多，请缩小地区或类别后重试', 422);
      let result = rows.map((row) => this.listingDto(row, false, q.point));
      if (q.point)
        result = result
          .filter(
            (x) =>
              x.distanceMeters !== null && (q.radius === null || x.distanceMeters! <= q.radius),
          )
          .sort((a, b) => a.distanceMeters! - b.distanceMeters! || a.id.localeCompare(b.id));
      if (q.point && q.cursor)
        result = result.filter(
          (row) =>
            row.distanceMeters! > q.cursor!.distance! ||
            (row.distanceMeters === q.cursor!.distance && row.id > q.cursor!.id),
        );
      const page = result.slice(0, q.limit);
      const last = page.at(-1);
      return {
        items: page,
        nextCursor:
          result.length > q.limit && last
            ? Buffer.from(
                JSON.stringify({
                  v: 1,
                  scope: q.scope,
                  id: last.id,
                  distance: last.distanceMeters,
                }),
              ).toString('base64url')
            : null,
        locationCapability: { enabled: this.locationProvider.enabled, coordinateSystem: 'GCJ02' },
        queryOrigin: q.point ? 'EXPLICIT_POINT' : 'REGION',
        truncated: false,
      };
    });
  }
  async publicDetail(id: string, ip: string) {
    await this.rateLimit(`local-detail:${hashToken(ip)}`, 120, 60);
    return this.transaction(async (c) => {
      const row = await this.listing(c, id);
      try {
        this.validSupply(row);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'LOCAL_SUPPLY_UNAVAILABLE')
          throw notFound();
        throw error;
      }
      const slots = (
        await c.query(
          `SELECT s.*,NOT EXISTS(SELECT 1 FROM local_resource_reservations r LEFT JOIN local_bookings b ON b.id=r.booking_id LEFT JOIN local_matchups m ON m.id=r.matchup_id WHERE r.active AND r.resource_key=$2 AND tstzrange(r.starts_at,r.ends_at,'[)') && tstzrange(s.starts_at,CASE WHEN $6::boolean THEN s.ends_at ELSE s.ends_at+interval '30 minutes' END,'[)') AND NOT COALESCE((b.status IN ('HELD','REQUESTED') AND b.hold_expires_at<=clock_timestamp()),false) AND NOT COALESCE((m.status='OPEN' AND m.expires_at<=clock_timestamp()),false)) AND NOT EXISTS(SELECT 1 FROM court_reservations old WHERE old.court_id=$4 AND tstzrange(old.starts_at,old.ends_at,'[)') && tstzrange(s.starts_at,s.ends_at,'[)')) AND NOT EXISTS(SELECT 1 FROM booking_appearances old WHERE old.player_user_id=$5 AND old.status IN ('REQUESTED','ACCEPTED','ARRIVED','COMPLETED','DISPUTED') AND NOT (old.status='REQUESTED' AND old.expires_at<=clock_timestamp()) AND c06_booking_window(old.report_at,old.end_at) && tstzrange(s.starts_at,s.ends_at+interval '30 minutes','[)')) AS available FROM local_slots s WHERE s.listing_id=$1 AND s.status='OPEN' AND s.starts_at>clock_timestamp() AND s.ends_at<=$3 ORDER BY s.starts_at,s.id LIMIT 100`,
          [
            row.id,
            row.kind === 'COURT' ? `court:${row.court_id}` : `user:${row.provider_user_id}`,
            row.qualified_until,
            row.kind === 'COURT' ? row.court_id : null,
            row.kind === 'COURT' ? null : row.provider_user_id,
            row.kind === 'COURT',
          ],
        )
      ).rows;
      return {
        listing: this.listingDto(row),
        slots: slots.map((s) => ({
          id: s.id,
          listingId: s.listing_id,
          startsAt: iso(s.starts_at),
          endsAt: iso(s.ends_at),
          status: s.status,
          version: s.version,
          available: s.available,
        })),
        terms: row.terms,
        paymentStatus: 'NOT_ENABLED',
      };
    });
  }
  async workspace(cookie: string | undefined, orgId?: string) {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const listings = (
        await c.query(
          `${baseListing} AND ${orgId ? 'l.org_id' : 'l.provider_user_id'}=$1 ORDER BY l.created_at DESC,l.id LIMIT 200`,
          [orgId ?? actor.user.id],
        )
      ).rows;
      const accessible: Row[] = [];
      for (const listing of listings) {
        try {
          accessible.push({
            ...this.listingDto(listing, true),
            capabilities: await this.viewListing(c, actor, listing),
          });
        } catch (error) {
          if (!(error instanceof ApiError) || ![403, 404].includes(error.status)) throw error;
        }
      }
      return {
        listings: accessible,
        locationEnabled: this.locationProvider.enabled,
        paymentStatus: 'NOT_ENABLED',
      };
    });
  }
  async supplyOptions(cookie: string | undefined, orgId: string) {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      await this.manager(c, actor, resourceId(orgId));
      const providers = (
        await c.query(
          "SELECT u.id,u.display_name AS name FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.status='ACTIVE' AND u.status='ACTIVE' ORDER BY u.display_name,u.id LIMIT 1001",
          [orgId],
        )
      ).rows;
      const courts = (
        await c.query(
          "SELECT id,name FROM courts WHERE org_id=$1 AND status='ACTIVE' ORDER BY name,id LIMIT 1001",
          [orgId],
        )
      ).rows;
      if (providers.length > 1000 || courts.length > 1000)
        localFail('LOCAL_OPTIONS_TOO_BROAD', '机构服务选项超过上限，请先由管理员整理有效供给');
      return { providers, courts };
    });
  }
  async privateListing(cookie: string | undefined, id: string, orgId?: string) {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        listing = await this.listing(c, id);
      if (orgId && listing.org_id !== resourceId(orgId)) throw notFound();
      const capabilities = await this.viewListing(c, actor, listing);
      const slots = (
        await c.query(
          'SELECT * FROM local_slots WHERE listing_id=$1 ORDER BY starts_at DESC,id LIMIT 200',
          [id],
        )
      ).rows;
      return {
        listing: this.listingDto(listing, true),
        terms: listing.terms,
        capabilities,
        slots: slots.map((s) => ({
          id: s.id,
          listingId: s.listing_id,
          startsAt: iso(s.starts_at),
          endsAt: iso(s.ends_at),
          status: s.status,
          version: s.version,
        })),
      };
    });
  }
  async reviseListing(cookie: string | undefined, id: string, raw: unknown) {
    const x = objectInput(raw, ['commandId', 'expectedVersion', 'payload']);
    const input = parseLocalListing({
      ...objectInput(x.payload, [
        'kind',
        'title',
        'description',
        'address',
        'region',
        'point',
        'coverageRegionIds',
        'providerUserId',
        'courtId',
        'qualificationNote',
        'terms',
      ]),
      commandId: x.commandId,
    });
    const expected = localVersion(x.expectedVersion);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        ref = await this.listing(c, id);
      await this.listingAccess(c, actor, ref);
      await this.mutex(c, [ref.org_id]);
      const listing = await this.listing(c, id, true);
      return this.operation(c, actor, input.commandId, { id, expected, input }, async () => {
        this.checkVersion(listing, expected);
        if (!['DRAFT', 'REJECTED'].includes(listing.status))
          localFail(
            'LOCAL_STATE_CONFLICT',
            '只能修改草稿或被退回资料，已批准／暂停资料需另建待审版本',
          );
        if (
          input.kind !== listing.kind ||
          input.providerUserId !== listing.provider_user_id ||
          input.courtId !== listing.court_id ||
          input.region.catalogVersion !== listing.region_catalog_version ||
          input.region.regionId !== listing.region_id
        )
          invalid('不能更换供给身份、实际人员、球场或经营地区');
        await this.region(c, input.region);
        const count = (
          await c.query(
            'SELECT count(*)::int AS n FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=ANY($2::uuid[])',
            [input.region.catalogVersion, input.coverageRegionIds],
          )
        ).rows[0].n;
        if (
          count !== input.coverageRegionIds.length ||
          (input.kind === 'COURT' &&
            (input.coverageRegionIds.length !== 1 ||
              input.coverageRegionIds[0] !== input.region.regionId))
        )
          invalid('覆盖地区无效');
        await c.query(
          "UPDATE local_listings SET title=$2,description=$3,address=$4,latitude=$5,longitude=$6,coverage_region_ids=$7,qualification_note=$8,terms=$9,status='DRAFT',published=false,reviewed_by=NULL,reviewed_at=NULL,qualified_until=NULL,review_reason=NULL,provider_confirmed=$10,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [
            id,
            input.title,
            input.description,
            input.address,
            input.point?.latitude ?? null,
            input.point?.longitude ?? null,
            input.coverageRegionIds,
            input.qualificationNote,
            input.terms,
            actor.user.id === input.providerUserId,
          ],
        );
        await this.history(
          c,
          actor,
          id,
          'REVISE_SUPPLY',
          listing.version + 1,
          '修订资料并重新取得服务方确认与审核',
        );
        return { resourceType: 'LISTING', resourceId: id, version: listing.version + 1 };
      });
    });
  }
  async createListing(cookie: string | undefined, orgId: string, raw: unknown) {
    const input = parseLocalListing(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      await this.manager(c, actor, orgId);
      await this.mutex(c, [orgId]);
      return this.operation(c, actor, input.commandId, { orgId, input }, async () => {
        await this.region(c, input.region);
        const count = (
          await c.query(
            'SELECT count(*)::int AS n FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=ANY($2::uuid[])',
            [input.region.catalogVersion, input.coverageRegionIds],
          )
        ).rows[0]?.n;
        if (count !== input.coverageRegionIds.length) invalid('覆盖地区包含无效或不同版本地区');
        if (
          input.kind === 'COURT' &&
          (input.coverageRegionIds.length !== 1 ||
            input.coverageRegionIds[0] !== input.region.regionId)
        )
          invalid('球场覆盖须为其实际经营地区');
        if (
          !(
            await c.query("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE", [
              input.providerUserId,
            ])
          ).rowCount
        )
          invalid('实际服务人员账号不可用');
        if (
          input.courtId &&
          !(
            await c.query(
              "SELECT id FROM courts WHERE org_id=$1 AND id=$2 AND status='ACTIVE' FOR SHARE",
              [orgId, input.courtId],
            )
          ).rowCount
        )
          invalid('请选择本机构有效实际球场');
        const id = randomUUID();
        await c.query(
          `INSERT INTO local_listings(id,org_id,provider_user_id,created_by,kind,court_id,title,description,address,region_catalog_version,region_id,coverage_region_ids,latitude,longitude,qualification_note,terms,provider_confirmed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            id,
            orgId,
            input.providerUserId,
            actor.user.id,
            input.kind,
            input.courtId,
            input.title,
            input.description,
            input.address,
            input.region.catalogVersion,
            input.region.regionId,
            input.coverageRegionIds,
            input.point?.latitude ?? null,
            input.point?.longitude ?? null,
            input.qualificationNote,
            input.terms,
            actor.user.id === input.providerUserId,
          ],
        );
        await this.history(c, actor, id, 'CREATE_SUPPLY', 1, '创建待审核供给');
        return { resourceType: 'LISTING', resourceId: id, version: 1 };
      });
    });
  }
  async listingCommand(cookie: string | undefined, id: string, raw: unknown) {
    const input = parseLocalListingCommand(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        ref = await this.listing(c, id);
      let revalidate: (() => Promise<void>) | undefined;
      if (['APPROVE', 'REJECT', 'SUSPEND'].includes(input.type))
        revalidate = await this.reviewAuthorization(
          c,
          actor,
          ref,
          input.type === 'SUSPEND' ? 'SUPPLY_SUSPEND' : 'SUPPLY_REVIEW',
        );
      else if (input.type === 'CONFIRM_PROVIDER') {
        if (ref.provider_user_id !== actor.user.id) throw forbidden();
      } else await this.listingAccess(c, actor, ref);
      await this.mutex(c, [ref.org_id]);
      const row = await this.listing(c, id, true);
      return this.operation(
        c,
        actor,
        input.commandId,
        { id, input },
        async () => {
          this.checkVersion(row, input.expectedVersion);
          let status = row.status,
            published = row.published,
            confirmed = row.provider_confirmed;
          let reviewedBy = row.reviewed_by,
            reviewedAt = row.reviewed_at,
            until = row.qualified_until;
          if (input.type === 'CONFIRM_PROVIDER') {
            if (row.provider_confirmed) localFail('LOCAL_STATE_CONFLICT', '服务方已经确认');
            confirmed = true;
          } else if (input.type === 'SUBMIT') {
            if (!['DRAFT', 'REJECTED'].includes(row.status) || !row.provider_confirmed)
              localFail('LOCAL_STATE_CONFLICT', '须服务方确认后才能提交待审核供给');
            status = 'PENDING';
          } else if (input.type === 'APPROVE' || input.type === 'REJECT') {
            if (row.status !== 'PENDING' || !row.provider_confirmed)
              localFail('LOCAL_STATE_CONFLICT', '仅可审核当前待审版本');
            status = input.type === 'APPROVE' ? 'APPROVED' : 'REJECTED';
            published = false;
            reviewedBy = actor.user.id;
            reviewedAt = (await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
            until = input.type === 'APPROVE' ? input.qualifiedUntil : null;
            if (
              until &&
              (Date.parse(until) <= new Date(reviewedAt).getTime() ||
                Date.parse(until) > new Date(reviewedAt).getTime() + 366 * 86400000)
            )
              invalid('资格有效期须在未来且不超过366天，按实际材料填写');
          } else if (input.type === 'PUBLISH') {
            if (
              row.status !== 'APPROVED' ||
              (row.kind === 'COURT' && row.court_status !== 'ACTIVE') ||
              !row.provider_confirmed ||
              !until ||
              new Date(until).getTime() <= new Date(row.db_now).getTime()
            )
              localFail('LOCAL_SUPPLY_UNAVAILABLE', '资格未通过或已过期，不能上架');
            published = true;
          } else if (input.type === 'UNPUBLISH') published = false;
          else if (input.type === 'SUSPEND') {
            status = 'SUSPENDED';
            published = false;
          }
          await c.query(
            'UPDATE local_listings SET status=$2,published=$3,provider_confirmed=$4,reviewed_by=$5,reviewed_at=$6,qualified_until=$7,review_reason=$8,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
            [id, status, published, confirmed, reviewedBy, reviewedAt, until, input.reason],
          );
          await this.history(c, actor, id, input.type, row.version + 1, input.reason);
          return { resourceType: 'LISTING', resourceId: id, version: row.version + 1 };
        },
        revalidate,
      );
    });
  }
  async createSlot(cookie: string | undefined, id: string, raw: unknown) {
    const input = parseLocalSlot(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        ref = await this.listing(c, id);
      await this.listingAccess(c, actor, ref);
      await this.mutex(c, [ref.org_id]);
      const row = await this.listing(c, id, true);
      return this.operation(c, actor, input.commandId, { id, input }, async () => {
        this.checkVersion(row, input.expectedVersion);
        this.validSupply(row, input.endsAt);
        const now = (await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
        if (Date.parse(input.startsAt) <= now.getTime()) invalid('只能配置未来时段');
        if (
          (
            await c.query(
              "SELECT id FROM local_slots WHERE listing_id=$1 AND status='OPEN' AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)')",
              [id, input.startsAt, input.endsAt],
            )
          ).rowCount
        )
          localFail('LOCAL_SLOT_CONFLICT', '该供给已有重叠开放时段');
        const slotId = randomUUID();
        await c.query(
          'INSERT INTO local_slots(id,org_id,listing_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)',
          [slotId, row.org_id, id, input.startsAt, input.endsAt],
        );
        await this.history(c, actor, slotId, 'OPEN_SLOT', 1, '建立真实可预约时隙');
        return { resourceType: 'LISTING', resourceId: id, slotId, version: row.version };
      });
    });
  }
  private async slot(c: PoolClient, slotId: string, listingId: string) {
    const slot = (
      await c.query('SELECT * FROM local_slots WHERE id=$1 AND listing_id=$2 FOR UPDATE', [
        resourceId(slotId),
        listingId,
      ])
    ).rows[0];
    if (!slot || slot.status !== 'OPEN')
      localFail('LOCAL_SLOT_UNAVAILABLE', '该时段已关闭或不可用');
    const now = (await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
    if (slot.starts_at <= now) localFail('LOCAL_SLOT_UNAVAILABLE', '该时段已经开始');
    return slot;
  }
  private async reserve(
    c: PoolClient,
    key: string,
    owner: { bookingId?: string; matchupId?: string },
    start: string,
    end: string,
  ) {
    try {
      await c.query(
        'INSERT INTO local_resource_reservations(id,resource_key,booking_id,matchup_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), key, owner.bookingId ?? null, owner.matchupId ?? null, start, end],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23P01')
        localFail('LOCAL_TIME_CONFLICT', '场地、人员或球队在该时段已有有效安排');
      throw error;
    }
  }
  private async coverage(c: PoolClient, listing: Row, region: LocalRegion) {
    await this.region(c, region);
    if (region.catalogVersion !== listing.region_catalog_version)
      invalid('供给与服务地点地区版本不一致');
    if (
      !(
        await c.query(
          `WITH RECURSIVE ancestors AS (SELECT region_id,parent_region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=$2 UNION ALL SELECT n.region_id,n.parent_region_id FROM region_catalog_nodes n JOIN ancestors a ON n.region_id=a.parent_region_id WHERE n.catalog_version=$1) SELECT 1 FROM ancestors WHERE region_id=ANY($3::uuid[])`,
          [region.catalogVersion, region.regionId, listing.coverage_region_ids],
        )
      ).rowCount
    )
      localFail('LOCAL_OUTSIDE_COVERAGE', '实际服务地点不在已审核覆盖地区');
  }
  async book(cookie: string | undefined, raw: unknown) {
    const input = parseLocalBooking(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        ref = await this.listing(c, input.listingId);
      if (ref.provider_user_id === actor.user.id) throw forbidden();
      await this.mutex(c, [ref.org_id]);
      const listing = await this.listing(c, ref.id, true);
      return this.operation(c, actor, input.commandId, input, async () => {
        const slot = await this.slot(c, input.slotId, listing.id);
        this.validSupply(listing, iso(slot.ends_at));
        await this.coverage(c, listing, input.serviceRegion);
        if (
          listing.kind === 'COURT' &&
          (input.serviceAddress !== null ||
            input.servicePoint !== null ||
            input.serviceRegion.regionId !== listing.region_id)
        )
          invalid('球场预约必须使用该球场实际地点');
        if (listing.kind !== 'COURT' && !input.serviceAddress)
          invalid('人员服务须明确实际服务地址，不能使用设备位置替代');
        const id = randomUUID(),
          isCourt = listing.kind === 'COURT';
        const snapshot = {
          title: listing.title,
          kind: listing.kind,
          address: isCourt ? listing.address : input.serviceAddress,
          point: isCourt
            ? listing.latitude === null
              ? null
              : {
                  latitude: listing.latitude,
                  longitude: listing.longitude,
                  coordinateSystem: 'GCJ02',
                }
            : input.servicePoint,
          region: input.serviceRegion,
          coverageRegionIds: listing.coverage_region_ids,
          listingVersion: listing.version,
          terms: listing.terms,
          courtId: listing.court_id,
          providerUserId: listing.provider_user_id,
        };
        await c.query(
          `INSERT INTO local_bookings(id,org_id,listing_id,slot_id,buyer_user_id,provider_user_id,status,starts_at,ends_at,hold_expires_at,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,LEAST(clock_timestamp()+interval '10 minutes',$8::timestamptz),$10)`,
          [
            id,
            listing.org_id,
            listing.id,
            slot.id,
            actor.user.id,
            listing.provider_user_id,
            isCourt ? 'HELD' : 'REQUESTED',
            slot.starts_at,
            slot.ends_at,
            snapshot,
          ],
        );
        const until = isCourt
          ? iso(slot.ends_at)
          : new Date(new Date(slot.ends_at).getTime() + 30 * 60000).toISOString();
        await this.reserve(
          c,
          isCourt ? `court:${listing.court_id}` : `user:${listing.provider_user_id}`,
          { bookingId: id },
          iso(slot.starts_at),
          until,
        );
        await this.history(
          c,
          actor,
          id,
          isCourt ? 'HOLD_COURT' : 'REQUEST_SERVICE',
          1,
          '本人确认当前条款和实际服务地点',
        );
        await this.trade?.captureSourceCharge(c, actor, {
          kind: 'LOCAL_BOOKING',
          sourceId: id,
          acceptedTermsId: input.acceptedTermsId,
          chargeConsent: input.chargeConsent === true,
        });
        return { resourceType: 'BOOKING', resourceId: id, version: 1 };
      });
    });
  }
  private bookingDto(row: Row, actor: Actor): LocalBookingData {
    const expired =
      ['HELD', 'REQUESTED'].includes(row.status) &&
      row.hold_expires_at &&
      new Date(row.hold_expires_at).getTime() <= new Date(row.db_now).getTime();
    return {
      id: row.id,
      listingId: row.listing_id,
      slotId: row.slot_id,
      status: expired ? 'EXPIRED' : row.status,
      version: row.version,
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      holdExpiresAt: row.hold_expires_at ? iso(row.hold_expires_at) : null,
      title: row.snapshot.title,
      kind: row.snapshot.kind,
      address: row.snapshot.address,
      location: row.snapshot.point,
      terms: row.snapshot.terms,
      reason: row.reason,
      change: row.change_request,
      paymentStatus: 'NOT_ENABLED',
      canActAs:
        row.buyer_user_id === actor.user.id
          ? 'BUYER'
          : row.provider_user_id === actor.user.id
            ? 'PROVIDER'
            : 'ADMIN',
    };
  }
  private async bookingAccess(c: PoolClient, actor: Actor, row: Row) {
    if (row.buyer_user_id === actor.user.id) return 'BUYER' as const;
    if (row.provider_user_id === actor.user.id) return 'PROVIDER' as const;
    await this.manager(c, actor, row.org_id);
    return 'ADMIN' as const;
  }
  async bookings(cookie: string | undefined) {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const rows = (
        await c.query(
          "SELECT b.*,clock_timestamp() AS db_now FROM local_bookings b JOIN organizations o ON o.id=b.org_id WHERE o.status='ACTIVE' AND (b.buyer_user_id=$1 OR b.provider_user_id=$1) ORDER BY b.created_at DESC,b.id LIMIT 200",
          [actor.user.id],
        )
      ).rows;
      return { items: rows.map((b) => this.bookingDto(b, actor)), limit: 200 };
    });
  }
  async bookingDetail(cookie: string | undefined, id: string) {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const b = (
        await c.query(
          "SELECT b.*,clock_timestamp() AS db_now FROM local_bookings b JOIN organizations o ON o.id=b.org_id WHERE b.id=$1 AND o.status='ACTIVE'",
          [resourceId(id)],
        )
      ).rows[0];
      if (!b) throw notFound();
      await this.bookingAccess(c, actor, b);
      return this.bookingDto(b, actor);
    });
  }
  async issueCheckin(
    cookie: string | undefined,
    id: string,
    raw: unknown,
  ): Promise<{ receipt: Row; checkin: LocalCheckinData | null }> {
    const x = objectInput(raw, ['commandId', 'expectedVersion']),
      commandId = localCommandId(x.commandId),
      expectedVersion = localVersion(x.expectedVersion);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        ref = (await c.query('SELECT * FROM local_bookings WHERE id=$1', [resourceId(id)])).rows[0];
      if (!ref || ref.buyer_user_id !== actor.user.id) throw notFound();
      await this.mutex(c, [ref.org_id]);
      const b = (await c.query('SELECT * FROM local_bookings WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      let checkin: { code: string; expiresAt: string } | null = null;
      const receipt = await this.operation(
        c,
        actor,
        commandId,
        { id, expectedVersion, kind: 'ISSUE_CHECKIN' },
        async () => {
          this.checkVersion(b, expectedVersion);
          await this.trade?.assertSourceFinancialGate(c, 'LOCAL_BOOKING', b.id);
          const listing = await this.listing(c, b.listing_id),
            now = (await c.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
          if (
            listing.kind !== 'COURT' ||
            listing.court_status !== 'ACTIVE' ||
            b.status !== 'CONFIRMED' ||
            now.getTime() < b.starts_at.getTime() - 30 * 60000 ||
            now >= b.ends_at
          )
            localFail(
              'LOCAL_CHECKIN_WINDOW',
              '请在球场开始前30分钟至结束前，由需求方现场生成核销码',
            );
          const code = randomBytes(16).toString('hex'),
            expiresAt = new Date(
              Math.min(now.getTime() + 10 * 60000, b.ends_at.getTime()),
            ).toISOString();
          await c.query(
            'UPDATE local_bookings SET checkin_hash=$2,checkin_expires_at=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
            [id, hashToken(code), expiresAt],
          );
          await this.history(
            c,
            actor,
            id,
            'ISSUE_CHECKIN',
            b.version + 1,
            '需求方签发或换发一次性球场现场核销码，明文不入库',
          );
          checkin = { code, expiresAt };
          return { resourceType: 'BOOKING', resourceId: id, version: b.version + 1 };
        },
      );
      // Plaintext appears only in this original response, never in receipts or audit history.
      return { receipt, checkin };
    });
  }
  async bookingCommand(cookie: string | undefined, id: string, raw: unknown) {
    const input = parseLocalBookingCommand(raw);
    resourceId(id);
    if (input.type === 'REDEEM_CHECKIN') {
      // Release the authentication connection before the pool-based limiter.
      const userId = await this.transaction(async (c) => (await this.lockActor(c, cookie)).user.id);
      await this.rateLimit(`local-checkin:${userId}:${id}`, 6, 60);
    }
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        ref = (await c.query('SELECT * FROM local_bookings WHERE id=$1', [resourceId(id)])).rows[0];
      if (!ref) throw notFound();
      const role = await this.bookingAccess(c, actor, ref);
      await this.mutex(c, [ref.org_id]);
      const b = (
        await c.query(
          'SELECT *,clock_timestamp() AS db_now FROM local_bookings WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      return this.operation(c, actor, input.commandId, { id, input }, async () => {
        this.checkVersion(b, input.expectedVersion);
        if (['CONFIRM', 'REDEEM_CHECKIN', 'ARRIVE', 'DELIVER', 'COMPLETE'].includes(input.type))
          await this.trade?.assertSourceFinancialGate(c, 'LOCAL_BOOKING', b.id);
        const now = (await c.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
        if (['HELD', 'REQUESTED'].includes(b.status) && b.hold_expires_at <= now)
          localFail('LOCAL_HOLD_EXPIRED', '预约占用已到期，请核对原结果后重新选时段');
        // Releasing or disputing an already authorized historical booking must remain
        // possible when the counterparty is disabled. New supply-dependent actions
        // still use the current active-provider lookup below.
        const listing = ['CANCEL', 'DISPUTE'].includes(input.type)
          ? b.snapshot
          : await this.listing(c, b.listing_id);
        let status: LocalBookingStatus = b.status,
          change = b.change_request,
          slotId = b.slot_id,
          startsAt = iso(b.starts_at),
          endsAt = iso(b.ends_at);
        if (input.type === 'PROPOSE_CHANGE') {
          if (status !== 'CONFIRMED' || role === 'ADMIN' || change)
            localFail('LOCAL_STATE_CONFLICT', '仅双方可为已确认订单提出一个待处理改期');
          const requestedSlot = await this.slot(c, input.newSlotId!, b.listing_id);
          change = {
            slotId: input.newSlotId,
            proposedBy: actor.user.id,
            reason: input.reason,
            startsAt: iso(requestedSlot.starts_at),
            endsAt: iso(requestedSlot.ends_at),
          };
        } else if (input.type === 'ACCEPT_CHANGE' || input.type === 'REJECT_CHANGE') {
          if (
            status !== 'CONFIRMED' ||
            role === 'ADMIN' ||
            !change ||
            change.proposedBy === actor.user.id
          )
            localFail('LOCAL_STATE_CONFLICT', '改期需由另一方确认');
          if (input.type === 'ACCEPT_CHANGE') {
            const slot = await this.slot(c, change.slotId, b.listing_id);
            this.validSupply(listing, iso(slot.ends_at));
            await this.coverage(c, listing, b.snapshot.region);
            if (
              (
                await c.query(
                  "SELECT id FROM local_matchups WHERE court_booking_id=$1 AND status IN ('OPEN','CONFIRMED')",
                  [b.id],
                )
              ).rowCount
            )
              localFail('LOCAL_MATCHUP_ATTACHED', '该球场预约已有双方约赛，先取消约赛再改期');
            await c.query(
              'UPDATE local_resource_reservations SET active=false WHERE booking_id=$1 AND active',
              [b.id],
            );
            const until =
              listing.kind === 'COURT'
                ? iso(slot.ends_at)
                : new Date(new Date(slot.ends_at).getTime() + 30 * 60000).toISOString();
            await this.reserve(
              c,
              listing.kind === 'COURT'
                ? `court:${listing.court_id}`
                : `user:${listing.provider_user_id}`,
              { bookingId: b.id },
              iso(slot.starts_at),
              until,
            );
            slotId = slot.id;
            startsAt = iso(slot.starts_at);
            endsAt = iso(slot.ends_at);
          }
          change = null;
        } else {
          if (input.type === 'ARRIVE' && listing.kind === 'COURT')
            localFail('LOCAL_CHECKIN_REQUIRED', '球场到场须由需求方出示一次性码并由实际经营方核销');
          if (input.type === 'REDEEM_CHECKIN') {
            if (
              listing.kind !== 'COURT' ||
              listing.court_status !== 'ACTIVE' ||
              role !== 'PROVIDER' ||
              !b.checkin_hash ||
              !b.checkin_expires_at ||
              b.checkin_expires_at <= now ||
              !timingSafeEqual(
                Buffer.from(b.checkin_hash, 'hex'),
                Buffer.from(hashToken(input.checkinCode!), 'hex'),
              )
            )
              localFail('LOCAL_CHECKIN_INVALID', '核销码无效、已过期或不是本次球场预约');
          }
          status = localBookingTransition(status, input.type, role);
          if (['CONFIRM', 'ACCEPT'].includes(input.type)) {
            this.validSupply(listing, endsAt);
            await this.coverage(c, listing, b.snapshot.region);
            if (b.starts_at <= now) localFail('LOCAL_SLOT_UNAVAILABLE', '原时段已经开始');
          }
          if (
            ['ARRIVE', 'REDEEM_CHECKIN', 'DELIVER', 'COMPLETE'].includes(input.type) &&
            (role === 'ADMIN' || now.getTime() < new Date(b.starts_at).getTime() - 30 * 60000)
          )
            localFail('LOCAL_STATE_CONFLICT', '尚未到可履约时段或非履约双方');
          if (status === 'COMPLETED' && b.ends_at > now)
            localFail('LOCAL_STATE_CONFLICT', '服务时段尚未结束');
          // Narrow lock-scope exception: the calendar mutex serializes all local rows.
          // Cascading cancellation may touch other organizations' matchup/ledger rows,
          // but never takes another org mutex or reads/locks legacy reservation rows.
          if (['CANCELLED', 'DECLINED', 'EXPIRED'].includes(status)) {
            await c.query(
              'UPDATE local_resource_reservations SET active=false WHERE booking_id=$1 AND active',
              [b.id],
            );
            await c.query(
              "UPDATE local_matchups SET status='CANCELLED',reason=$2,version=version+1,updated_at=clock_timestamp() WHERE court_booking_id=$1 AND status IN ('OPEN','CONFIRMED')",
              [b.id, '球场预约已取消，约赛同步取消'],
            );
            await c.query(
              'UPDATE local_resource_reservations r SET active=false FROM local_matchups m WHERE r.matchup_id=m.id AND m.court_booking_id=$1 AND r.active',
              [b.id],
            );
          }
          change = null;
        }
        await c.query(
          'UPDATE local_bookings SET status=$2,change_request=$3,slot_id=$4,starts_at=$5,ends_at=$6,reason=$7,checkin_hash=NULL,checkin_expires_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
          [id, status, change, slotId, startsAt, endsAt, input.reason],
        );
        await this.history(c, actor, id, input.type, b.version + 1, input.reason);
        return { resourceType: 'BOOKING', resourceId: id, version: b.version + 1 };
      });
    });
  }
  async closeSlot(cookie: string | undefined, id: string, slotId: string, raw: unknown) {
    const x = objectInput(raw, ['commandId', 'expectedVersion', 'reason']),
      commandId = localCommandId(x.commandId),
      expected = localVersion(x.expectedVersion),
      reason = text(x.reason, 'reason', 4, 500);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        ref = await this.listing(c, id);
      await this.listingAccess(c, actor, ref);
      await this.mutex(c, [ref.org_id]);
      return this.operation(c, actor, commandId, { id, slotId, expected, reason }, async () => {
        const s = (
          await c.query('SELECT * FROM local_slots WHERE id=$1 AND listing_id=$2 FOR UPDATE', [
            resourceId(slotId),
            id,
          ])
        ).rows[0];
        if (!s) throw notFound();
        this.checkVersion(s, expected);
        if (s.status !== 'OPEN') localFail('LOCAL_STATE_CONFLICT', '时隙已关闭');
        if (
          (
            await c.query(
              "SELECT id FROM local_bookings WHERE slot_id=$1 AND status IN ('ARRIVED','DELIVERED','DISPUTED')",
              [slotId],
            )
          ).rowCount
        )
          localFail('LOCAL_STATE_CONFLICT', '已有履约或争议记录，请按争议处理，不自动取消');
        // As with booking cancellation, the cross-org cascade below touches only
        // local rows under the calendar mutex; it acquires no additional org locks.
        await c.query(
          "UPDATE local_slots SET status='CLOSED',reason=$2,version=version+1 WHERE id=$1",
          [slotId, reason],
        );
        await c.query(
          "UPDATE local_resource_reservations r SET active=false FROM local_bookings b WHERE r.booking_id=b.id AND b.slot_id=$1 AND b.status IN ('HELD','REQUESTED','CONFIRMED') AND r.active",
          [slotId],
        );
        await c.query(
          "UPDATE local_matchups m SET status='CANCELLED',reason=$2,version=m.version+1,updated_at=clock_timestamp() FROM local_bookings b WHERE m.court_booking_id=b.id AND b.slot_id=$1 AND m.status IN ('OPEN','CONFIRMED')",
          [slotId, reason],
        );
        await c.query(
          'UPDATE local_resource_reservations r SET active=false FROM local_matchups m JOIN local_bookings b ON b.id=m.court_booking_id WHERE r.matchup_id=m.id AND b.slot_id=$1 AND r.active',
          [slotId],
        );
        await c.query(
          "UPDATE local_bookings SET status='CANCELLED',reason=$2,change_request=NULL,checkin_hash=NULL,checkin_expires_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE slot_id=$1 AND status IN ('HELD','REQUESTED','CONFIRMED')",
          [slotId, reason],
        );
        await this.history(c, actor, slotId, 'CLOSE_SLOT', s.version + 1, reason);
        return { resourceType: 'LISTING', resourceId: id, slotId, version: s.version + 1 };
      });
    });
  }
  async location(raw: unknown, ip: string) {
    const x = objectInput(raw, ['type', 'point', 'keyword', 'region']);
    await this.rateLimit(`local-map:${hashToken(ip)}`, 20, 60);
    if (x.type === 'REVERSE') {
      const candidates = await this.locationProvider.reverse(localPoint(x.point));
      const result = [];
      for (const candidate of candidates) {
        const node = candidate.sourceCode
          ? (
              await this.pool.query(
                'SELECT region_id,name,level FROM region_catalog_nodes WHERE catalog_version=$1 AND source_code=$2',
                [REGION_CATALOG_VERSION, candidate.sourceCode],
              )
            ).rows[0]
          : null;
        result.push({
          ...candidate,
          ...(node
            ? {
                region: { catalogVersion: REGION_CATALOG_VERSION, regionId: node.region_id },
                regionLabel: node.name,
                regionLevel: node.level,
              }
            : {}),
        });
      }
      return { candidates: result, inventoryVerified: false };
    }
    if (x.type !== 'SEARCH') invalid('不支持的地图查询');
    const r = objectInput(x.region, ['catalogVersion', 'regionId']);
    const region = {
      catalogVersion: String(r.catalogVersion),
      regionId: resourceId(String(r.regionId)),
    };
    const sourceCode = await this.transaction(async (c) => {
      await this.region(c, region);
      return (
        await c.query(
          'SELECT source_code FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=$2',
          [region.catalogVersion, region.regionId],
        )
      ).rows[0].source_code as string;
    });
    const candidates = await this.locationProvider.search(
      text(x.keyword, 'keyword', 1, 80),
      sourceCode,
      x.point ? localPoint(x.point) : undefined,
    );
    const allowedCodes = new Set(
      (
        await this.pool.query(
          `WITH RECURSIVE d AS (SELECT region_id,source_code FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=$2 UNION ALL SELECT n.region_id,n.source_code FROM region_catalog_nodes n JOIN d ON n.parent_region_id=d.region_id WHERE n.catalog_version=$1) SELECT source_code FROM d`,
          [region.catalogVersion, region.regionId],
        )
      ).rows.map((v) => v.source_code),
    );
    // Unknown POI district is not silently treated as being inside the selected city.
    return {
      candidates: candidates.filter((v) => v.sourceCode && allowedCodes.has(v.sourceCode)),
      inventoryVerified: false,
    };
  }
  async receipt(cookie: string | undefined, commandId: string) {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const r = (
        await c.query(
          'SELECT result FROM local_command_receipts WHERE actor_id=$1 AND command_id=$2',
          [actor.user.id, localCommandId(commandId)],
        )
      ).rows[0];
      if (!r) throw notFound();
      if (r.result.resourceType === 'LISTING')
        await this.viewListing(c, actor, await this.listing(c, r.result.resourceId));
      else if (r.result.resourceType === 'BOOKING') {
        const b = (
          await c.query(
            "SELECT b.*,clock_timestamp() AS db_now FROM local_bookings b JOIN organizations o ON o.id=b.org_id WHERE b.id=$1 AND o.status='ACTIVE'",
            [r.result.resourceId],
          )
        ).rows[0];
        if (!b) throw notFound();
        await this.bookingAccess(c, actor, b);
      } else await this.matchupAccess(c, actor, r.result.resourceId);
      return r.result;
    });
  }
  private async teamManager(c: PoolClient, actor: Actor, orgId: string, teamId: string) {
    if (
      !(
        await c.query(
          "SELECT 1 FROM team_access_grants g JOIN teams t ON t.org_id=g.org_id AND t.id=g.team_id JOIN organizations o ON o.id=t.org_id WHERE g.org_id=$1 AND g.team_id=$2 AND g.user_id=$3 AND g.status='ACTIVE' AND o.status='ACTIVE' FOR SHARE OF g,t,o",
          [orgId, teamId, actor.user.id],
        )
      ).rowCount
    )
      throw notFound();
  }
  private async matchupAccess(c: PoolClient, actor: Actor, id: string) {
    const r = (await c.query('SELECT * FROM local_matchups WHERE id=$1', [resourceId(id)])).rows[0];
    if (!r) throw notFound();
    const visible = (
      await c.query(
        "SELECT g.org_id,g.team_id FROM team_access_grants g JOIN teams t ON t.org_id=g.org_id AND t.id=g.team_id WHERE g.user_id=$1 AND g.status='ACTIVE' AND ((g.org_id=$2 AND g.team_id=$3) OR (g.org_id=$4 AND g.team_id=$5)) FOR SHARE OF g,t",
        [actor.user.id, r.home_org_id, r.home_team_id, r.away_org_id, r.away_team_id],
      )
    ).rows;
    if (!visible.length) throw notFound();
    const orgs = (
      await c.query("SELECT id FROM organizations WHERE id=ANY($1::uuid[]) AND status='ACTIVE'", [
        [r.home_org_id, r.away_org_id],
      ])
    ).rows;
    if (new Set(orgs.map((o) => o.id)).size !== new Set([r.home_org_id, r.away_org_id]).size)
      throw notFound();
    const existingTeams = (
      await c.query(
        'SELECT id FROM teams WHERE ((org_id=$1 AND id=$2) OR (org_id=$3 AND id=$4)) FOR SHARE',
        [r.home_org_id, r.home_team_id, r.away_org_id, r.away_team_id],
      )
    ).rows;
    if (existingTeams.length !== 2) throw notFound();
    return {
      row: r,
      home: visible.some((v) => v.team_id === r.home_team_id),
      away: visible.some((v) => v.team_id === r.away_team_id),
    };
  }
  private matchupDto(row: Row, away: boolean): LocalMatchupData {
    const expired =
      row.status === 'OPEN' && new Date(row.expires_at).getTime() <= new Date(row.db_now).getTime();
    return {
      id: row.id,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      homeTeamName: row.snapshot.homeTeamName,
      awayTeamName: row.snapshot.awayTeamName,
      homeOrgId: row.home_org_id,
      awayOrgId: row.away_org_id,
      courtId: row.snapshot.courtId,
      courtOrgId: row.snapshot.courtOrgId,
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      address: row.snapshot.address,
      terms: row.snapshot.terms,
      status: expired ? 'CANCELLED' : row.status,
      version: row.version,
      homeConfirmed: true,
      awayConfirmed: !!row.away_confirmed_by,
      canConfirm: away && row.status === 'OPEN' && !expired,
    };
  }
  async matchups(cookie: string | undefined) {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const rows = (
        await c.query(
          "SELECT m.*,clock_timestamp() AS db_now,EXISTS(SELECT 1 FROM team_access_grants g WHERE g.user_id=$1 AND g.org_id=m.away_org_id AND g.team_id=m.away_team_id AND g.status='ACTIVE') AS can_away FROM local_matchups m JOIN organizations h ON h.id=m.home_org_id JOIN organizations a ON a.id=m.away_org_id WHERE h.status='ACTIVE' AND a.status='ACTIVE' AND EXISTS(SELECT 1 FROM teams t WHERE t.org_id=m.home_org_id AND t.id=m.home_team_id) AND EXISTS(SELECT 1 FROM teams t WHERE t.org_id=m.away_org_id AND t.id=m.away_team_id) AND EXISTS(SELECT 1 FROM team_access_grants g WHERE g.user_id=$1 AND g.status='ACTIVE' AND ((g.org_id=m.home_org_id AND g.team_id=m.home_team_id) OR (g.org_id=m.away_org_id AND g.team_id=m.away_team_id))) ORDER BY m.created_at DESC,m.id LIMIT 200",
          [actor.user.id],
        )
      ).rows;
      return {
        items: rows.map((r) => this.matchupDto(r, r.can_away && r.created_by !== actor.user.id)),
        limit: 200,
      };
    });
  }
  async createMatchup(cookie: string | undefined, raw: unknown) {
    const x = objectInput(raw, [
      'commandId',
      'homeOrgId',
      'homeTeamId',
      'awayOrgId',
      'awayTeamId',
      'courtBookingId',
      'terms',
    ]);
    const input = {
      commandId: localCommandId(x.commandId),
      homeOrgId: resourceId(String(x.homeOrgId)),
      homeTeamId: resourceId(String(x.homeTeamId)),
      awayOrgId: resourceId(String(x.awayOrgId)),
      awayTeamId: resourceId(String(x.awayTeamId)),
      courtBookingId: resourceId(String(x.courtBookingId)),
      terms: text(x.terms, 'terms', 4, 1000),
    };
    if (input.homeTeamId === input.awayTeamId) invalid('约赛双方不能为同一球队');
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      await this.teamManager(c, actor, input.homeOrgId, input.homeTeamId);
      const ref = (
        await c.query('SELECT * FROM local_bookings WHERE id=$1 AND buyer_user_id=$2', [
          input.courtBookingId,
          actor.user.id,
        ])
      ).rows[0];
      if (!ref) throw notFound();
      await this.mutex(c, [input.homeOrgId, input.awayOrgId, ref.org_id]);
      return this.operation(c, actor, input.commandId, input, async () => {
        const b = (
          await c.query(
            'SELECT *,clock_timestamp() AS db_now FROM local_bookings WHERE id=$1 FOR UPDATE',
            [ref.id],
          )
        ).rows[0];
        if (b.status !== 'CONFIRMED' || b.snapshot.kind !== 'COURT' || b.starts_at <= b.db_now)
          localFail('LOCAL_COURT_BOOKING_REQUIRED', '约赛须使用本人已确认的未来球场预约');
        const currentSupply = await this.listing(c, b.listing_id);
        if (currentSupply.court_status !== 'ACTIVE')
          localFail('LOCAL_COURT_BOOKING_REQUIRED', '本次实际球场已停用，请先核对场地安排');
        const teams = (
          await c.query(
            'SELECT id,name FROM teams WHERE ((org_id=$1 AND id=$2) OR (org_id=$3 AND id=$4)) FOR SHARE',
            [input.homeOrgId, input.homeTeamId, input.awayOrgId, input.awayTeamId],
          )
        ).rows;
        if (teams.length !== 2) throw notFound();
        const id = randomUUID(),
          snap = {
            homeTeamName: teams.find((t) => t.id === input.homeTeamId)!.name,
            awayTeamName: teams.find((t) => t.id === input.awayTeamId)!.name,
            courtId: b.snapshot.courtId,
            courtOrgId: b.org_id,
            address: b.snapshot.address,
            terms: input.terms,
          };
        await c.query(
          "INSERT INTO local_matchups(id,home_org_id,home_team_id,away_org_id,away_team_id,court_booking_id,created_by,home_confirmed_by,starts_at,ends_at,expires_at,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,LEAST(clock_timestamp()+interval '30 minutes',$8::timestamptz),$10)",
          [
            id,
            input.homeOrgId,
            input.homeTeamId,
            input.awayOrgId,
            input.awayTeamId,
            b.id,
            actor.user.id,
            b.starts_at,
            b.ends_at,
            snap,
          ],
        );
        await this.reserve(
          c,
          `team:${input.homeTeamId}`,
          { matchupId: id },
          iso(b.starts_at),
          iso(b.ends_at),
        );
        await this.history(c, actor, id, 'PROPOSE_MATCHUP', 1, '本方队长确认约赛条款，等待另一方');
        return { resourceType: 'MATCHUP', resourceId: id, version: 1 };
      });
    });
  }
  async matchupCommand(cookie: string | undefined, id: string, raw: unknown) {
    const x = objectInput(raw, ['commandId', 'expectedVersion', 'type', 'reason']),
      commandId = localCommandId(x.commandId),
      expected = localVersion(x.expectedVersion),
      type = String(x.type),
      reason = text(x.reason, 'reason', 4, 500);
    if (!['CONFIRM', 'DECLINE', 'CANCEL', 'COMPLETE'].includes(type)) invalid('不支持的约赛操作');
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        access = await this.matchupAccess(c, actor, id),
        ref = access.row;
      const courtOrgId = (
        await c.query('SELECT org_id FROM local_bookings WHERE id=$1', [ref.court_booking_id])
      ).rows[0]?.org_id;
      await this.mutex(c, [ref.home_org_id, ref.away_org_id, courtOrgId]);
      const row = (await c.query('SELECT * FROM local_matchups WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      return this.operation(c, actor, commandId, { id, expected, type, reason }, async () => {
        this.checkVersion(row, expected);
        const now = (await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
        let status = row.status,
          away = row.away_confirmed_by;
        if (
          ['CANCELLED', 'DECLINED', 'COMPLETED'].includes(status) ||
          (status === 'OPEN' && row.expires_at <= now)
        )
          localFail('LOCAL_STATE_CONFLICT', '约赛已终结或邀请已过期');
        if (type === 'CONFIRM') {
          if (!access.away || actor.user.id === row.created_by || status !== 'OPEN')
            throw forbidden();
          const booking = (
            await c.query(
              'SELECT b.status,c.status AS court_status FROM local_bookings b JOIN local_listings l ON l.id=b.listing_id JOIN courts c ON c.id=l.court_id AND c.org_id=l.org_id WHERE b.id=$1',
              [row.court_booking_id],
            )
          ).rows[0];
          if (booking?.status !== 'CONFIRMED' || booking?.court_status !== 'ACTIVE')
            localFail('LOCAL_COURT_BOOKING_REQUIRED', '球场预约已变化，请由双方重新核对');
          if (row.starts_at <= now) localFail('LOCAL_STATE_CONFLICT', '约赛时段已经开始');
          await this.reserve(
            c,
            `team:${row.away_team_id}`,
            { matchupId: row.id },
            iso(row.starts_at),
            iso(row.ends_at),
          );
          status = 'CONFIRMED';
          away = actor.user.id;
        } else if (type === 'DECLINE') {
          if (!access.away || status !== 'OPEN') throw forbidden();
          status = 'DECLINED';
        } else if (type === 'CANCEL') status = 'CANCELLED';
        else {
          if (status !== 'CONFIRMED' || row.ends_at > now)
            localFail('LOCAL_STATE_CONFLICT', '只有已确认且时段结束的约赛可完成');
          status = 'COMPLETED';
        }
        if (['DECLINED', 'CANCELLED'].includes(status))
          await c.query(
            'UPDATE local_resource_reservations SET active=false WHERE matchup_id=$1 AND active',
            [id],
          );
        await c.query(
          'UPDATE local_matchups SET status=$2,away_confirmed_by=$3,reason=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
          [id, status, away, reason],
        );
        await this.history(c, actor, id, type, row.version + 1, reason);
        return { resourceType: 'MATCHUP', resourceId: id, version: row.version + 1 };
      });
    });
  }
}

/** Trusted governance adapters: identity and completion are persisted server facts. */
export async function verifiedGovernanceBooking(
  c: PoolClient,
  bookingId: string,
  actorUserId: string,
  requireCompleted = true,
) {
  const b = (
    await c.query(
      "SELECT b.*,l.region_catalog_version,l.region_id FROM local_bookings b JOIN local_listings l ON l.id=b.listing_id JOIN organizations o ON o.id=b.org_id JOIN users buyer ON buyer.id=b.buyer_user_id JOIN users provider ON provider.id=b.provider_user_id WHERE b.id=$1 AND (NOT $3::boolean OR b.status='COMPLETED') AND o.status='ACTIVE' AND ((buyer.status='ACTIVE' AND provider.status='ACTIVE') OR (NOT $3::boolean AND ((b.buyer_user_id=$2 AND buyer.status='ACTIVE' AND provider.status='DISABLED') OR (b.provider_user_id=$2 AND provider.status='ACTIVE' AND buyer.status='DISABLED')))) AND (b.buyer_user_id=$2 OR b.provider_user_id=$2)",
      [resourceId(bookingId), resourceId(actorUserId), requireCompleted],
    )
  ).rows[0];
  if (!b) throw notFound();
  return {
    bookingId: b.id,
    orgId: b.org_id,
    region: { catalogVersion: b.region_catalog_version, regionId: b.region_id },
    buyerUserId: b.buyer_user_id,
    providerUserId: b.provider_user_id,
    completed: b.status === 'COMPLETED',
  };
}
export async function verifiedCompletedBooking(
  c: PoolClient,
  bookingId: string,
  actorUserId: string,
) {
  return {
    ...(await verifiedGovernanceBooking(c, bookingId, actorUserId, true)),
    completed: true as const,
  };
}
