import type { ApiOptions } from './service.js';

export interface ResolvedApiOptions {
  databaseUrl: string;
  appOrigin: string;
  sessionTtlSeconds: number;
  secureCookies: boolean;
  organizationRegistrationEnabled: boolean;
  participantRegistrationEnabled: boolean;
  trustProxyHops: 0 | 1;
  production: boolean;
}
export interface RuntimeConfig {
  apiOptions: ResolvedApiOptions;
  host: string;
  port: number;
}

export function isProduction(): boolean {
  const mode = process.env.NODE_ENV;
  if (mode !== undefined && !['development', 'test', 'production'].includes(mode))
    throw new Error('NODE_ENV must be development, test or production');
  return mode === 'production';
}

export function validateDatabaseUrl(value: unknown): string {
  try {
    if (typeof value !== 'string' || !value || value !== value.trim()) throw new Error();
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.pathname ||
      url.pathname === '/'
    )
      throw new Error();
    return value;
  } catch {
    throw new Error('A valid PostgreSQL DATABASE_URL is required');
  }
}

/** Shared by createApi and direct service construction; caller options cannot select a mode. */
export function resolveApiOptions(options: ApiOptions): ResolvedApiOptions {
  const production = isProduction();
  let origin: URL;
  try {
    origin = new URL(options.appOrigin);
  } catch {
    throw new Error('appOrigin must be an HTTP(S) origin');
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== options.appOrigin)
    throw new Error('appOrigin must be an HTTP(S) origin without userinfo, path or query');
  if (production && origin.protocol !== 'https:')
    throw new Error('Production appOrigin must use HTTPS');
  const flags = [
    options.registrationEnabled,
    options.organizationRegistrationEnabled,
    options.participantRegistrationEnabled,
    options.secureCookies,
  ];
  if (flags.some((v) => v !== undefined && typeof v !== 'boolean'))
    throw new Error('Registration and Cookie flags must be boolean');
  if (production && options.secureCookies === false)
    throw new Error('Production cookies must be Secure');
  if (
    options.registrationEnabled !== undefined &&
    [options.organizationRegistrationEnabled, options.participantRegistrationEnabled].some(
      (v) => v !== undefined && v !== options.registrationEnabled,
    )
  )
    throw new Error('Conflicting registration switches');
  const ttl = options.sessionTtlSeconds ?? 12 * 60 * 60;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 30 * 24 * 60 * 60)
    throw new Error('sessionTtlSeconds must be an integer from 1 to 2592000');
  const hops = options.trustProxyHops ?? 0;
  if (hops !== 0 && hops !== 1) throw new Error('trustProxyHops must be 0 or 1');
  return {
    databaseUrl: validateDatabaseUrl(options.databaseUrl),
    appOrigin: options.appOrigin,
    sessionTtlSeconds: ttl,
    secureCookies: production || options.secureCookies === true,
    organizationRegistrationEnabled:
      options.organizationRegistrationEnabled ?? options.registrationEnabled ?? !production,
    participantRegistrationEnabled:
      options.participantRegistrationEnabled ?? options.registrationEnabled ?? !production,
    trustProxyHops: hops,
    production,
  };
}
