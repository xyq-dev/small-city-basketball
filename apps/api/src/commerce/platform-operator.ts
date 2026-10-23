import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { Pool } from 'pg';
import type { Pool as PoolType } from 'pg';
import { isDirectExecution, loadRootEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { emailInput, objectInput } from '../validation.js';
import { readAccountMaintenanceDatabaseUrl } from '../account-maintenance.js';
import { reason } from './domain.js';
export function parsePlatformOperatorInput(raw: unknown) {
  const v = objectInput(raw, ['email', 'status', 'reason']);
  if (v.status !== 'ACTIVE' && v.status !== 'DISABLED')
    throw new Error('Platform operator input is invalid');
  return {
    email: emailInput(v.email),
    status: v.status as 'ACTIVE' | 'DISABLED',
    reason: reason(v.reason),
  };
}
/** Offline maintenance identity only. Runtime SQL privileges can never grant a platform role. */
export async function maintainPlatformOperator(pool: PoolType, raw: unknown) {
  const input = parsePlatformOperatorInput(raw);
  const role = (
    await pool.query<{ role: string; superuser: boolean }>(
      'SELECT current_user AS role,rolsuper AS superuser FROM pg_roles WHERE rolname=current_user',
    )
  ).rows[0];
  if (!role || (!role.superuser && !['scb_admin', 'scb_migrator'].includes(role.role)))
    throw new ApiError(403, 'MAINTENANCE_ROLE_REQUIRED', '平台权限维护需要数据库维护身份');
  const ref = (
    await pool.query<{ id: string }>("SELECT id FROM users WHERE email=$1 AND status='ACTIVE'", [
      input.email,
    ])
  ).rows[0];
  if (!ref) throw new ApiError(409, 'PLATFORM_OPERATOR_REJECTED', '目标账号不可维护');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout='15s'");
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `scb-account-maintenance:${ref.id}`,
    ]);
    // lockActor already holds users SHARE. Drain those requests before changing privileges;
    // new contexts cannot observe an in-flight role change. No runtime table lock grant needed.
    const target = (
      await c.query(
        "SELECT id FROM users WHERE id=$1 AND email=$2 AND status='ACTIVE' FOR UPDATE",
        [ref.id, input.email],
      )
    ).rows[0];
    if (!target) throw new ApiError(409, 'PLATFORM_OPERATOR_REJECTED', '目标账号已变化');
    const maintenanceActorId = randomUUID();
    await c.query(
      'INSERT INTO platform_operators(user_id,status,maintenance_actor_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET status=EXCLUDED.status,maintenance_actor_id=EXCLUDED.maintenance_actor_id,reason=EXCLUDED.reason,updated_at=clock_timestamp()',
      [ref.id, input.status, maintenanceActorId, input.reason],
    );
    await c.query(
      "INSERT INTO audit_logs(id,org_id,actor_id,action,resource_type,resource_id,metadata) VALUES($1,NULL,NULL,$2,'user',$3,$4::jsonb)",
      [
        randomUUID(),
        input.status === 'ACTIVE'
          ? 'commerce.platform_operator.granted'
          : 'commerce.platform_operator.revoked',
        ref.id,
        JSON.stringify({ maintenanceActorId, reason: input.reason, databaseRole: role.role }),
      ],
    );
    await c.query('COMMIT');
    return { status: input.status, userId: ref.id, maintenanceActorId };
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    if (error instanceof ApiError) throw error;
    throw new Error('Platform operator maintenance failed');
  } finally {
    c.release();
  }
}
export function readPlatformOperatorInput() {
  if (process.env.PLATFORM_OPERATOR_INPUT !== undefined)
    throw new Error('Inline platform permissions are not permitted');
  const file = process.env.PLATFORM_OPERATOR_INPUT_FILE;
  if (!file || file.includes('\u0000')) throw new Error('Private platform input file is required');
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.size < 1 ||
      stat.size > 8192 ||
      ![0o400, 0o600].includes(stat.mode & 0o7777) ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    )
      throw new Error();
    const data = Buffer.alloc(8193);
    let size = 0;
    while (size <= 8192) {
      const n = readSync(fd, data, size, data.length - size, null);
      if (!n) break;
      size += n;
    }
    if (size < 1 || size > 8192) throw new Error();
    return parsePlatformOperatorInput(JSON.parse(data.subarray(0, size).toString('utf8')));
  } catch {
    throw new Error('Platform operator private input is unavailable or invalid');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export async function runPlatformOperatorCli() {
  if (process.argv.length > 2)
    throw new Error('Platform permissions cannot be passed as arguments');
  loadRootEnv();
  const input = readPlatformOperatorInput();
  const pool = new Pool({
    connectionString: readAccountMaintenanceDatabaseUrl(),
    connectionTimeoutMillis: 5000,
  });
  try {
    console.log(JSON.stringify(await maintainPlatformOperator(pool, input)));
  } finally {
    await pool.end();
  }
}
if (isDirectExecution(import.meta.url)) {
  try {
    await runPlatformOperatorCli();
  } catch {
    console.error('Platform operator maintenance failed');
    process.exitCode = 1;
  }
}
