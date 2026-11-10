import { AlertCircle, Info, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

export type MembershipPeriodView = 'MONTH' | 'YEAR';
export function MembershipPeriodTabs({
  value,
  onChange,
}: {
  value: MembershipPeriodView;
  onChange: (value: MembershipPeriodView) => void;
}) {
  return (
    <div className="membership-period-toggle" aria-label="会员计费周期">
      <button type="button" aria-pressed={value === 'MONTH'} onClick={() => onChange('MONTH')}>
        月付
      </button>
      <button type="button" aria-pressed={value === 'YEAR'} onClick={() => onChange('YEAR')}>
        年付
      </button>
    </div>
  );
}
export function MembershipNotice({
  title,
  children,
  tone = 'neutral',
  role = 'status',
}: {
  title?: string;
  children: ReactNode;
  tone?: 'neutral' | 'info' | 'warning' | 'error';
  role?: 'status' | 'alert';
}) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'info' ? ShieldCheck : Info;
  return (
    <div className={`membership-notice is-${tone}`} role={role}>
      <Icon size={20} aria-hidden="true" />
      <div>
        {title && <strong>{title}</strong>}
        <p>{children}</p>
      </div>
    </div>
  );
}
export const membershipMoney = (fen: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(fen / 100);
export const membershipTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
