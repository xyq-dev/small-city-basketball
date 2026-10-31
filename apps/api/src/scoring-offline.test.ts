import { describe, expect, test } from 'vitest';
import { offlineIntentHash, parseOfflineScoringIntent } from './scoring-offline.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const raw = () => ({
  intentId: id(1),
  queueId: id(2),
  ordinal: 1,
  previousIntentId: null,
  command: {
    commandId: id(1),
    type: 'RECORD_STAT',
    payload: { side: 'HOME', kind: 'SCORE', value: 2 },
    expectedVersion: 4,
    capturedAt: '2026-10-31T00:00:00Z',
  },
});
describe('durable offline scoring intent validation', () => {
  test('canonical intent excludes renewable control and retains original UUID/version', () => {
    const a = parseOfflineScoringIntent(raw());
    expect(a.command).not.toHaveProperty('control');
    expect(a.command.commandId).toBe(a.intentId);
    expect(a.command.expectedVersion).toBe(4);
    const b = parseOfflineScoringIntent({
      ...raw(),
      command: { ...raw().command, payload: { value: 2, kind: 'SCORE', side: 'HOME' } },
    });
    expect(offlineIntentHash(a)).toBe(offlineIntentHash(b));
    expect(offlineIntentHash(a)).not.toBe(
      offlineIntentHash(
        parseOfflineScoringIntent({ ...raw(), command: { ...raw().command, expectedVersion: 5 } }),
      ),
    );
  });
  test('rejects credentials, different original ID, malformed sequence and online-only commands', () => {
    for (const v of [
      { ...raw(), command: { ...raw().command, control: {} } },
      { ...raw(), command: { ...raw().command, commandId: id(3) } },
      { ...raw(), ordinal: 2 },
      { ...raw(), previousIntentId: id(1) },
      { ...raw(), command: { ...raw().command, type: 'CLOCK_START', payload: {} } },
    ])
      expect(() => parseOfflineScoringIntent(v)).toThrow();
  });
  test('validates professional corrections through the same strict scoring parser', () => {
    const v = {
      ...raw(),
      command: {
        ...raw().command,
        type: 'ADD_PRO_CORRECTION',
        payload: { side: 'HOME', memberId: id(4), kind: 'ASSIST', period: 1, reason: '离线漏记' },
      },
    };
    expect(parseOfflineScoringIntent(v).command.payload).toEqual(v.command.payload);
    expect(() =>
      parseOfflineScoringIntent({
        ...v,
        command: { ...v.command, payload: { ...v.command.payload, score: 2 } },
      }),
    ).toThrow();
  });
});
