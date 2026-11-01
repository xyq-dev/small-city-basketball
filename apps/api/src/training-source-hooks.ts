import type { PoolClient } from 'pg';
import type { Actor } from './service.js';
/** Trusted in-transaction trade bridge. No payment state is accepted from HTTP clients. */
export interface TrainingTradeHooks {
  binding(
    c: PoolClient,
    orgId: string,
  ): Promise<{ merchantKey: string; beneficiaryId: string; beneficiaryName: string } | null>;
  capture(
    c: PoolClient,
    actor: Actor,
    input: { enrollmentId: string; acceptedTermsId: string; chargeConsent: boolean },
  ): Promise<string | null>;
  payment(
    c: PoolClient,
    enrollmentId: string,
  ): Promise<{
    orderId: string;
    status: 'PAID' | 'UNPAID' | 'UNKNOWN' | 'REFUNDED';
    paidFen: number;
    refundedFen: number;
  }>;
  refund(
    c: PoolClient,
    actor: Actor,
    input: { enrollmentId: string; allocationId: string; amountFen: number; reason: string },
  ): Promise<{ refundId: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' }>;
  refundStatus(
    c: PoolClient,
    refundId: string,
  ): Promise<'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'>;
}
export interface TrainingOptions {
  enabled?: boolean;
  trade?: TrainingTradeHooks;
}
