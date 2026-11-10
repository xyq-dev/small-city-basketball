import type {
  SoftwareMembershipDuration,
  SoftwareMembershipTier,
} from '@small-city-basketball/contracts';
export interface MembershipPlanForm {
  code: string;
  name: string;
  price: string;
  tier: SoftwareMembershipTier;
  durationDays: SoftwareMembershipDuration;
  reason: string;
}
/** Suggestions for an operator's local draft; checkout never reads these values. */
export const softwareMembershipPresets: ReadonlyArray<
  Readonly<Omit<MembershipPlanForm, 'reason'>>
> = [
  {
    code: 'scb_pro_month',
    name: '小城市·专业机构月费',
    price: '199',
    tier: 'PRO',
    durationDays: 30,
  },
  {
    code: 'scb_pro_year',
    name: '小城市·专业机构年费',
    price: '1699',
    tier: 'PRO',
    durationDays: 365,
  },
  {
    code: 'scb_business_month',
    name: '小城市·商业机构月费',
    price: '399',
    tier: 'BUSINESS',
    durationDays: 30,
  },
  {
    code: 'scb_business_year',
    name: '小城市·商业机构年费',
    price: '3399',
    tier: 'BUSINESS',
    durationDays: 365,
  },
];
export function membershipDraftQuota(
  tier: SoftwareMembershipTier,
  days: SoftwareMembershipDuration,
) {
  return {
    eventLimit: tier === 'PRO' ? (days === 365 ? 36 : 3) : days === 365 ? 120 : 10,
    maxTeams: tier === 'PRO' ? 16 : 32,
    maxMatches: tier === 'PRO' ? 128 : 512,
  };
}
export function membershipDraftFen(value: string): number | null {
  const parts = /^(0|[1-9][0-9]{0,6})(?:\.([0-9]{1,2}))?$/.exec(value);
  if (!parts) return null;
  const amount = Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= 100_000_000 ? amount : null;
}
