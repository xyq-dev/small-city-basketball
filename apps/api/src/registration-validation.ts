import {
  ENTRY_COMMANDS,
  ENTRY_STATUSES,
  REGISTRATION_COMMANDS,
} from '@small-city-basketball/contracts';
import type {
  EntryCommandInput,
  EntryStatus,
  RegistrationCommandInput,
  RegistrationRulesInput,
  UpdateEntryRosterInput,
  UpdateTeamMembersInput,
} from '@small-city-basketball/contracts';
import { invalid, objectInput, resourceId, text } from './validation.js';

export function expectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 2147483647)
    invalid('请提供有效版本', { expectedVersion: '版本需为正整数' });
  return value as number;
}
export function teamInput(value: unknown, updating = false) {
  const input = objectInput(value, updating ? ['name', 'expectedVersion'] : ['name']);
  return {
    name: text(input.name, 'name', 1, 80),
    ...(updating ? { expectedVersion: expectedVersion(input.expectedVersion) } : {}),
  };
}
export function teamMembersInput(value: unknown): UpdateTeamMembersInput {
  const input = objectInput(value, ['expectedVersion', 'members']);
  if (!Array.isArray(input.members) || input.members.length > 60)
    invalid('球队名单最多60人', { members: '请填写最多60名成员' });
  const seen = new Set<string>();
  const members = input.members.map((raw) => {
    const member = objectInput(raw, ['id', 'name']);
    let id: string | undefined;
    if (member.id !== undefined) {
      if (typeof member.id !== 'string') invalid('无效成员编号', { members: '请使用本队成员编号' });
      try {
        id = resourceId(member.id);
      } catch {
        invalid('无效成员编号', { members: '请使用本队成员编号' });
      }
      if (seen.has(id)) invalid('成员不能重复', { members: '成员编号不能重复' });
      seen.add(id);
    }
    return { ...(id ? { id } : {}), name: text(member.name, 'name', 1, 80) };
  });
  return { expectedVersion: expectedVersion(input.expectedVersion), members };
}
export function rulesInput(value: unknown): RegistrationRulesInput {
  const input = objectInput(value, [
    'expectedVersion',
    'minPlayers',
    'maxPlayers',
    'zeroAndDoubleZeroDistinct',
    'requireIdentity',
    'requireInsurance',
  ]);
  if (
    !Number.isInteger(input.minPlayers) ||
    !Number.isInteger(input.maxPlayers) ||
    Number(input.minPlayers) < 1 ||
    Number(input.maxPlayers) > 60 ||
    Number(input.maxPlayers) < Number(input.minPlayers)
  )
    invalid('参赛人数需为1–60且上限不低于下限', {
      minPlayers: '请检查人数上下限',
      maxPlayers: '请检查人数上下限',
    });
  for (const field of ['zeroAndDoubleZeroDistinct', 'requireIdentity', 'requireInsurance'])
    if (typeof input[field] !== 'boolean') invalid('请明确选择规则', { [field]: '请选择是或否' });
  return {
    expectedVersion: expectedVersion(input.expectedVersion),
    minPlayers: input.minPlayers as number,
    maxPlayers: input.maxPlayers as number,
    zeroAndDoubleZeroDistinct: input.zeroAndDoubleZeroDistinct as boolean,
    requireIdentity: input.requireIdentity as boolean,
    requireInsurance: input.requireInsurance as boolean,
  };
}
export function rosterInput(value: unknown): UpdateEntryRosterInput {
  const input = objectInput(value, ['expectedVersion', 'players']);
  if (!Array.isArray(input.players) || input.players.length > 60)
    invalid('名单最多60人', { players: '请填写最多60名球员' });
  const seen = new Set<string>();
  const players = input.players.map((raw) => {
    const player = objectInput(raw, ['memberId', 'jerseyNo']);
    let memberId: string;
    try {
      memberId = typeof player.memberId === 'string' ? resourceId(player.memberId) : '';
    } catch {
      memberId = '';
    }
    if (!memberId || seen.has(memberId))
      invalid('球员编号无效或重复', { players: '请使用不重复的本队成员' });
    if (typeof player.jerseyNo !== 'string' || !/^(?:0|00|[1-9][0-9]?)$/.test(player.jerseyNo))
      invalid('球衣号码需为0、00或1–99', { players: '请检查球衣号码' });
    seen.add(memberId);
    return { memberId, jerseyNo: player.jerseyNo };
  });
  return { expectedVersion: expectedVersion(input.expectedVersion), players };
}
export function assertJerseyNumbers(players: { jerseyNo: string }[], distinct: boolean) {
  const seen = new Set<string>();
  for (const player of players) {
    const key = !distinct && player.jerseyNo === '00' ? '0' : player.jerseyNo;
    if (seen.has(key)) invalid('同一名单球衣号码不能重复', { players: '请按赛事规则使用不同号码' });
    seen.add(key);
  }
}
export function entryCommandInput(value: unknown): EntryCommandInput {
  const input = objectInput(value, ['type', 'expectedVersion', 'reason']);
  if (!(ENTRY_COMMANDS as readonly unknown[]).includes(input.type)) invalid('无效报名命令');
  const reason = input.reason === undefined ? undefined : text(input.reason, 'reason', 1, 500);
  if (['REQUEST_CHANGES', 'REJECT'].includes(input.type as string) && !reason)
    invalid('请填写退回或拒绝理由', { reason: '请输入1–500个字符' });
  return {
    type: input.type as EntryCommandInput['type'],
    expectedVersion: expectedVersion(input.expectedVersion),
    ...(reason ? { reason } : {}),
  };
}
export function registrationCommandInput(value: unknown): RegistrationCommandInput {
  const input = objectInput(value, ['type', 'expectedVersion']);
  if (!(REGISTRATION_COMMANDS as readonly unknown[]).includes(input.type)) invalid('无效报名命令');
  return {
    type: input.type as RegistrationCommandInput['type'],
    expectedVersion: expectedVersion(input.expectedVersion),
  };
}
export interface PageInput {
  limit: number;
  cursor?: string;
  q?: string;
  teamId?: string;
  status?: EntryStatus;
}
export function pageInput(value: unknown, extras: readonly string[] = []): PageInput {
  const input = objectInput(value, ['limit', 'cursor', ...extras]);
  const result: PageInput = { limit: 20 };
  if (input.limit !== undefined) {
    if (
      typeof input.limit !== 'string' ||
      !/^[1-9]\d{0,2}$/.test(input.limit) ||
      Number(input.limit) > 100
    )
      invalid('分页数量需为1–100');
    result.limit = Number(input.limit);
  }
  if (input.cursor !== undefined) {
    if (
      typeof input.cursor !== 'string' ||
      input.cursor.length > 2048 ||
      !/^[A-Za-z0-9_-]+$/.test(input.cursor)
    )
      invalid('无效分页游标');
    result.cursor = input.cursor;
  }
  if (input.q !== undefined) result.q = text(input.q, 'q', 0, 80);
  if (input.teamId !== undefined)
    result.teamId = resourceId(typeof input.teamId === 'string' ? input.teamId : '');
  if (input.status !== undefined) {
    if (!(ENTRY_STATUSES as readonly unknown[]).includes(input.status)) invalid('无效报名状态筛选');
    result.status = input.status as EntryStatus;
  }
  return result;
}
