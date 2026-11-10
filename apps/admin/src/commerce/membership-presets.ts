export interface MembershipPlanDraft {
  code: string;
  name: string;
  price: string;
  maxTeams: string;
  maxMatches: string;
  validDays: string;
  reason: string;
}

/** Local form suggestions only. Purchasable prices always come from the server catalog. */
export const membershipPresets: ReadonlyArray<Readonly<Omit<MembershipPlanDraft, 'reason'>>> = [
  {
    code: 'scb_event_basic',
    name: '小城市·基础赛事包',
    price: '99',
    maxTeams: '8',
    maxMatches: '32',
    validDays: '90',
  },
  {
    code: 'scb_event_standard',
    name: '小城市·专业赛事包',
    price: '299',
    maxTeams: '16',
    maxMatches: '128',
    validDays: '180',
  },
  {
    code: 'scb_event_business',
    name: '小城市·商业赛事包',
    price: '599',
    maxTeams: '32',
    maxMatches: '512',
    validDays: '365',
  },
];

export function applyMembershipPreset(
  current: MembershipPlanDraft,
  preset: Readonly<Omit<MembershipPlanDraft, 'reason'>>,
): MembershipPlanDraft {
  return { ...preset, reason: current.reason };
}
