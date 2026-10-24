import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors.js';
import type { Actor } from '../service.js';
import { PlayerBookingService } from './service.js';

function fixture(revokeBeforeWrite = false) {
  let borrowed = false;
  let limiterQueries = 0;
  let profileInserts = 0;
  const actor: Actor = {
    sessionId: randomUUID(),
    user: {
      id: randomUUID(),
      email: 'synthetic@example.test',
      display_name: '合成球员',
      password_hash: 'unused',
      status: 'ACTIVE',
    },
  };
  const now = new Date('2026-10-24T00:00:00Z');
  const player = {
    id: randomUUID(),
    user_id: actor.user.id,
    display_name: '合成球员',
    position: 'PG',
    height_cm: 180,
    city: '高州',
    bio: '',
    price_fen: 30000,
    travel_fen: 0,
    accommodation_fen: 0,
    availability: [],
    version: 1,
    status: 'PENDING',
    review_reason: null,
    created_at: now,
    updated_at: now,
  };
  const client = {
    async query(sql: string) {
      if (sql.startsWith('INSERT INTO booking_profiles')) {
        profileInserts++;
        return { rows: [player], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      borrowed = false;
    },
  } as unknown as PoolClient;
  const pool = {
    async connect() {
      if (borrowed) throw new Error('single connection is already borrowed');
      borrowed = true;
      return client;
    },
    async query() {
      // Model max=1 without waiting 5 seconds: a nested pool borrow is invalid.
      if (borrowed) throw new Error('nested limiter borrow would exhaust a max=1 pool');
      limiterQueries++;
      return { rows: [{ attempts: 1 }], rowCount: 1 };
    },
  } as unknown as Pool;
  class AuthControlledService extends PlayerBookingService {
    authCalls = 0;
    protected override async lockActor(): Promise<Actor> {
      this.authCalls++;
      if (revokeBeforeWrite && this.authCalls === 2)
        throw new ApiError(401, 'UNAUTHENTICATED', '会话已撤销');
      return actor;
    }
  }
  return {
    service: new AuthControlledService(pool, {
      databaseUrl: 'postgres://unused@127.0.0.1/unused',
      appOrigin: 'http://127.0.0.1:5173',
    }),
    counters: () => ({ borrowed, limiterQueries, profileInserts }),
    input: {
      commandId: randomUUID(),
      expectedVersion: 0,
      displayName: '合成球员',
      position: 'PG',
      heightCm: 180,
      city: '高州',
      bio: '',
      priceFen: 30000,
      travelFen: 0,
      availability: [{ startAt: '2027-01-01T10:00:00+08:00', endAt: '2027-01-01T22:00:00+08:00' }],
      adultConfirmed: true,
    },
  };
}

describe('C06 limiter connection boundaries (simulated single-connection pool)', () => {
  it('releases the auth connection before the pool-based limiter and authenticates again for writes', async () => {
    const f = fixture();
    await expect(f.service.putProfile('synthetic-cookie', f.input)).resolves.toMatchObject({
      status: 'PENDING',
    });
    expect(f.service.authCalls).toBe(2);
    expect(f.counters()).toEqual({ borrowed: false, limiterQueries: 2, profileInserts: 1 });
  });
  it('rejects a session revoked between preflight and the write transaction without creating a player', async () => {
    const f = fixture(true);
    await expect(f.service.putProfile('synthetic-cookie', f.input)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(f.counters()).toEqual({ borrowed: false, limiterQueries: 2, profileInserts: 0 });
  });
});
