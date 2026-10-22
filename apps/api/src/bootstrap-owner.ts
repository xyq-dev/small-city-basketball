import { randomUUID } from 'node:crypto';
import { openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { Pool } from 'pg';
import type { Pool as PoolType } from 'pg';
import { isDirectExecution, loadRootEnv } from './env.js';
import { readDatabaseUrl } from './runtime-config.js';
import { hashPassword } from './security.js';
import { ApiError } from './errors.js';
import { objectInput, emailInput, passwordInput, text } from './validation.js';

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
  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // User before organization follows existing registration order and also
    // prevents a competing participant insert from racing the unique email check.
    await client.query('LOCK TABLE users,organizations IN SHARE ROW EXCLUSIVE MODE');
    if ((await client.query('SELECT 1 FROM organizations LIMIT 1')).rowCount)
      throw new ApiError(409, 'BOOTSTRAP_NOT_EMPTY', '已有机构，不能重复初始化负责人');
    if ((await client.query('SELECT id FROM users WHERE email=$1', [input.email])).rowCount)
      throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', '不能提升既有账号为初始化负责人');
    const userId = randomUUID();
    const organizationId = randomUUID();
    await client.query(
      'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
      [userId, input.email, input.displayName, passwordHash],
    );
    await client.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
      organizationId,
      input.organizationName,
    ]);
    await client.query(
      "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER')",
      [organizationId, userId],
    );
    await client.query(
      "INSERT INTO audit_logs(id,org_id,actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,'BOOTSTRAP_OWNER','organization',$2,'{}'::jsonb)",
      [randomUUID(), organizationId, userId],
    );
    await client.query('COMMIT');
    return { userId, organizationId };
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
