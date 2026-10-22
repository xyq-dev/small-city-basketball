import { describe, expect, it } from 'vitest';
import { ApiError } from './errors.js';
import {
  emailInput,
  eventInput,
  eventQuery,
  membershipInput,
  objectInput,
  passwordInput,
  text,
} from './validation.js';

const event = {
  name: '  城市邀请赛  ',
  startDate: '2026-11-01',
  endDate: '2026-11-08',
  timezone: 'Asia/Shanghai',
  format: 'ROUND_ROBIN',
};

describe('真实API输入边界', () => {
  it('名称去空白、可选地点归一化，接受Unicode边界', () => {
    expect(eventInput(event).input).toMatchObject({ name: '城市邀请赛', venueName: null });
    expect(eventInput({ ...event, venueName: ' ' }).input.venueName).toBeNull();
    expect(eventInput({ ...event, name: '🏀'.repeat(80) }).input.name).toBe('🏀'.repeat(80));
    expect(() => eventInput({ ...event, name: '🏀'.repeat(81) })).toThrow(ApiError);
  });

  it.each(['2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01'])(
    '拒绝非法日期%s',
    (startDate) => {
      expect(() => eventInput({ ...event, startDate })).toThrow(ApiError);
    },
  );

  it('日期有序、赛制/时区有限，拒绝额外身份或状态字段', () => {
    expect(() => eventInput({ ...event, endDate: '2026-10-01' })).toThrow(ApiError);
    expect(() => eventInput({ ...event, format: 'OTHER' })).toThrow(ApiError);
    expect(() => eventInput({ ...event, timezone: 'UTC' })).toThrow(ApiError);
    expect(() => eventInput({ ...event, status: 'RUNNING' })).toThrow(ApiError);
    expect(() => eventInput({ ...event, orgId: 'forged' })).toThrow(ApiError);
    expect(() => eventInput({ ...event, venueName: null })).toThrow(ApiError);
  });

  it('更新必须提供整数版本；创建不能夹带版本', () => {
    expect(eventInput({ ...event, expectedVersion: 2 }, true).expectedVersion).toBe(2);
    for (const expectedVersion of [undefined, '1', 0, 1.2, 2147483648]) {
      expect(() => eventInput({ ...event, expectedVersion }, true)).toThrow(ApiError);
    }
    expect(() => eventInput({ ...event, expectedVersion: 1 })).toThrow(ApiError);
  });

  it('JSON对象和筛选字段使用白名单，不接受数组或原型键', () => {
    expect(() => objectInput([], [])).toThrow(ApiError);
    expect(() => objectInput(null, [])).toThrow(ApiError);
    expect(() => objectInput(JSON.parse('{"__proto__":{"role":"ORG_OWNER"}}'), [])).toThrow(
      ApiError,
    );
    expect(eventQuery({ q: ' 联赛 ', status: 'DRAFT', limit: '100' })).toMatchObject({
      q: '联赛',
      status: 'DRAFT',
      limit: 100,
    });
    expect(() => eventQuery({ limit: '101' })).toThrow(ApiError);
    expect(() => eventQuery({ limit: ['1', '2'] })).toThrow(ApiError);
    expect(() => eventQuery({ sort: 'password_hash' })).toThrow(ApiError);
  });

  it('不能通过成员接口授予OWNER或任意状态', () => {
    expect(() => membershipInput({ role: 'ORG_OWNER', status: 'ACTIVE' })).toThrow(ApiError);
    expect(() => membershipInput({ role: 'ORG_ADMIN', status: 'INACTIVE' })).toThrow(ApiError);
    expect(() => membershipInput({ role: 'ORG_ADMIN', status: 'ACTIVE' }, true)).toThrow(ApiError);
    expect(membershipInput({ role: 'SCORER', status: 'DISABLED' }, true)).toEqual({
      role: 'SCORER',
      status: 'DISABLED',
    });
  });

  it('邮箱规范化，密码12–128码点且不自动trim改变凭据', () => {
    expect(emailInput(' USER@Example.Test ')).toBe('user@example.test');
    expect(() => emailInput('bad-email')).toThrow(ApiError);
    expect(() => passwordInput('x'.repeat(11))).toThrow(ApiError);
    expect(() => passwordInput('x'.repeat(129))).toThrow(ApiError);
    expect(passwordInput('🔒'.repeat(12))).toBe('🔒'.repeat(12));
    expect(passwordInput('  valid-password  ')).toBe('  valid-password  ');
  });

  it('拒绝PG文字字段无法存储的NUL，返回对应字段提示', () => {
    for (const attempt of [
      () => text('机构\u0000名称', 'organizationName', 1, 80),
      () => eventInput({ ...event, name: '赛事\u0000名称' }),
      () => emailInput('private\u0000@example.test'),
    ]) {
      try {
        attempt();
        expect.fail('NUL input must be rejected before PostgreSQL');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(422);
        expect((error as ApiError).details?.fieldErrors).toBeDefined();
      }
    }
  });
});
