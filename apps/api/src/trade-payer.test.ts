import { describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { hashToken } from './security.js';
import { createTradePayerResolver } from './trade-payer.js';
import type { TradeMerchant } from './trade-provider.js';

const appId = 'wx1234567890abcdef';
const openid = 'bound_openid_123456789';
function fixture(change?: () => void) {
  let binding: any = { id: 'binding', version: 1, openid_hash: hashToken(`${appId}\n${openid}`) };
  let password = 'current-private-password-hash';
  let session = true;
  let connections = 0;
  const client = {
    async query(sql: string) {
      if (sql.includes('FROM sessions'))
        return { rows: session ? [{ created_at: new Date() }] : [] };
      if (sql.includes('FROM users')) return { rows: [{ password_hash: password, reset: null }] };
      if (sql.includes('FROM wechat_identities')) return { rows: binding ? [{ ...binding }] : [] };
      return { rows: [] };
    },
    release() {
      connections--;
    },
  };
  const pool = {
    async connect() {
      connections++;
      return client;
    },
  } as unknown as Pool;
  const merchant = { key: 'merchant', appId, payments: { enabled: true } } as TradeMerchant;
  let exchanges = 0;
  let result = { appId, openid };
  const resolve = createTradePayerResolver(
    pool,
    { enabled: true, appId },
    {
      async exchange() {
        exchanges++;
        expect(connections).toBe(0);
        change?.();
        return result;
      },
    },
    { organization: merchant },
  );
  return {
    client: client as unknown as PoolClient,
    call: () =>
      resolve({
        actorId: 'actor',
        sessionId: 'session',
        merchantKey: 'merchant',
        code: 'fresh_code',
      }),
    resolve,
    get exchanges() {
      return exchanges;
    },
    unbind: () => {
      binding = null;
    },
    version: () => {
      binding.version++;
    },
    reset: () => {
      password = 'changed-password-hash';
    },
    revoke: () => {
      session = false;
    },
    wrongTarget: () => {
      result = { appId, openid: 'other_openid_123456789' };
    },
  };
}
describe('trusted trade payer resolver', () => {
  it('returns only the currently bound server-exchanged identity without holding a connection', async () => {
    const f = fixture();
    await expect(f.call()).resolves.toMatchObject({ appId, openid });
    expect(f.exchanges).toBe(1);
  });
  for (const operation of ['unbind', 'version', 'reset', 'revoke'] as const)
    it(`rejects ${operation} while the exchange was in flight`, async () => {
      const f = fixture(() => f[operation]());
      await expect(f.call()).rejects.toMatchObject({ code: 'TRADE_PAYER_IDENTITY_CHANGED' });
    });
  for (const operation of ['unbind', 'version', 'reset', 'revoke'] as const)
    it(`rechecks ${operation} in the final dispatch transaction after resolution returned`, async () => {
      const f = fixture();
      const payer = await f.call();
      f[operation]();
      await expect(payer.assertCurrent(f.client)).rejects.toMatchObject({
        code: 'TRADE_PAYER_IDENTITY_CHANGED',
      });
    });
  it('rejects another mini-program user even when the exchange succeeds', async () => {
    const f = fixture();
    f.wrongTarget();
    await expect(f.call()).rejects.toMatchObject({ code: 'TRADE_PAYER_IDENTITY_CHANGED' });
  });
  it('rejects unknown merchant and malformed code before provider access', async () => {
    const f = fixture();
    await expect(
      f.resolve({ actorId: 'actor', sessionId: 'session', merchantKey: 'other', code: 'code' }),
    ).rejects.toMatchObject({ code: 'TRADE_PAYER_IDENTITY_CHANGED' });
    await expect(
      f.resolve({
        actorId: 'actor',
        sessionId: 'session',
        merchantKey: 'merchant',
        code: '../openid',
      }),
    ).rejects.toMatchObject({ code: 'TRADE_PAYER_IDENTITY_CHANGED' });
    expect(f.exchanges).toBe(0);
  });
});
