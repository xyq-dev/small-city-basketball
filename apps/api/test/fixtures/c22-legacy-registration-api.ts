import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApi } from '../../src/app.js';
import { RegistrationService as LegacyRegistrationService } from './c22-legacy-registration-service.js';

export const C22_LEGACY_REGISTRATION_SOURCE = {
  commit: '83ae15a64bce2a29566d22e3885ebb44a0772bdd',
  path: 'apps/api/src/registration-service.ts',
  blob: 'dcc8285394389cb7378b7e2578b52568cbe48080',
  originalSha256: '7debdee076284a52440e0bbb9dd4b010693b27d4b218c857bface12331f6c99a',
  fixtureSha256: '2ccceccb1e55829a09993ffa2bd248b823adadf83b72ed5d7a580a2324cc4bf4',
} as const;

/** The sole permitted derivation is relocating relative imports; no SQL or method changes. */
export async function verifyC22LegacyRegistrationSource() {
  const source = await readFile(
    new URL('./c22-legacy-registration-service.ts', import.meta.url),
    'utf8',
  );
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const original = source.replaceAll("from '../../src/", "from './");
  const originalBlob = createHash('sha1')
    .update(`blob ${Buffer.byteLength(original)}\0`)
    .update(original)
    .digest('hex');
  if (
    digest(source) !== C22_LEGACY_REGISTRATION_SOURCE.fixtureSha256 ||
    digest(original) !== C22_LEGACY_REGISTRATION_SOURCE.originalSha256 ||
    originalBlob !== C22_LEGACY_REGISTRATION_SOURCE.blob
  )
    throw new Error('The fixed C22 registration fixture source is not intact');
}

/**
 * Test-only compatibility factory, not a reproduction of the entire historical app.
 * Controllers and schema-independent support services stay current. Only this one
 * API's registration provider gets the exact frozen historical methods. No global
 * prototype, production provider, migration runner or database schema is changed.
 */
export async function createC22LegacyRegistrationApi(input: {
  databaseUrl: string;
  appOrigin: string;
}) {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('The fixed legacy registration provider is limited to tests');
  await verifyC22LegacyRegistrationSource();
  const api = await createApi(input);
  try {
    const provider = api.app.get<{ pool: typeof api.pool; options: { production: boolean } }>(
      'SCB_APPLICATION_SERVICE',
    );
    if (provider.pool !== api.pool || provider.options.production)
      throw new Error('Legacy registration fixture cannot replace this provider');
    Object.setPrototypeOf(provider, LegacyRegistrationService.prototype);
    return api;
  } catch (error) {
    await api.app.close();
    await api.pool.end();
    throw error;
  }
}
