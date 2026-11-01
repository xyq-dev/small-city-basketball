import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { RegistrationWorkspace } from '../registration/shared';

export function yuanToFen(raw: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw.trim())) throw new Error('金额最多两位小数');
  const [whole, fraction = ''] = raw.trim().split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function fenText(fen: number) {
  return `¥${(fen / 100).toFixed(2)}（${fen} 分）`;
}

export function commandId() {
  return crypto.randomUUID();
}

/** Drops a response that belongs to an older detail, institution or account view. */
export function useEpoch() {
  const epoch = useRef(0);
  return {
    next() {
      epoch.current += 1;
      return epoch.current;
    },
    peek() {
      return epoch.current;
    },
    current(token: number) {
      return token === epoch.current;
    },
  };
}

/** Product timestamps are China civil time, matching the existing mini program. */
export function chinaIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('请按北京时间填写到分钟');
  const date = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(date.getTime())) throw new Error('时间无效');
  return date.toISOString();
}

export function reasonText(value: string) {
  const text = value.trim();
  if (text.length < 4 || text.length > 500) throw new Error('操作说明请填写 4 到 500 字');
  return text;
}

export function OperationsFrame({
  context,
  children,
}: {
  context: RegistrationWorkspace;
  children: (orgId: string) => ReactNode;
}) {
  if (!context.organizationId || context.teamContext)
    return (
      <section className="panel" role="status">
        <h1>请先进入机构工作台</h1>
        <p>这些资料按当前机构授权读取。切换机构后页面会重新加载。</p>
      </section>
    );
  return <>{children(context.organizationId)}</>;
}
