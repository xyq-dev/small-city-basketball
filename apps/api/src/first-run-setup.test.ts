import { describe, expect, it } from 'vitest';
import { setupOrigin } from './first-run-setup.js';
import { parseBootstrapOwnerInput } from './bootstrap-owner.js';

describe('first-instance setup boundaries', () => {
  it('accepts only an exact HTTPS origin without credentials, path, query or fragment', () => {
    expect(setupOrigin('https://setup.example.test')).toBe('https://setup.example.test');
    for (const value of [
      'http://setup.example.test',
      'https://setup.example.test/',
      'https://setup.example.test?token=bad',
      'https://setup.example.test#token=bad',
      'https://user@setup.example.test',
      '',
    ])
      expect(() => setupOrigin(value)).toThrow('Setup requires a canonical HTTPS APP_ORIGIN');
  });
  it('retains existing OWNER input and password validation', () => {
    const input = {
      email: 'SYNTHETIC@example.test',
      password: 'Synthetic password 🏀 2026',
      displayName: ' 初始化用户 ',
      organizationName: ' 初始化机构 ',
    };
    expect(parseBootstrapOwnerInput(input)).toEqual({
      ...input,
      email: 'synthetic@example.test',
      displayName: '初始化用户',
      organizationName: '初始化机构',
    });
    expect(() => parseBootstrapOwnerInput({ ...input, role: 'PLATFORM_ADMIN' })).toThrow();
    expect(() => parseBootstrapOwnerInput({ ...input, password: 'short' })).toThrow();
  });
});
