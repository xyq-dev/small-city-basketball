import { describe, expect, test, vi } from 'vitest';
import { createCommerceApi } from './commerce';
import { order, workspace } from '../commerce/test-fixtures';
import type { ApiClient } from './client';
const client = (value: unknown) =>
  ({
    request: vi.fn().mockResolvedValue({ data: value, meta: { requestId: 'unit' } }),
  }) as unknown as ApiClient;
describe('commercial same-origin DTO boundary', () => {
  const entitlement = {
    id: 'right-a',
    eventId: 'event-a',
    eventName: '合成权益',
    orderId: 'order-a',
    validUntil: '2026-11-11T00:00:00Z',
    revokedAt: null,
    maxTeams: 8,
    maxMatches: 32,
    activated: false,
  };
  test('accepts an older API without status and never invents a membership grant', async () => {
    const data = await createCommerceApi(
      client({ ...workspace, entitlements: [entitlement] }),
      'org-a',
    ).workspace();
    expect(data.entitlements[0]).not.toHaveProperty('activationStatus');
    expect(data.canPurchase).toBe(workspace.canPurchase);
  });
  test.each([
    { activationStatus: 'READY', statusCheckedAt: '2026-11-10T00:00:00Z' },
    { activationStatus: 'EXPIRED', statusCheckedAt: '2026-11-11T00:00:00Z' },
    { activationStatus: 'ACTIVATED', activated: true, statusCheckedAt: '2027-11-11T00:00:00Z' },
    {
      activationStatus: 'REVOKED',
      revokedAt: '2026-11-10T00:00:00Z',
      statusCheckedAt: '2026-11-11T00:00:00Z',
    },
    { activationStatus: 'REFUND_PENDING', statusCheckedAt: '2026-11-10T00:00:00Z' },
    { activationStatus: 'UNAVAILABLE', statusCheckedAt: '2026-11-10T00:00:00Z' },
  ])(
    'preserves coherent server projection %j without a client-clock freshness decision',
    async (projection) => {
      const value = { ...entitlement, ...projection };
      const data = await createCommerceApi(
        client({ ...workspace, entitlements: [value] }),
        'org-a',
      ).workspace();
      expect(data.entitlements).toEqual([value]);
    },
  );
  test.each([
    { activationStatus: 'READY' },
    { statusCheckedAt: '2026-11-10T00:00:00Z' },
    { activationStatus: 'VIP', statusCheckedAt: '2026-11-10T00:00:00Z' },
    { activationStatus: 'READY', statusCheckedAt: 'bad-time' },
    { activationStatus: 'READY', statusCheckedAt: '2026-11-11T00:00:00Z' },
    { activationStatus: 'EXPIRED', statusCheckedAt: '2026-11-10T00:00:00Z' },
    { activationStatus: 'READY', activated: true, statusCheckedAt: '2026-11-10T00:00:00Z' },
    { activationStatus: 'ACTIVATED', statusCheckedAt: '2026-11-10T00:00:00Z' },
    { activationStatus: 'REVOKED', statusCheckedAt: '2026-11-10T00:00:00Z' },
    {
      activationStatus: 'REFUND_PENDING',
      revokedAt: '2026-11-10T00:00:00Z',
      statusCheckedAt: '2026-11-11T00:00:00Z',
    },
  ])('rejects partial, unknown or contradictory entitlement projection %j', async (projection) => {
    await expect(
      createCommerceApi(
        client({ ...workspace, entitlements: [{ ...entitlement, ...projection }] }),
        'org-a',
      ).workspace(),
    ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  test('uses encoded tenant paths and rejects another organization before render', async () => {
    const c = client(workspace);
    await createCommerceApi(c, 'org-a').workspace();
    expect(c.request).toHaveBeenCalledWith('/v1/orgs/org-a/commerce', expect.anything());
    await expect(
      createCommerceApi(client({ ...workspace, orgId: 'org-b' }), 'org-a').workspace(),
    ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
    await expect(
      createCommerceApi(
        client({ ...workspace, orders: [{ ...order, orgId: 'org-b' }] }),
        'org-a',
      ).workspace(),
    ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  test('rejects fractional money, unknown statuses and forged capability shapes', async () => {
    for (const o of [
      { ...order, quote: { ...order.quote, amountFen: 1.5 } },
      { ...order, status: 'FREE_GRANTED' },
      { ...order, capabilities: { canCancel: 'yes' } },
      { ...order, capabilities: { ...order.capabilities, canCloseNative: 'yes' } },
    ])
      await expect(
        createCommerceApi(client({ ...workspace, orders: [o] }), 'org-a').workspace(),
      ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  test('does not accept a different order or remote QR URL as successful payment initiation', async () => {
    const input = { commandId: 'command', type: 'CREATE_NATIVE' as const, expectedOrderVersion: 1 };
    for (const result of [
      { order: { ...order, id: 'other' }, nativePayment: null },
      { order, nativePayment: { codeUrl: 'https://evil.example/pay' } },
    ])
      await expect(
        createCommerceApi(client(result), 'org-a').buyerCommand(order.id, input),
      ).rejects.toMatchObject({ apiCode: 'INVALID_RESPONSE' });
  });
  test('retains exact CAS/command identity and does not add price or paid status to checkout', async () => {
    const c = client({ order, nativePayment: null });
    const input = {
      commandId: 'stable-command',
      eventId: 'event-a',
      planId: 'plan-a',
      expectedEventVersion: 3,
    };
    await createCommerceApi(c, 'org-a').createOrder(input);
    const init = (c.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(JSON.parse(init.body)).toEqual(input);
    expect(init.body).not.toMatch(/amountFen|PAID|entitlement/);
  });
});
