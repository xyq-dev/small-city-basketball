import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveApiOptions, readRuntimeConfig } from './runtime-config.js';
import { readRequiredSecret } from './env.js';
import { RegistrationService } from './registration-service.js';

const url = 'postgresql://unused:unused@127.0.0.1:1/unused';
const options = { databaseUrl: url, appOrigin: 'https://example.test' };
const directory = mkdtempSync(join(tmpdir(), 'scb-runtime-'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('central runtime configuration', () => {
  it('C23: missing participant key stays disabled and malformed keys never appear in errors', () => {
    expect(resolveApiOptions(options).participantDataKey).toBeUndefined();
    const synthetic = Buffer.alloc(32, 7).toString('base64');
    expect(
      resolveApiOptions({ ...options, participantDataKey: synthetic }).participantDataKey,
    ).toBe(synthetic);
    for (const secret of [
      'private-secret-marker',
      synthetic + '\n',
      Buffer.alloc(31).toString('base64'),
    ]) {
      try {
        resolveApiOptions({ ...options, participantDataKey: secret });
        throw new Error('expected rejection');
      } catch (error) {
        expect(String(error)).toContain('key configuration');
        expect(String(error)).not.toContain(secret);
      }
    }
  });
  it('uses production defaults for direct service construction and exposes only two public capabilities', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const pool = new Pool({ connectionString: url });
    try {
      const service = new RegistrationService(pool, options);
      expect(service.authCapabilities()).toEqual({
        canRegisterOrganization: false,
        canRegisterParticipant: false,
      });
      expect(service.secureCookies).toBe(true);
      const query = vi.spyOn(pool, 'query');
      await expect(service.register({}, 'peer')).rejects.toMatchObject({
        status: 403,
        code: 'REGISTRATION_DISABLED',
      });
      await expect(service.registerParticipant({}, 'peer')).rejects.toMatchObject({
        status: 403,
        code: 'REGISTRATION_DISABLED',
      });
      expect(query).not.toHaveBeenCalled();
      expect(resolveApiOptions({ ...options, participantRegistrationEnabled: true })).toMatchObject(
        { organizationRegistrationEnabled: false, participantRegistrationEnabled: true },
      );
    } finally {
      await pool.end();
    }
  });
  it('retains development/test registration and explicit legacy fallback without accepting conflicting flags', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(resolveApiOptions(options)).toMatchObject({
      organizationRegistrationEnabled: true,
      participantRegistrationEnabled: true,
      trustProxyHops: 0,
    });
    expect(resolveApiOptions({ ...options, registrationEnabled: false })).toMatchObject({
      organizationRegistrationEnabled: false,
      participantRegistrationEnabled: false,
    });
    expect(
      resolveApiOptions({
        ...options,
        registrationEnabled: false,
        participantRegistrationEnabled: false,
      }),
    ).toMatchObject({ participantRegistrationEnabled: false });
    expect(() =>
      resolveApiOptions({
        ...options,
        registrationEnabled: false,
        participantRegistrationEnabled: true,
      }),
    ).toThrow('Conflicting');
  });
  it.each([
    'https://user:secret@example.test',
    'https://example.test/',
    'https://example.test/path',
    'https://example.test?token=secret',
    'https://example.test#token=secret',
    'javascript:secret',
  ])('rejects a noncanonical application origin without reflecting it: %s', (appOrigin) => {
    try {
      resolveApiOptions({ ...options, appOrigin });
      throw new Error('expected failure');
    } catch (error) {
      expect(String(error)).not.toContain(appOrigin);
      expect(String(error)).not.toContain('secret');
    }
  });
  it('rejects production HTTP, insecure cookies, arbitrary hops and misspelled deployment mode', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => resolveApiOptions({ ...options, appOrigin: 'http://example.test' })).toThrow(
      'HTTPS',
    );
    expect(() => resolveApiOptions({ ...options, secureCookies: false })).toThrow('Secure');
    for (const trustProxyHops of [true, '1', -1, 2])
      expect(() => resolveApiOptions({ ...options, trustProxyHops } as never)).toThrow();
    vi.stubEnv('NODE_ENV', 'prod');
    expect(() => resolveApiOptions(options)).toThrow('NODE_ENV');
  });
  it('loads exact secret files, rejects dual configuration and never includes a failed path or secret', () => {
    const path = join(directory, 'database-secret');
    writeFileSync(path, url + '\n', { mode: 0o600 });
    vi.stubEnv('SCB_TEST_SECRET_FILE', path);
    expect(readRequiredSecret('SCB_TEST_SECRET')).toBe(url);
    vi.stubEnv('SCB_TEST_SECRET', 'private-marker');
    expect(() => readRequiredSecret('SCB_TEST_SECRET')).toThrow('Conflicting');
    vi.stubEnv('SCB_TEST_SECRET', undefined);
    vi.stubEnv('SCB_TEST_SECRET_FILE', path + '-private-marker');
    try {
      readRequiredSecret('SCB_TEST_SECRET');
      throw new Error('expected failure');
    } catch (error) {
      expect(String(error)).not.toContain(path);
      expect(String(error)).not.toContain('private-marker');
      expect((error as Error).cause).toBeUndefined();
    }
  });
  it('parses strict environment integers and booleans while using production API defaults', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', url);
    vi.stubEnv('DATABASE_URL_FILE', undefined);
    vi.stubEnv('APP_ORIGIN', options.appOrigin);
    vi.stubEnv('REGISTRATION_ENABLED', undefined);
    vi.stubEnv('ORGANIZATION_REGISTRATION_ENABLED', 'false');
    vi.stubEnv('PARTICIPANT_REGISTRATION_ENABLED', 'true');
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    vi.stubEnv('HOST', '0.0.0.0');
    vi.stubEnv('PORT', '3000');
    vi.stubEnv('COOKIE_SECURE', undefined);
    expect(readRuntimeConfig()).toMatchObject({
      host: '0.0.0.0',
      port: 3000,
      apiOptions: {
        organizationRegistrationEnabled: false,
        participantRegistrationEnabled: true,
        secureCookies: true,
        trustProxyHops: 1,
      },
    });
    for (const value of ['3e3', '3000.0', ' 3000', '03000', '0', '65536']) {
      vi.stubEnv('PORT', value);
      expect(() => readRuntimeConfig()).toThrow('PORT');
    }
    vi.stubEnv('PORT', '3000');
    vi.stubEnv('PARTICIPANT_REGISTRATION_ENABLED', 'yes');
    expect(() => readRuntimeConfig()).toThrow('true or false');
    rmSync(directory, { recursive: true, force: true });
  });
});
