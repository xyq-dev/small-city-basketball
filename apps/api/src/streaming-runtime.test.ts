import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStreamingOptions } from './streaming-runtime.js';
afterEach(() => vi.unstubAllEnvs());
describe('E01 real provider runtime is an explicit closed configuration boundary', () => {
  it('defaults closed and does not read unrelated secret values or construct external resources', () => {
    vi.stubEnv('SCB_STREAMING_ENABLED', undefined);
    vi.stubEnv('SCB_CSS_SECRET_KEY', 'synthetic-secret-that-must-not-be-read');
    expect(readStreamingOptions()).toEqual({ autoDispatch: false, authorizeRecording: undefined });
  });
  it('rejects ambiguous flags and missing or non organization-bound configurations before any execution', () => {
    vi.stubEnv('SCB_STREAMING_ENABLED', 'yes');
    expect(() => readStreamingOptions()).toThrow('Invalid streaming configuration');
    vi.stubEnv('SCB_STREAMING_ENABLED', 'true');
    vi.stubEnv(
      'SCB_STREAMING_TARGETS_JSON',
      '[{"host":"untrusted.example.com","publishKey":"must-not-be-accepted"}]',
    );
    expect(() => readStreamingOptions()).toThrow('Invalid organization-bound streaming targets');
  });
});
