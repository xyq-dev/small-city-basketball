import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import type { MatchStatus, ScheduleFixtureData } from '@small-city-basketball/contracts';
import type { RegistrationWorkspace } from '../registration/shared';
export const matchStatusLabels: Record<MatchStatus, string> = {
  SCHEDULED: '待准备',
  READY: '已准备',
  LIVE: '进行中',
  PENDING_CONFIRMATION: '待确认',
  FINAL: '已确认',
  POSTPONED: '已延期',
  CANCELLED: '已取消',
};
export function organizationContext(
  context: RegistrationWorkspace,
): context is RegistrationWorkspace & { organizationId: string } {
  return Boolean(context.organizationId && !context.teamContext);
}
export function SchedulingAccessRequired() {
  return (
    <section className="panel sc-empty">
      <ShieldCheck size={29} />
      <h1>请切换到机构工作台</h1>
      <p>球队授权不包含后台场地与排赛权限。请使用有赛事授权的机构身份。</p>
      <Link className="button button-secondary" to="/my-team">
        返回我的球队
      </Link>
    </section>
  );
}
export function fixtureLabel(fixture: Pick<ScheduleFixtureData, 'roundNo' | 'positionNo'>) {
  return `第${fixture.roundNo}轮第${fixture.positionNo}场`;
}
export function localInput(value: string | null) {
  if (!value) return '';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('服务返回的时间无效');
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 23);
}
export function offsetTime(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) throw new Error('请填写有效的日期和时间');
  const canonical = `${match[1]}T${match[2]}:${match[3] ?? '00'}.${(match[4] ?? '').padEnd(3, '0')}`;
  const time = Date.parse(canonical + 'Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 23) !== canonical)
    throw new Error('请填写真实有效的日历日期和时间');
  return canonical + '+08:00';
}
export function timeLabel(value: string | null) {
  return value
    ? new Date(value).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '尚未安排';
}
