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
function harness(
  kind: 'APPLY' | 'CANCEL' | 'QUERY' = 'APPLY',
  currentProvider = 'synthetic-insurance-test',
) {
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
      product_provider_id: 'synthetic-insurance-test',
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
      lease_until: null as Date | null,
    },
    valid: true,
    applyCalls: [] as string[],
    cancelCalls: [] as string[],
    queryCalls: [] as string[],
    fact: null as InsurancePolicyFact | null,
    orderWrites: 0,
    candidateScopes: [] as unknown[],
    stealFence: false,
    databaseNow: Date.now(),
    expireLeaseOnQuery: false,
    expireLeaseOnSecondAuthorization: false,
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
            state.op.status !== 'RUNNING' ||
            (state.op.lease_until !== null && state.op.lease_until.getTime() <= state.databaseNow))
        )
          return { rows: [] };
        return { rows: [{ ...state.op }] };
      }
      if (sql.startsWith('SELECT o.*')) return { rows: [{ ...order }] };
      if (sql.startsWith('SELECT $1::timestamptz')) return { rows: [{ valid: state.valid }] };
      if (sql.startsWith('UPDATE insurance_operations')) {
        if (
          sql.includes("WHERE id=$1 AND status='RUNNING'") &&
          values.length === 3 &&
          (state.op.status !== 'RUNNING' ||
            state.op.lease_id !== values[1] ||
            state.op.fence !== values[2])
        )
          return { rows: [], rowCount: 0 };
        if (
          sql.includes('lease_until>clock_timestamp()') &&
          state.op.lease_until &&
          state.op.lease_until.getTime() <= state.databaseNow
        )
          return { rows: [], rowCount: 0 };
        if (sql.includes("SET status='RUNNING'")) {
          state.op.status = 'RUNNING';
          state.op.fence = values[1];
          state.op.lease_id = values[2];
          state.op.lease_until = new Date(state.databaseNow + 30000);
          state.op.attempt_count++;
        } else if (sql.includes("SET status='DONE'")) {
          state.op.status = 'DONE';
          state.op.lease_id = null;
        } else if (sql.includes("SET status='FAILED'")) {
          state.op.status = 'FAILED';
          state.op.lease_id = null;
        } else {
          if (sql.includes('fence=fence+1')) state.op.fence++;
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
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.startsWith('UPDATE insurance_operations')) return { rows: [] };
      if (sql.startsWith('SELECT x.id')) {
        state.candidateScopes.push(values[0]);
        return {
          rows:
            state.op.status === 'DONE'
              ? []
              : [{ id: state.op.id, org_id: order.org_id, event_id: order.event_id }],
        };
      }
      throw Error(sql);
    },
  } as unknown as Pool;
  const provider: InsuranceProvider = {
    id: currentProvider,
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
      if (state.expireLeaseOnQuery) state.databaseNow += 31000;
      return state.fact;
    },
  };
  class Service extends InsuranceService {
    protected override async transaction<T>(work: (c: PoolClient) => Promise<T>) {
      const snapshot = {
        op: structuredClone(state.op),
        order: structuredClone(order),
        orderWrites: state.orderWrites,
      };
      try {
        return await work(client);
      } catch (error) {
        state.op = snapshot.op;
        Object.assign(order, snapshot.order);
        state.orderWrites = snapshot.orderWrites;
        throw error;
      }
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
  let authorizations = 0;
  Object.defineProperty(service, 'workerAuthorization', {
    value: async () => {
      if (++authorizations === 2 && state.expireLeaseOnSecondAuthorization)
        state.databaseNow += 31000;
      return true;
    },
  });
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
    expect(h.state.op.status).toBe('RUNNING');
    expect(h.state.op.fence).toBe(2);
  });
  it('a query delayed beyond its lease without another owner cannot mint a fresh policy observation', async () => {
    const h = harness();
    h.state.fact = h.fact;
    h.state.expireLeaseOnQuery = true;
    const originalFence = h.state.op.fence;
    await h.service.drain();
    expect(h.state.orderWrites).toBe(0);
    expect(h.order.payment_status).toBe('UNPAID');
    expect(h.order.policy_status).toBe('PENDING');
    expect(h.state.op.status).toBe('UNKNOWN');
    expect(h.state.op.reconcile_only).toBe(true);
    expect(h.state.op.fence).toBeGreaterThan(originalFence);
    expect(h.state.applyCalls).toEqual([h.order.operation_id]);
  });
  it('lease expiry after authorization rolls back every tentative policy write at the final update', async () => {
    const h = harness();
    h.state.fact = h.fact;
    h.state.expireLeaseOnSecondAuthorization = true;
    await h.service.drain();
    expect(h.state.orderWrites).toBe(0);
    expect(h.order.policy_status).toBe('PENDING');
    expect(h.state.op.status).toBe('UNKNOWN');
    expect(h.state.op.reconcile_only).toBe(true);
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
  it('trusted scoped batches validate a UUID and restrict both candidate selection and lease recovery', async () => {
    const h = harness();
    await expect(h.service.drain('not-a-uuid')).rejects.toThrow();
    expect(h.state.applyCalls).toHaveLength(0);
    await h.service.drain(h.order.id);
    expect(h.state.candidateScopes).toEqual([h.order.id]);
  });
  it.each(['APPLY', 'CANCEL', 'QUERY'] as const)(
    'a %s for supplier A never reaches replacement supplier B',
    async (kind) => {
      const h = harness(kind, 'synthetic-supplier-B');
      if (kind === 'APPLY') h.state.op.reconcile_only = true;
      const originalPayment = h.order.payment_status,
        originalPolicy = h.order.policy_status;
      await h.service.drain();
      await h.service.drain();
      expect(h.state.applyCalls).toEqual([]);
      expect(h.state.cancelCalls).toEqual([]);
      expect(h.state.queryCalls).toEqual([]);
      expect(h.state.op.status).toBe('UNKNOWN');
      expect(h.state.op.reconcile_only).toBe(true);
      expect(h.order.payment_status).toBe(originalPayment);
      expect(h.order.policy_status).toBe(originalPolicy);
      expect(h.order.provider_id).toBe('synthetic-insurance-test');
      expect(h.state.orderWrites).toBe(0);
    },
  );
  it('a product with another supplier pin cannot dispatch even if the order pin matches the current driver', async () => {
    const h = harness();
    h.order.product_provider_id = 'synthetic-supplier-B';
    await h.service.drain();
    expect(h.state.applyCalls).toEqual([]);
    expect(h.state.queryCalls).toEqual([]);
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
