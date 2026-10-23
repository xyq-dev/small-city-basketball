import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from './security.js';
import {
  maintainAccount,
  parseAccountMaintenanceInput,
  readAccountMaintenanceDatabaseUrl,
  readAccountMaintenanceInput,
} from './account-maintenance.js';

const input = {
  email: 'operator@example.test',
  loginName: 'admin_26',
  password: 'Private-maintenance-test-password',
  reason: 'Owner requested account maintenance',
};
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'scb-account-maintenance-'));
  vi.stubEnv('ACCOUNT_MAINTENANCE_INPUT', undefined);
  vi.stubEnv('ACCOUNT_MAINTENANCE_INPUT_FILE', undefined);
  vi.stubEnv('DATABASE_URL', undefined);
  vi.stubEnv('DATABASE_URL_FILE', undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe('offline maintenance private input and fixed-error boundary', () => {
  it('strictly parses normalized identity without trimming or weakening the password', () => {
    expect(
      parseAccountMaintenanceInput({
        ...input,
        email: ' Operator@Example.Test ',
        loginName: ' Admin_26 ',
      }),
    ).toEqual(input);
    for (const invalid of [
      { ...input, password: 'too-short' },
      { ...input, loginName: 'admin@example.test' },
      { ...input, reason: ' ' },
      { ...input, reason: input.password },
      { ...input, actorId: 'forged' },
      { ...input, organizationName: 'cannot-bootstrap' },
    ])
      expect(() => parseAccountMaintenanceInput(invalid)).toThrow();
  });

  it.each([0o400, 0o600])('accepts a bounded private regular file with mode %s', (mode) => {
    const path = join(directory, 'input.json');
    writeFileSync(path, JSON.stringify(input), { mode });
    vi.stubEnv('ACCOUNT_MAINTENANCE_INPUT_FILE', path);
    expect(readAccountMaintenanceInput()).toEqual(input);
  });

  it('rejects inline credentials, public modes, symlinks, oversized and malformed files without echoing contents', () => {
    const path = join(directory, 'input.json');
    writeFileSync(path, JSON.stringify(input), { mode: 0o600 });
    vi.stubEnv('ACCOUNT_MAINTENANCE_INPUT_FILE', path);
    vi.stubEnv('ACCOUNT_MAINTENANCE_INPUT', 'private-inline-marker');
    expect(() => readAccountMaintenanceInput()).toThrow(
      'Inline account maintenance input is not permitted',
    );
    vi.stubEnv('ACCOUNT_MAINTENANCE_INPUT', undefined);
    chmodSync(path, 0o644);
    expect(() => readAccountMaintenanceInput()).toThrow(
      'Account maintenance input file is unavailable or invalid',
    );
    chmodSync(path, 0o600);
    const link = join(directory, 'linked-input.json');
    symlinkSync(path, link);
    vi.stubEnv('ACCOUNT_MAINTENANCE_INPUT_FILE', link);
    expect(() => readAccountMaintenanceInput()).toThrow(
      'Account maintenance input file is unavailable or invalid',
    );
    vi.stubEnv('ACCOUNT_MAINTENANCE_INPUT_FILE', path);
    for (const raw of ['x'.repeat(32769), 'private-json-marker', '']) {
      writeFileSync(path, raw);
      expect(() => readAccountMaintenanceInput()).toThrow(
        'Account maintenance input file is unavailable or invalid',
      );
    }
  });

  it('requires a private no-follow database URL file too, without changing the shared runtime reader', () => {
    const file = join(directory, 'database-url');
    writeFileSync(file, 'postgresql://private-user:synthetic-password@localhost/scb_test_account', {
      mode: 0o600,
    });
    vi.stubEnv('DATABASE_URL_FILE', file);
    expect(readAccountMaintenanceDatabaseUrl()).toBe(
      'postgresql://private-user:synthetic-password@localhost/scb_test_account',
    );
    chmodSync(file, 0o644);
    expect(() => readAccountMaintenanceDatabaseUrl()).toThrow(
      'Account maintenance database URL file is unavailable or invalid',
    );
    chmodSync(file, 0o600);
    const link = join(directory, 'database-url-link');
    symlinkSync(file, link);
    vi.stubEnv('DATABASE_URL_FILE', link);
    expect(() => readAccountMaintenanceDatabaseUrl()).toThrow(
      'Account maintenance database URL file is unavailable or invalid',
    );
    vi.stubEnv('DATABASE_URL', 'private-inline-url-marker');
    expect(() => readAccountMaintenanceDatabaseUrl()).toThrow(
      'Account maintenance requires a private database URL file',
    );
  });

  it('rejects a runtime-role caller before credential lookup, hashing, or transactional writes', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ role: 'scb_runtime', superuser: false }] });
    const connect = vi.fn();
    await expect(
      maintainAccount({ query, connect } as unknown as Pool, input),
    ).rejects.toMatchObject({ status: 403, code: 'MAINTENANCE_ROLE_REQUIRED' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects the existing password using the actual password verifier before any write transaction', async () => {
    const hash = await hashPassword(input.password);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ role: 'scb_migrator', superuser: false }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'candidate',
            email: input.email,
            login_name: null,
            password_hash: hash,
            status: 'ACTIVE',
          },
        ],
      });
    const connect = vi.fn();
    await expect(
      maintainAccount({ query, connect } as unknown as Pool, input),
    ).rejects.toMatchObject({ status: 422, code: 'PASSWORD_REUSE_NOT_ALLOWED' });
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(['argument', 'inline', 'database'])(
    'CLI %s failure emits only a fixed message',
    (kind) => {
      const file = join(directory, 'input.json');
      const database = join(directory, 'database-url');
      writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
      writeFileSync(database, 'postgresql://private-user:private-db-password@host:bad-port/db', {
        mode: 0o600,
      });
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(new URL('account-maintenance.ts', import.meta.url)),
          ...(kind === 'argument' ? ['private-argument-marker'] : []),
        ],
        {
          encoding: 'utf8',
          timeout: 10000,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            NODE_NO_WARNINGS: '1',
            ACCOUNT_MAINTENANCE_INPUT_FILE: file,
            ACCOUNT_MAINTENANCE_INPUT: kind === 'inline' ? 'private-inline-marker' : undefined,
            DATABASE_URL: undefined,
            DATABASE_URL_FILE: database,
          },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe('Account maintenance failed');
    },
  );
});
