import { existsSync, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function loadRootEnv() {
  if (process.env.NODE_ENV === 'production') return;
  const file = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (!existsSync(file)) return;
  const explicit = { ...process.env };
  process.loadEnvFile(file);
  for (const [key, value] of Object.entries(explicit)) {
    if (value !== undefined) process.env[key] = value;
  }
}

/** Secret configuration errors deliberately exclude paths, contents and causes. */
export function readRequiredSecret(name: string): string {
  const inline = process.env[name];
  const file = process.env[`${name}_FILE`];
  if (inline !== undefined && file !== undefined)
    throw new Error('Conflicting secret configuration');
  try {
    let value: string;
    if (file !== undefined) {
      if (!file || file.includes('\u0000')) throw new Error();
      const fd = openSync(file, 'r');
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size < 1 || stat.size > 16384) throw new Error();
        value = readFileSync(fd, 'utf8');
      } finally {
        closeSync(fd);
      }
    } else {
      if (inline === undefined) throw new Error();
      value = inline;
    }
    if (!value || Buffer.byteLength(value) > 16384 || value.includes('\u0000')) throw new Error();
    const normalized = value.trim();
    if (!normalized) throw new Error();
    return normalized;
  } catch {
    throw new Error('Required secret configuration is unavailable or invalid');
  }
}

export function isDirectExecution(url: string): boolean {
  return Boolean(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === url);
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
