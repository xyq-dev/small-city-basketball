import { openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { Pool } from 'pg';
import type { Pool as PoolType } from 'pg';
import { isDirectExecution, loadRootEnv } from './env.js';
import { readDatabaseUrl } from './runtime-config.js';
import { hashPassword } from './security.js';
import { ApiError } from './errors.js';
import { objectInput, emailInput, passwordInput, text } from './validation.js';
import {
  assertEmptyFirstRun,
  assertSetupMaintenanceRole,
  createFirstOwner,
  lockFirstRunSetup,
} from './first-run-setup.js';

export interface BootstrapOwnerInput {
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
}
export function parseBootstrapOwnerInput(body: unknown): BootstrapOwnerInput {
  const input = objectInput(body, ['email', 'password', 'displayName', 'organizationName']);
  return {
    email: emailInput(input.email),
    password: passwordInput(input.password),
    displayName: text(input.displayName, 'displayName', 1, 80),
    organizationName: text(input.organizationName, 'organizationName', 1, 80),
  };
}

export async function bootstrapOwner(
  pool: PoolType,
  body: unknown,
): Promise<{ userId: string; organizationId: string }> {
  const input = parseBootstrapOwnerInput(body);
  await assertSetupMaintenanceRole(pool);
  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await lockFirstRunSetup(client);
    await assertEmptyFirstRun(client, state);
    const result = await createFirstOwner(client, input, passwordHash);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Preserve only controlled errors. */
    }
    if (error instanceof ApiError) throw error;
    throw new Error('Unable to initialize the first owner');
  } finally {
    client.release();
  }
}

export async function readBootstrapOwnerInput(
  input: AsyncIterable<Uint8Array | string> & { isTTY?: boolean } = process.stdin,
): Promise<BootstrapOwnerInput> {
  if (process.env.BOOTSTRAP_OWNER_INPUT !== undefined)
    throw new Error('Inline owner input is not permitted');
  let raw: string;
  const file = process.env.BOOTSTRAP_OWNER_INPUT_FILE;
  if (file !== undefined) {
    try {
      const fd = openSync(file, 'r');
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size < 1 || stat.size > 32768) throw new Error();
        raw = readFileSync(fd, 'utf8');
      } finally {
        closeSync(fd);
      }
    } catch {
      throw new Error('Owner input file is unavailable or invalid');
    }
  } else {
    if (input.isTTY)
      throw new Error('Owner input requires a private file or non-interactive stdin');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of input) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 32768) throw new Error('Owner input exceeds the permitted size');
      chunks.push(bytes);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  try {
    if (Buffer.byteLength(raw) > 32768) throw new Error();
    return parseBootstrapOwnerInput(JSON.parse(raw));
  } catch {
    throw new Error('Owner input must be the required JSON object');
  }
}

export async function runBootstrapOwnerCli(): Promise<void> {
  if (process.argv.length > 2) throw new Error('Owner credentials cannot be provided as arguments');
  loadRootEnv();
  if (process.env.FIRST_RUN_SETUP_ENABLED !== 'true')
    throw new Error('First owner initialization must be explicitly enabled');
  const input = await readBootstrapOwnerInput();
  const pool = new Pool({ connectionString: readDatabaseUrl(), connectionTimeoutMillis: 5000 });
  try {
    const result = await bootstrapOwner(pool, input);
    console.log(JSON.stringify({ status: 'created', ...result }));
  } finally {
    await pool.end();
  }
}
if (isDirectExecution(import.meta.url)) {
  try {
    await runBootstrapOwnerCli();
  } catch {
    console.error('First owner initialization failed');
    process.exitCode = 1;
  }
}
