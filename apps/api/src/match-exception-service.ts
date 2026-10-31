import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApplicationService, EVENT_SELECT, isAdministrator } from './service.js';
import type { OrgActor } from './service.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { resourceId } from './validation.js';
import {
  administrativeOutcome,
  exceptionFail,
  exceptionHash,
  exceptionProposalInput,
  exceptionReviewInput,
  exceptionRulesInput,
} from './match-exception-domain.js';

type Row = Record<string, any>;
type Access = { ctx: OrgActor; event: Row; match: Row | null; manager: boolean };
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
const equalVersion = (actual: number, expected: number) => {
  if (actual !== expected) exceptionFail('VERSION_CONFLICT', '资料已更新，请重新读取');
};
export class MatchExceptionService extends ApplicationService {
  private async access(
    c: PoolClient,
    cookie: string | undefined,
    org: string,
    id: string,
    matchScope: boolean,
    write = false,
  ): Promise<Access> {
    const ctx = await this.lockOrganization(c, await this.lockActor(c, cookie), org);
    let eventId = resourceId(id);
    if (matchScope) {
      const r = await c.query<Row>(
        'SELECT event_id FROM published_matches WHERE org_id=$1 AND id=$2',
        [ctx.orgId, eventId],
      );
      if (!r.rows[0]) throw notFound();
      eventId = r.rows[0].event_id;
    }
    const e = await c.query<Row>(
      `SELECT ${EVENT_SELECT} FROM events e WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'} OF e`,
      [ctx.orgId, eventId],
    );
    if (!e.rows[0]) throw notFound();
    const staff = await c.query<Row>(
      "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
      [ctx.orgId, eventId, ctx.user.id],
    );
    const manager = isAdministrator(ctx.role) || staff.rows[0]?.role === 'EVENT_MANAGER';
    let match: Row | null = null;
    if (matchScope) {
      const m = await c.query<Row>(
        `SELECT * FROM published_matches WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`,
        [ctx.orgId, id],
      );
      match = m.rows[0] ?? null;
      if (!match) throw notFound();
    }
    const allowed =
      manager ||
      (match &&
        Boolean(
          (
            await c.query('SELECT x02_can_adjudicate($1,$2,$3,$4) AS ok', [
              ctx.orgId,
              eventId,
              id,
              ctx.user.id,
            ])
          ).rows[0]?.ok,
        ));
    if (!allowed) throw notFound();
    return { ctx, event: e.rows[0], match, manager };
  }
  /** Recheck natural expiry after every row-lock wait, including read/replay responses. */
  private async fresh<T>(c: PoolClient, a: Access, response: T): Promise<T> {
    await this.ensureFreshSession(c, a.ctx);
    return response;
  }
  private rulesDto(r: Row | null) {
    return r
      ? {
          id: r.id,
          eventId: r.event_id,
          version: r.version,
          forfeitWinPoints: r.forfeit_win_points,
          forfeitLossPoints: r.forfeit_loss_points,
          cancellationPolicy: r.cancellation_policy,
        }
      : null;
  }
  private requestDto(r: Row) {
    return {
      id: r.id,
      matchId: r.match_id,
      version: r.version,
      operation: r.operation,
      kind: r.kind,
      forfeitingSide: r.forfeiting_side,
      status: r.status,
      sourceMatchVersion: r.source_match_version,
      sourceHeadVersion: r.source_head_version,
      targetAdjudicationId: r.target_adjudication_id,
      winnerEntryId: r.winner_entry_id,
      loserEntryId: r.loser_entry_id,
      rulesId: r.rules_id,
      rulesVersion: r.rules_version,
      proposedBy: r.proposed_by,
      reason: r.reason,
      reviewedBy: r.reviewed_by,
      reviewReason: r.review_reason,
      createdAt: iso(r.created_at),
      reviewedAt: iso(r.reviewed_at),
    };
  }
  private async rules(c: PoolClient, a: Access) {
    return (
      (
        await c.query<Row>(
          'SELECT * FROM match_exception_rules WHERE org_id=$1 AND event_id=$2 FOR SHARE',
          [a.ctx.orgId, a.event.id],
        )
      ).rows[0] ?? null
    );
  }
  private async head(c: PoolClient, a: Access, write = false) {
    return (
      (
        await c.query<Row>(
          `SELECT * FROM match_exception_heads WHERE org_id=$1 AND match_id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`,
          [a.ctx.orgId, a.match!.id],
        )
      ).rows[0] ?? null
    );
  }
  private async current(c: PoolClient, a: Access, h: Row | null) {
    return h?.active_request_id
      ? ((
          await c.query<Row>('SELECT * FROM match_exception_requests WHERE org_id=$1 AND id=$2', [
            a.ctx.orgId,
            h.active_request_id,
          ])
        ).rows[0] ?? null)
      : null;
  }
  private async independent(c: PoolClient, a: Access, proposer: string) {
    return Boolean(
      (
        await c.query('SELECT x02_independent_reviewer($1,$2,$3,$4,$5) AS ok', [
          a.ctx.orgId,
          a.event.id,
          a.match!.id,
          a.ctx.user.id,
          proposer,
        ])
      ).rows[0]?.ok,
    );
  }
  private async view(c: PoolClient, a: Access) {
    const rules = await this.rules(c, a),
      head = await this.head(c, a),
      active = await this.current(c, a, head);
    administrativeOutcome(a.match as any, {
      checked: true,
      head: head as any,
      request: active,
      rules,
    });
    const requests = (
      await c.query<Row>(
        'SELECT * FROM match_exception_requests WHERE org_id=$1 AND match_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50',
        [a.ctx.orgId, a.match!.id],
      )
    ).rows;
    const pending = requests.find((r) => r.status === 'PENDING');
    const unstarted = await this.unstarted(c, a, false);
    const live = ['SCHEDULED', 'RUNNING'].includes(a.event.status);
    return this.fresh(c, a, {
      event: { id: a.event.id, version: a.event.version, status: a.event.status },
      match: { id: a.match!.id, version: a.match!.version, status: a.match!.status },
      rules: this.rulesDto(rules),
      active: active ? this.requestDto(active) : null,
      requests: requests.map((r) => this.requestDto(r)),
      capabilities: {
        canPropose: live && unstarted && !!rules && !pending && !active,
        canRevoke: live && unstarted && !!active && !pending,
        canReview: !!pending && (await this.independent(c, a, pending.proposed_by)),
      },
    });
  }
  private async replay(c: PoolClient, a: Access, client: string, fingerprint: string) {
    const r = (
      await c.query<Row>(
        'SELECT * FROM match_exception_receipts WHERE user_id=$1 AND client_request_id=$2',
        [a.ctx.user.id, client],
      )
    ).rows[0];
    if (!r) return null;
    if (
      r.org_id !== a.ctx.orgId ||
      r.event_id !== a.event.id ||
      r.match_id !== (a.match?.id ?? null) ||
      r.request_fingerprint !== fingerprint
    )
      exceptionFail('IDEMPOTENCY_CONFLICT', '操作编号已用于其他内容');
    return this.fresh(c, a, r.response);
  }
  private async receipt(
    c: PoolClient,
    a: Access,
    client: string,
    fingerprint: string,
    action: string,
    response: Row,
  ) {
    await c.query(
      'INSERT INTO match_exception_receipts(user_id,client_request_id,org_id,event_id,match_id,request_fingerprint,action,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        a.ctx.user.id,
        client,
        a.ctx.orgId,
        a.event.id,
        a.match?.id ?? null,
        fingerprint,
        action,
        response,
      ],
    );
    return this.fresh(c, a, response);
  }
  private async unstarted(c: PoolClient, a: Access, fail = true) {
    const m = a.match!;
    const r = await c.query<Row>(
      `SELECT EXISTS(SELECT 1 FROM scoring_events WHERE org_id=$1 AND match_id=$2 AND type='START_MATCH') AS started,to_jsonb(s) AS state,
  EXISTS(SELECT 1 FROM knockout_round_publications WHERE org_id=$1 AND event_id=$3 AND sources @> jsonb_build_array(jsonb_build_object('matchId',$2::text))) OR EXISTS(SELECT 1 FROM group_qualification_publications WHERE org_id=$1 AND event_id=$3 AND sources @> jsonb_build_array(jsonb_build_object('matchId',$2::text))) AS consumed FROM (SELECT 1) x LEFT JOIN scoring_states s ON s.org_id=$1 AND s.match_id=$2`,
      [a.ctx.orgId, m.id, a.event.id],
    );
    const x = r.rows[0]!;
    const ok =
      !x.started &&
      !x.consumed &&
      ((m.status === 'SCHEDULED' && !x.state) ||
        (m.status === 'READY' &&
          x.state?.source_version === m.version &&
          x.state?.clock_running === false));
    if (!ok && fail)
      exceptionFail(
        x.consumed ? 'KNOCKOUT_RESULT_CONSUMED' : 'MATCH_ALREADY_STARTED',
        x.consumed ? '裁定已被下一轮消费，当前不能直接撤回' : '只允许裁定从未开赛的比赛',
      );
    return ok;
  }
  private async execute<T>(fn: (c: PoolClient) => Promise<T>) {
    try {
      return await this.transaction(fn);
    } catch (e: any) {
      if (e?.code === '23505') exceptionFail('EXCEPTION_PENDING', '本场已有待处理提案或操作编号');
      if (e?.code === '23514')
        exceptionFail('EXCEPTION_SOURCE_CHANGED', '裁定条件已改变，请刷新后操作');
      throw e;
    }
  }
  async getRules(cookie: string | undefined, org: string, event: string) {
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, event, false);
      return this.fresh(c, a, {
        event: { id: a.event.id, version: a.event.version, status: a.event.status },
        rules: this.rulesDto(await this.rules(c, a)),
        canEdit: a.manager && a.event.status === 'DRAFT',
      });
    });
  }
  async setRules(cookie: string | undefined, org: string, event: string, raw: unknown) {
    const input = exceptionRulesInput(raw),
      fingerprint = exceptionHash({ action: 'RULES', event, input });
    return this.execute(async (c) => {
      const a = await this.access(c, cookie, org, event, false, true);
      if (!a.manager) throw forbidden();
      const replay = await this.replay(c, a, input.clientRequestId, fingerprint);
      if (replay) return replay;
      equalVersion(a.event.version, input.expectedEventVersion);
      if (a.event.status !== 'DRAFT')
        exceptionFail('EXCEPTION_RULES_LOCKED', '异常规则须在草稿阶段显式配置');
      const old = await this.rules(c, a);
      equalVersion(old?.version ?? 0, input.expectedVersion);
      const id = old?.id ?? randomUUID(),
        v = (old?.version ?? 0) + 1;
      if (old)
        await c.query(
          'UPDATE match_exception_rules SET version=$3,forfeit_win_points=$4,forfeit_loss_points=$5,updated_by=$6,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
          [a.ctx.orgId, id, v, input.forfeitWinPoints, input.forfeitLossPoints, a.ctx.user.id],
        );
      else
        await c.query(
          'INSERT INTO match_exception_rules(id,org_id,event_id,forfeit_win_points,forfeit_loss_points,cancellation_policy,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7)',
          [
            id,
            a.ctx.orgId,
            event,
            input.forfeitWinPoints,
            input.forfeitLossPoints,
            input.cancellationPolicy,
            a.ctx.user.id,
          ],
        );
      await c.query(
        'UPDATE events SET version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
        [a.ctx.orgId, event],
      );
      await this.audit(c, a.ctx.user.id, a.ctx.orgId, 'match-exception.rules', 'event', event, {
        rulesId: id,
        version: v,
      });
      return this.receipt(c, a, input.clientRequestId, fingerprint, 'RULES', {
        rulesId: id,
        version: v,
        eventVersion: a.event.version + 1,
      });
    });
  }
  async get(cookie: string | undefined, org: string, match: string) {
    return this.transaction(async (c) =>
      this.view(c, await this.access(c, cookie, org, match, true)),
    );
  }
  async propose(cookie: string | undefined, org: string, match: string, raw: unknown) {
    const input = exceptionProposalInput(raw),
      fingerprint = exceptionHash({ action: 'PROPOSE', match, input });
    return this.execute(async (c) => {
      const a = await this.access(c, cookie, org, match, true, true);
      const replay = await this.replay(c, a, input.clientRequestId, fingerprint);
      if (replay) return replay;
      equalVersion(a.event.version, input.expectedEventVersion);
      equalVersion(a.match!.version, input.expectedMatchVersion);
      if (!['SCHEDULED', 'RUNNING'].includes(a.event.status))
        exceptionFail('INVALID_EVENT_STATE', '只允许裁定已发布且进行中的赛事');
      await this.unstarted(c, a);
      const rules = await this.rules(c, a);
      if (!rules) exceptionFail('EXCEPTION_RULES_REQUIRED', '发布前未配置异常规则，当前不能裁定');
      await c.query(
        'INSERT INTO match_exception_heads(org_id,event_id,match_id) VALUES($1,$2,$3) ON CONFLICT(org_id,match_id) DO NOTHING',
        [a.ctx.orgId, a.event.id, match],
      );
      const h = (await this.head(c, a, true))!,
        active = await this.current(c, a, h);
      if (input.operation === 'DECLARE' && active)
        exceptionFail('MATCH_ADJUDICATED', '请先撤回已有裁定');
      if (
        input.operation === 'REVOKE' &&
        (!active ||
          active.id !== input.targetAdjudicationId ||
          active.kind !== input.kind ||
          active.forfeiting_side !== input.forfeitingSide)
      )
        exceptionFail('EXCEPTION_SOURCE_CHANGED', '撤回须引用当前完整裁定');
      const winner =
          input.kind === 'FORFEIT'
            ? input.forfeitingSide === 'HOME'
              ? a.match!.away_entry_id
              : a.match!.home_entry_id
            : null,
        loser =
          input.kind === 'FORFEIT'
            ? input.forfeitingSide === 'HOME'
              ? a.match!.home_entry_id
              : a.match!.away_entry_id
            : null,
        id = randomUUID();
      await c.query(
        `INSERT INTO match_exception_requests(id,org_id,event_id,match_id,rules_id,rules_version,source_match_version,source_head_version,operation,kind,forfeiting_side,winner_entry_id,loser_entry_id,target_adjudication_id,proposed_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          id,
          a.ctx.orgId,
          a.event.id,
          match,
          rules!.id,
          rules!.version,
          a.match!.version,
          h.version,
          input.operation,
          input.kind,
          input.forfeitingSide,
          winner,
          loser,
          input.targetAdjudicationId,
          a.ctx.user.id,
          input.reason,
        ],
      );
      await this.audit(c, a.ctx.user.id, a.ctx.orgId, 'match-exception.proposed', 'match', match, {
        requestId: id,
        operation: input.operation,
        kind: input.kind,
        reason: input.reason,
      });
      return this.receipt(c, a, input.clientRequestId, fingerprint, 'PROPOSE', { requestId: id });
    });
  }
  async review(
    cookie: string | undefined,
    org: string,
    match: string,
    request: string,
    raw: unknown,
  ) {
    resourceId(request);
    const input = exceptionReviewInput(raw),
      fingerprint = exceptionHash({ action: 'REVIEW', match, request, input });
    return this.execute(async (c) => {
      const a = await this.access(c, cookie, org, match, true, true),
        replay = await this.replay(c, a, input.clientRequestId, fingerprint);
      if (replay) return replay;
      equalVersion(a.event.version, input.expectedEventVersion);
      equalVersion(a.match!.version, input.expectedMatchVersion);
      const r = (
        await c.query<Row>(
          'SELECT * FROM match_exception_requests WHERE org_id=$1 AND match_id=$2 AND id=$3 FOR UPDATE',
          [a.ctx.orgId, match, request],
        )
      ).rows[0];
      if (!r) throw notFound();
      equalVersion(r.version, input.expectedRequestVersion);
      if (r.status !== 'PENDING') exceptionFail('EXCEPTION_ALREADY_REVIEWED', '提案已经审核');
      // Serialize team membership and access decisions with their existing team mutex.
      await c.query(
        'SELECT id FROM teams WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
        [a.ctx.orgId, [a.match!.home_team_id, a.match!.away_team_id]],
      );
      if (!(await this.independent(c, a, r.proposed_by)))
        exceptionFail('INDEPENDENT_REVIEW_REQUIRED', '须由未参赛、未操作本场的另一名有权人员审核');
      const h = await this.head(c, a, true);
      if (input.type === 'APPROVE') {
        if (!['SCHEDULED', 'RUNNING'].includes(a.event.status))
          exceptionFail('INVALID_EVENT_STATE', '已结束赛事不能批准裁定');
        await this.unstarted(c, a);
        equalVersion(a.match!.version, r.source_match_version);
        equalVersion(h?.version ?? 0, r.source_head_version);
        if (
          !Boolean(
            (
              await c.query('SELECT x02_can_adjudicate($1,$2,$3,$4) AS ok', [
                a.ctx.orgId,
                a.event.id,
                match,
                r.proposed_by,
              ])
            ).rows[0]?.ok,
          )
        )
          exceptionFail('EXCEPTION_PROPOSER_UNAUTHORIZED', '提议者当前授权已失效，请驳回后重提');
      }
      await c.query(
        `UPDATE match_exception_requests SET status=$4,version=version+1,reviewed_by=$5,review_reason=$6,reviewed_at=clock_timestamp(),review_transaction_id=pg_current_xact_id(),review_event_version=$7 WHERE org_id=$1 AND match_id=$2 AND id=$3`,
        [
          a.ctx.orgId,
          match,
          request,
          input.type === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          a.ctx.user.id,
          input.reason,
          a.event.version,
        ],
      );
      if (input.type === 'APPROVE') {
        await c.query(
          'UPDATE match_exception_heads SET version=version+1,active_request_id=$3 WHERE org_id=$1 AND match_id=$2',
          [a.ctx.orgId, match, r.operation === 'DECLARE' ? request : null],
        );
        await c.query(
          'UPDATE events SET version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
          [a.ctx.orgId, a.event.id],
        );
      }
      await this.audit(
        c,
        a.ctx.user.id,
        a.ctx.orgId,
        `match-exception.${input.type.toLowerCase()}`,
        'match',
        match,
        { requestId: request, operation: r.operation, kind: r.kind, reason: input.reason },
      );
      return this.receipt(c, a, input.clientRequestId, fingerprint, 'REVIEW', {
        requestId: request,
        status: input.type === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        eventVersion: a.event.version + (input.type === 'APPROVE' ? 1 : 0),
      });
    });
  }
}
