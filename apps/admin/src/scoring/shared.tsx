import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import type { RegistrationWorkspace } from '../registration/shared';

export function scoringOrganization(
  context: RegistrationWorkspace,
): context is RegistrationWorkspace & { organizationId: string } {
  return Boolean(context.organizationId?.trim() && !context.teamContext);
}
export function ScoringAccessRequired() {
  return (
    <section className="panel score-empty">
      <ShieldCheck size={30} />
      <h1>请切换到机构工作台</h1>
      <p>球队身份不包含后台记分权限，请使用有场次授权的机构身份。</p>
      <Link className="button button-secondary" to="/my-team">
        返回我的球队
      </Link>
    </section>
  );
}
export function shortUser(value: string) {
  return `${value.slice(0, 8)}…`;
}
export function localMoment(value: string) {
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
export const matchStatusLabels: Record<string, string> = {
  SCHEDULED: '待准备',
  READY: '准备就绪',
  LIVE: '比赛进行中',
  PENDING_CONFIRMATION: '待独立确认',
  FINAL: '正式赛果',
  POSTPONED: '已延期',
  CANCELLED: '已取消',
};
