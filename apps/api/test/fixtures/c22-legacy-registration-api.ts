import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApi } from '../../src/app.js';
import { RegistrationService as LegacyRegistrationService } from './c22-legacy-registration-service.js';
import { SchedulingService as LegacySchedulingService } from './c22-legacy-scheduling-service.js';
import { StandingsService as LegacyStandingsService } from './c22-legacy-standings-service.js';

export const C22_LEGACY_REGISTRATION_SOURCE = {
  commit: '83ae15a64bce2a29566d22e3885ebb44a0772bdd',
  path: 'apps/api/src/registration-service.ts',
  blob: 'dcc8285394389cb7378b7e2578b52568cbe48080',
  originalSha256: '7debdee076284a52440e0bbb9dd4b010693b27d4b218c857bface12331f6c99a',
  fixtureSha256: '2ccceccb1e55829a09993ffa2bd248b823adadf83b72ed5d7a580a2324cc4bf4',
} as const;
export const C22_LEGACY_SCHEDULING_SOURCE = {
  commit: '83ae15a64bce2a29566d22e3885ebb44a0772bdd',
  path: 'apps/api/src/scheduling-service.ts',
  blob: 'ff4cbcd44097848af7c577f0459543356e57a6a5',
  originalSha256: '9da9ea02e30dd27d2977ff4e845da164b5b9d1f4e057d84683c1b04305183954',
  fixtureSha256: '4a6872945b7ce34f394daffa1ef7110dc723db84875e5d356a60c7adcd72c9f5',
} as const;
export const C22_LEGACY_STANDINGS_SOURCE = {
  commit: '83ae15a64bce2a29566d22e3885ebb44a0772bdd',
  path: 'apps/api/src/standings-service.ts',
  blob: '50f582833b5e86b165d0fd7f4bfc2706bf2213ea',
  originalSha256: '9c528277ef4c1c80f22bc676ee1215cc3f06ea2caf70ca3621fb3124f5933cdf',
  fixtureSha256: 'd38672dbaf745544b403d8e9e73f3e3eac93dde5729364aaa21d1f31ff33a759',
} as const;
export const C22_LEGACY_COMMERCE_ACTIVATION_SOURCE = {
  commit: '83ae15a64bce2a29566d22e3885ebb44a0772bdd',
  path: 'apps/api/src/commerce/activation.ts',
  blob: '3204ef950d71be26ee4827b8380fcf6c9bf3e944',
  originalSha256: '41fd448f246fefa9a6e9b8446c11848684b5f8cc04af3e5459bf22ba50a12c35',
  fixtureSha256: 'cb377584b248c7a70c7e0fdb92f4b2590c5d1492e34e7a3e18479d086eac273d',
} as const;

/** The sole permitted derivation is relocating relative imports; no SQL or method changes. */
async function verifyFixedSource(
  name: string,
  expected: { originalSha256: string; fixtureSha256: string; blob: string },
) {
  const source = await readFile(
    new URL(
      name === 'commerce-activation'
        ? './c22-legacy-commerce-activation.ts'
        : `./c22-legacy-${name}-service.ts`,
      import.meta.url,
    ),
    'utf8',
  );
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const original =
    name === 'commerce-activation'
      ? source.replaceAll("from '../../src/commerce/", "from './")
      : source
          .replaceAll("from '../../src/", "from './")
          .replaceAll(
            "from './c22-legacy-commerce-activation.js'",
            "from './commerce/activation.js'",
          );
  const originalBlob = createHash('sha1')
    .update(`blob ${Buffer.byteLength(original)}\0`)
    .update(original)
    .digest('hex');
  if (
    digest(source) !== expected.fixtureSha256 ||
    digest(original) !== expected.originalSha256 ||
    originalBlob !== expected.blob
  )
    throw new Error(`The fixed C22 ${name} fixture source is not intact`);
}
export const verifyC22LegacyRegistrationSource = () =>
  verifyFixedSource('registration', C22_LEGACY_REGISTRATION_SOURCE);
export const verifyC22LegacySchedulingSource = () =>
  verifyFixedSource('scheduling', C22_LEGACY_SCHEDULING_SOURCE);
export const verifyC22LegacyStandingsSource = () =>
  verifyFixedSource('standings', C22_LEGACY_STANDINGS_SOURCE);
export const verifyC22LegacyCommerceActivationSource = () =>
  verifyFixedSource('commerce-activation', C22_LEGACY_COMMERCE_ACTIVATION_SOURCE);

/**
 * Test-only compatibility factory, not a reproduction of the entire historical app.
 * Controllers and schema-independent support services stay current. Only this one
 * API's registration, scheduling/activation and standings use frozen historical methods. No global
 * prototype, production provider, migration runner or database schema is changed.
 */
export async function createC22LegacyRegistrationApi(input: {
  databaseUrl: string;
  appOrigin: string;
}) {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('The fixed legacy registration provider is limited to tests');
  await Promise.all([
    verifyC22LegacyRegistrationSource(),
    verifyC22LegacySchedulingSource(),
    verifyC22LegacyStandingsSource(),
    verifyC22LegacyCommerceActivationSource(),
  ]);
  const api = await createApi(input);
  try {
    for (const [token, prototype] of [
      ['SCB_APPLICATION_SERVICE', LegacyRegistrationService.prototype],
      ['SCB_SCHEDULING_SERVICE', LegacySchedulingService.prototype],
      ['SCB_STANDINGS_SERVICE', LegacyStandingsService.prototype],
    ] as const) {
      const provider = api.app.get<{ pool: typeof api.pool; options: { production: boolean } }>(
        token,
      );
      if (provider.pool !== api.pool || provider.options.production)
        throw new Error('Legacy fixture cannot replace this provider');
      Object.setPrototypeOf(provider, prototype);
    }
    return api;
  } catch (error) {
    await api.app.close();
    await api.pool.end();
    throw error;
  }
}
