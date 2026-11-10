import type {
  CreateSoftwareMembershipPlanInput,
  CreateSoftwareMembershipOrderInput,
  SoftwareMembershipDuration,
  SoftwareMembershipTier,
  SoftwareMembershipQuote,
  SoftwareMembershipPeriodState,
} from '../../../../packages/contracts/membership.js';
import { objectInput, invalid, resourceId, text } from '../validation.js';
import { commandId, digest, integer, MAX_FEN, reason } from './domain.js';

export const MEMBERSHIP_SECONDS_PER_DAY = 86400;
export function membershipPaymentIsTimely(input: {
  paidAt: string;
  createdAt: Date;
  expiresAt: Date;
  now: Date;
  channel: 'MANUAL' | 'WECHAT_NATIVE';
}) {
  const paid = Date.parse(input.paidAt),
    created = input.createdAt.getTime(),
    expiry = input.expiresAt.getTime(),
    now = input.now.getTime();
  if (![paid, created, expiry, now].every(Number.isFinite)) return false;
  const lower = input.channel === 'WECHAT_NATIVE' ? Math.floor(created / 1000) * 1000 : created;
  return (
    paid >= lower &&
    paid <= now &&
    (input.channel === 'MANUAL' ? paid < expiry && now < expiry : paid <= expiry)
  );
}
export function membershipLimits(tier: SoftwareMembershipTier, days: SoftwareMembershipDuration) {
  return tier === 'PRO'
    ? { eventLimit: days === 30 ? 3 : 36, maxTeams: 16, maxMatches: 128 }
    : { eventLimit: days === 30 ? 10 : 120, maxTeams: 32, maxMatches: 512 };
}

export function parseMembershipPlan(raw: unknown): CreateSoftwareMembershipPlanInput {
  const v = objectInput(raw, [
    'commandId',
    'code',
    'name',
    'currency',
    'amountFen',
    'tier',
    'durationDays',
    'reason',
  ]);
  if (typeof v.code !== 'string' || !/^[a-z][a-z0-9_-]{1,31}$/.test(v.code))
    invalid('套餐代码须为2至32位小写字母、数字、下划线或短横线');
  if (v.currency !== 'CNY') invalid('当前仅支持人民币CNY');
  if (v.tier !== 'PRO' && v.tier !== 'BUSINESS') invalid('会员等级无效');
  if (v.durationDays !== 30 && v.durationDays !== 365) invalid('会员周期必须为30或365天');
  return {
    commandId: commandId(v.commandId),
    code: v.code,
    name: text(v.name, 'name', 1, 80),
    currency: 'CNY',
    amountFen: integer(v.amountFen, 'amountFen', 1, MAX_FEN),
    tier: v.tier,
    durationDays: v.durationDays,
    reason: reason(v.reason),
  };
}

export function parseMembershipOrder(raw: unknown): CreateSoftwareMembershipOrderInput {
  const v = objectInput(raw, ['commandId', 'planId', 'expectedMembershipVersion']);
  if (
    typeof v.expectedMembershipVersion !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.expectedMembershipVersion)
  )
    invalid('会员资料核对版本无效，请刷新后核对');
  return {
    commandId: commandId(v.commandId),
    planId: resourceId(typeof v.planId === 'string' ? v.planId : ''),
    expectedMembershipVersion: v.expectedMembershipVersion,
  };
}

export function makeMembershipQuote(
  p: Record<string, any>,
  previousPeriodId: string | null,
): SoftwareMembershipQuote {
  const terms = {
    planId: p.id,
    code: p.code,
    version: p.version,
    name: p.name,
    currency: 'CNY' as const,
    amountFen: p.amount_fen,
    maxTeams: p.max_teams,
    maxMatches: p.max_matches,
    validDays: p.valid_days,
    scope: 'ORG_MEMBERSHIP' as const,
    tier: p.membership_tier as SoftwareMembershipTier,
    durationDays: p.valid_days as SoftwareMembershipDuration,
    eventLimit: p.membership_events,
    previousPeriodId,
  };
  return { ...terms, hash: digest(terms) };
}

/** Fixed-second periods and a supplied database instant; never the UI or process clock. */
export function membershipPeriodState(input: {
  revokedAt: unknown;
  orderStatus: string;
  startsAt: Date;
  endsAt: Date;
  now: Date;
  usedEvents: number;
  eventLimit: number;
}): SoftwareMembershipPeriodState {
  if (input.revokedAt !== null) return 'REVOKED';
  if (input.orderStatus === 'REFUND_PENDING') return 'REFUND_PENDING';
  const start = input.startsAt.getTime(),
    end = input.endsAt.getTime(),
    now = input.now.getTime();
  if (
    input.orderStatus !== 'PAID' ||
    ![start, end, now].every(Number.isFinite) ||
    start >= end ||
    !Number.isSafeInteger(input.usedEvents) ||
    input.usedEvents < 0 ||
    !Number.isSafeInteger(input.eventLimit) ||
    input.eventLimit < 1 ||
    input.usedEvents > input.eventLimit
  )
    return 'UNAVAILABLE';
  if (now < start) return 'SCHEDULED';
  if (now >= end) return 'EXPIRED';
  if (input.usedEvents === input.eventLimit) return 'EXHAUSTED';
  return 'ACTIVE';
}
