import type { ApiOptions } from './service.js';
import type { CommerceMode } from '@small-city-basketball/contracts';
import type { WechatPayConfig } from './commerce/wechatpay.js';
import { readCommerceMode, readWechatPayConfig } from './commerce-runtime.js';
import { isIP } from 'node:net';
import { readRequiredSecret } from './env.js';

export interface ResolvedApiOptions {
  databaseUrl: string;
  appOrigin: string;
  sessionTtlSeconds: number;
  secureCookies: boolean;
  organizationRegistrationEnabled: boolean;
  participantRegistrationEnabled: boolean;
  participantDataKey?: string;
  notificationStartingLeadMinutes?: number;
  trustProxyHops: 0 | 1;
  production: boolean;
  commerceMode: CommerceMode;
  wechatPay: WechatPayConfig;
}
export interface RuntimeConfig {
  apiOptions: ResolvedApiOptions;
  host: string;
  port: number;
}

function booleanEnv(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Boolean runtime configuration must be true or false');
}

export function readDatabaseUrl(): string {
  return validateDatabaseUrl(readRequiredSecret('DATABASE_URL'));
}

export function readRuntimeConfig(): RuntimeConfig {
  const rawPort = process.env.PORT ?? '3000';
  if (!/^[1-9]\d{0,4}$/.test(rawPort) || Number(rawPort) > 65535)
    throw new Error('PORT must be from 1 to 65535');
  const host = process.env.HOST ?? '127.0.0.1';
  if (host !== 'localhost' && !isIP(host))
    throw new Error('HOST must be an IP address or localhost');
  const rawHops = process.env.TRUST_PROXY_HOPS ?? '0';
  if (rawHops !== '0' && rawHops !== '1') throw new Error('TRUST_PROXY_HOPS must be 0 or 1');
  return {
    host,
    port: Number(rawPort),
    apiOptions: resolveApiOptions({
      databaseUrl: readDatabaseUrl(),
      appOrigin: process.env.APP_ORIGIN ?? '',
      secureCookies: booleanEnv('COOKIE_SECURE'),
      registrationEnabled: booleanEnv('REGISTRATION_ENABLED'),
      organizationRegistrationEnabled: booleanEnv('ORGANIZATION_REGISTRATION_ENABLED'),
      participantRegistrationEnabled: booleanEnv('PARTICIPANT_REGISTRATION_ENABLED'),
      participantDataKey:
        process.env.SCB_PARTICIPANT_DATA_KEY !== undefined ||
        process.env.SCB_PARTICIPANT_DATA_KEY_FILE !== undefined
          ? readRequiredSecret('SCB_PARTICIPANT_DATA_KEY')
          : undefined,
      trustProxyHops: Number(rawHops) as 0 | 1,
      commerceMode: readCommerceMode(),
      wechatPay: readWechatPayConfig(process.env.APP_ORIGIN ?? ''),
    }),
  };
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
  if (
    options.notificationStartingLeadMinutes !== undefined &&
    (!Number.isInteger(options.notificationStartingLeadMinutes) ||
      options.notificationStartingLeadMinutes < 1 ||
      options.notificationStartingLeadMinutes > 120)
  )
    throw new Error('Invalid notification lead time');
  const participantDataKey = options.participantDataKey;
  if (
    participantDataKey !== undefined &&
    (typeof participantDataKey !== 'string' ||
      !/^[A-Za-z0-9+/]{43}=$/.test(participantDataKey) ||
      Buffer.from(participantDataKey, 'base64').length !== 32 ||
      Buffer.from(participantDataKey, 'base64').toString('base64') !== participantDataKey)
  )
    throw new Error('Participant material key configuration is invalid');
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
  const commerceMode = options.commerceMode ?? 'OFF';
  if (commerceMode !== 'OFF' && commerceMode !== 'ENFORCED')
    throw new Error('commerceMode must be OFF or ENFORCED');
  const hops = options.trustProxyHops ?? 0;
  if (hops !== 0 && hops !== 1) throw new Error('trustProxyHops must be 0 or 1');
  return {
    databaseUrl: validateDatabaseUrl(options.databaseUrl),
    ...(participantDataKey === undefined ? {} : { participantDataKey }),
    ...(options.notificationStartingLeadMinutes === undefined
      ? {}
      : { notificationStartingLeadMinutes: options.notificationStartingLeadMinutes }),
    appOrigin: options.appOrigin,
    sessionTtlSeconds: ttl,
    secureCookies: production || options.secureCookies === true,
    organizationRegistrationEnabled:
      options.organizationRegistrationEnabled ?? options.registrationEnabled ?? !production,
    participantRegistrationEnabled:
      options.participantRegistrationEnabled ?? options.registrationEnabled ?? !production,
    trustProxyHops: hops,
    production,
    commerceMode,
    wechatPay: options.wechatPay ?? { enabled: false },
  };
}
