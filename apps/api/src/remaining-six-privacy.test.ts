import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AccountClosureService } from './account-closure-service.js';
import { createAccountClosureHooks } from './account-closure-hooks.js';
import { ACCOUNT_CLOSURE_DOMAINS } from './account-closure-domain.js';
import {
  lockRemainingSixClosure,
  readRemainingSixClosureBlockers,
  revokeRemainingSixPrivacy,
} from './remaining-six-privacy.js';
const facts = {
  training_service: false,
  training_money: false,
  matching_intent: false,
  matching_source: false,
  dispatch_intent: false,
  dispatch_source: false,
  sponsor_service: false,
  sponsor_money: false,
};
const userId = randomUUID();
function deps() {
  return {
    streaming: { inspect: async () => [], revoke: async () => {} },
    insurance: { inspect: async () => [], revoke: async () => {} },
    trade: { assertSafe: async () => {} },
    notifications: { revoke: async () => {} },
    guardians: { revoke: async () => {} },
    remainingSix: {
      orgScopes: async () => [],
      lock: async () => {},
      inspect: async () => [],
      revoke: async () => {},
    },
  };
}
describe('R6 account closure obligations and monotonic privacy withdrawal', () => {
  it('requires every R6 closure dependency and advertises all four new domains', () => {
    const dependencies = deps();
    expect(createAccountClosureHooks(dependencies)?.domains).toEqual(ACCOUNT_CLOSURE_DOMAINS);
    expect(ACCOUNT_CLOSURE_DOMAINS).toEqual(
      expect.arrayContaining(['TRAINING', 'MATCHING', 'DISPATCH', 'SPONSOR_COMMERCE']),
    );
    expect(createAccountClosureHooks({ ...dependencies, remainingSix: undefined })).toBeUndefined();
    for (const domain of ['TRAINING', 'MATCHING', 'DISPATCH', 'SPONSOR_COMMERCE']) {
      const hooks = createAccountClosureHooks(dependencies)!;
      const service = new AccountClosureService(
        {} as Pool,
        { databaseUrl: 'postgres://unused@localhost/unused', appOrigin: 'http://localhost:5173' },
        { enabled: true, hooks: { ...hooks, domains: hooks.domains.filter((d) => d !== domain) } },
      );
      expect(service.capabilities().enabled).toBe(false);
    }
    for (const key of ['orgScopes', 'lock', 'inspect', 'revoke'])
      expect(
        createAccountClosureHooks({
          ...dependencies,
          remainingSix: { ...dependencies.remainingSix, [key]: undefined },
        } as unknown as Parameters<typeof createAccountClosureHooks>[0]),
      ).toBeUndefined();
  });
  it('does not convert absent, malformed, unavailable, or uncertain facts into permission to close', async () => {
    const client = (rows: unknown[]) =>
      ({
        query: async (sql: string) => ({
          rows: sql.includes('SELECT o.id,t.id AS trade_order_id') ? [] : rows,
        }),
      }) as unknown as PoolClient;
    await expect(readRemainingSixClosureBlockers(client([]), userId)).rejects.toThrow();
    await expect(readRemainingSixClosureBlockers(client([{}]), userId)).rejects.toThrow();
    await expect(
      readRemainingSixClosureBlockers(client([{ ...facts, sponsor_money: null }]), userId),
    ).rejects.toThrow();
    const broken = {
      query: async () => {
        throw Error('missing table');
      },
    } as unknown as PoolClient;
    await expect(readRemainingSixClosureBlockers(broken, userId)).rejects.toThrow('missing table');
    expect(
      await readRemainingSixClosureBlockers(
        client([{ ...facts, training_service: true, dispatch_intent: true, sponsor_money: true }]),
        userId,
      ),
    ).toEqual([
      { code: 'TRAINING_SERVICE_UNRESOLVED' },
      { code: 'DISPATCH_INTENT_UNRESOLVED' },
      { code: 'SPONSOR_MONEY_UNRESOLVED' },
    ]);
  });
  it('backs off on opposing consent locks and never waits for existing workflow rows', async () => {
    const sql: string[] = [];
    const c = {
      query: async (query: string) => {
        sql.push(query);
        return query.startsWith('SELECT source_kind')
          ? { rows: [{ source_kind: 'ADULT_PLAYER', source_id: randomUUID() }] }
          : { rows: [{ acquired: false }] };
      },
    } as unknown as PoolClient;
    await expect(lockRemainingSixClosure(c, userId)).rejects.toMatchObject({ code: '55P03' });
    expect(sql).toHaveLength(2);
    const calls: string[] = [];
    await lockRemainingSixClosure(
      {
        query: async (query: string) => {
          calls.push(query);
          return { rows: [] };
        },
      } as unknown as PoolClient,
      userId,
    );
    for (const query of calls.filter((q) => q.includes('FOR UPDATE')))
      expect(query).toContain('NOWAIT');
  });
  it('requires canonical sponsor funds for every scoped source and propagates failed reconciliation', async () => {
    const sourceId = randomUUID();
    const client = (tradeOrderId: string | null) =>
      ({
        query: async (sql: string) => {
          if (sql.includes('SELECT o.id,t.id AS trade_order_id'))
            return { rows: [{ id: sourceId, trade_order_id: tradeOrderId }] };
          if (sql.includes('AS sponsor_money')) return { rows: [{ ...facts }] };
          throw new Error('sponsor reconciliation unavailable');
        },
      }) as unknown as PoolClient;
    expect(await readRemainingSixClosureBlockers(client(null), userId)).toEqual([
      { code: 'SPONSOR_MONEY_UNRESOLVED' },
    ]);
    await expect(readRemainingSixClosureBlockers(client(randomUUID()), userId)).rejects.toThrow(
      'sponsor reconciliation unavailable',
    );
  });
  it('withdraws future discovery/contact and pending notices without deleting financial or history evidence', async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [] }));
    await revokeRemainingSixPrivacy({ query } as unknown as PoolClient, userId);
    const sql = query.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => s.includes('discovery_enabled=false,contact_enabled=false'))).toBe(true);
    expect(sql.some((s) => s.includes("UPDATE matching_outbox SET state='CANCELLED'"))).toBe(true);
    expect(
      sql.some((s) =>
        s.includes('UPDATE dispatch_preferences SET enabled=false,version=version+1'),
      ),
    ).toBe(true);
    expect(
      sql.some((s) =>
        s.includes("UPDATE training_guardian_grants SET state='REVOKED',epoch=epoch+1"),
      ),
    ).toBe(true);
    expect(
      sql.some((s) =>
        /DELETE|UPDATE (sponsor_|trade_|matching_candidates|training_attendance|dispatch_events)/.test(
          s,
        ),
      ),
    ).toBe(false);
    expect(query.mock.calls.every((c) => c[1]?.[0] === userId)).toBe(true);
  });
});
