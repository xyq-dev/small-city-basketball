import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  YouthGuardianRequestData,
  YouthPurpose,
} from '../../../packages/contracts/youth-guardians.js';
import { ApplicationService, isAdministrator } from './service.js';
import type { Actor, ApiOptions } from './service.js';
import { forbidden, notFound } from './errors.js';
import { objectInput, text } from './validation.js';
import {
  participantKey,
  participantKeyId,
  sanitizeParticipantFile,
} from './participant-materials-domain.js';
import type { ParticipantFileInput } from './participant-materials-domain.js';
import {
  ageOn,
  guardianText,
  guardianRequestRequired,
  identityBirthDate,
  openGuardian,
  sealGuardian,
  YOUTH_DATA_TERMS_VERSION,
  YOUTH_TERMS_VERSION,
  youthCommand,
  youthFail,
  youthFingerprint,
  youthId,
  youthPolicyInput,
  youthPurposes,
  youthVersion,
} from './youth-guardians-domain.js';
import {
  readYouthDataProcessingConsent,
  readYouthEligibility,
} from './youth-guardians-eligibility.js';
import type {
  YouthEligibilityInput,
  YouthQualificationReader,
} from './youth-guardians-eligibility.js';

type Row = Record<string, any>;
type Context = { actor: Actor; orgId: string; event: Row; today: string };
export interface YouthGuardianOptions extends ApiOptions {
  youthQualificationReader?: YouthQualificationReader;
}
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
const simpleHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const version = (row: Row, expected: number) => {
  if (row.version !== expected) youthFail('VERSION_CONFLICT', '资料已变化，请重新读取后确认');
};
const activeStatuses = ['AWAITING_GUARDIAN', 'AWAITING_REVIEW', 'APPROVED'];
const cursorTime = 'to_char(created_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\')';
function pageQuery(raw: unknown, scope: string) {
  const b = objectInput(raw ?? {}, ['cursor', 'limit']);
  const limit = b.limit === undefined ? 20 : Number(b.limit);
  if (
    (b.limit !== undefined && !['string', 'number'].includes(typeof b.limit)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    youthFail('YOUTH_INPUT_INVALID', '分页数量无效', 422);
  let cursor: { time: string; id: string; kind: string } | null = null;
  if (b.cursor !== undefined) {
    if (
      typeof b.cursor !== 'string' ||
      b.cursor.length > 1200 ||
      !/^[A-Za-z0-9_-]+$/.test(b.cursor)
    )
      youthFail('YOUTH_CURSOR_INVALID', '请重新读取列表', 422);
    try {
      const values = JSON.parse(Buffer.from(b.cursor as string, 'base64url').toString('utf8'));
      if (
        !Array.isArray(values) ||
        values.length !== 4 ||
        values[0] !== scope ||
        typeof values[1] !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(values[1]) ||
        !['REQUEST', 'DATA'].includes(values[3])
      )
        throw new Error();
      cursor = { time: values[1], id: youthId(values[2]), kind: values[3] };
    } catch {
      youthFail('YOUTH_CURSOR_INVALID', '请重新读取列表', 422);
    }
  }
  return { limit, cursor };
}
const nextCursor = (scope: string, row: Row | undefined) =>
  row
    ? Buffer.from(JSON.stringify([scope, row.cursor_time, row.id, row.kind ?? 'REQUEST'])).toString(
        'base64url',
      )
    : null;
/** Youth processing consent, participation consent and publication purposes are independent grants. */
export class YouthGuardiansService extends ApplicationService {
  private readonly reader?: YouthQualificationReader;
  private readonly rawKey?: string;
  constructor(pool: Pool, options: YouthGuardianOptions) {
    super(pool, options);
    this.reader = options.youthQualificationReader;
    this.rawKey = options.participantDataKey;
  }
  private key() {
    return participantKey(this.rawKey);
  }
  private async context(
    c: PoolClient,
    actor: Actor,
    org: string,
    event: string,
    write = false,
    security = false,
  ): Promise<Context> {
    const orgId = youthId(org),
      eventId = youthId(event);
    const o = (await c.query(`SELECT id,status FROM organizations WHERE id=$1 FOR SHARE`, [orgId]))
      .rows[0];
    if (!o || (!security && o.status !== 'ACTIVE')) throw notFound();
    const e = (
      await c.query(
        `SELECT e.*,e.start_date::text,e.end_date::text,to_char(clock_timestamp() AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS today FROM events e WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'} OF e`,
        [orgId, eventId],
      )
    ).rows[0];
    if (!e) throw notFound();
    return { actor, orgId, event: e, today: e.today };
  }
  private async manager(c: PoolClient, a: Context, request?: Row) {
    const m = (
      await c.query(
        'SELECT role,status FROM organization_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE',
        [a.orgId, a.actor.user.id],
      )
    ).rows[0];
    const s = (
      await c.query(
        'SELECT role,status FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 FOR SHARE',
        [a.orgId, a.event.id, a.actor.user.id],
      )
    ).rows[0];
    const allowed =
      m?.status === 'ACTIVE' &&
      (isAdministrator(m.role) ||
        (s?.status === 'ACTIVE' && ['EVENT_MANAGER', 'REVIEWER'].includes(s.role)));
    if (!allowed) return false;
    if (request) {
      if ([request.subject_user_id, request.guardian_user_id].includes(a.actor.user.id))
        return false;
      await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
        a.orgId,
        request.team_id,
      ]);
      const associated = await c.query(
        `SELECT 1 FROM team_access_grants WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE'
    UNION ALL SELECT 1 FROM team_member_bindings WHERE org_id=$1 AND team_id=$2 AND user_id=$3 AND status='ACTIVE' LIMIT 1`,
        [a.orgId, request.team_id, a.actor.user.id],
      );
      if (associated.rowCount) return false;
    }
    return true;
  }
  private async boundSubject(c: PoolClient, a: Context) {
    return Boolean(
      (
        await c.query(
          `SELECT 1 FROM entries e JOIN team_member_bindings b ON b.org_id=e.org_id AND b.team_id=e.team_id AND b.status='ACTIVE'
   JOIN team_members m ON m.org_id=b.org_id AND m.team_id=b.team_id AND m.id=b.member_id AND m.status='ACTIVE'
   WHERE e.org_id=$1 AND e.event_id=$2 AND e.status NOT IN('WITHDRAWN','REJECTED') AND b.user_id=$3 LIMIT 1`,
          [a.orgId, a.event.id, a.actor.user.id],
        )
      ).rowCount,
    );
  }
  private async policyRow(c: PoolClient, a: Context) {
    return (
      (
        await c.query('SELECT * FROM youth_event_policies WHERE org_id=$1 AND event_id=$2', [
          a.orgId,
          a.event.id,
        ])
      ).rows[0] ?? null
    );
  }
  private policyDto(p: Row | null) {
    return {
      enabled: p?.enabled === true,
      version: p?.version ?? 0,
      guardianAgeThreshold: p?.guardian_age_threshold ?? 18,
      termsVersion: p?.terms_version ?? YOUTH_TERMS_VERSION,
      dataTermsVersion: YOUTH_DATA_TERMS_VERSION,
    };
  }
  private async fresh(c: PoolClient, a: Context, parties?: Row) {
    await this.ensureFreshSession(c, a.actor);
    if (parties) {
      const count = (
        await c.query(
          "SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[]) AND status='ACTIVE'",
          [[parties.subject_user_id, parties.guardian_user_id]],
        )
      ).rows[0]!.n;
      if (count !== 2) youthFail('YOUTH_ACCOUNT_INACTIVE', '当前本人或监护账号已失效');
    }
  }
  private async replay(c: PoolClient, a: Context, id: string, hash: string) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `youth-command:${a.actor.user.id}:${id}`,
    ]);
    const r = (
      await c.query(
        'SELECT * FROM youth_guardian_commands WHERE actor_id=$1 AND client_request_id=$2',
        [a.actor.user.id, id],
      )
    ).rows[0];
    if (!r) return null;
    if (r.org_id !== a.orgId || r.event_id !== a.event.id || r.request_hash !== hash)
      youthFail('REQUEST_CONFLICT', '原操作编号内容不同');
    await this.fresh(c, a);
    return r.result;
  }
  private async complete(
    c: PoolClient,
    a: Context,
    id: string,
    hash: string,
    requestId: string | null,
    result: Row,
    action: string,
  ) {
    await c.query(
      'INSERT INTO youth_guardian_commands(actor_id,client_request_id,org_id,event_id,request_id,request_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [a.actor.user.id, id, a.orgId, a.event.id, requestId, hash, JSON.stringify(result)],
    );
    await this.audit(
      c,
      a.actor.user.id,
      a.orgId,
      action,
      'youth_guardian',
      requestId ?? a.event.id,
      { eventId: a.event.id },
    );
    await this.fresh(c, a);
    return result;
  }
  private async history(c: PoolClient, a: Context, r: Row, action: string) {
    await c.query(
      'INSERT INTO youth_guardian_history(id,request_id,version,actor_id,action,facts) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [
        randomUUID(),
        r.id,
        r.version,
        a.actor.user.id,
        action,
        JSON.stringify({
          status: r.status,
          policyVersion: r.policy_version,
          guardianPayloadVersion: r.guardian_payload_version,
        }),
      ],
    );
  }
  private async dataHistory(c: PoolClient, a: Context, r: Row, action: string) {
    await c.query(
      'INSERT INTO youth_preconsent_history(id,preconsent_id,version,actor_id,action) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), r.id, r.version, a.actor.user.id, action],
    );
  }
  private writable(a: Context) {
    if (!['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(a.event.status))
      youthFail('YOUTH_EVENT_CLOSED', '当前赛事不接受新的监护确认');
  }
  private async keyCheck(c: PoolClient, key: Buffer) {
    const mismatch = await c.query(
      'SELECT 1 FROM youth_guardian_requests WHERE guardian_payload_ciphertext IS NOT NULL AND guardian_key_id<>$1 LIMIT 1',
      [participantKeyId(key)],
    );
    if (mismatch.rowCount)
      youthFail('YOUTH_KEY_MISMATCH', '监护证明安全存储配置与已有材料不一致', 503);
  }
  async policy(cookie: string | undefined, org: string, event: string) {
    return this.transaction(async (c) => {
      const a = await this.context(c, await this.lockActor(c, cookie), org, event);
      const manager = await this.manager(c, a);
      const relatedGuardian = Boolean(
        (
          await c.query(
            `SELECT 1 FROM youth_guardian_preconsents WHERE org_id=$1 AND event_id=$2 AND guardian_user_id=$3 UNION ALL SELECT 1 FROM youth_guardian_requests WHERE org_id=$1 AND event_id=$2 AND guardian_user_id=$3 LIMIT 1`,
            [a.orgId, a.event.id, a.actor.user.id],
          )
        ).rowCount,
      );
      if (!manager && !(await this.boundSubject(c, a)) && !relatedGuardian) throw notFound();
      await this.fresh(c, a);
      return {
        event: { id: a.event.id, name: a.event.name, status: a.event.status },
        policy: this.policyDto(await this.policyRow(c, a)),
        capabilities: {
          canConfigure: manager && a.event.status === 'DRAFT',
          canInviteData:
            ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(a.event.status) &&
            (await this.boundSubject(c, a)),
        },
      };
    });
  }
  async setPolicy(cookie: string | undefined, org: string, event: string, raw: unknown) {
    const p = youthPolicyInput(raw),
      hash = simpleHash(['POLICY', p]);
    return this.transaction(async (c) => {
      const a = await this.context(c, await this.lockActor(c, cookie), org, event, true);
      if (!(await this.manager(c, a))) throw forbidden();
      const old = await this.replay(c, a, p.clientRequestId, hash);
      if (old) return old;
      if (a.event.status !== 'DRAFT' || a.event.locked_ruleset_id)
        youthFail('YOUTH_POLICY_LOCKED', '青年规则须在开放报名前明确配置');
      const previous = await this.policyRow(c, a);
      if ((previous?.version ?? null) !== p.expectedVersion)
        youthFail('VERSION_CONFLICT', '规则已变化，请重新读取');
      if (p.enabled) {
        const r = (
          await c.query(
            'SELECT require_participant_materials FROM event_rulesets WHERE org_id=$1 AND event_id=$2 AND id=$3',
            [a.orgId, a.event.id, a.event.current_ruleset_id],
          )
        ).rows[0];
        if (!r?.require_participant_materials)
          youthFail('YOUTH_MATERIALS_REQUIRED', '青年流程须先启用本人资料及照片');
        await this.keyCheck(c, this.key());
      }
      const r = (
        await c.query(
          `INSERT INTO youth_event_policies(org_id,event_id,enabled,guardian_age_threshold,terms_version,updated_by) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(org_id,event_id) DO UPDATE SET enabled=EXCLUDED.enabled,guardian_age_threshold=EXCLUDED.guardian_age_threshold,terms_version=EXCLUDED.terms_version,updated_by=EXCLUDED.updated_by,version=youth_event_policies.version+1,updated_at=clock_timestamp() RETURNING *`,
          [
            a.orgId,
            a.event.id,
            p.enabled,
            p.guardianAgeThreshold,
            YOUTH_TERMS_VERSION,
            a.actor.user.id,
          ],
        )
      ).rows[0];
      return this.complete(
        c,
        a,
        p.clientRequestId,
        hash,
        null,
        { policy: this.policyDto(r) },
        'YOUTH_POLICY_CONFIGURED',
      );
    });
  }
  async inviteData(cookie: string | undefined, org: string, event: string, raw: unknown) {
    const b = objectInput(raw, [
        'clientRequestId',
        'expectedPolicyVersion',
        'guardianUserId',
        'subjectAlias',
        'declaredYouth',
      ]),
      id = youthId(b.clientRequestId),
      guardian = youthId(b.guardianUserId),
      policyVersion = youthVersion(b.expectedPolicyVersion),
      alias = text(b.subjectAlias, 'subjectAlias', 1, 40);
    if (b.declaredYouth !== true)
      youthFail('YOUTH_DECLARATION_REQUIRED', '请选择青年报名入口；年龄声明不替代后续核验', 422);
    const hash = simpleHash(['DATA_INVITE', guardian, policyVersion, alias]);
    return this.transaction(async (c) => {
      const a = await this.context(c, await this.lockActor(c, cookie), org, event, true);
      this.writable(a);
      if (!(await this.boundSubject(c, a))) throw notFound();
      const replay = await this.replay(c, a, id, hash);
      if (replay) return replay;
      const policy = await this.policyRow(c, a);
      if (!policy?.enabled || policy.version !== policyVersion)
        youthFail('YOUTH_POLICY_REQUIRED', '请先读取当前青年规则');
      if (
        guardian === a.actor.user.id ||
        !(await c.query("SELECT 1 FROM users WHERE id=$1 AND status='ACTIVE'", [guardian])).rowCount
      )
        youthFail('GUARDIAN_ACCOUNT_UNAVAILABLE', '请核对独立监护账号', 422);
      if (
        (
          await c.query(
            "SELECT 1 FROM youth_guardian_preconsents WHERE org_id=$1 AND event_id=$2 AND subject_user_id=$3 AND status IN('INVITED','CONSENTED')",
            [a.orgId, a.event.id, a.actor.user.id],
          )
        ).rowCount
      )
        youthFail('GUARDIAN_DATA_INVITE_EXISTS', '请先核对或撤回原监护数据邀请');
      const r = (
        await c.query(
          `INSERT INTO youth_guardian_preconsents(id,org_id,event_id,subject_user_id,guardian_user_id,subject_alias,policy_version,data_terms_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            randomUUID(),
            a.orgId,
            a.event.id,
            a.actor.user.id,
            guardian,
            alias,
            policyVersion,
            YOUTH_DATA_TERMS_VERSION,
          ],
        )
      ).rows[0];
      await this.dataHistory(c, a, r, 'INVITE');
      await this.fresh(c, a, r);
      return this.complete(
        c,
        a,
        id,
        hash,
        null,
        { preconsentId: r.id, version: r.version },
        'YOUTH_DATA_INVITED',
      );
    });
  }
  private async preAccess(
    c: PoolClient,
    actor: Actor,
    id: string,
    write = false,
    security = false,
  ) {
    const route = (
      await c.query(
        'SELECT org_id,event_id FROM youth_guardian_preconsents WHERE id=$1 AND (subject_user_id=$2 OR guardian_user_id=$2)',
        [youthId(id), actor.user.id],
      )
    ).rows[0];
    if (!route) throw notFound();
    const a = await this.context(c, actor, route.org_id, route.event_id, write, security);
    const row = (
      await c.query(
        `SELECT * FROM youth_guardian_preconsents WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`,
        [id],
      )
    ).rows[0];
    if (!row || ![row.subject_user_id, row.guardian_user_id].includes(actor.user.id))
      throw notFound();
    return { a, row };
  }
  async dataDecision(cookie: string | undefined, requestId: string, raw: unknown) {
    const { b, id, expectedVersion } = youthCommand(raw, [
      'decision',
      'acceptedDataProcessing',
      'dataTermsVersion',
    ]);
    if (!['CONSENT', 'DECLINE', 'WITHDRAW'].includes(String(b.decision)))
      youthFail('YOUTH_INPUT_INVALID', '请选择同意、拒绝或撤回', 422);
    const hash = simpleHash([
      'DATA_DECISION',
      requestId,
      b.decision,
      b.acceptedDataProcessing,
      b.dataTermsVersion,
      expectedVersion,
    ]);
    return this.transaction(async (c) => {
      const { a, row } = await this.preAccess(
        c,
        await this.lockActor(c, cookie),
        requestId,
        true,
        b.decision === 'WITHDRAW',
      );
      const replay = await this.replay(c, a, id, hash);
      if (replay) return replay;
      version(row, expectedVersion);
      if (b.decision !== 'WITHDRAW') {
        this.writable(a);
        if (a.actor.user.id !== row.guardian_user_id) throw forbidden();
        if (row.status !== 'INVITED') youthFail('YOUTH_CONSENT_STATE', '当前邀请不能重复确认');
        const policy = await this.policyRow(c, a);
        if (!policy?.enabled || policy.version !== row.policy_version)
          youthFail('GUARDIAN_SOURCE_CHANGED', '青年规则已变化');
        if (
          b.decision === 'CONSENT' &&
          (b.acceptedDataProcessing !== true || b.dataTermsVersion !== YOUTH_DATA_TERMS_VERSION)
        )
          youthFail('YOUTH_DATA_CONSENT_REQUIRED', '请监护人明确同意本届必要资料处理', 422);
        await this.fresh(c, a, row);
      }
      const r = (
        await c.query(
          `UPDATE youth_guardian_preconsents SET status=$2,guardian_confirmed_at=CASE WHEN $2='CONSENTED' THEN clock_timestamp() ELSE guardian_confirmed_at END,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
          [
            requestId,
            b.decision === 'CONSENT'
              ? 'CONSENTED'
              : b.decision === 'DECLINE'
                ? 'DECLINED'
                : 'WITHDRAWN',
          ],
        )
      ).rows[0];
      await this.dataHistory(c, a, r, String(b.decision));
      if (b.decision === 'WITHDRAW') {
        const affected = (
          await c.query(
            "UPDATE youth_guardian_requests SET status='WITHDRAWN',version=version+1,updated_at=clock_timestamp() WHERE preconsent_id=$1 AND status<>'WITHDRAWN' RETURNING *",
            [requestId],
          )
        ).rows;
        for (const current of affected) await this.history(c, a, current, 'WITHDRAW');
      }
      return this.complete(
        c,
        a,
        id,
        hash,
        null,
        { preconsentId: requestId, version: r.version },
        'YOUTH_DATA_' + b.decision,
      );
    });
  }
  private async qualification(c: PoolClient, a: Context, entryId: string, memberId: string) {
    const e = (
      await c.query('SELECT * FROM entries WHERE org_id=$1 AND event_id=$2 AND id=$3', [
        a.orgId,
        a.event.id,
        youthId(entryId),
      ])
    ).rows[0];
    if (!e?.roster_revision_id) throw notFound();
    const input: YouthEligibilityInput = {
      orgId: a.orgId,
      eventId: a.event.id,
      entryId,
      memberId: youthId(memberId),
      rosterRevisionId: e.roster_revision_id,
      rulesetId: e.ruleset_id,
      policyDate: a.event.start_date,
    };
    if (!this.reader) youthFail('YOUTH_QUALIFICATION_UNAVAILABLE', '资格预审服务尚未接入', 503);
    const q = await this.reader!(c, input);
    return { entry: e, input, q };
  }
  private async currentSource(c: PoolClient, a: Context, r: Row) {
    const { entry, input, q } = await this.qualification(c, a, r.entry_id, r.member_id);
    const policy = await this.policyRow(c, a),
      data = await readYouthDataProcessingConsent(c, {
        orgId: a.orgId,
        eventId: a.event.id,
        userId: r.subject_user_id,
        forceRequired: true,
      });
    if (
      !q.ready ||
      !q.birthDate ||
      q.subjectUserId !== r.subject_user_id ||
      q.materialId !== r.material_id ||
      q.materialRevisionId !== r.material_revision_id ||
      q.qualificationId !== r.qualification_id ||
      entry.roster_revision_id !== r.roster_revision_id ||
      entry.ruleset_id !== r.ruleset_id ||
      !policy?.enabled ||
      policy.version !== r.policy_version ||
      policy.terms_version !== r.terms_version ||
      !data.ready ||
      data.preconsentId !== r.preconsent_id ||
      data.version !== r.preconsent_version ||
      data.guardianUserId !== r.guardian_user_id ||
      !guardianRequestRequired({
        birthDate: q.birthDate,
        policyDate: a.event.start_date,
        processingDate: a.today,
        threshold: policy.guardian_age_threshold,
        purposes: r.subject_purposes,
      })
    )
      youthFail('GUARDIAN_SOURCE_CHANGED', '本人资料、资格预审或监护同意已变化，请重新办理');
    return input;
  }
  async propose(cookie: string | undefined, org: string, event: string, raw: unknown) {
    const b = objectInput(raw, [
      'clientRequestId',
      'entryId',
      'memberId',
      'expectedPolicyVersion',
      'acceptedTerms',
      'termsVersion',
      'publicityConsent',
      'archiveConsent',
      'liveConsent',
    ]);
    const id = youthId(b.clientRequestId),
      entryId = youthId(b.entryId),
      memberId = youthId(b.memberId),
      expectedPolicy = youthVersion(b.expectedPolicyVersion);
    if (b.acceptedTerms !== true || b.termsVersion !== YOUTH_TERMS_VERSION)
      youthFail('YOUTH_CONSENT_REQUIRED', '请本人阅读并同意本届参赛规则', 422);
    const purposes = youthPurposes({
        publicityConsent: b.publicityConsent,
        archiveConsent: b.archiveConsent,
        liveConsent: b.liveConsent,
      }),
      hash = simpleHash(['PROPOSE', entryId, memberId, expectedPolicy, purposes]);
    return this.transaction(async (c) => {
      const a = await this.context(c, await this.lockActor(c, cookie), org, event, true);
      this.writable(a);
      const source = await this.qualification(c, a, entryId, memberId),
        q = source.q;
      if (q.subjectUserId !== a.actor.user.id) throw notFound();
      const old = await this.replay(c, a, id, hash);
      if (old) return old;
      const policy = await this.policyRow(c, a);
      if (!policy?.enabled || policy.version !== expectedPolicy)
        youthFail('VERSION_CONFLICT', '青年规则已变化');
      if (!q.ready || !q.birthDate || !q.materialId || !q.materialRevisionId || !q.qualificationId)
        youthFail('YOUTH_QUALIFICATION_REQUIRED', '请先完成独立资格预审');
      if (
        !guardianRequestRequired({
          birthDate: q.birthDate!,
          policyDate: a.event.start_date,
          processingDate: a.today,
          threshold: policy.guardian_age_threshold,
          purposes,
        })
      )
        youthFail('GUARDIAN_NOT_REQUIRED', '当前已核验年龄不需要本赛事监护确认');
      const data = await readYouthDataProcessingConsent(c, {
        orgId: a.orgId,
        eventId: a.event.id,
        userId: a.actor.user.id,
        forceRequired: true,
      });
      if (!data.ready) youthFail('YOUTH_DATA_CONSENT_REQUIRED', '请先由监护人确认必要资料处理');
      if (
        (
          await c.query(
            'SELECT 1 FROM youth_guardian_requests WHERE org_id=$1 AND event_id=$2 AND entry_id=$3 AND member_id=$4 AND status=ANY($5::text[])',
            [a.orgId, a.event.id, entryId, memberId, activeStatuses],
          )
        ).rowCount
      )
        youthFail('GUARDIAN_REQUEST_EXISTS', '请先核对或撤回原监护申请');
      const r = (
        await c.query(
          `INSERT INTO youth_guardian_requests(id,org_id,event_id,team_id,entry_id,member_id,subject_user_id,guardian_user_id,material_id,material_revision_id,qualification_id,preconsent_id,preconsent_version,roster_revision_id,ruleset_id,policy_version,terms_version,subject_confirmed_at,subject_purposes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,clock_timestamp(),$18::text[]) RETURNING *`,
          [
            randomUUID(),
            a.orgId,
            a.event.id,
            source.entry.team_id,
            entryId,
            memberId,
            a.actor.user.id,
            data.guardianUserId,
            q.materialId,
            q.materialRevisionId,
            q.qualificationId,
            data.preconsentId,
            data.version,
            source.entry.roster_revision_id,
            source.entry.ruleset_id,
            policy.version,
            YOUTH_TERMS_VERSION,
            purposes,
          ],
        )
      ).rows[0];
      await this.history(c, a, r, 'PROPOSE');
      await this.fresh(c, a, r);
      return this.complete(
        c,
        a,
        id,
        hash,
        r.id,
        { requestId: r.id, version: r.version },
        'YOUTH_GUARDIAN_PROPOSED',
      );
    });
  }
  private async requestAccess(
    c: PoolClient,
    actor: Actor,
    id: string,
    write = false,
    security = false,
  ) {
    const route = (
      await c.query('SELECT org_id,event_id FROM youth_guardian_requests WHERE id=$1', [
        youthId(id),
      ])
    ).rows[0];
    if (!route) throw notFound();
    const a = await this.context(c, actor, route.org_id, route.event_id, write, security);
    const r = (
      await c.query(
        `SELECT * FROM youth_guardian_requests WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`,
        [id],
      )
    ).rows[0];
    if (!r) throw notFound();
    const party = [r.subject_user_id, r.guardian_user_id].includes(actor.user.id),
      reviewer = await this.manager(c, a, r);
    if (!party && !reviewer) throw notFound();
    return { a, row: r, reviewer };
  }
  async guardianConfirm(cookie: string | undefined, requestId: string, raw: unknown) {
    // Authorize before decoding potentially large proof bytes, then reauthorize after asynchronous image processing.
    const today = await this.transaction(async (c) => {
      const { a, row } = await this.requestAccess(c, await this.lockActor(c, cookie), requestId);
      if (row.guardian_user_id !== a.actor.user.id) throw forbidden();
      await this.fresh(c, a);
      return a.today;
    });
    const p = guardianText(raw, today),
      proof = await sanitizeParticipantFile(p.proof as ParticipantFileInput, 'insurance');
    return this.transaction(async (c) => {
      const { a, row } = await this.requestAccess(
        c,
        await this.lockActor(c, cookie),
        requestId,
        true,
      );
      if (row.guardian_user_id !== a.actor.user.id) throw forbidden();
      this.writable(a);
      const key = this.key();
      await this.keyCheck(c, key);
      const hash = youthFingerprint(key, [
        'GUARDIAN_CONFIRM',
        requestId,
        p.expectedVersion,
        p.realName,
        p.identityNumber,
        p.relationship,
        p.relationshipExplanation,
        proof.sha256,
        p.purposes,
      ]);
      const old = await this.replay(c, a, p.clientRequestId, hash);
      if (old) return old;
      version(row, p.expectedVersion);
      if (!['AWAITING_GUARDIAN', 'AWAITING_REVIEW', 'APPROVED'].includes(row.status))
        youthFail('YOUTH_CONSENT_STATE', '原监护申请已撤回');
      await this.currentSource(c, a, row);
      guardianText(raw, a.today);
      const next = row.guardian_payload_version + 1,
        payload = {
          realName: p.realName,
          identityNumber: p.identityNumber,
          relationship: p.relationship,
          relationshipExplanation: p.relationshipExplanation,
          proof,
        };
      const cipher = sealGuardian(payload, key, a.orgId, requestId, row.guardian_user_id, next),
        bytes = Buffer.byteLength(cipher);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `youth-proof-quota:${a.orgId}`,
      ]);
      const usage = Number(
        (
          await c.query(
            'SELECT COALESCE(sum(guardian_payload_bytes),0)::bigint AS n FROM youth_guardian_requests WHERE org_id=$1 AND guardian_payload_ciphertext IS NOT NULL',
            [a.orgId],
          )
        ).rows[0]!.n,
      );
      if (usage - row.guardian_payload_bytes + bytes > 128 * 1024 * 1024)
        youthFail('YOUTH_STORAGE_LIMIT', '监护证明存储额度已满', 422);
      const r = (
        await c.query(
          `UPDATE youth_guardian_requests SET status='AWAITING_REVIEW',guardian_confirmed_at=clock_timestamp(),guardian_purposes=$2::text[],guardian_payload_version=$3,guardian_payload_ciphertext=$4,guardian_payload_bytes=$5,guardian_payload_hash=$6,guardian_key_id=$7,proof_purged_at=NULL,reviewed_payload_version=NULL,guardian_identity_checked=false,relationship_checked=false,guardian_adult_checked=false,reviewer_id=NULL,review_reason=NULL,reviewed_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
          [
            requestId,
            p.purposes,
            next,
            cipher,
            bytes,
            youthFingerprint(key, payload),
            participantKeyId(key),
          ],
        )
      ).rows[0];
      await this.history(c, a, r, 'GUARDIAN_CONFIRM');
      await this.currentSource(c, a, r);
      await this.fresh(c, a, r);
      return this.complete(
        c,
        a,
        p.clientRequestId,
        hash,
        r.id,
        { requestId: r.id, version: r.version },
        'YOUTH_GUARDIAN_CONFIRMED',
      );
    });
  }
  async review(cookie: string | undefined, requestId: string, raw: unknown) {
    const { b, id, expectedVersion } = youthCommand(raw, [
      'decision',
      'reason',
      'identityChecked',
      'relationshipChecked',
    ]);
    if (!['APPROVE', 'REJECT'].includes(String(b.decision)))
      youthFail('YOUTH_INPUT_INVALID', '请选择审核结论', 422);
    const reason = text(b.reason, 'reason', 4, 500),
      hash = simpleHash([
        'REVIEW',
        requestId,
        expectedVersion,
        b.decision,
        reason,
        b.identityChecked,
        b.relationshipChecked,
      ]);
    return this.transaction(async (c) => {
      const { a, row, reviewer } = await this.requestAccess(
        c,
        await this.lockActor(c, cookie),
        requestId,
        true,
      );
      if (!reviewer) throw forbidden();
      this.writable(a);
      const old = await this.replay(c, a, id, hash);
      if (old) return old;
      version(row, expectedVersion);
      if (row.status !== 'AWAITING_REVIEW')
        youthFail('YOUTH_CONSENT_STATE', '仅待独立审核的监护材料可以处理');
      await this.currentSource(c, a, row);
      const approved = b.decision === 'APPROVE';
      if (approved) {
        if (b.identityChecked !== true || b.relationshipChecked !== true)
          youthFail('GUARDIAN_CHECKS_REQUIRED', '请独立核验监护身份、成年和关系证明', 422);
        const payload = this.proof(row);
        if (ageOn(identityBirthDate(payload.identityNumber, a.today), a.today) < 18)
          youthFail('GUARDIAN_ADULT_REQUIRED', '监护人当前身份未符合成年要求', 422);
      }
      const r = (
        await c.query(
          `UPDATE youth_guardian_requests SET status=$2,reviewer_id=$3,review_reason=$4,reviewed_at=clock_timestamp(),reviewed_payload_version=guardian_payload_version,guardian_identity_checked=$5,relationship_checked=$5,guardian_adult_checked=$5,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
          [requestId, approved ? 'APPROVED' : 'REJECTED', a.actor.user.id, reason, approved],
        )
      ).rows[0];
      await this.history(c, a, r, approved ? 'REVIEW_APPROVE' : 'REVIEW_REJECT');
      await this.currentSource(c, a, r);
      await this.fresh(c, a, r);
      return this.complete(
        c,
        a,
        id,
        hash,
        r.id,
        { requestId: r.id, version: r.version },
        approved ? 'YOUTH_REVIEW_APPROVED' : 'YOUTH_REVIEW_REJECTED',
      );
    });
  }
  async withdraw(cookie: string | undefined, requestId: string, raw: unknown) {
    const { id, expectedVersion } = youthCommand(raw, []),
      hash = simpleHash(['WITHDRAW', requestId, expectedVersion]);
    return this.transaction(async (c) => {
      const { a, row } = await this.requestAccess(
        c,
        await this.lockActor(c, cookie),
        requestId,
        true,
        true,
      );
      if (![row.subject_user_id, row.guardian_user_id].includes(a.actor.user.id)) throw forbidden();
      const old = await this.replay(c, a, id, hash);
      if (old) return old;
      version(row, expectedVersion);
      const r = (
        await c.query(
          "UPDATE youth_guardian_requests SET status='WITHDRAWN',version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
          [requestId],
        )
      ).rows[0];
      await this.history(c, a, r, 'WITHDRAW');
      return this.complete(
        c,
        a,
        id,
        hash,
        row.id,
        { requestId: row.id, version: r.version },
        'YOUTH_GUARDIAN_WITHDRAWN',
      );
    });
  }
  private proof(row: Row) {
    if (!row.guardian_payload_ciphertext || row.proof_purged_at)
      youthFail('YOUTH_PROOF_UNAVAILABLE', '监护证明已清除或尚未提交', 404);
    const key = this.key();
    if (participantKeyId(key) !== row.guardian_key_id)
      youthFail('YOUTH_KEY_MISMATCH', '监护证明安全存储配置不匹配', 503);
    return openGuardian(
      row.guardian_payload_ciphertext,
      key,
      row.org_id,
      row.id,
      row.guardian_user_id,
      row.guardian_payload_version,
    );
  }
  private async dto(
    c: PoolClient,
    a: Context,
    r: Row,
    reviewer: boolean,
  ): Promise<YouthGuardianRequestData> {
    const names = (
      await c.query('SELECT id,display_name FROM users WHERE id=ANY($1::uuid[])', [
        [r.subject_user_id, r.guardian_user_id],
      ])
    ).rows;
    let blockers: string[] = [];
    try {
      await this.currentSource(c, a, r);
    } catch {
      blockers = ['GUARDIAN_SOURCE_CHANGED'];
    }
    const healthy = blockers.length === 0,
      open = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(a.event.status),
      party =
        r.subject_user_id === a.actor.user.id
          ? 'SUBJECT'
          : r.guardian_user_id === a.actor.user.id
            ? 'GUARDIAN'
            : 'REVIEWER';
    return {
      id: r.id,
      orgId: r.org_id,
      eventId: r.event_id,
      eventName: a.event.name,
      entryId: r.entry_id,
      memberId: r.member_id,
      subjectName: names.find((n) => n.id === r.subject_user_id)?.display_name ?? '本人',
      guardianName: names.find((n) => n.id === r.guardian_user_id)?.display_name ?? '监护人',
      version: r.version,
      status: r.status,
      role: party,
      policyVersion: r.policy_version,
      termsVersion: r.terms_version,
      guardianPayloadVersion: r.guardian_payload_version,
      subjectPurposes: r.subject_purposes,
      guardianPurposes: r.guardian_purposes,
      subjectConfirmed: !!r.subject_confirmed_at,
      guardianConfirmed: !!r.guardian_confirmed_at,
      reviewReason: r.review_reason,
      current: healthy,
      blockers,
      capabilities: {
        canConfirm:
          party === 'GUARDIAN' &&
          open &&
          healthy &&
          ['AWAITING_GUARDIAN', 'AWAITING_REVIEW', 'APPROVED'].includes(r.status),
        canReview: reviewer && open && healthy && r.status === 'AWAITING_REVIEW',
        canWithdraw: party !== 'REVIEWER' && r.status !== 'WITHDRAWN',
        canReadProof:
          (party === 'GUARDIAN' || reviewer) &&
          !!r.guardian_payload_ciphertext &&
          !r.proof_purged_at,
      },
    };
  }
  async detail(cookie: string | undefined, requestId: string) {
    return this.transaction(async (c) => {
      const { a, row, reviewer } = await this.requestAccess(
        c,
        await this.lockActor(c, cookie),
        requestId,
        false,
        false,
      );
      const value = await this.dto(c, a, row, reviewer);
      await this.fresh(c, a);
      return value;
    });
  }
  async workspace(cookie: string | undefined, raw: unknown = {}) {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        scope = 'mine:' + actor.user.id,
        { limit, cursor } = pageQuery(raw, scope);
      const rows = (
        await c.query(
          `SELECT *,${cursorTime} AS cursor_time FROM (
     SELECT r.id,r.created_at,'REQUEST'::text AS kind FROM youth_guardian_requests r JOIN organizations o ON o.id=r.org_id AND o.status='ACTIVE' WHERE r.subject_user_id=$1 OR r.guardian_user_id=$1
     UNION ALL SELECT p.id,p.created_at,'DATA'::text AS kind FROM youth_guardian_preconsents p JOIN organizations o ON o.id=p.org_id AND o.status='ACTIVE' WHERE p.subject_user_id=$1 OR p.guardian_user_id=$1) x
     WHERE ($2::timestamptz IS NULL OR (created_at,id,kind)<($2::timestamptz,$3::uuid,$4::text)) ORDER BY created_at DESC,id DESC,kind DESC LIMIT $5`,
          [
            actor.user.id,
            cursor?.time ?? null,
            cursor?.id ?? null,
            cursor?.kind ?? null,
            limit + 1,
          ],
        )
      ).rows;
      const chosen = rows.slice(0, limit),
        requests: YouthGuardianRequestData[] = [],
        preconsents: Row[] = [];
      for (const item of chosen) {
        if (item.kind === 'REQUEST') {
          const { a, row, reviewer } = await this.requestAccess(c, actor, item.id);
          requests.push(await this.dto(c, a, row, reviewer));
        } else {
          const { a, row: r } = await this.preAccess(c, actor, item.id);
          const guardian = (
            await c.query('SELECT display_name FROM users WHERE id=$1', [r.guardian_user_id])
          ).rows[0];
          preconsents.push({
            id: r.id,
            orgId: r.org_id,
            eventId: r.event_id,
            eventName: a.event.name,
            subjectAlias: r.subject_alias,
            guardianName: guardian?.display_name ?? '监护人',
            role: r.subject_user_id === actor.user.id ? 'SUBJECT' : 'GUARDIAN',
            status: r.status,
            version: r.version,
            policyVersion: r.policy_version,
            dataTermsVersion: r.data_terms_version,
            guardianConfirmedAt: iso(r.guardian_confirmed_at),
          });
        }
      }
      await this.ensureFreshSession(c, actor);
      return {
        requests,
        preconsents,
        nextCursor: rows.length > limit ? nextCursor(scope, chosen.at(-1)) : null,
      };
    });
  }
  async reviewQueue(cookie: string | undefined, org: string, event: string, raw: unknown = {}) {
    return this.transaction(async (c) => {
      const a = await this.context(c, await this.lockActor(c, cookie), org, event);
      if (!(await this.manager(c, a))) throw notFound();
      const scope = 'review:' + a.actor.user.id + ':' + a.orgId + ':' + a.event.id,
        { limit, cursor } = pageQuery(raw, scope);
      const rows = (
        await c.query(
          `SELECT *,${cursorTime} AS cursor_time FROM youth_guardian_requests WHERE org_id=$1 AND event_id=$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5`,
          [a.orgId, a.event.id, cursor?.time ?? null, cursor?.id ?? null, limit + 1],
        )
      ).rows;
      const chosen = rows.slice(0, limit),
        requests = [];
      for (const r of chosen) requests.push(await this.dto(c, a, r, await this.manager(c, a, r)));
      await this.fresh(c, a);
      return {
        requests,
        policy: this.policyDto(await this.policyRow(c, a)),
        nextCursor: rows.length > limit ? nextCursor(scope, chosen.at(-1)) : null,
      };
    });
  }
  async privateData(cookie: string | undefined, requestId: string) {
    return this.transaction(async (c) => {
      const { a, row, reviewer } = await this.requestAccess(
        c,
        await this.lockActor(c, cookie),
        requestId,
      );
      if (a.actor.user.id !== row.guardian_user_id && !reviewer) throw forbidden();
      const p = this.proof(row);
      await this.audit(
        c,
        a.actor.user.id,
        a.orgId,
        'YOUTH_PRIVATE_PROOF_READ',
        'youth_guardian',
        row.id,
        {},
      );
      await this.fresh(c, a);
      return {
        realName: p.realName,
        identityNumber: p.identityNumber,
        relationship: p.relationship,
        relationshipExplanation: p.relationshipExplanation,
        proof: {
          fileName: p.proof.fileName,
          contentType: p.proof.contentType,
          byteLength: p.proof.byteLength,
          sha256: p.proof.sha256,
        },
      };
    });
  }
  async proofFile(cookie: string | undefined, requestId: string) {
    return this.transaction(async (c) => {
      const { a, row, reviewer } = await this.requestAccess(
        c,
        await this.lockActor(c, cookie),
        requestId,
      );
      if (a.actor.user.id !== row.guardian_user_id && !reviewer) throw forbidden();
      const p = this.proof(row).proof;
      await this.audit(
        c,
        a.actor.user.id,
        a.orgId,
        'YOUTH_PRIVATE_PROOF_DOWNLOAD',
        'youth_guardian',
        row.id,
        {},
      );
      await this.fresh(c, a);
      return {
        body: Buffer.from(p.base64, 'base64'),
        contentType: p.contentType,
        fileName: p.fileName,
        attachment: p.contentType === 'application/pdf',
      };
    });
  }
  async purgeProof(cookie: string | undefined, requestId: string, raw: unknown) {
    const { id, expectedVersion } = youthCommand(raw, []),
      hash = simpleHash(['PURGE_PROOF', requestId, expectedVersion]);
    return this.transaction(async (c) => {
      const { a, row, reviewer } = await this.requestAccess(
        c,
        await this.lockActor(c, cookie),
        requestId,
        true,
        true,
      );
      if (!reviewer) throw forbidden();
      const old = await this.replay(c, a, id, hash);
      if (old) return old;
      version(row, expectedVersion);
      const allowed = (
        await c.query(
          "SELECT clock_timestamp()>((end_date+90)::timestamp AT TIME ZONE timezone) AS ok FROM events WHERE org_id=$1 AND id=$2 AND status IN('ARCHIVED','CANCELLED')",
          [a.orgId, a.event.id],
        )
      ).rows[0]?.ok;
      if (!allowed || row.legal_hold)
        youthFail('YOUTH_RETENTION_ACTIVE', '监护材料仍在必要保留期或争议留存中');
      const r = (
        await c.query(
          "UPDATE youth_guardian_requests SET status='WITHDRAWN',guardian_payload_ciphertext=NULL,proof_purged_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
          [requestId],
        )
      ).rows[0];
      await this.history(c, a, r, 'PURGE_PROOF');
      return this.complete(
        c,
        a,
        id,
        hash,
        r.id,
        { requestId: r.id, version: r.version },
        'YOUTH_PROOF_PURGED',
      );
    });
  }
  async receipt(cookie: string | undefined, commandId: string) {
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      const r = (
        await c.query(
          'SELECT result FROM youth_guardian_commands WHERE actor_id=$1 AND client_request_id=$2',
          [actor.user.id, youthId(commandId)],
        )
      ).rows[0];
      await this.ensureFreshSession(c, actor);
      return { found: !!r, result: r?.result ?? null };
    });
  }
}
