import { describe, expect, test } from 'vitest';
import type { PoolClient } from 'pg';
import type { Actor } from './service.js';
import type { LocalServicesService } from './local-services-service.js';
import type { MatchingConversionInput } from './matching-source-adapter.js';
import { createMatchingLocalSourceHooks } from './matching-local-source.js';

const input = (): MatchingConversionInput => ({
  commandId: '10000000-0000-4000-8000-000000000001',
  kind: 'STAFF_SERVICE',
  need: {
    id: 'need',
    orgId: 'buyer-org',
    teamId: 'home',
    regionId: 'region',
    catalogVersion: 'catalog',
    startsAt: '2030-01-01T10:00:00.000Z',
    endsAt: '2030-01-01T11:00:00.000Z',
    address: '确定实际地址',
    windows: [
      {
        reportAt: '2030-01-01T10:00:00.000Z',
        startAt: '2030-01-01T10:00:00.000Z',
        endAt: '2030-01-01T11:00:00.000Z',
      },
    ],
  },
  candidate: {
    sourceId: 'listing',
    sourceOrgId: 'provider-org',
    userId: 'provider',
    sourceVersion: 4,
    sourceSlotId: 'slot',
    totalFen: 1000,
  },
  sourceInput: { acceptedTerms: true, acceptedTermsId: 'terms', chargeConsent: true },
});
function harness(query?: (sql: string) => unknown[] | undefined) {
  let body: any,
    writes = 0;
  const raw = input();
  const actor: Actor = {
    sessionId: '20000000-0000-4000-8000-000000000001',
    user: {
      id: '30000000-0000-4000-8000-000000000001',
      email: 'matching-unit@example.test',
      display_name: '合成请求人',
      password_hash: 'synthetic-unused',
      status: 'ACTIVE',
    },
  };
  const queries: { sql: string; parameters: unknown[] }[] = [];
  const defaults = (sql: string) => {
    if (sql.includes('FROM local_command_receipts')) return [];
    if (sql.includes('FROM trade_terms')) return [{ id: 'terms', amount_fen: 1000 }];
    if (sql.includes('FROM trade_orders'))
      return [
        {
          org_id: 'provider-org',
          payer_user_id: actor.user.id,
          beneficiary_user_id: 'provider',
          total_fen: 1000,
          terms_id: 'terms',
        },
      ];
    return [];
  };
  const c = {
    query: async (sql: string, parameters: unknown[] = []) => {
      queries.push({ sql, parameters });
      const rows = query?.(sql) ?? defaults(sql);
      return { rows, rowCount: rows.length };
    },
  } as unknown as PoolClient;
  const listing = {
    kind: 'SCORER',
    provider_user_id: 'provider',
    org_id: 'provider-org',
    version: 4,
  };
  const slot = { starts_at: raw.need.startsAt, ends_at: raw.need.endsAt };
  const local = {
    prepareBookingInTransaction: async (_c: unknown, _a: unknown, value: unknown) => {
      body = value;
      return {
        listing,
        slot,
        execute: async () => {
          writes++;
          return { resourceId: 'real-booking' };
        },
      };
    },
    prepareMatchupInTransaction: async (_c: unknown, _a: unknown, value: unknown) => {
      body = value;
      return {
        booking: {
          starts_at: raw.need.startsAt,
          ends_at: raw.need.endsAt,
          snapshot: {
            address: raw.need.address,
            region: { catalogVersion: raw.need.catalogVersion, regionId: raw.need.regionId },
          },
        },
        execute: async () => {
          writes++;
          return { resourceId: 'real-matchup' };
        },
      };
    },
    inspectMatchingSourceInTransaction: async () => ({ ended: true, completed: false }),
  } as unknown as LocalServicesService;
  return {
    hooks: createMatchingLocalSourceHooks(local),
    c,
    actor,
    queries,
    listing,
    slot,
    body: () => body,
    writes: () => writes,
  };
}
describe('R6 matching canonical local source boundary', () => {
  test('source input cannot replace the server-bound inventory, address, time or fee amount', async () => {
    for (const field of [
      'listingId',
      'slotId',
      'serviceAddress',
      'serviceRegion',
      'servicePoint',
      'commandId',
      'totalFen',
    ]) {
      const h = harness(),
        x = input();
      x.sourceInput = { ...(x.sourceInput as object), [field]: 'substitution' };
      await expect(h.hooks.prepare(h.c, h.actor, x)).rejects.toBeDefined();
      expect(h.body()).toBeUndefined();
      expect(h.writes()).toBe(0);
    }
  });
  test('prepare binds canonical fields and only execute creates the original source', async () => {
    const h = harness(),
      x = input(),
      prepared = await h.hooks.prepare(h.c, h.actor, x);
    expect(h.body()).toEqual({
      commandId: x.commandId,
      listingId: 'listing',
      slotId: 'slot',
      serviceRegion: { catalogVersion: 'catalog', regionId: 'region' },
      serviceAddress: '确定实际地址',
      acceptedTerms: true,
      acceptedTermsId: 'terms',
      chargeConsent: true,
    });
    expect(h.writes()).toBe(0);
    await expect(prepared.execute()).resolves.toEqual({
      sourceKind: 'LOCAL_BOOKING',
      sourceId: 'real-booking',
      totalFen: 1000,
    });
    expect(h.writes()).toBe(1);
  });
  test('stale source version, wrong slot window and price changes cannot execute', async () => {
    for (const mutate of [
      (h: ReturnType<typeof harness>) => {
        h.listing.version = 5;
      },
      (h: ReturnType<typeof harness>) => {
        h.slot.ends_at = '2030-01-01T12:00:00.000Z';
      },
    ]) {
      const h = harness();
      mutate(h);
      await expect(h.hooks.prepare(h.c, h.actor, input())).rejects.toMatchObject({
        code: 'MATCHING_SOURCE_CHANGED',
      });
      expect(h.writes()).toBe(0);
    }
    const h = harness((sql) =>
      sql.includes('FROM trade_terms') ? [{ id: 'terms', amount_fen: 2000 }] : undefined,
    );
    await expect(h.hooks.prepare(h.c, h.actor, input())).rejects.toMatchObject({
      code: 'MATCHING_PRICE_CHANGED',
    });
    expect(h.writes()).toBe(0);
  });
  test('a prior staff or team source receipt cannot be rebound to another matching conversion', async () => {
    for (const kind of ['STAFF_SERVICE', 'TEAM_MATCHUP'] as const) {
      const h = harness((sql) =>
        sql.includes('FROM local_command_receipts') ? [{ exists: 1 }] : undefined,
      );
      const x = input();
      x.kind = kind;
      if (kind === 'TEAM_MATCHUP') {
        x.candidate.totalFen = 0;
        x.sourceInput = { courtBookingId: 'court-booking', terms: '双方约定的比赛条款' };
      }
      await expect(h.hooks.prepare(h.c, h.actor, x)).rejects.toMatchObject({
        code: 'MATCHING_SOURCE_ALREADY_CREATED',
      });
      expect(h.writes()).toBe(0);
      expect(
        h.queries.find((q) => q.sql.includes('FROM local_command_receipts'))?.parameters,
      ).toEqual([h.actor.user.id, x.commandId]);
    }
  });
  test('execute refuses missing or mismatched canonical paid source bindings', async () => {
    for (const binding of [[], [{ org_id: 'wrong-org', total_fen: 1000 }]]) {
      const h = harness((sql) => (sql.includes('FROM trade_orders') ? binding : undefined));
      const prepared = await h.hooks.prepare(h.c, h.actor, input());
      await expect(prepared.execute()).rejects.toMatchObject({
        code: binding.length ? 'MATCHING_TRADE_CHANGED' : 'MATCHING_TRADE_REQUIRED',
      });
    }
  });
  test('reopening refuses unknown payment or retained money without completed settlement', async () => {
    for (const scenario of ['UNKNOWN', 'PAID']) {
      const h = harness((sql) => {
        if (sql.includes('FROM trade_orders')) return [{ id: 'trade' }];
        if (sql.includes('FROM trade_payment_attempts'))
          return [{ status: scenario, total_fen: 1000 }];
        if (sql.includes('FROM trade_deductions') && scenario === 'PAID')
          return [{ status: 'APPROVED', amount_fen: 1000 }];
        return [];
      });
      const result = await h.hooks.inspectEnded!(h.c, h.actor, {
        sourceKind: 'LOCAL_BOOKING',
        sourceId: 'source',
      });
      expect(result.unresolvedMoney).toBe(true);
    }
  });
  test('an entirely refunded final source can reopen; a completed source remains completed', async () => {
    const h = harness((sql) => {
      if (sql.includes('FROM trade_orders')) return [{ id: 'trade' }];
      if (sql.includes('FROM trade_payment_attempts')) return [{ status: 'PAID', total_fen: 1000 }];
      if (sql.includes('FROM trade_refunds')) return [{ status: 'SUCCEEDED', amount_fen: 1000 }];
      return [];
    });
    await expect(
      h.hooks.inspectEnded!(h.c, h.actor, { sourceKind: 'LOCAL_BOOKING', sourceId: 'source' }),
    ).resolves.toEqual({
      ended: true,
      completed: false,
      unresolvedMoney: false,
      retainedCostFen: 0,
    });
  });
});
