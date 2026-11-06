import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ApiError } from './errors.js';
import { hashToken, newSessionToken } from './security.js';
import type { BootstrapOwnerInput } from './bootstrap-owner.js';

const closed = () => new ApiError(409, 'SETUP_CLOSED', '此实例不能再次初始化');
export interface FirstRunState {
  initialized_at: Date | null;
  token_hash: string | null;
  token_expires_at: Date | null;
  token_used_at: Date | null;
}

/** Shared mutex for the web, legacy CLI, issuing CLI and public registration. */
export async function lockFirstRunSetup(client: PoolClient): Promise<FirstRunState> {
  const state = (
    await client.query<FirstRunState>(
      'SELECT initialized_at,token_hash,token_expires_at,token_used_at FROM first_run_setup WHERE singleton=true FOR UPDATE',
    )
  ).rows[0];
  if (!state) throw closed();
  return state;
}

export async function assertRegistrationAllowed(client: PoolClient): Promise<void> {
  const state = await lockFirstRunSetup(client);
  if (!state.initialized_at)
    throw new ApiError(409, 'SETUP_REQUIRED', '请先完成部署初始化，再注册账号');
}

/** Called only after the singleton mutex. Every real-account creation path
 * (registration, participant registration, dev seed, both setup paths) takes
 * that same mutex. Table-level write locks would require broader runtime grants.
 */
export async function assertEmptyFirstRun(client: PoolClient, state: FirstRunState): Promise<void> {
  if (state.initialized_at || state.token_used_at) throw closed();
  const populated = await client.query(`SELECT 1 WHERE EXISTS(SELECT 1 FROM organizations)
    OR EXISTS(SELECT 1 FROM users WHERE NOT (
      status='DISABLED' AND (
        (email='commerce-system-'||id::text||'@system.invalid'
         AND display_name IN ('离线平台权限维护系统主体','商业账本系统主体')
         AND password_hash ~ '^!SCB_DISABLED_COMMERCE_ACTOR![A-Za-z0-9_-]{86}$')
        OR (email='maintenance-'||id::text||'@system.invalid'
         AND display_name='离线账号维护系统主体'
         AND password_hash ~ '^!SCB_DISABLED_MAINTENANCE_ACTOR![A-Za-z0-9_-]{86}$')
      )
    ))`);
  if (populated.rowCount) throw closed();
}

export async function assertSetupMaintenanceRole(pool: Pool): Promise<void> {
  const row = (
    await pool.query<{ role: string; superuser: boolean }>(
      'SELECT current_user AS role,rolsuper AS superuser FROM pg_roles WHERE rolname=current_user',
    )
  ).rows[0];
  if (!row || (!row.superuser && !['scb_admin', 'scb_migrator'].includes(row.role)))
    throw new ApiError(403, 'MAINTENANCE_ROLE_REQUIRED', '初始化链接需要数据库维护身份');
}

export async function createFirstOwner(
  client: PoolClient,
  input: BootstrapOwnerInput,
  passwordHash: string,
): Promise<{ userId: string; organizationId: string }> {
  const userId = randomUUID();
  const organizationId = randomUUID();
  // Email verification retains its schema default; setup does not verify mail.
  await client.query('INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)', [
    userId,
    input.email,
    input.displayName,
    passwordHash,
  ]);
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
  await client.query(
    'UPDATE first_run_setup SET initialized_at=clock_timestamp(),token_used_at=CASE WHEN token_hash IS NULL THEN NULL ELSE clock_timestamp() END WHERE singleton=true',
  );
  return { userId, organizationId };
}

export function setupOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password)
      throw new Error();
    return url.origin;
  } catch {
    throw new Error('Setup requires a canonical HTTPS APP_ORIGIN');
  }
}

/** Only the offline maintenance command calls this. Never expose issuance over HTTP. */
export async function issueInitializationLink(
  pool: Pool,
  options: { enabled: boolean; appOrigin: string },
): Promise<{ link: string; expiresAt: string }> {
  if (!options.enabled) throw new ApiError(403, 'SETUP_DISABLED', '部署初始化未开启');
  const origin = setupOrigin(options.appOrigin);
  await assertSetupMaintenanceRole(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await lockFirstRunSetup(client);
    await assertEmptyFirstRun(client, state);
    const token = newSessionToken();
    const result = await client.query<{ token_expires_at: Date }>(
      `UPDATE first_run_setup SET token_hash=$1,token_expires_at=clock_timestamp()+interval '15 minutes',token_used_at=NULL WHERE singleton=true RETURNING token_expires_at`,
      [hashToken(token)],
    );
    await client.query('COMMIT');
    return {
      link: `${origin}/setup#token=${token}`,
      expiresAt: result.rows[0]!.token_expires_at.toISOString(),
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* controlled error only */
    }
    if (error instanceof ApiError) throw error;
    throw new Error('Unable to issue initialization link');
  } finally {
    client.release();
  }
}
