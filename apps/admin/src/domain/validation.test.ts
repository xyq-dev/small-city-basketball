import { describe, expect, it } from 'vitest';
import type { CreateEventInput } from './types';
import { validateEventInput } from './validation';

const valid: CreateEventInput = {
  name: '城市篮球邀请赛',
  startDate: '2026-10-22',
  endDate: '2026-10-22',
  timezone: 'Asia/Shanghai',
  format: 'GROUP_KNOCKOUT',
};

describe('赛事资料校验', () => {
  it('接受同日比赛、历史日期及未设置地点', () => {
    expect(validateEventInput(valid)).toEqual({});
    expect(validateEventInput({ ...valid, startDate: '2020-01-01' })).toEqual({});
    expect(validateEventInput({ ...valid, venueName: '   ' })).toEqual({});
  });

  it('校验去除首尾空白后的标题与Unicode字符长度', () => {
    expect(validateEventInput({ ...valid, name: ' \n ' })).toHaveProperty('name');
    expect(validateEventInput({ ...valid, name: '球'.repeat(80) })).toEqual({});
    expect(validateEventInput({ ...valid, name: '🏀'.repeat(80) })).toEqual({});
    expect(validateEventInput({ ...valid, name: '球'.repeat(81) })).toHaveProperty('name');
  });

  it.each([
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '0000-01-01',
    '2026-1-01',
    'not-a-date',
  ])('拒绝不存在或格式不符的日期 %s', (startDate) => {
    expect(validateEventInput({ ...valid, startDate })).toHaveProperty('startDate');
  });

  it('正确判断闰年并拒绝结束早于开始', () => {
    expect(validateEventInput({ ...valid, startDate: '2024-02-29' })).toEqual({});
    expect(validateEventInput({ ...valid, startDate: '2000-02-29' })).toEqual({});
    expect(validateEventInput({ ...valid, startDate: '1900-02-29' })).toHaveProperty('startDate');
    expect(validateEventInput({ ...valid, endDate: '2026-10-21' })).toHaveProperty('endDate');
  });

  it('限制P01时区、赛制与可选地点的类型和长度', () => {
    expect(validateEventInput({ ...valid, timezone: 'UTC' })).toHaveProperty('timezone');
    expect(
      validateEventInput({ ...valid, format: 'UNKNOWN' as CreateEventInput['format'] }),
    ).toHaveProperty('format');
    expect(validateEventInput({ ...valid, venueName: '场'.repeat(100) })).toEqual({});
    expect(validateEventInput({ ...valid, venueName: '场'.repeat(101) })).toHaveProperty(
      'venueName',
    );
    expect(
      validateEventInput({ ...valid, venueName: null } as unknown as CreateEventInput),
    ).toHaveProperty('venueName');
  });

  it('给缺失资料返回字段错误而不是运行时异常', () => {
    const errors = validateEventInput(undefined as unknown as CreateEventInput);
    expect(errors).toMatchObject({
      name: expect.any(String),
      startDate: expect.any(String),
      endDate: expect.any(String),
      timezone: expect.any(String),
      format: expect.any(String),
    });
  });
});
