import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const input = JSON.stringify({
  email: 'owner@example.test',
  password: 'Private-owner-password-2026',
  displayName: '负责人',
  organizationName: '合成机构',
});
describe('entrypoint failures do not disclose private configuration', () => {
  it.each([
    ['main.ts', 'API startup failed'],
    ['database/migrate.ts', 'Database migration failed'],
    ['database/migrate-cli.ts', 'Database migration failed'],
    ['bootstrap-owner.ts', 'First owner initialization failed'],
  ])('%s emits only a fixed failure for a credential-bearing malformed URL', (file, message) => {
    const path = fileURLToPath(new URL(file, import.meta.url));
    const result = spawnSync(process.execPath, ['--import', 'tsx', path], {
      encoding: 'utf8',
      input,
      timeout: 10000,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://example.test',
        PORT: '3000',
        HOST: '127.0.0.1',
        DATABASE_URL: 'postgresql://guard-user:guard-password@host:bad-port/db',
        DATABASE_URL_FILE: undefined,
        BOOTSTRAP_OWNER_INPUT: undefined,
        BOOTSTRAP_OWNER_INPUT_FILE: undefined,
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(message);
    for (const marker of ['guard-user', 'guard-password', 'Private-owner-password'])
      expect(result.stderr).not.toContain(marker);
  });
  it('refuses owner credentials supplied as arguments without printing the argument', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('bootstrap-owner.ts', import.meta.url)),
        'private-argv-marker',
      ],
      {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, NODE_NO_WARNINGS: '1', NODE_ENV: 'production' },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe('First owner initialization failed');
  });
});
