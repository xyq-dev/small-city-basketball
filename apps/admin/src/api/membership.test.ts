import { describe, expect, test, vi } from 'vitest';
import type { ApiClient } from './client';
import { checkedMembershipWorkspace, createMembershipApi } from './membership';
import {
  businessPlan,
  order,
  period,
  plan,
  platformWorkspace,
  workspace,
} from '../membership/test-fixtures';
const client = (value: unknown) =>
  ({
    request: vi.fn().mockResolvedValue({ data: value, meta: { requestId: 'unit' } }),
  }) as unknown as ApiClient;
describe('software membership authoritative API boundary (unit responses)', () => {
  test('reads the encoded institution path and does not calculate quota from bounded history', async () => {
    const c = client({
      ...workspace,
      periods: [period],
      historyTruncated: { plans: true, orders: true, periods: true, allocations: true },
    });
    const value = await createMembershipApi(c, 'org-a').workspace();
    expect(c.request).toHaveBeenCalledWith(
      '/v1/orgs/org-a/software-membership',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(value.periods[0].remainingEvents).toBe(24);
    expect(value.allocations).toEqual([]);
    expect(value.historyTruncated.allocations).toBe(true);
  });
  test('accepts only the independent platform workspace at the platform endpoint', async () => {
    expect(
      (await createMembershipApi(client(platformWorkspace)).workspace()).platformOperator,
    ).toBe(true);
    expect(() =>
      checkedMembershipWorkspace({ ...platformWorkspace, platformOperator: false }, null),
    ).toThrow();
  });
  test.each([
    { orgId: 'org-b' },
    { membershipVersion: 'fake-token' },
    { serverTime: 'not-a-time' },
    { serverTime: '2026-02-30T00:00:00Z' },
    { plans: [plan, plan] },
    { orders: [order, order] },
    { periods: [period, period] },
    { mode: 'FREE_PREMIUM' },
    { canPurchase: 'yes' },
    { historyTruncated: { orders: false, periods: false } },
    { purchasablePlanIds: ['missing-plan'] },
    { purchasablePlanIds: [plan.id, plan.id] },
    { canPurchase: false },
    { mode: 'OFF' },
    { orders: [{ ...order, orgId: 'org-b' }] },
    { orders: [{ ...order, eventId: 'virtual-event' }] },
    { orders: [{ ...order, quote: { ...order.quote, amountFen: 0.5 } }] },
    { orders: [{ ...order, quote: { ...order.quote, scope: 'EVENT' } }] },
    { orders: [{ ...order, quote: { ...order.quote, validDays: 30 } }] },
    { orders: [{ ...order, capabilities: { ...order.capabilities, canConfirmPayment: 'yes' } }] },
    { plans: [{ ...plan, amountFen: 1.5 }] },
    { plans: [{ ...plan, eventLimit: 3600 }] },
    { plans: [{ ...businessPlan, maxTeams: 16 }] },
    { periods: [{ ...period, orgId: 'org-b' }] },
    { periods: [{ ...period, remainingEvents: 36 }] },
    { periods: [{ ...period, state: 'VIP' }] },
    { periods: [{ ...period, state: 'EXPIRED' }] },
    { periods: [{ ...period, startsAt: '2027-11-01T00:00:00Z', endsAt: '2028-11-01T00:00:00Z' }] },
    {
      allocations: [
        {
          eventId: 'match',
          eventName: '合成',
          orgId: 'org-b',
          periodId: period.id,
          source: 'MEMBERSHIP',
          participantCount: 2,
          expectedMatchCount: 1,
          activatedAt: period.startsAt,
        },
      ],
    },
  ])('fails closed for corrupt, contradictory or cross-institution data %j', async (delta) => {
    await expect(
      createMembershipApi(client({ ...workspace, ...delta }), 'org-a').workspace(),
    ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  test('an expired period preserves unused quantity without treating it as currently available', () => {
    const result = checkedMembershipWorkspace(
      {
        ...workspace,
        serverTime: '2027-11-01T00:00:00Z',
        periods: [{ ...period, state: 'EXPIRED' }],
      },
      'org-a',
    );
    expect(result.periods[0]).toMatchObject({ state: 'EXPIRED', remainingEvents: 24 });
  });
  test('checkout sends only the exact plan and server read token; it does not submit price or member state', async () => {
    const c = client({ order, nativePayment: null });
    const input = {
      commandId: 'stable-command',
      planId: plan.id,
      expectedMembershipVersion: workspace.membershipVersion,
      amountFen: 1,
      status: 'PAID',
    };
    await createMembershipApi(c, 'org-a').createOrder(input);
    const call = (c.request as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('/v1/orgs/org-a/software-membership/orders');
    expect(JSON.parse(call[1].body)).toEqual({
      commandId: input.commandId,
      planId: input.planId,
      expectedMembershipVersion: input.expectedMembershipVersion,
    });
  });
  test.each([
    { order: { ...order, id: 'another-order' }, nativePayment: null },
    { order: { ...order, orgId: 'org-b' }, nativePayment: null },
    { order, nativePayment: { codeUrl: 'https://evil.example/pay' } },
    { order, nativePayment: { codeUrl: 'weixin://some-other-privileged-action' } },
  ])('does not accept a changed order or unrelated payment target %j', async (value) => {
    await expect(
      createMembershipApi(client(value), 'org-a').buyerCommand(order.id, {
        commandId: 'stable',
        type: 'CREATE_NATIVE',
        expectedOrderVersion: 1,
      }),
    ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  test('aborts the outstanding old-context network request without changing its command identity', async () => {
    let signal: AbortSignal | undefined;
    const c = {
      request: vi.fn().mockImplementation((_path: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise((_resolve, reject) =>
          signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
        );
      }),
    } as unknown as ApiClient;
    const api = createMembershipApi(c, 'org-a');
    const pendingRead = api.workspace();
    expect(signal?.aborted).toBe(false);
    api.abortPending();
    expect(signal?.aborted).toBe(true);
    await expect(pendingRead).rejects.toThrow('aborted');
  });
  test('organization and platform mutations cannot be sent from the other API context', async () => {
    const c = client({ order, nativePayment: null });
    await expect(
      createMembershipApi(c).createOrder({
        commandId: 'command',
        planId: plan.id,
        expectedMembershipVersion: workspace.membershipVersion,
      }),
    ).rejects.toMatchObject({ apiCode: 'INVALID_ORGANIZATION' });
    await expect(
      createMembershipApi(c, 'org-a').createPlan({
        commandId: 'command',
        code: 'plan',
        name: '合成计划',
        currency: 'CNY',
        amountFen: 19900,
        tier: 'PRO',
        durationDays: 30,
        reason: '合成发布原因',
      }),
    ).rejects.toMatchObject({ apiCode: 'INVALID_CONTEXT' });
    expect(c.request).not.toHaveBeenCalled();
  });
});
