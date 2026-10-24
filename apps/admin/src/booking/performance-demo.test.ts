import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBookingRepository } from './demo';
import { createDemoPerformanceRepository } from './performance-demo';
afterEach(() => vi.restoreAllMocks());

describe('合成授权仓库分页', () => {
  it('相同创建时刻的历史也能按50条读完，cursor绑定身份且单条能力按当前角色重验', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-24T12:00:00.000Z'));
    const booking = createDemoBookingRepository();
    booking.setRole('publisher');
    const repository = createDemoPerformanceRepository(booking);
    for (let i = 0; i < 52; i++) {
      const link = await repository.nominate({
        commandId: `nominate-${i}`,
        profileId: 'demo-guard',
        orgId: 'demo-org',
        eventId: 'demo-publication-event',
        teamId: 'demo-team',
        memberId: 'demo-member-guard',
        publisherConsent: true,
        reason: '合成历史授权分页验证',
      });
      await repository.command(link.id, {
        commandId: `revoke-${i}`,
        expectedVersion: link.version,
        type: 'REVOKE',
        reason: '本次合成授权已撤销',
      });
    }
    const first = await repository.workspace();
    expect(first.links).toHaveLength(50);
    expect(first.linksHasMore).toBe(true);
    expect(first.nextCursor).toBeTypeOf('string');
    const second = await repository.workspace(first.nextCursor!);
    expect(second.links).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(second.linksHasMore).toBe(false);
    expect(new Set([...first.links, ...second.links].map((l) => l.id)).size).toBe(55);
    expect((await repository.link('demo-base-guard-two')).capabilities.canRevoke).toBe(true);
    booking.setRole('player');
    await expect(repository.workspace(first.nextCursor!)).rejects.toThrow('游标已失效');
    await expect(repository.link('demo-base-guard-two')).rejects.toThrow('没有权限');
    expect((await repository.link('demo-pending-record-link')).capabilities.canConsent).toBe(true);
    booking.setRole('operator');
    await expect(repository.link('demo-pending-record-link')).rejects.toThrow('没有权限');
  });
});
