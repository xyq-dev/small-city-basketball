import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  PlayerPerformanceBatchData,
  PlayerPerformanceCommandInput,
  PlayerPerformanceData,
  PlayerPerformanceLinkData,
  PlayerPerformanceNominateInput,
  PlayerPerformanceSourcesData,
  PlayerPerformanceWorkspaceData,
} from '@small-city-basketball/contracts';
import { ApplicationService, isAdministrator } from '../service.js';
import type { Actor } from '../service.js';
import { forbidden, notFound } from '../errors.js';
import { objectInput, text } from '../validation.js';
import { expectedVersion } from '../registration-validation.js';
import { bookingFail, bookingHash, id } from './domain.js';
import { performanceProjection } from './performance-domain.js';
import type { PerformanceSample } from './performance-domain.js';

type Row = Record<string, any>;
const iso = (value: Date | string | null) => (value == null ? null : new Date(value).toISOString());
const publisherPower = (alias: string) =>
  `EXISTS(SELECT 1 FROM organization_memberships pm WHERE pm.org_id=${alias}.org_id AND pm.user_id=${alias}.nominated_by AND pm.status='ACTIVE' AND (pm.role IN ('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff ps WHERE ps.org_id=${alias}.org_id AND ps.event_id=${alias}.event_id AND ps.user_id=pm.user_id AND ps.status='ACTIVE' AND ps.role='EVENT_MANAGER')))`;
const PUBLIC_SNAPSHOT = `
WITH visible_profiles AS MATERIALIZED (
  SELECT p.id,p.user_id FROM booking_profiles p JOIN users owner ON owner.id=p.user_id AND owner.status='ACTIVE'
  WHERE p.id=ANY($1::uuid[]) AND p.status='APPROVED'
), authorized_links AS MATERIALIZED (
  SELECT l.*,e.name AS event_name,e.format AS event_format
  FROM booking_performance_links l JOIN visible_profiles p ON p.id=l.profile_id AND p.user_id=l.consented_by
  JOIN organizations org ON org.id=l.org_id AND org.status='ACTIVE'
  JOIN events e ON e.org_id=l.org_id AND e.id=l.event_id
  JOIN users publisher ON publisher.id=l.nominated_by AND publisher.status='ACTIVE'
  WHERE l.status='APPROVED' AND l.consented_at IS NOT NULL AND ${publisherPower('l')}
)
SELECT p.id,statement_timestamp() AS as_of,
  (SELECT count(*)::int FROM authorized_links l WHERE l.profile_id=p.id) AS source_count,
  (SELECT count(*)::int FROM booking_appearances a WHERE a.player_user_id=p.user_id AND a.status='COMPLETED') AS completed_service_count,
  COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.starts_at DESC,q.match_id DESC) FROM (
    SELECT l.team_id,l.member_id,l.event_name,l.event_format,m.starts_at,m.id AS match_id,
      to_char(m.starts_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS match_date,
      to_jsonb(m) || jsonb_build_object('state',to_jsonb(s),'confirmation',to_jsonb(cf),'last_event',to_jsonb(le),'last_command',to_jsonb(rc),'scoring_rules',to_jsonb(sr),
        'home_roster',(SELECT jsonb_agg(jsonb_build_object('memberId',rp.member_id,'name',rp.name,'jerseyNo',rp.jersey_no) ORDER BY rp.member_id) FROM entry_roster_players rp WHERE rp.org_id=m.org_id AND rp.entry_id=m.home_entry_id AND rp.revision_id=m.home_roster_revision_id),
        'away_roster',(SELECT jsonb_agg(jsonb_build_object('memberId',rp.member_id,'name',rp.name,'jerseyNo',rp.jersey_no) ORDER BY rp.member_id) FROM entry_roster_players rp WHERE rp.org_id=m.org_id AND rp.entry_id=m.away_entry_id AND rp.revision_id=m.away_roster_revision_id)
      ) AS proof
    FROM authorized_links l JOIN published_matches m ON m.org_id=l.org_id AND m.event_id=l.event_id AND l.team_id IN (m.home_team_id,m.away_team_id)
    LEFT JOIN scoring_states s ON s.org_id=m.org_id AND s.match_id=m.id
    LEFT JOIN result_confirmations cf ON cf.org_id=m.org_id AND cf.match_id=m.id AND cf.id=s.latest_confirmation_id
    LEFT JOIN scoring_events le ON le.org_id=m.org_id AND le.match_id=m.id AND le.seq=s.last_event_seq
    LEFT JOIN scoring_commands rc ON rc.org_id=m.org_id AND rc.match_id=m.id AND rc.actor_id=le.actor_id AND rc.command_id=le.command_id
    LEFT JOIN scoring_rulesets sr ON sr.org_id=m.org_id AND sr.event_id=m.event_id AND sr.id=s.ruleset_id
    WHERE l.profile_id=p.id AND EXISTS(SELECT 1 FROM entry_roster_players rp WHERE rp.org_id=m.org_id AND rp.team_id=l.team_id AND rp.member_id=l.member_id AND ((rp.entry_id=m.home_entry_id AND rp.revision_id=m.home_roster_revision_id) OR (rp.entry_id=m.away_entry_id AND rp.revision_id=m.away_roster_revision_id)))
    ORDER BY m.starts_at DESC,m.id DESC LIMIT 1001
  ) q),'[]'::jsonb) AS samples
FROM visible_profiles p ORDER BY p.id`;

export class PlayerPerformanceService extends ApplicationService {
  private async mayManage(c: PoolClient, actor: Actor, orgId: string, eventId: string) {
    const row = (
      await c.query<Row>(
        `SELECT e.id FROM events e JOIN organizations o ON o.id=e.org_id AND o.status='ACTIVE' JOIN organization_memberships m ON m.org_id=e.org_id AND m.user_id=$3 AND m.status='ACTIVE' WHERE e.org_id=$1 AND e.id=$2 AND (m.role IN ('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff s WHERE s.org_id=e.org_id AND s.event_id=e.id AND s.user_id=$3 AND s.status='ACTIVE' AND s.role='EVENT_MANAGER'))`,
        [orgId, eventId, actor.user.id],
      )
    ).rows[0];
    return Boolean(row);
  }
  private async manager(c: PoolClient, actor: Actor, orgId: string, eventId: string) {
    const org = await this.lockOrganization(c, actor, orgId);
    const event = (
      await c.query<Row>('SELECT * FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
        org.orgId,
        id(eventId),
      ])
    ).rows[0];
    if (!event) throw notFound();
    const staff = (
      await c.query<Row>(
        "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
        [org.orgId, event.id, actor.user.id],
      )
    ).rows[0];
    if (!isAdministrator(org.role) && staff?.role !== 'EVENT_MANAGER') throw notFound();
    return event;
  }
  private async upstream(c: PoolClient, linkId: string) {
    return Boolean(
      (
        await c.query(
          `SELECT l.id FROM booking_performance_links l JOIN booking_profiles p ON p.id=l.profile_id AND p.status='APPROVED' JOIN users owner ON owner.id=p.user_id AND owner.status='ACTIVE' JOIN users publisher ON publisher.id=l.nominated_by AND publisher.status='ACTIVE' JOIN organizations org ON org.id=l.org_id AND org.status='ACTIVE' WHERE l.id=$1 AND ${publisherPower('l')}`,
          [linkId],
        )
      ).rowCount,
    );
  }
  private async link(c: PoolClient, actor: Actor, linkId: string) {
    const l = (
      await c.query<Row>(
        `SELECT l.*,p.user_id AS owner_user_id,p.display_name AS profile_name,e.name AS event_name,t.name AS team_name,tm.name AS member_name FROM booking_performance_links l JOIN booking_profiles p ON p.id=l.profile_id JOIN events e ON e.org_id=l.org_id AND e.id=l.event_id JOIN teams t ON t.org_id=l.org_id AND t.id=l.team_id JOIN team_members tm ON tm.org_id=l.org_id AND tm.team_id=l.team_id AND tm.id=l.member_id WHERE l.id=$1`,
        [id(linkId)],
      )
    ).rows[0];
    if (!l) throw notFound();
    const owns = l.owner_user_id === actor.user.id;
    const manages = await this.mayManage(c, actor, l.org_id, l.event_id);
    if (!owns && !manages) throw notFound();
    return { l, owns, manages };
  }
  private async dto(
    c: PoolClient,
    actor: Actor,
    linkId: string,
  ): Promise<PlayerPerformanceLinkData> {
    const { l, owns, manages } = await this.link(c, actor, linkId);
    const upstream = await this.upstream(c, l.id);
    return {
      id: l.id,
      profileId: l.profile_id,
      profileName: l.profile_name,
      orgId: l.org_id,
      eventId: l.event_id,
      eventName: l.event_name,
      teamId: l.team_id,
      teamName: l.team_name,
      memberId: l.member_id,
      memberName: l.member_name,
      status: l.status,
      version: l.version,
      nominatedByUserId: l.nominated_by,
      consentedAt: iso(l.consented_at),
      revokedAt: iso(l.revoked_at),
      reason: l.revoke_reason ?? l.publisher_reason,
      sourceCurrentlyAvailable: l.status === 'APPROVED' && upstream,
      createdAt: iso(l.created_at)!,
      capabilities: {
        canConsent: owns && l.status === 'PENDING' && upstream,
        canRevoke: (owns || manages) && l.status !== 'REVOKED',
      },
    };
  }
  private async operation(
    c: PoolClient,
    actor: Actor,
    command: string,
    request: unknown,
  ): Promise<Row | null> {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `scb-performance:${actor.user.id}:${command}`,
    ]);
    const hash = bookingHash(request);
    const old = (
      await c.query<Row>(
        'SELECT request_hash,result FROM booking_performance_operations WHERE actor_id=$1 AND command_id=$2',
        [actor.user.id, command],
      )
    ).rows[0];
    if (old) {
      if (old.request_hash !== hash)
        bookingFail('IDEMPOTENCY_CONFLICT', '操作编号已用于不同的数据授权内容');
      if (!old.result) bookingFail('OPERATION_PENDING', '原授权操作结果待核对，请重新读取授权记录');
      return old.result;
    }
    await c.query(
      'INSERT INTO booking_performance_operations(actor_id,command_id,request_hash) VALUES($1,$2,$3)',
      [actor.user.id, command, hash],
    );
    return null;
  }
  private async receipt(c: PoolClient, actor: Actor, command: string, linkId: string) {
    await c.query(
      'UPDATE booking_performance_operations SET result=$3::jsonb WHERE actor_id=$1 AND command_id=$2',
      [actor.user.id, command, JSON.stringify({ linkId })],
    );
  }
  private async sourceMember(
    c: PoolClient,
    orgId: string,
    eventId: string,
    teamId: string,
    memberId: string,
  ) {
    const result = await c.query<Row>(
      `SELECT en.id FROM entries en JOIN entry_roster_players rp ON rp.org_id=en.org_id AND rp.entry_id=en.id AND rp.team_id=en.team_id WHERE en.org_id=$1 AND en.event_id=$2 AND en.team_id=$3 AND rp.member_id=$4 AND (rp.revision_id=en.roster_revision_id OR EXISTS(SELECT 1 FROM published_matches m WHERE m.org_id=en.org_id AND m.event_id=en.event_id AND ((m.home_entry_id=en.id AND m.home_roster_revision_id=rp.revision_id) OR (m.away_entry_id=en.id AND m.away_roster_revision_id=rp.revision_id)))) LIMIT 1 FOR SHARE OF en`,
      [orgId, eventId, teamId, memberId],
    );
    if (!result.rowCount) throw notFound();
  }
  async workspace(cookie: string | undefined): Promise<PlayerPerformanceWorkspaceData> {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const own = (
        await c.query<Row>('SELECT id FROM booking_profiles WHERE user_id=$1', [actor.user.id])
      ).rows[0];
      const events = (
        await c.query<Row>(
          `SELECT e.id,e.org_id,e.name,e.format FROM events e JOIN organizations o ON o.id=e.org_id AND o.status='ACTIVE' JOIN organization_memberships m ON m.org_id=e.org_id AND m.user_id=$1 AND m.status='ACTIVE' WHERE m.role IN ('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff s WHERE s.org_id=e.org_id AND s.event_id=e.id AND s.user_id=$1 AND s.status='ACTIVE' AND s.role='EVENT_MANAGER') ORDER BY e.start_date DESC,e.id LIMIT 200`,
          [actor.user.id],
        )
      ).rows;
      const refs = (
        await c.query<Row>(
          'SELECT id FROM booking_performance_links WHERE profile_id=$1 OR event_id=ANY($2::uuid[]) ORDER BY created_at DESC,id DESC LIMIT 201',
          [own?.id ?? null, events.map((e) => e.id)],
        )
      ).rows;
      const links = [];
      for (const ref of refs.slice(0, 200)) links.push(await this.dto(c, actor, ref.id));
      await this.ensureFreshSession(c, actor);
      return {
        viewerUserId: actor.user.id,
        ownProfileId: own?.id ?? null,
        manageableEvents: events.map((e) => ({
          id: e.id,
          orgId: e.org_id,
          name: e.name,
          format: e.format,
        })),
        links,
        linksHasMore: refs.length > 200,
        disclosureNotice:
          '主办方提名代表允许公开该成员有限统计；只有球员本人再次明确同意才生效。可随时撤销；主办方授权、机构或账号失效时来源停止公开。平台运营身份不替代赛事数据管理权。',
      };
    });
  }
  async sources(cookie: string | undefined, raw: unknown): Promise<PlayerPerformanceSourcesData> {
    const query = objectInput(raw, ['orgId', 'eventId']);
    const orgId = id(query.orgId),
      eventId = id(query.eventId);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const event = await this.manager(c, actor, orgId, eventId);
      const rows = (
        await c.query<Row>(
          `SELECT DISTINCT en.team_id,en.team_name,rp.member_id,rp.name,rp.jersey_no FROM entries en JOIN entry_roster_players rp ON rp.org_id=en.org_id AND rp.entry_id=en.id AND rp.team_id=en.team_id WHERE en.org_id=$1 AND en.event_id=$2 AND (rp.revision_id=en.roster_revision_id OR EXISTS(SELECT 1 FROM published_matches m WHERE m.org_id=en.org_id AND m.event_id=en.event_id AND ((m.home_entry_id=en.id AND m.home_roster_revision_id=rp.revision_id) OR (m.away_entry_id=en.id AND m.away_roster_revision_id=rp.revision_id)))) ORDER BY en.team_id,rp.member_id,rp.name,rp.jersey_no`,
          [orgId, eventId],
        )
      ).rows;
      const teams = new Map<string, PlayerPerformanceSourcesData['teams'][number]>();
      for (const row of rows) {
        let team = teams.get(row.team_id);
        if (!team) {
          team = { id: row.team_id, name: row.team_name, members: [] };
          teams.set(row.team_id, team);
        }
        if (!team.members.some((m) => m.id === row.member_id))
          team.members.push({ id: row.member_id, name: row.name, jerseyNo: row.jersey_no });
      }
      await this.ensureFreshSession(c, actor);
      return {
        event: { id: event.id, orgId: event.org_id, name: event.name, format: event.format },
        teams: [...teams.values()],
      };
    });
  }
  async nominate(cookie: string | undefined, raw: unknown): Promise<PlayerPerformanceLinkData> {
    const v = objectInput(raw, [
      'commandId',
      'profileId',
      'orgId',
      'eventId',
      'teamId',
      'memberId',
      'reason',
      'publisherConsent',
    ]);
    if (v.publisherConsent !== true)
      bookingFail('VALIDATION_ERROR', '主办方须明确允许公开该成员有限比赛统计', 422);
    const input: PlayerPerformanceNominateInput = {
      commandId: id(v.commandId),
      profileId: id(v.profileId),
      orgId: id(v.orgId),
      eventId: id(v.eventId),
      teamId: id(v.teamId),
      memberId: id(v.memberId),
      reason: text(v.reason, 'reason', 2, 500),
      publisherConsent: true,
    };
    try {
      return await this.transaction(async (c) => {
        const actor = await this.lockActor(c, cookie);
        await this.manager(c, actor, input.orgId, input.eventId);
        const replay = await this.operation(c, actor, input.commandId, { op: 'nominate', input });
        if (replay) return this.dto(c, actor, replay.linkId);
        await this.sourceMember(c, input.orgId, input.eventId, input.teamId, input.memberId);
        const profile = (
          await c.query<Row>(
            "SELECT p.id FROM booking_profiles p JOIN users u ON u.id=p.user_id AND u.status='ACTIVE' WHERE p.id=$1 AND p.status='APPROVED' FOR SHARE OF p,u",
            [input.profileId],
          )
        ).rows[0];
        if (!profile) throw notFound();
        const linkId = randomUUID();
        await c.query(
          'INSERT INTO booking_performance_links(id,profile_id,org_id,event_id,team_id,member_id,nominated_by,publisher_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            linkId,
            input.profileId,
            input.orgId,
            input.eventId,
            input.teamId,
            input.memberId,
            actor.user.id,
            input.reason,
          ],
        );
        await this.audit(
          c,
          actor.user.id,
          input.orgId,
          'PERFORMANCE_NOMINATE',
          'performance_link',
          linkId,
          {
            profileId: input.profileId,
            eventId: input.eventId,
            teamId: input.teamId,
            memberId: input.memberId,
            publisherConsent: true,
            reason: input.reason,
          },
        );
        await this.receipt(c, actor, input.commandId, linkId);
        return this.dto(c, actor, linkId);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        bookingFail(
          'PERFORMANCE_LINK_EXISTS',
          '该球员赛事或该名单成员已有待确认/有效授权，请先核对或撤销原授权',
        );
      throw error;
    }
  }
  async command(
    cookie: string | undefined,
    linkId: string,
    raw: unknown,
  ): Promise<PlayerPerformanceLinkData> {
    const v = objectInput(raw, ['commandId', 'expectedVersion', 'type', 'reason', 'playerConsent']);
    if (v.type !== 'CONSENT' && v.type !== 'REVOKE')
      bookingFail('VALIDATION_ERROR', '不支持的数据授权操作', 422);
    if (v.type === 'CONSENT' && v.playerConsent !== true)
      bookingFail('VALIDATION_ERROR', '球员本人须明确同意公开有限比赛统计', 422);
    const input: PlayerPerformanceCommandInput = {
      commandId: id(v.commandId),
      expectedVersion: expectedVersion(v.expectedVersion),
      type: v.type,
      reason: text(v.reason, 'reason', 2, 500),
      ...(v.playerConsent === true ? { playerConsent: true } : {}),
    };
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const context = await this.link(c, actor, id(linkId));
      if (input.type === 'CONSENT' && !context.owns) throw forbidden();
      if (!context.owns) await this.manager(c, actor, context.l.org_id, context.l.event_id);
      const replay = await this.operation(c, actor, input.commandId, {
        op: 'command',
        linkId,
        input,
      });
      if (replay) return this.dto(c, actor, linkId);
      const l = (
        await c.query<Row>('SELECT * FROM booking_performance_links WHERE id=$1 FOR UPDATE', [
          linkId,
        ])
      ).rows[0]!;
      if (l.version !== input.expectedVersion)
        bookingFail('VERSION_CONFLICT', '授权状态已更新，请刷新后确认');
      if (l.status === 'REVOKED' || (input.type === 'CONSENT' && l.status !== 'PENDING'))
        bookingFail('PERFORMANCE_LINK_STATE', '该授权已处理，撤销后须重新提名及同意');
      if (input.type === 'CONSENT') {
        if (!(await this.upstream(c, linkId)))
          bookingFail(
            'PERFORMANCE_SOURCE_UNAVAILABLE',
            '主办方授权或球员资料当前不可用，请先核实来源',
          );
        await c.query(
          "UPDATE booking_performance_links SET status='APPROVED',consented_by=$2,consented_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [linkId, actor.user.id],
        );
      } else
        await c.query(
          "UPDATE booking_performance_links SET status='REVOKED',revoked_by=$2,revoked_at=clock_timestamp(),revoke_reason=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [linkId, actor.user.id, input.reason],
        );
      await this.audit(
        c,
        actor.user.id,
        l.org_id,
        `PERFORMANCE_${input.type}`,
        'performance_link',
        linkId,
        {
          previousStatus: l.status,
          previousVersion: l.version,
          nextStatus: input.type === 'CONSENT' ? 'APPROVED' : 'REVOKED',
          playerConsent: input.type === 'CONSENT',
          reason: input.reason,
        },
      );
      await this.receipt(c, actor, input.commandId, linkId);
      return this.dto(c, actor, linkId);
    });
  }
  async publicBatch(profileIds: string[], peer: string): Promise<PlayerPerformanceBatchData> {
    if (profileIds.length < 1 || profileIds.length > 20)
      bookingFail('VALIDATION_ERROR', '每次最多读取20位球员的公开统计', 422);
    const ids = [...new Set(profileIds.map(id))];
    // No connection is held while this inherited pool-based limiter runs.
    await this.rateLimit(`performance-read:${bookingHash(peer).slice(0, 32)}`, 600, 3600);
    const rows = (await this.pool.query<Row>(PUBLIC_SNAPSHOT, [ids])).rows;
    const players = rows.map((row) => {
      const samples: PerformanceSample[] = row.samples.map((r: Row) => ({
        teamId: r.team_id,
        memberId: r.member_id,
        eventName: r.event_name,
        format: r.event_format,
        date: r.match_date,
        startsAt: iso(r.starts_at)!,
        proof: r.proof,
      }));
      return performanceProjection({
        profileId: row.id,
        sourceCount: row.source_count,
        completedServiceCount: row.completed_service_count,
        samples,
        asOf: iso(row.as_of)!,
        truncated: samples.length > 1000,
      });
    });
    return {
      players,
      unavailableProfileIds: ids.filter(
        (profileId) => !players.some((p) => p.profileId === profileId),
      ),
    };
  }
  async publicOne(profileId: string, peer: string): Promise<PlayerPerformanceData> {
    const result = await this.publicBatch([id(profileId)], peer);
    if (!result.players[0]) throw notFound();
    return result.players[0];
  }
}
