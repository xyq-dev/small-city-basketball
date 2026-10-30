import { expect, test } from 'vitest';
import { verifyC22LegacyRegistrationSource } from './c22-legacy-registration-api.js';

test('the test-only old registration provider exactly recovers its fixed historical source and blob', async () => {
  await expect(verifyC22LegacyRegistrationSource()).resolves.toBeUndefined();
});
