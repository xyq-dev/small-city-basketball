import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../api/client';
import type { ApiClient } from '../api/client';
import { PasswordField, validNewPassword } from './PasswordField';
import { createAccountSecurityApi } from './security-api';

export function AccountSecurityForm({
  client,
  email,
  disabled = false,
  onBusyChange,
  onPasswordChanged,
}: {
  client: ApiClient;
  email: string;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onPasswordChanged: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || disabled) return;
    const next: Record<string, string> = {};
    if (!currentPassword) next.currentPassword = '请输入当前密码';
    if (!validNewPassword(newPassword)) next.newPassword = '新密码需为12–128个字符';
    else if (newPassword === currentPassword) next.newPassword = '新密码不能与当前密码相同';
    if (!confirmPassword || confirmPassword !== newPassword)
      next.confirmPassword = '两次输入的新密码不一致';
    setErrors(next);
    setError('');
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(`security-${first}`)?.focus();
      return;
    }
    locked.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      await createAccountSecurityApi(client).changePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onPasswordChanged();
    } catch (cause) {
      // Password commands only display fixed copy, never arbitrary server details.
      setError(
        cause instanceof ApiError &&
          [
            'CURRENT_PASSWORD_INVALID',
            'INVALID_CURRENT_PASSWORD',
            'CURRENT_PASSWORD_INCORRECT',
            'INVALID_PASSWORD',
          ].includes(cause.apiCode)
          ? '当前密码不正确，请重新输入。'
          : cause instanceof ApiError && cause.status === 429
            ? '操作过于频繁，请稍后重试。'
            : cause instanceof ApiError && cause.status === 401
              ? '登录已失效，请重新登录。'
              : '密码未修改，请核对当前密码和新密码后重试。',
      );
    } finally {
      locked.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <section className="runtime-account-security" aria-labelledby="runtime-security-title">
      <h3 id="runtime-security-title">账号安全 → 修改密码</h3>
      <p className="runtime-profile-copy">
        新密码需为12–128个字符。修改成功后，所有设备都需重新登录。
      </p>
      <form className="runtime-invitation-form" onSubmit={(event) => void submit(event)} noValidate>
        <input type="hidden" name="username" value={email} autoComplete="username" readOnly />
        <PasswordField
          id="security-currentPassword"
          label="当前密码"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
          disabled={busy || disabled}
          error={errors.currentPassword}
        />
        <PasswordField
          id="security-newPassword"
          label="新密码"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          disabled={busy || disabled}
          error={errors.newPassword}
        />
        <PasswordField
          id="security-confirmPassword"
          label="确认新密码"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          disabled={busy || disabled}
          error={errors.confirmPassword}
        />
        {error && (
          <div className="runtime-error" role="alert">
            {error}
          </div>
        )}
        <button className="button button-primary" type="submit" disabled={busy || disabled}>
          {busy ? '正在修改密码…' : '修改密码并重新登录'}
        </button>
      </form>
    </section>
  );
}
