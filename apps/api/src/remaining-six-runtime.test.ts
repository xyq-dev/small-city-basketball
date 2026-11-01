import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readRemainingSixOptions } from './remaining-six-runtime.js';
const names = [
  'SCB_R6_MATCHING_ENABLED',
  'SCB_R6_TRAINING_ENABLED',
  'SCB_R6_DISPATCH_ENABLED',
  'SCB_R6_DISPATCH_AUTO_DISPATCH',
  'SCB_LOCAL_SEARCH_CURSOR_KEY',
  'SCB_LOCAL_SEARCH_CURSOR_KEY_FILE',
];
beforeEach(() => {
  for (const name of names) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());
it('keeps new workflow and automation off without configuration', () => {
  expect(readRemainingSixOptions()).toEqual({
    matching: { enabled: false },
    training: { enabled: false },
    dispatch: { enabled: false, autoDispatch: false },
    localSearch: {},
  });
});
it('uses explicit independent switches and rejects automation without its domain', () => {
  vi.stubEnv('SCB_R6_DISPATCH_AUTO_DISPATCH', 'true');
  expect(() => readRemainingSixOptions()).toThrow();
  vi.stubEnv('SCB_R6_DISPATCH_ENABLED', 'true');
  vi.stubEnv('SCB_R6_TRAINING_ENABLED', 'true');
  expect(readRemainingSixOptions()).toMatchObject({
    matching: { enabled: false },
    training: { enabled: true },
    dispatch: { enabled: true, autoDispatch: true },
  });
  vi.stubEnv('SCB_R6_MATCHING_ENABLED', '1');
  expect(() => readRemainingSixOptions()).toThrow();
});
it('requires a canonical dedicated 32 byte cursor key without returning it in errors', () => {
  vi.stubEnv('SCB_LOCAL_SEARCH_CURSOR_KEY', 'sensitive-invalid-key');
  try {
    readRemainingSixOptions();
    throw Error('expected rejection');
  } catch (error) {
    expect(String(error)).not.toContain('sensitive-invalid-key');
  }
  const key = Buffer.alloc(32, 73);
  vi.stubEnv('SCB_LOCAL_SEARCH_CURSOR_KEY', key.toString('base64'));
  expect(readRemainingSixOptions().localSearch.cursorKey).toEqual(key);
});
