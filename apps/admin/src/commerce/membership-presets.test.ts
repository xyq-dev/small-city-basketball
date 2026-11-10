import { describe, expect, test } from 'vitest';
import { applyMembershipPreset, membershipPresets } from './membership-presets';

describe('local event membership pricing suggestions', () => {
  test('offers only the three agreed per-event prices, quotas and activation windows', () => {
    expect(membershipPresets).toEqual([
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
    ]);
  });

  test('replaces pricing fields while retaining the operator reason and leaving sources intact', () => {
    const current = {
      code: 'custom',
      name: '原本地草稿',
      price: '110.50',
      maxTeams: '12',
      maxMatches: '66',
      validDays: '60',
      reason: '已与机构核对原有需求',
    };
    const source = { ...current };
    const preset = { ...membershipPresets[1] };
    const result = applyMembershipPreset(current, membershipPresets[1]);
    expect(result).toEqual({ ...preset, reason: current.reason });
    expect(current).toEqual(source);
    expect(membershipPresets[1]).toEqual(preset);
    expect(result).not.toHaveProperty('role');
    expect(result).not.toHaveProperty('available');
    expect(result).not.toHaveProperty('activated');
  });
});
