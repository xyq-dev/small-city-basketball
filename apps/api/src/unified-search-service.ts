import type {
  PublicSearchData,
  PublicSearchItem,
} from '../../../packages/contracts/unified-search.js';
import { PublicArchivesService, ARCHIVE_EFFECTIVE_SOURCE_SQL } from './public-archives-service.js';
import {
  parsePublicSearch,
  literalSearchPattern,
  publicSearchCursor,
  searchHash,
} from './unified-search-domain.js';
import { readVerifiedRegionCatalog } from './region-catalog-integrity.js';
import { ApiError } from './errors.js';
type Row = Record<string, any>;
const live = `(e.status IN ('SCHEDULED','RUNNING') AND sp.purpose='LIVE') OR (e.status IN ('COMPLETED','ARCHIVED') AND sp.purpose='HISTORY')`;
/** Anonymous search consumes only current independently published public projections. */
export class UnifiedSearchService extends PublicArchivesService {
  async search(raw: unknown, peer: string): Promise<PublicSearchData> {
    const q = parsePublicSearch(raw);
    await this.rateLimit('public-search:' + searchHash(peer), 60, 60);
    return this.snapshotRead(async (c) => {
      if (q.regionId) {
        const { nodes } = await readVerifiedRegionCatalog(c);
        if (!nodes.some((n) => n.regionId === q.regionId))
          throw new ApiError(400, 'INVALID_REGION', '地区不存在，请重新选择');
      }
      const region = `($4::uuid IS NULL OR COALESCE(l.region_id,legacy.region_id) IN (SELECT region_id FROM selected_regions))`;
      const publicListing = `JOIN organizations o ON o.id=l.org_id AND o.status='ACTIVE'
        JOIN events e ON e.org_id=l.org_id AND e.id=l.event_id
        JOIN public_event_publications sp ON sp.org_id=l.org_id AND sp.event_id=l.event_id AND sp.id=l.publication_id AND sp.revoked_at IS NULL
        LEFT JOIN region_legacy_aliases legacy ON l.region_id IS NULL AND legacy.catalog_version=$5 AND legacy.label=l.display_city`;
      // Current youth/public-purpose checks happen after candidate discovery. Fill a
      // visible page without letting old ineligible profiles hide later matches.
      const batchSize = 20;
      const candidates = async (after: string) =>
        (
          await c.query<Row>(
            `WITH RECURSIVE selected_regions AS (
        SELECT region_id FROM region_catalog_nodes WHERE region_id=$4::uuid AND catalog_version=$5
        UNION ALL SELECT n.region_id FROM region_catalog_nodes n JOIN selected_regions r ON n.parent_region_id=r.region_id WHERE n.catalog_version=$5
      ), candidates AS (
        SELECT 'E:'||sp.public_event_id AS key,'EVENT'::text AS kind,sp.public_event_id AS public_key,e.name AS display_name,l.display_city AS city,
          e.start_date::text AS starts_on,e.end_date::text AS ends_on,l.id AS listing_id,NULL::jsonb AS profile
        FROM event_directory_listings l ${publicListing}
        WHERE l.status='ACTIVE' AND (${live}) AND e.format IN ('ROUND_ROBIN','DOUBLE_ROUND_ROBIN','SINGLE_ELIMINATION','GROUP_KNOCKOUT')
          AND ($2='ALL' OR $2='EVENT') AND (e.name ILIKE $1 ESCAPE '\\' OR COALESCE(e.venue_name,'') ILIKE $1 ESCAPE '\\')
          AND ($3::text IS NULL OR l.display_city=$3) AND ${region}
        UNION ALL
        SELECT CASE WHEN p.kind='TEAM' THEN 'T:' ELSE 'P:' END||p.public_key,p.kind,p.public_key,p.display_name,$3::text,NULL::text,NULL::text,NULL::uuid,to_jsonb(p)||jsonb_build_object('consented_at',k.consented_at)
        FROM public_archive_profiles p JOIN public_archive_publications k ON k.profile_id=p.id AND k.public_key=p.public_key AND k.status='ACTIVE'
          JOIN users u ON u.id=p.owner_user_id LEFT JOIN organizations po ON po.id=p.org_id
        WHERE p.status='PUBLISHED' AND ((p.kind='PLAYER' AND u.status='ACTIVE') OR (p.kind='TEAM' AND po.status='ACTIVE'))
          AND ($2='ALL' OR $2=p.kind) AND p.display_name ILIKE $1 ESCAPE '\\'
          AND EXISTS(SELECT 1 FROM (${ARCHIVE_EFFECTIVE_SOURCE_SQL}) eligible WHERE eligible.profile_id=p.id)
          AND (($3::text IS NULL AND $4::uuid IS NULL) OR EXISTS(
            SELECT 1 FROM (${ARCHIVE_EFFECTIVE_SOURCE_SQL}) eligible JOIN event_directory_listings l ON l.org_id=eligible.org_id AND l.event_id=eligible.event_id
            ${publicListing} WHERE eligible.profile_id=p.id AND l.status='ACTIVE' AND (${live})
              AND ($3::text IS NULL OR l.display_city=$3) AND ${region}
          ))
      ) SELECT * FROM candidates WHERE key COLLATE "C" > $6 ORDER BY key COLLATE "C" LIMIT $7`,
            [
              literalSearchPattern(q.q),
              q.kind,
              q.city,
              q.regionId,
              q.catalogVersion,
              after,
              batchSize + 1,
            ],
          )
        ).rows;
      const asOf = new Date(
        (await c.query<Row>('SELECT statement_timestamp() AS now')).rows[0]!.now,
      ).toISOString();
      const items: PublicSearchItem[] = [];
      let after = q.after,
        hasMore = false;
      // At most 200 inspected candidates and 10 queries, plus one lookahead per
      // query. A bounded empty page retains a cursor to the next unchecked item.
      for (let batch = 0; batch < 10 && items.length < q.limit; batch++) {
        const rows = await candidates(after);
        const page = rows.slice(0, batchSize),
          profiles = page.filter((r) => r.profile).map((r) => r.profile);
        await this.lockPublicSources(c, profiles);
        const ids = page.filter((r) => r.listing_id).map((r) => r.listing_id);
        if (ids.length)
          await c.query(
            `SELECT l.id FROM event_directory_listings l JOIN organizations o ON o.id=l.org_id JOIN events e ON e.org_id=l.org_id AND e.id=l.event_id JOIN public_event_publications sp ON sp.id=l.publication_id WHERE l.id=ANY($1::uuid[]) ORDER BY o.id,e.id,l.id FOR SHARE OF o,e,sp,l NOWAIT`,
            [ids],
          );
        hasMore = false;
        for (let index = 0; index < page.length; index++) {
          const r = page[index]!;
          after = r.key;
          hasMore = index + 1 < rows.length;
          if (r.profile) {
            const permitted = await this.currentArchiveSources(c, [r.profile]);
            if (!permitted.length) continue;
            if (q.city || q.regionId) {
              const sourceRegion = region.replaceAll('$4', '$2').replaceAll('$5', '$3');
              const sourceListing = publicListing.replaceAll('$5', '$3');
              const regionMatch = await c.query(
                `WITH RECURSIVE selected_regions AS (
              SELECT region_id FROM region_catalog_nodes WHERE region_id=$2::uuid AND catalog_version=$3
              UNION ALL SELECT n.region_id FROM region_catalog_nodes n JOIN selected_regions r ON n.parent_region_id=r.region_id WHERE n.catalog_version=$3
            ) SELECT l.id FROM public_archive_sources g JOIN event_directory_listings l ON l.org_id=g.org_id AND l.event_id=g.event_id ${sourceListing}
              WHERE g.id=ANY($4::uuid[]) AND l.status='ACTIVE' AND (${live}) AND ($1::text IS NULL OR l.display_city=$1) AND ${sourceRegion}
              ORDER BY l.id LIMIT 1 FOR SHARE OF l,sp NOWAIT`,
                [q.city, q.regionId, q.catalogVersion, permitted.map((s) => s.id)],
              );
              if (!regionMatch.rowCount) continue;
            }
            const current = await this.projection(c, r.profile, asOf, permitted);
            if (current.authorizedSourceCount < 1) continue;
          }
          items.push({
            kind: r.kind,
            publicKey: r.public_key,
            displayName: r.display_name,
            city: r.city,
            startsOn: r.starts_on,
            endsOn: r.ends_on,
          });
          if (items.length === q.limit) break;
        }
        if (!hasMore) break;
      }
      return {
        query: q.q,
        items,
        nextCursor: hasMore ? publicSearchCursor(q.context, after) : null,
        asOf,
        notice:
          '仅搜索当前获准公开的赛事、球队及球员。地区筛选按已公开来源赛事判断；没有可公开来源的档案不显示。',
      };
    });
  }
}
