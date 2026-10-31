import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { InsuranceService } from './insurance-service.js';
import { sealInsurance } from './insurance-domain.js';
import type {
  InsuranceApplicant,
  InsurancePolicyFact,
  InsuranceProvider,
  InsuranceQuote,
} from './insurance-provider.js';
const key = Buffer.alloc(32, 7),
  id = () => randomUUID();
function harness(kind: 'APPLY' | 'CANCEL' = 'APPLY') {
  const quote: InsuranceQuote = {
    quoteReference: 'synthetic-quote',
    productExternalId: 'basketball',
    productVersion: '1',
    termsVersion: 'terms1',
    applicantReference: 'a'.repeat(64),
    premiumFen: 100,
    currency: 'CNY',
    coverageStartDate: '2026-11-01',
    coverageEndDate: '2026-11-02',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  };
  const applicant: InsuranceApplicant = {
    realName: '合成申请人',
    identityNumber: 'synthetic identity never sent to a real provider',
    applicantReference: quote.applicantReference,
    coverageStartDate: quote.coverageStartDate,
    coverageEndDate: quote.coverageEndDate,
  };
  const operation = id(),
    quoteId = id(),
    order: any = {
      id: id(),
      org_id: id(),
      event_id: id(),
      entry_id: id(),
      member_id: id(),
      user_id: id(),
      quote_id: quoteId,
      operation_id: operation,
      version: 1,
      refunded_fen: 0,
      provider_order_id: null,
      quote_ciphertext: sealInsurance(key, quoteId, quote),
      applicant_ciphertext: sealInsurance(key, quoteId, applicant),
      material_revision_id: id(),
      coverage_start_date: quote.coverageStartDate,
      coverage_end_date: quote.coverageEndDate,
      expires_at: quote.expiresAt,
      payment_status: 'UNPAID',
      policy_status: 'PENDING',
      cancellation_requested_at: kind === 'CANCEL' ? new Date() : null,
      product_active: true,
      provider_id: 'synthetic-insurance-test',
    };
  const state = {
    op: {
      id: kind === 'APPLY' ? operation : id(),
      order_id: order.id,
      kind,
      status: 'PENDING',
      reconcile_only: false,
      attempt_count: 0,
      fence: 0,
      lease_id: null as string | null,
    },
    valid: true,
    applyCalls: [] as string[],
    cancelCalls: [] as string[],
    queryCalls: [] as string[],
    fact: null as InsurancePolicyFact | null,
    orderWrites: 0,
    stealFence: false,
  };
  const fact: InsurancePolicyFact = {
    ...quote,
    operationId: operation,
    providerOrderId: 'synthetic-order',
    paymentStatus: 'PAID',
    policyStatus: 'ISSUED',
    policyNumber: 'synthetic-policy',
    refundedFen: 0,
    document: null,
    checkoutUrl: null,
  };
  const client = {
    query: async (sql: string, values: any[] = []) => {
      if (sql.startsWith('SELECT * FROM insurance_operations')) {
        if (
          values.length === 3 &&
          (state.op.lease_id !== values[1] ||
            state.op.fence !== values[2] ||
            state.op.status !== 'RUNNING')
        )
          return { rows: [] };
        return { rows: [{ ...state.op }] };
      }
      if (sql.startsWith('SELECT o.*')) return { rows: [{ ...order }] };
      if (sql.startsWith('SELECT $1::timestamptz')) return { rows: [{ valid: state.valid }] };
      if (sql.startsWith('UPDATE insurance_operations')) {
        if (sql.includes("status='RUNNING'")) {
          state.op.status = 'RUNNING';
          state.op.fence = values[1];
          state.op.lease_id = values[2];
          state.op.attempt_count++;
        } else if (sql.includes("status='DONE'")) {
          state.op.status = 'DONE';
          state.op.lease_id = null;
        } else if (sql.includes("status='FAILED'")) {
          state.op.status = 'FAILED';
          state.op.lease_id = null;
        } else {
          state.op.status = 'UNKNOWN';
          state.op.reconcile_only = true;
          state.op.lease_id = null;
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE insurance_orders')) {
        state.orderWrites++;
        if (sql.includes("policy_status='FAILED'")) order.policy_status = 'FAILED';
        else {
          order.payment_status = values[2];
          order.policy_status = values[3];
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO insurance_policy_facts')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('INSERT INTO insurance_operations')) return { rows: [], rowCount: 1 };
      throw Error('Unexpected synthetic DB operation ' + sql);
    },
  } as unknown as PoolClient;
  const pool = {
    query: async (sql: string) => {
      if (sql.startsWith('UPDATE insurance_operations')) return { rows: [] };
      if (sql.startsWith('SELECT x.id'))
        return {
          rows:
            state.op.status === 'DONE'
              ? []
              : [{ id: state.op.id, org_id: order.org_id, event_id: order.event_id }],
        };
      throw Error(sql);
    },
  } as unknown as Pool;
  const provider: InsuranceProvider = {
    id: 'synthetic-insurance-test',
    allowedOrigins: ['https://insurer.example.test'],
    catalog: async () => [],
    quote: async () => quote,
    apply: async (op) => {
      state.applyCalls.push(op);
      return 'UNKNOWN';
    },
    cancel: async (op) => {
      state.cancelCalls.push(op);
      return 'UNKNOWN';
    },
    query: async (op) => {
      state.queryCalls.push(op);
      if (state.stealFence) state.op.fence++;
      return state.fact;
    },
  };
  class Service extends InsuranceService {
    protected override async transaction<T>(work: (c: PoolClient) => Promise<T>) {
      return work(client);
    }
  }
  const service = new Service(
    pool,
    {
      databaseUrl: 'postgres://unused@127.0.0.1/unused',
      appOrigin: 'http://127.0.0.1:5173',
      participantDataKey: Buffer.alloc(32, 8).toString('base64'),
    },
    {
      provider,
      dataKey: key.toString('base64'),
      autoDispatch: false,
      participationGuard: async () => ({ ready: true }),
    },
  );
  // These worker tests isolate transport/fencing; the real qualification reader has its own domain and PG tests.
  Object.defineProperty(service, 'lockScope', { value: async () => ({}) });
  Object.defineProperty(service, 'workerAuthorization', { value: async () => true });
  return { state, service, fact, order };
}
describe('durable insurance worker uncertainty and fencing', () => {
  it('an unknown apply queries the same original order on every retry without a second apply', async () => {
    const h = harness();
    await h.service.drain();
    expect(h.state.op.status).toBe('UNKNOWN');
    expect(h.state.applyCalls).toEqual([h.order.operation_id]);
    h.state.fact = h.fact;
    await h.service.drain();
    expect(h.state.applyCalls).toEqual([h.order.operation_id]);
    expect(h.state.queryCalls).toEqual([h.order.operation_id, h.order.operation_id]);
    expect(h.state.op.status).toBe('DONE');
    expect(h.order.policy_status).toBe('ISSUED');
  });
  it('an unknown cancellation queries the original policy instead of sending another cancellation', async () => {
    const h = harness('CANCEL');
    await h.service.drain();
    await h.service.drain();
    expect(h.state.cancelCalls).toHaveLength(1);
    expect(h.state.queryCalls).toEqual([h.order.operation_id, h.order.operation_id]);
    expect(h.state.op.reconcile_only).toBe(true);
  });
  it('an accepted cancellation remains query-only until the original policy actually cancels', async () => {
    const h = harness('CANCEL');
    h.state.fact = h.fact;
    await h.service.drain();
    expect(h.state.op.status).toBe('UNKNOWN');
    expect(h.order.policy_status).toBe('CANCEL_PENDING');
    await h.service.drain();
    expect(h.state.cancelCalls).toHaveLength(1);
    expect(h.state.queryCalls).toHaveLength(2);
  });
  it('a late worker result cannot overwrite an operation owned by another fence', async () => {
    const h = harness();
    h.state.fact = h.fact;
    h.state.stealFence = true;
    await h.service.drain();
    expect(h.state.orderWrites).toBe(0);
    expect(h.order.policy_status).toBe('PENDING');
  });
  it('expired quote never dispatches a charge-bearing apply', async () => {
    const h = harness();
    h.state.valid = false;
    await h.service.drain();
    expect(h.state.applyCalls).toHaveLength(0);
    expect(h.state.queryCalls).toHaveLength(0);
    expect(h.state.op.status).toBe('FAILED');
  });
  it('a cancelled policy cannot be revived by a stale ISSUED query response', async () => {
    const h = harness();
    h.state.op.reconcile_only = true;
    h.order.policy_status = 'CANCELLED';
    h.state.fact = h.fact;
    await h.service.drain();
    expect(h.state.orderWrites).toBe(0);
    expect(h.order.policy_status).toBe('CANCELLED');
  });
  it('a query cannot silently switch an order already bound to a provider order id', async () => {
    const h = harness();
    h.state.op.reconcile_only = true;
    h.order.provider_order_id = 'existing-provider-order';
    h.state.fact = h.fact;
    await h.service.drain();
    expect(h.state.orderWrites).toBe(0);
    expect(h.state.op.status).toBe('UNKNOWN');
  });
  it('no supplier configuration produces no network work and reports a closed feature', async () => {
    const service = new InsuranceService({} as Pool, {
      databaseUrl: 'postgres://unused@127.0.0.1/unused',
      appOrigin: 'http://127.0.0.1:5173',
    });
    expect(service.capabilities().enabled).toBe(false);
    await service.drain();
  });
});
