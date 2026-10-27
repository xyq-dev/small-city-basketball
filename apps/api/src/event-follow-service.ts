import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FollowData } from '@small-city-basketball/contracts';
import { notFound, unauthenticated } from './errors.js';
import { hashToken, readSessionToken } from './security.js';
import { StandingsService } from './standings-service.js';
import { resourceId } from './validation.js';
import {
  encodeFollowCursor,
  followDto,
  parseCancelInput,
  parseFollowInput,
  parseFollowListQuery,
  parseLookupQuery,
} from './event-follow-domain.js';
import type { FollowRow } from './event-follow-domain.js';

// The publication chain is joined on every read so INVALID is derived from current state.
const FOLLOW_SELECT = `SELECT f.id,f.status,f.created_at,f.cancelled_at,
  to_char(f.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
  p.public_event_id,p.purpose,(p.revoked_at IS NOT NULL) AS publication_revoked,
  o.status AS org_status,e.name AS event_name,e.start_date::text AS event_start_date,
  e.end_date::text AS event_end_date,e.status AS event_status,e.format AS event_format
  FROM event_follows f
  JOIN public_event_publications p ON p.org_id=f.org_id AND p.event_id=f.event_id AND p.id=f.publication_id
  JOIN organizations o ON o.id=f.org_id
  JOIN events e ON e.org_id=f.org_id AND e.id=f.event_id`;
type Row = FollowRow & { cursor_at: string };

/**
 * C19 event follows (docs/design/C19_CONTRACTS.md §4). Every route acts only on the signed-in
 * account's own rows. Following re-runs the anonymous public-read gate on the server and binds
 * to the publication row; lock order: identity -> organization -> event -> publication -> follow.
 * No WeChat message is sent or scheduled here.
 */
export class EventFollowService extends StandingsService {
  private async one(c: PoolClient, where: string, values: unknown[]): Promise<Row | null> {
    return (await c.query<Row>(`${FOLLOW_SELECT} ${where}`, values)).rows[0] ?? null;
  }

  /** Returns the follow and whether this request created it (201) or found it (200). */
  async follow(
    cookie: string | undefined,
    raw: unknown,
  ): Promise<{ created: boolean; data: FollowData }> {
    const token = readSessionToken(cookie);
    if (!token) throw unauthenticated();
    const input = parseFollowInput(raw);
    // Following reveals no more than the anonymous read does, but keep it bounded per session.
    await this.rateLimit(`follow:${hashToken(token)}`, 30, 60);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      // Identical 404 for unknown, revoked, disabled-organization or purpose-mismatched keys.
      const { pub } = await this.publicAccess(c, input.publicEventId);
      const id = randomUUID();
      const inserted = await c.query(
        `INSERT INTO event_follows(id,user_id,org_id,event_id,publication_id)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (user_id,publication_id) WHERE status='ACTIVE' DO NOTHING`,
        [id, actor.user.id, pub.org_id, pub.event_id, pub.id],
      );
      const created = inserted.rowCount === 1;
      if (created)
        // Personal action: no organization audit scope, so organizers never see who follows.
        await this.audit(c, actor.user.id, null, 'follow.created', 'event_follow', id, {
          publicationId: pub.id,
        });
      const row = await this.one(
        c,
        "WHERE f.user_id=$1 AND f.publication_id=$2 AND f.status='ACTIVE'",
        [actor.user.id, pub.id],
      );
      if (!row) throw notFound();
      return { created, data: followDto(row) };
    });
  }

  async list(cookie: string | undefined, raw: unknown) {
    const q = parseFollowListQuery(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const values: unknown[] = [actor.user.id, q.limit + 1];
      if (q.cursor) values.push(q.cursor.createdAt, q.cursor.id);
      const rows = (
        await c.query<Row>(
          `${FOLLOW_SELECT} WHERE f.user_id=$1 AND f.status='ACTIVE'
           ${q.cursor ? 'AND (f.created_at,f.id) < ($3::timestamptz,$4::uuid)' : ''}
           ORDER BY f.created_at DESC,f.id DESC LIMIT $2`,
          values,
        )
      ).rows;
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return {
        data: page.map(followDto),
        nextCursor:
          rows.length > q.limit && last ? encodeFollowCursor(last.cursor_at, last.id) : null,
      };
    });
  }

  /** The caller's live (ACTIVE or INVALID) follow of exactly this public key, or null. */
  async lookup(cookie: string | undefined, raw: unknown): Promise<FollowData | null> {
    const publicEventId = parseLookupQuery(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const row = await this.one(
        c,
        "WHERE f.user_id=$1 AND p.public_event_id=$2 AND f.status='ACTIVE'",
        [actor.user.id, publicEventId],
      );
      return row ? followDto(row) : null;
    });
  }

  /** Cancelling never needs the publication to be readable; repeating it is a no-op. */
  async cancel(cookie: string | undefined, followId: string, raw: unknown): Promise<FollowData> {
    parseCancelInput(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const id = resourceId(followId);
      // Another account's follow is indistinguishable from a missing one.
      const locked = await c.query<{ status: string }>(
        'SELECT status FROM event_follows WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [id, actor.user.id],
      );
      if (!locked.rows[0]) throw notFound();
      if (locked.rows[0].status === 'ACTIVE') {
        await c.query(
          `UPDATE event_follows SET status='CANCELLED',cancelled_at=GREATEST(clock_timestamp(),created_at)
           WHERE id=$1 AND status='ACTIVE'`,
          [id],
        );
        await this.audit(c, actor.user.id, null, 'follow.cancelled', 'event_follow', id);
      }
      const row = await this.one(c, 'WHERE f.id=$1 AND f.user_id=$2', [id, actor.user.id]);
      if (!row) throw notFound();
      return followDto(row);
    });
  }
}
