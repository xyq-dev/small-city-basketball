import { describe, expect, it } from 'vitest';
import { createDemoBookingRepository } from './demo';
import { commandId } from './model';

async function requested(demo: ReturnType<typeof createDemoBookingRepository>) {
  const order = await demo.repository.get('demo-series');
  const appearance = order.appearances.find((row) => row.status === 'REQUESTED');
  if (!appearance) throw new Error('测试需要待接单场次');
  return { order, appearance };
}

describe('演示预约的待接单争议边界', () => {
  it.each(['buyer', 'player'] as const)(
    '%s不能将待接单请求改成争议，也不延长原请求',
    async (role) => {
      const demo = createDemoBookingRepository();
      demo.setRole(role);
      const { order, appearance } = await requested(demo);
      expect(appearance.capabilities.canDispute).toBe(false);
      expect(appearance.capabilities.canCancel).toBe(true);
      expect(appearance.capabilities.canDecline).toBe(role === 'player');
      expect(appearance.expiresAt).not.toBeNull();
      await expect(
        demo.repository.command(order.id, {
          commandId: commandId(),
          appearanceId: appearance.id,
          expectedVersion: appearance.version,
          type: 'DISPUTE',
          reason: '待接单时不能冻结档期',
        }),
      ).rejects.toThrow();
      const unchanged = await demo.repository.get(order.id);
      expect(unchanged.version).toBe(order.version);
      expect(unchanged.appearances.find((row) => row.id === appearance.id)).toEqual(appearance);
    },
  );

  it.each(['buyer', 'player'] as const)('%s仍可取消未接单预约', async (role) => {
    const demo = createDemoBookingRepository();
    demo.setRole(role);
    const { order, appearance } = await requested(demo);
    const cancelled = await demo.repository.command(order.id, {
      commandId: commandId(),
      appearanceId: appearance.id,
      expectedVersion: appearance.version,
      type: 'CANCEL',
      reason: '比赛安排取消',
    });
    expect(cancelled.appearances.find((row) => row.id === appearance.id)).toMatchObject({
      status: 'CANCELLED',
      version: appearance.version + 1,
      cancellationReason: '比赛安排取消',
      capabilities: { canDispute: false, canAccept: false },
    });
  });

  it('球员仍可拒绝未接单预约', async () => {
    const demo = createDemoBookingRepository();
    demo.setRole('player');
    const { order, appearance } = await requested(demo);
    const declined = await demo.repository.command(order.id, {
      commandId: commandId(),
      appearanceId: appearance.id,
      expectedVersion: appearance.version,
      type: 'DECLINE',
      reason: '本场无法参加',
    });
    expect(declined.appearances.find((row) => row.id === appearance.id)).toMatchObject({
      status: 'DECLINED',
      version: appearance.version + 1,
      cancellationReason: '本场无法参加',
      capabilities: { canDispute: false, canAccept: false },
    });
  });

  it.each(['buyer', 'player'] as const)('接单后%s可争议，独立平台身份仍可处理', async (role) => {
    const demo = createDemoBookingRepository();
    demo.setRole('player');
    const { order, appearance } = await requested(demo);
    const accepted = await demo.repository.command(order.id, {
      commandId: commandId(),
      appearanceId: appearance.id,
      expectedVersion: appearance.version,
      type: 'ACCEPT',
      eligibilityConfirmed: true,
    });
    const acceptedAppearance = accepted.appearances.find((row) => row.id === appearance.id)!;
    expect(acceptedAppearance.status).toBe('ACCEPTED');
    demo.setRole(role);
    const participantView = await demo.repository.get(order.id);
    expect(
      participantView.appearances.find((row) => row.id === appearance.id)?.capabilities.canDispute,
    ).toBe(true);
    const disputed = await demo.repository.command(order.id, {
      commandId: commandId(),
      appearanceId: appearance.id,
      expectedVersion: acceptedAppearance.version,
      type: 'DISPUTE',
      reason: '已确认合作需要平台协调',
    });
    const disputedAppearance = disputed.appearances.find((row) => row.id === appearance.id)!;
    expect(disputedAppearance.status).toBe('DISPUTED');
    expect(disputedAppearance.capabilities.canResolveDispute).toBe(false);
    demo.setRole('operator');
    const operatorView = await demo.repository.get(order.id);
    expect(
      operatorView.appearances.find((row) => row.id === appearance.id)?.capabilities
        .canResolveDispute,
    ).toBe(true);
    const resolved = await demo.repository.command(order.id, {
      commandId: commandId(),
      appearanceId: appearance.id,
      expectedVersion: disputedAppearance.version,
      type: 'RESOLVE_DISPUTE',
      resolution: 'CANCEL',
      reason: '协调双方同意取消本场',
    });
    expect(resolved.appearances.find((row) => row.id === appearance.id)).toMatchObject({
      status: 'CANCELLED',
      version: disputedAppearance.version + 1,
    });
    expect(resolved.totals).toMatchObject({ paidFen: 0, settledFen: 0, refundedFen: 0 });
  });
});
