import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBootstrapOwnerInput, readBootstrapOwnerInput } from './bootstrap-owner.js';

const input = {
  email: ' Owner@Example.test ',
  password: 'Private-owner-password-2026',
  displayName: ' 首位负责人 ',
  organizationName: ' 合成机构 ',
};
afterEach(() => vi.unstubAllEnvs());
describe('first owner private input boundary', () => {
  it('normalizes the four explicit fields and rejects any attempt to assign another privilege', () => {
    expect(parseBootstrapOwnerInput(input)).toEqual({
      ...input,
      email: 'owner@example.test',
      displayName: '首位负责人',
      organizationName: '合成机构',
    });
    for (const invalid of [
      { ...input, role: 'ORG_OWNER' },
      { ...input, userId: 'existing' },
      { ...input, password: 'short' },
      { ...input, organizationName: 'bad\u0000name' },
      { ...input, email: 'bad' },
    ])
      expect(() => parseBootstrapOwnerInput(invalid)).toThrow();
  });
  it('reads bounded nonTTY JSON and never echoes malformed private input', async () => {
    vi.stubEnv('BOOTSTRAP_OWNER_INPUT_FILE', undefined);
    vi.stubEnv('BOOTSTRAP_OWNER_INPUT', undefined);
    expect(await readBootstrapOwnerInput(Readable.from([JSON.stringify(input)]))).toMatchObject({
      email: 'owner@example.test',
    });
    for (const raw of ['private-marker invalid JSON', 'x'.repeat(32769)]) {
      try {
        await readBootstrapOwnerInput(Readable.from([raw]));
        throw new Error('expected failure');
      } catch (error) {
        expect(String(error)).not.toContain('private-marker');
        expect((error as Error).cause).toBeUndefined();
      }
    }
    const terminal = Readable.from([JSON.stringify(input)]) as Readable & { isTTY: boolean };
    terminal.isTTY = true;
    await expect(readBootstrapOwnerInput(terminal)).rejects.toThrow('non-interactive');
  });
  it('uses a private JSON file and refuses an inline owner credential even if a file exists', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'scb-owner-'));
    try {
      const file = join(directory, 'owner-input');
      writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
      vi.stubEnv('BOOTSTRAP_OWNER_INPUT_FILE', file);
      vi.stubEnv('BOOTSTRAP_OWNER_INPUT', undefined);
      expect(await readBootstrapOwnerInput(Readable.from([]))).toMatchObject({
        organizationName: '合成机构',
      });
      vi.stubEnv('BOOTSTRAP_OWNER_INPUT', 'private-marker');
      await expect(readBootstrapOwnerInput(Readable.from([]))).rejects.toThrow(
        'Inline owner input is not permitted',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
