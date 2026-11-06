import { useState } from 'react';

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  disabled: boolean;
  error?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="runtime-password-field">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          className="button button-secondary"
          aria-label={`${visible ? '隐藏' : '显示'}${label}`}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
        >
          {visible ? '隐藏' : '显示'}
        </button>
      </div>
      {error && (
        <span id={`${id}-error`} className="runtime-field-error">
          {error}
        </span>
      )}
    </>
  );
}

export function validNewPassword(password: string): boolean {
  const length = Array.from(password).length;
  return length >= 12 && length <= 128;
}
