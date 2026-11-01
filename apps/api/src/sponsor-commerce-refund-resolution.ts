import type { PoolClient } from 'pg';
import { notFound } from './errors.js';
import { sponsorFail, sponsorHash } from './sponsor-commerce-domain.js';
import { tradeHash } from './trade-domain.js';
type Row = Record<string, any>;

export function sponsorRefundFailed(r: Row | null | undefined) {
  return (
    !!r &&
    (r.status === 'FAILED'
      ? !!r.provider_refund_id && !r.success_at
      : r.status === 'REJECTED' && !r.provider_refund_id && !r.fence && !r.success_at)
  );
}

/** One obligation, immutable original return evidence, and an explicit non-branching chain of common refunds. */
export async function readSponsorRefundResolution(c: PoolClient, planId: string) {
  const plan = (
    await c.query<Row>('SELECT * FROM sponsor_refund_plans WHERE id=$1 FOR UPDATE', [planId])
  ).rows[0];
  if (!plan) throw notFound();
  const retries = (
    await c.query<Row>(
      'SELECT * FROM sponsor_refund_retries WHERE plan_id=$1 ORDER BY created_at,id FOR UPDATE',
      [planId],
    )
  ).rows;
  const ids = [
    plan.trade_refund_id,
    ...retries.flatMap((r) => [r.previous_refund_id, r.trade_refund_id]),
  ].filter(Boolean);
  const refunds = ids.length
    ? (
        await c.query<Row>(
          'SELECT * FROM trade_refunds WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
          [ids],
        )
      ).rows
    : [];
  const bindings = ids.length
    ? (
        await c.query<Row>(
          'SELECT * FROM r6_trade_refund_bindings WHERE refund_id=ANY($1::uuid[])',
          [ids],
        )
      ).rows
    : [];
  const trade = (
    await c.query<Row>(
      "SELECT * FROM trade_orders WHERE kind='SPONSOR_ORDER' AND source_id=$1 FOR UPDATE",
      [plan.order_id],
    )
  ).rows[0];
  const source = (
    await c.query<Row>('SELECT * FROM sponsor_orders WHERE id=$1 FOR UPDATE', [plan.order_id])
  ).rows[0];
  const identity = source && {
    contractId: source.contract_id,
    snapshot: source.snapshot,
    merchantId: source.merchant_id,
    merchantAppId: source.merchant_app_id,
  };
  let valid =
    !!trade &&
    !!source &&
    trade.org_id === plan.org_id &&
    source.org_id === plan.org_id &&
    trade.payer_user_id === source.payer_user_id &&
    trade.beneficiary_user_id === source.beneficiary_user_id &&
    trade.total_fen === source.total_fen &&
    trade.currency === source.currency &&
    trade.merchant_key === source.merchant_key &&
    trade.merchant_id === source.merchant_id &&
    trade.merchant_app_id === source.merchant_app_id &&
    trade.terms_id === null &&
    trade.source_hash === tradeHash(identity) &&
    sponsorHash(trade.source_snapshot) === sponsorHash(identity);
  const chain: Row[] = [];
  let currentRefund: Row | null = refunds.find((r) => r.id === plan.trade_refund_id) ?? null;
  let pendingRetry: Row | null = null;
  const active = retries.filter((r) => r.status !== 'REJECTED'),
    visited = new Set<string>();
  const bound = (r: Row, allocation: string) =>
    bindings.some(
      (b) =>
        b.kind === 'SPONSOR_ORDER' &&
        b.source_id === plan.order_id &&
        b.order_id === trade?.id &&
        b.allocation_id === allocation &&
        b.refund_id === r.id,
    );
  if (plan.status === 'CLAIMED')
    valid = valid && !!currentRefund && !!currentRefund && bound(currentRefund, plan.id);
  else valid = valid && !currentRefund && !retries.length;
  if (currentRefund) {
    const root = currentRefund;
    const payment = (
      await c.query<Row>('SELECT * FROM trade_payment_attempts WHERE id=$1 FOR SHARE', [
        root.payment_id,
      ])
    ).rows[0];
    valid =
      valid &&
      !!payment &&
      payment.order_id === trade?.id &&
      payment.status === 'PAID' &&
      payment.profit_sharing &&
      !!payment.provider_transaction_id &&
      payment.total_fen === trade?.total_fen &&
      root.amount_fen <= payment.total_fen;
    while (currentRefund) {
      chain.push(currentRefund);
      valid =
        valid &&
        currentRefund.order_id === trade?.id &&
        currentRefund.payment_id === root.payment_id &&
        currentRefund.amount_fen === plan.amount_fen;
      const next = active.filter((r) => r.previous_refund_id === currentRefund!.id);
      if (!next.length) break;
      if (next.length !== 1) {
        valid = false;
        break;
      }
      const retry = next[0]!;
      if (visited.has(retry.id)) {
        valid = false;
        break;
      }
      visited.add(retry.id);
      valid =
        valid &&
        plan.funding_mode === 'RETURN_FIRST' &&
        retry.org_id === plan.org_id &&
        retry.order_id === plan.order_id &&
        retry.proposed_by !== retry.reviewed_by;
      if (retry.status !== 'CLAIMED') {
        pendingRetry = retry;
        valid =
          valid &&
          ['IN_REVIEW', 'APPROVED'].includes(retry.status) &&
          !retry.trade_refund_id &&
          (retry.status === 'IN_REVIEW' || !!retry.reviewed_by);
        break;
      }
      const nextRefund = refunds.find((r) => r.id === retry.trade_refund_id);
      if (!nextRefund || !retry.reviewed_by || !bound(nextRefund, retry.id)) {
        valid = false;
        break;
      }
      currentRefund = nextRefund;
    }
  }
  if (visited.size !== active.length) valid = false;
  const structurallyValid = valid;
  const leafRefund = currentRefund;
  const successIndex = chain.findIndex((r) => r.status === 'SUCCEEDED');
  const ancestorsFailed = chain.slice(0, -1).every(sponsorRefundFailed);
  if (successIndex >= 0) {
    valid =
      valid &&
      !pendingRetry &&
      chain.slice(0, successIndex).every(sponsorRefundFailed) &&
      chain.slice(successIndex + 1).every(sponsorRefundFailed);
    if (valid) currentRefund = chain[successIndex]!;
  } else valid = valid && ancestorsFailed;
  return {
    plan,
    retries,
    chain,
    currentRefund,
    leafRefund,
    pendingRetry,
    valid,
    structurallyValid,
    resolved:
      valid && plan.status === 'CLAIMED' && !pendingRetry && currentRefund?.status === 'SUCCEEDED',
  };
}

export async function assertSponsorRetryWritesAllowed(c: PoolClient) {
  if (
    (
      await c.query(
        "SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore' LIMIT 1",
      )
    ).rowCount
  )
    sponsorFail('SPONSOR_RESTORE_QUARANTINED', '恢复环境禁止生成或审批替代退款', 503);
}
