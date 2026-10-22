import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  OverlayBootstrapData,
  OverlayCommandResponse,
  OverlayGrantData,
  OverlaySnapshotData,
  OverlayWorkbenchData,
} from '@small-city-basketball/contracts';
import { ApplicationService, isAdministrator } from './service.js';
import type { OrgActor } from './service.js';
import { ApiError, forbidden, notFound, unauthenticated } from './errors.js';
import { resourceId } from './validation.js';
import {
  hashOverlayToken,
  newOverlayToken,
  opaqueOverlayId,
  overlayCookie,
  overlayPreview,
  parseOverlayBootstrap,
  parseOverlayCommand,
  readOverlayCookie,
} from './overlay-domain.js';
import type { ResultRow } from './standings-domain.js';

type Row = Record<string, any>;
interface Access {
  ctx: OrgActor;
  event: { id: string; name: string; version: number };
  matchId: string;
  manager: boolean;
}
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const conflict = (code: string, message: string): never => {
  throw new ApiError(409, code, message);
};

/** Overlay authorization never inherits a private user session or public publication. */
export class OverlayService extends ApplicationService {
  private async access(
    c: PoolClient,
    cookie: string | undefined,
    org: string,
    id: string,
    writing: boolean,
  ): Promise<Access> {
    const ctx = await this.lockOrganization(c, await this.lockActor(c, cookie), org);
    const matchId = resourceId(id);
    // Identity lookup only: no match lock before the Event lock.
    const match = (
      await c.query<Row>('SELECT event_id FROM published_matches WHERE org_id=$1 AND id=$2', [
        ctx.orgId,
        matchId,
      ])
    ).rows[0];
    if (!match) throw notFound();
    const event = (
      await c.query<Access['event']>(
        `SELECT id,name,version FROM events WHERE org_id=$1 AND id=$2 FOR ${writing ? 'UPDATE' : 'SHARE'}`,
        [ctx.orgId, match.event_id],
      )
    ).rows[0];
    if (!event) throw notFound();
    const staff = (
      await c.query<Row>(
        "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
        [ctx.orgId, event.id, ctx.user.id],
      )
    ).rows[0];
    if (!isAdministrator(ctx.role) && !staff) throw notFound();
    const manager =
      isAdministrator(ctx.role) || ['EVENT_MANAGER', 'STREAMER'].includes(staff?.role);
    if (writing && !manager) throw forbidden();
    return { ctx, event, matchId, manager };
  }

  /** One locked wall-clock sample, retaining PG precision for all SQL cutoffs. */
  private async now(c: PoolClient, actor?: OrgActor): Promise<string> {
    const now = (await c.query<{ now: string }>('SELECT clock_timestamp()::text AS now')).rows[0]!
      .now;
    if (actor) {
      const fresh = await c.query(
        'SELECT id FROM sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>$2::timestamptz',
        [actor.sessionId, now],
      );
      if (!fresh.rowCount) throw unauthenticated();
    }
    return now;
  }

  private async current(c: PoolClient, a: Access, writing = false): Promise<Row | null> {
    return (
      (
        await c.query<Row>(
          `SELECT * FROM overlay_grants WHERE org_id=$1 AND event_id=$2 AND match_id=$3 AND revoked_at IS NULL FOR ${writing ? 'UPDATE' : 'SHARE'}`,
          [a.ctx.orgId, a.event.id, a.matchId],
        )
      ).rows[0] ?? null
    );
  }

  private grantDto(r: Row, now: string): OverlayGrantData {
    return {
      overlayId: r.overlay_id,
      template: r.template,
      status: r.revoked_at
        ? 'REVOKED'
        : new Date(r.expires_at).getTime() <= Date.parse(now)
          ? 'EXPIRED'
          : 'ACTIVE',
      version: r.version,
      createdAt: iso(r.created_at),
      expiresAt: iso(r.expires_at),
      revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
      revocationReason: r.revocation_reason,
    };
  }

  /** All current result evidence comes from this single statement snapshot. */
  private async source(
    c: PoolClient,
    org: string,
    event: string,
    match: string,
  ): Promise<ResultRow> {
    const row = (
      await c.query<ResultRow>(
        `SELECT m.*,to_jsonb(s) AS state,to_jsonb(cf) AS confirmation,to_jsonb(le) AS last_event,to_jsonb(rc) AS last_command,to_jsonb(sr) AS scoring_rules FROM published_matches m LEFT JOIN scoring_states s ON s.org_id=m.org_id AND s.match_id=m.id LEFT JOIN result_confirmations cf ON cf.org_id=m.org_id AND cf.match_id=m.id AND cf.id=s.latest_confirmation_id LEFT JOIN scoring_events le ON le.org_id=m.org_id AND le.match_id=m.id AND le.seq=s.last_event_seq LEFT JOIN scoring_commands rc ON rc.org_id=m.org_id AND rc.match_id=m.id AND rc.actor_id=le.actor_id AND rc.command_id=le.command_id LEFT JOIN scoring_rulesets sr ON sr.org_id=m.org_id AND sr.event_id=m.event_id AND sr.id=s.ruleset_id WHERE m.org_id=$1 AND m.event_id=$2 AND m.id=$3`,
        [org, event, match],
      )
    ).rows[0];
    if (!row) throw notFound();
    return row;
  }

  private async workbench(
    c: PoolClient,
    a: Access,
    current: Row | null,
    now: string,
  ): Promise<OverlayWorkbenchData> {
    const history = (
      await c.query<Row>(
        'SELECT * FROM overlay_grants WHERE org_id=$1 AND event_id=$2 AND match_id=$3 AND revoked_at IS NOT NULL ORDER BY created_at DESC,overlay_id DESC LIMIT 21',
        [a.ctx.orgId, a.event.id, a.matchId],
      )
    ).rows;
    let preview: OverlayWorkbenchData['preview'] = null;
    let previewError: OverlayWorkbenchData['previewError'] = null;
    try {
      preview = overlayPreview(
        await this.source(c, a.ctx.orgId, a.event.id, a.matchId),
        a.event.name,
        iso(now),
      );
    } catch (error) {
      // A damaged result can never prevent management from revoking its read authorization.
      if (!(error instanceof ApiError) || error.code !== 'RESULT_SOURCE_INVALID') throw error;
      previewError = { code: 'RESULT_SOURCE_INVALID', message: error.message };
    }
    const currentGrant = current ? this.grantDto(current, now) : null;
    return {
      event: { id: a.event.id, name: a.event.name, version: a.event.version },
      matchId: a.matchId,
      preview,
      previewError,
      currentGrant,
      history: history.slice(0, 20).map((r) => this.grantDto(r, now)),
      historyLimit: 20,
      historyTruncated: history.length > 20,
      capabilities: {
        canIssue: a.manager && (!currentGrant || currentGrant.status === 'EXPIRED'),
        canRotate: a.manager && !!currentGrant,
        canRevoke: a.manager && !!currentGrant,
      },
      serverTime: iso(now),
    };
  }

  async getWorkbench(
    cookie: string | undefined,
    org: string,
    match: string,
  ): Promise<OverlayWorkbenchData> {
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, match, false);
      const current = await this.current(c, a);
      return this.workbench(c, a, current, await this.now(c, a.ctx));
    });
  }

  private async revoke(c: PoolClient, r: Row, now: string, reason: string) {
    await c.query(
      'UPDATE overlay_grants SET version=2,revoked_at=$2::timestamptz,revocation_reason=$3 WHERE id=$1',
      [r.id, now, reason],
    );
  }

  async executeCommand(
    cookie: string | undefined,
    org: string,
    match: string,
    body: unknown,
  ): Promise<OverlayCommandResponse> {
    const input = parseOverlayCommand(body);
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, match, true);
      let current = await this.current(c, a, true);
      const target =
        input.type === 'ISSUE'
          ? null
          : (
              await c.query<Row>(
                'SELECT * FROM overlay_grants WHERE org_id=$1 AND event_id=$2 AND match_id=$3 AND overlay_id=$4 FOR UPDATE',
                [a.ctx.orgId, a.event.id, a.matchId, input.overlayId],
              )
            ).rows[0];
      // Even a target-grant wait must precede the sole TTL/CAS wall-clock sample.
      const now = await this.now(c, a.ctx);
      if (a.event.version !== input.expectedEventVersion)
        throw new ApiError(409, 'VERSION_CONFLICT', '赛事已更新，请重新读取后操作', {
          currentVersion: a.event.version,
        });
      if (input.type === 'ISSUE') {
        if (current && this.grantDto(current, now).status === 'ACTIVE')
          conflict('OVERLAY_ALREADY_ISSUED', '本场已有未到期授权，请使用轮换操作');
        if (current) await this.revoke(c, current, now, 'SUPERSEDED_AFTER_EXPIRY');
      } else {
        if (!target) throw notFound();
        if (!current || target.id !== current.id || target.revoked_at)
          conflict('OVERLAY_GRANT_NOT_CURRENT', '授权已撤销或已被替换，请重新读取');
        if (target.version !== input.expectedGrantVersion)
          throw new ApiError(409, 'OVERLAY_GRANT_VERSION_CONFLICT', '授权已更新，请重新读取', {
            currentVersion: target.version,
          });
        await this.revoke(c, target, now, input.reason);
      }
      let credential: OverlayCommandResponse['credential'] = null;
      if (input.type !== 'REVOKE') {
        const overlayId = newOverlayToken();
        const token = newOverlayToken();
        current = (
          await c.query<Row>(
            `INSERT INTO overlay_grants(id,org_id,event_id,match_id,overlay_id,secret_hash,template,issuer_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,'SCOREBAR_1080P_V1',$7,$8::timestamptz,$8::timestamptz+($9::int*interval '1 minute')) RETURNING *`,
            [
              randomUUID(),
              a.ctx.orgId,
              a.event.id,
              a.matchId,
              overlayId,
              hashOverlayToken(token),
              a.ctx.user.id,
              now,
              input.expiresInMinutes,
            ],
          )
        ).rows[0]!;
        credential = { overlayId, token };
      } else current = null;
      const updated = await c.query<{ version: number }>(
        'UPDATE events SET version=version+1,updated_at=$3::timestamptz WHERE org_id=$1 AND id=$2 RETURNING version',
        [a.ctx.orgId, a.event.id, now],
      );
      a.event.version = updated.rows[0]!.version;
      await this.audit(c, a.ctx.user.id, a.ctx.orgId, `OVERLAY_${input.type}`, 'match', a.matchId, {
        overlayId: credential?.overlayId ?? (input.type === 'REVOKE' ? input.overlayId : null),
        ...(input.type === 'ISSUE' ? {} : { reason: input.reason }),
      });
      return { ...(await this.workbench(c, a, current, now)), credential };
    });
  }

  /** Resolve only opaque scope first, then lock org -> Event -> Grant. No private auth. */
  private async readAccess(c: PoolClient, id: string): Promise<{ grant: Row; eventName: string }> {
    opaqueOverlayId(id);
    const scope = (
      await c.query<Row>('SELECT org_id,event_id FROM overlay_grants WHERE overlay_id=$1', [id])
    ).rows[0];
    if (!scope) throw notFound();
    const org = await c.query(
      "SELECT id FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE",
      [scope.org_id],
    );
    if (!org.rowCount) throw notFound();
    const event = (
      await c.query<Row>('SELECT name FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
        scope.org_id,
        scope.event_id,
      ])
    ).rows[0];
    if (!event) throw notFound();
    const grant = (
      await c.query<Row>(
        'SELECT * FROM overlay_grants WHERE org_id=$1 AND event_id=$2 AND overlay_id=$3 FOR SHARE',
        [scope.org_id, scope.event_id, id],
      )
    ).rows[0];
    if (!grant || grant.revoked_at) throw notFound();
    return { grant, eventName: event.name };
  }

  private async readSession(c: PoolClient, g: Row, token: string | null): Promise<Row | null> {
    if (!token) return null;
    return (
      (
        await c.query<Row>(
          'SELECT * FROM overlay_sessions WHERE org_id=$1 AND event_id=$2 AND match_id=$3 AND grant_id=$4 AND token_hash=$5 FOR SHARE',
          [g.org_id, g.event_id, g.match_id, g.id, hashOverlayToken(token)],
        )
      ).rows[0] ?? null
    );
  }

  async bootstrap(
    id: string,
    body: unknown,
    cookie?: string,
  ): Promise<{ data: OverlayBootstrapData; cookie: string }> {
    const input = parseOverlayBootstrap(body);
    return this.transaction(async (c) => {
      const { grant: g } = await this.readAccess(c, id);
      // Always prove the source secret before considering any dedicated Cookie.
      const expected = Buffer.from(g.secret_hash, 'hex');
      const actual = Buffer.from(hashOverlayToken(input.token), 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw notFound();
      const existingToken = readOverlayCookie(cookie);
      const existing = await this.readSession(c, g, existingToken);
      let now = await this.now(c);
      if (new Date(g.expires_at).getTime() <= Date.parse(now)) throw notFound();
      let token = existingToken;
      if (!existing || new Date(existing.expires_at).getTime() <= Date.parse(now)) {
        token = newOverlayToken();
        const sessionId = randomUUID();
        // Keep the exact PG timestamp: a JS Date round-trip can truncate FK-bound microseconds.
        await c.query(
          'INSERT INTO overlay_sessions(id,org_id,event_id,match_id,grant_id,token_hash,created_at,expires_at) SELECT $1,org_id,event_id,match_id,id,$2,$3::timestamptz,expires_at FROM overlay_grants WHERE id=$4',
          [sessionId, hashOverlayToken(token), now, g.id],
        );
        // Its published-match FK can wait behind an active scorer. Recheck only
        // after that possible wait and compare exact PG instants before commit.
        const fresh = (
          await c.query<{ now: string; valid: boolean }>(
            `WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS now)
             SELECT stamp.now::text AS now,
               (g.expires_at>stamp.now AND s.expires_at>stamp.now) AS valid
             FROM stamp JOIN overlay_grants g ON g.id=$1
             JOIN overlay_sessions s ON s.grant_id=g.id AND s.id=$2`,
            [g.id, sessionId],
          )
        ).rows[0];
        if (!fresh?.valid) throw notFound();
        now = fresh.now;
      }
      return {
        data: { overlayId: id, expiresAt: iso(g.expires_at), serverTime: iso(now) },
        cookie: overlayCookie(token!, id, now, iso(g.expires_at), this.secureCookies),
      };
    });
  }

  async getSnapshot(id: string, cookie?: string): Promise<OverlaySnapshotData> {
    const token = readOverlayCookie(cookie);
    if (!token) throw notFound();
    return this.transaction(async (c) => {
      const { grant: g, eventName } = await this.readAccess(c, id);
      const session = await this.readSession(c, g, token);
      if (!session) throw notFound();
      const row = await this.source(c, g.org_id, g.event_id, g.match_id);
      const now = await this.now(c);
      if (
        new Date(g.expires_at).getTime() <= Date.parse(now) ||
        new Date(session.expires_at).getTime() <= Date.parse(now)
      )
        throw notFound();
      return {
        ...overlayPreview(row, eventName, iso(now)),
        overlayId: g.overlay_id,
        template: g.template,
        expiresAt: iso(g.expires_at),
      };
    });
  }
}
