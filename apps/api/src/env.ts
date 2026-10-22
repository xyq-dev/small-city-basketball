import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadRootEnv() {
  const file = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (!existsSync(file)) return;
  const explicit = { ...process.env };
  process.loadEnvFile(file);
  for (const [key, value] of Object.entries(explicit)) {
    if (value !== undefined) process.env[key] = value;
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
