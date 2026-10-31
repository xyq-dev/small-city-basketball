import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  PublicArchiveData,
  PublicArchiveProfileData,
  PublicArchiveSourceData,
  PublicArchiveKind,
} from '@small-city-basketball/contracts';
import { ApplicationService, isAdministrator } from './service.js';
import type { Actor } from './service.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { objectInput, text } from './validation.js';
import {
  archiveCommandInput,
  archiveHash,
  archiveId,
  archiveProjection,
  archiveVersion,
  createArchiveInput,
  MAX_ARCHIVE_MATCHES,
  MAX_ARCHIVE_SOURCES,
  PUBLIC_ARCHIVE_NOTICE,
  publicKey,
} from './public-archives-domain.js';
import type { ArchiveSample } from './public-archives-domain.js';
type Row = Record<string, any>;
const iso = (v: Date | string) => new Date(v).toISOString();
const conflict = (message: string): never => {
  throw new ApiError(409, 'PUBLIC_ARCHIVE_CONFLICT', message);
};
const POWER = `EXISTS(SELECT 1 FROM organization_memberships pm WHERE pm.org_id=g.org_id AND pm.user_id=g.nominated_by AND pm.status='ACTIVE' AND (pm.role IN ('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff es WHERE es.org_id=g.org_id AND es.event_id=g.event_id AND es.user_id=g.nominated_by AND es.status='ACTIVE' AND es.role='EVENT_MANAGER')))`;
// A historical immutable binding remains identity evidence after leaving a team. It grants
// no access itself: publication + exact source consent + current publisher power are all required.
const SOURCE_VALID = `o.status='ACTIVE' AND nu.status='ACTIVE' AND ${POWER} AND ((p.kind='TEAM' AND g.member_id IS NULL AND p.org_id=g.org_id AND p.team_id=g.team_id) OR (p.kind='PLAYER' AND owner.status='ACTIVE' AND g.target_user_id=p.owner_user_id AND b.org_id=g.org_id AND b.team_id=g.team_id AND b.member_id=g.member_id AND b.user_id=p.owner_user_id)) AND EXISTS(SELECT 1 FROM registration_freezes f WHERE f.org_id=g.org_id AND f.event_id=g.event_id AND f.snapshot->'entries' @> jsonb_build_array(jsonb_build_object('teamId',g.team_id::text)) AND (g.member_id IS NULL OR f.snapshot->'entries' @> jsonb_build_array(jsonb_build_object('teamId',g.team_id::text,'players',jsonb_build_array(jsonb_build_object('memberId',g.member_id::text))))))`;
const EFFECTIVE = `g.status='APPROVED' AND g.consented_at IS NOT NULL AND (p.kind='TEAM' OR g.consented_by=p.owner_user_id) AND ${SOURCE_VALID}`;
const SOURCE_SELECT = `SELECT g.*,e.name AS event_name,t.name AS team_name,tm.name AS member_name,(${EFFECTIVE}) AS effective FROM public_archive_sources g JOIN public_archive_profiles p ON p.id=g.profile_id JOIN users owner ON owner.id=p.owner_user_id JOIN organizations o ON o.id=g.org_id JOIN events e ON e.org_id=g.org_id AND e.id=g.event_id JOIN teams t ON t.org_id=g.org_id AND t.id=g.team_id JOIN users nu ON nu.id=g.nominated_by LEFT JOIN team_members tm ON tm.org_id=g.org_id AND tm.team_id=g.team_id AND tm.id=g.member_id LEFT JOIN team_member_bindings b ON b.id=g.binding_id`;
const PROOF = `SELECT g.id AS source_id,g.team_id,g.member_id,e.name AS event_name,to_char(m.starts_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS match_date,
 to_jsonb(m)||jsonb_build_object('state',to_jsonb(s),'confirmation',to_jsonb(cf),'last_event',to_jsonb(le),'last_command',to_jsonb(rc),'scoring_rules',to_jsonb(sr),
 'home_roster',(SELECT jsonb_agg(jsonb_build_object('memberId',rp.member_id,'name',rp.name,'jerseyNo',rp.jersey_no) ORDER BY rp.member_id) FROM entry_roster_players rp WHERE rp.org_id=m.org_id AND rp.entry_id=m.home_entry_id AND rp.revision_id=m.home_roster_revision_id),
 'away_roster',(SELECT jsonb_agg(jsonb_build_object('memberId',rp.member_id,'name',rp.name,'jerseyNo',rp.jersey_no) ORDER BY rp.member_id) FROM entry_roster_players rp WHERE rp.org_id=m.org_id AND rp.entry_id=m.away_entry_id AND rp.revision_id=m.away_roster_revision_id)) AS proof
 FROM public_archive_sources g JOIN public_archive_profiles p ON p.id=g.profile_id JOIN users owner ON owner.id=p.owner_user_id JOIN organizations o ON o.id=g.org_id JOIN events e ON e.org_id=g.org_id AND e.id=g.event_id JOIN users nu ON nu.id=g.nominated_by LEFT JOIN team_member_bindings b ON b.id=g.binding_id
 JOIN published_matches m ON m.org_id=g.org_id AND m.event_id=g.event_id AND g.team_id IN (m.home_team_id,m.away_team_id)
 LEFT JOIN scoring_states s ON s.org_id=m.org_id AND s.match_id=m.id
 LEFT JOIN result_confirmations cf ON cf.org_id=m.org_id AND cf.match_id=m.id AND cf.id=s.latest_confirmation_id
 LEFT JOIN scoring_events le ON le.org_id=m.org_id AND le.match_id=m.id AND le.seq=s.last_event_seq
 LEFT JOIN scoring_commands rc ON rc.org_id=m.org_id AND rc.match_id=m.id AND rc.actor_id=le.actor_id AND rc.command_id=le.command_id
 LEFT JOIN scoring_rulesets sr ON sr.org_id=m.org_id AND sr.id=s.ruleset_id
 WHERE g.profile_id=$1 AND ${EFFECTIVE}
 AND NOT EXISTS(SELECT 1 FROM match_exception_heads h WHERE h.org_id=m.org_id AND h.match_id=m.id AND h.active_request_id IS NOT NULL)
 AND (g.member_id IS NULL OR EXISTS(SELECT 1 FROM entry_roster_players rp WHERE rp.org_id=m.org_id AND rp.team_id=g.team_id AND rp.member_id=g.member_id AND ((rp.entry_id=m.home_entry_id AND rp.revision_id=m.home_roster_revision_id) OR (rp.entry_id=m.away_entry_id AND rp.revision_id=m.away_roster_revision_id))))
 ORDER BY m.starts_at DESC,m.id,g.id LIMIT ${MAX_ARCHIVE_MATCHES + 1}`;
export class PublicArchivesService extends ApplicationService {
  private async snapshotRead<T>(work: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const v = await work(c);
      await c.query('COMMIT');
      return v;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  private async manages(c: PoolClient, actor: Actor, org: string, event?: string) {
    return !!(
      await c.query(
        `SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.org_id AND o.status='ACTIVE' WHERE m.org_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND (m.role IN ('ORG_OWNER','ORG_ADMIN') OR ($3::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM event_staff es WHERE es.org_id=m.org_id AND es.event_id=$3 AND es.user_id=m.user_id AND es.status='ACTIVE' AND es.role='EVENT_MANAGER')))`,
        [org, actor.user.id, event ?? null],
      )
    ).rowCount;
  }
  private async sourceContext(
    c: PoolClient,
    org: string,
    event: string,
    team: string,
    requireActive = true,
  ) {
    const o = await c.query(
      "SELECT id FROM organizations WHERE id=$1 AND (NOT $2::boolean OR status='ACTIVE') FOR SHARE",
      [org, requireActive],
    );
    if (!o.rowCount) throw notFound();
    if (
      !(await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [org, event]))
        .rowCount
    )
      throw notFound();
    if (
      !(await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [org, team]))
        .rowCount
    )
      throw notFound();
  }
  private async profile(c: PoolClient, actor: Actor, id: string, write = false): Promise<Row> {
    let row = (
      await c.query<Row>('SELECT * FROM public_archive_profiles WHERE id=$1', [archiveId(id)])
    ).rows[0];
    if (!row) throw notFound();
    if (row.kind === 'TEAM') {
      const org = await this.lockOrganization(c, actor, row.org_id);
      if (!isAdministrator(org.role)) throw forbidden();
      await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
        row.org_id,
        row.team_id,
      ]);
    } else if (row.owner_user_id !== actor.user.id) throw notFound();
    if (write)
      row = (
        await c.query<Row>('SELECT * FROM public_archive_profiles WHERE id=$1 FOR UPDATE', [id])
      ).rows[0]!;
    return row;
  }
  private async sourceDto(c: PoolClient, actor: Actor, row: Row): Promise<PublicArchiveSourceData> {
    const owns = row.target_user_id === actor.user.id,
      manages = await this.manages(c, actor, row.org_id, row.event_id);
    await this.ensureFreshSession(c, actor);
    return {
      id: row.id,
      profileId: row.profile_id,
      orgId: row.org_id,
      eventId: row.event_id,
      teamId: row.team_id,
      memberId: row.member_id,
      eventName: row.event_name,
      teamName: row.team_name,
      memberName: row.member_name ?? null,
      status: row.status,
      version: row.version,
      reason: row.revoke_reason ?? row.publisher_reason,
      currentlyEffective: row.effective === true,
      canConsent: owns && row.status === 'PENDING' && (await this.sourceUpstream(c, row.id)),
      canRevoke: (owns || manages) && row.status !== 'REVOKED',
    };
  }
  private async profileDto(
    c: PoolClient,
    actor: Actor,
    id: string,
  ): Promise<PublicArchiveProfileData> {
    const p = await this.profile(c, actor, id);
    const rows = (
      await c.query<Row>(
        SOURCE_SELECT +
          " WHERE g.profile_id=$1 AND g.status<>'REVOKED' ORDER BY g.created_at DESC,g.id LIMIT 101",
        [p.id],
      )
    ).rows;
    if (rows.length > 100) conflict('档案有效来源超过安全上限');
    return {
      id: p.id,
      kind: p.kind,
      displayName: p.display_name,
      version: p.version,
      orgId: p.org_id,
      teamId: p.team_id,
      status: p.status,
      publicKey: p.public_key,
      sources: await Promise.all(rows.map((r) => this.sourceDto(c, actor, r))),
    };
  }
  private async sourceUpstream(c: PoolClient, id: string) {
    return !!(await c.query(SOURCE_SELECT + ' WHERE g.id=$1 AND (' + SOURCE_VALID + ')', [id]))
      .rowCount;
  }
  private async operation(c: PoolClient, actor: Actor, command: string, body: unknown) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'public-archive:' + actor.user.id + ':' + command,
    ]);
    const r = (
      await c.query<Row>(
        'SELECT * FROM public_archive_operations WHERE actor_id=$1 AND command_id=$2',
        [actor.user.id, command],
      )
    ).rows[0];
    if (r && r.request_hash !== archiveHash(body)) conflict('同一操作编号已用于不同内容');
    return r;
  }
  private async accepted(
    c: PoolClient,
    actor: Actor,
    command: string,
    body: unknown,
    kind: string,
    target: string,
  ) {
    await c.query(
      'INSERT INTO public_archive_operations(actor_id,command_id,request_hash,target_kind,target_id) VALUES($1,$2,$3,$4,$5)',
      [actor.user.id, command, archiveHash(body), kind, target],
    );
    await this.audit(
      c,
      actor.user.id,
      null,
      'public_archive.' + kind.toLowerCase(),
      'public_archive',
      target,
      { purpose: 'PUBLIC_ARCHIVE', commandId: command, requestHash: archiveHash(body) },
    );
  }
  async workspace(cookie: string | undefined) {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const profiles = (
        await c.query<Row>(
          `SELECT p.id FROM public_archive_profiles p WHERE (p.kind='PLAYER' AND p.owner_user_id=$1) OR (p.kind='TEAM' AND EXISTS(SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.org_id AND o.status='ACTIVE' WHERE m.org_id=p.org_id AND m.user_id=$1 AND m.status='ACTIVE' AND m.role IN ('ORG_OWNER','ORG_ADMIN'))) ORDER BY p.created_at DESC,p.id LIMIT 51`,
          [actor.user.id],
        )
      ).rows;
      const teams = (
        await c.query<Row>(
          "SELECT t.org_id,t.id,t.name FROM teams t JOIN organizations o ON o.id=t.org_id AND o.status='ACTIVE' JOIN organization_memberships m ON m.org_id=t.org_id AND m.user_id=$1 AND m.status='ACTIVE' AND m.role IN ('ORG_OWNER','ORG_ADMIN') ORDER BY t.id LIMIT 201",
          [actor.user.id],
        )
      ).rows;
      const events = (
        await c.query<Row>(
          `SELECT e.org_id,e.id,e.name FROM events e JOIN organizations o ON o.id=e.org_id AND o.status='ACTIVE' JOIN organization_memberships m ON m.org_id=e.org_id AND m.user_id=$1 AND m.status='ACTIVE' WHERE EXISTS(SELECT 1 FROM registration_freezes f WHERE f.org_id=e.org_id AND f.event_id=e.id) AND (m.role IN ('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff es WHERE es.org_id=e.org_id AND es.event_id=e.id AND es.user_id=$1 AND es.status='ACTIVE' AND es.role='EVENT_MANAGER')) ORDER BY e.start_date DESC,e.id LIMIT 201`,
          [actor.user.id],
        )
      ).rows;
      const pending = (
        await c.query<Row>(
          SOURCE_SELECT +
            ` WHERE g.status<>'REVOKED' AND (g.target_user_id=$1 OR EXISTS(SELECT 1 FROM organization_memberships m WHERE m.org_id=g.org_id AND m.user_id=$1 AND m.status='ACTIVE' AND (m.role IN ('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff es WHERE es.org_id=g.org_id AND es.event_id=g.event_id AND es.user_id=$1 AND es.status='ACTIVE' AND es.role='EVENT_MANAGER')))) ORDER BY g.id LIMIT 101`,
          [actor.user.id],
        )
      ).rows;
      await this.ensureFreshSession(c, actor);
      return {
        profiles: await Promise.all(
          profiles.slice(0, 50).map((p) => this.profileDto(c, actor, p.id)),
        ),
        manageableTeams: teams
          .slice(0, 200)
          .map((t) => ({ orgId: t.org_id, id: t.id, name: t.name })),
        manageableEvents: events
          .slice(0, 200)
          .map((e) => ({ orgId: e.org_id, id: e.id, name: e.name })),
        pendingSources: await Promise.all(
          pending.slice(0, 100).map((r) => this.sourceDto(c, actor, r)),
        ),
        optionsTruncated:
          profiles.length > 50 || teams.length > 200 || events.length > 200 || pending.length > 100,
        disclosureNotice: PUBLIC_ARCHIVE_NOTICE,
      };
    });
  }
  async create(cookie: string | undefined, raw: unknown) {
    const input = createArchiveInput(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      if (input.kind === 'TEAM') {
        const org = await this.lockOrganization(c, actor, input.orgId!);
        if (!isAdministrator(org.role)) throw forbidden();
        if (
          !(
            await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
              input.orgId,
              input.teamId,
            ])
          ).rowCount
        )
          throw notFound();
      }
      const old = await this.operation(c, actor, input.commandId, { create: input });
      if (old) return this.profileDto(c, actor, old.target_id);
      const exists = await c.query(
        "SELECT id FROM public_archive_profiles WHERE (kind='PLAYER' AND $1='PLAYER' AND owner_user_id=$2) OR (kind='TEAM' AND $1='TEAM' AND org_id=$3 AND team_id=$4)",
        [input.kind, actor.user.id, input.orgId, input.teamId],
      );
      if (exists.rowCount) conflict('此身份已有独立档案，请读取工作台');
      const id = randomUUID();
      await c.query(
        'INSERT INTO public_archive_profiles(id,kind,owner_user_id,org_id,team_id,display_name) VALUES($1,$2,$3,$4,$5,$6)',
        [id, input.kind, actor.user.id, input.orgId, input.teamId, input.displayName],
      );
      await this.accepted(c, actor, input.commandId, { create: input }, 'PROFILE', id);
      return this.profileDto(c, actor, id);
    });
  }
  async command(cookie: string | undefined, id: string, raw: unknown) {
    id = archiveId(id);
    const input = archiveCommandInput(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const p = await this.profile(c, actor, id, true);
      const old = await this.operation(c, actor, input.commandId, { profileId: id, input });
      if (old) return this.profileDto(c, actor, id);
      if (p.version !== input.expectedVersion) conflict('档案已更新，请重新读取');
      if (input.type === 'PUBLISH') {
        if (p.status === 'PUBLISHED') conflict('档案已经发布');
        const key = randomBytes(32).toString('base64url');
        await c.query(
          'INSERT INTO public_archive_publications(public_key,profile_id,consented_by) VALUES($1,$2,$3)',
          [key, id, actor.user.id],
        );
        await c.query(
          "UPDATE public_archive_profiles SET status='PUBLISHED',public_key=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [id, key],
        );
      } else if (input.type === 'REVOKE') {
        if (p.status !== 'PUBLISHED') conflict('档案当前未发布');
        await c.query(
          "UPDATE public_archive_publications SET status='REVOKED',revoked_at=clock_timestamp() WHERE profile_id=$1 AND status='ACTIVE'",
          [id],
        );
        await c.query(
          "UPDATE public_archive_profiles SET status='REVOKED',public_key=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [id],
        );
      } else
        await c.query(
          'UPDATE public_archive_profiles SET display_name=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
          [id, input.displayName],
        );
      await this.accepted(c, actor, input.commandId, { profileId: id, input }, 'PROFILE', id);
      return this.profileDto(c, actor, id);
    });
  }
  async sources(cookie: string | undefined, org: string, event: string) {
    org = archiveId(org);
    event = archiveId(event);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      await this.lockOrganization(c, actor, org);
      if (!(await this.manages(c, actor, org, event))) throw forbidden();
      const e = (
        await c.query<Row>('SELECT name FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
          org,
          event,
        ])
      ).rows[0];
      if (!e) throw notFound();
      const rows = (
        await c.query<Row>(
          `SELECT DISTINCT t.id,t.name,(rp->>'memberId')::uuid AS member_id,rp->>'name' AS member_name,rp->>'jerseyNo' AS jersey_no,b.user_id,p.id AS profile_id FROM registration_freezes f CROSS JOIN LATERAL jsonb_array_elements(f.snapshot->'entries') en CROSS JOIN LATERAL jsonb_array_elements(en->'players') rp JOIN teams t ON t.org_id=f.org_id AND t.id=(en->>'teamId')::uuid LEFT JOIN team_member_bindings b ON b.org_id=f.org_id AND b.team_id=t.id AND b.member_id=(rp->>'memberId')::uuid LEFT JOIN public_archive_profiles p ON p.kind='PLAYER' AND p.owner_user_id=b.user_id WHERE f.org_id=$1 AND f.event_id=$2 ORDER BY t.id,member_id LIMIT 1201`,
          [org, event],
        )
      ).rows;
      if (rows.length > 1200) conflict('赛事名单超过安全选择上限');
      await this.ensureFreshSession(c, actor);
      return {
        eventName: e.name,
        players: rows
          .filter((r) => r.profile_id)
          .map((r) => ({
            profileId: r.profile_id,
            teamId: r.id,
            teamName: r.name,
            memberId: r.member_id,
            memberName: r.member_name,
            jerseyNo: r.jersey_no,
          })),
        teams: [...new Map(rows.map((r) => [r.id, { teamId: r.id, teamName: r.name }])).values()],
      };
    });
  }
  async nominate(cookie: string | undefined, raw: unknown) {
    const v = objectInput(raw, [
      'commandId',
      'profileId',
      'orgId',
      'eventId',
      'teamId',
      'memberId',
      'publisherConsent',
      'reason',
    ]);
    if (v.publisherConsent !== true)
      throw new ApiError(422, 'VALIDATION_ERROR', '请明确同意公开此精确赛事来源');
    const input = {
      commandId: archiveId(v.commandId),
      profileId: archiveId(v.profileId),
      orgId: archiveId(v.orgId),
      eventId: archiveId(v.eventId),
      teamId: archiveId(v.teamId),
      memberId: v.memberId === null ? null : archiveId(v.memberId),
      publisherConsent: true,
      reason: text(v.reason, 'reason', 4, 500),
    };
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      await this.lockOrganization(c, actor, input.orgId);
      await this.sourceContext(c, input.orgId, input.eventId, input.teamId);
      if (!(await this.manages(c, actor, input.orgId, input.eventId))) throw forbidden();
      const p = (
        await c.query<Row>('SELECT * FROM public_archive_profiles WHERE id=$1 FOR UPDATE', [
          input.profileId,
        ])
      ).rows[0];
      if (!p) throw notFound();
      const old = await this.operation(c, actor, input.commandId, { nominate: input });
      if (old) return this.privateSource(c, actor, old.target_id);
      let binding: Row | undefined;
      if (p.kind === 'PLAYER') {
        if (!input.memberId) conflict('球员来源必须选择精确球员身份');
        binding = (
          await c.query<Row>(
            'SELECT * FROM team_member_bindings WHERE org_id=$1 AND team_id=$2 AND member_id=$3 AND user_id=$4 ORDER BY created_at,id LIMIT 1 FOR SHARE',
            [input.orgId, input.teamId, input.memberId, p.owner_user_id],
          )
        ).rows[0];
        if (!binding) conflict('没有此账号与球员的明确绑定，不能按姓名归档');
      } else if (input.memberId !== null || p.org_id !== input.orgId || p.team_id !== input.teamId)
        conflict('球队来源必须属于档案同一组织与球队');
      const frozen = await c.query(
        `SELECT 1 FROM registration_freezes f WHERE f.org_id=$1 AND f.event_id=$2 AND f.snapshot->'entries' @> jsonb_build_array(jsonb_build_object('teamId',$3::text)) AND ($4::uuid IS NULL OR f.snapshot->'entries' @> jsonb_build_array(jsonb_build_object('teamId',$3::text,'players',jsonb_build_array(jsonb_build_object('memberId',$4::text)))))`,
        [input.orgId, input.eventId, input.teamId, input.memberId],
      );
      if (!frozen.rowCount) conflict('此身份不在本届冻结名单');
      const count = await c.query<Row>(
        "SELECT count(*)::int AS count FROM public_archive_sources WHERE profile_id=$1 AND status<>'REVOKED'",
        [p.id],
      );
      if (count.rows[0]!.count >= MAX_ARCHIVE_SOURCES) conflict('有效授权来源已达100届上限');
      if (
        (
          await c.query(
            "SELECT 1 FROM public_archive_sources WHERE profile_id=$1 AND event_id=$2 AND status<>'REVOKED'",
            [p.id, input.eventId],
          )
        ).rowCount
      )
        conflict('本届已有精确来源，须先撤销后重新选择');
      const id = randomUUID(),
        team = p.kind === 'TEAM';
      await c.query(
        'INSERT INTO public_archive_sources(id,profile_id,org_id,event_id,team_id,member_id,binding_id,target_user_id,nominated_by,publisher_reason,status,consented_by,consented_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $12::uuid IS NULL THEN NULL ELSE clock_timestamp() END)',
        [
          id,
          p.id,
          input.orgId,
          input.eventId,
          input.teamId,
          input.memberId,
          binding?.id ?? null,
          team ? null : p.owner_user_id,
          actor.user.id,
          input.reason,
          team ? 'APPROVED' : 'PENDING',
          team ? actor.user.id : null,
        ],
      );
      await this.accepted(c, actor, input.commandId, { nominate: input }, 'SOURCE', id);
      return this.privateSource(c, actor, id);
    });
  }
  private async privateSource(c: PoolClient, actor: Actor, id: string) {
    const row = (await c.query<Row>(SOURCE_SELECT + ' WHERE g.id=$1', [archiveId(id)])).rows[0];
    if (!row) throw notFound();
    if (
      row.target_user_id !== actor.user.id &&
      !(await this.manages(c, actor, row.org_id, row.event_id))
    )
      throw notFound();
    return this.sourceDto(c, actor, row);
  }
  async sourceCommand(cookie: string | undefined, id: string, raw: unknown) {
    id = archiveId(id);
    const v = objectInput(raw, ['commandId', 'expectedVersion', 'type', 'playerConsent', 'reason']);
    if (!['CONSENT', 'REVOKE'].includes(String(v.type)))
      throw new ApiError(422, 'VALIDATION_ERROR', '无效来源授权操作');
    if (v.type === 'CONSENT' && v.playerConsent !== true)
      throw new ApiError(422, 'VALIDATION_ERROR', '请本人明确同意此PUBLIC_ARCHIVE来源');
    const input = {
      commandId: archiveId(v.commandId),
      expectedVersion: archiveVersion(v.expectedVersion),
      type: String(v.type),
      reason: text(v.reason, 'reason', 4, 500),
      ...(v.type === 'CONSENT' ? { playerConsent: true } : {}),
    };
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const ref = (await c.query<Row>('SELECT * FROM public_archive_sources WHERE id=$1', [id]))
        .rows[0];
      if (!ref) throw notFound();
      await this.sourceContext(
        c,
        ref.org_id,
        ref.event_id,
        ref.team_id,
        !(input.type === 'REVOKE' && ref.target_user_id === actor.user.id),
      );
      await c.query('SELECT id FROM public_archive_profiles WHERE id=$1 FOR UPDATE', [
        ref.profile_id,
      ]);
      const row = (
        await c.query<Row>('SELECT * FROM public_archive_sources WHERE id=$1 FOR UPDATE', [id])
      ).rows[0]!;
      const owns = row.target_user_id === actor.user.id,
        manager = await this.manages(c, actor, row.org_id, row.event_id);
      if (!owns && !manager) throw notFound();
      const old = await this.operation(c, actor, input.commandId, { sourceId: id, input });
      if (old) return this.privateSource(c, actor, id);
      if (row.version !== input.expectedVersion) conflict('来源授权已更新，请重新读取');
      if (input.type === 'CONSENT') {
        if (!owns) throw forbidden();
        if (row.status !== 'PENDING' || !(await this.sourceUpstream(c, id)))
          conflict('来源当前不能授权');
        await c.query(
          "UPDATE public_archive_sources SET status='APPROVED',consented_by=$2,consented_at=clock_timestamp(),version=version+1 WHERE id=$1",
          [id, actor.user.id],
        );
      } else {
        if (row.status === 'REVOKED') conflict('来源已经撤销');
        await c.query(
          "UPDATE public_archive_sources SET status='REVOKED',revoked_at=clock_timestamp(),revoke_reason=$2,version=version+1 WHERE id=$1",
          [id, input.reason],
        );
      }
      await this.accepted(c, actor, input.commandId, { sourceId: id, input }, 'SOURCE', id);
      return this.privateSource(c, actor, id);
    });
  }
  private async projection(c: PoolClient, p: Row, asOf: string): Promise<PublicArchiveData> {
    const sources = await c.query<Row>(
      SOURCE_SELECT + ' WHERE g.profile_id=$1 AND (' + EFFECTIVE + ')',
      [p.id],
    );
    const rows = (await c.query<Row>(PROOF, [p.id])).rows;
    return archiveProjection(
      {
        publicKey: p.public_key,
        kind: p.kind,
        displayName: p.display_name,
        publishedAt: iso(p.consented_at),
      },
      rows.map((r) => ({
        eventName: r.event_name,
        date: r.match_date,
        teamId: r.team_id,
        memberId: r.member_id,
        proof: r.proof,
      })) as ArchiveSample[],
      sources.rowCount ?? 0,
      asOf,
    );
  }
  private async rankingProjections(c: PoolClient, profiles: Row[], asOf: string) {
    if (!profiles.length) return [];
    const ids = profiles.map((p) => p.id);
    const counts = (
      await c.query<Row>(
        'SELECT profile_id,count(*)::int AS count FROM (' +
          SOURCE_SELECT +
          ' WHERE g.profile_id=ANY($1::uuid[]) AND (' +
          EFFECTIVE +
          ')) valid GROUP BY profile_id',
        [ids],
      )
    ).rows;
    const byCount = new Map(counts.map((r) => [r.profile_id, r.count]));
    // One database snapshot and two bounded statements for all ranking candidates. Never
    // rank a truncated subset if the full authorized proof exceeds this request capacity.
    const rows = (
      await c.query<Row>(
        'SELECT requested.id AS profile_id,q.* FROM unnest($1::uuid[]) AS requested(id) CROSS JOIN LATERAL (' +
          PROOF.replace('g.profile_id=$1', 'g.profile_id=requested.id') +
          ') q LIMIT 5001',
        [ids],
      )
    ).rows;
    if (rows.length > 5000)
      throw new ApiError(
        503,
        'ARCHIVE_RANKING_CAPACITY',
        '完整榜单来源超过本次计算容量，暂不提供部分榜单',
      );
    const grouped = new Map<string, ArchiveSample[]>();
    for (const r of rows) {
      const list = grouped.get(r.profile_id) ?? [];
      list.push({
        eventName: r.event_name,
        date: r.match_date,
        teamId: r.team_id,
        memberId: r.member_id,
        proof: r.proof,
      });
      grouped.set(r.profile_id, list);
    }
    return profiles.map((p) =>
      archiveProjection(
        {
          publicKey: p.public_key,
          kind: p.kind,
          displayName: p.display_name,
          publishedAt: iso(p.consented_at),
        },
        grouped.get(p.id) ?? [],
        byCount.get(p.id) ?? 0,
        asOf,
      ),
    );
  }
  async publicOne(key: string, peer: string) {
    key = publicKey(key);
    await this.rateLimit('public-archive:' + archiveHash(peer).slice(0, 32), 600, 3600);
    return this.snapshotRead(async (c) => {
      const p = (
        await c.query<Row>(
          `SELECT p.*,k.consented_at FROM public_archive_profiles p JOIN public_archive_publications k ON k.profile_id=p.id AND k.public_key=p.public_key AND k.status='ACTIVE' JOIN users u ON u.id=p.owner_user_id LEFT JOIN organizations o ON o.id=p.org_id WHERE p.public_key=$1 AND p.status='PUBLISHED' AND ((p.kind='PLAYER' AND u.status='ACTIVE') OR (p.kind='TEAM' AND o.status='ACTIVE'))`,
          [key],
        )
      ).rows[0];
      if (!p) throw notFound();
      const at = (await c.query<Row>('SELECT statement_timestamp() AS now')).rows[0]!.now;
      return this.projection(c, p, iso(at));
    });
  }
  async rankings(raw: unknown, peer: string) {
    const q = objectInput(raw, ['kind']);
    if (q.kind !== 'PLAYER' && q.kind !== 'TEAM')
      throw new ApiError(422, 'VALIDATION_ERROR', '请选择球员或球队榜单');
    await this.rateLimit('public-archive-rank:' + archiveHash(peer).slice(0, 32), 60, 3600);
    return this.snapshotRead(async (c) => {
      const profiles = (
        await c.query<Row>(
          `SELECT p.*,k.consented_at FROM public_archive_profiles p JOIN public_archive_publications k ON k.profile_id=p.id AND k.public_key=p.public_key AND k.status='ACTIVE' JOIN users u ON u.id=p.owner_user_id LEFT JOIN organizations o ON o.id=p.org_id WHERE p.kind=$1 AND p.status='PUBLISHED' AND ((p.kind='PLAYER' AND u.status='ACTIVE') OR (p.kind='TEAM' AND o.status='ACTIVE')) ORDER BY p.id LIMIT 1001`,
          [q.kind],
        )
      ).rows;
      if (profiles.length > 1000)
        throw new ApiError(
          503,
          'ARCHIVE_RANKING_CAPACITY',
          '公开档案数量超过本次完整计算容量，榜单暂不可用',
        );
      const asOf = iso((await c.query<Row>('SELECT statement_timestamp() AS now')).rows[0]!.now);
      const data: PublicArchiveData[] = (await this.rankingProjections(c, profiles, asOf)).filter(
        (d) =>
          d.recordedMatchCount &&
          d.invalidMatchCount === 0 &&
          (d.kind === 'TEAM' ||
            (d.teamOnlyMatchCount === 0 && d.attributionIncompleteMatchCount === 0)),
      );
      data.sort(
        (a, b) =>
          (b.pointsPerRecordedMatch ?? -1) - (a.pointsPerRecordedMatch ?? -1) ||
          (b.points ?? -1) - (a.points ?? -1) ||
          a.publicKey.localeCompare(b.publicKey),
      );
      let rank = 0,
        prior: string | null = null;
      return {
        kind: q.kind as PublicArchiveKind,
        asOf,
        entries: data.slice(0, 50).map((archive, i) => {
          const score = String(archive.pointsPerRecordedMatch) + ':' + archive.points;
          if (score !== prior) rank = i + 1;
          prior = score;
          return { rank, archive };
        }),
        notice:
          '公开跨届榜单按已授权的逐人／球队有效确认样本场均得分、总分排序；并列保留相同名次。展示前50名；个人榜排除未逐人采集或归属不完整的档案。不把未公开、未授权、未确认、行政结果或来源异常的档案填零参评。',
      };
    });
  }
}
