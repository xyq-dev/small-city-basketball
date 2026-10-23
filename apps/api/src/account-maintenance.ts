import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { Pool } from 'pg';
import type { Pool as PoolType } from 'pg';
import { isDirectExecution, loadRootEnv } from './env.js';
import { ApiError } from './errors.js';
import { validateDatabaseUrl } from './runtime-config.js';
import { hashPassword, verifyPassword } from './security.js';
import { emailInput, loginNameInput, objectInput, passwordInput, text } from './validation.js';

export interface AccountMaintenanceInput {
  email: string;
  loginName: string;
  password: string;
  reason: string;
}

interface AccountCandidate {
  id: string;
  email: string;
  login_name: string | null;
  password_hash: string;
  status: string;
}

export function parseAccountMaintenanceInput(body: unknown): AccountMaintenanceInput {
  const input = objectInput(body, ['email', 'loginName', 'password', 'reason']);
  const password = passwordInput(input.password);
  const reason = text(input.reason, 'reason', 1, 240);
  if (reason.includes(password))
    throw new Error('Maintenance reason must not contain credential material');
  return {
    email: emailInput(input.email),
    loginName: loginNameInput(input.loginName),
    password,
    reason,
  };
}

/** Offline operator utility: not an HTTP endpoint and not a runtime-role action. */
export async function maintainAccount(
  pool: PoolType,
  body: unknown,
): Promise<{
  status: 'updated';
  userId: string;
  maintenanceActorId: string;
  sessionsRevoked: number;
}> {
  const input = parseAccountMaintenanceInput(body);
  const identity = (
    await pool.query<{ role: string; superuser: boolean }>(
      'SELECT current_user AS role,rolsuper AS superuser FROM pg_roles WHERE rolname=current_user',
    )
  ).rows[0];
  if (!identity || (!identity.superuser && !['scb_admin', 'scb_migrator'].includes(identity.role)))
    throw new ApiError(403, 'MAINTENANCE_ROLE_REQUIRED', '账号维护需要数据库维护身份');
  const candidate = (
    await pool.query<AccountCandidate>(
      'SELECT id,email,login_name,password_hash,status FROM users WHERE email=$1',
      [input.email],
    )
  ).rows[0];
  if (!candidate || candidate.status !== 'ACTIVE')
    throw new ApiError(409, 'ACCOUNT_MAINTENANCE_REJECTED', '目标账号不可维护');
  if (await verifyPassword(input.password, candidate.password_hash))
    throw new ApiError(422, 'PASSWORD_REUSE_NOT_ALLOWED', '维护时必须设置不同的新密码');
  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `scb-account-maintenance:${candidate.id}`,
    ]);
    // lockActor takes session -> user. Drain current requests in that order,
    // before acquiring the user UPDATE lock that serializes with new logins.
    await client.query(
      'SELECT id FROM sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY id FOR UPDATE',
      [candidate.id],
    );
    const current = (
      await client.query<AccountCandidate>(
        'SELECT id,email,login_name,password_hash,status FROM users WHERE id=$1 FOR UPDATE',
        [candidate.id],
      )
    ).rows[0];
    if (
      !current ||
      current.status !== 'ACTIVE' ||
      current.email !== input.email ||
      current.password_hash !== candidate.password_hash ||
      current.login_name !== candidate.login_name
    )
      throw new ApiError(409, 'ACCOUNT_CHANGED', '账号已变化，请重新核对后维护');
    await client.query(
      'UPDATE users SET login_name=$1,password_hash=$2,updated_at=clock_timestamp() WHERE id=$3',
      [input.loginName, passwordHash, current.id],
    );
    // A login that completed while the initial sessions were being drained is
    // included here too; no later login can pass the locked old-password check.
    const revoked = await client.query(
      'UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL',
      [current.id],
    );
    const maintenanceActorId = randomUUID();
    // Deliberately not a verifyPassword-compatible hash. A fresh system actor
    // avoids reusing an ordinary account that happens to have a similar name.
    const sentinel = `!SCB_DISABLED_MAINTENANCE_ACTOR!${randomBytes(64).toString('base64url')}`;
    await client.query(
      `INSERT INTO users(id,email,display_name,password_hash,status)
       VALUES($1,$2,'离线账号维护系统主体',$3,'DISABLED')`,
      [maintenanceActorId, `maintenance-${maintenanceActorId}@system.invalid`, sentinel],
    );
    const sessionsRevoked = revoked.rowCount ?? 0;
    await client.query(
      `INSERT INTO audit_logs(id,org_id,actor_id,action,resource_type,resource_id,metadata)
       VALUES($1,NULL,$2,'ACCOUNT_CREDENTIALS_RESET','user',$3,$4::jsonb)`,
      [
        randomUUID(),
        maintenanceActorId,
        current.id,
        JSON.stringify({
          source: 'offline-account-maintenance',
          reason: input.reason,
          sessionsRevoked,
        }),
      ],
    );
    await client.query('COMMIT');
    return { status: 'updated', userId: current.id, maintenanceActorId, sessionsRevoked };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Preserve only a controlled error; never print PostgreSQL DETAIL. */
    }
    if (error instanceof ApiError) throw error;
    throw new Error('Account maintenance failed');
  } finally {
    client.release();
  }
}

function readPrivateMaintenanceFile(file: string | undefined, maximum: number): string {
  if (!file || file.includes('\u0000')) throw new Error();
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let raw: string;
  try {
    const stat = fstatSync(fd);
    const mode = stat.mode & 0o7777;
    if (
      !stat.isFile() ||
      stat.size < 1 ||
      stat.size > maximum ||
      ![0o400, 0o600].includes(mode) ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    )
      throw new Error();
    const bytes = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size <= maximum) {
      const read = readSync(fd, bytes, size, bytes.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size < 1 || size > maximum) throw new Error();
    raw = bytes.subarray(0, size).toString('utf8');
  } finally {
    closeSync(fd);
  }
  return raw;
}

export function readAccountMaintenanceInput(): AccountMaintenanceInput {
  if (process.env.ACCOUNT_MAINTENANCE_INPUT !== undefined)
    throw new Error('Inline account maintenance input is not permitted');
  try {
    return parseAccountMaintenanceInput(
      JSON.parse(readPrivateMaintenanceFile(process.env.ACCOUNT_MAINTENANCE_INPUT_FILE, 32768)),
    );
  } catch {
    throw new Error('Account maintenance input file is unavailable or invalid');
  }
}

export function readAccountMaintenanceDatabaseUrl(): string {
  if (process.env.DATABASE_URL !== undefined)
    throw new Error('Account maintenance requires a private database URL file');
  try {
    return validateDatabaseUrl(
      readPrivateMaintenanceFile(process.env.DATABASE_URL_FILE, 16384).trim(),
    );
  } catch {
    throw new Error('Account maintenance database URL file is unavailable or invalid');
  }
}

export async function runAccountMaintenanceCli(): Promise<void> {
  if (process.argv.length > 2)
    throw new Error('Account maintenance credentials cannot be provided as arguments');
  loadRootEnv();
  const input = readAccountMaintenanceInput();
  const pool = new Pool({
    connectionString: readAccountMaintenanceDatabaseUrl(),
    connectionTimeoutMillis: 5000,
  });
  try {
    console.log(JSON.stringify(await maintainAccount(pool, input)));
  } finally {
    await pool.end();
  }
}

if (isDirectExecution(import.meta.url)) {
  try {
    await runAccountMaintenanceCli();
  } catch {
    console.error('Account maintenance failed');
    process.exitCode = 1;
  }
}
