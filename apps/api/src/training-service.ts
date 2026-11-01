import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  TrainingCohortData,
  TrainingEnrollmentData,
  TrainingMakeupOptionsData,
} from '../../../packages/contracts/training.js';
import { ApplicationService, isAdministrator } from './service.js';
import type { Actor, ApiOptions } from './service.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { objectInput, text } from './validation.js';
import { expectedVersion } from './registration-validation.js';
import { lockTradeSourceCalendar } from './trade-source-hooks.js';
import {
  allocateTrainingPrice,
  parseTrainingAction,
  parseTrainingCohort,
  trainingCanConfirm,
  trainingCommand,
  trainingFail,
  trainingHash,
  trainingId,
  trainingTime,
  trainingVersion,
} from './training-domain.js';
import type { TrainingOptions } from './training-source-hooks.js';
import { trainingCohortCompletionBlocker } from './training-cohort-completion.js';
type Row = Record<string, any>;
const iso = (x: Date | string | null) => (x === null ? null : new Date(x).toISOString());
/** Adult short-course workflow. All inventory and monetary source mutations share the calendar lock. */
export class TrainingService extends ApplicationService {
  constructor(
    pool: Pool,
    options: ApiOptions,
    readonly training: TrainingOptions = {},
  ) {
    super(pool, options);
  }
  capabilities() {
    return {
      enabled: this.training.enabled === true,
      paidEnrollmentEnabled: !!this.training.trade,
      adultOnly: true,
      youthEnrollmentEnabled: false,
      packagesEnabled: false,
    };
  }
  private async enabled(c: PoolClient) {
    if (!this.training.enabled) trainingFail('TRAINING_DISABLED', '培训尚未开放', 503);
    if (
      (
        await c.query(
          "SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore' LIMIT 1",
        )
      ).rowCount
    )
      trainingFail('RESTORE_QUARANTINE', '恢复副本尚未解除隔离', 503);
  }
  private async manager(c: PoolClient, a: Actor, org: string) {
    const x = await this.lockOrganization(c, a, org);
    if (!isAdministrator(x.role)) throw forbidden();
  }
  private async operator(c: PoolClient, a: Actor) {
    if (
      !(
        await c.query(
          "SELECT p.user_id FROM platform_operators p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND p.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF u",
          [a.user.id],
        )
      ).rowCount
    )
      throw forbidden();
  }
  private async managed(c: PoolClient, a: Actor, org: string) {
    try {
      await this.manager(c, a, org);
      return true;
    } catch (e) {
      if (e instanceof ApiError && [403, 404].includes(e.status)) return false;
      throw e;
    }
  }
  private async receipt(
    c: PoolClient,
    a: Actor,
    id: string,
    input: unknown,
    work: () => Promise<Row>,
  ) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `training:${a.user.id}:${id}`,
    ]);
    const hash = trainingHash(input);
    const old = (
      await c.query(
        'SELECT request_hash,result FROM training_command_receipts WHERE actor_id=$1 AND command_id=$2',
        [a.user.id, id],
      )
    ).rows[0];
    if (old) {
      if (old.request_hash !== hash)
        trainingFail('COMMAND_ID_REUSED', '原操作编号不可用于不同内容');
      return old.result;
    }
    const r = await work();
    await c.query(
      'INSERT INTO training_command_receipts(actor_id,command_id,request_hash,result) VALUES($1,$2,$3,$4)',
      [a.user.id, id, hash, r],
    );
    return r;
  }
  private async write(
    cookie: string | undefined,
    orgId: string,
    fn: (c: PoolClient, a: Actor) => Promise<Row>,
    allowClosed = false,
  ) {
    try {
      return await this.transaction(async (c) => {
        const a = await this.lockActor(c, cookie);
        await lockTradeSourceCalendar(c, orgId);
        if (!allowClosed) await this.enabled(c);
        else if (
          (
            await c.query(
              "SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore' LIMIT 1",
            )
          ).rowCount
        )
          trainingFail('RESTORE_QUARANTINE', '恢复副本尚未解除隔离', 503);
        await c.query('SELECT x12_release_expired()');
        await c.query(
          "UPDATE training_resource_reservations r SET active=false FROM training_enrollments n WHERE r.enrollment_id=n.id AND r.active AND n.state='HOLDING' AND n.hold_expires_at<=clock_timestamp()",
        );
        const r = await fn(c, a);
        await this.ensureFreshSession(c, a);
        return r;
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23P01')
        trainingFail('TRAINING_SCHEDULE_CONFLICT', '人物或场地已有重叠安排，请选择其他课次');
      if (code === '23505') trainingFail('TRAINING_DUPLICATE', '已有相同的有效记录，请刷新后核对');
      if (code === '23503') throw notFound();
      throw error;
    }
  }
  private async log(
    c: PoolClient,
    a: Actor,
    org: string,
    id: string,
    action: string,
    details: Row = {},
  ) {
    await c.query(
      'INSERT INTO training_audit_events(id,org_id,actor_id,resource_id,action,details) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), org, a.user.id, id, action, details],
    );
  }
  private async ref(
    table:
      | 'training_cohorts'
      | 'training_enrollments'
      | 'training_coaches'
      | 'training_consumptions'
      | 'training_refund_allocations'
      | 'training_sessions',
    id: string,
  ) {
    const r = (await this.pool.query(`SELECT org_id FROM ${table} WHERE id=$1`, [trainingId(id)]))
      .rows[0];
    if (!r) throw notFound();
    return r.org_id as string;
  }
  private async cohort(c: PoolClient, id: string, lock = false) {
    const r = (
      await c.query(
        `SELECT h.*,co.description,clock_timestamp() AS db_now FROM training_cohorts h JOIN training_courses co ON co.id=h.course_id AND co.org_id=h.org_id WHERE h.id=$1 ${lock ? 'FOR UPDATE OF h' : ''}`,
        [trainingId(id)],
      )
    ).rows[0];
    if (!r) throw notFound();
    return r;
  }
  private async eligible(c: PoolClient, h: Row) {
    const p = (
      await c.query(
        "SELECT 1 FROM training_providers p JOIN organizations o ON o.id=p.org_id WHERE p.org_id=$1 AND p.status='APPROVED' AND p.qualified_until>(SELECT max(ends_at) FROM training_sessions WHERE cohort_id=$2) AND o.status='ACTIVE' FOR SHARE OF p,o",
        [h.org_id, h.id],
      )
    ).rowCount;
    const court = (
      await c.query(
        "SELECT 1 FROM courts WHERE org_id=$1 AND id=$2 AND status='ACTIVE' FOR SHARE",
        [h.org_id, h.court_id],
      )
    ).rowCount;
    const bad = (
      await c.query(
        "SELECT 1 FROM training_session_coaches sc JOIN training_sessions s ON s.id=sc.session_id JOIN training_coaches t ON t.id=sc.coach_id JOIN users u ON u.id=t.user_id WHERE s.cohort_id=$1 AND (t.status<>'APPROVED' OR NOT t.consented OR t.qualified_until<s.ends_at OR u.status<>'ACTIVE') LIMIT 1",
        [h.id],
      )
    ).rowCount;
    return !!p && !!court && !bad;
  }
  private async resumeBlocker(c: PoolClient, h: Row): Promise<string | null> {
    if (h.state !== 'SUSPENDED') return '只有暂停班期可以恢复';
    if (!this.training.enabled) return '培训服务尚未开放';
    if (
      !(await c.query('SELECT 1 FROM training_sessions WHERE cohort_id=$1 LIMIT 1', [h.id]))
        .rowCount
    )
      return '缺少原班期课次记录';
    if (
      (
        await c.query(
          "SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore' LIMIT 1",
        )
      ).rowCount
    )
      return '恢复副本尚未解除隔离';
    if (
      !(
        await c.query(
          `SELECT 1 FROM training_providers p JOIN organizations o ON o.id=p.org_id
          JOIN courts court ON court.org_id=p.org_id AND court.id=$3
          WHERE p.org_id=$1 AND p.status='APPROVED' AND o.status='ACTIVE' AND court.status='ACTIVE'
          AND p.qualified_until>greatest(clock_timestamp(),(SELECT max(ends_at) FROM training_sessions WHERE cohort_id=$2 AND state='SCHEDULED'))
          FOR SHARE OF p,o,court`,
          [h.org_id, h.id, h.court_id],
        )
      ).rowCount
    )
      return '机构、场地或剩余课次的资质未满足';
    if (
      (
        await c.query(
          `SELECT 1 FROM training_sessions s WHERE s.cohort_id=$1 AND s.state='SCHEDULED' AND (
          NOT EXISTS(SELECT 1 FROM training_session_coaches sc WHERE sc.session_id=s.id) OR EXISTS(
            SELECT 1 FROM training_session_coaches sc JOIN training_coaches t ON t.id=sc.coach_id JOIN users u ON u.id=t.user_id
            WHERE sc.session_id=s.id AND (t.status<>'APPROVED' OR NOT t.consented OR u.status<>'ACTIVE' OR t.qualified_until<=greatest(clock_timestamp(),s.ends_at)))) LIMIT 1`,
          [h.id],
        )
      ).rowCount
    )
      return '剩余课次的教练资格或本人确认未满足';
    if (
      (
        await c.query(
          `SELECT 1 FROM training_consumptions x JOIN training_lesson_entitlements e ON e.id=x.entitlement_id
          JOIN training_enrollments n ON n.id=e.enrollment_id JOIN training_sessions s ON s.id=e.current_session_id
          WHERE (n.cohort_id=$1 OR s.cohort_id=$1) AND x.status IN('PROPOSED','REVIEWED','DISPUTED') LIMIT 1`,
          [h.id],
        )
      ).rowCount
    )
      return '仍有待确认消费或未独立裁决的异议';
    // RESUME never recreates reservations. Live protected windows need their original active
    // court/coach rows; ended windows may use immutable released history for delayed delivery.
    if (
      (
        await c.query(
          `SELECT 1 FROM training_sessions s CROSS JOIN LATERAL (
            SELECT 'court:'||$2::text AS resource_key UNION ALL
            SELECT 'user:'||t.user_id::text FROM training_session_coaches sc JOIN training_coaches t ON t.id=sc.coach_id WHERE sc.session_id=s.id
          ) expected WHERE s.cohort_id=$1 AND s.state='SCHEDULED' AND NOT EXISTS(
            SELECT 1 FROM training_resource_reservations r WHERE r.org_id=s.org_id AND r.session_id=s.id
            AND r.resource_key=expected.resource_key AND r.enrollment_id IS NULL
            AND r.starts_at=s.starts_at-s.buffer_minutes*interval '1 minute'
            AND r.ends_at=s.ends_at+s.buffer_minutes*interval '1 minute'
            AND (r.active OR r.ends_at<=clock_timestamp())) LIMIT 1`,
          [h.id, h.court_id],
        )
      ).rowCount
    )
      return '原发布的场地或教练占位证明不完整';
    return null;
  }
  private async expire(c: PoolClient, id: string) {
    await c.query(
      "UPDATE training_enrollments SET state='EXPIRED',version=version+1 WHERE cohort_id=$1 AND state='HOLDING' AND hold_expires_at<=clock_timestamp() AND trade_order_id IS NULL",
      [id],
    );
  }
  private async seats(c: PoolClient, id: string) {
    return Number(
      (
        await c.query(
          "SELECT count(*)::int AS n FROM training_enrollments WHERE cohort_id=$1 AND (state='CONFIRMED' OR (state='HOLDING' AND hold_expires_at>clock_timestamp()))",
          [id],
        )
      ).rows[0]!.n,
    );
  }
  async registerProvider(cookie: string | undefined, orgId: string, raw: unknown) {
    orgId = trainingId(orgId);
    const v = objectInput(raw, ['commandId', 'name', 'evidenceReference', 'qualifiedUntil']);
    const commandId = trainingCommand(v.commandId),
      name = text(v.name, 'name', 1, 80),
      evidence = text(v.evidenceReference, 'evidenceReference', 1, 120),
      until = trainingTime(v.qualifiedUntil);
    return this.write(cookie, orgId, async (c, a) => {
      await this.manager(c, a, orgId);
      return this.receipt(c, a, commandId, { op: 'REGISTER_PROVIDER', orgId, ...v }, async () => {
        if (Date.parse(until) <= Date.now()) trainingFail('QUALIFICATION_EXPIRED', '资质已过期');
        if ((await c.query('SELECT 1 FROM training_providers WHERE org_id=$1', [orgId])).rowCount)
          trainingFail('PROVIDER_EXISTS', '该机构已有培训主体');
        await c.query(
          'INSERT INTO training_providers(org_id,name,evidence_reference,qualified_until,created_by) VALUES($1,$2,$3,$4,$5)',
          [orgId, name, evidence, until, a.user.id],
        );
        await this.log(c, a, orgId, orgId, 'PROVIDER_SUBMITTED');
        return { orgId };
      });
    });
  }
  async providerCommand(cookie: string | undefined, orgId: string, raw: unknown) {
    orgId = trainingId(orgId);
    const v = parseTrainingAction(raw, ['APPROVE', 'REJECT', 'SUSPEND']);
    return this.write(
      cookie,
      orgId,
      async (c, a) => {
        await this.operator(c, a);
        return this.receipt(c, a, v.commandId, { op: 'PROVIDER', orgId, ...v }, async () => {
          const p = (
            await c.query('SELECT * FROM training_providers WHERE org_id=$1 FOR UPDATE', [orgId])
          ).rows[0];
          if (!p) throw notFound();
          trainingVersion(p.version, v.expectedVersion);
          if (p.created_by === a.user.id) throw forbidden();
          if (!v.reason) trainingFail('REASON_REQUIRED', '请填写审核依据');
          if (v.action === 'APPROVE' && new Date(p.qualified_until) <= new Date())
            trainingFail('QUALIFICATION_EXPIRED', '资质已过期');
          const state = (
            { APPROVE: 'APPROVED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED' } as Record<
              string,
              string
            >
          )[v.action];
          await c.query(
            'UPDATE training_providers SET status=$2,reviewed_by=$3,version=version+1 WHERE org_id=$1',
            [orgId, state, a.user.id],
          );
          await this.log(c, a, orgId, orgId, 'PROVIDER_' + v.action, { reason: v.reason });
          return { orgId };
        });
      },
      v.action === 'SUSPEND',
    );
  }
  async addCoach(cookie: string | undefined, orgId: string, raw: unknown) {
    orgId = trainingId(orgId);
    const v = objectInput(raw, [
      'commandId',
      'userId',
      'displayName',
      'evidenceReference',
      'qualifiedUntil',
    ]);
    const commandId = trainingCommand(v.commandId),
      uid = trainingId(v.userId),
      name = text(v.displayName, 'displayName', 1, 80),
      evidence = text(v.evidenceReference, 'evidenceReference', 1, 120),
      until = trainingTime(v.qualifiedUntil);
    return this.write(cookie, orgId, async (c, a) => {
      await this.manager(c, a, orgId);
      return this.receipt(c, a, commandId, { op: 'COACH_CREATE', orgId, ...v }, async () => {
        if (!(await c.query("SELECT 1 FROM users WHERE id=$1 AND status='ACTIVE'", [uid])).rowCount)
          throw notFound();
        if (
          (
            await c.query('SELECT 1 FROM training_coaches WHERE org_id=$1 AND user_id=$2', [
              orgId,
              uid,
            ])
          ).rowCount
        )
          trainingFail('COACH_EXISTS', '本机构已登记此教练');
        const id = randomUUID();
        await c.query(
          'INSERT INTO training_coaches(id,org_id,user_id,display_name,evidence_reference,qualified_until,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [id, orgId, uid, name, evidence, until, a.user.id],
        );
        return { coachId: id };
      });
    });
  }
  async coachCommand(cookie: string | undefined, id: string, raw: unknown) {
    const org = await this.ref('training_coaches', id),
      v = parseTrainingAction(raw, ['CONSENT', 'APPROVE', 'REJECT', 'SUSPEND']);
    return this.write(
      cookie,
      org,
      async (c, a) => {
        const t = (await c.query('SELECT * FROM training_coaches WHERE id=$1 FOR UPDATE', [id]))
          .rows[0]!;
        if (v.action === 'CONSENT') {
          if (t.user_id !== a.user.id) throw forbidden();
        } else {
          if (!(await this.managed(c, a, org))) await this.operator(c, a);
          if ([t.created_by, t.user_id].includes(a.user.id)) throw forbidden();
        }
        return this.receipt(c, a, v.commandId, { op: 'COACH', id, ...v }, async () => {
          trainingVersion(t.version, v.expectedVersion);
          if (v.action === 'CONSENT')
            await c.query(
              'UPDATE training_coaches SET consented=true,version=version+1 WHERE id=$1',
              [id],
            );
          else {
            if (!v.reason) trainingFail('REASON_REQUIRED', '请填写审核依据');
            if (
              v.action === 'APPROVE' &&
              (!t.consented || new Date(t.qualified_until) <= new Date())
            )
              trainingFail('COACH_INELIGIBLE', '本人未确认或资质已过期');
            await c.query(
              'UPDATE training_coaches SET status=$2,reviewed_by=$3,version=version+1 WHERE id=$1',
              [
                id,
                (
                  { APPROVE: 'APPROVED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED' } as Record<
                    string,
                    string
                  >
                )[v.action],
                a.user.id,
              ],
            );
          }
          await this.log(c, a, org, id, 'COACH_' + v.action, { reason: v.reason });
          return { coachId: id };
        });
      },
      v.action === 'SUSPEND',
    );
  }
  async createCourse(cookie: string | undefined, orgId: string, raw: unknown) {
    orgId = trainingId(orgId);
    const v = objectInput(raw, ['commandId', 'title', 'description']);
    const commandId = trainingCommand(v.commandId),
      title = text(v.title, 'title', 1, 80),
      description = text(v.description, 'description', 1, 1000);
    return this.write(cookie, orgId, async (c, a) => {
      await this.manager(c, a, orgId);
      return this.receipt(c, a, commandId, { op: 'COURSE', orgId, ...v }, async () => {
        const id = randomUUID();
        await c.query(
          'INSERT INTO training_courses(id,org_id,title,description,created_by) VALUES($1,$2,$3,$4,$5)',
          [id, orgId, title, description, a.user.id],
        );
        return { courseId: id };
      });
    });
  }
  async createCohort(cookie: string | undefined, orgId: string, raw: unknown) {
    orgId = trainingId(orgId);
    const v = parseTrainingCohort(raw);
    return this.write(cookie, orgId, async (c, a) => {
      await this.manager(c, a, orgId);
      return this.receipt(c, a, v.commandId, { op: 'COHORT', orgId, ...v }, async () => {
        if (
          !(
            await c.query('SELECT 1 FROM training_courses WHERE org_id=$1 AND id=$2', [
              orgId,
              v.courseId,
            ])
          ).rowCount
        )
          throw notFound();
        if (
          !(
            await c.query("SELECT 1 FROM courts WHERE org_id=$1 AND id=$2 AND status='ACTIVE'", [
              orgId,
              v.courtId,
            ])
          ).rowCount
        )
          throw notFound();
        const now = (await c.query('SELECT clock_timestamp() AS n')).rows[0]!.n;
        if (Date.parse(v.enrollmentDeadline) <= new Date(now).getTime())
          trainingFail('DEADLINE_PASSED', '报名截止须在未来');
        const id = randomUUID();
        await c.query(
          'INSERT INTO training_cohorts(id,org_id,course_id,court_id,title,address,capacity,total_fen,terms_id,terms_text,enrollment_deadline,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [
            id,
            orgId,
            v.courseId,
            v.courtId,
            v.title,
            v.address,
            v.capacity,
            v.totalFen,
            randomUUID(),
            v.termsText,
            v.enrollmentDeadline,
            a.user.id,
          ],
        );
        for (const s of v.sessions) {
          const sid = randomUUID();
          await c.query(
            'INSERT INTO training_sessions(id,org_id,cohort_id,starts_at,ends_at,buffer_minutes,price_weight) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [sid, orgId, id, s.startsAt, s.endsAt, s.bufferMinutes, s.priceWeight],
          );
          for (const coachId of s.coachIds) {
            if (
              !(
                await c.query('SELECT 1 FROM training_coaches WHERE org_id=$1 AND id=$2', [
                  orgId,
                  coachId,
                ])
              ).rowCount
            )
              throw notFound();
            await c.query(
              'INSERT INTO training_session_coaches(session_id,org_id,coach_id) VALUES($1,$2,$3)',
              [sid, orgId, coachId],
            );
          }
        }
        return { cohortId: id };
      });
    });
  }
  async cohortCommand(cookie: string | undefined, id: string, raw: unknown) {
    const org = await this.ref('training_cohorts', id),
      v = parseTrainingAction(raw, ['PUBLISH', 'SUSPEND', 'RESUME', 'CANCEL', 'COMPLETE']);
    return this.write(
      cookie,
      org,
      async (c, a) => {
        await this.manager(c, a, org);
        return this.receipt(c, a, v.commandId, { op: 'COHORT_COMMAND', id, ...v }, async () => {
          const h = await this.cohort(c, id, true);
          trainingVersion(h.version, v.expectedVersion);
          if (v.action === 'PUBLISH') {
            if (h.state !== 'DRAFT') trainingFail('INVALID_STATE', '只有草稿可招生');
            if (!(await this.eligible(c, h)))
              trainingFail('SUPPLY_UNQUALIFIED', '机构、场地或教练资质未满足');
            if (new Date(h.enrollment_deadline) <= new Date(h.db_now))
              trainingFail('DEADLINE_PASSED', '报名已截止');
            const sessions = (
              await c.query(
                'SELECT * FROM training_sessions WHERE cohort_id=$1 ORDER BY starts_at,id',
                [id],
              )
            ).rows;
            for (const s of sessions) {
              const coaches = (
                await c.query(
                  'SELECT t.user_id FROM training_session_coaches sc JOIN training_coaches t ON t.id=sc.coach_id WHERE sc.session_id=$1 ORDER BY t.user_id',
                  [s.id],
                )
              ).rows;
              for (const key of [`court:${h.court_id}`, ...coaches.map((x) => `user:${x.user_id}`)])
                await c.query(
                  "INSERT INTO training_resource_reservations(id,org_id,session_id,resource_key,starts_at,ends_at) VALUES($1,$2,$3,$4,$5::timestamptz-($7::integer*interval '1 minute'),$6::timestamptz+($7::integer*interval '1 minute'))",
                  [randomUUID(), org, s.id, key, s.starts_at, s.ends_at, s.buffer_minutes],
                );
            }
            await c.query(
              "UPDATE training_cohorts SET state='ENROLLING',version=version+1 WHERE id=$1",
              [id],
            );
          } else if (v.action === 'RESUME') {
            if (!v.reason) trainingFail('REASON_REQUIRED', '请填写恢复依据');
            const blocker = await this.resumeBlocker(c, h);
            if (blocker) trainingFail('TRAINING_RESUME_BLOCKED', blocker);
            await c.query(
              "UPDATE training_cohorts SET state=CASE WHEN enrollment_deadline>clock_timestamp() THEN 'ENROLLING' ELSE 'RUNNING' END,version=version+1 WHERE id=$1",
              [id],
            );
          } else if (v.action === 'COMPLETE') {
            if (!v.reason) trainingFail('REASON_REQUIRED', '请填写结课依据');
            const safelyEndedEnrollmentIds: string[] = [];
            const blocker = await trainingCohortCompletionBlocker(c, h, safelyEndedEnrollmentIds);
            if (blocker) trainingFail('TRAINING_COMPLETION_BLOCKED', blocker);
            if (safelyEndedEnrollmentIds.length) {
              await c.query(
                "UPDATE training_enrollments SET state='CANCELLED',version=version+1 WHERE id=ANY($1::uuid[])",
                [safelyEndedEnrollmentIds],
              );
              await this.log(c, a, org, id, 'COMPLETE_UNUSED_ENROLLMENTS', {
                enrollmentIds: safelyEndedEnrollmentIds,
              });
            }
            await c.query(
              "UPDATE training_cohorts SET state='COMPLETED',version=version+1 WHERE id=$1",
              [id],
            );
            await c.query(
              'UPDATE training_resource_reservations SET active=false WHERE active AND session_id IN(SELECT id FROM training_sessions WHERE cohort_id=$1)',
              [id],
            );
          } else {
            if (['COMPLETED', 'CANCELLED'].includes(h.state))
              trainingFail('INVALID_STATE', '班期已终结');
            if (v.action === 'SUSPEND' && !['ENROLLING', 'RUNNING'].includes(h.state))
              trainingFail('INVALID_STATE', '只有招生中或授课中的班期可以暂停');
            if (!v.reason) trainingFail('REASON_REQUIRED', '请填写停课原因');
            await c.query('UPDATE training_cohorts SET state=$2,version=version+1 WHERE id=$1', [
              id,
              v.action === 'SUSPEND' ? 'SUSPENDED' : 'CANCELLED',
            ]);
            if (v.action === 'CANCEL') {
              await c.query(
                "UPDATE training_sessions SET state='CANCELLED',version=version+1 WHERE cohort_id=$1 AND state='SCHEDULED'",
                [id],
              );
              await c.query(
                "UPDATE training_resource_reservations SET active=false WHERE session_id IN(SELECT id FROM training_sessions WHERE cohort_id=$1 AND state='CANCELLED')",
                [id],
              );
              await c.query(
                "UPDATE training_lesson_entitlements e SET state='MAKEUP_DUE',version=e.version+1 FROM training_sessions s WHERE e.current_session_id=s.id AND s.cohort_id=$1 AND s.state='CANCELLED' AND e.state='AVAILABLE'",
                [id],
              );
            }
          }
          await this.log(c, a, org, id, v.action, { reason: v.reason });
          return { cohortId: id };
        });
      },
      !['PUBLISH', 'RESUME'].includes(v.action),
    );
  }
  private async cohortDto(c: PoolClient, h: Row, manage = false): Promise<TrainingCohortData> {
    const sessions = (
      await c.query('SELECT * FROM training_sessions WHERE cohort_id=$1 ORDER BY starts_at,id', [
        h.id,
      ])
    ).rows;
    const items = [];
    for (const s of sessions) {
      const coaches = (
        await c.query(
          'SELECT t.id,t.display_name AS name FROM training_session_coaches sc JOIN training_coaches t ON t.id=sc.coach_id WHERE sc.session_id=$1 ORDER BY t.id',
          [s.id],
        )
      ).rows;
      items.push({
        id: s.id,
        startsAt: iso(s.starts_at)!,
        endsAt: iso(s.ends_at)!,
        state: s.state,
        version: s.version,
        coaches,
      });
    }
    const eligible = await this.eligible(c, h);
    const completionBlocker = manage ? await trainingCohortCompletionBlocker(c, h) : null;
    const resumeBlocker = manage ? await this.resumeBlocker(c, h) : null;
    return {
      id: h.id,
      orgId: h.org_id,
      courseId: h.course_id,
      title: h.title,
      description: h.description,
      address: h.address,
      state: h.state,
      capacity: h.capacity,
      available: Math.max(0, h.capacity - (await this.seats(c, h.id))),
      totalFen: h.total_fen,
      termsId: h.terms_id,
      termsText: h.terms_text,
      enrollmentDeadline: iso(h.enrollment_deadline)!,
      version: h.version,
      sessions: items,
      capabilities: {
        canEnroll:
          !!this.training.enabled &&
          h.state === 'ENROLLING' &&
          eligible &&
          new Date(h.enrollment_deadline) > new Date(),
        canManage: manage,
        canComplete: manage && completionBlocker === null,
        completionBlocker,
        canResume: manage && resumeBlocker === null,
        resumeBlocker,
        paidEnrollmentEnabled: !!this.training.trade,
      },
    };
  }
  async catalog() {
    if (!this.training.enabled) return { items: [], capabilities: this.capabilities() };
    return this.transaction(async (c) => {
      const rows = (
        await c.query(
          "SELECT h.*,co.description FROM training_cohorts h JOIN training_courses co ON co.id=h.course_id JOIN training_providers p ON p.org_id=h.org_id JOIN organizations o ON o.id=h.org_id WHERE h.state='ENROLLING' AND h.enrollment_deadline>clock_timestamp() AND p.status='APPROVED' AND p.qualified_until>clock_timestamp() AND o.status='ACTIVE' ORDER BY h.created_at DESC,h.id DESC LIMIT 100",
        )
      ).rows;
      const items = [];
      for (const r of rows) if (await this.eligible(c, r)) items.push(await this.cohortDto(c, r));
      return { items, capabilities: this.capabilities() };
    });
  }
  async detail(id: string) {
    return this.transaction(async (c) => {
      const h = await this.cohort(c, id);
      if (
        !['ENROLLING', 'RUNNING', 'COMPLETED'].includes(h.state) ||
        !this.training.enabled ||
        !(await this.eligible(c, h))
      )
        throw notFound();
      return this.cohortDto(c, h);
    });
  }
  async workspace(cookie: string | undefined, orgId: string) {
    orgId = trainingId(orgId);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      let manager = await this.managed(c, a, orgId);
      if (!manager) await this.operator(c, a);
      const provider =
        (await c.query('SELECT * FROM training_providers WHERE org_id=$1', [orgId])).rows[0] ??
        null;
      const coaches = (
        await c.query('SELECT * FROM training_coaches WHERE org_id=$1 ORDER BY id', [orgId])
      ).rows;
      const courses = (
        await c.query('SELECT * FROM training_courses WHERE org_id=$1 ORDER BY id', [orgId])
      ).rows;
      const hs = (
        await c.query(
          'SELECT h.*,c.description FROM training_cohorts h JOIN training_courses c ON c.id=h.course_id WHERE h.org_id=$1 ORDER BY h.created_at DESC LIMIT 100',
          [orgId],
        )
      ).rows;
      const cohorts = [];
      for (const h of hs) cohorts.push(await this.cohortDto(c, h, manager));
      await this.ensureFreshSession(c, a);
      const courts = (
        await c.query(
          "SELECT id,name FROM courts WHERE org_id=$1 AND status='ACTIVE' ORDER BY name",
          [orgId],
        )
      ).rows;
      const enrollments = (
        await c.query(
          'SELECT id,cohort_id,state,learner_user_id,payer_user_id,version FROM training_enrollments WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100',
          [orgId],
        )
      ).rows;
      return {
        provider,
        coaches,
        courses,
        courts,
        cohorts,
        enrollments,
        capabilities: this.capabilities(),
      };
    });
  }
  private async enrollment(c: PoolClient, id: string, lock = false) {
    const r = (
      await c.query(
        `SELECT n.*,clock_timestamp() AS db_now FROM training_enrollments n WHERE n.id=$1 ${lock ? 'FOR UPDATE' : ''}`,
        [trainingId(id)],
      )
    ).rows[0];
    if (!r) throw notFound();
    return r;
  }
  private participant(a: Actor, n: Row) {
    return [n.applicant_user_id, n.payer_user_id, n.learner_user_id].includes(a.user.id);
  }
  private async access(c: PoolClient, a: Actor, n: Row) {
    if (this.participant(a, n)) return false;
    const manage = await this.managed(c, a, n.org_id);
    if (
      !manage &&
      !(
        await c.query(
          "SELECT p.user_id FROM platform_operators p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND p.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF u",
          [a.user.id],
        )
      ).rowCount
    )
      throw notFound();
    return true;
  }
  private async assigned(c: PoolClient, a: Actor, sessionId: string) {
    if (
      !(
        await c.query(
          "SELECT 1 FROM training_session_coaches sc JOIN training_coaches t ON t.id=sc.coach_id WHERE sc.session_id=$1 AND t.user_id=$2 AND t.status='APPROVED' AND t.consented AND t.qualified_until>clock_timestamp()",
          [sessionId, a.user.id],
        )
      ).rowCount
    )
      throw forbidden();
  }
  private async reserveLearner(c: PoolClient, n: Row, s: Row) {
    const saved = await c.query(
      "INSERT INTO training_resource_reservations(id,org_id,session_id,resource_key,starts_at,ends_at,enrollment_id) VALUES($1,$2,$3,$4,$5::timestamptz-($7::integer*interval '1 minute'),$6::timestamptz+($7::integer*interval '1 minute'),$8)",
      [
        randomUUID(),
        n.org_id,
        s.id,
        `user:${n.learner_user_id}`,
        s.starts_at,
        s.ends_at,
        s.buffer_minutes,
        n.id,
      ],
    );
    if (!saved.rowCount) trainingFail('LEARNER_COACH_CONFLICT', '本场授课教练不能作为学员占位');
  }
  private async sessionRoom(c: PoolClient, sid: string, exclude?: string) {
    const r = (
      await c.query(
        `SELECT h.capacity,(SELECT count(*)::int FROM training_lesson_entitlements e JOIN training_enrollments n ON n.id=e.enrollment_id WHERE e.current_session_id=s.id AND e.state NOT IN('MAKEUP_DUE','REFUND_PENDING','REFUNDED') AND ($2::uuid IS NULL OR e.enrollment_id<>$2) AND (n.state='CONFIRMED' OR(n.state='HOLDING' AND n.hold_expires_at>clock_timestamp()))) AS occupied FROM training_sessions s JOIN training_cohorts h ON h.id=s.cohort_id WHERE s.id=$1`,
        [sid, exclude ?? null],
      )
    ).rows[0];
    return !!r && r.occupied < r.capacity;
  }
  private async capture(
    c: PoolClient,
    a: Actor,
    n: Row,
    acceptedTermsId: unknown,
    chargeConsent: unknown,
  ) {
    if (n.total_fen === 0) return;
    if (n.payer_user_id !== a.user.id) throw forbidden();
    if (!this.training.trade) trainingFail('PAID_TRAINING_UNAVAILABLE', '收费培训尚未接入交易');
    if (acceptedTermsId !== n.terms_id || chargeConsent !== true)
      trainingFail('TERMS_CONSENT_REQUIRED', '付款人须明确接受本次冻结合同');
    if (n.trade_order_id) return;
    const id = await this.training.trade!.capture(c, a, {
      enrollmentId: n.id,
      acceptedTermsId: n.terms_id,
      chargeConsent: true,
    });
    if (!id) trainingFail('PAID_TRAINING_UNAVAILABLE', '交易能力未开放');
    await c.query(
      'UPDATE training_enrollments SET trade_order_id=$2,version=version+1 WHERE id=$1',
      [n.id, id],
    );
  }
  async enroll(cookie: string | undefined, cohortId: string, raw: unknown) {
    const org = await this.ref('training_cohorts', cohortId);
    const v = objectInput(raw, [
      'commandId',
      'payerUserId',
      'learnerUserId',
      'adultConfirmed',
      'acceptedTermsId',
      'chargeConsent',
      'waitlist',
    ]);
    const commandId = trainingCommand(v.commandId),
      payer = trainingId(v.payerUserId),
      learner = trainingId(v.learnerUserId);
    if (v.adultConfirmed !== true)
      trainingFail('ADULT_CONFIRMATION_REQUIRED', '当前只开放成年人本人报名');
    return this.write(cookie, org, async (c, a) => {
      if (learner !== a.user.id)
        trainingFail('LEARNER_SELF_CONSENT_REQUIRED', '首期由成年学员本人确认报名', 403);
      return this.receipt(c, a, commandId, { op: 'ENROLL', cohortId, ...v }, async () => {
        const h = await this.cohort(c, cohortId, true);
        await this.expire(c, cohortId);
        if (
          h.state !== 'ENROLLING' ||
          new Date(h.enrollment_deadline) <= new Date(h.db_now) ||
          !(await this.eligible(c, h))
        )
          trainingFail('ENROLLMENT_CLOSED', '当前班期未开放报名');
        if (v.acceptedTermsId !== h.terms_id) trainingFail('TERMS_CHANGED', '请重新核对课程合同');
        if (
          !(await c.query("SELECT 1 FROM users WHERE id=$1 AND status='ACTIVE'", [payer])).rowCount
        )
          throw notFound();
        if (
          (
            await c.query(
              "SELECT 1 FROM training_enrollments WHERE cohort_id=$1 AND learner_user_id=$2 AND state IN('WAITLISTED','HOLDING','CONFIRMED','PAID_UNALLOCATED','COMPLETED')",
              [cohortId, learner],
            )
          ).rowCount
        )
          trainingFail('ENROLLMENT_EXISTS', '已有报名或候补，请查看原记录');
        const binding = h.total_fen > 0 ? await this.training.trade?.binding(c, org) : null;
        if (h.total_fen > 0 && !binding)
          trainingFail('PAID_TRAINING_UNAVAILABLE', '本机构尚未开放收费培训');
        const ss = (
          await c.query(
            'SELECT * FROM training_sessions WHERE cohort_id=$1 ORDER BY starts_at,id',
            [cohortId],
          )
        ).rows;
        let room = (await this.seats(c, cohortId)) < h.capacity;
        for (const s of ss) room = room && (await this.sessionRoom(c, s.id));
        const prior = !!(
          await c.query(
            "SELECT 1 FROM training_enrollments WHERE cohort_id=$1 AND state='WAITLISTED' LIMIT 1",
            [cohortId],
          )
        ).rowCount;
        const wait = !room || prior;
        if (wait && v.waitlist !== true) trainingFail('CAPACITY_FULL', '名额已满，可明确选择候补');
        const id = randomUUID(),
          prices = allocateTrainingPrice(
            h.total_fen,
            ss.map((s) => s.price_weight),
          );
        const snapshot = {
          title: h.title,
          termsText: h.terms_text,
          termsId: h.terms_id,
          courseId: h.course_id,
          cohortId,
          orgId: org,
          applicantId: a.user.id,
          payerId: payer,
          learnerId: learner,
          totalFen: h.total_fen,
          beneficiaryId: binding?.beneficiaryId ?? h.created_by,
          beneficiaryName: binding?.beneficiaryName ?? '免费培训',
          merchantKey: binding?.merchantKey ?? null,
          lessons: ss.map((s, i) => ({
            id: s.id,
            startsAt: iso(s.starts_at),
            endsAt: iso(s.ends_at),
            netFen: prices[i],
          })),
          adultConfirmed: true,
        };
        await c.query(
          "INSERT INTO training_enrollments(id,org_id,cohort_id,applicant_user_id,payer_user_id,learner_user_id,adult_confirmed,terms_id,terms_snapshot,total_fen,state,hold_expires_at) VALUES($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,CASE WHEN $10='HOLDING' THEN LEAST(clock_timestamp()+interval '10 minutes',(SELECT enrollment_deadline FROM training_cohorts WHERE id=$3)) ELSE NULL END)",
          [
            id,
            org,
            cohortId,
            a.user.id,
            payer,
            learner,
            h.terms_id,
            snapshot,
            h.total_fen,
            wait ? 'WAITLISTED' : 'HOLDING',
          ],
        );
        const n = await this.enrollment(c, id);
        for (let i = 0; i < ss.length; i++) {
          await c.query(
            'INSERT INTO training_lesson_entitlements(id,org_id,enrollment_id,original_session_id,current_session_id,net_fen) VALUES($1,$2,$3,$4,$4,$5)',
            [randomUUID(), org, id, ss[i]!.id, prices[i]],
          );
          if (!wait) await this.reserveLearner(c, n, ss[i]!);
        }
        if (!wait && payer === a.user.id && h.total_fen > 0)
          await this.capture(c, a, n, v.acceptedTermsId, v.chargeConsent);
        await this.log(c, a, org, id, wait ? 'WAITLIST_JOINED' : 'SEAT_HELD');
        return { enrollmentId: id };
      });
    });
  }
  private async enrollmentDto(
    c: PoolClient,
    n: Row,
    manage = false,
  ): Promise<TrainingEnrollmentData> {
    const es = (
      await c.query(
        'SELECT * FROM training_lesson_entitlements WHERE enrollment_id=$1 ORDER BY original_session_id',
        [n.id],
      )
    ).rows;
    const consumptions = (
      await c.query(
        'SELECT x.* FROM training_consumptions x JOIN training_lesson_entitlements e ON e.id=x.entitlement_id WHERE e.enrollment_id=$1 ORDER BY x.created_at',
        [n.id],
      )
    ).rows;
    const refunds = (
      await c.query(
        'SELECT * FROM training_refund_allocations WHERE enrollment_id=$1 ORDER BY created_at',
        [n.id],
      )
    ).rows;
    return {
      id: n.id,
      orgId: n.org_id,
      cohortId: n.cohort_id,
      applicantUserId: n.applicant_user_id,
      payerUserId: n.payer_user_id,
      learnerUserId: n.learner_user_id,
      state: n.state,
      totalFen: n.total_fen,
      tradeOrderId: n.trade_order_id,
      holdExpiresAt: iso(n.hold_expires_at),
      version: n.version,
      entitlements: es.map((e) => ({
        id: e.id,
        sessionId: e.current_session_id,
        originalSessionId: e.original_session_id,
        netFen: e.net_fen,
        state: e.state,
        version: e.version,
      })),
      consumptions,
      refunds,
      capabilities: {
        canConfirm: n.state === 'HOLDING',
        canCancel: ['WAITLISTED', 'HOLDING', 'EXPIRED'].includes(n.state),
        canRequestRefund: ['CONFIRMED', 'PAID_UNALLOCATED'].includes(n.state),
        canManage: manage,
      },
    };
  }
  async myEnrollments(cookie: string | undefined) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const ns = (
        await c.query(
          'SELECT * FROM training_enrollments WHERE $1 IN(applicant_user_id,payer_user_id,learner_user_id) ORDER BY created_at DESC LIMIT 100',
          [a.user.id],
        )
      ).rows;
      const items = [];
      for (const n of ns) items.push(await this.enrollmentDto(c, n));
      const teaching = (
        await c.query(
          'SELECT s.*,h.title FROM training_sessions s JOIN training_cohorts h ON h.id=s.cohort_id JOIN training_session_coaches sc ON sc.session_id=s.id JOIN training_coaches t ON t.id=sc.coach_id WHERE t.user_id=$1 ORDER BY s.starts_at DESC LIMIT 100',
          [a.user.id],
        )
      ).rows;
      const coachProfiles = (
        await c.query(
          'SELECT id,org_id,display_name,status,consented,version FROM training_coaches WHERE user_id=$1',
          [a.user.id],
        )
      ).rows;
      await this.ensureFreshSession(c, a);
      return { items, teaching, coachProfiles, capabilities: this.capabilities() };
    });
  }
  async enrollmentDetail(cookie: string | undefined, id: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        n = await this.enrollment(c, id),
        m = await this.access(c, a, n);
      const enrollment = await this.enrollmentDto(c, n, m);
      await this.ensureFreshSession(c, a);
      return { ...enrollment, termsId: n.terms_id, termsSnapshot: n.terms_snapshot };
    });
  }
  async enrollmentCommand(cookie: string | undefined, id: string, raw: unknown) {
    const org = await this.ref('training_enrollments', id),
      v = parseTrainingAction(
        raw,
        ['CLAIM', 'AUTHORIZE_PAYMENT', 'CONFIRM', 'REFRESH', 'CANCEL'],
        ['acceptedTermsId', 'chargeConsent'],
      );
    return this.write(
      cookie,
      org,
      async (c, a) => {
        const n = await this.enrollment(c, id, true);
        await this.access(c, a, n);
        return this.receipt(c, a, v.commandId, { op: 'ENROLLMENT', id, ...v }, async () => {
          trainingVersion(n.version, v.expectedVersion);
          const h = await this.cohort(c, n.cohort_id, true);
          if (v.action === 'CLAIM') {
            if (n.learner_user_id !== a.user.id || n.state !== 'WAITLISTED') throw forbidden();
            await this.expire(c, h.id);
            const first = (
              await c.query(
                "SELECT id FROM training_enrollments WHERE cohort_id=$1 AND state='WAITLISTED' ORDER BY created_at,id LIMIT 1",
                [h.id],
              )
            ).rows[0];
            if (first?.id !== id) trainingFail('WAITLIST_PRIORITY', '前序候补尚未处理');
            if (
              h.state !== 'ENROLLING' ||
              new Date(h.enrollment_deadline) <= new Date(h.db_now) ||
              !(await this.eligible(c, h))
            )
              trainingFail('ENROLLMENT_CLOSED', '班期已停止招生');
            if ((await this.seats(c, h.id)) >= h.capacity)
              trainingFail('CAPACITY_FULL', '暂无名额');
            const ss = (
              await c.query(
                'SELECT * FROM training_sessions WHERE cohort_id=$1 ORDER BY starts_at,id',
                [h.id],
              )
            ).rows;
            for (const s of ss) {
              if (!(await this.sessionRoom(c, s.id)))
                trainingFail('CAPACITY_FULL', '某课次暂无名额');
              await this.reserveLearner(c, n, s);
            }
            await c.query(
              "UPDATE training_enrollments SET state='HOLDING',hold_expires_at=LEAST(clock_timestamp()+interval '10 minutes',(SELECT enrollment_deadline FROM training_cohorts WHERE id=training_enrollments.cohort_id)),version=version+1 WHERE id=$1",
              [id],
            );
          } else if (v.action === 'AUTHORIZE_PAYMENT') {
            if (
              n.state !== 'HOLDING' ||
              new Date(n.hold_expires_at) <= new Date(n.db_now) ||
              h.state !== 'ENROLLING' ||
              !(await this.eligible(c, h))
            )
              trainingFail('HOLD_EXPIRED', '锁位已失效');
            await this.capture(c, a, n, v.acceptedTermsId, v.chargeConsent);
          } else if (v.action === 'CANCEL') {
            if (!this.participant(a, n) || !['WAITLISTED', 'HOLDING', 'EXPIRED'].includes(n.state))
              trainingFail('INVALID_STATE', '已有服务或已付款请申请逐课退款');
            if (n.trade_order_id) {
              const payment = await this.training.trade?.payment(c, id);
              if (
                !payment ||
                payment.status !== 'UNPAID' ||
                payment.paidFen !== 0 ||
                payment.refundedFen !== 0 ||
                payment.canReleaseUnpaidHold !== true
              )
                trainingFail(
                  'PAYMENT_MAY_BE_PENDING',
                  '原支付仍待核对，不能假定未付款；逾期实付将进入待退款',
                );
            }
            await c.query(
              "UPDATE training_enrollments SET state='CANCELLED',version=version+1 WHERE id=$1",
              [id],
            );
            await c.query(
              'UPDATE training_resource_reservations SET active=false WHERE enrollment_id=$1',
              [id],
            );
          } else {
            if (!['HOLDING', 'EXPIRED', 'PAID_UNALLOCATED', 'CONFIRMED'].includes(n.state))
              trainingFail('INVALID_STATE', '当前报名不可核对');
            if (n.state === 'CONFIRMED') return { enrollmentId: id };
            let paid = false;
            if (n.total_fen > 0) {
              if (!this.training.trade || !n.trade_order_id)
                trainingFail('PAYMENT_PENDING', '尚未取得真实支付凭据');
              const p = await this.training.trade.payment(c, id);
              if (p.status === 'UNKNOWN') trainingFail('PAYMENT_UNKNOWN', '支付结果待核对');
              paid = p.status === 'PAID' && p.paidFen - p.refundedFen === n.total_fen;
              if (p.refundedFen > 0) trainingFail('REFUND_IN_PROGRESS', '已有退款，请查看退款记录');
            }
            const expired =
              n.state !== 'HOLDING' || new Date(n.hold_expires_at) <= new Date(n.db_now);
            const state = trainingCanConfirm({
              expired,
              eligible: h.state === 'ENROLLING' && (await this.eligible(c, h)),
              paid,
              free: n.total_fen === 0,
            });
            if (state === 'PAYMENT_PENDING') trainingFail('PAYMENT_PENDING', '尚未确认到账');
            if (state === 'REJECT') trainingFail('SUPPLY_UNQUALIFIED', '供给资格已变化');
            await c.query(
              'UPDATE training_enrollments SET state=$2,version=version+1 WHERE id=$1',
              [id, state],
            );
            if (state !== 'CONFIRMED')
              await c.query(
                'UPDATE training_resource_reservations SET active=false WHERE enrollment_id=$1',
                [id],
              );
          }
          await this.log(c, a, org, id, 'ENROLLMENT_' + v.action);
          return { enrollmentId: id };
        });
      },
      ['REFRESH', 'CANCEL'].includes(v.action),
    );
  }
  async sessionRoster(cookie: string | undefined, id: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const s = (await c.query('SELECT * FROM training_sessions WHERE id=$1', [trainingId(id)]))
        .rows[0];
      if (!s) throw notFound();
      const manager = await this.managed(c, a, s.org_id);
      if (!manager) await this.assigned(c, a, id);
      const learners = (
        await c.query(
          "SELECT e.*,n.learner_user_id,u.display_name FROM training_lesson_entitlements e JOIN training_enrollments n ON n.id=e.enrollment_id JOIN users u ON u.id=n.learner_user_id WHERE e.current_session_id=$1 AND n.state='CONFIRMED' AND e.state NOT IN('MAKEUP_DUE','REFUNDED') ORDER BY e.id",
          [id],
        )
      ).rows;
      const attendance = (
        await c.query('SELECT * FROM training_attendance WHERE session_id=$1 ORDER BY created_at', [
          id,
        ])
      ).rows;
      await this.ensureFreshSession(c, a);
      const consumptions = (
        await c.query(
          'SELECT x.* FROM training_consumptions x JOIN training_lesson_entitlements e ON e.id=x.entitlement_id WHERE e.current_session_id=$1 ORDER BY x.created_at',
          [id],
        )
      ).rows;
      return { session: s, learners, attendance, consumptions, canManage: manager };
    });
  }
  async sessionCommand(cookie: string | undefined, id: string, raw: unknown) {
    const org = await this.ref('training_sessions', id),
      v = parseTrainingAction(raw, ['DELIVER']);
    return this.write(
      cookie,
      org,
      async (c, a) => {
        await this.assigned(c, a, id);
        return this.receipt(c, a, v.commandId, { op: 'SESSION', id, ...v }, async () => {
          const s = (
            await c.query(
              'SELECT *,clock_timestamp() AS db_now FROM training_sessions WHERE id=$1 FOR UPDATE',
              [id],
            )
          ).rows[0];
          trainingVersion(s.version, v.expectedVersion);
          if (s.state !== 'SCHEDULED' || new Date(s.ends_at) > new Date(s.db_now))
            trainingFail('DELIVERY_NOT_READY', '课次结束后才能提交授课事实');
          if (!v.reason) trainingFail('REASON_REQUIRED', '请填写授课记录');
          const h = await this.cohort(c, s.cohort_id);
          if (['CANCELLED', 'SUSPENDED'].includes(h.state))
            trainingFail('COHORT_STOPPED', '停课班期不可提交授课');
          await c.query(
            "UPDATE training_sessions SET state='DELIVERED',delivered_by=$2,delivered_at=clock_timestamp(),delivery_note=$3,version=version+1 WHERE id=$1",
            [id, a.user.id, v.reason],
          );
          await this.log(c, a, org, id, 'LESSON_DELIVERED');
          return { sessionId: id };
        });
      },
      true,
    );
  }
  /** Same predicate is used for discovery and the in-lock MAKEUP command. No payer/manager override. */
  private async eligibleMakeupSessions(
    c: PoolClient,
    n: Row,
    e: Row,
    target: string | null = null,
  ) {
    const original = await this.cohort(c, n.cohort_id);
    return (
      await c.query(
        `SELECT s.id,s.cohort_id,s.org_id,s.starts_at,s.ends_at,s.buffer_minutes,
      h.title AS cohort_title,h.address,(h.capacity-seats.used)::int AS available_seats,
      (SELECT jsonb_agg(jsonb_build_object('name',tc.display_name) ORDER BY tc.display_name,tc.id)
       FROM training_session_coaches sc JOIN training_coaches tc ON tc.id=sc.coach_id WHERE sc.session_id=s.id) AS coaches
      FROM training_sessions s JOIN training_cohorts h ON h.id=s.cohort_id AND h.org_id=s.org_id
      JOIN training_providers p ON p.org_id=h.org_id JOIN organizations o ON o.id=h.org_id
      JOIN courts ct ON ct.id=h.court_id AND ct.org_id=h.org_id
      CROSS JOIN LATERAL (SELECT count(*)::int AS used FROM training_lesson_entitlements le
        JOIN training_enrollments en ON en.id=le.enrollment_id
        WHERE le.current_session_id=s.id AND le.state NOT IN('MAKEUP_DUE','REFUND_PENDING','REFUNDED')
        AND (en.state='CONFIRMED' OR (en.state='HOLDING' AND en.hold_expires_at>clock_timestamp()))) seats
      WHERE s.org_id=$1 AND h.course_id=$2 AND ($5::uuid IS NULL OR s.id=$5)
      AND s.state='SCHEDULED' AND s.starts_at>clock_timestamp() AND h.state IN('ENROLLING','RUNNING')
      AND o.status='ACTIVE' AND ct.status='ACTIVE' AND p.status='APPROVED'
      AND p.qualified_until>(SELECT max(ends_at) FROM training_sessions WHERE cohort_id=h.id)
      AND seats.used<h.capacity
      AND EXISTS(SELECT 1 FROM training_session_coaches WHERE session_id=s.id)
      AND NOT EXISTS(SELECT 1 FROM training_session_coaches sc JOIN training_sessions ts ON ts.id=sc.session_id
        JOIN training_coaches tc ON tc.id=sc.coach_id JOIN users u ON u.id=tc.user_id WHERE ts.cohort_id=h.id
        AND (tc.status<>'APPROVED' OR NOT tc.consented OR tc.qualified_until<ts.ends_at OR u.status<>'ACTIVE'))
      AND NOT EXISTS(SELECT 1 FROM training_lesson_entitlements le WHERE le.enrollment_id=$3
        AND le.current_session_id=s.id AND le.id<>$6 AND le.state NOT IN('REFUNDED','MAKEUP_DUE'))
      AND NOT EXISTS(SELECT 1 FROM training_resource_reservations r
        LEFT JOIN training_enrollments en ON en.id=r.enrollment_id
        WHERE r.active AND r.resource_key='user:'||$4::text
        AND NOT(coalesce(en.state='HOLDING' AND en.hold_expires_at<=clock_timestamp(),false))
        AND tstzrange(r.starts_at,r.ends_at,'[)') && tstzrange(s.starts_at-s.buffer_minutes*interval '1 minute',s.ends_at+s.buffer_minutes*interval '1 minute','[)'))
      AND NOT EXISTS(SELECT 1 FROM local_resource_reservations r WHERE r.active AND r.resource_key='user:'||$4::text
        AND NOT(EXISTS(SELECT 1 FROM local_bookings b WHERE b.id=r.booking_id AND b.status IN('HELD','REQUESTED') AND b.hold_expires_at<=clock_timestamp())
          OR EXISTS(SELECT 1 FROM local_matchups m WHERE m.id=r.matchup_id AND m.status='OPEN' AND m.expires_at<=clock_timestamp())
          OR EXISTS(SELECT 1 FROM dispatch_offers d WHERE d.id=r.dispatch_offer_id AND (d.status<>'ACCEPTED_HELD' OR d.hold_expires_at<=clock_timestamp())))
        AND tstzrange(r.starts_at,r.ends_at,'[)') && tstzrange(s.starts_at-s.buffer_minutes*interval '1 minute',s.ends_at+s.buffer_minutes*interval '1 minute','[)'))
      AND NOT EXISTS(SELECT 1 FROM booking_appearances b WHERE b.player_user_id=$4::uuid
        AND b.status IN('REQUESTED','ACCEPTED','ARRIVED','COMPLETED','DISPUTED')
        AND NOT(b.status='REQUESTED' AND b.expires_at<=clock_timestamp())
        AND c06_booking_window(b.report_at,b.end_at) && tstzrange(s.starts_at-s.buffer_minutes*interval '1 minute',s.ends_at+s.buffer_minutes*interval '1 minute','[)'))
      ORDER BY s.starts_at,s.id LIMIT 51`,
        [n.org_id, original.course_id, n.id, n.learner_user_id, target, e.id],
      )
    ).rows;
  }
  async makeupOptions(cookie: string | undefined, id: string): Promise<TrainingMakeupOptionsData> {
    id = trainingId(id);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        e = (await c.query('SELECT * FROM training_lesson_entitlements WHERE id=$1', [id])).rows[0];
      if (!e) throw notFound();
      const n = await this.enrollment(c, e.enrollment_id);
      if (n.learner_user_id !== a.user.id) throw notFound();
      if (n.state !== 'CONFIRMED' || e.state !== 'MAKEUP_DUE')
        trainingFail('MAKEUP_NOT_DUE', '当前没有可选课的待补课权益');
      const rows = await this.eligibleMakeupSessions(c, n, e);
      await this.ensureFreshSession(c, a);
      return {
        entitlementId: id,
        entitlementVersion: e.version,
        truncated: rows.length > 50,
        items: rows.slice(0, 50).map((r) => ({
          sessionId: r.id,
          cohortId: r.cohort_id,
          cohortTitle: r.cohort_title,
          address: r.address,
          startsAt: iso(r.starts_at)!,
          endsAt: iso(r.ends_at)!,
          availableSeats: r.available_seats,
          coaches: r.coaches ?? [],
        })),
      };
    });
  }
  async entitlementCommand(cookie: string | undefined, id: string, raw: unknown) {
    id = trainingId(id);
    const base = (
      await this.pool.query('SELECT org_id FROM training_lesson_entitlements WHERE id=$1', [id])
    ).rows[0];
    if (!base) throw notFound();
    const org = base.org_id as string,
      v = parseTrainingAction(
        raw,
        ['CHECKIN', 'CHECKOUT', 'LEAVE', 'MAKEUP', 'PROPOSE_CONSUMPTION'],
        ['sessionId'],
      );
    return this.write(
      cookie,
      org,
      async (c, a) =>
        this.receipt(c, a, v.commandId, { op: 'ENTITLEMENT', id, ...v }, async () => {
          const e = (
              await c.query('SELECT * FROM training_lesson_entitlements WHERE id=$1 FOR UPDATE', [
                id,
              ])
            ).rows[0],
            n = await this.enrollment(c, e.enrollment_id, true),
            s = (
              await c.query(
                'SELECT *,clock_timestamp() AS db_now FROM training_sessions WHERE id=$1 FOR UPDATE',
                [e.current_session_id],
              )
            ).rows[0];
          trainingVersion(e.version, v.expectedVersion);
          if (n.state !== 'CONFIRMED') trainingFail('ENROLLMENT_NOT_CONFIRMED', '报名尚未确认');
          if (['CHECKIN', 'CHECKOUT', 'PROPOSE_CONSUMPTION'].includes(v.action))
            await this.assigned(c, a, s.id);
          else if (n.learner_user_id !== a.user.id) throw forbidden();
          if (v.action === 'CHECKIN' || v.action === 'CHECKOUT') {
            if (e.state !== 'AVAILABLE' || s.state === 'CANCELLED')
              trainingFail('INVALID_STATE', '本课次不能签到');
            if (
              new Date(s.db_now).getTime() < new Date(s.starts_at).getTime() - 30 * 60000 ||
              new Date(s.db_now).getTime() > new Date(s.ends_at).getTime() + 24 * 3600000
            )
              trainingFail('ATTENDANCE_WINDOW', '不在签到补记时间范围');
            if (
              v.action === 'CHECKOUT' &&
              !(
                await c.query(
                  "SELECT 1 FROM training_attendance WHERE entitlement_id=$1 AND session_id=$2 AND action='CHECKIN'",
                  [id, s.id],
                )
              ).rowCount
            )
              trainingFail('CHECKIN_REQUIRED', '请先签到');
            await c.query(
              'INSERT INTO training_attendance(id,org_id,entitlement_id,session_id,action,actor_id) VALUES($1,$2,$3,$4,$5,$6)',
              [randomUUID(), org, id, s.id, v.action, a.user.id],
            );
            await c.query('UPDATE training_lesson_entitlements SET version=version+1 WHERE id=$1', [
              id,
            ]);
          } else if (v.action === 'LEAVE') {
            if (e.state !== 'AVAILABLE' || new Date(s.starts_at) <= new Date(s.db_now))
              trainingFail('LEAVE_WINDOW', '开课前的未消费课次可以请假');
            if (!v.reason) trainingFail('REASON_REQUIRED', '请填写请假原因');
            await c.query(
              "UPDATE training_lesson_entitlements SET state='MAKEUP_DUE',version=version+1 WHERE id=$1",
              [id],
            );
            await c.query(
              'UPDATE training_resource_reservations SET active=false WHERE enrollment_id=$1 AND session_id=$2',
              [n.id, s.id],
            );
          } else if (v.action === 'MAKEUP') {
            if (e.state !== 'MAKEUP_DUE') trainingFail('MAKEUP_NOT_DUE', '没有待补课权益');
            const target = trainingId(v.sessionId),
              t = (
                await c.query(
                  'SELECT s.*,h.course_id,h.state AS cohort_state FROM training_sessions s JOIN training_cohorts h ON h.id=s.cohort_id WHERE s.id=$1 AND s.org_id=$2 FOR UPDATE OF s',
                  [target, org],
                )
              ).rows[0],
              h = await this.cohort(c, n.cohort_id);
            if (
              !t ||
              t.course_id !== h.course_id ||
              t.state !== 'SCHEDULED' ||
              !['ENROLLING', 'RUNNING'].includes(t.cohort_state) ||
              new Date(t.starts_at) <= new Date(s.db_now)
            )
              trainingFail('MAKEUP_INELIGIBLE', '补课须选择同课程尚未开课的有效课次');
            if (
              (
                await c.query(
                  "SELECT 1 FROM training_lesson_entitlements WHERE enrollment_id=$1 AND current_session_id=$2 AND id<>$3 AND state NOT IN('REFUNDED','MAKEUP_DUE')",
                  [n.id, target, id],
                )
              ).rowCount
            )
              trainingFail('DUPLICATE_LESSON', '不可重复使用同一课次');
            const th = await this.cohort(c, t.cohort_id);
            if (!(await this.eligible(c, th)) || !(await this.sessionRoom(c, target)))
              trainingFail('MAKEUP_FULL', '补课资格或容量不足');
            if (!(await this.eligibleMakeupSessions(c, n, e, target)).length)
              trainingFail('MAKEUP_UNAVAILABLE', '所选课次、名额或本人档期已变化，请重新选择');
            await this.reserveLearner(c, n, t);
            await c.query(
              "UPDATE training_lesson_entitlements SET current_session_id=$2,state='AVAILABLE',version=version+1 WHERE id=$1",
              [id, target],
            );
          } else {
            if (e.state !== 'AVAILABLE' || s.state !== 'DELIVERED')
              trainingFail('CONSUMPTION_NOT_READY', '需先完成实际授课');
            if (
              !(
                await c.query(
                  "SELECT 1 FROM training_attendance WHERE entitlement_id=$1 AND session_id=$2 AND action='CHECKIN'",
                  [id, s.id],
                )
              ).rowCount
            )
              trainingFail('ATTENDANCE_REQUIRED', '缺少独立签到事实');
            if (!v.reason) trainingFail('REASON_REQUIRED', '请填写课次消费依据');
            const cid = randomUUID();
            await c.query(
              'INSERT INTO training_consumptions(id,org_id,entitlement_id,proposed_by,reason) VALUES($1,$2,$3,$4,$5)',
              [cid, org, id, a.user.id, v.reason],
            );
            await c.query(
              "UPDATE training_lesson_entitlements SET state='CONSUMPTION_PENDING',version=version+1 WHERE id=$1",
              [id],
            );
            await this.log(c, a, org, cid, 'CONSUMPTION_PROPOSED');
            return { enrollmentId: n.id, consumptionId: cid };
          }
          await this.log(c, a, org, id, v.action, {
            reason: v.reason,
            sessionId: v.sessionId ?? s.id,
          });
          return { enrollmentId: n.id };
        }),
      true,
    );
  }
  async consumptionCommand(cookie: string | undefined, id: string, raw: unknown) {
    const org = await this.ref('training_consumptions', id),
      v = parseTrainingAction(raw, [
        'REVIEW',
        'REJECT',
        'ACKNOWLEDGE',
        'DISPUTE',
        'RESOLVE_UPHOLD',
        'RESOLVE_ADJUST',
      ]);
    return this.write(
      cookie,
      org,
      async (c, a) =>
        this.receipt(c, a, v.commandId, { op: 'CONSUMPTION', id, ...v }, async () => {
          const x = (
              await c.query('SELECT * FROM training_consumptions WHERE id=$1 FOR UPDATE', [id])
            ).rows[0],
            e = (
              await c.query('SELECT * FROM training_lesson_entitlements WHERE id=$1 FOR UPDATE', [
                x.entitlement_id,
              ])
            ).rows[0],
            n = await this.enrollment(c, e.enrollment_id, true);
          trainingVersion(x.version, v.expectedVersion);
          let state = x.status,
            es = e.state,
            reviewer = x.reviewed_by,
            ack = x.acknowledged_by,
            finalization = x.finalization_reason;
          if (['REVIEW', 'REJECT'].includes(v.action)) {
            await this.manager(c, a, org);
            if (x.status !== 'PROPOSED') trainingFail('INVALID_STATE', '仅待复核消费可以复核');
            if (
              [x.proposed_by, n.learner_user_id, n.payer_user_id].includes(a.user.id) ||
              (
                await c.query(
                  'SELECT 1 FROM training_session_coaches sc JOIN training_coaches t ON t.id=sc.coach_id WHERE sc.session_id=$1 AND t.user_id=$2',
                  [e.current_session_id, a.user.id],
                )
              ).rowCount
            )
              trainingFail(
                'INDEPENDENT_REVIEW_REQUIRED',
                '授课、学员和付款相关人员不能复核消费',
                403,
              );
            if (!v.reason) trainingFail('REASON_REQUIRED', '请填写复核依据');
            reviewer = a.user.id;
            state = v.action === 'REVIEW' ? 'REVIEWED' : 'REJECTED';
            if (state === 'REJECTED') es = 'AVAILABLE';
          } else if (v.action === 'ACKNOWLEDGE') {
            if (n.learner_user_id !== a.user.id) throw forbidden();
            if (x.status !== 'REVIEWED')
              trainingFail('INDEPENDENT_REVIEW_REQUIRED', '需完成独立复核后才能确认消费');
            state = 'FINALIZED';
            es = 'CONSUMED';
            ack = a.user.id;
            finalization = 'USER_CONFIRMED';
          } else if (v.action === 'DISPUTE') {
            if (![n.learner_user_id, n.payer_user_id].includes(a.user.id)) throw forbidden();
            if (!['PROPOSED', 'REVIEWED', 'FINALIZED'].includes(x.status))
              trainingFail('INVALID_STATE', '当前消费不可重复异议');
            if (!v.reason) trainingFail('REASON_REQUIRED', '请填写异议事实');
            state = 'DISPUTED';
            es = 'CONSUMPTION_PENDING';
          } else {
            await this.operator(c, a);
            if (x.status !== 'DISPUTED') trainingFail('INVALID_STATE', '只有异议中的消费可裁决');
            if (
              [
                x.proposed_by,
                x.reviewed_by,
                n.learner_user_id,
                n.payer_user_id,
                n.terms_snapshot.beneficiaryId,
              ].includes(a.user.id)
            )
              trainingFail(
                'INDEPENDENT_REVIEW_REQUIRED',
                '原经办、复核及利益相关人员不能裁决',
                403,
              );
            if (!v.reason) trainingFail('REASON_REQUIRED', '请填写裁决依据');
            state = v.action === 'RESOLVE_UPHOLD' ? 'FINALIZED' : 'ADJUSTED';
            es = state === 'FINALIZED' ? 'CONSUMED' : 'MAKEUP_DUE';
            reviewer = a.user.id;
            finalization = 'INDEPENDENT_RESOLUTION';
          }
          await c.query(
            'UPDATE training_consumptions SET status=$2,reviewed_by=$3,acknowledged_by=$4,finalization_reason=$5,dispute_reason=CASE WHEN $6 THEN $7 ELSE dispute_reason END,version=version+1 WHERE id=$1',
            [id, state, reviewer, ack, finalization, v.action === 'DISPUTE', v.reason],
          );
          await c.query(
            'UPDATE training_lesson_entitlements SET state=$2,version=version+1 WHERE id=$1',
            [e.id, es],
          );
          if (es === 'MAKEUP_DUE')
            await c.query(
              'UPDATE training_resource_reservations SET active=false WHERE enrollment_id=$1 AND session_id=$2',
              [n.id, e.current_session_id],
            );
          if (
            !(
              await c.query(
                "SELECT 1 FROM training_lesson_entitlements WHERE enrollment_id=$1 AND state NOT IN('CONSUMED','REFUNDED') LIMIT 1",
                [n.id],
              )
            ).rowCount
          )
            await c.query(
              "UPDATE training_enrollments SET state='COMPLETED',version=version+1 WHERE id=$1 AND state='CONFIRMED'",
              [n.id],
            );
          if (['MAKEUP_DUE', 'CONSUMPTION_PENDING'].includes(es) && n.state === 'COMPLETED')
            await c.query(
              "UPDATE training_enrollments SET state='CONFIRMED',version=version+1 WHERE id=$1",
              [n.id],
            );
          if (['MAKEUP_DUE', 'CONSUMPTION_PENDING'].includes(es))
            await c.query(
              `UPDATE training_cohorts SET state='SUSPENDED',version=version+1 WHERE state='COMPLETED'
               AND (id=$1 OR id=(SELECT cohort_id FROM training_sessions WHERE id=$2))`,
              [n.cohort_id, e.current_session_id],
            );
          await this.log(c, a, org, id, 'CONSUMPTION_' + v.action, {
            reason: v.reason,
            previousStatus: x.status,
            state,
          });
          return { enrollmentId: n.id, consumptionId: id };
        }),
      true,
    );
  }
  async requestRefund(cookie: string | undefined, id: string, raw: unknown) {
    const org = await this.ref('training_enrollments', id),
      v = objectInput(raw, ['commandId', 'expectedVersion', 'entitlementIds', 'reason']);
    const commandId = trainingCommand(v.commandId),
      version = expectedVersion(v.expectedVersion),
      reason = text(v.reason, 'reason', 4, 1000);
    if (
      !Array.isArray(v.entitlementIds) ||
      v.entitlementIds.length < 1 ||
      v.entitlementIds.length > 8
    )
      trainingFail('REFUND_LESSONS_REQUIRED', '请选择1–8个未消费课次', 400);
    const ids = v.entitlementIds.map(trainingId).sort();
    if (new Set(ids).size !== ids.length) trainingFail('DUPLICATE_LESSON', '退款课次不能重复', 400);
    return this.write(
      cookie,
      org,
      async (c, a) => {
        const n = await this.enrollment(c, id, true);
        if (n.payer_user_id !== a.user.id) await this.manager(c, a, org);
        return this.receipt(
          c,
          a,
          commandId,
          { op: 'REFUND_REQUEST', id, version, ids, reason },
          async () => {
            trainingVersion(n.version, version);
            if (!['CONFIRMED', 'PAID_UNALLOCATED'].includes(n.state))
              trainingFail('REFUND_NOT_READY', '报名未取得服务或真实付款结果');
            const es = (
              await c.query(
                'SELECT * FROM training_lesson_entitlements WHERE enrollment_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
                [id, ids],
              )
            ).rows;
            if (
              es.length !== ids.length ||
              es.some((e) => !['AVAILABLE', 'MAKEUP_DUE'].includes(e.state))
            )
              trainingFail('REFUND_LESSON_UNAVAILABLE', '仅未消费且未冻结课次可退款');
            const amount = es.reduce((a, e) => a + e.net_fen, 0);
            if (amount > 0) {
              if (!this.training.trade || !n.trade_order_id)
                trainingFail('PAID_TRAINING_UNAVAILABLE', '须由真实交易系统核对退款');
              const p = await this.training.trade.payment(c, id);
              const reserved = Number(
                (
                  await c.query(
                    "SELECT coalesce(sum(amount_fen),0)::int AS amount FROM training_refund_allocations WHERE enrollment_id=$1 AND status IN('PENDING_REVIEW','PENDING','UNKNOWN')",
                    [id],
                  )
                ).rows[0]!.amount,
              );
              if (p.status !== 'PAID' || amount + reserved > p.paidFen - p.refundedFen)
                trainingFail('REFUND_LIMIT', '可退实付不足或支付结果待核对');
            }
            const rid = randomUUID();
            await c.query(
              'INSERT INTO training_refund_allocations(id,org_id,enrollment_id,entitlement_ids,amount_fen,proposed_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [rid, org, id, ids, amount, a.user.id, reason],
            );
            await c.query(
              "UPDATE training_lesson_entitlements SET state='REFUND_PENDING',version=version+1 WHERE id=ANY($1::uuid[])",
              [ids],
            );
            await c.query(
              'UPDATE training_resource_reservations SET active=false WHERE enrollment_id=$1 AND session_id=ANY($2::uuid[])',
              [id, es.map((e) => e.current_session_id)],
            );
            await c.query('UPDATE training_enrollments SET version=version+1 WHERE id=$1', [id]);
            await this.log(c, a, org, rid, 'REFUND_PROPOSED', {
              entitlementIds: ids,
              amountFen: amount,
            });
            return { enrollmentId: id, allocationId: rid };
          },
        );
      },
      true,
    );
  }
  async refundCommand(cookie: string | undefined, id: string, raw: unknown) {
    const org = await this.ref('training_refund_allocations', id),
      v = parseTrainingAction(raw, ['APPROVE', 'REJECT', 'REFRESH']);
    return this.write(
      cookie,
      org,
      async (c, a) =>
        this.receipt(c, a, v.commandId, { op: 'REFUND_COMMAND', id, ...v }, async () => {
          const r = (
              await c.query('SELECT * FROM training_refund_allocations WHERE id=$1 FOR UPDATE', [
                id,
              ])
            ).rows[0],
            n = await this.enrollment(c, r.enrollment_id, true);
          trainingVersion(r.version, v.expectedVersion);
          let status = r.status;
          if (v.action === 'REFRESH') {
            await this.access(c, a, n);
            if (!r.trade_refund_id || !['PENDING', 'UNKNOWN'].includes(r.status))
              trainingFail('REFUND_NOT_PENDING', '没有待核对退款');
            if (!this.training.trade)
              trainingFail('PAID_TRAINING_UNAVAILABLE', '退款回执暂不可读取');
            status = await this.training.trade.refundStatus(c, r.trade_refund_id);
          } else {
            await this.manager(c, a, org);
            if (r.status !== 'PENDING_REVIEW') trainingFail('INVALID_STATE', '退款已处理');
            if ([r.proposed_by, n.payer_user_id, n.learner_user_id].includes(a.user.id))
              trainingFail('INDEPENDENT_REVIEW_REQUIRED', '申请人及学员付款人不能复核退款', 403);
            if (!v.reason) trainingFail('REASON_REQUIRED', '请填写复核依据');
            status =
              v.action === 'REJECT'
                ? 'REJECTED'
                : r.amount_fen === 0
                  ? 'COMPLETED_ZERO'
                  : 'PENDING';
            await c.query(
              'UPDATE training_refund_allocations SET reviewed_by=$2,status=$3 WHERE id=$1',
              [id, a.user.id, status],
            );
            if (v.action === 'APPROVE' && r.amount_fen > 0) {
              if (!this.training.trade)
                trainingFail('PAID_TRAINING_UNAVAILABLE', '真实退款能力未开放');
              const result = await this.training.trade.refund(c, a, {
                enrollmentId: n.id,
                allocationId: id,
                amountFen: r.amount_fen,
                reason: r.reason,
              });
              status = result.status;
              await c.query(
                'UPDATE training_refund_allocations SET trade_refund_id=$2 WHERE id=$1',
                [id, result.refundId],
              );
            }
          }
          await c.query(
            'UPDATE training_refund_allocations SET status=$2,version=version+1 WHERE id=$1',
            [id, status],
          );
          if (['SUCCEEDED', 'COMPLETED_ZERO', 'FAILED', 'REJECTED'].includes(status)) {
            await c.query(
              'UPDATE training_lesson_entitlements SET state=$2,version=version+1 WHERE id=ANY($1::uuid[])',
              [
                r.entitlement_ids,
                ['SUCCEEDED', 'COMPLETED_ZERO'].includes(status) ? 'REFUNDED' : 'MAKEUP_DUE',
              ],
            );
            if (
              !(
                await c.query(
                  "SELECT 1 FROM training_lesson_entitlements WHERE enrollment_id=$1 AND state<>'REFUNDED' LIMIT 1",
                  [n.id],
                )
              ).rowCount
            )
              await c.query(
                "UPDATE training_enrollments SET state='CANCELLED',version=version+1 WHERE id=$1",
                [n.id],
              );
          }
          if (
            !(
              await c.query(
                "SELECT 1 FROM training_lesson_entitlements WHERE enrollment_id=$1 AND state NOT IN('CONSUMED','REFUNDED') LIMIT 1",
                [n.id],
              )
            ).rowCount
          )
            await c.query(
              "UPDATE training_enrollments SET state='COMPLETED',version=version+1 WHERE id=$1 AND state='CONFIRMED'",
              [n.id],
            );
          await this.log(c, a, org, id, 'REFUND_' + v.action, { status, reason: v.reason });
          return { enrollmentId: n.id, allocationId: id };
        }),
      true,
    );
  }
  async commandReceipt(cookie: string | undefined, id: string) {
    id = trainingCommand(id);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        r = (
          await c.query(
            'SELECT command_id,result,created_at FROM training_command_receipts WHERE actor_id=$1 AND command_id=$2',
            [a.user.id, id],
          )
        ).rows[0];
      await this.ensureFreshSession(c, a);
      return r ?? { command_id: id, pending: true };
    });
  }
}
