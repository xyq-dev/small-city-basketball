import { describe, expect, it } from 'vitest';
import {
  clearedSessionCookie,
  hashPassword,
  hashToken,
  newSessionToken,
  readSessionToken,
  sessionCookie,
  verifyPassword,
} from './security.js';

describe('密码与持久会话凭据', () => {
  it('相同密码使用不同随机盐，正确密码可验证而错误密码不通过', async () => {
    const password = '合成测试密码12个字符以上🔒';
    const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);
    expect(first).toMatch(/^scrypt\$131072\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(`${password}错误`, first)).toBe(false);
  });

  it('未知用户和损坏的密码记录不会被接受', async () => {
    expect(await verifyPassword('some-long-password')).toBe(false);
    expect(await verifyPassword('some-long-password', 'broken')).toBe(false);
  });

  it('会话token是32字节随机值，只允许唯一且格式正确的cookie', () => {
    const first = newSessionToken();
    const second = newSessionToken();
    expect(first).not.toBe(second);
    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(hashToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(first)).not.toContain(first);
    expect(readSessionToken(`theme=dark; scb.sid=${first}; other=1`)).toBe(first);
    expect(readSessionToken(`scb.sid=${first}; scb.sid=${second}`)).toBeUndefined();
    expect(readSessionToken('scb.sid=short')).toBeUndefined();
    expect(readSessionToken()).toBeUndefined();
  });

  it('cookie具备必要属性，退出使用相同路径清除', () => {
    const cookie = sessionCookie(newSessionToken(), 3600, true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('; Secure');
    expect(cookie).toContain('Path=/');
    expect(clearedSessionCookie(true)).toContain('scb.sid=; Path=/; Max-Age=0');
  });
});
