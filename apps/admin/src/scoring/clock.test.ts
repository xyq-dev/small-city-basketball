import { describe, expect, it } from 'vitest';
import { clockLabel, clockRemaining } from './clock';

describe('server-anchored display clock', () => {
  it('uses server anchor and monotonic elapsed time, regardless of client wall clock', () => {
    const clock = { remainingMs: 60000, running: true, anchorServerTime: '2026-10-22T08:00:00Z' };
    expect(clockRemaining(clock, '2026-10-22T08:00:10Z', 5000)).toBe(45000);
    expect(clockRemaining(clock, '2026-10-22T08:00:10Z', 60000)).toBe(0);
  });
  it('does not advance a paused clock or turn zero into a new period', () => {
    const clock = { remainingMs: 2000, running: false, anchorServerTime: '2026-10-22T08:00:00Z' };
    expect(clockRemaining(clock, '2026-10-22T08:00:10Z', 999999)).toBe(2000);
    expect(clockLabel(0)).toBe('00:00');
    expect(clockLabel(1)).toBe('00:01');
    expect(clockLabel(60000)).toBe('01:00');
  });
});
