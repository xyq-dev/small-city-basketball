import { expect, test } from 'vitest';
import {
  verifyC22LegacyRegistrationSource,
  verifyC22LegacySchedulingSource,
  verifyC22LegacyStandingsSource,
  createC22LegacyRegistrationApi,
} from './c22-legacy-registration-api.js';
import { createApi } from '../../src/app.js';
import { SchedulingService } from '../../src/scheduling-service.js';
import { StandingsService } from '../../src/standings-service.js';
import { SchedulingService as LegacySchedulingService } from './c22-legacy-scheduling-service.js';
import { StandingsService as LegacyStandingsService } from './c22-legacy-standings-service.js';

test('the test-only old registration provider exactly recovers its fixed historical source and blob', async () => {
  await expect(verifyC22LegacyRegistrationSource()).resolves.toBeUndefined();
});
test('the test-only scheduling provider recovers its exact historical source and blob', async () => {
  await expect(verifyC22LegacySchedulingSource()).resolves.toBeUndefined();
});
test('the test-only standings provider recovers its exact historical source and blob', async () => {
  await expect(verifyC22LegacyStandingsSource()).resolves.toBeUndefined();
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
