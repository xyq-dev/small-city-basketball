import type {
  BookingScope,
  BookingPosition,
  BookingPlayerData,
  BookingProfileInput,
  BookingCreateInput,
  BookingOrderData,
  BookingCommandInput,
  BookingWorkspaceData,
} from '@small-city-basketball/contracts';
export type {
  BookingScope,
  BookingPosition,
  BookingPlayerData,
  BookingProfileInput,
  BookingCreateInput,
  BookingOrderData,
  BookingCommandInput,
  BookingWorkspaceData,
  BookingAppearanceData,
} from '@small-city-basketball/contracts';
export interface BookingRepository {
  workspace(): Promise<BookingWorkspaceData>;
  get(id: string): Promise<BookingOrderData>;
  saveProfile(input: BookingProfileInput): Promise<BookingPlayerData>;
  reviewProfile(
    id: string,
    version: number,
    status: 'APPROVED' | 'REJECTED' | 'DISABLED',
    reason: string,
    commandId: string,
  ): Promise<BookingPlayerData>;
  create(input: BookingCreateInput): Promise<BookingOrderData>;
  command(id: string, input: BookingCommandInput): Promise<BookingOrderData>;
  updateFee(version: number, feeBps: number, commandId: string): Promise<void>;
}
export const scopeLabels: Record<BookingScope, string> = {
  SINGLE: '单场预约',
  MULTI: '自选多场',
  TOURNAMENT: '整届赛事',
  SEASON: '赛季合作',
  TIME_BLOCK: '按时段预约',
};
export const positionLabels: Record<BookingPosition, string> = {
  PG: '控球后卫',
  SG: '得分后卫',
  SF: '小前锋',
  PF: '大前锋',
  C: '中锋',
};
export const stateLabels: Record<string, string> = {
  PENDING: '待审核',
  APPROVED: '资料审核通过',
  REJECTED: '未通过',
  DISABLED: '已停用',
  ACTIVE: '合作进行中',
  REQUESTED: '待球员确认',
  ACCEPTED: '球员已接单',
  CONDITIONAL: '条件意向',
  CANCELLED: '已取消',
  DECLINED: '已拒绝',
  EXPIRED: '已过期',
  ARRIVED: '已到场',
  COMPLETED: '已完成',
  DISPUTED: '争议处理中',
  UNAVAILABLE: '支付未接通',
  BLOCKED: '暂不可结算',
};
export const money = (fen: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(fen / 100);
export const localTime = (iso: string | null, full = false) =>
  iso
    ? new Date(iso).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        ...(full ? { year: 'numeric' } : {}),
      })
    : '赛程待确认';
export const fee = (fen: number, bps: number) => Math.round((fen * bps) / 10000);
export function shortDate(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: 'short',
        day: 'numeric',
      })
    : '待定';
}
export function commandId() {
  const cryptography = globalThis.crypto;
  if (typeof cryptography?.randomUUID === 'function') return cryptography.randomUUID();
  if (typeof cryptography?.getRandomValues !== 'function') {
    throw new Error(
      '当前浏览器缺少安全随机数能力，无法创建预约操作编号，请使用支持 Web Crypto 的浏览器。',
    );
  }
  // getRandomValues is also available outside secure contexts. Keep UUID version
  // and variant bits explicit; never replace the cryptographic source with Math.random.
  const bytes = new Uint8Array(16);
  cryptography.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function inputTime(iso: string) {
  const time = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return time.toISOString().slice(0, 16);
}
export function isoTime(input: string) {
  return new Date(`${input}:00+08:00`).toISOString();
}
