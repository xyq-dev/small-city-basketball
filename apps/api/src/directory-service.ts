import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  EventDirectoryData,
  EventDirectoryListingData,
  PublicDirectoryEventData,
} from '@small-city-basketball/contracts';
import { ApiError, forbidden } from './errors.js';
import { hashToken } from './security.js';
import { StandingsService } from './standings-service.js';
import type { StandingsAccess } from './standings-service.js';
import {
  directoryGroup,
  encodeDirectoryCursor,
  parseDirectoryCommand,
  parseDirectoryQuery,
} from './directory-domain.js';

type Row = Record<string, any>;
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const conflict = (code: string, message: string): never => {
  throw new ApiError(409, code, message);
};
const version = (actual: number, expected: number) => {
  if (actual !== expected)
    throw new ApiError(409, 'VERSION_CONFLICT', '赛事已更新，请重新读取后操作', {
      currentVersion: actual,
    });
};
const LISTING_COLUMNS =
  'l.id,l.status,l.display_city,l.listed_at,l.revoked_at,l.revoke_source,p.public_event_id';

/**
 * C18 public event directory. LIST/UNLIST reuse the public-viewing authority (organization
 * owner/admin or the event's active EVENT_MANAGER) and lock in the established order:
 * identity -> organization -> event -> public publication -> directory listing.
 * Automatic withdrawals (publication revoked, organization disabled) are database triggers.
 */
export class DirectoryService extends StandingsService {
  private listingDto(r: Row | undefined): EventDirectoryListingData | null {
    return r
      ? {
          id: r.id,
          status: r.status,
          publicEventId: r.public_event_id,
          displayCity: r.display_city,
          listedAt: iso(r.listed_at),
          revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
          revokeSource: r.revoke_source,
        }
      : null;
  }

  private async state(
    c: PoolClient,
    a: StandingsAccess,
    lock = false,
  ): Promise<{
    data: EventDirectoryData;
    pub: Row | null;
    active: Row | null;
  }> {
    const org = a.ctx.orgId,
      id = a.event.id;
    const pub = await this.publication(c, org, id);
    if (pub && !pub.revoked_at && lock)
      await c.query('SELECT id FROM public_event_publications WHERE id=$1 FOR SHARE', [pub.id]);
    const rows = (
      await c.query<Row>(
        `SELECT ${LISTING_COLUMNS} FROM event_directory_listings l
         JOIN public_event_publications p ON p.org_id=l.org_id AND p.event_id=l.event_id AND p.id=l.publication_id
         WHERE l.org_id=$1 AND l.event_id=$2 ORDER BY (l.status='ACTIVE') DESC,l.listed_at DESC,l.id DESC LIMIT 1`,
        [org, id],
      )
    ).rows;
    let active = rows[0]?.status === 'ACTIVE' ? rows[0] : null;
    if (active && lock)
      active =
        (
          await c.query<Row>(
            `SELECT ${LISTING_COLUMNS} FROM event_directory_listings l
           JOIN public_event_publications p ON p.org_id=l.org_id AND p.event_id=l.event_id AND p.id=l.publication_id
           WHERE l.id=$1 AND l.status='ACTIVE' FOR UPDATE OF l`,
            [active.id],
          )
        ).rows[0] ?? null;
    const livePub = pub && !pub.revoked_at ? pub : null;
    const group = livePub ? directoryGroup(a.event.status, livePub.purpose) : null;
    return {
      pub: livePub,
      active,
      data: {
        event: { id, status: a.event.status, version: a.event.version },
        publication: pub
          ? {
              publicEventId: pub.public_event_id,
              purpose: pub.purpose,
              status: pub.revoked_at ? 'REVOKED' : 'ACTIVE',
            }
          : null,
        listing: this.listingDto(active ?? undefined),
        lastListing: active ? null : this.listingDto(rows[0]),
        group,
        capabilities: {
          canList: a.manager && !active && !!group,
          // Withdrawing is never blocked by a closed event.
          canUnlist: a.manager && !!active,
        },
      },
    };
  }

  async getDirectory(cookie: string | undefined, org: string, id: string) {
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.event(c, ctx, id);
      await this.now(c, ctx);
      return (await this.state(c, a)).data;
    });
  }

  async directoryCommand(cookie: string | undefined, org: string, id: string, raw: unknown) {
    const input = parseDirectoryCommand(raw);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.event(c, ctx, id, true);
      if (!a.manager) throw forbidden();
      const now = await this.now(c, ctx);
      version(a.event.version, input.expectedEventVersion);
      const { pub, active } = await this.state(c, a, true);
      if (input.type === 'LIST') {
        if (active) conflict('DIRECTORY_ALREADY_LISTED', '该赛事已在公开目录中');
        if (!pub) conflict('PUBLIC_VIEWING_NOT_ENABLED', '请先开启公开观赛');
        if (!directoryGroup(a.event.status, pub!.purpose))
          conflict('INVALID_EVENT_STATE', '当前赛事状态与公开观赛用途不符，不能列入目录');
        const listingId = randomUUID();
        await c.query(
          `INSERT INTO event_directory_listings(id,org_id,event_id,publication_id,display_city,listed_by,listed_at,listed_event_version,list_reason)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            listingId,
            ctx.orgId,
            a.event.id,
            pub!.id,
            input.displayCity,
            ctx.user.id,
            now,
            a.event.version + 1,
            input.reason,
          ],
        );
        await this.touch(c, a, now);
        await this.audit(c, ctx.user.id, ctx.orgId, 'directory.listed', 'event', a.event.id, {
          listingId,
          publicationId: pub!.id,
          displayCity: input.displayCity,
          reason: input.reason,
          eventVersion: a.event.version,
        });
      } else {
        if (!active) conflict('DIRECTORY_NOT_LISTED', '该赛事当前不在公开目录中');
        await c.query(
          `UPDATE event_directory_listings SET status='REVOKED',revoked_at=GREATEST($2::timestamptz,listed_at),
           revoked_by=$3,revoke_source='UNLIST',revoke_reason=$4 WHERE id=$1 AND status='ACTIVE'`,
          [active!.id, now, ctx.user.id, input.reason],
        );
        await this.touch(c, a, now);
        await this.audit(c, ctx.user.id, ctx.orgId, 'directory.unlisted', 'event', a.event.id, {
          listingId: active!.id,
          reason: input.reason,
          eventVersion: a.event.version,
        });
      }
      return (await this.state(c, a)).data;
    });
  }

  /** Anonymous; no cookie is read. Every page re-checks organization, event and publication. */
  async getPublicDirectory(raw: unknown, ip: string) {
    const q = parseDirectoryQuery(raw);
    await this.rateLimit(`directory-ip:${hashToken(ip)}`, 60, 60);
    const history = q.group === 'HISTORY';
    const sort = history ? 'e.end_date' : 'e.start_date';
    const condition =
      q.group === 'LIVE'
        ? "e.status='RUNNING' AND p.purpose='LIVE'"
        : q.group === 'UPCOMING'
          ? "e.status='SCHEDULED' AND p.purpose='LIVE'"
          : "e.status IN ('COMPLETED','ARCHIVED') AND p.purpose='HISTORY'";
    const after = q.cursor
      ? history
        ? `AND (${sort} < $3::date OR (${sort} = $3::date AND p.public_event_id COLLATE "C" > $4))`
        : `AND (${sort} > $3::date OR (${sort} = $3::date AND p.public_event_id COLLATE "C" > $4))`
      : '';
    const params: unknown[] = [q.city, q.limit + 1];
    if (q.cursor) params.push(q.cursor.sortDate, q.cursor.publicEventId);
    const rows = (
      await this.pool.query<Row>(
        `SELECT p.public_event_id,e.name,e.start_date::text AS start_date,e.end_date::text AS end_date,
           e.venue_name,e.status,p.purpose,l.display_city,${sort}::text AS sort_date
         FROM event_directory_listings l
         JOIN organizations o ON o.id=l.org_id AND o.status='ACTIVE'
         JOIN events e ON e.org_id=l.org_id AND e.id=l.event_id
         JOIN public_event_publications p ON p.org_id=l.org_id AND p.event_id=l.event_id
           AND p.id=l.publication_id AND p.revoked_at IS NULL
         WHERE l.status='ACTIVE' AND ${condition}
           AND e.format IN ('ROUND_ROBIN','SINGLE_ELIMINATION','GROUP_KNOCKOUT')
           AND ($1::text IS NULL OR l.display_city=$1::text) ${after}
         ORDER BY ${sort} ${history ? 'DESC' : 'ASC'}, p.public_event_id COLLATE "C" ASC
         LIMIT $2`,
        params,
      )
    ).rows;
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    const data: PublicDirectoryEventData[] = page.map((r) => ({
      publicEventId: r.public_event_id,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      venueName: r.venue_name,
      status: r.status,
      purpose: r.purpose,
      displayCity: r.display_city,
    }));
    return {
      data,
      nextCursor:
        rows.length > q.limit && last
          ? encodeDirectoryCursor(q.group, q.city, last.sort_date, last.public_event_id)
          : null,
    };
  }
}
