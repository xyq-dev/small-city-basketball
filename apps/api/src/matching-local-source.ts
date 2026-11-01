import type { PoolClient } from 'pg';
import type { MatchingSourceHooks } from './matching-source-adapter.js';
import type { LocalServicesService } from './local-services-service.js';
import { localFail } from './local-services-domain.js';
import { objectInput } from './validation.js';

const iso = (value: Date | string) => new Date(value).toISOString();
/** Canonical X12 conversion: source objects, prices and time are server-bound.
 * The caller owns the transaction; prepare acquires source locks before matching locks. */
export function createMatchingLocalSourceHooks(local: LocalServicesService): MatchingSourceHooks {
  return {
    async prepare(c, actor, input) {
      const { need, candidate } = input;
      if (need.windows.length !== 1)
        localFail('MATCHING_SOURCE_WINDOW', '同城预约每次须对应一个明确连续服务时段');
      if (input.kind === 'STAFF_SERVICE') {
        const consent = objectInput(input.sourceInput, [
          'acceptedTerms',
          'acceptedTermsId',
          'chargeConsent',
        ]);
        const prepared = await local.prepareBookingInTransaction(c, actor, {
          commandId: input.commandId,
          listingId: candidate.sourceId,
          slotId: candidate.sourceSlotId,
          serviceRegion: { catalogVersion: need.catalogVersion, regionId: need.regionId },
          serviceAddress: need.address,
          ...consent,
        });
        const { listing: l, slot } = prepared;
        if (
          !['REFEREE', 'SCORER', 'RECORDER', 'STREAMER', 'PHOTOGRAPHER'].includes(l.kind) ||
          l.provider_user_id !== candidate.userId ||
          l.org_id !== candidate.sourceOrgId ||
          l.version !== candidate.sourceVersion ||
          !slot ||
          iso(slot.starts_at) !== need.startsAt ||
          iso(slot.ends_at) !== need.endsAt
        )
          localFail('MATCHING_SOURCE_CHANGED', '意向中的人员供给或档期已经变化');
        const term = (
          await c.query(
            "SELECT id,amount_fen FROM trade_terms WHERE org_id=$1 AND kind='LOCAL_BOOKING' AND source_id=$2 AND status='ACTIVE' FOR SHARE",
            [l.org_id, l.id],
          )
        ).rows[0];
        if (
          !term ||
          term.amount_fen !== candidate.totalFen ||
          (consent.acceptedTermsId !== undefined && consent.acceptedTermsId !== term.id)
        )
          localFail('MATCHING_PRICE_CHANGED', '意向中的收费条款已变化，请重新读取报价');
        return {
          execute: async () => {
            const result = await prepared.execute();
            return {
              sourceKind: 'LOCAL_BOOKING',
              sourceId: result.resourceId as string,
              totalFen: term.amount_fen as number,
            };
          },
        };
      }
      if (input.kind !== 'TEAM_MATCHUP')
        localFail('MATCHING_SOURCE_UNAVAILABLE', '该撮合来源不属于同城预约', 503);
      const detail = objectInput(input.sourceInput, ['courtBookingId', 'terms']);
      if (!need.teamId || !candidate.sourceOrgId || candidate.totalFen !== 0)
        localFail('MATCHING_SOURCE_CHANGED', '球队意向需双方明确球队和免费约赛来源');
      const prepared = await local.prepareMatchupInTransaction(c, actor, {
        commandId: input.commandId,
        homeOrgId: need.orgId,
        homeTeamId: need.teamId,
        awayOrgId: candidate.sourceOrgId,
        awayTeamId: candidate.sourceId,
        ...detail,
      });
      if (
        iso(prepared.booking.starts_at) !== need.startsAt ||
        iso(prepared.booking.ends_at) !== need.endsAt
      )
        localFail('MATCHING_SOURCE_WINDOW', '实际球场预约须与意向的比赛时间完全一致');
      const team = (
        await c.query('SELECT version FROM teams WHERE id=$1 AND org_id=$2 FOR SHARE', [
          candidate.sourceId,
          candidate.sourceOrgId,
        ])
      ).rows[0];
      const authority = await c.query(
        `SELECT 1 FROM users u WHERE u.id=$1 AND u.status='ACTIVE' AND (EXISTS(SELECT 1 FROM team_access_grants g WHERE g.user_id=u.id AND g.org_id=$2 AND g.team_id=$3 AND g.status='ACTIVE') OR EXISTS(SELECT 1 FROM organization_memberships m WHERE m.user_id=u.id AND m.org_id=$2 AND m.status='ACTIVE' AND m.role IN('ORG_OWNER','ORG_ADMIN'))) FOR SHARE OF u`,
        [candidate.userId, candidate.sourceOrgId, candidate.sourceId],
      );
      if (!team || team.version !== candidate.sourceVersion || !authority.rowCount)
        localFail('MATCHING_SOURCE_CHANGED', '对方球队资料或授权已变化');
      return {
        execute: async () => {
          const result = await prepared.execute();
          return { sourceKind: 'TEAM_MATCHUP', sourceId: result.resourceId as string, totalFen: 0 };
        },
      };
    },
    async inspectEnded(c, actor, source) {
      const state = await local.inspectMatchingSourceInTransaction(
        c,
        actor,
        source.sourceKind,
        source.sourceId,
      );
      if (source.sourceKind === 'TEAM_MATCHUP')
        return { ...state, unresolvedMoney: false, retainedCostFen: 0 };
      return { ...state, ...(await inspectLocalMoney(c, source.sourceId)) };
    },
  };
}

/** Reopening is conservative: all provider operations must have a final status,
 * and retained money must equal independently approved, fully settled deductions. */
async function inspectLocalMoney(c: PoolClient, sourceId: string) {
  const orders = (
    await c.query(
      "SELECT id FROM trade_orders WHERE kind='LOCAL_BOOKING' AND source_id=$1 ORDER BY id FOR UPDATE",
      [sourceId],
    )
  ).rows;
  let unresolvedMoney = false,
    retainedCostFen = 0;
  for (const order of orders) {
    const payments = (
      await c.query(
        'SELECT status,total_fen FROM trade_payment_attempts WHERE order_id=$1 ORDER BY id FOR UPDATE',
        [order.id],
      )
    ).rows;
    const refunds = (
      await c.query(
        'SELECT status,amount_fen FROM trade_refunds WHERE order_id=$1 ORDER BY id FOR UPDATE',
        [order.id],
      )
    ).rows;
    const deductions = (
      await c.query(
        'SELECT status,amount_fen FROM trade_deductions WHERE order_id=$1 ORDER BY id FOR UPDATE',
        [order.id],
      )
    ).rows;
    const settlements = (
      await c.query(
        'SELECT status,amount_fen,return_amount_fen FROM trade_settlements WHERE order_id=$1 ORDER BY id FOR UPDATE',
        [order.id],
      )
    ).rows;
    const returns = (
      await c.query(
        'SELECT r.status FROM trade_settlement_returns r JOIN trade_settlements s ON s.id=r.settlement_id WHERE s.order_id=$1 ORDER BY r.id FOR UPDATE OF r',
        [order.id],
      )
    ).rows;
    unresolvedMoney ||=
      payments.some((p) => !['PAID', 'CLOSED', 'FAILED'].includes(p.status)) ||
      refunds.some((r) => !['SUCCEEDED', 'REJECTED', 'FAILED'].includes(r.status)) ||
      deductions.some((d) => !['APPROVED', 'REJECTED', 'REVERSED'].includes(d.status)) ||
      settlements.some(
        (s) => !['SUCCEEDED', 'RETURNED', 'REJECTED', 'FAILED'].includes(s.status),
      ) ||
      returns.some((r) => !['SUCCEEDED', 'FAILED'].includes(r.status));
    const paid = payments.filter((p) => p.status === 'PAID').reduce((n, p) => n + p.total_fen, 0);
    const refunded = refunds
      .filter((r) => r.status === 'SUCCEEDED')
      .reduce((n, r) => n + r.amount_fen, 0);
    const retained = deductions
      .filter((d) => d.status === 'APPROVED')
      .reduce((n, d) => n + d.amount_fen, 0);
    const settled = settlements
      .filter((s) => ['SUCCEEDED', 'RETURNED'].includes(s.status))
      .reduce((n, s) => n + s.amount_fen - s.return_amount_fen, 0);
    unresolvedMoney ||= paid - refunded !== retained || settled !== retained;
    retainedCostFen += retained;
  }
  return { unresolvedMoney, retainedCostFen };
}
