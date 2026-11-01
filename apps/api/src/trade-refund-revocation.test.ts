import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, test, vi } from 'vitest';
import { ApiError } from './errors.js';
import { tradeHash } from './trade-domain.js';
import { TradeService } from './trade-service.js';

/** Unit-only controlled source facts. Real auth, SQL rollback and source-chain tests are separate PG cases. */
function fixture() {
  const actorId = randomUUID(),
    payer = randomUUID(),
    beneficiary = randomUUID();
  const order = {
    id: randomUUID(),
    org_id: randomUUID(),
    kind: 'SPONSOR_ORDER',
    source_id: randomUUID(),
    source_version: 1,
    version: 5,
    payer_user_id: payer,
    beneficiary_user_id: beneficiary,
    status: 'SOURCE_CONFLICT',
    total_fen: 1000,
    merchant_name: '合成收款方',
    quote: { title: '合成订单', terms: '合成条款' },
    source_hash: tradeHash({ id: 'synthetic' }),
  };
  const refund = {
    id: randomUUID(),
    order_id: order.id,
    payment_id: randomUUID(),
    amount_fen: 1000,
    status: 'APPROVED',
    reason: '合成恢复退款',
    proposed_by: payer,
    reviewed_by: actorId,
    fence: null,
    provider_refund_id: null,
    success_at: null,
  } as Record<string, any>;
  const binding = {
    kind: order.kind,
    source_id: order.source_id,
    order_id: order.id,
    refund_id: refund.id,
    allocation_id: randomUUID(),
  };
  const source = {
    valid: true,
    payable: false,
    fulfilled: true,
    disputed: false,
    identity: { id: 'synthetic' },
  };
  const ctx = {
    a: {
      sessionId: randomUUID(),
      user: {
        id: actorId,
        email: 'reviewer@example.test',
        display_name: '合成审核人',
        password_hash: 'unit-only',
        status: 'ACTIVE',
      },
    },
    s: source,
    order,
    manage: true,
    operator: false,
  };
  const state = {
    binding: binding as typeof binding | null,
    fresh: true,
    refunds: [refund],
    attempts: [
      {
        id: refund.payment_id,
        total_fen: 1000,
        status: 'PAID',
        channel: 'NATIVE',
        expires_at: new Date(),
        paid_at: new Date(),
        checkout: null,
      },
    ],
    deductions: [] as any[],
    settlements: [] as any[],
    writes: [] as string[],
    sqlError: null as Error | null,
  };
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    let rows: any[] = [];
    if (state.sqlError) throw state.sqlError;
    if (sql.startsWith('SELECT * FROM r6_trade_refund_bindings'))
      rows = state.binding ? [state.binding] : [];
    else if (sql.startsWith('SELECT * FROM trade_refunds WHERE id=')) rows = [refund];
    else if (sql.startsWith('SELECT * FROM trade_refunds WHERE order_id=')) rows = state.refunds;
    else if (sql.startsWith('SELECT * FROM trade_payment_attempts')) rows = state.attempts;
    else if (sql.startsWith('SELECT * FROM trade_deductions')) rows = state.deductions;
    else if (sql.startsWith('SELECT * FROM trade_settlements')) rows = state.settlements;
    else if (sql.startsWith('SELECT id FROM sessions'))
      rows = state.fresh ? [{ id: ctx.a.sessionId }] : [];
    else if (sql.startsWith('SELECT clock_timestamp')) rows = [{ now: new Date() }];
    else if (sql.startsWith('UPDATE trade_refunds')) {
      state.writes.push(sql);
      refund.status = values[1];
    } else if (sql.startsWith('UPDATE') || sql.startsWith('INSERT')) state.writes.push(sql);
    return { rows, rowCount: rows.length };
  });
  const client = { query } as unknown as PoolClient;
  const revocation = vi.fn(async () => {}),
    dispatch = vi.fn(async () => {});
  const adapter = {
    reference: vi.fn(),
    read: vi.fn(),
    settlementMode: 'MODULE' as const,
    requiresProfitSharing: true,
    assertRefundAllocation: vi.fn(),
    assertRefundRevocation: revocation,
    assertRefundDispatch: dispatch,
  };
  const service = new TradeService(
    {} as Pool,
    { databaseUrl: 'postgresql://localhost/scb_test_unit', appOrigin: 'http://localhost:5173' },
    {},
    { SPONSOR_ORDER: adapter, TRAINING_ENROLLMENT: adapter },
  );
  vi.spyOn(service as any, 'transaction').mockImplementation(async (work: any) => work(client));
  vi.spyOn(service as any, 'context').mockResolvedValue(ctx);
  const review = (decision = 'REJECT') =>
    service.review('synthetic-cookie', order.id, 'REFUND', refund.id, {
      clientRequestId: randomUUID(),
      expectedVersion: order.version,
      decision,
      reason: '已独立核对原退款结果及后继未出网',
    });
  return {
    service,
    state,
    ctx,
    order,
    refund,
    binding,
    adapter,
    revocation,
    dispatch,
    review,
    client,
  };
}

describe('source-bound refund approval and narrowly scoped unsent sponsor retry revocation', () => {
  test('APPROVE rechecks a PENDING_REVIEW source allocation before any mutation', async () => {
    const f = fixture();
    f.refund.status = 'PENDING_REVIEW';
    f.dispatch.mockRejectedValue(new ApiError(409, 'ANCESTOR_SUCCEEDED', '祖先已成功'));
    await expect(f.review('APPROVE')).rejects.toMatchObject({ code: 'ANCESTOR_SUCCEEDED' });
    expect(f.dispatch).toHaveBeenCalledExactlyOnceWith(
      f.client,
      f.order.source_id,
      f.binding.allocation_id,
      1000,
    );
    expect(f.refund.status).toBe('PENDING_REVIEW');
    expect(f.state.writes).toEqual([]);
  });
  test('valid PENDING_REVIEW source is approved, while legacy approval has no new source requirement', async () => {
    const f = fixture();
    f.refund.status = 'PENDING_REVIEW';
    await f.review('APPROVE');
    expect(f.refund.status).toBe('APPROVED');
    expect(f.dispatch).toHaveBeenCalledOnce();
    const legacy = fixture();
    legacy.refund.status = 'PENDING_REVIEW';
    legacy.order.kind = 'LOCAL_BOOKING';
    await legacy.review('APPROVE');
    expect(legacy.dispatch).not.toHaveBeenCalled();
  });
  test('verified unsent approved sponsor retry may be independently rejected without replacing its binding', async () => {
    const f = fixture();
    const before = structuredClone(f.binding);
    await f.review();
    expect(f.refund.status).toBe('REJECTED');
    expect(f.state.binding).toEqual(before);
    expect(f.revocation).toHaveBeenCalledExactlyOnceWith(
      f.client,
      f.order.source_id,
      f.binding.allocation_id,
      1000,
    );
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.state.writes.some((s) => s.includes('r6_trade_refund_bindings'))).toBe(false);
  });
  test.each(['SENDING', 'UNKNOWN', 'PROCESSING', 'FAILED', 'SUCCEEDED', 'REJECTED'])(
    'cannot revoke %s as an unsent approval',
    async (status) => {
      const f = fixture();
      f.refund.status = status;
      await expect(f.review()).rejects.toMatchObject({ code: 'TRADE_REVIEW_STATE' });
      expect(f.revocation).not.toHaveBeenCalled();
      expect(f.state.writes).toEqual([]);
    },
  );
  test.each(['fence', 'provider_refund_id', 'success_at'])(
    'APPROVED with %s evidence cannot be revoked',
    async (column) => {
      const f = fixture();
      f.refund[column] = column === 'success_at' ? new Date() : randomUUID();
      await expect(f.review()).rejects.toMatchObject({ code: 'TRADE_REVIEW_STATE' });
      expect(f.state.writes).toEqual([]);
      expect((await f.service.get('cookie', f.order.id)).refunds[0]!.canRejectApprovedRefund).toBe(
        false,
      );
    },
  );
  test.each(['LOCAL_BOOKING', 'TRAINING_ENROLLMENT'])(
    '%s approved refund remains non-revocable',
    async (kind) => {
      const f = fixture();
      f.order.kind = kind;
      await expect(f.review()).rejects.toMatchObject({ code: 'TRADE_REVIEW_STATE' });
      expect(f.revocation).not.toHaveBeenCalled();
    },
  );
  test.each(['payer', 'beneficiary', 'proposer', 'unprivileged'])(
    '%s cannot revoke, and its capability is false',
    async (who) => {
      const f = fixture();
      if (who === 'payer') f.ctx.a.user.id = f.order.payer_user_id;
      if (who === 'beneficiary') f.ctx.a.user.id = f.order.beneficiary_user_id;
      if (who === 'proposer') f.refund.proposed_by = f.ctx.a.user.id;
      if (who === 'unprivileged') f.ctx.manage = false;
      await expect(f.review()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(f.state.writes).toEqual([]);
      expect((await f.service.get('cookie', f.order.id)).refunds[0]!.canRejectApprovedRefund).toBe(
        false,
      );
    },
  );
  test('platform operator retains the same independent common review authority', async () => {
    const f = fixture();
    f.ctx.manage = false;
    f.ctx.operator = true;
    await f.review();
    expect(f.refund.status).toBe('REJECTED');
  });
  test.each(['missing', 'wrong-kind', 'wrong-source', 'missing-hook', 'ancestor-not-successful'])(
    'revocation fails closed for %s source proof',
    async (fault) => {
      const f = fixture();
      if (fault === 'missing') f.state.binding = null;
      if (fault === 'wrong-kind') f.binding.kind = 'TRAINING_ENROLLMENT';
      if (fault === 'wrong-source') f.binding.source_id = randomUUID();
      if (fault === 'missing-hook') delete (f.adapter as any).assertRefundRevocation;
      if (fault === 'ancestor-not-successful')
        f.revocation.mockRejectedValue(new ApiError(409, 'RETRY_STILL_VALID', '祖先未成功'));
      await expect(f.review()).rejects.toBeInstanceOf(ApiError);
      expect(f.state.writes).toEqual([]);
      expect((await f.service.get('cookie', f.order.id)).refunds[0]!.canRejectApprovedRefund).toBe(
        false,
      );
    },
  );
  test('quarantine hides revocation but preserves historical GET; other provider failures remain visible', async () => {
    const f = fixture();
    f.revocation.mockRejectedValue(
      new ApiError(503, 'SPONSOR_RESTORE_QUARANTINED', '恢复隔离禁止写入'),
    );
    expect((await f.service.get('cookie', f.order.id)).refunds[0]!.canRejectApprovedRefund).toBe(
      false,
    );
    await expect(f.review()).rejects.toMatchObject({
      status: 503,
      code: 'SPONSOR_RESTORE_QUARANTINED',
    });
    expect(f.state.writes).toEqual([]);
    f.revocation.mockRejectedValue(new ApiError(503, 'OTHER_UNAVAILABLE', '未知服务错误'));
    await expect(f.service.get('cookie', f.order.id)).rejects.toMatchObject({
      code: 'OTHER_UNAVAILABLE',
    });
  });
  test('get is read-only, propagates unexpected hook/SQL errors and checks fresh session after proof', async () => {
    const f = fixture();
    const before = structuredClone(f.refund);
    expect((await f.service.get('cookie', f.order.id)).refunds[0]!.canRejectApprovedRefund).toBe(
      true,
    );
    expect(f.refund).toEqual(before);
    expect(f.state.writes).toEqual([]);
    f.revocation.mockRejectedValueOnce(new Error('synthetic database failure'));
    await expect(f.service.get('cookie', f.order.id)).rejects.toThrow('synthetic database failure');
    f.state.fresh = false;
    await expect(f.service.get('cookie', f.order.id)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(f.review()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('read-only sponsor refund over-reservation view', () => {
  function overReserved() {
    const f = fixture();
    f.state.refunds.unshift({
      ...f.refund,
      id: randomUUID(),
      status: 'SUCCEEDED',
      success_at: new Date(),
      provider_refund_id: 'synthetic-original',
    });
    return f;
  }
  test('preserves actual money and all pending reservations, keeps REJECT reachable, and strict writers still fail', async () => {
    const f = overReserved();
    const dto = await f.service.get('cookie', f.order.id);
    expect(dto).toMatchObject({
      balanceConflict: true,
      paidFen: 1000,
      refundedFen: 1000,
      refundReservedFen: 2000,
      refundableFen: 0,
      capabilities: {
        canPay: false,
        canRequestRefund: false,
        settlementAvailable: false,
        canManage: true,
      },
    });
    expect(dto.refunds.find((r) => r.id === f.refund.id)?.canRejectApprovedRefund).toBe(true);
    await expect((f.service as any).money(f.client, f.order)).rejects.toMatchObject({
      code: 'TRADE_BALANCE_INVALID',
    });
    await f.review();
    const after = await f.service.get('cookie', f.order.id);
    expect(after).toMatchObject({
      balanceConflict: false,
      paidFen: 1000,
      refundedFen: 1000,
      refundReservedFen: 1000,
      refundableFen: 0,
    });
  });
  test('ordinary kinds do not receive a relaxed read view', async () => {
    const f = overReserved();
    f.order.kind = 'LOCAL_BOOKING';
    await expect(f.service.get('cookie', f.order.id)).rejects.toMatchObject({
      code: 'TRADE_BALANCE_INVALID',
    });
  });
  test.each(['actual-refunds', 'deductions', 'invalid-pending', 'negative-settlement', 'sql'])(
    'does not mask %s integrity errors',
    async (fault) => {
      const f = overReserved();
      if (fault === 'actual-refunds') f.state.refunds[0]!.amount_fen = 1001;
      if (fault === 'deductions') f.state.deductions.push({ status: 'APPROVED', amount_fen: 1001 });
      if (fault === 'invalid-pending') f.refund.amount_fen = 0.5;
      if (fault === 'negative-settlement')
        f.state.settlements.push({ status: 'SUCCEEDED', amount_fen: 5, return_amount_fen: 6 });
      if (fault === 'sql') f.state.sqlError = new Error('synthetic SQL error');
      await expect(f.service.get('cookie', f.order.id)).rejects.toBeInstanceOf(Error);
    },
  );
});
