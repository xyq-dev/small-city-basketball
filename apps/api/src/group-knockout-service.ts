import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  EventGroupKnockoutData,
  KnockoutBracket,
  GroupKnockoutConfig,
} from '@small-city-basketball/contracts';
import { KnockoutService } from './knockout-service.js';
import type { EventAccess, RevisionRow } from './scheduling-service.js';
import type { OrgActor } from './service.js';
import { ApiError, forbidden } from './errors.js';
import { objectInput, invalid } from './validation.js';
import { expectedVersion } from './registration-validation.js';
import {
  calculateGroupKnockout,
  generateGroupPairings,
  groupTieOrder,
} from './group-knockout-domain.js';
import { groupEvidence } from './group-knockout-repository.js';
export class GroupKnockoutService extends KnockoutService {
  protected override async view(
    c: PoolClient,
    ctx: OrgActor,
    event: EventAccess,
  ): Promise<Awaited<ReturnType<KnockoutService['view']>>> {
    if (event.row.format !== 'GROUP_KNOCKOUT') return super.view(c, ctx, event);
    const { response, revision, matches, publication } = await this.groupView(c, ctx, event);
    const competition = response.competition;
    return {
      response: {
        event: response.event,
        publicationId: response.publicationId,
        participants:
          revision?.source.entries.map(({ entryId, teamId, teamName, rosterRevisionId }) => ({
            entryId,
            teamId,
            teamName,
            rosterRevisionId,
          })) ?? [],
        bracket: competition?.bracket ?? null,
        capabilities: { canPublishNextRound: response.capabilities.canPublishNextRound },
      },
      revision,
      matches,
      publication,
      nextRound: competition?.nextRound ?? null,
    };
  }
  private async groupView(c: PoolClient, ctx: OrgActor, event: EventAccess) {
    if (event.row.format !== 'GROUP_KNOCKOUT')
      throw new ApiError(422, 'UNSUPPORTED_EVENT_FORMAT', '仅分组接淘汰赛事可读取分组赛');
    const publication = await this.publication(c, ctx.orgId, event.row.id);
    const revision = event.row.current_schedule_revision_id
      ? (
          await c.query<RevisionRow>(
            'SELECT * FROM schedule_revisions WHERE org_id=$1 AND event_id=$2 AND id=$3',
            [ctx.orgId, event.row.id, event.row.current_schedule_revision_id],
          )
        ).rows[0]
      : null;
    const matches = await this.resultRows(c, ctx.orgId, event.row.id);
    const now = (
      await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')
    ).rows[0]!.now.toISOString();
    let competition: EventGroupKnockoutData['competition'] = null;
    if (publication) {
      if (
        !revision ||
        revision.algorithm_version !== 'GK_BALANCED_V1' ||
        revision.status !== 'PUBLISHED'
      )
        throw new ApiError(409, 'RESULT_SOURCE_INVALID', '分组来源无法核验');
      const evidence = await groupEvidence(c, ctx.orgId, event.row.id);
      if (!evidence.rules)
        throw new ApiError(422, 'STANDINGS_RULES_REQUIRED', '请先发布分组积分规则');
      const roundPublications = (
        await c.query(
          'SELECT round_no,sources FROM knockout_round_publications WHERE org_id=$1 AND event_id=$2 ORDER BY round_no',
          [ctx.orgId, event.row.id],
        )
      ).rows.map((r) => ({ roundNo: r.round_no, sources: r.sources }));
      competition = calculateGroupKnockout({
        publicationId: publication.id,
        source: revision.source,
        seed: revision.seed,
        policy: revision.policy,
        config: revision.group_config!,
        rules: evidence.rules,
        matches,
        asOf: now,
        draws: evidence.draws,
        qualification: evidence.qualification,
        roundPublications,
      });
    }
    const can = event.canManage && ['SCHEDULED', 'RUNNING'].includes(event.row.status);
    const response: EventGroupKnockoutData = {
      event: this.dtoEvent(event),
      publicationId: publication?.id ?? null,
      config: revision?.group_config ?? null,
      competition,
      draftGroups:
        revision && !publication
          ? generateGroupPairings(
              revision.source,
              revision.policy,
              revision.seed,
              revision.group_config,
            ).groups.map((g) => ({
              groupKey: g.groupKey,
              label: `${g.groupKey}组`,
              participants: g.entryIds.map((id) => {
                const { entryId, teamId, teamName, rosterRevisionId } =
                  revision.source.entries.find((e) => e.entryId === id)!;
                return { entryId, teamId, teamName, rosterRevisionId };
              }),
            }))
          : [],
      capabilities: {
        canDrawTies: can && competition?.qualification.status === 'TIE_BREAK_REQUIRED',
        canPublishQualification: can && competition?.qualification.status === 'READY',
        canPublishNextRound:
          can && competition?.qualification.status === 'PUBLISHED' && !!competition.nextRound,
      },
    };
    return { response, revision, matches, publication };
  }
  async getGroups(
    cookie: string | undefined,
    org: string,
    id: string,
  ): Promise<EventGroupKnockoutData> {
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const r = await this.groupView(c, ctx, await this.event(c, ctx, id, false));
      await this.ensureFreshSession(c, ctx);
      return r.response;
    });
  }
  async drawGroupTie(
    cookie: string | undefined,
    org: string,
    id: string,
    raw: unknown,
  ): Promise<EventGroupKnockoutData> {
    const input = objectInput(raw, [
      'type',
      'expectedEventVersion',
      'expectedSourceHash',
      'groupKey',
      'reason',
    ]);
    if (
      input.type !== 'DRAW_GROUP_TIE' ||
      typeof input.groupKey !== 'string' ||
      !/^[A-H]$/.test(input.groupKey) ||
      typeof input.expectedSourceHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(input.expectedSourceHash)
    )
      invalid('抽签命令无效');
    const version = expectedVersion(input.expectedEventVersion),
      reason = this.groupReason(input.reason);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const event = await this.event(c, ctx, id, true);
      if (!event.canManage) throw forbidden();
      if (event.row.version !== version)
        throw new ApiError(409, 'VERSION_CONFLICT', '赛事已更新，请刷新');
      if (!['SCHEDULED', 'RUNNING'].includes(event.row.status))
        throw new ApiError(409, 'INVALID_EVENT_STATE', '赛事当前不能抽签');
      const state = await this.groupView(c, ctx, event);
      const group = state.response.competition?.groups.find((g) => g.groupKey === input.groupKey);
      if (
        !group ||
        !group.standings.isComplete ||
        !group.unresolvedTieEntryIds.length ||
        state.response.competition?.qualification.status !== 'TIE_BREAK_REQUIRED'
      )
        throw new ApiError(409, 'GROUP_TIE_DRAW_NOT_REQUIRED', '当前无需或不能重复抽签');
      if (group.standings.sourceHash !== input.expectedSourceHash)
        throw new ApiError(409, 'GROUP_SOURCE_CONFLICT', '组赛来源已变化，请刷新');
      const seed = randomBytes(32).toString('hex'),
        order = groupTieOrder(seed, group.unresolvedTieEntryIds),
        drawId = randomUUID();
      await this.ensureFreshSession(c, ctx);
      await c.query(
        'INSERT INTO group_tiebreak_draws(id,org_id,event_id,revision_id,group_key,source_hash,seed,tied_entry_ids,ordered_entry_ids,reason,created_by,sources,ruleset_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb,$13)',
        [
          drawId,
          ctx.orgId,
          id,
          state.revision!.id,
          group.groupKey,
          group.standings.sourceHash,
          seed,
          JSON.stringify(group.unresolvedTieEntryIds),
          JSON.stringify(order),
          reason,
          ctx.user.id,
          JSON.stringify(
            state.response.competition!.qualification.sources.filter((source) =>
              group.participants.some((p) => p.entryId === source.winnerEntryId),
            ),
          ),
          (await groupEvidence(c, ctx.orgId, id)).rules!.id,
        ],
      );
      await c.query(
        'UPDATE events SET version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
        [ctx.orgId, id],
      );
      await this.audit(c, ctx.user.id, ctx.orgId, 'GROUP_TIE_DRAWN', 'event', id, {
        drawId,
        groupKey: group.groupKey,
        sourceHash: group.standings.sourceHash,
        reason,
      });
      return (await this.groupView(c, ctx, await this.event(c, ctx, id, false))).response;
    });
  }
  private groupReason(raw: unknown): string {
    if (typeof raw !== 'string' || raw.includes('\u0000')) invalid('请填写操作原因');
    const s = (raw as string).trim();
    if (Array.from(s).length < 4 || Array.from(s).length > 500) invalid('原因须为4–500字符');
    return s;
  }
  async publishQualification(
    cookie: string | undefined,
    org: string,
    id: string,
    raw: unknown,
  ): Promise<EventGroupKnockoutData> {
    await this.publishRound(cookie, org, id, raw, true);
    return this.getGroups(cookie, org, id);
  }
  protected override async persistRoundProof(
    c: PoolClient,
    ctx: OrgActor,
    event: EventAccess,
    revision: RevisionRow,
    publicationId: string,
    next: NonNullable<KnockoutBracket['nextRound']>,
    fixtures: unknown[],
    proofId: string,
    reason: string,
    qualification: boolean,
  ) {
    if (event.row.format !== 'GROUP_KNOCKOUT')
      return super.persistRoundProof(
        c,
        ctx,
        event,
        revision,
        publicationId,
        next,
        fixtures,
        proofId,
        reason,
        qualification,
      );
    const state = await this.groupView(c, ctx, event),
      competition = state.response.competition!;
    if (!qualification) {
      if (competition.qualification.status !== 'PUBLISHED')
        throw new ApiError(409, 'GROUP_QUALIFICATION_REQUIRED', '请先显式发布晋级资格');
      return super.persistRoundProof(
        c,
        ctx,
        event,
        revision,
        publicationId,
        next,
        fixtures,
        proofId,
        reason,
        false,
      );
    }
    if (
      competition.qualification.status !== 'READY' ||
      competition.qualification.sourceHash !== next.sourceHash
    )
      throw new ApiError(409, 'GROUP_QUALIFICATION_NOT_READY', '请完成全部组赛及必要同分抽签');
    const evidence = await groupEvidence(c, ctx.orgId, event.row.id);
    await c.query(
      `INSERT INTO group_qualification_publications(id,org_id,event_id,publication_id,revision_id,round_no,from_event_version,to_event_version,source_hash,sources,slots,draw_ids,fixtures,ruleset_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7+1,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15)`,
      [
        proofId,
        ctx.orgId,
        event.row.id,
        publicationId,
        revision.id,
        next.roundNo,
        event.row.version,
        next.sourceHash,
        JSON.stringify(next.sources),
        JSON.stringify(competition.qualification.slots),
        JSON.stringify(competition.groups.flatMap((g) => (g.draw ? [g.draw.id] : []))),
        JSON.stringify(fixtures),
        evidence.rules!.id,
        reason,
        ctx.user.id,
      ],
    );
  }
}
