import { describe, expect, test } from 'vitest';
import { parseChangePasswordInput } from './change-password-service.js';

describe('change-password input boundary', () => {
  const valid = {
    currentPassword: 'Synthetic current password 2026',
    newPassword: ' Synthetic new password 2026 ',
    confirmPassword: ' Synthetic new password 2026 ',
  };
  test('preserves whitespace and password-manager supplied Unicode', () => {
    expect(parseChangePasswordInput(valid)).toEqual(valid);
    const currentPassword = ' Ab 密🔒 ';
    expect(parseChangePasswordInput({ ...valid, currentPassword }).currentPassword).toBe(
      currentPassword,
    );
    expect(
      parseChangePasswordInput({
        ...valid,
        newPassword: '🏀'.repeat(12),
        confirmPassword: '🏀'.repeat(12),
      }).newPassword.length,
    ).toBe(24);
  });
  test('rejects mismatched confirmation, missing inputs and arbitrary account targets', () => {
    for (const input of [
      { ...valid, confirmPassword: 'Synthetic different confirmation' },
      { ...valid, currentPassword: '' },
      { ...valid, currentPassword: 'x'.repeat(129) },
      { ...valid, newPassword: 'short-pass1', confirmPassword: 'short-pass1' },
      { ...valid, newPassword: 'x'.repeat(129) },
      { ...valid, userId: 'cannot-target-another-user' },
      { ...valid, loginName: 'cannot-change-login' },
      {},
      null,
    ])
      expect(() => parseChangePasswordInput(input)).toThrow();
  });
});
