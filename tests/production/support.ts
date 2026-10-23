import { readFile, stat } from 'node:fs/promises';
import type { Page } from '@playwright/test';

export function requireCheck(condition: unknown, phase: string): asserts condition {
  if (!condition) throw new Error(`P07_CHECK:${phase}`);
}

export function httpsOrigin() {
  requireCheck(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'tls-verification-required');
  try {
    const value = new URL(process.env.SCB_CHECK_BASE_URL ?? '');
    requireCheck(
      value.protocol === 'https:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname) &&
        !value.username &&
        !value.password &&
        value.pathname === '/' &&
        !value.search &&
        !value.hash,
      'explicit-loopback-https-origin',
    );
    return value.origin;
  } catch {
    throw new Error('P07_CHECK:explicit-loopback-https-origin');
  }
}

export interface OwnerInput {
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
}
export interface ProductionFixture {
  event: { id: string; name: string };
  knockout: {
    knockout: { event: { id: string } };
    publicId: string;
    oldPublicId: string;
    overview: { name: string };
  };
  viewing: {
    publicId: string;
    revokedId: string;
    overview: { name: string };
    matches: { publicMatchId: string; home: { teamName: string }; away: { teamName: string } }[];
  };
  overlays: {
    active: {
      overlayId: string;
      token: string;
      snapshot: { score: { home: number; away: number } | null };
    }[];
    revoked: { overlayId: string; token: string };
  };
}

async function privateJson(variable: string): Promise<unknown> {
  try {
    const path = process.env[variable];
    requireCheck(path, 'private-fixture-required');
    const info = await stat(path);
    requireCheck(info.isFile() && (info.mode & 0o077) === 0, 'private-fixture-permissions');
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new Error('P07_CHECK:private-fixture-readable');
  }
}
export async function ownerInput(): Promise<OwnerInput> {
  const value = (await privateJson('SCB_CHECK_OWNER_FILE')) as OwnerInput;
  requireCheck(
    value &&
      [value.email, value.password, value.displayName, value.organizationName].every(
        (field) => typeof field === 'string' && field.length > 0,
      ),
    'owner-fixture-shape',
  );
  return value;
}
export async function productionFixture(): Promise<ProductionFixture> {
  const value = (await privateJson('SCB_PERSISTENCE_FILE')) as ProductionFixture;
  requireCheck(
    value?.event?.id &&
      value.event.name &&
      value.viewing?.publicId &&
      value.viewing.overview?.name &&
      value.viewing.matches?.length &&
      value.overlays?.active?.some((item) => item.snapshot?.score !== null) &&
      value.overlays.revoked?.overlayId &&
      value.knockout?.knockout?.event?.id &&
      value.knockout.publicId &&
      value.knockout.overview?.name &&
      value.knockout.oldPublicId,
    'business-fixture-shape',
  );
  return value;
}

// Navigation failures can include the complete source fragment in Playwright's
// call log. Replace them before reporting; never attach or print the original.
export async function stage(label: string, work: () => Promise<void>) {
  try {
    await work();
  } catch {
    throw new Error(`P07_CHECK:${label}`);
  }
}
export async function noOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
