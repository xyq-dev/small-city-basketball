import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from './service.js';
import { PlayerBookingService } from './player-booking/service.js';
import type { BookingOrderData } from '@small-city-basketball/contracts';
import { createMatchingPlayerSource, matchingPlayerOrderInput } from './matching-player-source.js';
import type { MatchingConversionInput } from './matching-source-adapter.js';
const input = (): MatchingConversionInput => ({
  commandId: randomUUID(),
  kind: 'ADULT_PLAYER',
  need: {
    id: randomUUID(),
    orgId: randomUUID(),
    teamId: randomUUID(),
    regionId: randomUUID(),
    catalogVersion: 'synthetic-v1',
    startsAt: '2027-01-01T01:00:00.000Z',
    endsAt: '2027-01-01T03:00:00.000Z',
    address: '合成球场',
    windows: [
      {
        reportAt: '2027-01-01T01:00:00.000Z',
        startAt: '2027-01-01T01:30:00.000Z',
        endAt: '2027-01-01T03:00:00.000Z',
      },
    ],
  },
  candidate: {
    sourceId: randomUUID(),
    sourceOrgId: null,
    userId: randomUUID(),
    sourceVersion: 7,
    settingsVersion: 3,
    sourceSlotId: null,
    totalFen: 99999,
  },
  sourceInput: {
    eligibilityConfirmed: true,
    reviewedSettingsVersion: 3,
    acceptedTermsId: 'a'.repeat(64),
    chargeConsent: true,
  },
});
describe('matching player conversion source boundary', () => {
  it('derives original source, team, venue and every window from the pinned matching context', () => {
    const i = input(),
      raw = matchingPlayerOrderInput(i);
    expect(raw).toMatchObject({
      commandId: i.commandId,
      orgId: i.need.orgId,
      teamId: i.need.teamId,
      reviewedProfileVersions: { [i.candidate.sourceId]: 7 },
      reviewedSettingsVersion: 3,
      acceptedTermsIds: { [i.candidate.sourceId]: 'a'.repeat(64) },
      appearances: [
        {
          profileId: i.candidate.sourceId,
          conditional: false,
          venue: i.need.address,
          ...i.need.windows[0],
        },
      ],
    });
    expect(raw).not.toHaveProperty('totalFen');
    for (const key of [
      'orgId',
      'teamId',
      'profileId',
      'userId',
      'appearances',
      'eventId',
      'totalFen',
      'reviewedProfileVersions',
      'acceptedTermsIds',
      'commandId',
    ])
      expect(() =>
        matchingPlayerOrderInput({
          ...i,
          sourceInput: { ...(i.sourceInput as object), [key]: randomUUID() },
        }),
      ).toThrow();
  });
  it('the real source preparer acquires calendar, buyer command and profile locks without borrowing or committing a second transaction', async () => {
    const i = input(),
      actor = { user: { id: randomUUID() } } as Actor;
    const calls: { sql: string; values: unknown[] }[] = [];
    const client = {
      query: async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values });
        if (sql.startsWith('SELECT t.*'))
          return {
            rows: [{ id: i.need.teamId, org_id: i.need.orgId, name: '合成球队' }],
            rowCount: 1,
          };
        if (sql.startsWith('SELECT role FROM organization_memberships'))
          return { rows: [{ role: 'ORG_OWNER' }], rowCount: 1 };
        if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: '0' }], rowCount: 1 };
        if (sql.startsWith('SELECT p.*,u.status'))
          return {
            rows: [
              {
                id: i.candidate.sourceId,
                user_id: i.candidate.userId,
                version: 7,
                status: 'APPROVED',
                user_status: 'ACTIVE',
                availability: [{ startAt: i.need.startsAt, endAt: i.need.endsAt }],
                price_fen: 30000,
                travel_fen: 0,
                accommodation_fen: 0,
              },
            ],
            rowCount: 1,
          };
        if (sql.startsWith('SELECT * FROM booking_settings'))
          return { rows: [{ version: 3, fee_bps: 1000 }], rowCount: 1 };
        if (sql.startsWith('SELECT clock_timestamp()'))
          return { rows: [{ now: new Date('2026-12-31T00:00:00Z') }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    } as unknown as PoolClient;
    const nested = vi.fn(() => {
      throw Error('nested database connection forbidden');
    });
    const service = new PlayerBookingService(
      { query: nested, connect: nested } as unknown as Pool,
      { databaseUrl: 'postgres://unused@127.0.0.1/unused', appOrigin: 'http://127.0.0.1:5173' },
    );
    await createMatchingPlayerSource(service).prepare(client, actor, i);
    const index = (value: string) =>
      calls.findIndex(
        (c) =>
          c.sql.includes(value) || c.values.some((v) => typeof v === 'string' && v.includes(value)),
      );
    expect(index('x12_calendar_lock')).toBeLessThan(index('scb-booking-buyer:'));
    expect(index('scb-booking-buyer:')).toBeLessThan(index('scb-booking-operation:'));
    expect(index('scb-booking-operation:')).toBeLessThan(index('scb-booking-player:'));
    expect(
      calls.some((c) =>
        /^(BEGIN|COMMIT|SAVEPOINT|INSERT INTO booking_orders|INSERT INTO booking_appearances)/.test(
          c.sql,
        ),
      ),
    ).toBe(false);
    expect(nested).not.toHaveBeenCalled();
  });
  it('does not infer adult eligibility, charge consent or a reviewed settings version', () => {
    const i = input();
    for (const sourceInput of [
      {},
      { eligibilityConfirmed: false, reviewedSettingsVersion: 3 },
      { eligibilityConfirmed: true },
      { eligibilityConfirmed: true, reviewedSettingsVersion: 3, chargeConsent: false },
      { eligibilityConfirmed: true, reviewedSettingsVersion: 4 },
    ])
      expect(() => matchingPlayerOrderInput({ ...i, sourceInput })).toThrow();
    expect(() =>
      matchingPlayerOrderInput({ ...i, candidate: { ...i.candidate, sourceOrgId: randomUUID() } }),
    ).toThrow();
    expect(() => matchingPlayerOrderInput({ ...i, need: { ...i.need, teamId: null } })).toThrow();
  });
  it('prepares source locks in the supplied transaction, defers effects and returns the original order amount', async () => {
    const i = input(),
      c = {} as PoolClient,
      actor = { user: { id: randomUUID() } } as Actor;
    const order = {
      id: randomUUID(),
      orgId: i.need.orgId,
      teamId: i.need.teamId,
      buyerUserId: actor.user.id,
      appearances: [{ profileId: i.candidate.sourceId, playerUserId: i.candidate.userId }],
      totals: { confirmedTotalFen: 33000 },
    } as BookingOrderData;
    const execute = vi.fn(async () => order);
    const prepareCreateOrder = vi.fn(async () => ({
      players: [
        {
          id: i.candidate.sourceId,
          userId: i.candidate.userId,
          version: i.candidate.sourceVersion,
        },
      ],
      execute,
    }));
    const hook = createMatchingPlayerSource({ prepareCreateOrder });
    const prepared = await hook.prepare(c, actor, i);
    expect(prepareCreateOrder).toHaveBeenCalledWith(
      c,
      actor,
      expect.objectContaining({ teamId: i.need.teamId }),
      { kind: 'MATCHING', needId: i.need.id },
    );
    expect(execute).not.toHaveBeenCalled();
    expect(await prepared.execute()).toEqual({
      sourceKind: 'PLAYER_ORDER',
      sourceId: order.id,
      totalFen: 33000,
    });
  });
  it('rejects stale ownership/profile versions before execution and propagates original failures', async () => {
    const i = input(),
      c = {} as PoolClient,
      actor = { user: { id: randomUUID() } } as Actor;
    const execute = vi.fn(async (): Promise<BookingOrderData> => {
      throw Error('original source rejection');
    });
    for (const change of [{ id: randomUUID() }, { userId: randomUUID() }, { version: 8 }]) {
      const hook = createMatchingPlayerSource({
        prepareCreateOrder: async () => ({
          players: [
            {
              id: i.candidate.sourceId,
              userId: i.candidate.userId,
              version: i.candidate.sourceVersion,
              ...change,
            },
          ],
          execute,
        }),
      });
      await expect(hook.prepare(c, actor, i)).rejects.toMatchObject({
        code: 'MATCHING_PLAYER_SOURCE_CHANGED',
      });
    }
    expect(execute).not.toHaveBeenCalled();
    const hook = createMatchingPlayerSource({
      prepareCreateOrder: async () => ({
        players: [
          {
            id: i.candidate.sourceId,
            userId: i.candidate.userId,
            version: i.candidate.sourceVersion,
          },
        ],
        execute,
      }),
    });
    const prepared = await hook.prepare(c, actor, i);
    await expect(prepared.execute()).rejects.toThrow('original source rejection');
  });
});
