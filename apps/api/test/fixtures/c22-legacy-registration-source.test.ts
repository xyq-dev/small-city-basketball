import { expect, test, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  verifyC22LegacyRegistrationSource,
  verifyC22LegacySchedulingSource,
  verifyC22LegacyStandingsSource,
  verifyC22LegacyCommerceActivationSource,
  createC22LegacyRegistrationApi,
} from './c22-legacy-registration-api.js';
import { createApi } from '../../src/app.js';
import { SchedulingService } from '../../src/scheduling-service.js';
import { StandingsService } from '../../src/standings-service.js';
import { SchedulingService as LegacySchedulingService } from './c22-legacy-scheduling-service.js';
import { StandingsService as LegacyStandingsService } from './c22-legacy-standings-service.js';
import { activateEventCommerce as activateLegacyCommerce } from './c22-legacy-commerce-activation.js';

test('the test-only old registration provider exactly recovers its fixed historical source and blob', async () => {
  await expect(verifyC22LegacyRegistrationSource()).resolves.toBeUndefined();
});
test('the test-only scheduling provider recovers its exact historical source and blob', async () => {
  await expect(verifyC22LegacySchedulingSource()).resolves.toBeUndefined();
});
test('the test-only standings provider recovers its exact historical source and blob', async () => {
  await expect(verifyC22LegacyStandingsSource()).resolves.toBeUndefined();
});
test('the legacy scheduling activation dependency recovers the same fixed historical source and blob', async () => {
  await expect(verifyC22LegacyCommerceActivationSource()).resolves.toBeUndefined();
});
test('the frozen activation retains the original activation and audit writes without post-022 columns', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  await activateLegacyCommerce({ query } as unknown as PoolClient, {
    orgId: 'legacy-org',
    eventId: 'legacy-event',
    actorId: 'legacy-owner',
    participantCount: 2,
    expectedMatchCount: 1,
    mode: 'OFF',
  });
  expect(query).toHaveBeenCalledTimes(3);
  expect(query.mock.calls[1]?.[0]).toMatch(/^INSERT INTO event_commercial_activations/);
  expect(query.mock.calls[1]?.[1]).toEqual([
    'legacy-event',
    'legacy-org',
    'UNMETERED',
    null,
    2,
    1,
    'legacy-owner',
  ]);
  expect(query.mock.calls[2]?.[0]).toMatch(/^INSERT INTO audit_logs/);
  expect(JSON.parse(query.mock.calls[2]?.[1]?.[4])).toEqual({
    source: 'UNMETERED',
    entitlementId: null,
    participantCount: 2,
    expectedMatchCount: 1,
  });
  for (const [sql] of query.mock.calls)
    expect(sql).not.toMatch(/membership_period_id|software_membership_periods|target_kind/);
});
test('the fixed providers affect only their legacy test instance, without a database connection', async () => {
  const input = {
    databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
    appOrigin: 'http://localhost:5173',
  };
  const legacy = await createC22LegacyRegistrationApi(input);
  let current: Awaited<ReturnType<typeof createApi>> | undefined;
  try {
    current = await createApi(input);
    expect(Object.getPrototypeOf(legacy.app.get('SCB_SCHEDULING_SERVICE'))).toBe(
      LegacySchedulingService.prototype,
    );
    expect(Object.getPrototypeOf(legacy.app.get('SCB_STANDINGS_SERVICE'))).toBe(
      LegacyStandingsService.prototype,
    );
    expect(Object.getPrototypeOf(current.app.get('SCB_SCHEDULING_SERVICE'))).toBe(
      SchedulingService.prototype,
    );
    expect(Object.getPrototypeOf(current.app.get('SCB_STANDINGS_SERVICE'))).toBe(
      StandingsService.prototype,
    );
  } finally {
    await legacy.app.close();
    await legacy.pool.end();
    if (current) {
      await current.app.close();
      await current.pool.end();
    }
  }
});
