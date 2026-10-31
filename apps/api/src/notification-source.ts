import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { NotificationKind } from '../../../packages/contracts/notifications.js';
import { notificationHash, notificationKind } from './notification-domain.js';
import { resourceId } from './validation.js';
export interface NotificationSourceInput {
  kind: NotificationKind;
  orgId: string;
  eventId: string;
  resourceId: string;
}
export interface ResolvedNotificationSource extends NotificationSourceInput {
  fingerprint: string;
  title: string;
  detail: string;
  eventName: string;
  time: string;
  location: string | null;
  dueAt: Date;
  expiresAt: Date;
  teamIds: string[];
}
type Row = Record<string, any>;
/** Same authoritative source resolver is used at capture, inbox read, fanout and every send. */
export async function resolveNotificationSource(
  c: PoolClient,
  input: NotificationSourceInput,
  leadMinutes = 15,
): Promise<ResolvedNotificationSource | null> {
  notificationKind(input.kind);
  for (const id of [input.orgId, input.eventId, input.resourceId]) resourceId(id);
  if (!Number.isInteger(leadMinutes) || leadMinutes < 1 || leadMinutes > 120)
    throw new Error('Invalid notification lead time');
  const e = (
    await c.query<Row>(
      `SELECT e.name,e.status,clock_timestamp() AS now FROM organizations o JOIN events e ON e.org_id=o.id
     WHERE o.id=$1 AND e.id=$2 AND o.status='ACTIVE' AND e.status<>'CANCELLED' FOR SHARE OF o,e`,
      [input.orgId, input.eventId],
    )
  ).rows[0];
  if (!e) return null;
  const now = new Date(e.now);
  if (input.kind === 'REGISTRATION_REVIEW') {
    const entry = (
      await c.query<Row>(
        `SELECT n.id,n.team_id,n.status,h.id AS review_id,h.command,h.created_at AS reviewed_at FROM entries n
       JOIN LATERAL(SELECT id,command,created_at FROM entry_review_history WHERE org_id=n.org_id AND entry_id=n.id
         ORDER BY created_at DESC,id DESC LIMIT 1) h ON true
       WHERE n.org_id=$1 AND n.event_id=$2 AND n.id=$3 FOR SHARE OF n`,
        [input.orgId, input.eventId, input.resourceId],
      )
    ).rows[0];
    const statuses: Record<string, string> = {
      APPROVE: 'APPROVED',
      REQUEST_CHANGES: 'CHANGES_REQUESTED',
      REJECT: 'REJECTED',
    };
    if (!entry || statuses[entry.command] !== entry.status) return null;
    const detail = {
      APPROVED: '报名审核通过',
      CHANGES_REQUESTED: '报名需要补充资料',
      REJECTED: '报名审核未通过',
    }[entry.status as string];
    if (!detail) return null;
    return {
      ...input,
      fingerprint: notificationHash([input.kind, entry.id, entry.review_id, entry.status]),
      title: '报名审核更新',
      location: null,
      detail,
      eventName: e.name,
      time: new Date(entry.reviewed_at).toISOString(),
      dueAt: now,
      expiresAt: new Date(now.getTime() + 7 * 86400000),
      teamIds: [entry.team_id],
    };
  }
  if (!['SCHEDULED', 'RUNNING'].includes(e.status)) return null;
  const m = (
    await c.query<Row>(
      `SELECT m.id,m.status,m.starts_at,m.court_id,m.court_name,m.home_team_id,m.away_team_id,
      r.id AS reschedule_id,r.new_starts_at,r.new_court_id
     FROM published_matches m LEFT JOIN LATERAL(SELECT id,new_starts_at,new_court_id FROM match_reschedules
       WHERE org_id=m.org_id AND match_id=m.id ORDER BY to_match_version DESC LIMIT 1) r ON true
     WHERE m.org_id=$1 AND m.event_id=$2 AND m.id=$3 FOR SHARE OF m`,
      [input.orgId, input.eventId, input.resourceId],
    )
  ).rows[0];
  if (!m || !['SCHEDULED', 'READY'].includes(m.status)) return null;
  const exception = (
    await c.query<Row>(
      'SELECT version,active_request_id FROM match_exception_heads WHERE org_id=$1 AND event_id=$2 AND match_id=$3 FOR SHARE',
      [input.orgId, input.eventId, input.resourceId],
    )
  ).rows[0];
  // An approved cancellation/forfeit retains SCHEDULED in the physical match row.
  // Reinstatement changes the head version and creates a fresh notification generation.
  if (exception?.active_request_id) return null;
  const startsAt = new Date(m.starts_at);
  if (startsAt <= now) return null;
  if (
    input.kind === 'MATCH_RESCHEDULED' &&
    (!m.reschedule_id ||
      new Date(m.new_starts_at).getTime() !== startsAt.getTime() ||
      m.new_court_id !== m.court_id)
  )
    return null;
  const plan = [
    m.id,
    m.reschedule_id ?? null,
    startsAt.toISOString(),
    m.court_id,
    exception?.version ?? 0,
  ];
  const dueAt =
    input.kind === 'MATCH_STARTING' ? new Date(startsAt.getTime() - leadMinutes * 60000) : now;
  return {
    ...input,
    fingerprint: notificationHash([
      input.kind,
      ...plan,
      input.kind === 'MATCH_STARTING' ? leadMinutes : null,
    ]),
    location: typeof m.court_name === 'string' ? m.court_name : '待定',
    title: input.kind === 'MATCH_STARTING' ? '比赛即将开始' : '比赛安排已更新',
    detail:
      input.kind === 'MATCH_STARTING'
        ? '请按当前赛程准备参赛或观赛'
        : '请打开消息核对最新时间与场地',
    eventName: e.name,
    time: startsAt.toISOString(),
    dueAt,
    expiresAt: startsAt,
    teamIds: [m.home_team_id, m.away_team_id],
  };
}
/** Locks the exact currently effective relation before disclosing or externally sending content. */
export async function notificationRecipientAllowed(
  c: PoolClient,
  source: ResolvedNotificationSource,
  userId: string,
): Promise<boolean> {
  const manager = await c.query(
    `SELECT user_id FROM organization_memberships WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE'
     AND role IN('ORG_OWNER','ORG_ADMIN') FOR SHARE`,
    [source.orgId, userId],
  );
  if (manager.rowCount) return true;
  const staff = await c.query(
    `SELECT s.user_id FROM event_staff s JOIN organization_memberships m ON m.org_id=s.org_id AND m.user_id=s.user_id WHERE s.org_id=$1 AND s.event_id=$2 AND s.user_id=$3 AND s.status='ACTIVE' AND m.status='ACTIVE' FOR SHARE OF s,m`,
    [source.orgId, source.eventId, userId],
  );
  if (staff.rowCount) return true;
  for (const team of [...source.teamIds].sort()) {
    const t = await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
      source.orgId,
      team,
    ]);
    if (!t.rowCount) continue;
    const grant = await c.query(
      `SELECT user_id FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE`,
      [source.orgId, team, userId],
    );
    if (grant.rowCount) return true;
  }
  if (source.kind === 'REGISTRATION_REVIEW') return false;
  const follow = await c.query(
    `SELECT f.id FROM event_follows f JOIN public_event_publications p ON p.org_id=f.org_id
      AND p.event_id=f.event_id AND p.id=f.publication_id
     WHERE f.org_id=$1 AND f.event_id=$2 AND f.user_id=$3 AND f.status='ACTIVE'
      AND p.revoked_at IS NULL AND p.purpose='LIVE' FOR SHARE OF f,p`,
    [source.orgId, source.eventId, userId],
  );
  return !!follow.rowCount;
}
/** Called only from an already authorized business transaction, never an HTTP client payload. */
export async function captureNotification(
  c: PoolClient,
  input: NotificationSourceInput,
  leadMinutes = 15,
  refreshRecipients = true,
) {
  const source = await resolveNotificationSource(c, input, leadMinutes);
  if (!source) return null;
  const proposed = randomUUID();
  const result = await c.query<{ id: string }>(
    `INSERT INTO notification_source_events(id,org_id,event_id,kind,resource_id,source_fingerprint,due_at,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(org_id,kind,resource_id,source_fingerprint) DO NOTHING RETURNING id`,
    [
      proposed,
      input.orgId,
      input.eventId,
      input.kind,
      input.resourceId,
      source.fingerprint,
      source.dueAt,
      source.expiresAt,
    ],
  );
  const id =
    result.rows[0]?.id ??
    (
      await c.query<{ id: string }>(
        'SELECT id FROM notification_source_events WHERE org_id=$1 AND kind=$2 AND resource_id=$3 AND source_fingerprint=$4',
        [input.orgId, input.kind, input.resourceId, source.fingerprint],
      )
    ).rows[0]!.id;
  await c.query(
    refreshRecipients
      ? `INSERT INTO notification_fanout_state(source_id) VALUES($1)
     ON CONFLICT(source_id) DO UPDATE SET cursor_user_id=NULL,done=false
     WHERE notification_fanout_state.done=true`
      : 'INSERT INTO notification_fanout_state(source_id) VALUES($1) ON CONFLICT DO NOTHING',
    [id],
  );
  return id;
}
/** Root hooks publish/new-round and reschedule transactions here; DB timestamps determine due work. */
export async function captureEventMatchNotifications(
  c: PoolClient,
  orgId: string,
  eventId: string,
  leadMinutes = 15,
) {
  resourceId(orgId);
  resourceId(eventId);
  const matches = await c.query<{ id: string }>(
    `SELECT id FROM published_matches WHERE org_id=$1 AND event_id=$2 AND status IN('SCHEDULED','READY')
     AND starts_at>clock_timestamp() ORDER BY starts_at,id LIMIT 1000`,
    [orgId, eventId],
  );
  for (const match of matches.rows)
    await captureNotification(
      c,
      { kind: 'MATCH_STARTING', orgId, eventId, resourceId: match.id },
      leadMinutes,
    );
}
/** Keyset fanout keeps a popular public event from enlarging the original business transaction. */
export async function notificationRecipientPage(
  c: PoolClient,
  source: ResolvedNotificationSource,
  cursor?: string,
) {
  const r = await c.query<{ user_id: string }>(
    `SELECT user_id FROM (
      SELECT user_id FROM organization_memberships WHERE org_id=$1 AND status='ACTIVE' AND role IN('ORG_OWNER','ORG_ADMIN')
      UNION SELECT user_id FROM event_staff WHERE org_id=$1 AND event_id=$2 AND status='ACTIVE'
      UNION SELECT user_id FROM team_access_grants WHERE org_id=$1 AND team_id=ANY($3::uuid[]) AND status='ACTIVE'
      UNION SELECT f.user_id FROM event_follows f JOIN public_event_publications p ON p.id=f.publication_id
        WHERE $5::boolean AND f.org_id=$1 AND f.event_id=$2 AND f.status='ACTIVE' AND p.revoked_at IS NULL AND p.purpose='LIVE'
    ) x WHERE ($4::uuid IS NULL OR user_id>$4::uuid) ORDER BY user_id LIMIT 100`,
    [
      source.orgId,
      source.eventId,
      source.teamIds,
      cursor ?? null,
      source.kind !== 'REGISTRATION_REVIEW',
    ],
  );
  return r.rows.map((x) => x.user_id);
}
