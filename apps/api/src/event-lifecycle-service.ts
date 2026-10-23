import type { PoolClient } from 'pg';
import type { EventLifecycleData } from '@small-city-basketball/contracts';
import { ApiError, forbidden } from './errors.js';
import { StandingsService } from './standings-service.js';
import type { StandingsAccess } from './standings-service.js';
import {
  activeEvent,
  closedEvent,
  completionReadiness,
  knockoutCompletionReadiness,
  nextEventStatus,
  parseLifecycleCommand,
} from './event-lifecycle-domain.js';

export class EventLifecycleService extends StandingsService {
  private async completion(c: PoolClient, a: StandingsAccess, now: string) {
    const plan = await this.plan(c, a.ctx.orgId, a.event.id);
    const matches = await this.matches(c, a.ctx.orgId, a.event.id);
    try {
      if (a.event.format === 'GROUP_KNOCKOUT' && plan) {
        const competition = await this.groupCompetition(c, a.event, plan, matches, now);
        return {
          totalMatchCount: competition.totalMatchCount,
          confirmedMatchCount: competition.confirmedMatchCount,
          ready: competition.isComplete,
          blockers: competition.isComplete ? [] : ['UNCONFIRMED_MATCHES'],
          sourceHash: competition.sourceHash,
        };
      }
      if (a.event.format === 'SINGLE_ELIMINATION')
        return knockoutCompletionReadiness({
          publicationId: plan?.id ?? null,
          source: plan?.source ?? null,
          seed: plan?.seed,
          policy: plan?.policy,
          roundPublications: plan?.round_publications,
          matches,
          asOf: now,
        });
      const rules = await this.rules(c, a.ctx.orgId, a.event.locked_standings_ruleset_id);
      return completionReadiness({
        publicationId: plan?.id ?? null,
        participants: plan ? this.participants(plan) : null,
        rules,
        matches,
        asOf: now,
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'RESULT_SOURCE_INVALID') throw error;
      return {
        totalMatchCount: matches.length,
        confirmedMatchCount: 0,
        ready: false,
        blockers: ['RESULT_SOURCE_INVALID'],
        sourceHash: null,
      };
    }
  }
  private async lifecycleView(
    c: PoolClient,
    a: StandingsAccess,
    now: string,
  ): Promise<EventLifecycleData> {
    const completion = await this.completion(c, a, now);
    return {
      event: this.eventDto(a),
      completion,
      capabilities: {
        canComplete: a.manager && activeEvent(a.event.status) && completion.ready,
        canArchive: a.manager && a.event.status === 'COMPLETED',
        canReopen: a.manager && closedEvent(a.event.status),
      },
    };
  }
  async getLifecycle(cookie: string | undefined, org: string, id: string) {
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      const a = await this.event(c, ctx, id);
      return this.lifecycleView(c, a, await this.now(c, ctx));
    });
  }
  async lifecycleCommand(cookie: string | undefined, org: string, id: string, raw: unknown) {
    const input = parseLifecycleCommand(raw);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      // All scoring writers acquire this event before any match/lease/team locks.
      // This UPDATE lock waits for them, then all proof reads use their committed state.
      const a = await this.event(c, ctx, id, true);
      if (!a.manager) throw forbidden();
      const now = await this.now(c, ctx);
      if (a.event.version !== input.expectedEventVersion)
        throw new ApiError(409, 'VERSION_CONFLICT', '赛事已更新，请重新读取后操作', {
          currentVersion: a.event.version,
        });
      const from = a.event.status;
      const to = nextEventStatus(from, input.type);
      if (input.type === 'COMPLETE') {
        const completion = await this.completion(c, a, now);
        if (!completion.ready)
          throw new ApiError(
            422,
            'EVENT_COMPLETION_BLOCKED',
            a.event.format === 'SINGLE_ELIMINATION'
              ? '请先完成全部淘汰轮次并独立确认赛果'
              : '请先完成并独立确认所有比赛及排名规则',
            {
              blockers: completion.blockers,
            },
          );
      }
      if (input.type === 'COMPLETE' || input.type === 'REOPEN') {
        // Never revive old opaque keys, including after a later COMPLETE.
        await c.query(
          'UPDATE public_event_publications SET revoked_at=$3,revoked_by=$4 WHERE org_id=$1 AND event_id=$2 AND revoked_at IS NULL',
          [ctx.orgId, id, now, ctx.user.id],
        );
      }
      await c.query('UPDATE events SET status=$3 WHERE org_id=$1 AND id=$2', [ctx.orgId, id, to]);
      a.event.status = to;
      await this.touch(c, a, now);
      await this.audit(
        c,
        ctx.user.id,
        ctx.orgId,
        `event.lifecycle.${input.type.toLowerCase()}`,
        'event',
        id,
        {
          from,
          to,
          reason: input.reason,
          expectedEventVersion: input.expectedEventVersion,
        },
      );
      return this.lifecycleView(c, a, now);
    });
  }
}
