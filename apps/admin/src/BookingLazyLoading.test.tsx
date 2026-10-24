// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createMemoryEventRepository } from './domain/repository';
import { isBookingPath } from './booking/routes';
const { loadBooking } = vi.hoisted(() => ({ loadBooking: vi.fn() }));
vi.mock('./booking/BookingPages', () => {
  loadBooking();
  return { BookingPage: () => <h1>预约模块已按需加载</h1> };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('预约模块代码分割', () => {
  it('轻量路径判断不会把其他页面当作预约入口', () => {
    expect(isBookingPath('/players')).toBe(true);
    expect(isBookingPath('/player-bookings/order-id')).toBe(true);
    expect(isBookingPath('/player-center')).toBe(true);
    expect(isBookingPath('/players-archive')).toBe(false);
    expect(isBookingPath('/events/new')).toBe(false);
    expect(isBookingPath('/account/wechat')).toBe(false);
  });
  it('普通工作台不载入预约模块，导航到预约时才加载', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal('crypto', undefined);
    window.history.replaceState({}, '', '/events');
    render(<App repository={createMemoryEventRepository({ seed: [], latencyMs: 0 })} />);
    const entry = await screen.findByRole('link', { name: '球员预约' });
    expect(loadBooking).not.toHaveBeenCalled();
    await userEvent.setup().click(entry);
    expect(await screen.findByRole('heading', { name: '预约模块已按需加载' })).toBeVisible();
    expect(loadBooking).toHaveBeenCalledOnce();
  });
});
