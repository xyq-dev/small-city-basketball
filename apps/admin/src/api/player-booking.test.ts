import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client';
import { createPlayerBookingApi, parseBookingWorkspace } from './player-booking';
import { createDemoBookingRepository } from '../booking/demo';
const fixture = () => createDemoBookingRepository().repository.workspace();
describe('预约API边界', () => {
  it('读取工作区保留服务费快照，拒绝伪造已收款响应', async () => {
    const data = await fixture();
    expect(parseBookingWorkspace(data).orders[0]?.feeBps).toBe(1000);
    data.paymentAvailable = true as false;
    expect(() => parseBookingWorkspace(data)).toThrow('资料不完整');
  });
  it('缺少服务端能力、金额不一致或赛程资料损坏时拒绝整个响应', async () => {
    const data = await fixture();
    delete (data.orders[0]!.appearances[0]!.capabilities as unknown as Record<string, unknown>)
      .canAccept;
    expect(() => parseBookingWorkspace(data)).toThrow('资料不完整');
    const badMoney = await fixture();
    badMoney.orders[0]!.appearances[0]!.totalFen += 1;
    expect(() => parseBookingWorkspace(badMoney)).toThrow('资料不完整');
    const badMatches = await fixture();
    badMatches.matches = [{ id: 'x' }] as typeof badMatches.matches;
    expect(() => parseBookingWorkspace(badMatches)).toThrow('资料不完整');
  });
  it('按ID请求独立详情，保留原命令和逐场版本，不自动重试', async () => {
    const data = await fixture();
    const request = vi
      .fn<ApiClient['request']>()
      .mockResolvedValue({ data: data.orders[0], meta: { requestId: 'test' } });
    const api = createPlayerBookingApi({ request: request as ApiClient['request'] });
    await api.get('order/id');
    expect(request.mock.calls[0]?.[0]).toBe('/v1/player-bookings/orders/order%2Fid');
    const input = {
      commandId: 'same-id',
      appearanceId: 'appearance',
      expectedVersion: 9,
      type: 'ACCEPT' as const,
      eligibilityConfirmed: true as const,
    };
    await api.command('order', input);
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual(input);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('网络失败向上传播，不构造演示数据', async () => {
    const request = vi.fn<ApiClient['request']>().mockRejectedValue(new Error('真实API断开'));
    await expect(
      createPlayerBookingApi({ request: request as ApiClient['request'] }).workspace(),
    ).rejects.toThrow('真实API断开');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
