import { describe, expect, it } from 'vitest';
import { ApiError } from './errors.js';
import {
  assertJerseyNumbers,
  entryCommandInput,
  pageInput,
  registrationCommandInput,
  rosterInput,
  rulesInput,
  teamInput,
  teamMembersInput,
} from './registration-validation.js';

const member = '11111111-1111-4111-8111-111111111111';
const another = '22222222-2222-4222-8222-222222222222';
const rules = {
  expectedVersion: 1,
  minPlayers: 1,
  maxPlayers: 60,
  zeroAndDoubleZeroDistinct: false,
  requireIdentity: false,
  requireInsurance: false,
};

describe('P03报名输入边界', () => {
  it('C23: legacy rule patches omit the opt-in while new clients must send a boolean', () => {
    expect(rulesInput(rules)).not.toHaveProperty('requireParticipantMaterials');
    expect(rulesInput({ ...rules, requireParticipantMaterials: true })).toMatchObject({
      requireParticipantMaterials: true,
    });
    expect(rulesInput({ ...rules, requireParticipantMaterials: false })).toMatchObject({
      requireParticipantMaterials: false,
    });
    for (const value of [null, 'true', 0, {}, []])
      expect(() => rulesInput({ ...rules, requireParticipantMaterials: value })).toThrow(ApiError);
  });
  it('球队与成员白名单、Unicode边界、最多60人；同名成员可共存', () => {
    expect(teamInput({ name: '  城市队  ' }).name).toBe('城市队');
    expect(
      teamMembersInput({
        expectedVersion: 1,
        members: [{ name: '同名球员' }, { name: '同名球员' }],
      }).members,
    ).toHaveLength(2);
    expect(() => teamInput({ name: '队', role: 'TEAM_MANAGER' })).toThrow(ApiError);
    expect(() => teamInput({ name: '🏀'.repeat(81) })).toThrow(ApiError);
    expect(() =>
      teamMembersInput({
        expectedVersion: 1,
        members: Array.from({ length: 61 }, () => ({ name: '球员' })),
      }),
    ).toThrow(ApiError);
    expect(() =>
      teamMembersInput({
        expectedVersion: 1,
        members: [
          { id: member, name: '甲' },
          { id: member.toUpperCase(), name: '乙' },
        ],
      }),
    ).toThrow(ApiError);
    expect(() => teamMembersInput({ expectedVersion: '1', members: [] })).toThrow(ApiError);
  });
  it('规则必须明确提供布尔选项，人数有序，禁止伪造锁定字段', () => {
    expect(rulesInput(rules)).toEqual(rules);
    for (const invalid of [
      { minPlayers: 0 },
      { maxPlayers: 61 },
      { minPlayers: 20, maxPlayers: 10 },
      { requireIdentity: 'false' },
      { zeroAndDoubleZeroDistinct: undefined },
      { expectedVersion: 0 },
      { lockedRulesetId: member },
    ]) {
      expect(() => rulesInput({ ...rules, ...invalid })).toThrow(ApiError);
    }
  });
  it('号码保持字符串语义，0和00按规则判重，拒绝前导零/负数/重复成员', () => {
    const value = rosterInput({
      expectedVersion: 1,
      players: [
        { memberId: member, jerseyNo: '0' },
        { memberId: another, jerseyNo: '00' },
      ],
    });
    expect(value.players.map((player) => player.jerseyNo)).toEqual(['0', '00']);
    expect(() => assertJerseyNumbers(value.players, false)).toThrow(ApiError);
    expect(() => assertJerseyNumbers(value.players, true)).not.toThrow();
    expect(() => assertJerseyNumbers([{ jerseyNo: '9' }, { jerseyNo: '9' }], true)).toThrow(
      ApiError,
    );
    for (const jerseyNo of ['01', '000', '-1', '100', ' 1 ', 1])
      expect(() =>
        rosterInput({ expectedVersion: 1, players: [{ memberId: member, jerseyNo }] }),
      ).toThrow(ApiError);
    expect(() =>
      rosterInput({
        expectedVersion: 1,
        players: [
          { memberId: member, jerseyNo: '1' },
          { memberId: member, jerseyNo: '2' },
        ],
      }),
    ).toThrow(ApiError);
    expect(() =>
      rosterInput({
        expectedVersion: 1,
        players: [{ memberId: member, name: '伪造姓名', jerseyNo: '1' }],
      }),
    ).toThrow(ApiError);
    expect(rosterInput({ expectedVersion: 1, players: [] }).players).toEqual([]);
  });
  it('退回与拒绝必须提供有效理由，命令和版本显式限制', () => {
    expect(
      entryCommandInput({ type: 'REQUEST_CHANGES', expectedVersion: 2, reason: '  请调整名单  ' })
        .reason,
    ).toBe('请调整名单');
    for (const reason of [undefined, '', ' ', '字'.repeat(501), '空\u0000字符'])
      expect(() => entryCommandInput({ type: 'REJECT', expectedVersion: 2, reason })).toThrow(
        ApiError,
      );
    expect(() => entryCommandInput({ type: 'APPROVED', expectedVersion: 1 })).toThrow(ApiError);
    expect(() => registrationCommandInput({ type: 'SCHEDULE', expectedVersion: 1 })).toThrow(
      ApiError,
    );
    expect(() =>
      registrationCommandInput({
        type: 'OPEN_REGISTRATION',
        expectedVersion: 1,
        status: 'RUNNING',
      }),
    ).toThrow(ApiError);
  });
  it('分页上限和路由专属筛选白名单，防嵌套query或字段注入', () => {
    expect(
      pageInput({ limit: '100', status: 'APPROVED', teamId: member }, ['teamId', 'status']),
    ).toMatchObject({ limit: 100, status: 'APPROVED', teamId: member });
    for (const value of [
      { limit: ['1', '2'] },
      { limit: '101' },
      { cursor: '!' },
      { q: '球队' },
      { role: 'ORG_OWNER' },
    ])
      expect(() => pageInput(value)).toThrow(ApiError);
    expect(() => pageInput({ status: 'UNKNOWN' }, ['status'])).toThrow(ApiError);
  });
});
